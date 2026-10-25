import { fileURLToPath } from "node:url";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

/**
 * Base path: BASE_PATH tiene prioridad; si no, en GitHub Actions se deriva
 * "/<repo>/" de GITHUB_REPOSITORY; en local "/".
 */
function resolveBase(): string {
  let base = process.env.BASE_PATH;
  if (!base && process.env.GITHUB_REPOSITORY) {
    const repo = process.env.GITHUB_REPOSITORY.split("/")[1];
    // Un repo <user>.github.io se sirve en la raíz.
    base = repo && !repo.endsWith(".github.io") ? `/${repo}/` : "/";
  }
  base = base || "/";
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return base;
}

/** GitHub Pages: 404.html = index.html (fallback SPA) y .nojekyll. */
function githubPagesPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "github-pages-spa",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(join(outDir, "index.html"), join(outDir, "404.html"));
      writeFileSync(join(outDir, ".nojekyll"), "");
    },
  };
}

export default defineConfig({
  base: resolveBase(),
  server: { host: "0.0.0.0", port: 8080 },
  preview: { host: "127.0.0.1", port: 8081 },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist" },
  plugins: [
    tailwindcss(),
    svelte(),
    githubPagesPlugin(),
  ],
});
