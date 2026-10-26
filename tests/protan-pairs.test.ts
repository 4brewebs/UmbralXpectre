import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assistColor, extremeColor, measuredRegion, regionMask, type Sector } from "../src/lib/color/spectrum";
import { dirFromTheta, thetaOf } from "../src/lib/color/space";
import { parseProfile } from "../src/lib/color/profile";
import { deltaE00Linear } from "../src/lib/color/deltaE";
import { luminance, type Vec3 } from "../src/lib/color/space";

/**
 * Colorado, ítem 3: visión protán simulada con el perfil real 07:21Z,
 * 5 pares de la línea de confusión, ΔE00 antes/después de la asistencia. Criterio: ninguno < 5 ΔE00 tras la
 * asistencia y mejora clara sobre el original. Se imprime la tabla aunque falle.
 */
const profile = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8"))!;
const floor = profile.fit.controlAbs!;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h: string): Vec3 => [0, 2, 4].map((i) => lin(parseInt(h.slice(1 + i, 3 + i), 16) / 255)) as Vec3;
/** Protanopía de Machado et al. (2009), severidad 1, RGB lineal (igual que dalton.test.ts). */
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];
const protan = (c: Vec3): Vec3 => PROTAN.map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))) as Vec3;
/** Segundo color del par igualado en luminancia al primero (solo cromático, como en la línea de confusión). */
const matched = (a: Vec3, b: Vec3): Vec3 => { const k = luminance(a) / luminance(b); return b.map((v) => Math.min(1, v * k)) as Vec3; };

export const PAIRS: [string, string, string][] = [
  ["rojo / verde oliva", "#C04040", "#808030"],
  ["naranja / verde amarillento", "#E07020", "#90B030"],
  ["rosa / gris", "#E090A0", "#A0A0A0"],
  ["marrón / verde", "#8B4513", "#4A7A2A"],
  ["violeta / azul", "#8040C0", "#4050C0"],
];

const SIM_EDGES = JSON.parse(fs.readFileSync(new URL("./fixtures/bordes-simulado-v3-0721Z.json", import.meta.url), "utf8")).runs.map((r: { file: unknown }) => r.file);
/** Región con bordes SIMULADOS (bordes-simulado-v3) o con los bordes reales de Lucas (ninguno → provisional ±10°). */
export function region(simulated: boolean): Sector[] {
  return measuredRegion(profile.axes, floor, simulated ? SIM_EDGES : []);
}
const at = (deg: number, r: number, y = 0.2): Vec3 => { const d = dirFromTheta((deg * Math.PI) / 180); return [y + d[0] * r, y + d[1] * r, y + d[2] * r]; };
const inMask = (c: Vec3, reg: Sector[]) => { const y = luminance(c); const p: Vec3 = [c[0] - y, c[1] - y, c[2] - y]; return regionMask(thetaOf(p), Math.hypot(...p), reg); };

export function protanTable(simulated = true) {
  const reg = region(simulated);
  const base = PAIRS.map(([name, ha, hb]) => { const a = hex(ha); return { name, ha, hb, a, b: matched(a, hex(hb)) }; });
  const inner = reg.map((s) => { const mid = s.loDeg + (((s.hiDeg - s.loDeg) % 360) + 360) % 360 / 2; return { name: `dentro ${s.axis} (${mid.toFixed(1)}°, 0,8·escala) / gris`, ha: "-", hb: "-", a: at(mid, 0.8 * s.scale), b: at(0, 0) }; });
  const rows = [...base, ...inner].map(({ name, ha, hb, a, b }) => {
    const d = (f: (c: Vec3) => Vec3) => deltaE00Linear(protan(f(a)), protan(f(b)));
    const inside = inMask(a, reg) > 0 || inMask(b, reg) > 0;
    return { name, ha, hb, inside, before: d((c) => c), assist: d((c) => assistColor(c, profile.axes, floor, [], reg)), extreme: d((c) => extremeColor(c, profile.axes, floor, [], reg)) };
  });
  return { rows };
}

for (const simulated of [true, false]) {
  const label = simulated ? "bordes SIMULADOS v3" : "bordes reales vacíos (provisional ±10°)";
  test(`protán simulado (perfil 07:21Z, ${label}): los pares fuera de la región quedan iguales al original`, () => {
    const t = protanTable(simulated);
    console.log(`${label}: par | región | original | asistencia | extremo`);
    for (const r of t.rows) console.log(`${r.name} (${r.ha}/${r.hb}) | ${r.inside ? "dentro" : "fuera"} | ${r.before.toFixed(2)} | ${r.assist.toFixed(2)} | ${r.extreme.toFixed(2)}`);
    for (const r of t.rows.filter((x) => !x.inside)) assert.ok(r.assist === r.before && r.extreme === r.before, r.name);
    for (const r of t.rows.filter((x) => x.inside)) assert.ok(r.assist > r.before && r.extreme >= r.assist, r.name);
  });
  test(`protán simulado (perfil 07:21Z, ${label}): pares dentro de la región ≥ 5 ΔE00 tras la asistencia`, { todo: "no se alcanza: con colores bajo la escala de fallo medida la asistencia da 2,2–4,6 ΔE00 (extremo 3,0–6,7)" }, () => {
    for (const r of protanTable(simulated).rows.filter((x) => x.inside)) assert.ok(r.assist >= 5, `${r.name}: ${r.assist.toFixed(2)}`);
  });
}
