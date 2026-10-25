<script lang="ts">
  import { Check, Copy, Download, RotateCcw } from "@lucide/svelte";
  import { edgeFilename, type ConeId, type EdgeFile } from "@/lib/color/edges";
  import { buildTransformFile } from "@/lib/color/lut";
  import type { UmbralProfile } from "@/lib/color/profile";
  import ConeCard from "./ConeCard.svelte";
  import Plates from "./Plates.svelte";
  import AssistCamera from "./AssistCamera.svelte";
  import EdgeTest from "./EdgeTest.svelte";
  import ImportJson from "./ImportJson.svelte";

  let {
    profile,
    copied,
    onCopy,
    onDownload,
    onAgain,
    onImport,
    onMotion,
    onMotionV2,
    edgeFiles,
    onEdgeFile,
  }: {
    profile: UmbralProfile;
    copied: boolean;
    onCopy: () => void;
    onDownload: () => void;
    onAgain: () => void;
    onImport: (profile: UmbralProfile) => void;
    onMotion: () => void;
    onMotionV2?: () => void;
    edgeFiles: Partial<Record<ConeId, EdgeFile>>;
    onEdgeFile: (file: EdgeFile) => void;
  } = $props();

  type Matches = NonNullable<UmbralProfile["luminance"]>["matches"];

  const json = $derived(JSON.stringify(profile, null, 2));
  const edgeList = $derived(Object.values(edgeFiles) as EdgeFile[]);
  let baking = $state(false);
  let measuring = $state<ConeId | null>(null);

  function downloadEdgeFile(file: EdgeFile) {
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = edgeFilename(file.cone);
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadTransforms() {
    if (baking) return;
    baking = true;
    window.setTimeout(() => {
      try {
        const file = buildTransformFile(profile);
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "umbral-transformadas.json";
        link.click();
        URL.revokeObjectURL(url);
      } finally {
        baking = false;
      }
    }, 40);
  }

  const elevated = $derived(profile.fit.pathways?.filter((pathway) => pathway.elevated) ?? []);
  const peak = $derived(Math.max(...profile.axes.map((item) => item.threshold ?? 0), 0.0001));

  function brightnessStatus(matches: Matches): string {
    const ruler = matches.find((match) => match.kind === "control");
    return ruler && Math.abs(ruler.gain - 1) > 0.12
      ? "La regla no cayó junto a 1×. Esta pasada no sirve de cero."
      : `${matches.length === 1 ? "1 franja" : `${matches.length} franjas`}. El dato es el ancho, no cuántas muestras hizo falta.`;
  }
</script>

{#snippet stat(label: string, value: string)}
  <div class="bg-bg px-4 py-3">
    <dt class="text-xs text-muted">{label}</dt>
    <dd class="mt-1 font-serif text-2xl text-fg">{value}</dd>
  </div>
{/snippet}

{#snippet brightness(matches: Matches)}
  <section class="flex flex-col gap-3 border-t border-border pt-4">
    <h2 class="font-serif text-2xl text-fg">Brillo</h2>
    <p class="leading-relaxed text-fg">{brightnessStatus(matches)}</p>
    <ul class="flex flex-col gap-2">
      {#each matches as match (`${match.order}-${match.axisId}`)}
        {@const place = match.kind === "cruce" ? "Franja" : match.kind === "extremo" ? "Dentro" : match.kind === "control" ? "Regla" : "Eje"}
        {@const against = match.kind === "control" ? "gris" : match.referenceHue}
        {@const taken = match.trials === 1 ? "1 muestra" : `${match.trials} muestras`}
        {@const fan = match.span === "range" ? `${match.low.toFixed(2)}–${match.high.toFixed(2)}× · abanico ${match.width.toFixed(2)} · ${taken}` : `un corte · ${match.gain.toFixed(2)}× · ${taken}`}
        <li class="flex flex-col gap-0.5 text-sm">
          <span class="text-fg">{place} · {match.hue} frente a {against}</span>
          <span class="text-muted">{fan}</span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

{#if measuring}
  {#key measuring}
    <EdgeTest
      {profile}
      cone={measuring}
      onCancel={() => (measuring = null)}
      onDone={(file) => {
        onEdgeFile(file);
        measuring = null;
      }}
    />
  {/key}
{:else}
  <div class="flex flex-col gap-8">
    <p class="text-lg leading-relaxed text-fg">{profile.summary.replace(/ Brillo, por movimiento:.*$/, "")}</p>
    <p class="text-sm text-muted">Pares iguales: {profile.catches.same} vistos iguales{profile.catches.missed ? `, ${profile.catches.missed} marcados distintos` : ""}.</p>
    {#if profile.luminance?.matches?.length}
      {@render brightness(profile.luminance.matches)}
    {:else}
      <button type="button" onclick={onMotion} class="text-sm text-muted">Medir el brillo con las bandas</button>
    {/if}
    {#if profile.luminance?.weightsSource === "measured"}
      {@const lum = profile.luminance}
      <section class="rounded-2xl border border-border p-4 text-sm text-fg" data-testid="weights-v2">
        <p class="font-semibold">Pesos de brillo medidos (prueba v2)</p>
        <p class="mt-1 text-muted">R {lum.weights[0].toFixed(3)} · G {lum.weights[1].toFixed(3)} · B {lum.weights[2].toFixed(3)} (estándar 0.213 · 0.715 · 0.072)</p>
        <p class="mt-1 text-muted">Confianza {lum.checks?.confidence === "high" ? "alta" : "baja"}{lum.checks?.withinNoise ? " · dentro del ruido de Y estándar" : ""} · {lum.measuredMatches.length} colores · refresco {lum.refreshHz ?? "—"} Hz. Aún no cambia los filtros (fase 2).</p>
      </section>
    {/if}
    {#if onMotionV2 && profile.luminance?.matches?.length}
      <button type="button" onclick={onMotionV2} class="text-sm text-muted">Medir pesos de brillo (prueba v2)</button>
    {/if}
    <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
      {@render stat("Confianza", profile.confidence === "high" ? "Alta" : "Baja")}
      {@render stat(
        "Sobre el control",
        profile.fit.timesControl == null ? "—" : `${profile.fit.timesControlKind === "at-least" ? "≥ " : ""}${profile.fit.timesControl.toFixed(1)}×`,
      )}
      {@render stat("Líneas altas", profile.fit.elevatedCount == null ? "—" : String(profile.fit.elevatedCount))}
      {@render stat(
        "Ángulo",
        profile.fit.elevatedCount != null && profile.fit.elevatedCount !== 1
          ? "varias o ninguna"
          : profile.fit.confusionAngleDeg == null
            ? "—"
            : `${profile.fit.confusionAngleDeg}°`,
      )}
      {@render stat("Desvío del prior", profile.fit.shiftFromNearestPriorDeg == null ? "—" : `${profile.fit.shiftFromNearestPriorDeg}°`)}
    </dl>
    <ul class="flex flex-col gap-3">
      {#each profile.axes.filter((a) => a.role !== "refine" || !a.closed) as axis (axis.id)}
        {@const width = Math.round(((axis.threshold ?? 0) / peak) * 100)}
        <li class="flex flex-col gap-1">
          <div class="flex items-baseline justify-between gap-3 text-sm">
            <span class="text-fg">{axis.label ?? axis.hue}</span>
            <span class="text-muted">{axis.thresholdKind === "upper-bound" ? "fino" : axis.closed ? "bajo" : "medido"}{axis.threshold != null ? ` · ${axis.threshold.toFixed(3)}` : ""}{axis.thresholdKind === "upper-bound" ? " o menos" : ""}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-surface">
            <div class="h-full bg-fg" style:width={`${width}%`}></div>
          </div>
        </li>
      {/each}
    </ul>
    {#if profile.fit.pathways?.length}
      <ConeCard {profile} edgeFiles={edgeList} />
    {/if}
    <Plates {profile} />
    <AssistCamera {profile} edgeFiles={edgeList} />
    <p class="text-sm leading-relaxed text-muted">{profile.disclaimer}</p>
    <div class="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onclick={onDownload}
        class="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-fg"
      ><Download class="size-4" aria-hidden="true" />Descargar JSON</button>
      <button
        type="button"
        onclick={onCopy}
        class="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg"
      >{#if copied}<Check class="size-4" aria-hidden="true" />{:else}<Copy class="size-4" aria-hidden="true" />{/if}{copied ? "Copiado" : "Copiar JSON"}</button>
      <ImportJson onProfile={onImport} />
    </div>
    <button
      type="button"
      disabled={baking}
      onclick={downloadTransforms}
      class="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg disabled:opacity-50"
    ><Download class="size-4" aria-hidden="true" />{baking ? "Preparando transformaciones…" : "Descargar JSON transformaciones"}</button>
    {#each elevated as pathway (pathway.id)}
      {@const cone = pathway.id as ConeId}
      {@const name = cone === "l" ? "rojos" : cone === "m" ? "verdes" : "azules"}
      {@const file = edgeFiles[cone]}
      <div class="flex flex-col gap-3">
        <button
          type="button"
          onclick={() => (measuring = cone)}
          class="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg"
        >{file ? `Repetir bordes ${name}` : `Medir bordes ${name}`}</button>
        {#if file}
          <button
            type="button"
            onclick={() => downloadEdgeFile(file)}
            class="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg"
          ><Download class="size-4" aria-hidden="true" />Descargar JSON {name}</button>
        {/if}
      </div>
    {/each}
    <button type="button" onclick={onAgain} class="inline-flex h-12 items-center justify-center gap-2 text-sm text-muted"><RotateCcw class="size-4" aria-hidden="true" />Repetir calibración</button>
    <details class="rounded-2xl border border-border">
      <summary class="cursor-pointer px-4 py-3 text-sm text-fg">Ver JSON</summary>
      <pre class="max-h-80 overflow-auto px-4 pb-4 text-xs leading-relaxed text-muted">{json}</pre>
    </details>
  </div>
{/if}
