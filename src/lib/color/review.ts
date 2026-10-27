/**
 * Repaso corto de l y m con los pesos personales (tras la prueba de luminancia).
 *
 * Solo si los pesos se midieron en esta pantalla (`weightsSource: "measured"`); si no, se salta.
 * QUEST+ sí/no en los ejes l y m, con el prior log-normal centrado en el umbral ya medido (Y estándar).
 * Pares gris ± s·dir igualados con los pesos personales (`isoDir`) y ruido ε ±8 % independiente en cada lado.
 * Catch: un par idéntico (gris, también con ε independiente) cada `catchEvery` ensayos.
 * El umbral repasado sustituye al original en `axes[].threshold` (filtros) y en `fit` (T); el original queda en
 * `thresholdStandardY` y los pesos en `review.weights`.
 */
import { createQuestPlus, weibull, type JsQuest, type QuestPlus, type ResponseFn } from "./questplus";
import { gammaOf } from "./calibqp";
import { ANCHOR, addScaled, dirFromTheta, isoDir, lumEps, makeLumNoise, noiseOf, maxScale, measuredLumWeights, toSrgb8, withLum, type LumNoise, type Vec3 } from "./space";
import { refitProfile, type UmbralProfile } from "./profile";

export const REVIEW = {
  /** Ensayos de color por eje (ver `scripts/review-sim.ts`: error frente a número de ensayos). */
  trialsPerAxis: 12,
  /** Un catch (par idéntico) cada 4 ensayos de color: 3 por eje. */
  catchEvery: 4,
  /** Rejilla de α en log: umbral medido ×/÷ 4, 41 puntos. */
  span: 4,
  points: 41,
  /** σ del prior en ln(α): el umbral con Y estándar puede moverse ~×2 con los pesos personales. */
  priorSigma: Math.log(2),
  beta: 3,
  gamma: 0.05,
  lapses: [0.02, 0.05],
  axes: ["l", "m"] as const,
  /** Falsas alarmas / catch por encima de esto: repaso no fiable (se conserva el umbral original). */
  maxFalseAlarmRate: 0.15,
  /** Razón repasado/original fuera de [½, 2]: solo aviso (no se rechaza). */
  ratioWarn: [0.5, 2] as const,
} as const;

export type ReviewAxisId = (typeof REVIEW.axes)[number];

export interface ReviewTrial {
  order: number;
  axis: ReviewAxisId | "catch";
  scale: number;
  different: boolean;
  catch: boolean;
  lumEps: [number, number];
  /** Solo catch con ruido activo: ε₂ − ε₁. */
  dEps?: number;
}

interface ReviewAxis {
  id: ReviewAxisId;
  angleDeg: number;
  original: number;
  qp: QuestPlus;
  trials: number;
  /** Rejillas y prior, para reconstruir el QUEST+ cuando cambia γ. */
  spec: { stim: number[]; alphas: number[]; prior: number[] };
}

export interface ReviewState {
  weights: Vec3;
  noise: LumNoise | null;
  axes: ReviewAxis[];
  /** Índice del eje del siguiente ensayo (alternados) o "catch". */
  next: number | "catch";
  log: ReviewTrial[];
  done: boolean;
  /** γ en uso: `gammaOf(catch, falsas alarmas)` (0,05 con menos de 5 catch). */
  gamma: number;
  Q: JsQuest;
}

export interface ReviewStimulus {
  axis: ReviewAxisId | "catch";
  scale: number;
  reference: [number, number, number];
  comparison: [number, number, number];
  lumEps: [number, number];
  step: number;
  total: number;
}

/** Pesos para el repaso, o null (se salta): solo pesos medidos. */
export function reviewWeights(profile: UmbralProfile | null | undefined): Vec3 | null {
  return measuredLumWeights(profile);
}

function logGrid(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / (n - 1)));
}

function yesNo(gamma: number): ResponseFn[] {
  const yes: ResponseFn = (x, a, b, l) => weibull(x, a, b, gamma, l);
  return [yes, (x, a, b, l) => 1 - yes(x, a, b, l)];
}

function reach(angleDeg: number, w: Vec3): number {
  const dir = isoDir(dirFromTheta((angleDeg * Math.PI) / 180), w);
  return Math.min(maxScale(dir), maxScale([-dir[0], -dir[1], -dir[2]]));
}

/** Estado inicial, o null si no hay pesos medidos o el perfil no tiene umbral en l y m. */
function buildQp(Q: JsQuest, spec: ReviewAxis["spec"], gamma: number): QuestPlus {
  return createQuestPlus(Q, { stim: spec.stim, params: [spec.alphas, [REVIEW.beta], [...REVIEW.lapses]], prior: [spec.prior], responses: yesNo(gamma) });
}

/** γ de los catch del registro (como `calibqp.gammaOf`). */
export function reviewGamma(log: ReviewTrial[]): number {
  const c = log.filter((t) => t.catch);
  return gammaOf(c.length, c.filter((t) => t.different).length);
}

/** Reconstruye el QUEST+ de cada eje con `gamma` y repite sus ensayos (como `calibqp.rebuild`). */
function rebuildAxes(Q: JsQuest, axes: ReviewAxis[], log: ReviewTrial[], gamma: number): ReviewAxis[] {
  return axes.map((a) => {
    const qp = buildQp(Q, a.spec, gamma);
    for (const t of log) if (t.axis === a.id) qp.update(t.scale, t.different ? 0 : 1);
    return { ...a, qp };
  });
}

/** `lumNoise`: `true` = ±8 %, número = esa amplitud (0 incluido, se guarda), `false`/ausente = sin ruido. */
export function createReview(profile: UmbralProfile, Q: JsQuest, opts: { seed?: number; lumNoise?: boolean | number } = {}): ReviewState | null {
  const w = reviewWeights(profile);
  if (!w) return null;
  const axes: ReviewAxis[] = [];
  for (const id of REVIEW.axes) {
    const a = profile.axes.find((x) => x.id === id);
    if (!a || a.threshold == null || !(a.threshold > 0)) continue;
    const t = a.threshold;
    const top = Math.min(t * REVIEW.span, reach(a.angleDeg, w));
    const alphas = logGrid(t / REVIEW.span, t * REVIEW.span, REVIEW.points);
    const stim = alphas.filter((v) => v <= top + 1e-12);
    const prior = alphas.map((v) => Math.exp(-((Math.log(v / t)) ** 2) / (2 * REVIEW.priorSigma ** 2)));
    const spec = { stim: stim.length ? stim : [alphas[0]], alphas, prior };
    axes.push({ id, angleDeg: a.angleDeg, original: t, qp: buildQp(Q, spec, REVIEW.gamma), trials: 0, spec });
  }
  if (!axes.length) return null;
  return { weights: w, noise: noiseOf(opts.lumNoise, ((opts.seed ?? Date.now()) ^ 0x2545f491) >>> 0), axes, next: 0, log: [], done: false, gamma: REVIEW.gamma, Q };
}

const gray = (): Vec3 => [ANCHOR, ANCHOR, ANCHOR];

export function reviewStimulus(state: ReviewState): ReviewStimulus | null {
  if (state.done) return null;
  const n = state.log.length;
  const eps: [number, number] = state.noise?.amp ? [lumEps(state.noise, n, 0), lumEps(state.noise, n, 1)] : [0, 0];
  const total = state.axes.length * REVIEW.trialsPerAxis;
  const total2 = total + Math.ceil(total / REVIEW.catchEvery) - 1;
  if (state.next === "catch") {
    return { axis: "catch", scale: 0, reference: toSrgb8(withLum(gray(), eps[0])), comparison: toSrgb8(withLum(gray(), eps[1])), lumEps: eps, step: n + 1, total: total2 };
  }
  const ax = state.axes[state.next];
  const s = ax.qp.next();
  const dir = isoDir(dirFromTheta((ax.angleDeg * Math.PI) / 180), state.weights);
  return {
    axis: ax.id,
    scale: s,
    reference: toSrgb8(withLum(addScaled(gray(), dir, -s), eps[0])),
    comparison: toSrgb8(withLum(addScaled(gray(), dir, s), eps[1])),
    lumEps: eps,
    step: n + 1,
    total: total2,
  };
}

/** Respuesta: `different` = «distintos». Devuelve un estado nuevo (los QUEST+ se comparten). */
export function answerReview(state: ReviewState, different: boolean): ReviewState {
  const stim = reviewStimulus(state);
  if (!stim) return state;
  const log = [...state.log, { order: state.log.length + 1, axis: stim.axis, scale: Math.round(stim.scale * 1e5) / 1e5, different, catch: stim.axis === "catch", lumEps: stim.lumEps, ...(stim.axis === "catch" && state.noise?.amp ? { dEps: Math.round((stim.lumEps[1] - stim.lumEps[0]) * 1e6) / 1e6 } : {}) }];
  let axes = state.axes.map((a) => ({ ...a }));
  let gamma = state.gamma;
  if (state.next !== "catch") {
    const ax = axes[state.next];
    ax.qp.update(stim.scale, different ? 0 : 1);
    ax.trials += 1;
  } else {
    // Catch: γ con los catch ya vistos; si cambia, se reconstruyen los QUEST+ y se repiten los ensayos.
    gamma = reviewGamma(log);
    if (gamma !== state.gamma) axes = rebuildAxes(state.Q, axes, log, gamma);
  }
  state = { ...state, gamma };
  const colorDone = axes.reduce((t, a) => t + a.trials, 0);
  const done = axes.every((a) => a.trials >= REVIEW.trialsPerAxis);
  if (done) return { ...state, axes, log, next: 0, done: true };
  if (state.next !== "catch" && colorDone % REVIEW.catchEvery === 0) return { ...state, axes, log, next: "catch" };
  const open = axes.map((a, i) => ({ a, i })).filter(({ a }) => a.trials < REVIEW.trialsPerAxis);
  const pick = open.reduce((x, y) => (y.a.trials < x.a.trials ? y : x));
  return { ...state, axes, log, next: pick.i };
}

export interface ReviewEstimate {
  id: ReviewAxisId;
  threshold: number;
  thresholdStandardY: number;
  lo: number;
  hi: number;
  trials: number;
}

export function reviewEstimates(state: ReviewState): ReviewEstimate[] {
  return state.axes.map((a) => {
    const e = a.qp.estimate();
    // Media en log (geométrica) a partir de la marginal.
    const m = a.qp.marginal();
    const lnMean = m.values.reduce((t, v, i) => t + Math.log(v) * m.probs[i], 0);
    return { id: a.id, threshold: Math.exp(lnMean), thresholdStandardY: a.original, lo: e.lo, hi: e.hi, trials: a.trials };
  });
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Aplica el repaso: el umbral repasado sustituye al original en los ejes (filtros) y en `fit` (T), salvo si el eje
 * es «review-unreliable» (FA/catch > 0,15 o el original dentro del IC): entonces se conserva el original.
 * La razón frente al original fuera de [½, 2] solo avisa (`warnings`).
 * el original queda en `thresholdStandardY` y los pesos usados en `review`.
 */
export interface ReviewVerdict {
  falseAlarmRate: number;
  gamma: number;
  /** Por eje: motivos de «review-unreliable» (vacío = sustituye) y aviso de razón. */
  axes: Array<{ id: ReviewAxisId; reasons: string[]; ratio: number; warn: boolean }>;
}

export function reviewVerdict(state: ReviewState): ReviewVerdict {
  const catches = state.log.filter((t) => t.catch);
  const fa = catches.filter((t) => t.different).length;
  const falseAlarmRate = catches.length ? fa / catches.length : 0;
  const axes = reviewEstimates(state).map((e) => {
    const reasons: string[] = [];
    if (falseAlarmRate > REVIEW.maxFalseAlarmRate) reasons.push(`false-alarms ${fa}/${catches.length}`);
    if (e.lo <= e.thresholdStandardY && e.thresholdStandardY <= e.hi) reasons.push("original-inside-ci");
    const ratio = e.threshold / e.thresholdStandardY;
    return { id: e.id, reasons, ratio, warn: ratio < REVIEW.ratioWarn[0] || ratio > REVIEW.ratioWarn[1] };
  });
  return { falseAlarmRate, gamma: state.gamma, axes };
}

export function applyReview(profile: UmbralProfile, state: ReviewState): UmbralProfile {
  const est = reviewEstimates(state);
  const verdict = reviewVerdict(state);
  const axes = profile.axes.map((a) => {
    const e = est.find((x) => x.id === a.id);
    const v = verdict.axes.find((x) => x.id === a.id);
    if (!e) return a;
    // No fiable: se conserva el umbral original (Y estándar).
    if (v?.reasons.length) return { ...a, thresholdSource: "review-unreliable" as const };
    return { ...a, threshold: r4(e.threshold), thresholdStandardY: a.threshold, thresholdSource: "review-measured" as const };
  });
  const catches = state.log.filter((t) => t.catch);
  const unreliable = verdict.axes.filter((v) => v.reasons.length);
  const warnings = verdict.axes.filter((v) => v.warn).map((v) => `ratio-out-of-range ${v.id} ×${Math.round(v.ratio * 100) / 100}`);
  return refitProfile({
    ...profile,
    axes,
    review: {
      scaleNormalized: false,
      method: "QUEST+ sí/no, prior log-normal centrado en el umbral con Y estándar (σ = ln 2)",
      pairLuminance: { source: "measured", weights: [state.weights[0], state.weights[1], state.weights[2]] },
      ...(state.noise ? { lumNoise: state.noise } : {}),
      axes: est.map((e) => ({ id: e.id, threshold: r4(e.threshold), thresholdStandardY: e.thresholdStandardY, lo: r4(e.lo), hi: r4(e.hi), trials: e.trials })),
      catches: { shown: catches.length, falseAlarms: catches.filter((t) => t.different).length },
      gamma: Math.round(state.gamma * 1e4) / 1e4,
      status: unreliable.length === 0 ? "review-measured" : unreliable.length === verdict.axes.length ? "review-unreliable" : "partial",
      ...(unreliable.length ? { unreliable: unreliable.map((v) => ({ id: v.id, reasons: v.reasons })) } : {}),
      ...(warnings.length ? { warnings } : {}),
      trials: state.log,
    },
  });
}
