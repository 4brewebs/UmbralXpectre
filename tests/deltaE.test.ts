import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ciede2000, labOfLinear, deltaE00Linear, type Lab } from "../src/lib/color/deltaE";

// Datos: tabla 1 de Sharma et al. (2005), transcrita de github.com/gfiumara/CIEDE2000 (testCIEDE2000.cpp).
const pairs = JSON.parse(fs.readFileSync(new URL("./fixtures/sharma2005.json", import.meta.url), "utf8")) as Array<[Lab, Lab, number]>;

test("CIEDE2000: 34 pares de Sharma, Wu & Dalal (2005) a 4 decimales", () => {
  assert.equal(pairs.length, 34);
  pairs.forEach(([a, b, e], i) => {
    assert.equal(ciede2000(a, b).toFixed(4), e.toFixed(4), `par ${i + 1}`);
    assert.equal(ciede2000(b, a).toFixed(4), e.toFixed(4), `par ${i + 1} simétrico`);
  });
});

test("Lab: blanco D65 → (100, 0, 0); gris idéntico → ΔE00 0", () => {
  const w = labOfLinear([1, 1, 1]);
  assert.ok(Math.abs(w[0] - 100) < 1e-3 && Math.abs(w[1]) < 1e-2 && Math.abs(w[2]) < 1e-2);
  assert.equal(deltaE00Linear([0.2, 0.2, 0.2], [0.2, 0.2, 0.2]), 0);
});
