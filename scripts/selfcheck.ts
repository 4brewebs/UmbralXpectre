// Ejecuta el autochequeo de src/lib/color (lógica pura, sin DOM).
import { runSelfCheck } from "../src/lib/color/selfcheck";

const errors = runSelfCheck();
if (errors.length) {
  console.error(`selfcheck: ${errors.length} fallo(s)`);
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("selfcheck: OK");
