import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basePrefix, envKey, legacyPrefixesFor, migratedKey, migrateLegacy, scopedStore, type Store } from "../src/lib/storage";
import { PROFILE_STORAGE_KEY, parseProfile } from "../src/lib/color/profile";
import { EDGES_STORAGE_KEY } from "../src/lib/color/edgestore";
import { MOTION_V2_FLAG } from "../src/lib/color/motion2";
import { QP_RESUME_KEY } from "../src/lib/color/session";
import type { StorageEnv } from "../src/lib/env";

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
const norm = (raw: string) => JSON.parse(JSON.stringify(parseProfile(raw)));
const ENVS: StorageEnv[] = ["pro", "qa", "stable"];
const BASES: Record<StorageEnv, string> = { pro: "/UmbralXpectre/", qa: "/UmbralXpectre/qa/", stable: "/UmbralXpectre/stable-v1/" };
const prefixes = (env: StorageEnv) => legacyPrefixesFor(env, BASES[env]);
const LEGACY = ["umbral-profile-v3", "umbral-profile-v2", "umbral-profile-v1", EDGES_STORAGE_KEY, MOTION_V2_FLAG, QP_RESUME_KEY, "qa.umbral-profile-v3", basePrefix(BASES.pro) + PROFILE_STORAGE_KEY];

function legacyStore() {
  const s = new Mem();
  s.map.set("umbral-profile-v2", asV2());
  s.map.set("umbral-profile-v1", asV2());
  s.map.set(EDGES_STORAGE_KEY, "[]");
  s.map.set(MOTION_V2_FLAG, "v3");
  s.map.set(QP_RESUME_KEY, '{"sesion":1}');
  s.writes = [];
  return s;
}
const snapshot = (s: Mem) => LEGACY.map((k) => s.getItem(k));

test("claves: coletilla por entorno y la sesión en curso termina en <entorno>-session", () => {
  assert.equal(envKey(PROFILE_STORAGE_KEY, "pro"), "umbral-profile-v3-pro");
  for (const env of ENVS) assert.ok(envKey(QP_RESUME_KEY, env).endsWith(`${env}-session`));
  assert.deepEqual(prefixes("qa"), ["umbral@/UmbralXpectre/qa/:", "qa.", ""]);
  assert.deepEqual(prefixes("pro"), ["umbral@/UmbralXpectre/:", ""]);
});

test("primer uso: copia el perfil sin prefijo migrado a v3, con bordes, sesión y flag; las antiguas quedan intactas", () => {
  for (const env of ENVS) {
    const s = legacyStore();
    const before = snapshot(s);
    migrateLegacy(s, env, prefixes(env));
    const copied = JSON.parse(s.getItem(envKey(PROFILE_STORAGE_KEY, env))!);
    assert.equal(copied.schema, "umbral.profile.v3");
    assert.deepEqual(copied, norm(asV2()));
    assert.equal(s.getItem(envKey(EDGES_STORAGE_KEY, env)), "[]");
    assert.equal(s.getItem(envKey(MOTION_V2_FLAG, env)), "v3");
    assert.equal(s.getItem(`umbral.calib.qp.resume-${env}-session`), '{"sesion":1}');
    assert.equal(s.getItem(migratedKey(env)), "1");
    assert.deepEqual(snapshot(s), before, "las claves antiguas siguen igual");
    assert.ok(s.writes.every((w) => w.startsWith("set ") && w.includes(`-${env}`)), `solo escribe en su entorno: ${s.writes}`);
  }
});

test("orden de origen: umbral@<base>: de 3ac5e80, luego qa. (solo QA), luego sin prefijo", () => {
  const s = legacyStore();
  const other = { ...JSON.parse(V3), note: "base" };
  s.map.set(basePrefix(BASES.pro) + PROFILE_STORAGE_KEY, JSON.stringify(other));
  s.map.set(basePrefix(BASES.pro) + EDGES_STORAGE_KEY, "[1]");
  s.map.set("qa.umbral-profile-v3", V3);
  migrateLegacy(s, "pro", prefixes("pro"));
  assert.deepEqual(JSON.parse(s.getItem("umbral-profile-v3-pro")!), norm(JSON.stringify(other)));
  assert.equal(s.getItem("umbral-edges-v1-pro"), "[1]");
  migrateLegacy(s, "qa", prefixes("qa"));
  assert.deepEqual(JSON.parse(s.getItem("umbral-profile-v3-qa")!), norm(V3));
  migrateLegacy(s, "stable", prefixes("stable"));
  assert.deepEqual(JSON.parse(s.getItem("umbral-profile-v3-stable")!), norm(asV2()));
});

test("copia única: si el entorno se vacía después, no vuelve a copiar", () => {
  const s = legacyStore();
  migrateLegacy(s, "pro", prefixes("pro"));
  s.removeItem(envKey(PROFILE_STORAGE_KEY, "pro"));
  migrateLegacy(s, "pro", prefixes("pro"));
  assert.equal(s.getItem(envKey(PROFILE_STORAGE_KEY, "pro")), null);
  const ls = scopedStore(() => s, "pro", prefixes("pro"));
  assert.equal(ls.getItem(PROFILE_STORAGE_KEY), null);
});

test("aislamiento entre pro, qa y stable: cada uno solo lee y escribe lo suyo; borrar no toca a los demás ni a las antiguas", () => {
  const s = legacyStore();
  const before = snapshot(s);
  const stores = Object.fromEntries(ENVS.map((env) => [env, scopedStore(() => s, env, prefixes(env))])) as Record<StorageEnv, Store>;
  for (const env of ENVS) stores[env].setItem("x", env);
  for (const env of ENVS) assert.equal(stores[env].getItem("x"), env);
  stores.qa.setItem(PROFILE_STORAGE_KEY, V3);
  stores.qa.removeItem(EDGES_STORAGE_KEY);
  stores.stable.removeItem(PROFILE_STORAGE_KEY);
  ["umbral-profile-v2", "umbral-profile-v1", MOTION_V2_FLAG, QP_RESUME_KEY].forEach((k) => stores.pro.removeItem(k));
  assert.deepEqual(JSON.parse(stores.pro.getItem(PROFILE_STORAGE_KEY)!), norm(asV2()));
  assert.equal(stores.pro.getItem(EDGES_STORAGE_KEY), "[]");
  assert.equal(stores.stable.getItem(EDGES_STORAGE_KEY), "[]");
  assert.equal(stores.qa.getItem(PROFILE_STORAGE_KEY), V3);
  assert.deepEqual(snapshot(s), before);
  assert.ok(s.writes.every((w) => /-(pro|qa|stable)(-session)?$/.test(w)), `${s.writes}`);
});

test("sin perfil antiguo no copia nada", () => {
  const s = new Mem();
  migrateLegacy(s, "qa", prefixes("qa"));
  assert.equal(s.getItem(envKey(PROFILE_STORAGE_KEY, "qa")), null);
  assert.deepEqual([...s.map.keys()], [migratedKey("qa")]);
});
