<script lang="ts">
  import { num } from "@/lib/format";
  import { untrack } from "svelte";
  import { ANCHOR, cssRgb, lumNoiseAmp, toSrgb8 } from "@/lib/color/space";
  import type { UmbralProfile } from "@/lib/color/profile";
  import { questPlusEnabled } from "@/lib/color/motion2";
  import { applyAnswer, edgeInputFromProfile, armConfirm, discsOf, edgeFile, searchBounds, startRun, type ConeId, type EdgeFile, type EdgeRun } from "@/lib/color/edges";

  import { acceptsResponse, EDGE_STAGE, EDGE_VEIL, edgeLayout, edgeOffset, SWAP, swapFill, swapStarts, type Offset, type SwapPhase } from "@/lib/test/transition";

  /** Gris de anclaje: el mismo en todos los ensayos y en el test de perfil. */
  const GRAY = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));

  let {
    profile,
    cone,
    onCancel,
    onDone,
  }: {
    profile: UmbralProfile;
    cone: ConeId;
    onCancel: () => void;
    onDone: (file: EdgeFile) => void;
  } = $props();

  function phaseLabel(run: EdgeRun): string {
    if (run.repeat) return "Este tono no ha quedado claro. Lo repito.";
    if (run.edgeConfirm === "inside") return "Repito el último que no separaste.";
    if (run.edgeConfirm === "outside") return "Repito el último que sí separaste.";
    if (run.phase === "peak") return "El tono que el primer test dejó alto. El contraste no cambia.";
    if (run.phase === "minus") return "Un lado del tramo. Sigue el mismo contraste.";
    if (run.phase === "plus") return "El otro lado del tramo.";
    if (run.phase === "depth") return "El tono se queda. Ahora cambia el contraste.";
    return "";
  }

  function round1(n: number): number {
    return Math.round(n * 10) / 10;
  }

  // Inicial, como useState(() => startRun(...)); EdgeTest se monta con {#key cone}.
  let run = $state.raw<EdgeRun>(
    untrack(() => {
      return startRun({ ...edgeInputFromProfile(profile, cone), lumNoise: lumNoiseAmp(window.location.search) });
    }),
  );

  // QUEST+ tras flag (`?qp=1`): se carga perezosamente y entra tras el bracketing.
  $effect(() => {
    if (!questPlusEnabled(window.location.search) || run.questPlus) return;
    void import("@/lib/color/questplus").then(async ({ loadQuestPlus }) => {
      const Q = await loadQuestPlus();
      run = { ...run, questPlus: Q };
    });
  });

  let picked = $state.raw<number[]>([]);
  let draft = $state.raw<{ minus: number; plus: number } | null>(null);
  let probe = $state.raw<null | { side: "minus" | "plus"; left: number; hits: number }>(null);
  let note = $state<string | null>(null);

  const asking = $derived(run.phase === "peak" || run.phase === "minus" || run.phase === "plus" || run.phase === "depth" || probe != null);
  // Mismas dependencias que el useEffect original; $derived solo notifica si cambia el valor.
  const askKey = $derived(asking ? `${run.trials.length}|${run.angle}|${run.scale}|${run.oddIndex}|${run.phase}` : null);

  let swap = $state<{ key: string | null; phase: SwapPhase }>({ key: null, phase: "fadeOut" });
  /** Si la pregunta acaba de cambiar y el efecto aún no ha corrido, ya es fadeOut: el color nuevo nunca se pinta antes de tiempo. */
  const phase = $derived<SwapPhase>(swap.key === askKey ? swap.phase : "fadeOut");
  const ready = $derived(acceptsResponse(phase));
  /** Posiciones de las piezas; solo cambian en el hold, bajo el velo. No se guardan en el JSON. */
  let layout = $state.raw<Offset[]>(edgeLayout(Math.random));
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  $effect(() => {
    const k = askKey;
    if (k == null) return;
    const set = (p: SwapPhase) => (swap = { key: k, phase: p });
    untrack(() => {
      picked = [];
      set("fadeOut");
    });
    const at = swapStarts();
    const timers = [
      window.setTimeout(() => {
        set("hold");
        layout = edgeLayout(Math.random);
      }, at.hold),
      window.setTimeout(() => set("fadeIn"), at.fadeIn),
      window.setTimeout(() => set("ready"), at.ready),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  });

  $effect(() => {
    if (run.phase !== "confirm" || draft) return;
    draft = {
      // Lado sin explorar: sin pruebas de banda más allá del pico.
      minus: run.minus.edge ?? run.peak,
      plus: run.plus.edge ?? run.peak,
    };
  });

  function submit(none: boolean) {
    if (!ready) return;
    const next = applyAnswer(run, { picked: none ? [] : picked, none });
    if (probe) {
      const kind = next.trials[next.trials.length - 1]?.kind;
      const hits = probe.hits + (kind === "seen" ? 1 : 0);
      const left = probe.left - 1;
      run = next;
      if (left <= 0) {
        const accepted = hits >= 2;
        if (draft && accepted) draft = { ...draft, [probe.side]: next.angle };
        note = accepted ? "Este borde se queda donde lo has puesto." : "No lo has separado con claridad. El borde no se mueve.";
        probe = null;
      } else {
        probe = { ...probe, left, hits };
      }
      return;
    }
    run = next;
  }

  function save() {
    onDone(edgeFile(run, draft ? { minus: round1(draft.minus), plus: round1(draft.plus) } : undefined));
  }

  function beginProbe(side: "minus" | "plus") {
    if (!draft) return;
    note = null;
    probe = { side, left: 3, hits: 0 };
    run = armConfirm(run, side === "minus" ? draft.minus : draft.plus);
  }

  const name = $derived(run.name);
  const showDiscs = $derived(asking && run.phase !== "done");
  const sector = $derived(searchBounds(run));
</script>

{#snippet edgeSlider(label: string, min: number, max: number, value: number, onChange: (value: number) => void)}
  <label class="flex flex-col gap-2 text-sm text-fg">
    <span class="flex items-baseline justify-between">{label}<span class="text-muted">{num(value, 1)}°</span></span>
    <input type="range" {min} {max} step={0.5} {value} oninput={(event) => onChange(Number(event.currentTarget.value))} />
  </label>
{/snippet}

<div class="flex flex-col gap-6">
  <div>
    <p class="text-sm text-muted">Precisión · {name}</p>
    <h2 class="mt-1 font-serif text-3xl text-fg">Dónde empieza y acaba</h2>
    <p class="mt-3 text-base leading-relaxed text-muted">Tres son iguales y uno no. Toca solo ese. Si ninguno destaca, no elijas: pulsa Ninguno destaca.</p>
  </div>

  {#if run.phase === "done" && run.band === "none"}
    <p class="text-lg leading-relaxed text-fg">A este contraste separas el tono de partida. No hay tramo que marcar.</p>
  {/if}
  {#if run.phase === "done" && run.band === "unmeasurable"}
    <p class="text-lg leading-relaxed text-fg">Sin banda medible: se ve el tono de partida incluso al contraste más bajo.</p>
  {/if}

  {#if showDiscs}
    <p class="min-h-12 text-lg leading-snug text-fg" aria-live="polite">{ready ? (probe ? `Probando este borde. Quedan ${probe.left}.` : phaseLabel(run)) : "Pausa en gris. No juzgues el cambio."}</p>
    <p class="text-sm text-muted">Pregunta {run.trials.length + 1} · tono {num(run.angle, 1)}°</p>
    <div class="relative mx-auto my-4 shrink-0" style:width={`${EDGE_STAGE.size}px`} style:height={`${EDGE_STAGE.size}px`} data-testid="edge-stage" data-phase={phase}>
      <!-- Piezas siempre montadas (clave por índice): el color se funde con background-color y la posición con transform. -->
      {#each discsOf(run) as rgb, index (index)}
        {@const o = edgeOffset(phase, index, layout, reduced)}
        <button
          type="button"
          disabled={!ready}
          aria-pressed={picked.includes(index) ? "true" : "false"}
          aria-label={`Disco ${index + 1}`}
          onclick={() => (picked = picked[0] === index ? [] : [index])}
          class={`absolute top-1/2 left-1/2 rounded-full border-2 ${picked.includes(index) ? "border-accent" : "border-transparent"}`}
          style:width={`${EDGE_STAGE.disc}px`}
          style:height={`${EDGE_STAGE.disc}px`}
          style:margin={`-${EDGE_STAGE.disc / 2}px`}
          style:transform={`translate(${o.x}px, ${o.y}px)`}
          style:background-color={swapFill(phase, cssRgb(rgb), GRAY)}
          style:transition={phase === "hold" ? "none" : `background-color ${SWAP.fadeOut}ms linear, transform ${SWAP.fadeOut}ms ease-in-out`}
        ></button>
      {/each}
      <!-- Velo gris de anclaje sobre toda la zona de las piezas: liso en el hold, sin bordes suavizados ni costuras. Sube solo al final del fadeOut (el viaje al centro se ve entero) y baja en fadeIn. -->
      <div
        aria-hidden="true"
        data-testid="edge-veil"
        class="pointer-events-none absolute inset-0"
        style:background-color={GRAY}
        style:opacity={phase === "fadeOut" || phase === "hold" ? 1 : 0}
        style:transition={phase === "fadeOut" ? `opacity ${EDGE_VEIL.fadeOut}ms linear ${EDGE_VEIL.delay}ms` : `opacity ${SWAP.fadeIn}ms linear`}
      ></div>
    </div>
    <button type="button" disabled={!ready} onclick={() => submit(true)} class="h-14 rounded-2xl border border-border text-base font-medium text-fg disabled:opacity-40">Ninguno destaca</button>
    <button type="button" disabled={!ready || picked.length !== 1} onclick={() => submit(false)} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg disabled:opacity-40">Listo</button>
  {/if}

  {#if run.phase === "confirm" && !probe && draft}
    {@const d = draft}
    <div class="flex flex-col gap-5">
      <p class="text-base leading-relaxed text-fg">{run.minus.toEnd && run.plus.toEnd ? "Por ninguno de los dos lados ha vuelto el color. El fallo sigue hasta el límite de la pantalla en los dos sentidos." : run.minus.toEnd || run.plus.toEnd ? "Un lado tiene un corte. En el otro el fallo sigue hasta el límite de la pantalla." : run.minus.found && run.plus.found ? "Los dos cortes han quedado acotados. Puedes moverlos y probarlos." : "Un lado no ha encontrado el corte. Puedes probar el que sí, o guardar así."}</p>
      <p class="text-sm text-muted">Centro del contraste: {run.depthBound === "at-least" ? "≥ " : ""}{num(((run.depthLo + run.depthHi) / 2), 3)}</p>
      {@render edgeSlider("Un borde", sector.lo, sector.hi, d.minus, (value) => (draft = { ...d, minus: value }))}
      {@render edgeSlider("El otro borde", sector.lo, sector.hi, d.plus, (value) => (draft = { ...d, plus: value }))}
      {#if note}
        <p class="text-sm text-muted">{note}</p>
      {/if}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onclick={() => beginProbe("minus")} class="h-12 rounded-2xl border border-border text-sm text-fg">Probar un borde</button>
        <button type="button" onclick={() => beginProbe("plus")} class="h-12 rounded-2xl border border-border text-sm text-fg">Probar el otro</button>
      </div>
      <button type="button" onclick={save} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">Guardar JSON {name}</button>
    </div>
  {/if}

  {#if run.phase === "done"}
    <button type="button" onclick={save} class="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">Guardar JSON {name}</button>
  {/if}

  <button type="button" onclick={onCancel} class="h-12 text-sm text-muted">Volver sin guardar</button>
</div>
