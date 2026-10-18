// The springs (springs.js, with Motion) are a chunk of their own: the page paints without them,
// and they are fetched once it is idle, or at the first press or key, whichever comes first.
// `springs()` answers at once — the module, or null while it is still on its way, in which case
// a change simply happens without motion.

let loaded = null;
let loading = null;

export const loadSprings = () => {
  loading ??= import('./springs.js').then(
    (module) => {
      loaded = module;
      return module;
    },
    () => {
      loading = null;
      return null;
    },
  );
  return loading;
};

export const springs = () => loaded;

// Called once by the public pages: fetch the springs as soon as the page has painted (the fetch
// never holds a frame), or the moment the visitor reaches for something, whichever comes first.
export const warmSprings = () => {
  if (loaded || typeof window === 'undefined') return () => {};
  let frame = 0;
  let timer = 0;
  const start = () => {
    loadSprings();
    stop();
  };
  // Two frames: the first paint has happened.
  frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(start, 0);
    });
  });
  const stop = () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.removeEventListener('pointerdown', start, true);
    window.removeEventListener('keydown', start, true);
  };
  window.addEventListener('pointerdown', start, true);
  window.addEventListener('keydown', start, true);
  return stop;
};
