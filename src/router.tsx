import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    // Coincide con `base` de Vite (BASE_PATH), p. ej. "/umbralxpectre/".
    basepath: import.meta.env.BASE_URL,
    defaultErrorComponent: AppErrorComponent,
  });
}
