<script lang="ts">
  import { onMount } from "svelte";
  import {
    BLOCK_MS,
    CYCLES_PER_DEG,
    answerMotionV2,
    blockReady,
    requireBlockCatches,
    startBlock,
    viewingSetup,
    MAX_MICHELSON,
    createMotionV2,
    gratingSize,
    degreesOf,
    type MotionV2Meta,
    paintMotionV2,
    periodPx,
    pickTemporal,
    stimulusOf,
    type MotionV2State,
  } from "@/lib/color/motion2";
  import type { UmbralProfile } from "@/lib/color/profile";

  let {
    profile,
    onDone,
    onStop,
  }: {
    profile: UmbralProfile;
    onDone: (state: MotionV2State, meta: MotionV2Meta) => void;
    onStop: () => void;
  } = $props();

  type Step = "consent" | "run" | "pause" | "done";
  let step = $state<Step>("consent");
  let agreed = $state(false);
  let reducedOk = $state(false);
  let reduced = $state(false);
  let refreshHz = $state<number | null>(null);
  // svelte-ignore state_referenced_locally
  let motion = $state.raw<MotionV2State>(createMotionV2(profile, Date.now()));
  let canvas: HTMLCanvasElement | undefined = $state();
  let host: HTMLDivElement | undefined = $state();
  let size = $state({ width: 480, height: 160 });
  let blockStart = 0;
  let viewing = $state<ReturnType<typeof viewingSetup>>({ device: "pc", cm: 60, cssPxPerMm: 1 / 0.26, hint: "un brazo extendido", heuristic: "pc-0.26mm-per-css-px" });
  let block = $state(1);
  let finished = false;

  const temporal = $derived(pickTemporal(refreshHz ?? 60));
  const totalTargets = $derived(motion.stairs.length);
  const doneTargets = $derived(motion.stairs.filter((s) => s.done).length);
  const canStart = $derived(agreed && refreshHz != null && (!reduced || reducedOk));

  onMount(() => {
    viewing = viewingSetup(
      window.screen.width || window.innerWidth,
      window.screen.height || window.innerHeight,
      window.devicePixelRatio || 1,
      window.matchMedia?.("(pointer: coarse)").matches ?? false,
    );
    reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Refresco medido con rAF: mediana de los intervalos de 60 fotogramas.
    const stamps: number[] = [];
    let id = 0;
    const tick = (t: number) => {
      stamps.push(t);
      if (stamps.length < 61) id = window.requestAnimationFrame(tick);
      else {
        const d = stamps.slice(1).map((v, i) => v - stamps[i]).sort((a, b) => a - b);
        const med = d[Math.floor(d.length / 2)];
        refreshHz = med > 0 ? Math.round((1000 / med) * 10) / 10 : 60;
      }
    };
    id = window.requestAnimationFrame(tick);
    const hide = () => {
      if (document.hidden && step === "run") step = "pause";
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", hide);
    };
  });

  $effect(() => {
    if (step !== "run" || !host) return;
    size = gratingSize(host.clientWidth, window.screen.width || window.innerWidth, window.screen.height || window.innerHeight);
  });

  $effect(() => {
    const el = canvas;
    if (step !== "run" || !el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    el.width = w;
    el.height = h;
    const image = ctx.createImageData(w, h);
    const period = periodPx(CYCLES_PER_DEG, viewing.cm, viewing.cssPxPerMm) * dpr;
    const k = temporal.framesPerPhase;
    let frame = 0;
    let id = 0;
    const draw = () => {
      id = window.requestAnimationFrame(draw);
      const stim = stimulusOf(motion);
      if (!stim) return;
      paintMotionV2(image.data, w, h, Math.floor(frame / k) % 4, frame, stim, period);
      ctx.putImageData(image, 0, 0);
      frame++;
    };
    id = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(id);
  });

  $effect(() => {
    if (!motion.complete || finished) return;
    finished = true;
    step = "done";
    onDone(motion, { refreshHz, temporalHz: temporal.hz, cyclesPerDeg: CYCLES_PER_DEG, viewingCm: viewing.cm, deviceType: viewing.device, cssPxPerMm: viewing.cssPxPerMm,
      stimulusDeg: {
        width: Math.round(degreesOf(size.width, viewing.cm, viewing.cssPxPerMm) * 10) / 10,
        height: Math.round(degreesOf(size.height, viewing.cm, viewing.cssPxPerMm) * 10) / 10,
      },
      sizingHeuristic: viewing.heuristic,
    });
  });

  function begin() {
    if (step === "pause") motion = startBlock(motion);
    blockStart = performance.now();
    step = "run";
  }

  function choose(answer: "left" | "right" | "still") {
    motion = answerMotionV2(motion, answer, Date.now());
    if (motion.complete) return;
    if (performance.now() - blockStart > BLOCK_MS) {
      // Antes de la pausa, el bloque completa sus catch trials mínimos.
      if (motion.pendingCatches === 0 && motion.blockCatches < 5) motion = requireBlockCatches(motion);
      if (blockReady(motion)) {
        block += 1;
        step = "pause";
      }
    }
  }
</script>

<div class="flex flex-col gap-6" data-testid="motion-v2">
  <div class="flex items-center justify-between gap-4">
    <p class="text-sm text-muted">Brillo por movimiento · prueba v2 (opcional)</p>
    <button type="button" onclick={onStop} class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg">Parar</button>
  </div>

  {#if step === "consent" || step === "pause"}
    <p class="rounded-2xl border border-accent p-4 text-base text-fg" data-testid="distance">
      <strong>Distancia:</strong> {viewing.device === "phone" ? "móvil" : "ordenador"} — ponte a unos {viewing.cm} cm de la pantalla ({viewing.hint}) y mantenla durante la prueba.
    </p>
  {/if}

  {#if step === "consent"}
    <div class="flex flex-col gap-4 text-base leading-relaxed text-fg">
      <p>Verás una franja de rayas que parpadea a unos {temporal.hz} Hz y parece moverse. Dinos hacia dónde va. Sirve para medir cómo de brillante ves cada color en esta pantalla.</p>
      <p class="rounded-2xl border border-border p-4 text-sm"><strong>Aviso de fotosensibilidad.</strong> Esta prueba contiene parpadeo y colores saturados. Ocupa como mucho una cuarta parte de la pantalla y su contraste de luminancia es bajo, pero no afirmamos que cumpla WCAG 2.3.1. Si tienes epilepsia fotosensible, migrañas con la luz o te mareas, no la hagas. Es opcional: tu perfil de color ya está guardado.</p>
      <p class="text-sm text-muted">Antes de empezar: desactiva True Tone, el modo noche (Night Shift / luz nocturna) y el brillo automático, y no cambies el brillo durante la prueba. Bloques de unos 25 s con pausas. Puedes parar cuando quieras.</p>
      <p class="text-sm text-muted">Refresco medido: {refreshHz == null ? "midiendo…" : `${refreshHz} Hz`}. Contraste de brillo limitado al {Math.round(MAX_MICHELSON * 100)} %.</p>
      {#if reduced}
        <label class="flex items-start gap-3 text-sm"><input type="checkbox" bind:checked={reducedOk} class="mt-1" /> Tu sistema pide reducir el movimiento. Marca esto solo si aun así quieres ver la prueba.</label>
      {/if}
      <label class="flex items-start gap-3 text-sm"><input type="checkbox" bind:checked={agreed} class="mt-1" data-testid="consent" /> He leído el aviso y quiero hacer la prueba.</label>
      <button type="button" disabled={!canStart} onclick={begin} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg disabled:opacity-40">Empezar</button>
    </div>
  {:else if step === "run"}
    <p class="text-sm text-muted">Bloque {block} · {doneTargets} de {totalTargets} colores</p>
    <p class="text-lg leading-snug text-fg">¿Hacia dónde se mueven las rayas? Si no se mueven hacia ningún lado, «Quieto».</p>
    <div bind:this={host} class="flex justify-center">
      <canvas bind:this={canvas} style={`width:${size.width}px;height:${size.height}px`} class="rounded-xl" aria-label="Rayas en movimiento"></canvas>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <button type="button" onclick={() => choose("left")} class="h-16 rounded-2xl border border-border text-base font-semibold text-fg">Izquierda</button>
      <button type="button" onclick={() => choose("still")} class="h-16 rounded-2xl border border-border text-base font-semibold text-fg">Quieto</button>
      <button type="button" onclick={() => choose("right")} class="h-16 rounded-2xl border border-border text-base font-semibold text-fg">Derecha</button>
    </div>
  {:else if step === "pause"}
    <p class="text-lg text-fg">Pausa. Descansa la vista unos segundos.</p>
    <button type="button" onclick={begin} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">Seguir</button>
  {:else}
    <p class="text-lg text-fg">Hecho. Guardando los pesos en tu perfil.</p>
  {/if}
</div>
