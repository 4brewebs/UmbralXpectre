import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BAND_GAIN, bandFromProfile, bandShift, bandStep, bandWeight, moveAlong, type AssistBand, type BandProfile } from "../src/lib/color/assistband";
import { assistColor, extremeColor, labHueShift } from "../src/lib/color/spectrum";
import { dirFromTheta, fromSrgb8, killLuminance, norm, srgbToLinearChannel, thetaOf, toSrgb8, type Vec3 } from "../src/lib/color/space";

/**
 * Asistido por franja (Regla B). Referencia: reglaB.py (fixture generado con tests/fixtures/gen-asistido-franja.py).
 */
const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const P = read("perfil-72c787e.json");
const B = read("bordes-l-72c787e.json");
const REF = read("asistido-franja-ref.json");
const SYN = read("perfiles-sinteticos-reglaB.json") as Record<"normal" | "deutan", BandProfile>;
const bands = bandFromProfile(P, [B]);
const WU: Vec3 = P.luminance.weights;
const yWU = (c: Vec3) => c[0] * WU[0] + c[1] * WU[1] + c[2] * WU[2];
const thetaDeg = (c: Vec3) => (thetaOf(killLuminance(c)) * 180) / Math.PI;
const at = (deg: number, r: number, y = 0.25): Vec3 => { const d = dirFromTheta((deg * Math.PI) / 180); return [y + d[0] * r, y + d[1] * r, y + d[2] * r]; };
const inGamut = (c: Vec3) => c.every((x) => x >= 0 && x <= 1);
/** Todos los colores 8 bits de una rejilla de 18³ más los de los vectores de referencia. */
const grid: Array<[number, number, number]> = [];
for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) grid.push([r, g, b]);
const sets: Record<string, number[][]> = { arcoiris: REF.arcoiris, hsv: REF.hsv, ...REF.laminas5g };
const all8 = [...grid, ...Object.values(sets).flatMap((v) => v.map((x) => [x[0], x[1], x[2]] as [number, number, number]))];

test("franja de Lucas: eje 11,1°, núcleo = bordes 8,6–14°, cero fuera de los vecinos −9,5° / 31,7°", () => {
  assert.equal(bands.length, 1);
  const b = bands[0];
  assert.equal(b.via, "l");
  assert.equal(b.core, "bordes");
  assert.ok(Math.abs(b.phi - 11.1) < 1e-9);
  assert.ok(Math.abs(b.lo - 8.6) < 1e-9 && Math.abs(b.hi - 14) < 1e-9);
  assert.ok(Math.abs(b.z0 + 9.5) < 1e-9 && Math.abs(b.z1 - 31.7) < 1e-9);
  assert.equal(b.tControl, 0.0035, "T_control = threshold del control, no thresholdStandardY");
  assert.deepEqual(b.weights, [0.10312, 0.78804, 0.10884]);
});

test("ángulo de confusión ≈ 12,5° (vértice de la parábola en log T), igual que Python", () => {
  assert.ok(Math.abs(bands[0].confusionDeg - 12.5) < 0.05, `${bands[0].confusionDeg}`);
  assert.ok(Math.abs(bands[0].confusionDeg - REF.confusionDeg) < 1e-9);
});

test("sin bordes: núcleo donde log d ≥ ½·log d(eje)", () => {
  const [b] = bandFromProfile(P, []);
  assert.equal(b.core, "logd");
  const half = Math.log(0.0324 / 0.0035) / 2;
  for (const x of [b.lo, b.hi]) assert.ok(Math.abs(Math.log(bandWeight(b, x).T / 0.0035) - half) < 0.01);
  assert.ok(b.lo < 11.1 && b.hi > 11.1);
});

test("paridad con reglaB.py: arcoíris, barrido HSV y las 8 láminas 5g (máx. diferencia 0 en 8 bits)", () => {
  for (const [name, rows] of Object.entries(sets)) {
    let max = 0;
    for (const r of rows) {
      const o = toSrgb8(assistColor(fromSrgb8([r[0], r[1], r[2]]), bands));
      for (let i = 0; i < 3; i++) max = Math.max(max, Math.abs(o[i] - r[3 + i]));
    }
    assert.equal(max, 0, `${name}: ${max}`);
  }
});

test("perfil normal (sintético y sin vías elevadas): identidad exacta en Asistencia y Extremo", () => {
  const normal = bandFromProfile(SYN.normal);
  assert.deepEqual(normal, []);
  const healthy = { ...P, fit: { ...P.fit, pathways: P.fit.pathways.map((p: { elevated: boolean }) => ({ ...p, elevated: false })) } };
  const none = bandFromProfile(healthy, [B]);
  for (const c8 of all8) {
    const c = fromSrgb8(c8);
    assert.deepEqual(assistColor(c, normal), c);
    assert.deepEqual(extremeColor(c, none), c);
  }
});

test("cambio 0 fuera de la franja y azul nunca cambia (Asistencia y Extremo)", () => {
  let moved = 0;
  for (const c8 of all8) {
    const c = fromSrgb8(c8);
    const w = norm(killLuminance(c)) > 1e-7 ? bandWeight(bands[0], thetaDeg(c)).w : 0;
    for (const out of [assistColor(c, bands), extremeColor(c, bands)]) {
      assert.equal(out[2], c[2]);
      assert.ok(inGamut(out));
      if (w === 0) assert.deepEqual(out, c);
      else if (out[0] !== c[0]) moved++;
    }
  }
  assert.ok(moved > 100);
});

test("luminancia WU constante (lineal ~0; en 8 bits dentro del redondeo)", () => {
  const lin = (v: number) => srgbToLinearChannel(Math.max(0, Math.min(255, v)) / 255);
  let maxLin = 0;
  let max8 = 0;
  for (const c8 of all8) {
    const c = fromSrgb8(c8);
    for (const out of [assistColor(c, bands), extremeColor(c, bands)]) {
      maxLin = Math.max(maxLin, Math.abs(yWU(out) - yWU(c)));
      const o8 = toSrgb8(out);
      const tol = [0, 1, 2].reduce((s, i) => s + WU[i] * (lin(o8[i] + 1) - lin(o8[i] - 1)) / 2, 0);
      const d = Math.abs(yWU(fromSrgb8(o8)) - yWU(c));
      assert.ok(d <= tol + 1e-12, `${c8} → ${o8}: ${d} > ${tol}`);
      max8 = Math.max(max8, d);
    }
  }
  assert.ok(maxLin < 1e-12, `${maxLin}`);
});

test("lado rojizo +R−G, verdoso −R+G, con ΔG = −ΔR·W_R/W_G", () => {
  const k = WU[0] / WU[1];
  const red = at(11.1, 0.05), green = at(191.1, 0.05);
  const a = assistColor(red, bands), g = assistColor(green, bands);
  assert.ok(a[0] > red[0] && a[1] < red[1]);
  assert.ok(g[0] < green[0] && g[1] > green[1]);
  assert.ok(Math.abs((a[1] - red[1]) / (a[0] - red[0]) + k) < 1e-12);
});

test("Extremo: misma dirección que la Asistencia, más lejos, giro ≤ 60°", () => {
  for (let deg = -9; deg <= 31; deg += 2) {
    for (const r of [0.02, 0.06, 0.12]) {
      const c = at(deg, r);
      if (!inGamut(c)) continue;
      const a = assistColor(c, bands), e = extremeColor(c, bands);
      const da = a[0] - c[0], de = e[0] - c[0];
      if (da === 0) continue;
      assert.ok(Math.sign(de) === Math.sign(da) && Math.abs(de) >= Math.abs(da) - 1e-12, `${deg}° ${r}`);
      assert.ok(labHueShift(c, e) <= (60 * Math.PI) / 180 + 1e-6);
    }
  }
});

test("una franja que «no cae» se corta en el vecino medido: w = 0 más allá aunque T siga alto", () => {
  const flat = structuredClone(P);
  for (const a of flat.axes) if (a.id === "l:+") a.threshold = 0.0324;
  const [b] = bandFromProfile(flat, [B]);
  assert.ok(bandWeight(b, 31.6).T > 0.03, "T sigue alto en el vecino");
  for (const deg of [31.7, 32, 35, 45]) assert.equal(bandWeight(b, deg).w, 0);
  for (const deg of [31.8, 35, 45]) {
    const c = at(deg, 0.05);
    assert.deepEqual(bandShift(c, [b], 6), c);
  }
  assert.ok(bandWeight(b, 31).w > 0);
});

test("deután sintético: por ahora solo la vía l (identidad); con la vía m, solo estructura", () => {
  assert.deepEqual(bandFromProfile(SYN.deutan), []);
  const deu: AssistBand[] = bandFromProfile(SYN.deutan, null, ["m"]);
  assert.equal(deu.length, 1);
  const W = deu[0].weights;
  const k = W[0] / W[1];
  let moved = 0;
  for (const c8 of all8) {
    const c = fromSrgb8(c8);
    const out = bandShift(c, deu, 6);
    assert.equal(out[2], c[2]);
    assert.ok(Math.abs(out[0] * W[0] + out[1] * W[1] - c[0] * W[0] - c[1] * W[1]) < 1e-12);
    if (out[0] === c[0]) continue;
    moved++;
    assert.ok(Math.abs((out[1] - c[1]) / (out[0] - c[0]) + k) < 1e-9);
    assert.ok(bandWeight(deu[0], thetaDeg(c)).w > 0, "solo se mueve en su eje");
  }
  assert.ok(moved > 0);
});

test("continuidad en los vecinos: w llega exactamente a 0 en z0/z1 y el color no salta", () => {
  const b = bands[0];
  for (const z of [b.z0, b.z1]) {
    assert.equal(bandWeight(b, z).w, 0);
    for (const e of [1e-3, 1e-2]) {
      assert.ok(bandWeight(b, z + e).w < 1e-4 && bandWeight(b, z - e).w < 1e-4, `w cerca de ${z}`);
    }
  }
  // Barrido fino de tono (0,01°) con croma y luminancia fijos: ningún salto de color en ningún sitio.
  const hsv = (h: number): Vec3 => {
    const s = 0.5, v = 0.7, f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)].map(srgbToLinearChannel) as Vec3;
  };
  for (const g of [assistColor, extremeColor]) {
    let prevIn = hsv(0), prevOut = g(prevIn, bands), worst = 0;
    for (let h = 0.01; h < 360; h += 0.01) {
      const c = hsv(h), o = g(c, bands);
      const dOut = Math.max(...o.map((x, i) => Math.abs(x - prevOut[i])));
      const dIn = Math.max(...c.map((x, i) => Math.abs(x - prevIn[i])));
      worst = Math.max(worst, dOut - dIn);
      prevIn = c; prevOut = o;
    }
    assert.ok(worst < 2e-3, `salto ${worst}`);
  }
});

test("gris puro: sin cambio en Asistencia y Extremo (C = 0, sin tono)", () => {
  for (const y of [0, 0.01, 0.18, 0.5, 1]) {
    const g: Vec3 = [y, y, y];
    assert.deepEqual(assistColor(g, bands), g);
    assert.deepEqual(extremeColor(g, bands), g);
  }
});

test("vía exacta: |ΔR| = g · w · T(θ) sin tope por croma (recortado solo a la gama)", () => {
  for (let h = 0; h < 360; h += 0.5) for (const r of [0.0005, 0.002, 0.02, 0.08]) {
    const c = dirFromTheta((h * Math.PI) / 180).map((x) => 0.3 + r * x) as Vec3;
    const s = bandStep(c, bands);
    if (!s) continue;
    assert.deepEqual(bandShift(c, bands, BAND_GAIN.assist), moveAlong(c, s, BAND_GAIN.assist * s.w * s.T));
  }
});

/** Salida de reglaB.py validada a ciegas (8/8) en las láminas 5g, congelada (no se regenera con el generador). */
const VALIDADAS = read("laminas-5g-validadas.json").laminas5g as Record<string, number[][]>;
test("láminas = 5g: P1–P8 por la vía exacta idénticas a las validadas (0 colores distintos, máx. 0 en 8 bits)", () => {
  assert.deepEqual(Object.keys(VALIDADAS).sort(), ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
  for (const [name, rows] of Object.entries(VALIDADAS)) {
    let distintos = 0;
    for (const r of rows) {
      const o = toSrgb8(assistColor(fromSrgb8([r[0], r[1], r[2]]), bands));
      if (o.some((x, i) => x !== r[3 + i])) distintos++;
    }
    assert.equal(distintos, 0, `${name}: ${distintos} colores distintos`);
  }
});
