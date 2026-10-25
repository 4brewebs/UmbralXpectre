// Tipos mínimos para jsQuestPlus 2.1.0 (API según su README/demos oficiales).
export interface JsQuestSettings {
  /** Una función por respuesta: f(...stim, ...psychParams) → P(respuesta). */
  psych_func: Array<(...args: number[]) => number>;
  stim_samples: number[][];
  psych_samples: number[][];
  priors?: { priors: number[][]; comb_priors: number[]; normalized_priors: number[] };
}
export default class jsquest {
  constructor(settings: JsQuestSettings);
  comb_stim_params: Array<number | number[]>;
  comb_PF_params: number[][];
  normalized_posteriors: number[];
  expected_entropies_by_stim: number[];
  getStimParams(num?: number): number | number[];
  update(stim: number | number[], resp: number): void;
  getEstimates(rule?: "mode" | "mean", roundStimuliToDomain?: boolean): number[];
  getSDs(): number[];
  static set_prior(prior: Array<number[] | number>, normFlag?: boolean): NonNullable<JsQuestSettings["priors"]>;
  static weibull(stim: number, threshold: number, slope: number, guess: number, lapse: number): number;
  static linspace(a: number, b: number, n?: number): number[];
}
