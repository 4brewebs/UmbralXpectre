import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIGRATED_KEY, envKey, migrateLegacy, scopedStore, type Store } from "../src/lib/storage";
import { PROFILE_STORAGE_KEY, parseProfile } from "../src/lib/color/profile";
import { MOTION_V2_FLAG } from "../src/lib/color/motion2";
import { QP_RESUME_KEY } from "../src/lib/color/session";

class Mem implements Store {
  map = new Map<string, string>();
  writes: string[] = [];
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes.push(k);
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.writes.push(k);
    this.map.delete(k);
  }
}

const V3 = readFileSync(new URL("./fixtures/perfil-v3-movil.json", import.meta.url), "utf8");
const asV2 = () => JSON.stringify({ ...JSON.parse(V3), schema: "umbral.profile.v2" });
const LEGACY = ["umbral-profile-v3", "umbral-profile-v2", "umbral-profile-v1", MOTION_V2_FLAG, QP_RESUME_KEY, "umbral-profile-v3-pro", "umbral-profile-v3-qa"];
function legacyStore() {
  const s = new Mem();
  s.map.set("umbral-profile-v2", asV2());
  s.map.set(MOTION_V2_FLAG, "v3");
  s.map.set(QP_RESUME_KEY, '{"s":1}');
  s.map.set("umbral-profile-v3-pro", "pro");
  s.map.set("umbral-profile-v3-qa", "qa");
  return s;
}
const snap = (s: Mem) => LEGACY.map((k) => s.getItem(k));

test("stable: copia única del perfil sin prefijo migrado a v3, sesión y flag; antiguas intactas", () => {
  const s = legacyStore();
  const before = snap(s);
  migrateLegacy(s);
  assert.deepEqual(JSON.parse(s.getItem("umbral-profile-v3-stable")!), JSON.parse(JSON.stringify(parseProfile(asV2()))));
  assert.equal(s.getItem("umbral.calib.qp.resume-stable-session"), '{"s":1}');
  assert.equal(s.getItem(envKey(MOTION_V2_FLAG)), "v3");
  assert.deepEqual(snap(s), before);
  assert.ok(s.writes.every((k) => /-stable(-session)?$/.test(k)), `${s.writes}`);
  s.removeItem(envKey(PROFILE_STORAGE_KEY));
  migrateLegacy(s);
  assert.equal(s.getItem(envKey(PROFILE_STORAGE_KEY)), null, "no vuelve a copiar");
  assert.equal(s.getItem(MIGRATED_KEY), "1");
});

test("stable: aislado de pro y qa; guardar y borrar solo toca -stable", () => {
  const s = legacyStore();
  const before = snap(s);
  const ls = scopedStore(() => s);
  ls.setItem(PROFILE_STORAGE_KEY, V3);
  ["umbral-profile-v2", "umbral-profile-v1", MOTION_V2_FLAG, QP_RESUME_KEY].forEach((k) => ls.removeItem(k));
  assert.equal(ls.getItem(PROFILE_STORAGE_KEY), V3);
  assert.deepEqual(snap(s), before);
});
