import test from "node:test";
import assert from "node:assert/strict";
import { applyAnswer, startRun, type EdgeRun } from "../src/lib/color/edges";

const base = { cone: "l" as const, peakDeg: 11.1, floor: 0.0105, sourceThreshold: 0.0568, sourceTimes: 5.4, profileSchema: "x", profileCreatedAt: "y", seed: 7 };
const seen = (r: EdgeRun) => applyAnswer(r, { picked: [r.oddIndex], none: false });
const miss = (r: EdgeRun) => applyAnswer(r, { picked: [], none: true });

/** Banda −5°…25° no vista; hasta llegar a la fase de profundidad. */
function toDepth(): EdgeRun {
  let r = startRun(base);
  for (let i = 0; i < 200 && r.phase !== "depth"; i++) r = r.catchTrial || !(r.angle >= -5 && r.angle <= 25) ? seen(r) : miss(r);
  assert.equal(r.phase, "depth");
  return r;
}
/** Avanza con «visto» a la escala del borde hasta que el cursor quede por debajo de la escala del borde. */
function belowEdge(): EdgeRun {
  let r = toDepth();
  for (let i = 0; i < 10 && r.scale >= r.edgeScale - 1e-9; i++) r = seen(r);
  assert.ok(r.phase === "depth" && r.scale < r.edgeScale, `${r.phase} ${r.scale} ${r.edgeScale}`);
  return r;
}

test("profundidad: un «visto» bajo la escala del borde no cuenta solo; se repite a la misma escala", () => {
  const r = belowEdge();
  const s = r.scale;
  const hi = r.depthHi;
  const a = seen(r);
  assert.equal(a.phase, "depth");
  assert.equal(a.scale, s);
  assert.equal(a.depthHi, hi);
  assert.equal(a.depthPending, s);
  const b = seen(a);
  assert.ok(b.depthHi <= s + 1e-12, `hi ${b.depthHi}`);
  assert.equal(b.depthPending, null);
});

test("profundidad: «visto» y luego «no visto» a la misma escala cuenta como fallo", () => {
  const r = belowEdge();
  const s = r.scale;
  const b = miss(seen(r));
  assert.ok(b.depthLo >= s - 1e-12 || b.phase === "confirm", `lo ${b.depthLo}`);
  assert.equal(b.depthPending ?? null, null);
});
