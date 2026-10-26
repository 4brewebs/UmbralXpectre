import { test } from "node:test";
import assert from "node:assert/strict";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";
import { buildProfile, parseProfile, refitProfile, type HardwareSnapshot, type UmbralProfile } from "../src/lib/color/profile";
import { applyReview, answerReview, createReview, REVIEW, reviewEstimates, reviewStimulus } from "../src/lib/color/review";
import { thresholdAt } from "../src/lib/color/spectrum";
import { fromSrgb8, type Vec3 } from "../src/lib/color/space";

const W: Vec3 = [0.3, 0.62, 0.08];
const hw: HardwareSnapshot = {
  userAgent: "test", language: "es", screen: { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 }, viewport: { width: 390, height: 844 },
  gamut: "srgb", colorScheme: "light", forcedColors: false, reducedMotion: false, maxTouchPoints: 5, capturedAt: "2026-10-26T14:00:00.000Z",
};
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function baseProfile(): UmbralProfile {
  let s = createSession(7);
  for (let i = 0; i < 400 && !s.complete; i++) {
    const st = stimulusOf(s)!;
    s = answer(s, st.catch ? "same" : st.s > 0.04 ? "different" : "same", i);
  }
  return buildProfile(s, hw, new Date("2026-10-26T14:00:00Z"));
}
const withWeights = (p: UmbralProfile, source = "measured"): UmbralProfile => ({ ...p, luminance: { ...(p.luminance as object), weightsSource: source, weights: W } as UmbralProfile["luminance"] });

function run(p: UmbralProfile, Q: Awaited<ReturnType<typeof loadQuestPlus>>, truth: (id: string) => number, seed = 1) {
  let st = createReview(p, Q, { seed, lumNoise: true })!;
  const r = rng(seed);
  for (let i = 0; i < 200 && !st.done; i++) {
    const stim = reviewStimulus(st)!;
    const pd = stim.axis === "catch" ? 0.05 : weibull(stim.scale, truth(stim.axis), 3, 0.05, 0.03);
    st = answerReview(st, r() < pd);
  }
  return st;
}

test("repaso: se salta sin pesos medidos", async () => {
  const Q = await loadQuestPlus();
  const p = baseProfile();
  assert.equal(createReview(p, Q), null);
  assert.equal(createReview(withWeights(p, "predicted"), Q), null);
  assert.equal(createReview(withWeights(p, "standard"), Q), null);
  assert.ok(createReview(withWeights(p), Q));
});

test("repaso: pares igualados con los pesos personales, ε independiente y catch", async () => {
  const Q = await loadQuestPlus();
  const st = run(withWeights(baseProfile()), Q, () => 0.03);
  assert.equal(st.log.filter((t) => !t.catch).length, REVIEW.trialsPerAxis * 2);
  assert.ok(st.log.filter((t) => t.catch).length >= 4);
  assert.ok(st.log.some((t) => t.lumEps[0] !== t.lumEps[1]));
  let s0 = createReview(withWeights(baseProfile()), Q, { lumNoise: false })!;
  const stim = reviewStimulus(s0)!;
  const y = (c: [number, number, number]) => fromSrgb8(c).reduce((t, v, i) => t + v * W[i], 0);
  assert.ok(Math.abs(y(stim.reference) - y(stim.comparison)) < 0.004);
  void s0;
});

test("repaso: converge en simulación", async () => {
  const Q = await loadQuestPlus();
  const p = withWeights(baseProfile());
  const orig = (id: string) => p.axes.find((a) => a.id === id)!.threshold!;
  const errs: number[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const truth = (id: string) => orig(id) * (seed % 2 ? 1.4 : 0.75);
    for (const e of reviewEstimates(run(p, Q, truth, seed))) errs.push(Math.log(e.threshold / truth(e.id)));
  }
  const rms = Math.sqrt(errs.reduce((t, e) => t + e * e, 0) / errs.length);
  assert.ok(rms < 0.25, `RMS ln ${rms}`);
});

test("repaso: el umbral repasado se usa para T y filtros; JSON guarda thresholdStandardY y pesos", async () => {
  const Q = await loadQuestPlus();
  const p = withWeights(baseProfile());
  const orig = (id: string) => p.axes.find((a) => a.id === id)!.threshold!;
  const out = applyReview(p, run(p, Q, (id) => orig(id) * (id === "l" ? 3 : 1), 3));
  const est = out.review!.axes;
  for (const id of ["l", "m"]) {
    const ax = out.axes.find((a) => a.id === id)!;
    const e = est.find((x) => x.id === id)!;
    assert.equal(ax.thresholdStandardY, orig(id));
    assert.equal(ax.threshold, e.threshold);
    assert.equal(out.fit.pathways.find((x) => x.id === id)?.threshold, e.threshold);
  }
  assert.ok(out.axes.find((a) => a.id === "l")!.threshold! > orig("l") * 1.5);
  const l = out.axes.find((a) => a.id === "l")!;
  assert.ok(Math.abs(thresholdAt((l.angleDeg * Math.PI) / 180, out.axes as never, 0.001) - l.threshold!) < 1e-6);
  assert.equal(out.review!.scaleNormalized, false);
  assert.equal(parseProfile(JSON.stringify(out))!.review?.scaleNormalized, false);
  assert.deepEqual(out.review!.pairLuminance, { source: "measured", weights: W });
  const parsed = parseProfile(JSON.stringify(out))!;
  assert.equal(parsed.axes.find((a) => a.id === "l")!.thresholdStandardY, orig("l"));
  assert.deepEqual(parsed.review?.pairLuminance.weights, W);
  // T: refit coincide con lo guardado; el resto del perfil intacto.
  assert.deepEqual(refitProfile(out).fit, out.fit);
  assert.deepEqual(out.axes.filter((a) => a.id !== "l" && a.id !== "m"), p.axes.filter((a) => a.id !== "l" && a.id !== "m"));
  assert.deepEqual(out.trials, p.trials);
});

test("refit sin cambios deja el fit igual", () => {
  const p = baseProfile();
  assert.deepEqual(refitProfile(p).fit, p.fit);
});
