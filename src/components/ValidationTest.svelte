<script lang="ts">
  import { untrack } from "svelte";
  import { cssRgb, toSrgb8, ANCHOR } from "@/lib/color/space";
  import { answerValidation, validationStimulus, type ValidationState } from "@/lib/color/validation";

  let { state: initial, onDone, onSkip }: { state: ValidationState; onDone: (s: ValidationState) => void; onSkip: () => void } = $props();

  let validation = $state.raw<ValidationState>(untrack(() => initial));
  const stim = $derived(validationStimulus(validation));
  const step = $derived(stim?.step);
  let ready = $state(false);

  $effect(() => {
    void step;
    ready = false;
    const id = window.setTimeout(() => (ready = true), 700);
    return () => window.clearTimeout(id);
  });

  const neutral = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));
  const NAMES = ["izquierda", "centro", "derecha"];

  function choose(index: number) {
    if (!ready) return;
    const next = answerValidation(validation, index);
    validation = next;
    if (next.done) onDone(next);
  }
</script>

{#if stim}
  <div class="flex flex-col gap-6" data-testid="validation">
    <div class="flex items-baseline justify-between gap-4">
      <p class="text-sm text-fg">Validación · {stim.step} de {stim.total}</p>
      <p class="text-sm text-fg">Rojos y verdes, con tu brillo</p>
    </div>
    <p class="min-h-12 text-lg leading-snug text-fg" aria-live="polite">{ready ? "Elige el distinto entre los 3." : "Pausa en gris."}</p>
    <div class="mx-auto w-full max-w-md rounded-3xl bg-stage px-4 py-8 sm:px-8">
      <div class="grid grid-cols-3 gap-5 sm:gap-8" role="group" aria-label="Tres campos de color">
        {#each stim.fields as field, i (i)}
          <button
            type="button"
            disabled={!ready}
            onclick={() => choose(i)}
            aria-label={`Elegir el campo de la ${NAMES[i]}`}
            class="aspect-square w-full rounded-full border-2 border-transparent focus-visible:border-accent disabled:cursor-default"
            style:background={ready ? cssRgb(field) : neutral}
            style:transition="none"
          ></button>
        {/each}
      </div>
    </div>
    <p class="text-center text-sm text-fg">Toca el campo de color distinto. Si no lo ves, elige uno al azar.</p>
    <button type="button" onclick={onSkip} class="text-sm text-fg underline underline-offset-4">Saltar la validación. Se queda el umbral del perfil.</button>
  </div>
{/if}
