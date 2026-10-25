/**
 * Adaptive constant-luminance matcher.
 *
 * The two cards of a trial are the same step on either side of gray, so an angle
 * and the angle opposite it are one line, not two pathways. A staircase that
 * never hears "same" stores an upper bound at the smallest step still separated,
 * and every axis is walked down to the same absolute step.
 */

import {
  ANCHOR,
  addScaled,
  angDist,
  dirFromTheta,
  hueName,
  killLuminance,
  maxScale,
  normalize,
  searchPriors,
  thetaOf,
  toSrgb8,
  type PriorKey,
  type Vec3,
} from "./space";
import type { JsQuest } from "./questplus";
import { QP_CALIB, gammaOf, pairDeltaE, stepAxis, stepForDeltaE, type QpLog } from "./calibqp";

export type Judgment = "same" | "different";
export type Phase = "descend" | "confirm" | "bisect" | "done";
export type ThresholdKind = "upper-bound" | "estimate";

/** Fractions of the in-gamut scale. Large first, then tighter. */
export const DESCEND: readonly number[] = [0.62, 0.34, 0.18, 0.09];

const CLOSE_NORM = 0.12;
/** Smallest step asked on every axis, in linear sRGB. A long-gamut red is not "closed" at a coarser step. */
export const ABS_CLOSE = 0.02;
const BISECT_GAP = 0.04;
const BISECT_CAP = 6;
const REFINE_CAP = 4;
const SESSION_CAP = 160;
const REFINE_DELTA = 0.36;

export interface Axis {
  id: string;
  theta: number;
  priorKey: PriorKey | "refine";
  parentId?: string;
  hue: string;
  searchPrior: string | null;
  maxS: number;
  descendIndex: number;
  phase: Phase;
  lo: number;
  hi: number;
  cursor: number;
  trials: number;
  bisectSteps: number;
  threshold: number | null;
  thresholdKind: ThresholdKind | null;
  /** Solo con QUEST+ (`?qp=1`): ensayos en ΔE00, ΔE00 del par actual, alcance y estimación. */
  qpLog?: QpLog;
  qpDe?: number;
  qpReach?: number;
  qpEstimate?: { deltaE00: number; lo: number; hi: number; gamma: number };
}

export interface TrialRecord {
  axisId: string;
  hue: string;
  priorKey: Axis["priorKey"] | "catch";
  theta: number;
  s: number;
  sNorm: number;
  judgment: Judgment;
  reference: [number, number, number];
  comparison: [number, number, number];
  side: "left" | "right";
  at: number;
}

export interface Session {
  axes: Axis[];
  activeId: string | null;
  log: TrialRecord[];
  complete: boolean;
  note: string;
  side: "left" | "right";
  startedAt: number;
  rngState: number;
  pendingCatch: boolean;
  sinceCatch: number;
  catchSlot: number;
  catchHits: number;
  catchMisses: number;
  /** jsQuestPlus cargado: QUEST+ sí/no por eje (flag `?qp=1`). Pares y catch no cambian. */
  questPlus?: JsQuest;
}

export interface Stimulus {
  axisId: string;
  hue: string;
  priorKey: Axis["priorKey"] | "catch";
  phase: Phase;
  s: number;
  sNorm: number;
  reference: [number, number, number];
  comparison: [number, number, number];
  side: "left" | "right";
  step: number;
  priorsDone: number;
  priorTotal: number;
  refining: boolean;
  catch: boolean;
}

function gray(): Vec3 {
  return [ANCHOR, ANCHOR, ANCHOR];
}

function axisFromPrior(
  id: string,
  theta: number,
  priorKey: Axis["priorKey"],
  hue: string,
  searchPrior: string | null,
  maxS: number,
  phase: Phase,
  cursor: number,
  parentId?: string,
): Axis {
  return {
    id,
    theta,
    priorKey,
    parentId,
    hue,
    searchPrior,
    maxS,
    descendIndex: 0,
    phase,
    lo: 0,
    hi: maxS,
    cursor,
    trials: 0,
    bisectSteps: 0,
    threshold: null,
    thresholdKind: null,
  };
}

function nextRand(state: number): { state: number; value: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function endAxis(id: "red-end" | "blue-end", primary: Vec3, hue: string, searchPrior: string): Axis {
  const dir = normalize(killLuminance(primary));
  const theta = thetaOf(dir);
  const aligned = dirFromTheta(theta);
  const opposite: Vec3 = [-aligned[0], -aligned[1], -aligned[2]];
  const scale = Math.min(maxScale(aligned), maxScale(opposite));
  return axisFromPrior(id, theta, id, hue, searchPrior, scale, "descend", DESCEND[0] * scale);
}

/** γ actual: falsas alarmas («distinto» en un par idéntico) de los catch. */
export function sessionGamma(session: Pick<Session, "catchHits" | "catchMisses">): number {
  return gammaOf(session.catchHits + session.catchMisses, session.catchMisses);
}

function initQp(axis: Axis, Q: JsQuest, gamma: number): Axis {
  const qpReach = pairDeltaE(axis.theta, axis.maxS);
  const first = stepAxis(Q, qpReach, gamma, []);
  return { ...axis, phase: "bisect", qpLog: [], qpReach, qpDe: first.nextDe, cursor: stepForDeltaE(axis.theta, first.nextDe, axis.maxS) };
}

function qpThreshold(axis: Axis, Q: JsQuest, gamma: number): number {
  const res = stepAxis(Q, axis.qpReach ?? 0, gamma, axis.qpLog ?? []);
  axis.qpEstimate = { deltaE00: res.estimate.mean, lo: res.estimate.lo, hi: res.estimate.hi, gamma };
  return stepForDeltaE(axis.theta, res.estimate.mean, axis.maxS);
}

export function createSession(now = 0, questPlus?: JsQuest): Session {
  const priors = searchPriors();
  const axes = disambiguate([
    ...priors.map((p) => axisFromPrior(p.key, p.theta, p.key, p.hue, p.searchPrior, p.maxS, "descend", DESCEND[0] * p.maxS)),
    endAxis("red-end", [1, 0, 0], "rojo extremo", "last red this display emits"),
    endAxis("blue-end", [0, 0, 1], "azul extremo", "first blue this display emits"),
  ]);
  let rngState = (now || 1) >>> 0;
  const startRoll = nextRand(rngState);
  rngState = startRoll.state;
  const catchRoll = nextRand(rngState);
  rngState = catchRoll.state;
  const start = axes[Math.floor(startRoll.value * axes.length)] ?? null;
  return {
    axes: questPlus ? axes.map((a) => initQp(a, questPlus, QP_CALIB.gammaDefault)) : axes,
    ...(questPlus ? { questPlus } : {}),
    activeId: start?.id ?? null,
    log: [],
    complete: false,
    note: "Algunos pares son el mismo color. Juzga en reposo, no el salto.",
    side: "left",
    startedAt: now,
    rngState,
    pendingCatch: catchRoll.value < 0.34,
    sinceCatch: 0,
    catchSlot: Math.floor(catchRoll.value * 4),
    catchHits: 0,
    catchMisses: 0,
  };
}

function disambiguate(axes: Axis[]): Axis[] {
  const counts = new Map<string, number>();
  for (const a of axes) counts.set(a.hue, (counts.get(a.hue) ?? 0) + 1);
  const seen = new Map<string, number>();
  return axes.map((a) => {
    if ((counts.get(a.hue) ?? 0) < 2) return a;
    const n = (seen.get(a.hue) ?? 0) + 1;
    seen.set(a.hue, n);
    return { ...a, hue: `${a.hue} ${n}` };
  });
}

export function activeAxis(session: Session): Axis | null {
  return session.axes.find((a) => a.id === session.activeId) ?? null;
}

function catchColor(slot: number): Vec3 {
  if (slot % 4 === 0) return gray();
  const primary: Vec3 = slot % 4 === 1 ? [1, 0, 0] : slot % 4 === 2 ? [0, 0, 1] : [0, 1, 0];
  const dir = normalize(killLuminance(primary));
  return addScaled(gray(), dir, maxScale(dir) * 0.42);
}

export function stimulusOf(session: Session): Stimulus | null {
  const axis = activeAxis(session);
  if (!axis || session.complete) return null;
  const priors = session.axes.filter((a) => a.priorKey !== "refine");
  const shared = {
    step: session.log.length + 1,
    priorsDone: priors.filter((a) => a.phase === "done").length,
    priorTotal: priors.length,
    side: session.side,
  };
  if (session.pendingCatch) {
    const rgb = toSrgb8(catchColor(session.catchSlot));
    return {
      axisId: "catch",
      hue: "igual",
      priorKey: "catch",
      phase: axis.phase,
      s: 0,
      sNorm: 0,
      reference: rgb,
      comparison: rgb,
      refining: false,
      catch: true,
      ...shared,
    };
  }
  const dir = dirFromTheta(axis.theta);
  const positive = toSrgb8(addScaled(gray(), dir, axis.cursor));
  const negative = toSrgb8(addScaled(gray(), dir, -axis.cursor));
  return {
    axisId: axis.id,
    hue: axis.hue,
    priorKey: axis.priorKey,
    phase: axis.phase,
    s: axis.cursor,
    sNorm: axis.maxS > 0 ? axis.cursor / axis.maxS : 0,
    reference: negative,
    comparison: positive,
    refining: axis.priorKey === "refine",
    catch: false,
    ...shared,
  };
}

function finish(axis: Axis, threshold: number, kind: ThresholdKind) {
  axis.phase = "done";
  axis.threshold = threshold;
  axis.thresholdKind = kind;
  axis.cursor = threshold;
}

function closeNote(axis: Axis): string {
  return `«${axis.hue}» sigue separado en el paso pequeño. Menos pruebas en esta vía; las otras siguen.`;
}

function draw(session: Session): { session: Session; value: number } {
  const rolled = nextRand(session.rngState);
  return { session: { ...session, rngState: rolled.state }, value: rolled.value };
}

function pickNext(session: Session, axes: Axis[], currentId: string): { session: Session; axis: Axis | null } {
  const open = axes.filter((axis) => axis.phase !== "done" && axis.id !== currentId);
  const pool = open.length ? open : axes.filter((axis) => axis.phase !== "done");
  if (!pool.length) return { session, axis: null };
  const rolled = draw(session);
  return { session: rolled.session, axis: pool[Math.floor(rolled.value * pool.length)] ?? pool[0] };
}

function makeRefinements(parent: Axis, existing: Axis[]): Axis[] {
  const parentFrac = parent.maxS > 0 ? (parent.threshold ?? 0) / parent.maxS : 0;
  const spawned: Axis[] = [];
  for (const delta of [-REFINE_DELTA, REFINE_DELTA]) {
    const theta = Math.atan2(Math.sin(parent.theta + delta), Math.cos(parent.theta + delta));
    if (existing.some((a) => angDist(a.theta, theta) < 0.16)) continue;
    if (spawned.some((a) => angDist(a.theta, theta) < 0.16)) continue;
    const dir = dirFromTheta(theta);
    const scale = maxScale(dir);
    if (scale < 0.05) continue;
    const cursor = Math.min(scale * 0.94, Math.max(scale * 0.05, parentFrac * scale));
    spawned.push(
      axisFromPrior(
        `${parent.id}:${delta > 0 ? "+" : "-"}`,
        theta,
        "refine",
        hueName(addScaled(gray(), dir, scale * 0.5)),
        null,
        scale,
        "bisect",
        cursor,
        parent.id,
      ),
    );
  }
  return disambiguate(spawned);
}

export function answer(session: Session, judgment: Judgment, now = 0): Session {
  const stim = stimulusOf(session);
  if (!stim || !session.activeId) return session;
  if (stim.catch) return answerCatch(session, stim, judgment, now);

  const axes = session.axes.map((a) => ({ ...a }));
  const axis = axes.find((a) => a.id === session.activeId);
  if (!axis) return session;

  const log: TrialRecord[] = [
    ...session.log,
    {
      axisId: stim.axisId,
      hue: stim.hue,
      priorKey: stim.priorKey,
      theta: axis.theta,
      s: stim.s,
      sNorm: stim.sNorm,
      judgment,
      reference: stim.reference,
      comparison: stim.comparison,
      side: stim.side,
      at: now,
    },
  ];

  axis.trials += 1;
  let note = "";
  const Q = session.questPlus;

  if (Q && axis.qpLog) {
    const gamma = sessionGamma(session);
    axis.qpLog = [...axis.qpLog, [axis.qpDe ?? QP_CALIB.deMin, judgment === "different" ? 0 : 1]];
    const res = stepAxis(Q, axis.qpReach ?? 0, gamma, axis.qpLog);
    if (res.done) {
      finish(axis, qpThreshold(axis, Q, gamma), "estimate");
      note = "Límite medido en este ángulo. Las otras vías siguen su propio margen.";
    } else {
      axis.qpDe = res.nextDe;
      axis.cursor = stepForDeltaE(axis.theta, res.nextDe, axis.maxS);
      note = "Estrecho el margen.";
    }
  } else if (axis.phase === "descend") {
    if (judgment === "different") {
      axis.hi = axis.cursor;
      if (axis.descendIndex >= DESCEND.length - 1) {
        axis.phase = "confirm";
        note = "Paso pequeño separado. Lo compruebo otra vez, no justo después, por si era el cambio.";
      } else {
        axis.descendIndex += 1;
        axis.cursor = DESCEND[axis.descendIndex] * axis.maxS;
        note = "Lo separas. Bajo el contraste y paso por las otras vías antes de volver.";
      }
    } else {
      axis.lo = axis.cursor;
      axis.hi = axis.descendIndex === 0 ? axis.maxS : DESCEND[axis.descendIndex - 1] * axis.maxS;
      axis.phase = "bisect";
      axis.cursor = (axis.lo + axis.hi) / 2;
      note = "Aquí no coincide. Estrecho el límite de esta vía.";
    }
  } else if (axis.phase === "confirm") {
    if (judgment === "different") {
      finish(axis, axis.cursor, "upper-bound");
      note = closeNote(axis);
    } else {
      axis.lo = axis.cursor;
      axis.hi = DESCEND[DESCEND.length - 2] * axis.maxS;
      axis.phase = "bisect";
      axis.cursor = (axis.lo + axis.hi) / 2;
      note = "En reposo ya no lo separas. El salto anterior pudo bastar. Estrecho el límite.";
    }
  } else if (axis.phase === "bisect") {
    if (judgment === "same") axis.lo = Math.max(axis.lo, axis.cursor);
    else axis.hi = Math.min(axis.hi, axis.cursor);
    axis.bisectSteps += 1;
    const gap = axis.maxS > 0 ? (axis.hi - axis.lo) / axis.maxS : 0;
    const cap = axis.priorKey === "refine" ? REFINE_CAP : BISECT_CAP;
    if (gap < BISECT_GAP || axis.bisectSteps >= cap) {
      const threshold = (axis.lo + axis.hi) / 2;
      const norm = axis.maxS > 0 ? threshold / axis.maxS : 0;
      finish(axis, threshold, "estimate");
      note =
        norm <= CLOSE_NORM
          ? closeNote(axis)
          : "Límite medido en este ángulo. Las otras vías siguen su propio margen.";
    } else {
      axis.cursor = (axis.lo + axis.hi) / 2;
      note = "Estrecho el margen.";
    }
  }

  let nextAxes = axes;
  if (
    axis.phase === "done" &&
    axis.priorKey !== "refine" &&
    axis.priorKey !== "control" &&
    axis.thresholdKind === "estimate" &&
    axis.maxS > 0 &&
    (axis.threshold ?? 0) / axis.maxS > CLOSE_NORM
  ) {
    const made = makeRefinements(axis, axes);
    const extra = Q ? made.map((a) => initQp(a, Q, sessionGamma(session))) : made;
    if (extra.length) {
      nextAxes = axes.concat(extra);
      note = `Duda en «${axis.hue}». Miro al lado, sin dejar las otras vías.`;
    }
  }

  if (log.length >= SESSION_CAP) {
    for (const a of nextAxes) {
      if (a.phase !== "done") finish(a, Q && a.qpLog ? qpThreshold(a, Q, sessionGamma(session)) : (a.lo + a.hi) / 2 || a.cursor, "estimate");
    }
  }

  const next = pickNext({ ...session, sinceCatch: session.sinceCatch + 1 }, nextAxes, axis.id);
  let pendingCatch = false;
  let sinceCatch = next.session.sinceCatch;
  let catchSlot = session.catchSlot;
  let scheduled = next.session;
  if (next.axis && sinceCatch >= 3) {
    const rolled = draw(scheduled);
    scheduled = rolled.session;
    if (rolled.value < 0.55 || sinceCatch >= 5) {
      pendingCatch = true;
      sinceCatch = 0;
      catchSlot = Math.floor(rolled.value * 4);
    }
  }
  return {
    ...scheduled,
    axes: nextAxes,
    log,
    activeId: next.axis?.id ?? null,
    complete: !next.axis,
    note,
    side: log.length % 2 === 0 ? "left" : "right",
    pendingCatch: next.axis ? pendingCatch : false,
    sinceCatch,
    catchSlot,
  };
}

function answerCatch(session: Session, stim: Stimulus, judgment: Judgment, now: number): Session {
  const hit = judgment === "same";
  const log: TrialRecord[] = [
    ...session.log,
    {
      axisId: "catch",
      hue: stim.hue,
      priorKey: "catch",
      theta: 0,
      s: 0,
      sNorm: 0,
      judgment,
      reference: stim.reference,
      comparison: stim.comparison,
      side: stim.side,
      at: now,
    },
  ];
  const next = pickNext(session, session.axes, session.activeId ?? "");
  return {
    ...next.session,
    log,
    activeId: next.axis?.id ?? null,
    complete: !next.axis,
    note: "",
    side: log.length % 2 === 0 ? "left" : "right",
    pendingCatch: false,
    sinceCatch: 0,
    catchHits: session.catchHits + (hit ? 1 : 0),
    catchMisses: session.catchMisses + (hit ? 0 : 1),
  };
}

export function axisNorm(axis: Axis): number {
  if (axis.threshold == null || axis.maxS <= 0) return 0;
  return axis.threshold / axis.maxS;
}

export function isClosed(axis: Axis): boolean {
  return axis.phase === "done" && axis.threshold != null && axis.threshold <= ABS_CLOSE * 1.25;
}
