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
  isoDir,
  fromSrgb8,
  lumEps,
  makeLumNoise,
  withLum,
  type LumNoise,
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
import { QP_CALIB, entropyOf, gammaOf, logWidth, pairDeltaE, posteriorOf, stepAxis, stepForDeltaE, type QpLog } from "./calibqp";

export type Judgment = "same" | "different";
export type Phase = "descend" | "confirm" | "bisect" | "done";
export type ThresholdKind = "upper-bound" | "estimate";

/**
 * Fractions of the in-gamut scale. Large first, then tighter. Extended down to ≈0.006 lineal
 * (0.0225 × ~0.27) so a good control is measured, not clipped at the grid. Index 0 only for the jitter.
 */
export const DESCEND: readonly number[] = [0.85, 0.62, 0.34, 0.18, 0.09, 0.045, 0.0225];
/** Rung where a descent normally starts; each axis starts ±1 rung at random (same answers ≠ same levels). */
export const DESCEND_START = 1;
/** Near the threshold the bisection stops on a relative gap too (finer steps at small thresholds). */
const BISECT_REL_GAP = 0.25;

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
  /** Rung where this axis started (jitter ±1). Absent: DESCEND_START (older saved sessions). */
  descendStart?: number;
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
  /**
   * «Al menos» el alcance: el posterior sigue por encima del par más fuerte que da la pantalla. Resultado válido
   * (umbral = alcance del gamut), nunca «cerrado» como umbral medido.
   */
  qpBound?: "gamut-limit";
  /** Cerrado por el tope de sesión, no por su regla de parada: se puede reanudar. */
  qpForced?: boolean;
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
  /** ε aplicados [referencia, comparación] (ruido de luminancia). */
  lumEps?: [number, number];
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
  /** Solo QUEST+: el catch pendiente es un par obvio (+20 % de Y), no idéntico. No entra en γ. */
  catchObvious?: boolean;
  obviousShown?: number;
  obviousMissed?: number;
  /** jsQuestPlus cargado: QUEST+ sí/no por eje (flag `?qp=1`). Pares y catch no cambian. */
  questPlus?: JsQuest;
  /** Pesos personales de luminancia medidos (C1); sin ellos, Y estándar. */
  lumWeights?: Vec3;
  /** Ruido de luminancia por estímulo (sin él, ?lumnoise=0, todo como antes). */
  lumNoise?: LumNoise;
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
  /** ε aplicados [referencia, comparación]. */
  lumEps?: [number, number];
  side: "left" | "right";
  step: number;
  priorsDone: number;
  priorTotal: number;
  refining: boolean;
  catch: boolean;
  /** Catch de par obvio (respuesta esperada «distinto»). */
  obvious?: boolean;
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
    descendIndex: DESCEND_START,
    descendStart: DESCEND_START,
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

function endAxis(id: "red-end" | "blue-end", primary: Vec3, hue: string, searchPrior: string, w?: Vec3): Axis {
  const dir = normalize(w ? killLuminance(primary, w) : killLuminance(primary));
  const theta = thetaOf(dir);
  const aligned = dirFromTheta(theta);
  const opposite: Vec3 = [-aligned[0], -aligned[1], -aligned[2]];
  const scale = Math.min(maxScale(aligned), maxScale(opposite));
  return axisFromPrior(id, theta, id, hue, searchPrior, scale, "descend", DESCEND[DESCEND_START] * scale);
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
  if (res.bound) {
    axis.qpBound = "gamut-limit";
    return axis.maxS;
  }
  delete axis.qpBound;
  return stepForDeltaE(axis.theta, res.estimate.mean, axis.maxS);
}

/** Estado para reanudar la calibración QUEST+ en otra sesión (localStorage y perfil). */
export interface QpResume {
  schema: "umbral.calib.qp.v1";
  savedAt: number;
  catchHits: number;
  catchMisses: number;
  axes: Array<{
    id: string;
    theta: number;
    priorKey: Axis["priorKey"];
    parentId: string | null;
    hue: string;
    searchPrior: string | null;
    maxS: number;
    qpLog: QpLog;
    open: boolean;
    threshold: number | null;
    qpEstimate: Axis["qpEstimate"] | null;
    qpBound?: Axis["qpBound"];
    /** Posterior marginal de α (ΔE00); se puede reconstruir exacto desde `qpLog` y γ. */
    posterior: { alphas: number[]; probs: number[] };
  }>;
}

export const QP_RESUME_KEY = "umbral.calib.qp.resume";

/** Null si todos los ejes pararon por su regla (nada que reanudar). */
export function qpResumeOf(session: Session, now = 0): QpResume | null {
  const Q = session.questPlus;
  const reopen = (a: Axis) => !!a.qpForced || (a.phase === "done" && !!a.qpLog && !a.qpBound && !isClosed(a));
  if (!Q || !session.axes.some(reopen)) return null;
  const gamma = sessionGamma(session);
  return {
    schema: "umbral.calib.qp.v1",
    savedAt: now,
    catchHits: session.catchHits,
    catchMisses: session.catchMisses,
    axes: session.axes.map((a) => ({
      id: a.id,
      theta: a.theta,
      priorKey: a.priorKey,
      parentId: a.parentId ?? null,
      hue: a.hue,
      searchPrior: a.searchPrior,
      maxS: a.maxS,
      qpLog: a.qpLog ?? [],
      open: reopen(a),
      threshold: a.threshold,
      qpEstimate: a.qpEstimate ?? null,
      ...(a.qpBound ? { qpBound: a.qpBound } : {}),
      posterior: posteriorOf(Q, a.qpReach ?? pairDeltaE(a.theta, a.maxS), gamma, a.qpLog ?? []),
    })),
  };
}

export function parseQpResume(raw: string | null): QpResume | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as QpResume;
    return r?.schema === "umbral.calib.qp.v1" && Array.isArray(r.axes) ? r : null;
  } catch {
    return null;
  }
}

/** Sesión que sigue una anterior: ejes cerrados se quedan; los abiertos siguen con sus ensayos. */
function resumeAxes(resume: QpResume, Q: JsQuest, gamma: number): Axis[] {
  return resume.axes.map((r) => {
    const base = axisFromPrior(r.id, r.theta, r.priorKey, r.hue, r.searchPrior, r.maxS, "bisect", 0, r.parentId ?? undefined);
    const qpReach = pairDeltaE(r.theta, r.maxS);
    if (!r.open) {
      return { ...base, phase: "done", threshold: r.threshold, thresholdKind: r.threshold == null ? null : "estimate", cursor: r.threshold ?? 0, qpLog: r.qpLog, qpReach, qpEstimate: r.qpEstimate ?? undefined, trials: r.qpLog.length, ...(r.qpBound ? { qpBound: r.qpBound } : {}) };
    }
    const next = stepAxis(Q, qpReach, gamma, r.qpLog);
    return { ...base, qpLog: r.qpLog, qpReach, qpDe: next.nextDe, cursor: stepForDeltaE(r.theta, next.nextDe, r.maxS), trials: r.qpLog.length };
  });
}

export function createSession(now = 0, questPlus?: JsQuest, resume?: QpResume | null, lumWeights?: Vec3 | null, lumNoise = false): Session {
  const w = lumWeights ?? undefined;
  const priors = searchPriors();
  const axes = disambiguate([
    ...priors.map((p) => axisFromPrior(p.key, p.theta, p.key, p.hue, p.searchPrior, p.maxS, "descend", DESCEND[DESCEND_START] * p.maxS)),
    endAxis("red-end", [1, 0, 0], "rojo extremo", "last red this display emits", w),
    endAxis("blue-end", [0, 0, 1], "azul extremo", "first blue this display emits", w),
  ]);
  let rngState = (now || 1) >>> 0;
  const startRoll = nextRand(rngState);
  rngState = startRoll.state;
  // Arranque ±1 peldaño por eje (escalera): las mismas respuestas ya no dan los mismos niveles.
  for (const a of axes) {
    const j = nextRand(rngState);
    rngState = j.state;
    const start = DESCEND_START + Math.min(1, Math.floor(j.value * 3) - 1);
    a.descendIndex = start;
    a.descendStart = start;
    a.cursor = DESCEND[start] * a.maxS;
  }
  const catchRoll = nextRand(rngState);
  rngState = catchRoll.state;
  const resumed = questPlus && resume ? resumeAxes(resume, questPlus, gammaOf(resume.catchHits + resume.catchMisses, resume.catchMisses)) : null;
  const openResumed = resumed?.filter((a) => a.phase !== "done") ?? [];
  const start = resumed ? (openResumed[Math.floor(startRoll.value * openResumed.length)] ?? null) : (axes[Math.floor(startRoll.value * axes.length)] ?? null);
  return {
    axes: resumed ?? (questPlus ? axes.map((a) => initQp(a, questPlus, QP_CALIB.gammaDefault)) : axes),
    ...(questPlus ? { questPlus } : {}),
    activeId: start?.id ?? null,
    log: [],
    complete: false,
    note: "Algunos pares son el mismo color. Juzga en reposo, no el salto.",
    side: "left",
    startedAt: now,
    rngState,
    pendingCatch: questPlus ? false : catchRoll.value < 0.34,
    sinceCatch: 0,
    catchSlot: Math.floor(catchRoll.value * 4),
    catchHits: 0,
    catchMisses: 0,
    ...(resumed ? { catchHits: resume!.catchHits, catchMisses: resume!.catchMisses, note: "Sigo donde lo dejaste: solo quedan las vías sin cerrar." } : {}),
    ...(w ? { lumWeights: w } : {}),
    ...(lumNoise ? { lumNoise: makeLumNoise((now || 1) ^ 0x5bd1e995) } : {}),
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

function catchColor(slot: number, w?: Vec3): Vec3 {
  if (slot % 4 === 0) return gray();
  const primary: Vec3 = slot % 4 === 1 ? [1, 0, 0] : slot % 4 === 2 ? [0, 0, 1] : [0, 1, 0];
  const dir = normalize(w ? killLuminance(primary, w) : killLuminance(primary));
  return addScaled(gray(), dir, maxScale(dir) * 0.42);
}

export function stimulusOf(session: Session): Stimulus | null {
  const raw = rawStimulus(session);
  if (!raw || !session.lumNoise) return raw;
  // Ruido de luminancia, después de igualar (con los pesos personales si los hay): cada estímulo su ε.
  const n = session.lumNoise;
  const eps: [number, number] = [lumEps(n, session.log.length, 0), lumEps(n, session.log.length, 1)];
  return { ...raw, reference: toSrgb8(withLum(fromSrgb8(raw.reference), eps[0])), comparison: toSrgb8(withLum(fromSrgb8(raw.comparison), eps[1])), lumEps: eps };
}

function rawStimulus(session: Session): Stimulus | null {
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
    const base = catchColor(session.catchSlot, session.lumWeights);
    const rgb = toSrgb8(base);
    if (session.questPlus && session.catchObvious) {
      const k = QP_CALIB.obviousLum;
      const bright = toSrgb8([Math.min(1, base[0] * k), Math.min(1, base[1] * k), Math.min(1, base[2] * k)]);
      return {
        axisId: "catch",
        hue: "obvio",
        priorKey: "catch",
        phase: axis.phase,
        s: 0,
        sNorm: 0,
        reference: rgb,
        comparison: bright,
        refining: false,
        catch: true,
        obvious: true,
        ...shared,
      };
    }
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
  const dir = isoDir(dirFromTheta(axis.theta), session.lumWeights);
  // Con pesos personales la dirección cambia y su gamut también: el par se recorta a lo que cabe sin saturar un canal
  // (un canal recortado rompería la igualación). Sin pesos, el cursor tal cual.
  const reach = session.lumWeights ? Math.min(axis.cursor, maxScale(dir), maxScale([-dir[0], -dir[1], -dir[2]])) : axis.cursor;
  const positive = toSrgb8(addScaled(gray(), dir, reach));
  const negative = toSrgb8(addScaled(gray(), dir, -reach));
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

/**
 * Con QUEST+, eje no elevado: su IC entero está por debajo de 1,6× el umbral del control (en ΔE00).
 * El control mismo nunca se relaja.
 */
function notElevated(axes: Axis[], axis: Axis, Q: JsQuest, gamma: number): boolean {
  if (axis.priorKey === "control") return false;
  const control = axes.find((a) => a.priorKey === "control" && a.qpLog);
  if (!control?.qpLog || control.qpLog.length < QP_CALIB.relaxedMinTrials) return false;
  const c = control.qpEstimate?.deltaE00 ?? stepAxis(Q, control.qpReach ?? 0, gamma, control.qpLog).estimate.mean;
  const own = stepAxis(Q, axis.qpReach ?? 0, gamma, axis.qpLog ?? []).estimate;
  return own.hi <= c * 1.6;
}

function pickNext(session: Session, axes: Axis[], currentId: string): { session: Session; axis: Axis | null } {
  const open = axes.filter((axis) => axis.phase !== "done" && axis.id !== currentId);
  const pool = open.length ? open : axes.filter((axis) => axis.phase !== "done");
  if (!pool.length) return { session, axis: null };
  const Q = session.questPlus;
  if (Q && pool.every((a) => a.qpLog)) {
    // Con QUEST+: el eje de mayor entropía del posterior (no por turnos). Nunca el mismo dos veces si hay otro.
    const gamma = sessionGamma(session);
    let best = pool[0];
    let bestH = -Infinity;
    for (const a of pool) {
      const h = entropyOf(Q, a.qpReach ?? 0, gamma, a.qpLog ?? []);
      if (h > bestH + 1e-12) {
        bestH = h;
        best = a;
      }
    }
    return { session, axis: best };
  }
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
      ...(stim.lumEps ? { lumEps: stim.lumEps } : {}),
    },
  ];

  axis.trials += 1;
  let note = "";
  const Q = session.questPlus;

  if (Q && axis.qpLog) {
    const gamma = sessionGamma(session);
    axis.qpLog = [...axis.qpLog, [axis.qpDe ?? QP_CALIB.deMin, judgment === "different" ? 0 : 1]];
    const res = stepAxis(Q, axis.qpReach ?? 0, gamma, axis.qpLog, notElevated(axes, axis, Q, gamma));
    if (res.done) {
      finish(axis, qpThreshold(axis, Q, gamma), "estimate");
      note = axis.qpBound
        ? "Ni el par más fuerte de esta pantalla basta en este ángulo: queda como «al menos»."
        : "Límite medido en este ángulo. Las otras vías siguen su propio margen.";
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
      axis.hi = axis.descendIndex <= (axis.descendStart ?? 0) ? axis.maxS : DESCEND[axis.descendIndex - 1] * axis.maxS;
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
    const rel = axis.hi > 0 ? (axis.hi - axis.lo) / axis.hi : 0;
    if ((gap < BISECT_GAP && rel < BISECT_REL_GAP) || axis.bisectSteps >= cap) {
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

  applyCap(session, nextAxes, log.length);

  const next = pickNext({ ...session, sinceCatch: session.sinceCatch + 1 }, nextAxes, axis.id);
  let pendingCatch = false;
  let sinceCatch = next.session.sinceCatch;
  let catchSlot = session.catchSlot;
  let scheduled = next.session;
  let catchObvious = false;
  if (Q) {
    // QUEST+: catch 1 de cada 8–10 ensayos, mitad idénticos y mitad obvios (Colorado, 6.ª ronda).
    if (next.axis && sinceCatch >= QP_CALIB.catchMin) {
      const rolled = draw(scheduled);
      scheduled = rolled.session;
      if (rolled.value < 0.5 || sinceCatch >= QP_CALIB.catchMax) {
        pendingCatch = true;
        sinceCatch = 0;
        catchSlot = Math.floor(rolled.value * 8) % 4;
        const kind = draw(scheduled);
        scheduled = kind.session;
        catchObvious = kind.value < 0.5;
      }
    }
  } else if (next.axis && sinceCatch >= 3) {
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
    ...(Q ? { catchObvious: next.axis ? catchObvious : false } : {}),
  };
}

/** Tope por sesión (80 con QUEST+, 160 en escalera): lo abierto se cierra como estimación; con QUEST+ queda reanudable. */
function applyCap(session: Session, axes: Axis[], trials: number): void {
  const Q = session.questPlus;
  if (trials < (Q ? QP_CALIB.sessionCap : SESSION_CAP)) return;
  for (const a of axes) {
    if (a.phase !== "done") {
      if (Q && a.qpLog) a.qpForced = true;
      finish(a, Q && a.qpLog ? qpThreshold(a, Q, sessionGamma(session)) : (a.lo + a.hi) / 2 || a.cursor, "estimate");
    }
  }
}

function answerCatch(session: Session, stim: Stimulus, judgment: Judgment, now: number): Session {
  if (stim.obvious) return answerObvious(session, stim, judgment, now);
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
      ...(stim.lumEps ? { lumEps: stim.lumEps } : {}),
    },
  ];
  const counted = { ...session, catchHits: session.catchHits + (hit ? 1 : 0), catchMisses: session.catchMisses + (hit ? 0 : 1) };
  const axes = session.questPlus ? session.axes.map((a) => ({ ...a })) : session.axes;
  applyCap(counted, axes, log.length);
  const next = pickNext(session, axes, session.activeId ?? "");
  return {
    ...next.session,
    axes,
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

/** Catch obvio (+20 % de Y): «igual» es un fallo de atención; no entra en γ (que solo usa pares idénticos). */
function answerObvious(session: Session, stim: Stimulus, judgment: Judgment, now: number): Session {
  const log: TrialRecord[] = [
    ...session.log,
    { axisId: "catch", hue: stim.hue, priorKey: "catch", theta: 0, s: 0, sNorm: 0, judgment, reference: stim.reference, comparison: stim.comparison, side: stim.side, at: now, ...(stim.lumEps ? { lumEps: stim.lumEps } : {}) },
  ];
  const axes = session.axes.map((a) => ({ ...a }));
  applyCap(session, axes, log.length);
  const next = pickNext(session, axes, session.activeId ?? "");
  return {
    ...next.session,
    axes,
    log,
    activeId: next.axis?.id ?? null,
    complete: !next.axis,
    note: "",
    side: log.length % 2 === 0 ? "left" : "right",
    pendingCatch: false,
    catchObvious: false,
    sinceCatch: 0,
    obviousShown: (session.obviousShown ?? 0) + 1,
    obviousMissed: (session.obviousMissed ?? 0) + (judgment === "same" ? 1 : 0),
  };
}

export function axisNorm(axis: Axis): number {
  if (axis.threshold == null || axis.maxS <= 0) return 0;
  return axis.threshold / axis.maxS;
}

/**
 * IC de QUEST+ convergido: anchura ln(hi/lo) < ln 2,2 y sin pegarse al techo de la rejilla (10 ΔE00 en perfiles
 * antiguos, QP_CALIB.deMax ahora) ni al alcance del eje. Si no, el eje queda abierto.
 */
export function qpConverged(e: { lo: number; hi: number }, reach?: number): boolean {
  const ceiling = Math.min(QP_CALIB.deMax, reach ?? Infinity);
  if (e.hi >= ceiling - 1e-6 || Math.abs(e.hi - 10) < 1e-6) return false;
  return logWidth(e) < QP_CALIB.relaxedLogWidth;
}

export function isClosed(axis: Axis): boolean {
  if (axis.qpBound) return false;
  // QUEST+ sin converger (cortado por el tope de sesión o IC ancho): abierto, no cerrado (Colorado, 7.ª ronda).
  if (axis.qpForced) return false;
  if (axis.qpLog && axis.qpEstimate && !qpConverged(axis.qpEstimate, axis.qpReach)) return false;
  return axis.phase === "done" && axis.threshold != null && axis.threshold <= ABS_CLOSE * 1.25;
}
