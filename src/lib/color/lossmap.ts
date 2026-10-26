import type { UmbralProfile } from "./profile";
import type { EdgeFile } from "./edges";
import { measuredRegion } from "./spectrum";
import { luminance, thetaOf, type Vec3 } from "./space";

/**
 * Zonas de confusión en grises (diagnóstico, no es un filtro de color).
 * Intensidad por tono = umbral medido en ese tono / umbral del control, de 1× (oscuro) al pico medido (gris claro),
 * en escala logarítmica y rampa uniforme en L* (12 → 85). Solo se interpola en ángulo entre puntos medidos:
 * ejes del perfil y bordes de la región (borde encontrado, toEnd, punto medio al eje sano). Nunca la matriz ni la
 * simulación. Los lados «midpointToHealthy» son estimados (rayado).
 */
export const LOSS_RAMP = { lMin: 12, lMax: 85 };
/** Alrededor de cada punto medido (ejes y red-end) el mapa es liso: ±plainDeg, y luego transición suave de fadeDeg al rayado. */
export const HATCH = { plainDeg: 6, fadeDeg: 4 };

type Point = { deg: number; ratio: number };
const wrap = (d: number) => ((d % 360) + 360) % 360;

export function lossPoints(profile: UmbralProfile, edges: EdgeFile[] = []): { points: Point[]; estimated: Array<[number, number]>; measured: number[] } {
  const control = profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02;
  const points: Point[] = [];
  for (const axis of profile.axes) {
    if (axis.threshold == null || !Number.isFinite(axis.angleDeg)) continue;
    points.push({ deg: wrap(axis.angleDeg), ratio: Math.max(1, axis.threshold / control) });
  }
  const measured = points.map((p) => p.deg);
  const estimated: Array<[number, number]> = [];
  for (const sector of measuredRegion(profile.axes, control, edges)) {
    const axis = profile.axes.find((a) => (a.id ?? a.role) === sector.axis);
    const peak = Math.max(1, (axis?.threshold ?? control) / control);
    const file = edges.find((e) => e.cone === axis?.role);
    for (const [side, dir] of [[sector.minus, -1], [sector.plus, 1]] as const) {
      if (side.source === "edge") {
        // En el borde, el fallo se midió hasta la escala de bordes.
        points.push({ deg: wrap(side.deg), ratio: Math.max(1, (file?.edgeScale ?? control) / control) });
      } else if (side.source === "toEnd") {
        // Sigue fallando hasta el eje sano: el pico se mantiene hasta justo antes de él.
        points.push({ deg: wrap(side.deg - dir * 1), ratio: peak });
      } else {
        const lo = dir < 0 ? side.deg : sector.centerDeg;
        const hi = dir < 0 ? sector.centerDeg : side.deg;
        estimated.push([wrap(lo), wrap(lo) + (hi - lo)]);
      }
    }
  }
  points.sort((a, b) => a.deg - b.deg);
  return { points, estimated, measured };
}

/** Interpola log(ratio) en ángulo entre los puntos vecinos (circular). */
export function ratioAt(points: Point[], deg: number): number {
  if (!points.length) return 1;
  if (points.length === 1) return points[0].ratio;
  const d = wrap(deg);
  let i = points.findIndex((p) => p.deg > d);
  if (i < 0) i = 0;
  const hi = points[i];
  const lo = points[(i - 1 + points.length) % points.length];
  const span = wrap(hi.deg - lo.deg) || 360;
  const t = wrap(d - lo.deg) / span;
  return Math.exp(Math.log(lo.ratio) * (1 - t) + Math.log(hi.ratio) * t);
}

export function isEstimated(estimated: Array<[number, number]>, deg: number): boolean {
  const d = wrap(deg);
  return estimated.some(([lo, hi]) => (d >= lo && d <= hi) || (d + 360 >= lo && d + 360 <= hi));
}

/** Peso del rayado (0 liso, 1 rayado): 0 a ≤ plainDeg de un punto medido, smoothstep hasta plainDeg + fadeDeg. */
export function hatchWeight(estimated: Array<[number, number]>, measuredDeg: number[], deg: number): number {
  if (!isEstimated(estimated, deg)) return 0;
  const gap = Math.min(Infinity, ...measuredDeg.map((m) => { const x = Math.abs(wrap(deg - m)); return Math.min(x, 360 - x); }));
  const t = Math.max(0, Math.min(1, (gap - HATCH.plainDeg) / HATCH.fadeDeg));
  return t * t * (3 - 2 * t);
}

/** L* → sRGB 8-bit gris. */
export function greyOfL(l: number): number {
  const y = l > 8 ? ((l + 16) / 116) ** 3 : l / 903.3;
  const s = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, s)) * 255);
}

/** Posición en la rampa (0 = 1×, 1 = pico) en escala log, y su L*. */
export function rampL(ratio: number, peak: number): number {
  const t = peak > 1 ? Math.max(0, Math.min(1, Math.log(Math.max(1, ratio)) / Math.log(peak))) : 0;
  return LOSS_RAMP.lMin + t * (LOSS_RAMP.lMax - LOSS_RAMP.lMin);
}

export type LossSample = { ratio: number; l: number; grey: number; estimated: boolean; hatch: number };

export function lossMap(profile: UmbralProfile, edges: EdgeFile[], rgbs: Vec3[]): LossSample[] {
  const { points, estimated, measured } = lossPoints(profile, edges);
  const peak = Math.max(1, ...points.map((p) => p.ratio));
  return rgbs.map((rgb) => {
    const y = luminance(rgb);
    const deg = (thetaOf([rgb[0] - y, rgb[1] - y, rgb[2] - y]) * 180) / Math.PI;
    const ratio = ratioAt(points, deg);
    const l = rampL(ratio, peak);
    const hatch = hatchWeight(estimated, measured, deg);
    return { ratio, l, grey: greyOfL(l), estimated: hatch > 0, hatch };
  });
}

/** Pico medido (cociente frente al control). */
export function lossPeak(profile: UmbralProfile, edges: EdgeFile[] = []): number {
  return Math.max(1, ...lossPoints(profile, edges).points.map((p) => p.ratio));
}

/** Máscara CSS del rayado: alfa por muestra (transición suave hacia los puntos medidos). */
export function hatchMask(samples: LossSample[]): string {
  return `linear-gradient(90deg, ${samples.map((s, i) => `rgb(0 0 0 / ${s.hatch.toFixed(3)}) ${(i / (samples.length - 1)) * 100}%`).join(", ")})`;
}

/** Tramos contiguos estimados, en % de la barra, para el rayado. */
export function hatchRuns(samples: LossSample[]): Array<{ left: number; width: number }> {
  const runs: Array<{ left: number; width: number }> = [];
  const n = samples.length;
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && samples[i].estimated;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const left = (Math.max(0, start - 0.5) / (n - 1)) * 100;
      const right = (Math.min(n - 1, i - 0.5) / (n - 1)) * 100;
      runs.push({ left, width: right - left });
      start = -1;
    }
  }
  return runs;
}
