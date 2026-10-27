import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTransformFile, parseTransformFile } from "../src/lib/color/lut";
import { parseProfile } from "../src/lib/color/profile";

test("transforms v1 (fixture real) carga y migra a v2 conservando nodos", () => {
  const txt = readFileSync("tests/fixtures/transforms-v3-0721Z.json", "utf8");
  const v1 = JSON.parse(txt);
  const t = parseTransformFile(txt)!;
  assert.equal(t.schema, "umbral.transforms.v2");
  assert.equal(t.size, v1.size);
  assert.deepEqual(t.filters, v1.filters);
  assert.equal(t.params, undefined);
  assert.deepEqual(t.legacyParamsV1, v1.params);
});

test("v1 con params de región: van a legacyParamsV1", () => {
  const t = parseTransformFile({ schema: "umbral.transforms.v1", size: 33, filters: [], params: { mask: "región medida", region: [] } })!;
  assert.equal(t.schema, "umbral.transforms.v2");
  assert.equal(t.params, undefined);
  assert.deepEqual(t.legacyParamsV1, { mask: "región medida", region: [] });
});

test("v2 recién horneado: ida y vuelta por JSON", () => {
  const p = parseProfile(readFileSync("tests/fixtures/perfil-72c787e.json", "utf8"))!;
  const t = buildTransformFile(p);
  assert.equal(t.schema, "umbral.transforms.v2");
  assert.deepEqual(parseTransformFile(JSON.stringify(t)), JSON.parse(JSON.stringify(t)));
});

test("rechaza esquemas desconocidos o rotos", () => {
  assert.equal(parseTransformFile({ schema: "umbral.transforms.v9", size: 33, filters: [] }), null);
  assert.equal(parseTransformFile("{no json"), null);
  assert.equal(parseTransformFile({ schema: "umbral.transforms.v1" }), null);
});
