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
  // v3: transición a pantalla completa (1 s), adaptación al gris (2 s) y vuelta a la app (1 s).
  const FADE_MS = 1000;
  const ADAPT_MS = 2000;
  let veil = $state(0);
  let adapting = $state(false);
  let leaving = $state(false);
  /** Texto y botones de la pantalla de prueba: gris #A0A0A0 sobre #6B6B6B (Michelson ≈ 41 %), sin blanco. */
  const UI_GRAY = "#A0A0A0";
  const oneDegPx = $derived(pxOfDegrees(1, viewing.cm, viewing.cssPxPerMm));
  const fadeMs = $derived(reduced ? 0 : FADE_MS);
  const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
  /** Funde la pantalla de prueba y sale a `next` (solo se llama dentro del ISI). */
  async function leave(next: Step) {
    leaving = true;
    veil = 0;
    await wait(fadeMs);
    step = next;
    leaving = false;
  }

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
      if (!stim || isi || adapting || leaving) {
        // Adaptación e ISI: solo fondo uniforme y punto de fijación.
        const g0 = gray255(motion.bgY);
        ctx.fillStyle = `rgb(${g0},${g0},${g0})`;
        ctx.fillRect(0, 0, w, h);
        const gd = gray255(motion.bgY * (1 + SCREEN.dotWeber));
        ctx.fillStyle = `rgb(${gd},${gd},${gd})`;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, dot, 0, 2 * Math.PI);
        ctx.fill();
        return;
      }
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
    const done = () =>
      onDone(motion, { refreshHz, temporalHz: temporal.hz, cyclesPerDeg: CYCLES_PER_DEG, viewingCm: viewing.cm, deviceType: viewing.device, cssPxPerMm: viewing.cssPxPerMm,
      stimulusDeg: {
        width: Math.round(degreesOf(size.width, viewing.cm, viewing.cssPxPerMm) * 10) / 10,
        height: Math.round(degreesOf(size.height, viewing.cm, viewing.cssPxPerMm) * 10) / 10,
      },
      sizingHeuristic: viewing.heuristic,
    });
    // Vuelta a la app con fundido; después se guarda.
    void leave("done").then(done);
  });

  async function begin() {
    if (step === "consent" && questPlusEnabled(window.location.search)) {
      // QUEST+ tras flag: la librería se carga perezosamente solo aquí.
      const { loadQuestPlus } = await import("@/lib/color/questplus");
      motion = createMotionV2(profile, Date.now(), await loadQuestPlus());
    }
    if (step === "pause") motion = startBlock(motion);
    veil = 0;
    adapting = true;
    step = "run";
    await wait(20);
    veil = 1;
    await wait(fadeMs + ADAPT_MS);
    adapting = false;
    blockStart = performance.now();
  }

  function choose(answer: "left" | "right" | "still") {
    if (isi || adapting || leaving) return;
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
        void leave("pause");
      }
    }
  }
</script>

<div class="flex flex-col gap-6" data-testid="motion-v3">
  {#if step === "consent"}
    <div class="flex flex-col gap-5">
      <h2 class="font-serif text-2xl text-fg">Brillo por movimiento</h2>
      <p class="text-lg leading-snug text-fg">Verás una mancha de rayas en el centro que parpadea a unos {temporal.hz} Hz y parece moverse. Mira el punto central y dinos hacia dónde van. Si solo laten, Quieto.</p>
      <p class="rounded-2xl border border-border p-4 text-base text-fg" data-testid="distance">
        <strong>Distancia:</strong> {viewing.device === "phone" ? "móvil" : "ordenador"} — ponte a unos {viewing.cm} cm de la pantalla ({viewing.hint}) y mantenla durante la prueba.
      </p>
      <p class="rounded-2xl border border-border p-4 text-sm text-fg"><strong>Aviso de fotosensibilidad.</strong> Esta prueba contiene parpadeo y colores saturados. Ocupa como mucho una cuarta parte de la pantalla y su contraste de luminancia es bajo, pero no afirmamos que cumpla WCAG 2.3.1. Si tienes epilepsia fotosensible, migrañas con la luz o te mareas, no la hagas. Es opcional: tu perfil de color ya está guardado.</p>
      <p class="text-sm text-muted">Antes de empezar: desactiva True Tone, el modo noche y el brillo automático, y no cambies el brillo durante la prueba. Bloques de unos 25 s con pausas. Refresco medido: {refreshHz == null ? "midiendo…" : `${refreshHz} Hz`}.</p>
      {#if reduced}
        <label class="flex items-start gap-3 text-sm text-fg"><input type="checkbox" bind:checked={reducedOk} class="mt-1" /> Tu sistema pide reducir el movimiento. Marca esto solo si aun así quieres ver la prueba.</label>
      {/if}
      <label class="flex items-start gap-3 text-sm text-fg"><input type="checkbox" bind:checked={agreed} class="mt-1" data-testid="consent" /> He leído el aviso y quiero hacer la prueba.</label>
      <div class="grid grid-cols-2 gap-3">
        <button type="button" onclick={onStop} class="h-14 rounded-2xl border border-border text-base font-semibold text-fg">Ahora no</button>
        <button type="button" disabled={!canStart} onclick={begin} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg disabled:opacity-40">Empezar</button>
      </div>
    </div>
  {:else if step === "run"}
    <!-- Parche centrado en la pantalla como en v2; texto a 1,5° del parche (≥ 1°), botones abajo, en #A0A0A0 (Michelson ≈ 41 % sobre #6B6B6B). -->
    <div
      class="fixed inset-0 z-50"
      style={`background:${shade(0)};color:${UI_GRAY};opacity:${veil};transition:opacity ${fadeMs}ms ease-in-out`}
      data-testid="test-screen"
    >
      <div class="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-sm sm:p-8">
        <span>{doneTargets} de {totalTargets}</span>
        <button type="button" onclick={onStop} class="h-10 rounded-2xl border px-4 text-sm font-semibold" style={`border-color:${UI_GRAY};color:${UI_GRAY}`}>Parar</button>
      </div>
      <p
        class="absolute inset-x-0 px-4 text-center text-base leading-snug"
        style={`bottom:calc(50% + ${size.height / 2 + 1.5 * oneDegPx}px)`}
        data-testid="instructions"
      >
        Mira el punto central.<br />{adapting ? "Empezamos en un momento." : "¿Hacia dónde se mueven las rayas?"}
      </p>
      <div bind:this={host} class="absolute inset-x-4 flex justify-center" style={`top:calc(50% - ${size.height / 2}px)`}>
        <!-- Mismo estímulo y fijación que v2; sin retícula. Al responder se funde a gris (solo en el ISI). -->
        <canvas
          bind:this={canvas}
          style={`width:${size.width}px;height:${size.height}px;opacity:${isi ? 0 : 1};transition:${isi && !reduced ? "opacity 150ms ease-out" : "none"}`}
          aria-label="Rayas en movimiento"
          data-testid="patch"
        ></canvas>
      </div>
      <div class="absolute inset-x-0 bottom-0 flex justify-center p-4 sm:p-8">
        <div class="grid w-full max-w-md grid-cols-3 gap-3">
          {#each [["left", "Izquierda"], ["still", "Quieto"], ["right", "Derecha"]] as [v, label] (v)}
            <button
              type="button"
              disabled={isi || adapting || leaving}
              onclick={() => choose(v as "left" | "right" | "still")}
              class="h-14 rounded-2xl border text-base font-semibold"
              style={`border-color:${UI_GRAY};color:${UI_GRAY}`}>{label}</button
            >
          {/each}
        </div>
      </div>
    </div>
  {:else if step === "pause"}
    <div class="flex flex-col gap-5" data-testid="rest">
      <h2 class="font-serif text-2xl text-fg">Buen trabajo, bloque {block - 1} hecho</h2>
      <p class="text-base text-muted">Descansa la vista el tiempo que quieras. Llevas {doneTargets} de {totalTargets}. Mantén la misma distancia ({viewing.cm} cm).</p>
      <div class="grid grid-cols-2 gap-3">
        <button type="button" onclick={onStop} class="h-14 rounded-2xl border border-border text-base font-semibold text-fg">Parar</button>
        <button type="button" onclick={begin} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">Seguir</button>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-3" data-testid="result">
      <h2 class="font-serif text-2xl text-fg">Hecho</h2>
      <p class="text-base text-muted">Guardando los pesos de brillo en tu perfil.</p>
    </div>
  {/if}
</div>
