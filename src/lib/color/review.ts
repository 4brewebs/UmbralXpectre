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
import { ANCHOR, addScaled, dirFromTheta, isoDir, lumEps, makeLumNoise, maxScale, measuredLumWeights, toSrgb8, withLum, type LumNoise, type Vec3 } from "./space";
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
} as const;

export type ReviewAxisId = (typeof REVIEW.axes)[number];

export interface ReviewTrial {
  order: number;
  axis: ReviewAxisId | "catch";
  scale: number;
  different: boolean;
  catch: boolean;
  lumEps: [number, number];
}

interface ReviewAxis {
  id: ReviewAxisId;
  angleDeg: number;
  original: number;
  qp: QuestPlus;
  trials: number;
}

export interface ReviewState {
  weights: Vec3;
  noise: LumNoise | null;
  axes: ReviewAxis[];
  /** Índice del eje del siguiente ensayo (alternados) o "catch". */
  next: number | "catch";
  log: ReviewTrial[];
  done: boolean;
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

function yesNo(): ResponseFn[] {
  const yes: ResponseFn = (x, a, b, l) => weibull(x, a, b, REVIEW.gamma, l);
  return [yes, (x, a, b, l) => 1 - yes(x, a, b, l)];
}

function reach(angleDeg: number, w: Vec3): number {
  const dir = isoDir(dirFromTheta((angleDeg * Math.PI) / 180), w);
  return Math.min(maxScale(dir), maxScale([-dir[0], -dir[1], -dir[2]]));
}

/** Estado inicial, o null si no hay pesos medidos o el perfil no tiene umbral en l y m. */
export function createReview(profile: UmbralProfile, Q: JsQuest, opts: { seed?: number; lumNoise?: boolean } = {}): ReviewState | null {
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
    const qp = createQuestPlus(Q, { stim: stim.length ? stim : [alphas[0]], params: [alphas, [REVIEW.beta], [...REVIEW.lapses]], prior: [prior], responses: yesNo() });
    axes.push({ id, angleDeg: a.angleDeg, original: t, qp, trials: 0 });
  }
  if (!axes.length) return null;
  return { weights: w, noise: opts.lumNoise ? makeLumNoise(((opts.seed ?? Date.now()) ^ 0x2545f491) >>> 0) : null, axes, next: 0, log: [], done: false };
}

const gray = (): Vec3 => [ANCHOR, ANCHOR, ANCHOR];

export function reviewStimulus(state: ReviewState): ReviewStimulus | null {
  if (state.done) return null;
  const n = state.log.length;
  const eps: [number, number] = state.noise ? [lumEps(state.noise, n, 0), lumEps(state.noise, n, 1)] : [0, 0];
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
  const log = [...state.log, { order: state.log.length + 1, axis: stim.axis, scale: Math.round(stim.scale * 1e5) / 1e5, different, catch: stim.axis === "catch", lumEps: stim.lumEps }];
  const axes = state.axes.map((a) => ({ ...a }));
  if (state.next !== "catch") {
    const ax = axes[state.next];
    ax.qp.update(stim.scale, different ? 0 : 1);
    ax.trials += 1;
  }
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
 * Aplica el repaso: el umbral repasado sustituye al original en los ejes (filtros) y en `fit` (T);
 * el original queda en `thresholdStandardY` y los pesos usados en `review`.
 */
export function applyReview(profile: UmbralProfile, state: ReviewState): UmbralProfile {
  const est = reviewEstimates(state);
  const axes = profile.axes.map((a) => {
    const e = est.find((x) => x.id === a.id);
    return e ? { ...a, threshold: r4(e.threshold), thresholdStandardY: a.threshold, thresholdSource: "review-measured" as const } : a;
  });
  const catches = state.log.filter((t) => t.catch);
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
      trials: state.log,
    },
  });
}
