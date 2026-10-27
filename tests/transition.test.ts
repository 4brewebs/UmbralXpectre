import test from "node:test";
import assert from "node:assert/strict";
import { ANCHOR, cssRgb, toSrgb8 } from "../src/lib/color/space";
import { acceptsResponse, profileRotation, PROFILE_ROTATION, SWAP, SWAP_ORDER, swapFill, swapPhase, swapStarts } from "../src/lib/test/transition";

test("giro del perfil: magnitud en [20, 160] y los dos sentidos", () => {
  let neg = 0, pos = 0;
  for (let i = 0; i <= 1000; i++) {
    const r = profileRotation(i / 1000, ((i * 7919) % 1000) / 1000);
    assert.ok(Math.abs(r) >= PROFILE_ROTATION.min && Math.abs(r) <= PROFILE_ROTATION.max, `${r}`);
    if (r < 0) neg++; else pos++;
  }
  assert.ok(neg > 0 && pos > 0);
  assert.equal(profileRotation(0, 0.9), 20);
  assert.equal(profileRotation(1, 0.1), -160);
  assert.equal(profileRotation(-3, 0.9), 20);
  assert.equal(profileRotation(7, 0.9), 160);
});

test("giro del perfil: nunca cerca de 0° ni de 180° (la línea es simétrica módulo 180°)", () => {
  for (let i = 0; i < 5000; i++) {
    const r = profileRotation(Math.random(), Math.random());
    const m = ((r % 180) + 180) % 180;
    assert.ok(Math.min(m, 180 - m) >= 20, `${r}`);
  }
});

test("fases: fadeOut 300, hold ≥ 500, fadeIn 300, ready, en orden", () => {
  assert.deepEqual(SWAP, { fadeOut: 300, hold: 500, fadeIn: 300 });
  assert.deepEqual(swapStarts(), { fadeOut: 0, hold: 300, fadeIn: 800, ready: 1100 });
  assert.ok(SWAP.hold >= 500, "el hold no baja de 500 ms");
  const seen: string[] = [];
  for (let t = 0; t <= 1200; t += 10) {
    const p = swapPhase(t);
    if (seen.at(-1) !== p) seen.push(p);
  }
  assert.deepEqual(seen, SWAP_ORDER);
  assert.equal(swapPhase(299), "fadeOut");
  assert.equal(swapPhase(300), "hold");
  assert.equal(swapPhase(799), "hold");
  assert.equal(swapPhase(800), "fadeIn");
  assert.equal(swapPhase(1100), "ready");
});

test("solo se responde en ready; gris igual fuera de la aparición", () => {
  assert.deepEqual(SWAP_ORDER.filter(acceptsResponse), ["ready"]);
  assert.deepEqual(SWAP_ORDER.map((p) => swapFill(p, "rojo", "gris")), ["gris", "gris", "rojo", "rojo"]);
});

test("el gris de la transición es exactamente el de anclaje (neutro, mismo brillo medio)", () => {
  const g = toSrgb8([ANCHOR, ANCHOR, ANCHOR]);
  assert.equal(g[0], g[1]);
  assert.equal(g[1], g[2]);
  const neutral = cssRgb(g);
  for (const p of ["fadeOut", "hold"] as const) assert.equal(swapFill(p, "rgb(1, 2, 3)", neutral), neutral);
});
