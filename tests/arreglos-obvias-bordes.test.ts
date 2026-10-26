// Arreglos 26/10 (Colorado): catch obvios fallados en el perfil,
// parada mínima y aviso de desequilibrio en bordes. Sesión real de Lucas en QA (9dd5bcd) como caso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";
import { buildProfile, type HardwareSnapshot } from "../src/lib/color/profile";
import { applyAnswer, edgeFile, edgeInputFromProfile, QP_EDGES, sideBalance, startRun, type EdgeRun } from "../src/lib/color/edges";

const FIX = new URL("./fixtures/lucas-9dd5bcd/", import.meta.url);
const lucas = JSON.parse(readFileSync(new URL("perfil.json", FIX), "utf8"));
const lucasEdges = JSON.parse(readFileSync(new URL("bordes-l.json", FIX), "utf8"));
const hw: HardwareSnapshot = {
  userAgent: "test", language: "es", screen: { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 }, viewport: { width: 390, height: 844 },
  gamut: "srgb", colorScheme: "light", forcedColors: false, reducedMotion: false, maxTouchPoints: 5, capturedAt: "2026-10-26T14:00:00.000Z",
};
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }




test("perfil: obvious.missed ≥ 1 marca el bloque como poco fiable; 0 no", () => {
  let s = createSession(7);
  for (let i = 0; i < 400 && !s.complete; i++) {
    const st = stimulusOf(s)!;
    s = answer(s, st.catch ? "same" : st.s > 0.04 ? "different" : "same", i);
  }
  const bad = buildProfile({ ...s, obviousShown: 2, obviousMissed: 1 }, hw, new Date("2026-10-26T14:00:00Z"));
  assert.deepEqual(bad.catches.obvious, { shown: 2, missed: 1, unreliable: true });
  const ok = buildProfile({ ...s, obviousShown: 2, obviousMissed: 0 }, hw, new Date("2026-10-26T14:00:00Z"));
  assert.deepEqual(ok.catches.obvious, { shown: 2, missed: 0 });
  assert.equal(buildProfile(s, hw, new Date("2026-10-26T14:00:00Z")).catches.obvious, undefined);
});

test("bordes: sideBalance avisa con < ⅓ (Lucas: minus 23, plus 4) y no con lados parejos", () => {
  assert.equal(sideBalance(lucasEdges), "side-imbalance: minus 23, plus 4");
  const t = (side: string, n: number) => Array.from({ length: n }, () => ({ side }));
  assert.equal(sideBalance({ trials: [...t("minus", 9), ...t("plus", 3)] } as never), null);
  assert.equal(sideBalance({ trials: [...t("minus", 10), ...t("plus", 3)] } as never), "side-imbalance: minus 10, plus 3");
  assert.equal(sideBalance({ trials: [] } as never), null);
});

const ans = (run: EdgeRun, k: string) => (k === "seen" ? { picked: [run.oddIndex], none: false } : k === "none" ? { picked: [], none: true } : { picked: [(run.oddIndex + 1) % 4], none: false });

test("bordes: parada QUEST+ con ≥ 8 ensayos, IC < 1 ΔE00 y < 8° (o 45); el plus de Lucas ya no cierra con 1", async () => {
  const Q = await loadQuestPlus();
  const peak = lucasEdges.startAngleDeg;
  const truth = { minus: Math.abs(lucasEdges.minus.angleDeg - peak), plus: Math.abs(lucasEdges.plus.angleDeg - peak) };
  for (let seed = 1; seed <= 6; seed++) {
    let run = startRun({ ...edgeInputFromProfile(lucas, "l"), seed: 1, questPlus: Q });
    const queue = lucasEdges.trials.filter((x: any) => x.side !== "center");
    const r = rng(seed);
    for (let i = 0; i < 200 && ["peak", "minus", "plus"].includes(run.phase); i++) {
      const next = queue[0];
      let k: string;
      if (next && next.side === (run.phase === "peak" ? "peak" : run.phase) && (run.catchTrial ? next.catch : !next.catch && Math.abs(next.angleDeg - run.angle) < 0.06)) k = queue.shift().kind;
      else {
        while (queue.length && queue[0].side === run.phase) queue.shift();
        const p = run.catchTrial ? 0.97 : weibull(Math.abs(run.angle - run.peak), truth[run.phase as "minus" | "plus"], 3.5, 0, 0.03);
        k = r() < p ? "seen" : r() < 0.5 ? "miss" : "none";
      }
      run = applyAnswer(run, ans(run, k));
    }
    const f = edgeFile(run);
    for (const side of [f.minus, f.plus]) {
      const qp = side.qp!;
      assert.ok(qp.trials >= QP_EDGES.minTrials, `seed ${seed}: ${qp.trials}`);
      assert.ok(qp.trials >= QP_EDGES.maxTrials || (qp.ciDeg < QP_EDGES.fallbackDeg && qp.ciDeltaE00 < QP_EDGES.stopDeltaE), `seed ${seed}: ${JSON.stringify(qp)}`);
    }
  }
});

// ── Ruido de brillo apagado por defecto (Lucas 26/10) ──
import { LUM_NOISE_AMP, lumNoiseAmp, lumNoiseEnabled, noiseOf } from "../src/lib/color/space";
import { applyReview, answerReview, createReview, REVIEW, reviewStimulus, type ReviewState } from "../src/lib/color/review";
import type { UmbralProfile } from "../src/lib/color/profile";

test("ruido: apagado por defecto; ?lumnoise=1 → 0,08; ?lumnoise=0.08 → 0,08; =0 o ausente → 0", () => {
  assert.equal(LUM_NOISE_AMP, 0);
  assert.equal(lumNoiseAmp(""), 0);
  assert.equal(lumNoiseAmp("?lumnoise=0"), 0);
  assert.equal(lumNoiseAmp("?lumnoise=1"), 0.08);
  assert.equal(lumNoiseAmp("?lumnoise=0.08"), 0.08);
  assert.equal(lumNoiseAmp("?lumnoise=0.05"), 0.05);
  assert.equal(lumNoiseAmp("?lumnoise=x"), 0);
  assert.equal(lumNoiseEnabled(""), false);
  assert.equal(noiseOf(false, 1), null);
  assert.equal(noiseOf(true, 1)!.amp, 0.08);
});

test("ruido: amp 0 se guarda en el JSON (perfil, repaso, bordes) y no toca los estímulos", async () => {
  const Q = await loadQuestPlus();
  const run = (n: boolean | number) => {
    let s = createSession(7, undefined, null, null, n);
    const stims: unknown[] = [];
    for (let i = 0; i < 400 && !s.complete; i++) {
      const st = stimulusOf(s)!;
      stims.push([st.reference, st.comparison]);
      s = answer(s, st.catch ? "same" : st.s > 0.04 ? "different" : "same", i);
    }
    return { p: buildProfile(s, hw, new Date("2026-10-26T14:00:00Z")), stims };
  };
  const off = run(lumNoiseAmp("")), none = run(false), on = run(lumNoiseAmp("?lumnoise=1"));
  assert.equal(off.p.lumNoise!.amp, 0);
  assert.deepEqual(off.stims, none.stims);
  assert.equal(on.p.lumNoise!.amp, 0.08);
  assert.ok(on.p.catches.trials.every((t) => typeof (t as { dEps?: number }).dEps === "number"));
  assert.ok(off.p.catches.trials.every((t) => !("dEps" in t)));
  const W: Vec3 = [0.3, 0.62, 0.08];
  const pw = { ...off.p, luminance: { ...(off.p.luminance as object), weightsSource: "measured", weights: W } } as UmbralProfile;
  const rv = createReview(pw, Q, { seed: 1, lumNoise: 0 })!;
  assert.equal(rv.noise!.amp, 0);
  assert.equal(reviewStimulus(rv)!.lumEps.join(), "0,0");
  const e = startRun({ ...edgeInputFromProfile(off.p, "l"), seed: 1, lumNoise: 0 });
  assert.equal(edgeFile(e).lumNoise!.amp, 0);
});

// ── Repaso (arreglo 1, sin la regla de ±4 %) ──
import type { Vec3 } from "../src/lib/color/space";
function reviewProfile(): UmbralProfile {
  let s = createSession(7);
  for (let i = 0; i < 400 && !s.complete; i++) {
    const st = stimulusOf(s)!;
    s = answer(s, st.catch ? "same" : st.s > 0.04 ? "different" : "same", i);
  }
  const p = buildProfile(s, hw, new Date("2026-10-26T14:00:00Z"));
  return { ...p, luminance: { ...(p.luminance as object), weightsSource: "measured", weights: [0.3, 0.62, 0.08] } as UmbralProfile["luminance"] };
}
function sim(p: UmbralProfile, Q: Awaited<ReturnType<typeof loadQuestPlus>>, truth: (id: string) => number, fa: number, seed = 1): ReviewState {
  let st = createReview(p, Q, { seed, lumNoise: true })!;
  const r = rng(seed);
  for (let i = 0; i < 200 && !st.done; i++) {
    const stim = reviewStimulus(st)!;
    st = answerReview(st, r() < (stim.axis === "catch" ? fa : weibull(stim.scale, truth(stim.axis), 3, 0.05, 0.03)));
  }
  return st;
}

test("repaso: γ = gammaOf al llegar a 5 catch y QUEST+ reconstruido", async () => {
  const Q = await loadQuestPlus();
  const p = reviewProfile();
  const orig = (id: string) => p.axes.find((a) => a.id === id)!.threshold!;
  const st = sim(p, Q, orig, 0.45, 2);
  const c = st.log.filter((t) => t.catch);
  assert.equal(c.length, 5);
  assert.equal(st.gamma, Math.min(0.3, Math.max(0.02, c.filter((t) => t.different).length / 5)));
  assert.notEqual(st.gamma, REVIEW.gamma);
  assert.ok(c.every((t) => typeof t.dEps === "number"));
});

test("repaso: FA > 0,15 → review-unreliable, se conserva el original", async () => {
  const Q = await loadQuestPlus();
  const p = reviewProfile();
  const orig = (id: string) => p.axes.find((a) => a.id === id)!.threshold!;
  let st: ReviewState | null = null;
  for (let seed = 1; seed < 40 && !st; seed++) {
    const s = sim(p, Q, (id) => orig(id) * 3, 0.5, seed);
    const c = s.log.filter((t) => t.catch);
    if (c.filter((t) => t.different).length / c.length > 0.15) st = s;
  }
  const out = applyReview(p, st!);
  for (const id of ["l", "m"]) {
    const a = out.axes.find((x) => x.id === id)!;
    assert.equal(a.thresholdSource, "review-unreliable");
    assert.equal(a.threshold, orig(id));
  }
  assert.equal(out.review!.status, "review-unreliable");
});

test("repaso: original dentro del IC → solo ese eje no fiable", async () => {
  const Q = await loadQuestPlus();
  const p = reviewProfile();
  const orig = (id: string) => p.axes.find((a) => a.id === id)!.threshold!;
  const out = applyReview(p, sim(p, Q, (id) => orig(id) * (id === "l" ? 3 : 1), 0, 3));
  assert.equal(out.axes.find((a) => a.id === "m")!.thresholdSource, "review-unreliable");
  assert.equal(out.axes.find((a) => a.id === "l")!.thresholdSource, "review-measured");
  assert.equal(out.review!.status, "partial");
  assert.deepEqual(out.review!.unreliable, [{ id: "m", reasons: ["original-inside-ci"] }]);
});

test("repaso: razón fuera de [½, 2] solo avisa", async () => {
  const Q = await loadQuestPlus();
  const p = reviewProfile();
  const orig = (id: string) => p.axes.find((a) => a.id === id)!.threshold!;
  const out = applyReview(p, sim(p, Q, (id) => orig(id) * (id === "l" ? 3.5 : 1), 0, 3));
  const l = out.axes.find((a) => a.id === "l")!;
  assert.equal(l.thresholdSource, "review-measured");
  assert.ok(l.threshold! / orig("l") > 2);
  assert.ok(out.review!.warnings!.some((w) => w.startsWith("ratio-out-of-range l")));
});

test("repaso de Lucas (9dd5bcd): FA 2/5 → review-unreliable con los umbrales originales", async () => {
  const Q = await loadQuestPlus();
  const pre = { ...lucas, axes: lucas.axes.map((a: any) => (a.thresholdStandardY ? { ...a, threshold: a.thresholdStandardY, thresholdStandardY: undefined, thresholdSource: undefined } : a)) };
  delete pre.review;
  let st = createReview(pre, Q, { seed: 1 })!;
  for (const [i, t] of (lucas.review.trials as Array<{ axis: string; scale: number; different: boolean }>).entries()) {
    const s = reviewStimulus(st)!;
    assert.equal(s.axis, t.axis);
    if (i < 25) assert.ok(Math.abs(s.scale - t.scale) < 1e-5, `orden ${i + 1}`);
    st = answerReview(st, t.different);
  }
  assert.equal(st.gamma, 0.3);
  const out = applyReview(pre, st);
  assert.equal(out.review!.status, "review-unreliable");
  assert.equal(out.axes.find((a) => a.id === "l")!.threshold, 0.0189);
  assert.equal(out.axes.find((a) => a.id === "m")!.threshold, 0.0154);
});
