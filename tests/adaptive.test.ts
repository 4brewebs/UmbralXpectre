import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { parseEdgeFile } from "../src/lib/color/edges";
import { adaptiveColor, measuredRegion, pairMetric } from "../src/lib/color/spectrum";
import { buildTransformFile } from "../src/lib/color/lut";
import { lossPoints, ratioAt } from "../src/lib/color/lossmap";
import { ANCHOR, addScaled, dirFromTheta, type Vec3 } from "../src/lib/color/space";

const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const profile = parseProfile(fx("perfil-v3-0721Z.json"))!;
const floor = profile.fit.controlAbs!;
const real = ["bordes-rojos-1240Z.json", "bordes-verdes-1241Z.json"].map((f) => parseEdgeFile(fx(f))!);
const sim = JSON.parse(fx("bordes-simulado-v3-0721Z.json")).runs.map((r: any) => r.file);

function plate(role: string): Array<[Vec3, Vec3]> {
  const axis = profile.axes.find((a) => a.role === role)!;
  const dir = dirFromTheta((axis.angleDeg * Math.PI) / 180);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0), seed / 4294967296);
  const out: Array<[Vec3, Vec3]> = [];
  for (let i = 0; i < 80; i++) {
    const a = axis.threshold! * (0.82 + rnd() * 0.18);
    const n = (rnd() * 2 - 1) * 0.028;
    const m = (sg: number) => addScaled([ANCHOR, ANCHOR, ANCHOR], dir, sg * a).map((c) => c + n) as Vec3;
    out.push([m(1), m(-1)]);
  }
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("A: la profundidad real del rojizo (0,0084) se recorta a floor en la región", () => {
  assert.equal(real[0].depth!.scale, 0.0084);
  const l = measuredRegion(profile.axes, floor, real).find((s) => s.axis.startsWith("l"))!;
  assert.ok(l.scale >= floor - 1e-12, `${l.scale}`);
});

test("B: la métrica usa la misma T interpolada que «Zonas de confusión» y la lámina l sin filtro da < 1", () => {
  for (const edges of [real, sim, []]) {
    const pairs = plate("l");
    const m = mean(pairs.map(([a, b]) => pairMetric(a, b, profile.axes, floor, measuredRegion(profile.axes, floor, edges))));
    assert.ok(m < 1, `l sin filtro ${m}`);
  }
  const pts = lossPoints(profile, real).points;
  assert.ok(Math.abs(ratioAt(pts, 11.1) - 0.0568 / floor) < 0.05);
});

test("C: la ganancia adaptativa lleva la lámina m (bordes simulados) a ≥ 1,5 / ≥ 2 y no toca fuera de la región", () => {
  const region = measuredRegion(profile.axes, floor, sim);
  for (const [ex, target] of [[false, 1.5], [true, 2]] as const) {
    const m = mean(plate("m").map(([a, b]) => pairMetric(adaptiveColor(a, profile.axes, floor, ex, region).out, adaptiveColor(b, profile.axes, floor, ex, region).out, profile.axes, floor, region)));
    assert.ok(m >= target, `m ${ex ? "extremo" : "asistencia"} ${m}`);
  }
  const grey: Vec3 = [0.3, 0.3, 0.3];
  assert.deepEqual(adaptiveColor(grey, profile.axes, floor, false, region).out, grey);
});

test("C: el JSON de transformaciones resume el factor y marca «limitado por tope»", () => {
  const file = buildTransformFile(profile, real);
  for (const id of ["assist", "extreme"] as const) {
    const f = file.filters.find((x) => x.id === id)!;
    assert.ok(f.adaptive, id);
    assert.ok(f.adaptive!.kMax <= 4 + 1e-9);
    assert.equal(f.adaptive!.status, f.adaptive!.limitedNodes > 0 ? "limitado por tope" : "meta alcanzada");
    if (f.adaptive!.limitedNodes > 0) assert.match(f.note, /Limitado por tope/);
  }
});
