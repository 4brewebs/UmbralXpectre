import type { UmbralProfile } from "./profile";
import { LOSS_RAMP, lossPoints } from "./lossmap";
import { BAND_GAIN, type AssistBand } from "./assistband";
import { EXTREME_TURN_DEG, assistColor, bandsFor, colorFor, extremeColor, filterTexts, labHueShift, measuredRegion, type FilterSource } from "./spectrum";
import type { EdgeFile } from "./edges";
import { linearToSrgbChannel, type Vec3 } from "./space";

/** Lattice per channel. 33³ is the usual film size: smooth enough, cheap to bake. */
export const LUT_N = 33;

export type FilterKind = "assist" | "simulate" | "extreme";

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Giro CIELAB máximo tras cuantizar: 60° el Extremo (Lucas, 26/10). La Asistencia por franja ya no lleva tope (era
 * 45° con la daltonización): la Regla B validada a ciegas no lo tiene y así la cámara coincide con láminas y Python.
 * El simulador no tiene tope.
 */
export const QUANT_CAP_DEG: Partial<Record<string, number>> = { extreme: EXTREME_TURN_DEG };

/**
 * Cuantiza `out` a 8 bits y, si el byte resultante gira más que `capDeg` respecto al nodo de entrada (también en
 * 8 bits), acerca `out` a la entrada (mezcla lineal) hasta que el byte quepa.
 */
export function quantizeCapped(input: Vec3, out: Vec3, capDeg?: number): [number, number, number] {
  const q = (v: Vec3): [number, number, number] => [0, 1, 2].map((i) => Math.round(linearToSrgbChannel(v[i]) * 255)) as [number, number, number];
  const first = q(out);
  if (capDeg == null) return first;
  const cap = (capDeg * Math.PI) / 180;
  const inQ = q(input);
  const lin = (b: number[]): Vec3 => b.map((x) => srgbToLinear(x / 255)) as Vec3;
  const inL = lin(inQ);
  const ok = (b: number[]) => labHueShift(inL, lin(b)) <= cap + 1e-9;
  if (ok(first)) return first;
  const mix = (t: number) => q([input[0] + (out[0] - input[0]) * t, input[1] + (out[1] - input[1]) * t, input[2] + (out[2] - input[2]) * t]);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mix(mid))) lo = mid;
    else hi = mid;
  }
  return ok(mix(lo)) ? mix(lo) : inQ;
}

/**
 * Bake one profile filter into an sRGB lattice.
 * The camera never reimplements the math: every entry is that function.
 * Index order is r fastest, then g, then b, RGBA.
 */
function bakeLattice(apply: (rgb: Vec3) => Vec3, capDeg?: number): Uint8Array {
  const n = LUT_N;
  const data = new Uint8Array(n * n * n * 4);
  let i = 0;
  for (let b = 0; b < n; b++) {
    const bl = srgbToLinear(b / (n - 1));
    for (let g = 0; g < n; g++) {
      const gl = srgbToLinear(g / (n - 1));
      for (let r = 0; r < n; r++) {
        const input: Vec3 = [srgbToLinear(r / (n - 1)), gl, bl];
        const [q0, q1, q2] = quantizeCapped(input, apply(input), capDeg);
        data[i++] = q0;
        data[i++] = q1;
        data[i++] = q2;
        data[i++] = 255;
      }
    }
  }
  return data;
}

/**
 * LUT 3D del simulador para la cámara. Asistencia y Extremo ya no se hornean: van píxel a píxel en el shader
 * (bandshader.ts). `source` elige el simulador (perfil o bordes).
 */
export function buildSimulatorLut(profile: UmbralProfile, source: FilterSource = "profile", files: EdgeFile[] = []): Uint8Array {
  return bakeLattice((rgb) => colorFor("simulate", rgb, profile, source, files));
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
};

export type TransformFile = {
  schema: "umbral.transforms.v2";
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
    mask: "franja medida";
    /** Franjas calculadas al cargar (no se guardan en el perfil). */
    bands: Array<{ via: string; phiDeg: number; confusionDeg: number; coreDeg: [number, number]; zeroBeyondDeg: [number, number]; core: AssistBand["core"]; tControl: number; weights: Vec3 }>;
    gain: { assist: number; extreme: number };
    extremeTurnCapDeg: number;
    notes: string[];
    /** Zonas de confusión: diagnóstico en grises, no se hornea ni se aplica como filtro. */
    lossMap?: { name: string; kind: "grises"; ratio: string; scale: "log"; lStar: [number, number]; estimated: string; points: Array<{ deg: number; ratio: number }> };
  };
  filters: TransformFilter[];
  /** Solo en archivos migrados desde v1: los parámetros del filtro por región, tal cual (no se aplican). */
  legacyParamsV1?: unknown;
};

/**
 * Carga un archivo de transformaciones v1 o v2 y lo devuelve en v2. En v1, `params` tenía la forma
 * del filtro por región (mask «región medida», region, regionSoft…): se conserva en `legacyParamsV1`
 * y `params` queda ausente. Nodos y filtros no cambian de forma. null si no es un archivo válido.
 */
export function parseTransformFile(raw: unknown): TransformFile | null {
  const parsed = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!parsed || typeof parsed !== "object") return null;
  const f = parsed as Record<string, unknown>;
  if (typeof f.size !== "number" || !Array.isArray(f.filters)) return null;
  if (f.schema === "umbral.transforms.v2") return f as unknown as TransformFile;
  if (f.schema !== "umbral.transforms.v1") return null;
  const { params, ...rest } = f;
  return { ...(rest as unknown as Omit<TransformFile, "schema" | "params">), schema: "umbral.transforms.v2", ...(params === undefined ? {} : { legacyParamsV1: params }) };
}

const GATE = 1.6;

/**
 * One element per filter. The lattice is the same function the plates and the camera apply,
 * baked from this profile. Identity filters omit the bytes.
 */
export function buildTransformFile(profile: UmbralProfile, edges: EdgeFile[] = []): TransformFile {
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const axes = profile.axes;
  const texts = filterTexts(axes, floor, measuredRegion(axes, floor, edges));
  const bands = bandsFor(profile, edges);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const none = "Sin vía elevada con franja medida: no cambia ningún color.";
  const specs: Array<{ id: TransformFilter["id"]; name: string; note: string; apply: ((rgb: Vec3) => Vec3) | null }> = [
    { id: "original", name: "Sin filtro", note: "No cambia ningún color.", apply: null },
    { id: "simulate", name: "Simulador", note: texts.simulate, apply: (rgb) => colorFor("simulate", rgb, profile, "profile", edges) },
    {
      id: "assist",
      name: "Asistencia",
      note: bands.length
        ? `Asistido por franja: en la franja que no separas mueve rojo y verde en sentidos opuestos (|ΔR| = ${BAND_GAIN.assist}·w·T(θ)), con tu luminancia y el azul iguales. Fuera de la franja, cambio 0.`
        : none,
      apply: (rgb) => assistColor(rgb, bands),
    },
    {
      id: "extreme",
      name: "Extremo",
      note: bands.length
        ? `La misma dirección que la asistencia con ganancia ${BAND_GAIN.extreme}, ampliada hacia el borde del gamut; giro ≤ ${EXTREME_TURN_DEG}°.`
        : none,
      apply: (rgb) => extremeColor(rgb, bands),
    },
  ];
  return {
    schema: "umbral.transforms.v2",
    basedOn: { schema: profile.schema, createdAt: profile.createdAt },
    space: "sRGB 8-bit. Cada nodo es el color de salida de ese filtro.",
    size: LUT_N,
    nodes: LUT_N * LUT_N * LUT_N,
    order: "Índice ((b * size + g) * size + r). r es el eje rápido. Tres bytes RGB por nodo.",
    floor: Math.round(floor * 10000) / 10000,
    gate: GATE,
    params: {
      mask: "franja medida",
      bands: bands.map((b) => ({ via: b.via, phiDeg: r2(b.phi), confusionDeg: r2(b.confusionDeg), coreDeg: [r2(b.lo), r2(b.hi)], zeroBeyondDeg: [r2(b.z0), r2(b.z1)], core: b.core, tControl: b.tControl, weights: b.weights })),
      gain: { ...BAND_GAIN },
      extremeTurnCapDeg: EXTREME_TURN_DEG,
      notes: [
        "solo la vía l por ahora; núcleo = bordes medidos (o log d ≥ ½·log d del eje), caída smoothstep hasta los vecinos medidos y cambio 0 más allá",
        "la simulación («Tu visión») es solo ilustración; no decide qué se modifica",
      ],
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
    filters: specs.map((spec) => bakeFilter(spec)),
  };
}

function bakeFilter(
  spec: { id: TransformFilter["id"]; name: string; note: string; apply: ((rgb: Vec3) => Vec3) | null },
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
        const input: Vec3 = [srgbToLinear(r / (n - 1)), gl, bl];
        const [r8, gOut, bOut] = quantizeCapped(input, spec.apply(input), QUANT_CAP_DEG[spec.id]);
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
 * Perfil para filtros: ejes validados (3AFC) + el resto como estimados; los sectores solo salen de lo validado.
 * Sin validación, null: no hay filtros (los umbrales del perfil sí/no ya no los construyen).
 * El suelo (`fit.controlAbs`) es el control validado; sin control validado, null.
 */
export function filterProfile(profile: UmbralProfile): UmbralProfile | null {
  const v = profile.validation;
  if (!v?.axes?.length) return null;
  const ids = new Set(v.axes.map((a) => a.id));
  const isVal = (a: (typeof profile.axes)[number]) => ids.has(a.id) && a.thresholdSource === "validation-3afc";
  // Punto 2 (26/10): se conservan TODOS los ejes medidos; los no validados entran en T(θ) como «estimado»
  // (razón atenuada en spectrum) y no abren sector. Solo lo validado decide si hay filtros.
  const valAxes = profile.axes.filter(isVal);
  const control = valAxes.find((a) => a.role === "control");
  if (!control?.threshold || !valAxes.some((a) => a.role !== "control")) return null;
  const axes = profile.axes.filter((a) => isVal(a) || a.role !== "control");
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
      validation: base.axes.filter((a) => a.thresholdSource === "validation-3afc").map((a) => ({ id: a.id, threshold: a.threshold ?? 0, thresholdStandardY: a.thresholdStandardY ?? 0 })),
      edges: edges.map((e) => e.cone),
    },
  };
}
