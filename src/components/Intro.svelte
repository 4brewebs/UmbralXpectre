<script lang="ts">
  import type { UmbralProfile } from "@/lib/color/profile";
  import ImportJson from "./ImportJson.svelte";

  let {
    stored,
    onStart,
    onView,
    onImport,
  }: {
    stored: UmbralProfile | null;
    onStart: () => void;
    onView: () => void;
    onImport: (profile: UmbralProfile) => void;
  } = $props();

  const items = [
    ["1", "Brillo al máximo. Sin modo noche ni filtro de color del sistema."],
    ["2", "Entre prueba y prueba la pantalla se queda en gris. Juzga las dos mitades quietas, no el salto."],
    [
      "3",
      "Se miden las fronteras entre conos y también el primer azul y el último rojo que esta pantalla puede emitir. El orden cambia. Algunos pares son el mismo color: no todo es distinto.",
    ],
    ["4", "Después, un campo que se desplaza. Sigue hasta que solo late, y pulsa Quieto."],
  ];
</script>

<div class="flex flex-col gap-8">
  <p class="text-lg leading-relaxed text-muted">
    Mide, en esta pantalla, qué diferencias de color separas y cuáles no. No te clasifica. El resultado es un perfil de tus respuestas y de este dispositivo.
  </p>
  <ol class="flex flex-col gap-4 border-t border-border pt-6">
    {#each items as [n, text] (n)}
      <li class="grid grid-cols-[2rem_1fr] gap-3">
        <span class="font-serif text-xl text-accent">{n}</span>
        <span class="leading-relaxed text-fg">{text}</span>
      </li>
    {/each}
  </ol>
  <p class="text-sm leading-relaxed text-muted">
    No es un diagnóstico clínico. Dos personas con la misma etiqueta no reciben el mismo JSON.
  </p>
  <div class="flex flex-col gap-3 sm:flex-row">
    <button type="button" onclick={onStart} class="h-14 rounded-2xl bg-accent px-6 text-base font-semibold text-accent-fg">Empezar calibración</button>
    {#if stored}
      <button type="button" onclick={onView} class="h-14 rounded-2xl border border-border px-6 text-base text-fg">Ver perfil guardado</button>
    {/if}
    <ImportJson onProfile={onImport} />
  </div>
</div>
