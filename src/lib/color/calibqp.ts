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
  deMin: 0.1,
  /**
   * Techo de la rejilla de α (Colorado, 6.ª ronda): muy por encima del alcance del gamut (~9 ΔE00 en l y rojo
   * extremo), para que el posterior no se amontone en el último punto. Los estímulos siguen cortados al alcance.
   */
  deMax: 60,
  /** Mismo paso logarítmico que la rejilla antigua (40 puntos en 0,1–10). */
  points: 56,
  /** Masa del posterior por encima del estímulo más alto posible que impide la parada relativa. */
  pinnedMass: 0.05,
  /** Con ≥ este número de ensayos y la mitad de la masa fuera de alcance: «al menos» el alcance (límite del gamut). */
  gamutMinTrials: 10,
  gamutMass: 0.5,
  beta: 3,
  lapses: [0.02, 0.035, 0.05],
  gammaMin: 0.02,
  gammaMax: 0.3,
  /** Catch necesarios antes de usar su tasa de falsas alarmas. */
  minCatches: 5,
  /** γ antes de tener 5 catch. PROVISIONAL. */
  gammaDefault: 0.05,
  /**
   * Parada relativa en escala log (Colorado, 5.ª ronda): IC 95 % de ln(α) con anchura ln(hi/lo) < ln 1,5, o 36 ensayos
   * por eje. Sustituye al criterio absoluto de 1 ΔE00 (que con umbrales ~1,5 ΔE00 paraba demasiado pronto). Bordes no cambia.
   */
  stopLogWidth: Math.log(1.5),
  maxTrials: 36,
  /** Tope de ensayos por sesión con QUEST+ (Colorado); lo que falte sigue en otra sesión. */
  sessionCap: 60,
  /**
   * Parada antes en ejes no elevados (Colorado, 6.ª ronda): si el IC entero queda por debajo de 1,6× el control,
   * basta una anchura ln 2,2 con ≥ 8 ensayos. El número exacto no cambia ningún filtro.
   */
  relaxedLogWidth: Math.log(2.2),
  relaxedMinTrials: 8,
  /** Catch 1 de cada 8–10 ensayos; mitad pares idénticos, mitad pares obvios (+20 % de Y). */
  catchMin: 8,
  catchMax: 10,
  obviousLum: 1.2,
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
  /** Masa del posterior por encima del alcance del gamut (α que no se puede probar en esta pantalla). */
  beyondReach: number;
  /** Terminado (o a terminar) como «al menos el alcance»: resultado válido, no un fallo. */
  bound: "gamut-limit" | null;
  /** ΔE00 del siguiente par. */
  nextDe: number;
  estimate: { mean: number; lo: number; hi: number; width: number };
}

/** Anchura del IC 95 % en ln ΔE00: ln(hi/lo). */
export function logWidth(e: { lo: number; hi: number }): number {
  return e.lo > 0 ? Math.log(e.hi / e.lo) : Infinity;
}

export function stepAxis(Q: JsQuest, deReach: number, gamma: number, log: QpLog, relaxed = false): AxisQpResult {
  const qp = rebuild(Q, deReach, gamma, log);
  const estimate = qp.estimate(0);
  const m = qp.marginal(0);
  const top = Math.min(QP_CALIB.deMax, deReach);
  let beyondReach = 0;
  for (let i = 0; i < m.values.length; i++) if (m.values[i] > top + 1e-9) beyondReach += m.probs[i];
  // Nunca para por anchura con > 5 % fuera de alcance: ese IC lo estrecha el techo, no los datos.
  const pinned = beyondReach > QP_CALIB.pinnedMass;
  const width = logWidth(estimate);
  const narrow =
    !pinned && (width < QP_CALIB.stopLogWidth || (relaxed && log.length >= QP_CALIB.relaxedMinTrials && width < QP_CALIB.relaxedLogWidth));
  const gamut = pinned && log.length >= QP_CALIB.gamutMinTrials && beyondReach >= QP_CALIB.gamutMass;
  const capped = log.length >= QP_CALIB.maxTrials;
  const done = log.length > 0 && (narrow || gamut || capped);
  return { done, nextDe: qp.next(), estimate, beyondReach, bound: pinned && (gamut || capped) ? "gamut-limit" : null };
}

/** Posterior marginal de α (ΔE00) del eje, para guardarlo y mostrarlo. */
export function posteriorOf(Q: JsQuest, deReach: number, gamma: number, log: QpLog): { alphas: number[]; probs: number[] } {
  const m = rebuild(Q, deReach, gamma, log).marginal(0);
  return { alphas: m.values, probs: m.probs };
}

/** Entropía (nats) del posterior marginal de α: el eje con más incertidumbre recibe el siguiente ensayo. */
const entropyCache = new WeakMap<QpLog, { reach: number; gamma: number; h: number }>();

export function entropyOf(Q: JsQuest, deReach: number, gamma: number, log: QpLog): number {
  const hit = entropyCache.get(log);
  if (hit && hit.reach === deReach && hit.gamma === gamma) return hit.h;
  const h = entropyRaw(Q, deReach, gamma, log);
  entropyCache.set(log, { reach: deReach, gamma, h });
  return h;
}

function entropyRaw(Q: JsQuest, deReach: number, gamma: number, log: QpLog): number {
  const { probs } = rebuild(Q, deReach, gamma, log).marginal(0);
  let h = 0;
  for (const p of probs) if (p > 0) h -= p * Math.log(p);
  return h;
}
