<script lang="ts">
  import type { UmbralProfile } from "@/lib/color/profile";
  import { elevatedAxes, makeDots, paint, pickHealthy, type FilterView } from "./plates";

  let { profile }: { profile: UmbralProfile } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  const floor = $derived(profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02);
  const holes = $derived(elevatedAxes(profile, floor));
  // svelte-ignore state_referenced_locally
  let plateId = $state<string>(holes[0]?.id ?? "control");
  const selected = $derived(holes.find((axis) => axis.id === plateId) ?? null);
  const hole = $derived(plateId !== "control" && selected != null);
  const healthy = $derived(pickHealthy(profile, selected ?? holes[0] ?? null));
  let view = $state<FilterView>("original");
  let seed = $state(1);
  let shown = $state(false);
  const active = $derived(hole ? selected : healthy);

  $effect(() => {
    if (plateId !== "control" && !holes.some((axis) => axis.id === plateId)) {
      plateId = holes[0]?.id ?? "control";
    }
  });

  $effect(() => {
    if (!canvas) return;
    if (!active) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const dots = makeDots(hole, active, floor, seed);
    paint(canvas, dots, profile, floor, view);
  });

  const tabs = $derived<Array<{ id: string; label: string }>>([
    ...holes.map((axis) => ({ id: axis.id, label: axis.hue })),
    ...(healthy ? [{ id: "control", label: "Control" }] : []),
  ]);
  const views = [
    ["original", "Sin filtro"],
    ["assist", "Asistencia"],
    ["simulate", "Simulador"],
    ["extreme", "Extremo"],
  ] as const;
</script>

<section class="flex flex-col gap-4 border-t border-border pt-8">
  <div>
    <h2 class="font-serif text-2xl text-fg">Láminas</h2>
    <p class="mt-2 text-sm leading-relaxed text-muted">
      La lámina alta es un 42 en la línea que este JSON no separa. La de control es un 7 en una línea que sí separas. Sin filtro, asistencia, simulador y extremo usan el perfil de esta sesión. No es una carta clínica.
    </p>
  </div>
  {#if tabs.length > 1}
    <div class="flex flex-wrap gap-2">
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          onclick={() => {
            plateId = tab.id;
            shown = false;
          }}
          class={`h-10 rounded-xl px-3 text-sm ${plateId === tab.id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
        >{tab.label}</button>
      {/each}
    </div>
  {/if}
  <canvas bind:this={canvas} class="mx-auto aspect-square w-full max-w-[520px]" aria-label="Lámina de umbral"></canvas>
  <div class="flex flex-wrap gap-2">
    {#each views as [id, label] (id)}
      <button
        type="button"
        onclick={() => (view = id)}
        class={`h-10 rounded-xl px-3 text-sm ${view === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
      >{label}</button>
    {/each}
    <button type="button" onclick={() => (seed += 1)} class="h-10 rounded-xl border border-border px-3 text-sm text-fg">Otro patrón</button>
    <button type="button" onclick={() => (shown = !shown)} class="h-10 rounded-xl border border-border px-3 text-sm text-fg">{shown ? (hole ? "Es el 42" : "Es el 7") : "Mostrar el número"}</button>
  </div>
</section>
