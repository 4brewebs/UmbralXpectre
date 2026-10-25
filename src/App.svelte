<script lang="ts">
  import Calibrator from "@/components/Calibrator.svelte";
  import ErrorView from "@/lib/ErrorView.svelte";

  // Una sola página. Cualquier otra ruta bajo BASE_PATH muestra "Not Found",
  // como hacía TanStack Router (GitHub Pages sirve 404.html = index.html).
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.slice(base.length).replace(/\/index\.html$/, "/");
  const isHome = path === "" || path === "/";
</script>

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
