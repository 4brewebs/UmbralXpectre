<script lang="ts">
  import { FilePlus2, Upload, UserRound, History } from "@lucide/svelte";
  import type { UmbralProfile } from "@/lib/color/profile";
  import type { EdgeFile } from "@/lib/color/edges";
  import { loadEdges } from "@/lib/color/edgestore";
  import { scopedStorage as ls } from "@/lib/storage";
  import type { Route } from "@/lib/router";
  import ImportJson from "./ImportJson.svelte";

  // Páginas sencillas sobre lo que ya existe: la importación de JSON y lo guardado en localStorage.
  let {
    mode,
    stored,
    onProfile,
    onEdges,
    go,
  }: {
    mode: "importar" | "perfiles" | "sesiones";
    stored: UmbralProfile | null;
    onProfile: (p: UmbralProfile) => void;
    onEdges?: (file: EdgeFile) => void;
    go: (r: Route) => void;
  } = $props();

  const KIND: Record<string, string> = { calibration: "Calibración", "motion-v1": "Brillo (v1)", "motion-v2": "Brillo (v2)", edges: "Bordes" };
  const fecha = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  };
  const edges = $derived.by(() => {
    if (!stored) return null;
    try {
      return loadEdges(ls, stored);
    } catch {
      return null;
    }
  });
  const sessions = $derived([...(stored?.history?.sessions ?? [])].reverse());
</script>

<div class="flex flex-col gap-6" data-testid={`pagina-${mode}`}>
  {#if mode === "importar"}
    <p class="leading-relaxed text-fg">Carga un perfil exportado (<code>umbral-perfil.json</code>). Si ya hay un perfil, también puedes añadir sus bordes.</p>
    <div class="flex flex-col gap-3 sm:flex-row">
      <ImportJson onProfile={onProfile} edgeProfile={stored} {onEdges} />
    </div>
  {:else if !stored}
    <p class="leading-relaxed text-fg">{mode === "perfiles" ? "No hay ningún perfil guardado en este navegador." : "No hay sesiones guardadas: el historial vive dentro del perfil, y aún no hay ninguno."}</p>
    <div class="flex flex-col gap-3 sm:flex-row">
      <button type="button" onclick={() => go("nuevo")} class="inline-flex h-12 items-center gap-2 rounded-2xl bg-accent px-5 font-semibold text-accent-fg"><FilePlus2 class="size-5" aria-hidden="true" /> Empezar de cero</button>
      <button type="button" onclick={() => go("importar")} class="inline-flex h-12 items-center gap-2 rounded-2xl border border-border px-5 text-fg"><Upload class="size-5" aria-hidden="true" /> Importar</button>
    </div>
  {:else if mode === "perfiles"}
    <ul class="flex flex-col gap-3">
      <li class="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <span class="flex items-center gap-2 text-fg"><UserRound class="size-5 text-accent" aria-hidden="true" /> Perfil del {fecha(stored.createdAt)}</span>
        <span class="text-sm text-fg">{stored.history?.sessions.length ?? 0} sesiones en el historial · bordes guardados: {edges ? Object.keys(edges.files).length : 0}{edges?.stale ? " (de un perfil anterior)" : ""}</span>
        <button type="button" onclick={() => onProfile(stored)} class="h-11 self-start rounded-xl bg-accent px-4 font-semibold text-accent-fg">Usar este perfil</button>
      </li>
    </ul>
  {:else}
    {#if !sessions.length}
      <p class="text-fg">El perfil guardado no tiene sesiones en su historial.</p>
    {/if}
    <ul class="flex flex-col gap-2">
      {#each sessions as s (s.id)}
        <li class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-3">
          <span class="flex items-center gap-2 text-fg"><History class="size-5 text-accent" aria-hidden="true" /> {KIND[s.kind] ?? s.kind} · {fecha(s.date)} · {s.count} ensayos</span>
          <button type="button" onclick={() => onProfile(stored)} class="h-10 rounded-xl border border-border px-3 text-sm text-fg">Abrir su perfil</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
