import test from "node:test";
import { parseProfile } from "../src/lib/color/profile";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assistColor, extremeColor, paintYours, lumaFromProfile } from "../src/lib/color/spectrum";
import { buildTransformFile } from "../src/lib/color/lut";
import { deltaE00Linear } from "../src/lib/color/deltaE";
import { dirFromTheta, lineGap, luminance, thetaOf, type Vec3 } from "../src/lib/color/space";
import { correctColor, labHueShift, MASK_EDGE, lossMask } from "../src/lib/color/spectrum";

const profile = JSON.parse(fs.readFileSync(new URL("./fixtures/perfil-v3-qp-2140Z.json", import.meta.url), "utf8"));
const floor = profile.fit.controlAbs;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h: string): Vec3 => [0, 2, 4].map((i) => lin(parseInt(h.slice(1 + i, 3 + i), 16) / 255)) as Vec3;
/** Protanopía de Machado et al. (2009), severidad 1, en RGB lineal. Solo para el test. */
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];
const protan = (c: Vec3): Vec3 => PROTAN.map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))) as Vec3;
const pair = (): [Vec3, Vec3] => {
  const a = hex("#C04040");
  const b0 = hex("#708030");
  const k = luminance(a) / luminance(b0);
  return [a, b0.map((v) => v * k) as Vec3];
};

export function pairReport() {
  const [a, b] = pair();
  const luma = lumaFromProfile(profile);
  const as = assistColor(a, profile.axes, floor), bs = assistColor(b, profile.axes, floor);
  const ex = extremeColor(a, profile.axes, floor), bx = extremeColor(b, profile.axes, floor);
  return {
    before: deltaE00Linear(protan(a), protan(b)),
    assist: deltaE00Linear(protan(as), protan(bs)),
    extreme: deltaE00Linear(protan(ex), protan(bx)),
    profileSimAssist: deltaE00Linear(paintYours(as, profile.axes, floor, luma), paintYours(bs, profile.axes, floor, luma)),
    y: [luminance(a), luminance(as), luminance(b), luminance(bs)],
  };
}

test("daltonización: #C04040 vs #708030 (misma Y) ≥ 10 ΔE00 en simulación protan tras Asistencia", () => {
  const r = pairReport();
  assert.ok(r.assist >= 10, JSON.stringify(r));
  assert.ok(r.extreme >= r.assist - 1e-9, JSON.stringify(r));
  // Solo croma: la Y no cambia.
  assert.ok(Math.abs(r.y[0] - r.y[1]) < 1e-7 && Math.abs(r.y[2] - r.y[3]) < 1e-7);
});

test("daltonización: rojizo y verdoso a extremos opuestos de S, giro ≤ 45° (60° Extremo), dentro del gamut", () => {
  // Las dos cartas de la línea de confusión (mismo Y, ± dirección del eje l): a extremos opuestos de S.
  // Máscara por pérdida (base t0 = 14): con el perfil 21:40Z la carta rojiza ya no pierde bastante; se usa el real 07:21Z.
  const real = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
  const d = dirFromTheta((11.1 * Math.PI) / 180);
  const a: Vec3 = [0.22 + d[0] * 0.22, 0.22 + d[1] * 0.22, 0.22 + d[2] * 0.22];
  const b: Vec3 = [0.22 - d[0] * 0.22, 0.22 - d[1] * 0.22, 0.22 - d[2] * 0.22];
  const blue = (c: Vec3) => c[2] - (c[0] + c[1]) / 2;
  const da = blue(assistColor(a, real.axes, real.fit.controlAbs!)) - blue(a);
  const db = blue(assistColor(b, real.axes, real.fit.controlAbs!)) - blue(b);
  assert.ok(da * db < 0, `${da} ${db}`);
  for (let i = 0; i < 400; i++) {
    const c: Vec3 = [((i * 37) % 101) / 100, ((i * 53) % 103) / 102, ((i * 71) % 107) / 106];
    const y = luminance(c);
    for (const [f, cap] of [[assistColor, 45], [extremeColor, 60]] as const) {
      const o = f(c, profile.axes, floor);
      assert.ok(o.every((v) => v >= -1e-9 && v <= 1 + 1e-9));
      assert.ok(Math.abs(luminance(o) - y) < 1e-7);
      const p0: Vec3 = [c[0] - y, c[1] - y, c[2] - y];
      const p1: Vec3 = [o[0] - y, o[1] - y, o[2] - y];
      if (Math.hypot(...p0) < 1e-3 || Math.hypot(...p1) < 1e-3) continue;
      let d = Math.abs(thetaOf(p1) - thetaOf(p0));
      if (d > Math.PI) d = 2 * Math.PI - d;
      assert.ok((d * 180) / Math.PI <= cap + 0.5, `${(d * 180) / Math.PI}`);
    }
  }
});

test("perfil de Lucas 21:40Z: Asistencia y Extremo ya cambian nodos", () => {
  const t = buildTransformFile(profile);
  const changed = (id: string) => t.filters.find((f) => f.id === id)!.changed;
  assert.ok(changed("assist") > 1000, `${changed("assist")}`);
  assert.ok(changed("extreme") > 1000, `${changed("extreme")}`);
});

test("filtros del perfil (Colorado, 7.ª ronda): #FF0000 con Asistencia gira ≤ 45° CIELAB y ≤ 32 % de los nodos cambian (objetivo 30 %)", () => {
  const red: Vec3 = [1, 0, 0];
  for (const [f, cap] of [[assistColor, 45], [extremeColor, 60], [correctColor, 45]] as const) {
    const dh = (labHueShift(red, f(red, profile.axes, floor)) * 180) / Math.PI;
    assert.ok(dh <= cap + 1e-6, `${dh}`);
  }
  const t = buildTransformFile(profile);
  const changed = (id: string) => t.filters.find((x) => x.id === id)!.changed;
  assert.equal(t.nodes, 35937);
  assert.ok(changed("assist") <= 0.32 * 35937, `${changed("assist")}`);
});

test("filtros del perfil: giro CIELAB por nodo ≤ 45° (60° Extremo); fuera de la máscara el cambio es exactamente 0", () => {
  const mid = (11.1 * Math.PI) / 180;
  for (let i = 0; i < 600; i++) {
    const c: Vec3 = [((i * 37) % 101) / 100, ((i * 53) % 103) / 102, ((i * 71) % 107) / 106];
    for (const [f, cap] of [[assistColor, 45], [extremeColor, 60], [correctColor, 45]] as const) {
      const o = f(c, profile.axes, floor);
      assert.ok((labHueShift(c, o) * 180) / Math.PI <= cap + 0.5);
    }
    const y = luminance(c);
    const plane: Vec3 = [c[0] - y, c[1] - y, c[2] - y];
    if (Math.hypot(...plane) > 1e-3 && lineGap(thetaOf(plane), mid) >= MASK_EDGE) assert.deepEqual(correctColor(c, profile.axes, floor), c);
    // Asistencia/Extremo: máscara por pérdida; con w = 0 el cambio es exactamente 0.
    if (lossMask(c, profile.axes, floor) === 0) {
      assert.deepEqual(assistColor(c, profile.axes, floor), c);
      assert.deepEqual(extremeColor(c, profile.axes, floor), c);
    }
  }
});

test("filtros del perfil: el rojo casi puro no se va a magenta (conserva su tono)", () => {
  const near: Vec3 = [0.75, 0.05, 0.05];
  for (const f of [assistColor, extremeColor]) assert.ok((labHueShift(near, f(near, profile.axes, floor)) * 180) / Math.PI < 15);
});

test("transforms: guarda t0/t1 de la máscara por pérdida y la limitación conocida (sin derrame a Y)", () => {
  const f = buildTransformFile(profile) as { params?: { lossMask: { t0: number; t1: number }; notes: string[]; lightSpill?: unknown } };
  assert.deepEqual(f.params?.lossMask, { t0: 14, t1: 20 });
  assert.deepEqual(f.params?.notes, ["esquina azul saturada de la gama: sin corrección"]);
  assert.equal(f.params?.lightSpill, undefined);
});

test("barrido HSV 1° (S 100 y 50 %): escalón filtrado ≤ escalón original + 1 ΔE00 (Asistencia y Extremo, perfil 07:21Z)", () => {
  const real = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
  const hsv = (h: number, s: number): Vec3 => {
    const g = (n: number) => { const k = (n + h / 60) % 6; return 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [g(5), g(3), g(1)].map(lin) as Vec3;
  };
  const bad: string[] = [];
  for (const [name, f] of [["asistencia", assistColor], ["extremo", extremeColor]] as const) for (const s of [1, 0.5]) {
    let worst = -Infinity, at = 0;
    for (let h = 0; h < 360; h++) {
      const ex = deltaE00Linear(f(hsv(h, s), real.axes, real.fit.controlAbs!), f(hsv(h + 1, s), real.axes, real.fit.controlAbs!)) - deltaE00Linear(hsv(h, s), hsv(h + 1, s));
      if (ex > worst) { worst = ex; at = h; }
    }
    console.log(`${name} S${s * 100}: exceso máx ${worst.toFixed(2)} ΔE00 en ${at}→${at + 1}°`);
    if (worst > 1) bad.push(`${name} S${s * 100} ${worst.toFixed(2)} @${at}°`);
  }
  assert.deepEqual(bad, []);
});
