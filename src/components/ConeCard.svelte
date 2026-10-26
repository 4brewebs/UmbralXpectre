<script lang="ts">
  import { cssRgb, toSrgb8, ANCHOR, addScaled, dirFromTheta } from "@/lib/color/space";
  import { colorFor, coneBlurb, coneLead, coneOrder, CONE_MARKS, edgesReady, markLeft, spectrumSamples, type FilterSource } from "@/lib/color/spectrum";
  import type { EdgeFile } from "@/lib/color/edges";
  import type { UmbralProfile } from "@/lib/color/profile";

  let { profile, edgeFiles }: { profile: UmbralProfile; edgeFiles: EdgeFile[] } = $props();

  type Rgb = [number, number, number];
  const pathways = $derived(coneOrder(profile.fit.pathways));
  const control = $derived(profile.fit.controlAbs ?? 0);
  const ceiling = $derived(Math.max(control, ...pathways.map((p) => p.threshold), 0.001));
  const samples = spectrumSamples();
  const strip = (colors: Array<Rgb>) =>
    `linear-gradient(90deg, ${colors.map((rgb, i) => `${cssRgb(toSrgb8(rgb))} ${(i / (colors.length - 1)) * 100}%`).join(", ")})`;
  let source = $state<FilterSource>("profile");
  const ready = $derived(edgesReady(edgeFiles));
  const paint = (kind: "simulate" | "correct" | "assist") => strip(samples.map((s) => colorFor(kind, s.rgb, profile, source, edgeFiles)));
  const expected = strip(samples.map((s) => s.rgb));
  const yours = $derived(paint("simulate"));
  const corrected = $derived(paint("correct"));
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
      corrected: [colorFor("correct", a, profile, source, edgeFiles), colorFor("correct", b, profile, source, edgeFiles)],
      assisted: [colorFor("assist", a, profile, source, edgeFiles), colorFor("assist", b, profile, source, edgeFiles)],
    } as Record<"overlap" | "corrected" | "assisted", [Rgb, Rgb]>;
  });
</script>

{#snippet swatch(rgb: Rgb)}
  <div class="h-14 flex-1 rounded-2xl" style:background={cssRgb(toSrgb8(rgb))} role="img" aria-label={cssRgb(toSrgb8(rgb))}></div>
{/snippet}

{#snippet stripRow(label: string, gradient: string)}
  <div class="flex flex-col gap-1">
    <p class="text-xs text-muted">{label}</p>
    <div class="relative pt-3">
      {#each CONE_MARKS as mark (mark.id)}
        <span class="absolute top-0 h-2.5 w-px bg-accent" style:left={`${markLeft(mark.nm)}%`}></span>
      {/each}
      <div class="h-8 w-full rounded-2xl" style:background={gradient} role="img" aria-label={label}></div>
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
    <h2 class="font-serif text-2xl text-fg">Tus conos</h2>
    <p class="mt-2 text-base leading-relaxed text-fg">{coneLead(pathways)}</p>
  </div>
  <ul class="flex flex-col gap-5">
    {#each pathways as pathway (pathway.id)}
      {@const mark = CONE_MARKS.find((item) => item.id === pathway.id)}
      {@const yoursWidth = Math.round((pathway.threshold / ceiling) * 100)}
      {@const expectedAt = Math.round((control / ceiling) * 100)}
      <li class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-fg">{mark?.name ?? pathway.hue}</span>
          <span class="text-sm text-muted">{pathway.kind === "upper-bound" ? `≤ ${pathway.threshold.toFixed(3)}` : `${pathway.threshold.toFixed(3)}${pathway.timesControl != null ? ` · ${pathway.timesControl.toFixed(1)}×` : ""}`}</span>
        </div>
        <div class="relative h-2 rounded-full bg-surface">
          <div class="h-full rounded-full bg-fg" style:width={`${yoursWidth}%`}></div>
          <div class="absolute top-[-3px] h-3.5 w-px bg-accent" style:left={`${expectedAt}%`}></div>
        </div>
        <p class="text-sm leading-relaxed text-muted">{coneBlurb(pathway)}</p>
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
    {@render stripRow("Mapa intermedio", corrected)}
    {@render stripRow("Asistencia", assisted)}
  </div>
  <div class="flex flex-col gap-4">
    <p class="text-sm leading-relaxed text-muted">
      Los cuatro van en el mismo orden. El primero es la pantalla, sin filtro. El segundo, Tu visión, es el simulador de este perfil. El tercero pinta ese tramo sobre el cono intacto, para ver dónde cae. El cuarto es la asistencia: el mismo tramo, llevado al color cercano que sí separas, con la saturación del original y el brillo que midió la prueba. En las láminas y en la cámara está también Extremo, la asistencia de antes, con la saturación muy subida.
    </p>
    {#if pair}
      <div class="flex flex-col gap-2">
        {@render pairRow("El par que se te solapa", pair.overlap)}
        <p class="text-sm leading-relaxed text-muted">
          En la vía más corta mediste estos dos como iguales. Ahí se montan, sea cual sea el color. No los he convertido en gris en el arcoíris: el gris te quitaría saturación, y esa sí la separas.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        {@render pairRow("Ese par, en el mapa intermedio", pair.corrected)}
      </div>
      <div class="flex flex-col gap-2">
        {@render pairRow("Ese par, con la asistencia", pair.assisted)}
      </div>
    {/if}
  </div>
</section>
