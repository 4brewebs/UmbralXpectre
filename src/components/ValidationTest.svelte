<script lang="ts">
  import { untrack } from "svelte";
  import { cssRgb, toSrgb8, ANCHOR } from "@/lib/color/space";
  import { answerValidation, validationStimulus, type ValidationState } from "@/lib/color/validation";
  import { acceptsAnswer, sectorFill, wheelPlan, WHEEL, type WheelPhase } from "@/lib/color/wheel";

  let { state: initial, onDone, onSkip }: { state: ValidationState; onDone: (s: ValidationState) => void; onSkip: () => void } = $props();

  let validation = $state.raw<ValidationState>(untrack(() => initial));
  const stim = $derived(validationStimulus(validation));
  const step = $derived(stim?.step);
  let phase = $state<WheelPhase>("fade");
  /** Ángulo mostrado (acumulado) y duración del giro CSS en curso (0 = quieto). */
  let angle = $state<number | null>(null);
  let spinMs = $state(0);
  const reduced = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

  $effect(() => {
    void step;
    const target = untrack(() => stim?.rotationDeg ?? 0);
    const stepDeg = untrack(() => stim?.rotationStepDeg ?? 0);
    const plan = wheelPlan(untrack(() => angle), stepDeg, target, reduced, Math.random());
    const timers: number[] = [];
    phase = plan.fadeMs ? "fade" : phase;
    timers.push(
      window.setTimeout(() => {
        if (plan.spinMs) {
          phase = "spin";
          spinMs = plan.spinMs;
          angle = plan.to;
        }
        timers.push(
          window.setTimeout(() => {
            spinMs = 0;
            angle = plan.to;
            phase = "ready";
          }, plan.spinMs),
        );
      }, plan.fadeMs),
    );
    if (angle == null) angle = plan.from;
    return () => timers.forEach((t) => window.clearTimeout(t));
  });

  const neutral = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));
  /** Disco de radio 50 (viewBox −50…50). Línea y triángulo con el grosor de la línea del perfil (0,55rem sobre ~25rem de disco). */
  const R = 50;
  const LINE = 2.2;
  const HUB = 7;
  const xy = (d: number, r: number): [number, number] => [Math.cos(((d - 90) * Math.PI) / 180) * r, Math.sin(((d - 90) * Math.PI) / 180) * r];
  const pt = (d: number, r: number) => xy(d, r).map((v) => v.toFixed(3)).join(" ");
  const sector = (a: number) => `M 0 0 L ${pt(a, R + 1)} A ${R + 1} ${R + 1} 0 0 1 ${pt(a + 120, R + 1)} Z`;
  const hub = `M ${pt(0, HUB)} L ${pt(120, HUB)} L ${pt(240, HUB)} Z`;

  function choose(index: number) {
    if (!acceptsAnswer(phase)) return;
    phase = "fade";
    const next = answerValidation(validation, index);
    validation = next;
    if (next.done) onDone(next);
  }
</script>

{#if stim}
  <div class="flex flex-col gap-6" data-testid="validation" data-phase={phase} data-rotation={stim.rotationDeg}>
    <div class="flex items-baseline justify-between gap-4">
      <p class="text-sm text-fg">Validación · paso {stim.step}</p>
      <p class="text-sm text-fg">Zonas conflictivas, con tu brillo</p>
    </div>
    <p class="min-h-12 text-lg leading-snug text-fg" aria-live="polite">{phase === "ready" ? "Toca el sector distinto. Si no lo ves, elige uno." : "Espera a los colores."}</p>
    <div class="mx-auto aspect-square w-full max-w-md rounded-full bg-stage p-5 sm:p-7">
      <svg viewBox="-50 -50 100 100" class="h-full w-full overflow-hidden rounded-full" role="group" aria-label="Disco en tres sectores">
        <defs><clipPath id="disco"><circle r={R} /></clipPath></defs>
        <g clip-path="url(#disco)">
          <g style:transform={`rotate(${angle ?? 0}deg)`} style:transition={spinMs ? `transform ${spinMs}ms ${WHEEL.easing}` : "none"}>
            {#each stim.fields as field, i (i)}
              <path
                d={sector(120 * i)}
                fill={sectorFill(phase, cssRgb(field), neutral)}
                role="button"
                tabindex={phase === "ready" ? 0 : -1}
                aria-label={`Sector ${i + 1}`}
                aria-disabled={phase !== "ready"}
                data-sector={i}
                style:transition={phase === "fade" ? `fill ${WHEEL.fade}ms linear` : "none"}
                class={phase === "ready" ? "cursor-pointer outline-none" : "outline-none"}
                onclick={() => choose(i)}
                onkeydown={(e) => (e.key === "Enter" || e.key === " ") && choose(i)}
              />
            {/each}
            {#each [0, 1, 2] as i (i)}
              {@const [x, y] = xy(120 * i, R + 2)}
              <line x1="0" y1="0" x2={x} y2={y} stroke="var(--color-stage)" stroke-width={LINE} pointer-events="none" />
            {/each}
            <path d={hub} fill="var(--color-stage)" stroke="var(--color-stage)" stroke-width={LINE} stroke-linejoin="round" pointer-events="none" />
          </g>
        </g>
      </svg>
    </div>
    <p class="text-center text-sm text-fg">Dos sectores son iguales y uno es distinto. Fíjate en el color, no en el brillo.</p>
    <button type="button" onclick={onSkip} class="text-sm text-fg underline underline-offset-4">Saltar la validación. Sin ella no hay filtros.</button>
  </div>
{/if}
