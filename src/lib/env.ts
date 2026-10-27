/**
 * Entorno de la build (inyectado por Vite `define`): prod o qa, rama y commit corto.
 * Fuera de Vite (tests con tsx) vale prod / "local".
 */
declare const __APP_ENV__: string | undefined;
declare const __APP_BRANCH__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
declare const __APP_BASE__: string | undefined;
declare const __APP_STORAGE_ENV__: string | undefined;

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

/** Base de la build (la misma que import.meta.env.BASE_URL, vía `define`); fuera de Vite, "/". */
export const BASE_URL: string = typeof __APP_BASE__ !== "undefined" && __APP_BASE__ ? __APP_BASE__ : "/";

/** Entorno de almacenamiento (coletilla de las claves): pro (main), qa (develop), stable (stable-v1). Fuera de Vite, pro. */
export type StorageEnv = "pro" | "qa" | "stable";
export function parseStorageEnv(value: string | undefined | null): StorageEnv {
  return value === "qa" ? "qa" : value === "stable" ? "stable" : "pro";
}
export const STORAGE_ENV: StorageEnv = parseStorageEnv(typeof __APP_STORAGE_ENV__ !== "undefined" ? __APP_STORAGE_ENV__ : undefined);
