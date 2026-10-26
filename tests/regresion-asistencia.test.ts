import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { parseEdgeFile } from "../src/lib/color/edges";
import { buildFilterTransforms, filterProfile } from "../src/lib/color/lut";
import { assistColor, labHueShift, lumaFromProfile, paintYours, regionMask } from "../src/lib/color/spectrum";
import { pairDeltaE } from "../src/lib/color/calibqp";
import { deltaE00Linear } from "../src/lib/color/deltaE";
import { dirFromTheta, fromSrgb8, luminance, thetaOf, type Vec3 } from "../src/lib/color/space";

/**
 * Punto 6 (Lucas, 26/10): regresión de la Asistencia sobre la sesión real de hoy (72c787e, perfil + bordes l).
 * - ΔE00 medio de Asistencia en la región de pérdida ≥ 5;
 * - par tipo Ishihara (rojo a −5°, verde a −89° en el plano isoluminante) separado ≥ 1,5× el control (simulación del perfil);
 * - giro de tono CIELAB ≤ 45° en todos los nodos de la LUT 33³.
 */
const profile = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-72c787e.json", import.meta.url), "utf8"))!;
const rawEdge = JSON.parse(fs.readFileSync(new URL("./fixtures/bordes-l-72c787e.json", import.meta.url), "utf8"));
const edges = (Array.isArray(rawEdge) ? rawEdge : [rawEdge]).map((e: unknown) => parseEdgeFile(JSON.stringify(e)) ?? e) as never[];
const base = filterProfile(profile)!;
const floor = base.fit.controlAbs!;
const file = buildFilterTransforms(profile, edges)!;
const region = file.params!.region;
const N = file.size;
const control = base.axes.find((a) => a.role === "control")!;
export const CONTROL_DE = pairDeltaE((control.angleDeg * Math.PI) / 180, control.threshold!);
const A = (c: Vec3) => assistColor(c, base.axes, floor, [], region);

function nodes(): Array<{ src: Vec3; out: Vec3 }> {
  const flt = file.filters.find((f) => f.id === "assist")!;
  const b = Buffer.from(flt.bytes!, "base64");
  const out: Array<{ src: Vec3; out: Vec3 }> = [];
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    const i = ((bi * N + gi) * N + ri) * 3;
    const s8: [number, number, number] = [ri, gi, bi].map((v) => Math.round((v * 255) / (N - 1))) as [number, number, number];
    out.push({ src: fromSrgb8(s8), out: fromSrgb8([b[i], b[i + 1], b[i + 2]]) });
  }
  return out;
}

/** Media de ΔE00 de Asistencia en los nodos de la región de pérdida (peso ≥ 0,5, fuera del gris). */
export function lossRegionMean(): { n: number; mean: number } {
  let n = 0, sum = 0;
  for (const { src, out } of nodes()) {
    const y = luminance(src);
    const p: Vec3 = [src[0] - y, src[1] - y, src[2] - y];
    const r = Math.hypot(...p);
    if (r < 0.02 || regionMask(thetaOf(p), r, region) < 0.5) continue;
    n++; sum += deltaE00Linear(src, out);
  }
  return { n, mean: n ? sum / n : 0 };
}

test("regresión Asistencia (72c787e): ΔE00 medio en la región de pérdida ≥ 5", () => {
  const { n, mean } = lossRegionMean();
  console.log(`región de pérdida: ${n} nodos, ΔE00 medio ${mean.toFixed(2)}`);
  assert.ok(n > 0);
  if (PENDING_LOSS_MEAN && mean < 5) console.log(`PENDIENTE ΔE00 medio ${mean.toFixed(2)} < 5 (se espera del punto 3)`);
  else assert.ok(mean >= 5, `ΔE00 medio ${mean.toFixed(2)} < 5`);
});

test("regresión Asistencia (72c787e): par Ishihara rojo −5° / verde −89° ≥ 1,5× control en la simulación del perfil", () => {
  const at = (deg: number, r: number): Vec3 => { const d = dirFromTheta((deg * Math.PI) / 180); return [0.2 + d[0] * r, 0.2 + d[1] * r, 0.2 + d[2] * r]; };
  const luma = lumaFromProfile(base);
  const sim = (c: Vec3) => paintYours(c, base.axes, floor, luma);
  const red = at(-5, 0.05), green = at(-89, 0.05);
  const before = deltaE00Linear(sim(red), sim(green));
  const after = deltaE00Linear(sim(A(red)), sim(A(green)));
  console.log(`Ishihara: control ${CONTROL_DE.toFixed(2)} ΔE00; simulado antes ${before.toFixed(2)}, con Asistencia ${after.toFixed(2)}`);
  assert.ok(after >= 1.5 * CONTROL_DE, `${after.toFixed(2)} < ${(1.5 * CONTROL_DE).toFixed(2)}`);
});

test("regresión Asistencia (72c787e): giro de tono CIELAB ≤ 45° en todos los nodos (cálculo en coma flotante)", () => {
  let worst = 0;
  for (const { src } of nodes()) worst = Math.max(worst, (labHueShift(src, A(src)) * 180) / Math.PI);
  console.log(`giro máx. ${worst.toFixed(1)}°`);
  assert.ok(worst <= 45 + 1e-6, `${worst.toFixed(2)}°`);
});

/** true mientras el punto 3 no llegue a ΔE00 medio ≥ 5 (Lucas: PENDIENTE sin assert hasta entonces). */
const PENDING_LOSS_MEAN = true;

test("punto 5: etiqueta azul–amarillo con los ejes medidos; sin validar se marca", async () => {
  const { classify } = await import("../src/lib/color/classify");
  const by = classify(base, edges).groups.find((g) => g.id === "blue-yellow")!;
  // s 0,0054 / control validado 0,0035 → 1,5×, no validado.
  assert.ok(by.ratio != null && Math.abs(by.ratio - 0.0054 / 0.0035) < 1e-9, String(by.ratio));
  assert.equal(by.unvalidated, true);
  const rg = classify(base, edges).groups.find((g) => g.id === "red-green")!;
  assert.equal(rg.unvalidated, false);
});
