/**
 * Envoltorio tipado de QUEST+ sobre jsQuestPlus vendorizado.
 *
 * Método: Watson, A. B. (2017). QUEST+: A general multidimensional Bayesian adaptive
 * psychometric method. J. Vision 17(3):10, doi:10.1167/17.3.10. Siguiente estímulo =
 * mínimo de la entropía esperada de la posterior; posterior = prior × verosimilitud.
 * Librería: Kuroki & Pronk (2022), Behav. Res. Methods, doi:10.3758/s13428-022-01948-8;
 * API según su README/demos: `new jsQuestPlus({psych_func, stim_samples, psych_samples, priors})`,
 * `getStimParams()`, `update(stim, resp)`, `normalized_posteriors`, `comb_PF_params`.
 * Más de 2 respuestas: una función por respuesta en `psych_func` (respuestas 0..n−1).
 *
 * La librería se carga perezosamente (`import()`) para no engordar el bundle inicial.
 */
import type jsquest from "@/vendor/jsquestplus/jsQuestPlus.module.js";

export type JsQuest = typeof jsquest;
/** P(respuesta | estímulo x, parámetros...). */
export type ResponseFn = (x: number, ...params: number[]) => number;

let loaded: Promise<JsQuest> | null = null;
export function loadQuestPlus(): Promise<JsQuest> {
  loaded ??= import("@/vendor/jsquestplus/jsQuestPlus.module.js").then((m) => m.default);
  return loaded;
}

/**
 * Weibull de Watson (2017, ec. de §«Psychometric function», forma lineal):
 * ψ(x) = γ + (1 − γ − λ)·(1 − exp(−(x/α)^β)), x > 0.
 */
export function weibull(x: number, alpha: number, beta: number, gamma: number, lambda: number): number {
  if (x <= 0) return gamma;
  return gamma + (1 - gamma - lambda) * (1 - Math.exp(-Math.pow(x / alpha, beta)));
}

/** 2AFC con la Weibull: respuesta 0 = correcta, 1 = incorrecta. */
export function weibull2afc(gamma = 0.5): ResponseFn[] {
  const c: ResponseFn = (x, a, b, l) => weibull(x, a, b, gamma, l);
  return [c, (x, a, b, l) => 1 - c(x, a, b, l)];
}

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Modelo de 3 respuestas para el mínimo de movimiento (decisión 4 de Colorado, PLAN §8.4).
 * x = log(e_estímulo), μ = log(e_nulo), β = pendiente, δ = semiancho de la banda «quieto», λ = lapse
 * (repartido por igual entre las 3 respuestas).
 * 0 = «más oscuro» (movimiento hacia el lado del gris), 1 = «quieto», 2 = «más claro».
 * P(0) y P(2) son logísticas opuestas centradas en μ∓δ/μ±δ; P(1) es el resto (máximo en μ, ≥ 0 si δ ≥ 0).
 */
export function motion3(): ResponseFn[] {
  const up = (x: number, mu: number, b: number, d: number, l: number) => l / 3 + (1 - l) * logistic(b * (x - mu - d));
  const down = (x: number, mu: number, b: number, d: number, l: number) => l / 3 + (1 - l) * logistic(-b * (x - mu + d));
  return [down, (x, mu, b, d, l) => Math.max(0, 1 - up(x, mu, b, d, l) - down(x, mu, b, d, l)), up];
}

export interface QuestPlusConfig {
  /** Rejilla de estímulos (1 dimensión). */
  stim: number[];
  /** Rejillas de parámetros; el primero es el que se estima, el resto se marginaliza. */
  params: number[][];
  /** Prior por parámetro (misma longitud que su rejilla). Uniforme si falta. */
  prior?: Array<number[] | undefined>;
  responses: ResponseFn[];
}

export interface QuestPlus {
  /** Estímulo de mínima entropía esperada (Watson 2017). */
  next(): number;
  /** Ajusta `x` al punto más cercano de la rejilla y actualiza la posterior. */
  update(x: number, response: number): void;
  /** Marginal de la posterior del parámetro `dim`. */
  marginal(dim?: number): { values: number[]; probs: number[] };
  /** Media posterior e intervalo creíble del 95 % del parámetro `dim`. */
  estimate(dim?: number): { mean: number; lo: number; hi: number; width: number };
  trials: number;
}

function normalize(p: number[]): number[] {
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((v) => v / s);
}

export function createQuestPlus(Q: JsQuest, cfg: QuestPlusConfig): QuestPlus {
  const priors = cfg.params.map((g, i) => normalize(cfg.prior?.[i] ?? g.map(() => 1)));
  const q = new Q({
    psych_func: cfg.responses,
    stim_samples: [cfg.stim],
    psych_samples: cfg.params,
    priors: Q.set_prior(priors),
  });
  const snap = (x: number) => cfg.stim.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), cfg.stim[0]);
  const api: QuestPlus = {
    trials: 0,
    next: () => q.getStimParams() as number,
    update(x, r) {
      q.update(snap(x), r);
      api.trials += 1;
    },
    marginal(dim = 0) {
      const values = cfg.params[dim];
      const probs = values.map(() => 0);
      const post = q.normalized_posteriors;
      q.comb_PF_params.forEach((row, k) => {
        const v = Array.isArray(row) ? row[dim] : row;
        probs[values.indexOf(v)] += post[k];
      });
      return { values, probs };
    },
    estimate(dim = 0) {
      const { values, probs } = api.marginal(dim);
      const mean = values.reduce((a, v, i) => a + v * probs[i], 0);
      let acc = 0;
      let lo = values[0];
      let hi = values[values.length - 1];
      let loSet = false;
      for (let i = 0; i < values.length; i++) {
        acc += probs[i];
        if (!loSet && acc >= 0.025) {
          lo = values[i];
          loSet = true;
        }
        if (acc >= 0.975) {
          hi = values[i];
          break;
        }
      }
      return { mean, lo, hi, width: hi - lo };
    },
  };
  return api;
}

/** Rejilla lineal de n puntos entre a y b. */
export function grid(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}
