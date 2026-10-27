import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD } from "../src/lib/env";
import { envKey } from "../src/lib/storage";
import { STORAGE_ENV, parseStorageEnv } from "../src/lib/env";
import { motionUiOf, questPlusEnabled } from "../src/lib/color/motion2";
import { makeSession } from "../src/lib/color/history";

test("entorno: fuera de Vite es prod/pro; cada entorno tiene su coletilla de claves", () => {
  assert.equal(BUILD.env, "prod");
  assert.equal(STORAGE_ENV, "pro");
  assert.equal(parseStorageEnv("qa"), "qa");
  assert.equal(parseStorageEnv("stable"), "stable");
  assert.equal(parseStorageEnv("prod"), "pro");
  assert.equal(envKey("umbral-profile-v3"), "umbral-profile-v3-pro");
  assert.equal(envKey("umbral-profile-v3", "qa"), "umbral-profile-v3-qa");
});

test("valores por defecto: prod sin flags = legacy y sin QUEST+; con fallback de QA = v3 y QUEST+; los flags mandan", () => {
  assert.equal(motionUiOf("", null), "legacy");
  assert.equal(questPlusEnabled(""), false);
  assert.equal(questPlusEnabled("", true), true);
  assert.equal(questPlusEnabled("?qp=0", true), false);
  assert.equal(questPlusEnabled("?qp=1", false), true);
});

test("cada sesión del historial lleva la build", () => {
  const s = makeSession("calibration", { date: new Date(0).toISOString(), deviceType: null, viewingCm: null, stimulusDeg: null, backgroundY: null, method: "staircase" }, []);
  assert.deepEqual(s.build, BUILD);
});
