<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import { parseProfile, profileRejectReason, type UmbralProfile } from "@/lib/color/profile";
  import { importEdgeFile } from "@/lib/color/edgestore";
  import type { EdgeFile } from "@/lib/color/edges";

  let {
    onProfile,
    edgeProfile = null,
    onEdges,
  }: {
    onProfile: (profile: UmbralProfile) => void;
    /** Perfil activo: con él se ofrece importar un JSON de bordes (debe encajar por basedOn.createdAt). */
    edgeProfile?: UmbralProfile | null;
    onEdges?: (file: EdgeFile) => void;
  } = $props();
  let input: HTMLInputElement | undefined = $state();
  let edgeInput: HTMLInputElement | undefined = $state();

  function onEdgeChange(event: Event & { currentTarget: HTMLInputElement }) {
    const target = event.currentTarget;
    const file = target.files?.[0];
    target.value = "";
    if (!file || !edgeProfile || !onEdges) return;
    void file.text().then((text) => {
      const out = importEdgeFile(text, edgeProfile);
      if ("error" in out) {
        error = out.error;
        return;
      }
      error = null;
      onEdges(out.file);
    });
  }
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
  {#if edgeProfile && onEdges}
    <input bind:this={edgeInput} type="file" accept="application/json,.json" class="hidden" onchange={onEdgeChange} />
    <button
      type="button"
      onclick={() => edgeInput?.click()}
      class="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border px-6 text-base text-fg"
    ><Upload class="size-4" aria-hidden="true" />Importar JSON de bordes</button>
  {/if}
  {#if error}
    <p class="text-sm text-muted">{error}</p>
  {/if}
</div>
