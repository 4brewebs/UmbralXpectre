import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  answerMotionV2, createMotionV2, measuredMatches, stimulusOf, michelsonOf, questPlusEnabled, attachMotionV2,
  E_MAX, E_MIN, MAX_MICHELSON, type MotionV2State,
} from "../src/lib/color/motion2";
import { parseProfile, type UmbralProfile } from "../src/lib/color/profile";
import { predictedLumWeights, predictedMatch, type ObserverType } from "../src/lib/color/cones";
import { luminance, type Vec3 } from "../src/lib/color/space";
import { loadQuestPlus, motion3 } from "../src/lib/color/questplus";

const base = () => parseProfile(fs.readFileSync(new URL("./fixtures/perfil_56KB.json", import.meta.url), "utf8"))!;
function profileOf(type: ObserverType): UmbralProfile {
  const p = base();
  return { ...p, luminance: { ...p.luminance!, type, predicted: predictedLumWeights(type === "normal" ? "normal" : type, 0.6) } } as UmbralProfile;
}
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Observador simulado con el modelo de 3 respuestas (β 20, δ 0.02, λ 0.03) y pesos verdaderos w. */
function observe(state: MotionV2State, w: Vec3, seed: number): MotionV2State {
  const r = rng(seed);
  const fns = motion3();
  for (let i = 0; i < 3000 && !state.complete; i++) {
    const st = stimulusOf(state)!;
    assert.ok(michelsonOf(st) <= MAX_MICHELSON + 1e-9, "tope de seguridad");
    let answer: "left" | "right" | "still";
    if (st.catch) answer = r() < 0.97 ? (st.sign === 1 ? "right" : "left") : "still";
    else {
      // x = log e; μ verdadero = log del nulo con los pesos w.
      const tgt = state.stairs[state.current!.index].target;
      const mu = Math.log(predictedMatch(tgt.color, [0.18, 0.18, 0.18], w));
      const x = Math.log(st.e);
      const ps = fns.map((f) => f(x, mu, 20, 0.02, 0.03));
      const u = r();
      const k = u < ps[0] ? 0 : u < ps[0] + ps[1] ? 1 : 2;
      answer = k === 1 ? "still" : (k === 0) === (st.sign === 1) ? "right" : "left";
    }
    state = answerMotionV2(state, answer, i);
  }
  return state;
}

test("flag QUEST+ apagado por defecto", () => {
  assert.equal(questPlusEnabled(""), false);
  assert.equal(questPlusEnabled("?motion=v2"), false);
  assert.equal(questPlusEnabled("?motion=v2&qp=1"), true);
});

const cases: Array<[ObserverType, number]> = [["normal", 0], ["protan", 0.3], ["protan", 0.6], ["protan", 1], ["deutan", 0.3], ["deutan", 0.6], ["deutan", 1], ["tritan", 1]];
for (const [type, sev] of cases) {
  test(`QUEST+ converge: ${type} ${sev}`, async () => {
    const Q = await loadQuestPlus();
    const w = predictedLumWeights(type, sev);
    let ok = 0;
    let total = 0;
    const seeds = 6;
    for (let seed = 1; seed <= seeds; seed++) {
      const s = observe(createMotionV2(profileOf(type), seed, Q), w, seed);
      assert.ok(s.complete);
      assert.equal(s.method, "quest+");
      for (const m of measuredMatches(s)) {
        const tgt = s.stairs.find((x) => x.target.id === m.id)!.target;
        const truth = predictedMatch(tgt.color, [0.18, 0.18, 0.18], w);
        total++;
        if (m.atLeast) {
          if (truth <= E_MIN * 1.03 || truth >= E_MAX / 1.03) ok++;
        } else if (Math.abs(Math.log(m.efficiency / truth)) < 0.05) ok++;
        assert.ok(m.trials <= 40);
      }
    }
    assert.ok(ok / total >= 0.9, `${ok}/${total}`);
  });
}

test("QUEST+ guarda searchMethod en el perfil", async () => {
  const Q = await loadQuestPlus();
  const s = observe(createMotionV2(profileOf("protan"), 9, Q), predictedLumWeights("protan", 0.6), 9);
  const p = attachMotionV2(base(), s, { refreshHz: 60, temporalHz: 7.5, cyclesPerDeg: 1 });
  assert.equal(p.luminance!.searchMethod, "quest+");
  void luminance;
});

test("benchmark: ensayos y acierto, QUEST+ frente a la escalera", async () => {
  const Q = await loadQuestPlus();
  const rows: string[] = [];
  for (const [type, sev] of [["normal", 0], ["protan", 0.6], ["deutan", 0.6], ["tritan", 1]] as Array<[ObserverType, number]>) {
    const w = predictedLumWeights(type, sev);
    const acc = { qp: [0, 0, 0], st: [0, 0, 0] };
    for (let seed = 1; seed <= 6; seed++) {
      for (const [k, s] of [["qp", observe(createMotionV2(profileOf(type), seed, Q), w, seed)], ["st", observe(createMotionV2(profileOf(type), seed), w, seed)]] as const) {
        const a = acc[k];
        for (const m of measuredMatches(s)) {
          const tgt = s.stairs.find((x) => x.target.id === m.id)!.target;
          const truth = predictedMatch(tgt.color, [0.18, 0.18, 0.18], w);
          a[2]++;
          a[0] += m.trials;
          if (m.atLeast ? truth <= E_MIN * 1.03 || truth >= E_MAX / 1.03 : Math.abs(Math.log(m.efficiency / truth)) < 0.05) a[1]++;
        }
      }
    }
    const f = (a: number[]) => `${(a[0] / a[2]).toFixed(1)} ens/obj, ${((100 * a[1]) / a[2]).toFixed(0)}% ±5%`;
    rows.push(`${type} ${sev}: QUEST+ ${f(acc.qp)} | escalera ${f(acc.st)}`);
  }
  console.log("BENCH\n" + rows.join("\n"));
  assert.ok(rows.length === 4);
});
