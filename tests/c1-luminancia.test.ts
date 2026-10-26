import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";
import { applyAnswer, discEnds, discsOf, edgeFile, startRun } from "../src/lib/color/edges";
import { buildProfile, type HardwareSnapshot } from "../src/lib/color/profile";
import { ANCHOR, fromSrgb8, linearToSrgbChannel, lumEps, luminance, makeLumNoise, srgbToLinearChannel, withLum, Y_COEF, type Vec3 } from "../src/lib/color/space";

const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/c1-estandar-6e44b6e.json", import.meta.url), "utf8"));
const W: Vec3 = [0.3, 0.62, 0.08];
const hw: HardwareSnapshot = {
  userAgent: "test", language: "es", screen: { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 }, viewport: { width: 390, height: 844 },
  gamut: "srgb", colorScheme: "light", forcedColors: false, reducedMotion: false, maxTouchPoints: 5, capturedAt: "2026-10-26T14:00:00.000Z",
};

function sessionStimuli(w?: Vec3, noise = false) {
  const out: unknown[] = [];
  for (const seed of [1, 7, 42]) {
    let s = createSession(seed, undefined, null, w ?? null, noise);
    for (let i = 0; i < 150 && !s.complete; i++) {
      const st = stimulusOf(s)!;
      out.push([st.reference, st.comparison, st.catch]);
      s = answer(s, st.catch ? "same" : i % 3 ? "different" : "same", i);
    }
  }
  return out;
}

function edgeStimuli() {
  const out: unknown[] = [];
  for (const ang of [-156.7, 0, 11.1, 107.7, 200]) for (const sc of [0.01, 0.03, 0.06]) {
    out.push(discEnds(ang, sc));
    for (const odd of [0, 2]) out.push(discsOf({ angle: ang, scale: sc, oddIndex: odd, oddSign: 1, catchTrial: false }));
  }
  return out;
}

/** Tolerancia de un código de 8 bits: el redondeo de cada canal (±½ código) pesado con w, en los dos colores. */
function oneCode(a: [number, number, number], w: Vec3): number {
  return a.reduce((t, c, i) => t + w[i] * (srgbToLinearChannel(Math.min(255, c + 1) / 255) - srgbToLinearChannel(Math.max(0, c - 1) / 255)) / 2, 0);
}

test("C1 sin pesos y sin ruido: perfil y bordes dan exactamente lo mismo que 6e44b6e", () => {
  assert.deepEqual(sessionStimuli(), golden.session);
  assert.deepEqual(edgeStimuli(), golden.edges);
  assert.equal("lumNoise" in createSession(1), false);
  assert.equal("lumWeights" in createSession(1), false);
});

test("C1 con pesos personales: cada par del perfil tiene la misma luminancia personal (±1 código de 8 bits)", () => {
  let n = 0;
  let stdOff = 0;
  for (const seed of [1, 7, 42]) {
    let s = createSession(seed, undefined, null, W);
    for (let i = 0; i < 150 && !s.complete; i++) {
      const st = stimulusOf(s)!;
      if (!st.catch) {
        const a = fromSrgb8(st.reference);
        const b = fromSrgb8(st.comparison);
        assert.ok(Math.abs(luminance(a, W) - luminance(b, W)) <= oneCode(st.reference, W) + oneCode(st.comparison, W), `${st.axisId} ${st.reference} ${st.comparison}`);
        stdOff = Math.max(stdOff, Math.abs(luminance(a) - luminance(b)));
        n++;
      }
      s = answer(s, st.catch ? "same" : i % 3 ? "different" : "same", i);
    }
  }
  assert.ok(n > 100);
  assert.ok(stdOff > 0.002, `con Y estándar sí difieren (${stdOff})`);
});

test("C1 con pesos personales: los discos de bordes brillan igual para el observador (±1 código de 8 bits)", () => {
  for (const ang of [-156.7, 0, 11.1, 107.7, 200]) for (const sc of [0.01, 0.03, 0.05, 0.2]) {
    const d = discsOf({ angle: ang, scale: sc, oddIndex: 1, oddSign: 1, catchTrial: false, lumWeights: W });
    const e = discEnds(ang, sc, W);
    for (const [a, b] of [[d[1], d[0]], [e.positive, e.negative]]) assert.ok(Math.abs(luminance(fromSrgb8(a), W) - luminance(fromSrgb8(b), W)) <= oneCode(a, W) + oneCode(b, W), `${ang} ${sc}`);
  }
});

test("C1: el JSON de perfil y el de bordes guardan qué pesos se usaron (fuente y valores)", () => {
  const done = (w?: Vec3) => {
    let s = createSession(1, undefined, null, w ?? null);
    for (let i = 0; i < 400 && !s.complete; i++) s = answer(s, stimulusOf(s)!.catch ? "same" : i % 3 ? "different" : "same", i);
    return buildProfile(s, hw);
  };
  assert.deepEqual(done().pairLuminance, { source: "standard", weights: Y_COEF });
  assert.deepEqual(done(W).pairLuminance, { source: "measured", weights: W });
  const base = { cone: "l" as const, peakDeg: 11.1, floor: 0.0105, sourceThreshold: 0.0568, sourceTimes: 5.4, profileSchema: "umbral.profile.v3", profileCreatedAt: "x", seed: 3 };
  assert.deepEqual(edgeFile(startRun(base)).pairLuminance, { source: "standard", weights: Y_COEF });
  assert.deepEqual(edgeFile(startRun({ ...base, lumWeights: W })).pairLuminance, { source: "measured", weights: W });
});

test("ruido de luminancia: ±8 % en el gris de anclaje son varios códigos de 8 bits", () => {
  const code = (y: number) => linearToSrgbChannel(y) * 255;
  const lo = code(ANCHOR * 0.92);
  const hi = code(ANCHOR * 1.08);
  const mid = code(ANCHOR);
  console.log(`# gris ${mid.toFixed(2)}: −8 % ${lo.toFixed(2)} (${(lo - mid).toFixed(2)} códigos), +8 % ${hi.toFixed(2)} (+${(hi - mid).toFixed(2)})`);
  assert.ok(hi - mid >= 3 && mid - lo >= 3);
});

test("ruido de luminancia: sin mover el tono, dentro del gamut, ε uniforme en ±8 % e independiente", () => {
  const n = makeLumNoise(99);
  const e = Array.from({ length: 20000 }, (_, i) => lumEps(n, i >> 1, i & 1));
  assert.ok(Math.max(...e) <= 0.08 && Math.min(...e) >= -0.08 && Math.max(...e) > 0.079 && Math.min(...e) < -0.079);
  assert.ok(Math.abs(e.reduce((a, b) => a + b, 0) / e.length) < 0.002);
  const a = e.filter((_, i) => i % 2 === 0);
  const b = e.filter((_, i) => i % 2 === 1);
  assert.ok(Math.abs(corr(a, b)) < 0.03);
  const c: Vec3 = [0.9, 0.5, 0.2];
  const up = withLum(c, 0.08);
  assert.ok(Math.max(...up) <= 1 + 1e-12);
  assert.ok(Math.abs(up[1] / up[0] - c[1] / c[0]) < 1e-12 && Math.abs(up[2] / up[0] - c[2] / c[0]) < 1e-12);
});

function corr(x: number[], y: number[]): number {
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sx += (x[i] - mx) ** 2;
    sy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sx * sy);
}

test("ruido de luminancia: en 10⁴ ensayos de bordes la luminancia no predice el impar (correlación ≈ 0)", () => {
  let run = startRun({ cone: "l", peakDeg: 11.1, floor: 0.0105, sourceThreshold: 0.0568, sourceTimes: 5.4, profileSchema: "umbral.profile.v3", profileCreatedAt: "x", seed: 11, lumNoise: true, lumWeights: W });
  const isOdd: number[] = [];
  const dev: number[] = [];
  let hits = 0;
  let r = 12345;
  const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0), r / 4294967296);
  for (let t = 0; t < 10000; t++) {
    const trial = { ...run, angle: -180 + 360 * rnd(), scale: 0.005 + 0.05 * rnd(), oddIndex: Math.floor(rnd() * 4), oddSign: (rnd() < 0.5 ? 1 : -1) as 1 | -1, catchTrial: false, trials: new Array(t) };
    const ys = discsOf(trial).map((c) => luminance(fromSrgb8(c), W));
    const m = ys.reduce((a, b) => a + b, 0) / 4;
    ys.forEach((y, i) => {
      isOdd.push(i === trial.oddIndex ? 1 : 0);
      dev.push(Math.abs(y - (4 * m - y) / 3));
    });
    if (ys.indexOf(ys.reduce((a, b, i) => (Math.abs(b - m) > Math.abs(a - m) ? b : a), ys[0])) === trial.oddIndex) hits++;
  }
  const rr = corr(isOdd, dev);
  console.log(`# 10⁴ ensayos: correlación ${rr.toFixed(4)}, el más distinto en luminancia acierta el impar ${(hits / 100).toFixed(1)} % (azar 25 %)`);
  assert.ok(Math.abs(rr) < 0.02, `correlación ${rr}`);
  assert.ok(Math.abs(hits / 10000 - 0.25) < 0.02);
  // Y se guardan los ε de cada ensayo y la amplitud.
  run = applyAnswer(run, { picked: [run.oddIndex], none: false } as never);
  assert.equal(run.trials[0].lumEps?.length, 4);
  assert.deepEqual(edgeFile(run).lumNoise?.amp, 0.08);
});

test("ruido de luminancia en el perfil: cada estímulo su ε, guardado por ensayo; con el flag apagado, igual que antes", () => {
  let s = createSession(5, undefined, null, W, true);
  assert.equal(s.lumNoise?.amp, 0.08);
  const st = stimulusOf(s)!;
  assert.equal(st.lumEps?.length, 2);
  s = answer(s, "different", 1);
  assert.deepEqual(s.log[0].lumEps, st.lumEps);
  assert.deepEqual(sessionStimuli(undefined, false), golden.session);
});
