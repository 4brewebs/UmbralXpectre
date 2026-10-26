// Flujo nuevo: perfil sí/no sin ruido (tope 60), luminancia igual, validación 3AFC (sustituye al repaso), bordes opcionales 8–20.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";
import { edgeInputFromProfile, QP_EDGES } from "../src/lib/color/edges";
import { buildProfile, type HardwareSnapshot } from "../src/lib/color/profile";
import { buildFilterTransforms, filterProfile } from "../src/lib/color/lut";
import { answerValidation, applyValidation, createValidation, oddPosition, rotationOf, VALIDATION, validationEstimates, validationStimulus, validationTargets, type ValidationState } from "../src/lib/color/validation";
import { acceptsAnswer, diff120, sectorFill, wheelPhase, wheelPlan } from "../src/lib/color/wheel";

const FIX = new URL("./fixtures/lucas-9dd5bcd/", import.meta.url);
const lucas = JSON.parse(readFileSync(new URL("perfil.json", FIX), "utf8"));
const orig = (id: string) => lucas.axes.find((a: { id: string }) => a.id === id).threshold as number;

const HW: HardwareSnapshot = {
  userAgent: "test", language: "es", screen: { width: 390, height: 844, colorDepth: 24, pixelRatio: 3 }, viewport: { width: 390, height: 844 },
  gamut: "srgb", colorScheme: "light", forcedColors: false, reducedMotion: false, maxTouchPoints: 5, capturedAt: "2026-10-26T14:00:00.000Z",
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = () => validationTargets(lucas).map((t) => t.id);
const truthOf = (f: Record<string, number> = {}) => Object.fromEntries(ids().map((id) => [id, orig(id) * (f[id] ?? 1)]));

async function run(truth: Record<string, number>, seed: number): Promise<ValidationState> {
  const Q = await loadQuestPlus();
  let st = createValidation(lucas, Q, { seed })!;
  const r = rng(seed);
  while (!st.done) {
    const x = validationStimulus(st)!;
    const pc = 1 / 3 + (2 / 3) * weibull(x.scale, truth[x.axis], 3, 0, 0.02);
    st = answerValidation(st, r() < pc ? x.odd : (x.odd + 1 + Math.floor(r() * 2)) % 3);
  }
  return st;
}

test("perfil: escalera sí/no sin ruido, guarda el método y el punto de convergencia", () => {
  let s = createSession(7);
  assert.equal(s.questPlus, undefined);
  assert.equal(s.lumNoise ?? null, null);
  const r = rng(7);
  for (let i = 0; i < 400 && !s.complete; i++) {
    const x = stimulusOf(s)!;
    assert.ok(!x.lumEps || (x.lumEps[0] === 0 && x.lumEps[1] === 0));
    const diff = x.catch ? r() < 0.03 : r() < weibull(x.s, 0.03, 3, 0, 0.03);
    s = answer(s, diff ? "different" : "same", i * 1000);
  }
  assert.ok(s.complete);
  const p = buildProfile(s, HW);
  assert.equal(p.method.search, "staircase");
  const done = p.axes.filter((a) => a.threshold != null);
  assert.ok(done.length > 0);
  for (const a of done) {
    assert.ok(a.staircase, `eje ${a.id} sin escalera`);
    assert.equal(a.staircase!.convergence, a.threshold);
    assert.equal(a.quest, undefined);
  }
});

test("validación: sin pesos medidos no hay validación", async () => {
  const Q = await loadQuestPlus();
  assert.equal(createValidation({ ...lucas, luminance: { ...lucas.luminance, weightsSource: "standard" } }, Q, { seed: 1 }), null);
});

test("validación: mide los ejes conflictivos del perfil (≥ 1,6× control), no fijo en l y m", () => {
  const t = validationTargets(lucas);
  assert.ok(t.length >= 1 && t.length <= VALIDATION.maxAxes);
  for (const x of t) assert.ok(x.ratio >= VALIDATION.elevatedRatio);
  assert.deepEqual(t.map((x) => x.id), ["l", "red-end"]);
  // Normal: nada conflictivo → solo el de mayor razón, para confirmarlo.
  const flat = { ...lucas, axes: lucas.axes.map((a: { threshold: number | null }) => ({ ...a, threshold: a.threshold == null ? null : lucas.fit.controlAbs * 1.1 })) };
  assert.equal(validationTargets(flat).length, 1);
});

test("validación: 3 sectores, 2 iguales y 1 distinto, distinto y orientación al azar, γ = 1/3, sin catch", async () => {
  const Q = await loadQuestPlus();
  assert.equal(VALIDATION.gamma, 1 / 3);
  const st0 = createValidation(lucas, Q, { seed: 42 })!;
  const x = validationStimulus(st0)!;
  assert.equal(x.fields.length, 3);
  const others = x.fields.filter((_, i) => i !== x.odd);
  assert.deepEqual(others[0], others[1]);
  assert.notDeepEqual(x.fields[x.odd], others[0]);
  assert.deepEqual([...new Set(Array.from({ length: 30 }, (_, n) => oddPosition(42, n)))].sort(), [0, 1, 2]);
});

test("validación: misma Y con los pesos medidos en los 3 sectores (sin ruido)", async () => {
  const Q = await loadQuestPlus();
  const st = createValidation(lucas, Q, { seed: 3 })!;
  const w = st.weights;
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const x = validationStimulus(st)!;
  const ys = x.fields.map((f) => w[0] * lin(f[0]) + w[1] * lin(f[1]) + w[2] * lin(f[2]));
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.004, ys.join(" "));
});

test("validación: parada por IC (sin número fijo), tope de seguridad y orientación en el log", async () => {
  const st = await run(truthOf(), 3);
  for (const a of st.axes) {
    assert.ok(a.done && a.trials >= VALIDATION.minTrials && a.trials <= VALIDATION.maxTrials);
    if (a.stop === "ci") { const e = a.qp.estimate(); assert.ok(Math.log(e.hi / e.lo) < VALIDATION.stopLogWidth); }
  }
  assert.ok(st.log.every((t) => Number.isInteger(t.rotationDeg) && t.rotationDeg >= 0 && t.rotationDeg < 360));
  const p = applyValidation(lucas, st);
  assert.ok((p.validation!.trials as Array<{ rotationDeg: number }>).every((t) => typeof t.rotationDeg === "number"));
});

test("validación: el prior se centra en el umbral del perfil", async () => {
  const Q = await loadQuestPlus();
  const st = createValidation(lucas, Q, { seed: 1 })!;
  for (const e of validationEstimates(st)) assert.ok(Math.abs(Math.log(e.threshold / e.thresholdStandardY)) < 0.05, `${e.id} ${e.threshold}`);
});

test("validación: sustituye el umbral, guarda el original y etiqueta «confirmado» si cae en el IC", async () => {
  let confirmed = 0, n = 0;
  for (let k = 0; k < 20; k++) {
    const p = applyValidation(lucas, await run(truthOf(), 100 + k));
    for (const id of ids()) {
      const a = p.axes.find((x) => x.id === id)!;
      const v = p.validation!.axes.find((x) => x.id === id)!;
      assert.equal(a.thresholdSource, "validation-3afc");
      assert.equal(a.thresholdStandardY, orig(id));
      assert.equal(a.threshold, v.threshold);
      assert.equal(v.label === "confirmado", v.lo <= orig(id) && orig(id) <= v.hi);
      n++;
      if (v.label === "confirmado") confirmed++;
    }
  }
  assert.ok(confirmed >= 0.8 * n, `confirmados ${confirmed}/${n}`);
});

test("validación: razón fuera de [½, 2] solo avisa (el umbral se sustituye igual)", async () => {
  const p = applyValidation(lucas, await run(truthOf({ l: 4 }), 9));
  const l = p.validation!.axes.find((x) => x.id === "l")!;
  assert.ok(l.ratio > 2, `razón ${l.ratio}`);
  assert.equal(l.label, "nuevo");
  assert.ok(p.validation!.warnings?.some((w) => w.startsWith("ratio-out-of-range l")));
  assert.equal(p.axes.find((x) => x.id === "l")!.threshold, l.threshold);
});

test("bordes: parten del umbral validado, mínimo 8 y tope 20 QUEST+ por lado", async () => {
  assert.equal(QP_EDGES.minTrials, 8);
  assert.equal(QP_EDGES.maxTrials, 20);
  const p = applyValidation(lucas, await run(truthOf({ l: 1.8 }), 5));
  assert.equal(edgeInputFromProfile(p, "l").sourceThreshold, p.axes.find((x) => x.id === "l")!.threshold);
});

test("orientación: diferencia ≥ 30° módulo 120° con la anterior en todos los ensayos", () => {
  for (const seed of [1, 42, 777, 123456]) {
    const r = Array.from({ length: 200 }, (_, n) => rotationOf(seed, n));
    for (let n = 1; n < r.length; n++) assert.ok(diff120(r[n], r[n - 1]) >= 30, `semilla ${seed} n ${n}: ${r[n - 1]}→${r[n]}`);
    assert.ok(r.every((x) => Number.isInteger(x) && x >= 0 && x < 360));
  }
});

test("orientación: el sector distinto es independiente de la orientación", () => {
  const N = 3000;
  const table = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let n = 0; n < N; n++) table[Math.floor(rotationOf(9, n) / 120)][oddPosition(9, n)]++;
  // χ² de independencia 3×3 (4 g.l.; p = 0,001 → 18,5).
  const rows = table.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = [0, 1, 2].map((j) => table.reduce((a, r) => a + r[j], 0));
  let chi = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const e = (rows[i] * cols[j]) / N; chi += (table[i][j] - e) ** 2 / e; }
  assert.ok(chi < 18.5, `χ² ${chi.toFixed(2)}`);
  for (const c of cols) assert.ok(Math.abs(c / N - 1 / 3) < 0.04);
});

test("transición: fundido a gris, giro corto 300–500 ms en gris, colores al pararse; sin respuesta antes", () => {
  for (const u of [0, 0.5, 0.999]) {
    const p = wheelPlan(725, 40, false, u);
    assert.ok(p.spinMs >= 300 && p.spinMs <= 500);
    assert.equal(diff120(p.to, 40), 0);
    assert.ok(p.to - p.from >= 0 && p.to - p.from < 120);
    assert.equal(p.target, 40);
    const at = (t: number) => wheelPhase(p, t);
    for (const t of [0, p.fadeMs - 1]) assert.equal(at(t), "fade");
    for (const t of [p.fadeMs, p.fadeMs + p.spinMs - 1]) assert.equal(at(t), "spin");
    for (const t of [0, p.fadeMs, p.fadeMs + p.spinMs - 1]) {
      assert.equal(acceptsAnswer(at(t)), false);
      assert.equal(sectorFill(at(t), "rgb(1, 2, 3)", "gris"), "gris");
    }
    assert.equal(at(p.fadeMs + p.spinMs), "ready");
    assert.equal(acceptsAnswer("ready"), true);
    assert.equal(sectorFill("ready", "rgb(1, 2, 3)", "gris"), "rgb(1, 2, 3)");
  }
  // Primer ensayo: sin transición.
  assert.equal(wheelPhase(wheelPlan(null, 10, false, 0.5), 0), "ready");
});

test("transición: con prefers-reduced-motion no hay giro, solo cambia la orientación", () => {
  const p = wheelPlan(725, 40, true, 0.5);
  assert.equal(p.spinMs, 0);
  assert.equal(p.from, p.to);
  assert.equal(diff120(p.to, 40), 0);
  assert.notEqual(wheelPhase(p, 0), "spin");
  assert.equal(wheelPhase(p, p.fadeMs), "ready");
});

test("filtros: sin validación no hay; con ella salen solo de sus ejes y basedOn lo dice", async () => {
  assert.equal(filterProfile(lucas), null);
  assert.equal(buildFilterTransforms(lucas), null);
  const st = await run(truthOf(), 11);
  const p = applyValidation(lucas, st);
  const base = filterProfile(p)!;
  assert.deepEqual(base.axes.map((a) => a.id).sort(), ids().sort());
  const t = buildFilterTransforms(p, [])!;
  assert.equal(t.basedOn.thresholds, "validation-3afc");
  assert.deepEqual(t.basedOn.validation!.map((v) => v.threshold), base.axes.map((a) => a.threshold));
  assert.deepEqual(t.basedOn.edges, []);
  assert.equal(t.basedOn.createdAt, lucas.createdAt);
});
