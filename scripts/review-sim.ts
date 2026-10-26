/** Simulación del repaso: error en ln(umbral) frente a ensayos por eje. `tsx scripts/review-sim.ts` */
import { createQuestPlus, loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { REVIEW } from "../src/lib/color/review";

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const Q = await loadQuestPlus();
const t0 = 0.03;
const alphas = Array.from({ length: REVIEW.points }, (_, i) => t0 / REVIEW.span * Math.exp((2 * Math.log(REVIEW.span) * i) / (REVIEW.points - 1)));
const prior = alphas.map((v) => Math.exp(-(Math.log(v / t0) ** 2) / (2 * REVIEW.priorSigma ** 2)));
const yes = (x: number, a: number, b: number, l: number) => weibull(x, a, b, REVIEW.gamma, l);
const Ns = [4, 6, 8, 10, 12, 16, 20, 30];
const ratios = [0.6, 0.8, 1, 1.25, 1.6];
const runs = 60;
console.log("N\tRMS ln err\tmediana |err| %\tp90 |err| %");
for (const N of Ns) {
  const errs: number[] = [];
  for (const k of ratios) for (let r = 0; r < runs; r++) {
    const rand = rng(r * 977 + Math.round(k * 100));
    const qp = createQuestPlus(Q, { stim: alphas, params: [alphas, [REVIEW.beta], [...REVIEW.lapses]], prior: [prior], responses: [yes, (x, a, b, l) => 1 - yes(x, a, b, l)] });
    for (let i = 0; i < N; i++) { const x = qp.next(); qp.update(x, rand() < weibull(x, t0 * k, 3, 0.05, 0.03) ? 0 : 1); }
    const m = qp.marginal(); const est = Math.exp(m.values.reduce((t, v, i) => t + Math.log(v) * m.probs[i], 0));
    errs.push(Math.log(est / (t0 * k)));
  }
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const rms = Math.sqrt(errs.reduce((t, e) => t + e * e, 0) / errs.length);
  console.log(`${N}\t${rms.toFixed(3)}\t\t${((Math.exp(abs[Math.floor(abs.length / 2)]) - 1) * 100).toFixed(0)}\t\t${((Math.exp(abs[Math.floor(abs.length * 0.9)]) - 1) * 100).toFixed(0)}`);
}
console.log(`(sin datos, el prior da RMS ≈ ${Math.sqrt(ratios.reduce((t, k) => t + Math.log(k) ** 2, 0) / ratios.length).toFixed(3)})`);
