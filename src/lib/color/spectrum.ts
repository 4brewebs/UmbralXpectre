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
  lineGap,
  luminance,
  norm,
  thetaOf,
  type Vec3,
} from "./space";
import { labOfLinear } from "./deltaE";
import type { UmbralProfile } from "./profile";
import { fileDepth, type EdgeFile } from "./edges";
import { BAND_GAIN, bandFromProfile, bandShift, bandStep, moveAlong, type AssistBand } from "./assistband";

type Pathway = UmbralProfile["fit"]["pathways"][number];
type AxisMark = {
  id?: string;
  angleDeg: number;
  threshold: number | null;
  role?: string;
  parentId?: string | null;
  thresholdKind?: string | null;
  /** «validation-3afc» si la validación 3AFC lo midió; en un perfil validado, el resto entra como estimado. */
  thresholdSource?: string | null;
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
/** Máscara de la daltonización: distancia (plano) a la línea de confusión a la que el cambio ya es exactamente 0. */
const MASK_CORE = (8 * Math.PI) / 180;
export const MASK_EDGE = (35 * Math.PI) / 180;
/** Inyección en S acotada: como mucho esta fracción del croma del píxel (Extremo, la segunda). */
/** Tope de croma de salida (radio en el plano) frente al de entrada. */

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
const simCache = new WeakMap<AxisMark[], { floor: number; points: Array<{ deg: number; ratio: number }> }>();
function simPoints(axes: AxisMark[], floor: number): Array<{ deg: number; ratio: number }> {
  const hit = simCache.get(axes);
  if (hit && hit.floor === floor) return hit.points;
  const points = confusionPoints(axes, floor, []).points;
  simCache.set(axes, { floor, points });
  return points;
}

export function paintYours(rgb: Vec3, axes: AxisMark[], floor: number, luma: LumaGain[] = []): Vec3 {
  if (!(floor > 0)) return rgb;
  const y = luminance(rgb);
  const plane = killPlane(rgb, y);
  if (norm(plane) < 1e-4) return rgb;
  const model = filterModel(axes, floor);
  const hit = activeBand(thetaOf(plane), model);
  if (!hit) return rgb;
  const { u, p, n } = splitPlane(plane, hit.band.mid);
  // Misma T(θ) que el mapa y el filtro, en el tono del color (punto 2, 26/10).
  const seen = Math.min(1, floor / confusionT(simPoints(axes, floor), floor, (thetaOf(plane) * 180) / Math.PI, norm(plane)));
  const pSim = p * (1 - hit.w * (1 - seen));
  // Punto 4 (26/10): solo encoge la componente en la línea de confusión (factor suelo/T(θ)); sin derrame hacia la
  // vía que la recogía (llevaba rojos y magentas al verde).
  const plane2: Vec3 = [n[0] + u[0] * pSim, n[1] + u[1] * pSim, n[2] + u[2] * pSim];
  const y2 = y / (1 + (lumaGainAt(thetaOf(plane), luma) - 1) * hit.w);
  return planeColor(y2, plane2);
}

/** Tono CIELAB (rad) y croma de un color lineal. */
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
 * Máscara suave por distancia (plano) a la línea de confusión (Colorado, 8.ª ronda): 1 hasta 8°, borde coseno
 * elevado (C¹, sin saltos) hasta 35° y 0 exacto a partir de ahí.
 */
export function bandMask(theta: number, mid: number, core = MASK_CORE, edge = MASK_EDGE): number {
  const d = lineGap(theta, mid);
  if (d <= core) return 1;
  if (d >= edge) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * (d - core)) / (edge - core)));
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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
  /** Escala a la que se midieron los bordes (fallo en el borde). */
  edgeScale?: number;
  /** T(θ) única (ejes medidos, estimados y bordes): de ella sale el peso por tono y lo perdido. */
  profileT?: { floor: number; points: Array<{ deg: number; ratio: number }> };
  /** Alcance angular del sector: hasta el primer eje sano a cada lado (los bordes no lo recortan, solo afinan T). */
  reachLo?: number;
  reachHi?: number;
  provisional: boolean;
};
/** Transición coseno (C1) de 12° (Extremo 14°) en cada extremo, ensanchada al calibrar la ganancia con T/floor ≥ 1,6; los lados provisionales corrigen al 70 %. */
/** Extremo usa una transición más ancha (Colorado, 26/10): su desplazamiento es mayor y el escalón crece con él. */
export const REGION = { edgeSoftDeg: 16, edgeSoftDegExtreme: 18, scaleSoft: 0.5, provisionalGain: 0.7 };

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Eje medido sano: cualquier eje (control, l, m, s, red-end, blue-end o vecino) con umbral ≤ gate o cota «o menos». */
function isHealthy(axis: AxisMark, gate: number, axes?: AxisMark[]): boolean {
  if (!Number.isFinite(axis.angleDeg) || axis.threshold == null || !(axis.threshold > 0)) return false;
  if (axis.thresholdKind === "upper-bound") return true;
  // En un perfil validado, los ejes no validados cuentan con su razón atenuada (estimados).
  return effThreshold(axis, gate / GATE, axes) <= gate;
}

/**
 * Pérdida única T(θ) (Colorado, 26/10): mapa, filtro y simulador usan la misma. En un perfil con validación 3AFC,
 * los ejes no validados entran como «estimado» con la razón atenuada en log (peso ESTIMATED_WEIGHT).
 */
/** weightFullRatio: T/suelo a partir del cual el peso por tono es 1 (rampa ancha: sin escalón en el anillo). */
export const LOSS_CURVE = { estimatedWeight: 0.5, maxGapDeg: 60, taperDeg: 30, weightFullRatio: 2.5, weightStartRatio: 1.3, smoothDeg: 0, smoothDegSat: 90, satRadius: [0.05, 0.3] as [number, number] };
function validated(axes: AxisMark[] | undefined): boolean {
  return !!axes?.some((a) => a.thresholdSource === "validation-3afc");
}
function isEstimated(axis: AxisMark, axes: AxisMark[] | undefined): boolean {
  return validated(axes) && axis.thresholdSource !== "validation-3afc";
}
function effThreshold(axis: AxisMark, floor: number, axes: AxisMark[] | undefined): number {
  const t = axis.threshold as number;
  if (!isEstimated(axis, axes) || !(floor > 0) || !(t > floor)) return t;
  return floor * Math.exp(LOSS_CURVE.estimatedWeight * Math.log(t / floor));
}

/** Primer eje sano medido en esa dirección (cualquier eje medido no elevado): distancia angular (°) > 0. */
function healthyReach(axes: AxisMark[], gate: number, from: number, dir: 1 | -1): { dist: number; deg: number } | null {
  let best: { dist: number; deg: number } | null = null;
  for (const axis of axes) {
    if (!isHealthy(axis, gate, axes)) continue;
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
    // Filtros solo desde lo validado: un eje estimado da forma a T(θ) pero no abre sector propio.
    if (isEstimated(axis, axes)) continue;
    const file = edges.find((e) => e.cone === axis.role);
    const usable = file && file.band !== "unmeasurable" && file.band !== "none" ? file : null;
    const center = axis.angleDeg;
    const hMinus = healthyReach(axes, gate, center, -1);
    const hPlus = healthyReach(axes, gate, center, 1);
    const minus = buildSide(center, -1, hMinus, usable?.minus ?? null);
    const plus = buildSide(center, 1, hPlus, usable?.plus ?? null);
    out.push({
      axis: axis.id ?? axis.role,
      centerDeg: center,
      loDeg: minus.deg,
      hiDeg: plus.deg,
      minus,
      plus,
      // Profundidad: max(estimación, edgeScale si el pico falló), ≥ floor, techo = umbral del eje (Colorado, 26/10).
      scale: (usable && fileDepth(usable, floor, axis.threshold)) ?? axis.threshold,
      ...(usable ? { edgeScale: usable.edgeScale } : {}),
      reachLo: center - (hMinus?.dist ?? NO_HEALTHY_DIST),
      reachHi: center + (hPlus?.dist ?? NO_HEALTHY_DIST),
      provisional: minus.provisional || plus.provisional,
    });
  }
  // Una sola T(θ) para todos los sectores: ejes (medidos y estimados) y bordes de la región.
  const points = confusionPoints(axes, floor, out).points;
  for (const sct of out) sct.profileT = { floor, points };
  return out;
}

/** Peso C1 de la región y ganancia (1 en lados medidos, 0,7 en provisionales). */
export function regionInfo(theta: number, radius: number, sectors: Sector[], softDeg: number = REGION.edgeSoftDeg): { w: number; gain: number } {
  let best = { w: 0, gain: 1 };
  const deg = (theta * 180) / Math.PI;
  for (const sct of sectors) {
    const rel = wrapDeg(deg - sct.centerDeg);
    // Alcance hasta el primer eje sano (no hasta el borde medido: los bordes solo afinan T(θ)).
    const sideDeg = rel >= 0 ? (sct.reachHi ?? sct.hiDeg) - sct.centerDeg : sct.centerDeg - (sct.reachLo ?? sct.loDeg);
    const outside = Math.max(0, Math.abs(rel) - sideDeg);
    const ws = 1 - smoothstep(0, softDeg, outside);
    // Peso solo por tono (punto 1, 26/10): sin techo radial; un color saturado de la zona se corrige igual que uno pálido.
    // Dentro del alcance, el peso sigue a T(θ): 0 donde T ≈ suelo, 1 desde T ≥ 2,5·suelo.
    const wt = sct.profileT ? smoothstep(LOSS_CURVE.weightStartRatio, LOSS_CURVE.weightFullRatio, confusionT(sct.profileT.points, sct.profileT.floor, deg, radius) / sct.profileT.floor) : 1;
    void radius;
    const w = ws * wt;
    if (w > best.w) best = { w, gain: (rel >= 0 ? sct.plus : sct.minus).provisional ? REGION.provisionalGain : 1 };
  }
  return best;
}
export function regionMask(theta: number, radius: number, sectors: Sector[], extreme = false): number {
  return regionInfo(theta, radius, sectors, extreme ? REGION.edgeSoftDegExtreme : REGION.edgeSoftDeg).w;
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
  const healthy = axes.filter((axis) => isHealthy(axis, gate, axes));
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
/** Puntos (ángulo, T/floor) del mapa de confusión: ejes medidos y bordes de la región, como «Zonas de confusión». */
export function confusionPoints(axes: AxisMark[], floor: number, region: Sector[]): { points: Array<{ deg: number; ratio: number }>; estimated: Array<[number, number]>; measured: number[] } {
  const w360 = (d: number) => ((d % 360) + 360) % 360;
  const points: Array<{ deg: number; ratio: number }> = [];
  const estimated: Array<[number, number]> = [];
  const measured: number[] = [];
  for (const axis of axes) {
    if (axis.threshold == null || !Number.isFinite(axis.angleDeg)) continue;
    const deg = w360(axis.angleDeg);
    points.push({ deg, ratio: Math.max(1, effThreshold(axis, floor, axes) / floor) });
    // Ejes no validados en un perfil validado: estimados (rayado en el mapa).
    if (isEstimated(axis, axes)) estimated.push([deg - 10, deg + 10]);
    else measured.push(deg);
  }
  for (const sector of region) {
    const axis = axes.find((a) => (a.id ?? a.role) === sector.axis);
    const peak = Math.max(1, (axis?.threshold ?? floor) / floor);
    for (const [side, dir] of [[sector.minus, -1], [sector.plus, 1]] as const) {
      if (side.source === "edge") {
        // En el borde, el fallo se midió hasta la escala de bordes.
        points.push({ deg: w360(side.deg), ratio: Math.max(1, (sector.edgeScale ?? floor) / floor) });
      } else if (side.source === "toEnd") {
        points.push({ deg: w360(side.deg - dir * 1), ratio: peak });
      } else {
        const lo = dir < 0 ? side.deg : sector.centerDeg;
        const hi = dir < 0 ? sector.centerDeg : side.deg;
        estimated.push([w360(lo), w360(lo) + (hi - lo)]);
      }
    }
  }
  points.sort((a, b) => a.deg - b.deg);
  return { points, estimated, measured };
}

/** T absoluto en un ángulo: log(T/floor) interpolado en ángulo entre los puntos vecinos (circular). */
/**
 * T(θ) suavizada (Lucas, 26/10: «arcoíris»): log(T/suelo) de los puntos se suaviza circularmente con un núcleo
 * gaussiano de σ = LOSS_CURVE.smoothDeg, muestreado a 1°; sin escalones entre ejes. Una sola curva para mapa,
 * filtro y simulador.
 */
const smoothCache = new WeakMap<object, Map<number, Float64Array>>();
function smoothLogs(points: Array<{ deg: number; ratio: number }>, sigma: number): Float64Array {
  let bySigma = smoothCache.get(points);
  if (!bySigma) {
    bySigma = new Map();
    smoothCache.set(points, bySigma);
  }
  const hit = bySigma.get(sigma);
  if (hit) return hit;
  const raw = new Float64Array(360);
  for (let i = 0; i < 360; i++) raw[i] = Math.log(rawConfusionT(points, 1, i));
  const half = Math.ceil(3 * sigma);
  const kern: number[] = [];
  let ks = 0;
  for (let j = -half; j <= half; j++) {
    const k = Math.exp(-0.5 * (j / sigma) ** 2);
    kern.push(k);
    ks += k;
  }
  const logs = new Float64Array(360);
  for (let i = 0; i < 360; i++) {
    let a = 0;
    for (let j = -half; j <= half; j++) a += kern[j + half] * raw[(((i + j) % 360) + 360) % 360];
    logs[i] = Math.max(0, a / ks);
  }
  bySigma.set(sigma, logs);
  return logs;
}

/**
 * T(θ) suavizada (Lucas, 26/10: «arcoíris»): log(T/suelo) se suaviza circularmente con un núcleo gaussiano, sin
 * escalones entre ejes. σ crece con la croma del color (`radius`): smoothDeg cerca del gris (conserva el pico del
 * eje medido: láminas) y smoothDegSat en los saturados (barras, arcoíris). Sin `radius`: σ = smoothDeg (mapa).
 */
export function confusionT(points: Array<{ deg: number; ratio: number }>, floor: number, deg: number, radius = 0): number {
  if (points.length < 2) return rawConfusionT(points, floor, deg);
  const d = ((deg % 360) + 360) % 360;
  const i0 = Math.floor(d) % 360;
  const f = d - Math.floor(d);
  const at = (sigma: number) => {
    if (!(sigma > 0)) return Math.log(rawConfusionT(points, 1, d));
    const logs = smoothLogs(points, sigma);
    return logs[i0] * (1 - f) + logs[(i0 + 1) % 360] * f;
  };
  const sat = smoothstep(LOSS_CURVE.satRadius[0], LOSS_CURVE.satRadius[1], radius);
  const lo = at(LOSS_CURVE.smoothDeg);
  const log = sat > 0 ? lo * (1 - sat) + at(LOSS_CURVE.smoothDegSat) * sat : lo;
  return floor * Math.exp(log);
}

function rawConfusionT(points: Array<{ deg: number; ratio: number }>, floor: number, deg: number): number {
  const w360 = (d: number) => ((d % 360) + 360) % 360;
  if (!points.length) return floor;
  if (points.length === 1) return points[0].ratio * floor;
  const d = w360(deg);
  let i = points.findIndex((p) => p.deg > d);
  if (i < 0) i = 0;
  const hi = points[i];
  const lo = points[(i - 1 + points.length) % points.length];
  const span = w360(hi.deg - lo.deg) || 360;
  const dl = w360(d - lo.deg);
  if (span <= LOSS_CURVE.maxGapDeg) {
    const t = dl / span;
    return floor * Math.exp(Math.log(lo.ratio) * (1 - t) + Math.log(hi.ratio) * t);
  }
  // Hueco > 60°: no se inventa la zona central; log T de cada eje medido decae hacia el suelo
  // con semianchura taperDeg (gaussiana: a taperDeg queda la mitad del log), sin corte brusco.
  const dh = span - dl;
  const fade = (ratio: number, dist: number) => Math.exp(Math.log(ratio) * Math.exp(-Math.LN2 * (dist / LOSS_CURVE.taperDeg) ** 2));
  return floor * Math.max(1, fade(lo.ratio, dl), fade(hi.ratio, dh));
}

function pairMetricPoints(a: Vec3, b: Vec3, points: Array<{ deg: number; ratio: number }>, floor: number): number {
  const pa = killPlane(a, luminance(a));
  const pb = killPlane(b, luminance(b));
  const diff: Vec3 = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
  const len = norm(diff);
  if (len < 1e-12) return 0;
  const deg = (thetaOf(diff) * 180) / Math.PI;
  // La diferencia es una recta: se toma el umbral mayor de sus dos sentidos (conservador).
  const T = Math.max(confusionT(points, floor, deg), confusionT(points, floor, deg + 180));
  return len / (2 * T);
}

/** Métrica de discriminación: |diferencia en el plano isoluminante| / (2 · T(ángulo de la diferencia)). Sin proyectar sobre m. */
export function pairMetric(a: Vec3, b: Vec3, axes: AxisMark[], floor: number, region: Sector[] = []): number {
  return pairMetricPoints(a, b, confusionPoints(axes, floor, region).points, floor);
}

function killPlane(rgb: Vec3, y: number): Vec3 {
  return [rgb[0] - y, rgb[1] - y, rgb[2] - y];
}

/**
 * Extremo: el mismo desplazamiento de la franja con g = 12 y, encima, croma ampliada hasta el borde de gama en la
 * misma dirección (R/G, azul fijo, luminancia del usuario igual), ponderada por w. Tope de giro CIELAB 60°.
 */
export function extremeColor(rgb: Vec3, bands: AssistBand[]): Vec3 {
  const step = bandStep(rgb, bands);
  if (!step) return rgb;
  const base = Math.min(step.cap, BAND_GAIN.extreme * step.w * step.T);
  const full = (base + step.w * (step.cap - base)) * step.sat;
  const cap = (EXTREME_TURN_DEG * Math.PI) / 180;
  if (labHueShift(rgb, moveAlong(rgb, step, full)) <= cap) return moveAlong(rgb, step, full);
  let lo = 0;
  let hi = full;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (labHueShift(rgb, moveAlong(rgb, step, mid)) <= cap) lo = mid;
    else hi = mid;
  }
  return moveAlong(rgb, step, lo);
}

/** Asistencia: asistido por franja (Regla B), g = 6, sin brillo. Fuera de la franja, el color tal cual. */
export function assistColor(rgb: Vec3, bands: AssistBand[]): Vec3 {
  return bandShift(rgb, bands, BAND_GAIN.assist);
}

/** Tope de giro del Extremo (grados CIELAB), el mismo que QUANT_CAP_DEG.extreme en lut.ts. */
export const EXTREME_TURN_DEG = 60;

const bandCache = new WeakMap<object, { files: EdgeFile[]; bands: AssistBand[] }>();
/** Franjas del perfil con sus bordes, calculadas una vez por (perfil, lista de bordes). */
export function bandsFor(profile: UmbralProfile, files: EdgeFile[] = []): AssistBand[] {
  const hit = bandCache.get(profile);
  if (hit && hit.files === files) return hit.bands;
  const bands = bandFromProfile(profile, files);
  bandCache.set(profile, { files, bands });
  return bands;
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

function edgePaint(rgb: Vec3, profile: UmbralProfile, files: EdgeFile[]): Vec3 {
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
  const mid = (best.notch.loIn + best.notch.hiIn) / 2;
  const { u, p, n } = splitPlane(plane, mid);
  // Punto 4 (26/10): el mismo factor suelo/T a todo |p| (no solo al tramo bajo el umbral) y sin derrame.
  const seen = Math.min(1, floor / Math.max(best.T, 1e-6));
  const keep = p * (1 - best.w * (1 - seen));
  const plane2: Vec3 = [n[0] + u[0] * keep, n[1] + u[1] * keep, n[2] + u[2] * keep];
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
  if (source === "edges" && kind === "simulate") return edgePaint(rgb, profile, files);
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const luma = lumaFromProfile(profile);
  if (kind === "simulate") return paintYours(rgb, profile.axes, floor, luma);
  // Asistencia y Extremo: siempre la franja del perfil con sus bordes medidos (el selector solo cambia el simulador).
  const bands = bandsFor(profile, files);
  return kind === "extreme" ? extremeColor(rgb, bands) : assistColor(rgb, bands);
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
