/**
 * Router por hash (sin dependencias). Rutas de menú y de fase; las antiguas redirigen;
 * las fases que necesitan un perfil guardado vuelven a #/inicio con aviso si no lo hay.
 */
export const MENU_ROUTES = ["inicio", "nuevo", "importar", "perfiles", "sesiones"] as const;
export const PHASE_ROUTES = ["perfil", "movimiento", "repaso", "resultado", "camara"] as const;
export type Route = (typeof MENU_ROUTES)[number] | (typeof PHASE_ROUTES)[number];

/** Fases que no tienen sentido sin un perfil. `#/perfil` crea uno, así que no lo necesita. */
export const NEEDS_PROFILE: readonly Route[] = ["movimiento", "repaso", "resultado", "camara"];

/** Rutas antiguas o alias → ruta nueva. */
export const LEGACY: Readonly<Record<string, Route>> = {
  "": "inicio",
  intro: "inicio",
  home: "inicio",
  calibrar: "nuevo",
  calibrador: "nuevo",
  calibracion: "perfil",
  test: "perfil",
  luminancia: "movimiento",
  motion: "movimiento",
  review: "repaso",
  done: "resultado",
  resultados: "resultado",
  bordes: "resultado",
  cam: "camara",
  "cámara": "camara",
  importar_json: "importar",
};

export const NO_PROFILE_NOTICE = "Esa fase necesita un perfil. Empieza de cero, importa uno o elige un perfil guardado.";

export interface Resolved {
  route: Route;
  /** Hash canónico al que hay que llevar la URL si difiere del actual (con replaceState). */
  redirect: string | null;
  notice: string | null;
}

const ALL: readonly string[] = [...MENU_ROUTES, ...PHASE_ROUTES];

export const hashOf = (route: Route) => `#/${route}`;

export function resolveRoute(hash: string, hasProfile: boolean): Resolved {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, "").split("?")[0]).replace(/\/+$/, "").toLowerCase();
  let route: Route = ALL.includes(raw) ? (raw as Route) : (LEGACY[raw] ?? "inicio");
  let notice: string | null = null;
  if (NEEDS_PROFILE.includes(route) && !hasProfile) {
    route = "inicio";
    notice = NO_PROFILE_NOTICE;
  }
  const canonical = hashOf(route);
  return { route, redirect: hash === canonical ? null : canonical, notice };
}
