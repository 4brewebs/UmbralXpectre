import { test } from "node:test";
import assert from "node:assert/strict";
import { apcaLc } from "../src/lib/ui/apca";
import { PORTADA, worstPanelBackground } from "../src/lib/ui/portada";

test("apca: valores de referencia", () => {
  assert.ok(Math.abs(apcaLc("#888888", "#ffffff") - 63.06) < 0.1);
  assert.ok(Math.abs(apcaLc("#ffffff", "#000000") + 107.88) < 0.1);
});

test("portada y menú: todo el texto con |Lc| ≥ 60 sobre los fondos de la app", () => {
  const bgs = { "--color-bg": PORTADA.bg, "--color-surface (opciones)": PORTADA.surface, "velo peor caso": worstPanelBackground() };
  const rows: string[] = [];
  for (const [bn, bg] of Object.entries(bgs)) {
    const lc = apcaLc(PORTADA.text, bg);
    rows.push(`--color-fg ${PORTADA.text} sobre ${bn} ${bg}: Lc ${lc.toFixed(1)}`);
    assert.ok(Math.abs(lc) >= 60, rows.at(-1));
  }
  console.log(rows.join("\n"));
});
