/**
 * Asistido por franja en la cámara, píxel a píxel: la Regla B (assistband.ts + extremeColor) escrita en GLSL.
 * Sin LUT 3D: la franja depende del tono, que cambia muy deprisa cerca del gris, y una red 33³/65³ no la resuelve.
 * `bandShaderColor` es la traducción literal del GLSL a TS (misma secuencia de operaciones) para el test de paridad.
 */
import { BAND_GAIN, type AssistBand } from "./assistband";
import { BASIS, Y_COEF, type Vec3 } from "./space";

export const MAX_BANDS = 2;
export const MAX_PTS = 16;

/** Uniforms del shader para unas franjas. Franjas de más o puntos de más se ignoran (hoy: 1 franja, 5 puntos). */
export type BandUniforms = {
  count: number;
  /** Por franja: [phi, z0, z1, lo, hi, npts, k] */
  geo: number[];
  /** Por franja: MAX_PTS ángulos y MAX_PTS log T. */
  px: number[];
  py: number[];
  basisU: Vec3;
  basisV: Vec3;
  lumY: Vec3;
  gain: { assist: number; extreme: number };
  turnCapRad: number;
};

export function bandUniforms(bands: AssistBand[], extremeTurnDeg: number): BandUniforms {
  const use = bands.slice(0, MAX_BANDS);
  const geo: number[] = [], px: number[] = [], py: number[] = [];
  for (let i = 0; i < MAX_BANDS; i++) {
    const b = use[i];
    const n = b ? Math.min(MAX_PTS, b.px.length) : 0;
    geo.push(b?.phi ?? 0, b?.z0 ?? 0, b?.z1 ?? 0, b?.lo ?? 0, b?.hi ?? 0, n, b ? b.weights[0] / b.weights[1] : 0);
    for (let j = 0; j < MAX_PTS; j++) {
      px.push(b && j < n ? b.px[j] : 0);
      py.push(b && j < n ? b.py[j] : 0);
    }
  }
  return {
    count: use.length,
    geo,
    px,
    py,
    basisU: [...BASIS.u] as Vec3,
    basisV: [...BASIS.v] as Vec3,
    lumY: [...Y_COEF] as Vec3,
    gain: { ...BAND_GAIN },
    turnCapRad: (extremeTurnDeg * Math.PI) / 180,
  };
}

/** Funciones GLSL; uMode: 2 Asistencia, 3 Extremo. Entrada y salida en sRGB lineal. */
export const BAND_GLSL = `
#define MAX_BANDS ${MAX_BANDS}
#define MAX_PTS ${MAX_PTS}
uniform int uBandCount;
uniform float uGeo[MAX_BANDS * 7];
uniform float uPx[MAX_BANDS * MAX_PTS];
uniform float uPy[MAX_BANDS * MAX_PTS];
uniform vec3 uBasisU;
uniform vec3 uBasisV;
uniform vec3 uLumY;
uniform vec2 uGain;
uniform float uTurnCap;

float modp(float a, float m) { return a - m * floor(a / m); }
float ssBand(float x) { float c = clamp(x, 0.0, 1.0); return c * c * (3.0 - 2.0 * c); }
float bandT(int b, float x) {
  int n = int(uGeo[b * 7 + 5]);
  float z0 = uGeo[b * 7 + 1];
  float z1 = uGeo[b * 7 + 2];
  float xc = min(z1, max(z0, x));
  int o = b * MAX_PTS;
  float y = uPy[o];
  if (xc > uPx[o]) {
    y = uPy[o + n - 1];
    for (int i = 0; i < MAX_PTS - 1; i++) {
      if (i + 1 >= n) break;
      float a = uPx[o + i];
      float c = uPx[o + i + 1];
      if (xc <= c) { y = uPy[o + i] + (uPy[o + i + 1] - uPy[o + i]) * (xc - a) / (c - a); break; }
    }
  }
  return exp(y);
}
vec3 labOf(vec3 c) {
  float X = 0.4124564 * c.r + 0.3575761 * c.g + 0.1804375 * c.b;
  float Y = 0.2126729 * c.r + 0.7151522 * c.g + 0.072175 * c.b;
  float Z = 0.0193339 * c.r + 0.119192 * c.g + 0.9503041 * c.b;
  vec3 t = vec3(X / 0.95047, Y, Z / 1.08883);
  vec3 f = mix((24389.0 / 27.0 * t + 16.0) / 116.0, pow(max(t, vec3(0.0)), vec3(1.0 / 3.0)), step(vec3(216.0 / 24389.0), t));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
float labTurn(vec3 a, vec3 b) {
  vec3 la = labOf(a);
  vec3 lb = labOf(b);
  if (length(la.yz) < 1.0 || length(lb.yz) < 1.0) return 0.0;
  float d = atan(lb.z, lb.y) - atan(la.z, la.y);
  return abs(atan(sin(d), cos(d)));
}
vec3 bandColor(vec3 rgb, float mode) {
  vec3 plane = rgb - dot(rgb, uLumY);
  float C = length(plane);
  if (!(C > 1e-7) || uBandCount == 0) return rgb;
  float theta = degrees(atan(dot(plane, uBasisV), dot(plane, uBasisU)));
  float bw = 0.0; float bT = 0.0; float bSign = 0.0; float bK = 0.0;
  for (int b = 0; b < MAX_BANDS; b++) {
    if (b >= uBandCount) break;
    float phi = uGeo[b * 7]; float z0 = uGeo[b * 7 + 1]; float z1 = uGeo[b * 7 + 2];
    float lo = uGeo[b * 7 + 3]; float hi = uGeo[b * 7 + 4];
    float x = modp(modp(theta, 180.0) - phi + 90.0, 180.0) - 90.0 + phi;
    if (x <= z0 || x >= z1) continue;
    float w = 1.0;
    if (x < lo) w = ssBand((x - z0) / max(1e-9, lo - z0));
    else if (x > hi) w = 1.0 - ssBand((x - hi) / max(1e-9, z1 - hi));
    if (!(w > 0.0) || w <= bw) continue;
    bw = w; bT = bandT(b, x); bK = uGeo[b * 7 + 6];
    bSign = cos(radians(theta - phi)) >= 0.0 ? 1.0 : -1.0;
  }
  if (bw <= 0.0) return rgb;
  float cap = max(0.0, bSign > 0.0 ? min(1.0 - rgb.r, rgb.g / bK) : min(rgb.r, (1.0 - rgb.g) / bK));
  vec3 dir = vec3(bSign, -bSign * bK, 0.0);
  if (mode < 2.5) return rgb + dir * clamp(uGain.x * bw * bT, 0.0, cap);
  float base = min(cap, uGain.y * bw * bT);
  float full = base + bw * (cap - base);
  vec3 outc = rgb + dir * clamp(full, 0.0, cap);
  if (labTurn(rgb, outc) <= uTurnCap) return outc;
  float lo2 = 0.0; float hi2 = full;
  for (int i = 0; i < 30; i++) {
    float mid = 0.5 * (lo2 + hi2);
    if (labTurn(rgb, rgb + dir * clamp(mid, 0.0, cap)) <= uTurnCap) lo2 = mid; else hi2 = mid;
  }
  return rgb + dir * clamp(lo2, 0.0, cap);
}
`;

/** Traducción literal de `bandColor` (GLSL) a TS. `mode`: 2 Asistencia, 3 Extremo. */
export function bandShaderColor(rgb: Vec3, u: BandUniforms, mode: 2 | 3): Vec3 {
  const modp = (a: number, m: number) => a - m * Math.floor(a / m);
  const ss = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  const T = (b: number, x: number) => {
    const n = u.geo[b * 7 + 5], z0 = u.geo[b * 7 + 1], z1 = u.geo[b * 7 + 2], o = b * MAX_PTS;
    const xc = Math.min(z1, Math.max(z0, x));
    let y = u.py[o];
    if (xc > u.px[o]) {
      y = u.py[o + n - 1];
      for (let i = 0; i + 1 < n; i++) {
        const a = u.px[o + i], c = u.px[o + i + 1];
        if (xc <= c) { y = u.py[o + i] + ((u.py[o + i + 1] - u.py[o + i]) * (xc - a)) / (c - a); break; }
      }
    }
    return Math.exp(y);
  };
  const labOf = (c: Vec3): Vec3 => {
    const X = 0.4124564 * c[0] + 0.3575761 * c[1] + 0.1804375 * c[2];
    const Y = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
    const Z = 0.0193339 * c[0] + 0.119192 * c[1] + 0.9503041 * c[2];
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const turn = (a: Vec3, b: Vec3) => {
    const la = labOf(a), lb = labOf(b);
    if (Math.hypot(la[1], la[2]) < 1 || Math.hypot(lb[1], lb[2]) < 1) return 0;
    const d = Math.atan2(lb[2], lb[1]) - Math.atan2(la[2], la[1]);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  };
  const y = rgb[0] * u.lumY[0] + rgb[1] * u.lumY[1] + rgb[2] * u.lumY[2];
  const plane: Vec3 = [rgb[0] - y, rgb[1] - y, rgb[2] - y];
  const C = Math.hypot(...plane);
  if (!(C > 1e-7) || u.count === 0) return rgb;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const theta = (Math.atan2(dot(plane, u.basisV), dot(plane, u.basisU)) * 180) / Math.PI;
  let bw = 0, bT = 0, bSign = 0, bK = 0;
  for (let b = 0; b < u.count; b++) {
    const [phi, z0, z1, lo, hi] = u.geo.slice(b * 7, b * 7 + 5);
    const x = modp(modp(theta, 180) - phi + 90, 180) - 90 + phi;
    if (x <= z0 || x >= z1) continue;
    let w = 1;
    if (x < lo) w = ss((x - z0) / Math.max(1e-9, lo - z0));
    else if (x > hi) w = 1 - ss((x - hi) / Math.max(1e-9, z1 - hi));
    if (!(w > 0) || w <= bw) continue;
    bw = w; bT = T(b, x); bK = u.geo[b * 7 + 6];
    bSign = Math.cos(((theta - phi) * Math.PI) / 180) >= 0 ? 1 : -1;
  }
  if (bw <= 0) return rgb;
  const cap = Math.max(0, bSign > 0 ? Math.min(1 - rgb[0], rgb[1] / bK) : Math.min(rgb[0], (1 - rgb[1]) / bK));
  const along = (m: number): Vec3 => { const a = Math.min(cap, Math.max(0, m)); return [rgb[0] + bSign * a, rgb[1] - bSign * bK * a, rgb[2]]; };
  if (mode === 2) return along(u.gain.assist * bw * bT);
  const base = Math.min(cap, u.gain.extreme * bw * bT);
  const full = base + bw * (cap - base);
  if (turn(rgb, along(full)) <= u.turnCapRad) return along(full);
  let lo2 = 0, hi2 = full;
  for (let i = 0; i < 30; i++) {
    const mid = 0.5 * (lo2 + hi2);
    if (turn(rgb, along(mid)) <= u.turnCapRad) lo2 = mid;
    else hi2 = mid;
  }
  return along(lo2);
}
