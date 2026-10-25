<script module lang="ts">
  /** Retícula decorativa de la pantalla de prueba. `false` la quita sin tocar la medida. */
  export const SHOW_RETICLE = true;
</script>

<script lang="ts">
  // Retícula tipo instrumento óptico. Restricciones de Colorado (25/10): solo grises
  // acromáticos con Weber ≤ 15 % (líneas) y ≤ 30 % (texto) sobre el fondo; nada dentro
  // del margen máx(1°, un periodo) alrededor del parche; marcas radiales y lejos; simetría
  // izquierda/derecha; estática durante el ensayo (el anillo solo avanza en el ISI).
  import type { Snippet } from "svelte";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { SCREEN } from "@/lib/color/motion2";

  let {
    width,
    height,
    marginPx,
    shade,
    progress,
    labels,
    children,
  }: {
    width: number;
    height: number;
    marginPx: number;
    shade: (weber: number) => string;
    progress: number;
    labels: { tl: string; tr: string; bottom: string };
    children: Snippet;
  } = $props();

  const r = $derived(Math.hypot(width, height) / 2 + marginPx);
  const ringP = $derived(r + 14);
  const side = $derived(Math.ceil(2 * (ringP + 30)));
  const c = $derived(side / 2);
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  // El anillo avanza con easing lento solo al cambiar `progress` (entre ensayos, en el ISI de 0.5 s).
  const eased = new Tween(0, { duration: 400, easing: cubicOut });
  $effect(() => {
    eased.target = Math.max(0, Math.min(1, progress));
  });
  const arcs = $derived.by(() => {
    const th = (eased.current * Math.PI) / 2;
    const pt = (a: number) => `${c + ringP * Math.cos(a)} ${c + ringP * Math.sin(a)}`;
    const out: string[] = [];
    for (const start of [-Math.PI / 2, Math.PI / 2])
      for (const dir of [1, -1]) {
        const sweep = (dir === 1) === (start < 0) ? 1 : 0;
        out.push(`M ${pt(start)} A ${ringP} ${ringP} 0 0 ${sweep} ${pt(start + dir * (start < 0 ? 1 : -1) * th)}`);
      }
    return out;
  });
  const line = $derived(shade(-SCREEN.lineWeber * 0.6));
  const strong = $derived(shade(-SCREEN.lineWeber));
</script>

{#if SHOW_RETICLE}
  <div class="relative" style={`width:${side}px;height:${side}px`} data-testid="reticle">
    <svg class="absolute inset-0" width={side} height={side} viewBox={`0 0 ${side} ${side}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke={line} stroke-width="1" />
      {#each ticks as a (a)}
        {@const t = (a * Math.PI) / 180}
        {@const len = a % 90 === 0 ? 8 : 4}
        <line
          x1={c + Math.cos(t) * (r + 2)}
          y1={c + Math.sin(t) * (r + 2)}
          x2={c + Math.cos(t) * (r + 2 + len)}
          y2={c + Math.sin(t) * (r + 2 + len)}
          stroke={a % 90 === 0 ? strong : line}
          stroke-width="1"
        />
      {/each}
      <circle cx={c} cy={c} r={ringP} fill="none" stroke={line} stroke-width="1" opacity="0.5" />
      {#if eased.current > 0.001}
        <!-- Progreso simétrico: desde arriba y abajo a la vez, hacia izquierda y derecha. -->
        {#each arcs as d (d)}
          <path {d} fill="none" stroke={strong} stroke-width="1.5" stroke-linecap="round" />
        {/each}
      {/if}
    </svg>
    <div class="absolute inset-0 flex items-center justify-center">{@render children()}</div>
    <div class="hud pointer-events-none absolute inset-0 text-[10px]" style={`color:${shade(-SCREEN.textWeber)}`}>
      <span class="absolute left-0 top-0">{labels.tl}</span>
      <span class="absolute right-0 top-0">{labels.tr}</span>
      <span class="absolute bottom-0 left-0 right-0 text-center">{labels.bottom}</span>
    </div>
  </div>
{:else}
  <div style={`padding:${Math.round(marginPx)}px 0`}>{@render children()}</div>
{/if}

<style>
  .hud {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-weight: 300;
    font-variant: small-caps;
    letter-spacing: 0.18em;
    text-transform: lowercase;
  }
</style>
