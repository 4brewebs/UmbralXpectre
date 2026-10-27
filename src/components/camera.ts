import type { AssistBand } from "@/lib/color/assistband";
import { BAND_GLSL, bandShaderColor, bandUniforms } from "@/lib/color/bandshader";
import { fromSrgb8, toSrgb8 } from "@/lib/color/space";
import { LUT_N, sampleLut, type FilterKind } from "@/lib/color/lut";
import { EXTREME_TURN_DEG } from "@/lib/color/spectrum";

export type View = "original" | FilterKind;
export type Facing = "environment" | "user";

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * uMode: 0 original, 1 simulador (LUT 3D), 2 Asistencia y 3 Extremo, evaluados píxel a píxel con la Regla B
 * (bandshader.ts, la misma fórmula que láminas y transformadas).
 */
export const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler2D uVideo;
uniform sampler3D uLut;
uniform vec2 uLutFix;
uniform float uMode;
out vec4 fragColor;
${BAND_GLSL}
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 src = texture(uVideo, uv).rgb;
  vec3 outc = src;
  if (uMode > 1.5) outc = toSrgb(bandColor(toLinear(src), uMode));
  else if (uMode > 0.5) outc = texture(uLut, src * uLutFix.x + uLutFix.y).rgb;
  fragColor = vec4(outc, 1.0);
}`;

/** Modo del shader para una vista. */
export function shaderMode(view: View): number {
  return view === "original" ? 0 : view === "simulate" ? 1 : view === "assist" ? 2 : 3;
}

export function cameraError(error: unknown): string {
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
    console.warn("shader de cámara:", gl.getShaderInfoLog(shader));
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

export function createFilter(
  gl: WebGL2RenderingContext,
  simulatorLut: Uint8Array,
  bands: AssistBand[],
): { program: WebGLProgram; videoTex: WebGLTexture; lutTex: WebGLTexture; modeLoc: WebGLUniformLocation | null } | null {
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

  // Solo el simulador usa LUT 3D; Asistencia y Extremo van en el shader.
  const lutTex = gl.createTexture();
  if (!lutTex) return null;
  gl.activeTexture(gl.TEXTURE1);
  uploadLut(gl, lutTex, simulatorLut);

  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uVideo"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uLut"), 1);
  gl.uniform2f(gl.getUniformLocation(program, "uLutFix"), (LUT_N - 1) / LUT_N, 0.5 / LUT_N);
  const u = bandUniforms(bands, EXTREME_TURN_DEG);
  gl.uniform1i(gl.getUniformLocation(program, "uBandCount"), u.count);
  gl.uniform1fv(gl.getUniformLocation(program, "uGeo"), u.geo);
  gl.uniform1fv(gl.getUniformLocation(program, "uPx"), u.px);
  gl.uniform1fv(gl.getUniformLocation(program, "uPy"), u.py);
  gl.uniform3fv(gl.getUniformLocation(program, "uBasisU"), u.basisU);
  gl.uniform3fv(gl.getUniformLocation(program, "uBasisV"), u.basisV);
  gl.uniform3fv(gl.getUniformLocation(program, "uLumY"), u.lumY);
  gl.uniform2f(gl.getUniformLocation(program, "uGain"), u.gain.assist, u.gain.extreme);
  gl.uniform1f(gl.getUniformLocation(program, "uTurnCap"), u.turnCapRad);
  const modeLoc = gl.getUniformLocation(program, "uMode");
  return { program, videoTex, lutTex, modeLoc };
}

/** Sin WebGL2: Asistencia y Extremo con la misma fórmula del shader (memo por color); el simulador por LUT. */
export function cpuMapper(view: View, lut: Uint8Array | null, bands: AssistBand[]): ((r: number, g: number, b: number) => [number, number, number]) | null {
  if (view === "original") return null;
  if (view === "simulate") return lut ? (r, g, b) => sampleLut(lut, r, g, b) : null;
  const u = bandUniforms(bands, EXTREME_TURN_DEG);
  const mode = view === "assist" ? 2 : 3;
  const memo = new Map<number, [number, number, number]>();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let o = memo.get(key);
    if (!o) {
      o = toSrgb8(bandShaderColor(fromSrgb8([r, g, b]), u, mode));
      memo.set(key, o);
    }
    return o;
  };
}

export function paint2d(canvas: HTMLCanvasElement, video: HTMLVideoElement, map: ((r: number, g: number, b: number) => [number, number, number]) | null) {
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
  if (!map) return;
  const frame = ctx.getImageData(0, 0, w, h);
  const px = frame.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = map(px[i], px[i + 1], px[i + 2]);
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
  ctx.putImageData(frame, 0, 0);
}
