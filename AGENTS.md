# AGENTS.md — UmbralXpectre

Guía para cualquier agente o persona que trabaje en este repositorio. Léela entera antes de tocar código.

## Qué es
UmbralXpectre es una herramienta open source (licencia MIT) de ayuda para personas daltónicas. Mide la visión del color del usuario en su propia pantalla (calibrador de umbrales, test de bordes y test de movimiento para el brillo) y con ese perfil aplica filtros (Simulador, Mapa intermedio, Asistencia y Extremo) sobre láminas, bordes, animaciones y la cámara en tiempo real.

No es un diagnóstico médico. Las láminas son elementos visuales para probar y enseñar los filtros, no un test.

## Stack
- Svelte 5 (runes) + Vite, SPA 100 % cliente, sin SvelteKit; router por hash propio en `src/lib/router.ts` (`#/inicio`, `#/nuevo`, `#/importar`, `#/perfiles`, `#/sesiones` y las fases `#/perfil`, `#/movimiento`, `#/repaso`, `#/resultado`, `#/camara`).
- Tailwind CSS 4 (`src/styles.css`).
- Iconos: `@lucide/svelte`.
- TypeScript estricto; `svelte-check` como typecheck.
- Sin backend, sin login y sin base de datos: los perfiles viven en `localStorage` y se importan o exportan como JSON.
- Despliegue: GitHub Pages con GitHub Actions (`.github/workflows/deploy.yml`). Nada de Vercel, Nitro ni servidores.

## Estructura
- `src/main.ts`, `src/App.svelte`: arranque; la ruta base muestra el calibrador y cualquier otra muestra "Not Found".
- `src/components/*.svelte`: interfaz (Calibrator, Intro, ImportJson, Trial, Result, ConeCard, MotionTest, EdgeTest, Plates, AssistCamera).
- `src/components/camera.ts`, `plates.ts`: lógica no visual de la cámara (WebGL2, shaders, LUT 3D) y de las láminas.
- `src/lib/color/*.ts`: toda la ciencia del color en TypeScript puro, sin dependencias del framework:
  - `space.ts`: sRGB lineal, XYZ D65, LMS, luminancia (`luminance`, `killLuminance`).
  - `session.ts`: estímulos y escaleras del calibrador.
  - `profile.ts`: ajuste del perfil y su esquema JSON (`umbral.profile.v2`).
  - `edges.ts`: test de bordes (`umbral.edges.v1`).
  - `motion.ts`: test de movimiento (luminancia).
  - `spectrum.ts`: modelo de filtros, bandas y brillo.
  - `lut.ts`: LUTs 3D y exportación `umbral.transforms.v1`.
  - `selfcheck.ts`: autocomprobaciones (`npm test`).
- `TODO.md`: pendientes priorizados. `PLAN-luminancia.md`: plan aprobado del rediseño del test de movimiento.

## Comandos (Node 22 LTS)
- `npm run dev`: servidor de desarrollo en el puerto 8080.
- `npm run build`: build estático en `dist/`. `BASE_PATH=/umbralxpectre/ npm run build` reproduce el de Pages; en CI la base sale de `actions/configure-pages` o de `GITHUB_REPOSITORY`.
- `npm run preview`, `npm run check`, `npm run lint`, `npm test`, `npm run format`.

## Reglas
1. Antes de cambiar código, describe exactamente qué vas a cambiar y espera el OK del propietario (Lucas Serrano Pérez).
2. `src/lib/color/*` debe seguir siendo TypeScript puro y sin dependencias del framework. Los cambios de ciencia del color se validan antes con el responsable de colorimetría y se cubren con `selfcheck` o tests.
3. Trabajar siempre en sRGB lineal para el cálculo y aplicar la curva de transferencia solo al mostrar.
4. Mantener la compatibilidad de los JSON exportados: si cambia el significado de un esquema, se sube de versión (v2 a v3) con migración.
5. La app debe seguir siendo estática: nada de server functions, SSR, cookies de sesión ni servicios de pago.
6. Las rutas y assets deben funcionar bajo una sub-ruta (`import.meta.env.BASE_URL`); el build genera `404.html` y `.nojekyll`.
7. Un commit por paso lógico, con mensajes en español en el estilo `tipo: descripción` (`feat`, `fix`, `chore`, `docs`).
8. Los avisos de fotosensibilidad y los límites de contraste y área en los tests con animación no son opcionales.
