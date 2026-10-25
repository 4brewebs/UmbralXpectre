import { ANCHOR, addScaled, dirFromTheta, maxScale, toSrgb8, type Vec3 } from "./space";
import { createQuestPlus, detect3, grid, type JsQuest, type QuestPlus } from "./questplus";
import { deltaE00Linear } from "./deltaE";

/**
 * QUEST+ en el refinamiento tras el bracketing (PLAN-questplus §3.2, tras flag `?qp=1`).
 * Weibull de Watson (2017) en d = |ángulo − pico|: P(ver el disco distinto) = γ + (1−γ−λ)(1 − e^−(d/α)^β),
 * α = distancia del borde (°), β y λ marginalizados (decisión 2).
 * Modelo de 3 respuestas `detect3` (Colorado, punto 6): «Ninguno» = fallo de detección informativo,
 * disco equivocado = lapsus/azar. La escalera por defecto no cambia.
 * Parada (Colorado): IC 95 % de α < 2° o 45 ensayos. 1 ΔE00 se convierte a ángulo por bisección
 * (`angleForDeltaE`) y se guarda junto al IC en ΔE00; a la escala de los discos 1 ΔE00 ≈ 8–12°,
 * así que «IC < 1 ΔE00» sería mucho más laxo que 2° (pregunta abierta).
 * Fiabilidad: catch de diferencia obvia (tono +90° del pico); si > 25 % son «ninguno», la ronda no es fiable.
 */
/** Parada (Colorado): IC < 2°, máx. 45. `fixedSlope`: β fijo al nominal 3.5; sesgo simulado −0,9 % (< 3 %, regla de Colorado). */
export const QP_EDGES = { gamma: 0.25, betas: [1.75, 3.5, 7], nominalBeta: 3.5, fixedSlope: true, lapses: [0.02, 0.035, 0.05], stepDeg: 0.5, stopDeg: 2, stopDeltaE: 1, maxTrials: 45, catchEvery: 6, catchNoneMax: 0.25 };

type QpCtx = { Q: JsQuest; scale: number };

export type ConeId = "l" | "m" | "s";
export type EdgeName = "rojos" | "verdes" | "azules";

export const EDGE_NAME: Record<ConeId, EdgeName> = {
  l: "rojos",
  m: "verdes",
  s: "azules",
};

const WALK_STEP = 4;
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
  createdAt: string;
  basedOn: { schema: string; createdAt: string };
  cone: ConeId;
  name: EdgeName;
  offeredBecause: "estimate >= 1.6× control";
  floor: number;
  edgeScale: number;
  startAngleDeg: number;
  sourceThreshold: number;
  sourceTimes: number | null;
  /** `closed` means both sides reached a repeated miss and a repeated hit. The angles are trials, not midpoints. */
  band: "none" | "open" | "closed";
  minus: EdgeBound;
  plus: EdgeBound;
  depth: { angleDeg: number; scale: number; bound: "estimate" | "at-least"; ceiling: number } | null;
  confirmed: { minus: number | null; plus: number | null };
  trials: EdgeTrial[];
  /** Solo con QUEST+: catch obvios y si la ronda es fiable (> 25 % «ninguno» ⇒ no fiable). */
  reliability?: { catches: number; none: number; unreliable: boolean };
}

interface EdgeBound {
  found: boolean;
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

/** `seen`: the single odd disc. `none`: nothing stood out. `miss`: one disc, and it was one of the three equals. */
export function classify(picked: number[], none: boolean, oddIndex: number): AnswerKind {
  if (none || picked.length === 0) return "none";
  if (picked.length === 1 && picked[0] === oddIndex) return "seen";
  return "miss";
}

/**
 * Last angle this display still paints as that hue.
 * Red ends where rojizo becomes orange or magenta. Green ends where verdoso becomes cyan or yellow.
 * Blue ends where the violet–blue run becomes magenta or cyan. Past these there is no more of that color to test.
 */
export function sectorOf(cone: ConeId): { lo: number; hi: number } {
  if (cone === "l") return { lo: -18, hi: 14 };
  if (cone === "m") return { lo: -160, hi: -82 };
  return { lo: 50, hi: 152 };
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

function reach(cursor: number, limit: number, sign: number): number {
  const next = snap(cursor + sign * WALK_STEP);
  return sign < 0 ? snap(Math.max(limit, next)) : snap(Math.min(limit, next));
}

function atEnd(cursor: number, limit: number): boolean {
  return Math.abs(cursor - limit) < 0.05;
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
}): EdgeRun {
  const floor = input.floor > 0 ? input.floor : 0.02;
  const edgeScale = scaleAt(floor, input.peakDeg);
  const rolled = roll(input.seed ?? ((Date.now() >>> 0) || 1));
  const peak = input.peakDeg;
  return {
    cone: input.cone,
    name: EDGE_NAME[input.cone],
    floor,
    edgeScale,
    peak,
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
  if ((side.qpTrials ?? 0) > 0 && (est.width < QP_EDGES.stopDeg || (side.qpTrials ?? 0) >= QP_EDGES.maxTrials)) {
    const edge = snap(peak + sign * est.mean);
    const gray: Vec3 = [ANCHOR, ANCHOR, ANCHOR];
    const at = (d: number) => addScaled(gray, dirFromTheta(rad(peak + sign * d)), side.qpScale ?? 0.04);
    const qpCi = { deg: round1(est.width), deltaE00: round4(deltaE00Linear(at(est.lo), at(est.hi))) };
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

function advanceSide(side: Side, kind: "seen" | "none", peak: number, limit: number, Q?: QpCtx, raw?: AnswerKind): Side {
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
    const next = reach(side.cursor, limit, sign);
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
      const next = reach(side.cursor, limit, sign);
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
  const depthAngle = snap(known.length ? known.reduce((sum, angle) => sum + angle, 0) / known.length : run.peak);
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
      return { ...run, phase: "done", band: "none", edgeConfirm: null };
    }
    return place({ ...run, minus: { ...blankSide("minus", run.peak), cursor: reach(run.peak, sectorOf(run.cone).lo, -1) } }, "minus", reach(run.peak, sectorOf(run.cone).lo, -1), run.edgeScale);
  }
  if (run.phase === "minus" || run.phase === "plus") {
    const current = run.phase === "minus" ? run.minus : run.plus;
    const limit = run.phase === "minus" ? sectorOf(run.cone).lo : sectorOf(run.cone).hi;
    const stepped = advanceSide(current, kind, run.peak, limit, run.questPlus ? { Q: run.questPlus, scale: run.edgeScale } : undefined, raw);
    const patched = run.phase === "minus" ? { ...run, minus: stepped } : { ...run, plus: stepped };
    if (stepped.status !== "done") {
      if (stepped.qp && (stepped.qpTrials ?? 0) > 0 && (stepped.qpTrials ?? 0) % QP_EDGES.catchEvery === 0 && (current.qpTrials ?? 0) !== stepped.qpTrials) {
        return { ...place(patched, run.phase, catchAngle(run.peak), run.edgeScale), catchTrial: true };
      }
      return place(patched, run.phase, stepped.cursor, run.edgeScale);
    }
    if (run.phase === "minus") {
      const sector = sectorOf(run.cone);
      const cursor = reach(run.peak, sector.hi, 1);
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
    const trials = recorded.trials.map((t, i) => (i === last ? { ...t, catch: true as const } : t));
    const c = run.catches ?? { shown: 0, none: 0 };
    const catches = { shown: c.shown + 1, none: c.none + (kind === "none" ? 1 : 0) };
    const side = run.phase === "minus" ? run.minus : run.plus;
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
  return {
    found: side.found,
    toEnd: side.toEnd,
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
    run.phase === "peak" || run.phase === "minus" || run.phase === "plus" || run.band === "none"
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
    offeredBecause: "estimate >= 1.6× control",
    floor: round4(run.floor),
    edgeScale: round4(run.edgeScale),
    startAngleDeg: round1(run.peak),
    sourceThreshold: round4(run.sourceThreshold),
    sourceTimes: run.sourceTimes,
    band: run.band ?? (run.phase === "done" ? "none" : "open"),
    minus,
    plus,
    depth,
    confirmed: confirmed ?? { minus: minus.angleDeg, plus: plus.angleDeg },
    trials: run.trials,
    ...(run.questPlus ? { reliability: reliabilityOf(run) } : {}),
  };
}

export function reliabilityOf(run: EdgeRun): { catches: number; none: number; unreliable: boolean } {
  const c = run.catches ?? { shown: 0, none: 0 };
  return { catches: c.shown, none: c.none, unreliable: c.shown > 0 && c.none / c.shown > QP_EDGES.catchNoneMax };
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
