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

import { EDGE_STAGE, edgeContracted, edgeLayout, edgeMinGap, edgeOffset, edgeFormation, edgeAngle } from "../src/lib/test/transition";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("bordes: formación en cuadrado a distancia fija, dentro del escenario y sin tocarse con cualquier giro", () => {
  const R = EDGE_STAGE.radius, half = EDGE_STAGE.size / 2, d = EDGE_STAGE.disc / 2;
  assert.equal(R, 100);
  const check = (l: ReturnType<typeof edgeFormation>, tag: string) => {
    assert.equal(l.length, 4);
    for (const p of l) {
      assert.ok(Math.abs(Math.hypot(p.x, p.y) - R) < 0.02, tag);
      assert.ok(Math.hypot(p.x, p.y) + d <= half, tag);
      assert.ok(Math.abs(p.x) + d <= half && Math.abs(p.y) + d <= half, tag);
    }
    const g = edgeMinGap(l);
    assert.ok(Math.abs(g - (R * Math.SQRT2 - EDGE_STAGE.disc)) < 0.05, `${tag} hueco ${g}`);
    assert.ok(g >= EDGE_STAGE.gap, tag);
  };
  for (let deg = 0; deg < 360; deg += 0.5) check(edgeFormation(deg), `giro ${deg}`);
  for (let seed = 1; seed <= 2000; seed++) check(edgeLayout(lcg(seed)), `seed ${seed}`);
  assert.ok(Math.abs(edgeMinGap(edgeFormation(0)) - 69.42) < 0.05);
});

test("bordes: giro uniforme en [0, 360) y orden de las piezas conservado (separadas 90°)", () => {
  assert.equal(edgeAngle(() => 0), 0);
  assert.ok(edgeAngle(() => 0.999999) < 360);
  const bins = new Array(8).fill(0), r = lcg(11);
  for (let i = 0; i < 8000; i++) { const a = edgeAngle(r); assert.ok(a >= 0 && a < 360); bins[Math.floor(a / 45)]++; }
  bins.forEach((n) => assert.ok(n > 800 && n < 1200, `${bins}`));
  const l = edgeFormation(0);
  l.forEach((p, i) => { assert.equal(Math.sign(p.x), i % 2 ? 1 : -1); assert.equal(Math.sign(p.y), i < 2 ? -1 : 1); });
  for (const deg of [17, 123, 301]) {
    const ang = edgeFormation(deg).map((p) => Math.atan2(p.y, p.x) * 180 / Math.PI);
    const base = l.map((p) => Math.atan2(p.y, p.x) * 180 / Math.PI);
    ang.forEach((a, i) => { const dlt = (((a - base[i] - deg) % 360) + 540) % 360 - 180; assert.ok(Math.abs(dlt) < 0.05); });
  }
});

test("bordes: las posiciones cambian de un ensayo a otro", () => {
  const r = lcg(42);
  const a = edgeLayout(r), b = edgeLayout(r);
  assert.notDeepEqual(a, b);
});

test("bordes: contraídas hacia el centro dejan hueco y no se tocan", () => {
  const c = [0, 1, 2, 3].map((i) => edgeContracted(i));
  assert.ok(edgeMinGap(c) >= EDGE_STAGE.centerGap - 1e-9);
  const l = edgeLayout(lcg(7));
  c.forEach((p, i) => assert.ok(Math.hypot(p.x, p.y) < Math.hypot(l[i].x, l[i].y)));
});

test("bordes: desplazamiento por fase y sin desplazamiento con movimiento reducido", () => {
  const l = edgeLayout(lcg(3));
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(edgeOffset("fadeOut", i, l, false), edgeContracted(i));
    assert.deepEqual(edgeOffset("hold", i, l, false), edgeContracted(i));
    assert.deepEqual(edgeOffset("fadeIn", i, l, false), l[i]);
    assert.deepEqual(edgeOffset("ready", i, l, false), l[i]);
    for (const ph of ["fadeOut", "hold", "fadeIn", "ready"] as const) assert.deepEqual(edgeOffset(ph, i, l, true), l[i]);
  }
});

test("bordes: mismas fases que el perfil, solo se responde en listo", () => {
  assert.equal(swapPhase(150), "fadeOut");
  assert.equal(swapPhase(SWAP.fadeOut + SWAP.hold / 2), "hold");
  assert.equal(swapPhase(SWAP.fadeOut + SWAP.hold + 10), "fadeIn");
  assert.equal(swapPhase(SWAP.fadeOut + SWAP.hold + SWAP.fadeIn), "ready");
  assert.deepEqual(SWAP_ORDER.filter(acceptsResponse), ["ready"]);
  const gray = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));
  assert.equal(gray, "rgb(129 129 129)");
  assert.equal(swapFill("hold", "rgb(1, 2, 3)", gray), gray);
});

