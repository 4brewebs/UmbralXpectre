import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuestPlus, grid, loadQuestPlus, motion3, weibull, weibull2afc } from "../src/lib/color/questplus.ts";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function draw(ps: number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < ps.length; i++) if ((acc += ps[i]) >= u) return i;
  return ps.length - 1;
}

test("Weibull de Watson: γ en 0, γ+(1−γ−λ)(1−e⁻¹) en α", () => {
  assert.equal(weibull(0, 1, 3, 0.5, 0.02), 0.5);
  assert.ok(Math.abs(weibull(1, 1, 3, 0.5, 0.02) - (0.5 + 0.48 * (1 - Math.exp(-1)))) < 1e-12);
});

test("modelo de 3 respuestas: suma 1, «quieto» máximo en el nulo", () => {
  const [d, s, u] = motion3();
  for (const x of grid(-1, 1, 41)) {
    const t = d(x, 0, 8, 0.05, 0.03) + s(x, 0, 8, 0.05, 0.03) + u(x, 0, 8, 0.05, 0.03);
    assert.ok(Math.abs(t - 1) < 1e-12);
    assert.ok(s(x, 0, 8, 0.05, 0.03) <= s(0, 0, 8, 0.05, 0.03) + 1e-12);
  }
});

test("2AFC: converge al umbral simulado (≥ 90 % de 50 semillas dentro del IC)", async () => {
  const Q = await loadQuestPlus();
  const stim = grid(0.02, 1, 50);
  const alphas = grid(0.05, 0.8, 31);
  let hits = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const r = rng(seed);
    const qp = createQuestPlus(Q, { stim, params: [alphas, [2, 3.5, 5], [0.02, 0.035, 0.05]], responses: weibull2afc(0.5) });
    for (let i = 0; i < 40; i++) {
      const x = qp.next();
      qp.update(x, r() < weibull(x, 0.3, 3.5, 0.5, 0.03) ? 0 : 1);
    }
    const e = qp.estimate();
    if (e.lo - 0.03 <= 0.3 && 0.3 <= e.hi + 0.03) hits++;
  }
  assert.ok(hits >= 45, `${hits}/50`);
});

test("3 respuestas: estima el punto nulo con β, δ y λ marginalizados", async () => {
  const Q = await loadQuestPlus();
  const stim = grid(-0.5, 0.5, 51);
  const mus = grid(-0.4, 0.4, 41);
  const fns = motion3();
  let hits = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const qp = createQuestPlus(Q, { stim, params: [mus, [10, 20, 40], [0.01, 0.03, 0.06], [0.02, 0.05]], responses: fns });
    for (let i = 0; i < 40; i++) {
      const x = qp.next();
      qp.update(x, draw(fns.map((f) => f(x, 0.12, 20, 0.03, 0.03)), r()));
    }
    const e = qp.estimate();
    if (Math.abs(e.mean - 0.12) < 0.05) hits++;
  }
  assert.ok(hits >= 18, `${hits}/20`);
});
