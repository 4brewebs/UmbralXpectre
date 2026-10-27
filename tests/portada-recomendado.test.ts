import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apcaLc } from "../src/lib/ui/apca";
import { PORTADA } from "../src/lib/ui/portada";

const src = readFileSync(new URL("../src/components/Portada.svelte", import.meta.url), "utf8");

test("portada: «Empezar de cero» se distingue sin color (borde de 2 px y «Recomendado»)", () => {
  assert.match(src, /label: "Empezar de cero"[^}]*primary: true/);
  assert.equal((src.match(/primary: true/g) ?? []).length, 1, "solo una opción principal");
  assert.match(src, /\.opcion\.primaria \{[^}]*border-width: 2px;[^}]*border-color: var\(--color-accent\);/);
  assert.match(src, /\{#if o\.primary\}<span class="[^"]*\btext-fg\b[^"]*\btext-xs\b|\{#if o\.primary\}<span class="[^"]*\btext-xs\b[^"]*\btext-fg\b/);
  assert.match(src, />Recomendado</);
  const lc = apcaLc(PORTADA.text, PORTADA.surface);
  console.log(`«Recomendado» --color-fg sobre --color-surface: Lc ${lc.toFixed(1)}`);
  assert.ok(Math.abs(lc) >= 60);
});
