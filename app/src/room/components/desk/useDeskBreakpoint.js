import { useSyncExternalStore } from 'react';
import { BP_HUGE, DESK_MEDIA } from '../../deskLayout';

// The desk's breakpoint, from media queries — never from measuring anything. One set of
// MediaQueryLists for the module; a change re-renders only the pages that read it.

const queries =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? DESK_MEDIA.map(([name, query]) => [name, window.matchMedia(query)])
    : [];

const subscribe = (onChange) => {
  queries.forEach(([, list]) => list.addEventListener('change', onChange));
  return () => queries.forEach(([, list]) => list.removeEventListener('change', onChange));
};

const current = () => queries.find(([, list]) => list.matches)?.[0] || BP_HUGE;

export const useDeskBreakpoint = () => useSyncExternalStore(subscribe, current, () => BP_HUGE);

// The system's reduced-motion wish, the same way: a media query, never a measurement.
const reduced =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

const subscribeReduced = (onChange) => {
  reduced?.addEventListener('change', onChange);
  return () => reduced?.removeEventListener('change', onChange);
};

export const useReducedMotion = () => useSyncExternalStore(subscribeReduced, () => Boolean(reduced?.matches), () => false);

// The window's size, for the seated scene (deskLayout.sceneLayout composes it for the window):
// the window itself, never an element's measured box. One listener for the module, read once
// a frame at most while it is being resized.
let size = typeof window === 'undefined' ? { width: 1440, height: 900 } : { width: window.innerWidth, height: window.innerHeight };
const sizeListeners = new Set();
let sizeFrame = 0;
const onResize = () => {
  if (sizeFrame) return;
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = 0;
    const next = { width: window.innerWidth, height: window.innerHeight };
    if (next.width === size.width && next.height === size.height) return;
    size = next;
    sizeListeners.forEach((listener) => listener());
  });
};

const subscribeSize = (onChange) => {
  if (!sizeListeners.size && typeof window !== 'undefined') window.addEventListener('resize', onResize);
  sizeListeners.add(onChange);
  return () => {
    sizeListeners.delete(onChange);
    if (!sizeListeners.size && typeof window !== 'undefined') window.removeEventListener('resize', onResize);
  };
};

export const useViewport = () => useSyncExternalStore(subscribeSize, () => size, () => size);
