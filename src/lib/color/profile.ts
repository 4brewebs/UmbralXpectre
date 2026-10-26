/**
 * Personal profile: measured thresholds on this display, plus a matrix fit
 * to those thresholds. Textbook cone axes are recorded only as the search
 * prior they were.
 */

import {
  angDist,
  attenuationMatrix,
  dirFromTheta,
  round3,
  roundMatrix,
  type Vec3,
  measuredLumWeights,
  pairLuminanceOf,
  type LumNoise,
  type PairLuminance,
} from "./space";
export { measuredLumWeights } from "./space";
import { readHistory, type HistoryLog } from "./history";
import type { DeviceFingerprint } from "./device";
import { BUILD, type BuildInfo } from "../env";
import { axisNorm, isClosed, qpConverged, qpResumeOf, ABS_CLOSE, type Axis, type QpResume, type Session, type TrialRecord } from "./session";
import { orderLuminance, type LuminanceResult } from "./motion";
import { predictedLumWeights, typeFromProfile, type ObserverType } from "./cones";
import type { WeightsSource } from "./lumweights";

export interface HardwareSnapshot {
  userAgent: string;
  language: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
    pixelRatio: number;
  };
  viewport: { width: number; height: number };
  gamut: "srgb" | "p3" | "rec2020" | "unknown";
  colorScheme: "dark" | "light";
  forcedColors: boolean;
  reducedMotion: boolean;
  maxTouchPoints: number;
  capturedAt: string;
}

export interface UmbralProfile {
  schema: "umbral.profile.v3";
  /** Solo con QUEST+ y ejes cerrados por el tope de 80: posterior por eje para seguir en otra sesión. */
  calibrationResume?: QpResume;
  /** Historial completo de sesiones (`umbral.history.v1`, ver `history.ts`). Opcional: perfiles previos no lo traen. */
  history?: HistoryLog;
  /** Pesos de luminancia con que se igualaron los pares de esta calibración (C1): fuente y valores. */
  pairLuminance?: PairLuminance;
  /** Ruido de luminancia de los pares: amplitud y semilla (los ε de cada ensayo, en los ensayos). */
  lumNoise?: LumNoise;
  disclaimer: string;
  createdAt: string;
  /** Build que generó el perfil: entorno, rama y commit. */
  build?: BuildInfo;
  hardware: HardwareSnapshot;
  method: {
    space: string;
    anchorLinear: number;
    procedure: string;
    priorsRole: string;
  };
  summary: string;
  confidence: "high" | "low";
  closedAxes: string[];
  measuredAxes: string[];
  fit: {
    method: string;
    /** 1 - (control threshold / peak threshold). 0 if the peak is not clearly above the control. Not a percent of vision lost. */
    severity: number;
    /** Peak absolute threshold divided by the control. Lower bound when the control only has an upper bound. */
    timesControl: number | null;
    timesControlKind: "at-least" | "estimate" | null;
    /** El control solo tiene cota superior (llegó al último peldaño): las razones son «al menos». */
    controlBounded?: boolean;
    peakAbs: number | null;
    controlAbs: number | null;
    confusionAngleDeg: number | null;
    shiftFromNearestPriorDeg: number | null;
    nearestSearchPrior: string | null;
    confusionDirectionLinearRgb: Vec3 | null;
    /** How many of the three cones sit clearly above the control. One, two, or three. */
    elevatedCount: number;
    pathways: Array<{
      id: string;
      hue: string;
      threshold: number;
      kind: Axis["thresholdKind"];
      timesControl: number | null;
      /** «al menos» mientras el control esté acotado (cota superior). */
      timesControlKind?: "at-least";
      elevated: boolean;
      /** Set when this cone label is the other end of a line already counted. */
      sameLineAs?: string | null;
    }>;
    attenuationMatrix: number[][];
  };
  axes: Array<{
    id: string;
    hue: string;
    label: string;
    role: Axis["priorKey"];
    searchPrior: string | null;
    parentId: string | null;
    angleDeg: number;
    maxScale: number;
    threshold: number | null;
    thresholdNorm: number | null;
    /** Solo con QUEST+ (`?qp=1`): umbral en ΔE00 (CIEDE2000), IC 95 % y γ (falsas alarmas) usada. */
    quest?: {
      deltaE00: number;
      lo: number;
      hi: number;
      gamma: number;
      trials: number;
      resumable: boolean;
      /** «Al menos» el alcance del gamut (`deltaE00` = alcance): resultado válido, no un fallo. */
      atLeast?: boolean;
      reason?: "gamut-limit";
    };
    thresholdKind: Axis["thresholdKind"];
    closed: boolean;
    trials: number;
    order: number;
  }>;
  trials: Array<TrialRecord & { order: number }>;
  /** Identical pairs, kept out of the color sequence. A miss is "different" on two cards of the same color. */
  catches: {
    same: number;
    missed: number;
    /** Solo QUEST+: pares obvios (+20 % de Y); «igual» en ellos es un fallo de atención. */
    obvious?: { shown: number; missed: number };
    trials: Array<TrialRecord & { order: number }> };
  /**
   * Luminancia. `matches` son las igualaciones de la prueba antigua a 1 Hz (legado: los filtros
   * de fase 1 las siguen leyendo igual). Los campos v3 son los pesos personales.
   */
  luminance?: LuminanceResult & LuminanceV3;
}

/** Igualación de la prueba de movimiento v2 (Anstis-Cavanagh), en el formato que lee lumweights. */
export interface MeasuredMatch {
  id: string;
  hue: string;
  kind: "test" | "control";
  test: Vec3;
  ref: Vec3;
  /** Ganancia sobre `test` (Y estándar igualada) que lo iguala a `ref`. */
  gain: number;
  /** Brillo relativo = 1 / gain. */
  efficiency: number;
  width: number;
  reversals: number;
  trials: number;
  bound: "converged" | "cap" | "edge" | "at-least";
  /** Llegó al tope de contraste (22 % Michelson): el valor es una cota, no una igualación. */
  atLeast: boolean;
  /** 1: hace falta al menos este brillo relativo (o más); −1: como mucho este. */
  atLeastSide?: 1 | -1;
}

export interface LuminanceV3 {
  /** Pesos {wR, wG, wB} de este observador en esta pantalla, suma 1. */
  weights: Vec3;
  weightsSource: WeightsSource;
  /** Predicción del modelo de conos (severity de Machado PREDICTION_SEVERITY), o null si el tipo es normal/desconocido. */
  predicted: Vec3 | null;
  type: ObserverType;
  refreshHz: number | null;
  temporalHzV2?: number | null;
  cyclesPerDeg: number | null;
  viewingCm?: number | null;
  /** Montaje detectado: móvil (40 cm) o PC (60 cm). */
  deviceType?: "phone" | "pc" | null;
  /** px CSS por mm supuestos para el periodo de la red. */
  cssPxPerMm?: number | null;
  /** Tamaño de la red en grados y heurística de tamaño usada (para reprocesar). */
  stimulusDeg?: { width: number; height: number } | null;
  sizingHeuristic?: string | null;
  /** Método de búsqueda de la prueba v2: escalera (por defecto) o QUEST+ (`?qp=1`). */
  searchMethod?: "staircase" | "quest+";
  /** Interfaz de la última prueba de brillo (legacy|v2|v3). */
  ui?: "legacy" | "v2" | "v3";
  build?: BuildInfo;
  fixationWeber?: number;
  /** Dispositivo en que se midieron estos pesos (no valen en otra pantalla). */
  device?: DeviceFingerprint;
  checks: {
    controlError: number | null;
    catches: { shown: number; missed: number };
    residuals: number[];
    cond: number | null;
    withinNoise: boolean;
    confidence: "high" | "low";
    /** Bloques de la prueba; `unreliable` si «quieto» > 60 % (catch incluidos). */
    blocks?: Array<{ trials: number; still: number; unreliable: boolean }>;
    unreliableBlocks?: number;
  } | null;
  /** Contra qué se igualó: siempre Y estándar de sRGB nominal en esta fase. */
  calibratedWith: "standard-Y" ;
  /** Igualaciones de la prueba v2. Las `matches` antiguas quedan como legado. */
  measuredMatches: MeasuredMatch[];
  /** true si `matches` vienen de la prueba a 1 Hz (rojo contra rojo) y no se usaron para los pesos. */
  legacyMatches: boolean;
}

/** Severity de Machado de la que parte la predicción (no es `fit.severity`). */
export const PREDICTION_SEVERITY = 0.6;

/** Campos v3 por defecto: pesos = predicción del tipo, o Y estándar. Nunca derivados de igualaciones antiguas. */
export function defaultLuminanceV3(profile: Pick<UmbralProfile, "fit">, legacyMatches = false): LuminanceV3 {
  const type = typeFromProfile(profile);
  const predicted = type === "protan" || type === "deutan" || type === "tritan" ? predictedLumWeights(type, PREDICTION_SEVERITY) : null;
  const std = predictedLumWeights("normal");
  const round = (v: Vec3) => v.map((x) => Math.round(x * 1e5) / 1e5) as Vec3;
  return {
    weights: round(predicted ?? std),
    weightsSource: predicted ? "predicted" : "standard",
    predicted: predicted ? round(predicted) : null,
    type,
    refreshHz: null,
    cyclesPerDeg: null,
    checks: null,
    calibratedWith: "standard-Y",
    measuredMatches: [],
    legacyMatches,
  };
}

function emptyLuminance(profile: Pick<UmbralProfile, "fit">): LuminanceResult & LuminanceV3 {
  return { ...orderLuminance({ method: "", matches: [], log: [] }), ...defaultLuminanceV3(profile) };
}

function keepV3(raw: Partial<LuminanceV3> | undefined, fallback: LuminanceV3): LuminanceV3 {
  if (!raw || !Array.isArray(raw.weights) || raw.weights.length !== 3) return fallback;
  return {
    ...fallback,
    ...raw,
    weights: [Number(raw.weights[0]), Number(raw.weights[1]), Number(raw.weights[2])],
    measuredMatches: Array.isArray(raw.measuredMatches) ? raw.measuredMatches : [],
    legacyMatches: Boolean(raw.legacyMatches),
    calibratedWith: "standard-Y",
  };
}

function deg(rad: number): number {
  return Math.round((rad * 180) / Math.PI * 10) / 10;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function readHardware(now = new Date()): HardwareSnapshot {
  const gamut = window.matchMedia("(color-gamut: rec2020)").matches
    ? "rec2020"
    : window.matchMedia("(color-gamut: p3)").matches
      ? "p3"
      : window.matchMedia("(color-gamut: srgb)").matches
        ? "srgb"
        : "unknown";
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      colorDepth: window.screen.colorDepth,
      pixelRatio: window.devicePixelRatio,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gamut,
    colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    capturedAt: now.toISOString(),
  };
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function buildProfile(session: Session, hardware: HardwareSnapshot, now = new Date()): UmbralProfile {
  const done = session.axes.filter((a) => a.phase === "done" && a.threshold != null);
  const labels = axisLabels(done);
  const scored = scoreCones(
    done.map((axis) => ({
      id: axis.id,
      hue: labels.get(axis.id) ?? axis.hue,
      role: axis.priorKey,
      parentId: axis.parentId ?? null,
      angleRad: axis.theta,
      threshold: axis.threshold,
      thresholdKind: axis.thresholdKind,
      maxScale: axis.maxS,
      searchPrior: axis.searchPrior,
    })),
  );

  const closedAxes = done.filter(isClosed).map((a) => labels.get(a.id) ?? a.hue);
  const measuredAxes = done.filter((a) => !isClosed(a)).map((a) => labels.get(a.id) ?? a.hue);

  const built: UmbralProfile = {
    schema: "umbral.profile.v3",
    disclaimer:
      "Perfil relativo a los colores que esta pantalla recibió en esta sesión. No es un diagnóstico clínico ni una plantilla de protanomalía, deuteranomalía o tritanomalía.",
    createdAt: now.toISOString(),
    build: BUILD,
    hardware,
    method: {
      space: "linear sRGB, constant CIE Y, anchor 0.22",
      anchorLinear: 0.22,
      procedure:
        "All three pathways are measured, interleaved, and shuffled. Each pair is the same step on both sides of gray. Some pairs are the same color on both cards. A pathway that stays visible at the small step is confirmed once later and then sampled less — it is not dropped. One, two, three, or none may come back high. Pure red and pure blue are references and do not change that reading.",
      priorsRole: "Cone-isolation directions only choose where to look first. They are not the output.",
    },
    summary: summarize({
      confidence: scored.confidence,
      controlAbs: scored.controlAbs,
      controlKind: scored.controlKind,
      controlUnusable: scored.controlUnusable,
      yardstick: scored.yardstick,
      pathways: scored.pathways,
      ends: done
        .filter((axis) => axis.priorKey === "red-end" || axis.priorKey === "blue-end")
        .map((axis) => ({
          hue: labels.get(axis.id) ?? axis.hue,
          threshold: axis.threshold ?? 0,
          kind: axis.thresholdKind,
          closed: isClosed(axis),
        })),
      also: done
        .filter((axis) => axis.priorKey === "refine" || axis.priorKey === "red-end" || axis.priorKey === "blue-end")
        .filter((axis) => {
          if (axis.threshold == null || axis.thresholdKind == null) return false;
          if (axis.thresholdKind === "estimate") return axis.threshold >= scored.yardstick * 1.6;
          return axis.threshold > Math.max(scored.yardstick, ABS_CLOSE) * 1.25;
        })
        .map((axis) => ({
          hue: labels.get(axis.id) ?? axis.hue,
          threshold: axis.threshold ?? 0,
          kind: axis.thresholdKind,
        })),
      missedCatches: session.catchMisses,
    }),
    confidence: scored.confidence,
    closedAxes,
    measuredAxes,
    fit: {
      method:
        "Peak absolute distance in linear sRGB (unit direction × scale), compared with the control. Gamut fraction is not the rank: a short-gamut axis must not look worse just because it clips sooner.",
      severity: scored.severity,
      timesControl: scored.timesControl,
      timesControlKind: scored.timesControlKind,
      controlBounded: scored.controlKind === "upper-bound",
      peakAbs: scored.peakAbs,
      controlAbs: scored.controlAbs == null ? null : Math.round(scored.controlAbs * 10000) / 10000,
      confusionAngleDeg: scored.confusionAngleDeg,
      shiftFromNearestPriorDeg: scored.shift,
      nearestSearchPrior: scored.nearestPrior,
      confusionDirectionLinearRgb: scored.confusionDir ? round3(scored.confusionDir) : null,
      elevatedCount: scored.elevatedCount,
      pathways: scored.pathways,
      attenuationMatrix: scored.matrix,
    },
    axes: orderAxes(session.axes).map((a, index) => ({
      id: a.id,
      hue: a.hue,
      label: axisLabels(session.axes).get(a.id) ?? a.hue,
      role: a.priorKey,
      searchPrior: a.searchPrior,
      parentId: a.parentId ?? null,
      angleDeg: deg(a.theta),
      maxScale: Math.round(a.maxS * 10000) / 10000,
      threshold: a.threshold == null ? null : Math.round(a.threshold * 10000) / 10000,
      thresholdNorm: a.threshold == null ? null : Math.round(axisNorm(a) * 1000) / 1000,
      thresholdKind: a.thresholdKind,
      closed: isClosed(a),
      trials: a.trials,
      order: index + 1,
      ...(a.qpEstimate ? { quest: { deltaE00: r4(a.qpEstimate.deltaE00), lo: r4(a.qpEstimate.lo), hi: r4(a.qpEstimate.hi), gamma: r4(a.qpEstimate.gamma), trials: a.qpLog?.length ?? 0, resumable: !!a.qpForced, ...(a.qpBound ? { deltaE00: r4(a.qpReach ?? a.qpEstimate.deltaE00), atLeast: true, reason: a.qpBound } : {}) } } : {}),
    })),
    trials: orderColorTrials(session.log, session.axes),
    catches: {
      same: session.catchHits,
      missed: session.catchMisses,
      ...(session.obviousShown ? { obvious: { shown: session.obviousShown, missed: session.obviousMissed ?? 0 } } : {}),
      trials: orderCatchTrials(session.log),
    },
  };
  const resume = qpResumeOf(session, now.getTime());
  return { ...built, pairLuminance: pairLuminanceOf(session.lumWeights), ...(session.lumNoise ? { lumNoise: session.lumNoise } : {}), luminance: emptyLuminance(built), ...(resume ? { calibrationResume: resume } : {}) };
}

const ROLE_RANK: Record<string, number> = {
  s: 0,
  control: 1,
  l: 2,
  m: 3,
  "red-end": 4,
  "blue-end": 5,
};

/** Stable place in the JSON. The cards on screen stay shuffled. */
export function axisRank(axis: { id: string; priorKey?: string; role?: string; parentId?: string | null }): number {
  const role = axis.role ?? axis.priorKey ?? "";
  if (role !== "refine") return (ROLE_RANK[role] ?? 40) * 100;
  const parent = ROLE_RANK[axis.parentId ?? ""] ?? 40;
  return 10000 + parent * 10 + (axis.id.endsWith(":+") ? 1 : 0);
}

function orderAxes<T extends { id: string; priorKey?: string; role?: string; parentId?: string | null }>(axes: T[]): T[] {
  return axes.slice().sort((a, b) => axisRank(a) - axisRank(b) || a.id.localeCompare(b.id));
}

function orderColorTrials(log: TrialRecord[], axes: Axis[]): Array<TrialRecord & { order: number }> {
  const rank = new Map(orderAxes(axes).map((axis, index) => [axis.id, index]));
  return log
    .filter((trial) => trial.axisId !== "catch")
    .slice()
    .sort((a, b) => (rank.get(a.axisId) ?? 999) - (rank.get(b.axisId) ?? 999) || a.at - b.at)
    .map((trial, index) => ({ ...trial, order: index + 1 }));
}

function orderCatchTrials(log: TrialRecord[]): Array<TrialRecord & { order: number }> {
  return log
    .filter((trial) => trial.axisId === "catch")
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((trial, index) => ({ ...trial, order: index + 1 }));
}

const LINE_NOTE = 1.6;

/** Pure red and pure blue, and the probes spawned from them, stay out of the three-cone reading. */
function isReferenceAxis(axis: { role: string; parentId?: string | null }): boolean {
  return axis.role === "red-end" || axis.role === "blue-end" || axis.parentId === "red-end" || axis.parentId === "blue-end";
}

type ConeAxis = {
  id: string;
  hue: string;
  role: string;
  parentId?: string | null;
  angleRad: number;
  threshold: number | null;
  thresholdKind: Axis["thresholdKind"];
  maxScale: number;
  searchPrior: string | null;
};

type ConeScore = {
  confidence: "high" | "low";
  controlUnusable: boolean;
  controlAbs: number | null;
  controlKind: Axis["thresholdKind"] | null;
  yardstick: number;
  severity: number;
  timesControl: number | null;
  timesControlKind: "at-least" | "estimate" | null;
  peakAbs: number | null;
  shift: number | null;
  nearestPrior: string | null;
  confusionAngleDeg: number | null;
  confusionDir: Vec3 | null;
  pathways: UmbralProfile["fit"]["pathways"];
  elevatedCount: number;
  matrix: number[][];
};

/**
 * Published detector: each of S, L and M is elevated on its own when the estimate
 * is at least 1.6× the control. A second cone is not folded away for sharing a line.
 * Reference axes do not compete for the peak.
 */
function scoreCones(axes: ConeAxis[]): ConeScore {
  const control = axes.find((axis) => axis.role === "control");
  const controlUnusable =
    !!control &&
    control.thresholdKind === "estimate" &&
    control.maxScale > 0 &&
    (control.threshold ?? 0) / control.maxScale > 0.2;
  const controlAbs = control?.threshold ?? null;
  const controlKind = control?.thresholdKind ?? null;
  const yardstick = controlUnusable || !(controlAbs && controlAbs > 0) ? ABS_CLOSE : controlAbs;
  const worst = axes
    .filter((axis) => axis.thresholdKind === "estimate" && axis.threshold != null && !isReferenceAxis(axis))
    .slice()
    .sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0))[0];

  let severity = 0;
  let timesControl: number | null = null;
  let timesControlKind: "at-least" | "estimate" | null = null;

  if (!controlUnusable && worst && controlAbs && controlAbs > 0) {
    const peakAbs = worst.threshold ?? 0;
    timesControl = peakAbs / controlAbs;
    timesControlKind = controlKind === "upper-bound" ? "at-least" : "estimate";
    if (timesControl >= LINE_NOTE) severity = clamp01(1 - controlAbs / peakAbs);
  }

  const pathways = (["s", "l", "m"] as const).flatMap((id) => {
    const axis = axes.find((item) => item.id === id);
    if (!axis || axis.threshold == null) return [];
    const times = controlAbs && controlAbs > 0 ? axis.threshold / controlAbs : null;
    const elevated = axis.thresholdKind === "estimate" && times != null && times >= LINE_NOTE;
    return [
      {
        id,
        hue: axis.hue,
        threshold: Math.round(axis.threshold * 10000) / 10000,
        kind: axis.thresholdKind,
        timesControl: times == null ? null : Math.round(times * 10) / 10,
        ...(times != null && controlKind === "upper-bound" ? { timesControlKind: "at-least" as const } : {}),
        elevated,
        sameLineAs: null,
      },
    ];
  });
  const elevated = pathways.filter((pathway) => pathway.elevated);
  const lone = elevated.length === 1 ? elevated[0] : undefined;
  const familyPeak = lone
    ? axes
        .filter(
          (axis) =>
            axis.thresholdKind === "estimate" &&
            axis.threshold != null &&
            (axis.id === lone.id || axis.parentId === lone.id),
        )
        .slice()
        .sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0))[0]
    : undefined;
  const aim = familyPeak ?? (lone ? axes.find((axis) => axis.id === lone.id) : undefined);
  let aimShift: number | null = null;
  let aimPrior: string | null = null;
  if (aim && severity > 0) {
    const priors = axes.filter((axis) => axis.role === "l" || axis.role === "m" || axis.role === "s");
    if (priors.length) {
      const nearest = priors.reduce((a, b) =>
        angDist(a.angleRad, aim.angleRad) <= angDist(b.angleRad, aim.angleRad) ? a : b,
      );
      aimShift = (angDist(aim.angleRad, nearest.angleRad) * 180) / Math.PI;
      aimPrior = nearest.searchPrior;
    }
  }
  const named = elevated.length === 1 && aim != null && severity > 0;
  const aimDir = named && aim ? dirFromTheta(aim.angleRad) : null;
  return {
    confidence: controlUnusable ? "low" : "high",
    controlUnusable,
    controlAbs,
    controlKind,
    yardstick,
    severity: Math.round(severity * 1000) / 1000,
    timesControl: timesControl == null ? null : Math.round(timesControl * 10) / 10,
    timesControlKind,
    peakAbs: worst && timesControl != null && timesControl >= LINE_NOTE ? Math.round((worst.threshold ?? 0) * 10000) / 10000 : null,
    shift: named && aimShift != null ? Math.round(aimShift * 10) / 10 : null,
    nearestPrior: named ? aimPrior : null,
    confusionAngleDeg: named && aim ? deg(aim.angleRad) : null,
    confusionDir: aimDir,
    pathways,
    elevatedCount: elevated.length,
    matrix: aimDir ? roundMatrix(attenuationMatrix(aimDir, severity)) : roundMatrix(attenuationMatrix([1, 0, 0], 0)),
  };
}

function axisLabels(axes: Axis[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const axis of axes) {
    base.set(axis.id, axis.priorKey === "refine" ? `${axis.hue} · al lado` : axis.hue);
  }
  const counts = new Map<string, number>();
  for (const label of base.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const axis of axes) {
    const label = base.get(axis.id) ?? axis.hue;
    out.set(axis.id, (counts.get(label) ?? 0) > 1 ? `${label} ${deg(axis.theta)}°` : label);
  }
  return out;
}

function summarize(input: {
  confidence: "high" | "low";
  controlAbs: number | null;
  controlKind: Axis["thresholdKind"] | null;
  controlUnusable: boolean;
  yardstick: number;
  pathways: UmbralProfile["fit"]["pathways"];
  ends: Array<{ hue: string; threshold: number; kind: Axis["thresholdKind"]; closed: boolean }>;
  also: Array<{ hue: string; threshold: number; kind: Axis["thresholdKind"] }>;
  missedCatches: number;
}): string {
  const lines = input.pathways.map((p) => {
    const value = p.kind === "upper-bound" ? `${p.threshold.toFixed(3)} o menos` : p.threshold.toFixed(3);
    return `${p.hue} ${value}`;
  });
  const control = input.controlUnusable
    ? ` El control también quedó alto${input.controlAbs == null ? "" : ` (${input.controlAbs.toFixed(3)})`}, así que comparo con el paso común de ${input.yardstick.toFixed(3)}, no con ese control.`
    : input.controlAbs == null
      ? ""
      : ` Control ${input.controlAbs.toFixed(3)}${input.controlKind === "upper-bound" ? " o menos" : ""}.`;
  const high = input.pathways.filter((p) => p.elevated);
  const reference = input.controlUnusable ? "del paso común" : "del control";
  const tail =
    input.confidence === "low"
      ? ""
      : high.length === 0
        ? ` Ninguna de las tres queda claramente por encima ${reference}.`
        : high.length === 1
          ? ` Solo «${high[0].hue}» queda por encima ${reference}.`
          : ` Quedan por encima ${high.map((p) => `«${p.hue}»`).join(" y ")}. No elijo un ángulo: pueden ir altas una, dos o las tres.`;
  const also =
    input.also.length === 0
      ? ""
      : ` También mido ${input.also
          .map((item) =>
            item.kind === "upper-bound"
              ? `«${item.hue}», techo ${item.threshold.toFixed(3)} sin un igual`
              : `«${item.hue}» ${item.threshold.toFixed(3)}`,
          )
          .join("; ")}.`;
  const openEnds = input.ends.filter((end) => !end.closed && !input.also.some((item) => item.hue === end.hue));
  const ends =
    openEnds.length === 0
      ? ""
      : ` En el extremo de la pantalla, ${openEnds.map((end) => `«${end.hue}» ${end.threshold.toFixed(3)}`).join(" y ")}.`;
  const catches = input.missedCatches > 0 ? ` En los pares iguales marcó distinto ${input.missedCatches} veces.` : "";
  const lead =
    input.confidence === "low"
      ? "El contraste de control también quedó alto. El perfil se guarda, pero conviene repetir con el brillo al máximo y sin filtro de color. No lo leo como un tipo de daltonismo."
      : `Las tres vías quedan medidas. ${lines.join(". ")}.${control}`;
  return `${lead}${tail}${also}${ends}${catches}`;
}

export const PROFILE_STORAGE_KEY = "umbral-profile-v3";
/** Claves antiguas, de la más reciente a la más vieja. Se leen si no hay v3. */
export const RETIRED_PROFILE_KEYS = ["umbral-profile-v2", "umbral-profile-v1"] as const;
export const RETIRED_PROFILE_KEY = RETIRED_PROFILE_KEYS[0];

export function profileRejectReason(raw: string): string {
  try {
    JSON.parse(raw);
  } catch {
    return "Ese archivo no es un perfil de esta app.";
  }
  return "Ese archivo no tiene ejes medidos.";
}

function syncImportedReading(profile: UmbralProfile): { summary: string; confidence: "high" | "low"; fit: UmbralProfile["fit"] } {
  const scored = scoreCones(
    profile.axes.map((axis) => ({
      id: axis.id,
      hue: axis.label || axis.hue,
      role: axis.role,
      parentId: axis.parentId,
      angleRad: (axis.angleDeg * Math.PI) / 180,
      threshold: axis.threshold,
      thresholdKind: axis.thresholdKind,
      maxScale: axis.maxScale,
      searchPrior: axis.searchPrior,
    })),
  );
  const summary = summarize({
    confidence: scored.confidence,
    controlAbs: scored.controlAbs,
    controlKind: scored.controlKind,
    controlUnusable: scored.controlUnusable,
    yardstick: scored.yardstick,
    pathways: scored.pathways,
    ends: profile.axes
      .filter((axis) => axis.role === "red-end" || axis.role === "blue-end")
      .map((axis) => ({
        hue: axis.label || axis.hue,
        threshold: axis.threshold ?? 0,
        kind: axis.thresholdKind,
        closed: axis.closed,
      })),
    also: profile.axes
      .filter((axis) => axis.role === "refine" || axis.role === "red-end" || axis.role === "blue-end")
      .filter((axis) => {
        if (axis.threshold == null || axis.thresholdKind == null) return false;
        if (axis.thresholdKind === "estimate") return axis.threshold >= scored.yardstick * 1.6;
        return axis.threshold > Math.max(scored.yardstick, ABS_CLOSE) * 1.25;
      })
      .map((axis) => ({
        hue: axis.label || axis.hue,
        threshold: axis.threshold ?? 0,
        kind: axis.thresholdKind,
      })),
    missedCatches: profile.catches?.missed ?? 0,
  });
  return {
    summary,
    confidence: scored.confidence,
    fit: {
      ...profile.fit,
      severity: scored.severity,
      timesControl: scored.timesControl,
      timesControlKind: scored.timesControlKind,
      controlBounded: scored.controlKind === "upper-bound",
      peakAbs: scored.peakAbs,
      controlAbs: scored.controlAbs == null ? null : Math.round(scored.controlAbs * 10000) / 10000,
      elevatedCount: scored.elevatedCount,
      pathways: scored.pathways,
      confusionAngleDeg: scored.confusionAngleDeg,
      shiftFromNearestPriorDeg: scored.shift,
      nearestSearchPrior: scored.nearestPrior,
      confusionDirectionLinearRgb: scored.confusionDir ? round3(scored.confusionDir) : null,
      attenuationMatrix: scored.matrix,
    },
  };
}

export function parseProfile(raw: string): UmbralProfile | null {
  try {
    const parsed = JSON.parse(raw) as UmbralProfile;
    const schema = (parsed as { schema?: string })?.schema;
    if (schema !== "umbral.profile.v3" && schema !== "umbral.profile.v2" && schema !== "umbral.profile.v1") return null;
    if (!parsed.fit || !Array.isArray(parsed.axes) || parsed.axes.length === 0) return null;
    // Un eje QUEST+ reanudable no convergió: se muestra abierto aunque un perfil antiguo lo guardara cerrado.
    const unconverged = (axis: UmbralProfile["axes"][number]) => !!axis.quest && (axis.quest.atLeast === true || !qpConverged(axis.quest));
    const reopened = new Set(parsed.axes.filter((axis) => axis.closed && unconverged(axis)).map((axis) => axis.label ?? axis.hue));
    const axes = orderAxes(parsed.axes).map((axis, index) => ({ ...axis, ...(unconverged(axis) ? { closed: false } : {}), order: index + 1 }));
    if (reopened.size && Array.isArray(parsed.closedAxes)) {
      parsed.closedAxes = parsed.closedAxes.filter((name) => !reopened.has(name));
      parsed.measuredAxes = [...(parsed.measuredAxes ?? []), ...[...reopened].filter((name) => !(parsed.measuredAxes ?? []).includes(name))];
    }
    const rank = new Map(axes.map((axis) => [axis.id, axis.order]));
    const sourceTrials = Array.isArray(parsed.trials) ? parsed.trials : [];
    const trials = sourceTrials
      .filter((trial) => trial.axisId !== "catch")
      .slice()
      .sort((a, b) => (rank.get(a.axisId) ?? 999) - (rank.get(b.axisId) ?? 999) || a.at - b.at)
      .map((trial, index) => ({ ...trial, order: index + 1 }));
    const catchSource = parsed.catches?.trials?.length
      ? parsed.catches.trials
      : sourceTrials.filter((trial) => trial.axisId === "catch");
    const catchTrials = catchSource
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((trial, index) => ({ ...trial, order: index + 1 }));
    const folded = syncImportedReading({ ...parsed, axes });
    const history = readHistory(parsed.history);
    const { history: _dropHistory, ...rest } = parsed;
    void _dropHistory;
    return {
      ...rest,
      ...(history ? { history } : {}),
      schema: "umbral.profile.v3",
      summary: folded.summary,
      confidence: folded.confidence,
      fit: folded.fit,
      axes,
      trials,
      catches: {
        same: parsed.catches?.same ?? catchTrials.filter((trial) => trial.judgment === "same").length,
        missed: parsed.catches?.missed ?? catchTrials.filter((trial) => trial.judgment === "different").length,
        trials: catchTrials,
      },
      luminance: parsed.luminance
        ? {
            ...orderLuminance({
              method: parsed.luminance.method,
              temporalHz: parsed.luminance.temporalHz,
              matches: parsed.luminance.matches ?? [],
              log:
                "log" in parsed.luminance && Array.isArray(parsed.luminance.log)
                  ? parsed.luminance.log
                  : (parsed.luminance.matches ?? []).flatMap((match) => match.samples ?? []),
            }),
            ...(schema === "umbral.profile.v3"
              ? keepV3(parsed.luminance, defaultLuminanceV3({ fit: folded.fit }))
              : defaultLuminanceV3({ fit: folded.fit }, (parsed.luminance.matches ?? []).length > 0)),
          }
        : emptyLuminance({ fit: folded.fit }),
    };
  } catch {
    return null;
  }
}
