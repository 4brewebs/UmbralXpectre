/**
 * Validación 3AFC de l y m con los pesos personales (sustituye al repaso sí/no tras la luminancia).
 *
 * «Elige el distinto entre 3»: dos campos iguales (gris − s·dir) y uno distinto (gris + s·dir), los tres igualados en
 * brillo con los pesos medidos (`isoDir`), sin ruido de brillo, en posición aleatoria (semilla) y separados.
 * QUEST+ con γ = 1/3 fija (azar de 3AFC) y lapse estimada (se marginaliza); sin catch: la γ no se estima.
 * Prior log-normal centrado en el umbral del perfil (σ = ln 2). ~10 ensayos por eje, ejes alternados.
 * El umbral validado sustituye al del perfil (filtros y `fit`); el original queda en `thresholdStandardY`.
 * «confirmado» si el original cae dentro del IC 95 %; razón fuera de [½, 2]: solo aviso.
 */
import { createQuestPlus, weibull, type JsQuest, type QuestPlus, type ResponseFn } from "./questplus";
import { ANCHOR, addScaled, dirFromTheta, isoDir, maxScale, measuredLumWeights, toSrgb8, type Vec3 } from "./space";
import { refitProfile, type UmbralProfile } from "./profile";

export const VALIDATION = {
  trialsPerAxis: 10,
  /** Rejilla de α en log: umbral del perfil ×/÷ 4, 41 puntos. */
  span: 4,
  points: 41,
  priorSigma: Math.log(2),
  beta: 3,
  /** Azar de «elige el distinto entre 3». Fija. */
  gamma: 1 / 3,
  /** Rejilla de lapse (se estima marginalizando). */
  lapses: [0, 0.02, 0.04, 0.07, 0.1],
  axes: ["l", "m"] as const,
  ratioWarn: [0.5, 2] as const,
  choices: 3,
} as const;

export type ValidationAxisId = (typeof VALIDATION.axes)[number];

export interface ValidationTrial {
  order: number;
  axis: ValidationAxisId;
  scale: number;
  /** Posición del distinto (0..2) y la elegida. */
  odd: number;
  picked: number;
  correct: boolean;
}

interface ValidationAxis {
  id: ValidationAxisId;
  angleDeg: number;
  original: number;
  qp: QuestPlus;
  trials: number;
}

export interface ValidationState {
  weights: Vec3;
  axes: ValidationAxis[];
  next: number;
  seed: number;
  log: ValidationTrial[];
  done: boolean;
}

export interface ValidationStimulus {
  axis: ValidationAxisId;
  scale: number;
  /** Los tres campos en orden de pantalla; `odd` es el distinto. */
  fields: [number, number, number][];
  odd: number;
  step: number;
  total: number;
}

/** 3AFC: P(acierto) = γ + (1 − γ − λ)·(1 − e^{−(x/α)^β}). Respuestas: 0 acierto, 1 fallo. */
export function oddity3(): ResponseFn[] {
  const ok: ResponseFn = (x, a, b, l) => weibull(x, a, b, VALIDATION.gamma, l);
  return [ok, (x, a, b, l) => 1 - ok(x, a, b, l)];
}

function logGrid(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / (n - 1)));
}

function reach(angleDeg: number, w: Vec3): number {
  const dir = isoDir(dirFromTheta((angleDeg * Math.PI) / 180), w);
  return Math.min(maxScale(dir), maxScale([-dir[0], -dir[1], -dir[2]]));
}

/** Posición del distinto en el ensayo `n` (determinista con la semilla). */
export function oddPosition(seed: number, n: number): number {
  let t = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) % VALIDATION.choices;
}

/** Estado inicial, o null si no hay pesos medidos o el perfil no tiene umbral en l y m. */
export function createValidation(profile: UmbralProfile, Q: JsQuest, opts: { seed?: number } = {}): ValidationState | null {
  const w = measuredLumWeights(profile);
  if (!w) return null;
  const axes: ValidationAxis[] = [];
  for (const id of VALIDATION.axes) {
    const a = profile.axes.find((x) => x.id === id);
    if (!a || a.threshold == null || !(a.threshold > 0)) continue;
    const t = a.threshold;
    const top = Math.min(t * VALIDATION.span, reach(a.angleDeg, w));
    const alphas = logGrid(t / VALIDATION.span, t * VALIDATION.span, VALIDATION.points);
    const stim = alphas.filter((v) => v <= top + 1e-12);
    const prior = alphas.map((v) => Math.exp(-(Math.log(v / t) ** 2) / (2 * VALIDATION.priorSigma ** 2)));
    const qp = createQuestPlus(Q, { stim: stim.length ? stim : [alphas[0]], params: [alphas, [VALIDATION.beta], [...VALIDATION.lapses]], prior: [prior], responses: oddity3() });
    axes.push({ id, angleDeg: a.angleDeg, original: t, qp, trials: 0 });
  }
  if (!axes.length) return null;
  return { weights: w, axes, next: 0, seed: (opts.seed ?? Date.now()) >>> 0, log: [], done: false };
}

const gray = (): Vec3 => [ANCHOR, ANCHOR, ANCHOR];

export function validationStimulus(state: ValidationState): ValidationStimulus | null {
  if (state.done) return null;
  const n = state.log.length;
  const ax = state.axes[state.next];
  const s = ax.qp.next();
  const dir = isoDir(dirFromTheta((ax.angleDeg * Math.PI) / 180), state.weights);
  const same = toSrgb8(addScaled(gray(), dir, -s));
  const diff = toSrgb8(addScaled(gray(), dir, s));
  const odd = oddPosition(state.seed, n);
  const fields = [0, 1, 2].map((i) => (i === odd ? diff : same));
  return { axis: ax.id, scale: s, fields, odd, step: n + 1, total: state.axes.length * VALIDATION.trialsPerAxis };
}

/** Respuesta: posición elegida (0..2). */
export function answerValidation(state: ValidationState, picked: number): ValidationState {
  const stim = validationStimulus(state);
  if (!stim) return state;
  const correct = picked === stim.odd;
  const log = [...state.log, { order: state.log.length + 1, axis: stim.axis, scale: Math.round(stim.scale * 1e5) / 1e5, odd: stim.odd, picked, correct }];
  const axes = state.axes.map((a) => ({ ...a }));
  axes[state.next].qp.update(stim.scale, correct ? 0 : 1);
  axes[state.next].trials += 1;
  if (axes.every((a) => a.trials >= VALIDATION.trialsPerAxis)) return { ...state, axes, log, done: true };
  const open = axes.map((a, i) => ({ a, i })).filter(({ a }) => a.trials < VALIDATION.trialsPerAxis);
  const pick = open.reduce((x, y) => (y.a.trials < x.a.trials ? y : x));
  return { ...state, axes, log, next: pick.i };
}

export interface ValidationEstimate {
  id: ValidationAxisId;
  threshold: number;
  thresholdStandardY: number;
  lo: number;
  hi: number;
  lapse: number;
  trials: number;
  ratio: number;
  label: "confirmado" | "nuevo";
  warn: boolean;
}

export function validationEstimates(state: ValidationState): ValidationEstimate[] {
  return state.axes.map((a) => {
    const e = a.qp.estimate();
    const m = a.qp.marginal();
    const threshold = Math.exp(m.values.reduce((t, v, i) => t + Math.log(v) * m.probs[i], 0));
    const lm = a.qp.marginal(2);
    const lapse = lm.values.reduce((t, v, i) => t + v * lm.probs[i], 0);
    const ratio = threshold / a.original;
    return {
      id: a.id,
      threshold,
      thresholdStandardY: a.original,
      lo: e.lo,
      hi: e.hi,
      lapse,
      trials: a.trials,
      ratio,
      label: e.lo <= a.original && a.original <= e.hi ? "confirmado" : "nuevo",
      warn: ratio < VALIDATION.ratioWarn[0] || ratio > VALIDATION.ratioWarn[1],
    };
  });
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** El umbral validado sustituye al del perfil; el original queda en `thresholdStandardY`. */
export function applyValidation(profile: UmbralProfile, state: ValidationState): UmbralProfile {
  const est = validationEstimates(state);
  const axes = profile.axes.map((a) => {
    const e = est.find((x) => x.id === a.id);
    if (!e) return a;
    return { ...a, threshold: r4(e.threshold), thresholdStandardY: a.threshold, thresholdSource: "validation-3afc" as const };
  });
  const warnings = est.filter((e) => e.warn).map((e) => `ratio-out-of-range ${e.id} ×${Math.round(e.ratio * 100) / 100}`);
  return refitProfile({
    ...profile,
    axes,
    validation: {
      method: "3AFC «elige el distinto entre 3», QUEST+ con γ = 1/3 fija y lapse estimada, prior log-normal en el umbral del perfil (σ = ln 2)",
      pairLuminance: { source: "measured", weights: [state.weights[0], state.weights[1], state.weights[2]] },
      gamma: Math.round(VALIDATION.gamma * 1e4) / 1e4,
      axes: est.map((e) => ({ id: e.id, threshold: r4(e.threshold), thresholdStandardY: e.thresholdStandardY, lo: r4(e.lo), hi: r4(e.hi), lapse: Math.round(e.lapse * 1000) / 1000, trials: e.trials, ratio: Math.round(e.ratio * 100) / 100, label: r4(e.lo) <= e.thresholdStandardY && e.thresholdStandardY <= r4(e.hi) ? ("confirmado" as const) : ("nuevo" as const) })),
      ...(warnings.length ? { warnings } : {}),
      trials: state.log,
    },
  });
}
