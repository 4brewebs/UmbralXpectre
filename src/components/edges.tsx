import { useEffect, useState } from "react";
import { ANCHOR, cssRgb, toSrgb8 } from "@/lib/color/space";
import type { UmbralProfile } from "@/lib/color/profile";
import {
  applyAnswer,
  armConfirm,
  discEnds,
  edgeFile,
  sectorOf,
  startRun,
  type ConeId,
  type EdgeFile,
  type EdgeRun,
} from "@/lib/color/edges";

const GRAY = cssRgb(toSrgb8([ANCHOR, ANCHOR, ANCHOR]));

function discsOf(run: EdgeRun): Array<[number, number, number]> {
  const ends = discEnds(run.angle, run.scale);
  return [0, 1, 2, 3].map((index) => (index === run.oddIndex ? (run.oddSign > 0 ? ends.positive : ends.negative) : run.oddSign > 0 ? ends.negative : ends.positive));
}

function phaseLabel(run: EdgeRun): string {
  if (run.repeat) return "Este tono no ha quedado claro. Lo repito.";
  if (run.edgeConfirm === "inside") return "Repito el último que no separaste.";
  if (run.edgeConfirm === "outside") return "Repito el último que sí separaste.";
  if (run.phase === "peak") return "El tono que el primer test dejó alto. El contraste no cambia.";
  if (run.phase === "minus") return "Un lado del tramo. Sigue el mismo contraste.";
  if (run.phase === "plus") return "El otro lado del tramo.";
  if (run.phase === "depth") return "El tono se queda. Ahora cambia el contraste.";
  return "";
}

export function EdgeTest({
  profile,
  cone,
  onCancel,
  onDone,
}: {
  profile: UmbralProfile;
  cone: ConeId;
  onCancel: () => void;
  onDone: (file: EdgeFile) => void;
}) {
  const pathway = profile.fit.pathways.find((item) => item.id === cone);
  const axis = profile.axes.find((item) => item.id === cone);
  const [run, setRun] = useState(() =>
    startRun({
      cone,
      peakDeg: axis?.angleDeg ?? 0,
      floor: profile.fit.controlAbs && profile.fit.controlAbs > 0 ? profile.fit.controlAbs : 0.02,
      sourceThreshold: pathway?.threshold ?? axis?.threshold ?? 0,
      sourceTimes: pathway?.timesControl ?? null,
      profileSchema: profile.schema,
      profileCreatedAt: profile.createdAt,
    }),
  );
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [draft, setDraft] = useState<{ minus: number; plus: number } | null>(null);
  const [probe, setProbe] = useState<null | { side: "minus" | "plus"; left: number; hits: number }>(null);
  const [note, setNote] = useState<string | null>(null);

  const asking = run.phase === "peak" || run.phase === "minus" || run.phase === "plus" || run.phase === "depth" || probe != null;

  useEffect(() => {
    if (!asking) return;
    setPicked([]);
    setReady(false);
    const id = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(id);
  }, [asking, run.trials.length, run.angle, run.scale, run.oddIndex, run.phase]);

  useEffect(() => {
    if (run.phase !== "confirm" || draft) return;
    setDraft({
      minus: run.minus.edge ?? sectorOf(run.cone).lo,
      plus: run.plus.edge ?? sectorOf(run.cone).hi,
    });
  }, [run.phase, run.minus.edge, run.plus.edge, run.peak, draft]);

  function submit(none: boolean) {
    if (!ready) return;
    const next = applyAnswer(run, { picked: none ? [] : picked, none });
    if (probe) {
      const kind = next.trials[next.trials.length - 1]?.kind;
      const hits = probe.hits + (kind === "seen" ? 1 : 0);
      const left = probe.left - 1;
      setRun(next);
      if (left <= 0) {
        const accepted = hits >= 2;
        if (draft && accepted) {
          setDraft({ ...draft, [probe.side]: next.angle });
        }
        setNote(accepted ? "Este borde se queda donde lo has puesto." : "No lo has separado con claridad. El borde no se mueve.");
        setProbe(null);
      } else {
        setProbe({ ...probe, left, hits });
      }
      return;
    }
    setRun(next);
  }

  function save() {
    onDone(edgeFile(run, draft ? { minus: round1(draft.minus), plus: round1(draft.plus) } : undefined));
  }

  function beginProbe(side: "minus" | "plus") {
    if (!draft) return;
    setNote(null);
    setProbe({ side, left: 3, hits: 0 });
    setRun(armConfirm(run, side === "minus" ? draft.minus : draft.plus));
  }

  const name = run.name;
  const showDiscs = asking && run.phase !== "done";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted">Precisión · {name}</p>
        <h2 className="mt-1 font-serif text-3xl text-fg">Dónde empieza y acaba</h2>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Tres son iguales y uno no. Toca solo ese. Si ninguno destaca, no elijas: pulsa Ninguno destaca.
        </p>
      </div>

      {run.phase === "done" && run.band === "none" ? (
        <p className="text-lg leading-relaxed text-fg">
          A este contraste separas el tono de partida. No hay tramo que marcar.
        </p>
      ) : null}

      {showDiscs ? (
        <>
          <p className="min-h-12 text-lg leading-snug text-fg" aria-live="polite">
            {ready ? (probe ? `Probando este borde. Quedan ${probe.left}.` : phaseLabel(run)) : "Pausa en gris. No juzgues el cambio."}
          </p>
          <p className="text-sm text-muted">
            Pregunta {run.trials.length + 1} · tono {run.angle.toFixed(1)}°
          </p>
          <div className="mx-auto grid w-full max-w-xs grid-cols-2 gap-x-16 gap-y-10 py-4">
            {discsOf(run).map((rgb, index) => (
              <button
                key={`${run.trials.length}-${index}`}
                type="button"
                disabled={!ready}
                aria-pressed={picked.includes(index)}
                aria-label={`Disco ${index + 1}`}
                onClick={() => setPicked((current) => (current[0] === index ? [] : [index]))}
                className={`mx-auto size-[4.5rem] rounded-full border-2 ${picked.includes(index) ? "border-accent" : "border-transparent"} disabled:opacity-80`}
                style={{ background: ready ? cssRgb(rgb) : GRAY }}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!ready}
            onClick={() => submit(true)}
            className="h-14 rounded-2xl border border-border text-base font-medium text-fg disabled:opacity-40"
          >
            Ninguno destaca
          </button>
          <button
            type="button"
            disabled={!ready || picked.length !== 1}
            onClick={() => submit(false)}
            className="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg disabled:opacity-40"
          >
            Listo
          </button>
        </>
      ) : null}

      {run.phase === "confirm" && !probe && draft ? (
        <div className="flex flex-col gap-5">
          <p className="text-base leading-relaxed text-fg">
            {run.minus.toEnd && run.plus.toEnd
              ? "Por ninguno de los dos lados ha vuelto el color. El fallo sigue hasta los dos finales de este tono."
              : run.minus.toEnd || run.plus.toEnd
                ? "Un lado tiene un corte. En el otro el fallo sigue hasta el final de este tono."
                : run.minus.found && run.plus.found
                  ? "Los dos cortes han quedado acotados. Puedes moverlos y probarlos."
                  : "Un lado no ha encontrado el corte. Puedes probar el que sí, o guardar así."}
          </p>
          <p className="text-sm text-muted">
            Centro del contraste: {run.depthBound === "at-least" ? "≥ " : ""}
            {((run.depthLo + run.depthHi) / 2).toFixed(3)}
          </p>
          <EdgeSlider label="Un borde" min={sectorOf(run.cone).lo} max={sectorOf(run.cone).hi} value={draft.minus} onChange={(value) => setDraft({ ...draft, minus: value })} />
          <EdgeSlider label="El otro borde" min={sectorOf(run.cone).lo} max={sectorOf(run.cone).hi} value={draft.plus} onChange={(value) => setDraft({ ...draft, plus: value })} />
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => beginProbe("minus")} className="h-12 rounded-2xl border border-border text-sm text-fg">
              Probar un borde
            </button>
            <button type="button" onClick={() => beginProbe("plus")} className="h-12 rounded-2xl border border-border text-sm text-fg">
              Probar el otro
            </button>
          </div>
          <button type="button" onClick={save} className="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">
            Guardar JSON {name}
          </button>
        </div>
      ) : null}

      {run.phase === "done" ? (
        <button type="button" onClick={save} className="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-fg">
          Guardar JSON {name}
        </button>
      ) : null}

      <button type="button" onClick={onCancel} className="h-12 text-sm text-muted">
        Volver sin guardar
      </button>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function EdgeSlider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm text-fg">
      <span className="flex items-baseline justify-between">
        {label}
        <span className="text-muted">{value.toFixed(1)}°</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
