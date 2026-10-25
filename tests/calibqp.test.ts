import test from "node:test";
import assert from "node:assert/strict";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { answerAxis, axisEstimate, nextStep, startAxisQuest } from "../src/lib/color/calibqp";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Umbrales de eje simulados (sRGB lineal): normal ~0,03; eje afectado mucho más alto.
const observers: Record<string, number> = { normal: 0.03, protan: 0.25, deutan: 0.18, tritan: 0.12 };

for (const [name, alpha] of Object.entries(observers)) {
  test(`calibración QUEST+ 2AFC converge: ${name}`, async () => {
    const Q = await loadQuestPlus();
    let ok = 0;
    let n = 0;
    const N = 6;
    for (let seed = 1; seed <= N; seed++) {
      const r = rng(seed * 31);
      let a = startAxisQuest(Q, 0.6);
      while (!a.done) {
        const s = nextStep(a);
        a = answerAxis(a, s, r() < weibull(s, alpha, 3.5, 0.5, 0.03));
      }
      const e = axisEstimate(a);
      if (Math.abs(Math.log(e.mean / alpha)) < Math.log(1.35)) ok++;
      n += a.qp.trials;
    }
    console.log(`calib ${name}: ${ok}/${N} dentro de ×1,35, ${(n / N).toFixed(1)} ensayos`);
    assert.ok(ok >= N - 1);
  });
}
