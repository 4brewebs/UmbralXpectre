import { over } from "./apca";

/** Colores de la portada (#/inicio). Los comprueba tests/portada-apca.test.ts (APCA |Lc| ≥ 60). */
export const PORTADA = {
  black: "#000000",
  /** Opacidad de la imagen de fondo (atenuada). */
  imageOpacity: 0.38,
  /** Velo oscuro bajo todo el texto y los botones. */
  veil: { color: "#000000", alpha: 0.86 },
  text: "#f3efe6",
  muted: "#c4beb2",
  accent: "#e0b06a",
  buttonBg: "#ebbd78",
  buttonFg: "#120d06",
  /** Píxel más claro de la imagen (crema del logotipo), peor caso bajo el velo. */
  brightestImagePixel: "#f4ecdc",
} as const;

/** Fondo efectivo en el peor caso: píxel más claro de la imagen atenuada, bajo el velo. */
export function worstPanelBackground(): string {
  const dimmed = over(PORTADA.brightestImagePixel, PORTADA.imageOpacity, PORTADA.black);
  return over(PORTADA.veil.color, PORTADA.veil.alpha, dimmed);
}
