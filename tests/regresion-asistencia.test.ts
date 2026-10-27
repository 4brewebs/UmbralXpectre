import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { parseEdgeFile } from "../src/lib/color/edges";
import { filterProfile } from "../src/lib/color/lut";
import { pairDeltaE } from "../src/lib/color/calibqp";
import { deltaE00Linear } from "../src/lib/color/deltaE";
import { dirFromTheta, luminance, type Vec3 } from "../src/lib/color/space";

/**
 * Punto 6 (Lucas, 26/10): regresión sobre la sesión real 72c787e (perfil + bordes l). Los criterios del filtro
 * anterior (ΔE00 medio ≥ 5, par Ishihara ≥ 1,5× control, giro ≤ 45°) se retiraron con el asistido por franja (27/10):
 * su paridad y sus controles están en asistido-franja.test.ts.
 */
const profile = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-72c787e.json", import.meta.url), "utf8"))!;
const rawEdge = JSON.parse(fs.readFileSync(new URL("./fixtures/bordes-l-72c787e.json", import.meta.url), "utf8"));
const edges = (Array.isArray(rawEdge) ? rawEdge : [rawEdge]).map((e: unknown) => parseEdgeFile(JSON.stringify(e)) ?? e) as never[];
const base = filterProfile(profile)!;
const control = base.axes.find((a) => a.role === "control")!;
export const CONTROL_DE = pairDeltaE((control.angleDeg * Math.PI) / 180, control.threshold!);

test("punto 5: etiqueta azul–amarillo con los ejes medidos; sin validar se marca", async () => {
  const { classify } = await import("../src/lib/color/classify");
  const by = classify(base, edges).groups.find((g) => g.id === "blue-yellow")!;
  // s 0,0054 / control validado 0,0035 → 1,5×, no validado.
  assert.ok(by.ratio != null && Math.abs(by.ratio - 0.0054 / 0.0035) < 1e-9, String(by.ratio));
  assert.equal(by.unvalidated, true);
  const rg = classify(base, edges).groups.find((g) => g.id === "red-green")!;
  assert.equal(rg.unvalidated, false);
});

test("punto 4: simulador (Perfil y Bordes) solo encoge la componente en la línea l: |p| no crece ni cambia de signo (sin derrame)", async () => {
  const { colorFor } = await import("../src/lib/color/spectrum");
  const l = dirFromTheta((base.axes.find((a) => a.id === "l")!.angleDeg * Math.PI) / 180);
  let worst = 0;
  for (const source of ["profile", "edges"] as const) for (let h = -40; h <= 40; h += 2) for (const r of [0.05, 0.12, 0.2]) {
    const d = dirFromTheta((h * Math.PI) / 180);
    const c: Vec3 = [0.3 + d[0] * r, 0.3 + d[1] * r, 0.3 + d[2] * r];
    const o = colorFor("simulate", c, base, source, edges);
    const pc = [c[0] - luminance(c), c[1] - luminance(c), c[2] - luminance(c)], po = [o[0] - luminance(o), o[1] - luminance(o), o[2] - luminance(o)];
    const pr = (v: number[]) => v[0] * l[0] + v[1] * l[1] + v[2] * l[2];
    // |p| no crece y no cambia de signo: lo perdido no se vierte a otro tono.
    assert.ok(Math.abs(pr(po)) <= Math.abs(pr(pc)) + 1e-9 && pr(po) * pr(pc) >= 0, `${source} h=${h} r=${r}`);
    worst = Math.max(worst, deltaE00Linear(c, o));
  }
  console.log(`simulador: ΔE00 máx en ±40° de l = ${worst.toFixed(2)}`);
});
