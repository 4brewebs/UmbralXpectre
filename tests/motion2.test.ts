import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  answerMotionV2, attachMotionV2, createMotionV2, measuredMatches, motionV2Enabled, paintMotionV2,
  periodPx, pickTemporal, stimulusOf, targetsFor, LUMA_CONTRAST, type MotionV2State,
} from "../src/lib/color/motion2";
import { parseProfile } from "../src/lib/color/profile";
import { predictedLumWeights, predictedMatch } from "../src/lib/color/cones";
import { luminance, type Vec3 } from "../src/lib/color/space";

const profile = () => parseProfile(fs.readFileSync(new URL("./fixtures/perfil_56KB.json", import.meta.url), "utf8"))!;

test("flag apagado por defecto", () => {
  assert.equal(motionV2Enabled("", null), false);
  assert.equal(motionV2Enabled("?motion=v2", null), true);
  assert.equal(motionV2Enabled("", "v2"), true);
  assert.equal(motionV2Enabled("?motion=v1", "v2"), false);
});

test("frecuencia y periodo", () => {
  assert.deepEqual(pickTemporal(60), { framesPerPhase: 2, hz: 7.5 });
  assert.equal(pickTemporal(120).hz, 10);
  assert.equal(pickTemporal(90).hz, 11.25);
  const p = periodPx();
  assert.ok(p > 26 && p < 53, `${p}`);
});

test("colores: siempre contra gris, nunca rojo contra rojo; control en eje no afectado", () => {
  const w = predictedLumWeights("protan", 1);
  const t = targetsFor("protan", w, profile().fit.confusionDirectionLinearRgb);
  assert.ok(t.some((x) => x.id === "rojo") && t.some((x) => x.kind === "control"));
  const red = t.find((x) => x.id === "rojo")!;
  assert.ok(red.lo <= 0.3 && red.hi >= 1.1 && red.predicted > 0.45 && red.predicted < 0.57);
  const s = createMotionV2(profile(), 1);
  for (let i = 0; i < 20 && s.current; i++) {
    const st = stimulusOf(s)!;
    assert.ok(st.ref[0] === st.ref[1] && st.ref[1] === st.ref[2]);
    assert.ok(st.test.every((v) => v <= 1 + 1e-9));
  }
  assert.ok(targetsFor("tritan", predictedLumWeights("tritan"), null).filter((x) => x.kind === "test").length >= 6);
});

test("pinta 4 fotogramas: luminancia ≤ 10 % Michelson", () => {
  const w = 64;
  const data = new Uint8ClampedArray(w * 4 * 4);
  const stim = { test: [0.3, 0, 0] as Vec3, ref: [0.1, 0.1, 0.1] as Vec3, sign: 1 as const };
  paintMotionV2(data, w, 4, 1, 0, stim, 32);
  const ys = Array.from({ length: w }, (_, x) => data[x * 4]);
  const mx = Math.max(...ys);
  const mn = Math.min(...ys);
  const lin = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;
  assert.ok((lin(mx) - lin(mn)) / (lin(mx) + lin(mn)) <= LUMA_CONTRAST + 0.02);
});

/** Observador simulado con pesos w: responde la dirección según el brillo percibido, con ruido. */
function run(state: MotionV2State, w: Vec3, noise: number, seed = 3): MotionV2State {
  let r = seed;
  const rand = () => ((r = (r * 1664525 + 1013904223) % 4294967296), r / 4294967296);
  for (let i = 0; i < 2000 && !state.complete; i++) {
    const st = stimulusOf(state)!;
    const d = Math.log(luminance(st.test, w) / luminance(st.ref, w)) + noise * (rand() * 2 - 1);
    const right = d > 0 === (st.sign === 1);
    state = answerMotionV2(state, right ? "right" : "left", i);
  }
  return state;
}

test("recupera el brillo del rojo de un protán simulado y guarda pesos v3", () => {
  const truth = predictedLumWeights("protan", 0.8);
  let s = createMotionV2(profile(), 42);
  s = run(s, truth, 0.01);
  assert.ok(s.complete);
  const red = measuredMatches(s).find((m) => m.id === "rojo")!;
  const expected = predictedMatch([1, 0, 0], [0.18, 0.18, 0.18], truth);
  assert.ok(Math.abs(red.efficiency / expected - 1) < 0.04, `${red.efficiency} vs ${expected}`);
  const p = attachMotionV2(profile(), s, { refreshHz: 60, temporalHz: 7.5, cyclesPerDeg: 0.75 });
  const lum = p.luminance!;
  assert.equal(lum.weightsSource, "measured");
  assert.ok(Math.abs(lum.weights[0] - truth[0]) < 0.03, `${lum.weights} vs ${truth}`);
  assert.equal(lum.matches.length, profile().luminance!.matches.length);
  assert.equal(lum.checks!.catches.missed, 0);
  assert.ok(lum.checks!.catches.shown > 0);
  const again = parseProfile(JSON.stringify(p))!;
  assert.deepEqual(again.luminance!.weights, lum.weights);
});
