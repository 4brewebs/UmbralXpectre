/**
 * Asistido por franja (Regla B «Forja», validada a ciegas por Lucas 8/8 el 27/10). TypeScript puro.
 *
 * Por cada vía elevada (de momento solo `l`) se calcula al cargar, sin escribir nada en el JSON (esquema v3 igual):
 * - el eje como línea (θ mod 180, plegado al lado del rojo);
 * - T(θ): log T interpolado linealmente en θ entre los ejes medidos que caen entre los dos vecinos `refine`;
 * - núcleo (w = 1): la banda de bordes (`confirmed`) si el archivo es de esa vía y los dos lados se encontraron; si no,
 *   donde log(T/T_control) ≥ ½·log(T_eje/T_control);
 * - caída smoothstep del núcleo a los vecinos medidos y w = 0 más allá, aunque T siga alto.
 * El desplazamiento (`bandShift`) va solo en R y G: lado rojizo +R−G, verdoso −R+G, ΔG = −ΔR·W_R/W_G con los pesos de
 * luminancia del usuario (su luminancia queda igual), azul fijo y recorte de gama por píxel a lo largo de esa dirección.
 * Referencia: /workspace/parity/general/reglaB.py y filtro_general.py (line_phi, apply_delta, thetav, ss).
 */
import { killLuminance, norm, thetaOf, Y_COEF, type Vec3 } from "./space";

/** Vías con asistido por franja. Las demás vías elevadas (p. ej. `m`) aún no se corrigen. */
export const ASSIST_VIAS: readonly string[] = ["l"];
/** Fuerza de Asistencia y de Extremo (|ΔR| = g · w · T(θ)). */
export const BAND_GAIN = { assist: 6, extreme: 12 };

type AxisLike = { id: string; role?: string | null; parentId?: string | null; angleDeg: number; threshold: number | null };
export type BandProfile = {
  axes: AxisLike[];
  fit: { pathways: Array<{ id: string; elevated: boolean }> };
  luminance?: { weights?: Vec3 | number[] } | null;
};
type SideLike = { found: boolean };
export type BandEdges = { cone: string; minus: SideLike; plus: SideLike; confirmed: { minus: number | null; plus: number | null } };

export type AssistBand = {
  via: string;
  /** Eje como línea (grados, θ plegado al semiplano del rojo). */
  phi: number;
  /** Vecinos medidos: w = 0 fuera de [z0, z1]. */
  z0: number;
  z1: number;
  /** Núcleo con w = 1. */
  lo: number;
  hi: number;
  core: "bordes" | "logd";
  /** Puntos (ángulo de línea, log T) dentro de [z0, z1], ordenados. */
  px: number[];
  py: number[];
  /** Umbral del control (axes[role=control].threshold). */
  tControl: number;
  /** Pesos de luminancia del usuario (profile.luminance.weights). */
  weights: Vec3;
  /** Vértice de la parábola en log T con el eje y sus vecinos (grados). */
  confusionDeg: number;
};

const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const mod = (a: number, m: number) => ((a % m) + m) % m;
/** Ángulo de un eje como línea: plegado al semiplano donde está el rojo (+u). */
export function linePhi(deg: number): number {
  const a = wrap(deg);
  return Math.cos((a * Math.PI) / 180) >= 0 ? a : wrap(a + 180);
}
/** Lleva θ (grados) a la línea, en (φ − 90, φ + 90]. */
const fold = (t: number, phi: number) => mod(mod(t, 180) - phi + 90, 180) - 90 + phi;
const ss = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let i = 0;
  while (x > xs[i + 1]) i++;
  return ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
}

/** Mínimos cuadrados de grado 2; vértice si abre hacia abajo. */
function parabolaVertex(xs: number[], ys: number[]): number | null {
  const S = [0, 0, 0, 0, 0];
  const R = [0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    for (let p = 0; p < 5; p++) S[p] += xs[i] ** p;
    for (let p = 0; p < 3; p++) R[p] += ys[i] * xs[i] ** p;
  }
  // [S4 S3 S2; S3 S2 S1; S2 S1 S0] · [A B C] = [R2 R1 R0]
  const M = [
    [S[4], S[3], S[2], R[2]],
    [S[3], S[2], S[1], R[1]],
    [S[2], S[1], S[0], R[0]],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const A = M[0][3] / M[0][0];
  const B = M[1][3] / M[1][1];
  return A < 0 ? -B / (2 * A) : null;
}

function confusionAngle(axes: AxisLike[], e: AxisLike): number {
  let nb = axes.filter((a) => a.parentId === e.id);
  if (nb.length < 2) {
    nb = axes
      .filter((a) => a !== e && a.role !== "red-end" && a.role !== "blue-end")
      .sort((a, b) => Math.abs(wrap(a.angleDeg - e.angleDeg)) - Math.abs(wrap(b.angleDeg - e.angleDeg)))
      .slice(0, 2);
  }
  const pts = [...nb, e]
    .filter((a) => a.threshold != null && a.threshold > 0)
    .map((a) => [e.angleDeg + wrap(a.angleDeg - e.angleDeg), Math.log(a.threshold as number)])
    .sort((p, q) => p[0] - q[0]);
  const v = pts.length >= 3 ? parabolaVertex(pts.map((p) => p[0]), pts.map((p) => p[1])) : null;
  return v ?? e.angleDeg;
}

/** T(θ) de la franja (θ en grados de línea, ya plegado). */
export function bandT(band: AssistBand, x: number): number {
  return Math.exp(interp(Math.min(band.z1, Math.max(band.z0, x)), band.px, band.py));
}

/**
 * Franjas del perfil, calculadas al cargar. `edges`: los archivos de bordes (se usa el de la misma vía, si lo hay).
 * Perfil sin vía elevada (de las de `vias`) ⇒ lista vacía ⇒ identidad.
 */
export function bandFromProfile(profile: BandProfile, edges: BandEdges | BandEdges[] | null = null, vias: readonly string[] = ASSIST_VIAS): AssistBand[] {
  const files = edges == null ? [] : Array.isArray(edges) ? edges : [edges];
  const control = profile.axes.find((a) => a.role === "control");
  const tControl = control?.threshold;
  if (!tControl || !(tControl > 0)) return [];
  const w = profile.luminance?.weights;
  const weights: Vec3 = w && w.length === 3 ? [Number(w[0]), Number(w[1]), Number(w[2])] : [...Y_COEF];
  const bands: AssistBand[] = [];
  for (const via of vias) {
    if (!profile.fit.pathways.some((p) => p.id === via && p.elevated)) continue;
    const e = profile.axes.find((a) => a.id === via);
    if (!e || !e.threshold || !(e.threshold > 0)) continue;
    const phi = linePhi(e.angleDeg);
    const onLine = (deg: number) => phi + (mod(deg - phi + 90, 180) - 90);
    const nb = profile.axes.filter((a) => a.parentId === via).map((a) => onLine(a.angleDeg)).sort((a, b) => a - b);
    const [z0, z1] = nb.length >= 2 ? [nb[0], nb[nb.length - 1]] : [phi - 20, phi + 20];
    const byAngle = new Map<number, number>();
    for (const a of profile.axes) {
      if (!a.threshold || a.role === "control") continue;
      byAngle.set(Math.round(onLine(a.angleDeg) * 1e6) / 1e6, a.threshold);
    }
    const pts = [...byAngle.entries()].filter(([x]) => x >= z0 - 1e-9 && x <= z1 + 1e-9).sort((p, q) => p[0] - q[0]);
    const px = pts.length ? pts.map((p) => p[0]) : [phi];
    const py = pts.length ? pts.map((p) => Math.log(p[1])) : [Math.log(e.threshold)];
    const band: AssistBand = { via, phi, z0, z1, lo: phi, hi: phi, core: "logd", px, py, tControl, weights, confusionDeg: confusionAngle(profile.axes, e) };
    const file = files.find((f) => f.cone === via);
    if (file && file.minus.found && file.plus.found && file.confirmed.minus != null && file.confirmed.plus != null) {
      band.lo = fold(file.confirmed.minus, phi);
      band.hi = fold(file.confirmed.plus, phi);
      band.core = "bordes";
    } else {
      const half = Math.log(e.threshold / tControl) / 2;
      const n = Math.ceil((z1 - z0) / 0.01 - 1e-9);
      const g = (i: number) => z0 + i * 0.01;
      const ok = (i: number) => Math.log(bandT(band, g(i)) / tControl) >= half;
      let i0 = 0;
      for (let i = 1; i < n; i++) if (Math.abs(g(i) - phi) < Math.abs(g(i0) - phi)) i0 = i;
      let a = i0;
      let b = i0;
      while (a > 0 && ok(a - 1)) a--;
      while (b < n - 1 && ok(b + 1)) b++;
      band.lo = g(a);
      band.hi = g(b);
    }
    bands.push(band);
  }
  return bands;
}

/** Peso w ∈ [0, 1] y T de la franja para un θ (grados, sin plegar). */
export function bandWeight(band: AssistBand, thetaDeg: number): { w: number; T: number; x: number } {
  const x = fold(thetaDeg, band.phi);
  const T = bandT(band, x);
  if (x <= band.z0 || x >= band.z1) return { w: 0, T, x };
  let w = 1;
  if (x < band.lo) w = ss((x - band.z0) / Math.max(1e-9, band.lo - band.z0));
  else if (x > band.hi) w = 1 - ss((x - band.hi) / Math.max(1e-9, band.z1 - band.hi));
  return { w, T, x };
}

export type BandStep = {
  band: AssistBand;
  /** +1 lado rojizo (+R−G), −1 verdoso. */
  sign: number;
  w: number;
  T: number;
  /** ΔG/ΔR = −W_R/W_G. */
  k: number;
  /** Máximo |ΔR| dentro de la gama en esa dirección. */
  cap: number;
};

/** Dónde cae el color en las franjas (la de mayor w). null fuera de toda franja o casi gris. */
export function bandStep(rgb: Vec3, bands: AssistBand[]): BandStep | null {
  if (!bands.length) return null;
  const plane = killLuminance(rgb);
  if (!(norm(plane) > 1e-7)) return null;
  const theta = (thetaOf(plane) * 180) / Math.PI;
  let best: BandStep | null = null;
  for (const band of bands) {
    const { w, T } = bandWeight(band, theta);
    if (!(w > 0) || (best && best.w >= w)) continue;
    const sign = Math.cos(((theta - band.phi) * Math.PI) / 180) >= 0 ? 1 : -1;
    const k = band.weights[0] / band.weights[1];
    const cap = Math.max(0, sign > 0 ? Math.min(1 - rgb[0], rgb[1] / k) : Math.min(rgb[0], (1 - rgb[1]) / k));
    best = { band, sign, w, T, k, cap };
  }
  return best;
}

/** Mueve el color |ΔR| = amount a lo largo de la dirección del paso (azul y luminancia del usuario iguales). */
export function moveAlong(rgb: Vec3, step: BandStep, amount: number): Vec3 {
  const m = Math.max(0, Math.min(amount, step.cap));
  return [rgb[0] + step.sign * m, rgb[1] - step.sign * m * step.k, rgb[2]];
}

/** Asistido por franja (vía exacta, la de las láminas 5g): |ΔR| = g · w · T(θ), recortado a la gama en su dirección. */
export function bandShift(rgb: Vec3, bands: AssistBand[], g: number): Vec3 {
  const step = bandStep(rgb, bands);
  if (!step) return rgb;
  return moveAlong(rgb, step, g * step.w * step.T);
}
