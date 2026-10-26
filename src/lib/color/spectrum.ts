import { num } from "../format";
/**
 * Visible-spectrum strip for the result card.
 * Wavelengths are only a map. The heights come from this screen's thresholds.
 */

import {
  ANCHOR,
  addScaled,
  angDist,
  dirFromTheta,
  dot,
  hueName,
  lineGap,
  luminance,
  norm,
  normalize,
  thetaOf,
  type Vec3,
} from "./space";
import { deltaE00Linear, labOfLinear } from "./deltaE";
import type { UmbralProfile } from "./profile";
import type { EdgeFile } from "./edges";

type Pathway = UmbralProfile["fit"]["pathways"][number];
type AxisMark = {
  id?: string;
  angleDeg: number;
  threshold: number | null;
  role?: string;
  parentId?: string | null;
  thresholdKind?: string | null;
};
export type LumaGain = { angleDeg: number; gain: number };

/** Relative to the yellow ruler. A gain above 1 means that direction looks dimmer than the screen's light. */
export function lumaFromProfile(profile: UmbralProfile): LumaGain[] {
  const matches = profile.luminance?.matches ?? [];
  const ruler = matches.find((match) => match.kind === "control" && match.bound !== "unconverged" && match.gain > 0);
  if (!ruler) return [];
  const gains: LumaGain[] = [];
  for (const match of matches) {
    if (match.kind === "control") continue;
    const gainValue = matchGain(match);
    if (gainValue == null) continue;
    const gain = gainValue / ruler.gain;
    if (!(gain > 0) || Math.abs(gain - 1) < 0.015) continue;
    const id = match.axisId.replace(/:(cruce|extremo|edge)$/, "");
    const axis = profile.axes.find((item) => item.id === id);
    if (!axis) continue;
    gains.push({ angleDeg: axis.angleDeg, gain });
  }
  return gains;
}

function matchGain(match: NonNullable<UmbralProfile["luminance"]>["matches"][number]): number | null {
  if (match.bound !== "unconverged" && match.gain > 0) return match.gain;
  const dim = match.samples.filter((sample) => !sample.tooBright && sample.answer !== "still").map((sample) => sample.gain);
  const bright = match.samples.filter((sample) => sample.tooBright).map((sample) => sample.gain);
  if (!dim.length || !bright.length) return null;
  const low = Math.max(...dim);
  const high = Math.min(...bright);
  if (!(high > low) || high - low > 0.12) return null;
  return (low + high) / 2;
}

/** CIE 1931 2°, 10 nm. Enough to paint a spectrum, not a lab curve. */
const CMF: Array<[number, number, number, number]> = [
  [420, 0.1344, 0.004, 0.6456],
  [430, 0.2839, 0.0116, 1.3856],
  [440, 0.3483, 0.023, 1.7471],
  [450, 0.3362, 0.038, 1.7721],
  [460, 0.2908, 0.06, 1.6692],
  [470, 0.1954, 0.091, 1.2876],
  [480, 0.0956, 0.139, 0.813],
  [490, 0.032, 0.208, 0.4652],
  [500, 0.0049, 0.323, 0.272],
  [510, 0.0093, 0.503, 0.1582],
  [520, 0.0633, 0.71, 0.0782],
  [530, 0.1655, 0.862, 0.0422],
  [540, 0.2904, 0.954, 0.0203],
  [550, 0.4334, 0.995, 0.0087],
  [560, 0.5945, 0.995, 0.0039],
  [570, 0.7621, 0.952, 0.0021],
  [580, 0.9163, 0.87, 0.0017],
  [590, 1.0263, 0.757, 0.0011],
  [600, 1.0622, 0.631, 0.0008],
  [610, 1.0026, 0.503, 0.0003],
  [620, 0.8544, 0.381, 0.0002],
  [630, 0.6424, 0.265, 0],
  [640, 0.4479, 0.175, 0],
  [650, 0.2835, 0.107, 0],
  [660, 0.1649, 0.061, 0],
  [670, 0.0874, 0.032, 0],
];

const XYZ_TO_RGB: number[][] = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

const NM_MIN = 420;
const NM_MAX = 670;

export const CONE_MARKS = [
  { id: "s", nm: 445, name: "Conos azules" },
  { id: "m", nm: 540, name: "Conos verdes" },
  { id: "l", nm: 570, name: "Conos rojos" },
] as const;

function xyzToRgb(x: number, y: number, z: number): Vec3 {
  return [
    XYZ_TO_RGB[0][0] * x + XYZ_TO_RGB[0][1] * y + XYZ_TO_RGB[0][2] * z,
    XYZ_TO_RGB[1][0] * x + XYZ_TO_RGB[1][1] * y + XYZ_TO_RGB[1][2] * z,
    XYZ_TO_RGB[2][0] * x + XYZ_TO_RGB[2][1] * y + XYZ_TO_RGB[2][2] * z,
  ];
}

/** Pull a color onto the anchor luminance and back inside the sRGB cube. */
function fitAnchor(rgb: Vec3): Vec3 {
  const y = luminance(rgb);
  if (y < 1e-6) return [ANCHOR, ANCHOR, ANCHOR];
  const scaled: Vec3 = [rgb[0] * (ANCHOR / y), rgb[1] * (ANCHOR / y), rgb[2] * (ANCHOR / y)];
  let lo = 0;
  let hi = 1;
  let best: Vec3 = [ANCHOR, ANCHOR, ANCHOR];
  for (let i = 0; i < 18; i++) {
    const t = (lo + hi) / 2;
    const mix = addScaled([ANCHOR, ANCHOR, ANCHOR], [scaled[0] - ANCHOR, scaled[1] - ANCHOR, scaled[2] - ANCHOR], t);
    if (mix.every((c) => c >= 0.02 && c <= 0.94)) {
      best = mix;
      lo = t;
    } else {
      hi = t;
    }
  }
  return best;
}

export function spectrumSamples(): Array<{ nm: number; rgb: Vec3 }> {
  return CMF.map(([nm, x, y, z]) => ({ nm, rgb: fitAnchor(xyzToRgb(x, y, z)) }));
}

export function markLeft(nm: number): number {
  return ((nm - NM_MIN) / (NM_MAX - NM_MIN)) * 100;
}

const ringCache = new WeakMap<AxisMark[], { floor: number; pts: { a: number; t: number }[] }>();

/** The three cones, their neighbors, and the control. Pure red and pure blue stay references. */
function ringAxes(axes: AxisMark[]): AxisMark[] {
  return axes.filter((axis) => {
    if (axis.role === "red-end" || axis.role === "blue-end") return false;
    if (axis.parentId === "red-end" || axis.parentId === "blue-end") return false;
    return true;
  });
}

function thresholdRing(axes: AxisMark[], floor: number): { a: number; t: number }[] {
  const cached = ringCache.get(axes);
  if (cached && cached.floor === floor) return cached.pts;
  const pts: { a: number; t: number }[] = [];
  for (const axis of ringAxes(axes)) {
    if (axis.threshold == null || !(axis.threshold > 0) || !Number.isFinite(axis.angleDeg)) continue;
    const base = (axis.angleDeg * Math.PI) / 180;
    for (let turn = -2; turn <= 2; turn++) pts.push({ a: base + turn * Math.PI, t: axis.threshold });
  }
  pts.sort((p, q) => p.a - q.a);
  ringCache.set(axes, { floor, pts });
  return pts;
}

/** Threshold in direction θ. Both rays of a measured line, raw, with no extra gate. */
export function thresholdAt(theta: number, axes: AxisMark[], floor: number): number {
  const pts = thresholdRing(axes, floor);
  if (!pts.length) return floor;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].a <= theta) lo = mid;
    else hi = mid - 1;
  }
  const bracketed = lo < pts.length - 1 && pts[lo].a <= theta && theta <= pts[lo + 1].a;
  const left = bracketed ? pts[lo] : pts[0];
  const right = bracketed ? pts[lo + 1] : pts[pts.length - 1];
  const span = right.a - left.a;
  if (span < 1e-6) return Math.max(floor, left.t);
  const f = (theta - left.a) / span;
  return Math.max(floor, left.t + (right.t - left.t) * f);
}

const GATE = 1.6;
/** A bad axis paints this far and then stops. The pure red this display measured as seen stays outside. */
const BAND_HALF = (10 * Math.PI) / 180;
/** Tope duro de giro de tono de la asistencia del perfil (60° en Extremo). */
const ROT_CAP = (45 * Math.PI) / 180;
const ROT_CAP_EXTREME = (60 * Math.PI) / 180;
/** Máscara de la daltonización: distancia (plano) a la línea de confusión a la que el cambio ya es exactamente 0. */
const MASK_CORE = (8 * Math.PI) / 180;
export const MASK_EDGE = (35 * Math.PI) / 180;
/** Inyección en S acotada: como mucho esta fracción del croma del píxel (Extremo, la segunda). */
/** Tope de croma de salida (radio en el plano) frente al de entrada. */
const CHROMA_CAP = 2.5;
const S_BOUND = 1;
const S_BOUND_EXTREME = 1.7;
const DALTON_GAIN = 2;
const DALTON_GAIN_EXTREME = 4;
const ASSIST_TURN = 0.7;
const EXTREME_GAIN = 5.5;
const ALIAS_LEAK = 1;
const ASSIST_LUMA = 0.35;

type Family = "l" | "m" | "s";
type Band = { mid: number; T: number; both: boolean };
type FilterModel = {
  floor: number;
  bands: Band[];
  weak: Family | null;
  catcher: number | null;
  blue: number | null;
  /** Línea de confusión de la daltonización: la banda del cono más débil (o la peor). */
  confusion: Band | null;
};

const modelCache = new WeakMap<AxisMark[], FilterModel>();

function isReference(axis: AxisMark): boolean {
  return axis.role === "red-end" || axis.role === "blue-end" || axis.parentId === "red-end" || axis.parentId === "blue-end";
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function lobeWeight(theta: number, band: Band): number {
  const d = band.both ? lineGap(theta, band.mid) : angDist(theta, band.mid);
  if (d >= BAND_HALF) return 0;
  const raised = Math.cos((Math.PI * 0.5 * d) / BAND_HALF);
  return raised * raised;
}

/**
 * Vía que recoge lo perdido en la simulación (derivada del perfil, no fija por cono): el eje de cono medido
 * (l, m, s; no el propio) más cercano a la carta opuesta del eje que falla.
 */
function catcherFor(axes: AxisMark[], weakAngle: number, weakRole: string | null): number | null {
  const opposite = weakAngle + Math.PI;
  let best: number | null = null;
  let bestD = Infinity;
  for (const axis of axes) {
    if (isReference(axis) || axis.role === weakRole || !(axis.role === "l" || axis.role === "m" || axis.role === "s")) continue;
    if (!Number.isFinite(axis.angleDeg)) continue;
    const d = angDist(opposite, rad(axis.angleDeg));
    if (d < bestD) {
      bestD = d;
      best = rad(axis.angleDeg);
    }
  }
  return best;
}

function roleAngle(axes: AxisMark[], role: string): number | null {
  const axis = axes.find((item) => item.role === role && Number.isFinite(item.angleDeg));
  return axis ? rad(axis.angleDeg) : null;
}

/**
 * Bands for the filters only. An axis joins when its own estimate clears 1.6× the control.
 * Both cards of a bad cone are the band. A side probe is only the ray that was measured,
 * so the opposite of that probe does not paint a neighbour the test already separated.
 * The weight dies within 10° instead of being interpolated into that neighbour.
 */
function filterModel(axes: AxisMark[], floor: number): FilterModel {
  const cached = modelCache.get(axes);
  if (cached && cached.floor === floor) return cached;
  const gate = floor * GATE;
  const usable = axes.filter(
    (axis) =>
      !isReference(axis) &&
      axis.thresholdKind !== "upper-bound" &&
      axis.threshold != null &&
      axis.threshold > 0 &&
      Number.isFinite(axis.angleDeg),
  );
  const bad = usable.filter((axis) => (axis.threshold ?? 0) > gate);
  const cones = bad.filter((axis) => axis.role === "l" || axis.role === "m" || axis.role === "s");
  let weak: Family | null = null;
  if (cones.length) {
    weak = cones.reduce((a, b) => ((a.threshold ?? 0) > (b.threshold ?? 0) ? a : b)).role as Family;
  } else if (bad.length) {
    const parent = bad.reduce((a, b) => ((a.threshold ?? 0) > (b.threshold ?? 0) ? a : b)).parentId;
    if (parent === "l" || parent === "m" || parent === "s") weak = parent;
  }
  const weakAxis = weak ? axes.find((axis) => axis.role === weak && !isReference(axis)) : undefined;
  const catcher = weakAxis ? catcherFor(axes, rad(weakAxis.angleDeg), weak) : null;
  const blueAxis = axes.find((axis) => axis.role === "s" && !isReference(axis));
  const blue =
    blueAxis && blueAxis.thresholdKind !== "upper-bound" && (blueAxis.threshold ?? 0) > gate ? null : roleAngle(axes, "s");
  const bands: Band[] = bad.map((axis) => {
    const both = axis.role === "l" || axis.role === "m" || axis.role === "s";
    const raw = rad(axis.angleDeg);
    const mid = raw;
    return {
      mid,
      T: axis.threshold ?? gate,
      both,
    };
  });
  const confusion = bands.length
    ? bands.reduce((x, y) => (x.both !== y.both ? (x.both ? x : y) : x.T >= y.T ? x : y))
    : null;
  const model = { floor, bands, weak, catcher, blue, confusion };
  modelCache.set(axes, model);
  return model;
}

function activeBand(theta: number, model: FilterModel): { w: number; band: Band } | null {
  let band: Band | null = null;
  let w = 0;
  for (const candidate of model.bands) {
    const next = lobeWeight(theta, candidate);
    if (next > w) {
      w = next;
      band = candidate;
    }
  }
  return band && w > 0 ? { w, band } : null;
}

function lumaGainAt(theta: number, luma: LumaGain[]): number {
  let best = 1;
  let bestD = BAND_HALF;
  for (const sample of luma) {
    const d = angDist(theta, rad(sample.angleDeg));
    if (d < bestD) {
      bestD = d;
      best = sample.gain;
    }
  }
  return best;
}

/** Put a chromatic plane back on luminance `y` and inside the cube, without moving the hue. */
function planeColor(y: number, plane: Vec3): Vec3 {
  const yClamped = Math.min(1, Math.max(0, y));
  let scale = 1;
  for (let i = 0; i < 3; i++) {
    const channel = plane[i];
    if (Math.abs(channel) < 1e-8) continue;
    const room = channel > 0 ? (1 - yClamped) / channel : -yClamped / channel;
    if (room < scale) scale = room;
  }
  if (!(scale > 0)) return [yClamped, yClamped, yClamped];
  const s = Math.min(1, scale);
  return [yClamped + plane[0] * s, yClamped + plane[1] * s, yClamped + plane[2] * s];
}

function splitPlane(plane: Vec3, mid: number): { u: Vec3; p: number; n: Vec3 } {
  const u = dirFromTheta(mid);
  const p = dot(plane, u);
  const n: Vec3 = [plane[0] - u[0] * p, plane[1] - u[1] * p, plane[2] - u[2] * p];
  return { u, p, n };
}

/**
 * What this profile sees, shown to someone who separates the band.
 * Only the confusion coordinate shrinks. The lost red is caught by the intact cone, not dropped to gray.
 */
export function paintYours(rgb: Vec3, axes: AxisMark[], floor: number, luma: LumaGain[] = []): Vec3 {
  if (!(floor > 0)) return rgb;
  const y = luminance(rgb);
  const plane = killPlane(rgb, y);
  if (norm(plane) < 1e-4) return rgb;
  const model = filterModel(axes, floor);
  const hit = activeBand(thetaOf(plane), model);
  if (!hit) return rgb;
  const { u, p, n } = splitPlane(plane, hit.band.mid);
  const seen = Math.min(1, floor / hit.band.T);
  const pSim = p * (1 - hit.w * (1 - seen));
  const lost = p - pSim;
  // Solo la carta medida (el rayo del eje que falla) vierte hacia la vía que lo recoge; igual para l, m y s.
  const spill = Math.max(lost, 0);
  const alias = model.catcher == null ? null : dirFromTheta(model.catcher);
  const leak = alias == null ? 0 : spill * ALIAS_LEAK;
  const plane2: Vec3 = [
    n[0] + u[0] * pSim + (alias ? alias[0] * leak : 0),
    n[1] + u[1] * pSim + (alias ? alias[1] * leak : 0),
    n[2] + u[2] * pSim + (alias ? alias[2] * leak : 0),
  ];
  const y2 = y / (1 + (lumaGainAt(thetaOf(plane), luma) - 1) * hit.w);
  return planeColor(y2, plane2);
}


/**
 * Daltonización clásica (Fidaner et al.), base de Asistencia y Extremo en modo Perfil (Colorado, 6.ª ronda).
 * La señal L−M que este perfil pierde en su línea de confusión (p·(1 − visto)) se reinyecta en el eje S, con signo:
 * el lado rojizo y el verdoso de la banda van a extremos OPUESTOS de S. Desplazamiento proporcional a lo perdido,
 * con tope de giro de tono (45°, 60° en Extremo). Solo croma: la Y personal no cambia. Si se sale del gamut, se
 * acorta el desplazamiento; nunca se recorta el canal.
 */
function labHue(rgb: Vec3): { h: number; c: number } {
  const lab = labOfLinear(rgb);
  return { h: Math.atan2(lab[2], lab[1]), c: Math.hypot(lab[1], lab[2]) };
}

/** Giro de tono CIELAB (rad) entre dos colores; 0 si alguno es casi acromático. */
export function labHueShift(a: Vec3, b: Vec3): number {
  const ha = labHue(a);
  const hb = labHue(b);
  if (ha.c < 1 || hb.c < 1) return 0;
  return angDist(ha.h, hb.h);
}

/**
 * Tope por nodo del giro de tono CIELAB (Colorado, 7.ª ronda): si `out` gira más que `cap` respecto a `rgb`,
 * se mezcla hacia `rgb` (en lineal, misma Y si ambos la tienen) hasta que quepa.
 */
function limitLabHue(rgb: Vec3, out: Vec3, cap: number): Vec3 {
  if (labHueShift(rgb, out) <= cap) return out;
  const mix = (t: number): Vec3 => [rgb[0] + (out[0] - rgb[0]) * t, rgb[1] + (out[1] - rgb[1]) * t, rgb[2] + (out[2] - rgb[2]) * t];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (labHueShift(rgb, mix(mid)) <= cap) lo = mid;
    else hi = mid;
  }
  return lo <= 0 ? rgb : mix(lo);
}

/**
 * Máscara suave por distancia (plano) a la línea de confusión (Colorado, 8.ª ronda): 1 hasta 8°, borde coseno
 * elevado (C¹, sin saltos) hasta 35° y 0 exacto a partir de ahí.
 */
export function bandMask(theta: number, mid: number, core = MASK_CORE, edge = MASK_EDGE): number {
  const d = lineGap(theta, mid);
  if (d <= core) return 1;
  if (d >= edge) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * (d - core)) / (edge - core)));
}


/** Mayor t ∈ [0, 1] con y + plane + disp·t dentro del cubo y giro (plano) ≤ cap. Proporcional al hueco al gamut. */
function reachT(y: number, plane: Vec3, disp: Vec3, cap: number, chromaCap = Infinity): number {
  const radius = norm(plane);
  const ok = (t: number): boolean => {
    const q: Vec3 = [plane[0] + disp[0] * t, plane[1] + disp[1] * t, plane[2] + disp[2] * t];
    if (norm(q) > chromaCap * radius + 1e-12) return false;
    const c = dot(q, plane) / (norm(q) * radius || 1);
    if (Math.acos(Math.max(-1, Math.min(1, c))) > cap + 1e-9) return false;
    return q.every((v) => y + v >= -1e-9 && y + v <= 1 + 1e-9);
  };
  if (ok(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}


function mixRgb(a: Vec3, b: Vec3, w: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}

/** Las 6 esquinas saturadas de la pantalla (R, G, B, C, M, Y). */
const CORNERS: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]];
/** Giro máximo en una esquina (Asistencia) y distancia (RGB lineal) a la que el tope vuelve a ser el normal. */
export const CORNER_GUARD = { capDeg: 10, radius: 0.35 };
/** Tope de giro con guardia de identidad en las 6 esquinas: ≤ 10° en la esquina, transición C1 hasta el tope normal. */
function cornerCap(rgb: Vec3, cap: number): number {
  const corner = rad(CORNER_GUARD.capDeg);
  if (cap <= corner) return cap;
  let d = Infinity;
  for (const c of CORNERS) d = Math.min(d, Math.hypot(rgb[0] - c[0], rgb[1] - c[1], rgb[2] - c[2]));
  return corner + (cap - corner) * smoothstep(0, CORNER_GUARD.radius, d);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Anchura de la atenuación en la pared del gamut (margen del canal que se mueve). */
export const GAMUT_SOFT = 0.3;
/**
 * Atenuación C1 en la pared del gamut (Colorado, 4.ª ronda): producto por canal de smoothstep(0, GAMUT_SOFT, margen),
 * y cada factor entra según cuánto se mueve ese canal (smoothstep de |d_i|/máx|d|), sin min() ni tramos lineales.
 */
function gamutAtten(a: Vec3, b: Vec3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dm = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  if (dm < 1e-9) return 1;
  let w = 1;
  for (let i = 0; i < 3; i++) {
    const up = smoothstep(-0.25, 0.25, d[i] / dm); // 1 si sube, 0 si baja; C1 al cruzar 0
    const room = up * (1 - a[i]) + (1 - up) * a[i];
    const moving = smoothstep(0, 0.25, Math.abs(d[i]) / dm);
    w *= 1 - moving * (1 - smoothstep(0, GAMUT_SOFT, room));
  }
  return w;
}

/** Notas del filtro (principio «solo lo medido», 26-10-2026). Las dos limitaciones previas se retiran: ver texto. */
export const KNOWN_LIMITATIONS = [
  "máscara solo con datos medidos: por lado, borde encontrado → hasta el borde; toEnd → hasta el primer eje sano; sin explorar → punto medio hacia el eje sano (provisional, 70 %); por debajo de la escala de fallo medida; fuera, cambio 0 (coseno 12°, Extremo 14°)",
  "la simulación («Tu visión») es solo ilustración; no decide qué se modifica",
  "colores fuera de la región medida (p. ej. saturados) sin corrección hasta que se mida fallo ahí",
  "retirada «esquina azul saturada de la gama: sin corrección»: queda fuera de la región medida, cambio 0 por diseño (no es zona medida, no una limitación del filtro)",
  "retirada «escalón cian→menta al 50 % en la pared verde, ~181–205°»: la pared verde queda fuera de la región; el barrido HSV ya no añade escalón",
];
export const PROVISIONAL_NOTE = "provisional: algún lado sin borde medido (sin explorar / «unmeasurable» / sin bordes) llega al punto medio hacia el primer eje sano y corrige al 70 %";


/**
 * Región medida (principio de Lucas, 26-10-2026: «solo modificar lo que sabemos y podemos medir que el usuario
 * falla»). Asistencia/Extremo solo tocan píxeles dentro de un sector medido y por debajo de la escala hasta la que
 * se midió el fallo. La simulación («Tu visión») ya no decide nada.
 * - Eje elevado con bordes medidos (ambos lados «found»): sector [minus, plus]; escala = profundidad medida
 *   (depth.scale) o el umbral del eje.
 * - Eje elevado sin bordes (sin explorar, «unmeasurable», abierto o en el techo): ±10° alrededor del ángulo
 *   medido del eje, escala = umbral del eje; provisional.
 * Fuera: cambio 0, con transición C1 (smoothstep) en ángulo y en escala.
 */
export type SideSource = "edge" | "toEnd" | "midpointToHealthy";
export type SectorSide = { deg: number; source: SideSource; provisional: boolean; healthyDeg: number | null };
export type Sector = {
  axis: string;
  centerDeg: number;
  loDeg: number;
  hiDeg: number;
  minus: SectorSide;
  plus: SectorSide;
  scale: number;
  provisional: boolean;
};
/** Transición coseno (C1) de 12° (Extremo 14°) en cada extremo, ensanchada al calibrar la ganancia con T/floor ≥ 1,6; los lados provisionales corrigen al 70 %. */
/** Extremo usa una transición más ancha (Colorado, 26/10): su desplazamiento es mayor y el escalón crece con él. */
export const REGION = { edgeSoftDeg: 12, edgeSoftDegExtreme: 14, scaleSoft: 0.5, provisionalGain: 0.7 };

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Eje medido sano: cualquier eje (control, l, m, s, red-end, blue-end o vecino) con umbral ≤ gate o cota «o menos». */
function isHealthy(axis: AxisMark, gate: number): boolean {
  if (!Number.isFinite(axis.angleDeg) || axis.threshold == null || !(axis.threshold > 0)) return false;
  return axis.thresholdKind === "upper-bound" || axis.threshold <= gate;
}

/** Primer eje sano medido en esa dirección (cualquier eje medido no elevado): distancia angular (°) > 0. */
function healthyReach(axes: AxisMark[], gate: number, from: number, dir: 1 | -1): { dist: number; deg: number } | null {
  let best: { dist: number; deg: number } | null = null;
  for (const axis of axes) {
    if (!isHealthy(axis, gate)) continue;
    const dist = ((((axis.angleDeg - from) * dir) % 360) + 360) % 360;
    if (dist > 1e-6 && (!best || dist < best.dist)) best = { dist, deg: axis.angleDeg };
  }
  return best;
}

/**
 * Reglas por lado (decisión 26/10), en orden:
 * 1) borde encontrado → el sector llega al borde;
 * 2) toEnd (sigue fallando hasta el final explorado / gamut) → banda lateral completa hasta el primer eje sano;
 * 3) sin explorar / «unmeasurable» → hasta el punto medio entre el eje que falla y el primer eje sano (provisional);
 * 4) sin bordes → regla 3 en ambos lados, centrada en el punto crítico del perfil (ángulo medido del eje).
 * Nunca pasa del primer eje sano medido. Cada regla es una función: cambiarlas no toca el resto.
 */
type SideRule = (ctx: { center: number; dir: 1 | -1; healthy: { dist: number; deg: number } | null; side: EdgeSide | null }) => SectorSide | null;
type EdgeSide = NonNullable<EdgeFile["minus"]>;
const NO_HEALTHY_DIST = 90;
const sideRules: SideRule[] = [
  ({ center, dir, healthy, side }) => {
    if (!side || !(side.result === "found" || (side.result == null && side.found && !side.toEnd)) || side.angleDeg == null) return null;
    const dist = Math.min(((((side.angleDeg - center) * dir) % 360) + 360) % 360, healthy?.dist ?? 360);
    return { deg: center + dir * dist, source: "edge", provisional: false, healthyDeg: healthy?.deg ?? null };
  },
  ({ center, dir, healthy, side }) => {
    if (!side || !(side.result === "noEdgeToGamut" || side.toEnd)) return null;
    return { deg: center + dir * (healthy?.dist ?? NO_HEALTHY_DIST), source: "toEnd", provisional: false, healthyDeg: healthy?.deg ?? null };
  },
  ({ center, dir, healthy }) => ({
    deg: center + (dir * (healthy?.dist ?? NO_HEALTHY_DIST)) / 2,
    source: "midpointToHealthy",
    provisional: true,
    healthyDeg: healthy?.deg ?? null,
  }),
];
function buildSide(center: number, dir: 1 | -1, healthy: { dist: number; deg: number } | null, side: EdgeSide | null): SectorSide {
  for (const rule of sideRules) {
    const out = rule({ center, dir, healthy, side });
    if (out) return out;
  }
  throw new Error("sin regla de lado");
}

export function measuredRegion(axes: AxisMark[], floor: number, edges: EdgeFile[] = []): Sector[] {
  if (!(floor > 0)) return [];
  const gate = floor * GATE;
  const out: Sector[] = [];
  for (const axis of axes) {
    if (isReference(axis) || axis.threshold == null || !(axis.threshold > gate) || axis.thresholdKind === "upper-bound") continue;
    if (!(axis.role === "l" || axis.role === "m" || axis.role === "s")) continue;
    const file = edges.find((e) => e.cone === axis.role);
    const usable = file && file.band !== "unmeasurable" && file.band !== "none" ? file : null;
    const center = axis.angleDeg;
    const minus = buildSide(center, -1, healthyReach(axes, gate, center, -1), usable?.minus ?? null);
    const plus = buildSide(center, 1, healthyReach(axes, gate, center, 1), usable?.plus ?? null);
    out.push({
      axis: axis.id ?? axis.role,
      centerDeg: center,
      loDeg: minus.deg,
      hiDeg: plus.deg,
      minus,
      plus,
      scale: usable?.depth?.scale ?? axis.threshold,
      provisional: minus.provisional || plus.provisional,
    });
  }
  return out;
}

/** Peso C1 de la región y ganancia (1 en lados medidos, 0,7 en provisionales). */
export function regionInfo(theta: number, radius: number, sectors: Sector[], softDeg: number = REGION.edgeSoftDeg): { w: number; gain: number } {
  let best = { w: 0, gain: 1 };
  const deg = (theta * 180) / Math.PI;
  for (const sct of sectors) {
    const rel = wrapDeg(deg - sct.centerDeg);
    const sideDeg = rel >= 0 ? sct.hiDeg - sct.centerDeg : sct.centerDeg - sct.loDeg;
    const outside = Math.max(0, Math.abs(rel) - sideDeg);
    const ws = 1 - smoothstep(0, softDeg, outside);
    const wr = 1 - smoothstep(sct.scale, sct.scale * (1 + REGION.scaleSoft), radius);
    const w = ws * wr;
    if (w > best.w) best = { w, gain: (rel >= 0 ? sct.plus : sct.minus).provisional ? REGION.provisionalGain : 1 };
  }
  return best;
}
export function regionMask(theta: number, radius: number, sectors: Sector[]): number {
  return regionInfo(theta, radius, sectors).w;
}
const regionCache = new WeakMap<AxisMark[], { floor: number; sectors: Sector[] }>();
function defaultRegion(axes: AxisMark[], floor: number): Sector[] {
  const c = regionCache.get(axes);
  if (c && c.floor === floor) return c.sectors;
  const sectors = measuredRegion(axes, floor);
  regionCache.set(axes, { floor, sectors });
  return sectors;
}

/** Corrección de un eje elevado: su propia línea, su vía objetivo y su sector (Colorado, generalización 26/10). */
export type Correction = {
  sector: Sector;
  axisId: string;
  role: string;
  /** Rayo medido del eje que falla (rad); el signo de la proyección sobre él decide el lado. */
  line: number;
  T: number;
  /** Dirección (rad) de la inyección para la carta medida; la opuesta va al otro extremo. */
  target: number;
  /** Eje sano elegido (id) o «perpendicular» si ninguno cae en ±45° de la perpendicular. */
  targetId: string;
  targetRole: string | null;
  margin: number | null;
};

/**
 * Objetivo: la vía sana medida con más margen (gate / umbral) dentro de ±45° (como línea) de la perpendicular a la
 * línea de confusión; si ninguna cae ahí, la perpendicular. Sin ninguna vía sana medida, no se corrige (null).
 */
function pickTarget(axes: AxisMark[], line: number, gate: number): Pick<Correction, "target" | "targetId" | "targetRole" | "margin"> | null {
  const healthy = axes.filter((axis) => isHealthy(axis, gate));
  if (!healthy.length) return null;
  const perp = line + Math.PI / 2;
  let best: AxisMark | null = null;
  let bestMargin = -Infinity;
  let bestGap = Infinity;
  for (const axis of healthy) {
    const gap = lineGap(rad(axis.angleDeg), perp);
    if (gap > ROT_CAP + 1e-9) continue;
    const margin = gate / (axis.threshold as number);
    if (margin > bestMargin + 1e-9 || (Math.abs(margin - bestMargin) <= 1e-9 && gap < bestGap)) {
      best = axis;
      bestMargin = margin;
      bestGap = gap;
    }
  }
  let target = best ? rad(best.angleDeg) : perp;
  // Orientación fija respecto a la perpendicular: la carta medida (p > 0) va a +objetivo, la opuesta a −objetivo.
  if (Math.cos(target - perp) < 0) target += Math.PI;
  return best
    ? { target, targetId: best.id ?? best.role ?? "?", targetRole: best.role ?? null, margin: bestMargin }
    : { target, targetId: "perpendicular", targetRole: null, margin: null };
}

const correctionCache = new WeakMap<object, Correction[]>();
export function corrections(axes: AxisMark[], floor: number, region?: Sector[]): Correction[] {
  const sectors = region ?? defaultRegion(axes, floor);
  const cached = correctionCache.get(sectors);
  if (cached) return cached;
  const gate = floor * GATE;
  const out: Correction[] = [];
  for (const sector of sectors) {
    const axis = axes.find((item) => (item.id ?? item.role) === sector.axis);
    if (!axis || axis.threshold == null) continue;
    const line = rad(sector.centerDeg);
    const pick = pickTarget(axes, line, gate);
    if (!pick) continue;
    out.push({ sector, axisId: sector.axis, role: axis.role ?? sector.axis, line, T: axis.threshold, ...pick });
  }
  correctionCache.set(sectors, out);
  return out;
}

/**
 * Fracción de la proyección que se reinyecta. Calibrada para que con T/floor = 1,6 (el umbral de entrada) la
 * simulación del perfil ya separe los pares del sector a ≥ 1,5× el control (≥ 2× en Extremo).
 */
/** Subida de croma junto al giro (Asistencia / Extremo). */
export const RADIAL_BOOST = 0.8;
export const RADIAL_BOOST_EXTREME = 0.5;
export const LOSS_FLOOR = 1;
function lostFraction(T: number, floor: number): number {
  return Math.max(LOSS_FLOOR, 1 - floor / T);
}

/**
 * Daltonización generalizada: cada eje elevado tiene su línea, su objetivo y su sector. Lo perdido en la línea
 * (p · fracción) se inyecta hacia la vía objetivo con el signo de la proyección. Si los sectores se solapan, los
 * desplazamientos se mezclan por su máscara (media ponderada), no se suman. Tope de giro 45° (60° Extremo),
 * croma ≤ 2,5×, nunca fuera del gamut y guardia de identidad en las 6 esquinas.
 */
function daltonize(rgb: Vec3, axes: AxisMark[], floor: number, extreme: boolean, region?: Sector[]): Vec3 {
  if (!(floor > 0)) return rgb;
  const y = luminance(rgb);
  const plane = killPlane(rgb, y);
  const radius = norm(plane);
  if (radius < 1e-4) return rgb;
  const list = corrections(axes, floor, region);
  if (!list.length) return rgb;
  const theta = thetaOf(plane);
  const soft = extreme ? REGION.edgeSoftDegExtreme : REGION.edgeSoftDeg;
  let sumW = 0;
  let maxW = 0;
  const d: Vec3 = [0, 0, 0];
  for (const c of list) {
    const { w, gain: sideGain } = regionInfo(theta, radius, [c.sector], soft);
    if (w <= 0) continue;
    const p = dot(plane, dirFromTheta(c.line));
    const lost = p * lostFraction(c.T, floor);
    const gain = (extreme ? DALTON_GAIN_EXTREME : DALTON_GAIN) * sideGain;
    const bound = (extreme ? S_BOUND_EXTREME : S_BOUND) * radius * sideGain;
    const boost = (extreme ? RADIAL_BOOST_EXTREME : RADIAL_BOOST) * sideGain;
    const inj = Math.max(-bound * (1 + boost), Math.min(bound * (1 + boost), lost * gain * (1 + boost)));
    const t = dirFromTheta(c.target);
    // Además del giro, sube el croma (≤ 2,5×) en proporción a lo perdido: con T/floor bajo el giro solo no basta.
    const radial = boost * (Math.abs(p) / radius) * lostFraction(c.T, floor);
    d[0] += w * (t[0] * inj + plane[0] * radial);
    d[1] += w * (t[1] * inj + plane[1] * radial);
    d[2] += w * (t[2] * inj + plane[2] * radial);
    sumW += w;
    maxW = Math.max(maxW, w);
  }
  if (maxW <= 0) return rgb;
  d[0] /= sumW;
  d[1] /= sumW;
  d[2] /= sumW;
  if (norm(d) < 1e-9) return rgb;
  const cap = cornerCap(rgb, extreme ? ROT_CAP_EXTREME : ROT_CAP);
  const tS = reachT(y, plane, d, cap, CHROMA_CAP);
  const full: Vec3 = [y + plane[0] + d[0] * tS, y + plane[1] + d[1] * tS, y + plane[2] + d[2] * tS];
  const att = maxW * gamutAtten(rgb, full);
  const out = mixRgb(rgb, full, att);
  return limitLabHue(rgb, out, cap);
}

function killPlane(rgb: Vec3, y: number): Vec3 {
  return [rgb[0] - y, rgb[1] - y, rgb[2] - y];
}

/** La misma daltonización que la asistencia, con más ganancia y giro de hasta 60°. */
export function extremeColor(rgb: Vec3, axes: AxisMark[], floor: number, _luma: LumaGain[] = [], region?: Sector[]): Vec3 {
  return daltonize(rgb, axes, floor, true, region);
}

/** Lo perdido en L−M pasa a S (daltonización), giro de tono ≤ 45°, misma Y. */
export function assistColor(rgb: Vec3, axes: AxisMark[], floor: number, _luma: LumaGain[] = [], region?: Sector[]): Vec3 {
  return daltonize(rgb, axes, floor, false, region);
}

export type FilterSource = "profile" | "edges";
export type PaintedKind = "simulate" | "assist" | "extreme";

type Notch = {
  cone: EdgeFile["cone"];
  loOut: number;
  loIn: number;
  hiIn: number;
  hiOut: number;
  tInner: number;
  tRim: number;
  /** Lado sin borde medido (no encontrado, hasta el final o sin explorar): no es un destino distinguible. */
  loOpen: boolean;
  hiOpen: boolean;
};

/** Un lado está abierto si no tiene un borde medido de verdad. */
export function sideOpen(side: EdgeFile["minus"]): boolean {
  if (side.result) return side.result !== "found";
  return !side.found || side.toEnd === true;
}

/** A measured notch. A side that reaches the last hue of that color stays painted to the end. */
export function edgeNotches(files: EdgeFile[]): Notch[] {
  const notches: Notch[] = [];
  for (const file of files) {
    if (file.band === "none" || file.band === "unmeasurable") continue;
    const minusEnd = file.minus.toEnd === true;
    const plusEnd = file.plus.toEnd === true;
    if (!minusEnd && !plusEnd && (file.band !== "closed" || !file.minus.found || !file.plus.found)) continue;
    const loInDeg = minusEnd
      ? (file.minus.angleDeg ?? file.minus.insideDeg)
      : (file.confirmed.minus ?? file.minus.insideDeg ?? file.minus.angleDeg);
    const hiInDeg = plusEnd
      ? (file.plus.angleDeg ?? file.plus.insideDeg)
      : (file.confirmed.plus ?? file.plus.insideDeg ?? file.plus.angleDeg);
    const loOutDeg = minusEnd ? loInDeg : (file.minus.outsideDeg ?? loInDeg);
    const hiOutDeg = plusEnd ? hiInDeg : (file.plus.outsideDeg ?? hiInDeg);
    if (loInDeg == null || hiInDeg == null || loOutDeg == null || hiOutDeg == null) continue;
    const innerLo = Math.min(loInDeg, hiInDeg);
    const innerHi = Math.max(loInDeg, hiInDeg);
    const outerLo = Math.min(loOutDeg, hiOutDeg, innerLo);
    const outerHi = Math.max(loOutDeg, hiOutDeg, innerHi);
    if (!(outerHi > outerLo) && !minusEnd && !plusEnd) continue;
    if (outerHi - outerLo > 170) continue;
    // Red de seguridad: una profundidad medida en el borde no rebaja el umbral de origen.
    const tInner = Math.max(file.depth && file.depth.scale > 0 ? file.depth.scale : 0, file.sourceThreshold, file.edgeScale);
    const lo = rad(outerLo);
    const hi = rad(outerHi);
    notches.push({
      cone: file.cone,
      loOut: lo,
      loIn: rad(Math.max(outerLo, Math.min(innerLo, outerHi))),
      hiIn: rad(Math.max(outerLo, Math.min(innerHi, outerHi))),
      hiOut: hi,
      tInner,
      tRim: file.edgeScale > 0 ? file.edgeScale : tInner,
      loOpen: sideOpen(file.minus),
      hiOpen: sideOpen(file.plus),
    });
  }
  return notches;
}

export function edgesReady(files: EdgeFile[]): boolean {
  return edgeNotches(files).length > 0;
}

function notchSample(rawTheta: number, notch: Notch): { w: number; T: number } {
  // La búsqueda puede pasar de ±180° (verde hacia −240°): el ángulo se lleva junto al centro del notch.
  const center = (notch.loOut + notch.hiOut) / 2;
  const theta = center + Math.atan2(Math.sin(rawTheta - center), Math.cos(rawTheta - center));
  if (theta < notch.loOut || theta > notch.hiOut) return { w: 0, T: notch.tRim };
  if (theta < notch.loIn) {
    const span = notch.loIn - notch.loOut;
    const f = span < 1e-6 ? 1 : (theta - notch.loOut) / span;
    return { w: f, T: notch.tRim + (notch.tInner - notch.tRim) * f };
  }
  if (theta > notch.hiIn) {
    const span = notch.hiOut - notch.hiIn;
    const f = span < 1e-6 ? 1 : (notch.hiOut - theta) / span;
    return { w: f, T: notch.tRim + (notch.tInner - notch.tRim) * f };
  }
  return { w: 1, T: notch.tInner };
}

/** Keep everything past the measured threshold. Only the slice below it is reduced. */
function knee(p: number, T: number, floor: number, w: number): { keep: number; lost: number } {
  const sign = p >= 0 ? 1 : -1;
  const mag = Math.abs(p);
  const slice = Math.min(mag, Math.max(T, floor));
  const excess = mag - slice;
  const seen = Math.min(1, floor / Math.max(T, 1e-6));
  const keptSlice = slice * (1 - w * (1 - seen));
  return { keep: sign * (keptSlice + excess), lost: sign * (slice - keptSlice) };
}

function edgePaint(rgb: Vec3, profile: UmbralProfile, files: EdgeFile[], kind: PaintedKind): Vec3 {
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const notches = edgeNotches(files);
  if (!notches.length) return rgb;
  const y = luminance(rgb);
  const plane = killPlane(rgb, y);
  const radius = norm(plane);
  if (radius < 1e-4) return rgb;
  const theta = thetaOf(plane);
  let best: { notch: Notch; w: number; T: number } | null = null;
  for (const notch of notches) {
    const sample = notchSample(theta, notch);
    if (!best || sample.w > best.w) best = { notch, ...sample };
  }
  if (!best || best.w <= 0) return rgb;
  const luma = lumaFromProfile(profile);
  const others = notches.filter((notch) => notch !== best.notch);
  const blocked = (angle: number) => others.some((notch) => notchSample(angle, notch).w >= 0.5);
  if (kind === "assist" || kind === "extreme") {
    // Nunca hacia un lado abierto: allí sigue la confusión. Sin ningún borde medido, la asistencia del perfil.
    if (best.notch.loOpen && best.notch.hiOpen) {
      return kind === "extreme" ? extremeColor(rgb, profile.axes, floor, luma) : assistColor(rgb, profile.axes, floor, luma);
    }
    let target = best.notch.loOpen
      ? best.notch.hiOut
      : best.notch.hiOpen
        ? best.notch.loOut
        : angDist(theta, best.notch.loOut) <= angDist(theta, best.notch.hiOut)
          ? best.notch.loOut
          : best.notch.hiOut;
    if (blocked(target)) {
      const free = [best.notch.loOpen ? null : best.notch.loOut, best.notch.hiOpen ? null : best.notch.hiOut].filter((angle): angle is number => angle != null && !blocked(angle));
      if (free.length) target = free.sort((a, b) => angDist(theta, a) - angDist(theta, b))[0];
    }
    const from = dirFromTheta(theta);
    const land = dirFromTheta(target);
    const turn = (kind === "extreme" ? 1 : ASSIST_TURN) * best.w;
    const dir = normalize([
      from[0] * (1 - turn) + land[0] * turn,
      from[1] * (1 - turn) + land[1] * turn,
      from[2] * (1 - turn) + land[2] * turn,
    ]);
    const mag = kind === "extreme" ? radius * (1 + (EXTREME_GAIN - 1) * best.w) : radius;
    const gain = lumaGainAt(theta, luma);
    const y2 = kind === "extreme" ? y : y / (1 + (gain - 1) * best.w * ASSIST_LUMA);
    return planeColor(y2, [dir[0] * mag, dir[1] * mag, dir[2] * mag]);
  }
  const mid = (best.notch.loIn + best.notch.hiIn) / 2;
  const { u, p, n } = splitPlane(plane, mid);
  const { keep, lost } = knee(p, best.T, floor, best.w);
  // Vía que recoge lo perdido, derivada del perfil: los ejes de cono medidos (no el propio, no bloqueados),
  // ordenados por cercanía a la carta opuesta del notch.
  const order = profile.axes
    .filter((axis) => !isReference(axis) && (axis.role === "l" || axis.role === "m" || axis.role === "s") && axis.role !== best.notch.cone && Number.isFinite(axis.angleDeg))
    .map((axis) => rad(axis.angleDeg))
    .sort((a, b) => angDist(mid + Math.PI, a) - angDist(mid + Math.PI, b));
  const catcher = order.find((angle) => !blocked(angle)) ?? null;
  // Solo la carta medida (el lado del notch) vierte, igual para l, m y s.
  const spill = Math.max(lost, 0);
  const alias = catcher == null ? null : dirFromTheta(catcher);
  const leak = alias == null ? 0 : spill * ALIAS_LEAK;
  const plane2: Vec3 = [
    n[0] + u[0] * keep + (alias ? alias[0] * leak : 0),
    n[1] + u[1] * keep + (alias ? alias[1] * leak : 0),
    n[2] + u[2] * keep + (alias ? alias[2] * leak : 0),
  ];
  const y2 = y / (1 + (lumaGainAt(theta, luma) - 1) * best.w);
  return planeColor(y2, plane2);
}

/** Profile filters stay on their own path. Edges paint only a closed measured notch. */
export function colorFor(
  kind: PaintedKind,
  rgb: Vec3,
  profile: UmbralProfile,
  source: FilterSource,
  files: EdgeFile[] = [],
): Vec3 {
  if (source === "edges" && kind === "simulate") return edgePaint(rgb, profile, files, kind);
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const luma = lumaFromProfile(profile);
  if (kind === "simulate") return paintYours(rgb, profile.axes, floor, luma);
  // Perfil y Bordes usan la misma región medida (reglas por lado): siempre hay filtro.
  const region = measuredRegion(profile.axes, floor, files);
  if (kind === "extreme") return extremeColor(rgb, profile.axes, floor, luma, region);
  return assistColor(rgb, profile.axes, floor, luma, region);
}

const axisName = (axes: AxisMark[], id: string | null, role: string | null) => {
  const a = axes.find((x) => (x.id ?? x.role) === id) ?? axes.find((x) => x.role === role);
  return (a as { label?: string } | undefined)?.label ?? a?.role ?? id ?? "?";
};

/**
 * Textos de los filtros generados desde (vía elevada, vía objetivo) — sustituyen a los fijos «rojo/verde».
 * Sin vía sana medida, no hay corrección: solo mapa.
 */
export function filterTexts(axes: AxisMark[], floor: number, region?: Sector[]): { simulate: string; assist: string; extreme: string; pairs: Array<{ elevated: string; target: string }> } {
  const sectors = region ?? defaultRegion(axes, floor);
  const cs = corrections(axes, floor, sectors);
  const pairs = cs.map((c) => ({ elevated: axisName(axes, c.axisId, c.role), target: c.targetId === "perpendicular" ? "la perpendicular" : axisName(axes, c.targetId, c.targetRole) }));
  const weak = sectors.map((s) => {
    const axis = axes.find((x) => (x.id ?? x.role) === s.axis);
    const catcher = axis ? catcherFor(axes, rad(axis.angleDeg), axis.role ?? null) : null;
    const cAxis = catcher == null ? null : axes.find((x) => !isReference(x) && Math.abs(rad(x.angleDeg) - catcher) < 1e-9);
    return { name: axisName(axes, s.axis, axis?.role ?? null), catcher: cAxis ? axisName(axes, cAxis.id ?? null, cAxis.role ?? null) : null };
  });
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
  const simulate = weak.length
    ? `Encoge solo la dirección que no separas (${list(weak.map((w) => w.name))}) y vierte lo perdido hacia ${list(weak.map((w) => w.catcher ?? "el eje opuesto"))}, que sí lo recoge. Aplica el brillo medido. Fuera de la banda no toca.`
    : "Sin eje elevado medido: no cambia ningún color.";
  const assist = pairs.length
    ? `Mueve un poco ${pairs.map((p) => `la banda ${p.elevated} hacia ${p.target === "la perpendicular" ? p.target : `el ${p.target}`}`).join("; ")}, que sí separas, sin cambiar un pálido por uno vivo.`
    : sectors.length
      ? "Sin vía sana medida a la que llevar la banda: no corrige, solo el mapa."
      : "Sin eje elevado medido: no cambia ningún color.";
  const extreme = pairs.length ? "La misma dirección que la asistencia, ampliada hasta el borde del gamut, para separar los píxeles de la banda." : assist;
  return { simulate, assist, extreme, pairs };
}

export function coneOrder(pathways: Pathway[]): Pathway[] {
  const rank = ["s", "m", "l"];
  return [...pathways].sort((a, b) => rank.indexOf(a.id) - rank.indexOf(b.id));
}
