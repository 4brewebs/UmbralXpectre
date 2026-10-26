import { test } from "node:test";
import assert from "node:assert/strict";
import { motionUiOf, motionV2Enabled } from "../src/lib/color/motion2";

test("versión de la interfaz de brillo: flag y localStorage", () => {
  assert.equal(motionUiOf("", null), "legacy");
  assert.equal(motionUiOf("?motion=v3", null), "v3");
  assert.equal(motionUiOf("", "v3"), "v3");
  assert.equal(motionUiOf("?motion=v2", "v3"), "v2");
  assert.equal(motionUiOf("?motion=v1", "v3"), "legacy");
  assert.equal(motionUiOf("", null, "v3"), "v3");
  assert.equal(motionV2Enabled("?motion=v3", null), true);
});
