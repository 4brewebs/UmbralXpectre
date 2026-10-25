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
    patchSize,
    pxOfDegrees,
    patchMask,
    gray255,
    SCREEN,
    questPlusEnabled,
    degreesOf,
    type MotionV2Meta,
    paintMotionV2,
    periodPx,
    pickTemporal,
    stimulusOf,
    type MotionV2State,
  } from "@/lib/color/motion2";
  import type { UmbralProfile } from "@/lib/color/profile";
  import MotionReticle from "./MotionReticle.svelte";

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
  let isi = $state(false);
  // Pantalla de prueba: fondo uniforme y constante en toda la sesión (la red se centra en él).
  const bgY = $derived(motion.bgY);
  const shade = (weber: number) => {
    const g = gray255(bgY * (1 + weber));
    return `rgb(${g},${g},${g})`;
  };
  const marginPx = $derived(pxOfDegrees(SCREEN.marginDeg, viewing.cm, viewing.cssPxPerMm));

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
    size = patchSize(viewing.cm, viewing.cssPxPerMm, host.clientWidth, window.screen.width || window.innerWidth, window.screen.height || window.innerHeight);
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
    const pxDeg = (deg: number) => pxOfDegrees(deg, viewing.cm, viewing.cssPxPerMm) * dpr;
    const mask = patchMask(w, h, pxDeg(SCREEN.edgeDeg), pxDeg(SCREEN.gapDeg / 2));
    const dot = Math.max(1.5 * dpr, pxDeg(SCREEN.dotDeg) / 2);
    let frame = 0;
    let id = 0;
    const draw = () => {
      id = window.requestAnimationFrame(draw);
      const stim = stimulusOf(motion);
      if (!stim || isi) return;
      paintMotionV2(image.data, w, h, Math.floor(frame / k) % 4, frame, stim, period, mask);
      ctx.putImageData(image, 0, 0);
      // Fijación: punto acromático de 0.15° en el hueco de 0.5° (gris medio).
      const g = gray255(motion.bgY * (1 + SCREEN.dotWeber));
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, dot, 0, 2 * Math.PI);
      ctx.fill();
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

  async function begin() {
    if (step === "consent" && questPlusEnabled(window.location.search)) {
      // QUEST+ tras flag: la librería se carga perezosamente solo aquí.
      const { loadQuestPlus } = await import("@/lib/color/questplus");
      motion = createMotionV2(profile, Date.now(), await loadQuestPlus());
    }
    if (step === "pause") motion = startBlock(motion);
    blockStart = performance.now();
    step = "run";
  }

  function choose(answer: "left" | "right" | "still") {
    if (isi) return;
    motion = answerMotionV2(motion, answer, Date.now());
    // Háptica suave en móvil, si hay soporte y no se pide reducir el movimiento.
    if (!reduced && viewing.device === "phone") navigator.vibrate?.(8);
    // Intervalo entre ensayos: 0.5 s de gris neutro uniforme.
    isi = true;
    window.setTimeout(() => (isi = false), SCREEN.isiMs);
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
    <div
      class="fixed inset-0 z-50 flex flex-col items-center justify-between p-4 font-mono"
      style={`background:${shade(0)};color:${shade(-SCREEN.textWeber)}`}
      data-testid="test-screen"
    >
      <div class="flex w-full items-center justify-between text-xs">
        <span>{doneTargets}/{totalTargets}</span>
        <button type="button" onclick={onStop} class="rounded-full border px-4 py-2 text-sm" style={`border-color:${shade(-SCREEN.lineWeber)}`}>Parar</button>
      </div>
      <p class="text-center text-sm tracking-wide" style={`color:${shade(-SCREEN.uiWeber)}`}>Mira el punto central. ¿Hacia dónde se mueven las rayas?</p>
      <div bind:this={host} class="flex w-full justify-center">
        <MotionReticle
          width={size.width}
          height={size.height}
          {marginPx}
          {shade}
          progress={totalTargets ? doneTargets / totalTargets : 0}
          labels={{
            tl: refreshHz == null ? "— hz" : `${refreshHz.toFixed(1)} hz`,
            tr: `${CYCLES_PER_DEG.toFixed(1)} c/°`,
            bottom: `bloque ${block} · ensayo ${motion.log.length + 1}`,
          }}
        >
          <!-- Al responder se funde a gris (solo en el ISI); al empezar el ensayo aparece sin transición. -->
          <canvas
            bind:this={canvas}
            style={`width:${size.width}px;height:${size.height}px;opacity:${isi ? 0 : 1};transition:${isi && !reduced ? "opacity 150ms ease-out" : "none"}`}
            aria-label="Rayas en movimiento"
          ></canvas>
        </MotionReticle>
      </div>
      <p class="text-center text-xs tracking-wide" style={`color:${shade(-SCREEN.uiWeber)}`}>Sin prisa. No hay respuestas malas.</p>
      <div class="grid w-full max-w-md grid-cols-3 gap-3">
        {#each [["left", "Izquierda"], ["still", "Quieto"], ["right", "Derecha"]] as [v, label] (v)}
          <button
            type="button"
            disabled={isi}
            onclick={() => choose(v as "left" | "right" | "still")}
            class="h-14 rounded-2xl border text-base"
            style={`border-color:${shade(-SCREEN.uiWeber)};color:${shade(-SCREEN.uiWeber)}`}>{label}</button
          >
        {/each}
      </div>
    </div>
  {:else if step === "pause"}
    <p class="text-lg text-fg">Buen trabajo, un bloque menos.</p>
    <p class="text-base text-muted">Descansa la vista el tiempo que quieras. Seguimos cuando pulses «Seguir».</p>
    <button type="button" onclick={begin} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">Seguir</button>
  {:else}
    <p class="text-lg text-fg">Hecho. Guardando los pesos en tu perfil.</p>
  {/if}
</div>
