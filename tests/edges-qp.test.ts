import test from "node:test";
import assert from "node:assert/strict";
import { applyAnswer, startRun, edgeFile, angleForDeltaE, QP_EDGES, type EdgeRun } from "../src/lib/color/edges";
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
function simulate(run: EdgeRun, edge: number, seed: number, catchNone = 0): EdgeRun {
  const r = rng(seed);
  for (let i = 0; i < 200 && run.phase !== "done" && run.phase !== "confirm"; i++) {
    let p: number;
    if (run.catchTrial) p = r() < catchNone ? 0 : 0.97;
    else if (run.phase === "depth") p = 0.9;
    else p = weibull(Math.abs(run.angle - run.peak), edge, 3.5, 0, 0);
    // Observador honesto: si no detecta, «ninguno»; lapsus del 3 % como elección al azar.
    const seen = r() < p;
    const lapse = r() < 0.03;
    const pick = lapse ? Math.floor(r() * 4) : seen ? run.oddIndex : -1;
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
  QP_EDGES.fixedSlope = true;
  console.log(`bordes sesgo: marginal ${(100 * out.marginal.bias).toFixed(1)}% (${out.marginal.n.toFixed(1)} ens), fijo ${(100 * out.fijo.bias).toFixed(1)}% (${out.fijo.n.toFixed(1)} ens)`);
  // Regla de Colorado: β fijo solo si su sesgo < 3 %; si no, se marginaliza.
  assert.equal(QP_EDGES.fixedSlope, Math.abs(out.fijo.bias) < 0.03);
});

test("bordes: 1 ΔE00 a ángulo de tono por bisección", async () => {
  const { deltaE00Linear } = await import("../src/lib/color/deltaE");
  const { dirFromTheta, addScaled, ANCHOR } = await import("../src/lib/color/space");
  const g: [number, number, number] = [ANCHOR, ANCHOR, ANCHOR];
  for (const peak of [0, -120, 100]) for (const sign of [1, -1] as const) {
    const t = angleForDeltaE(peak, 0.04, sign, 1);
    const ref = addScaled(g, dirFromTheta((peak * Math.PI) / 180), 0.04);
    const de = deltaE00Linear(ref, addScaled(g, dirFromTheta(((peak + sign * t) * Math.PI) / 180), 0.04));
    assert.ok(Math.abs(de - 1) < 1e-6, `${peak} ${sign}: ${de}`);
  }
});

test("bordes: catch obvios; > 25 % «ninguno» marca la ronda como no fiable", async () => {
  const Q = await loadQuestPlus();
  // Con la parada en ΔE00 hay pocos ensayos QUEST+ por ronda; se juntan varias semillas.
  let shown = 0;
  let goodFlag = 0;
  let badFlag = 0;
  let badRuns = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const good = edgeFile(simulate(startRun({ ...base, seed, questPlus: Q }), 9, seed, 0));
    const bad = edgeFile(simulate(startRun({ ...base, seed, questPlus: Q }), 9, seed, 0.6));
    shown += good.reliability!.catches;
    if (good.reliability!.unreliable) goodFlag++;
    if (bad.reliability!.catches > 0) {
      badRuns++;
      if (bad.reliability!.unreliable) badFlag++;
    }
    if (seed === 1) assert.ok(good.trials.some((t) => t.catch) || good.reliability!.catches === 0);
  }
  assert.ok(shown >= 5, `catch mostrados ${shown}`);
  assert.equal(goodFlag, 0);
  assert.ok(badRuns > 0 && badFlag / badRuns >= 0.5, `${badFlag}/${badRuns}`);
  assert.equal(edgeFile(simulate(startRun({ ...base, seed: 3 }), 9, 3)).reliability, undefined);
});

test("bordes: el catch obvio añade ≥ 20 % de Y al disco distinto; fuera de catch, igual que discEnds", async () => {
  const { discsOf, discEnds } = await import("../src/lib/color/edges");
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const Y = (rgb: number[]) => 0.2126729 * lin(rgb[0]) + 0.7151522 * lin(rgb[1]) + 0.072175 * lin(rgb[2]);
  for (const angle of [0, 90, -120, 150]) for (const oddSign of [1, -1] as const) {
    const run = { angle, scale: 0.04, oddIndex: 2, oddSign, catchTrial: false };
    const plain = discsOf(run);
    const e = discEnds(angle, 0.04);
    assert.deepEqual(plain[2], oddSign > 0 ? e.positive : e.negative);
    assert.deepEqual(plain[0], oddSign > 0 ? e.negative : e.positive);
    const c = discsOf({ ...run, catchTrial: true });
    assert.ok(Y(c[2]) / Y(c[0]) >= 1.2, `${angle} ${oddSign}: ${(Y(c[2]) / Y(c[0])).toFixed(3)}`);
  }
});
