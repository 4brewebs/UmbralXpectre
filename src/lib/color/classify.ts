/**
 * Clasificación orientativa por ejes (Colorado, 26/10). No es un diagnóstico: solo cambia textos y prioridades;
 * la corrección sigue saliendo de los ejes medidos.
 * - «Eje rojo–verde» = l y m (el peor de los dos); «Eje azul–amarillo» = s y blue-end. El JSON conserva l y m.
 * - Tipo rojo–verde por la eficiencia luminosa del rojo (#FF0000): < 0,85 con IC superior < 0,90 → protán;
 *   ≥ 0,90 con IC inferior > 0,85 → deután; si no, o sin prueba de luminancia → sin determinar.
 * - Bordes, si los hay: el centro de la banda cerrada frente a las líneas copuntuales de Smith–Pokorny en el plano
 *   isoluminante de la app; desempatan o confirman. Contradicción fuera del margen → sin determinar. Nunca se fuerza.
 */
import { lineGap, thetaOf, type Vec3 } from "./space";
import type { EdgeFile } from "./edges";
import type { UmbralProfile } from "./profile";

export type AxisGroupId = "red-green" | "blue-yellow";
export type AxisGroup = { id: AxisGroupId; name: string; worst: number | null; ratio: number | null; elevated: boolean; members: string[] };
export type Compatible = "none" | "protan" | "deutan" | "tritan" | "red-green-undetermined" | "mixed";
export type Classification = {
  groups: AxisGroup[];
  compatible: Compatible;
  /** Tipo rojo–verde cuando hay fallo mixto (si se pudo determinar). */
  redGreenType: "protan" | "deutan" | null;
  luminance: { efficiency: number; lo: number; hi: number } | null;
  edgeHint: { type: "protan" | "deutan" | null; centerDeg: number; marginDeg: number } | null;
  reason: string;
  text: string;
  disclaimer: string;
};

export const CLASSIFY = { gate: 1.6, protanBelow: 0.85, protanCiHi: 0.9, deutanAtLeast: 0.9, deutanCiLo: 0.85, edgeMarginDeg: 3 };
export const DISCLAIMER = "Orientativo: describe lo medido en esta pantalla y no es un diagnóstico.";

const GROUPS: Array<{ id: AxisGroupId; name: string; roles: string[] }> = [
  { id: "red-green", name: "Eje rojo–verde", roles: ["l", "m"] },
  { id: "blue-yellow", name: "Eje azul–amarillo", roles: ["s", "blue-end"] },
];

/** Puntos copuntuales de Smith & Pokorny (CIE 1931 xy). */
const COPUNCTAL = { protan: [0.747, 0.253], deutan: [1.4, -0.4], tritan: [0.171, 0] } as const;
const XYZ_TO_RGB = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.204, 1.057],
];
const xyYtoLinear = (x: number, y: number, Y: number): Vec3 => {
  const X = (x * Y) / y;
  const Z = ((1 - x - y) * Y) / y;
  return XYZ_TO_RGB.map((r) => r[0] * X + r[1] * Y + r[2] * Z) as Vec3;
};
/** Ángulo (rad) de la línea de confusión por el blanco D65 hacia el punto copuntual, a Y constante. */
export function copunctalAngle(type: keyof typeof COPUNCTAL): number {
  const w = [0.3127, 0.329];
  const p = COPUNCTAL[type];
  const t = 0.02;
  const a = xyYtoLinear(w[0] + (p[0] - w[0]) * t, w[1] + (p[1] - w[1]) * t, 0.2);
  const b = xyYtoLinear(w[0], w[1], 0.2);
  return thetaOf([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
}

function redEfficiency(profile: UmbralProfile) {
  const matches = (profile.luminance as { measuredMatches?: Array<Record<string, unknown>> } | undefined)?.measuredMatches ?? [];
  const red = matches.find((m) => m.id === "rojo" && m.kind === "test" && m.atLeast !== true && m.bound !== "unconverged");
  const eff = red && typeof red.efficiency === "number" ? red.efficiency : null;
  if (eff == null || !(eff > 0)) return null;
  // `width`: semiancho del IC en log (eficiencia · e^±width).
  const w = typeof red!.width === "number" && red!.width > 0 ? red!.width : 0;
  return { efficiency: eff, lo: eff * Math.exp(-w), hi: eff * Math.exp(w) };
}

function edgeHint(files: EdgeFile[]) {
  const file = files.find((f) => (f.cone === "l" || f.cone === "m") && f.band === "closed" && f.minus?.found && f.plus?.found && f.minus.angleDeg != null && f.plus.angleDeg != null);
  if (!file) return null;
  const lo = file.minus.angleDeg as number;
  const hi = file.plus.angleDeg as number;
  const centerDeg = (lo + hi) / 2;
  const unc = (s: EdgeFile["minus"]) => (s.insideDeg != null && s.outsideDeg != null ? Math.abs(s.outsideDeg - s.insideDeg) / 2 : 0);
  const marginDeg = Math.max(CLASSIFY.edgeMarginDeg, (unc(file.minus) + unc(file.plus)) / 2);
  const c = (centerDeg * Math.PI) / 180;
  const dp = (lineGap(c, copunctalAngle("protan")) * 180) / Math.PI;
  const dd = (lineGap(c, copunctalAngle("deutan")) * 180) / Math.PI;
  const type = Math.abs(dp - dd) <= marginDeg ? null : dp < dd ? "protan" : "deutan";
  return { type, centerDeg, marginDeg } as const;
}

const c3 = (v: number) => v.toFixed(3).replace(".", ",");

export function classify(profile: UmbralProfile, edges: EdgeFile[] = []): Classification {
  const floor = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : null;
  const groups: AxisGroup[] = GROUPS.map((g) => {
    const members = profile.axes.filter((a) => a.role && g.roles.includes(a.role) && a.threshold != null && a.threshold > 0);
    const estimates = members.filter((a) => a.thresholdKind !== "upper-bound");
    const worst = members.length ? Math.max(...members.map((a) => a.threshold as number)) : null;
    const worstEst = estimates.length ? Math.max(...estimates.map((a) => a.threshold as number)) : null;
    const ratio = worst != null && floor ? worst / floor : null;
    const elevated = worstEst != null && floor != null && worstEst > floor * CLASSIFY.gate;
    return { id: g.id, name: g.name, worst, ratio, elevated, members: members.map((a) => a.id ?? a.role ?? "?") };
  });
  const rg = groups[0].elevated;
  const by = groups[1].elevated;
  const lum = redEfficiency(profile);
  const hint = edgeHint(edges);
  let rgType: "protan" | "deutan" | null = null;
  let reason = "";
  if (rg) {
    const fromLum = !lum
      ? null
      : lum.efficiency < CLASSIFY.protanBelow && lum.hi < CLASSIFY.protanCiHi
        ? "protan"
        : lum.efficiency >= CLASSIFY.deutanAtLeast && lum.lo > CLASSIFY.deutanCiLo
          ? "deutan"
          : null;
    if (fromLum && hint?.type && hint.type !== fromLum) {
      rgType = null;
      reason = "la luminancia y los bordes se contradicen fuera del margen";
    } else if (fromLum) {
      rgType = fromLum;
      reason = lum ? `eficiencia luminosa del rojo ${c3(lum.efficiency)} (IC ${c3(lum.lo)}–${c3(lum.hi)})${hint?.type === fromLum ? ", confirmada por los bordes" : ""}` : "";
    } else if (hint?.type) {
      rgType = hint.type;
      reason = "luminancia sin decidir; desempatan los bordes (líneas de Smith–Pokorny)";
    } else {
      reason = lum ? `eficiencia luminosa del rojo ${c3(lum.efficiency)} en zona intermedia` : "sin prueba de luminancia";
    }
  }
  const compatible: Compatible = rg && by ? "mixed" : by ? "tritan" : rg ? (rgType ?? "red-green-undetermined") : "none";
  const fmt = (g: AxisGroup) => `${g.name.toLowerCase()} (${g.ratio != null ? g.ratio.toFixed(1).replace(".", ",") : "?"}× el control)`;
  const rgLabel = rgType === "protan" ? "compatible con protán" : rgType === "deutan" ? "compatible con deután" : "tipo sin determinar";
  const text =
    compatible === "none"
      ? "Sin alteración medida: los dos ejes aguantan el paso del control."
      : compatible === "tritan"
        ? `Compatible con tritán: elevado el ${fmt(groups[1])}.`
        : compatible === "mixed"
          ? `Mixto: elevados el ${fmt(groups[0])} (${rgLabel}) y el ${fmt(groups[1])}.`
          : rgType
            ? `Compatible con ${rgType === "protan" ? "protán" : "deután"}: elevado el ${fmt(groups[0])}.`
            : `Elevado el ${fmt(groups[0])}; tipo sin determinar.`;
  return { groups, compatible, redGreenType: rgType, luminance: lum, edgeHint: hint, reason, text, disclaimer: DISCLAIMER };
}
