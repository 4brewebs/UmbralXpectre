<script lang="ts">
  import { answerMotion, createMotion, luminanceResult, paintMotion, pairOf, type LuminanceResult, type MotionState } from "@/lib/color/motion";
  import type { UmbralProfile } from "@/lib/color/profile";

  const WIDTH = 640;
  const HEIGHT = 280;

  let {
    profile,
    onDone,
    onSkip,
  }: {
    profile: UmbralProfile;
    onDone: (result: LuminanceResult) => void;
    onSkip: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let motion = $state.raw<MotionState>(createMotion(profile));
  let canvas: HTMLCanvasElement | undefined = $state();
  let finished = false;
  const complete = $derived(motion.complete);

  $effect(() => {
    const el = canvas;
    if (!el || complete) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      const pair = pairOf(motion);
      if (!pair) return;
      paintMotion(ctx, el.width, el.height, pair.test, pair.ref, motion.sign, (now - started) / 1000);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!motion.complete || finished) return;
    finished = true;
    onDone(luminanceResult(motion));
  });

  const target = $derived(motion.targets[motion.index]);

  function choose(side: "left" | "right" | "still") {
    motion = answerMotion(motion, side, Date.now());
  }
</script>

{#if !motion.complete}
  {#if !target}
    <p class="text-sm text-muted">No hay un eje medido del que sacar el brillo.</p>
  {:else}
    <div class="flex flex-col gap-6">
      <div class="flex items-baseline justify-between gap-4">
        <p class="text-sm text-muted">{motion.index + 1} de {motion.targets.length}</p>
        <p class="text-sm text-muted">{target.kind === "cruce" ? "Cruce" : target.kind === "extremo" ? "Extremo" : "Regla"}</p>
      </div>
      <p class="text-lg leading-snug text-fg">{target.kind === "control" ? `Regla, «${target.hue}» frente a gris. No es una franja débil.` : target.kind === "cruce" ? `Franja, «${target.hue}» frente a «${target.refHue}». Las dos caen donde el primer test no separa.` : `Dentro de «${target.hue}», el tramo que no separas.`} ¿Hacia dónde se mueven las franjas más oscuras? Si solo laten, Quieto.</p>
      <canvas bind:this={canvas} width={WIDTH} height={HEIGHT} class="h-44 w-full rounded-2xl bg-stage" aria-label="Campo de color en movimiento"></canvas>
      <p class="text-sm text-muted">{motion.phase === "down" ? "Hacia oscuro, hasta que vuelva a moverse." : motion.phase === "up" ? "Hacia claro, hasta el otro corte." : motion.phase === "bisect" ? "Partiendo el salto donde cambió el sentido." : "Saltos grandes, hasta el primer quieto. Luego se miden los dos cortes."}</p>
      <div class="grid grid-cols-3 gap-3">
        <button type="button" onclick={() => choose("left")} class="h-16 rounded-2xl border border-border text-base font-semibold text-fg">Izquierda</button>
        <button type="button" onclick={() => choose("still")} class="h-16 rounded-2xl bg-accent text-base font-semibold text-accent-fg">Quieto</button>
        <button type="button" onclick={() => choose("right")} class="h-16 rounded-2xl border border-border text-base font-semibold text-fg">Derecha</button>
      </div>
      <button type="button" onclick={onSkip} class="text-sm text-muted">Saltar el brillo. El perfil de color se queda.</button>
    </div>
  {/if}
{/if}
