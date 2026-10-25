import { useEffect, useRef, useState } from "react";
import { Camera, SwitchCamera } from "lucide-react";
import { buildFilterLuts, LUT_N, sampleLut, type FilterKind } from "@/lib/color/lut";
import type { EdgeFile } from "@/lib/color/edges";
import { edgesReady, type FilterSource } from "@/lib/color/spectrum";
import type { UmbralProfile } from "@/lib/color/profile";

type View = "original" | FilterKind;
type Facing = "environment" | "user";

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler2D uVideo;
uniform sampler3D uLut;
uniform vec2 uLutFix;
uniform float uMode;
out vec4 fragColor;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 src = texture(uVideo, uv).rgb;
  vec3 graded = texture(uLut, src * uLutFix.x + uLutFix.y).rgb;
  float amount = uMode < 0.5 ? 0.0 : 1.0;
  fragColor = vec4(mix(src, graded, amount), 1.0);
}`;

function cameraError(error: unknown): string {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Hace falta una página segura (https) para pedir la cámara.";
  }
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "El navegador no ha dado permiso de cámara.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No encuentro una cámara.";
  }
  return "No se ha podido abrir la cámara.";
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function uploadLut(gl: WebGL2RenderingContext, tex: WebGLTexture, lut: Uint8Array) {
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_BASE_LEVEL, 0);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAX_LEVEL, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, LUT_N, LUT_N, LUT_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
}

function createFilter(
  gl: WebGL2RenderingContext,
  luts: Record<FilterKind, Uint8Array>,
): { program: WebGLProgram; videoTex: WebGLTexture; lutTex: Record<FilterKind, WebGLTexture>; lutLoc: WebGLUniformLocation | null } | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const videoTex = gl.createTexture();
  if (!videoTex) return null;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const kinds = ["assist", "simulate", "extreme"] as const;
  const lutTex = {} as Record<FilterKind, WebGLTexture>;
  gl.activeTexture(gl.TEXTURE1);
  for (const kind of kinds) {
    const tex = gl.createTexture();
    if (!tex) return null;
    uploadLut(gl, tex, luts[kind]);
    lutTex[kind] = tex;
  }

  gl.useProgram(program);
  const lutLoc = gl.getUniformLocation(program, "uLut");
  gl.uniform1i(gl.getUniformLocation(program, "uVideo"), 0);
  gl.uniform1i(lutLoc, 1);
  gl.uniform2f(gl.getUniformLocation(program, "uLutFix"), (LUT_N - 1) / LUT_N, 0.5 / LUT_N);
  return { program, videoTex, lutTex, lutLoc };
}

function paint2d(canvas: HTMLCanvasElement, video: HTMLVideoElement, lut: Uint8Array | null, view: View) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || video.videoWidth === 0) return;
  const scale = Math.min(1, 480 / video.videoWidth);
  const w = Math.max(2, Math.round(video.videoWidth * scale));
  const h = Math.max(2, Math.round(video.videoHeight * scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.drawImage(video, 0, 0, w, h);
  if (view === "original" || !lut) return;
  const frame = ctx.getImageData(0, 0, w, h);
  const px = frame.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = sampleLut(lut, px[i], px[i + 1], px[i + 2]);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

export function AssistCamera({ profile, edgeFiles = [] }: { profile: UmbralProfile; edgeFiles?: EdgeFile[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const profileLuts = useRef<Record<FilterKind, Uint8Array> | null>(null);
  const edgeLuts = useRef<Record<FilterKind, Uint8Array> | null>(null);
  const sourceRef = useRef<FilterSource>("profile");
  const [luts, setLuts] = useState<Record<FilterKind, Uint8Array> | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<View>("assist");
  const [source, setSource] = useState<FilterSource>("profile");
  const [facing, setFacing] = useState<Facing>("environment");
  const viewRef = useRef(view);
  const mounted = useRef(true);
  viewRef.current = view;
  sourceRef.current = source;
  const edgeKey = edgeFiles.map((file) => `${file.cone}:${file.createdAt}`).join("|");
  const ready = edgesReady(edgeFiles);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!live || !luts || !video || !canvas) return;
    let stopped = false;
    let frame = 0;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: false });
    const filter = gl ? createFilter(gl, luts) : null;
    const modeLoc = filter && gl ? gl.getUniformLocation(filter.program, "uMode") : null;

    const draw = () => {
      if (stopped) return;
      frame = window.requestAnimationFrame(draw);
      if (video.readyState < 2 || video.videoWidth === 0) return;
      const current = viewRef.current;
      if (!gl || !filter || !modeLoc) {
        paint2d(canvas, video, current === "original" ? null : luts[current], current);
        return;
      }
      const scale = Math.min(1, 1280 / video.videoWidth);
      const w = Math.max(2, Math.round(video.videoWidth * scale));
      const h = Math.max(2, Math.round(video.videoHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      const kind: FilterKind = current === "original" ? "assist" : current;
      gl.useProgram(filter.program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, filter.lutTex[kind]);
      gl.uniform1i(filter.lutLoc, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, filter.videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform1f(modeLoc, current === "original" ? 0 : 1);
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
  }, [live, luts]);

  useEffect(() => {
    profileLuts.current = null;
    edgeLuts.current = null;
    setLuts(null);
  }, [profile, edgeKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const video = videoRef.current;
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function baked(next: FilterSource): Record<FilterKind, Uint8Array> {
    if (next === "edges") {
      if (!edgeLuts.current) edgeLuts.current = buildFilterLuts(profile, "edges", edgeFiles);
      return edgeLuts.current;
    }
    if (!profileLuts.current) profileLuts.current = buildFilterLuts(profile);
    return profileLuts.current;
  }

  function chooseSource(next: FilterSource) {
    setSource(next);
    if (!live) return;
    setBusy(true);
    window.setTimeout(() => {
      if (!mounted.current) return;
      setLuts(baked(next));
      setBusy(false);
    }, 20);
  }

  async function open(next: Facing) {
    const video = videoRef.current;
    if (!video || busy) return;
    setMessage(null);
    setBusy(true);
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    if (!mounted.current) return;
    setLuts(baked(sourceRef.current));
    setBusy(false);
    const previous = video.srcObject;
    if (previous instanceof MediaStream) previous.getTracks().forEach((track) => track.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setFacing(next);
      setLive(true);
    } catch (error) {
      setLive(false);
      setBusy(false);
      setMessage(cameraError(error));
    }
  }

  function close() {
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    setLive(false);
  }

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div>
        <h2 className="font-serif text-2xl text-fg">Cámara</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          El permiso es el del navegador y el vídeo no sale de este aparato. Sin filtro es la cámara. Asistencia mueve
          solo el tramo conflictivo al color cercano que este perfil sí separa, sin subir la saturación. Simulador es
          el segundo arcoíris. Extremo es la asistencia de antes, con la saturación muy subida. El JSON se midió en una
          pantalla: en otra cámara sigue siendo ese perfil, no un diagnóstico nuevo.
        </p>
      </div>
      <video ref={videoRef} playsInline muted autoPlay className="hidden" />
      {live ? <canvas ref={canvasRef} className="aspect-video w-full rounded-2xl bg-stage object-cover" /> : null}
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
            onClick={() => chooseSource(id)}
            className={`h-10 rounded-xl px-3 text-sm ${source === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {source === "edges" && !ready ? (
        <p className="text-sm text-muted">Sin un borde cerrado, este filtro no cambia ningún color.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {live ? (
          <>
            {(
              [
                ["original", "Sin filtro"],
                ["assist", "Asistencia"],
                ["simulate", "Simulador"],
                ["extreme", "Extremo"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`h-10 rounded-xl px-3 text-sm ${view === id ? "bg-accent font-semibold text-accent-fg" : "border border-border text-fg"}`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void open(facing === "environment" ? "user" : "environment")}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm text-fg"
            >
              <SwitchCamera className="size-4" aria-hidden="true" />
              Cambiar
            </button>
            <button type="button" onClick={close} className="h-10 rounded-xl border border-border px-3 text-sm text-fg">
              Cerrar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void open(facing)}
            disabled={busy}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-accent-fg disabled:opacity-60"
          >
            <Camera className="size-4" aria-hidden="true" />
            {busy ? "Preparando el filtro…" : "Abrir cámara"}
          </button>
        )}
      </div>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </section>
  );
}
