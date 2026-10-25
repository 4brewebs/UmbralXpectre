import type { UmbralProfile } from "./profile";
import { ANCHOR, addScaled, angDist, dirFromTheta, luminance, maxScale, toSrgb8, type Vec3 } from "./space";

/** Fast enough that the drift reads as motion, slow enough to follow. */
export const MOTION_HZ = 1;

const START_GAIN = 1.7;
const START_STEP = 0.16;
const FINE_STEP = 0.06;
const FLOOR_GAIN = 0.45;
const MIN_GAIN = 0.35;
const MAX_GAIN = 3.5;
/** Thin stripes across the field. One fat cycle was hard to read. */
const STRIPES = 8;
/** Safety only. A fringe ends when both edges are found. */
const TRIAL_CAP = 48;
const LOCAL_PAIR = 0.8;
const POLE_PAIR = 0.55;

type SweepPhase = "seek" | "down" | "up" | "bisect";
type Axis = UmbralProfile["axes"][number];

export type Side = "left" | "right";
export type MotionAnswer = Side | "still";

export interface MotionTarget {
  id: string;
  hue: string;
  role: string;
  theta: number;
  kind: "cruce" | "extremo" | "control" | "edge";
  sat: number;
  refHue: string;
  refTheta: number;
  refSat: number;
}

export interface MotionTrial {
  targetId: string;
  hue: string;
  kind: string;
  gain: number;
  yRatio: number;
  sign: 1 | -1;
  answer: MotionAnswer;
  tooBright: boolean;
  at: number;
  order: number;
  test?: [number, number, number];
  reference?: [number, number, number];
}

export interface LuminanceMatch {
  axisId: string;
  hue: string;
  role: string;
  kind: "cruce" | "extremo" | "control" | "edge";
  gain: number;
  low: number;
  high: number;
  width: number;
  span: "range" | "point";
  bound: "estimate" | "lower" | "unconverged";
  referenceHue: string;
  reversals: number;
  trials: number;
  order: number;
  samples: MotionTrial[];
}

export interface LuminanceResult {
  method: string;
  temporalHz: number;
  count: number;
  sampleCount: number;
  reading: string;
  matches: LuminanceMatch[];
}

export interface MotionState {
  targets: MotionTarget[];
  index: number;
  phase: SweepPhase;
  gain: number;
  step: number;
  sign: 1 | -1;
  complete: boolean;
  log: MotionTrial[];
  matches: LuminanceMatch[];
  trialsOnTarget: number;
  lastTooBright: boolean | null;
  lastGain: number | null;
  lastYRatio: number | null;
  seenStill: boolean;
  stillGains: number[];
  anchorGain: number | null;
  anchorRatio: number | null;
  darkEdge: number | null;
  brightEdge: number | null;
  bracketLow: number | null;
  bracketHigh: number | null;
  hiTooBright: boolean | null;
  dimBound: number | null;
}

function signOf(rng: () => number): 1 | -1 {
  return rng() < 0.5 ? -1 : 1;
}

function clampGain(gain: number): number {
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, Math.round(gain * 1000) / 1000));
}

function rad(axis: Axis): number {
  return (axis.angleDeg * Math.PI) / 180;
}

function openAxes(profile: UmbralProfile): Axis[] {
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  return profile.axes.filter((axis) => {
    if (axis.role === "control") return false;
    if (axis.thresholdKind === "upper-bound" || axis.closed) return false;
    return axis.threshold != null && axis.threshold >= floor * 1.6;
  });
}

/**
 * An open axis is paired with a nearby open axis, or with the open axis across its own line.
 * The worse threshold is the color whose light we change. A closed neighbor is never the reference.
 */
function pickTargets(profile: UmbralProfile): MotionTarget[] {
  const open = openAxes(profile).slice().sort((a, b) => luminanceRank(a.id, "edge") - luminanceRank(b.id, "edge") || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const targets: MotionTarget[] = [];
  const nearest = (axis: Axis, pool: Axis[]) =>
    pool.reduce((best, item) => (angDist(rad(item), rad(axis)) < angDist(rad(best), rad(axis)) ? item : best));

  for (const axis of open) {
    const others = open.filter((item) => item.id !== axis.id);
    if (!others.length) continue;
    const local = others.filter((item) => angDist(rad(item), rad(axis)) <= LOCAL_PAIR);
    let partner: Axis | null = null;
    if (local.length) partner = nearest(axis, local);
    else {
      const pole = rad(axis) + Math.PI;
      const across = others.filter((item) => angDist(rad(item), pole) <= POLE_PAIR);
      if (across.length) partner = across.reduce((best, item) => (angDist(rad(item), pole) < angDist(rad(best), pole) ? item : best));
    }
    if (!partner) continue;
    const key = [axis.id, partner.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const test = (axis.threshold ?? 0) >= (partner.threshold ?? 0) ? axis : partner;
    const ref = test === axis ? partner : axis;
    const sat = Math.min(test.threshold ?? 0.05, ref.threshold ?? 0.05) * 0.72;
    targets.push({
      id: `${test.id}:cruce`,
      hue: test.hue,
      role: test.role,
      theta: rad(test),
      kind: "cruce",
      sat,
      refHue: ref.hue,
      refTheta: rad(ref),
      refSat: sat,
    });
  }

  for (const axis of open) {
    if (axis.role !== "red-end" && axis.role !== "blue-end") continue;
    if (targets.some((target) => target.id.startsWith(axis.id))) continue;
    targets.push({
      id: `${axis.id}:extremo`,
      hue: axis.hue,
      role: axis.role,
      theta: rad(axis),
      kind: "extremo",
      sat: Math.min(axis.threshold ?? 0.05, maxScale(dirFromTheta(rad(axis))) * 0.4),
      refHue: "gris",
      refTheta: 0,
      refSat: 0,
    });
  }

  const control = profile.axes.find((axis) => axis.role === "control");
  if (control) {
    const theta = rad(control);
    targets.push({
      id: "control",
      hue: control.hue,
      role: "control",
      theta,
      kind: "control",
      sat: Math.min(0.12, maxScale(dirFromTheta(theta)) * 0.45),
      refHue: "gris",
      refTheta: 0,
      refSat: 0,
    });
  }
  return targets;
}

function scaleY(rgb: Vec3, gain: number): Vec3 {
  let k = gain;
  for (let i = 0; i < 14; i++) {
    const next: Vec3 = [rgb[0] * k, rgb[1] * k, rgb[2] * k];
    if (next.every((channel) => channel >= 0 && channel <= 1)) return next;
    k *= 0.86;
  }
  return rgb;
}

function colored(theta: number, sat: number, gain: number): Vec3 {
  const base = addScaled([ANCHOR, ANCHOR, ANCHOR], dirFromTheta(theta), Math.max(0, sat));
  return gain === 1 ? base : scaleY(base, gain);
}

export function pairOf(state: MotionState): { test: Vec3; ref: Vec3 } | null {
  const target = state.targets[state.index];
  if (!target || state.complete) return null;
  const test = colored(target.theta, target.sat, state.gain);
  const ref = target.kind === "control" || target.kind === "extremo" ? ([ANCHOR, ANCHOR, ANCHOR] as Vec3) : colored(target.refTheta, target.refSat, 1);
  return { test, ref };
}

/** Dark-stripe direction, with the grating sign taken out. Right means the test is too bright when sign is +1. */
export function tooBright(answer: Side, sign: 1 | -1): boolean {
  return (answer === "right") === (sign === 1);
}

function freshWalk(rng: () => number): Omit<MotionState, "targets" | "index" | "complete" | "log" | "matches"> {
  return {
    phase: "seek",
    gain: START_GAIN,
    step: START_STEP,
    sign: signOf(rng),
    trialsOnTarget: 0,
    lastTooBright: null,
    lastGain: null,
    lastYRatio: null,
    seenStill: false,
    stillGains: [],
    anchorGain: null,
    anchorRatio: null,
    darkEdge: null,
    brightEdge: null,
    bracketLow: null,
    bracketHigh: null,
    hiTooBright: null,
    dimBound: null,
  };
}

export function createMotion(profile: UmbralProfile, rng: () => number = Math.random): MotionState {
  const targets = pickTargets(profile);
  return {
    targets,
    index: 0,
    complete: targets.length === 0,
    log: [],
    matches: [],
    ...freshWalk(rng),
  };
}

function spanOf(low: number, high: number): "range" | "point" {
  return high - low > FINE_STEP * 0.5 ? "range" : "point";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function matchFrom(
  state: MotionState,
  trials: number,
  low: number,
  high: number,
  span: "range" | "point",
  gain = (Math.min(low, high) + Math.max(low, high)) / 2,
): LuminanceMatch | null {
  const target = state.targets[state.index];
  if (!target) return null;
  return {
    axisId: target.id,
    hue: target.hue,
    role: target.role,
    kind: target.kind,
    gain: round2(gain),
    low: round2(Math.min(low, high)),
    high: round2(Math.max(low, high)),
    width: round2(Math.max(0, high - low)),
    span,
    referenceHue: target.refHue,
    reversals: state.stillGains.length,
    trials,
    order: 0,
    bound: "estimate",
    samples: [],
  };
}

export function answerMotion(state: MotionState, answer: MotionAnswer, now: number, rng: () => number = Math.random): MotionState {
  const target = state.targets[state.index];
  const pair = pairOf(state);
  if (!target || !pair || state.complete) return state;
  const yRatio = luminance(pair.test) / Math.max(1e-6, luminance(pair.ref));
  const bright = answer === "still" ? false : tooBright(answer, state.sign);
  const log: MotionTrial[] = [
    ...state.log,
    {
      targetId: target.id,
      hue: target.hue,
      kind: target.kind,
      gain: round2(state.gain),
      yRatio: round2(yRatio),
      sign: state.sign,
      answer,
      tooBright: answer !== "still" && bright,
      at: now,
      order: 0,
      test: toSrgb8(pair.test),
      reference: toSrgb8(pair.ref),
    },
  ];
  const trialsOnTarget = state.trialsOnTarget + 1;
  if (trialsOnTarget >= TRIAL_CAP) {
    const edge = state.anchorRatio ?? yRatio;
    const low = Math.min(state.darkEdge ?? edge, state.brightEdge ?? edge);
    const high = Math.max(state.darkEdge ?? edge, state.brightEdge ?? edge);
    return advanceTarget(state, log, trialsOnTarget, rng, low, high, spanOf(low, high));
  }
  if (state.phase === "seek") return seek(state, answer, bright, yRatio, log, trialsOnTarget, rng);
  if (state.phase === "down") return walkDown(state, answer, yRatio, log, trialsOnTarget, rng);
  if (state.phase === "up") return walkUp(state, answer, yRatio, log, trialsOnTarget, rng);
  return bisect(state, answer, bright, yRatio, log, trialsOnTarget, rng);
}

function beginFine(state: MotionState, log: MotionTrial[], trials: number, rng: () => number, yRatio: number): MotionState {
  return {
    ...state,
    log,
    trialsOnTarget: trials,
    phase: "down",
    seenStill: true,
    anchorGain: state.gain,
    anchorRatio: yRatio,
    darkEdge: yRatio,
    brightEdge: null,
    stillGains: [...state.stillGains, yRatio],
    gain: clampGain(state.gain - FINE_STEP),
    step: FINE_STEP,
    sign: signOf(rng),
    lastTooBright: null,
    lastGain: state.gain,
    lastYRatio: yRatio,
  };
}

function seek(
  state: MotionState,
  answer: MotionAnswer,
  bright: boolean,
  yRatio: number,
  log: MotionTrial[],
  trials: number,
  rng: () => number,
): MotionState {
  if (answer === "still") return beginFine(state, log, trials, rng, yRatio);
  if (state.lastTooBright != null && state.lastTooBright !== bright && state.lastGain != null) {
    const hi = Math.max(state.lastGain, state.gain);
    const lo = Math.min(state.lastGain, state.gain);
    const hiTooBright = state.lastGain > state.gain ? state.lastTooBright : bright;
    return {
      ...state,
      log,
      trialsOnTarget: trials,
      phase: "bisect",
      bracketLow: lo,
      bracketHigh: hi,
      hiTooBright,
      gain: (lo + hi) / 2,
      step: (hi - lo) / 2,
      sign: signOf(rng),
      lastTooBright: bright,
      lastGain: state.gain,
      lastYRatio: yRatio,
    };
  }
  const next = state.gain - START_STEP;
  if (next < FLOOR_GAIN) return advanceTarget(state, log, trials, rng, yRatio, yRatio, "point");
  return {
    ...state,
    log,
    trialsOnTarget: trials,
    gain: next,
    step: START_STEP,
    sign: signOf(rng),
    lastTooBright: bright,
    lastGain: state.gain,
    lastYRatio: yRatio,
  };
}

function toBrightSide(
  state: MotionState,
  log: MotionTrial[],
  trials: number,
  rng: () => number,
  darkEdge: number,
  dimBound: number | null,
): MotionState {
  return {
    ...state,
    log,
    trialsOnTarget: trials,
    phase: "up",
    darkEdge,
    dimBound,
    gain: clampGain((state.anchorGain ?? state.gain) + FINE_STEP),
    step: FINE_STEP,
    sign: signOf(rng),
    lastTooBright: null,
    lastYRatio: darkEdge,
  };
}

function walkDown(state: MotionState, answer: MotionAnswer, yRatio: number, log: MotionTrial[], trials: number, rng: () => number): MotionState {
  if (answer !== "still") return toBrightSide(state, log, trials, rng, state.darkEdge ?? state.anchorRatio ?? yRatio, yRatio);
  const next = state.gain - FINE_STEP;
  if (next < FLOOR_GAIN) return toBrightSide(state, log, trials, rng, yRatio, yRatio);
  return {
    ...state,
    log,
    trialsOnTarget: trials,
    darkEdge: yRatio,
    stillGains: [...state.stillGains, yRatio],
    gain: next,
    step: FINE_STEP,
    sign: signOf(rng),
    lastGain: state.gain,
    lastYRatio: yRatio,
  };
}

function walkUp(state: MotionState, answer: MotionAnswer, yRatio: number, log: MotionTrial[], trials: number, rng: () => number): MotionState {
  const dark = state.darkEdge ?? state.anchorRatio ?? yRatio;
  if (answer !== "still") {
    const brightEdge = state.brightEdge ?? state.anchorRatio ?? dark;
    if (state.dimBound != null && state.stillGains.length <= 1 && state.brightEdge == null) {
      const gain = state.anchorRatio ?? dark;
      return advanceTarget(state, log, trials, rng, state.dimBound, yRatio, "point", gain);
    }
    const low = Math.min(dark, brightEdge);
    const high = Math.max(dark, brightEdge);
    return advanceTarget(state, log, trials, rng, low, high, spanOf(low, high));
  }
  const next = state.gain + FINE_STEP;
  if (next > MAX_GAIN) {
    const low = Math.min(dark, yRatio);
    const high = Math.max(dark, yRatio);
    return advanceTarget(state, log, trials, rng, low, high, spanOf(low, high));
  }
  return {
    ...state,
    log,
    trialsOnTarget: trials,
    brightEdge: yRatio,
    stillGains: [...state.stillGains, yRatio],
    gain: next,
    step: FINE_STEP,
    sign: signOf(rng),
    lastGain: state.gain,
    lastYRatio: yRatio,
  };
}

function bisect(
  state: MotionState,
  answer: MotionAnswer,
  bright: boolean,
  yRatio: number,
  log: MotionTrial[],
  trials: number,
  rng: () => number,
): MotionState {
  if (answer === "still") return beginFine(state, log, trials, rng, yRatio);
  const lo = state.bracketLow ?? state.gain;
  const hi = state.bracketHigh ?? state.gain;
  const flipBelow = state.hiTooBright == null || bright === state.hiTooBright;
  const nextLo = flipBelow ? lo : state.gain;
  const nextHi = flipBelow ? state.gain : hi;
  if (nextHi - nextLo <= FINE_STEP) return advanceTarget(state, log, trials, rng, nextLo, nextHi, "point");
  return {
    ...state,
    log,
    trialsOnTarget: trials,
    bracketLow: nextLo,
    bracketHigh: nextHi,
    hiTooBright: flipBelow ? bright : state.hiTooBright,
    gain: (nextLo + nextHi) / 2,
    step: (nextHi - nextLo) / 2,
    sign: signOf(rng),
    lastTooBright: bright,
    lastGain: state.gain,
    lastYRatio: yRatio,
  };
}

function advanceTarget(
  state: MotionState,
  log: MotionTrial[],
  trials: number,
  rng: () => number,
  low: number,
  high: number,
  span: "range" | "point",
  gain?: number,
): MotionState {
  const match = matchFrom(state, trials, low, high, span, gain);
  const matches = match ? [...state.matches, match] : state.matches;
  const index = state.index + 1;
  if (index >= state.targets.length) {
    return { ...state, log, matches, complete: true, trialsOnTarget: trials };
  }
  return { ...state, ...freshWalk(rng), index, log, matches };
}

export function describeLuminance(matches: LuminanceMatch[]): string {
  if (!matches.length) return "No hay franjas de brillo.";
  const ruler = matches.find((match) => match.kind === "control");
  const lines = matches.map((match) => {
    const name = match.kind === "control" ? "La regla" : `«${match.hue}» frente a «${match.referenceHue}»`;
    const n = match.samples.length || match.trials;
    const taken = n === 1 ? "1 muestra" : `${n} muestras`;
    if (match.bound === "unconverged") {
      const sides = new Set(match.samples.map((sample) => sample.answer).filter((answer) => answer !== "still"));
      if (match.samples.length > 0 && sides.size <= 1) {
        return `${name} no cambió de lado. Sin quieto: este brillo no entra en el filtro. ${taken}.`;
      }
      return `${name} no dio un quieto. Este brillo no entra en el filtro. ${taken}.`;
    }
    const heardStill = match.samples.some((sample) => sample.answer === "still");
    if (!heardStill) {
      return `${name}: no hubo quieto, pero el sentido cambió entre ${match.low.toFixed(2)}× y ${match.high.toFixed(2)}×. El corte, ${match.gain.toFixed(2)}×, entra como brillo. ${taken}.`;
    }
    if (match.span === "range") {
      return `${name} se queda quieta de ${match.low.toFixed(2)}× a ${match.high.toFixed(2)}×. El abanico mide ${match.width.toFixed(2)}. ${taken}.`;
    }
    if (match.high - match.low > 0.02) {
      return `${name}: quieto en ${match.gain.toFixed(2)}×. Se mueve en ${match.low.toFixed(2)}× y en ${match.high.toFixed(2)}×. ${taken}.`;
    }
    return `${name} tiene un solo corte, en ${match.gain.toFixed(2)}×. ${taken}.`;
  });
  if (matches.every((match) => match.bound === "unconverged")) {
    lines.push("Ninguna franja se quedó quieta. La asistencia no toca la luz.");
  } else if (ruler && ruler.bound !== "unconverged" && Math.abs(ruler.gain - 1) > 0.12) {
    lines.push("La regla no cayó junto a 1×. Esta pasada no sirve de cero.");
  } else if (ruler && ruler.bound !== "unconverged" && ruler.width > 0.03) {
    const wider = matches.filter((match) => match.kind !== "control" && match.bound !== "unconverged" && match.width > ruler.width + 0.08);
    if (wider.length) lines.push("Ese abanico es más ancho que el de la regla.");
  }
  const noun = matches.length === 1 ? "1 franja" : `${matches.length} franjas`;
  return `${noun}. ${lines.join(" ")}`;
}

function luminanceRank(id: string, kind: string): number {
  if (kind === "control" || id === "control") return 900;
  const base = id.split(":")[0];
  const rank: Record<string, number> = { s: 0, control: 1, l: 2, m: 3, "red-end": 4, "blue-end": 5 };
  return (rank[base] ?? 40) * 10;
}

/** Last dim gain and first bright gain. Only when they still form a bracket. */
function bracketFromSamples(samples: MotionTrial[]): { low: number; high: number; gain: number } | null {
  const dim = samples.filter((sample) => !sample.tooBright && sample.answer !== "still").map((sample) => sample.gain);
  const bright = samples.filter((sample) => sample.tooBright).map((sample) => sample.gain);
  if (!dim.length || !bright.length) return null;
  const low = Math.max(...dim);
  const high = Math.min(...bright);
  if (!(high > low)) return null;
  return { low, high, gain: (low + high) / 2 };
}

type LooseMatch = Partial<LuminanceMatch> & { axisId?: string; hue?: string; gain?: number };
type LooseTrial = Partial<MotionTrial> & { targetId?: string; at?: number };

/** One shape however many probes a session needed, and however many answers each probe took. */
export function orderLuminance(result: {
  method?: string;
  temporalHz?: number;
  matches?: LooseMatch[];
  log?: LooseTrial[];
}): LuminanceResult {
  const loose = result.matches ?? [];
  const log = (result.log ?? loose.flatMap((match) => match.samples ?? [])).slice();
  const matches = loose
    .slice()
    .sort(
      (a, b) =>
        luminanceRank(a.axisId ?? "", a.kind ?? "edge") - luminanceRank(b.axisId ?? "", b.kind ?? "edge") ||
        (a.axisId ?? "").localeCompare(b.axisId ?? ""),
    )
    .map((match, index) => {
      const gain = Number.isFinite(match.gain) ? Number(match.gain) : 1;
      const low = Number.isFinite(match.low) ? Number(match.low) : gain;
      const high = Number.isFinite(match.high) ? Number(match.high) : gain;
      const width = Number.isFinite(match.width) ? Number(match.width) : round2(Math.max(0, high - low));
      const span = match.span === "range" || match.span === "point" ? match.span : width > 0.03 ? "range" : "point";
      const samples = log
        .filter((row) => row.targetId === match.axisId)
        .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
        .map(
          (row, sampleOrder): MotionTrial => ({
            targetId: row.targetId ?? match.axisId ?? "",
            hue: row.hue ?? match.hue ?? "",
            kind: row.kind ?? match.kind ?? "edge",
            gain: Number(row.gain ?? gain),
            yRatio: Number(row.yRatio ?? row.gain ?? gain),
            sign: row.sign === -1 ? -1 : 1,
            answer: row.answer === "left" || row.answer === "right" || row.answer === "still" ? row.answer : "still",
            tooBright: Boolean(row.tooBright),
            at: row.at ?? 0,
            order: sampleOrder + 1,
            test: Array.isArray(row.test) ? [Number(row.test[0]), Number(row.test[1]), Number(row.test[2])] : undefined,
            reference: Array.isArray(row.reference)
              ? [Number(row.reference[0]), Number(row.reference[1]), Number(row.reference[2])]
              : undefined,
          }),
        );
      const repaired = bracketFromSamples(samples);
      const bracketWidth = repaired ? repaired.high - repaired.low : Infinity;
      const crossed = repaired != null && bracketWidth <= 0.12;
      const sawStill = samples.some((sample) => sample.answer === "still") || (samples.length === 0 && (match.reversals ?? 0) > 0);
      const useCross = !sawStill && crossed && repaired != null;
      const nextLow = useCross ? repaired.low : Math.min(low, high);
      const nextHigh = useCross ? repaired.high : Math.max(low, high);
      const nextGain = useCross ? repaired.gain : gain;
      const bound: LuminanceMatch["bound"] = useCross || sawStill ? (match.bound === "lower" ? "lower" : "estimate") : "unconverged";
      return {
        axisId: match.axisId ?? `probe-${index + 1}`,
        hue: match.hue ?? "",
        role: match.role ?? "",
        kind: match.kind === "cruce" || match.kind === "extremo" || match.kind === "control" || match.kind === "edge" ? match.kind : "edge",
        gain: round2(nextGain),
        low: round2(nextLow),
        high: round2(nextHigh),
        width: round2(Math.max(0, nextHigh - nextLow)),
        span,
        bound,
        referenceHue: match.referenceHue ?? (match.kind === "control" ? "gris" : ""),
        reversals: match.reversals ?? 0,
        trials: samples.length || match.trials || 0,
        order: index + 1,
        samples,
      };
    });
  return {
    method: result.method ?? "",
    temporalHz: result.temporalHz ?? MOTION_HZ,
    count: matches.length,
    sampleCount: matches.reduce((sum, match) => sum + match.samples.length, 0),
    matches,
    reading: describeLuminance(matches),
  };
}

const LUMINANCE_METHOD =
  "Minimum motion at 1 Hz, eight thin stripes. Every trial asks which way the darker stripes drift. Coarse steps until the first still, then fine steps to the last still on the dim side and the last still on the bright side. The result is those two edges. Partners are only axes the first test left open. A closed neighbor is never the reference. A healthy color is only the ruler against gray.";

export function luminanceResult(state: MotionState): LuminanceResult {
  return orderLuminance({
    method: LUMINANCE_METHOD,
    temporalHz: MOTION_HZ,
    matches: state.matches,
    log: state.log,
  });
}

export function attachLuminance(profile: UmbralProfile, result: LuminanceResult): UmbralProfile {
  return { ...profile, luminance: orderLuminance(result) };
}

export function paintMotion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  test: Vec3,
  ref: Vec3,
  sign: 1 | -1,
  time: number,
): void {
  const image = ctx.createImageData(width, height);
  const wt = MOTION_HZ * Math.PI * 2 * time;
  const ct = Math.cos(wt);
  const st = Math.sin(wt) * sign;
  const data = image.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (x / width) * STRIPES * Math.PI * 2;
      const mix = 0.5 + 0.22 * Math.cos(p) * ct;
      const luma = 1 + 0.16 * Math.sin(p) * st;
      const rgb: Vec3 = [
        (ref[0] + (test[0] - ref[0]) * mix) * luma,
        (ref[1] + (test[1] - ref[1]) * mix) * luma,
        (ref[2] + (test[2] - ref[2]) * mix) * luma,
      ];
      const [r, g, b] = toSrgb8(rgb);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
