# UmbralXpectre

## Qué es
Ayuda de código abierto para personas con alteraciones de la visión del color. Mide, en tu pantalla, qué diferencias de color separas y cuáles no, y genera un perfil personal (guardado solo en tu navegador, `localStorage`) con el que ajustar la cámara, láminas, bordes y pruebas de movimiento. Todo se ejecuta en el cliente: no hay servidor ni cuentas.

Stack: React 19 + TanStack Router + Vite + Tailwind CSS 4.

## Desarrollo local
Requiere Node.js 22 (LTS) o superior.

```bash
npm install
npm run dev        # http://localhost:8080
npm run typecheck
npm run lint
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
1. Crea un repositorio público y sube el código a la rama `main`.
2. En el repositorio: **Settings > Pages > Source: GitHub Actions**.
3. El workflow `.github/workflows/deploy.yml` compila y publica en cada push a `main`, al publicar una release o manualmente (*Run workflow*).
4. La web quedará en `https://<usuario>.github.io/<repo>/`.

## Licencia
[MIT](LICENSE) © 2026 Lucas Serrano Pérez
