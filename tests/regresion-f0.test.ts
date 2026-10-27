// F0: regresión byte a byte de estímulos y salidas (perfil, bordes, repaso) con semillas fijas.
// Las marcas de tiempo ISO se sustituyen por "<ts>". Para regrabar: UPDATE_FIXTURES=1 npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";
import { buildProfile, type HardwareSnapshot, type UmbralProfile } from "../src/lib/color/profile";
import { applyAnswer, startRun, edgeFile, discsOf, edgeInputFromProfile, type EdgeRun } from "../src/lib/color/edges";
import { applyReview, answerReview, createReview, reviewStimulus } from "../src/lib/color/review";
import type { Vec3 } from "../src/lib/color/space";

const DIR = new URL("./fixtures/regresion/", import.meta.url);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const strip = (v: unknown): unknown =>
  typeof v === "string" && ISO.test(v) ? "<ts>" : Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)])) : v;

function golden(name: string, value: unknown) {
  const text = JSON.stringify(strip(value), null, 1) + "\n";
  const url = new URL(name, DIR);
  if (process.env.UPDATE_FIXTURES || !existsSync(url)) writeFileSync(url, text);
  assert.equal(text, readFileSync(url, "utf8"), `regresión: ${name} cambió`);
}

const hw: HardwareSnapshot = {
  userAgent: "test", language: "es", screen: { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 }, viewport: { width: 390, height: 844 },
  gamut: "srgb", colorScheme: "light", forcedColors: false, reducedMotion: false, maxTouchPoints: 5, capturedAt: "2026-10-26T14:00:00.000Z",
};
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const W: Vec3 = [0.3, 0.62, 0.08];

function calib(seed: number, w: Vec3 | null, noise: boolean) {
  let s = createSession(seed, undefined, null, w, noise);
  const stimuli: unknown[] = [];
  for (let i = 0; i < 400 && !s.complete; i++) {
    const st = stimulusOf(s)!;
    stimuli.push(st);
    s = answer(s, st.catch ? "same" : st.s > 0.04 ? "different" : "same", seed + i);
  }
  return { stimuli, profile: buildProfile(s, hw, new Date("2026-10-26T14:00:00Z")) };
}

for (const [seed, w, noise] of [[7, null, false], [11, W, true]] as const) {
  test(`F0: calibración semilla ${seed} (estímulos y perfil)`, () => {
    const { stimuli, profile } = calib(seed, w, noise);
    golden(`calib-${seed}-estimulos.json`, stimuli);
    golden(`calib-${seed}-perfil.json`, profile);
  });
}

function simulateEdges(run: EdgeRun, edge: number, seed: number) {
  const r = rng(seed);
  const stimuli: unknown[] = [];
  for (let i = 0; i < 200 && run.phase !== "done" && run.phase !== "confirm"; i++) {
    stimuli.push(discsOf(run));
    const p = run.catchTrial ? 0.97 : run.phase === "depth" ? 0.9 : weibull(Math.abs(run.angle - run.peak), edge, 3.5, 0, 0);
    const seen = r() < p;
    const pick = r() < 0.03 ? Math.floor(r() * 4) : seen ? run.oddIndex : -1;
    run = applyAnswer(run, pick < 0 ? { picked: [], none: true } : { picked: [pick], none: false });
  }
  return { stimuli, file: edgeFile(run) };
}

test("F0: bordes con semilla fija (escalera y QUEST+)", async () => {
  const Q = await loadQuestPlus();
  const base = { cone: "l" as const, peakDeg: 0, floor: 0.02, sourceThreshold: 0.05, sourceTimes: null, profileSchema: "x", profileCreatedAt: "y" };
  for (const seed of [3, 5]) {
    const s = simulateEdges(startRun({ ...base, seed }), 9, seed);
    golden(`bordes-escalera-${seed}.json`, s);
    const q = simulateEdges(startRun({ ...base, seed, questPlus: Q }), 9, seed);
    golden(`bordes-qp-${seed}.json`, q);
  }
  const { profile } = calib(7, null, false);
  const fromProfile = simulateEdges(startRun({ ...edgeInputFromProfile(profile, "m"), seed: 9, lumNoise: true } as Parameters<typeof startRun>[0]), 9, 9);
  golden("bordes-desde-perfil-m.json", fromProfile);
});

test("F0: repaso con semilla fija (estímulos y perfil exportado)", async () => {
  const Q = await loadQuestPlus();
  const p0 = calib(7, null, false).profile;
  const p: UmbralProfile = { ...p0, luminance: { ...(p0.luminance as object), weightsSource: "measured", weights: W } as UmbralProfile["luminance"] };
  let st = createReview(p, Q, { seed: 4, lumNoise: true })!;
  const r = rng(4);
  const stimuli: unknown[] = [];
  for (let i = 0; i < 200 && !st.done; i++) {
    const stim = reviewStimulus(st)!;
    stimuli.push(stim);
    const pd = stim.axis === "catch" ? 0.05 : weibull(stim.scale, 0.05, 3, 0.05, 0.03);
    st = answerReview(st, r() < pd);
  }
  golden("repaso-estimulos.json", stimuli);
  golden("repaso-perfil.json", applyReview(p, st));
});
