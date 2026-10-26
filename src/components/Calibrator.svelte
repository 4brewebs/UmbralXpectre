<script lang="ts">
  import { BUILD, scopedStorage as ls } from "@/lib/env";
  import { onMount, untrack } from "svelte";
  import { answer, createSession, parseQpResume, QP_RESUME_KEY, type Judgment, type Session } from "@/lib/color/session";
  import type { ConeId, EdgeFile } from "@/lib/color/edges";
  import { attachLuminance, type LuminanceResult } from "@/lib/color/motion";
  import {
    PROFILE_STORAGE_KEY,
    RETIRED_PROFILE_KEYS,
    buildProfile,
    readHardware,
    type UmbralProfile,
    measuredLumWeights,
  } from "@/lib/color/profile";
  import { lumNoiseEnabled } from "@/lib/color/space";
  import Intro from "./Intro.svelte";
  import SavedPages from "./SavedPages.svelte";
  import { loadStored } from "@/lib/stored";
  import type { Route } from "@/lib/router";
  import Trial from "./Trial.svelte";
  import MotionTest from "./MotionTest.svelte";
  import MotionTestV2 from "./MotionTestV2.svelte";
  import MotionTestV3 from "./MotionTestV3.svelte";
  import { appendHistory, makeSession, type HistoryKind } from "@/lib/color/history";
  import { ANCHOR, cssRgb, toSrgb8 } from "@/lib/color/space";
  import { MOTION_V2_FLAG, viewingSetup, attachMotionV2, motionUiOf, questPlusEnabled, type MotionUi, type MotionV2State, type MotionV2Meta } from "@/lib/color/motion2";
  import { deviceDiff, fingerprint, weightsDevice } from "@/lib/color/device";
  import Result from "./Result.svelte";
  import ReviewTest from "./ReviewTest.svelte";
  import { applyReview, createReview, type ReviewState } from "@/lib/color/review";
  import { clearEdges, loadEdges, saveEdges } from "@/lib/color/edgestore";

  type Phase = "intro" | "run" | "motion" | "review" | "done" | "importar" | "perfiles" | "sesiones";

  let { route, go }: { route: Route; go: (r: Route) => void } = $props();

  /** Fase ↔ ruta. `#/camara` es el resultado con la cámara a la vista. */
  const PHASE_OF: Record<Exclude<Route, "inicio">, Phase> = {
    nuevo: "intro", perfil: "run", movimiento: "motion", repaso: "review", resultado: "done", camara: "done",
    importar: "importar", perfiles: "perfiles", sesiones: "sesiones",
  };
  const ROUTE_OF: Record<Phase, Route> = {
    intro: "nuevo", run: "perfil", motion: "movimiento", review: "repaso", done: "resultado",
    importar: "importar", perfiles: "perfiles", sesiones: "sesiones",
  };

  function persistProfile(profile: UmbralProfile) {
    ls.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    RETIRED_PROFILE_KEYS.forEach((key) => ls.removeItem(key));
  }

  // $state.raw: los objetos se reemplazan enteros, como con useState.
  let phase = $state<Phase>("intro");
  /** Fundido de la portada negra al gris de anclaje antes del primer ensayo (≈1,2 s). */
  let fading = $state(false);
  const FADE_MS = 1200;
  let session = $state.raw<Session | null>(null);
  let profile = $state.raw<UmbralProfile | null>(null);
  let stored = $state.raw<UmbralProfile | null>(null);
  let copied = $state(false);
  let edgeFiles = $state.raw<Partial<Record<ConeId, EdgeFile>>>({});
  let edgesStale = $state(false);

  function setEdges(next: Partial<Record<ConeId, EdgeFile>>) {
    edgeFiles = next;
    saveEdges(ls, next);
  }

  let motionUi = $state<MotionUi>("legacy");
  const motionV2 = $derived(motionUi !== "legacy");

  onMount(() => {
    try {
      motionUi = motionUiOf(window.location.search, ls.getItem(MOTION_V2_FLAG));
    } catch {
      motionUi = "legacy";
    }
    stored = loadStored();
    enter(route);
  });

  // La ruta manda: al cambiar el hash se entra en su fase; al cambiar la fase dentro, se actualiza el hash.
  let mounted = false;
  $effect(() => {
    const r = route;
    if (mounted) untrack(() => enter(r));
  });
  $effect(() => {
    const p = phase;
    untrack(() => {
      if (!mounted) return;
      const want = ROUTE_OF[p];
      if (want !== route && !(route === "camara" && p === "done")) go(want);
    });
  });

  function enter(r: Route) {
    mounted = true;
    if (r === "inicio") return;
    const target = PHASE_OF[r];
    if (target === phase && (target !== "run" || session)) return;
    if (target === "run") {
      void start();
      return;
    }
    if (target === "review" && !review) {
      // Sin repaso en curso no hay nada que repasar: al resultado.
      if (stored) keep(stored);
      return;
    }
    if ((target === "done" || target === "motion") && !profile) {
      if (!stored) return; // la guarda del router ya lo evita
      keep(stored);
    }
    phase = target;
    if (r === "camara") queueMicrotask(() => setTimeout(() => document.getElementById("camara")?.scrollIntoView({ block: "start" }), 50));
  }

  function pairWeightsFrom(saved: UmbralProfile | null) {
    const w = measuredLumWeights(saved);
    if (!w || !saved) return null;
    const device = weightsDevice(saved);
    try {
      return device && deviceDiff(device, fingerprint(readHardware(), null)).length === 0 ? w : null;
    } catch {
      return null;
    }
  }

  async function start() {
    copied = false;
    edgeFiles = {};
    profile = null;
    // QUEST+ sí/no solo con `?qp=1` (carga perezosa); por defecto, la escalera de siempre.
    const Q = questPlusEnabled(window.location.search) ? await (await import("@/lib/color/questplus")).loadQuestPlus() : undefined;
    let resume = null;
    if (Q) {
      try {
        resume = parseQpResume(ls.getItem(QP_RESUME_KEY));
      } catch {
        resume = null;
      }
    }
    // C1: pares con los pesos personales medidos de la última prueba de luminancia en esta pantalla; si no, Y estándar.
    session = createSession(Date.now(), Q, resume, pairWeightsFrom(stored), lumNoiseEnabled(window.location.search));
    fading = true;
    phase = "run";
    setTimeout(() => (fading = false), FADE_MS);
  }

  /** Sesión del historial con el montaje de esta pantalla (misma heurística que movimiento v2). */
  function historyEntry(kind: HistoryKind, method: "staircase" | "quest+", backgroundY: number | null, trials: unknown[], ui?: MotionUi) {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const setup = viewingSetup(window.screen.width, window.screen.height, window.devicePixelRatio || 1, coarse);
    const device = fingerprint(readHardware(), null);
    return makeSession(kind, { date: new Date().toISOString(), deviceType: setup.device, viewingCm: setup.cm, stimulusDeg: null, backgroundY, method, device, ...(ui ? { ui } : {}) }, trials);
  }

  function choose(judgment: Judgment) {
    if (!session) return;
    const next = answer(session, judgment, Date.now());
    session = next;
    if (next.complete) {
      // Historial: se conserva el del perfil anterior y se añade esta calibración (fondo gris ANCHOR lineal).
      const built = appendHistory(
        { ...buildProfile(next, readHardware()), ...(stored?.history ? { history: stored.history } : {}) },
        historyEntry("calibration", next.questPlus ? "quest+" : "staircase", ANCHOR, next.log),
      );
      if (next.questPlus) {
        // QUEST+: lo que el tope de 80 dejó abierto se guarda para seguir en otra sesión.
        try {
          if (built.calibrationResume) ls.setItem(QP_RESUME_KEY, JSON.stringify(built.calibrationResume));
          else ls.removeItem(QP_RESUME_KEY);
        } catch {
          /* sin almacenamiento: se sigue sin reanudar */
        }
      }
      profile = built;
      persistProfile(built);
      // Perfil nuevo: los bordes guardados ya no valen.
      edgeFiles = {};
      edgesStale = false;
      clearEdges(ls);
      stored = built;
      phase = "motion";
    }
  }

  let review = $state.raw<ReviewState | null>(null);

  /** Tras la luminancia: repaso corto de l y m solo con pesos medidos en esta pantalla; si no, al resultado. */
  async function afterLuminance(p: UmbralProfile) {
    review = null;
    if (pairWeightsFrom(p)) {
      try {
        const Q = await (await import("@/lib/color/questplus")).loadQuestPlus();
        review = createReview(p, Q, { seed: Date.now(), lumNoise: lumNoiseEnabled(window.location.search) });
      } catch {
        review = null;
      }
    }
    phase = review ? "review" : "done";
  }

  function takeReview(state: ReviewState) {
    if (!profile) return;
    const reviewed = applyReview(profile, state);
    persistProfile(reviewed);
    profile = reviewed;
    stored = reviewed;
    review = null;
    phase = "done";
  }

  function takeLuminance(result: LuminanceResult) {
    if (!profile) return;
    const attached = attachLuminance(profile, result);
    const enriched = appendHistory(
      { ...attached, luminance: { ...attached.luminance!, ui: "legacy" as const, build: BUILD } },
      historyEntry("motion-v1", "staircase", null, result.matches.flatMap((m) => m.samples), "legacy"),
    );
    persistProfile(enriched);
    profile = enriched;
    stored = enriched;
    void afterLuminance(enriched);
  }

  function takeMotionV2(state: MotionV2State, meta: MotionV2Meta) {
    if (!profile) return;
    const enriched = attachMotionV2(profile, state, { ...meta, device: fingerprint(readHardware(), meta.refreshHz), ui: motionUi === "v3" ? "v3" : "v2" });
    persistProfile(enriched);
    profile = enriched;
    stored = enriched;
    void afterLuminance(enriched);
  }

  // Pesos medidos en otro dispositivo: aviso con «usar igualmente» o «repetir la prueba».
  let deviceAck = $state<string | null>(null);
  const deviceWarning = $derived.by(() => {
    if (!profile || phase !== "done" || deviceAck === profile.createdAt) return null;
    const saved = weightsDevice(profile);
    if (!saved) return null;
    try {
      const diff = deviceDiff(saved, fingerprint(readHardware(), null));
      return diff.length ? diff : null;
    } catch {
      return null;
    }
  });

  function keep(parsed: UmbralProfile) {
    const changed = profile?.createdAt !== parsed.createdAt;
    persistProfile(parsed);
    stored = parsed;
    profile = parsed;
    copied = false;
    // Solo se vacían si cambia el perfil; se restauran los guardados que encajan (basedOn.createdAt).
    if (changed || !Object.keys(edgeFiles).length) {
      const restored = loadEdges(ls, parsed);
      edgeFiles = restored.files;
      edgesStale = restored.stale;
    }
    phase = "done";
  }

  function copyJson() {
    if (!profile) return;
    void navigator.clipboard.writeText(JSON.stringify(profile, null, 2)).then(() => {
      copied = true;
    });
  }

  function downloadJson() {
    if (!profile) return;
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "umbral-perfil.json";
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if fading}
  <div class="fundido" style:--gris={cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]))} style:--dur={`${FADE_MS}ms`} data-testid="fundido" aria-hidden="true"></div>
{/if}

<main class="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-8 sm:py-14">
  <header class="mb-8">
    {#if phase === "intro" || phase === "importar" || phase === "perfiles" || phase === "sesiones"}
      <picture>
        <source srcset="{import.meta.env.BASE_URL}marca/cabecera.webp" type="image/webp" />
        <img src="{import.meta.env.BASE_URL}marca/cabecera.jpg" alt="Umbral Xpectra" width="1600" height="349" class="mb-5 w-full rounded-xl opacity-70" />
      </picture>
    {/if}
    <a href="#/inicio" class="inline-flex items-center gap-1 font-serif text-sm tracking-[0.22em] text-accent uppercase" data-testid="volver-inicio"><span aria-hidden="true">←</span> Umbral Xpectra · Inicio</a>
    <h1 class="mt-2 font-serif text-4xl leading-tight text-fg sm:text-5xl">{phase === "done" ? "Perfil de esta pantalla" : phase === "motion" ? "Hacia dónde caminan" : phase === "review" ? "Repaso con tu brillo" : phase === "importar" ? "Importar" : phase === "perfiles" ? "Perfil guardado" : phase === "sesiones" ? "Sesiones guardadas" : "Qué separas aquí"}</h1>
  </header>

  {#if phase === "intro"}
    <Intro {stored} onStart={() => void start()} onView={() => stored && keep(stored)} onImport={keep} />
  {/if}

  {#if phase === "importar" || phase === "perfiles" || phase === "sesiones"}
    <SavedPages
      mode={phase}
      {stored}
      onProfile={keep}
      onEdges={(file) => {
        setEdges({ ...edgeFiles, [file.cone]: file });
        edgesStale = false;
        if (stored && !profile) keep(stored);
        else phase = "done";
      }}
      {go}
    />
  {/if}

  {#if phase === "run" && session && !fading}
    <Trial {session} onChoose={choose} />
  {/if}

  {#if phase === "motion" && profile && !motionV2}
    <MotionTest {profile} onDone={takeLuminance} onSkip={() => (phase = "done")} />
  {/if}

  {#if phase === "motion" && profile && motionUi === "v3"}
    <MotionTestV3 {profile} onDone={takeMotionV2} onStop={() => (phase = "done")} />
  {/if}

  {#if phase === "motion" && profile && motionUi === "v2"}
    <MotionTestV2 {profile} onDone={takeMotionV2} onStop={() => (phase = "done")} />
  {/if}

  {#if phase === "review" && review}
    <ReviewTest state={review} onDone={takeReview} onSkip={() => { review = null; phase = "done"; }} />
  {/if}

  {#if deviceWarning && profile}
    <section role="alert" class="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <p class="text-base leading-relaxed text-fg">
        El brillo de este perfil se midió en otro dispositivo (cambia: {deviceWarning.join(", ")}). Los pesos y filtros pueden no valer en esta pantalla.
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" onclick={() => (deviceAck = profile?.createdAt ?? null)} class="h-10 rounded-xl border border-border px-3 text-sm text-fg">Usar igualmente</button>
        <button type="button" onclick={() => (phase = "motion")} class="h-10 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-fg">Repetir la prueba</button>
      </div>
    </section>
  {/if}

  {#if phase === "done" && profile}
    <Result
      {profile}
      {copied}
      onCopy={copyJson}
      onDownload={downloadJson}
      onAgain={start}
      onImport={keep}
      onMotion={() => (phase = "motion")}
      onMotionV2={motionV2 ? () => (phase = "motion") : undefined}
      {edgeFiles}
      {edgesStale}
      onEdgeImport={(file) => {
        setEdges({ ...edgeFiles, [file.cone]: file });
        edgesStale = false;
      }}
      onEdgeFile={(file) => {
        setEdges({ ...edgeFiles, [file.cone]: file });
        edgesStale = false;
        if (profile) {
          const enriched = appendHistory(profile, historyEntry("edges", file.reliability ? "quest+" : "staircase", null, file.trials));
          persistProfile(enriched);
          profile = enriched;
          stored = enriched;
        }
      }}
    />
  {/if}
</main>

<style>
  /* Negro de la portada → gris de anclaje del test, a pantalla completa, antes del primer ensayo. */
  .fundido {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: var(--gris);
    animation: fundido var(--dur) linear both;
  }
  @keyframes fundido {
    from {
      background: #000;
    }
    to {
      background: var(--gris);
    }
  }
</style>
