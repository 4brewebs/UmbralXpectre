/**
 * Transición entre muestras de los tests (Colorado, 27/10): fundido al gris de anclaje, gris quieto y aparición.
 * TypeScript puro y sin framework: las fases salen del tiempo transcurrido y se pueden testear sin DOM.
 */

/** Duraciones en ms. `hold` es la única constante del gris quieto (≥ 500 ms; subirla aquí, p. ej. a 800, si hiciera falta). */
export const SWAP = { fadeOut: 300, hold: 500, fadeIn: 300 } as const;

/** Rango del giro del test de perfil en grados (magnitud; el sentido es aleatorio). */
export const PROFILE_ROTATION = { min: 20, max: 160 } as const;

export type SwapPhase = "fadeOut" | "hold" | "fadeIn" | "ready";

export const SWAP_ORDER: readonly SwapPhase[] = ["fadeOut", "hold", "fadeIn", "ready"];

/** Inicio de cada fase en ms desde el cambio de muestra. */
export function swapStarts(): Record<SwapPhase, number> {
  const h = SWAP.hold;
  return { fadeOut: 0, hold: SWAP.fadeOut, fadeIn: SWAP.fadeOut + h, ready: SWAP.fadeOut + h + SWAP.fadeIn };
}

export function swapPhase(elapsedMs: number): SwapPhase {
  const s = swapStarts();
  if (elapsedMs < s.hold) return "fadeOut";
  if (elapsedMs < s.fadeIn) return "hold";
  if (elapsedMs < s.ready) return "fadeIn";
  return "ready";
}

/** Solo con la muestra entera a la vista se acepta respuesta. */
export const acceptsResponse = (phase: SwapPhase): boolean => phase === "ready";

/** Color de un campo: el gris de anclaje (el mismo en todos los ensayos) en fadeOut y hold; el color medido al aparecer y en ready. */
export function swapFill(phase: SwapPhase, color: string, neutral: string): string {
  return phase === "fadeIn" || phase === "ready" ? color : neutral;
}

/** Giro con signo: magnitud uniforme en [min, max] según `u1`, sentido según `u2` (< ½: negativo). Lejos de 0° y 180° si 0 < min ≤ max < 180. */
export function profileRotation(u1: number, u2: number, min: number = PROFILE_ROTATION.min, max: number = PROFILE_ROTATION.max): number {
  const u = Math.min(Math.max(u1, 0), 1);
  const mag = Math.round((min + (max - min) * u) * 100) / 100;
  return u2 < 0.5 ? -mag : mag;
}
