<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import { parseProfile, profileRejectReason, type UmbralProfile } from "@/lib/color/profile";

  let { onProfile }: { onProfile: (profile: UmbralProfile) => void } = $props();
  let input: HTMLInputElement | undefined = $state();
  let error = $state<string | null>(null);

  function onchange(event: Event & { currentTarget: HTMLInputElement }) {
    const target = event.currentTarget;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    void file.text().then((text) => {
      const parsed = parseProfile(text);
      if (!parsed) {
        error = profileRejectReason(text);
        return;
      }
      error = null;
      onProfile(parsed);
    });
  }
</script>

<div class="flex flex-1 flex-col gap-2">
  <input bind:this={input} type="file" accept="application/json,.json" class="hidden" {onchange} />
  <button
    type="button"
    onclick={() => input?.click()}
    class="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border px-6 text-base text-fg"
  ><Upload class="size-4" aria-hidden="true" />Importar JSON</button>
  {#if error}
    <p class="text-sm text-muted">{error}</p>
  {/if}
</div>
