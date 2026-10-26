import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { parseEdgeFile } from "../src/lib/color/edges";
import { colorFor, edgeNotches, measuredRegion } from "../src/lib/color/spectrum";
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

test("Bordes usa la región medida: un rojo saturado (fuera de la escala de fallo) no cambia en ningún filtro", () => {
  for (const kind of ["assist", "extreme", "correct"] as const) assert.deepEqual(colorFor(kind, red, profile, "edges", [open]), red);
});

test("con un lado cerrado: ese lado llega al borde; el abierto (toEnd) llega al primer eje sano", () => {
  const oneSide = {
    ...open,
    minus: { found: true, toEnd: false, angleDeg: -10, insideDeg: -10, outsideDeg: -14 },
    confirmed: { minus: -10, plus: 14 },
  };
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const [sec] = measuredRegion(profile.axes, floor, [oneSide]).filter((s) => s.axis === "l");
  assert.equal(sec.minus.source, "edge");
  assert.ok(Math.abs(sec.loDeg + 10) < 1e-9, `${sec.loDeg}`);
  assert.equal(sec.plus.source, "toEnd");
  assert.ok(Math.abs((((sec.hiDeg - sec.plus.healthyDeg! + 540) % 360) - 180)) < 1e-9, `${sec.hiDeg} vs ${sec.plus.healthyDeg}`);
});
