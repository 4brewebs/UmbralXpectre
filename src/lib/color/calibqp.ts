/**
 * QUEST+ por eje para la calibración (paso 6 de PLAN-questplus.md), detrás de `?qp=1`.
 *
 * Decisión 3 de Colorado: 2AFC con γ = 0,5 (Watson 2017, §2; jsQuestPlus README, ejemplo 2AFC).
 * Este módulo es solo el motor por eje: la UI actual de calibración es "igual / distinto"
 * (sí/no) y NO se cambia aquí; cablear 2AFC exige una tarea nueva (pregunta abierta).
 *
 * Dominio: paso s en sRGB lineal (mismas unidades que session.ts), rejilla logarítmica.
 * Weibull ψ = γ + (1−γ−λ)(1−exp(−(s/α)^β)).
 */

import { createQuestPlus, grid, weibull2afc, type JsQuest, type QuestPlus } from "./questplus";
import { ABS_CLOSE } from "./session";

export const QP_CALIB = {
  gamma: 0.5,
  /** PROVISIONAL: pendientes nominales. */
  betas: [2, 3.5, 6],
  lapses: [0.02, 0.035, 0.05],
  /** Umbral normal esperado (centro del prior log-normal). PROVISIONAL. */
  priorCenter: 0.03,
  /** σ en ln del prior. PROVISIONAL (amplio para cubrir protan/deutan/tritan). */
  priorSd: 1.5,
  /** Equivalente de "IC < 1 ΔE00": no hay ΔE00 en el código; se usa ABS_CLOSE. PROVISIONAL. */
  stopWidth: ABS_CLOSE,
  maxTrials: 40,
} as const;

export interface AxisQuest {
  qp: QuestPlus;
  maxS: number;
  done: boolean;
}

function logGrid(lo: number, hi: number, n: number): number[] {
  return grid(Math.log(lo), Math.log(hi), n).map((v) => Math.exp(v));
}

export function startAxisQuest(Q: JsQuest, maxS: number): AxisQuest {
  const stim = logGrid(0.004, maxS, 40);
  const alphas = logGrid(0.004, maxS, 40);
  const c = Math.log(QP_CALIB.priorCenter);
  const prior = alphas.map((a) => Math.exp(-0.5 * ((Math.log(a) - c) / QP_CALIB.priorSd) ** 2));
  const qp = createQuestPlus(Q, {
    responses: weibull2afc(QP_CALIB.gamma),
    stim,
    params: [alphas, [...QP_CALIB.betas], [...QP_CALIB.lapses]],
    prior: [prior],
  });
  return { qp, maxS, done: false };
}

/** Siguiente paso s a presentar (mínima entropía esperada). */
export function nextStep(a: AxisQuest): number {
  return a.qp.next();
}

/** `correct`: el observador eligió el intervalo distinto. */
export function answerAxis(a: AxisQuest, s: number, correct: boolean): AxisQuest {
  a.qp.update(s, correct ? 0 : 1);
  const e = a.qp.estimate(0);
  const done = e.hi - e.lo < QP_CALIB.stopWidth || a.qp.trials >= QP_CALIB.maxTrials;
  return { ...a, done };
}

export function axisEstimate(a: AxisQuest) {
  return a.qp.estimate(0);
}
