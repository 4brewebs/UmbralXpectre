import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, RotateCcw, Upload } from "lucide-react";
import { cssRgb, toSrgb8, ANCHOR, addScaled, dirFromTheta } from "@/lib/color/space";
import { colorFor, coneBlurb, coneLead, coneOrder, CONE_MARKS, edgesReady, markLeft, spectrumSamples, type FilterSource } from "@/lib/color/spectrum";
import {
  answer,
  createSession,
  stimulusOf,
  type Judgment,
  type Session,
} from "@/lib/color/session";
import { Plates } from "@/components/plates";
import { AssistCamera } from "@/components/camera";
import { MotionTest } from "@/components/motion";
import { EdgeTest } from "@/components/edges";
import { edgeFilename, type ConeId, type EdgeFile } from "@/lib/color/edges";
import { attachLuminance, type LuminanceResult } from "@/lib/color/motion";
import { buildTransformFile } from "@/lib/color/lut";
import {
  PROFILE_STORAGE_KEY,
  RETIRED_PROFILE_KEY,
  axisRank,
  buildProfile,
  parseProfile,
  profileRejectReason,
  readHardware,
  type UmbralProfile,
} from "@/lib/color/profile";

type Phase = "intro" | "run" | "motion" | "done";

function loadStored(): UmbralProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const current = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (current) {
      const parsed = parseProfile(current);
      if (parsed) {
        window.localStorage.removeItem(RETIRED_PROFILE_KEY);
        return parsed;
      }
    }
    const previous = window.localStorage.getItem(RETIRED_PROFILE_KEY);
    if (!previous) return null;
    return parseProfile(previous);
  } catch {
    return null;
  }
}

function persistProfile(profile: UmbralProfile) {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  window.localStorage.removeItem(RETIRED_PROFILE_KEY);
}

export function Calibrator() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UmbralProfile | null>(null);
  const [stored, setStored] = useState<UmbralProfile | null>(null);
  const [copied, setCopied] = useState(false);
  const [edgeFiles, setEdgeFiles] = useState<Partial<Record<ConeId, EdgeFile>>>({});

  useEffect(() => {
    setStored(loadStored());
  }, []);

  function start() {
    setCopied(false);
    setEdgeFiles({});
    setProfile(null);
    setSession(createSession(Date.now()));
    setPhase("run");
  }

  function choose(judgment: Judgment) {
    if (!session) return;
    const next = answer(session, judgment, Date.now());
    setSession(next);
    if (next.complete) {
      const built = buildProfile(next, readHardware());
      setProfile(built);
      persistProfile(built);
      setStored(built);
      setPhase("motion");
    }
  }

  function takeLuminance(result: LuminanceResult) {
    if (!profile) return;
    const enriched = attachLuminance(profile, result);
    persistProfile(enriched);
    setProfile(enriched);
    setStored(enriched);
    setPhase("done");
  }

  function keep(parsed: UmbralProfile) {
    persistProfile(parsed);
    setStored(parsed);
    setProfile(parsed);
    setCopied(false);
    setEdgeFiles({});
    setPhase("done");
  }

  function copyJson() {
    if (!profile) return;
    void navigator.clipboard.writeText(JSON.stringify(profile, null, 2)).then(() => {
      setCopied(true);
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-8 sm:py-14">
      <header className="mb-8">
        <p className="font-serif text-sm tracking-[0.22em] text-accent uppercase">Umbral</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight text-fg sm:text-5xl">
          {phase === "done" ? "Perfil de esta pantalla" : phase === "motion" ? "Hacia dónde caminan" : "Qué separas aquí"}
        </h1>
      </header>

      {phase === "intro" ? (
        <Intro stored={stored} onStart={start} onView={() => stored && keep(stored)} onImport={keep} />
      ) : null}

      {phase === "run" && session ? <Trial session={session} onChoose={choose} /> : null}

      {phase === "motion" && profile ? (
        <MotionTest profile={profile} onDone={takeLuminance} onSkip={() => setPhase("done")} />
      ) : null}

      {phase === "done" && profile ? (
        <Result
          profile={profile}
          copied={copied}
          onCopy={copyJson}
          onDownload={downloadJson}
          onAgain={start}
          onImport={keep}
          onMotion={() => setPhase("motion")}
          edgeFiles={edgeFiles}
          onEdgeFile={(file) => setEdgeFiles((current) => ({ ...current, [file.cone]: file }))}
        />
      ) : null}
    </main>
  );
}

function Intro({
  stored,
  onStart,
  onView,
  onImport,
}: {
  stored: UmbralProfile | null;
  onStart: () => void;
  onView: () => void;
  onImport: (profile: UmbralProfile) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-lg leading-relaxed text-muted">
        Mide, en esta pantalla, qué diferencias de color separas y cuáles no. No te clasifica.
        El resultado es un perfil de tus respuestas y de este dispositivo.
      </p>
      <ol className="flex flex-col gap-4 border-t border-border pt-6">
        <Item n="1" text="Brillo al máximo. Sin modo noche ni filtro de color del sistema." />
        <Item n="2" text="Entre prueba y prueba la pantalla se queda en gris. Juzga las dos mitades quietas, no el salto." />
        <Item
          n="3"
          text="Se miden las fronteras entre conos y también el primer azul y el último rojo que esta pantalla puede emitir. El orden cambia. Algunos pares son el mismo color: no todo es distinto."
        />
        <Item n="4" text="Después, un campo que se desplaza. Sigue hasta que solo late, y pulsa Quieto." />
      </ol>
      <p className="text-sm leading-relaxed text-muted">
        No es un diagnóstico clínico. Dos personas con la misma etiqueta no reciben el mismo JSON.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onStart}
          className="h-14 rounded-2xl bg-accent px-6 text-base font-semibold text-accent-fg"
        >
          Empezar calibración
        </button>
        {stored ? (
          <button
            type="button"
            onClick={onView}
            className="h-14 rounded-2xl border border-border px-6 text-base text-fg"
          >
            Ver perfil guardado
          </button>
        ) : null}
        <ImportJson onProfile={onImport} />
      </div>
    </div>
  );
}

function ImportJson({ onProfile }: { onProfile: (profile: UmbralProfile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-1 flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then((text) => {
            const parsed = parseProfile(text);
            if (!parsed) {
              setError(profileRejectReason(text));
              return;
            }
            setError(null);
            onProfile(parsed);
          });
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border px-6 text-base text-fg"
      >
        <Upload className="size-4" aria-hidden="true" />
        Importar JSON
      </button>
      {error ? <p className="text-sm text-muted">{error}</p> : null}
    </div>
  );
}

function Item({ n, text }: { n: string; text: string }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3">
      <span className="font-serif text-xl text-accent">{n}</span>
      <span className="leading-relaxed text-fg">{text}</span>
    </li>
  );
}

function Trial({ session, onChoose }: { session: Session; onChoose: (j: Judgment) => void }) {
  const stim = stimulusOf(session);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const id = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(id);
  }, [stim?.step]);
  if (!stim) return null;
  const left = stim.side === "left" ? stim.comparison : stim.reference;
  const right = stim.side === "left" ? stim.reference : stim.comparison;
  const priors = session.axes.filter((a) => a.priorKey !== "refine").slice().sort((a, b) => axisRank(a) - axisRank(b));
  const neutral = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-muted">Paso {stim.step}</p>
        <p className="text-sm text-muted">
          {stim.catch
            ? "Mira las dos, en reposo."
            : stim.refining
              ? "Afinando al lado"
              : `Eje ${Math.max(1, priors.findIndex((axis) => axis.id === session.activeId) + 1)} de ${stim.priorTotal}`}
        </p>
      </div>
      <p className="min-h-12 text-lg leading-snug text-fg" aria-live="polite">
        {ready ? session.note : "Pausa en gris. No juzgues el cambio."}
      </p>
      <div className="mx-auto aspect-square w-full max-w-md rounded-full bg-stage p-5 sm:p-7">
        {ready ? (
          <div
            className="grid h-full grid-cols-[1fr_0.55rem_1fr] overflow-hidden rounded-full"
            role="img"
            aria-label={`Dos campos. Contraste ${stim.hue}.`}
          >
            <div style={{ background: cssRgb(left), transition: "none" }} />
            <div className="bg-stage" />
            <div style={{ background: cssRgb(right), transition: "none" }} />
          </div>
        ) : (
          <div className="h-full rounded-full" style={{ background: neutral }} role="img" aria-label="Pausa gris" />
        )}
      </div>
      <p className="text-center text-sm text-muted">
        Misma luminosidad y misma saturación. Si solo notas el salto, son iguales.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => onChoose("same")}
          className="h-14 rounded-2xl border border-border bg-surface text-base font-medium text-fg disabled:opacity-40"
        >
          Iguales
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onChoose("different")}
          className="h-14 rounded-2xl border border-border bg-surface text-base font-medium text-fg disabled:opacity-40"
        >
          Distintos
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {priors.map((axis) => {
          const state =
            axis.phase !== "done"
              ? axis.id === session.activeId
                ? "ahora"
                : "espera"
              : axis.thresholdKind === "upper-bound"
                ? "fino"
                : "medido";
          return (
            <li key={axis.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
              <span className="text-fg">{axis.hue}</span>
              <span className="text-muted">{state}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function downloadEdgeFile(file: EdgeFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = edgeFilename(file.cone);
  link.click();
  URL.revokeObjectURL(url);
}

function Result({
  profile,
  copied,
  onCopy,
  onDownload,
  onAgain,
  onImport,
  onMotion,
  edgeFiles,
  onEdgeFile,
}: {
  profile: UmbralProfile;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onAgain: () => void;
  onImport: (profile: UmbralProfile) => void;
  onMotion: () => void;
  edgeFiles: Partial<Record<ConeId, EdgeFile>>;
  onEdgeFile: (file: EdgeFile) => void;
}) {
  const json = JSON.stringify(profile, null, 2);
  const [baking, setBaking] = useState(false);
  const [measuring, setMeasuring] = useState<ConeId | null>(null);
  function downloadTransforms() {
    if (baking) return;
    setBaking(true);
    window.setTimeout(() => {
      try {
        const file = buildTransformFile(profile);
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "umbral-transformadas.json";
        link.click();
        URL.revokeObjectURL(url);
      } finally {
        setBaking(false);
      }
    }, 40);
  }
  const elevated = profile.fit.pathways?.filter((pathway) => pathway.elevated) ?? [];
  if (measuring) {
    return (
      <EdgeTest
        key={measuring}
        profile={profile}
        cone={measuring}
        onCancel={() => setMeasuring(null)}
        onDone={(file) => {
          onEdgeFile(file);
          setMeasuring(null);
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <p className="text-lg leading-relaxed text-fg">{profile.summary.replace(/ Brillo, por movimiento:.*$/, "")}</p>
      <p className="text-sm text-muted">
        Pares iguales: {profile.catches.same} vistos iguales
        {profile.catches.missed ? `, ${profile.catches.missed} marcados distintos` : ""}.
      </p>
      {profile.luminance?.matches?.length ? <Brightness matches={profile.luminance.matches} /> : (
        <button type="button" onClick={onMotion} className="text-sm text-muted">
          Medir el brillo con las bandas
        </button>
      )}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
        <Stat label="Confianza" value={profile.confidence === "high" ? "Alta" : "Baja"} />
        <Stat
          label="Sobre el control"
          value={
            profile.fit.timesControl == null
              ? "—"
              : `${profile.fit.timesControlKind === "at-least" ? "≥ " : ""}${profile.fit.timesControl.toFixed(1)}×`
          }
        />
        <Stat
          label="Líneas altas"
          value={profile.fit.elevatedCount == null ? "—" : String(profile.fit.elevatedCount)}
        />
        <Stat
          label="Ángulo"
          value={
            profile.fit.elevatedCount != null && profile.fit.elevatedCount !== 1
              ? "varias o ninguna"
              : profile.fit.confusionAngleDeg == null
                ? "—"
                : `${profile.fit.confusionAngleDeg}°`
          }
        />
        <Stat
          label="Desvío del prior"
          value={
            profile.fit.shiftFromNearestPriorDeg == null ? "—" : `${profile.fit.shiftFromNearestPriorDeg}°`
          }
        />
      </dl>
      <ul className="flex flex-col gap-3">
        {profile.axes
          .filter((a) => a.role !== "refine" || !a.closed)
          .map((axis) => {
            const peak = Math.max(...profile.axes.map((item) => item.threshold ?? 0), 0.0001);
            const width = Math.round(((axis.threshold ?? 0) / peak) * 100);
            return (
              <li key={axis.id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-fg">{axis.label ?? axis.hue}</span>
                  <span className="text-muted">
                    {axis.thresholdKind === "upper-bound" ? "fino" : axis.closed ? "bajo" : "medido"}
                    {axis.threshold != null ? ` · ${axis.threshold.toFixed(3)}` : ""}
                    {axis.thresholdKind === "upper-bound" ? " o menos" : ""}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface">
                  <div className="h-full bg-fg" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
      </ul>
      {profile.fit.pathways?.length ? <ConeCard profile={profile} edgeFiles={Object.values(edgeFiles)} /> : null}
      <Plates profile={profile} />
      <AssistCamera profile={profile} edgeFiles={Object.values(edgeFiles)} />
      <p className="text-sm leading-relaxed text-muted">{profile.disclaimer}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-fg"
        >
          <Download className="size-4" aria-hidden="true" />
          Descargar JSON
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg"
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copiado" : "Copiar JSON"}
        </button>
        <ImportJson onProfile={onImport} />
      </div>
      <button
        type="button"
        disabled={baking}
        onClick={downloadTransforms}
        className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg disabled:opacity-50"
      >
        <Download className="size-4" aria-hidden="true" />
        {baking ? "Preparando transformaciones…" : "Descargar JSON transformaciones"}
      </button>
      {elevated.map((pathway) => {
        const cone = pathway.id as ConeId;
        const name = cone === "l" ? "rojos" : cone === "m" ? "verdes" : "azules";
        const file = edgeFiles[cone];
        return (
          <div key={cone} className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setMeasuring(cone)}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg"
            >
              {file ? `Repetir bordes ${name}` : `Medir bordes ${name}`}
            </button>
            {file ? (
              <button
                type="button"
                onClick={() => downloadEdgeFile(file)}
                className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-base text-fg"
              >
                <Download className="size-4" aria-hidden="true" />
                Descargar JSON {name}
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAgain}
        className="inline-flex h-12 items-center justify-center gap-2 text-sm text-muted"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        Repetir calibración
      </button>
      <details className="rounded-2xl border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm text-fg">Ver JSON</summary>
        <pre className="max-h-80 overflow-auto px-4 pb-4 text-xs leading-relaxed text-muted">{json}</pre>
      </details>
    </div>
  );
}

function ConeCard({ profile, edgeFiles }: { profile: UmbralProfile; edgeFiles: EdgeFile[] }) {
  const pathways = coneOrder(profile.fit.pathways);
  const control = profile.fit.controlAbs ?? 0;
  const ceiling = Math.max(control, ...pathways.map((p) => p.threshold), 0.001);
  const samples = spectrumSamples();
  const strip = (colors: Array<[number, number, number]>) =>
    `linear-gradient(90deg, ${colors
      .map((rgb, i) => `${cssRgb(toSrgb8(rgb))} ${(i / (colors.length - 1)) * 100}%`)
      .join(", ")})`;
  const [source, setSource] = useState<FilterSource>("profile");
  const ready = edgesReady(edgeFiles);
  const paint = (kind: "simulate" | "correct" | "assist") =>
    strip(samples.map((s) => colorFor(kind, s.rgb, profile, source, edgeFiles)));
  const expected = strip(samples.map((s) => s.rgb));
  const yours = paint("simulate");
  const corrected = paint("correct");
  const assisted = paint("assist");

  return (
    <section className="flex flex-col gap-6 border-t border-border pt-8">
      <div>
        <h2 className="font-serif text-2xl text-fg">Tus conos</h2>
        <p className="mt-2 text-base leading-relaxed text-fg">{coneLead(pathways)}</p>
      </div>
      <ul className="flex flex-col gap-5">
        {pathways.map((pathway) => {
          const mark = CONE_MARKS.find((item) => item.id === pathway.id);
          const yoursWidth = Math.round((pathway.threshold / ceiling) * 100);
          const expectedAt = Math.round((control / ceiling) * 100);
          return (
            <li key={pathway.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-fg">{mark?.name ?? pathway.hue}</span>
                <span className="text-sm text-muted">
                  {pathway.kind === "upper-bound"
                    ? `≤ ${pathway.threshold.toFixed(3)}`
                    : `${pathway.threshold.toFixed(3)}${pathway.timesControl != null ? ` · ${pathway.timesControl.toFixed(1)}×` : ""}`}
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-surface">
                <div className="h-full rounded-full bg-fg" style={{ width: `${yoursWidth}%` }} />
                <div className="absolute top-[-3px] h-3.5 w-px bg-accent" style={{ left: `${expectedAt}%` }} />
              </div>
              <p className="text-sm leading-relaxed text-muted">{coneBlurb(pathway)}</p>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">La marca dorada es el control de esta pantalla. La barra es tu límite.</p>
      <SourceSwitch source={source} onChange={setSource} />
      {source === "edges" && !ready ? (
        <p className="text-sm text-muted">Sin un borde cerrado, este filtro no cambia ningún color.</p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Strip label="En esta pantalla" gradient={expected} />
        <Strip label="Tu visión" gradient={yours} />
        <Strip label="Mapa intermedio" gradient={corrected} />
        <Strip label="Asistencia" gradient={assisted} />
      </div>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted">
          Los cuatro van en el mismo orden. El primero es la pantalla, sin filtro. El segundo, Tu visión, es el simulador de este perfil. El tercero pinta ese tramo sobre el cono intacto, para ver dónde cae. El cuarto es la asistencia: el mismo tramo, llevado al color cercano que sí separas, con la saturación del original y el brillo que midió la prueba. En las láminas y en la cámara está también Extremo, la asistencia de antes, con la saturación muy subida.
        </p>
        <Overlap profile={profile} floor={control} />
        <CorrectedPair profile={profile} floor={control} source={source} edgeFiles={edgeFiles} />
        <AssistedPair profile={profile} floor={control} source={source} edgeFiles={edgeFiles} />
      </div>
    </section>
  );
}

function SourceSwitch({ source, onChange }: { source: FilterSource; onChange: (source: FilterSource) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["profile", "Perfil"],
          ["edges", "Bordes"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`h-10 rounded-xl px-3 text-sm ${source === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function worstMeasured(profile: UmbralProfile) {
  return profile.axes
    .filter((item) => item.role === "l" || item.role === "m" || item.role === "s" || item.role === "red-end" || item.role === "blue-end")
    .filter((item) => item.thresholdKind === "estimate" && item.threshold != null)
    .sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0))[0];
}

function Overlap({ profile, floor }: { profile: UmbralProfile; floor: number }) {
  const axis = worstMeasured(profile);
  if (!axis || axis.threshold == null || floor <= 0 || axis.threshold < floor * 1.6) return null;
  const dir = dirFromTheta((axis.angleDeg * Math.PI) / 180);
  const anchor: [number, number, number] = [ANCHOR, ANCHOR, ANCHOR];
  const left = addScaled(anchor, dir, axis.threshold);
  const right = addScaled(anchor, dir, -axis.threshold);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg">El par que se te solapa</p>
      <div className="flex gap-3">
        <Swatch rgb={left} />
        <Swatch rgb={right} />
      </div>
      <p className="text-sm leading-relaxed text-muted">
        En la vía más corta mediste estos dos como iguales. Ahí se montan, sea cual sea el color. No los he convertido en
        gris en el arcoíris: el gris te quitaría saturación, y esa sí la separas.
      </p>
    </div>
  );
}

function CorrectedPair({
  profile,
  floor,
  source,
  edgeFiles,
}: {
  profile: UmbralProfile;
  floor: number;
  source: FilterSource;
  edgeFiles: EdgeFile[];
}) {
  const axis = worstMeasured(profile);
  if (!axis || axis.threshold == null || floor <= 0 || axis.threshold < floor * 1.6) return null;
  const dir = dirFromTheta((axis.angleDeg * Math.PI) / 180);
  const anchor: [number, number, number] = [ANCHOR, ANCHOR, ANCHOR];
  const left = colorFor("correct", addScaled(anchor, dir, axis.threshold), profile, source, edgeFiles);
  const right = colorFor("correct", addScaled(anchor, dir, -axis.threshold), profile, source, edgeFiles);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg">Ese par, en el mapa intermedio</p>
      <div className="flex gap-3">
        <Swatch rgb={left} />
        <Swatch rgb={right} />
      </div>
    </div>
  );
}

function AssistedPair({
  profile,
  floor,
  source,
  edgeFiles,
}: {
  profile: UmbralProfile;
  floor: number;
  source: FilterSource;
  edgeFiles: EdgeFile[];
}) {
  const axis = worstMeasured(profile);
  if (!axis || axis.threshold == null || floor <= 0 || axis.threshold < floor * 1.6) return null;
  const dir = dirFromTheta((axis.angleDeg * Math.PI) / 180);
  const anchor: [number, number, number] = [ANCHOR, ANCHOR, ANCHOR];
  const left = colorFor("assist", addScaled(anchor, dir, axis.threshold), profile, source, edgeFiles);
  const right = colorFor("assist", addScaled(anchor, dir, -axis.threshold), profile, source, edgeFiles);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg">Ese par, con la asistencia</p>
      <div className="flex gap-3">
        <Swatch rgb={left} />
        <Swatch rgb={right} />
      </div>
    </div>
  );
}

function Swatch({ rgb }: { rgb: [number, number, number] }) {
  return (
    <div
      className="h-14 flex-1 rounded-2xl"
      style={{ background: cssRgb(toSrgb8(rgb)) }}
      role="img"
      aria-label={cssRgb(toSrgb8(rgb))}
    />
  );
}

function Strip({ label, gradient }: { label: string; gradient: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted">{label}</p>
      <div className="relative pt-3">
        {CONE_MARKS.map((mark) => (
          <span key={mark.id} className="absolute top-0 h-2.5 w-px bg-accent" style={{ left: `${markLeft(mark.nm)}%` }} />
        ))}
        <div className="h-8 w-full rounded-2xl" style={{ background: gradient }} role="img" aria-label={label} />
      </div>
    </div>
  );
}

function Brightness({
  matches,
}: {
  matches: NonNullable<UmbralProfile["luminance"]>["matches"];
}) {
  const ruler = matches.find((match) => match.kind === "control");
  const status =
    ruler && Math.abs(ruler.gain - 1) > 0.12
      ? "La regla no cayó junto a 1×. Esta pasada no sirve de cero."
      : `${matches.length === 1 ? "1 franja" : `${matches.length} franjas`}. El dato es el ancho, no cuántas muestras hizo falta.`;
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="font-serif text-2xl text-fg">Brillo</h2>
      <p className="leading-relaxed text-fg">{status}</p>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => {
          const place = match.kind === "cruce" ? "Franja" : match.kind === "extremo" ? "Dentro" : match.kind === "control" ? "Regla" : "Eje";
          const against = match.kind === "control" ? "gris" : match.referenceHue;
          const taken = match.trials === 1 ? "1 muestra" : `${match.trials} muestras`;
          const fan =
            match.span === "range"
              ? `${match.low.toFixed(2)}–${match.high.toFixed(2)}× · abanico ${match.width.toFixed(2)} · ${taken}`
              : `un corte · ${match.gain.toFixed(2)}× · ${taken}`;
          return (
            <li key={`${match.order}-${match.axisId}`} className="flex flex-col gap-0.5 text-sm">
              <span className="text-fg">
                {place} · {match.hue} frente a {against}
              </span>
              <span className="text-muted">{fan}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-serif text-2xl text-fg">{value}</dd>
    </div>
  );
}
