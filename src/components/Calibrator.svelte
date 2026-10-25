<script lang="ts">
  import { onMount } from "svelte";
  import { answer, createSession, parseQpResume, QP_RESUME_KEY, type Judgment, type Session } from "@/lib/color/session";
  import type { ConeId, EdgeFile } from "@/lib/color/edges";
  import { attachLuminance, type LuminanceResult } from "@/lib/color/motion";
  import {
    PROFILE_STORAGE_KEY,
    RETIRED_PROFILE_KEYS,
    buildProfile,
    parseProfile,
    readHardware,
    type UmbralProfile,
  } from "@/lib/color/profile";
  import Intro from "./Intro.svelte";
  import Trial from "./Trial.svelte";
  import MotionTest from "./MotionTest.svelte";
  import MotionTestV2 from "./MotionTestV2.svelte";
  import { appendHistory, makeSession, type HistoryKind } from "@/lib/color/history";
  import { ANCHOR } from "@/lib/color/space";
  import { MOTION_V2_FLAG, viewingSetup, attachMotionV2, motionV2Enabled, questPlusEnabled, type MotionV2State, type MotionV2Meta } from "@/lib/color/motion2";
  import { deviceDiff, fingerprint, weightsDevice } from "@/lib/color/device";
  import Result from "./Result.svelte";

  type Phase = "intro" | "run" | "motion" | "done";

  function loadStored(): UmbralProfile | null {
    if (typeof window === "undefined") return null;
    try {
      const current = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (current) {
        const parsed = parseProfile(current);
        if (parsed) {
          RETIRED_PROFILE_KEYS.forEach((key) => window.localStorage.removeItem(key));
          return parsed;
        }
      }
      for (const key of RETIRED_PROFILE_KEYS) {
        const previous = window.localStorage.getItem(key);
        const parsed = previous ? parseProfile(previous) : null;
        if (parsed) return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  function persistProfile(profile: UmbralProfile) {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    RETIRED_PROFILE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  }

  // $state.raw: los objetos se reemplazan enteros, como con useState.
  let phase = $state<Phase>("intro");
  let session = $state.raw<Session | null>(null);
  let profile = $state.raw<UmbralProfile | null>(null);
  let stored = $state.raw<UmbralProfile | null>(null);
  let copied = $state(false);
  let edgeFiles = $state.raw<Partial<Record<ConeId, EdgeFile>>>({});

  let motionV2 = $state(false);

  onMount(() => {
    try {
      motionV2 = motionV2Enabled(window.location.search, window.localStorage.getItem(MOTION_V2_FLAG));
    } catch {
      motionV2 = false;
    }
    stored = loadStored();
  });

  async function start() {
    copied = false;
    edgeFiles = {};
    profile = null;
    // QUEST+ sí/no solo con `?qp=1` (carga perezosa); por defecto, la escalera de siempre.
    const Q = questPlusEnabled(window.location.search) ? await (await import("@/lib/color/questplus")).loadQuestPlus() : undefined;
    let resume = null;
    if (Q) {
      try {
        resume = parseQpResume(window.localStorage.getItem(QP_RESUME_KEY));
      } catch {
        resume = null;
      }
    }
    session = createSession(Date.now(), Q, resume);
    phase = "run";
  }

  /** Sesión del historial con el montaje de esta pantalla (misma heurística que movimiento v2). */
  function historyEntry(kind: HistoryKind, method: "staircase" | "quest+", backgroundY: number | null, trials: unknown[]) {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const setup = viewingSetup(window.screen.width, window.screen.height, window.devicePixelRatio || 1, coarse);
    const device = fingerprint(readHardware(), null);
    return makeSession(kind, { date: new Date().toISOString(), deviceType: setup.device, viewingCm: setup.cm, stimulusDeg: null, backgroundY, method, device }, trials);
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
          if (built.calibrationResume) window.localStorage.setItem(QP_RESUME_KEY, JSON.stringify(built.calibrationResume));
          else window.localStorage.removeItem(QP_RESUME_KEY);
        } catch {
          /* sin almacenamiento: se sigue sin reanudar */
        }
      }
      profile = built;
      persistProfile(built);
      stored = built;
      phase = "motion";
    }
  }

  function takeLuminance(result: LuminanceResult) {
    if (!profile) return;
    const enriched = appendHistory(
      attachLuminance(profile, result),
      historyEntry("motion-v1", "staircase", null, result.matches.flatMap((m) => m.samples)),
    );
    persistProfile(enriched);
    profile = enriched;
    stored = enriched;
    phase = "done";
  }

  function takeMotionV2(state: MotionV2State, meta: MotionV2Meta) {
    if (!profile) return;
    const enriched = attachMotionV2(profile, state, { ...meta, device: fingerprint(readHardware(), meta.refreshHz) });
    persistProfile(enriched);
    profile = enriched;
    stored = enriched;
    phase = "done";
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
    persistProfile(parsed);
    stored = parsed;
    profile = parsed;
    copied = false;
    edgeFiles = {};
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

<main class="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-8 sm:py-14">
  <header class="mb-8">
    <p class="font-serif text-sm tracking-[0.22em] text-accent uppercase">Umbral</p>
    <h1 class="mt-2 font-serif text-4xl leading-tight text-fg sm:text-5xl">{phase === "done" ? "Perfil de esta pantalla" : phase === "motion" ? "Hacia dónde caminan" : "Qué separas aquí"}</h1>
  </header>

  {#if phase === "intro"}
    <Intro {stored} onStart={start} onView={() => stored && keep(stored)} onImport={keep} />
  {/if}

  {#if phase === "run" && session}
    <Trial {session} onChoose={choose} />
  {/if}

  {#if phase === "motion" && profile && !motionV2}
    <MotionTest {profile} onDone={takeLuminance} onSkip={() => (phase = "done")} />
  {/if}

  {#if phase === "motion" && profile && motionV2}
    <MotionTestV2 {profile} onDone={takeMotionV2} onStop={() => (phase = "done")} />
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
      onEdgeFile={(file) => {
        edgeFiles = { ...edgeFiles, [file.cone]: file };
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
