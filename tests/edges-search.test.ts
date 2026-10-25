import test from "node:test";
import assert from "node:assert/strict";
import { applyAnswer, startRun, edgeFile, searchBounds, sectorOf, type EdgeRun } from "../src/lib/color/edges";
import { edgeNotches } from "../src/lib/color/spectrum";

const base = { cone: "l" as const, peakDeg: 11.1, floor: 0.024, sourceThreshold: 0.0229, sourceTimes: 2.5, profileSchema: "x", profileCreatedAt: "y", seed: 7 };

/** Observador determinista: no ve nada en [lo, hi], ve el disco fuera. */
function run(lo: number, hi: number, seenPeak = false): EdgeRun {
  let r = startRun(base);
  for (let i = 0; i < 200 && r.phase !== "done" && r.phase !== "confirm"; i++) {
    const inBand = r.phase === "depth" ? r.scale < 0.04 : r.angle >= lo && r.angle <= hi && !(seenPeak && r.angle >= r.peak - 0.05);
    r = applyAnswer(r, inBand ? { picked: [], none: true } : { picked: [r.oddIndex], none: false });
  }
  return r;
}

test("la búsqueda pasa del sector y para en el límite del gamut a Y constante", () => {
  const r = startRun(base);
  const b = searchBounds(r);
  const sector = sectorOf("l");
  assert.ok(b.hi > sector.hi && b.lo < sector.lo, JSON.stringify(b));
  assert.ok(b.hi - b.lo < 170);
});

test("borde real más allá del sector: se encuentra (found)", () => {
  const f = edgeFile(run(-30, 40));
  assert.equal(f.plus.result, "found");
  assert.ok((f.plus.angleDeg ?? 0) > sectorOf("l").hi, `${f.plus.angleDeg}`);
  assert.equal(f.minus.result, "found");
});

test("sin borde hasta el gamut: noEdgeToGamut, y cuenta como abierto para la asistencia", () => {
  const f = edgeFile(run(-30, 200));
  assert.equal(f.plus.result, "noEdgeToGamut");
  assert.equal(f.plus.toEnd, true);
  const [n] = edgeNotches([f]);
  assert.equal(n.hiOpen, true);
  assert.equal(n.loOpen, false);
});

test("lado sin explorar (visto ya en el pico): unexplored; escala ≥ 3× umbral, sin nota de pico bajo el umbral", () => {
  const f = edgeFile(run(-200, 200, true));
  assert.equal(f.minus.result, "unexplored");
  assert.ok(f.edgeScale >= 3 * f.sourceThreshold - 1e-4);
  assert.ok(!f.notes?.some((n) => n.startsWith("peak-seen-below-source")));
});

test("escala de Bordes: ≥ 3× umbral, ≥ 5 ΔE00 del gris, 1 ΔE00 ≤ 10°; si el gamut no deja, banda abierta", async () => {
  const { edgeScaleFor, angleForDeltaE } = await import("../src/lib/color/edges");
  // Verdes de Lucas (21:49Z): m a −156,7°, umbral 0,016.
  const g = edgeScaleFor(-156.7, 0.016);
  assert.equal(g.limited, false);
  assert.ok(g.scale >= 0.048 - 1e-6);
  assert.ok(angleForDeltaE(-156.7, g.scale, 1, 1) <= 10 && angleForDeltaE(-156.7, g.scale, -1, 1) <= 10);
  const big = edgeScaleFor(11.1, 0.0608);
  assert.equal(big.limited, true);
  const r = run(-30, 40);
  const limited = edgeFile({ ...r, scaleLimited: true, band: "closed" });
  assert.equal(limited.band, "open");
});

test("verde: un notch que cruza −180° pinta igual en el ángulo equivalente", async () => {
  const { colorFor } = await import("../src/lib/color/spectrum");
  const { dirFromTheta, ANCHOR } = await import("../src/lib/color/space");
  const file = { ...edgeFile(run(-30, 40)), cone: "m" as const, startAngleDeg: -170, confirmed: { minus: -200, plus: -150 }, minus: { found: true, toEnd: false, result: "found" as const, angleDeg: -200, insideDeg: -200, outsideDeg: -205 }, plus: { found: true, toEnd: false, result: "found" as const, angleDeg: -150, insideDeg: -150, outsideDeg: -145 } };
  const profile = { fit: { controlAbs: 0.024 }, axes: [], luminance: null } as never;
  const d = dirFromTheta((170 * Math.PI) / 180);
  const rgb = [ANCHOR + d[0] * 0.05, ANCHOR + d[1] * 0.05, ANCHOR + d[2] * 0.05] as [number, number, number];
  assert.notDeepEqual(colorFor("simulate", rgb, profile, "edges", [file]), rgb);
});
