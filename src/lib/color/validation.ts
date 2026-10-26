/**
 * Validación 3AFC con los pesos personales (sustituye al repaso sí/no tras la luminancia).
 *
 * Mide los ejes que el perfil (escalera) marcó como conflictivos (`validationTargets`), no fijo en l y m.
 * Disco en 3 sectores de 120°, orientación y sector distinto al azar en cada ensayo: dos sectores iguales
 * (gris − s·dir) y uno distinto (gris + s·dir), los tres con la misma Y con los pesos medidos (`isoDir`), sin ruido.
 * Se responde tocando un sector (sin «ninguno» ni «iguales»). QUEST+ con γ = 1/3 fija y lapse estimada.
 * Prior log-normal centrado en el umbral del perfil (σ = ln 2). Parada por precisión (IC 95 % en ln), con tope.
 * El umbral validado sustituye al del perfil (filtros y `fit`); el original queda en `thresholdStandardY`.
 * «confirmado» si el original cae dentro del IC 95 %; razón fuera de [½, 2]: solo aviso.
 */
import { createQuestPlus, weibull, type JsQuest, type QuestPlus, type ResponseFn } from "./questplus";
import { ANCHOR, addScaled, dirFromTheta, isoDir, maxScale, measuredLumWeights, toSrgb8, type Vec3 } from "./space";
import { refitProfile, type UmbralProfile } from "./profile";
import { nextRotation } from "./wheel";

export const VALIDATION = {
  /** Parada por eje: IC 95 % de α con ln(hi/lo) < stopLogWidth, tras minTrials. */
  stopLogWidth: Math.log(2),
  minTrials: 6,
  /** Tope de seguridad por eje. */
  maxTrials: 30,
  /** Como mucho estos ejes conflictivos (los de mayor razón frente al control). */
  maxAxes: 4,
  /** Conflictivo: umbral ≥ esto × control (como `elevated` del perfil). */
  elevatedRatio: 1.6,
  /** Rejilla de α en log: umbral del perfil ×/÷ 4, 41 puntos. */
  span: 4,
  points: 41,
  priorSigma: Math.log(2),
  beta: 3,
  /** Azar de «elige el distinto entre 3». Fija. */
  gamma: 1 / 3,
  /** Rejilla de lapse (se estima marginalizando). */
  lapses: [0, 0.02, 0.04, 0.07, 0.1],
  ratioWarn: [0.5, 2] as const,
  choices: 3,
} as const;

export type ValidationAxisId = string;

export interface ValidationTrial {
  order: number;
  axis: ValidationAxisId;
  scale: number;
  /** Sector distinto (0..2), orientación del disco (°) y sector elegido. */
  odd: number;
  rotationDeg: number;
  /** Incremento con signo respecto al ensayo anterior (0 en el primero). */
  rotationStepDeg: number;
  picked: number;
  correct: boolean;
}

interface ValidationAxis {
  id: ValidationAxisId;
  angleDeg: number;
  original: number;
  qp: QuestPlus;
  trials: number;
  /** Parado por precisión o por tope. */
  done: boolean;
  stop?: "ci" | "cap";
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
  /** Los tres sectores (0..2, en sentido horario desde `rotationDeg`); `odd` es el distinto. */
  fields: [number, number, number][];
  odd: number;
  rotationDeg: number;
  rotationStepDeg: number;
  step: number;
  /** Tope de seguridad (los ejes paran antes por precisión). */
  maxTotal: number;
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

function hash(seed: number, n: number, salt: number): number {
  let t = (seed ^ Math.imul(n + 1, 0x9e3779b1) ^ salt) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return (t ^ (t >>> 16)) >>> 0;
}
/** Sector distinto en el ensayo `n` (determinista con la semilla). */
export function oddPosition(seed: number, n: number): number {
  return hash(seed, n, 0) % VALIDATION.choices;
}
/**
 * Orientación del disco en el ensayo `n` (0–360°) y su incremento con signo respecto al anterior (15–45°, sentido
 * al azar; `nextRotation`). Determinista con la semilla e independiente del sector distinto (otra sal).
 */
export function rotationAt(seed: number, n: number): { rotationDeg: number; stepDeg: number } {
  let r: { rotationDeg: number; stepDeg: number } | null = null;
  for (let i = 0; i <= n; i++) r = nextRotation(r?.rotationDeg ?? null, hash(seed, i, 0x5bd1e995) / 4294967296, hash(seed, i, 0x27d4eb2f) / 4294967296);
  return r!;
}
export const rotationOf = (seed: number, n: number): number => rotationAt(seed, n).rotationDeg;

/**
 * Ejes conflictivos del perfil: los de umbral ≥ 1,6× el control (vías elevadas, extremos y afinados), de mayor a
 * menor razón, como mucho `maxAxes`. Sin ninguno (observador normal): el de mayor razón, para confirmarlo.
 */
export function validationTargets(profile: UmbralProfile): Array<{ id: string; angleDeg: number; threshold: number; ratio: number }> {
  const control = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : (profile.axes.find((a) => a.role === "control")?.threshold ?? 0);
  const all = profile.axes
    .filter((a) => a.role !== "control" && a.threshold != null && a.threshold > 0)
    .map((a) => ({ id: a.id, angleDeg: a.angleDeg, threshold: a.threshold as number, ratio: control > 0 ? (a.threshold as number) / control : 1 }))
    .sort((x, y) => y.ratio - x.ratio);
  const hot = all.filter((a) => a.ratio >= VALIDATION.elevatedRatio).slice(0, VALIDATION.maxAxes);
  return hot.length ? hot : all.slice(0, 1);
}

/** Estado inicial, o null si no hay pesos medidos o el perfil no tiene umbral en l y m. */
export function createValidation(profile: UmbralProfile, Q: JsQuest, opts: { seed?: number } = {}): ValidationState | null {
  const w = measuredLumWeights(profile);
  if (!w) return null;
  const axes: ValidationAxis[] = [];
  for (const target of validationTargets(profile)) {
    const t = target.threshold;
    const top = Math.min(t * VALIDATION.span, reach(target.angleDeg, w));
    const alphas = logGrid(t / VALIDATION.span, t * VALIDATION.span, VALIDATION.points);
    const stim = alphas.filter((v) => v <= top + 1e-12);
    const prior = alphas.map((v) => Math.exp(-(Math.log(v / t) ** 2) / (2 * VALIDATION.priorSigma ** 2)));
    const qp = createQuestPlus(Q, { stim: stim.length ? stim : [alphas[0]], params: [alphas, [VALIDATION.beta], [...VALIDATION.lapses]], prior: [prior], responses: oddity3() });
    axes.push({ id: target.id, angleDeg: target.angleDeg, original: t, qp, trials: 0, done: false });
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
  const rot = rotationAt(state.seed, n);
  return { axis: ax.id, scale: s, fields, odd, rotationDeg: rot.rotationDeg, rotationStepDeg: rot.stepDeg, step: n + 1, maxTotal: state.axes.length * VALIDATION.maxTrials };
}

/** Respuesta: posición elegida (0..2). */
export function answerValidation(state: ValidationState, picked: number): ValidationState {
  const stim = validationStimulus(state);
  if (!stim) return state;
  const correct = picked === stim.odd;
  const log = [...state.log, { order: state.log.length + 1, axis: stim.axis, scale: Math.round(stim.scale * 1e5) / 1e5, odd: stim.odd, rotationDeg: stim.rotationDeg, rotationStepDeg: stim.rotationStepDeg, picked, correct }];
  const axes = state.axes.map((a) => ({ ...a }));
  const ax = axes[state.next];
  ax.qp.update(stim.scale, correct ? 0 : 1);
  ax.trials += 1;
  const e = ax.qp.estimate();
  if (ax.trials >= VALIDATION.minTrials && Math.log(e.hi / e.lo) < VALIDATION.stopLogWidth) Object.assign(ax, { done: true, stop: "ci" });
  else if (ax.trials >= VALIDATION.maxTrials) Object.assign(ax, { done: true, stop: "cap" });
  if (axes.every((a) => a.done)) return { ...state, axes, log, done: true };
  const open = axes.map((a, i) => ({ a, i })).filter(({ a }) => !a.done);
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
  stop: "ci" | "cap" | null;
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
      stop: a.stop ?? null,
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
      method: "3AFC: disco en 3 sectores de 120° (giro de 15–45° en sentido al azar entre ensayos, distinto al azar), ejes conflictivos del perfil, QUEST+ con γ = 1/3 fija y lapse estimada, prior log-normal en el umbral del perfil (σ = ln 2), parada por IC 95 % (ln hi/lo < ln 2, mínimo 6, tope 30 por eje)",
      pairLuminance: { source: "measured", weights: [state.weights[0], state.weights[1], state.weights[2]] },
      gamma: Math.round(VALIDATION.gamma * 1e4) / 1e4,
      axes: est.map((e) => ({ id: e.id, threshold: r4(e.threshold), thresholdStandardY: e.thresholdStandardY, lo: r4(e.lo), hi: r4(e.hi), lapse: Math.round(e.lapse * 1000) / 1000, trials: e.trials, stop: e.stop, ratio: Math.round(e.ratio * 100) / 100, label: r4(e.lo) <= e.thresholdStandardY && e.thresholdStandardY <= r4(e.hi) ? ("confirmado" as const) : ("nuevo" as const) })),
      ...(warnings.length ? { warnings } : {}),
      trials: state.log,
    },
  });
}
