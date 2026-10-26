import { PROFILE_STORAGE_KEY, RETIRED_PROFILE_KEYS, parseProfile, type UmbralProfile } from "@/lib/color/profile";
import { scopedStorage as ls } from "@/lib/env";

/** Perfil guardado en localStorage (clave actual o retiradas). Sin formatos nuevos. */
export function loadStored(): UmbralProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const current = ls.getItem(PROFILE_STORAGE_KEY);
    if (current) {
      const parsed = parseProfile(current);
      if (parsed) {
        RETIRED_PROFILE_KEYS.forEach((key) => ls.removeItem(key));
        return parsed;
      }
    }
    for (const key of RETIRED_PROFILE_KEYS) {
      const previous = ls.getItem(key);
      const parsed = previous ? parseProfile(previous) : null;
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
