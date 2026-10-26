/**
 * Transición entre ensayos de la validación 3AFC (Lucas, 26/10): tras responder, los sectores se funden al gris de
 * anclaje; el triángulo y los separadores dan un giro corto en gris (300–500 ms, con easing); se paran y aparecen
 * los colores. Solo entonces se acepta respuesta; mientras se juzga, todo quieto.
 * Orientación: la diferencia con la anterior, módulo 120° (simetría del triángulo), es de al menos 30°.
 * Con `prefers-reduced-motion`, sin giro: solo cambia la orientación (misma regla).
 */
export const WHEEL = { fade: 150, spinMin: 300, spinMax: 500, minDiff: 30, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;

export type WheelPhase = "fade" | "spin" | "ready";

/** Diferencia de orientación módulo 120°, plegada a [0, 60]. */
export function diff120(a: number, b: number): number {
  const d = (((a - b) % 120) + 120) % 120;
  return Math.min(d, 120 - d);
}

/** Siguiente orientación (0–359) desde `prev`: diferencia módulo 120° en [30, 60] (plegada), `u1`,`u2` ∈ [0, 1). */
export function nextRotation(prev: number | null, u1: number, u2: number): number {
  if (prev == null) return Math.floor(u1 * 360) % 360;
  // Paso en [30, 90] módulo 120 (= plegado ≥ 30) y una de las 3 copias por simetría.
  const step = WHEEL.minDiff + Math.floor(u1 * (120 - 2 * WHEEL.minDiff + 1));
  return (prev + step + 120 * Math.floor(u2 * 3)) % 360;
}

export interface WheelPlan {
  fadeMs: number;
  spinMs: number;
  /** Ángulo mostrado al empezar y al terminar el giro (acumulado; congruente con `target` módulo 120°). */
  from: number;
  to: number;
  /** Orientación real del ensayo (los sectores de color). */
  target: number;
}

/** `from` = ángulo mostrado ahora (null: primer ensayo, sin transición). */
export function wheelPlan(from: number | null, target: number, reduced: boolean, u: number): WheelPlan {
  if (from == null) return { fadeMs: 0, spinMs: 0, from: target, to: target, target };
  const step = (((target - from) % 120) + 120) % 120;
  const to = from + step;
  if (reduced) return { fadeMs: WHEEL.fade, spinMs: 0, from: to, to, target };
  const spinMs = Math.round(WHEEL.spinMin + (WHEEL.spinMax - WHEEL.spinMin) * Math.min(Math.max(u, 0), 1));
  return { fadeMs: WHEEL.fade, spinMs, from, to, target };
}

export function wheelPhase(plan: WheelPlan, elapsedMs: number): WheelPhase {
  if (elapsedMs < plan.fadeMs) return "fade";
  if (elapsedMs < plan.fadeMs + plan.spinMs) return "spin";
  return "ready";
}

/** Solo con colores a la vista se acepta respuesta: toques durante el fundido o el giro se ignoran. */
export const acceptsAnswer = (phase: WheelPhase): boolean => phase === "ready";

/** Color de un sector: gris de anclaje salvo en «ready». */
export function sectorFill(phase: WheelPhase, color: string, neutral: string): string {
  return phase === "ready" ? color : neutral;
}
