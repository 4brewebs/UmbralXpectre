<script lang="ts">
  import { num } from "@/lib/format";
  import { cssRgb, toSrgb8, ANCHOR, addScaled, dirFromTheta } from "@/lib/color/space";
  import { colorFor, CONE_MARKS, edgesReady, markLeft, spectrumSamples, type FilterSource } from "@/lib/color/spectrum";
  import { hatchMask, hatchRuns, lossMap, lossPeak } from "@/lib/color/lossmap";
  import type { EdgeFile } from "@/lib/color/edges";
  import type { UmbralProfile } from "@/lib/color/profile";
  import { classify } from "@/lib/color/classify";

  let { profile, edgeFiles }: { profile: UmbralProfile; edgeFiles: EdgeFile[] } = $props();

  type Rgb = [number, number, number];
  const control = $derived(profile.fit.controlAbs ?? 0);
  const kind = $derived(classify(profile, edgeFiles));
  const ceilingRatio = $derived(Math.max(1, ...kind.groups.map((g) => g.ratio ?? 0)));
  const samples = spectrumSamples();
  const strip = (colors: Array<Rgb>) =>
    `linear-gradient(90deg, ${colors.map((rgb, i) => `${cssRgb(toSrgb8(rgb))} ${(i / (colors.length - 1)) * 100}%`).join(", ")})`;
  let source = $state<FilterSource>("profile");
  const ready = $derived(edgesReady(edgeFiles));
  const paint = (kind: "simulate" | "assist") => strip(samples.map((s) => colorFor(kind, s.rgb, profile, source, edgeFiles)));
  const expected = strip(samples.map((s) => s.rgb));
  const yours = $derived(paint("simulate"));
  // Zonas de confusión: intensidad de pérdida en grises (diagnóstico, no filtro).
  const loss = $derived(lossMap(profile, edgeFiles, samples.map((s) => s.rgb)));
  const lossStrip = $derived(
    `linear-gradient(90deg, ${loss.map((s, i) => `rgb(${s.grey} ${s.grey} ${s.grey}) ${(i / (loss.length - 1)) * 100}%`).join(", ")})`,
  );
  const hatch = $derived(hatchRuns(loss).length ? hatchMask(loss) : "");
  const peakLabel = $derived(`Zonas de confusión · máx. ${num(lossPeak(profile, edgeFiles), 1)}×`);
  const assisted = $derived(paint("assist"));

  function worstMeasured(profile: UmbralProfile) {
    return profile.axes
      .filter((item) => item.role === "l" || item.role === "m" || item.role === "s" || item.role === "red-end" || item.role === "blue-end")
      .filter((item) => item.thresholdKind === "estimate" && item.threshold != null)
      .sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0))[0];
  }

  // Overlap / CorrectedPair / AssistedPair comparten la misma condición.
  const pair = $derived.by(() => {
    const axis = worstMeasured(profile);
    const floor = control;
    if (!axis || axis.threshold == null || floor <= 0 || axis.threshold < floor * 1.6) return null;
    const dir = dirFromTheta((axis.angleDeg * Math.PI) / 180);
    const anchor: Rgb = [ANCHOR, ANCHOR, ANCHOR];
    const a = addScaled(anchor, dir, axis.threshold) as Rgb;
    const b = addScaled(anchor, dir, -axis.threshold) as Rgb;
    return {
      overlap: [a, b],
      assisted: [colorFor("assist", a, profile, source, edgeFiles), colorFor("assist", b, profile, source, edgeFiles)],
    } as Record<"overlap" | "assisted", [Rgb, Rgb]>;
  });
</script>

{#snippet swatch(rgb: Rgb)}
  <div class="h-14 flex-1 rounded-2xl" style:background={cssRgb(toSrgb8(rgb))} role="img" aria-label={cssRgb(toSrgb8(rgb))}></div>
{/snippet}

{#snippet stripRow(label: string, gradient: string, hatched = "")}
  <div class="flex flex-col gap-1">
    <p class="text-xs text-muted">{label}</p>
    <div class="relative pt-3">
      {#each CONE_MARKS as mark (mark.id)}
        <span class="absolute top-0 h-2.5 w-px bg-accent" style:left={`${markLeft(mark.nm)}%`}></span>
      {/each}
      <div class="relative h-8 w-full overflow-hidden rounded-2xl" style:background={gradient} role="img" aria-label={label}>
        {#if hatched}
          <span
            class="absolute inset-0"
            data-hatch="estimado"
            style:background="repeating-linear-gradient(45deg, rgb(255 255 255 / 0.16) 0 1.5px, transparent 1.5px 6px)"
            style:mask-image={hatched}
            style:-webkit-mask-image={hatched}
          ></span>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet pairRow(title: string, colors: [Rgb, Rgb])}
  <p class="text-sm text-fg">{title}</p>
  <div class="flex gap-3">
    {@render swatch(colors[0])}
    {@render swatch(colors[1])}
  </div>
{/snippet}

<section class="flex flex-col gap-6 border-t border-border pt-8">
  <div>
    <h2 class="font-serif text-2xl text-fg">Tu visión del color</h2>
    <p class="mt-2 text-base leading-relaxed text-fg">{kind.text}</p>
    <p class="mt-1 text-xs text-muted">{kind.disclaimer}</p>
  </div>
  <ul class="flex flex-col gap-5">
    {#each kind.groups as group (group.id)}
      {@const width = Math.round(((group.ratio ?? 0) / ceilingRatio) * 100)}
      {@const expectedAt = Math.round((1 / ceilingRatio) * 100)}
      <li class="flex flex-col gap-2" data-axis={group.id}>
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-fg">{group.name}</span>
          <span class="text-sm text-muted">{group.ratio != null ? `${num(group.ratio, 1)}×` : "sin medir"}</span>
        </div>
        <div class="relative h-2 rounded-full bg-surface">
          <div class="h-full rounded-full bg-fg" style:width={`${width}%`}></div>
          <div class="absolute top-[-3px] h-3.5 w-px bg-accent" style:left={`${expectedAt}%`}></div>
        </div>
        <p class="text-sm leading-relaxed text-muted">{group.elevated ? `Hace falta unas ${num(group.ratio ?? 0, 1)} veces más diferencia que en el control en este eje.` : "En esta pantalla lo separas al nivel del control, o mejor."}</p>
      </li>
    {/each}
  </ul>
  <p class="text-xs text-muted">La marca dorada es el control de esta pantalla. La barra es tu límite.</p>
  <div class="flex flex-wrap gap-2">
    {#each [["profile", "Perfil"], ["edges", "Bordes"]] as const as [id, label] (id)}
      <button
        type="button"
        onclick={() => (source = id)}
        class={`h-10 rounded-xl px-3 text-sm ${source === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
      >{label}</button>
    {/each}
  </div>
  {#if source === "edges" && !ready}
    <p class="text-sm text-muted">Sin bordes cerrados, el filtro usa una región provisional: hasta el punto medio hacia el primer eje sano, al 70 %.</p>
  {/if}
  <div class="flex flex-col gap-1.5">
    {@render stripRow("En esta pantalla", expected)}
    {@render stripRow("Tu visión", yours)}
    {@render stripRow(peakLabel, lossStrip, hatch)}
    {@render stripRow("Asistencia", assisted)}
    <p class="text-xs text-muted">Cuanto más claro, más te cuesta distinguir ese tono. Rayado = estimado.</p>
  </div>
  <div class="flex flex-col gap-4">
    <p class="text-sm leading-relaxed text-muted">
      Los cuatro van en el mismo orden. El primero es la pantalla, sin filtro. El segundo, Tu visión, es el simulador de este perfil. El tercero es un mapa en grises de tu pérdida medida frente al control; no es un filtro. El cuarto es la asistencia: el mismo tramo, llevado al color cercano que sí separas, con la saturación del original y el brillo que midió la prueba. En las láminas y en la cámara está también Extremo, la asistencia de antes, con la saturación muy subida.
    </p>
    {#if pair}
      <div class="flex flex-col gap-2">
        {@render pairRow("El par que se te solapa", pair.overlap)}
        <p class="text-sm leading-relaxed text-muted">
          En la vía más corta mediste estos dos como iguales. Ahí se montan, sea cual sea el color. No los he convertido en gris en el arcoíris: el gris te quitaría saturación, y esa sí la separas.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        {@render pairRow("Ese par, con la asistencia", pair.assisted)}
      </div>
    {/if}
  </div>
</section>
