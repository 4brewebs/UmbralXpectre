/**
 * Pesos de luminancia personales a partir de igualaciones de brillo (fase 1).
 *
 * Cada igualación dice que, para este observador, g·test y ref brillan igual:
 *   w · (g·t − r) = 0
 * Se resuelve por mínimos cuadrados ponderados (1/ancho²) con wR+wG+wB = 1, w ≥ 0
 * y un prior de peso λ (en "igualaciones equivalentes") hacia la predicción del modelo de conos.
 */
import { luminance, Y_COEF, type Vec3 } from "./space";

export interface BrightnessMatch {
  /** Color de prueba (sRGB lineal) tal como se escaló en la prueba antes de la ganancia. */
  test: Vec3;
  /** Referencia neutra (sRGB lineal). */
  ref: Vec3;
  /** Ganancia sobre `test` que lo iguala en brillo a `ref`. */
  gain: number;
  /** Ancho relativo del intervalo de la ganancia (p. ej. 0.02 = ±1%). */
  width: number;
  kind?: "test" | "control";
  id?: string;
}

export type WeightsSource = "measured" | "predicted" | "standard";

export interface LumWeightsResult {
  weights: Vec3;
  /** Error relativo de brillo de cada igualación con los pesos resueltos. */
  residuals: number[];
  /** Número de condición en el plano wR+wG+wB = 1 (solo datos, sin prior). */
  cond: number;
  n: number;
  source: WeightsSource;
  /** Y estándar explica las igualaciones dentro del ruido (útil en deután/tritán). */
  withinNoise: boolean;
  /** Control fuera de lo esperado, catch fallados o datos mal condicionados. */
  confidence: "high" | "low";
  controlError: number | null;
}

export const PRIOR_LAMBDA = 2;
const MIN_WIDTH = 0.01;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Fila de la igualación normalizada por la luminancia de la referencia. */
function row(m: BrightnessMatch): Vec3 {
  const y = luminance(m.ref) || 1;
  return [(m.gain * m.test[0] - m.ref[0]) / y, (m.gain * m.test[1] - m.ref[1]) / y, (m.gain * m.test[2] - m.ref[2]) / y];
}

function weightOf(m: BrightnessMatch): number {
  const w = Math.max(MIN_WIDTH, Number.isFinite(m.width) ? m.width : 1);
  return 1 / (w * w);
}

function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

/** min wᵀA w + λ|w − p|² con 1ᵀw = 1 y w_i = 0 para i ∈ zero. */
function constrained(A: number[][], lambda: number, prior: Vec3, zero: Set<number>): Vec3 | null {
  const size = 4 + zero.size;
  const K = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) K[i][j] = 2 * A[i][j] + (i === j ? 2 * lambda : 0);
    rhs[i] = 2 * lambda * prior[i];
    K[i][3] = 1;
    K[3][i] = 1;
  }
  rhs[3] = 1;
  [...zero].forEach((idx, k) => {
    K[idx][4 + k] = 1;
    K[4 + k][idx] = 1;
  });
  const x = solveLinear(K, rhs);
  return x ? [x[0], x[1], x[2]] : null;
}

function planeCond(A: number[][]): number {
  const u1: Vec3 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
  const u2: Vec3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
  const Au = (u: Vec3): Vec3 => [dot(A[0] as Vec3, u), dot(A[1] as Vec3, u), dot(A[2] as Vec3, u)];
  const a = dot(u1, Au(u1));
  const b = dot(u1, Au(u2));
  const d = dot(u2, Au(u2));
  const tr = a + d;
  const disc = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
  const hi = tr / 2 + disc;
  const lo = tr / 2 - disc;
  if (!(hi > 0)) return Infinity;
  return lo > hi * 1e-12 ? hi / lo : Infinity;
}

export function solveLumWeights(
  matches: BrightnessMatch[],
  prediction: Vec3 | null,
  options: { lambda?: number; missedCatches?: number; controlTolerance?: number } = {},
): LumWeightsResult {
  const standard: Vec3 = [...Y_COEF] as Vec3;
  const prior = prediction ?? standard;
  const usable = matches.filter((m) => m.gain > 0 && Number.isFinite(m.gain));
  const tests = usable.filter((m) => m.kind !== "control");
  const controls = usable.filter((m) => m.kind === "control");
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let wsum = 0;
  for (const m of usable) {
    const a = row(m);
    const om = weightOf(m);
    wsum += om;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += om * a[i] * a[j];
  }
  const cond = planeCond(A);
  let weights: Vec3 = prior;
  let source: WeightsSource = prediction ? "predicted" : "standard";
  if (tests.length > 0) {
    const lambda = (options.lambda ?? PRIOR_LAMBDA) * (wsum / usable.length);
    const zero = new Set<number>();
    let w = constrained(A, lambda, prior, zero);
    for (let guard = 0; w && guard < 3; guard++) {
      const neg = [0, 1, 2].filter((i) => !zero.has(i) && w![i] < 0);
      if (!neg.length) break;
      neg.forEach((i) => zero.add(i));
      w = constrained(A, lambda, prior, zero);
    }
    if (w) {
      weights = w.map((v) => Math.max(0, v)) as Vec3;
      const s = weights[0] + weights[1] + weights[2];
      weights = weights.map((v) => v / s) as Vec3;
      source = "measured";
    }
  }
  const rel = (m: BrightnessMatch, w: Vec3) => dot(row(m), w) / (dot(m.ref, w) / (luminance(m.ref) || 1) || 1);
  const residuals = usable.map((m) => rel(m, weights));
  const chi = (w: Vec3) => usable.reduce((sum, m) => sum + weightOf(m) * rel(m, w) ** 2, 0) / Math.max(1, usable.length);
  const withinNoise = usable.length > 0 && chi(standard) <= 4;
  const tol = options.controlTolerance ?? 0.1;
  let controlError: number | null = null;
  for (const m of controls) {
    const e = Math.abs(rel(m, weights));
    controlError = controlError == null ? e : Math.max(controlError, e);
  }
  const low =
    (controlError != null && controlError > Math.max(tol, 2 * Math.max(...controls.map((m) => m.width)))) ||
    (options.missedCatches ?? 0) > 0 ||
    (source === "measured" && !(cond < 1e6) && tests.length < 2);
  return {
    weights: weights.map((v) => Math.round(v * 1e5) / 1e5) as Vec3,
    residuals: residuals.map((v) => Math.round(v * 1e4) / 1e4),
    cond: Number.isFinite(cond) ? Math.round(cond * 10) / 10 : Infinity,
    n: usable.length,
    source,
    withinNoise,
    confidence: source === "measured" && !low ? "high" : "low",
    controlError: controlError == null ? null : Math.round(controlError * 1e4) / 1e4,
  };
}
