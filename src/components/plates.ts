import type { FilterKind } from "@/lib/color/lut";
import type { UmbralProfile } from "@/lib/color/profile";
import { ANCHOR, addScaled, angDist, dirFromTheta, toSrgb8, type Vec3 } from "@/lib/color/space";
import type { EdgeFile } from "@/lib/color/edges";
import { colorFor, type FilterSource } from "@/lib/color/spectrum";

export type FilterView = "original" | FilterKind;
export type AxisMark = UmbralProfile["axes"][number];

const SIZE = 560;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 1831565813) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function drawGlyph(ctx: CanvasRenderingContext2D, hole: boolean) {
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 44;
  ctx.beginPath();
  if (hole) {
    ctx.moveTo(196, 150);
    ctx.lineTo(112, 318);
    ctx.lineTo(248, 318);
    ctx.moveTo(206, 196);
    ctx.lineTo(206, 448);
    ctx.moveTo(286, 176);
    ctx.bezierCurveTo(360, 112, 470, 148, 438, 236);
    ctx.bezierCurveTo(414, 304, 318, 322, 286, 372);
    ctx.lineTo(458, 436);
  } else {
    ctx.moveTo(150, 156);
    ctx.lineTo(418, 156);
    ctx.lineTo(214, 448);
  }
  ctx.stroke();
}

function numberMask(hole: boolean): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray(SIZE * SIZE * 4);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  drawGlyph(ctx, hole);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function onMask(mask: Uint8ClampedArray, x: number, y: number): boolean {
  const sx = Math.max(0, Math.min(SIZE - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(SIZE - 1, Math.floor(y)));
  return mask[(sy * SIZE + sx) * 4] > 128;
}

export function makeDots(hole: boolean, axis: AxisMark, floor: number, seed: number) {
  const random = rng(seed + (hole ? 17 : 91));
  const mask = numberMask(hole);
  const dir = dirFromTheta((axis.angleDeg * Math.PI) / 180);
  const cap = axis.maxScale > 0 ? axis.maxScale * 0.82 : 0.4;
  const scale = Math.min(hole ? (axis.threshold ?? floor) : Math.max(floor * 6, 0.12), cap);
  const dots: Array<{ x: number; y: number; r: number; rgb: Vec3 }> = [];
  const cells = new Map<string, number[]>();
  const overlaps = (x: number, y: number, r: number) => {
    const col = Math.floor(x / 14);
    const row = Math.floor(y / 14);
    const reach = Math.ceil((r + 10) / 14);
    for (let j = row - reach; j <= row + reach; j += 1) {
      for (let i = col - reach; i <= col + reach; i += 1) {
        const bucket = cells.get(`${i},${j}`);
        if (!bucket) continue;
        for (const index of bucket) {
          const dot = dots[index];
          const dx = x - dot.x;
          const dy = y - dot.y;
          const min = r + dot.r + 0.55;
          if (dx * dx + dy * dy < min * min) return true;
        }
      }
    }
    return false;
  };
  const color = (inside: boolean) => {
    const amount = scale * (0.82 + random() * 0.18);
    const noise = (random() * 2 - 1) * 0.028;
    return addScaled([ANCHOR, ANCHOR, ANCHOR], dir, (inside ? 1 : -1) * amount).map((channel) =>
      Math.min(0.94, Math.max(0.02, channel + noise)),
    ) as Vec3;
  };
  const place = (x: number, y: number, r: number, inside: boolean) => {
    dots.push({ x, y, r, rgb: color(inside) });
    const key = `${Math.floor(x / 14)},${Math.floor(y / 14)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(dots.length - 1);
    else cells.set(key, [dots.length - 1]);
  };
  for (const wave of [
    { radius: 6.2, spacing: 13.6, strict: true },
    { radius: 4, spacing: 8.6, strict: true },
    { radius: 2.45, spacing: 5.15, strict: false },
  ]) {
    const rowStep = wave.spacing * 0.866;
    let row = 0;
    for (let y = wave.radius + 2; y < SIZE - wave.radius - 2; y += rowStep) {
      const shift = row % 2 ? wave.spacing * 0.5 : 0;
      for (let x = wave.radius + 2 + shift; x < SIZE - wave.radius - 2; x += wave.spacing) {
        const px = x + (random() - 0.5) * wave.spacing * 0.42;
        const py = y + (random() - 0.5) * rowStep * 0.42;
        const radius = wave.radius * (0.86 + random() * 0.28);
        if (Math.hypot(px - SIZE / 2, py - SIZE / 2) + radius > SIZE / 2 - 10 || overlaps(px, py, radius)) continue;
        const probes = wave.strict
          ? [
              [0, 0],
              [radius * 0.65, 0],
              [-radius * 0.65, 0],
              [0, radius * 0.65],
              [0, -radius * 0.65],
            ]
          : [[0, 0]];
        const inside = probes.filter(([dx, dy]) => onMask(mask, px + dx, py + dy)).length;
        if (wave.strict && inside !== 0 && inside !== probes.length) continue;
        place(px, py, radius, inside > 0);
      }
      row += 1;
    }
  }
  return dots;
}

export function elevatedAxes(profile: UmbralProfile, floor: number): AxisMark[] {
  return profile.axes
    .filter(
      (axis) =>
        (axis.role === "l" || axis.role === "m" || axis.role === "s") &&
        axis.thresholdKind === "estimate" &&
        axis.threshold != null &&
        axis.threshold >= floor * 1.6,
    )
    .sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0));
}

export function pickHealthy(profile: UmbralProfile, confusion: AxisMark | null): AxisMark | null {
  const confusionAngle = ((confusion?.angleDeg ?? 0) * Math.PI) / 180;
  const pool = profile.axes.filter((axis) => axis.threshold != null && axis.id !== confusion?.id);
  const far = pool.filter(
    (axis) => !confusion || angDist((axis.angleDeg * Math.PI) / 180, confusionAngle) > (50 * Math.PI) / 180,
  );
  const list = far.length ? far : pool;
  return list.sort((a, b) => (a.threshold ?? 1) - (b.threshold ?? 1))[0] ?? null;
}

export function paint(
  canvas: HTMLCanvasElement,
  dots: Array<{ x: number; y: number; r: number; rgb: Vec3 }>,
  profile: UmbralProfile,
  floor: number,
  view: FilterView,
  source: FilterSource = "profile",
  edgeFiles: EdgeFile[] = [],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(SIZE * dpr);
  canvas.height = Math.round(SIZE * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#1a1916";
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  for (const dot of dots) {
    // Mismo camino que el arcoíris y la cámara: perfil o bordes.
    const rgb = view === "original" ? dot.rgb : colorFor(view, dot.rgb, profile, source, edgeFiles);
    const [r, g, b] = toSrgb8(rgb);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

