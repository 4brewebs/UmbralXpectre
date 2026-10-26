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

test("pico visto: no se cierra; baja la escala y repite, sin lados «unexplored»", () => {
  // Observador: ve el disco en el pico mientras la escala sea > 0,012; por debajo, banda real [−30, 40].
  let r = startRun({ ...base, floor: 0.0059 });
  const start = r.edgeScale;
  for (let i = 0; i < 300 && r.phase !== "done" && r.phase !== "confirm"; i++) {
    const hidden = r.phase === "depth" ? r.scale < 0.01 : r.angle >= -30 && r.angle <= 40 && !(r.phase === "peak" && r.scale > 0.012);
    r = applyAnswer(r, hidden ? { picked: [], none: true } : { picked: [r.oddIndex], none: false });
  }
  const f = edgeFile(r);
  assert.ok((f.scaleLowered ?? 0) >= 1, JSON.stringify(f.scaleLowered));
  assert.ok(f.edgeScale < start && f.edgeScale <= 0.012 + 1e-4);
  assert.notEqual(f.band, "none");
  assert.notEqual(f.minus.result, "unexplored");
  assert.notEqual(f.plus.result, "unexplored");
});

test("escala de Bordes: entre 2× control y 0,8× umbral del eje; si no cabe, no se ofrece", async () => {
  const { edgeWindow } = await import("../src/lib/color/edges");
  // Perfil de Lucas 21:40Z: control 0,0059; rojos 0,0229; verdes 0,016.
  const red = edgeWindow(11.1, 0.0229, 0.0059);
  assert.ok(red.offered && red.scale >= 2 * 0.0059 - 1e-9 && red.scale <= 0.8 * 0.0229 + 1e-9, JSON.stringify(red));
  const green = edgeWindow(-156.7, 0.016, 0.0059);
  assert.ok(green.offered && green.scale >= 0.0118 - 1e-9 && green.scale <= 0.0128 + 1e-9, JSON.stringify(green));
  assert.equal(edgeWindow(11.1, 0.02, 0.0059 * 1.4).offered, false);
  const r = startRun({ ...base, floor: 0.0059 });
  assert.ok(Math.abs(r.edgeScale - red.scale) < 1e-9);
  assert.equal(edgeFile(r).offeredBecause, "2× control < 0.8× axis");
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
