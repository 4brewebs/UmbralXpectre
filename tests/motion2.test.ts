import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  answerMotionV2, attachMotionV2, createMotionV2, measuredMatches, motionV2Enabled, paintMotionV2,
  periodPx, pickTemporal, stimulusOf, targetsFor, LUMA_CONTRAST, type MotionV2State,
  E_MAX, E_MIN, MAX_MICHELSON, MIN_CATCHES_PER_BLOCK, requireBlockCatches, startBlock, towardEdge, viewingSetup, STILL_UNRELIABLE,
} from "../src/lib/color/motion2";
import { parseProfile } from "../src/lib/color/profile";
import { predictedLumWeights, predictedMatch } from "../src/lib/color/cones";
import { luminance, type Vec3 } from "../src/lib/color/space";

const profile = () => parseProfile(fs.readFileSync(new URL("./fixtures/perfil_56KB.json", import.meta.url), "utf8"))!;

test("flag apagado por defecto", () => {
  assert.equal(motionV2Enabled("", null), false);
  assert.equal(motionV2Enabled("?motion=v2", null), true);
  assert.equal(motionV2Enabled("", "v2"), true);
  assert.equal(motionV2Enabled("?motion=v1", "v2"), false);
});

test("frecuencia y periodo", () => {
  assert.deepEqual(pickTemporal(60), { framesPerPhase: 2, hz: 7.5 });
  assert.equal(pickTemporal(120).hz, 10);
  assert.equal(pickTemporal(90).hz, 11.25);
  const p = periodPx();
  assert.ok(p > 26 && p < 53, `${p}`);
});

test("colores: siempre contra gris, nunca rojo contra rojo; control en eje no afectado", () => {
  const w = predictedLumWeights("protan", 0.6);
  const t = targetsFor("protan", w, profile().fit.confusionDirectionLinearRgb);
  assert.ok(t.some((x) => x.id === "rojo") && t.some((x) => x.kind === "control"));
  const red = t.find((x) => x.id === "rojo")!;
  // Rango: tabla y severity 0..1, recortado al tope de contraste.
  assert.ok(Math.abs(red.lo - E_MIN) < 1e-3 && red.hi >= 1.1 && red.hi <= E_MAX + 1e-9);
  assert.ok(red.predicted > E_MIN && red.predicted < 1);
  // Rojo a 0.65 del camino al borde, no #FF0000.
  assert.ok(red.color[0] === 1 && red.color[1] > 0.15 && red.color[1] < 0.3);
  assert.deepEqual(towardEdge([1, 0, 0], 1), [1, 0, 0]);
  const s = createMotionV2(profile(), 1);
  for (let i = 0; i < 20 && s.current; i++) {
    const st = stimulusOf(s)!;
    assert.ok(st.ref[0] === st.ref[1] && st.ref[1] === st.ref[2]);
    assert.ok(st.test.every((v) => v <= 1 + 1e-9));
  }
  assert.ok(targetsFor("tritan", predictedLumWeights("tritan"), null).filter((x) => x.kind === "test").length >= 6);
});

test("pinta 4 fotogramas: luminancia ≤ 10 % Michelson", () => {
  const w = 64;
  const data = new Uint8ClampedArray(w * 4 * 4);
  const stim = { test: [0.3, 0, 0] as Vec3, ref: [0.1, 0.1, 0.1] as Vec3, sign: 1 as const };
  paintMotionV2(data, w, 4, 1, 0, stim, 32);
  const ys = Array.from({ length: w }, (_, x) => data[x * 4]);
  const mx = Math.max(...ys);
  const mn = Math.min(...ys);
  const lin = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;
  assert.ok((lin(mx) - lin(mn)) / (lin(mx) + lin(mn)) <= LUMA_CONTRAST + 0.02);
});

/** Observador simulado con pesos w: responde la dirección según el brillo percibido, con ruido. */
function run(state: MotionV2State, w: Vec3, noise: number, seed = 3): MotionV2State {
  let r = seed;
  const rand = () => ((r = (r * 1664525 + 1013904223) % 4294967296), r / 4294967296);
  for (let i = 0; i < 2000 && !state.complete; i++) {
    const st = stimulusOf(state)!;
    const d = Math.log(luminance(st.test, w) / luminance(st.ref, w)) + noise * (rand() * 2 - 1);
    const right = d > 0 === (st.sign === 1);
    state = answerMotionV2(state, right ? "right" : "left", i);
  }
  return state;
}

test("recupera el brillo del rojo de un protán simulado y guarda pesos v3", () => {
  const truth = predictedLumWeights("protan", 0.5);
  let s = createMotionV2(profile(), 42);
  s = run(s, truth, 0.01);
  assert.ok(s.complete);
  const red = measuredMatches(s).find((m) => m.id === "rojo")!;
  const expected = predictedMatch(red.test, red.ref, truth);
  assert.ok(expected > E_MIN && !red.atLeast);
  assert.ok(Math.abs(red.efficiency / expected - 1) < 0.04, `${red.efficiency} vs ${expected}`);
  const p = attachMotionV2(profile(), s, { refreshHz: 60, temporalHz: 7.5, cyclesPerDeg: 0.75 });
  const lum = p.luminance!;
  assert.equal(lum.weightsSource, "measured");
  assert.ok(Math.abs(lum.weights[0] - truth[0]) < 0.03, `${lum.weights} vs ${truth}`);
  assert.equal(lum.matches.length, profile().luminance!.matches.length);
  assert.equal(lum.checks!.catches.missed, 0);
  assert.ok(lum.checks!.catches.shown > 0);
  const again = parseProfile(JSON.stringify(p))!;
  assert.deepEqual(again.luminance!.weights, lum.weights);
  const h = again.history!.sessions.at(-1)!;
  assert.equal(h.kind, "motion-v2");
  assert.equal(h.backgroundY, s.bgY);
  assert.equal(h.count, s.log.length);
});

const lin = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;
function michelsonY(data: Uint8ClampedArray, w: number): number {
  const ys = Array.from({ length: w }, (_, x) => 0.2126729 * lin(data[x * 4]) + 0.7151522 * lin(data[x * 4 + 1]) + 0.072175 * lin(data[x * 4 + 2]));
  return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...ys) + Math.min(...ys));
}

test("tope de Michelson 22 % en Y estándar en cualquier fotograma", () => {
  for (const type of ["protan", "deutan", "tritan", "unknown"] as const) {
    let s = createMotionV2({ ...profile(), luminance: { ...profile().luminance!, type, predicted: type === "unknown" ? null : predictedLumWeights(type, 0.6) } }, 9);
    // Observador extremo: siempre "más oscuro" ⇒ la escalera va al mínimo.
    for (let i = 0; i < 400 && !s.complete; i++) {
      const st = stimulusOf(s)!;
      const w = 64;
      const data = new Uint8ClampedArray(w * 4 * 4);
      for (let f = 0; f < 4; f++) {
        paintMotionV2(data, w, 4, f, f, st, 32);
        assert.ok(michelsonY(data, w) <= MAX_MICHELSON + 0.015, `${type} frame ${f}: ${michelsonY(data, w)}`);
      }
      s = answerMotionV2(s, st.sign === 1 ? "left" : "right", i);
    }
    assert.ok(s.complete);
    const ms = measuredMatches(s);
    assert.ok(ms.filter((m) => m.kind === "test").every((m) => m.atLeast && m.atLeastSide === -1), type);
  }
});

test("colores que piden más contraste quedan como cota «al menos» y no entran en los pesos", () => {
  let s = createMotionV2(profile(), 4);
  s = run(s, predictedLumWeights("protan", 1), 0.005);
  const red = measuredMatches(s).find((m) => m.id === "rojo")!;
  const p = attachMotionV2(profile(), s, { refreshHz: 60, temporalHz: 7.5, cyclesPerDeg: 0.75, viewingCm: 40 });
  const expected = predictedMatch(red.test, red.ref, predictedLumWeights("protan", 1));
  if (expected < E_MIN) assert.equal(red.atLeast, true);
  assert.equal(p.luminance!.viewingCm, 40);
  assert.ok(p.luminance!.measuredMatches.some((m) => m.atLeast) === measuredMatches(s).some((m) => m.atLeast));
});

test("al menos 5 catch trials por bloque", () => {
  let s = createMotionV2(profile(), 11);
  s = startBlock(s);
  s = requireBlockCatches(s);
  let n = 0;
  while (s.pendingCatches > 0 && n < 20) {
    const st = stimulusOf(s)!;
    assert.ok(st.catch);
    s = answerMotionV2(s, "left", n++);
  }
  assert.ok(s.blockCatches >= MIN_CATCHES_PER_BLOCK);
  // Al terminar la prueba, el último bloque también completa sus catch.
  const done = run(createMotionV2(profile(), 12), predictedLumWeights("protan", 0.6), 0.01);
  assert.ok(done.blockCatches >= MIN_CATCHES_PER_BLOCK);
});

test("montaje: móvil 40 cm, PC 60 cm, ~1 ciclo/grado", () => {
  const phone = viewingSetup(390, 844, 3, true);
  assert.equal(phone.device, "phone");
  assert.equal(phone.cm, 40);
  const pc = viewingSetup(1440, 900, 1, false);
  assert.deepEqual([pc.device, pc.cm], ["pc", 60]);
  assert.equal(viewingSetup(1024, 1366, 2, true).device, "pc");
  for (const v of [phone, pc]) {
    // Periodo en mm a esa distancia ⇒ 1 grado.
    const mm = periodPx(1, v.cm, v.cssPxPerMm) / v.cssPxPerMm;
    const deg = (2 * Math.atan(mm / 2 / (v.cm * 10)) * 180) / Math.PI;
    assert.ok(Math.abs(deg - 1) < 0.01, `${deg}`);
  }
});

test("«quieto»: informativo fuera de catch, fallo en catch; bloque poco fiable si > 60 %", () => {
  let s = createMotionV2(profile(), 21);
  let n = 0;
  while (!s.current!.catch && n < 50) {
    const before = s.stairs[s.current!.index].reversals.length;
    const idx = s.current!.index;
    s = answerMotionV2(s, "still", n++);
    assert.equal(s.stairs[idx].reversals.length, before + 1);
  }
  const missed = s.catches.missed;
  s = answerMotionV2(s, "still", n++);
  assert.equal(s.catches.missed, missed + 1);
  s = startBlock(s);
  assert.equal(s.blocks.length, 1);
  assert.equal(s.blocks[0].unreliable, true);
  assert.ok(s.blocks[0].still / s.blocks[0].trials > STILL_UNRELIABLE);
  const done = run(createMotionV2(profile(), 22), predictedLumWeights("protan", 0.5), 0.01);
  assert.ok(done.blocks.length >= 1 && done.blocks.every((b) => !b.unreliable));
  const p = attachMotionV2(profile(), s.complete ? s : { ...s, blocks: s.blocks }, { refreshHz: 60, temporalHz: 7.5, cyclesPerDeg: 0.75, viewingCm: 40, deviceType: "phone", cssPxPerMm: 6.25, stimulusDeg: { width: 10, height: 4 }, sizingHeuristic: "phone-0.16mm-per-css-px" });
  assert.equal(p.luminance!.sizingHeuristic, "phone-0.16mm-per-css-px");
  assert.deepEqual(p.luminance!.stimulusDeg, { width: 10, height: 4 });
  assert.equal(p.luminance!.deviceType, "phone");
  assert.equal(p.luminance!.viewingCm, 40);
  assert.equal(p.luminance!.checks!.unreliableBlocks, 1);
  assert.equal(p.luminance!.checks!.confidence, "low");
});

test("parche central de 4°×2° y ≤ 25 % de la pantalla", async () => {
  const { patchSize, pxOfDegrees, degreesOf, MAX_AREA } = await import("../src/lib/color/motion2.ts");
  assert.ok(Math.abs(degreesOf(pxOfDegrees(4, 60, 1 / 0.26), 60, 1 / 0.26) - 4) < 1e-9);
  const pc = patchSize(60, 1 / 0.26, 900, 1440, 900);
  assert.ok(Math.abs(degreesOf(pc.width, 60, 1 / 0.26) - 4) < 0.05);
  const tiny = patchSize(40, 1 / 0.16, 900, 300, 200);
  assert.ok(tiny.width * tiny.height <= MAX_AREA * 300 * 200 + 2);
});

test("pantalla de prueba: constantes de Colorado, ventana suave y dirección equilibrada", async () => {
  const m = await import("../src/lib/color/motion2.ts");
  assert.ok(m.SCREEN.lineWeber <= 0.15 && m.SCREEN.textWeber <= 0.3 && Math.abs(m.SCREEN.dotWeber) <= 0.15);
  assert.ok(m.SCREEN.marginDeg >= Math.max(1, 1 / m.CYCLES_PER_DEG));
  assert.equal(m.SCREEN.isiMs, 500);
  const mask = m.patchMask(80, 40, 8, 6);
  assert.ok(mask[0] < 0.01 && mask[79] < 0.01 && mask[39 * 80] < 0.01 && mask[20 * 80 + 40] < 0.01, "esquinas y hueco a gris medio");
  assert.ok(mask[20 * 80 + 20] > 0.99 && mask[10 * 80 + 40] > 0.6);
  for (let x = 0; x < 80; x++) assert.ok(mask[x] < 0.05 && mask[39 * 80 + x] < 0.05, "bordes superior/inferior suaves");
  for (let i = 1; i < 80; i++) assert.ok(Math.abs(mask[20 * 80 + i] - mask[20 * 80 + i - 1]) < 0.45, "sin saltos");
  let s = m.createMotionV2({ fit: null, luminance: null } as never, 5);
  const signs: number[] = [];
  for (let i = 0; i < 60 && !s.complete; i++) {
    signs.push(s.current!.sign);
    s = m.answerMotionV2(s, i % 3 ? "left" : "right", i);
  }
  for (let i = 0; i + 1 < signs.length; i += 2) assert.equal(signs[i] + signs[i + 1], 0);
});

test("fondo constante: todos los ensayos centrados en el mismo gris y dentro del gamut", async () => {
  const { createMotionV2: create, answerMotionV2: answer, stimulusOf: stimOf, meanGray: mean } = await import("../src/lib/color/motion2");
  const { parseProfile: parse } = await import("../src/lib/color/profile");
  const { predictedLumWeights: plw } = await import("../src/lib/color/cones");
  const fsm = await import("node:fs");
  const p = parse(fsm.readFileSync(new URL("./fixtures/perfil_56KB.json", import.meta.url), "utf8"))!;
  for (const type of ["normal", "protan", "deutan", "tritan", "unknown"] as const) {
    let s = create({ ...p, luminance: { ...p.luminance!, type, predicted: plw(type === "unknown" ? "normal" : type, 0.6) } } as typeof p, 3);
    const bg = s.bgY;
    assert.ok(bg > 0.05 && bg <= 0.18, `${type} bg ${bg}`);
    for (let i = 0; i < 400 && !s.complete; i++) {
      const st = stimOf(s)!;
      assert.ok(Math.abs(mean(st) - bg) < 1e-6, `${type} media ${mean(st)} ≠ ${bg}`);
      for (const v of [...st.test, ...st.ref]) assert.ok(v <= 1 + 1e-9 && v >= 0);
      s = answer(s, i % 3 === 0 ? "still" : i % 2 ? "left" : "right", i);
      assert.equal(s.bgY, bg);
    }
    console.log(`fondo ${type}: Y = ${bg.toFixed(4)}`);
  }
});
