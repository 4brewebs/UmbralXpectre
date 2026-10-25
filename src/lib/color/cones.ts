/**
 * Modelo de conos y predicción de pesos de luminancia (fase 1 del plan de luminancia).
 *
 * - LMS de Smith-Pokorny a partir de XYZ 1931 (L + M = Y), primarios sRGB nominales.
 * - Cono anómalo como Machado 2009: severity 0..1 desplaza el pico del cono afectado.
 *   severity 1 = dicromacia: desplazamiento completo L→M (protán) o M→L (deután), que con
 *   los picos de esta plantilla (559/530 nm, como Smith-Pokorny) son 29 nm, no 20 nm.
 *   Por qué no 20 nm literales: Machado usa 20 nm como desplazamiento máximo de *su* modelo
 *   y trata severity 1 como dicromacia; aplicar 20 nm aquí deja L y M a 9 nm y el rojo de un
 *   protán severo saldría a ~0.65× en vez de ~0.46× (dicromático). Se reescala a la separación.
 *   (protán: L hacia M; deután: M hacia L). Tritán: S escalado (no entra en la luminancia).
 * - El desplazamiento se calcula con la plantilla de fotopigmento de Govardovskii (2000)
 *   y se proyecta por mínimos cuadrados sobre L y M de Smith-Pokorny.
 *
 * La `severity` de esta función es la de Machado. NO es `profile.fit.severity` (otra escala):
 * la predicción solo es el punto de partida de la prueba de movimiento.
 */
import { luminance, Y_COEF, type Vec3 } from "./space";
import type { UmbralProfile } from "./profile";

export type DeficiencyType = "protan" | "deutan" | "tritan";
export type ObserverType = DeficiencyType | "normal" | "unknown";

/** sRGB lineal → XYZ (D65), columnas = primarios. */
const RGB_TO_XYZ: number[][] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

/** Smith-Pokorny (sobre XYZ 1931): L + M = Y. */
const XYZ_TO_SP: number[][] = [
  [0.15514, 0.54312, -0.03286],
  [-0.15514, 0.45684, 0.03286],
  [0, 0, 0.00801],
];

/** Picos de fotopigmento aproximados (nm). */
const PEAK = { l: 559, m: 530 } as const;
/** Machado 2009: severity 1 ⇒ 20 nm. */
export const NM_PER_SEVERITY = 20;

/** Plantilla A1 de Govardovskii et al. (2000), banda alfa, pico = 1. */
export function pigment(lambda: number, peak: number): number {
  const x = peak / lambda;
  const a = 0.8795 + 0.0459 * Math.exp(-((peak - 300) ** 2) / 11940);
  return 1 / (Math.exp(69.7 * (a - x)) + Math.exp(28 * (0.922 - x)) + Math.exp(-14.9 * (1.104 - x)) + 0.674);
}

/**
 * APROXIMACIÓN: MacLeod-Boynton l = L/(L+M) ≈ 0.64 a 555 nm en Smith-Pokorny (valor redondeado,
 * no tabulado aquí). Fija la altura relativa de L y M en unidades de plantilla; afecta a los
 * pesos predichos de observadores anómalos (no al normal ni al dicromático extremo).
 */
const MB_L_555 = 0.64;
const LAMBDAS = Array.from({ length: 61 }, (_, i) => 400 + i * 5);

/** Mínimos cuadrados 2×2: target ≈ a·f + b·g sobre LAMBDAS. */
function fit2(target: (l: number) => number, f: (l: number) => number, g: (l: number) => number): [number, number] {
  let ff = 0;
  let fg = 0;
  let gg = 0;
  let ft = 0;
  let gt = 0;
  for (const l of LAMBDAS) {
    const fv = f(l);
    const gv = g(l);
    const tv = target(l);
    ff += fv * fv;
    fg += fv * gv;
    gg += gv * gv;
    ft += fv * tv;
    gt += gv * tv;
  }
  const det = ff * gg - fg * fg;
  return [(ft * gg - gt * fg) / det, (gt * ff - ft * fg) / det];
}

/** Alturas de L y M de Smith-Pokorny en unidades de plantilla (solo importa la razón). */
const K_L = 1;
const K_M = (pigment(555, PEAK.l) * (1 - MB_L_555)) / (MB_L_555 * pigment(555, PEAK.m));

/**
 * Cono desplazado expresado en L y M de Smith-Pokorny: devuelve [cL, cM] tales que
 * el cono anómalo ≈ cL·L + cM·M. Normal: L → [1, 0], M → [0, 1].
 */
export function shiftedCone(type: DeficiencyType, severity: number): { cone: "l" | "m" | "s"; coef: [number, number] } {
  const sev = Math.max(0, Math.min(1, severity));
  if (type === "tritan") return { cone: "s", coef: [0, 0] };
  const isL = type === "protan";
  const from = isL ? PEAK.l : PEAK.m;
  // Machado: 20 nm a severity 1 es dicromacia (el cono cae sobre el otro). Con los picos de
  // la plantilla (559/530) la separación es de 29 nm, así que se reescala a esa separación.
  const gap = PEAK.l - PEAK.m;
  const shift = sev * gap;
  const to = isL ? from - shift : from + shift;
  const height = isL ? K_L : K_M;
  const [a, b] = fit2((l) => height * pigment(l, to), (l) => K_L * pigment(l, PEAK.l), (l) => K_M * pigment(l, PEAK.m));
  return { cone: isL ? "l" : "m", coef: [a, b] };
}

function mul(m: number[][], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** LMS (Smith-Pokorny) de un color sRGB lineal. */
export function lmsOf(rgb: Vec3): Vec3 {
  return mul(XYZ_TO_SP, mul(RGB_TO_XYZ, rgb));
}

/**
 * Pesos de luminancia predichos {wR,wG,wB}, normalizados a suma 1.
 * V′ = L′ + M (protán), L + M′ (deután), L + M (normal/tritán: S no entra).
 */
export function predictedLumWeights(type: ObserverType, severity = 1): Vec3 {
  let cL = 1;
  let cM = 1;
  if (type === "protan") {
    const [a, b] = shiftedCone("protan", severity).coef;
    cL = a;
    cM = 1 + b;
  } else if (type === "deutan") {
    const [a, b] = shiftedCone("deutan", severity).coef;
    cL = 1 + a;
    cM = b;
  }
  if (type !== "protan" && type !== "deutan") {
    const s = Y_COEF[0] + Y_COEF[1] + Y_COEF[2];
    return [Y_COEF[0] / s, Y_COEF[1] / s, Y_COEF[2] / s];
  }
  const prim: Vec3 = [0, 1, 2].map((i) => {
    const e: Vec3 = [0, 0, 0];
    e[i] = 1;
    const [l, m] = lmsOf(e);
    return Math.max(0, cL * l + cM * m);
  }) as Vec3;
  const sum = prim[0] + prim[1] + prim[2];
  return [prim[0] / sum, prim[1] / sum, prim[2] / sum];
}

/**
 * Brillo relativo del test frente a la referencia para pesos `w`, cuando ambos
 * tienen la misma Y estándar: (Y_w(test)/Y(test)) / (Y_w(ref)/Y(ref)).
 * < 1: el test se ve más oscuro de lo que dice Y. La ganancia que lo iguala es 1/valor
 * (= Y_w(ref)/Y_w(test) con Y estándar igualada).
 */
export function predictedMatch(test: Vec3, ref: Vec3, w: Vec3): number {
  const yt = luminance(test);
  const yr = luminance(ref);
  const wt = luminance(test, w);
  const wr = luminance(ref, w);
  if (yt <= 0 || yr <= 0 || wr <= 0) return 1;
  return wt / yt / (wr / yr);
}

/** Ganancia sobre el test (en Y estándar) que lo iguala en brillo a la referencia. */
export function predictedGain(test: Vec3, ref: Vec3, w: Vec3): number {
  return 1 / predictedMatch(test, ref, w);
}

/** Tipo probable a partir del perfil. Ambiguo ⇒ "unknown" (rango ancho en la prueba). */
export function typeFromProfile(profile: Pick<UmbralProfile, "fit">): ObserverType {
  const pathways = profile.fit?.pathways ?? [];
  const elevated = pathways.filter((p) => p.elevated && !p.sameLineAs).map((p) => p.id);
  if ((profile.fit?.elevatedCount ?? elevated.length) === 0 || elevated.length === 0) return "normal";
  if (elevated.length > 1) {
    const prior = profile.fit?.nearestSearchPrior ?? "";
    if (/^L/i.test(prior)) return "protan";
    if (/^M/i.test(prior)) return "deutan";
    if (/^S/i.test(prior)) return "tritan";
    return "unknown";
  }
  return elevated[0] === "l" ? "protan" : elevated[0] === "m" ? "deutan" : elevated[0] === "s" ? "tritan" : "unknown";
}
