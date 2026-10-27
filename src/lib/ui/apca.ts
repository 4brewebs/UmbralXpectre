/** APCA-W3 0.0.98G-4g (Lc) para comprobar el contraste del texto. Sin dependencias. */
const hex = (c: string): [number, number, number] => {
  const h = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};

function screenY([r, g, b]: [number, number, number]): number {
  const y = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.072175 * b ** 2.4;
  return y > 0.022 ? y : y + (0.022 - y) ** 1.414;
}

/** Lc de un texto sobre un fondo (con signo: negativo = texto claro sobre fondo oscuro). */
export function apcaLc(text: string, background: string): number {
  const yt = screenY(hex(text));
  const yb = screenY(hex(background));
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** Mezcla `top` sobre `bottom` con opacidad `alpha` (en sRGB, como compone el navegador). */
export function over(top: string, alpha: number, bottom: string): string {
  const t = hex(top), b = hex(bottom);
  return "#" + t.map((v, i) => Math.round((v * alpha + b[i] * (1 - alpha)) * 255).toString(16).padStart(2, "0")).join("");
}
