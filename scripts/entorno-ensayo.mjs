// Compara con Playwright el color calculado del entorno del primer ensayo entre dos builds servidos.
// Uso: node scripts/entorno-ensayo.mjs <url-referencia> <url-nueva>   (necesita `playwright` instalado aparte)
// Referencia (973dd0e): raíz → «Empezar calibración». Nueva: #/nuevo → «Empezar calibración» (con fundido).
import { chromium } from "playwright";

const [ref, cur] = process.argv.slice(2);
const read = async (browser, url, vp) => {
  const page = await browser.newPage({ viewport: vp });
  await page.goto(url);
  await page.click("text=Empezar calibración");
  await page.waitForSelector("text=Iguales");
  await page.waitForTimeout(1800);
  const css = await page.evaluate(() => {
    const bg = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    const stage = document.querySelector(".bg-stage");
    return { html: bg(document.documentElement), body: bg(document.body), main: bg(document.querySelector("main")), stage: bg(stage), fundido: !!document.querySelector("[data-testid=fundido]") };
  });
  const png = await page.screenshot({ clip: { x: 2, y: vp.height - 3, width: 1, height: 1 } });
  await page.close();
  return { ...css, pixelEsquina: png.toString("base64").length ? "ok" : null, png };
};
const browser = await chromium.launch();
let fail = 0;
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  const a = await read(browser, ref, vp);
  const b = await read(browser, cur.replace(/#.*$/, "") + "#/nuevo", vp);
  const same = a.html === b.html && a.body === b.body && a.main === b.main && a.stage === b.stage && a.png.equals(b.png) && !b.fundido;
  console.log(`${vp.width}×${vp.height}`, JSON.stringify({ ...a, png: undefined }), "|", JSON.stringify({ ...b, png: undefined }), "| píxel de esquina igual:", a.png.equals(b.png), same ? "IGUAL" : "DISTINTO");
  if (!same) fail = 1;
}
await browser.close();
process.exit(fail);
