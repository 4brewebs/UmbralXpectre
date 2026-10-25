import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { predictedLumWeights, predictedMatch, predictedGain, shiftedCone, typeFromProfile, lmsOf } from "../src/lib/color/cones";
import { Y_COEF, type Vec3 } from "../src/lib/color/space";

const gray: Vec3 = [0.2, 0.2, 0.2];

test("L + M de Smith-Pokorny = Y", () => {
  for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, 0.5, 0.1]] as Vec3[]) {
    const [l, m] = lmsOf(c);
    const y = Y_COEF[0] * c[0] + Y_COEF[1] * c[1] + Y_COEF[2] * c[2];
    assert.ok(Math.abs(l + m - y) < 2e-4);
  }
});

test("observador normal ≈ Y_COEF y razón 1", () => {
  const w = predictedLumWeights("normal");
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(w[i] - Y_COEF[i]) < 1e-3);
  assert.ok(Math.abs(predictedMatch([1, 0, 0], gray, w) - 1) < 1e-3);
  assert.deepEqual(shiftedCone("protan", 0).coef.map((v) => Math.round(v * 1000) / 1000), [1, 0]);
});

test("protán severo: #FF0000 a 0.46–0.57× del gris", () => {
  const w = predictedLumWeights("protan", 1);
  const m = predictedMatch([1, 0, 0], gray, w);
  assert.ok(m >= 0.46 && m <= 0.57, `match ${m}`);
  assert.ok(Math.abs(predictedGain([1, 0, 0], gray, w) * m - 1) < 1e-9);
  assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-9);
});

test("monotonía y deután/tritán", () => {
  const m = (s: number) => predictedMatch([1, 0, 0], gray, predictedLumWeights("protan", s));
  assert.ok(m(0) > m(0.5) && m(0.5) > m(1));
  const d = predictedMatch([1, 0, 0], gray, predictedLumWeights("deutan", 1));
  assert.ok(d > 1 && d < 1.4);
  const t = predictedLumWeights("tritan", 1);
  assert.ok(Math.abs(t[0] - Y_COEF[0]) < 1e-3);
});

test("tipo desde el perfil de referencia", () => {
  const p = JSON.parse(fs.readFileSync(new URL("./fixtures/perfil_56KB.json", import.meta.url), "utf8"));
  assert.equal(typeFromProfile(p), "protan");
  assert.equal(typeFromProfile({ fit: { ...p.fit, pathways: [] } }), "normal");
});
