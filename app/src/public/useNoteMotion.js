import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// Moves a note's blocks from where they were to where they now are, after React has already put
// the new version in the DOM: measure (First), let React commit, measure again (Last), and play
// the difference back (Invert, Play) on the Web Animations API. The DOM always holds the real,
// final note — every effect here is paint only — so the status line and a screen reader have the
// result at once, and cancelling simply leaves the final state.
//
//   capture('run')      Run: blocks move (380ms), new blocks open after them, the page area
//                       grows or shrinks with them; all of it within 600ms
//   capture('compare')  Before / After: a quick 200ms move, nothing more
//   cancel()            stop everything now (goal change, Start over, resize, motion turned off,
//                       unmount)
//
// Sage's note and the words it changed arrive with CSS animations (sageDemo.css). cancel() ends
// those too: it marks the preview's root data-settled, which turns them off and leaves their
// final look, and keeps them off until the next Run — even if a change of layout shows a copy
// of the note that was hidden until then.
//
// Blocks carry data-block="<stable id>". One that disappears leaves an inert, aria-hidden copy
// of itself that fades where it was (in `ghostRef`); a new one fades in where it lands.
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const TIMING = {
  run: { move: 380, enter: 300, enterDelay: 140, stagger: 20, leave: 220 },
  compare: { move: 200, enter: 160, enterDelay: 0, stagger: 0, leave: 140 },
};

export const useNoteMotion = ({ rootRef, bodyRef, ghostRef, reduce }) => {
  const pending = useRef(null);
  const animations = useRef(new Set());
  const cleanups = useRef(new Set());

  const cancel = useCallback(() => {
    pending.current = null;
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
    cleanups.current.forEach((cleanup) => cleanup());
    cleanups.current.clear();
    rootRef?.current?.setAttribute('data-settled', '');
  }, [rootRef]);

  const capture = useCallback(
    (kind) => {
      cancel();
      const body = bodyRef.current;
      if (reduce || !body || typeof body.animate !== 'function') return;
      // A new result arrives: its note and its changed words may animate in once.
      if (kind === 'run') rootRef?.current?.removeAttribute('data-settled');
      const rects = new Map();
      const copies = new Map();
      body.querySelectorAll('[data-block]').forEach((element) => {
        rects.set(element.dataset.block, element.getBoundingClientRect());
        copies.set(element.dataset.block, element.cloneNode(true));
      });
      pending.current = { kind, rects, copies, height: body.getBoundingClientRect().height };
    },
    [rootRef, bodyRef, cancel, reduce],
  );

  // After every commit: if a change was captured, play it. Before paint, so nothing flashes.
  useLayoutEffect(() => {
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    const body = bodyRef.current;
    if (!body) return;
    const timing = TIMING[plan.kind] ?? TIMING.compare;

    const track = (animation, onEnd) => {
      animations.current.add(animation);
      const settle = () => {
        animations.current.delete(animation);
        onEnd?.();
      };
      animation.finished.then(settle, settle);
      return animation;
    };

    // The page area grows or shrinks with its content instead of jumping. Clipped on the
    // vertical axis only, so the margin marks beside each block stay visible.
    const height = body.getBoundingClientRect().height;
    if (Math.abs(height - plan.height) > 1) {
      const previous = body.style.overflowY;
      body.style.overflowY = 'clip';
      const restore = () => {
        body.style.overflowY = previous;
      };
      cleanups.current.add(restore);
      track(
        body.animate([{ height: `${plan.height}px` }, { height: `${height}px` }], {
          duration: timing.move,
          easing: EASE,
        }),
        () => {
          restore();
          cleanups.current.delete(restore);
        },
      );
    }

    const present = new Set();
    let entering = 0;
    body.querySelectorAll('[data-block]').forEach((element) => {
      const id = element.dataset.block;
      present.add(id);
      const before = plan.rects.get(id);
      const now = element.getBoundingClientRect();
      if (before) {
        const dx = before.left - now.left;
        const dy = before.top - now.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          track(
            element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
              duration: timing.move,
              easing: EASE,
            }),
          );
        }
      } else {
        track(
          element.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
            duration: timing.enter,
            delay: timing.enterDelay + Math.min(entering, 5) * timing.stagger,
            easing: EASE,
            fill: 'backwards',
          }),
        );
        entering += 1;
      }
    });

    // Blocks that left: an inert copy fades where each one was.
    const layer = ghostRef.current;
    if (layer) {
      const origin = layer.getBoundingClientRect();
      plan.rects.forEach((rect, id) => {
        if (present.has(id)) return;
        const copy = plan.copies.get(id);
        copy.removeAttribute('data-block');
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('inert', '');
        Object.assign(copy.style, {
          position: 'absolute',
          left: `${rect.left - origin.left}px`,
          top: `${rect.top - origin.top}px`,
          width: `${rect.width}px`,
          margin: '0',
        });
        layer.append(copy);
        const remove = () => copy.remove();
        cleanups.current.add(remove);
        track(
          copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: timing.leave, easing: 'ease-out', fill: 'forwards' }),
          () => {
            remove();
            cleanups.current.delete(remove);
          },
        );
      });
    }
  });

  // Stop on unmount, when motion is turned off, and when the width changes (a phone's address
  // bar resizing the height while scrolling is not a reason to stop).
  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (reduce) cancel();
  }, [reduce, cancel]);

  useEffect(() => {
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      cancel();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [cancel]);

  return { capture, cancel };
};
