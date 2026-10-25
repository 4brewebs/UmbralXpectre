import test from "node:test";
import assert from "node:assert/strict";
import { appendHistory, makeSession, packTrials, readHistory, trialsOf, unpackTrials, HISTORY_FORMAT, PACK_ABOVE } from "../src/lib/color/history";
import { buildProfile, parseProfile, type HardwareSnapshot } from "../src/lib/color/profile";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";

const hw: HardwareSnapshot = {
  userAgent: "test", language: "es", screen: { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 }, viewport: { width: 390, height: 844 },
  gamut: "srgb", colorScheme: "light", forcedColors: false, reducedMotion: false, maxTouchPoints: 5, capturedAt: "2026-10-25T20:00:00.000Z",
};

function finished() {
  let s = createSession(1);
  for (let i = 0; i < 400 && !s.complete; i++) {
    const st = stimulusOf(s)!;
    s = answer(s, st.catch ? "same" : i % 3 ? "different" : "same", i);
  }
  return s;
}

test("historial: columnas sin pérdida (huecos y null incluidos)", () => {
  const trials = [{ a: 1, b: null, c: [1, 2] }, { a: 2 }, { c: "x", d: { e: 1 } }];
  const packed = packTrials(trials);
  assert.deepEqual(unpackTrials(JSON.parse(JSON.stringify(packed))), trials);
});

test("historial: sesión pequeña en bruto, grande en columnas y más corta", () => {
  const small = makeSession("edges", { date: "2026-10-25T20:00:00.000Z", deviceType: "pc", viewingCm: 60, stimulusDeg: null, backgroundY: null, method: "quest+" }, [{ a: 1 }], () => 0.5);
  assert.ok(small.trials && !small.packed);
  assert.match(small.id, /^edges-[0-9a-z]+-[0-9a-z]{4}$/);
  assert.deepEqual(small.engine, { version: "0.1.0", method: "quest+" });
  const s = finished();
  const big = makeSession("calibration", { date: "2026-10-25T20:00:00.000Z", deviceType: "phone", viewingCm: 40, stimulusDeg: null, backgroundY: 0.22, method: "staircase" }, s.log);
  assert.ok(JSON.stringify(s.log).length > PACK_ABOVE && big.packed && !big.trials);
  assert.equal(big.count, s.log.length);
  assert.deepEqual(trialsOf(big), s.log);
  assert.ok(JSON.stringify(big.packed).length < JSON.stringify(s.log).length * 0.7);
});

test("historial: se acumula y sobrevive a parseProfile; perfiles sin historial siguen valiendo", () => {
  const s = finished();
  const base = buildProfile(s, hw);
  assert.equal(base.history, undefined);
  const again = parseProfile(JSON.stringify(base))!;
  assert.equal(again.history, undefined);
  const e1 = makeSession("calibration", { date: "2026-10-24T10:00:00.000Z", deviceType: "phone", viewingCm: 40, stimulusDeg: null, backgroundY: 0.22, method: "staircase" }, s.log);
  const e2 = makeSession("motion-v2", { date: "2026-10-25T10:00:00.000Z", deviceType: "phone", viewingCm: 40, stimulusDeg: { width: 4, height: 2 }, backgroundY: 0.1475, method: "quest+" }, [{ x: 1 }]);
  const withH = appendHistory(appendHistory(base, e1), e2);
  const read = parseProfile(JSON.stringify(withH))!;
  assert.equal(read.history!.format, HISTORY_FORMAT);
  assert.deepEqual(read.history!.sessions.map((x) => x.kind), ["calibration", "motion-v2"]);
  assert.deepEqual(trialsOf(read.history!.sessions[0]), s.log);
  assert.equal(readHistory({ format: "otro", sessions: [] }), undefined);
  assert.equal(parseProfile(JSON.stringify({ ...base, history: { format: "x" } }))!.history, undefined);
});
