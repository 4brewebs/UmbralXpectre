import type { UmbralProfile } from "./profile";
import { assistColor, colorFor, correctColor, extremeColor, lumaFromProfile, paintYours, type FilterSource } from "./spectrum";
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
  id: "original" | "simulate" | "correct" | "assist" | "extreme";
  name: string;
  /** `identity` leaves every color. `srgb8-base64` is the baked map. */
  encoding: "identity" | "srgb8-base64";
  changed: number;
  note: string;
  /** RGB bytes, r fastest, then g, then b. Omitted when the filter is identity. */
  bytes?: string;
};

export type TransformFile = {
  schema: "umbral.transforms.v1";
  basedOn: { schema: UmbralProfile["schema"]; createdAt: string };
  space: string;
  size: number;
  nodes: number;
  order: string;
  floor: number;
  gate: number;
  filters: TransformFilter[];
};

const GATE = 1.6;

/**
 * One element per filter. The lattice is the same function the plates and the camera apply,
 * baked from this profile. Identity filters omit the bytes.
 */
export function buildTransformFile(profile: UmbralProfile): TransformFile {
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const luma = lumaFromProfile(profile);
  const axes = profile.axes;
  const specs: Array<{
    id: TransformFilter["id"];
    name: string;
    note: string;
    apply: ((rgb: Vec3) => Vec3) | null;
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
      note: "Encoge solo la coordenada que no separas y vierte el rojo perdido hacia el cono que sí lo recoge. Aplica el brillo medido. Fuera de la banda no toca.",
      apply: (rgb) => paintYours(rgb, axes, floor, luma),
    },
    {
      id: "correct",
      name: "Mapa intermedio",
      note: "Conserva el rojo que sí cabe en la banda y pasa a azul la ganancia que no se va a ver. Fuera de la banda no toca.",
      apply: (rgb) => correctColor(rgb, axes, floor),
    },
    {
      id: "assist",
      name: "Asistencia",
      note: "Mueve un poco la banda hacia el rojo o el verde que ya separas, sin cambiar un pálido por uno vivo.",
      apply: (rgb) => assistColor(rgb, axes, floor, luma),
    },
    {
      id: "extreme",
      name: "Extremo",
      note: "La misma dirección que la asistencia, ampliada hasta el borde del gamut, para separar los píxeles de la banda.",
      apply: (rgb) => extremeColor(rgb, axes, floor, luma),
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
    filters: specs.map((spec) => bakeFilter(spec, floor)),
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
