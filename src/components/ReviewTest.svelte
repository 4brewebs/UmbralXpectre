<script lang="ts">
  import { untrack } from "svelte";
  import { cssRgb, toSrgb8, ANCHOR } from "@/lib/color/space";
  import { answerReview, reviewStimulus, type ReviewState } from "@/lib/color/review";

  let { state: initial, onDone, onSkip }: { state: ReviewState; onDone: (s: ReviewState) => void; onSkip: () => void } = $props();

  let review = $state.raw<ReviewState>(untrack(() => initial));
  const stim = $derived(reviewStimulus(review));
  const step = $derived(stim?.step);
  let ready = $state(false);
  let flip = $state(false);

  $effect(() => {
    void step;
    ready = false;
    flip = Math.random() < 0.5;
    const id = window.setTimeout(() => (ready = true), 700);
    return () => window.clearTimeout(id);
  });

  const neutral = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));

  function choose(different: boolean) {
    const next = answerReview(review, different);
    review = next;
    if (next.done) onDone(next);
  }
</script>

{#if stim}
  <div class="flex flex-col gap-6">
    <div class="flex items-baseline justify-between gap-4">
      <p class="text-sm text-muted">Repaso corto · {stim.step} de {stim.total}</p>
      <p class="text-sm text-muted">Rojos y verdes, con tu brillo</p>
    </div>
    <p class="min-h-12 text-lg leading-snug text-fg" aria-live="polite">{ready ? "¿Iguales o distintos?" : "Pausa en gris. No juzgues el cambio."}</p>
    <div class="mx-auto aspect-square w-full max-w-md rounded-full bg-stage p-5 sm:p-7">
      {#if ready}
        <div class="grid h-full grid-cols-[1fr_0.55rem_1fr] overflow-hidden rounded-full" role="img" aria-label="Dos campos del repaso">
          <div style:background={cssRgb(flip ? stim.comparison : stim.reference)} style:transition="none"></div>
          <div class="bg-stage"></div>
          <div style:background={cssRgb(flip ? stim.reference : stim.comparison)} style:transition="none"></div>
        </div>
      {:else}
        <div class="h-full rounded-full" style:background={neutral} role="img" aria-label="Pausa gris"></div>
      {/if}
    </div>
    <p class="text-center text-sm text-muted">Si solo notas el salto, son iguales.</p>
    <p class="text-center text-xs text-muted">Fíjate en el color, no en el brillo.</p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button type="button" disabled={!ready} onclick={() => choose(false)} class="h-14 rounded-2xl border border-border bg-surface text-base font-medium text-fg disabled:opacity-40">Iguales</button>
      <button type="button" disabled={!ready} onclick={() => choose(true)} class="h-14 rounded-2xl border border-border bg-surface text-base font-medium text-fg disabled:opacity-40">Distintos</button>
    </div>
    <button type="button" onclick={onSkip} class="text-sm text-muted">Saltar el repaso. Se queda el umbral con el brillo estándar.</button>
  </div>
{/if}
