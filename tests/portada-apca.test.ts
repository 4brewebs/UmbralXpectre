import { test } from "node:test";
import assert from "node:assert/strict";
import { apcaLc } from "../src/lib/ui/apca";
import { PORTADA, worstPanelBackground } from "../src/lib/ui/portada";

test("apca: valores de referencia", () => {
  assert.ok(Math.abs(apcaLc("#888888", "#ffffff") - 63.06) < 0.1);
  assert.ok(Math.abs(apcaLc("#ffffff", "#000000") + 107.88) < 0.1);
});

test("portada: todo el texto con |Lc| ≥ 60", () => {
  const bgs = { negro: PORTADA.black, "velo peor caso": worstPanelBackground() };
  const rows: string[] = [];
  for (const [bn, bg] of Object.entries(bgs)) {
    for (const [tn, fg] of Object.entries({ texto: PORTADA.text, secundario: PORTADA.muted, acento: PORTADA.accent })) {
      const lc = apcaLc(fg, bg);
      rows.push(`${tn} ${fg} sobre ${bn} ${bg}: Lc ${lc.toFixed(1)}`);
      assert.ok(Math.abs(lc) >= 60, rows.at(-1));
    }
  }
  const btn = apcaLc(PORTADA.buttonFg, PORTADA.buttonBg);
  rows.push(`botón ${PORTADA.buttonFg} sobre ${PORTADA.buttonBg}: Lc ${btn.toFixed(1)}`);
  assert.ok(Math.abs(btn) >= 60, rows.at(-1));
  console.log(rows.join("\n"));
});
