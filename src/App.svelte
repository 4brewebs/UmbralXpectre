<script lang="ts">
  import Calibrator from "@/components/Calibrator.svelte";
  import Portada from "@/components/Portada.svelte";
  import ErrorView from "@/lib/ErrorView.svelte";
  import { BUILD, IS_QA } from "@/lib/env";
  import { resolveRoute, hashOf, type Route } from "@/lib/router";
  import { loadStored } from "@/lib/stored";

  // GitHub Pages sirve 404.html = index.html: una ruta de ruta (no hash) bajo BASE_PATH sigue siendo "Not Found".
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.slice(base.length).replace(/\/index\.html$/, "/");
  const isHome = path === "" || path === "/";

  let route = $state<Route>("inicio");
  let notice = $state<string | null>(null);

  function sync() {
    const r = resolveRoute(window.location.hash, loadStored() !== null);
    if (r.redirect) history.replaceState(null, "", `${window.location.pathname}${window.location.search}${r.redirect}`);
    notice = r.notice;
    route = r.route;
  }
  sync();

  function go(next: Route) {
    if (window.location.hash === hashOf(next)) return;
    window.location.hash = hashOf(next);
  }
</script>

<svelte:window onhashchange={sync} />

{#if IS_QA}
  <div class="pointer-events-none fixed right-2 bottom-2 z-[60] rounded-full border border-border bg-bg px-3 py-1 font-mono text-xs text-muted" data-testid="qa-badge" title="Entorno de pruebas: datos aparte (prefijo qa.)">
    QA · {BUILD.branch} · {BUILD.commit}
  </div>
{/if}

<svelte:boundary>
  {#if !isHome}
    <p>Not Found</p>
  {:else if route === "inicio"}
    <Portada {notice} />
  {:else}
    <Calibrator {route} {go} />
  {/if}
  {#snippet failed(error)}
    <ErrorView {error} />
  {/snippet}
</svelte:boundary>
