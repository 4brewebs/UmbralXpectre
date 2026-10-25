import type { DeviceFingerprint } from "./device";
/**
 * Historial completo de sesiones dentro del perfil (Colorado, 4.ª ronda).
 *
 * Formato `umbral.history.v1` (campo opcional `history` del perfil v3; un perfil sin él sigue siendo
 * válido y se lee igual, así que no hace falta subir el esquema):
 *
 *   history = { format: "umbral.history.v1", sessions: HistorySession[] }   // en orden de fecha
 *   HistorySession = {
 *     id,                 // "<kind>-<ms en base 36>-<4 al azar>", único por sesión
 *     kind,               // "calibration" | "motion-v1" | "motion-v2" | "edges"
 *     date,               // ISO 8601 (UTC) de fin de la sesión
 *     deviceType,         // "phone" | "pc" | null (heurística de `viewingSetup`)
 *     viewingCm,          // distancia supuesta (40 móvil, 60 PC) o null
 *     stimulusDeg,        // { width, height } en grados o null si el estímulo no se dimensiona en grados
 *     backgroundY,        // Y lineal del fondo de la prueba o null si no es constante
 *     engine,             // { version: versión de la app, method: "staircase" | "quest+" }
 *     trials,             // ensayos en bruto tal cual los guarda cada motor (array de objetos)
 *     packed?,            // en lugar de `trials` si el JSON en bruto supera PACK_ABOVE bytes
 *     count,              // nº de ensayos (con o sin empaquetar)
 *   }
 *
 * Compresión «columns-v1» (sin pérdida, síncrona, sin dependencias): `packed = { encoding: "columns-v1",
 * keys: string[], rows: unknown[][], holes? }`; cada fila lleva los valores en el orden de `keys`; donde el
 * ensayo no tenía la clave va `null` y su índice se anota en `holes[fila]`. `unpackTrials` devuelve los objetos originales.
 * Quita los nombres de clave repetidos, que son la mayor parte del tamaño (≈ ½–⅓ del JSON en bruto).
 */

export const HISTORY_FORMAT = "umbral.history.v1";
export const ENGINE_VERSION = "0.1.0";
/** Por encima de este tamaño (bytes de JSON) los ensayos de una sesión se guardan en columnas. */
export const PACK_ABOVE = 8_000;

export type HistoryKind = "calibration" | "motion-v1" | "motion-v2" | "edges";
type Trial = Record<string, unknown>;
export interface PackedTrials {
  encoding: "columns-v1";
  keys: string[];
  rows: unknown[][];
  /** Fila → índices de `keys` que ese ensayo no tenía (solo filas con huecos). */
  holes?: Record<string, number[]>;
}
export interface HistorySession {
  id: string;
  kind: HistoryKind;
  date: string;
  deviceType: "phone" | "pc" | null;
  viewingCm: number | null;
  stimulusDeg: { width: number; height: number } | null;
  backgroundY: number | null;
  engine: { version: string; method: "staircase" | "quest+" };
  /** Dispositivo de la sesión (ausente en sesiones anteriores). */
  device?: DeviceFingerprint;
  /** Interfaz de la prueba de brillo (ausente en sesiones anteriores y en las que no son de brillo). */
  ui?: "legacy" | "v2" | "v3";
  count: number;
  trials?: Trial[];
  packed?: PackedTrials;
}
export interface HistoryLog {
  format: typeof HISTORY_FORMAT;
  sessions: HistorySession[];
}

export function packTrials(trials: Trial[]): PackedTrials {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const t of trials) {
    for (const k of Object.keys(t)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const holes: Record<string, number[]> = {};
  const rows = trials.map((t, r) => {
    const miss = keys.flatMap((k, i) => (k in t ? [] : [i]));
    if (miss.length) holes[r] = miss;
    return keys.map((k) => (k in t ? t[k] : null));
  });
  return { encoding: "columns-v1", keys, rows, ...(Object.keys(holes).length ? { holes } : {}) };
}

/** Inverso exacto de `packTrials`. */
export function unpackTrials(p: PackedTrials): Trial[] {
  return p.rows.map((row, r) => {
    const t: Trial = {};
    const miss = new Set(p.holes?.[r] ?? []);
    p.keys.forEach((k, i) => {
      if (!miss.has(i)) t[k] = row[i];
    });
    return t;
  });
}

export function trialsOf(s: HistorySession): Trial[] {
  return s.packed ? unpackTrials(s.packed) : (s.trials ?? []);
}

export function makeSession(
  kind: HistoryKind,
  data: Omit<HistorySession, "id" | "kind" | "count" | "trials" | "packed" | "engine"> & { method: "staircase" | "quest+" },
  trials: unknown[],
  rand: () => number = Math.random,
): HistorySession {
  const raw = trials as Trial[];
  const big = JSON.stringify(raw).length > PACK_ABOVE;
  const { method, ...rest } = data;
  const tag = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  return {
    id: `${kind}-${Date.parse(data.date).toString(36)}-${tag}`,
    kind,
    ...rest,
    engine: { version: ENGINE_VERSION, method },
    count: raw.length,
    ...(big ? { packed: packTrials(raw) } : { trials: raw }),
  };
}

/** Añade una sesión al historial (crea el historial si no existe). Lo previo se conserva. */
export function appendHistory<P extends { history?: HistoryLog }>(profile: P, session: HistorySession): P {
  const prev = profile.history?.format === HISTORY_FORMAT ? profile.history.sessions : [];
  return { ...profile, history: { format: HISTORY_FORMAT, sessions: [...prev, session] } };
}

/** Lectura tolerante: descarta lo que no tenga el formato (perfiles antiguos no traen historial). */
export function readHistory(raw: unknown): HistoryLog | undefined {
  const h = raw as HistoryLog | undefined;
  if (!h || h.format !== HISTORY_FORMAT || !Array.isArray(h.sessions)) return undefined;
  return { format: HISTORY_FORMAT, sessions: h.sessions.filter((s) => s && typeof s.id === "string" && (Array.isArray(s.trials) || s.packed?.encoding === "columns-v1")) };
}
