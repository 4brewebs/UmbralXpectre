import { ANCHOR, addScaled, dirFromTheta, hueName, maxScale, toSrgb8, type Vec3 } from "./space";
import { createQuestPlus, detect3, grid, type JsQuest, type QuestPlus } from "./questplus";
import { deltaE00Linear } from "./deltaE";

/**
 * QUEST+ en el refinamiento tras el bracketing (PLAN-questplus §3.2, tras flag `?qp=1`).
 * Weibull de Watson (2017) en d = |ángulo − pico|: P(ver el disco distinto) = γ + (1−γ−λ)(1 − e^−(d/α)^β),
 * α = distancia del borde (°), β y λ marginalizados (decisión 2).
 * Modelo de 3 respuestas `detect3` (Colorado, punto 6): «Ninguno» = fallo de detección informativo,
 * disco equivocado = lapsus/azar. La escalera por defecto no cambia.
 * Parada (Colorado): IC 95 % < 1 ΔE00 medido en ΔE00 entre los extremos del IC (respaldo 8° sin escala),
 * o 45 ensayos por lado. El IC se guarda en ° y en ΔE00; `angleForDeltaE` da el ángulo de 1 ΔE00.
 * Fiabilidad: catch de diferencia obvia (tono +90° del pico), 1 cada 6 y al menos 2 por ronda; se agregan en la
 * sesión (`sessionReliability`): < 5 catch ⇒ «indeterminada», > 25 % «ninguno» ⇒ no fiable. `reliability` por ronda
 * se guarda igual (dato en bruto; su `unreliable` es solo orientativo).
 */
/** Parada (Colorado): IC < 1 ΔE00, máx. 45. `fixedSlope`: con la ventana 1,5× control el β fijo sesga −7,7 % (≥ 3 %), así que se marginaliza β (−2,7 %), regla de Colorado. */
export const QP_EDGES = { gamma: 0.25, betas: [1.75, 3.5, 7], nominalBeta: 3.5, fixedSlope: false, lapses: [0.02, 0.035, 0.05], stepDeg: 0.5, stopDeltaE: 1, fallbackDeg: 8, maxTrials: 45, catchEvery: 6, catchNoneMax: 0.25, catchLum: 1.25, sessionCatchMin: 5, catchPerRound: 2 };

type QpCtx = { Q: JsQuest; scale: number };

export type ConeId = "l" | "m" | "s";
export type EdgeName = "rojos" | "verdes" | "azules";

export const EDGE_NAME: Record<ConeId, EdgeName> = {
  l: "rojos",
  m: "verdes",
  s: "azules",
};

const WALK_STEP = 4;
/** Más allá del sector, cada paso es este factor de lo ya andado desde el pico (pasos geométricos). */
const GEO_STEP = 0.5;
/** Tope de la búsqueda a cada lado del pico (°): dos lados juntos quedan por debajo de 170°. */
const MAX_SPAN = 84;
/** Escala del disco respecto al umbral de la banda cuando el suelo es la propia banda. */
const EDGE_GAP = 2;
const DEPTH_TRIALS = 8;

export type AnswerKind = "seen" | "none" | "miss";
export type EdgePhase = "peak" | "minus" | "plus" | "depth" | "confirm" | "done";

export interface EdgeTrial {
  order: number;
  phase: "edge" | "depth" | "confirm";
  side: "peak" | "minus" | "plus" | "center";
  angleDeg: number;
  scale: number;
  oddIndex: number;
  oddSign: 1 | -1;
  picked: number[];
  none: boolean;
  kind: AnswerKind;
  repeat: boolean;
  /** Set when this question repeats a bound already answered: the last miss or the last hit. */
  check: "inside" | "outside" | null;
  /** Catch de diferencia obvia (solo con QUEST+). */
  catch?: true;
  positive: [number, number, number];
  negative: [number, number, number];
}

export interface EdgeFile {
  schema: "umbral.edges.v1";
  /** «band»: el control del perfil estaba acotado y el suelo es el umbral de la propia banda. */
  floorFrom?: "band";
  /** La escala pedida no cabe en el gamut: banda abierta por construcción. */
  scaleLimited?: boolean;
  /** Ventana de escala: [2× control, 0,8× eje]. */
  scaleWindow?: { lo: number; hi: number };
  /** Veces que se bajó la escala porque el pico se veía. */
  scaleLowered?: number;
  /** Observaciones del registro (no son errores), p. ej. pico visto por debajo del umbral calibrado. */
  notes?: string[];
  createdAt: string;
  basedOn: { schema: string; createdAt: string };
  cone: ConeId;
  name: EdgeName;
  offeredBecause: "estimate >= 1.6× control" | "1.5× control < 0.8× axis";
  floor: number;
  edgeScale: number;
  startAngleDeg: number;
  sourceThreshold: number;
  sourceTimes: number | null;
  /** `closed` means both sides reached a repeated miss and a repeated hit. The angles are trials, not midpoints. */
  /** «unmeasurable»: el pico se vio incluso a la escala mínima (sin banda medible); distinto de «none». */
  band: "none" | "open" | "closed" | "unmeasurable";
  minus: EdgeBound;
  plus: EdgeBound;
  depth: { angleDeg: number; scale: number; bound: "estimate" | "at-least"; ceiling: number } | null;
  confirmed: { minus: number | null; plus: number | null };
  trials: EdgeTrial[];
  /** Solo con QUEST+: catch obvios y si la ronda es fiable (> 25 % «ninguno» ⇒ no fiable). */
  reliability?: { catches: number; none: number; unreliable: boolean };
}

export type EdgeResult = "found" | "noEdgeToGamut" | "unexplored";

interface EdgeBound {
  found: boolean;
  /**
   * found: borde medido. noEdgeToGamut: el fallo siguió hasta el límite del gamut a la Y del estímulo.
   * unexplored: no se recorrió (por ejemplo, el disco se vio ya en el pico). Ausente en archivos antiguos.
   */
  result?: EdgeResult;
  /** True when this side was still a miss at the last hue of this color. Absent on older files. */
  toEnd?: boolean;
  /** Last miss that was actually shown. Never a midpoint that was not a trial. */
  angleDeg: number | null;
  /** Last repeated miss, toward the starting tone. */
  insideDeg: number | null;
  /** Last repeated hit, outside the miss. */
  outsideDeg: number | null;
  /** Solo con QUEST+: IC 95 % en ° y ΔE00, y cuántos grados son 1 ΔE00 en ese color. */
  qp?: { ciDeg: number; ciDeltaE00: number; deg1DeltaE: number; trials: number };
}

interface Side {
  side: "minus" | "plus";
  inside: number | null;
  outside: number | null;
  insideHits: number;
  outsideHits: number;
  cursor: number;
  walked: number;
  status: "walk" | "bisect" | "confirm" | "done";
  confirm: "inside" | "outside" | null;
  found: boolean;
  /** True when the miss reached the last hue of this color and never recovered. */
  toEnd: boolean;
  edge: number | null;
  /** QUEST+ del refinamiento (solo con flag). */
  qp?: QuestPlus;
  qpTrials?: number;
  /** Ángulo (°) de 1 ΔE00 en el color de referencia de este lado (bisección). */
  deg1DeltaE?: number;
  qpScale?: number;
  /** IC 95 % final en ° y en ΔE00. */
  qpCi?: { deg: number; deltaE00: number };
}

export interface EdgeRun {
  cone: ConeId;
  name: EdgeName;
  floor: number;
  edgeScale: number;
  peak: number;
  sourceThreshold: number;
  sourceTimes: number | null;
  profileSchema: string;
  profileCreatedAt: string;
  phase: EdgePhase;
  repeat: boolean;
  angle: number;
  scale: number;
  oddIndex: number;
  oddSign: 1 | -1;
  rng: number;
  /** A bound is being asked again. Not the same as an unclear tap. */
  edgeConfirm: "inside" | "outside" | null;
  /** How many times the starting tone was seen. A single hit does not close the run. */
  peakSeen: number;
  minus: Side;
  plus: Side;
  depthLo: number;
  depthHi: number;
  depthCursor: number;
  depthLeft: number;
  depthAngle: number;
  depthBound: "estimate" | "at-least";
  depthSaw: boolean;
  trials: EdgeTrial[];
  band: EdgeFile["band"] | null;
  /** jsQuestPlus cargado: activa QUEST+ en el refinamiento. */
  questPlus?: JsQuest;
  /** Ensayo actual es un catch de diferencia obvia (solo con QUEST+). */
  catchTrial?: boolean;
  catches?: { shown: number; none: number };
  floorFrom?: "band";
  /** El gamut no deja la escala pedida: la banda queda abierta (archivos anteriores). */
  scaleLimited?: boolean;
  /** Escala mínima a la que se baja si el pico se ve (umbral del control). */
  scaleFloor?: number;
  scaleWindow?: { lo: number; hi: number };
  /** Veces que se bajó la escala porque el pico se veía. */
  scaleLowered?: number;
}

export interface EdgeAnswer {
  picked: number[];
  none: boolean;
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function nextRand(state: number): { state: number; value: number } {
  const x = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: x, value: x / 4294967296 };
}

function roll(rng: number): { rng: number; oddIndex: number; oddSign: 1 | -1 } {
  const first = nextRand(rng || 1);
  const second = nextRand(first.state);
  return {
    rng: second.state,
    oddIndex: Math.min(3, Math.floor(first.value * 4)),
    oddSign: second.value < 0.5 ? 1 : -1,
  };
}

export function scaleAt(floor: number, angleDeg: number): number {
  const dir = dirFromTheta(rad(angleDeg));
  const room = Math.min(maxScale(dir), maxScale([-dir[0], -dir[1], -dir[2]]));
  return Math.max(0.01, Math.min(floor * 2, room * 0.82));
}

export function discEnds(angleDeg: number, scale: number): { positive: [number, number, number]; negative: [number, number, number] } {
  const dir = dirFromTheta(rad(angleDeg));
  const gray: Vec3 = [ANCHOR, ANCHOR, ANCHOR];
  return {
    positive: toSrgb8(addScaled(gray, dir, scale)),
    negative: toSrgb8(addScaled(gray, dir, -scale)),
  };
}

/**
 * Los cuatro discos del ensayo (sRGB 8 bits). En un catch obvio el disco distinto, además del tono,
 * lleva un 25 % más de luminancia Y (≥ 20 %, Colorado): obvio para cualquier daltónico.
 */
export function discsOf(run: Pick<EdgeRun, "angle" | "scale" | "oddIndex" | "oddSign" | "catchTrial">): Array<[number, number, number]> {
  const dir = dirFromTheta(rad(run.angle));
  const gray: Vec3 = [ANCHOR, ANCHOR, ANCHOR];
  const odd = addScaled(gray, dir, run.oddSign * run.scale);
  const other = toSrgb8(addScaled(gray, dir, -run.oddSign * run.scale));
  const k = run.catchTrial ? QP_EDGES.catchLum : 1;
  const oddRgb = toSrgb8(odd.map((v) => Math.min(1, v * k)) as Vec3);
  return [0, 1, 2, 3].map((i) => (i === run.oddIndex ? oddRgb : other));
}

/** `seen`: the single odd disc. `none`: nothing stood out. `miss`: one disc, and it was one of the three equals. */
export function classify(picked: number[], none: boolean, oddIndex: number): AnswerKind {
  if (none || picked.length === 0) return "none";
  if (picked.length === 1 && picked[0] === oddIndex) return "seen";
  return "miss";
}

/**
 * Tramo fino de la búsqueda, derivado del perfil (Colorado, generalización 26/10): desde el pico medido se
 * camina en pasos de 1° mientras la pantalla siga pintando el mismo nombre de tono (hueName a escala 0,1),
 * hasta ±SECTOR_SPAN. Ya no hay ventanas fijas por cono; `cone` solo se conserva por compatibilidad.
 */
const SECTOR_SPAN = 80;
export function sectorOf(_cone: ConeId, peak: number): { lo: number; hi: number } {
  // Violáceo y azulado son un mismo tramo azul (la pantalla no tiene otro azul que probar entre ellos).
  const family = (n: string) => (n === "violáceo" || n === "azulado" ? "azul" : n);
  const name = (deg: number) => family(hueName(addScaled([ANCHOR, ANCHOR, ANCHOR], dirFromTheta((deg * Math.PI) / 180), 0.1)));
  const at = name(peak);
  const walk = (sign: 1 | -1) => {
    let last = peak;
    for (let d = 1; d <= SECTOR_SPAN; d++) {
      if (name(peak + sign * d) !== at) break;
      last = peak + sign * d;
    }
    return last;
  };
  return { lo: walk(-1), hi: walk(1) };
}

function snap(deg: number): number {
  return Math.round(deg * 10) / 10;
}

function blankSide(side: "minus" | "plus", peak: number): Side {
  const sign = side === "minus" ? -1 : 1;
  return {
    side,
    inside: snap(peak),
    outside: null,
    insideHits: 1,
    outsideHits: 0,
    cursor: snap(peak + sign * WALK_STEP),
    walked: WALK_STEP,
    status: "walk",
    confirm: null,
    found: false,
    toEnd: false,
    edge: null,
  };
}

/**
 * Límite de la búsqueda: el último tono donde los dos discos (gris ± escala) caben en el gamut a la Y
 * constante del estímulo, hasta MAX_SPAN. A Y constante el rojo se acaba antes. Analítico, no el sector.
 */
export function searchLimit(peak: number, sign: 1 | -1, scale: number): number {
  let last = peak;
  for (let d = 0.5; d <= MAX_SPAN + 1e-9; d += 0.5) {
    const a = peak + sign * d;
    if (roomAt(a) < scale) break;
    last = a;
  }
  return snap(last);
}

export function searchBounds(run: Pick<EdgeRun, "peak" | "edgeScale">): { lo: number; hi: number } {
  return { lo: searchLimit(run.peak, -1, run.edgeScale), hi: searchLimit(run.peak, 1, run.edgeScale) };
}

/** Paso de 4° dentro del sector del color; fuera, geométrico (la mitad de lo andado), hasta el límite. */
function reach(cursor: number, limit: number, sign: number, peak?: number, sectorEnd?: number): number {
  const past = peak != null && sectorEnd != null && (sign < 0 ? cursor <= sectorEnd + 1e-9 : cursor >= sectorEnd - 1e-9);
  const step = past ? Math.max(WALK_STEP, Math.abs(cursor - (peak as number)) * GEO_STEP) : WALK_STEP;
  let next = snap(cursor + sign * step);
  // No saltar el final del sector sin probarlo.
  if (!past && sectorEnd != null && (sign < 0 ? next < sectorEnd : next > sectorEnd)) next = snap(sectorEnd);
  return sign < 0 ? snap(Math.max(limit, next)) : snap(Math.min(limit, next));
}

function atEnd(cursor: number, limit: number): boolean {
  return Math.abs(cursor - limit) < 0.05;
}

/** Ventana de escala de Bordes (Colorado, 8.ª ronda): ≥ 1,5× el umbral del control y ≤ 0,8× el umbral del eje. */
export const EDGE_SCALE = { timesControl: 1.5, timesAxis: 0.8, lowerStep: 0.8 } as const;

export interface EdgeWindow {
  /** 1,5 × umbral del control: por encima se ve en ángulos sanos. */
  lo: number;
  /** 0,8 × umbral del eje: por debajo no se ve en el pico. */
  hi: number;
  /** Escala inicial: media geométrica de la ventana, sin salir del gamut en el pico. */
  scale: number;
  offered: boolean;
}

/**
 * La escala debe ser invisible en el pico y visible en ángulos sanos: entre 1,5× el control y 0,8× el umbral del eje.
 * Si 1,5× control ≥ 0,8× eje, la prueba de Bordes no se ofrece para ese eje.
 */
export function edgeWindow(peakDeg: number, axisThreshold: number, controlThreshold: number): EdgeWindow {
  const lo = EDGE_SCALE.timesControl * controlThreshold;
  const hi = EDGE_SCALE.timesAxis * axisThreshold;
  const offered = controlThreshold > 0 && axisThreshold > 0 && lo < hi;
  const room = roomAt(peakDeg);
  const scale = offered ? Math.max(0.001, Math.min(Math.sqrt(lo * hi), room)) : 0;
  return { lo, hi, scale, offered: offered && room > lo };
}

function roomAt(angleDeg: number): number {
  const dir = dirFromTheta(rad(angleDeg));
  return Math.min(maxScale(dir), maxScale([-dir[0], -dir[1], -dir[2]])) * 0.82;
}

/** High enough to reach the profile threshold, with room above it so a hit can bracket it. */
function depthCeiling(floor: number, source: number, angleDeg: number): number {
  const room = Math.max(0.01, roomAt(angleDeg));
  const target = Math.max(floor * 2, source > 0 ? source * 1.35 : floor * 2);
  return Math.min(room, Math.max(floor * 2, target));
}

function place(run: EdgeRun, phase: EdgePhase, angle: number, scale: number): EdgeRun {
  const rolled = roll(run.rng);
  const side = phase === "minus" ? run.minus : phase === "plus" ? run.plus : null;
  return {
    ...run,
    phase,
    angle: snap(angle),
    scale,
    oddIndex: rolled.oddIndex,
    oddSign: rolled.oddSign,
    rng: rolled.rng,
    repeat: false,
    edgeConfirm: side?.status === "confirm" ? side.confirm : null,
  };
}

/** Entrada de Bordes sacada SIEMPRE del perfil en que se basa (basedOn); ningún umbral fijo. */
export function edgeInputFromProfile(
  profile: {
    schema: string;
    createdAt: string;
    fit: { controlAbs?: number | null; controlBounded?: boolean; timesControlKind?: string | null; pathways?: Array<{ id: string; threshold?: number | null; timesControl?: number | null }> };
    axes: Array<{ id: string; angleDeg: number; threshold: number | null }>;
  },
  cone: ConeId,
): Parameters<typeof startRun>[0] {
  const pathway = profile.fit.pathways?.find((item) => item.id === cone);
  const axis = profile.axes.find((item) => item.id === cone);
  return {
    cone,
    peakDeg: axis?.angleDeg ?? 0,
    floor: profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02,
    sourceThreshold: pathway?.threshold ?? axis?.threshold ?? 0,
    sourceTimes: pathway?.timesControl ?? null,
    profileSchema: profile.schema,
    profileCreatedAt: profile.createdAt,
    controlBounded: profile.fit.controlBounded ?? profile.fit.timesControlKind === "at-least",
  };
}

export function startRun(input: {
  cone: ConeId;
  peakDeg: number;
  floor: number;
  sourceThreshold: number;
  sourceTimes: number | null;
  profileSchema: string;
  profileCreatedAt: string;
  seed?: number;
  questPlus?: JsQuest;
  /** El control del perfil está acotado (último peldaño): no se hereda; el suelo es el umbral de la banda. */
  controlBounded?: boolean;
}): EdgeRun {
  const fromBand = input.controlBounded === true && input.sourceThreshold > 0;
  const floor = fromBand ? input.sourceThreshold : input.floor > 0 ? input.floor : 0.02;
  // Con el suelo de la banda, el disco va por debajo de su umbral (0,8×): dentro no se ve, fuera sí.
  const control = input.floor > 0 ? input.floor : 0.02;
  const win = edgeWindow(input.peakDeg, input.sourceThreshold, control);
  // Fuera de la ventana no se ofrece (la UI no lo lanza); si se fuerza, se usa la cota inferior.
  const edgeScale = win.offered ? win.scale : Math.max(0.001, Math.min(win.lo, roomAt(input.peakDeg)));
  const rolled = roll(input.seed ?? ((Date.now() >>> 0) || 1));
  const peak = input.peakDeg;
  return {
    cone: input.cone,
    name: EDGE_NAME[input.cone],
    floor,
    edgeScale,
    peak,
    ...(fromBand ? { floorFrom: "band" as const } : {}),
    scaleFloor: Math.min(control, edgeScale),
    scaleWindow: { lo: win.lo, hi: win.hi },
    sourceThreshold: input.sourceThreshold,
    sourceTimes: input.sourceTimes,
    profileSchema: input.profileSchema,
    profileCreatedAt: input.profileCreatedAt,
    phase: "peak",
    repeat: false,
    angle: peak,
    scale: edgeScale,
    oddIndex: rolled.oddIndex,
    oddSign: rolled.oddSign,
    rng: rolled.rng,
    edgeConfirm: null,
    peakSeen: 0,
    minus: blankSide("minus", peak),
    plus: blankSide("plus", peak),
    depthLo: 0,
    depthHi: edgeScale,
    depthCursor: edgeScale,
    depthLeft: DEPTH_TRIALS,
    depthAngle: peak,
    depthBound: "estimate",
    depthSaw: false,
    trials: [],
    band: null,
    ...(input.questPlus ? { questPlus: input.questPlus } : {}),
  };
}

function pushTrial(run: EdgeRun, input: EdgeAnswer, kind: AnswerKind, phase: EdgeTrial["phase"], side: EdgeTrial["side"]): EdgeRun {
  const ends = discEnds(run.angle, run.scale);
  const trial: EdgeTrial = {
    order: run.trials.length + 1,
    phase,
    side,
    angleDeg: round1(run.angle),
    scale: round4(run.scale),
    oddIndex: run.oddIndex,
    oddSign: run.oddSign,
    picked: input.none ? [] : [...input.picked],
    none: input.none || input.picked.length === 0,
    kind,
    repeat: run.repeat,
    check: run.edgeConfirm,
    positive: ends.positive,
    negative: ends.negative,
  };
  return { ...run, trials: [...run.trials, trial] };
}

function sideOf(phase: EdgePhase): EdgeTrial["side"] {
  if (phase === "peak") return "peak";
  if (phase === "minus") return "minus";
  if (phase === "plus") return "plus";
  if (phase === "depth") return "center";
  return "center";
}

function recordPhase(phase: EdgePhase): EdgeTrial["phase"] {
  if (phase === "depth") return "depth";
  if (phase === "confirm") return "confirm";
  return "edge";
}

function gapOf(side: Side): number {
  if (side.inside == null || side.outside == null) return Number.POSITIVE_INFINITY;
  return Math.abs(side.outside - side.inside);
}

function withCursor(side: Side, cursor: number, status: Side["status"], confirm: Side["confirm"]): Side {
  return { ...side, cursor: snap(cursor), status, confirm };
}

function finishAtEnd(side: Side, limit: number): Side {
  return {
    ...side,
    inside: snap(limit),
    insideHits: Math.max(2, side.insideHits),
    outside: null,
    cursor: snap(limit),
    status: "done",
    confirm: null,
    found: true,
    toEnd: true,
    edge: snap(limit),
  };
}

/**
 * Ángulo de tono θ (°) tal que ΔE00(ref(pico), ref(pico ± θ)) = target, por bisección en θ
 * (Colorado, punto 6). ref(φ) = gris + dir(φ)·escala, el color del disco a ese tono.
 */
export function angleForDeltaE(peakDeg: number, scale: number, sign: 1 | -1, target: number, maxDeg = 90): number {
  const gray: Vec3 = [ANCHOR, ANCHOR, ANCHOR];
  const ref = addScaled(gray, dirFromTheta(rad(peakDeg)), scale);
  const de = (t: number) => deltaE00Linear(ref, addScaled(gray, dirFromTheta(rad(peakDeg + sign * t)), scale));
  if (de(maxDeg) < target) return maxDeg;
  let lo = 0;
  let hi = maxDeg;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (de(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Arranca QUEST+ dentro del intervalo del bracketing, prior uniforme (§3.2). */
function startQuest(side: Side, peak: number, ctx: QpCtx): Side {
  const a = Math.abs((side.inside ?? peak) - peak);
  const b = Math.abs((side.outside ?? peak) - peak);
  // Rejilla algo más ancha que el bracketing (½× a 1,5×): un borde cerca del extremo no queda truncado.
  const lo = Math.max(QP_EDGES.stepDeg, Math.min(a, b) / 2);
  const hi = Math.max(lo + QP_EDGES.stepDeg, Math.max(a, b) * 1.5);
  const n = Math.round((hi - lo) / QP_EDGES.stepDeg) + 1;
  const ds = grid(lo, hi, n);
  const qp = createQuestPlus(ctx.Q, { stim: ds, params: [ds, QP_EDGES.fixedSlope ? [QP_EDGES.nominalBeta] : [...QP_EDGES.betas], [...QP_EDGES.lapses]], responses: detect3(4) });
  const deg1DeltaE = angleForDeltaE(peak, ctx.scale, side.side === "minus" ? -1 : 1, QP_EDGES.stopDeltaE);
  return questStep({ ...side, qp, qpTrials: 0, deg1DeltaE, qpScale: ctx.scale }, peak);
}

function questStep(side: Side, peak: number): Side {
  const qp = side.qp!;
  const sign = side.side === "minus" ? -1 : 1;
  const est = qp.estimate();
  // Parada (Colorado): IC 95 % < 1 ΔE00, medido en ΔE00 entre los colores de los extremos del IC.
  // Si no hay escala de referencia, respaldo fijo de 8°.
  const gray: Vec3 = [ANCHOR, ANCHOR, ANCHOR];
  const at = (d: number) => addScaled(gray, dirFromTheta(rad(peak + sign * d)), side.qpScale ?? 0);
  const ciDe = side.qpScale ? deltaE00Linear(at(est.lo), at(est.hi)) : NaN;
  const narrow = Number.isFinite(ciDe) ? ciDe < QP_EDGES.stopDeltaE : est.width < QP_EDGES.fallbackDeg;
  if ((side.qpTrials ?? 0) > 0 && (narrow || (side.qpTrials ?? 0) >= QP_EDGES.maxTrials)) {
    const edge = snap(peak + sign * est.mean);
    const qpCi = { deg: round1(est.width), deltaE00: round4(Number.isFinite(ciDe) ? ciDe : NaN) };
    return { ...side, qpCi, inside: snap(peak + sign * est.lo), outside: snap(peak + sign * est.hi), status: "done", confirm: null, found: true, edge, cursor: edge };
  }
  return withCursor(side, peak + sign * qp.next(), "bisect", null);
}

/** Ask the midpoint while the bracket is wider than 2°. Then repeat the last miss and the last hit. */
function tighten(side: Side, peak?: number, Q?: QpCtx): Side {
  if (Q && peak != null && side.inside != null && side.outside != null && !side.qp && gapOf(side) > EDGE_GAP) return startQuest(side, peak, Q);
  if (side.inside == null || side.outside == null) return side;
  if (gapOf(side) > EDGE_GAP) {
    return withCursor(side, (side.inside + side.outside) / 2, "bisect", null);
  }
  if (side.insideHits < 2) return withCursor(side, side.inside, "confirm", "inside");
  if (side.outsideHits < 2) return withCursor(side, side.outside, "confirm", "outside");
  return { ...side, status: "done", confirm: null, found: true, edge: side.inside, cursor: side.inside };
}

function advanceSide(side: Side, kind: "seen" | "none", peak: number, limit: number, Q?: QpCtx, raw?: AnswerKind, sectorEnd?: number): Side {
  const sign = side.side === "minus" ? -1 : 1;
  if (side.qp && side.status === "bisect") {
    const r = raw ?? kind;
    side.qp.update(Math.abs(side.cursor - peak), r === "seen" ? 0 : r === "miss" ? 1 : 2);
    return questStep({ ...side, qpTrials: (side.qpTrials ?? 0) + 1 }, peak);
  }
  if (side.status === "confirm") {
    if (side.confirm === "inside") {
      if (kind === "none") {
        if (atEnd(side.cursor, limit)) return finishAtEnd(side, limit);
        return tighten({ ...side, insideHits: side.insideHits + 1, confirm: null }, peak, Q);
      }
      if (Math.abs(side.cursor - peak) < 0.05) {
        return { ...side, outside: snap(side.cursor), outsideHits: 1, status: "done", confirm: null, found: false, toEnd: false, edge: null };
      }
      return tighten({ ...side, outside: snap(side.cursor), outsideHits: 1, inside: snap(peak), insideHits: 1, confirm: null, toEnd: false }, peak, Q);
    }
    if (kind === "seen") return tighten({ ...side, outsideHits: side.outsideHits + 1, confirm: null, toEnd: false }, peak, Q);
    const next = reach(side.cursor, limit, sign, peak, sectorEnd);
    if (atEnd(side.cursor, limit) || next === snap(side.cursor)) return finishAtEnd(side, limit);
    return {
      ...side,
      inside: snap(side.cursor),
      insideHits: 1,
      outside: null,
      outsideHits: 0,
      cursor: next,
      walked: Math.abs(next - peak),
      status: "walk",
      confirm: null,
      toEnd: false,
    };
  }
  if (side.status === "walk") {
    if (kind === "none") {
      const next = reach(side.cursor, limit, sign, peak, sectorEnd);
      if (atEnd(side.cursor, limit) || next === snap(side.cursor)) {
        return { ...side, inside: snap(side.cursor), insideHits: side.insideHits + 1, cursor: snap(limit), status: "confirm", confirm: "inside" };
      }
      return { ...side, inside: snap(side.cursor), insideHits: 1, cursor: next, walked: Math.abs(next - peak), status: "walk", confirm: null };
    }
    return tighten({ ...side, outside: snap(side.cursor), outsideHits: 1, confirm: null, toEnd: false }, peak, Q);
  }
  const patched =
    kind === "none"
      ? { ...side, inside: snap(side.cursor), insideHits: 1, confirm: null as Side["confirm"] }
      : { ...side, outside: snap(side.cursor), outsideHits: 1, confirm: null as Side["confirm"], toEnd: false };
  return tighten(patched, peak, Q);
}

function beginDepth(run: EdgeRun): EdgeRun {
  const known = [run.minus, run.plus].filter((side) => side.found && side.edge != null).map((side) => side.edge as number);
  // Con un solo borde conocido, la media sería ese borde: la profundidad se mide en el pico.
  const depthAngle = snap(known.length === 2 ? (known[0] + known[1]) / 2 : run.peak);
  const recovered = run.minus.found && run.plus.found && !run.minus.toEnd && !run.plus.toEnd;
  const ceiling = depthCeiling(run.floor, run.sourceThreshold, depthAngle);
  const next = place(
    { ...run, depthAngle, depthLo: 0, depthHi: ceiling, depthLeft: DEPTH_TRIALS, depthBound: "estimate", band: recovered ? "closed" : "open" },
    "depth",
    depthAngle,
    run.edgeScale,
  );
  return { ...next, depthCursor: run.edgeScale };
}

/** Tono de un catch obvio: +90° del pico (perpendicular a la confusión), en (−180, 180]. */
function catchAngle(peak: number): number {
  const a = peak + 90;
  return a > 180 ? a - 360 : a;
}

function afterSearch(run: EdgeRun, kind: "seen" | "none", raw?: AnswerKind): EdgeRun {
  if (run.phase === "peak") {
    if (kind === "seen") {
      if (run.peakSeen < 1) {
        const again = place(run, "peak", run.peak, run.edgeScale);
        return { ...again, peakSeen: 1, edgeConfirm: "outside" };
      }
      // Pico visto dos veces: no se cierra. Se baja la escala y se repite (Colorado, 7.ª ronda).
      const floorScale = run.scaleFloor ?? 0.001;
      const lowered = Math.max(floorScale, run.edgeScale * EDGE_SCALE.lowerStep);
      if (lowered < run.edgeScale - 1e-6) {
        const next = { ...run, edgeScale: lowered, depthHi: lowered, depthCursor: lowered, peakSeen: 0, scaleLowered: (run.scaleLowered ?? 0) + 1 };
        return place(next, "peak", run.peak, lowered);
      }
      // Visto aún a la escala mínima: sin banda medible (no es «none»).
      return { ...run, phase: "done", band: "unmeasurable", edgeConfirm: null };
    }
    const first = reach(run.peak, searchBounds(run).lo, -1, run.peak, sectorOf(run.cone, run.peak).lo);
    return place({ ...run, minus: { ...blankSide("minus", run.peak), cursor: first } }, "minus", first, run.edgeScale);
  }
  if (run.phase === "minus" || run.phase === "plus") {
    const current = run.phase === "minus" ? run.minus : run.plus;
    const bounds = searchBounds(run);
    const sector = sectorOf(run.cone, run.peak);
    const limit = run.phase === "minus" ? bounds.lo : bounds.hi;
    const sectorEnd = run.phase === "minus" ? sector.lo : sector.hi;
    const stepped = advanceSide(current, kind, run.peak, limit, run.questPlus ? { Q: run.questPlus, scale: run.edgeScale } : undefined, raw, sectorEnd);
    const patched = run.phase === "minus" ? { ...run, minus: stepped } : { ...run, plus: stepped };
    if (stepped.status !== "done") {
      if (stepped.qp && (stepped.qpTrials ?? 0) > 0 && (stepped.qpTrials ?? 0) % QP_EDGES.catchEvery === 0 && (current.qpTrials ?? 0) !== stepped.qpTrials) {
        return { ...place(patched, run.phase, catchAngle(run.peak), run.edgeScale), catchTrial: true };
      }
      return place(patched, run.phase, stepped.cursor, run.edgeScale);
    }
    // Mínimo 2 catch por ronda (Colorado, 5.ª ronda): si QUEST+ cerró ambos lados con menos, se muestran antes de seguir.
    if (run.phase === "plus" && run.questPlus && (run.catches?.shown ?? 0) < QP_EDGES.catchPerRound) {
      return { ...place(patched, "plus", catchAngle(run.peak), run.edgeScale), catchTrial: true };
    }
    if (run.phase === "minus") {
      const cursor = reach(run.peak, bounds.hi, 1, run.peak, sector.hi);
      const plus = { ...blankSide("plus", run.peak), cursor };
      return place({ ...patched, plus }, "plus", cursor, run.edgeScale);
    }
    return beginDepth(patched);
  }
  if (run.phase === "depth") {
    let lo = run.depthLo;
    let hi = run.depthHi;
    const saw = run.depthSaw || kind === "seen";
    if (kind === "seen") hi = run.scale;
    else lo = run.scale;
    const ceiling = Math.max(run.depthHi, run.edgeScale);
    const left = run.depthLeft - 1;
    const stuck = Math.abs(hi - lo) < 0.004 || run.scale >= ceiling - 1e-3;
    if (!saw && (stuck || left <= 0)) {
      return { ...run, depthLo: lo, depthHi: lo, depthCursor: lo, depthLeft: 0, depthSaw: false, depthBound: "at-least", phase: "confirm", edgeConfirm: null, band: run.band ?? "open" };
    }
    if (left <= 0 || Math.abs(hi - lo) < 0.004) {
      return { ...run, depthLo: lo, depthHi: hi, depthCursor: (lo + hi) / 2, depthLeft: 0, depthSaw: saw, depthBound: "estimate", phase: "confirm", edgeConfirm: null, band: run.band ?? "open" };
    }
    return place({ ...run, depthLo: lo, depthHi: hi, depthCursor: (lo + hi) / 2, depthLeft: left, depthSaw: saw, depthBound: "estimate" }, "depth", run.depthAngle, (lo + hi) / 2);
  }
  return run;
}

/** One answer. A wrong disc and “nothing stands out” both fail the step, and they are stored apart. Nothing here touches the filters. */
export function applyAnswer(run: EdgeRun, input: EdgeAnswer): EdgeRun {
  if (run.phase === "done") return run;
  if (run.trials.length >= 120) return { ...run, phase: "done", band: run.band ?? "open" };
  const kind = classify(input.picked, input.none, run.oddIndex);
  const recorded = pushTrial(run, input, kind, recordPhase(run.phase), sideOf(run.phase));
  if (run.catchTrial) {
    // Catch obvio: no toca el QUEST+; solo cuenta para la fiabilidad. Vuelve al cursor del lado.
    const last = recorded.trials.length - 1;
    const odd = discsOf(run)[run.oddIndex];
    const trials = recorded.trials.map((t, i) => (i === last ? { ...t, catch: true as const, ...(run.oddSign > 0 ? { positive: odd } : { negative: odd }) } : t));
    const c = run.catches ?? { shown: 0, none: 0 };
    const catches = { shown: c.shown + 1, none: c.none + (kind === "none" ? 1 : 0) };
    const side = run.phase === "minus" ? run.minus : run.plus;
    // Catch obligatorio de cierre (ronda sin ninguno): el lado ya terminó, se sigue a la profundidad.
    if (side.status === "done") {
      if (catches.shown < QP_EDGES.catchPerRound) return { ...place({ ...recorded, trials, catches }, run.phase, catchAngle(run.peak), run.edgeScale), catchTrial: true };
      return beginDepth({ ...recorded, trials, catches, catchTrial: false });
    }
    return { ...place({ ...recorded, trials, catches }, run.phase, side.cursor, run.edgeScale), catchTrial: false };
  }
  if (run.phase === "confirm") {
    const rolled = roll(recorded.rng);
    return { ...recorded, oddIndex: rolled.oddIndex, oddSign: rolled.oddSign, rng: rolled.rng };
  }
  return afterSearch(recorded, kind === "seen" ? "seen" : "none", kind);
}

export function armConfirm(run: EdgeRun, angleDeg: number): EdgeRun {
  return place(run, "confirm", angleDeg, run.edgeScale);
}

function boundOf(side: Side): EdgeBound {
  const result: EdgeResult = side.found && !side.toEnd ? "found" : side.toEnd ? "noEdgeToGamut" : "unexplored";
  return {
    found: side.found,
    toEnd: side.toEnd,
    result,
    angleDeg: side.edge == null ? null : round1(side.edge),
    insideDeg: side.found && side.inside != null ? round1(side.inside) : null,
    outsideDeg: side.found && side.outside != null ? round1(side.outside) : null,
    ...(side.qpCi ? { qp: { ciDeg: side.qpCi.deg, ciDeltaE00: side.qpCi.deltaE00, deg1DeltaE: round1(side.deg1DeltaE ?? 0), trials: side.qpTrials ?? 0 } } : {}),
  };
}

export function edgeFile(run: EdgeRun, confirmed?: { minus: number | null; plus: number | null }): EdgeFile {
  const minus = boundOf(run.minus);
  const plus = boundOf(run.plus);
  const ceiling = depthCeiling(run.floor, run.sourceThreshold, run.depthAngle);
  const depth =
    run.phase === "peak" || run.phase === "minus" || run.phase === "plus" || run.band === "none" || run.band === "unmeasurable"
      ? null
      : {
          angleDeg: round1(run.depthAngle),
          scale: round4(run.depthBound === "at-least" ? run.depthLo : (run.depthLo + run.depthHi) / 2),
          bound: run.depthBound,
          ceiling: round4(ceiling),
        };
  return {
    schema: "umbral.edges.v1",
    createdAt: new Date().toISOString(),
    basedOn: { schema: run.profileSchema, createdAt: run.profileCreatedAt },
    cone: run.cone,
    name: run.name,
    offeredBecause: run.scaleWindow ? "1.5× control < 0.8× axis" : "estimate >= 1.6× control",
    floor: round4(run.floor),
    ...(run.floorFrom === "band" ? { floorFrom: "band" as const } : {}),
    edgeScale: round4(run.edgeScale),
    startAngleDeg: round1(run.peak),
    sourceThreshold: round4(run.sourceThreshold),
    sourceTimes: run.sourceTimes,
    band: run.scaleLimited && run.band === "closed" ? "open" : (run.band ?? (run.phase === "done" ? "none" : "open")),
    ...(run.scaleLimited ? { scaleLimited: true } : {}),
    ...(run.scaleWindow ? { scaleWindow: { lo: round4(run.scaleWindow.lo), hi: round4(run.scaleWindow.hi) } } : {}),
    ...(run.scaleLowered ? { scaleLowered: run.scaleLowered } : {}),
    minus,
    plus,
    depth,
    confirmed: confirmed ?? { minus: minus.angleDeg, plus: plus.angleDeg },
    trials: run.trials,
    ...(run.questPlus ? { reliability: reliabilityOf(run) } : {}),
    ...(notesOf(run).length ? { notes: notesOf(run) } : {}),
  };
}

/** Registro, no error: el pico se vio a una escala menor que el umbral calibrado (ruido entre sesiones o día). */
function notesOf(run: EdgeRun): string[] {
  const first = run.trials.find((t) => t.side === "peak");
  if (first?.kind === "seen" && run.edgeScale < run.sourceThreshold) {
    return [`peak-seen-below-source: pico visto a ${round4(run.edgeScale)} con umbral calibrado ${round4(run.sourceThreshold)}`];
  }
  return [];
}

export function reliabilityOf(run: EdgeRun): { catches: number; none: number; unreliable: boolean } {
  const c = run.catches ?? { shown: 0, none: 0 };
  return { catches: c.shown, none: c.none, unreliable: c.shown > 0 && c.none / c.shown > QP_EDGES.catchNoneMax };
}

export type SessionReliability = { rounds: number; catches: number; none: number; status: "fiable" | "no fiable" | "indeterminada" };

/**
 * Fiabilidad de la sesión de bordes (Colorado, 4.ª ronda): se suman los catch de todas las rondas QUEST+
 * de la sesión; con < 5 catch es «indeterminada»; si > 25 % son «ninguno», «no fiable». Null sin QUEST+.
 */
export function sessionReliability(files: Array<Pick<EdgeFile, "reliability">>): SessionReliability | null {
  const rel = files.map((f) => f.reliability).filter((r): r is NonNullable<EdgeFile["reliability"]> => !!r);
  if (!rel.length) return null;
  const catches = rel.reduce((n, r) => n + r.catches, 0);
  const none = rel.reduce((n, r) => n + r.none, 0);
  const status = catches < QP_EDGES.sessionCatchMin ? "indeterminada" : none / catches > QP_EDGES.catchNoneMax ? "no fiable" : "fiable";
  return { rounds: rel.length, catches, none, status };
}

export function edgeFilename(cone: ConeId): string {
  return `umbral-${EDGE_NAME[cone]}.json`;
}

/** Lee un umbral.edges.v1. Los basados en perfil v2 siguen valiendo con un perfil v3. */
export function parseEdgeFile(raw: string): EdgeFile | null {
  try {
    const parsed = JSON.parse(raw) as EdgeFile;
    if (parsed?.schema !== "umbral.edges.v1" || !parsed.basedOn || !parsed.cone) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Mismo perfil: se compara por `createdAt`; el esquema puede ser v2 o v3 (la migración no cambia la fecha). */
export function edgeFitsProfile(file: EdgeFile, profile: { schema: string; createdAt: string }): boolean {
  const okSchema = /^umbral\.profile\.v[23]$/.test(file.basedOn.schema) && /^umbral\.profile\.v[23]$/.test(profile.schema);
  return okSchema && file.basedOn.createdAt === profile.createdAt;
}
