// The rain on the home's window (HeroWindow.jsx): the page's side of it. The glass itself is drawn
// by rainRenderer.js — in a worker on an OffscreenCanvas (rainWorker.js) wherever the browser can
// hand a canvas over, so making the WebGL2 context, compiling, uploading the pictures and drawing
// every frame never hold the page's main thread; elsewhere on the page itself. This side knows
// what only the page can: whether the window is on screen and the tab visible (it runs only then),
// how big it is, the pictures, and the pointer's strokes.
//
//   createRainGlass({ canvas, reduce, foggy, ground, debug }) -> null without WebGL2, else
//   { ready, stats, setPicture(mood, image), setMix, setStill, setFoggy, stroke, onFirstFrame,
//     destroy }
// Any failure resolves `ready` false and the window stays the plain capture.

const DPR_CAP = 1.5;

// As rainRenderer.js CONTEXT (kept here so the page never loads the drawing code for nothing).
const CONTEXT = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };

// Whether the canvas can be handed to a worker. No WebGL2 probe here: making a context on the page
// is exactly the cost the worker saves; without WebGL2 the worker says so, and the window stays
// the plain capture.
const canHandOver = (canvas) =>
  typeof canvas.transferControlToOffscreen === 'function' &&
  typeof Worker !== 'undefined' &&
  typeof createImageBitmap === 'function';

export const createRainGlass = ({ canvas, reduce = false, foggy = true, ground = '#d6dde0', debug = false }) => {
  const stats = { compileMs: null, frames: 0, cpuMs: [], gpuMs: [], width: 0, height: 0, thread: null };
  const options = { reduce, foggy, ground, debug };
  let destroyed = false;
  let failed = false;
  let drawn = false;
  let inView = false;
  let shown = document.visibilityState === 'visible';
  let size = null;
  let worker = null;
  let inline = null;
  let queue = [];
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const firstFrame = new Set();
  const loaded = { rain: '', candlelight: '' };

  const send = (message, transfer) => {
    if (destroyed || failed) {
      message.bitmap?.close?.();
      return;
    }
    if (worker) worker.postMessage(message, transfer ?? []);
    else if (inline) inline.receive(message);
    else queue.push(message);
  };

  const fail = () => {
    if (failed) return;
    failed = true;
    resolveReady(false);
    destroy();
  };

  const handle = (message) => {
    if (message.type === 'ready') {
      stats.compileMs = message.compileMs;
      resolveReady(true);
    } else if (message.type === 'first-frame') {
      drawn = true;
      firstFrame.forEach((callback) => callback());
      firstFrame.clear();
    } else if (message.type === 'failed') {
      fail();
    } else if (message.type === 'stats') {
      Object.assign(stats, message.stats);
    }
  };

  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const scale = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    if (size && size.w === w && size.h === h) return true;
    size = { w, h, cssW: rect.width, cssH: rect.height, scale: w / rect.width };
    stats.width = w;
    stats.height = h;
    return true;
  };

  const running = () => send({ type: 'run', value: inView && shown });

  // ── Where the glass is drawn ──────────────────────────────────────────────────────────────
  measure();
  if (canHandOver(canvas)) {
    try {
      worker = new Worker(new URL('./rainWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => handle(data);
      worker.onerror = () => fail();
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen, options, size }, [offscreen]);
      stats.thread = 'worker';
    } catch {
      worker?.terminate();
      worker = null;
      return null;
    }
  } else {
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', CONTEXT);
    } catch {
      gl = null;
    }
    if (!gl) return null;
    stats.thread = 'page';
    // The drawing code is fetched only when it has to run here.
    import('./rainRenderer.js').then(
      ({ serveGlass }) => {
        if (destroyed) return;
        inline = serveGlass({
          gl,
          options,
          size,
          post: (message) => {
            if (message.type === 'stats') Object.assign(stats, message.stats);
            else handle(message);
          },
          schedule: (callback) => requestAnimationFrame(callback),
          cancel: (handle) => cancelAnimationFrame(handle),
        });
        const pending = queue;
        queue = [];
        pending.forEach((message) => inline.receive(message));
      },
      () => fail(),
    );
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      fail();
    });
  }

  // ── Watching ──────────────────────────────────────────────────────────────────────────────
  const io = new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    running();
  });
  io.observe(canvas);
  const onVisibility = () => {
    shown = document.visibilityState === 'visible';
    running();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const ro = new ResizeObserver(() => {
    const before = size;
    if (measure() && size !== before) send({ type: 'size', size });
  });
  ro.observe(canvas);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    if (worker) {
      const leaving = worker;
      worker = null;
      leaving.postMessage({ type: 'destroy' });
      setTimeout(() => leaving.terminate(), 500);
    }
    inline?.receive({ type: 'destroy' });
    inline = null;
    resolveReady(false);
  }

  return {
    ready,
    stats,
    // A picture of the room, once it has loaded (and again if the browser picks another crop).
    async setPicture(mood, image) {
      if (destroyed || failed || !image?.naturalWidth) return false;
      const src = image.currentSrc || image.src;
      if (loaded[mood] === src) return true;
      loaded[mood] = src;
      try {
        await image.decode?.();
      } catch {
        loaded[mood] = '';
        return false;
      }
      if (destroyed || failed) return false;
      if (!worker) {
        send({ type: 'picture', mood, image });
        return true;
      }
      // Decoded off the main thread, and handed over without a copy.
      const bitmap = await createImageBitmap(image, { premultiplyAlpha: 'none' }).catch(() => null);
      if (!bitmap) return false;
      send({ type: 'picture', mood, bitmap }, [bitmap]);
      return true;
    },
    // 0 = Rain, 1 = Candlelight (follows the window's crossfade).
    setMix: (value) => send({ type: 'mix', value }),
    setStill: (value) => send({ type: 'still', value: Boolean(value) }),
    setFoggy: (value) => send({ type: 'foggy', value: Boolean(value) }),
    // A pointer stroke across the glass, in the window's own 0 – 1 coordinates.
    stroke: (x0, y0, x1, y1) => send({ type: 'stroke', segment: [x0, y0, x1, y1] }),
    onFirstFrame(callback) {
      if (drawn) callback();
      else firstFrame.add(callback);
    },
    destroy,
  };
};
