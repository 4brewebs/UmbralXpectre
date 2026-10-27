/**
 * Bordes guardados junto al perfil (mismo almacenamiento con ámbito que el perfil). Solo valen si su
 * basedOn.createdAt coincide con el perfil activo (edgeFitsProfile); si no, se descartan.
 */
import { edgeFitsProfile, parseEdgeFile, type ConeId, type EdgeFile } from "./edges";

export const EDGES_STORAGE_KEY = "umbral-edges-v1";
export const STALE_EDGES_NOTE = "Bordes de un perfil anterior: repite el test de bordes";

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
type ProfileId = { schema: string; createdAt: string };
export type EdgeMap = Partial<Record<ConeId, EdgeFile>>;

export function saveEdges(store: Store, files: EdgeMap): void {
  const list = Object.values(files).filter(Boolean);
  try {
    if (list.length) store.setItem(EDGES_STORAGE_KEY, JSON.stringify(list));
    else store.removeItem(EDGES_STORAGE_KEY);
  } catch {
    /* sin almacenamiento: los bordes viven solo en la sesión */
  }
}

export function clearEdges(store: Store): void {
  try {
    store.removeItem(EDGES_STORAGE_KEY);
  } catch {
    /* nada */
  }
}

/** Restaura los bordes del perfil activo. Los de otro perfil se descartan (y se borran) y `stale` lo indica. */
export function loadEdges(store: Store, profile: ProfileId): { files: EdgeMap; stale: boolean } {
  let raw: string | null = null;
  try {
    raw = store.getItem(EDGES_STORAGE_KEY);
  } catch {
    return { files: {}, stale: false };
  }
  if (!raw) return { files: {}, stale: false };
  let list: unknown[] = [];
  try {
    const parsed = JSON.parse(raw);
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    list = [];
  }
  const files: EdgeMap = {};
  let stale = false;
  for (const item of list) {
    const file = parseEdgeFile(JSON.stringify(item));
    if (!file) continue;
    if (edgeFitsProfile(file, profile)) files[file.cone] = file;
    else stale = true;
  }
  if (stale) saveEdges(store, files);
  return { files, stale };
}

/** Importar un JSON de bordes (p. ej. descargado en otro navegador): debe ser edges.v1 y del perfil activo. */
export function importEdgeFile(raw: string, profile: ProfileId): { file: EdgeFile } | { error: string } {
  const file = parseEdgeFile(raw);
  if (!file) return { error: "Ese archivo no es un JSON de bordes (umbral.edges.v1)." };
  if (!edgeFitsProfile(file, profile)) return { error: STALE_EDGES_NOTE };
  return { file };
}
