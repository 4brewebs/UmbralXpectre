import type { AssistBand } from "@/lib/color/assistband";
import { BAND_GLSL, CAMERA_PUSH_K, bandUniforms, cameraFrame, cameraPush } from "@/lib/color/bandshader";
import { fromSrgb8, toSrgb8, type Vec3 } from "@/lib/color/space";
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

const HEAD = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uVideo;
uniform float uMode;
${BAND_GLSL}
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
`;

/**
 * Pase 1 (Asistencia y Extremo), a un cuarto de resolución (mitad por lado): empujón de la Regla B decidido en cada
 * píxel nítido del bloque 2×2 (d = bandColor(c) − c, sin suavizar la imagen antes), tope |d| ≤ CAMERA_PUSH_K · C de ese
 * píxel y media de los cuatro. Textura RGBA16F
 * con filas en el orden del vídeo (la fila 0 del framebuffer es la fila 0 de la textura del vídeo).
 */
export const PUSH_FRAG = `${HEAD}
out vec4 fragColor;
void main() {
  ivec2 size = textureSize(uVideo, 0);
  ivec2 base = 2 * ivec2(gl_FragCoord.xy);
  vec3 sum = vec3(0.0);
  for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
    vec3 c = toLinear(texelFetch(uVideo, min(base + ivec2(dx, dy), size - 1), 0).rgb);
    vec3 d = bandColor(c, uMode) - c;
    float dn = length(d - dot(d, uLumY));
    float lim = uPushK * length(c - dot(c, uLumY));
    sum += dn > lim ? d * (lim / dn) : d;
  }
  fragColor = vec4(sum * 0.25, 1.0);
}`;

/**
 * Pase 2 a resolución completa. uMode: 0 original, 1 simulador (LUT 3D), 2 Asistencia y 3 Extremo: el campo de empujón
 * del pase 1 ampliado con filtrado bilineal (LINEAR) y sumado al píxel nítido con bandApply (bandshader.ts).
 */
export const FRAG = `${HEAD}
in vec2 vUv;
uniform sampler3D uLut;
uniform sampler2D uPush;
uniform vec2 uLutFix;
out vec4 fragColor;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 src = texture(uVideo, uv).rgb;
  vec3 outc = src;
  if (uMode > 1.5) outc = toSrgb(bandApply(toLinear(src), texture(uPush, uv).rgb, uMode));
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

function link(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("programa de cámara:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function setBandUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, bands: AssistBand[], pushK: number) {
  gl.useProgram(program);
  const u = bandUniforms(bands, EXTREME_TURN_DEG);
  gl.uniform1i(gl.getUniformLocation(program, "uVideo"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uBandCount"), u.count);
  gl.uniform1fv(gl.getUniformLocation(program, "uGeo"), u.geo);
  gl.uniform1fv(gl.getUniformLocation(program, "uPx"), u.px);
  gl.uniform1fv(gl.getUniformLocation(program, "uPy"), u.py);
  gl.uniform3fv(gl.getUniformLocation(program, "uBasisU"), u.basisU);
  gl.uniform3fv(gl.getUniformLocation(program, "uBasisV"), u.basisV);
  gl.uniform3fv(gl.getUniformLocation(program, "uLumY"), u.lumY);
  gl.uniform2f(gl.getUniformLocation(program, "uGain"), u.gain.assist, u.gain.extreme);
  gl.uniform1f(gl.getUniformLocation(program, "uTurnCap"), u.turnCapRad);
  gl.uniform1f(gl.getUniformLocation(program, "uPushK"), pushK);
}

export type CameraFilter = {
  /** Sube el fotograma (vídeo, imagen o canvas) y lo dibuja en el canvas con la vista pedida, a w×h. */
  draw: (source: TexImageSource, view: View, w: number, h: number) => void;
  dispose: () => void;
};

/** Filtro WebGL2 de la cámara; null si falta WebGL2, falla el shader o no se puede renderizar a RGBA16F. */
/** Opciones de diagnóstico (mediciones): campo en RGBA32F y otro tope de cámara. Por defecto RGBA16F y CAMERA_PUSH_K. */
export type FilterOptions = { pushFloat32?: boolean; pushK?: number };

export function createFilter(gl: WebGL2RenderingContext, simulatorLut: Uint8Array, bands: AssistBand[], opts: FilterOptions = {}): CameraFilter | null {
  const pushFloat32 = opts.pushFloat32 ?? false;
  // Campo de empujón con signo: hace falta renderizar a coma flotante (RGBA16F).
  const f32 = !!gl.getExtension("EXT_color_buffer_float");
  if (!f32 && !gl.getExtension("EXT_color_buffer_half_float")) return null;
  // RGBA32F solo si se pide y se puede filtrar con LINEAR (OES_texture_float_linear); si no, RGBA16F.
  const use32 = pushFloat32 && f32 && !!gl.getExtension("OES_texture_float_linear");
  const program = link(gl, FRAG);
  const pushProgram = link(gl, PUSH_FRAG);
  if (!program || !pushProgram) return null;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex2d = (filter: number) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  gl.activeTexture(gl.TEXTURE0);
  const videoTex = tex2d(gl.LINEAR);
  // Solo el simulador usa LUT 3D; Asistencia y Extremo van en el shader.
  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  uploadLut(gl, lutTex, simulatorLut);
  gl.activeTexture(gl.TEXTURE2);
  const pushTex = tex2d(gl.LINEAR);
  const fbo = gl.createFramebuffer();
  let pushSize = "";

  setBandUniforms(gl, pushProgram, bands, opts.pushK ?? CAMERA_PUSH_K);
  const pushModeLoc = gl.getUniformLocation(pushProgram, "uMode");
  setBandUniforms(gl, program, bands, opts.pushK ?? CAMERA_PUSH_K);
  gl.uniform1i(gl.getUniformLocation(program, "uLut"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "uPush"), 2);
  gl.uniform2f(gl.getUniformLocation(program, "uLutFix"), (LUT_N - 1) / LUT_N, 0.5 / LUT_N);
  const modeLoc = gl.getUniformLocation(program, "uMode");

  const draw = (source: TexImageSource, view: View, w: number, h: number) => {
    const mode = shaderMode(view);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, pushTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    if (mode >= 2) {
      const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
      gl.activeTexture(gl.TEXTURE2);
      if (pushSize !== `${hw}x${hh}`) {
        pushSize = `${hw}x${hh}`;
        gl.texImage2D(gl.TEXTURE_2D, 0, use32 ? gl.RGBA32F : gl.RGBA16F, hw, hh, 0, gl.RGBA, use32 ? gl.FLOAT : gl.HALF_FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pushTex, 0);
      }
      // El pase 1 no puede leer la textura en la que escribe: se desliga de la unidad 2 mientras dibuja.
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, hw, hh);
      gl.useProgram(pushProgram);
      gl.uniform1f(pushModeLoc, mode);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, pushTex);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    gl.uniform1f(modeLoc, mode);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const dispose = () => {
    gl.deleteTexture(videoTex);
    gl.deleteTexture(lutTex);
    gl.deleteTexture(pushTex);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteProgram(pushProgram);
  };
  return { draw, dispose };
}

/**
 * Sin WebGL2 (o sin render a coma flotante): lo mismo en CPU. Simulador por LUT; Asistencia y Extremo con
 * `cameraFrame` (empujón por píxel, media 2×2, ampliación bilineal y bandApply), memo del empujón por color 8 bits.
 */
export function cpuFrame(view: View, lut: Uint8Array | null, bands: AssistBand[]): ((px: Uint8ClampedArray, w: number, h: number) => void) | null {
  if (view === "original") return null;
  if (view === "simulate") {
    if (!lut) return null;
    return (px) => {
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = sampleLut(lut, px[i], px[i + 1], px[i + 2]);
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    };
  }
  const u = bandUniforms(bands, EXTREME_TURN_DEG);
  const mode = view === "assist" ? 2 : 3;
  const memo = new Map<number, Vec3>();
  const push = (c: Vec3): Vec3 => {
    const s8 = toSrgb8(c);
    const key = (s8[0] << 16) | (s8[1] << 8) | s8[2];
    let d = memo.get(key);
    if (!d) {
      d = cameraPush(c, u, mode);
      memo.set(key, d);
    }
    return d;
  };
  return (px, w, h) => {
    const lin = new Float32Array(w * h * 3);
    for (let p = 0, i = 0; i < px.length; i += 4, p += 3) {
      const c = fromSrgb8([px[i], px[i + 1], px[i + 2]]);
      lin[p] = c[0]; lin[p + 1] = c[1]; lin[p + 2] = c[2];
    }
    const out = cameraFrame(lin, w, h, u, mode, push);
    for (let p = 0, i = 0; i < px.length; i += 4, p += 3) {
      const o = toSrgb8([out[p], out[p + 1], out[p + 2]]);
      px[i] = o[0]; px[i + 1] = o[1]; px[i + 2] = o[2];
    }
  };
}

export function paint2d(canvas: HTMLCanvasElement, video: HTMLVideoElement, apply: ((px: Uint8ClampedArray, w: number, h: number) => void) | null) {
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
  if (!apply) return;
  const frame = ctx.getImageData(0, 0, w, h);
  apply(frame.data, w, h);
  ctx.putImageData(frame, 0, 0);
}
