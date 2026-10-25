/**
 * Display-relative color geometry for an adaptive matcher.
 *
 * Stimuli live in linear sRGB at constant CIE Y. Search directions are seeded
 * from cone-isolation axes (priors only). The measured threshold along each
 * direction — not the prior — is the result.
 */

export type Vec3 = [number, number, number];

export const ANCHOR = 0.22;

const Y_COEF: Vec3 = [0.2126729, 0.7151522, 0.072175];

const RGB_TO_XYZ: number[][] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

/** Hunt-Pointer-Estevez, D65. */
const XYZ_TO_LMS: number[][] = [
  [0.4002, 0.7076, -0.0808],
  [-0.2263, 1.1653, 0.0457],
  [0, 0, 0.9182],
];

export function luminance(rgb: Vec3): number {
  return Y_COEF[0] * rgb[0] + Y_COEF[1] * rgb[1] + Y_COEF[2] * rgb[2];
}

export function killLuminance(rgb: Vec3): Vec3 {
  const y = luminance(rgb);
  return [rgb[0] - y, rgb[1] - y, rgb[2] - y];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function addScaled(base: Vec3, dir: Vec3, s: number): Vec3 {
  return [base[0] + dir[0] * s, base[1] + dir[1] * s, base[2] + dir[2] * s];
}

function matMul(a: number[][], b: number[][]): number[][] {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function apply(m: number[][], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function invert3(m: number[][]): number[][] {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("Singular color matrix");
  const invDet = 1 / det;
  return [
    [A * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [B * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [C * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

const RGB_TO_LMS = matMul(XYZ_TO_LMS, RGB_TO_XYZ);
const LMS_TO_RGB = invert3(RGB_TO_LMS);

function coneIsolation(cone: 0 | 1 | 2): Vec3 {
  const e: Vec3 = [0, 0, 0];
  e[cone] = 1;
  return normalize(killLuminance(apply(LMS_TO_RGB, e)));
}

function gramSchmidt(a: Vec3, b: Vec3): { u: Vec3; v: Vec3 } {
  const u = normalize(a);
  const proj = dot(b, u);
  const v = normalize([b[0] - u[0] * proj, b[1] - u[1] * proj, b[2] - u[2] * proj]);
  return { u, v };
}

const BASIS = gramSchmidt(killLuminance([1, 0, 0]), killLuminance([0, 0, 1]));

export function dirFromTheta(theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return normalize([
    c * BASIS.u[0] + s * BASIS.v[0],
    c * BASIS.u[1] + s * BASIS.v[1],
    c * BASIS.u[2] + s * BASIS.v[2],
  ]);
}

export function thetaOf(dir: Vec3): number {
  const u = dot(dir, BASIS.u);
  const v = dot(dir, BASIS.v);
  return Math.atan2(v, u);
}

export function angDist(a: number, b: number): number {
  const d = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(d);
}

/** Distance between undirected axes. θ and θ+180° are the same pair of cards, so this is 0. */
export function lineGap(a: number, b: number): number {
  const ray = angDist(a, b);
  return Math.min(ray, Math.PI - ray);
}

/** Largest scale that stays inside the linear sRGB cube along `dir`. */
export function maxScale(dir: Vec3, anchor = ANCHOR): number {
  let limit = Infinity;
  const lo = 0.012;
  const hi = 0.96;
  for (let i = 0; i < 3; i++) {
    const d = dir[i];
    if (Math.abs(d) < 1e-8) continue;
    const room = d > 0 ? (hi - anchor) / d : (anchor - lo) / -d;
    limit = Math.min(limit, room);
  }
  return Number.isFinite(limit) ? limit : 0;
}

export function linearToSrgbChannel(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

export function toSrgb8(linear: Vec3): [number, number, number] {
  return linear.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgbChannel(c))) * 255)) as [
    number,
    number,
    number,
  ];
}

export function cssRgb(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

export function hueName(linear: Vec3): string {
  const r = linearToSrgbChannel(linear[0]);
  const g = linearToSrgbChannel(linear[1]);
  const b = linearToSrgbChannel(linear[2]);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.07) return "neutro";
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  if (h < 18 || h >= 345) return "rojizo";
  if (h < 46) return "anaranjado";
  if (h < 70) return "amarillento";
  if (h < 165) return "verdoso";
  if (h < 200) return "cian";
  if (h < 255) return "azulado";
  if (h < 310) return "violáceo";
  return "magenta";
}

export type PriorKey = "l" | "m" | "s" | "control" | "red-end" | "blue-end";

export interface PriorDirection {
  key: PriorKey;
  theta: number;
  dir: Vec3;
  maxS: number;
  hue: string;
  /** Search hint only. Never a diagnosis. */
  searchPrior: string;
}

function priorFromDir(key: PriorKey, dir: Vec3, searchPrior: string): PriorDirection {
  const unit = normalize(dir);
  const theta = thetaOf(unit);
  const aligned = dirFromTheta(theta);
  const opposite: Vec3 = [-aligned[0], -aligned[1], -aligned[2]];
  const maxS = Math.min(maxScale(aligned), maxScale(opposite));
  return {
    key,
    theta,
    dir: aligned,
    maxS,
    hue: hueName(addScaled([ANCHOR, ANCHOR, ANCHOR], aligned, maxS * 0.5)),
    searchPrior,
  };
}

let cachedPriors: PriorDirection[] | null = null;

export function searchPriors(): PriorDirection[] {
  if (cachedPriors) return cachedPriors;
  const l = coneIsolation(0);
  const m = coneIsolation(1);
  const s = coneIsolation(2);
  const seeded = [
    priorFromDir("l", l, "L-cone isolation"),
    priorFromDir("m", m, "M-cone isolation"),
    priorFromDir("s", s, "S-cone isolation"),
  ];
  let bestTheta = 0;
  let bestScore = -1;
  for (let i = 0; i < 720; i++) {
    const theta = (i / 720) * Math.PI * 2 - Math.PI;
    const score = Math.min(...seeded.map((p) => lineGap(theta, p.theta)));
    if (score > bestScore) {
      bestScore = score;
      bestTheta = theta;
    }
  }
  const control = priorFromDir("control", dirFromTheta(bestTheta), "control, off the cone axes");
  cachedPriors = [seeded[2], control, seeded[0], seeded[1]];
  return cachedPriors;
}

/** A = I - alpha * d d^T. alpha 0 leaves color untouched. */
export function attenuationMatrix(dir: Vec3, alpha: number): number[][] {
  const n2 = dot(dir, dir) || 1;
  const a = Math.min(1, Math.max(0, alpha)) / n2;
  const m = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m[i][j] -= a * dir[i] * dir[j];
  }
  return m;
}

export function roundMatrix(m: number[][]): number[][] {
  return m.map((row) => row.map((v) => Math.round(v * 10000) / 10000));
}

export function round3(v: Vec3): Vec3 {
  return v.map((n) => Math.round(n * 10000) / 10000) as Vec3;
}
