import { over } from "./apca";

/**
 * Colores de la portada (#/inicio) tomados de los tokens de la app (src/styles.css), sin cambiarlos.
 * Los comprueba tests/portada-apca.test.ts (APCA |Lc| ≥ 60). `--color-muted` (Lc −48,8) y `--color-accent`
 * (−56,4) no llegan sobre `--color-bg`, y `--color-accent-fg` sobre `--color-accent` da 58,4: el texto usa
 * el token más cercano que sí llega (`--color-fg`); el acento queda para iconos y bordes, que no son texto.
 */
export const PORTADA = {
  bg: "#1a1916", // --color-bg
  surface: "#26241f", // --color-surface
  border: "#3a3832", // --color-border
  text: "#f3efe6", // --color-fg (texto principal y secundario)
  accent: "#d7a35a", // --color-accent (solo iconos y borde de la opción principal)
  /** Opacidad de la imagen de fondo (atenuada, en modo «lighten» sobre --color-bg). */
  imageOpacity: 0.38,
  /** Velo de --color-bg bajo todo el texto y los botones. */
  veil: { color: "#1a1916", alpha: 0.86 },
  /** Píxel más claro de la imagen (crema del logotipo), peor caso bajo el velo. */
  brightestImagePixel: "#f4ecdc",
} as const;

/** Fondo efectivo en el peor caso: píxel más claro de la imagen atenuada sobre --color-bg, bajo el velo. */
export function worstPanelBackground(): string {
  const dimmed = over(PORTADA.brightestImagePixel, PORTADA.imageOpacity, PORTADA.bg);
  return over(PORTADA.veil.color, PORTADA.veil.alpha, dimmed);
}
