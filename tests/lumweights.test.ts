import test from "node:test";
import assert from "node:assert/strict";
import { solveLumWeights, type BrightnessMatch } from "../src/lib/color/lumweights";
import { predictedLumWeights } from "../src/lib/color/cones";
import { luminance, Y_COEF, type Vec3 } from "../src/lib/color/space";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const gray: Vec3 = [0.1, 0.1, 0.1];
const colors: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0.3, 0], [1, 0, 0.3], [0.2, 0, 1]];

function synth(w: Vec3, noise: number, seed = 1, control?: Vec3): BrightnessMatch[] {
  const r = rng(seed);
  const out: BrightnessMatch[] = colors.map((c) => {
    const t = c.map((v) => (v * luminance(gray)) / luminance(c)) as Vec3;
    const g = luminance(gray, w) / luminance(t, w);
    return { test: t, ref: gray, gain: g * (1 + noise * (r() * 2 - 1)), width: Math.max(0.01, noise * 2) };
  });
  if (control) {
    const t = control.map((v) => (v * luminance(gray)) / luminance(control)) as Vec3;
    out.push({ test: t, ref: gray, gain: luminance(gray, w) / luminance(t, w), width: 0.02, kind: "control" });
  }
  return out;
}

test("recupera pesos protán con ruido 1%", () => {
  const w = predictedLumWeights("protan", 0.7);
  const res = solveLumWeights(synth(w, 0.01, 3), Y_COEF);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(res.weights[i] - w[i]) < 0.02, `${res.weights} vs ${w}`);
  assert.equal(res.source, "measured");
  assert.ok(res.weights[0] + res.weights[1] + res.weights[2] > 0.9999);
});

test("recupera pesos arbitrarios y respeta w ≥ 0", () => {
  const w: Vec3 = [0.3, 0.6, 0.1];
  const res = solveLumWeights(synth(w, 0.005, 7), predictedLumWeights("normal"));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(res.weights[i] - w[i]) < 0.015);
  const edge = solveLumWeights(synth([0.15, 0.85, 0], 0.005, 9), Y_COEF);
  assert.ok(edge.weights.every((v) => v >= 0));
  assert.ok(Number.isFinite(edge.cond));
});

test("sin igualaciones: predicción o estándar", () => {
  assert.equal(solveLumWeights([], [0.1, 0.8, 0.1]).source, "predicted");
  const s = solveLumWeights([], null);
  assert.equal(s.source, "standard");
  s.weights.forEach((v, i) => assert.ok(Math.abs(v - Y_COEF[i]) < 1e-4));
  assert.equal(s.confidence, "low");
});

test("withinNoise para un observador estándar y no para protán", () => {
  assert.equal(solveLumWeights(synth([...Y_COEF] as Vec3, 0.01, 5), Y_COEF).withinNoise, true);
  assert.equal(solveLumWeights(synth(predictedLumWeights("protan", 1), 0.01, 5), Y_COEF).withinNoise, false);
});

test("control fuera de 1 baja la confianza", () => {
  const w = predictedLumWeights("protan", 1);
  const good = solveLumWeights(synth(w, 0.005, 2, [0, 0, 1]), w);
  assert.equal(good.confidence, "high");
  const ms = synth(w, 0.005, 2, [0, 0, 1]);
  ms[ms.length - 1].gain *= 1.4;
  assert.equal(solveLumWeights(ms, w).confidence, "low");
  assert.equal(solveLumWeights(synth(w, 0.005, 2), w, { missedCatches: 1 }).confidence, "low");
});
