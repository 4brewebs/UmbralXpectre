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
import { labOfLinear } from "./deltaE";
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
/** Tope de giro del mapa intermedio en la línea de confusión (se estrecha con la máscara). */
const MAP_CAP = (30 * Math.PI) / 180;
const ROT_CAP_EXTREME = (60 * Math.PI) / 180;
/** Máscara de la daltonización: distancia (plano) a la línea de confusión a la que el cambio ya es exactamente 0. */
const MASK_CORE = (8 * Math.PI) / 180;
export const MASK_EDGE = (35 * Math.PI) / 180;
/** Inyección en S acotada: como mucho esta fracción del croma del píxel (Extremo, la segunda). */
const S_BOUND = 0.6;
const S_BOUND_EXTREME = 1;
/** Tono CIELAB de #FF0000 y entorno en el que el rojo puro conserva su tono (puede perder saturación). */
const RED_LAB_HUE = Math.atan2(labOfLinear([1, 0, 0])[2], labOfLinear([1, 0, 0])[1]);
const RED_GUARD = (40 * Math.PI) / 180;
const DALTON_GAIN = 1;
const DALTON_GAIN_EXTREME = 2;
const ASSIST_TURN = 0.7;
const EXTREME_GAIN = 5.5;
const ALIAS_LEAK = 1;
const ASSIST_LUMA = 0.35;
const RED_FAMILY = new Set(["rojizo", "anaranjado", "amarillento", "magenta"]);

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
  /** Ángulo (plano) del extremo S al que va el lado rojizo; el verdoso va al opuesto. */
  sDir: number | null;
};

const modelCache = new WeakMap<AxisMark[], FilterModel>();

function isReference(axis: AxisMark): boolean {
  return axis.role === "red-end" || axis.role === "blue-end" || axis.parentId === "red-end" || axis.parentId === "blue-end";
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function hueAt(angle: number): string {
  return hueName(addScaled([ANCHOR, ANCHOR, ANCHOR], dirFromTheta(angle), 0.25));
}

/** Face the red card of a confusion line. The other card is the opposite ray, not a second hole. */
function redFacing(angle: number): number {
  if (!RED_FAMILY.has(hueAt(angle)) && RED_FAMILY.has(hueAt(angle + Math.PI))) return angle + Math.PI;
  return angle;
}

function lobeWeight(theta: number, band: Band): number {
  const d = band.both ? lineGap(theta, band.mid) : angDist(theta, band.mid);
  if (d >= BAND_HALF) return 0;
  const raised = Math.cos((Math.PI * 0.5 * d) / BAND_HALF);
  return raised * raised;
}

/**
 * Eje S de referencia para la daltonización. Vale el eje S o el azul extremo (referencia de pantalla) si los separa
 * bien; LAND_MAX adaptativo: el candidato más cercano a la perpendicular de la línea de confusión, si queda dentro
 * del tope de giro (45°). Si no, la propia perpendicular. Signo: hacia el lado azul (S+).
 */
function sTarget(axes: AxisMark[], mid: number, gate: number): number {
  const perp0 = mid + Math.PI / 2;
  const blueSide = (a: number) => {
    const v = dirFromTheta(a);
    return v[2] - (v[0] + v[1]) / 2;
  };
  const perp = blueSide(perp0) >= 0 ? perp0 : perp0 + Math.PI;
  let best: number | null = null;
  let bestD = ROT_CAP;
  for (const axis of axes) {
    if (axis.role !== "s" && axis.role !== "blue-end") continue;
    if (axis.threshold == null || !(axis.threshold > 0) || axis.threshold > gate || !Number.isFinite(axis.angleDeg)) continue;
    const d = angDist(perp, rad(axis.angleDeg));
    if (d < bestD) {
      bestD = d;
      best = rad(axis.angleDeg);
    }
  }
  return best ?? perp;
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
  const catcher = weak === "l" ? roleAngle(axes, "m") : weak === "m" ? roleAngle(axes, "l") : weak === "s" ? roleAngle(axes, "m") : null;
  const blueAxis = axes.find((axis) => axis.role === "s" && !isReference(axis));
  const blue =
    blueAxis && blueAxis.thresholdKind !== "upper-bound" && (blueAxis.threshold ?? 0) > gate ? null : roleAngle(axes, "s");
  const bands: Band[] = bad.map((axis) => {
    const both = axis.role === "l" || axis.role === "m" || axis.role === "s";
    const raw = rad(axis.angleDeg);
    const mid = both ? redFacing(raw) : raw;
    return {
      mid,
      T: axis.threshold ?? gate,
      both,
    };
  });
  const confusion = bands.length
    ? bands.reduce((x, y) => (x.both !== y.both ? (x.both ? x : y) : x.T >= y.T ? x : y))
    : null;
  const model = { floor, bands, weak, catcher, blue, confusion, sDir: confusion ? sTarget(axes, confusion.mid, gate) : null };
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
  const spill = model.weak === "m" ? Math.max(-lost, 0) : model.weak === "s" ? Math.abs(lost) : Math.max(lost, 0);
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
 * Diagnostic map. The red magnitude this profile can still represent stays red.
 * The red gain that would be required and would not be seen is added on the intact blue cone.
 */
export function correctColor(rgb: Vec3, axes: AxisMark[], floor: number): Vec3 {
  if (!(floor > 0)) return rgb;
  const y = luminance(rgb);
  const plane = killPlane(rgb, y);
  const radius = norm(plane);
  if (radius < 1e-4) return rgb;
  const model = filterModel(axes, floor);
  if (model.blue == null || !model.confusion) return rgb;
  // Misma máscara suave que la asistencia, sobre la línea de confusión (antes: banda dura de ±10° por eje,
  // con saltos entre bandas y recorte del plano hacia el blanco).
  const band = model.confusion;
  // Mapa intermedio: coseno elevado desde la propia línea (sin núcleo plano) y tope de giro que también se
  // estrecha con la máscara; así no hay bloques (cian blanquecino ~170°, violeta ~320°).
  const mask = bandMask(thetaOf(plane), band.mid, 0, MASK_EDGE);
  if (mask <= 0) return rgb;
  const { u, p } = splitPlane(plane, band.mid);
  const seen = Math.min(1, floor / band.T);
  const drop = p * (1 - seen);
  const unseen = Math.min(Math.abs(drop) * (band.T / floor), S_BOUND * radius);
  const blue = dirFromTheta(model.blue);
  // Con signo, como la asistencia: la carta rojiza va hacia S+ y la verdosa hacia S−.
  const sgn = drop >= 0 ? 1 : -1;
  const disp: Vec3 = [-u[0] * drop + blue[0] * unseen * sgn, -u[1] * drop + blue[1] * unseen * sgn, -u[2] * drop + blue[2] * unseen * sgn];
  // Conserva el croma del píxel: es un giro hacia azul, no un paso hacia el gris (antes: bloque blanquecino).
  const raw: Vec3 = [plane[0] + disp[0], plane[1] + disp[1], plane[2] + disp[2]];
  const k = radius / (norm(raw) || 1);
  const full = capPlaneTurn(y, plane, [raw[0] * k, raw[1] * k, raw[2] * k], MAP_CAP * mask);
  return limitLabHue(rgb, mixRgb(rgb, full, mask), MAP_CAP * redGuard(rgb));
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

/**
 * Lleva el plano hacia el destino a la misma Y: el desplazamiento se acorta lo justo para quedar dentro del cubo
 * y con giro (plano) ≤ cap. El acortamiento es proporcional al hueco al gamut: continuo, sin blanquear.
 */
function capPlaneTurn(y: number, plane: Vec3, target: Vec3, cap: number): Vec3 {
  // Desplazamiento acortado (no croma encogido): dentro del cubo y con giro ≤ cap. Sin blanquear.
  const disp: Vec3 = [target[0] - plane[0], target[1] - plane[1], target[2] - plane[2]];
  const t = reachT(y, plane, disp, cap);
  return [y + plane[0] + disp[0] * t, y + plane[1] + disp[1] * t, y + plane[2] + disp[2] * t];
}

/** Mayor t ∈ [0, 1] con y + plane + disp·t dentro del cubo y giro (plano) ≤ cap. Proporcional al hueco al gamut. */
function reachT(y: number, plane: Vec3, disp: Vec3, cap: number): number {
  const radius = norm(plane);
  const ok = (t: number): boolean => {
    const q: Vec3 = [plane[0] + disp[0] * t, plane[1] + disp[1] * t, plane[2] + disp[2] * t];
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

/** Cerca del tono de #FF0000 el tope de giro baja a 0: el rojo puro conserva su tono. */
function redGuard(rgb: Vec3): number {
  const { h, c } = labHue(rgb);
  if (c < 1) return 1;
  const d = angDist(h, RED_LAB_HUE);
  return d >= RED_GUARD ? 1 : (d / RED_GUARD) ** 2;
}

function daltonize(rgb: Vec3, axes: AxisMark[], floor: number, extreme: boolean): Vec3 {
  if (!(floor > 0)) return rgb;
  const y = luminance(rgb);
  const plane = killPlane(rgb, y);
  const radius = norm(plane);
  if (radius < 1e-4) return rgb;
  const model = filterModel(axes, floor);
  const band = model.confusion;
  if (!band || model.sDir == null) return rgb;
  const mask = bandMask(thetaOf(plane), band.mid);
  if (mask <= 0) return rgb;
  const { p } = splitPlane(plane, band.mid);
  const seen = Math.min(1, floor / band.T);
  const lost = p * (1 - seen);
  if (Math.abs(lost) < 1e-6) return rgb;
  const s = dirFromTheta(model.sDir);
  const gain = extreme ? DALTON_GAIN_EXTREME : DALTON_GAIN;
  const bound = (extreme ? S_BOUND_EXTREME : S_BOUND) * radius;
  const inj = Math.max(-bound, Math.min(bound, lost * gain));
  const d: Vec3 = [s[0] * inj, s[1] * inj, s[2] * inj];
  const cap = extreme ? ROT_CAP_EXTREME : ROT_CAP;
  // Continuo en la entrada: si se sale del cubo se encoge el croma hacia la misma Y (sin recorte de canal);
  // el giro lo acotan el tope de plano y el de CIELAB después.
  const full = capPlaneTurn(y, plane, [plane[0] + d[0], plane[1] + d[1], plane[2] + d[2]], cap);
  // La máscara mezcla el resultado completo con el original: el cambio va a 0 sin saltos.
  return limitLabHue(rgb, mixRgb(rgb, full, mask), cap * redGuard(rgb));
}

function killPlane(rgb: Vec3, y: number): Vec3 {
  return [rgb[0] - y, rgb[1] - y, rgb[2] - y];
}

/** La misma daltonización que la asistencia, con más ganancia y giro de hasta 60°. */
export function extremeColor(rgb: Vec3, axes: AxisMark[], floor: number, _luma: LumaGain[] = []): Vec3 {
  return daltonize(rgb, axes, floor, true);
}

/** Lo perdido en L−M pasa a S (daltonización), giro de tono ≤ 45°, misma Y. */
export function assistColor(rgb: Vec3, axes: AxisMark[], floor: number, _luma: LumaGain[] = []): Vec3 {
  return daltonize(rgb, axes, floor, false);
}

export type FilterSource = "profile" | "edges";
export type PaintedKind = "simulate" | "correct" | "assist" | "extreme";

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
  if (kind === "correct") {
    const blue = roleAngle(profile.axes, "s");
    if (blue == null || best.notch.cone === "s" || blocked(blue)) return rgb;
    const unseen = Math.abs(lost) * (best.T / floor);
    const b = dirFromTheta(blue);
    return planeColor(y, [n[0] + u[0] * keep + b[0] * unseen, n[1] + u[1] * keep + b[1] * unseen, n[2] + u[2] * keep + b[2] * unseen]);
  }
  const order = best.notch.cone === "m" ? (["l", "s"] as const) : best.notch.cone === "s" ? (["m", "l"] as const) : (["m", "s"] as const);
  let catcher: number | null = null;
  for (const role of order) {
    const angle = roleAngle(profile.axes, role);
    if (angle == null || blocked(angle)) continue;
    catcher = angle;
    break;
  }
  const spill =
    best.notch.cone === "m" ? Math.max(-lost, 0) : best.notch.cone === "s" ? Math.abs(lost) : Math.max(lost, 0);
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
  if (source === "edges") return edgePaint(rgb, profile, files, kind);
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const luma = lumaFromProfile(profile);
  if (kind === "simulate") return paintYours(rgb, profile.axes, floor, luma);
  if (kind === "correct") return correctColor(rgb, profile.axes, floor);
  if (kind === "extreme") return extremeColor(rgb, profile.axes, floor, luma);
  return assistColor(rgb, profile.axes, floor, luma);
}

export function coneBlurb(pathway: Pathway): string {
  if (pathway.kind === "upper-bound" || !pathway.elevated) {
    return "En esta pantalla los separas al nivel del control, o mejor. Esta vía no queda afectada.";
  }
  const times = pathway.timesControl ?? pathway.threshold;
  if (times >= 5) {
    const where =
      pathway.id === "l"
        ? "El rojo no desaparece: se monta sobre el verde en un ángulo estrecho."
        : pathway.id === "m"
          ? "El verde no desaparece: se monta sobre el rojo en un ángulo estrecho."
          : "El azul no desaparece: el fallo está en un ángulo estrecho.";
    return `Hace falta unas ${times.toFixed(1)} veces más diferencia que en el control, en esa dirección. ${where}`;
  }
  return `Hace falta unas ${times.toFixed(1)} veces más diferencia que en el control. Queda afectada, sin cerrarse del todo.`;
}

export function coneLead(pathways: Pathway[]): string {
  const high = pathways.filter((p) => p.elevated);
  const name = (id: string) => CONE_MARKS.find((m) => m.id === id)?.name.toLowerCase() ?? id;
  if (high.length === 0) return "Las tres vías aguantan el paso pequeño. El arcoíris de abajo no se apaga.";
  if (high.length === 1) return `Pierde contraste la vía de los ${name(high[0].id)}. Las otras dos siguen.`;
  const sorted = [...high].sort((a, b) => b.threshold - a.threshold);
  const base = `Pierden contraste los ${sorted.map((p) => name(p.id)).join(" y los ")}.`;
  if (sorted[0].threshold >= sorted[1].threshold * 2) {
    return `${base} La de los ${name(sorted[0].id)} queda mucho más corta.`;
  }
  return `${base} No es una sola vía.`;
}

export function coneOrder(pathways: Pathway[]): Pathway[] {
  const rank = ["s", "m", "l"];
  return [...pathways].sort((a, b) => rank.indexOf(a.id) - rank.indexOf(b.id));
}
