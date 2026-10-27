/**
 * Almacenamiento por entorno. Raíz (pro), /qa/ (qa) y /stable-v1/ (stable) viven en el mismo origen
 * y compartirían localStorage; aquí cada build usa claves con la coletilla de su entorno
 * (`umbral-profile-v3-pro`, `umbral-edges-v1-qa`, la sesión en curso `umbral.calib.qp.resume-stable-session`…).
 * Al primer uso se COPIA el perfil (con su historial de sesiones), los bordes, la sesión en curso y el flag
 * desde las claves antiguas, migrando el esquema. Las claves antiguas nunca se escriben ni se borran.
 */
import { PROFILE_STORAGE_KEY, RETIRED_PROFILE_KEYS, parseProfile } from "./color/profile";
import { EDGES_STORAGE_KEY } from "./color/edgestore";
import { QP_RESUME_KEY } from "./color/session";
import { MOTION_V2_FLAG } from "./color/motion2";
import { BASE_URL, STORAGE_ENV, type StorageEnv } from "./env";

export type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** Clave real de `key` en el entorno `env`. La sesión en curso termina en `<env>-session`. */
export function envKey(key: string, env: StorageEnv = STORAGE_ENV): string {
  return key === QP_RESUME_KEY ? `${key}-${env}-session` : `${key}-${env}`;
}

/** Marca de copia hecha en el entorno (ya con coletilla). */
export const migratedKey = (env: StorageEnv) => `umbral-storage-migrated-${env}`;

/** Prefijo que usaba 3ac5e80 (`umbral@<BASE_URL>:`); solo se lee como origen de la copia. */
export function basePrefix(baseUrl: string): string {
  let base = baseUrl || "/";
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return `umbral@${base}:`;
}

/** Claves que acompañan al perfil y se copian desde el mismo origen que él. */
const COMPANION_KEYS = [EDGES_STORAGE_KEY, QP_RESUME_KEY] as const;

/**
 * Copia (una sola vez por entorno) el perfil antiguo a las claves de `env`, pasándolo por parseProfile
 * (migración v1/v2 → v3). `legacyPrefixes` en orden de preferencia ("" = sin prefijo). Solo escribe
 * claves con la coletilla de `env`.
 */
export function migrateLegacy(store: Store, env: StorageEnv, legacyPrefixes: readonly string[]): void {
  const k = (key: string) => envKey(key, env);
  try {
    if (store.getItem(migratedKey(env))) return;
    if (!store.getItem(k(PROFILE_STORAGE_KEY))) {
      outer: for (const legacy of legacyPrefixes) {
        for (const key of [PROFILE_STORAGE_KEY, ...RETIRED_PROFILE_KEYS]) {
          const raw = store.getItem(legacy + key);
          const parsed = raw ? parseProfile(raw) : null;
          if (!parsed) continue;
          store.setItem(k(PROFILE_STORAGE_KEY), JSON.stringify(parsed));
          for (const extra of COMPANION_KEYS) {
            const value = store.getItem(legacy + extra);
            if (value !== null && store.getItem(k(extra)) === null) store.setItem(k(extra), value);
          }
          break outer;
        }
      }
    }
    if (store.getItem(k(MOTION_V2_FLAG)) === null) {
      for (const legacy of legacyPrefixes) {
        const flag = store.getItem(legacy + MOTION_V2_FLAG);
        if (flag !== null) {
          store.setItem(k(MOTION_V2_FLAG), flag);
          break;
        }
      }
    }
    store.setItem(migratedKey(env), "1");
  } catch {
    /* sin almacenamiento: no hay nada que copiar */
  }
}

/** Orígenes de la copia, por preferencia: claves `umbral@<base>:` de 3ac5e80, `qa.` (solo QA) y sin prefijo. */
export function legacyPrefixesFor(env: StorageEnv, baseUrl: string): string[] {
  return [basePrefix(baseUrl), ...(env === "qa" ? ["qa."] : []), ""];
}

/** Store del entorno: lecturas, escrituras y borrados llevan la coletilla de `env`. Migra al primer uso. */
export function scopedStore(getBackend: () => Store, env: StorageEnv, legacyPrefixes: readonly string[]): Store {
  let ready = false;
  const backend = () => {
    const store = getBackend();
    if (!ready) {
      ready = true;
      migrateLegacy(store, env, legacyPrefixes);
    }
    return store;
  };
  return {
    getItem: (key) => backend().getItem(envKey(key, env)),
    setItem: (key, value) => backend().setItem(envKey(key, env), value),
    removeItem: (key) => backend().removeItem(envKey(key, env)),
  };
}

/** localStorage de este entorno; al primer uso copia el perfil antiguo (sin tocarlo). */
export const scopedStorage: Store = scopedStore(() => window.localStorage, STORAGE_ENV, legacyPrefixesFor(STORAGE_ENV, BASE_URL));
