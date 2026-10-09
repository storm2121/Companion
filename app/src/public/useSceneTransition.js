import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EASE, FADE, onScreen, sheetFor } from './flight';

// Moving between the home page and a note's own page (MarketingExperience.jsx).
//
// When the address names another page, the page on screen stays mounted a moment longer as the
// leaving page (aria-hidden and inert), pinned with position: fixed exactly where it was and
// fading out on top, while the new page fades in underneath (a fade through the ground, so two
// pages of text never sit over each other):
//
//   open    home -> a note    a sheet grows from what was clicked (a desk card, a preview, the
//                             cover) to the note's frame, carrying a clipped snapshot of it and the
//                             note's own photograph, each at its own size: the sheet changes
//                             shape, nothing is stretched
//   close   a note -> home    the same sheet folds back into what opened the note
//   switch  note -> note      a quick fade
//
// The new page is complete from the first frame: content, scroll position and focus arrive at
// once; the motion is paint only. Reduced motion or the public Motion switch: no leaving page and
// no motion. A new navigation, a change of width or motion setting, and unmount end the running
// transition at once (the effect's cleanup removes everything it added), and a page reached by
// interrupting one arrives without motion.
const PIN = ['position', 'top', 'left', 'width', 'minHeight', 'margin', 'zIndex'];

const kindOf = (from, to) => {
  if (from.view && to.view) return 'switch';
  return to.view ? 'open' : 'close';
};

const pageOf = (root, key) => root?.querySelector(`:scope > [data-scene-page="${key}"]`) ?? null;

// What opened (or reopens) a note on a page: the element it was opened from, else any way in.
const sourceOf = (page, view, opener) =>
  (opener && page.querySelector(`[data-target="${view}"][data-source="${opener}"]`)) ||
  page.querySelector(`[data-target="${view}"]`);

// `scene` is null while the address is about to be replaced (a redirect): nothing moves then.
export const useSceneTransition = ({ scene, reduce }) => {
  const [shown, setShown] = useState(scene);
  const [leaving, setLeaving] = useState(null);
  // Derived from the address: the moment it names another page, the old one starts leaving —
  // unless a transition is still running: an interrupted one ends, and the new page is simply there.
  if (scene && scene.key !== shown?.key) {
    setLeaving(reduce || !shown || leaving ? null : shown);
    setShown(scene);
  } else if (reduce && leaving) {
    setLeaving(null);
  }

  const rootRef = useRef(null);
  const flightRef = useRef(null);
  const previous = useRef(shown);
  // Where each page was read to, to return there; the reading position of the page on show.
  const memory = useRef(new Map());
  const reading = useRef(0);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = shown;
    if (!from || !shown || from.key === shown.key) return undefined;
    const root = rootRef.current;
    const into = pageOf(root, shown.key);
    if (!into) return undefined;

    const kind = kindOf(from, shown);
    const out = leaving ? pageOf(root, leaving.key) : null;
    // A page that was leaving a moment ago can be the one arriving: back into the flow.
    PIN.forEach((property) => {
      into.style[property] = '';
    });
    if (out) {
      const rect = out.getBoundingClientRect();
      Object.assign(out.style, {
        position: 'fixed',
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        minHeight: `${Math.max(0, window.innerHeight - rect.top)}px`,
        margin: '0',
        zIndex: '1',
      });
    }

    // A note is read from its top; the home page comes back where it was left.
    memory.current.set(from.key, reading.current);
    window.scrollTo({ top: kind === 'close' ? (memory.current.get(shown.key) ?? 0) : 0, left: 0, behavior: 'instant' });

    // Focus arrives with the page: a note's heading, or — back home — what opened the note.
    const source = kind === 'close' ? sourceOf(into, from.view, from.opener) : null;
    const target = source ?? into.querySelector('[data-scene-focus]');
    if (target) {
      target.focus({ preventScroll: true });
      if (kind === 'close' && !onScreen(target)) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    }

    if (!out || typeof into.animate !== 'function') return undefined;

    const animations = [];
    const cleanups = [];
    const play = (element, keyframes, options) => {
      const animation = element.animate(keyframes, { easing: EASE, fill: 'both', ...options });
      animations.push(animation);
      return animation.finished;
    };
    const fade = (element, duration, delay = 0) =>
      play(element, [{ opacity: 1 }, { opacity: 0 }], { duration, delay, easing: FADE });
    const appear = (element, duration, delay = 0) =>
      play(element, [{ opacity: 0 }, { opacity: 1 }], { duration, delay, easing: FADE });

    const ended = [];
    const note = kind === 'open' ? into : kind === 'close' ? out : null;
    const frame = note?.querySelector('[data-frame]');
    const card = kind === 'open' ? sourceOf(out, shown.view, shown.opener) : source;
    const flight = flightRef.current;

    if (kind !== 'switch' && frame && onScreen(card) && flight) {
      const opening = kind === 'open';
      // The flight layer is fixed to the screen: positions are the screen's.
      const { sheet, snapshot, photoCopy, from: cardBox, to: frameBox } = sheetFor({
        source: card,
        frame,
        origin: { left: 0, top: 0 },
      });
      flight.append(sheet);
      // The frame itself shows again when the sheet is gone.
      frame.style.opacity = '0';
      cleanups.push(() => {
        frame.style.opacity = '';
        sheet.remove();
      });

      if (opening) {
        ended.push(play(sheet, [cardBox, frameBox], { duration: 420 }));
        play(snapshot, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: FADE });
        if (photoCopy) play(photoCopy, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: FADE });
        ended.push(fade(out, 160), appear(into, 240, 140));
      } else {
        ended.push(play(sheet, [frameBox, cardBox], { duration: 360 }));
        if (photoCopy) play(photoCopy, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 80, easing: FADE });
        play(snapshot, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 120, easing: FADE });
        ended.push(fade(out, 140), appear(into, 220, 120));
      }
    } else if (kind === 'open') {
      // Nothing to grow from on screen: the note rises into place.
      ended.push(
        fade(out, 150),
        play(into, [{ transform: 'translateY(12px)' }, { transform: 'none' }], { duration: 320, delay: 100 }),
        appear(into, 240, 120),
      );
    } else {
      ended.push(fade(out, 130), appear(into, 200, 100));
    }

    let current = true;
    Promise.all(ended).then(
      () => {
        if (current) setLeaving(null);
      },
      () => {},
    );
    return () => {
      current = false;
      animations.forEach((animation) => animation.cancel());
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [shown, leaving]);

  // A change of width ends the transition: the pinned page and the measured sheet would be wrong.
  useEffect(() => {
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      setLeaving(null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The scene restores reading positions itself; the browser's own restoration would jump the
  // page before the transition measures it.
  useEffect(() => {
    const onScroll = () => {
      reading.current = window.scrollY;
    };
    reading.current = window.scrollY;
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.history.scrollRestoration = restoration;
    };
  }, []);

  return { shown, leaving, rootRef, flightRef };
};
