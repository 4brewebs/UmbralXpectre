/**
 * Prueba de movimiento v2 (fase 1 del plan de luminancia): red de 4 fotogramas de
 * Anstis-Cavanagh para igualar en brillo colores saturados contra un gris neutro.
 *
 * Fotogramas (fase espacial φ = 2πx/P, P = periodo):
 *   F1 color  test↔ref, test en φ = π/2   F2 luminancia, claro en φ = π
 *   F3 color invertido, test en 3π/2      F4 luminancia invertida, claro en 0
 * Si el test se ve más claro que la referencia, la red avanza a la derecha (sign = 1);
 * si se ve más oscuro, a la izquierda. En la igualdad el movimiento es ambiguo.
 *
 * Variable de la escalera: e = brillo relativo del test (Y estándar del test = Y_ref / e).
 * La ganancia de la igualación es g = 1/e (la que lee lumweights).
 *
 * Detrás de un flag (?motion=v2 o localStorage). La prueba antigua a 1 Hz (motion.ts) no cambia.
 */
import type { DeviceFingerprint } from "./device";
import { appendHistory, makeSession } from "./history";
import { BUILD, IS_QA } from "../env";
import { luminance, type Vec3 } from "./space";
import { predictedMatch, predictedLumWeights, type ObserverType } from "./cones";
import { solveLumWeights } from "./lumweights";
import { defaultLuminanceV3, type MeasuredMatch, type UmbralProfile } from "./profile";
import { createQuestPlus, motion3, grid, type JsQuest, type QuestPlus } from "./questplus";

export const MOTION_V2_FLAG = "umbral-motion";
/** Contraste de Michelson de la red de luminancia (≤ 10 %). */
export const LUMA_CONTRAST = 0.08;
/** Fracción máxima de la pantalla ocupada por la red. */
export const MAX_AREA = 0.25;
/** Objetivo de Colorado (25/10): 1 ciclo/grado (el mínimo de movimiento es robusto en 0.5–2). */
export const CYCLES_PER_DEG = 1;
/** Distancia de visión en móvil (cm). */
export const VIEWING_CM = 40;
/** Distancia de visión en pantallas de más de 10 pulgadas (cm). */
export const VIEWING_CM_LARGE = 60;
/**
 * Tope del contraste de Michelson en Y estándar, en cualquier fotograma: |Yt−Yr|/(Yt+Yr) ≤ 22 %.
 * Equivale a e ∈ [(1−c)/(1+c), (1+c)/(1−c)] ≈ [0.639, 1.564].
 */
export const MAX_MICHELSON = 0.22;
export const E_MIN = (1 - MAX_MICHELSON) / (1 + MAX_MICHELSON);
export const E_MAX = (1 + MAX_MICHELSON) / (1 - MAX_MICHELSON);
/** Fracción del camino gris → borde del gamut que usan los colores de prueba (no el borde). */
export const SATURATION = 0.65;
/** Catch trials mínimos por bloque. */
export const MIN_CATCHES_PER_BLOCK = 5;
const MAX_REF_Y = 0.18;
const FINE_STEP = Math.log(1.015);
const START_STEP = Math.log(1.1);
const STOP_REVERSALS = 8;
const STOP_CI = Math.log(1.025);
export const TRIALS_PER_TARGET = 30;
export const CATCH_EVERY = 4;
export const BLOCK_MS = 25_000;

/** QUEST+ en movimiento v2, tras flag (`?motion=v2&qp=1`). Apagado por defecto: escalera actual. */
/** `?qp=1` lo enciende y `?qp=0` lo apaga; sin flag, `fallback` (encendido en QA). */
export function questPlusEnabled(search: string, fallback = IS_QA): boolean {
  const q = new URLSearchParams(search).get("qp");
  if (q === "1") return true;
  if (q === "0") return false;
  return fallback;
}

/**
 * Parámetros de QUEST+ para movimiento v2 (PLAN-questplus §3.3 y §8).
 * x = log(e) del estímulo; se estima μ = log(e_nulo) con el modelo de 3 respuestas (§8.4)
 * y se marginalizan pendiente β, semiancho δ de «quieto» y lapse λ (Watson 2017).
 * Los valores nominales de β y δ NO los fija el plan: son provisionales (pregunta abierta).
 */
export const QP_MOTION = {
  /** Rejilla del estímulo: log e entre los topes de seguridad, paso ln 1.015. */
  stepLn: Math.log(1.015),
  /** μ cubre 0.2 en log más allá de los topes para detectar cotas «al menos». */
  muPad: 0.2,
  muPoints: 61,
  /** Pendiente nominal 20 /ln; {0.5, 1, 2}× nominal (Colorado). */
  betas: [10, 20, 40],
  nominalBeta: 20,
  /** β fijo al nominal: sesgo medido < 3 % en simulación (−0,08 %), ~25 % menos ensayos (Colorado). */
  fixedSlope: true,
  /** Semiancho de «quieto» δ en ln de la ganancia (Colorado). */
  deltas: [0.02, 0.04, 0.08],
  lapses: [0.02, 0.035, 0.05],
  /** Parada (Colorado): IC 95 % de ln e con anchura total < ln 1.10, o 30 ensayos. */
  stopWidth: Math.log(1.1),
  maxTrials: 30,
  /** Prior log-normal en ln de la ganancia, centrado en la predicción del perfil, σ = 0.25 (Colorado). */
  priorSd: 0.25,
} as const;

/** Prior en μ = ln e_nulo: normal en ln con centro en la predicción del objetivo y σ = QP_MOTION.priorSd. */
export function muPrior(predicted: number, mus: number[]): number[] {
  const c = Math.log(predicted);
  return mus.map((m) => Math.exp(-0.5 * ((m - c) / QP_MOTION.priorSd) ** 2) + 1e-6);
}

function makeQuest(Q: JsQuest, target: MotionV2Target, fixedSlope = false): QuestPlus {
  const lo = Math.log(E_MIN);
  const hi = Math.log(E_MAX);
  const n = Math.floor((hi - lo) / QP_MOTION.stepLn) + 1;
  const stim = grid(lo, lo + (n - 1) * QP_MOTION.stepLn, n);
  const mus = grid(lo - QP_MOTION.muPad, hi + QP_MOTION.muPad, QP_MOTION.muPoints);
  return createQuestPlus(Q, {
    stim,
    params: [mus, fixedSlope ? [QP_MOTION.nominalBeta] : [...QP_MOTION.betas], [...QP_MOTION.deltas], [...QP_MOTION.lapses]],
    prior: [muPrior(target.predicted, mus)],
    responses: motion3(),
  });
}

/** Comprobador de seguridad de CADA estímulo (§3.3): e dentro de los topes ⇒ Michelson ≤ 22 %. */
export function safeE(e: number): number {
  return Math.min(E_MAX, Math.max(E_MIN, e));
}

export function michelsonOf(stim: { test: Vec3; ref: Vec3 }): number {
  const a = luminance(stim.test);
  const b = luminance(stim.ref);
  return Math.abs(a - b) / (a + b);
}

/** Versión de la interfaz de la prueba de brillo. v2 y v3 comparten el mismo motor (este archivo). */
export type MotionUi = "legacy" | "v2" | "v3";

/** `?motion=v1|v2|v3` manda; si no, `localStorage[umbral-motion]`; por defecto, legacy. */
export function motionUiOf(search: string, stored: string | null, fallback: MotionUi = IS_QA ? "v3" : "legacy"): MotionUi {
  const q = new URLSearchParams(search).get("motion");
  if (q === "v2" || q === "v3") return q;
  if (q === "v1") return "legacy";
  if (stored === "v2" || stored === "v3") return stored;
  if (stored === "v1") return "legacy";
  return fallback;
}

export function motionV2Enabled(search: string, stored: string | null): boolean {
  return motionUiOf(search, stored) !== "legacy";
}

/** Frecuencia de la red: refresco / (4·k). Prefiere la más alta entre 7.2 y 12 Hz. */
export function pickTemporal(refreshHz: number): { framesPerPhase: number; hz: number } {
  const r = refreshHz > 20 && refreshHz < 500 ? refreshHz : 60;
  let best: { framesPerPhase: number; hz: number } | null = null;
  for (let k = 1; k <= 16; k++) {
    const hz = r / (4 * k);
    if (hz >= 7.2 && hz <= 12 && (!best || hz > best.hz)) best = { framesPerPhase: k, hz };
  }
  if (best) return { framesPerPhase: best.framesPerPhase, hz: round(best.hz, 100) };
  const k = Math.max(1, Math.round(r / 30));
  return { framesPerPhase: k, hz: round(r / (4 * k), 100) };
}

export type DeviceType = "phone" | "pc";

/**
 * Montaje de la prueba: móvil o PC, distancia y densidad supuesta de px CSS.
 *
 * Detección: móvil si `matchMedia('(pointer: coarse)')` y el lado corto de la pantalla
 * es < 600 px CSS; si no, PC (tablets incluidas, se usan apoyadas como un portátil).
 * Distancia: móvil 40 cm («un antebrazo»), PC 60 cm («un brazo extendido»).
 *
 * SUPUESTO px/mm (heurística de Colorado, 25/10): un px CSS mide ≈ 0.16 mm en móvil y
 * ≈ 0.26 mm en PC. Los cm CSS no son físicos, así que no se fija ninguna ventana en cm:
 * el tamaño se calcula en grados con esta heurística. Error típico ±15–20 %, que mueve los
 * ciclos/grado en la misma proporción (1 → 0.8–1.2). Sin calibración del usuario
 * (decisión de Lucas): el mínimo de movimiento es robusto entre 0.5 y 2 ciclos/grado.
 * La heurística se guarda en el perfil para poder reprocesar.
 */
export function viewingSetup(
  screenCssW: number,
  screenCssH: number,
  dpr: number,
  coarsePointer: boolean,
): { device: DeviceType; cm: number; cssPxPerMm: number; hint: string; heuristic: string } {
  void dpr;
  const phone = coarsePointer && Math.min(screenCssW, screenCssH) < 600;
  if (phone) return { device: "phone", cm: VIEWING_CM, cssPxPerMm: round(1 / 0.16, 1000), hint: "un antebrazo", heuristic: "phone-0.16mm-per-css-px" };
  return { device: "pc", cm: VIEWING_CM_LARGE, cssPxPerMm: round(1 / 0.26, 1000), hint: "un brazo extendido", heuristic: "pc-0.26mm-per-css-px" };
}

/** Ángulo visual (°) de `px` píxeles CSS a `viewingCm` con `cssPxPerMm`. */
export function degreesOf(px: number, viewingCm: number, cssPxPerMm: number): number {
  return (2 * Math.atan(px / cssPxPerMm / 2 / (viewingCm * 10)) * 180) / Math.PI;
}

export interface MotionV2Meta {
  refreshHz: number | null;
  temporalHz: number | null;
  cyclesPerDeg: number;
  viewingCm?: number;
  deviceType?: DeviceType;
  cssPxPerMm?: number;
  /** Tamaño de la red en grados (ancho × alto). */
  stimulusDeg?: { width: number; height: number };
  sizingHeuristic?: string;
  /** Fin de la sesión (para el historial); por defecto, ahora. */
  now?: Date;
  /** Huella del dispositivo (UA + pantalla + dpr + gamut + refresco). */
  device?: DeviceFingerprint;
  /** Interfaz con la que se hizo (v2 o v3; mismo motor). */
  ui?: MotionUi;
  /** Weber del punto de fijación usado (v2: SCREEN.dotWeber = −0.15; v3: −0.40). */
  fixationWeber?: number;
}

/** Periodo de la red en px CSS para `cpd` ciclos/grado a `viewingCm`, con `cssPxPerMm` supuestos. */
export function periodPx(cpd = CYCLES_PER_DEG, viewingCm = VIEWING_CM, cssPxPerMm = 96 / 25.4): number {
  const pxPerDeg = 2 * viewingCm * 10 * Math.tan(Math.PI / 360) * cssPxPerMm;
  return pxPerDeg / cpd;
}

/** Campo de la red (Lucas/Colorado, 25/10): pequeño y central, 4° × 2°, con punto de fijación. */
export const PATCH_DEG = { width: 4, height: 2 };

/** px CSS que subtienden `deg` grados a `viewingCm` con `cssPxPerMm`. */
export function pxOfDegrees(deg: number, viewingCm: number, cssPxPerMm: number): number {
  return 2 * viewingCm * 10 * Math.tan((deg * Math.PI) / 360) * cssPxPerMm;
}

/** Tamaño del parche en px CSS; nunca más del MAX_AREA de la pantalla ni más ancho que el contenedor. */
export function patchSize(viewingCm: number, cssPxPerMm: number, containerW: number, screenW: number, screenH: number): { width: number; height: number } {
  let width = pxOfDegrees(PATCH_DEG.width, viewingCm, cssPxPerMm);
  let height = pxOfDegrees(PATCH_DEG.height, viewingCm, cssPxPerMm);
  const k = Math.min(1, (containerW - 16) / width, Math.sqrt((MAX_AREA * screenW * screenH) / (width * height)));
  width *= k;
  height *= k;
  return { width: Math.floor(width), height: Math.floor(height) };
}

/** Luminancia media de la red de un ensayo (debe igualar `state.bgY`). */
export function meanGray(stim: { test: Vec3; ref: Vec3 }): number {
  return (luminance(stim.test) + luminance(stim.ref)) / 2;
}

/** Tamaño de la red: ancho del contenedor, alto limitado a MAX_AREA de la pantalla. */
export function gratingSize(containerW: number, screenW: number, screenH: number): { width: number; height: number } {
  const width = Math.max(120, Math.min(containerW, 520));
  const maxH = (MAX_AREA * screenW * screenH) / width;
  return { width: Math.round(width), height: Math.round(Math.max(60, Math.min(width * 0.4, maxH, 220))) };
}

export interface MotionV2Target {
  id: string;
  hue: string;
  /** Cromaticidad (sRGB lineal, máx. canal 1). La referencia siempre es gris. */
  color: Vec3;
  kind: "test" | "control";
  predicted: number;
  lo: number;
  hi: number;
}

interface Stair {
  target: MotionV2Target;
  logE: number;
  step: number;
  lastDir: 0 | 1 | -1;
  reversals: number[];
  trials: number;
  lo: number;
  hi: number;
  pinned: number;
  extensions: number;
  done: boolean;
  bound: MeasuredMatch["bound"];
  /** Estimación QUEST+ de μ = log(e_nulo): media e IC 95 %. */
  qpEst?: { mean: number; lo: number; hi: number };
  /** 1: el test necesita aún más brillo relativo que el tope; −1: aún menos. */
  atLeastSide?: 1 | -1;
}

export interface MotionV2Trial {
  targetId: string;
  catch: boolean;
  e: number;
  test: Vec3;
  ref: Vec3;
  sign: 1 | -1;
  answer: "left" | "right" | "still";
  correct?: boolean;
  at: number;
}

export const STILL_UNRELIABLE = 0.6;

export interface BlockRecord {
  trials: number;
  still: number;
  unreliable: boolean;
}

function closeBlock(state: MotionV2State): MotionV2State {
  if (state.block.trials === 0) return state;
  const rec = { ...state.block, unreliable: state.block.still / state.block.trials > STILL_UNRELIABLE };
  return { ...state, blocks: [...state.blocks, rec], block: { trials: 0, still: 0 } };
}

export interface MotionV2State {
  /** Luminancia Y del fondo, constante en toda la sesión (Colorado): la red se centra en ella. */
  bgY: number;
  type: ObserverType;
  weights: Vec3;
  stairs: Stair[];
  rng: number;
  /** Catch trials obligados antes de cerrar el bloque o la prueba. */
  pendingCatches: number;
  blockCatches: number;
  /** Ensayos y «quieto» del bloque en curso (catch incluidos). */
  block: { trials: number; still: number };
  /** Bloques cerrados. `unreliable`: «quieto» > 60 % de sus ensayos. */
  blocks: BlockRecord[];
  /** QUEST+ por color (solo con `?qp=1`); mutable, no se serializa. */
  qp?: QuestPlus[];
  method?: "staircase" | "quest+";
  /** Último escalón usado (para el nivel de gris de los catch del final). */
  lastIndex: number;
  current: { index: number; catch: boolean; sign: 1 | -1 } | null;
  log: MotionV2Trial[];
  sinceCatch: number;
  catches: { shown: number; missed: number };
  complete: boolean;
  endCatchesAsked?: boolean;
}

const RANGES: Record<ObserverType, [number, number]> = {
  protan: [0.3, 1.1],
  deutan: [0.8, 1.2],
  tritan: [0.8, 1.2],
  unknown: [0.3, 1.5],
  normal: [0.8, 1.2],
};

function round(n: number, f: number): number {
  return Math.round(n * f) / f;
}

function chroma(c: Vec3): Vec3 {
  const m = Math.max(c[0], c[1], c[2]);
  return m > 0 ? (c.map((v) => Math.max(0, v) / m) as Vec3) : [1, 1, 1];
}

/** Extremos de la línea de confusión medida, saturados al borde del gamut. */
function bandEnds(dir: Vec3 | null | undefined): Vec3[] {
  if (!dir || !dir.every(Number.isFinite)) return [];
  const out: Vec3[] = [];
  for (const sgn of [1, -1]) {
    let s = Infinity;
    for (let i = 0; i < 3; i++) {
      const d = dir[i] * sgn;
      if (d > 1e-9) s = Math.min(s, 0.5 / d);
      else if (d < -1e-9) s = Math.min(s, 0.5 / -d);
    }
    if (!Number.isFinite(s)) continue;
    out.push(chroma([0.5 + sgn * s * dir[0], 0.5 + sgn * s * dir[1], 0.5 + sgn * s * dir[2]]));
  }
  return out;
}

const GRAY: Vec3 = [0.18, 0.18, 0.18];

/** Colores por tipo: confusión contra gris, contrastes y un control en un eje no afectado. */
/** Punto a `SATURATION` del camino desde el gris medio hasta el borde del gamut, como cromaticidad. */
export function towardEdge(edge: Vec3, k = SATURATION): Vec3 {
  return chroma([0.5 + k * (edge[0] - 0.5), 0.5 + k * (edge[1] - 0.5), 0.5 + k * (edge[2] - 0.5)]);
}

export function targetsFor(type: ObserverType, weights: Vec3, confusionDir?: Vec3 | null): MotionV2Target[] {
  const span = type === "protan" || type === "deutan" ? [predictedLumWeights(type, 0), predictedLumWeights(type, 1)] : [];
  const [lo, hi] = RANGES[type];
  const list: Array<{ id: string; hue: string; color: Vec3; kind: "test" | "control"; main: boolean; repeat?: number }> = [];
  const band = bandEnds(confusionDir);
  if (type === "protan" || type === "deutan" || type === "normal") {
    const first: Vec3 = type === "deutan" ? [0, 1, 0] : [1, 0, 0];
    list.push({ id: type === "deutan" ? "verde" : "rojo", hue: type === "deutan" ? "verde #00FF00" : "rojo #FF0000", color: first, kind: "test", main: true });
    band.forEach((c, i) => list.push({ id: `banda-${i ? "b" : "a"}`, hue: `banda ${i ? "−" : "+"}`, color: c, kind: "test", main: true }));
    if (type === "deutan") list.push({ id: "rojo", hue: "rojo #FF0000", color: [1, 0, 0], kind: "test", main: false });
    else list.push({ id: "verde", hue: "verde #00FF00", color: [0, 1, 0], kind: "test", main: false });
    list.push({ id: "control-azul", hue: "azul #0000FF (control)", color: [0, 0, 1], kind: "control", main: false });
  } else if (type === "tritan") {
    for (const r of [1, 2]) {
      list.push({ id: `azul-${r}`, hue: "azul #0000FF", color: [0, 0, 1], kind: "test", main: true });
      list.push({ id: `violeta-${r}`, hue: "violeta", color: [0.5, 0, 1], kind: "test", main: true });
      list.push({ id: `amarillo-${r}`, hue: "amarillo #FFFF00", color: [1, 1, 0], kind: "test", main: true });
    }
    list.push({ id: "control-rojo", hue: "rojo #FF0000 (control)", color: [1, 0, 0], kind: "control", main: false });
  } else {
    list.push({ id: "rojo", hue: "rojo #FF0000", color: [1, 0, 0], kind: "test", main: true });
    list.push({ id: "verde", hue: "verde #00FF00", color: [0, 1, 0], kind: "test", main: true });
    list.push({ id: "azul", hue: "azul #0000FF", color: [0, 0, 1], kind: "test", main: true });
    list.push({ id: "amarillo", hue: "amarillo #FFFF00", color: [1, 1, 0], kind: "test", main: true });
  }
  return list.map((t) => {
    const color = towardEdge(t.color);
    const predicted = Math.min(E_MAX, Math.max(E_MIN, predictedMatch(color, GRAY, weights)));
    // Centro en la predicción ±50 %; los colores de confusión además cubren la tabla del tipo
    // y la predicción para severity 0..1. Todo dentro del tope de contraste.
    const ends = span.map((w) => predictedMatch(color, GRAY, w));
    let tlo = t.main ? Math.min(lo, predicted / 1.25, ...ends) : Math.min(predicted / 1.5, ...ends);
    let thi = t.main ? Math.max(hi, predicted * 1.25, ...ends) : Math.max(predicted * 1.5, ...ends);
    tlo = Math.max(E_MIN, tlo);
    thi = Math.min(E_MAX, thi);
    return { id: t.id, hue: t.hue, color, kind: t.kind, predicted: round(predicted, 1e4), lo: round(tlo, 1e4), hi: round(thi, 1e4) };
  });
}

function nextRand(state: number): { state: number; value: number } {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** `opts.fixedSlope`: β fijo al nominal en vez de marginalizarlo (experimento de coste, Colorado). */
export function createMotionV2(profile: Pick<UmbralProfile, "fit" | "luminance">, seed: number, questPlus?: JsQuest, opts: { fixedSlope?: boolean } = {}): MotionV2State {
  const v3 = profile.luminance ?? defaultLuminanceV3(profile);
  const type = v3.type ?? "unknown";
  const weights = v3.predicted ?? predictedLumWeights("normal");
  const targets = targetsFor(type, weights, profile.fit?.confusionDirectionLinearRgb);
  const stairs: Stair[] = targets.map((target) => ({
    target,
    logE: Math.log(Math.min(target.hi, Math.max(target.lo, target.predicted))),
    step: START_STEP,
    lastDir: 0,
    reversals: [],
    trials: 0,
    lo: Math.log(target.lo),
    hi: Math.log(target.hi),
    pinned: 0,
    extensions: 0,
    done: false,
    bound: "converged",
  }));
  const qp = questPlus ? targets.map((t) => makeQuest(questPlus, t, opts.fixedSlope ?? QP_MOTION.fixedSlope)) : undefined;
  if (qp) qp.forEach((q, i) => (stairs[i].logE = Math.log(safeE(Math.exp(q.next())))));
  return pick({ bgY: backgroundY(targets), type, weights, stairs, qp, method: qp ? "quest+" : "staircase", rng: seed >>> 0, pendingCatches: 0, blockCatches: 0, block: { trials: 0, still: 0 }, blocks: [], lastIndex: 0, current: null, log: [], sinceCatch: 0, catches: { shown: 0, missed: 0 }, complete: false });
}

/** Cierra el bloque: si faltan catch trials hasta MIN_CATCHES_PER_BLOCK, se piden antes de la pausa. */
export function requireBlockCatches(state: MotionV2State): MotionV2State {
  const pendingCatches = Math.max(0, MIN_CATCHES_PER_BLOCK - state.blockCatches);
  return pick({ ...state, pendingCatches });
}

/** Empieza un bloque nuevo tras la pausa. */
export function startBlock(state: MotionV2State): MotionV2State {
  return { ...closeBlock(state), blockCatches: 0, pendingCatches: 0 };
}

/** El bloque ya tiene sus catch trials obligados. */
export function blockReady(state: MotionV2State): boolean {
  return state.pendingCatches === 0;
}

function pick(state: MotionV2State): MotionV2State {
  const open = state.stairs.map((s, i) => (s.done ? -1 : i)).filter((i) => i >= 0);
  let pending = state.pendingCatches;
  if (!open.length && !state.complete && pending === 0 && state.blockCatches < MIN_CATCHES_PER_BLOCK && !state.endCatchesAsked) {
    pending = MIN_CATCHES_PER_BLOCK - state.blockCatches;
    state = { ...state, endCatchesAsked: true };
  }
  if (!open.length && pending === 0) return { ...closeBlock(state), pendingCatches: 0, current: null, complete: true };
  let r = nextRand(state.rng);
  const index = open.length ? open[Math.floor(r.value * open.length)] : state.lastIndex;
  r = nextRand(r.state);
  // Dirección equilibrada (Colorado): por parejas de ensayos, una a cada lado en orden aleatorio.
  const n = state.log.length;
  const sign: 1 | -1 = n % 2 === 0 ? (r.value < 0.5 ? 1 : -1) : (-state.log[n - 1].sign as 1 | -1);
  r = nextRand(r.state);
  const isCatch = pending > 0 || (state.sinceCatch >= CATCH_EVERY - 1 && r.value < 0.8);
  return { ...state, pendingCatches: pending, rng: r.state, lastIndex: index, current: { index, catch: isCatch, sign } };
}

/**
 * Fondo constante (Colorado): la Y media más baja que TODOS los ensayos pueden alcanzar.
 * Por ensayo, la red de media m usa ref = 2·m·e/(1+e) y test = ref/e; los topes son
 * ref ≤ MAX_REF_Y y test dentro del gamut (ref ≤ 0.95·e·Yc). El catch (test = 1.2·ref) también cabe.
 */
export function backgroundY(targets: MotionV2Target[]): number {
  let best = Infinity;
  const n = 400;
  for (const t of targets) {
    const yc = luminance(t.color);
    for (let i = 0; i <= n; i++) {
      const e = E_MIN * (E_MAX / E_MIN) ** (i / n);
      const ref = Math.min(MAX_REF_Y, 0.95 * e * yc);
      best = Math.min(best, (ref * (1 + 1 / e)) / 2);
    }
  }
  return Math.min(best, MAX_REF_Y / 1.1);
}

/** Colores lineales del ensayo actual. */
export function stimulusOf(state: MotionV2State): { test: Vec3; ref: Vec3; sign: 1 | -1; e: number; catch: boolean } | null {
  if (!state.current) return null;
  const stair = state.stairs[state.current.index];
  const e = safeE(Math.exp(stair.logE));
  const c = stair.target.color;
  const yc = luminance(c);
  if (state.current.catch) {
    // Movimiento solo de luminancia, dirección conocida (gris 20 % más claro: Michelson 9 %), media = fondo.
    const r = state.bgY / 1.1;
    const k = 1.2 * r;
    return { test: [k, k, k], ref: [r, r, r], sign: state.current.sign, e: 1.2, catch: true };
  }
  // Red centrada en el gris de fondo constante.
  const yRef = (2 * state.bgY * e) / (1 + e);
  const ref: Vec3 = [yRef, yRef, yRef];
  const s = yRef / e / yc;
  return { test: [c[0] * s, c[1] * s, c[2] * s], ref, sign: state.current.sign, e, catch: false };
}

function spread(values: number[]): { mean: number; ci: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, n);
  if (n < 2) return { mean, ci: Infinity };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { mean, ci: (1.96 * sd) / Math.sqrt(n) };
}

export function answerMotionV2(state: MotionV2State, answer: "left" | "right" | "still", at: number): MotionV2State {
  const stim = stimulusOf(state);
  if (!stim || !state.current) return state;
  const cur = state.current;
  state = { ...state, block: { trials: state.block.trials + 1, still: state.block.still + (answer === "still" ? 1 : 0) } };
  const stair = state.stairs[cur.index];
  const record: MotionV2Trial = {
    targetId: cur.catch ? "catch" : stair.target.id,
    catch: cur.catch,
    e: round(stim.e, 1e4),
    test: stim.test.map((v) => round(v, 1e5)) as Vec3,
    ref: stim.ref.map((v) => round(v, 1e5)) as Vec3,
    sign: cur.sign,
    answer,
    at,
  };
  if (cur.catch) {
    // Movimiento evidente: «quieto» también es fallo (atención).
    const correct = answer === (cur.sign === 1 ? "right" : "left");
    return pick({
      ...state,
      log: [...state.log, { ...record, correct }],
      sinceCatch: 0,
      pendingCatches: Math.max(0, state.pendingCatches - 1),
      blockCatches: state.blockCatches + 1,
      catches: { shown: state.catches.shown + 1, missed: state.catches.missed + (correct ? 0 : 1) },
    });
  }
  const next: Stair = { ...stair, reversals: [...stair.reversals], trials: stair.trials + 1 };
  const q = state.qp?.[cur.index];
  if (q) {
    // QUEST+: 0 = test más claro que su nulo (x < μ), 1 = quieto, 2 = más oscuro.
    const brighter = (answer === "right") === (cur.sign === 1);
    q.update(next.logE, answer === "still" ? 1 : brighter ? 0 : 2);
    const est = q.estimate();
    next.qpEst = { mean: est.mean, lo: est.lo, hi: est.hi };
    const lo = Math.log(E_MIN);
    const hi = Math.log(E_MAX);
    if (est.hi < lo || est.lo > hi) {
      next.done = true;
      next.bound = "at-least";
      next.atLeastSide = est.lo > hi ? 1 : -1;
    } else if (est.width < QP_MOTION.stopWidth) next.done = true;
    else if (next.trials >= QP_MOTION.maxTrials) {
      next.done = true;
      next.bound = est.mean < lo || est.mean > hi ? "at-least" : "cap";
      if (next.bound === "at-least") next.atLeastSide = est.mean > hi ? 1 : -1;
    }
    next.logE = Math.log(safeE(Math.exp(q.next())));
    const stairs = state.stairs.slice();
    stairs[cur.index] = next;
    return pick({ ...state, stairs, log: [...state.log, record], sinceCatch: state.sinceCatch + 1 });
  }
  if (answer === "still") {
    // Fuera de los catch, «quieto» es informativo: casi equiluminancia, cerca del nulo.
    next.reversals.push(next.logE);
    next.step = Math.max(FINE_STEP, next.step / 2);
  } else {
    const brighter = (answer === "right") === (cur.sign === 1);
    const dir: 1 | -1 = brighter ? 1 : -1;
    if (next.lastDir !== 0 && dir !== next.lastDir) {
      next.reversals.push(next.logE);
      next.step = Math.max(FINE_STEP, next.step / 2);
    }
    next.lastDir = dir;
    let le = next.logE + dir * next.step;
    const capHi = Math.log(E_MAX);
    const capLo = Math.log(E_MIN);
    if (le > next.hi || le < next.lo) {
      le = Math.min(next.hi, Math.max(next.lo, le));
      next.pinned += 1;
      const atCap = dir > 0 ? next.hi >= capHi - 1e-9 : next.lo <= capLo + 1e-9;
      if (next.pinned >= 2 && next.extensions < 2 && !atCap) {
        // Toca el límite: se ensancha ese lado un 50 %, sin pasar el tope de contraste.
        if (dir > 0) next.hi = Math.min(capHi, next.hi + Math.log(1.5));
        else next.lo = Math.max(capLo, next.lo - Math.log(1.5));
        next.extensions += 1;
        next.pinned = 0;
      } else if (next.pinned >= 3) {
        next.done = true;
        // En el tope de contraste: el resultado es una cota («al menos»), no una igualación.
        next.bound = atCap ? "at-least" : "edge";
        next.atLeastSide = dir;
      }
    } else next.pinned = 0;
    next.logE = le;
  }
  const tail = next.reversals.slice(-6);
  const { ci } = spread(tail);
  if (!next.done && (next.reversals.length >= STOP_REVERSALS || (next.reversals.length >= 4 && ci < STOP_CI))) next.done = true;
  if (!next.done && next.trials >= TRIALS_PER_TARGET) {
    next.done = true;
    next.bound = "cap";
  }
  const stairs = state.stairs.slice();
  stairs[cur.index] = next;
  return pick({ ...state, stairs, log: [...state.log, record], sinceCatch: state.sinceCatch + 1 });
}

/** Igualaciones en el formato de lumweights: test con la misma Y estándar que el gris. */
export function measuredMatches(state: MotionV2State): MeasuredMatch[] {
  return state.stairs
    .filter((s) => s.trials > 0)
    .map((s) => {
      const atLeast = s.bound === "at-least";
      if (s.qpEst) {
        const e = safeE(Math.exp(s.qpEst.mean));
        const yc = luminance(s.target.color);
        return {
          id: s.target.id,
          hue: s.target.hue,
          kind: s.target.kind,
          test: s.target.color.map((v) => round((v * 0.1) / yc, 1e6)) as Vec3,
          ref: [0.1, 0.1, 0.1] as Vec3,
          gain: round(1 / e, 1e4),
          efficiency: round(e, 1e4),
          width: round(Math.max(0.01, Math.exp(s.qpEst.hi - s.qpEst.lo) - 1), 1e4),
          reversals: 0,
          trials: s.trials,
          bound: s.bound,
          atLeast,
          ...(atLeast ? { atLeastSide: s.atLeastSide ?? 1 } : {}),
        };
      }
      const values = !atLeast && s.reversals.length >= 2 ? s.reversals.slice(-6) : [s.logE];
      const { mean, ci } = spread(values);
      const e = Math.exp(mean);
      const width = Number.isFinite(ci) ? Math.max(0.01, 2 * (Math.exp(ci) - 1)) : Math.max(0.05, 2 * (Math.exp(s.step) - 1));
      const yRef = 0.1;
      const yc = luminance(s.target.color);
      const t = s.target.color.map((v) => round((v * yRef) / yc, 1e6)) as Vec3;
      return {
        id: s.target.id,
        hue: s.target.hue,
        kind: s.target.kind,
        test: t,
        ref: [yRef, yRef, yRef] as Vec3,
        gain: round(1 / e, 1e4),
        efficiency: round(e, 1e4),
        width: round(width, 1e4),
        reversals: s.reversals.length,
        trials: s.trials,
        bound: s.bound,
        atLeast,
        ...(atLeast ? { atLeastSide: s.atLeastSide ?? 1 } : {}),
      };
    });
}

/** Guarda los pesos de la prueba v2 en el perfil v3. Las `matches` antiguas no se tocan. */
export function attachMotionV2(
  profile: UmbralProfile,
  state: MotionV2State,
  meta: MotionV2Meta,
): UmbralProfile {
  const base = profile.luminance ?? { ...defaultLuminanceV3(profile), method: "", temporalHz: 1, count: 0, sampleCount: 0, reading: "", matches: [] };
  const matches = measuredMatches(state);
  // Las cotas («al menos») no son igualaciones: no entran en el ajuste.
  const usable = matches.filter((m) => m.bound !== "edge" && !m.atLeast);
  const solved = solveLumWeights(
    usable.map((m) => ({ test: m.test, ref: m.ref, gain: m.gain, width: m.width, kind: m.kind, id: m.id })),
    base.predicted ?? null,
    { missedCatches: state.catches.missed > state.catches.shown / 4 ? state.catches.missed : 0 },
  );
  const unreliable = state.blocks.filter((b) => b.unreliable).length;
  const entry = makeSession(
    "motion-v2",
    {
      date: (meta.now ?? new Date()).toISOString(),
      deviceType: meta.deviceType ?? null,
      viewingCm: meta.viewingCm ?? null,
      stimulusDeg: meta.stimulusDeg ?? null,
      backgroundY: state.bgY ?? null,
      method: state.method ?? "staircase",
      ...(meta.device ? { device: meta.device } : {}),
      ui: meta.ui ?? "v2",
      fixationWeber: meta.fixationWeber ?? SCREEN.dotWeber,
    },
    state.log,
  );
  return appendHistory({
    ...profile,
    luminance: {
      ...base,
      weights: solved.weights,
      weightsSource: solved.source,
      refreshHz: meta.refreshHz == null ? null : round(meta.refreshHz, 10),
      temporalHzV2: meta.temporalHz,
      cyclesPerDeg: meta.cyclesPerDeg,
      viewingCm: meta.viewingCm ?? null,
      deviceType: meta.deviceType ?? null,
      cssPxPerMm: meta.cssPxPerMm ?? null,
      stimulusDeg: meta.stimulusDeg ?? null,
      sizingHeuristic: meta.sizingHeuristic ?? null,
      searchMethod: state.method ?? "staircase",
      ui: meta.ui ?? "v2",
      fixationWeber: meta.fixationWeber ?? SCREEN.dotWeber,
      build: BUILD,
      ...(meta.device ? { device: meta.device } : {}),
      checks: {
        controlError: solved.controlError,
        catches: state.catches,
        residuals: solved.residuals,
        cond: Number.isFinite(solved.cond) ? solved.cond : null,
        withinNoise: solved.withinNoise,
        confidence: unreliable > 0 ? "low" : solved.confidence,
        blocks: state.blocks,
        unreliableBlocks: unreliable,
      },
      calibratedWith: "standard-Y",
      measuredMatches: matches,
    },
  }, entry);
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function encode(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * Pinta un fotograma (phase 0..3) en RGBA con tramado espacial (Bayer 4×4) y temporal
 * (`tick` desplaza la matriz). `period` en px del buffer.
 */
export function paintMotionV2(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  phase: number,
  tick: number,
  stim: { test: Vec3; ref: Vec3; sign: 1 | -1 },
  period: number,
  mask?: Float32Array,
): void {
  if (mask) return paintMasked(data, width, height, phase, tick, stim, period, mask);
  const yT = luminance(stim.test);
  const yR = luminance(stim.ref);
  const mean = (yT + yR) / 2;
  const ox = tick & 3;
  const oy = (tick >> 2) & 3;
  const cols = new Array<Vec3>(width);
  for (let x = 0; x < width; x++) {
    const phi = (stim.sign * 2 * Math.PI * x) / period;
    let c: Vec3;
    if (phase === 0 || phase === 2) {
      const m = 0.5 + (phase === 0 ? 0.5 : -0.5) * Math.sin(phi);
      c = [
        stim.ref[0] + (stim.test[0] - stim.ref[0]) * m,
        stim.ref[1] + (stim.test[1] - stim.ref[1]) * m,
        stim.ref[2] + (stim.test[2] - stim.ref[2]) * m,
      ];
    } else {
      const y = mean * (1 + (phase === 1 ? 1 : -1) * LUMA_CONTRAST * Math.sin(phi - Math.PI / 2));
      c = [y, y, y];
    }
    cols[x] = [encode(c[0]) * 255, encode(c[1]) * 255, encode(c[2]) * 255];
  }
  for (let y = 0; y < height; y++) {
    const by = ((y + oy) & 3) * 4;
    for (let x = 0; x < width; x++) {
      const d = (BAYER[by + ((x + ox) & 3)] + 0.5) / 16;
      const c = cols[x];
      const i = (y * width + x) * 4;
      data[i] = Math.floor(c[0] + d);
      data[i + 1] = Math.floor(c[1] + d);
      data[i + 2] = Math.floor(c[2] + d);
      data[i + 3] = 255;
    }
  }
}

/** Constantes de la pantalla de prueba (restricciones de Colorado, 25/10). */
export const SCREEN = {
  /** Borde suave del parche: ventana coseno de 0.25°. */
  edgeDeg: 0.25,
  /** Hueco circular central de 0.5° con la luminancia media. */
  gapDeg: 0.5,
  /** Punto de fijación de 0.15°. */
  dotDeg: 0.15,
  /** Contraste de Weber del punto de fijación (acromático). */
  dotWeber: -0.15,
  /** Margen mínimo parche–decoración: máx(1°, un periodo). */
  marginDeg: Math.max(1, 1 / CYCLES_PER_DEG),
  /** Weber máximo de las líneas de la retícula y del texto. */
  lineWeber: 0.15,
  textWeber: 0.3,
  /** Instrucciones y botones, lejos del parche (Colorado): 30–40 %. */
  uiWeber: 0.35,
  /** Gris neutro entre ensayos. */
  isiMs: 500,
} as const;

/** Rampa coseno 0→1 en [0, edge]. */
function ramp(d: number, edge: number): number {
  if (d <= 0) return 0;
  if (d >= edge) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * d) / edge);
}

/**
 * Peso por píxel (0..1) del parche: apertura ELÍPTICA inscrita en width × height con ventana
 * coseno RADIAL de `edgePx` en todo el contorno (sin esquinas rectas), y hueco circular central
 * con borde coseno. Fuera del peso la imagen tiende al gris de luminancia media (en lineal).
 */
export function patchMask(width: number, height: number, edgePx: number, gapRadiusPx: number): Float32Array {
  const m = new Float32Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  const a = width / 2;
  const b = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      // Radio de la elipse en esta dirección: distancia (px) al contorno a lo largo del radio.
      const re = r > 0 ? (a * b) / Math.hypot(b * (dx / r), a * (dy / r)) : Math.min(a, b);
      m[y * width + x] = ramp(re - r, edgePx) * ramp(r - gapRadiusPx, edgePx / 2);
    }
  }
  return m;
}

const ENCODE_N = 4096;
const ENCODE_LUT = (() => {
  const t = new Float32Array(ENCODE_N + 1);
  for (let i = 0; i <= ENCODE_N; i++) t[i] = encode(i / ENCODE_N) * 255;
  return t;
})();
function enc255(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return ENCODE_LUT[Math.round(c * ENCODE_N)];
}

function paintMasked(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  phase: number,
  tick: number,
  stim: { test: Vec3; ref: Vec3; sign: 1 | -1 },
  period: number,
  mask: Float32Array,
): void {
  const yT = luminance(stim.test);
  const yR = luminance(stim.ref);
  const mean = (yT + yR) / 2;
  const ox = tick & 3;
  const oy = (tick >> 2) & 3;
  const cols = new Array<Vec3>(width);
  for (let x = 0; x < width; x++) {
    const phi = (stim.sign * 2 * Math.PI * x) / period;
    if (phase === 0 || phase === 2) {
      const m = 0.5 + (phase === 0 ? 0.5 : -0.5) * Math.sin(phi);
      cols[x] = [
        stim.ref[0] + (stim.test[0] - stim.ref[0]) * m,
        stim.ref[1] + (stim.test[1] - stim.ref[1]) * m,
        stim.ref[2] + (stim.test[2] - stim.ref[2]) * m,
      ];
    } else {
      const y = mean * (1 + (phase === 1 ? 1 : -1) * LUMA_CONTRAST * Math.sin(phi - Math.PI / 2));
      cols[x] = [y, y, y];
    }
  }
  for (let y = 0; y < height; y++) {
    const by = ((y + oy) & 3) * 4;
    for (let x = 0; x < width; x++) {
      const w = mask[y * width + x];
      const c = cols[x];
      const d = (BAYER[by + ((x + ox) & 3)] + 0.5) / 16;
      const i = (y * width + x) * 4;
      // Mezcla en lineal hacia el gris medio: la ventana nunca sube el contraste.
      data[i] = Math.floor(enc255(mean + w * (c[0] - mean)) + d);
      data[i + 1] = Math.floor(enc255(mean + w * (c[1] - mean)) + d);
      data[i + 2] = Math.floor(enc255(mean + w * (c[2] - mean)) + d);
      data[i + 3] = 255;
    }
  }
}

/** Gris sRGB (0..255) con luminancia `y` (lineal). */
export function gray255(y: number): number {
  return Math.round(encode(y) * 255);
}
