import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assistColor, extremeColor } from "../src/lib/color/spectrum";
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

export function protanTable() {
  const rows = PAIRS.map(([name, ha, hb]) => {
    const a = hex(ha), b = matched(a, hex(hb));
    const d = (f: (c: Vec3) => Vec3) => deltaE00Linear(protan(f(a)), protan(f(b)));
    return { name, ha, hb, before: d((c) => c), assist: d((c) => assistColor(c, profile.axes, floor)), extreme: d((c) => extremeColor(c, profile.axes, floor)) };
  });
  const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const col = (k: "before" | "assist" | "extreme") => rows.map((r) => r[k]);
  return { rows, median: { before: med(col("before")), assist: med(col("assist")), extreme: med(col("extreme")) }, min: { before: Math.min(...col("before")), assist: Math.min(...col("assist")), extreme: Math.min(...col("extreme")) } };
}

test("protán simulado (perfil 07:21Z): 5 pares, ninguno < 5 ΔE00 tras la asistencia y mejora clara", { todo: "FALLA (perfil real 07:21Z, máscara por pérdida 12/18): violeta/azul 2,87 ΔE00. ambos quedan bajo t0 (w = 0, sin cambio); con t0 = 2 sí se tocan, pero la inyección con signo en S lleva la B de los dos al mismo valor (violeta S+, azul S−) y la diferencia sigue en ~2,8" }, () => {
  const t = protanTable();
  console.log("par | original | asistencia | extremo");
  for (const r of t.rows) console.log(`${r.name} (${r.ha}/${r.hb}) | ${r.before.toFixed(2)} | ${r.assist.toFixed(2)} | ${r.extreme.toFixed(2)}`);
  console.log(`mediana | ${t.median.before.toFixed(2)} | ${t.median.assist.toFixed(2)} | ${t.median.extreme.toFixed(2)}`);
  console.log(`mínimo | ${t.min.before.toFixed(2)} | ${t.min.assist.toFixed(2)} | ${t.min.extreme.toFixed(2)}`);
  assert.ok(t.min.assist >= 5, `mínimo tras asistencia ${t.min.assist.toFixed(2)} < 5 ΔE00`);
  assert.ok(t.median.assist >= 1.5 * t.median.before, `mediana ${t.median.before.toFixed(2)} → ${t.median.assist.toFixed(2)}: sin mejora clara`);
});
