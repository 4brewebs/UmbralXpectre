/**
 * Transición entre ensayos de la validación 3AFC (Lucas, 26/10): tras responder, los sectores se funden al gris de
 * anclaje; el triángulo y los separadores dan un giro corto en gris (300–500 ms, con easing); se paran y aparecen
 * los colores. Solo entonces se acepta respuesta; mientras se juzga, todo quieto.
 * Orientación (Lucas, 26/10): incremento aleatorio uniforme de 15–45° respecto a la anterior, en sentido aleatorio
 * (horario o antihorario); la acumulada se aplica módulo 360°. Pasos distintos cada vez (no un paso fijo).
 * Con `prefers-reduced-motion`, el mismo incremento sin animación.
 */
export const WHEEL = { fade: 150, spinMin: 300, spinMax: 500, stepMin: 15, stepMax: 45, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;

export type WheelPhase = "fade" | "spin" | "ready";

/** Diferencia de orientación módulo 120°, plegada a [0, 60]. */
export function diff120(a: number, b: number): number {
  const d = (((a - b) % 120) + 120) % 120;
  return Math.min(d, 120 - d);
}

/**
 * Siguiente orientación desde `prev` (null: primer ensayo, orientación uniforme 0–360 y sin incremento).
 * `u1` fija la magnitud (uniforme 15–45°, centésimas de grado), `u2` el sentido (< ½ antihorario: negativo).
 */
export function nextRotation(prev: number | null, u1: number, u2: number): { rotationDeg: number; stepDeg: number } {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (prev == null) return { rotationDeg: r2((u1 * 360) % 360), stepDeg: 0 };
  const mag = WHEEL.stepMin + (WHEEL.stepMax - WHEEL.stepMin) * Math.min(Math.max(u1, 0), 1);
  const stepDeg = r2(u2 < 0.5 ? -mag : mag);
  return { rotationDeg: r2((((prev + stepDeg) % 360) + 360) % 360), stepDeg };
}

export interface WheelPlan {
  fadeMs: number;
  spinMs: number;
  /** Ángulo mostrado al empezar y al terminar el giro (acumulado; congruente con `target` módulo 360°). */
  from: number;
  to: number;
  /** Orientación real del ensayo (los sectores de color). */
  target: number;
}

/** `from` = ángulo mostrado ahora (acumulado; null: primer ensayo, sin transición); `stepDeg` = incremento con signo. */
export function wheelPlan(from: number | null, stepDeg: number, target: number, reduced: boolean, u: number): WheelPlan {
  if (from == null) return { fadeMs: 0, spinMs: 0, from: target, to: target, target };
  const to = from + stepDeg;
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
