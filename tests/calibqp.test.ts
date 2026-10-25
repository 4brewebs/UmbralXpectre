import test from "node:test";
import assert from "node:assert/strict";
import { loadQuestPlus, weibull } from "../src/lib/color/questplus";
import { gammaOf, pairDeltaE, stepForDeltaE, QP_CALIB } from "../src/lib/color/calibqp";
import { answer, createSession, parseQpResume, qpResumeOf, stimulusOf, type Session } from "../src/lib/color/session";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Umbral simulado en ΔE00 por ángulo: elipse alargada en la dirección de confusión θc. */
const observers: Record<string, { a: number; b: number; tc: number }> = {
  normal: { a: 1.5, b: 1.5, tc: 0 },
  protan: { a: 7, b: 1.5, tc: 0.2 },
  deutan: { a: 6, b: 1.5, tc: -0.3 },
  tritan: { a: 5, b: 1.5, tc: 1.6 },
};
const alphaAt = (o: { a: number; b: number; tc: number }, th: number) => 1 / Math.hypot(Math.cos(th - o.tc) / o.a, Math.sin(th - o.tc) / o.b);

function run(session: Session, o: { a: number; b: number; tc: number }, fa: number, seed: number): Session {
  const r = rng(seed);
  for (let i = 0; i < 400 && !session.complete; i++) {
    const st = stimulusOf(session)!;
    let p: number;
    if (st.catch) p = fa;
    else {
      const axis = session.axes.find((a) => a.id === st.axisId)!;
      p = weibull(pairDeltaE(axis.theta, st.s), alphaAt(o, axis.theta), 3, fa, 0.03);
    }
    session = answer(session, r() < p ? "different" : "same", i);
  }
  return session;
}

test("γ = falsas alarmas acotadas a [0,02, 0,3] con ≥ 5 catch", () => {
  assert.equal(gammaOf(4, 4), QP_CALIB.gammaDefault);
  assert.equal(gammaOf(10, 0), 0.02);
  assert.equal(gammaOf(10, 1), 0.1);
  assert.equal(gammaOf(10, 9), 0.3);
});

test("ΔE00 → paso s por bisección", () => {
  for (const th of [0, 1, 2.5, -2]) {
    const s = stepForDeltaE(th, 2, 0.3);
    assert.ok(Math.abs(pairDeltaE(th, s) - 2) < 1e-6);
  }
});

test("sin flag, la sesión no cambia (sin QUEST+)", () => {
  const s = createSession(5);
  assert.equal(s.questPlus, undefined);
  assert.ok(s.axes.every((a) => a.qpLog === undefined));
});

/** Sesiones QUEST+ encadenadas (tope 80 cada una) hasta que no queda nada que reanudar. */
async function chain(o: { a: number; b: number; tc: number }, seed: number, Q: Awaited<ReturnType<typeof loadQuestPlus>>) {
  let resume = null;
  let total = 0;
  let sessions = 0;
  let last: Session | null = null;
  do {
    const s = run(createSession(seed * 100 + sessions, Q, resume), o, 0.1, seed * 100 + sessions);
    assert.ok(s.log.length <= 80, `sesión de ${s.log.length}`);
    total += s.log.length;
    sessions++;
    // Ida y vuelta por JSON, como en localStorage.
    resume = parseQpResume(JSON.stringify(qpResumeOf(s, 1)));
    last = s;
  } while (resume && sessions < 6);
  return { last: last!, total, sessions };
}

test("calibración QUEST+: tope de 80 y reanudación con el posterior guardado", async () => {
  const Q = await loadQuestPlus();
  const first = run(createSession(1, Q), observers.protan, 0.1, 1);
  assert.equal(first.log.length, 80);
  const r = qpResumeOf(first, 1)!;
  assert.ok(r.axes.some((a) => a.open));
  const sum = r.axes[0].posterior.probs.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  const next = createSession(2, Q, parseQpResume(JSON.stringify(r)));
  assert.equal(next.catchHits + next.catchMisses, first.catchHits + first.catchMisses);
  for (const a of next.axes) {
    const old = r.axes.find((x) => x.id === a.id)!;
    assert.equal(a.phase === "done", !old.open);
    assert.equal(a.qpLog!.length, old.qpLog.length);
  }
  assert.equal(qpResumeOf(createSession(3), 1), null);
});

for (const [name, o] of Object.entries(observers)) {
  test(`calibración QUEST+ sí/no converge: ${name}`, async () => {
    const Q = await loadQuestPlus();
    let ok = 0;
    let total = 0;
    let nQ = 0;
    let nS = 0;
    let nSess = 0;
    let okS = 0;
    let totalS = 0;
    const N = 6;
    for (let seed = 1; seed <= N; seed++) {
      const c = await chain(o, seed, Q);
      const q = c.last;
      const s = run(createSession(seed), o, 0.1, seed);
      assert.ok(q.complete && s.complete);
      assert.ok(q.catchHits + q.catchMisses >= 5);
      nQ += c.total;
      nSess += c.sessions;
      nS += s.log.length;
      for (const a of s.axes) {
        if (a.threshold == null || a.thresholdKind !== "estimate") continue;
        const truth = alphaAt(o, a.theta);
        if (truth > Math.min(QP_CALIB.deMax, pairDeltaE(a.theta, a.maxS)) * 0.9) continue;
        totalS++;
        if (Math.abs(Math.log(pairDeltaE(a.theta, a.threshold) / truth)) < Math.log(1.35)) okS++;
      }
      for (const a of q.axes) {
        if (!a.qpEstimate) continue;
        const truth = alphaAt(o, a.theta);
        if (truth > Math.min(QP_CALIB.deMax, a.qpReach ?? 0) * 0.9) continue;
        total++;
        if (Math.abs(Math.log(a.qpEstimate.deltaE00 / truth)) < Math.log(1.35)) ok++;
      }
    }
    console.log(`calib ${name}: QUEST+ ${ok}/${total} ejes en ×1,35, ${(nQ / N).toFixed(1)} ensayos en ${(nSess / N).toFixed(1)} sesiones; escalera ${okS}/${totalS} (solo «estimate»), ${(nS / N).toFixed(1)}`);
    assert.ok(ok / total >= 0.8, `${ok}/${total}`);
  });
}
