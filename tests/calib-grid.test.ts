import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { answer, createSession, stimulusOf, DESCEND, type Session } from "../src/lib/color/session";
import { startRun, edgeFile } from "../src/lib/color/edges";
import { parseProfile } from "../src/lib/color/profile";

function play(seed: number, see: number): Session {
  let s = createSession(seed);
  for (let g = 0; !s.complete && g < 240; g++) {
    const st = stimulusOf(s);
    const a = s.axes.find((x) => x.id === s.activeId);
    s = answer(s, st?.catch ? "same" : a && a.cursor < see ? "same" : "different", g + 2);
  }
  return s;
}

test("rejilla de calibración hasta ≈0,006 lineal", () => {
  const s = createSession(1);
  const control = s.axes.find((a) => a.id === "control")!;
  assert.ok(DESCEND.at(-1)! * control.maxS <= 0.0065, `${DESCEND.at(-1)! * control.maxS}`);
});

test("un control bueno (0,010) se mide como estimación, no queda en la cota de la rejilla", () => {
  const control = play(1, 0.01).axes.find((a) => a.id === "control")!;
  assert.equal(control.thresholdKind, "estimate");
  assert.ok(Math.abs((control.threshold ?? 0) - 0.01) < 0.004, `${control.threshold}`);
});

test("arranque ±1 peldaño: semillas distintas empiezan en niveles distintos", () => {
  const starts = new Set<string>();
  for (let seed = 1; seed < 40; seed++) starts.add(createSession(seed * 7919).axes.map((a) => a.descendStart).join(","));
  assert.ok(starts.size > 1);
  for (const a of createSession(3).axes) assert.ok([0, 1, 2].includes(a.descendStart!));
});

test("control acotado: el suelo de bordes es el umbral de la banda; la escala la fija el umbral (≥ 3×) o el gamut", () => {
  const p = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-movil.json", import.meta.url), "utf8"))!;
  assert.equal(p.fit.controlBounded, true);
  assert.equal(p.fit.timesControlKind, "at-least");
  const run = startRun({ cone: "l", peakDeg: 11.1, floor: 0.024, sourceThreshold: 0.0608, sourceTimes: 2.5, profileSchema: "x", profileCreatedAt: "y", controlBounded: true });
  assert.equal(run.floor, 0.0608);
  // 3 × 0,0608 no cabe con 20° de búsqueda a cada lado: la mayor que cabe, y banda abierta.
  assert.ok(run.edgeScale > 0.0608);
  assert.equal(run.scaleLimited, true);
  assert.equal(edgeFile(run).floorFrom, "band");
});
