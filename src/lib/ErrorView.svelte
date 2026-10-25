<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";

  const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
  let { error }: { error: unknown } = $props();

  function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    return FALLBACK_MESSAGE;
  }
</script>

<main
  class="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
>
  <span class="text-red-500" aria-hidden="true">
    <TriangleAlert class="size-10" strokeWidth={2} />
  </span>
  <h1 class="text-lg font-semibold">Something went wrong</h1>
  <p class="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">{errorMessage(error)}</p>
</main>
