import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bandFromProfile } from "../src/lib/color/assistband";
import { CAMERA_GATE_T0, bandInWTs, bandShaderColor, bandUniforms, cameraFrame, cameraGate } from "../src/lib/color/bandshader";
import { EXTREME_TURN_DEG, assistColor, extremeColor, labHueShift } from "../src/lib/color/spectrum";
import { fromSrgb8, toSrgb8 } from "../src/lib/color/space";
import { FRAG } from "../src/components/camera";

/**
 * Cámara píxel a píxel: la traducción TS del shader (bandShaderColor) frente a la ruta exacta de láminas y
 * transformadas (assistColor / extremeColor), en arcoíris, barrido HSV, 8 láminas 5g y una rejilla 18³ (8 bits).
 */
const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const REF = read("asistido-franja-ref.json");
const bands = bandFromProfile(read("perfil-72c787e.json"), [read("bordes-l-72c787e.json")]);
const u = bandUniforms(bands, EXTREME_TURN_DEG);
const grid: Array<[number, number, number]> = [];
for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) grid.push([r, g, b]);
const sets: Record<string, Array<[number, number, number]>> = {
  rejilla: grid,
  arcoiris: REF.arcoiris.map((x: number[]) => [x[0], x[1], x[2]]),
  hsv: REF.hsv.map((x: number[]) => [x[0], x[1], x[2]]),
};
for (const [k, v] of Object.entries(REF.laminas5g as Record<string, number[][]>)) sets[k] = v.map((x) => [x[0], x[1], x[2]]);

for (const [mode, exact] of [[2, assistColor], [3, extremeColor]] as const) {
  test(`shader de cámara = ruta exacta (${mode === 2 ? "Asistencia" : "Extremo"}), 8 bits`, () => {
    for (const [name, list] of Object.entries(sets)) {
      let worst = 0;
      for (const c of list) {
        const a = toSrgb8(bandShaderColor(fromSrgb8(c), u, mode));
        const b = toSrgb8(exact(fromSrgb8(c), bands));
        worst = Math.max(worst, ...a.map((x, i) => Math.abs(x - b[i])));
      }
      assert.equal(worst, 0, `${name}: ${worst}`);
    }
  });
}

test("un pase a resolución completa: empujón por píxel, puerta por croma promediado guiado por brillo; LUT solo para el simulador", () => {
  assert.match(FRAG, /outc = toSrgb\(bandApply\(c, bandColor\(c, uMode\) - c, uMode, gate\)\);/);
  assert.match(FRAG, /float gate = smoothstep\(uGateT0, 2\.0 \* uGateT0, length\(sv\) \/ sw\);/);
  assert.match(FRAG, /float wt = exp\(dg \* dg \* inv\);/);
  assert.doesNotMatch(FRAG, /uPush\b/);
  assert.equal(u.count, 1);
  assert.equal(u.geo[5], bands[0].px.length);
});

/** Imagen lineal w×h a partir de una función de color 8 bits por píxel. */
const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const a = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(fromSrgb8(f(x, y)), (y * w + x) * 3);
  return a;
};

test("cámara: color liso sin tope = ruta exacta; ΔB = 0, ΔY_WU = 0, fuera de franja 0, en gama, giro ≤ 60°", () => {
  const w = 24, h = 16;
  for (const [mode, exact] of [[2, assistColor], [3, extremeColor]] as const) {
    for (const c of sets.hsv.filter((_, i) => i % 7 === 0)) {
      const out = cameraFrame(img(w, h, () => c), w, h, u, mode, { t0: 1e-9 });
      const e = toSrgb8(exact(fromSrgb8(c), bands));
      for (let p = 0; p < w * h; p += 37) {
        const o = toSrgb8([out[p * 3], out[p * 3 + 1], out[p * 3 + 2]]);
        assert.ok(o.every((x, i) => Math.abs(x - e[i]) <= 1), `${c} → ${o} vs ${e}`);
      }
    }
    // Mezcla de colores (franja, fuera de franja y gris) en tablero 1 px: invariantes por píxel.
    const pal = sets.arcoiris.filter((_, i) => i % 3 === 0);
    const src = img(w, h, (x, y) => pal[(x * 7 + y * 13) % pal.length]);
    const out = cameraFrame(src, w, h, u, mode);
    const Y = bands[0].weights; // luminancia WU del usuario (la que conserva la dirección del empujón)
    for (let p = 0; p < w * h; p++) {
      const c = [src[p * 3], src[p * 3 + 1], src[p * 3 + 2]] as [number, number, number];
      const o = [out[p * 3], out[p * 3 + 1], out[p * 3 + 2]] as [number, number, number];
      assert.equal(o[2], c[2]);
      assert.ok(Math.abs(o[0] * Y[0] + o[1] * Y[1] + o[2] * Y[2] - (c[0] * Y[0] + c[1] * Y[1] + c[2] * Y[2])) < 1e-6);
      assert.ok(o.every((x) => x >= -1e-6 && x <= 1 + 1e-6));
      if (bandInWTs(c, u) === 0) assert.deepEqual(o, c);
      if (mode === 3) assert.ok(labHueShift(c, o) <= (60 * Math.PI) / 180 + 1e-3);
    }
  }
});


test("puerta solo en cámara: g(C̄) = smoothstep(t0, 2·t0); ruido ±1 casi gris intacto; empujón nunca mayor que el exacto", () => {
  assert.equal(cameraGate(CAMERA_GATE_T0 * 0.99), 0);
  assert.equal(cameraGate(CAMERA_GATE_T0 * 2.01), 1);
  assert.ok(Math.abs(cameraGate(CAMERA_GATE_T0 * 1.5) - 0.5) < 1e-12);
  const w = 20, h = 12;
  for (const mode of [2, 3] as const) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const noisy = img(w, h, (x) => (x < 4 ? [128, 128, 128] : [128 + Math.floor(rnd() * 3) - 1, 128 + Math.floor(rnd() * 3) - 1, 128 + Math.floor(rnd() * 3) - 1]));
    assert.deepEqual(cameraFrame(noisy, w, h, u, mode), noisy);
    const pal = sets.arcoiris.filter((_, i) => i % 3 === 0);
    const src = img(w, h, (x, y) => pal[(x * 7 + y * 13) % pal.length]);
    const out = cameraFrame(src, w, h, u, mode);
    for (let p = 0; p < w * h; p++) {
      const c = [src[p * 3], src[p * 3 + 1], src[p * 3 + 2]] as [number, number, number];
      const e = bandShaderColor(c, u, mode);
      assert.ok(Math.abs(out[p * 3] - c[0]) <= Math.abs(e[0] - c[0]) + 1e-6);
    }
  }
});
