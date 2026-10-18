import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RADIUS, onScreen, sheetFor } from './flight';
import { springs } from './springLoader';

// Moving between the home page and a note's own page (MarketingExperience.jsx).
//
// When the address names another page, the page on screen stays mounted a moment longer as the
// leaving page (aria-hidden and inert), pinned with position: fixed exactly where it was and
// fading out on top, while the new page fades in underneath (a fade through the ground, so two
// pages of text never sit over each other):
//
//   open    home -> a note    a sheet springs from what was clicked (the window, a desk card's
//                             note, a ⌘K row) to the note's frame, carrying a clipped snapshot of it
//                             and the note's own photograph, each at its own size: only the sheet's
//                             outline changes (flight.js), nothing is stretched
//   close   a note -> home    the same sheet folds back into what opened the note — or, when the
//                             address names a section (a link, not Back), the home fades in there
//   switch  note -> note      a quick fade
//
// Everything is a spring or a short fade from where it is on screen. Turning back mid-transition
// (Back while a note is still opening) does not restart anything: the two pages swap roles and
// the same sheet, and the same fades, turn round from wherever they had got to. A third page
// reached mid-transition simply arrives. The new page is complete from the first frame: content,
// scroll position and focus arrive at once; the motion is paint only. Reduced motion or the public
// Motion switch: no leaving page and no motion; a change of width ends a transition at once.
const PIN = ['position', 'top', 'left', 'width', 'minHeight', 'margin', 'zIndex'];
const MOVE = { duration: 0.5 };

const kindOf = (from, to) => {
  if (from.view && to.view) return 'switch';
  return to.view ? 'open' : 'close';
};

const pageOf = (root, key) => root?.querySelector(`:scope > [data-scene-page="${key}"]`) ?? null;

// What opened (or reopens) a note on a page: the element it was opened from, else any way in.
const sourceOf = (page, view, opener) =>
  (opener && page.querySelector(`[data-target="${view}"][data-source="${opener}"]`)) ||
  page.querySelector(`[data-target="${view}"]`);

const stopRun = (run) => {
  run.clip?.stop();
  run.motions.forEach((motion) => motion.stop());
};

const disposeRun = (run) => {
  stopRun(run);
  run.clip?.destroy();
  run.wrap?.remove();
  run.motions.forEach((motion) => motion.destroy());
  if (run.frame) run.frame.style.opacity = '';
};

// `scene` is null while the address is about to be replaced (a redirect): nothing moves then.
export const useSceneTransition = ({ scene, reduce }) => {
  const [shown, setShown] = useState(scene);
  const [leaving, setLeaving] = useState(null);
  // Derived from the address: the moment it names another page, the old one starts leaving —
  // or, if it is the page that was just leaving, the two swap; a third page simply arrives.
  if (scene && scene.key !== shown?.key) {
    const back = Boolean(leaving && scene.key === leaving.key);
    const moving = !reduce && Boolean(springs()) && Boolean(shown);
    setLeaving(moving && (back || !leaving) ? shown : null);
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
  // The transition in the air: kept across a turn back, so it can turn round where it is.
  const live = useRef(null);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = shown;
    // Motion turned off, a resize, or a transition that has finished: nothing may stay behind.
    if (live.current && !leaving) {
      disposeRun(live.current);
      live.current = null;
    }
    if (!from || !shown || from.key === shown.key) return undefined;
    const root = rootRef.current;
    const into = pageOf(root, shown.key);
    if (!into) return undefined;

    const S = springs();
    const kind = kindOf(from, shown);
    const out = leaving ? pageOf(root, leaving.key) : null;
    const running = live.current;
    const back = Boolean(out && running && running.from === shown.key && running.to === from.key);
    if (running && !back) {
      disposeRun(running);
      live.current = null;
    }

    // A page that was leaving a moment ago can be the one arriving: back into the flow.
    PIN.forEach((property) => {
      into.style[property] = '';
    });
    if (out) {
      // Until this commit the leaving page was the one page in the flow, at its top: that is where
      // it is pinned (the arriving page may already sit above it in the document).
      const rect = out.getBoundingClientRect();
      const top = root.getBoundingClientRect().top;
      Object.assign(out.style, {
        position: 'fixed',
        top: `${top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        minHeight: `${Math.max(0, window.innerHeight - top)}px`,
        margin: '0',
        zIndex: '1',
      });
    }

    // A note is read from its top; the home page comes back where it was left — or, when a link
    // named one of its sections, there.
    memory.current.set(from.key, reading.current);
    const section = kind === 'close' && shown.landOn ? into.querySelector(`#${shown.landOn}`) : null;
    let top = 0;
    if (section) {
      const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
      top = Math.max(0, section.getBoundingClientRect().top + window.scrollY - margin);
    } else if (kind === 'close') {
      top = memory.current.get(shown.key) ?? 0;
    }
    window.scrollTo({ top, left: 0, behavior: 'instant' });

    // Focus arrives with the page: a note's heading, or — back home — what opened the note.
    const source = kind === 'close' && !section ? sourceOf(into, from.view, from.opener) : null;
    const target = section?.querySelector('h2') ?? source ?? into.querySelector('[data-scene-focus]');
    if (target) {
      target.focus({ preventScroll: true });
      // A ⌘K row is an option of a list, not a thing to focus: its field takes the focus.
      if (document.activeElement !== target) {
        const list = target.closest('[role="listbox"]');
        if (list?.id) document.querySelector(`[aria-controls="${list.id}"]`)?.focus({ preventScroll: true });
      }
      if (source && !onScreen(target)) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    }

    if (!out || !S) return undefined;

    const token = {};
    const run = back
      ? running
      : { from: from.key, to: shown.key, motions: [], fades: new Map(), clip: null, wrap: null, frame: null, boxes: null, snap: null, photo: null };
    run.from = from.key;
    run.to = shown.key;
    run.token = token;
    live.current = run;
    const fadeOf = (element, start) => {
      if (!run.fades.has(element)) {
        const fade = S.styleMotion(element, 'opacity', start);
        run.fades.set(element, fade);
        run.motions.push(fade);
      }
      return run.fades.get(element).mv;
    };
    const ends = [];

    if (back && run.clip) {
      // Turning round: the sheet heads back where it came from, from where it is.
      const opening = kind === 'open';
      ends.push(run.clip.to(opening ? run.boxes.frame : run.boxes.card, MOVE));
      if (run.snap) S.tweenTo(run.snap, opening ? 0 : 1, 0.18);
      if (run.photo) S.tweenTo(run.photo, opening ? 1 : 0, 0.18);
      ends.push(S.tweenTo(fadeOf(out, 1), 0, 0.16).finished, S.tweenTo(fadeOf(into, 0), 1, 0.22).finished);
    } else if (back) {
      ends.push(S.tweenTo(fadeOf(out, 1), 0, 0.14).finished, S.tweenTo(fadeOf(into, 0), 1, 0.2).finished);
    } else {
      const note = kind === 'open' ? into : kind === 'close' ? out : null;
      const frame = note?.querySelector('[data-frame]');
      const card = kind === 'open' ? sourceOf(out, shown.view, shown.opener) : source;
      const flight = flightRef.current;
      if (kind !== 'switch' && frame && onScreen(card) && flight) {
        const opening = kind === 'open';
        // The flight layer is fixed to the screen: positions are the screen's.
        const { wrap, sheet, snapshot, photo, from: cardBox, to: frameBox, size } = sheetFor({
          source: card,
          frame,
          origin: { left: 0, top: 0 },
        });
        flight.append(wrap);
        run.wrap = wrap;
        run.frame = frame;
        run.boxes = { card: cardBox, frame: frameBox };
        // The frame itself shows again when the sheet is gone.
        frame.style.opacity = '0';
        run.clip = S.boxMotion(wrap, sheet, opening ? cardBox : frameBox, size, RADIUS);
        const snap = S.styleMotion(snapshot, 'opacity', opening ? 1 : 0);
        run.motions.push(snap);
        run.snap = snap.mv;
        if (photo) {
          const picture = S.styleMotion(photo, 'opacity', opening ? 0 : 1);
          run.motions.push(picture);
          run.photo = picture.mv;
        }
        if (opening) {
          ends.push(run.clip.to(frameBox, MOVE));
          S.tweenTo(run.snap, 0, 0.16);
          if (run.photo) S.tweenTo(run.photo, 1, 0.24);
          ends.push(S.tweenTo(fadeOf(out, 1), 0, 0.18).finished, S.tweenTo(fadeOf(into, 0), 1, 0.26, { delay: 0.12 }).finished);
        } else {
          ends.push(run.clip.to(cardBox, { duration: 0.44 }));
          if (run.photo) S.tweenTo(run.photo, 0, 0.2, { delay: 0.08 });
          S.tweenTo(run.snap, 1, 0.22, { delay: 0.1 });
          ends.push(S.tweenTo(fadeOf(out, 1), 0, 0.16).finished, S.tweenTo(fadeOf(into, 0), 1, 0.22, { delay: 0.1 }).finished);
        }
      } else if (kind === 'open') {
        // Nothing to grow from on screen: the note rises into place.
        const rise = S.elementMotion(into);
        run.motions.push(rise);
        rise.y.jump(14);
        rise.render();
        ends.push(S.springTo(rise.y, 0, { duration: 0.42, delay: 0.08 }).finished);
        ends.push(S.tweenTo(fadeOf(out, 1), 0, 0.16).finished, S.tweenTo(fadeOf(into, 0), 1, 0.24, { delay: 0.1 }).finished);
      } else {
        ends.push(S.tweenTo(fadeOf(out, 1), 0, 0.14).finished, S.tweenTo(fadeOf(into, 0), 1, 0.2, { delay: 0.08 }).finished);
      }
    }

    Promise.all(ends).then(() => {
      if (live.current !== run || run.token !== token) return;
      disposeRun(run);
      live.current = null;
      setLeaving(null);
    });
    return () => {
      // Another change is coming: stop where everything is, and leave it drawn there — the next
      // run turns it round, or clears it.
      if (live.current === run) stopRun(run);
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

  useEffect(
    () => () => {
      if (live.current) disposeRun(live.current);
      live.current = null;
    },
    [],
  );

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
