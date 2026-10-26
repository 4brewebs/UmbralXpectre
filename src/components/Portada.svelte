<script lang="ts">
  import { FilePlus2, Upload, UserRound, History } from "@lucide/svelte";
  import { PORTADA } from "@/lib/ui/portada";

  let { notice = null }: { notice?: string | null } = $props();
  const base = import.meta.env.BASE_URL;
  const options = [
    { href: "#/nuevo", label: "Empezar de cero", hint: "Calibra esta pantalla desde el principio.", Icon: FilePlus2, primary: true },
    { href: "#/importar", label: "Importar", hint: "Carga un perfil o unos bordes en JSON.", Icon: Upload, primary: false },
    { href: "#/perfiles", label: "Elegir perfil guardado", hint: "El perfil guardado en este navegador.", Icon: UserRound, primary: false },
    { href: "#/sesiones", label: "Elegir sesión guardada", hint: "Las sesiones del historial del perfil.", Icon: History, primary: false },
  ];
</script>

<div
  class="portada relative min-h-screen w-full overflow-x-hidden bg-bg text-fg"
  style:--p-veil={`color-mix(in srgb, var(--color-bg) ${PORTADA.veil.alpha * 100}%, transparent)`}
  data-testid="portada"
>
  <picture class="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
    <source srcset="{base}marca/portada.webp" type="image/webp" />
    <img src="{base}marca/portada.jpg" alt="" class="rueda" style:opacity={PORTADA.imageOpacity} width="1600" height="900" />
  </picture>
  <h1 class="sr-only">Umbral Xpectra</h1>

  <main class="panel relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pt-6 pb-10 sm:px-8">
    {#if notice}
      <p role="alert" class="rounded-2xl border border-accent bg-surface px-4 py-3 text-base text-fg" data-testid="aviso-guarda">{notice}</p>
    {/if}
    <section class="flex flex-col gap-3" aria-labelledby="intro-titulo">
      <h2 id="intro-titulo" class="font-serif text-2xl leading-tight sm:text-3xl">Qué separas en esta pantalla</h2>
      <p class="text-base leading-relaxed">
        Umbral Xpectra mide qué diferencias de color distingues, y lo mide en tu pantalla: el resultado depende de lo que esta pantalla puede mostrar y de tus respuestas.
      </p>
      <p class="text-sm leading-relaxed text-fg">No es un diagnóstico ni sustituye una prueba clínica. Con tu perfil puedes probar filtros en láminas, bordes y la cámara.</p>
    </section>

    <nav aria-label="Menú principal" data-testid="menu">
      <ul class="grid gap-3 sm:grid-cols-2">
        {#each options as o (o.href)}
          <li>
            <a href={o.href} class="opcion flex h-full items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-4 text-fg" class:primaria={o.primary}>
              <o.Icon class="mt-0.5 size-6 shrink-0" aria-hidden="true" />
              <span class="flex flex-col gap-1">
                <span class="text-base font-semibold">{o.label}</span>
                <span class="text-sm leading-snug text-fg">{o.hint}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  </main>
</div>

<style>
  /* Tokens de la app (src/styles.css); sin colores propios. La rueda queda arriba y el texto empieza debajo. */
  .portada {
    --rueda-h: min(48vh, 56.25vw);
  }
  .rueda {
    height: var(--rueda-h);
    width: auto;
    max-width: none;
    /* «lighten» sobre --color-bg: el negro de la imagen desaparece; los bordes se funden con el fondo. */
    mix-blend-mode: lighten;
    mask-image: radial-gradient(closest-side, #000 82%, transparent 100%);
  }
  .panel {
    margin-top: var(--rueda-h);
    background: var(--p-veil);
  }
  .opcion :global(svg) {
    color: var(--color-accent);
  }
  .opcion.primaria {
    border-color: var(--color-accent);
  }
  .opcion:hover {
    border-color: var(--color-accent);
  }
  .opcion:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 3px;
  }
</style>
