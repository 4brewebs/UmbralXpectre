import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { depthScale, fileDepth, parseEdgeFile, peakFailed } from "../src/lib/color/edges";
import { adaptiveColor, colorFor, measuredRegion, pairMetric } from "../src/lib/color/spectrum";
import { buildFilterLuts } from "../src/lib/color/lut";
import { deltaE00Linear } from "../src/lib/color/deltaE";
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

test("A: profundidad = max(estimación, edgeScale si el pico falló), techo el umbral del eje, también en archivos guardados", () => {
  assert.equal(real[0].depth!.scale, 0.0084);
  assert.ok(peakFailed(real[0].trials, real[0].edgeScale));
  assert.equal(fileDepth(real[0], floor, 0.0568), 0.0268);
  assert.equal(fileDepth(real[1], floor, 0.0237), 0.0195);
  assert.equal(depthScale(0.03, 0.04, floor, 0.0237), 0.0237);
  assert.equal(depthScale(0.005, 0, floor, 0.05), floor);
  const l = measuredRegion(profile.axes, floor, real).find((s) => s.axis.startsWith("l"))!;
  assert.equal(l.scale, 0.0268);
});

test("B: la métrica usa la misma T interpolada que «Zonas de confusión» y la lámina l sin filtro da < 1", () => {
  for (const edges of [real, sim, []]) {
    const pairs = plate("l");
    const m = mean(pairs.map(([a, b]) => pairMetric(a, b, profile.axes, floor)));
    assert.ok(m < 1, `l sin filtro ${m}`);
  }
  const pts = lossPoints(profile, real).points;
  assert.ok(Math.abs(ratioAt(pts, 11.1) - 0.0568 / floor) < 0.05);
});

test("C: lámina m (bordes simulados): cada par llega a 1,5 / 2 o queda «limitado por tope»; el gris no se toca", () => {
  // Con T del mayor de los dos sentidos (T(m) 0,0237 frente a 0,0444 al otro lado) la lámina m no llega a la meta con
  // los topes de giro y croma: lo correcto es que lo diga (limited), no que alcance un número.
  const region = measuredRegion(profile.axes, floor, sim);
  for (const [ex, target] of [[false, 1.5], [true, 2]] as const) {
    for (const [a, b] of plate("m")) {
      const ra = adaptiveColor(a, profile.axes, floor, ex, region);
      const rb = adaptiveColor(b, profile.axes, floor, ex, region);
      const m = pairMetric(ra.out, rb.out, profile.axes, floor, [a, b]);
      assert.ok(m >= target - 1e-3 || ra.limited || rb.limited, `m ${ex ? "extremo" : "asistencia"} ${m} sin marcar`);
      assert.ok(m > pairMetric(a, b, profile.axes, floor, [a, b]), "el filtro separa más que el original");
    }
  }
  const grey: Vec3 = [0.3, 0.3, 0.3];
  assert.deepEqual(adaptiveColor(grey, profile.axes, floor, false, region).out, grey);
});

test("lámina m en Bordes (13:33Z/13:36Z): «tocar solo lo medido» deja el fondo casi quieto y la métrica por debajo de Perfil", () => {
  // Nota real (26/10): Perfil asistencia 1,21, Bordes 0,85. El fondo de la lámina m cae fuera de la región medida.
  const pairs = plate("m");
  const met = (src: "profile" | "edges") => mean(pairs.map(([a, b]) => pairMetric(colorFor("assist", a, profile, src, fresh), colorFor("assist", b, profile, src, fresh), profile.axes, floor, [a, b])));
  const bgMove = mean(pairs.map(([, b]) => deltaE00Linear(b, colorFor("assist", b, profile, "edges", fresh))));
  assert.ok(met("edges") < met("profile"));
  assert.ok(bgMove < 1, `fondo ${bgMove}`);
  assert.ok(mean(pairs.map(([a]) => deltaE00Linear(a, colorFor("assist", a, profile, "edges", fresh)))) >= 3);
});

test("C: el JSON de transformaciones resume el factor y marca «limitado por tope»", () => {
  const file = buildTransformFile(profile, real);
  for (const id of ["assist-profile", "extreme-profile", "assist-edges", "extreme-edges"] as const) {
    const f = file.filters.find((x) => x.id === id)!;
    assert.ok(f.adaptive, id);
    assert.ok(f.adaptive!.kMax <= 4 + 1e-9);
    assert.equal(f.adaptive!.status, f.adaptive!.limitedNodes > 0 ? "limitado por tope" : "meta alcanzada");
    if (f.adaptive!.limitedNodes > 0) assert.match(f.note, /Limitado por tope/);
  }
});

const fresh = ["bordes-rojos-1333Z.json", "bordes-verdes-1336Z.json"].map((f) => parseEdgeFile(fx(f))!);

test("modos separados: Perfil da los mismos bytes con bordes y sin bordes; Bordes sin bordes = Perfil", () => {
  const withE = buildTransformFile(profile, fresh);
  const without = buildTransformFile(profile, []);
  for (const id of ["assist-profile", "extreme-profile"] as const) {
    assert.equal(withE.filters.find((f) => f.id === id)!.bytes, without.filters.find((f) => f.id === id)!.bytes, id);
  }
  for (const k of ["assist", "extreme"] as const) {
    assert.equal(without.filters.find((f) => f.id === `${k}-edges`)!.bytes, without.filters.find((f) => f.id === `${k}-profile`)!.bytes, k);
    assert.notEqual(withE.filters.find((f) => f.id === `${k}-edges`)!.bytes, withE.filters.find((f) => f.id === `${k}-profile`)!.bytes, k);
  }
  const a = buildFilterLuts(profile, "profile", fresh);
  const b = buildFilterLuts(profile, "profile", []);
  assert.deepEqual(a.assist, b.assist);
  assert.deepEqual(buildFilterLuts(profile, "edges", []).extreme, b.extreme);
});

test("bordes 13:33Z/13:36Z: la lámina l llega a 1,49 o queda «limitado por tope» (JSON incluido) y la figura se mueve ≥ 3 ΔE00", () => {
  const file = buildTransformFile(profile, fresh);
  for (const source of ["profile", "edges"] as const) {
    const pairs = plate("l");
    const f = (c: Vec3) => colorFor("assist", c, profile, source, fresh);
    const m = mean(pairs.map(([a, b]) => pairMetric(f(a), f(b), profile.axes, floor, [a, b])));
    const move = mean(pairs.map(([a]) => deltaE00Linear(a, f(a))));
    assert.ok(move >= 3, `${source} movimiento ${move}`);
    if (m < 1.49) {
      const region = measuredRegion(profile.axes, floor, source === "edges" ? fresh : []);
      assert.ok(pairs.some(([a]) => adaptiveColor(a, profile.axes, floor, false, region).limited), `${source} ${m} sin marcar`);
      const j = file.filters.find((x) => x.id === `assist-${source}`)!;
      assert.equal(j.adaptive!.status, "limitado por tope");
      assert.match(j.note, /Limitado por tope/);
    }
  }
});
