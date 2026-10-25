<script lang="ts">
  import Calibrator from "@/components/Calibrator.svelte";
  import ErrorView from "@/lib/ErrorView.svelte";
  import { BUILD, IS_QA } from "@/lib/env";

  // Una sola página. Cualquier otra ruta bajo BASE_PATH muestra "Not Found",
  // como hacía TanStack Router (GitHub Pages sirve 404.html = index.html).
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.slice(base.length).replace(/\/index\.html$/, "/");
  const isHome = path === "" || path === "/";
</script>

{#if IS_QA}
  <div class="pointer-events-none fixed right-2 bottom-2 z-[60] rounded-full border border-border bg-bg px-3 py-1 font-mono text-xs text-muted" data-testid="qa-badge" title="Entorno de pruebas: datos aparte (prefijo qa.)">
    QA · {BUILD.branch} · {BUILD.commit}
  </div>
{/if}

<svelte:boundary>
  {#if isHome}
    <Calibrator />
  {:else}
    <p>Not Found</p>
  {/if}
  {#snippet failed(error)}
    <ErrorView {error} />
  {/snippet}
</svelte:boundary>
