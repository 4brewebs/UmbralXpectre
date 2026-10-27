import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildTransformFile } from "../src/lib/color/lut";

const profile = JSON.parse(fs.readFileSync(new URL("./fixtures/perfil-v3-qp-2140Z.json", import.meta.url), "utf8"));

test("perfil de Lucas 21:40Z: Asistencia y Extremo cambian nodos (solo en la región medida)", () => {
  const t = buildTransformFile(profile);
  const changed = (id: string) => t.filters.find((f) => f.id === id)!.changed;
  assert.ok(changed("assist") > 0, `${changed("assist")}`);
  assert.ok(changed("extreme") > 0, `${changed("extreme")}`);
});

