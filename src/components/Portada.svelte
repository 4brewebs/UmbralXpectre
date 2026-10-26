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
  class="portada relative min-h-screen w-full overflow-x-hidden"
  style:--p-black={PORTADA.black}
  style:--p-veil={`rgb(0 0 0 / ${PORTADA.veil.alpha})`}
  style:--p-text={PORTADA.text}
  style:--p-muted={PORTADA.muted}
  style:--p-accent={PORTADA.accent}
  style:--p-btn={PORTADA.buttonBg}
  style:--p-btn-fg={PORTADA.buttonFg}
  data-testid="portada"
>
  <picture class="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
    <source srcset="{base}marca/portada.webp" type="image/webp" />
    <img src="{base}marca/portada.jpg" alt="" class="rueda" style:opacity={PORTADA.imageOpacity} width="1600" height="900" />
  </picture>
  <h1 class="sr-only">Umbral Xpectra</h1>

  <main class="panel relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pt-6 pb-10 sm:px-8">
    {#if notice}
      <p role="alert" class="aviso rounded-xl border px-4 py-3 text-base" data-testid="aviso-guarda">{notice}</p>
    {/if}
    <section class="flex flex-col gap-3" aria-labelledby="intro-titulo">
      <h2 id="intro-titulo" class="font-serif text-2xl leading-tight sm:text-3xl" style:color="var(--p-text)">Qué separas en esta pantalla</h2>
      <p class="text-base leading-relaxed" style:color="var(--p-text)">
        Umbral Xpectra mide qué diferencias de color distingues, y lo mide en tu pantalla: el resultado depende de lo que esta pantalla puede mostrar y de tus respuestas.
      </p>
      <p class="text-sm leading-relaxed" style:color="var(--p-muted)">No es un diagnóstico ni sustituye una prueba clínica. Con tu perfil puedes probar filtros en láminas, bordes y la cámara.</p>
    </section>

    <nav aria-label="Menú principal" data-testid="menu">
      <ul class="grid gap-3 sm:grid-cols-2">
        {#each options as o (o.href)}
          <li>
            <a href={o.href} class="opcion flex h-full items-start gap-3 rounded-2xl border px-4 py-4" class:primaria={o.primary}>
              <o.Icon class="mt-0.5 size-6 shrink-0" aria-hidden="true" />
              <span class="flex flex-col gap-1">
                <span class="text-base font-semibold">{o.label}</span>
                <span class="text-sm leading-snug opacity-100 hint">{o.hint}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  </main>
</div>

<style>
  .portada {
    background: var(--p-black);
    color: var(--p-text);
  }
  /* La rueda queda arriba, atenuada; el texto empieza debajo, nunca encima. */
  .rueda {
    height: var(--rueda-h);
    width: auto;
    max-width: none;
    /* Bordes fundidos con el negro: sin rectángulo visible. */
    mask-image: radial-gradient(closest-side, #000 82%, transparent 100%);
  }
  .portada {
    --rueda-h: min(48vh, 56.25vw);
  }
  .panel {
    margin-top: var(--rueda-h);
    background: var(--p-veil);
  }
  .aviso {
    color: var(--p-text);
    border-color: var(--p-accent);
    background: var(--p-black);
  }
  .opcion {
    color: var(--p-text);
    border-color: #4a463e;
    background: var(--p-black);
  }
  .opcion :global(svg) {
    color: var(--p-accent);
  }
  .opcion .hint {
    color: var(--p-muted);
  }
  .opcion.primaria {
    background: var(--p-btn);
    border-color: var(--p-btn);
    color: var(--p-btn-fg);
  }
  .opcion.primaria :global(svg),
  .opcion.primaria .hint {
    color: var(--p-btn-fg);
  }
  .opcion:focus-visible {
    outline: 2px solid var(--p-accent);
    outline-offset: 3px;
  }
</style>
