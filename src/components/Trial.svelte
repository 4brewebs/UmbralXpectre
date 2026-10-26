<script lang="ts">
  import { cssRgb, toSrgb8, ANCHOR } from "@/lib/color/space";
  import { stimulusOf, type Judgment, type Session } from "@/lib/color/session";
  import { axisRank } from "@/lib/color/profile";

  let { session, onChoose }: { session: Session; onChoose: (j: Judgment) => void } = $props();

  const stim = $derived(stimulusOf(session));
  const step = $derived(stim?.step);
  let ready = $state(false);

  $effect(() => {
    void step;
    ready = false;
    const id = window.setTimeout(() => (ready = true), 700);
    return () => window.clearTimeout(id);
  });

  const left = $derived(stim ? (stim.side === "left" ? stim.comparison : stim.reference) : null);
  const right = $derived(stim ? (stim.side === "left" ? stim.reference : stim.comparison) : null);
  const priors = $derived(
    session.axes
      .filter((a) => a.priorKey !== "refine")
      .slice()
      .sort((a, b) => axisRank(a) - axisRank(b)),
  );
  const neutral = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));
</script>

{#if stim && left && right}
  <div class="flex flex-col gap-6">
    <div class="flex items-baseline justify-between gap-4">
      <p class="text-sm text-muted">Paso {stim.step}</p>
      <p class="text-sm text-muted">{stim.catch ? "Mira las dos, en reposo." : stim.refining ? "Afinando al lado" : `Eje ${Math.max(1, priors.findIndex((axis) => axis.id === session.activeId) + 1)} de ${stim.priorTotal}`}</p>
    </div>
    <p class="min-h-12 text-lg leading-snug text-fg" aria-live="polite">{ready ? session.note : "Pausa en gris. No juzgues el cambio."}</p>
    <div class="mx-auto aspect-square w-full max-w-md rounded-full bg-stage p-5 sm:p-7">
      {#if ready}
        <div class="grid h-full grid-cols-[1fr_0.55rem_1fr] overflow-hidden rounded-full" role="img" aria-label={`Dos campos. Contraste ${stim.hue}.`}>
          <div style:background={cssRgb(left)} style:transition="none"></div>
          <div class="bg-stage"></div>
          <div style:background={cssRgb(right)} style:transition="none"></div>
        </div>
      {:else}
        <div class="h-full rounded-full" style:background={neutral} role="img" aria-label="Pausa gris"></div>
      {/if}
    </div>
    <p class="text-center text-sm text-muted">Misma luminosidad y misma saturación. Si solo notas el salto, son iguales.</p>
    <p class="text-center text-xs text-muted">Fíjate en el color, no en el brillo.</p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button type="button" disabled={!ready} onclick={() => onChoose("same")} class="h-14 rounded-2xl border border-border bg-surface text-base font-medium text-fg disabled:opacity-40">Iguales</button>
      <button type="button" disabled={!ready} onclick={() => onChoose("different")} class="h-14 rounded-2xl border border-border bg-surface text-base font-medium text-fg disabled:opacity-40">Distintos</button>
    </div>
    <ul class="grid grid-cols-2 gap-2">
      {#each priors as axis (axis.id)}
        {@const state = axis.phase !== "done" ? (axis.id === session.activeId ? "ahora" : "espera") : axis.thresholdKind === "upper-bound" ? "fino" : "medido"}
        <li class="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
          <span class="text-fg">{axis.hue}</span>
          <span class="text-muted">{state}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
