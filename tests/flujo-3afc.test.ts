// Flujo nuevo: perfil sí/no sin ruido (tope 60), luminancia igual, validación 3AFC (sustituye al repaso), bordes opcionales 8–20.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { answer, createSession, stimulusOf } from "../src/lib/color/session";
import { edgeInputFromProfile, QP_EDGES } from "../src/lib/color/edges";
import { buildProfile, type HardwareSnapshot } from "../src/lib/color/profile";
import { buildFilterTransforms, filterProfile } from "../src/lib/color/lut";
import { answerValidation, applyValidation, createValidation, oddPosition, VALIDATION, validationEstimates, validationStimulus, type ValidationState } from "../src/lib/color/validation";

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

test("validación: 3 campos, 2 iguales y 1 distinto, posición aleatoria, 10 por eje, sin catch, γ = 1/3", async () => {
  const Q = await loadQuestPlus();
  assert.equal(VALIDATION.gamma, 1 / 3);
  assert.equal(VALIDATION.trialsPerAxis, 10);
  const st0 = createValidation(lucas, Q, { seed: 42 })!;
  const x = validationStimulus(st0)!;
  assert.equal(x.fields.length, 3);
  const others = x.fields.filter((_, i) => i !== x.odd);
  assert.deepEqual(others[0], others[1]);
  assert.notDeepEqual(x.fields[x.odd], others[0]);
  assert.equal(x.total, 20);
  const pos = new Set(Array.from({ length: 30 }, (_, n) => oddPosition(42, n)));
  assert.deepEqual([...pos].sort(), [0, 1, 2]);
  const st = await run({ l: orig("l"), m: orig("m") }, 3);
  assert.equal(st.log.length, 20);
  assert.equal(st.log.filter((t) => t.axis === "l").length, 10);
  assert.ok(st.log.every((t) => t.axis === "l" || t.axis === "m"));
});

test("validación: el prior se centra en el umbral del perfil", async () => {
  const Q = await loadQuestPlus();
  const st = createValidation(lucas, Q, { seed: 1 })!;
  for (const e of validationEstimates(st)) assert.ok(Math.abs(Math.log(e.threshold / e.thresholdStandardY)) < 0.05, `${e.id} ${e.threshold}`);
});

test("validación: sustituye el umbral, guarda el original y etiqueta «confirmado» si cae en el IC", async () => {
  let confirmed = 0;
  for (let k = 0; k < 20; k++) {
    const st = await run({ l: orig("l"), m: orig("m") }, 100 + k);
    const p = applyValidation(lucas, st);
    for (const id of ["l", "m"]) {
      const a = p.axes.find((x) => x.id === id)!;
      const v = p.validation!.axes.find((x) => x.id === id)!;
      assert.equal(a.thresholdSource, "validation-3afc");
      assert.equal(a.thresholdStandardY, orig(id));
      assert.equal(a.threshold, v.threshold);
      if (v.label === "confirmado") confirmed++;
      assert.equal(v.label === "confirmado", v.lo <= orig(id) && orig(id) <= v.hi);
    }
  }
  assert.ok(confirmed >= 34, `confirmados ${confirmed}/40`);
});

test("validación: razón fuera de [½, 2] solo avisa (el umbral se sustituye igual)", async () => {
  const st = await run({ l: orig("l") * 4, m: orig("m") }, 9);
  const p = applyValidation(lucas, st);
  const l = p.validation!.axes.find((x) => x.id === "l")!;
  assert.ok(l.ratio > 2, `razón ${l.ratio}`);
  assert.equal(l.label, "nuevo");
  assert.ok(p.validation!.warnings?.some((w) => w.startsWith("ratio-out-of-range l")));
  assert.equal(p.axes.find((x) => x.id === "l")!.threshold, l.threshold);
});

test("bordes: parten del umbral validado, mínimo 8 y tope 20 QUEST+ por lado", async () => {
  assert.equal(QP_EDGES.minTrials, 8);
  assert.equal(QP_EDGES.maxTrials, 20);
  const st = await run({ l: orig("l") * 1.8, m: orig("m") }, 5);
  const p = applyValidation(lucas, st);
  const l = p.axes.find((x) => x.id === "l")!;
  assert.equal(edgeInputFromProfile(p, "l").sourceThreshold, l.threshold);
});

test("filtros: sin validación no hay; con ella salen solo de sus ejes y basedOn lo dice", async () => {
  assert.equal(filterProfile(lucas), null);
  assert.equal(buildFilterTransforms(lucas), null);
  const st = await run({ l: orig("l"), m: orig("m") }, 11);
  const p = applyValidation(lucas, st);
  const base = filterProfile(p)!;
  assert.deepEqual(base.axes.map((a) => a.id).sort(), ["l", "m"]);
  const t = buildFilterTransforms(p, [])!;
  assert.equal(t.basedOn.thresholds, "validation-3afc");
  assert.deepEqual(t.basedOn.validation!.map((v) => v.threshold), base.axes.map((a) => a.threshold));
  assert.deepEqual(t.basedOn.edges, []);
  assert.equal(t.basedOn.createdAt, lucas.createdAt);
});
