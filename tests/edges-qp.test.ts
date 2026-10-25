import test from "node:test";
import assert from "node:assert/strict";
import { applyAnswer, startRun, edgeFile, QP_EDGES, type EdgeRun } from "../src/lib/color/edges";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Observador: ve el disco distinto con Weibull en |ángulo − pico| (borde `edge`°), γ = 1/4. */
function simulate(run: EdgeRun, edge: number, seed: number): EdgeRun {
  const r = rng(seed);
  for (let i = 0; i < 200 && run.phase !== "done" && run.phase !== "confirm"; i++) {
    let p: number;
    if (run.phase === "depth") p = 0.9;
    else p = weibull(Math.abs(run.angle - run.peak), edge, 3.5, 0, 0.03);
    const seen = r() < p;
    const pick = seen ? run.oddIndex : r() < 0.5 ? -1 : (run.oddIndex + 1) % 4;
    run = applyAnswer(run, pick < 0 ? { picked: [], none: true } : { picked: [pick], none: false });
  }
  return run;
}

const base = { cone: "l" as const, peakDeg: 0, floor: 0.02, sourceThreshold: 0.05, sourceTimes: null, profileSchema: "x", profileCreatedAt: "y" };

test("bordes: QUEST+ tras el bracketing estima el borde (y se compara con la escalera)", async () => {
  const Q = await loadQuestPlus();
  let hitsQ = 0;
  let hitsS = 0;
  let nQ = 0;
  let nS = 0;
  const N = 20;
  for (let seed = 1; seed <= N; seed++) {
    const q = simulate(startRun({ ...base, seed, questPlus: Q }), 9, seed);
    const s = simulate(startRun({ ...base, seed }), 9, seed);
    const fq = edgeFile(q);
    const fs = edgeFile(s);
    const eq = fq.minus.angleDeg;
    const es = fs.minus.angleDeg;
    if (eq != null && Math.abs(Math.abs(eq) - 9) <= 3) hitsQ++;
    if (es != null && Math.abs(Math.abs(es) - 9) <= 3) hitsS++;
    nQ += q.trials.length;
    nS += s.trials.length;
  }
  console.log(`bordes: QUEST+ ${hitsQ}/${N} en ±3°, ${(nQ / N).toFixed(1)} ensayos; escalera ${hitsS}/${N}, ${(nS / N).toFixed(1)}`);
  assert.ok(hitsQ >= hitsS - 2, `${hitsQ} vs ${hitsS}`);
  assert.ok(hitsQ >= N * 0.7);
});

test("bordes: sin flag, la escalera no cambia", () => {
  const r = startRun({ ...base, seed: 7 });
  assert.equal(r.questPlus, undefined);
});

test("bordes: sesgo con β fijo frente a β marginal", async () => {
  const Q = await loadQuestPlus();
  const out: Record<string, { bias: number; n: number }> = {};
  for (const fixed of [false, true]) {
    QP_EDGES.fixedSlope = fixed;
    let b = 0;
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const q = simulate(startRun({ ...base, seed, questPlus: Q }), 9, seed);
      const e = edgeFile(q).minus.angleDeg;
      if (e != null) b += Math.log(Math.abs(e) / 9);
      n += q.trials.length;
    }
    out[fixed ? "fijo" : "marginal"] = { bias: Math.exp(b / 20) - 1, n: n / 20 };
  }
  QP_EDGES.fixedSlope = false;
  console.log(`bordes sesgo: marginal ${(100 * out.marginal.bias).toFixed(1)}% (${out.marginal.n.toFixed(1)} ens), fijo ${(100 * out.fijo.bias).toFixed(1)}% (${out.fijo.n.toFixed(1)} ens)`);
  // Regla de Colorado: β fijo solo si su sesgo < 3 %; si no, se marginaliza.
  assert.equal(QP_EDGES.fixedSlope, Math.abs(out.fijo.bias) < 0.03);
});
