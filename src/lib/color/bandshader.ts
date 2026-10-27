/**
 * Asistido por franja en la cámara, píxel a píxel: la Regla B (assistband.ts + extremeColor) escrita en GLSL.
 * Sin LUT 3D: la franja depende del tono, que cambia muy deprisa cerca del gris, y una red 33³/65³ no la resuelve.
 * `bandShaderColor` es la traducción literal del GLSL a TS (misma secuencia de operaciones) para el test de paridad.
 */
import { BAND_GAIN, type AssistBand } from "./assistband";
import { BASIS, Y_COEF, type Vec3 } from "./space";

export const MAX_BANDS = 2;
export const MAX_PTS = 16;
/**
 * Solo cámara (Colorado 27/10): tope del empujón ampliado por el croma del píxel nítido, |d| ≤ CAMERA_PUSH_K · C en el
 * plano sin luminancia. Quita el ruido de sensor casi gris; la vía exacta (láminas, transformadas) no lleva tope.
 */
export const CAMERA_PUSH_K = 2;

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
uniform float uPushK;

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
float bandInW(vec3 rgb) {
  vec3 plane = rgb - dot(rgb, uLumY);
  // 1e-5 y no 1e-7: en float32 de GPU un gris puro 8 bits deja |plane| > 1e-7 (redondeo de toLinear y de uLumY) y caía
  // «dentro» de la franja con tono al azar; el croma no nulo más pequeño en 8 bits está muy por encima de 1e-5.
  if (!(length(plane) > 1e-5) || uBandCount == 0) return 0.0;
  float theta = degrees(atan(dot(plane, uBasisV), dot(plane, uBasisU)));
  float bw = 0.0;
  for (int b = 0; b < MAX_BANDS; b++) {
    if (b >= uBandCount) break;
    float phi = uGeo[b * 7]; float z0 = uGeo[b * 7 + 1]; float z1 = uGeo[b * 7 + 2];
    float lo = uGeo[b * 7 + 3]; float hi = uGeo[b * 7 + 4];
    float x = modp(modp(theta, 180.0) - phi + 90.0, 180.0) - 90.0 + phi;
    if (x <= z0 || x >= z1) continue;
    float w = 1.0;
    if (x < lo) w = ssBand((x - z0) / max(1e-9, lo - z0));
    else if (x > hi) w = 1.0 - ssBand((x - hi) / max(1e-9, z1 - hi));
    bw = max(bw, w);
  }
  return bw;
}
// Empujón ampliado d (ΔB = 0, ΔY_WU = 0) sobre el píxel nítido: 0 fuera de franja, escalado para no salir de la gama
// (misma dirección, así que la luminancia WU y el azul se conservan) y, en Extremo, giro CIELAB ≤ uTurnCap.
vec3 bandApply(vec3 rgb, vec3 d, float mode) {
  if (!(bandInW(rgb) > 0.0)) return rgb;
  float C = length(rgb - dot(rgb, uLumY));
  float dn = length(d - dot(d, uLumY));
  float s = dn > uPushK * C ? uPushK * C / dn : 1.0;
  for (int i = 0; i < 3; i++) {
    if (d[i] > 1e-9) s = min(s, (1.0 - rgb[i]) / d[i]);
    else if (d[i] < -1e-9) s = min(s, rgb[i] / -d[i]);
  }
  s = max(0.0, s);
  if (mode < 2.5 || labTurn(rgb, rgb + d * s) <= uTurnCap) return rgb + d * s;
  float lo2 = 0.0; float hi2 = s;
  for (int i = 0; i < 30; i++) {
    float mid = 0.5 * (lo2 + hi2);
    if (labTurn(rgb, rgb + d * mid) <= uTurnCap) lo2 = mid; else hi2 = mid;
  }
  return rgb + d * lo2;
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

/** Traducción literal de `bandApply` (GLSL) a TS. */
export function bandApplyTs(rgb: Vec3, d: Vec3, u: BandUniforms, mode: 2 | 3, pushK = CAMERA_PUSH_K): Vec3 {
  if (!(bandInWTs(rgb, u) > 0)) return rgb;
  const yc = rgb[0] * u.lumY[0] + rgb[1] * u.lumY[1] + rgb[2] * u.lumY[2];
  const yd = d[0] * u.lumY[0] + d[1] * u.lumY[1] + d[2] * u.lumY[2];
  const C = Math.hypot(rgb[0] - yc, rgb[1] - yc, rgb[2] - yc);
  const dn = Math.hypot(d[0] - yd, d[1] - yd, d[2] - yd);
  let s = dn > pushK * C ? (pushK * C) / dn : 1;
  for (let i = 0; i < 3; i++) {
    if (d[i] > 1e-9) s = Math.min(s, (1 - rgb[i]) / d[i]);
    else if (d[i] < -1e-9) s = Math.min(s, rgb[i] / -d[i]);
  }
  s = Math.max(0, s);
  const at = (m: number): Vec3 => [rgb[0] + d[0] * m, rgb[1] + d[1] * m, rgb[2] + d[2] * m];
  if (mode === 2 || labTurnTs(rgb, at(s)) <= u.turnCapRad) return at(s);
  let lo2 = 0, hi2 = s;
  for (let i = 0; i < 30; i++) {
    const mid = 0.5 * (lo2 + hi2);
    if (labTurnTs(rgb, at(mid)) <= u.turnCapRad) lo2 = mid;
    else hi2 = mid;
  }
  return at(lo2);
}

export function bandInWTs(rgb: Vec3, u: BandUniforms): number {
  const modp = (a: number, m: number) => a - m * Math.floor(a / m);
  const ss = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  const y = rgb[0] * u.lumY[0] + rgb[1] * u.lumY[1] + rgb[2] * u.lumY[2];
  const plane: Vec3 = [rgb[0] - y, rgb[1] - y, rgb[2] - y];
  if (!(Math.hypot(...plane) > 1e-5) || u.count === 0) return 0;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const theta = (Math.atan2(dot(plane, u.basisV), dot(plane, u.basisU)) * 180) / Math.PI;
  let bw = 0;
  for (let b = 0; b < u.count; b++) {
    const [phi, z0, z1, lo, hi] = u.geo.slice(b * 7, b * 7 + 5);
    const x = modp(modp(theta, 180) - phi + 90, 180) - 90 + phi;
    if (x <= z0 || x >= z1) continue;
    let w = 1;
    if (x < lo) w = ss((x - z0) / Math.max(1e-9, lo - z0));
    else if (x > hi) w = 1 - ss((x - hi) / Math.max(1e-9, z1 - hi));
    bw = Math.max(bw, w);
  }
  return bw;
}

function labTurnTs(a: Vec3, b: Vec3): number {
  const labOf = (c: Vec3): Vec3 => {
    const X = 0.4124564 * c[0] + 0.3575761 * c[1] + 0.1804375 * c[2];
    const Y = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
    const Z = 0.0193339 * c[0] + 0.119192 * c[1] + 0.9503041 * c[2];
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const la = labOf(a), lb = labOf(b);
  if (Math.hypot(la[1], la[2]) < 1 || Math.hypot(lb[1], lb[2]) < 1) return 0;
  const d = Math.atan2(lb[2], lb[1]) - Math.atan2(la[2], la[1]);
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

/** Pase 1 por píxel: empujón de la Regla B con el tope de cámara |d| ≤ pushK · C (plano sin luminancia). */
export function cameraPush(c: Vec3, u: BandUniforms, mode: 2 | 3, pushK = CAMERA_PUSH_K): Vec3 {
  const o = bandShaderColor(c, u, mode);
  const d: Vec3 = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const yd = d[0] * u.lumY[0] + d[1] * u.lumY[1] + d[2] * u.lumY[2];
  const yc = c[0] * u.lumY[0] + c[1] * u.lumY[1] + c[2] * u.lumY[2];
  const dn = Math.hypot(d[0] - yd, d[1] - yd, d[2] - yd);
  const lim = pushK * Math.hypot(c[0] - yc, c[1] - yc, c[2] - yc);
  return dn > lim ? [d[0] * (lim / dn), d[1] * (lim / dn), d[2] * (lim / dn)] : d;
}

/**
 * Cámara en dos pases, lo mismo que hace la GPU (referencia de CPU y fallback 2D):
 * 1. Empujón por píxel con la Regla B sobre la imagen nítida (sin suavizar antes), d = bandColor(c) − c, con el tope
 *    |d| ≤ CAMERA_PUSH_K · C de ese píxel (cameraPush), y media de los cuatro empujones de cada bloque 2×2 → campo a un cuarto de resolución (mitad por lado).
 * 2. Ese campo se amplía con filtrado bilineal (como `texture()` con LINEAR y CLAMP_TO_EDGE) y se suma al píxel nítido
 *    con `bandApply` (0 fuera de franja, tope |d| ≤ CAMERA_PUSH_K · C, gama, giro ≤ 60° en Extremo).
 * `lin`: RGB lineal intercalado (3 por píxel), filas de arriba abajo. Devuelve el mismo formato.
 */
export function cameraFrame(lin: Float32Array, w: number, h: number, u: BandUniforms, mode: 2 | 3, push?: (c: Vec3) => Vec3, pushK = CAMERA_PUSH_K): Float32Array {
  const pushOf = push ?? ((c: Vec3) => cameraPush(c, u, mode, pushK));
  const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
  const field = new Float32Array(hw * hh * 3);
  for (let j = 0; j < hh; j++) for (let i = 0; i < hw; i++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = Math.min(w - 1, 2 * i + dx), y = Math.min(h - 1, 2 * j + dy), o = (y * w + x) * 3;
      const d = pushOf([lin[o], lin[o + 1], lin[o + 2]]);
      r += d[0]; g += d[1]; b += d[2];
    }
    const o = (j * hw + i) * 3;
    field[o] = r / 4; field[o + 1] = g / 4; field[o + 2] = b / 4;
  }
  const out = new Float32Array(lin.length);
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) / h) * hh - 0.5, y0 = Math.floor(fy), ty = fy - y0;
    const ya = Math.min(hh - 1, Math.max(0, y0)), yb = Math.min(hh - 1, Math.max(0, y0 + 1));
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) / w) * hw - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      const xa = Math.min(hw - 1, Math.max(0, x0)), xb = Math.min(hw - 1, Math.max(0, x0 + 1));
      const d: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const a = field[(ya * hw + xa) * 3 + k] * (1 - tx) + field[(ya * hw + xb) * 3 + k] * tx;
        const b = field[(yb * hw + xa) * 3 + k] * (1 - tx) + field[(yb * hw + xb) * 3 + k] * tx;
        d[k] = a * (1 - ty) + b * ty;
      }
      const o = (y * w + x) * 3;
      const c = bandApplyTs([lin[o], lin[o + 1], lin[o + 2]], d, u, mode, pushK);
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    }
  }
  return out;
}
