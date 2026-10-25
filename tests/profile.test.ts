import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile, PROFILE_STORAGE_KEY, RETIRED_PROFILE_KEYS } from "../src/lib/color/profile";
import { lumaFromProfile } from "../src/lib/color/spectrum";
import { orderLuminance } from "../src/lib/color/motion";
import { edgeFitsProfile, parseEdgeFile } from "../src/lib/color/edges";
import { predictedLumWeights } from "../src/lib/color/cones";

const read = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("migra v2 → v3 sin derivar pesos de las igualaciones antiguas", () => {
  const raw = read("perfil_56KB.json");
  const v2 = JSON.parse(raw);
  const p = parseProfile(raw)!;
  assert.equal(p.schema, "umbral.profile.v3");
  assert.equal(p.createdAt, v2.createdAt);
  const lum = p.luminance!;
  assert.equal(lum.type, "protan");
  assert.equal(lum.weightsSource, "predicted");
  assert.equal(lum.legacyMatches, true);
  assert.deepEqual(lum.measuredMatches, []);
  const w = predictedLumWeights("protan", 1);
  lum.weights.forEach((v, i) => assert.ok(Math.abs(v - w[i]) < 1e-4));
  assert.equal(lum.matches.length, v2.luminance.matches.length);
  // Los filtros de fase 1 leen lo mismo que antes.
  const before = lumaFromProfile({ ...p, luminance: { ...lum, ...orderLuminance(v2.luminance) } });
  assert.deepEqual(lumaFromProfile(p), before);
});

test("v3 se conserva al reimportar", () => {
  const p = parseProfile(read("perfil_56KB.json"))!;
  const edited = { ...p, luminance: { ...p.luminance!, weights: [0.1, 0.8, 0.1], weightsSource: "measured", refreshHz: 60 } };
  const again = parseProfile(JSON.stringify(edited))!;
  assert.deepEqual(again.luminance!.weights, [0.1, 0.8, 0.1]);
  assert.equal(again.luminance!.weightsSource, "measured");
  assert.equal(again.luminance!.refreshHz, 60);
  assert.equal(again.luminance!.matches.length, p.luminance!.matches.length);
});

test("claves de almacenamiento y archivos que no son perfil", () => {
  assert.equal(PROFILE_STORAGE_KEY, "umbral-profile-v3");
  assert.deepEqual([...RETIRED_PROFILE_KEYS], ["umbral-profile-v2", "umbral-profile-v1"]);
  assert.equal(parseProfile(read("perfil_563KB.json")), null);
  assert.equal(parseProfile(read("perfil_7KB.json")), null);
});

test("edges.v1 sigue cargando y encaja con el perfil migrado", () => {
  const edge = parseEdgeFile(read("perfil_7KB.json"))!;
  assert.ok(edge);
  const p = parseProfile(read("perfil_56KB.json"))!;
  assert.equal(edgeFitsProfile(edge, p), true);
  assert.equal(edgeFitsProfile(edge, { ...p, createdAt: "2020-01-01T00:00:00.000Z" }), false);
});
