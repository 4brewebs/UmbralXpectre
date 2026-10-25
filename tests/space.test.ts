import { test } from "node:test";
import assert from "node:assert/strict";
import { killLuminance, luminance, Y_COEF, type Vec3 } from "../src/lib/color/space";

const samples: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.22, 0.22, 0.22],
  [0.3, 0.1, 0.7],
];

test("luminance sin w = Y estándar (sin cambio)", () => {
  for (const c of samples) {
    const expected = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
    assert.equal(luminance(c), expected);
    assert.equal(luminance(c, Y_COEF), expected);
  }
});

test("killLuminance sin w idéntico al anterior", () => {
  for (const c of samples) {
    const y = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
    assert.deepEqual(killLuminance(c), [c[0] - y, c[1] - y, c[2] - y]);
  }
});

test("pesos personales", () => {
  const w: Vec3 = [0.1, 0.8, 0.1];
  assert.ok(Math.abs(luminance([1, 0, 0], w) - 0.1) < 1e-12);
  // con pesos que suman 1, killLuminance(·, w) deja luminancia_w 0
  for (const c of samples) assert.ok(Math.abs(luminance(killLuminance(c, w), w)) < 1e-12);
});
