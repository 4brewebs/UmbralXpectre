import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deviceDiff, fingerprint, weightsDevice } from "../src/lib/color/device";
import { parseProfile } from "../src/lib/color/profile";
import { attachMotionV2 } from "../src/lib/color/motion2";

const phone = { userAgent: "Android 10 Chrome", screen: { width: 346, height: 768, pixelRatio: 3.125 }, gamut: "srgb" };

test("huella: girar la pantalla no cambia; otro dpr o refresco sí", () => {
  const a = fingerprint(phone, 89.3);
  assert.equal(fingerprint({ ...phone, screen: { width: 768, height: 346, pixelRatio: 3.125 } }, 89.3).key, a.key);
  assert.notEqual(fingerprint(phone, 60).key, a.key);
  assert.deepEqual(deviceDiff(a, fingerprint(phone, null)), []);
  assert.deepEqual(deviceDiff(a, fingerprint({ ...phone, screen: { ...phone.screen, pixelRatio: 2 } }, 60)), ["densidad de píxeles", "refresco"]);
});

test("perfil anterior sin huella: se deduce del hardware y del refresco de la prueba", () => {
  const p = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-movil.json", import.meta.url), "utf8"))!;
  const d = weightsDevice(p)!;
  assert.equal(d.refreshHz, 89.3);
  assert.deepEqual(d.screen, [346, 768]);
});

test("movimiento v2 guarda la huella en la luminancia y en la sesión del historial", () => {
  const p = parseProfile(fs.readFileSync(new URL("./fixtures/perfil-v3-movil.json", import.meta.url), "utf8"))!;
  const device = fingerprint(phone, 89.3);
  const state = { stairs: [], log: [], catches: { shown: 0, missed: 0 }, blocks: [], sinceCatch: 0 } as never;
  const out = attachMotionV2(p, state, { refreshHz: 89.3, temporalHz: 11, cyclesPerDeg: 1, device });
  assert.equal(out.luminance?.device?.key, device.key);
  assert.equal(out.history?.sessions.at(-1)?.device?.key, device.key);
  // Colorado, ítem 4: refreshHz se guarda por sesión (en la huella de cada sesión), no solo el último.
  assert.equal(out.history?.sessions.at(-1)?.device?.refreshHz, 89.3);
  const out2 = attachMotionV2(out, state, { refreshHz: 59.9, temporalHz: 7.5, cyclesPerDeg: 1, device: fingerprint(phone, 59.9) });
  const hz = out2.history!.sessions.filter((x) => x.device).slice(-2).map((x) => x.device!.refreshHz);
  assert.deepEqual(hz, [89.3, 59.9]);
  assert.equal(out2.luminance?.refreshHz, 59.9);
});
