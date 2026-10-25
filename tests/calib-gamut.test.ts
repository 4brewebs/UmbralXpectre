import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadQuestPlus } from "../src/lib/color/questplus";
import { QP_CALIB, stepAxis, type QpLog } from "../src/lib/color/calibqp";

const profile = JSON.parse(fs.readFileSync(new URL("./fixtures/perfil-v3-qp-2140Z.json", import.meta.url), "utf8"));
const logOf = (id: string): QpLog => profile.calibrationResume.axes.find((a: { id: string }) => a.id === id).qpLog;

test("rejilla α hasta 60 ΔE00, estímulos cortados al alcance", () => {
  assert.equal(QP_CALIB.deMax, 60);
  assert.ok(QP_CALIB.points >= 50);
});

test("perfil de Lucas 21:40Z: l y rojo extremo ya no paran por la anchura (masa fuera de alcance)", async () => {
  const Q = await loadQuestPlus();
  for (const id of ["l", "red-end"]) {
    const r = stepAxis(Q, 8.886, 0.02, logOf(id));
    assert.ok(r.beyondReach > QP_CALIB.pinnedMass, `${id}: ${r.beyondReach}`);
    // Nunca una parada relativa: o sigue, o termina como «al menos» por el gamut.
    assert.ok(!r.done || r.bound === "gamut-limit", id);
  }
  assert.equal(stepAxis(Q, 8.886, 0.02, logOf("l")).done, false, "l con 7 ensayos sigue");
  // Ejes sin elevar siguen parando con sus ensayos.
  const s = stepAxis(Q, 20, 0.02, logOf("control"));
  assert.ok(s.beyondReach < QP_CALIB.pinnedMass);
});

test("todo «igual» hasta el alcance: «al menos» por límite del gamut, no fallo", async () => {
  const Q = await loadQuestPlus();
  const log: QpLog = [];
  let r = stepAxis(Q, 8.886, 0.02, log);
  for (let i = 0; i < 36 && !r.done; i++) {
    log.push([r.nextDe, 1]);
    r = stepAxis(Q, 8.886, 0.02, log);
  }
  assert.equal(r.done, true);
  assert.equal(r.bound, "gamut-limit");
  assert.ok(log.length <= 20, `${log.length} ensayos`);
});
