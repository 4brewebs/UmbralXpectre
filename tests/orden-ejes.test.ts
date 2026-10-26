// El orden de los ejes de la calibración (eje inicial y siguientes) sale solo de la semilla, como en 973dd0e.
// La huella se grabó ejecutando este mismo recorrido sobre 973dd0e; el router y las guardas no intervienen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";

test("orden de ejes: igual que en 973dd0e con las mismas semillas, y aleatorio", () => {
  const out: string[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    let s = createSession(seed * 7919);
    const ids = [s.activeId];
    for (let i = 0; i < 30 && !s.complete; i++) {
      const st = stimulusOf(s)!;
      s = answer(s, st.s > 0.04 ? "different" : "same", i);
      ids.push(s.activeId);
    }
    out.push(ids.join(","));
  }
  assert.equal(createHash("sha256").update(out.join("\n")).digest("hex"), "7bdd53d37f5fdd4e99844be9f45edea9b7f594e2f6214e563bd58191e1222842");
  assert.equal(new Set(out.map((o) => o.split(",")[0])).size, 6, "el eje inicial varía entre los 6");
});
