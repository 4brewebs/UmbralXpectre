import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProfile } from "../src/lib/color/profile";
import { EDGES_STORAGE_KEY, STALE_EDGES_NOTE, clearEdges, importEdgeFile, loadEdges, saveEdges } from "../src/lib/color/edgestore";

const read = (n: string) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const profile = parseProfile(read("perfil-v3-0721Z.json"))!;
const sim = JSON.parse(read("bordes-simulado-v3-0721Z.json")).runs.map((r: { file: any }) => r.file);
const stale = { ...sim[0], basedOn: { schema: "umbral.profile.v3", createdAt: "2026-10-25T21:07:37.213Z" } };

test("bordes: se guardan y se restauran con el mismo perfil (sobreviven a recargar)", () => {
  const s = memory();
  saveEdges(s, { l: sim[0], m: sim[1] });
  assert.ok(s.m.has(EDGES_STORAGE_KEY));
  const out = loadEdges(s, profile);
  assert.equal(out.stale, false);
  assert.deepEqual(Object.keys(out.files).sort(), ["l", "m"]);
  assert.deepEqual(out.files.l, sim[0]);
});

test("bordes de un perfil anterior: se descartan, se borran y se avisa", () => {
  const s = memory();
  saveEdges(s, { l: stale, m: sim[1] });
  const out = loadEdges(s, profile);
  assert.equal(out.stale, true);
  assert.deepEqual(Object.keys(out.files), ["m"]);
  assert.equal(loadEdges(s, profile).stale, false);
  assert.match(STALE_EDGES_NOTE, /Bordes de un perfil anterior: repite el test de bordes/);
});

test("perfil nuevo: los bordes guardados no valen y se borran", () => {
  const s = memory();
  saveEdges(s, { l: sim[0], m: sim[1] });
  const nuevo = { ...profile, createdAt: "2026-10-27T09:00:00.000Z" };
  const out = loadEdges(s, nuevo);
  assert.equal(out.stale, true);
  assert.deepEqual(out.files, {});
  assert.equal(s.m.has(EDGES_STORAGE_KEY), false);
  saveEdges(s, { l: sim[0] });
  clearEdges(s);
  assert.equal(s.m.has(EDGES_STORAGE_KEY), false);
});

test("importar JSON de bordes: válido si encaja; de otro perfil o no-bordes, error", () => {
  assert.ok("file" in importEdgeFile(JSON.stringify(sim[0]), profile));
  const old = importEdgeFile(JSON.stringify(stale), profile);
  assert.ok("error" in old && old.error === STALE_EDGES_NOTE);
  assert.ok("error" in importEdgeFile(read("perfil-v3-0721Z.json"), profile));
});
