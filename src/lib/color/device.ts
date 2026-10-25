/**
 * Huella del dispositivo (UA + pantalla + dpr + gamut + refresco). Los pesos de luminancia y los
 * umbrales valen para esta pantalla: en otra, hay que avisar y ofrecer repetir la prueba.
 */
export interface DeviceFingerprint {
  userAgent: string;
  /** Lados de la pantalla en px CSS, el menor primero (girar el móvil no cambia la huella). */
  screen: [number, number];
  dpr: number;
  gamut: string;
  refreshHz: number | null;
  /** FNV-1a de lo anterior (refresco redondeado a 5 Hz). */
  key: string;
}

export interface DeviceSource {
  userAgent: string;
  screen: { width: number; height: number; pixelRatio: number };
  gamut: string;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const bucket = (hz: number | null) => (hz == null ? "?" : String(Math.round(hz / 5) * 5));

export function fingerprint(hw: DeviceSource, refreshHz: number | null): DeviceFingerprint {
  const screen: [number, number] = [Math.min(hw.screen.width, hw.screen.height), Math.max(hw.screen.width, hw.screen.height)];
  const dpr = Math.round(hw.screen.pixelRatio * 1000) / 1000;
  const hz = refreshHz == null ? null : Math.round(refreshHz * 10) / 10;
  const key = fnv1a([hw.userAgent, screen.join("x"), dpr, hw.gamut, bucket(hz)].join("|"));
  return { userAgent: hw.userAgent, screen, dpr, gamut: hw.gamut, refreshHz: hz, key };
}

/** Diferencias legibles entre la huella guardada y la actual. El refresco solo cuenta si ambos se midieron. */
export function deviceDiff(saved: DeviceFingerprint, now: DeviceFingerprint): string[] {
  const out: string[] = [];
  if (saved.userAgent !== now.userAgent) out.push("navegador o sistema");
  if (saved.screen[0] !== now.screen[0] || saved.screen[1] !== now.screen[1]) out.push("tamaño de pantalla");
  if (Math.abs(saved.dpr - now.dpr) > 0.01) out.push("densidad de píxeles");
  if (saved.gamut !== now.gamut) out.push("gama de color");
  if (saved.refreshHz != null && now.refreshHz != null && bucket(saved.refreshHz) !== bucket(now.refreshHz)) out.push("refresco");
  return out;
}

/**
 * Huella con la que se midieron los pesos: la guardada, o (perfiles anteriores) la del hardware del
 * perfil con el refresco de la prueba. Null si los pesos no se midieron.
 */
export function weightsDevice(profile: {
  hardware?: DeviceSource | null;
  luminance?: { weightsSource?: string; refreshHz?: number | null; device?: DeviceFingerprint } | null;
}): DeviceFingerprint | null {
  const lum = profile.luminance;
  if (!lum || lum.weightsSource !== "measured") return null;
  if (lum.device) return lum.device;
  return profile.hardware?.screen ? fingerprint(profile.hardware, lum.refreshHz ?? null) : null;
}
