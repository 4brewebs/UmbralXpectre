<script lang="ts">
  import { num } from "@/lib/format";
  import { untrack } from "svelte";
  import { ANCHOR, cssRgb, toSrgb8 } from "@/lib/color/space";
  import type { UmbralProfile } from "@/lib/color/profile";
  import { questPlusEnabled } from "@/lib/color/motion2";
  import { applyAnswer, edgeInputFromProfile, armConfirm, discsOf, edgeFile, searchBounds, startRun, type ConeId, type EdgeFile, type EdgeRun } from "@/lib/color/edges";

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
      return startRun(edgeInputFromProfile(profile, cone));
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

  let ready = $state(false);
  let picked = $state.raw<number[]>([]);
  let draft = $state.raw<{ minus: number; plus: number } | null>(null);
  let probe = $state.raw<null | { side: "minus" | "plus"; left: number; hits: number }>(null);
  let note = $state<string | null>(null);

  const asking = $derived(run.phase === "peak" || run.phase === "minus" || run.phase === "plus" || run.phase === "depth" || probe != null);
  // Mismas dependencias que el useEffect original; $derived solo notifica si cambia el valor.
  const askKey = $derived(asking ? `${run.trials.length}|${run.angle}|${run.scale}|${run.oddIndex}|${run.phase}` : null);

  $effect(() => {
    if (askKey == null) return;
    picked = [];
    ready = false;
    const id = window.setTimeout(() => (ready = true), 700);
    return () => window.clearTimeout(id);
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
    <div class="mx-auto grid w-full max-w-xs grid-cols-2 gap-x-16 gap-y-10 py-4">
      {#each discsOf(run) as rgb, index (`${run.trials.length}-${index}`)}
        <button
          type="button"
          disabled={!ready}
          aria-pressed={picked.includes(index) ? "true" : "false"}
          aria-label={`Disco ${index + 1}`}
          onclick={() => (picked = picked[0] === index ? [] : [index])}
          class={`mx-auto size-[4.5rem] rounded-full border-2 ${picked.includes(index) ? "border-accent" : "border-transparent"} disabled:opacity-80`}
          style:background={ready ? cssRgb(rgb) : GRAY}
        ></button>
      {/each}
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
