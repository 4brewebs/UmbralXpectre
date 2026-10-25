import { LUT_N, sampleLut, type FilterKind } from "@/lib/color/lut";

export type View = "original" | FilterKind;
export type Facing = "environment" | "user";

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

export function paint2d(canvas: HTMLCanvasElement, video: HTMLVideoElement, lut: Uint8Array | null, view: View) {
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

