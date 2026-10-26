import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { greyOfL, hatchRuns, hatchWeight, HATCH, lossPeak, lossMap, lossPoints, LOSS_RAMP, ratioAt, rampL } from "../src/lib/color/lossmap";
import { spectrumSamples } from "../src/lib/color/spectrum";
import { buildTransformFile } from "../src/lib/color/lut";

const real = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
const sim = JSON.parse(fs.readFileSync(new URL("./fixtures/bordes-simulado-v3-0721Z.json", import.meta.url), "utf8")).runs.map((x: { file: unknown }) => x.file);
const rgbs = spectrumSamples().map((s) => s.rgb);

test("Mapa en grises: rampa log monótona en L*, de 12 (1×) a 85 (pico), sin negro ni blanco puros", () => {
  const peak = 5.4;
  assert.equal(rampL(1, peak), LOSS_RAMP.lMin);
  assert.ok(Math.abs(rampL(peak, peak) - LOSS_RAMP.lMax) < 1e-9);
  // Log: la media geométrica cae en el centro de la rampa.
  assert.ok(Math.abs(rampL(Math.sqrt(peak), peak) - (LOSS_RAMP.lMin + LOSS_RAMP.lMax) / 2) < 1e-9);
  let prev = -Infinity;
  for (let r = 1; r <= peak; r += 0.01) { const l = rampL(r, peak); assert.ok(l >= prev); prev = l; }
  assert.ok(greyOfL(LOSS_RAMP.lMin) > 0 && greyOfL(LOSS_RAMP.lMax) < 255);
});

test("Mapa en grises: entre dos puntos medidos el log del cociente es lineal en ángulo (monótono)", () => {
  const pts = [{ deg: 10, ratio: 1 }, { deg: 50, ratio: 4 }];
  assert.ok(Math.abs(ratioAt(pts, 30) - 2) < 1e-9);
  let prev = 0;
  for (let d = 10; d <= 50; d += 0.5) { const r = ratioAt(pts, d); assert.ok(r >= prev - 1e-12); prev = r; }
});

test("Mapa en grises: el pico del perfil real es el eje l (≈5,41×) y el control es 1×", () => {
  const { points } = lossPoints(real, []);
  const peak = Math.max(...points.map((p) => p.ratio));
  assert.ok(Math.abs(peak - 5.41) < 0.01, `${peak}`);
  const map = lossMap(real, [], rgbs);
  assert.ok(map.every((s) => s.l >= LOSS_RAMP.lMin - 1e-9 && s.l <= LOSS_RAMP.lMax + 1e-9));
});

test("Mapa en grises: rayado solo en los lados midpointToHealthy; con bordes cerrados no hay rayado", () => {
  const realMap = lossMap(real, [], rgbs);
  assert.ok(realMap.some((s) => s.estimated) && realMap.some((s) => !s.estimated));
  assert.ok(hatchRuns(realMap).length > 0);
  const simMap = lossMap(real, sim, rgbs);
  assert.ok(simMap.every((s) => !s.estimated));
  assert.deepEqual(hatchRuns(simMap), []);
});

test("Zonas de confusión ya no es un filtro: no se hornea en el JSON y se describe como diagnóstico", () => {
  const t = buildTransformFile(real);
  assert.ok(!t.filters.some((f) => (f.id as string) === "correct"));
  assert.equal(t.params?.lossMap?.name, "Zonas de confusión");
  assert.ok(!JSON.stringify(t).includes("en revisión"));
});

test("Zonas de confusión: liso ±6° alrededor de cada punto medido (red-end 0° incluido), transición suave al rayado", () => {
  const { estimated, measured } = lossPoints(real, []);
  assert.ok(measured.includes(0));
  for (const m of measured) for (let d = -HATCH.plainDeg; d <= HATCH.plainDeg; d += 0.5) assert.equal(hatchWeight(estimated, measured, m + d), 0);
  // Dentro del lado estimado de l (11,1° → 52,8°), lejos de puntos: rayado pleno; en medio, creciente.
  assert.equal(hatchWeight(estimated, measured, 35), 1);
  let prev = 0;
  for (let d = 17.1; d <= 21.1; d += 0.25) { const w = hatchWeight(estimated, measured, d); assert.ok(w >= prev - 1e-12 && w <= 1); prev = w; }
  assert.ok(Math.abs(lossPeak(real) - 5.41) < 0.01);
});
