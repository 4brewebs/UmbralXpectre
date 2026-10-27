import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIGRATED_KEY, migrateLegacy, scopedStore, storagePrefix, type Store } from "../src/lib/storage";
import { PROFILE_STORAGE_KEY, parseProfile } from "../src/lib/color/profile";
import { EDGES_STORAGE_KEY } from "../src/lib/color/edgestore";
import { MOTION_V2_FLAG } from "../src/lib/color/motion2";

class Mem implements Store {
  map = new Map<string, string>();
  writes: string[] = [];
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes.push(`set ${k}`);
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.writes.push(`del ${k}`);
    this.map.delete(k);
  }
}

const V3 = readFileSync(new URL("./fixtures/perfil-v3-0721Z.json", import.meta.url), "utf8");
const asV2 = () => JSON.stringify({ ...JSON.parse(V3), schema: "umbral.profile.v2" });
const ROOT = storagePrefix("/UmbralXpectre/");
const QA = storagePrefix("/UmbralXpectre/qa/");
const LEGACY = ["umbral-profile-v3", "umbral-profile-v2", "umbral-profile-v1", EDGES_STORAGE_KEY, MOTION_V2_FLAG, "qa.umbral-profile-v3"];

function legacyStore() {
  const s = new Mem();
  s.map.set("umbral-profile-v2", asV2());
  s.map.set("umbral-profile-v1", asV2());
  s.map.set(EDGES_STORAGE_KEY, "[]");
  s.map.set(MOTION_V2_FLAG, "v3");
  s.writes = [];
  return s;
}

test("primer uso: copia el perfil sin prefijo y lo migra a v3, con sus bordes y el flag", () => {
  const s = legacyStore();
  const before = LEGACY.map((k) => s.getItem(k));
  migrateLegacy(s, ROOT, [""]);
  const copied = JSON.parse(s.getItem(ROOT + PROFILE_STORAGE_KEY)!);
  assert.equal(copied.schema, "umbral.profile.v3");
  assert.deepEqual(copied, JSON.parse(JSON.stringify(parseProfile(asV2()))));
  assert.equal(s.getItem(ROOT + EDGES_STORAGE_KEY), "[]");
  assert.equal(s.getItem(ROOT + MOTION_V2_FLAG), "v3");
  assert.equal(s.getItem(ROOT + MIGRATED_KEY), "1");
  assert.deepEqual(LEGACY.map((k) => s.getItem(k)), before, "las claves sin prefijo siguen igual");
  assert.ok(s.writes.every((w) => w.startsWith(`set ${ROOT}`)), `solo escribe en su espacio: ${s.writes}`);
});

test("solo una vez: si el espacio se vacía después, no vuelve a copiar", () => {
  const s = legacyStore();
  migrateLegacy(s, ROOT, [""]);
  s.removeItem(ROOT + PROFILE_STORAGE_KEY);
  migrateLegacy(s, ROOT, [""]);
  assert.equal(s.getItem(ROOT + PROFILE_STORAGE_KEY), null);
});

test("store con espacio: guardar y borrar (incluidas v1/v2 retiradas) nunca toca las claves sin prefijo", () => {
  const s = legacyStore();
  const before = LEGACY.map((k) => s.getItem(k));
  const ls = scopedStore(() => s, ROOT, [""]);
  assert.ok(ls.getItem(PROFILE_STORAGE_KEY));
  ls.setItem(PROFILE_STORAGE_KEY, V3);
  ["umbral-profile-v2", "umbral-profile-v1", EDGES_STORAGE_KEY, MOTION_V2_FLAG].forEach((k) => ls.removeItem(k));
  assert.deepEqual(LEGACY.map((k) => s.getItem(k)), before);
  assert.ok(s.writes.every((w) => w.includes(ROOT)), `${s.writes}`);
});

test("aislamiento: raíz y QA no se ven; QA prefiere su perfil antiguo qa. al de producción", () => {
  const s = legacyStore();
  s.map.set("qa.umbral-profile-v3", V3);
  const root = scopedStore(() => s, ROOT, [""]);
  const qa = scopedStore(() => s, QA, ["qa.", ""]);
  root.setItem("x", "raíz");
  assert.equal(qa.getItem("x"), null);
  qa.setItem("x", "qa");
  assert.equal(root.getItem("x"), "raíz");
  assert.deepEqual(JSON.parse(qa.getItem(PROFILE_STORAGE_KEY)!), JSON.parse(JSON.stringify(parseProfile(V3))));
  qa.removeItem(PROFILE_STORAGE_KEY);
  assert.ok(root.getItem(PROFILE_STORAGE_KEY), "borrar en QA no borra la raíz");
  assert.equal(s.getItem("qa.umbral-profile-v3"), V3);
});

test("sin perfil antiguo no copia nada y el prefijo nunca es vacío", () => {
  const s = new Mem();
  migrateLegacy(s, ROOT, [""]);
  assert.equal(s.getItem(ROOT + PROFILE_STORAGE_KEY), null);
  assert.notEqual(storagePrefix(""), "");
  assert.throws(() => migrateLegacy(s, "", [""]));
});
