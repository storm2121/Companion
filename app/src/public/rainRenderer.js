// The rain on the home's window (HeroWindow.jsx), drawn by hand on WebGL2: one full-screen
// triangle, three small programs, no engine. This file is the drawing alone — no DOM — so it runs
// in a worker on an OffscreenCanvas (rainWorker.js) or, where that is not possible, on the page
// (rainGlass.js hosts it either way).
//
//   glass  the pane itself, drawn OVER the real picture, premultiplied: drops that refract the room
//          (each a small lens: the room inverted inside it, a darker rim, a fleck of light),
//          drops running down on paths of their own and the wet trails they leave, and the
//          condensation — a blurred, veiled copy of the room — wherever the glass is not wiped.
//          Where the glass is clear the canvas is transparent, so the capture stays the browser's
//          own crisp image underneath.
//   blur   once per picture: the capture at a quarter of its size, blurred in two passes —
//          what the room looks like through fog.
//   wipe   while there is something to do: the wipe mask (at most 256 × 256). The pointer's strokes
//          are painted in; the fog gathers back over about twenty seconds, creeping in from the
//          edges of a wiped patch, faster in some places than others. 16-bit precision packed in
//          RGBA8 (r + g / 255), so a slow fade survives eight-bit textures; b holds where fog
//          gathers fastest (drawn once in JS: gatherMap).
//
// Rain by day is steady; Candlelight is a lighter drizzle (uMix follows the window's crossfade).
// With reduced motion it draws still drops (the wipe still answers the pointer); with reduced
// transparency there is no condensation.
//
// Direct3D (ANGLE on Windows) is slow to compile loops and long inlined code (contextweb.md §5):
// nothing here loops, every drop layer only nominates a candidate and one lens is shaded per
// pixel, and programs link in the background (KHR_parallel_shader_compile).

export const DPR_CAP = 1.5;
const MASK_MAX = 256;
const FOG_RETURN_S = 18;
// How much of the condensation lies over the room once it has formed (0 – 1).
const FOG_AT_REST = 0.34;
const FORM_S = 3.6;
const MAX_STROKES = 8;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Arithmetic hashes (no sin), stable across GPUs.
const HASH = `
vec4 hash42(vec2 p) {
  vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}`;

const GLASS = `#version 300 es
precision highp float;
uniform sampler2D uRoomA;
uniform sampler2D uRoomB;
uniform sampler2D uFogA;
uniform sampler2D uFogB;
uniform sampler2D uWipe;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform float uMix;
uniform float uFog;
uniform float uForm;
uniform vec3 uGround;
out vec4 outColor;
${HASH}

vec3 room(vec2 uv) {
  if (uMix >= 0.999) return texture(uRoomB, uv).rgb;
  vec4 a = texture(uRoomA, uv);
  vec3 day = mix(uGround, a.rgb, a.a);
  if (uMix <= 0.001) return day;
  return mix(day, texture(uRoomB, uv).rgb, uMix);
}

vec3 fogged(vec2 uv) {
  if (uMix >= 0.999) return texture(uFogB, uv).rgb;
  vec3 day = texture(uFogA, uv).rgb;
  if (uMix <= 0.001) return day;
  return mix(day, texture(uFogB, uv).rgb, uMix);
}

// Every layer only nominates the drop it has here; the one that covers most is shaded once, at
// the end. Straight-line code (selects, no early returns) keeps Direct3D's compiler quick.
vec2 dropQ;
float dropR;
float dropBend;
float dropCover;

// A lens of radius r, at q = offset / r: how much of this pixel it covers.
void consider(vec2 q, float r, float bend, float strength) {
  float edge = clamp(2.2 / (r * uScale), 0.02, 0.5);
  float cover = (1.0 - smoothstep(1.0 - edge, 1.0, length(q))) * strength;
  bool take = cover > dropCover;
  dropQ = take ? q : dropQ;
  dropR = take ? r : dropR;
  dropBend = take ? bend : dropBend;
  dropCover = take ? cover : dropCover;
}

// Beads: drops and spray, each forming, holding and drying in its own time; wiping clears them.
void beads(vec2 g, float cell, float density, float rMin, float rMax, float clear) {
  vec2 id = floor(g / cell);
  vec2 f = g - id * cell;
  vec4 h = hash42(id + 17.0);
  float alive = clamp((density - h.w) * 18.0 + 0.5, 0.0, 1.0);
  float life = fract(uTime / mix(14.0, 34.0, h.z) + h.x * 3.17);
  float grow = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.8, 1.0, life));
  float r = mix(rMin, rMax, h.y * h.y * h.y) * (0.6 + 0.4 * grow);
  float m = r + 0.8;
  vec2 c = vec2(m) + vec2(h.x, h.z) * max(vec2(0.0), vec2(cell - 2.0 * m));
  consider((f - c) / r, r, 1.5, alive * grow * (1.0 - clear));
}

// The path a running drop takes down its column: fixed on the glass, wandering a little.
float path(float y, float x0, vec4 h) {
  return x0 + 2.8 * sin(y * (0.04 + 0.02 * h.x) + h.z * 6.283);
}

// Runners: a drop gathers, sticks, slips down its path faster as it goes, and leaves a wet trail
// with a few beads in it that dries from the top once the drop has gone.
void runners(vec2 g, vec2 cell, float density, float speed, float rMin, float rMax, inout float trail) {
  vec2 id = floor(g / cell);
  vec2 f = g - id * cell;
  vec4 h = hash42(id * vec2(1.0, 7.0) + 3.0);
  float alive = clamp((density - h.w) * 18.0 + 0.5, 0.0, 1.0);
  float rr = mix(rMin, rMax, h.x);
  float margin = rr + 4.5;
  float x0 = margin + h.y * (cell.x - 2.0 * margin);
  float p = fract(uTime * speed / mix(7.0, 13.0, h.z) + h.y * 5.31);
  float u = clamp(p / 0.62, 0.0, 1.0);
  float yh = mix(5.0, cell.y - margin, u * u * (1.6 - 0.6 * u));
  float size = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.62, 0.65, p));
  float dry = 1.0 - smoothstep(0.62, 1.0, p);
  vec2 qHead = (f - vec2(path(yh, x0, h), yh)) / vec2(rr, rr * 1.2);
  float above = step(f.y, yh - rr * 0.6) * step(5.0, f.y);
  float fresh = exp(-(yh - f.y) / 160.0);
  float w = rr * 0.7;
  float px = path(f.y, x0, h);
  trail = max(trail, above * (1.0 - smoothstep(w * 0.5, w, abs(f.x - px))) * alive * dry * mix(0.45, 1.0, fresh));
  float n = floor(f.y / 11.0);
  vec4 hb = hash42(vec2(id.x * 13.0 + n, id.y * 5.0 + 1.0));
  float sy = (n + 0.5) * 11.0 + (hb.z - 0.5) * 3.0;
  float br = mix(0.8, 2.0, hb.x) * mix(0.55, 1.0, fresh);
  float bead = alive * dry * above * step(hb.w, 0.68) * step(sy, yh - rr * 1.4);
  // The head or the bead nearest it: one lens per runner (they never overlap).
  bool head = dot(qHead, qHead) < 1.0 && alive * size > 0.001;
  vec2 qBead = (f - vec2(px + (hb.y - 0.5) * w, sy)) / br;
  consider(head ? qHead : qBead, head ? rr : br, head ? 1.9 : 1.5, head ? alive * size : bead);
}

// Streaks: the small, quick drops of a steady rain — a head and its trail, no beads left behind.
void streaks(vec2 g, vec2 cell, float density, float speed, float rMin, float rMax, inout float trail) {
  vec2 id = floor(g / cell);
  vec2 f = g - id * cell;
  vec4 h = hash42(id * vec2(1.0, 7.0) + 5.0);
  float alive = clamp((density - h.w) * 18.0 + 0.5, 0.0, 1.0);
  float rr = mix(rMin, rMax, h.x);
  float margin = rr + 4.5;
  float x0 = margin + h.y * (cell.x - 2.0 * margin);
  float p = fract(uTime * speed / mix(5.0, 9.0, h.z) + h.y * 5.31);
  float u = clamp(p / 0.62, 0.0, 1.0);
  float yh = mix(5.0, cell.y - margin, u * u * (1.6 - 0.6 * u));
  float size = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.62, 0.65, p));
  float px = path(f.y, x0, h);
  consider((f - vec2(px, yh)) / vec2(rr, rr * 1.2), rr, 1.9, alive * size);
  float above = step(f.y, yh - rr * 0.6) * step(5.0, f.y);
  float fade = exp(-(yh - f.y) / 120.0) * (1.0 - smoothstep(0.62, 1.0, p));
  trail = max(trail, above * (1.0 - smoothstep(rr * 0.35, rr * 0.7, abs(f.x - px))) * alive * fade);
}

// Condensation is made of droplets too fine to see one by one: a faint glitter in the fog.
float mist(vec2 g) {
  vec2 id = floor(g / 4.0);
  float h = hash12(id + 91.0);
  vec2 c = (id + 0.3 + vec2(h, fract(h * 7.13)) * 0.4) * 4.0;
  float k = length(g - c) / (0.5 + 0.9 * fract(h * 3.71));
  return (1.0 - smoothstep(0.4, 1.0, k)) * step(fract(h * 13.7), 0.55);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = frag / uRes;
  vec2 css = uRes / uScale;
  vec2 g = frag / uScale;

  vec4 wm = texture(uWipe, uv);
  float wiped = clamp(wm.r + wm.g / 255.0, 0.0, 1.0);
  float day = 1.0 - uMix;

  dropQ = vec2(0.0);
  dropR = 1.0;
  dropBend = 0.0;
  dropCover = 0.0;
  float trail = 0.0;
  beads(g, mix(36.0, 44.0, uMix), mix(0.6, 0.32, uMix), 2.0, 6.4, wiped);
  // The spray; thicker where a wipe pushed the water aside, along the wiped patch's edge.
  float edge = smoothstep(0.05, 0.35, wiped) * (1.0 - smoothstep(0.5, 0.9, wiped));
  beads(g + 7.0, 12.0, mix(0.4, 0.2, uMix) + 0.55 * edge, 0.8, 2.2, wiped * (1.0 - edge));
  runners(g, vec2(62.0, 300.0), mix(0.52, 0.26, uMix), mix(1.0, 0.75, uMix), 3.4, 6.6, trail);
  if (day > 0.01) streaks(g + vec2(21.0, 87.0), vec2(37.0, 170.0), 0.38 * day, 1.25, 2.2, 3.6, trail);

  // The condensation: a little denser toward the frame, patchy where it gathers fastest, cleared
  // where it was wiped and along the trails. As the glass fogs up (uForm 0 -> 1, a few seconds),
  // the edges and the spots where condensation gathers fastest go first.
  float edgeward = smoothstep(0.3, 0.8, length((uv - vec2(0.5, 0.42)) * vec2(1.05, 1.5)));
  float first = 0.62 * (1.0 - wm.b) + 0.38 * (1.0 - edgeward);
  float formed = smoothstep(first - 0.22, first + 0.22, uForm * 1.44 - 0.22);
  // At rest it is a soft veil (about a third over the room): the note stays legible at a glance,
  // and a wiped path shows crisper, a little darker and fuller. By night the veil is mostly a warm
  // haze rather than the blurred room, so light type never blooms through it.
  float fog = uFog * mix(1.0, 0.85, uMix) * formed * (0.82 + 0.18 * edgeward) * (0.9 + 0.1 * wm.b) * (1.0 - wiped) * (1.0 - 0.8 * trail);
  vec3 veil = mix(vec3(0.985, 0.99, 0.995), vec3(0.35, 0.27, 0.2), uMix);
  vec3 fogColor = mix(fogged(uv), veil, mix(0.5, 0.62, uMix));
  // The glitter only ever brightens: fogged glass is lighter and cooler than what is behind it.
  fogColor += mist(g) * mix(0.14, 0.08, uMix) * mix(vec3(1.0), vec3(1.0, 0.8, 0.6), uMix);

  vec3 col = vec3(0.0);
  float a = 0.0;
  if (dropCover > 0.0) {
    // The drop, shaded once: the room bent and inverted inside it, lit from above — its lower
    // edge darker (about a pixel and a half whatever its size, so small drops are not rings) and
    // a fleck of light near the top.
    float k = length(dropQ);
    vec2 off = -dropQ * dropR * dropBend * (1.0 + 0.6 * k * k);
    float rimWidth = clamp(1.6 / (dropR * uScale), 0.12, 0.55);
    float rim = smoothstep(1.0 - rimWidth, 1.0, k) * (0.45 + 0.55 * clamp(dropQ.y + 0.35, 0.0, 1.0));
    float spec = 1.0 - smoothstep(0.0, 0.3, length(dropQ - vec2(-0.3, -0.42)));
    vec3 seen = room(clamp((g + off) / css, vec2(0.001), vec2(0.999)));
    seen *= 1.0 - rim * mix(0.42, 0.2, uMix);
    seen += rim * vec3(0.14, 0.09, 0.04) * uMix * (1.0 - clamp(off.y, 0.0, 1.0));
    seen += spec * mix(vec3(0.55), vec3(0.6, 0.45, 0.28), uMix);
    col = seen * dropCover;
    a = dropCover;
  }
  col += fogColor * fog * (1.0 - a);
  a += fog * (1.0 - a);
  outColor = vec4(col, a);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize;
uniform vec2 uDir;
uniform float uFlatten;
uniform vec3 uGround;
out vec4 outColor;
vec3 tap(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  return uFlatten > 0.5 ? mix(uGround, c.rgb, c.a) : c.rgb;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = tap(uv) * 0.2270270;
  c += (tap(uv + uDir * 1.3846154) + tap(uv - uDir * 1.3846154)) * 0.3162162;
  c += (tap(uv + uDir * 3.2307692) + tap(uv - uDir * 3.2307692)) * 0.0702703;
  outColor = vec4(c, 1.0);
}`;

const WIPE = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec2 uCss;
uniform float uDecay;
uniform float uErode;
uniform float uBrush;
uniform int uCount;
uniform vec4 uStroke[${MAX_STROKES}];
out vec4 outColor;
float unpack(vec4 c) { return c.r + c.g / 255.0; }
float stroke(vec2 p, vec4 s) {
  vec2 a = s.xy * uCss;
  vec2 ba = s.zw * uCss - a;
  vec2 pa = p - a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * t);
}
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 p = uv * uCss;
  vec4 prev = texture(uPrev, uv);
  float v = unpack(prev);
  float around = min(
    min(unpack(texture(uPrev, uv + vec2(uTexel.x, 0.0))), unpack(texture(uPrev, uv - vec2(uTexel.x, 0.0)))),
    min(unpack(texture(uPrev, uv + vec2(0.0, uTexel.y))), unpack(texture(uPrev, uv - vec2(0.0, uTexel.y))))
  );
  v = mix(v, min(v, around), uErode);
  v -= uDecay * (0.55 + 0.9 * prev.b);
  float s = 100000.0;
  if (uCount > 0) s = min(s, stroke(p, uStroke[0]));
  if (uCount > 1) s = min(s, stroke(p, uStroke[1]));
  if (uCount > 2) s = min(s, stroke(p, uStroke[2]));
  if (uCount > 3) s = min(s, stroke(p, uStroke[3]));
  if (uCount > 4) s = min(s, stroke(p, uStroke[4]));
  if (uCount > 5) s = min(s, stroke(p, uStroke[5]));
  if (uCount > 6) s = min(s, stroke(p, uStroke[6]));
  if (uCount > 7) s = min(s, stroke(p, uStroke[7]));
  v = clamp(max(v, 1.0 - smoothstep(uBrush * 0.62, uBrush, s)), 0.0, 1.0);
  outColor = vec4(floor(v * 255.0) / 255.0, fract(v * 255.0), prev.b, 1.0);
}`;

// Where condensation gathers fastest (the mask's blue channel): smooth value noise over the
// glass, about 90 css px across, drawn once in JS so no shader has to carry it.
const gatherMap = (w, h, cssW, cssH) => {
  const cells = new Map();
  const at = (x, y) => {
    const key = x * 7919 + y;
    if (!cells.has(key)) {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      cells.set(key, s - Math.floor(s));
    }
    return cells.get(key);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = ((x + 0.5) / w) * (cssW / 90);
      const py = ((y + 0.5) / h) * (cssH / 90);
      const value = 0.62 * noise(px, py) + 0.38 * noise(px * 2.7 + 11, py * 2.7 + 11);
      data[(y * w + x) * 4 + 2] = Math.round(value * 255);
      data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return data;
};

const hexToRgb = (hex) => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const CONTEXT = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

// The glass, drawn into `gl` — the context of a canvas on the page, or of an OffscreenCanvas in a
// worker (rainWorker.js): nothing here touches the DOM. Its host tells it the size, hands it the
// pictures, and runs its frames (createLoop below).
export const createRenderer = ({ gl, reduce = false, foggy = true, ground = '#d6dde0', debug = false }) => {
  const stats = { compileMs: null, frames: 0, cpuMs: [], gpuMs: [], width: 0, height: 0 };
  const groundRgb = hexToRgb(ground);
  let destroyed = false;
  let last = 0;
  let time = 31.7;
  let mix = 0;
  let moved = true;
  let fogLevel = 0;
  let fogTarget = foggy ? FOG_AT_REST : 0;
  // How far the glass has fogged up since it appeared (0 -> 1 over FORM_S), or 1 at once when still.
  let form = reduce ? 1 : 0;
  let still = reduce;
  let lastStroke = -Infinity;
  let strokes = [];
  let size = { w: 0, h: 0, cssW: 0, cssH: 0, scale: 1 };
  let mask = null;

  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  const timer = debug ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const queries = [];

  // ── Programs ──────────────────────────────────────────────────────────────────────────────
  const compileStart = performance.now();
  const shader = (type, source) => {
    const object = gl.createShader(type);
    gl.shaderSource(object, source);
    gl.compileShader(object);
    return object;
  };
  const vert = shader(gl.VERTEX_SHADER, VERT);
  const programs = {};
  const fragments = {};
  // The glass first and alone; the blur and the wipe once it can draw, so they never compete
  // with it for the driver's compiler.
  const link = (name, source) => {
    const program = gl.createProgram();
    fragments[name] = shader(gl.FRAGMENT_SHADER, source);
    gl.attachShader(program, vert);
    gl.attachShader(program, fragments[name]);
    gl.linkProgram(program);
    programs[name] = { program, uniforms: {} };
  };
  link('glass', GLASS);
  const uniform = (name, key) => {
    const entry = programs[name];
    if (!(key in entry.uniforms)) entry.uniforms[key] = gl.getUniformLocation(entry.program, key);
    return entry.uniforms[key];
  };

  // ── Textures and targets ──────────────────────────────────────────────────────────────────
  // Textures are made on a unit of their own, so making one never disturbs what is bound for
  // drawing (a texture bound where a pass reads while it is also the pass's target is a feedback
  // loop, and the draw is refused).
  const SCRATCH_UNIT = 7;
  const texture = (w, h, { mip = false, data = null } = {}) => {
    const object = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, object);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return object;
  };
  const target = (w, h, data = null) => {
    const tex = texture(w, h, { data });
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  };
  const dropTarget = (item) => {
    if (!item) return;
    gl.deleteTexture(item.tex);
    gl.deleteFramebuffer(item.fbo);
  };
  const g8 = groundRgb.map((c) => Math.round(c * 255));
  const placeholder = texture(1, 1, { data: new Uint8Array([g8[0], g8[1], g8[2], 255]) });
  const rooms = { rain: null, candlelight: null };
  const fogs = { rain: null, candlelight: null };
  // Pictures waiting for the blur program, and their sizes.
  const unblurred = new Map();

  const draw = (fbo, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // The room through fog: a quarter-size copy of the capture, blurred across then down.
  const blurOf = (mood, room, w, h) => {
    const qw = Math.max(8, Math.round(w / 4));
    const qh = Math.max(8, Math.round(h / 4));
    const across = target(qw, qh);
    const down = target(qw, qh);
    gl.useProgram(programs.blur.program);
    gl.uniform1i(uniform('blur', 'uSrc'), 0);
    gl.uniform2f(uniform('blur', 'uSize'), qw, qh);
    gl.uniform3fv(uniform('blur', 'uGround'), groundRgb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, room);
    gl.uniform2f(uniform('blur', 'uDir'), 1 / qw, 0);
    gl.uniform1f(uniform('blur', 'uFlatten'), 1);
    draw(across.fbo, qw, qh);
    gl.bindTexture(gl.TEXTURE_2D, across.tex);
    gl.uniform2f(uniform('blur', 'uDir'), 0, 1 / qh);
    gl.uniform1f(uniform('blur', 'uFlatten'), 0);
    draw(down.fbo, qw, qh);
    dropTarget(across);
    dropTarget(fogs[mood]);
    fogs[mood] = down;
  };

  // ── The wipe mask ─────────────────────────────────────────────────────────────────────────
  const makeMask = () => {
    const ratio = size.cssW / Math.max(1, size.cssH);
    const mw = ratio >= 1 ? MASK_MAX : Math.max(16, Math.round(MASK_MAX * ratio));
    const mh = ratio >= 1 ? Math.max(16, Math.round(MASK_MAX / ratio)) : MASK_MAX;
    if (mask && mask.w === mw && mask.h === mh) return;
    if (mask) mask.targets.forEach(dropTarget);
    const start = gatherMap(mw, mh, size.cssW, size.cssH);
    mask = { w: mw, h: mh, targets: [target(mw, mh, start), target(mw, mh, start)], read: 0 };
    lastStroke = -Infinity;
  };

  let glassReady = false;
  let blurReady = false;
  let wipeReady = false;
  const recent = () => performance.now() - lastStroke < (FOG_RETURN_S * 2 + 4) * 1000;

  const stepMask = (dt) => {
    if (!wipeReady || !mask) return;
    const from = mask.targets[mask.read];
    const into = mask.targets[1 - mask.read];
    gl.useProgram(programs.wipe.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(uniform('wipe', 'uPrev'), 0);
    gl.uniform2f(uniform('wipe', 'uTexel'), 1 / mask.w, 1 / mask.h);
    gl.uniform2f(uniform('wipe', 'uCss'), size.cssW, size.cssH);
    gl.uniform1f(uniform('wipe', 'uDecay'), dt / FOG_RETURN_S);
    gl.uniform1f(uniform('wipe', 'uErode'), Math.min(1, dt * 0.9));
    gl.uniform1f(uniform('wipe', 'uBrush'), Math.max(24, Math.min(40, size.cssW * 0.034)));
    const segments = strokes.slice(0, MAX_STROKES);
    strokes = strokes.slice(MAX_STROKES);
    const packed = new Float32Array(MAX_STROKES * 4);
    segments.forEach((segment, index) => packed.set(segment, index * 4));
    gl.uniform4fv(uniform('wipe', 'uStroke'), packed);
    gl.uniform1i(uniform('wipe', 'uCount'), segments.length);
    draw(into.fbo, mask.w, mask.h);
    mask.read = 1 - mask.read;
  };

  const drawGlass = () => {
    gl.useProgram(programs.glass.program);
    const bind = (unit, key, tex) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex ?? placeholder);
      gl.uniform1i(uniform('glass', key), unit);
    };
    bind(0, 'uRoomA', rooms.rain);
    bind(1, 'uRoomB', rooms.candlelight);
    bind(2, 'uFogA', fogs.rain?.tex);
    bind(3, 'uFogB', fogs.candlelight?.tex);
    bind(4, 'uWipe', mask.targets[mask.read].tex);
    gl.uniform2f(uniform('glass', 'uRes'), size.w, size.h);
    gl.uniform1f(uniform('glass', 'uScale'), size.scale);
    gl.uniform1f(uniform('glass', 'uTime'), time);
    gl.uniform1f(uniform('glass', 'uMix'), mix);
    gl.uniform1f(uniform('glass', 'uFog'), fogLevel);
    gl.uniform1f(uniform('glass', 'uForm'), form);
    gl.uniform3fv(uniform('glass', 'uGround'), groundRgb);
    draw(null, size.w, size.h);
  };

  const readQueries = () => {
    while (queries.length) {
      const query = queries[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      queries.shift();
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && stats.gpuMs.length < 600) stats.gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
  };

  const linked = (name) => Boolean(programs[name]) && (!parallel || gl.getProgramParameter(programs[name].program, parallel.COMPLETION_STATUS_KHR));
  const logs = () => {
    if (!debug) return;
    for (const [name, fragment] of Object.entries(fragments)) {
      const log = gl.getShaderInfoLog(fragment);
      if (log) console.warn(`rain: ${name} shader`, log);
    }
  };

  return {
    stats,
    // The programs, linked in the background. 'pending' until the glass and the blur can draw,
    // then 'ready' — or 'failed'. The wipe joins by itself when it is linked (a stroke made
    // before is kept); drivers often link one program at a time.
    poll() {
      if (destroyed) return 'failed';
      if (!glassReady) {
        if (!linked('glass')) return 'pending';
        if (!gl.getProgramParameter(programs.glass.program, gl.LINK_STATUS)) {
          logs();
          return 'failed';
        }
        stats.compileMs = performance.now() - compileStart;
        gl.disable(gl.BLEND);
        glassReady = true;
        link('blur', BLUR);
        link('wipe', WIPE);
        return 'ready';
      }
      if (!blurReady && linked('blur')) {
        blurReady = true;
        if (gl.getProgramParameter(programs.blur.program, gl.LINK_STATUS)) {
          unblurred.forEach(({ w, h }, mood) => blurOf(mood, rooms[mood], w, h));
          moved = true;
        } else {
          // No fog without the room seen through it.
          logs();
          fogTarget = 0;
        }
        unblurred.clear();
      }
      if (!wipeReady && linked('wipe')) {
        wipeReady = true;
        if (!gl.getProgramParameter(programs.wipe.program, gl.LINK_STATUS)) {
          logs();
          fogTarget = 0;
        }
      }
      return 'ready';
    },
    // Everything linked: no more polling needed.
    settled: () => blurReady && wipeReady,
    wipeReady: () => wipeReady,
    // The canvas's drawing size and the css size it is shown at.
    resize(next) {
      if (next.w === size.w && next.h === size.h && next.cssW === size.cssW) return;
      size = next;
      gl.canvas.width = next.w;
      gl.canvas.height = next.h;
      stats.width = next.w;
      stats.height = next.h;
      makeMask();
      moved = true;
    },
    // A picture of the room (an ImageBitmap in a worker, the page's own image element otherwise).
    upload(mood, source, width, height) {
      if (destroyed || !glassReady) return false;
      const tex = texture(0, 0, { mip: true });
      // texture() left it bound on the scratch unit, where it is filled.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (rooms[mood]) gl.deleteTexture(rooms[mood]);
      rooms[mood] = tex;
      if (blurReady) blurOf(mood, tex, width, height);
      else unblurred.set(mood, { w: width, h: height });
      moved = true;
      return true;
    },
    // 0 = Rain, 1 = Candlelight (follows the window's crossfade).
    setMix(value) {
      const next = Math.min(1, Math.max(0, value));
      if (next === mix) return;
      mix = next;
      moved = true;
    },
    setStill(value) {
      still = Boolean(value);
      last = 0;
    },
    setFoggy(value) {
      fogTarget = value ? FOG_AT_REST : 0;
    },
    // A pointer stroke across the glass, in the window's own 0 – 1 coordinates.
    stroke(segment) {
      if (fogTarget === 0) return;
      strokes.push(segment);
      lastStroke = performance.now();
    },
    // A pause (off screen, a hidden tab) is not time passing on the glass.
    rest() {
      last = 0;
    },
    // Whether anything would change if a frame were drawn now.
    wantsFrame() {
      if (destroyed || !glassReady || !mask) return false;
      if (!still) return true;
      return moved || strokes.length > 0 || Math.abs(fogLevel - fogTarget) > 0.002 || form < 1 || recent();
    },
    frame(now) {
      if (destroyed || !glassReady || !mask) return;
      const begin = performance.now();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      if (!still) time += dt;
      fogLevel += (fogTarget - fogLevel) * (1 - Math.exp(-dt / (fogTarget > fogLevel ? 0.5 : 0.25)));
      form = still ? 1 : Math.min(1, form + dt / FORM_S);
      if (strokes.length || recent()) stepMask(dt);
      let query = null;
      if (timer && queries.length < 4) {
        query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      }
      drawGlass();
      if (query) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        queries.push(query);
      }
      if (timer) readQueries();
      moved = false;
      stats.frames += 1;
      if (stats.cpuMs.length < 600) stats.cpuMs.push(performance.now() - begin);
    },
    lost: () => gl.isContextLost(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!gl.isContextLost()) {
        Object.values(programs).forEach(({ program }) => gl.deleteProgram(program));
        Object.values(rooms).forEach((tex) => tex && gl.deleteTexture(tex));
        Object.values(fogs).forEach(dropTarget);
        mask?.targets.forEach(dropTarget);
        gl.deleteTexture(placeholder);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
};

// The frames: drawn only while the glass is running (on screen, tab visible) and something would
// change. `schedule` is the host's own animation frame: the page's, or the worker's.
export const createLoop = ({ renderer, schedule, cancel, onFirstFrame, onFail }) => {
  let handle = 0;
  let running = false;
  let ready = false;
  let first = true;
  const tick = (now) => {
    handle = 0;
    if (!running || !ready) return;
    renderer.frame(now);
    if (renderer.lost()) {
      onFail();
      return;
    }
    if (first) {
      first = false;
      onFirstFrame();
    }
    kick();
  };
  const kick = () => {
    if (handle || !running || !ready || !renderer.wantsFrame()) return;
    handle = schedule(tick);
  };
  return {
    kick,
    setReady() {
      ready = true;
      kick();
    },
    setRunning(value) {
      if (value === running) return;
      running = value;
      renderer.rest();
      if (!running && handle) {
        cancel(handle);
        handle = 0;
      }
      kick();
    },
    stop() {
      running = false;
      if (handle) cancel(handle);
      handle = 0;
    },
  };
};

// One glass, served: the renderer and its frames, answering the host's messages (rainGlass.js) —
// in a worker (rainWorker.js) or on the page. `post` sends back 'ready', 'first-frame', 'failed'
// and, while debugging, 'stats'.
//   size { size }  picture { mood, bitmap | image }  mix | still | foggy { value }
//   stroke { segment }  run { value }  destroy
export const serveGlass = ({ gl, options, size, post, schedule, cancel }) => {
  const renderer = createRenderer({ gl, ...options });
  let alive = true;
  let announced = false;
  let statsTimer = 0;
  const waiting = new Map();
  const fail = () => {
    if (!alive) return;
    alive = false;
    loop.stop();
    renderer.destroy();
    globalThis.clearInterval(statsTimer);
    post({ type: 'failed' });
  };
  const loop = createLoop({
    renderer,
    schedule,
    cancel,
    onFirstFrame: () => post({ type: 'first-frame' }),
    onFail: fail,
  });
  const upload = (mood, source) => {
    renderer.upload(mood, source, source.naturalWidth || source.width, source.naturalHeight || source.height);
    source.close?.();
  };
  if (size) renderer.resize(size);
  // Polled on a short timer, not on frames: a frame is up to 16 ms of waiting for nothing.
  const check = () => {
    if (!alive) return;
    const state = renderer.poll();
    if (state === 'failed') {
      fail();
      return;
    }
    if (state === 'ready' && !announced) {
      announced = true;
      post({ type: 'ready', compileMs: renderer.stats.compileMs });
      waiting.forEach((source, mood) => upload(mood, source));
      waiting.clear();
      loop.setReady();
    }
    if (state !== 'ready' || !renderer.settled()) globalThis.setTimeout(check, 4);
    else loop.kick();
  };
  check();
  if (options.debug) {
    statsTimer = globalThis.setInterval(() => {
      const s = renderer.stats;
      post({ type: 'stats', stats: { compileMs: s.compileMs, frames: s.frames, width: s.width, height: s.height, gpuMs: s.gpuMs.slice(-240), cpuMs: s.cpuMs.slice(-240) } });
    }, 400);
  }
  return {
    receive(message) {
      if (!alive) {
        message.bitmap?.close?.();
        return;
      }
      switch (message.type) {
        case 'size':
          renderer.resize(message.size);
          break;
        case 'picture': {
          const source = message.bitmap ?? message.image;
          if (announced) upload(message.mood, source);
          else {
            waiting.get(message.mood)?.close?.();
            waiting.set(message.mood, source);
          }
          break;
        }
        case 'mix':
          renderer.setMix(message.value);
          break;
        case 'still':
          renderer.setStill(message.value);
          break;
        case 'foggy':
          renderer.setFoggy(message.value);
          break;
        case 'stroke':
          renderer.stroke(message.segment);
          break;
        case 'run':
          loop.setRunning(message.value);
          return;
        case 'destroy':
          alive = false;
          loop.stop();
          globalThis.clearInterval(statsTimer);
          waiting.forEach((source) => source.close?.());
          renderer.destroy();
          return;
        default:
          return;
      }
      loop.kick();
    },
  };
};
