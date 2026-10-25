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
import { luminance, type Vec3 } from "./space";
import { predictedMatch, predictedLumWeights, type ObserverType } from "./cones";
import { solveLumWeights } from "./lumweights";
import { defaultLuminanceV3, type MeasuredMatch, type UmbralProfile } from "./profile";

export const MOTION_V2_FLAG = "umbral-motion";
/** Contraste de Michelson de la red de luminancia (≤ 10 %). */
export const LUMA_CONTRAST = 0.08;
/** Fracción máxima de la pantalla ocupada por la red. */
export const MAX_AREA = 0.25;
export const CYCLES_PER_DEG = 0.75;
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

export function motionV2Enabled(search: string, stored: string | null): boolean {
  const q = new URLSearchParams(search).get("motion");
  if (q === "v2") return true;
  if (q === "v1") return false;
  return stored === "v2";
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
 * SUPUESTO px/mm: los px CSS no son físicos. En PC se toma el px de referencia CSS
 * (96 px/pulgada ≈ 3.78 px/mm). En móvil, ~150 px CSS/pulgada (≈ 5.9 px/mm) si
 * devicePixelRatio ≥ 3 y ~132 (≈ 5.2 px/mm) si no. Error típico ±15 %, que mueve los
 * ciclos/grado en la misma proporción (0.75 → 0.64–0.86). Sin calibración del usuario
 * (decisión de Lucas): el mínimo de movimiento es robusto entre 0.5 y 2 ciclos/grado.
 */
export function viewingSetup(
  screenCssW: number,
  screenCssH: number,
  dpr: number,
  coarsePointer: boolean,
): { device: DeviceType; cm: number; cssPxPerMm: number; hint: string } {
  const phone = coarsePointer && Math.min(screenCssW, screenCssH) < 600;
  if (phone) return { device: "phone", cm: VIEWING_CM, cssPxPerMm: round((dpr >= 3 ? 150 : 132) / 25.4, 1000), hint: "un antebrazo" };
  return { device: "pc", cm: VIEWING_CM_LARGE, cssPxPerMm: round(96 / 25.4, 1000), hint: "un brazo extendido" };
}

/** Periodo de la red en px CSS para `cpd` ciclos/grado a `viewingCm`, con `cssPxPerMm` supuestos. */
export function periodPx(cpd = CYCLES_PER_DEG, viewingCm = VIEWING_CM, cssPxPerMm = 96 / 25.4): number {
  const pxPerDeg = 2 * viewingCm * 10 * Math.tan(Math.PI / 360) * cssPxPerMm;
  return pxPerDeg / cpd;
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

export function createMotionV2(profile: Pick<UmbralProfile, "fit" | "luminance">, seed: number): MotionV2State {
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
  return pick({ type, weights, stairs, rng: seed >>> 0, pendingCatches: 0, blockCatches: 0, block: { trials: 0, still: 0 }, blocks: [], lastIndex: 0, current: null, log: [], sinceCatch: 0, catches: { shown: 0, missed: 0 }, complete: false });
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
  const sign: 1 | -1 = r.value < 0.5 ? 1 : -1;
  r = nextRand(r.state);
  const isCatch = pending > 0 || (state.sinceCatch >= CATCH_EVERY - 1 && r.value < 0.8);
  return { ...state, pendingCatches: pending, rng: r.state, lastIndex: index, current: { index, catch: isCatch, sign } };
}

/** Colores lineales del ensayo actual. */
export function stimulusOf(state: MotionV2State): { test: Vec3; ref: Vec3; sign: 1 | -1; e: number; catch: boolean } | null {
  if (!state.current) return null;
  const stair = state.stairs[state.current.index];
  const e = Math.exp(stair.logE);
  const c = stair.target.color;
  const yc = luminance(c);
  const yRef = Math.min(MAX_REF_Y, 0.95 * e * yc);
  const ref: Vec3 = [yRef, yRef, yRef];
  if (state.current.catch) {
    // Movimiento solo de luminancia, dirección conocida (gris 20 % más claro: Michelson 9 %).
    const k = 1.2 * yRef;
    return { test: [k, k, k], ref, sign: state.current.sign, e: 1.2, catch: true };
  }
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
  meta: {
    refreshHz: number | null;
    temporalHz: number | null;
    cyclesPerDeg: number;
    viewingCm?: number;
    deviceType?: DeviceType;
    cssPxPerMm?: number;
  },
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
  return {
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
  };
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
): void {
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
