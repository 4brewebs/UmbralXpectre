import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { parseEdgeFile } from "../src/lib/color/edges";
import { colorFor, edgeNotches } from "../src/lib/color/spectrum";
import { deltaE00Linear as deltaE00 } from "../src/lib/color/deltaE";
import { thetaOf, killLuminance } from "../src/lib/color/space";
import type { Vec3 } from "../src/lib/color/space";

const read = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const profile = parseProfile(read("perfil-v3-movil.json"))!;
const open = parseEdgeFile(read("bordes-rojos-abierto.json"))!;
const red: Vec3 = [0.93, 0.02, 0.1];

test("bordes abiertos por ambos lados: la asistencia es la del perfil, nunca hacia el lado toEnd", () => {
  const [n] = edgeNotches([open]);
  assert.equal(n.loOpen, true);
  assert.equal(n.hiOpen, true);
  assert.deepEqual(colorFor("assist", red, profile, "edges", [open]), colorFor("assist", red, profile, "profile"));
  assert.deepEqual(colorFor("extreme", red, profile, "edges", [open]), colorFor("extreme", red, profile, "profile"));
});

test("tInner no baja del umbral de origen aunque la profundidad se midiera en el borde", () => {
  const [n] = edgeNotches([open]);
  assert.ok(n.tInner >= open.sourceThreshold);
});

test("mapa intermedio en bordes cambia el rojo de forma visible (no es identidad)", () => {
  const out = colorFor("correct", red, profile, "edges", [open]);
  assert.ok(deltaE00(red, out) > 1, `ΔE00 ${deltaE00(red, out)}`);
});

test("con un lado cerrado, la asistencia va hacia ese lado y no hacia el abierto", () => {
  const oneSide = {
    ...open,
    minus: { found: true, toEnd: false, angleDeg: -10, insideDeg: -10, outsideDeg: -14 },
    confirmed: { minus: -10, plus: 14 },
  };
  const [n] = edgeNotches([oneSide]);
  assert.equal(n.loOpen, false);
  assert.equal(n.hiOpen, true);
  const out = colorFor("assist", red, profile, "edges", [oneSide]);
  const deg = (v: Vec3) => (thetaOf(killLuminance(v)) * 180) / Math.PI;
  assert.ok(deg(out) < deg(red), `${deg(out)} < ${deg(red)}`);
});
