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

/**
 * Test de bordes (cuadrícula 2×2). Medidas en px CSS respecto al centro del escenario cuadrado.
 * Cada pieza vive en su cuadrante: |x|, |y| ∈ [min, max]. Con min ≥ (disco + hueco)/2, dos piezas
 * de cuadrantes distintos quedan separadas al menos por `gap` en x o en y: nunca se tocan.
 */
export const EDGE_STAGE = { size: 288, disc: 72, gap: 16, centerGap: 8 } as const;

export type Offset = { x: number; y: number };

/** Signos de cada cuadrante en el orden de la cuadrícula: arriba-izq, arriba-dcha, abajo-izq, abajo-dcha. */
const QUAD: readonly Offset[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

/** Rango de |x| y |y| del centro de una pieza en reposo. */
export function edgeRange(st: typeof EDGE_STAGE = EDGE_STAGE): { min: number; max: number } {
  return { min: (st.disc + st.gap) / 2, max: st.size / 2 - st.disc / 2 };
}

/** Posiciones nuevas aleatorias (una por pieza) a partir de un generador uniforme en [0, 1). */
export function edgeLayout(rand: () => number, st: typeof EDGE_STAGE = EDGE_STAGE): Offset[] {
  const { min, max } = edgeRange(st);
  const pick = () => Math.round(min + (max - min) * Math.min(Math.max(rand(), 0), 1));
  return QUAD.map((q) => ({ x: q.x * pick(), y: q.y * pick() }));
}

/** Posición contraída hacia el centro (fin del fundido y gris quieto): las piezas dejan `centerGap` entre ellas. */
export function edgeContracted(index: number, st: typeof EDGE_STAGE = EDGE_STAGE): Offset {
  const c = (st.disc + st.centerGap) / 2;
  return { x: QUAD[index].x * c, y: QUAD[index].y * c };
}

/**
 * Desplazamiento de la pieza `index` según la fase: contraída en fadeOut y hold, en su posición en fadeIn y ready.
 * Con movimiento reducido no hay desplazamiento: siempre en su posición (el cambio de posición cae en el hold, tapado).
 */
export function edgeOffset(phase: SwapPhase, index: number, layout: readonly Offset[], reduced: boolean, st: typeof EDGE_STAGE = EDGE_STAGE): Offset {
  if (reduced || phase === "fadeIn" || phase === "ready") return layout[index];
  return edgeContracted(index, st);
}

/** Distancia mínima entre bordes de dos piezas cualesquiera (negativa si se solapan). */
export function edgeMinGap(pos: readonly Offset[], disc: number = EDGE_STAGE.disc): number {
  let m = Infinity;
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) m = Math.min(m, Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) - disc);
  return m;
}
