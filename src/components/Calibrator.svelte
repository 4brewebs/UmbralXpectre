<script lang="ts">
  import { onMount } from "svelte";
  import { answer, createSession, type Judgment, type Session } from "@/lib/color/session";
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
  import { MOTION_V2_FLAG, attachMotionV2, motionV2Enabled, type MotionV2State, type MotionV2Meta } from "@/lib/color/motion2";
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

  function start() {
    copied = false;
    edgeFiles = {};
    profile = null;
    session = createSession(Date.now());
    phase = "run";
  }

  function choose(judgment: Judgment) {
    if (!session) return;
    const next = answer(session, judgment, Date.now());
    session = next;
    if (next.complete) {
      const built = buildProfile(next, readHardware());
      profile = built;
      persistProfile(built);
      stored = built;
      phase = "motion";
    }
  }

  function takeLuminance(result: LuminanceResult) {
    if (!profile) return;
    const enriched = attachLuminance(profile, result);
    persistProfile(enriched);
    profile = enriched;
    stored = enriched;
    phase = "done";
  }

  function takeMotionV2(state: MotionV2State, meta: MotionV2Meta) {
    if (!profile) return;
    const enriched = attachMotionV2(profile, state, meta);
    persistProfile(enriched);
    profile = enriched;
    stored = enriched;
    phase = "done";
  }

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
      onEdgeFile={(file) => (edgeFiles = { ...edgeFiles, [file.cone]: file })}
    />
  {/if}
</main>
