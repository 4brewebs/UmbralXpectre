/**
 * Almacenamiento con espacio por versión publicada. Raíz, /qa/ y /stable-v1/ viven en el mismo
 * origen y compartirían localStorage; aquí cada build usa claves con un prefijo sacado de su
 * BASE_URL. Las claves sin prefijo (las que usa la versión estable) y las `qa.` de QA anteriores
 * solo se LEEN, una vez, para copiar el perfil al espacio nuevo: nunca se escriben ni se borran.
 */
import { PROFILE_STORAGE_KEY, RETIRED_PROFILE_KEYS, parseProfile } from "./color/profile";
import { EDGES_STORAGE_KEY } from "./color/edgestore";
import { QP_RESUME_KEY } from "./color/session";
import { MOTION_V2_FLAG } from "./color/motion2";
import { BASE_URL, IS_QA } from "./env";

export type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** Prefijo del espacio: `umbral@<BASE_URL>:` (p. ej. `umbral@/UmbralXpectre/qa/:`). Nunca vacío. */
export function storagePrefix(baseUrl: string): string {
  let base = baseUrl || "/";
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return `umbral@${base}:`;
}

export const MIGRATED_KEY = "storage-migrated";
/** Claves que acompañan al perfil y se copian desde el mismo origen que él. */
const COMPANION_KEYS = [EDGES_STORAGE_KEY, QP_RESUME_KEY] as const;

/**
 * Copia (una sola vez por espacio) el perfil antiguo al espacio `prefix`, pasándolo por
 * parseProfile (migración de esquema v1/v2 → v3). `legacyPrefixes` en orden de preferencia
 * ("" = sin prefijo). Solo escribe claves que empiezan por `prefix`.
 */
export function migrateLegacy(store: Store, prefix: string, legacyPrefixes: readonly string[]): void {
  if (!prefix) throw new Error("prefijo de almacenamiento vacío");
  try {
    if (store.getItem(prefix + MIGRATED_KEY)) return;
    if (!store.getItem(prefix + PROFILE_STORAGE_KEY)) {
      outer: for (const legacy of legacyPrefixes) {
        for (const key of [PROFILE_STORAGE_KEY, ...RETIRED_PROFILE_KEYS]) {
          const raw = store.getItem(legacy + key);
          const parsed = raw ? parseProfile(raw) : null;
          if (!parsed) continue;
          store.setItem(prefix + PROFILE_STORAGE_KEY, JSON.stringify(parsed));
          for (const extra of COMPANION_KEYS) {
            const value = store.getItem(legacy + extra);
            if (value !== null && store.getItem(prefix + extra) === null) store.setItem(prefix + extra, value);
          }
          break outer;
        }
      }
    }
    if (store.getItem(prefix + MOTION_V2_FLAG) === null) {
      for (const legacy of legacyPrefixes) {
        const flag = store.getItem(legacy + MOTION_V2_FLAG);
        if (flag !== null) {
          store.setItem(prefix + MOTION_V2_FLAG, flag);
          break;
        }
      }
    }
    store.setItem(prefix + MIGRATED_KEY, "1");
  } catch {
    /* sin almacenamiento: no hay nada que copiar */
  }
}

/** Store con espacio: todas las lecturas, escrituras y borrados llevan `prefix`. Migra al primer uso. */
export function scopedStore(getBackend: () => Store, prefix: string, legacyPrefixes: readonly string[]): Store {
  let ready = false;
  const backend = () => {
    const store = getBackend();
    if (!ready) {
      ready = true;
      migrateLegacy(store, prefix, legacyPrefixes);
    }
    return store;
  };
  return {
    getItem: (key) => backend().getItem(prefix + key),
    setItem: (key, value) => backend().setItem(prefix + key, value),
    removeItem: (key) => backend().removeItem(prefix + key),
  };
}

/** Clave real en localStorage para esta versión (o para la de `baseUrl`). */
export function storageKey(key: string, baseUrl: string = BASE_URL): string {
  return storagePrefix(baseUrl) + key;
}

/** Origen de la copia inicial, por preferencia: QA antiguo (`qa.`) y luego sin prefijo. */
export const LEGACY_PREFIXES: readonly string[] = IS_QA ? ["qa.", ""] : [""];

/** localStorage con el espacio de esta versión; al primer uso copia el perfil antiguo (sin tocarlo). */
export const scopedStorage: Store = scopedStore(() => window.localStorage, storagePrefix(BASE_URL), LEGACY_PREFIXES);
