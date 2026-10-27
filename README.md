# UmbralXpectre

## Qué es
Ayuda de código abierto para personas con alteraciones de la visión del color. Mide, en tu pantalla, qué diferencias de color separas y cuáles no, y genera un perfil personal (guardado solo en tu navegador, `localStorage`) con el que ajustar la cámara, láminas, bordes y pruebas de movimiento. Todo se ejecuta en el cliente: no hay servidor ni cuentas.

Stack: Svelte 5 (runes) + Vite + Tailwind CSS 4. SPA de una sola página, sin SvelteKit ni servidor. La lógica de color (`src/lib/color/*`) es TypeScript puro e independiente del framework.

## Desarrollo local
Requiere Node.js 22 (LTS) o superior.

```bash
npm install
npm run dev        # http://localhost:8080
npm run check      # svelte-check (tipos de .svelte y .ts)
npm run lint
npm test           # autochequeo de src/lib/color
```

## Build
```bash
npm run build      # genera dist/ (SPA estática, con 404.html y .nojekyll)
npm run preview    # sirve dist/ en http://127.0.0.1:8081
```

La ruta base se configura con `BASE_PATH` (por defecto `/`). En GitHub Actions, si no se define, se deriva de `GITHUB_REPOSITORY` (`/<repo>/`):

```bash
BASE_PATH=/umbralxpectre/ npm run build
```

## Despliegue en GitHub Pages
1. En el repositorio: **Settings > Pages > Source: GitHub Actions**.
2. El workflow `.github/workflows/deploy.yml` se lanza con cada push a `main` o `develop` (y con una release o *Run workflow*). Saca las dos ramas, compila las dos y publica un solo sitio:
   - `main` → producción en la raíz: https://4brewebs.github.io/UmbralXpectre/
   - `develop` → QA en `/qa/`: https://4brewebs.github.io/UmbralXpectre/qa/ (`BASE_PATH=/UmbralXpectre/qa/`, `VITE_APP_ENV=qa`).
3. El entorno `github-pages` debe permitir desplegar desde `main` y `develop`.

### Entorno QA
- Claves de `localStorage` (y de IndexedDB cuando llegue) con prefijo `qa.`: QA no toca los datos de producción.
- Insignia «QA · rama · commit» abajo a la derecha.
- Por defecto en QA: prueba de brillo v3 y QUEST+. Los flags siguen mandando en los dos entornos (`?motion=v1|v2|v3`, `?qp=0|1`). En QA el flag guardado es `qa.umbral-motion`.
- Cada build lleva entorno, rama y commit corto (Vite `define`), y se guardan en el perfil (`build`), en cada sesión del historial y en la luminancia, junto a la versión de interfaz (`ui`: legacy|v2|v3).

Flujo de trabajo: ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia
[MIT](LICENSE) © 2026 Lucas Serrano Pérez
