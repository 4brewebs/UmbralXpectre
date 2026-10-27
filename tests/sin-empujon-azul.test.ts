import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { parseEdgeFile } from "../src/lib/color/edges";
import { lmsOf } from "../src/lib/color/cones";
import { bandUniforms, cameraFrame } from "../src/lib/color/bandshader";
import { EXTREME_TURN_DEG, bandsFor, colorFor } from "../src/lib/color/spectrum";
import { fromSrgb8, type Vec3 } from "../src/lib/color/space";

/**
 * Colorado (27/10): la daltonización hacia s/blue-end no entra. En la sesión 72c787e lo perdido está en rojo–verde
 * (eje l); Asistido y Extremo deben restituirlo en L−M (y brillo L), nunca moviendo el color sobre todo en S
 * (azul–amarillo). Falla si en algún píxel que cambia |ΔS/S| supera a max(|ΔL/L|, |ΔM/M|) o es > 1e-6 sin cambio L/M.
 */
const read = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const profile = parseProfile(read("perfil-72c787e.json"))!;
const raw = JSON.parse(read("bordes-l-72c787e.json"));
const edges = (Array.isArray(raw) ? raw : [raw]).map((e: unknown) => parseEdgeFile(JSON.stringify(e)) ?? e) as never[];
const colors: Vec3[] = [];
for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) colors.push(fromSrgb8([r, g, b]));

function check(name: string, src: Vec3, out: Vec3) {
  const a = lmsOf(src), b = lmsOf(out);
  const rel = (i: number) => Math.abs(b[i] - a[i]) / Math.max(a[i], 1e-4);
  const lm = Math.max(rel(0), rel(1));
  if (lm < 1e-6 && rel(2) < 1e-6) return;
  assert.ok(rel(2) <= lm, `${name}: ${src.map((x) => x.toFixed(3))} → ΔS/S ${rel(2).toExponential(2)} > ΔL,M ${lm.toExponential(2)}`);
}

for (const kind of ["assist", "extreme"] as const) {
  test(`${kind === "assist" ? "Asistido" : "Extremo"}: lo perdido en rojo–verde no se lleva al eje S/azul (láminas, transformadas, cámara)`, () => {
    let moved = 0;
    for (const source of ["profile", "edges"] as const) for (const c of colors) {
      const o = colorFor(kind, c, profile, source, edges);
      if (o.some((x, i) => Math.abs(x - c[i]) > 1e-6)) moved++;
      check(`${source}`, c, o);
    }
    assert.ok(moved > 100, `solo ${moved} colores cambian`);
    const u = bandUniforms(bandsFor(profile, edges), EXTREME_TURN_DEG);
    const lin = new Float32Array(colors.length * 3);
    colors.forEach((c, i) => lin.set(c, i * 3));
    const out = cameraFrame(lin, colors.length, 1, u, kind === "assist" ? 2 : 3);
    colors.forEach((c, i) => check("cámara", c, [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]));
  });
}
