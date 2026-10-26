import test from "node:test";
import { parseProfile } from "../src/lib/color/profile";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assistColor, extremeColor, paintYours, lumaFromProfile } from "../src/lib/color/spectrum";
import { buildTransformFile } from "../src/lib/color/lut";
import { deltaE00Linear } from "../src/lib/color/deltaE";
import { dirFromTheta, lineGap, luminance, thetaOf, type Vec3 } from "../src/lib/color/space";
import { correctColor, labHueShift, MASK_EDGE, measuredRegion, regionMask } from "../src/lib/color/spectrum";

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

test("solo lo medido: #C04040 vs #708030 (saturados, fuera de la región medida) quedan como el original", () => {
  const r = pairReport();
  assert.ok(Math.abs(r.assist - r.before) < 1e-9 && Math.abs(r.extreme - r.before) < 1e-9, JSON.stringify(r));
  assert.ok(Math.abs(r.y[0] - r.y[1]) < 1e-7 && Math.abs(r.y[2] - r.y[3]) < 1e-7);
});

test("daltonización: rojizo y verdoso a extremos opuestos de S, giro ≤ 45° (60° Extremo), dentro del gamut", () => {
  // Las dos cartas de la línea de confusión (mismo Y, ± dirección del eje l): a extremos opuestos de S.
  // Región medida: dentro del sector del eje y por debajo de su escala (umbral l 0,0568) → radio 0,045.
  const real = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
  const d = dirFromTheta((11.1 * Math.PI) / 180);
  const a: Vec3 = [0.22 + d[0] * 0.045, 0.22 + d[1] * 0.045, 0.22 + d[2] * 0.045];
  // Carta verdosa dentro del sector m (−156,7°) y bajo su escala (umbral 0,0237) → radio 0,02.
  const e = dirFromTheta((-156.7 * Math.PI) / 180);
  const b: Vec3 = [0.22 + e[0] * 0.02, 0.22 + e[1] * 0.02, 0.22 + e[2] * 0.02];
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

test("perfil de Lucas 21:40Z: Asistencia y Extremo cambian nodos (solo en la región medida)", () => {
  const t = buildTransformFile(profile);
  const changed = (id: string) => t.filters.find((f) => f.id === id)!.changed;
  assert.ok(changed("assist") > 0, `${changed("assist")}`);
  assert.ok(changed("extreme") > 0, `${changed("extreme")}`);
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
    // Asistencia/Extremo: región medida; con w = 0 el cambio es exactamente 0.
    if (regionMask(thetaOf(plane), Math.hypot(...plane), measuredRegion(profile.axes, floor)) === 0) {
      assert.deepEqual(assistColor(c, profile.axes, floor), c);
      assert.deepEqual(extremeColor(c, profile.axes, floor), c);
    }
  }
});

test("filtros del perfil: el rojo casi puro no se va a magenta (conserva su tono)", () => {
  const near: Vec3 = [0.75, 0.05, 0.05];
  for (const f of [assistColor, extremeColor]) assert.ok((labHueShift(near, f(near, profile.axes, floor)) * 180) / Math.PI < 15);
});

test("transforms: región por lados (borde / toEnd / punto medio al eje sano); sin bordes → punto medio, provisional", () => {
  const real = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
  const f = buildTransformFile(real);
  assert.equal(f.params?.mask, "región medida");
  assert.equal(f.params?.provisional, true);
  const r = (x: typeof f) => x.params!.region.map((s) => [s.axis, +s.loDeg.toFixed(2), +s.hiDeg.toFixed(2), s.minus.source, s.plus.source]);
  // l (11,1°): sanos control −37° y s 94,5° → puntos medios −12,95° y 52,8°. m (−156,7°): blue-end 107,7° y control −37°.
  assert.deepEqual(r(f), [["l", -12.95, 52.8, "midpointToHealthy", "midpointToHealthy"], ["m", -204.5, -96.85, "midpointToHealthy", "midpointToHealthy"]]);
  assert.ok(f.params?.notes.some((n) => n.startsWith("provisional:")));
  assert.ok(f.params?.notes.some((n) => n.startsWith("retirada «esquina azul")) && f.params?.notes.some((n) => n.startsWith("retirada «escalón cian")));
  assert.equal((f.params as { lossMask?: unknown }).lossMask, undefined);
  const sim = JSON.parse(fs.readFileSync(new URL("./fixtures/bordes-simulado-v3-0721Z.json", import.meta.url), "utf8")).runs.map((x: { file: unknown }) => x.file);
  const g = buildTransformFile(real, sim);
  assert.equal(g.params?.provisional, false);
  assert.deepEqual(r(g), [["l", 1.1, 22, "edge", "edge"], ["m", -164, -148.7, "edge", "edge"]]);
  // toEnd: banda lateral completa hasta el primer eje sano (s 94,5°).
  const open = structuredClone(sim);
  open[0].plus = { ...open[0].plus, found: false, toEnd: true, result: "noEdgeToGamut" };
  const h = buildTransformFile(real, open);
  assert.deepEqual(r(h)[0], ["l", 1.1, 94.5, "edge", "toEnd"]);
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

test("anillo de croma baja (r 0,01–0,08, paso 0,25°): exceso ≤ +1 ΔE00/1° en Asistencia y Mapa; ≤ +1,5 en Extremo (transición de 10°, Colorado acepta +1,0–1,5)", () => {
  const real = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
  const fl = real.fit.controlAbs!;
  const sim = JSON.parse(fs.readFileSync(new URL("./fixtures/bordes-simulado-v3-0721Z.json", import.meta.url), "utf8")).runs.map((x: { file: unknown }) => x.file);
  const at = (deg: number, r: number): Vec3 => { const d = dirFromTheta((deg * Math.PI) / 180); return [0.2 + d[0] * r, 0.2 + d[1] * r, 0.2 + d[2] * r]; };
  for (const edges of [sim, []]) {
    const reg = measuredRegion(real.axes, fl, edges);
    for (const [name, f, limit] of [
      ["asistencia", (c: Vec3) => assistColor(c, real.axes, fl, [], reg), 1],
      ["mapa", (c: Vec3) => correctColor(c, real.axes, fl, reg), 1],
      ["extremo", (c: Vec3) => extremeColor(c, real.axes, fl, [], reg), 1.5],
    ] as const) {
      let worst = -Infinity;
      for (const r of [0.01, 0.02, 0.03, 0.045, 0.06, 0.08]) for (let h = -180; h < 180; h += 0.25) {
        const a = at(h, r), b = at(h + 0.25, r);
        worst = Math.max(worst, (deltaE00Linear(f(a), f(b)) - deltaE00Linear(a, b)) * 4);
      }
      console.log(`anillo ${edges.length ? "simulados" : "reales"} ${name}: ${worst.toFixed(2)} ΔE00/1°`);
      assert.ok(worst <= limit, `${name} ${worst.toFixed(2)} > ${limit}`);
    }
  }
});
