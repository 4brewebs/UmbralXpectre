/**
 * QUEST+ por eje para la calibración (PLAN-questplus paso 6), detrás de `?qp=1`.
 *
 * Provisional (Colorado): se mantiene la tarea sí/no («igual / distinto») con los mismos pares y
 * catch. Modelo de Watson (2017) para sí/no: P(«distinto») = γ + (1−γ−λ)(1 − e^−(x/α)^β), con
 * γ = tasa de falsas alarmas en los catch (pares idénticos) acotada a [0,02, 0,3] cuando hay ≥ 5.
 * x = ΔE00 entre los dos colores del par (CIEDE2000 real, `deltaE.ts`).
 * Prior uniforme en log ΔE00 entre 0,3 y 10; β = 3 fijo; λ marginalizado.
 * Como γ cambia con los catch, el posterior se reconstruye repitiendo los ensayos del eje.
 * Futuro (TODO): 2AFC «qué par es distinto» con γ = 0,5.
 */

import { createQuestPlus, grid, weibull, type JsQuest, type QuestPlus, type ResponseFn } from "./questplus";
import { deltaE00Linear } from "./deltaE";
import { ANCHOR, addScaled, dirFromTheta, type Vec3 } from "./space";

export const QP_CALIB = {
  deMin: 0.3,
  deMax: 10,
  points: 40,
  beta: 3,
  lapses: [0.02, 0.035, 0.05],
  gammaMin: 0.02,
  gammaMax: 0.3,
  /** Catch necesarios antes de usar su tasa de falsas alarmas. */
  minCatches: 5,
  /** γ antes de tener 5 catch. PROVISIONAL. */
  gammaDefault: 0.05,
  /** Parada: IC 95 % de α con anchura < 1 ΔE00, o 30 ensayos por eje (máximo PROVISIONAL, igual que movimiento). */
  stopDeltaE: 1,
  maxTrials: 30,
} as const;

export function yesNo(gamma: number): ResponseFn[] {
  const yes: ResponseFn = (x, a, b, l) => weibull(x, a, b, gamma, l);
  return [yes, (x, a, b, l) => 1 - yes(x, a, b, l)];
}

/** γ = falsas alarmas / catch, acotada; `gammaDefault` con menos de 5 catch. */
export function gammaOf(catches: number, falseAlarms: number): number {
  if (catches < QP_CALIB.minCatches) return QP_CALIB.gammaDefault;
  return Math.min(QP_CALIB.gammaMax, Math.max(QP_CALIB.gammaMin, falseAlarms / catches));
}

const gray = (): Vec3 => [ANCHOR, ANCHOR, ANCHOR];

/** ΔE00 del par gris ± dir(θ)·s que muestra la sesión. */
export function pairDeltaE(theta: number, s: number): number {
  const d = dirFromTheta(theta);
  return deltaE00Linear(addScaled(gray(), d, -s), addScaled(gray(), d, s));
}

/** Paso s con ΔE00 del par = target, por bisección en [0, maxS]. */
export function stepForDeltaE(theta: number, target: number, maxS: number): number {
  if (pairDeltaE(theta, maxS) <= target) return maxS;
  let lo = 0;
  let hi = maxS;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (pairDeltaE(theta, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function logGrid(lo: number, hi: number, n: number): number[] {
  return grid(Math.log(lo), Math.log(hi), n).map((v) => Math.exp(v));
}

export type QpLog = Array<[number, 0 | 1]>;

/** Reconstruye el QUEST+ del eje con la γ actual y repite sus ensayos (0 = «distinto», 1 = «igual»). */
export function rebuild(Q: JsQuest, deReach: number, gamma: number, log: QpLog): QuestPlus {
  const alphas = logGrid(QP_CALIB.deMin, QP_CALIB.deMax, QP_CALIB.points);
  const top = Math.min(QP_CALIB.deMax, deReach);
  const stim = alphas.filter((a) => a <= top + 1e-9);
  const qp = createQuestPlus(Q, {
    responses: yesNo(gamma),
    stim: stim.length ? stim : [alphas[0]],
    params: [alphas, [QP_CALIB.beta], [...QP_CALIB.lapses]],
  });
  for (const [x, r] of log) qp.update(x, r);
  return qp;
}

export interface AxisQpResult {
  done: boolean;
  /** ΔE00 del siguiente par. */
  nextDe: number;
  estimate: { mean: number; lo: number; hi: number; width: number };
}

export function stepAxis(Q: JsQuest, deReach: number, gamma: number, log: QpLog): AxisQpResult {
  const qp = rebuild(Q, deReach, gamma, log);
  const estimate = qp.estimate(0);
  const done = log.length > 0 && (estimate.width < QP_CALIB.stopDeltaE || log.length >= QP_CALIB.maxTrials);
  return { done, nextDe: qp.next(), estimate };
}
