<script lang="ts">
  import { Camera, SwitchCamera } from "@lucide/svelte";
  import { buildFilterLuts, type FilterKind } from "@/lib/color/lut";
  import type { EdgeFile } from "@/lib/color/edges";
  import { edgesReady, type FilterSource } from "@/lib/color/spectrum";
  import type { UmbralProfile } from "@/lib/color/profile";
  import { cameraError, createFilter, paint2d, type Facing, type View } from "./camera";

  let { profile, edgeFiles = [] }: { profile: UmbralProfile; edgeFiles?: EdgeFile[] } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let video: HTMLVideoElement | undefined = $state();
  let profileLuts: Record<FilterKind, Uint8Array> | null = null;
  let edgeLuts: Record<FilterKind, Uint8Array> | null = null;
  let luts = $state.raw<Record<FilterKind, Uint8Array> | null>(null);
  let live = $state(false);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let view = $state<View>("assist");
  // Bordes por defecto cuando hay bordes medidos (Lucas); el usuario puede volver a Perfil.
  // svelte-ignore state_referenced_locally
  let source = $state<FilterSource>(edgesReady(edgeFiles) ? "edges" : "profile");
  let sourcePicked = false;
  let facing = $state<Facing>("environment");
  let mounted = true;
  const edgeKey = $derived(edgeFiles.map((file) => `${file.cone}:${file.createdAt}`).join("|"));
  const ready = $derived(edgesReady(edgeFiles));

  function stopStream(el: HTMLVideoElement | undefined) {
    const stream = el?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
  }

  // Bucle de dibujo: depende de live, luts y el canvas (como [live, luts]).
  $effect(() => {
    const el = video;
    const cv = canvas;
    const current = luts;
    if (!live || !current || !el || !cv) return;
    let stopped = false;
    let frame = 0;
    const gl = cv.getContext("webgl2", { premultipliedAlpha: false, alpha: false });
    const filter = gl ? createFilter(gl, current) : null;
    const modeLoc = filter && gl ? gl.getUniformLocation(filter.program, "uMode") : null;

    const draw = () => {
      if (stopped) return;
      frame = window.requestAnimationFrame(draw);
      if (el.readyState < 2 || el.videoWidth === 0) return;
      const mode = view; // lectura no rastreada (dentro de rAF), como viewRef
      if (!gl || !filter || !modeLoc) {
        paint2d(cv, el, mode === "original" ? null : current[mode], mode);
        return;
      }
      const scale = Math.min(1, 1280 / el.videoWidth);
      const w = Math.max(2, Math.round(el.videoWidth * scale));
      const h = Math.max(2, Math.round(el.videoHeight * scale));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        gl.viewport(0, 0, w, h);
      }
      const kind: FilterKind = mode === "original" ? "assist" : mode;
      gl.useProgram(filter.program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, filter.lutTex[kind]);
      gl.uniform1i(filter.lutLoc, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, filter.videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, el);
      gl.uniform1f(modeLoc, mode === "original" ? 0 : 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    frame = window.requestAnimationFrame(draw);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      if (gl && filter) {
        gl.deleteTexture(filter.videoTex);
        gl.deleteTexture(filter.lutTex.assist);
        gl.deleteTexture(filter.lutTex.simulate);
        gl.deleteTexture(filter.lutTex.extreme);
        gl.deleteProgram(filter.program);
      }
    };
  });

  // Perfil o bordes nuevos: hay que volver a hornear las LUT.
  $effect(() => {
    void profile;
    void edgeKey;
    profileLuts = null;
    edgeLuts = null;
    luts = null;
  });

  // Al desmontar se para la cámara. El <video> se captura aquí, así que la
  // limpieza no depende de un ref que ya pueda ser null (bug de la versión React).
  $effect(() => {
    const el = video;
    mounted = true;
    return () => {
      mounted = false;
      stopStream(el);
    };
  });

  function baked(next: FilterSource): Record<FilterKind, Uint8Array> {
    if (next === "edges") {
      if (!edgeLuts) edgeLuts = buildFilterLuts(profile, "edges", edgeFiles);
      return edgeLuts;
    }
    if (!profileLuts) profileLuts = buildFilterLuts(profile);
    return profileLuts;
  }

  $effect(() => {
    if (ready && !sourcePicked && source !== "edges") chooseSource("edges", false);
  });

  function chooseSource(next: FilterSource, byUser = true) {
    if (byUser) sourcePicked = true;
    source = next;
    if (!live) return;
    busy = true;
    window.setTimeout(() => {
      if (!mounted) return;
      luts = baked(next);
      busy = false;
    }, 20);
  }

  async function open(next: Facing) {
    const el = video;
    if (!el || busy) return;
    message = null;
    busy = true;
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    if (!mounted) return;
    luts = baked(source);
    busy = false;
    stopStream(el);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      el.srcObject = stream;
      el.muted = true;
      await el.play();
      if (!mounted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      facing = next;
      live = true;
    } catch (error) {
      live = false;
      busy = false;
      message = cameraError(error);
    }
  }

  function close() {
    stopStream(video);
    if (video) video.srcObject = null;
    live = false;
  }

  const sources = [
    ["profile", "Perfil"],
    ["edges", "Bordes"],
  ] as const;
  const views = [
    ["original", "Sin filtro"],
    ["assist", "Asistencia"],
    ["simulate", "Simulador"],
    ["extreme", "Extremo"],
  ] as const;
</script>

<section class="flex flex-col gap-4 border-t border-border pt-8">
  <div>
    <h2 class="font-serif text-2xl text-fg">Cámara</h2>
    <p class="mt-2 text-sm leading-relaxed text-muted">
      El permiso es el del navegador y el vídeo no sale de este aparato. Sin filtro es la cámara. Asistencia mueve solo el tramo conflictivo al color cercano que este perfil sí separa, sin subir la saturación. Simulador es el segundo arcoíris. Extremo es la asistencia de antes, con la saturación muy subida. El JSON se midió en una pantalla: en otra cámara sigue siendo ese perfil, no un diagnóstico nuevo.
    </p>
  </div>
  <video bind:this={video} playsinline muted autoplay class="hidden"></video>
  {#if live}
    <canvas bind:this={canvas} class="aspect-video w-full rounded-2xl bg-stage object-cover"></canvas>
  {/if}
  <div class="flex flex-wrap gap-2">
    {#each sources as [id, label] (id)}
      <button
        type="button"
        onclick={() => chooseSource(id)}
        class={`h-10 rounded-xl px-3 text-sm ${source === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
      >{label}</button>
    {/each}
  </div>
  {#if source === "edges" && !ready}
    <p class="text-sm text-muted">Sin bordes cerrados, el filtro usa una región provisional: hasta el punto medio hacia el primer eje sano, al 70 %.</p>
  {/if}
  <div class="flex flex-wrap gap-2">
    {#if live}
      {#each views as [id, label] (id)}
        <button
          type="button"
          onclick={() => (view = id)}
          class={`h-10 rounded-xl px-3 text-sm ${view === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
        >{label}</button>
      {/each}
      <button
        type="button"
        onclick={() => void open(facing === "environment" ? "user" : "environment")}
        class="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm text-fg"
      ><SwitchCamera class="size-4" aria-hidden="true" />Cambiar</button>
      <button type="button" onclick={close} class="h-10 rounded-xl border border-border px-3 text-sm text-fg">Cerrar</button>
    {:else}
      <button
        type="button"
        onclick={() => void open(facing)}
        disabled={busy}
        class="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-accent-fg disabled:opacity-60"
      ><Camera class="size-4" aria-hidden="true" />{busy ? "Preparando el filtro…" : "Abrir cámara"}</button>
    {/if}
  </div>
  {#if message}
    <p class="text-sm text-muted">{message}</p>
  {/if}
</section>
