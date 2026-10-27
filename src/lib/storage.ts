/**
 * Almacenamiento del entorno stable (/stable-v1/). Raíz (pro), /qa/ y /stable-v1/ comparten origen y
 * localStorage; esta versión usa claves con la coletilla `-stable` (la sesión en curso, `-stable-session`).
 * Al primer uso COPIA el perfil (con su historial de sesiones), la sesión en curso y el flag desde las
 * claves sin prefijo, migrando el esquema. Las claves sin prefijo nunca se escriben ni se borran.
 */
import { PROFILE_STORAGE_KEY, RETIRED_PROFILE_KEYS, parseProfile } from "./color/profile";
import { QP_RESUME_KEY } from "./color/session";
import { MOTION_V2_FLAG } from "./color/motion2";

export type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export const STORAGE_ENV = "stable";
export const MIGRATED_KEY = `umbral-storage-migrated-${STORAGE_ENV}`;

/** Clave real de `key`: coletilla `-stable`; la sesión en curso termina en `stable-session`. */
export function envKey(key: string): string {
  return key === QP_RESUME_KEY ? `${key}-${STORAGE_ENV}-session` : `${key}-${STORAGE_ENV}`;
}

/** Copia (una sola vez) el perfil sin prefijo a las claves `-stable`, migrado a v3. Solo escribe claves `-stable`. */
export function migrateLegacy(store: Store): void {
  try {
    if (store.getItem(MIGRATED_KEY)) return;
    if (!store.getItem(envKey(PROFILE_STORAGE_KEY))) {
      for (const key of [PROFILE_STORAGE_KEY, ...RETIRED_PROFILE_KEYS]) {
        const raw = store.getItem(key);
        const parsed = raw ? parseProfile(raw) : null;
        if (!parsed) continue;
        store.setItem(envKey(PROFILE_STORAGE_KEY), JSON.stringify(parsed));
        const resume = store.getItem(QP_RESUME_KEY);
        if (resume !== null && store.getItem(envKey(QP_RESUME_KEY)) === null) store.setItem(envKey(QP_RESUME_KEY), resume);
        break;
      }
    }
    const flag = store.getItem(MOTION_V2_FLAG);
    if (flag !== null && store.getItem(envKey(MOTION_V2_FLAG)) === null) store.setItem(envKey(MOTION_V2_FLAG), flag);
    store.setItem(MIGRATED_KEY, "1");
  } catch {
    /* sin almacenamiento */
  }
}

/** Store del entorno stable; migra al primer uso. */
export function scopedStore(getBackend: () => Store): Store {
  let ready = false;
  const backend = () => {
    const store = getBackend();
    if (!ready) {
      ready = true;
      migrateLegacy(store);
    }
    return store;
  };
  return {
    getItem: (key) => backend().getItem(envKey(key)),
    setItem: (key, value) => backend().setItem(envKey(key), value),
    removeItem: (key) => backend().removeItem(envKey(key)),
  };
}

export const scopedStorage: Store = scopedStore(() => window.localStorage);
