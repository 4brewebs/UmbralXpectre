/**
 * CIEDE2000 (ΔE00) según Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula:
 * Implementation Notes, Supplementary Test Data, and Mathematical Observations",
 * Color Res. Appl. 30(1):21–30. Ecuaciones (1)–(22), kL = kC = kH = 1.
 * Validado contra sus 34 pares de prueba (tests/deltaE.test.ts).
 */

import type { Vec3 } from "./space";

export type Lab = [number, number, number];

const RAD = Math.PI / 180;
const P25_7 = 25 ** 7;

export function ciede2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const Cab = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cab ** 7 / (Cab ** 7 + P25_7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const C1 = Math.hypot(ap1, b1);
  const C2 = Math.hypot(ap2, b2);
  const hOf = (ap: number, b: number) => (ap === 0 && b === 0 ? 0 : ((Math.atan2(b, ap) / RAD) + 360) % 360);
  const h1 = hOf(ap1, b1);
  const h2 = hOf(ap2, b2);

  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = 0;
  if (C1 * C2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * RAD);

  const Lm = (L1 + L2) / 2;
  const Cm = (C1 + C2) / 2;
  let hm = h1 + h2;
  if (C1 * C2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2;
    else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * RAD) + 0.24 * Math.cos(2 * hm * RAD) + 0.32 * Math.cos((3 * hm + 6) * RAD) - 0.2 * Math.cos((4 * hm - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + P25_7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cm;
  const SH = 1 + 0.015 * Cm * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** sRGB lineal (D65) → CIELAB (D65, IEC 61966-2-1 / CIE 15). */
export function labOfLinear(rgb: Vec3): Lab {
  const [r, g, b] = rgb;
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X / 0.95047);
  const fy = f(Y);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE00Linear(a: Vec3, b: Vec3): number {
  return ciede2000(labOfLinear(a), labOfLinear(b));
}
