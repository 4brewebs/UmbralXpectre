import type { UmbralProfile } from "./profile";
import { LOSS_RAMP, lossPoints } from "./lossmap";
import { ADAPTIVE, adaptiveColor, GAMUT_SOFT, KNOWN_LIMITATIONS, PROVISIONAL_NOTE, REGION, assistColor, measuredRegion, type Sector, colorFor, extremeColor, filterTexts, lumaFromProfile, paintYours, type FilterSource } from "./spectrum";
import type { EdgeFile } from "./edges";
import { linearToSrgbChannel, type Vec3 } from "./space";

/** Lattice per channel. 33³ is the usual film size: smooth enough, cheap to bake. */
export const LUT_N = 33;

export type FilterKind = "assist" | "simulate" | "extreme";

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const APPLY: Record<
  FilterKind,
  (rgb: Vec3, axes: UmbralProfile["axes"], floor: number, luma: ReturnType<typeof lumaFromProfile>) => Vec3
> = {
  assist: assistColor,
  simulate: paintYours,
  extreme: extremeColor,
};

/**
 * Bake one profile filter into an sRGB lattice.
 * The camera never reimplements the math: every entry is that function.
 * Index order is r fastest, then g, then b, RGBA.
 */
function bakeLattice(apply: (rgb: Vec3) => Vec3): Uint8Array {
  const n = LUT_N;
  const data = new Uint8Array(n * n * n * 4);
  let i = 0;
  for (let b = 0; b < n; b++) {
    const bl = srgbToLinear(b / (n - 1));
    for (let g = 0; g < n; g++) {
      const gl = srgbToLinear(g / (n - 1));
      for (let r = 0; r < n; r++) {
        const out = apply([srgbToLinear(r / (n - 1)), gl, bl]);
        data[i++] = Math.round(linearToSrgbChannel(out[0]) * 255);
        data[i++] = Math.round(linearToSrgbChannel(out[1]) * 255);
        data[i++] = Math.round(linearToSrgbChannel(out[2]) * 255);
        data[i++] = 255;
      }
    }
  }
  return data;
}

export function buildFilterLut(profile: UmbralProfile, kind: FilterKind): Uint8Array {
  return bakeLattice((rgb) => {
    const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
    const luma = lumaFromProfile(profile);
    return APPLY[kind](rgb, profile.axes, floor, luma);
  });
}

export function buildFilterLuts(
  profile: UmbralProfile,
  source: FilterSource = "profile",
  files: EdgeFile[] = [],
): Record<FilterKind, Uint8Array> {
  if (source === "profile") {
    return {
      assist: buildFilterLut(profile, "assist"),
      simulate: buildFilterLut(profile, "simulate"),
      extreme: buildFilterLut(profile, "extreme"),
    };
  }
  const kinds: FilterKind[] = ["assist", "simulate", "extreme"];
  const out = {} as Record<FilterKind, Uint8Array>;
  for (const kind of kinds) out[kind] = bakeLattice((rgb) => colorFor(kind, rgb, profile, "edges", files));
  return out;
}

export type TransformFilter = {
  id: "original" | "simulate" | "assist" | "extreme";
  name: string;
  /** `identity` leaves every color. `srgb8-base64` is the baked map. */
  encoding: "identity" | "srgb8-base64";
  changed: number;
  note: string;
  /** RGB bytes, r fastest, then g, then b. Omitted when the filter is identity. */
  bytes?: string;
  /** Ganancia adaptativa por color (Asistencia/Extremo): factor k sobre la ganancia calibrada y nodos que no llegan a la meta. */
  adaptive?: {
    metric: string;
    target: number;
    activeNodes: number;
    kMean: number;
    kMax: number;
    limitedNodes: number;
    /** «limitado por tope» si algún nodo se quedó en el máximo permitido sin llegar a la meta. */
    status: "limitado por tope" | "meta alcanzada";
  };
};

export type TransformFile = {
  schema: "umbral.transforms.v1";
  basedOn: {
    schema: UmbralProfile["schema"];
    createdAt: string;
    /** De dónde salen los umbrales: solo la validación 3AFC (y los bordes, si hay). */
    thresholds?: "validation-3afc";
    validation?: Array<{ id: string; threshold: number; thresholdStandardY: number }>;
    edges?: string[];
  };
  space: string;
  size: number;
  nodes: number;
  order: string;
  floor: number;
  gate: number;
  /** Parámetros de Asistencia/Extremo con los que se hornearon los nodos (ausente en archivos anteriores). */
  params?: {
    mask: "región medida";
    region: Sector[];
    provisional: boolean;
    regionSoft: { edgeDeg: number; edgeDegExtreme: number; scaleTimes: number; provisionalGain: number };
    gamutSoft: number;
    notes: string[];
    /** Zonas de confusión: diagnóstico en grises, no se hornea ni se aplica como filtro. */
    lossMap?: { name: string; kind: "grises"; ratio: string; scale: "log"; lStar: [number, number]; estimated: string; points: Array<{ deg: number; ratio: number }> };
  };
  filters: TransformFilter[];
};

const GATE = 1.6;

/**
 * One element per filter. The lattice is the same function the plates and the camera apply,
 * baked from this profile. Identity filters omit the bytes.
 */
export function buildTransformFile(profile: UmbralProfile, edges: EdgeFile[] = []): TransformFile {
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const luma = lumaFromProfile(profile);
  const axes = profile.axes;
  const region = measuredRegion(axes, floor, edges);
  const texts = filterTexts(axes, floor, region);
  const specs: Array<{
    id: TransformFilter["id"];
    name: string;
    note: string;
    apply: ((rgb: Vec3) => Vec3) | null;
    /** Extremo (true) o Asistencia (false): se hornea con adaptiveColor y se resume en `adaptive`. */
    adaptive?: boolean;
  }> = [
    {
      id: "original",
      name: "Sin filtro",
      note: "No cambia ningún color.",
      apply: null,
    },
    {
      id: "simulate",
      name: "Simulador",
      note: texts.simulate,
      apply: (rgb) => paintYours(rgb, axes, floor, luma),
    },
    {
      id: "assist",
      name: "Asistencia",
      note: texts.assist,
      apply: (rgb) => assistColor(rgb, axes, floor, luma, region),
      adaptive: false,
    },
    {
      id: "extreme",
      name: "Extremo",
      note: texts.extreme,
      apply: (rgb) => extremeColor(rgb, axes, floor, luma, region),
      adaptive: true,
    },
  ];
  return {
    schema: "umbral.transforms.v1",
    basedOn: { schema: profile.schema, createdAt: profile.createdAt },
    space: "sRGB 8-bit. Cada nodo es el color de salida de ese filtro.",
    size: LUT_N,
    nodes: LUT_N * LUT_N * LUT_N,
    order: "Índice ((b * size + g) * size + r). r es el eje rápido. Tres bytes RGB por nodo.",
    floor: Math.round(floor * 10000) / 10000,
    gate: GATE,
    params: {
      mask: "región medida",
      region,
      provisional: region.some((sector) => sector.provisional),
      regionSoft: { edgeDeg: REGION.edgeSoftDeg, edgeDegExtreme: REGION.edgeSoftDegExtreme, scaleTimes: 1 + REGION.scaleSoft, provisionalGain: REGION.provisionalGain },
      gamutSoft: GAMUT_SOFT,
      notes: [...KNOWN_LIMITATIONS, ...(region.some((sector) => sector.provisional) ? [PROVISIONAL_NOTE] : [])],
      lossMap: {
        name: "Zonas de confusión",
        kind: "grises",
        ratio: "umbral en el tono / umbral del control",
        scale: "log",
        lStar: [LOSS_RAMP.lMin, LOSS_RAMP.lMax],
        estimated: "lados midpointToHealthy (rayado)",
        points: lossPoints(profile, edges).points.map((p) => ({ deg: Math.round(p.deg * 100) / 100, ratio: Math.round(p.ratio * 1000) / 1000 })),
      },
    },
    filters: specs.map((spec) => {
      if (spec.adaptive == null) return bakeFilter(spec, floor);
      const extreme = spec.adaptive;
      const stats = { active: 0, sum: 0, max: 0, limited: 0 };
      const baked = bakeFilter(
        {
          ...spec,
          apply: (rgb) => {
            const res = adaptiveColor(rgb, axes, floor, extreme, region);
            if (res.active) {
              stats.active++;
              stats.sum += res.k;
              stats.max = Math.max(stats.max, res.k);
              if (res.limited) stats.limited++;
            }
            return res.out;
          },
        },
        floor,
      );
      const r2 = (x: number) => Math.round(x * 100) / 100;
      return {
        ...baked,
        ...(stats.limited ? { note: `${baked.note} Limitado por tope en ${stats.limited} nodos: se aplica el máximo permitido.` } : {}),
        adaptive: {
          metric: "|diferencia| / (2 · T(ángulo de la diferencia)), T interpolado en log como «Zonas de confusión»",
          target: extreme ? ADAPTIVE.targetExtreme : ADAPTIVE.target,
          activeNodes: stats.active,
          kMean: stats.active ? r2(stats.sum / stats.active) : 0,
          kMax: r2(stats.max),
          limitedNodes: stats.limited,
          status: stats.limited ? "limitado por tope" : "meta alcanzada",
        },
      };
    }),
  };
}

function bakeFilter(
  spec: { id: TransformFilter["id"]; name: string; note: string; apply: ((rgb: Vec3) => Vec3) | null },
  _floor: number,
): TransformFilter {
  if (!spec.apply) {
    return { id: spec.id, name: spec.name, encoding: "identity", changed: 0, note: spec.note };
  }
  const n = LUT_N;
  const rgb = new Uint8Array(n * n * n * 3);
  let changed = 0;
  let i = 0;
  for (let b = 0; b < n; b++) {
    const bl = srgbToLinear(b / (n - 1));
    const b8 = Math.round((b / (n - 1)) * 255);
    for (let g = 0; g < n; g++) {
      const gl = srgbToLinear(g / (n - 1));
      const g8 = Math.round((g / (n - 1)) * 255);
      for (let r = 0; r < n; r++) {
        const out = spec.apply([srgbToLinear(r / (n - 1)), gl, bl]);
        const r8 = Math.round(linearToSrgbChannel(out[0]) * 255);
        const gOut = Math.round(linearToSrgbChannel(out[1]) * 255);
        const bOut = Math.round(linearToSrgbChannel(out[2]) * 255);
        const inR = Math.round((r / (n - 1)) * 255);
        rgb[i++] = r8;
        rgb[i++] = gOut;
        rgb[i++] = bOut;
        if (r8 !== inR || gOut !== g8 || bOut !== b8) changed += 1;
      }
    }
  }
  if (changed === 0) {
    return {
      id: spec.id,
      name: spec.name,
      encoding: "identity",
      changed: 0,
      note: `${spec.note} En este perfil no mueve ningún color.`,
    };
  }
  return {
    id: spec.id,
    name: spec.name,
    encoding: "srgb8-base64",
    changed,
    note: spec.note,
    bytes: bytesToBase64(rgb),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(text);
}

function at(lut: Uint8Array, r: number, g: number, b: number, channel: number): number {
  const n = LUT_N;
  return lut[((b * n + g) * n + r) * 4 + channel];
}

/** Trilinear sample. Inputs are 0–255 sRGB, the same space the camera texture uses. */
export function sampleLut(lut: Uint8Array, r8: number, g8: number, b8: number): [number, number, number] {
  const n = LUT_N;
  const scale = n - 1;
  const x = Math.min(scale, Math.max(0, (r8 / 255) * scale));
  const y = Math.min(scale, Math.max(0, (g8 / 255) * scale));
  const z = Math.min(scale, Math.max(0, (b8 / 255) * scale));
  const x0 = Math.min(n - 2, Math.floor(x));
  const y0 = Math.min(n - 2, Math.floor(y));
  const z0 = Math.min(n - 2, Math.floor(z));
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(lut, x0, y0, z0, c) * (1 - tx) + at(lut, x0 + 1, y0, z0, c) * tx;
    const c10 = at(lut, x0, y0 + 1, z0, c) * (1 - tx) + at(lut, x0 + 1, y0 + 1, z0, c) * tx;
    const c01 = at(lut, x0, y0, z0 + 1, c) * (1 - tx) + at(lut, x0 + 1, y0, z0 + 1, c) * tx;
    const c11 = at(lut, x0, y0 + 1, z0 + 1, c) * (1 - tx) + at(lut, x0 + 1, y0 + 1, z0 + 1, c) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    out[c] = Math.round(c0 * (1 - tz) + c1 * tz);
  }
  return out;
}

/**
 * Perfil para filtros: solo los ejes de la validación 3AFC (sus umbrales ya sustituyen a los del perfil).
 * Sin validación, null: no hay filtros (los umbrales del perfil sí/no ya no los construyen).
 * El suelo (`fit.controlAbs`) es el control validado; sin control validado, null.
 */
export function filterProfile(profile: UmbralProfile): UmbralProfile | null {
  const v = profile.validation;
  if (!v?.axes?.length) return null;
  const ids = new Set(v.axes.map((a) => a.id));
  const axes = profile.axes.filter((a) => ids.has(a.id) && a.thresholdSource === "validation-3afc");
  const control = axes.find((a) => a.role === "control");
  if (!control?.threshold || !axes.some((a) => a.role !== "control")) return null;
  return { ...profile, axes, fit: { ...profile.fit, controlAbs: control.threshold } };
}

/** Transformaciones solo desde la validación 3AFC y los bordes; null sin validación. */
export function buildFilterTransforms(profile: UmbralProfile, edges: EdgeFile[] = []): TransformFile | null {
  const base = filterProfile(profile);
  if (!base) return null;
  const file = buildTransformFile(base, edges);
  return {
    ...file,
    basedOn: {
      ...file.basedOn,
      thresholds: "validation-3afc",
      validation: base.axes.map((a) => ({ id: a.id, threshold: a.threshold ?? 0, thresholdStandardY: a.thresholdStandardY ?? 0 })),
      edges: edges.map((e) => e.cone),
    },
  };
}
