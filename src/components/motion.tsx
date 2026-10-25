import { useEffect, useRef, useState } from "react";
import {
  answerMotion,
  createMotion,
  luminanceResult,
  paintMotion,
  pairOf,
  type LuminanceResult,
  type MotionState,
} from "@/lib/color/motion";
import type { UmbralProfile } from "@/lib/color/profile";

const WIDTH = 640;
const HEIGHT = 280;

export function MotionTest({
  profile,
  onDone,
  onSkip,
}: {
  profile: UmbralProfile;
  onDone: (result: LuminanceResult) => void;
  onSkip: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<MotionState>(() => createMotion(profile));
  const stateRef = useRef(state);
  const finished = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || state.complete) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      const current = stateRef.current;
      const pair = pairOf(current);
      if (!pair) return;
      paintMotion(ctx, canvas.width, canvas.height, pair.test, pair.ref, current.sign, (now - started) / 1000);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [state.complete]);

  useEffect(() => {
    if (!state.complete || finished.current) return;
    finished.current = true;
    onDone(luminanceResult(state));
  }, [onDone, state]);

  const target = state.targets[state.index];
  if (state.complete) return null;
  if (!target) {
    return <p className="text-sm text-muted">No hay un eje medido del que sacar el brillo.</p>;
  }

  function choose(side: "left" | "right" | "still") {
    setState((current) => answerMotion(current, side, Date.now()));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-muted">
          {state.index + 1} de {state.targets.length}
        </p>
        <p className="text-sm text-muted">
          {target.kind === "cruce" ? "Cruce" : target.kind === "extremo" ? "Extremo" : "Regla"}
        </p>
      </div>
      <p className="text-lg leading-snug text-fg">
        {target.kind === "control"
          ? `Regla, «${target.hue}» frente a gris. No es una franja débil.`
          : target.kind === "cruce"
            ? `Franja, «${target.hue}» frente a «${target.refHue}». Las dos caen donde el primer test no separa.`
            : `Dentro de «${target.hue}», el tramo que no separas.`}{" "}
        ¿Hacia dónde se mueven las franjas más oscuras? Si solo laten, Quieto.
      </p>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="h-44 w-full rounded-2xl bg-stage"
        aria-label="Campo de color en movimiento"
      />
      <p className="text-sm text-muted">
        {state.phase === "down"
          ? "Hacia oscuro, hasta que vuelva a moverse."
          : state.phase === "up"
            ? "Hacia claro, hasta el otro corte."
            : state.phase === "bisect"
              ? "Partiendo el salto donde cambió el sentido."
              : "Saltos grandes, hasta el primer quieto. Luego se miden los dos cortes."}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => choose("left")}
          className="h-16 rounded-2xl border border-border text-base font-semibold text-fg"
        >
          Izquierda
        </button>
        <button
          type="button"
          onClick={() => choose("still")}
          className="h-16 rounded-2xl bg-accent text-base font-semibold text-accent-fg"
        >
          Quieto
        </button>
        <button
          type="button"
          onClick={() => choose("right")}
          className="h-16 rounded-2xl border border-border text-base font-semibold text-fg"
        >
          Derecha
        </button>
      </div>
      <button type="button" onClick={onSkip} className="text-sm text-muted">
        Saltar el brillo. El perfil de color se queda.
      </button>
    </div>
  );
}
