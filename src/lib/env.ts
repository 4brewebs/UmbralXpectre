/**
 * Entorno de la build (inyectado por Vite `define`): prod o qa, rama y commit corto.
 * Fuera de Vite (tests con tsx) vale prod / "local".
 */
declare const __APP_ENV__: string | undefined;
declare const __APP_BRANCH__: string | undefined;
declare const __APP_COMMIT__: string | undefined;

export type AppEnv = "prod" | "qa";
export interface BuildInfo {
  env: AppEnv;
  branch: string;
  commit: string;
}

export const BUILD: BuildInfo = {
  env: typeof __APP_ENV__ !== "undefined" && __APP_ENV__ === "qa" ? "qa" : "prod",
  branch: typeof __APP_BRANCH__ !== "undefined" && __APP_BRANCH__ ? __APP_BRANCH__ : "local",
  commit: typeof __APP_COMMIT__ !== "undefined" && __APP_COMMIT__ ? __APP_COMMIT__ : "local",
};

export const IS_QA = BUILD.env === "qa";

/** Prefijo de claves de almacenamiento por entorno: QA no pisa los datos de producción. */
export function storageKey(key: string, env: AppEnv = BUILD.env): string {
  return env === "qa" ? `qa.${key}` : key;
}

/** localStorage con el prefijo del entorno. */
export const scopedStorage = {
  getItem: (key: string) => window.localStorage.getItem(storageKey(key)),
  setItem: (key: string, value: string) => window.localStorage.setItem(storageKey(key), value),
  removeItem: (key: string) => window.localStorage.removeItem(storageKey(key)),
};
