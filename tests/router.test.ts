import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute, NO_PROFILE_NOTICE } from "../src/lib/router";

test("router: la raíz y lo desconocido van a #/inicio", () => {
  for (const h of ["", "#", "#/", "#/nada"]) assert.deepEqual(resolveRoute(h, false), { route: "inicio", redirect: "#/inicio", notice: null });
  assert.equal(resolveRoute("#/inicio", false).redirect, null);
});

test("router: rutas antiguas redirigen", () => {
  assert.equal(resolveRoute("#/calibrador", false).redirect, "#/nuevo");
  assert.equal(resolveRoute("#/resultados", true).redirect, "#/resultado");
  assert.equal(resolveRoute("#/intro", true).route, "inicio");
});

test("router: guardas de perfil", () => {
  for (const r of ["movimiento", "repaso", "resultado", "camara"]) {
    assert.deepEqual(resolveRoute(`#/${r}`, false), { route: "inicio", redirect: "#/inicio", notice: NO_PROFILE_NOTICE });
    assert.deepEqual(resolveRoute(`#/${r}`, true), { route: r, redirect: null, notice: null });
  }
  for (const r of ["perfil", "nuevo", "importar", "perfiles", "sesiones"]) assert.equal(resolveRoute(`#/${r}`, false).route, r);
});
