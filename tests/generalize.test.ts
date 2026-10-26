import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile, type UmbralProfile } from "../src/lib/color/profile";
import { assistColor, corrections, extremeColor, filterTexts, labHueShift, lumaFromProfile, measuredRegion, paintYours } from "../src/lib/color/spectrum";
import { classify } from "../src/lib/color/classify";
import { pairDeltaE } from "../src/lib/color/calibqp";
import { dirFromTheta, type Vec3 } from "../src/lib/color/space";
import { deltaE00Linear } from "../src/lib/color/deltaE";

const raw = fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8");
const C = 0.0105;
/** Perfil sintético: umbrales por rol = C × factor; lo elevado pasa a «estimate». */
export const mk = (f: Record<string, number>, redEff?: number): UmbralProfile => {
  const p = parseProfile(raw)!;
  for (const a of p.axes) if (a.role && f[a.role] != null) {
    a.threshold = C * f[a.role];
    if (f[a.role] > 1.6) a.thresholdKind = "estimate";
  }
  if (redEff != null) for (const m of (p.luminance as any).measuredMatches) if (m.id === "rojo") m.efficiency = redEff;
  return p;
};
export const PROFILES: Record<string, () => UmbralProfile> = {
  real: () => parseProfile(raw)!,
  deutan: () => mk({ m: 5, l: 1.2, "red-end": 1 }, 1.0),
  tritan: () => mk({ s: 5, "blue-end": 5, l: 1, m: 1, "red-end": 1 }, 1.0),
  mixed: () => mk({ l: 2, m: 2, "red-end": 1 }),
  low: () => mk({ l: 1.65, m: 1.65, "red-end": 1 }),
  normal: () => mk({ l: 1, m: 1, "red-end": 1, s: 0.9, "blue-end": 0.7 }, 1.0),
};
const at = (deg: number, r: number, y = 0.2): Vec3 => { const d = dirFromTheta((deg * Math.PI) / 180); return [y + d[0] * r, y + d[1] * r, y + d[2] * r]; };
const real = PROFILES.real();
const ctl = real.axes.find((a) => a.role === "control")!;
const CDE = pairDeltaE((ctl.angleDeg * Math.PI) / 180, ctl.threshold!);
export const CORNERS: Array<[string, Vec3]> = [["R", [1, 0, 0]], ["G", [0, 1, 0]], ["B", [0, 0, 1]], ["C", [0, 1, 1]], ["M", [1, 0, 1]], ["Y", [1, 1, 0]]];

export function evaluate(p: UmbralProfile) {
  const fl = p.fit.controlAbs!, luma = lumaFromProfile(p), reg = measuredRegion(p.axes, fl, []);
  const sim = (c: Vec3) => paintYours(c, p.axes, fl, luma);
  const A = (c: Vec3) => assistColor(c, p.axes, fl, [], reg), E = (c: Vec3) => extremeColor(c, p.axes, fl, [], reg);
  const rows = reg.flatMap((s) => [[at(s.centerDeg, 0.8 * s.scale), at(0, 0)], [at(s.centerDeg, 0.8 * s.scale), at(s.centerDeg + 180, 0.8 * s.scale)]] as Array<[Vec3, Vec3]>)
    .map(([a, b]) => ({ assist: deltaE00Linear(sim(A(a)), sim(A(b))), extreme: deltaE00Linear(sim(E(a)), sim(E(b))) }));
  const corners = CORNERS.map(([n, c]) => ({ n, assist: Math.abs(labHueShift(c, A(c)) * 180 / Math.PI), extreme: Math.abs(labHueShift(c, E(c)) * 180 / Math.PI) }));
  return { reg, rows, corners, corr: corrections(p.axes, fl, reg), texts: filterTexts(p.axes, fl, reg), minA: Math.min(99, ...rows.map((r) => r.assist)), minE: Math.min(99, ...rows.map((r) => r.extreme)) };
}

for (const name of ["real", "deutan", "tritan", "mixed", "low"]) {
  test(`generalización ${name}: dentro de la región ≥ 1,5× control (asist.) y ≥ 2× (extr.); esquinas Δh ≤ 10° en Asistencia`, () => {
    const e = evaluate(PROFILES[name]());
    assert.ok(e.reg.length > 0);
    assert.ok(e.minA >= 1.5 * CDE, `asist ${e.minA.toFixed(2)} < ${(1.5 * CDE).toFixed(2)}`);
    assert.ok(e.minE >= 2 * CDE, `extr ${e.minE.toFixed(2)} < ${(2 * CDE).toFixed(2)}`);
    for (const c of e.corners) assert.ok(c.assist <= 10 + 1e-9, `${c.n} ${c.assist.toFixed(2)}°`);
    for (const c of e.corr) assert.notEqual(c.targetId, "perpendicular", `${c.axisId} sin vía sana`);
  });
}

test("generalización normal: sin eje elevado, ningún sector y ningún color cambia", () => {
  const e = evaluate(PROFILES.normal());
  assert.equal(e.reg.length, 0);
  for (const [, c] of CORNERS) assert.deepEqual(assistColor(c, PROFILES.normal().axes, C, []), c);
});

test("mixto: cada eje elevado tiene su línea, objetivo y sector propios", () => {
  const e = evaluate(PROFILES.mixed());
  assert.deepEqual(e.corr.map((c) => c.role).sort(), ["l", "m"]);
  assert.equal(new Set(e.corr.map((c) => c.sector)).size, 2);
});

test("tritán: el sector se estrecha (antes 180°) al primer eje sano", () => {
  const [s] = evaluate(PROFILES.tritan()).reg;
  assert.ok(s.hiDeg - s.loDeg < 120, `${s.loDeg}…${s.hiDeg}`);
});

test("sin vía sana medida: no corrige (solo mapa)", () => {
  const axes = [{ id: "l", role: "l", angleDeg: 11.1, threshold: 0.06, thresholdKind: "estimate" }];
  assert.deepEqual(corrections(axes, C), []);
  const red = at(11.1, 0.03);
  assert.deepEqual(assistColor(red, axes, C, []), red);
  assert.match(filterTexts(axes, C).assist, /no corrige/);
});

test("textos generados desde (vía elevada, vía objetivo), sin «rojo o el verde» fijo", () => {
  for (const name of ["real", "deutan", "tritan"]) {
    const t = evaluate(PROFILES[name]()).texts;
    assert.ok(!/rojo o el verde|rojo perdido/.test(t.assist + t.simulate), t.assist);
    for (const p of t.pairs) assert.ok(t.assist.includes(p.elevated) && t.assist.includes(p.target), t.assist);
  }
});

test("clasificación: real → compatible con protán (eficiencia 0,666)", () => {
  const c = classify(real);
  assert.equal(c.compatible, "protan");
  assert.ok(Math.abs(c.luminance!.efficiency - 0.6664) < 1e-4);
  assert.match(c.text, /^Compatible con tipo protán \(rojo–verde\)/);
  assert.match(c.disclaimer, /no es un diagnóstico/);
  assert.deepEqual(c.groups.map((g) => g.name), ["Eje rojo–verde", "Eje azul–amarillo"]);
});
test("clasificación: deután sintético (eficiencia 1,0) → compatible con deután", () => assert.equal(classify(PROFILES.deutan()).compatible, "deutan"));
test("clasificación: solo azul–amarillo elevado → compatible con tritán", () => assert.equal(classify(PROFILES.tritan()).compatible, "tritan"));
test("clasificación: normal → sin alteración medida", () => assert.equal(classify(PROFILES.normal()).compatible, "none"));
test("clasificación: eficiencia 0,87 → tipo sin determinar (nunca se fuerza)", () => assert.equal(classify(mk({}, 0.87)).compatible, "red-green-undetermined"));
test("clasificación: mixto (los dos ejes) muestra ambos", () => {
  const c = classify(mk({ l: 3, s: 4 }));
  assert.equal(c.compatible, "mixed");
  assert.ok(c.groups.every((g) => g.elevated));
});
test("clasificación: bordes que contradicen la luminancia → sin determinar", () => {
  const edge = { cone: "l", band: "closed", minus: { found: true, angleDeg: 15, insideDeg: 15, outsideDeg: 14 }, plus: { found: true, angleDeg: 25, insideDeg: 25, outsideDeg: 26 } } as any;
  assert.equal(classify(real, [edge]).compatible, "red-green-undetermined");
});
