import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { springs } from './springLoader';

// Moves a note's blocks from where they were to where they now are, after React has already put
// the new version in the DOM: measure where everything is drawn (First), let React commit,
// measure again (Last), and spring the difference back to nothing (Invert, Play). The DOM always
// holds the real, final note — every effect here is paint only — so the status line and a screen
// reader have the result at once.
//
// Every block's offset and opacity are live values (springs.js): a second pick mid-move starts
// each block from where it is DRAWN, at the speed it is moving, so nothing jumps and nothing
// waits. New blocks rise and fade in after the move; a block that leaves fades out where it was
// (an inert copy, in `ghostRef`); the page area's height follows from its present height.
//
//   capture('run')      a goal was picked: blocks move, new ones arrive, the height follows
//   capture('compare')  Before / After: the same, quicker
//   cancel()            stop and clear everything now (a resize, motion turned off, unmount)
//
// Sage's note and the words it changed arrive with CSS animations (sageDemo.css). cancel() ends
// those too: it marks the preview's root data-settled, which turns them off and leaves their
// final look. With reduced motion the new version cross-fades in instead.
//
// Blocks carry data-block="<stable id>".
const TIMING = {
  run: { move: 0.46, enter: 0.36, delay: 0.12, stagger: 0.025, leave: 0.2 },
  compare: { move: 0.3, enter: 0.24, delay: 0, stagger: 0, leave: 0.14 },
};

export const useNoteMotion = ({ rootRef, bodyRef, ghostRef, reduce }) => {
  const pending = useRef(null);
  // Block id -> { element, motion } (motion: springs.js elementMotion).
  const blocks = useRef(new Map());
  const height = useRef(null);
  const ghosts = useRef(new Set());

  const clearGhosts = () => {
    ghosts.current.forEach(({ element, fade }) => {
      fade.destroy();
      element.remove();
    });
    ghosts.current.clear();
  };

  const cancel = useCallback(() => {
    pending.current = null;
    blocks.current.forEach(({ motion }) => motion.destroy());
    blocks.current.clear();
    clearGhosts();
    const body = bodyRef.current;
    height.current?.destroy();
    height.current = null;
    if (body) {
      body.style.overflowY = '';
      body.style.opacity = '';
    }
    rootRef?.current?.setAttribute('data-settled', '');
  }, [rootRef, bodyRef]);

  const capture = useCallback(
    (kind) => {
      const body = bodyRef.current;
      const S = springs();
      if (!body) return;
      if (reduce || !S) {
        cancel();
        pending.current = S ? { kind: 'fade' } : null;
        return;
      }
      // A new result arrives: its note and its changed words may animate in once.
      if (kind === 'run') rootRef?.current?.removeAttribute('data-settled');
      const rects = new Map();
      const copies = new Map();
      const speeds = new Map();
      body.querySelectorAll('[data-block]').forEach((element) => {
        const id = element.dataset.block;
        // Where it is drawn now — mid-move included — and how fast it is going.
        rects.set(id, element.getBoundingClientRect());
        const held = blocks.current.get(id);
        if (held?.element === element) {
          speeds.set(id, { x: held.motion.x.getVelocity(), y: held.motion.y.getVelocity(), o: held.motion.o.get() });
        }
        copies.set(id, element.cloneNode(true));
      });
      pending.current = {
        kind,
        rects,
        copies,
        speeds,
        height: body.getBoundingClientRect().height,
        heightSpeed: height.current?.mv.getVelocity() ?? 0,
      };
    },
    [rootRef, bodyRef, cancel, reduce],
  );

  // After every commit: if a change was captured, play it. Before paint, so nothing flashes.
  useLayoutEffect(() => {
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    const body = bodyRef.current;
    const S = springs();
    if (!body || !S) return;

    if (plan.kind === 'fade') {
      // Reduced motion: the new version simply cross-fades in.
      const fade = S.styleMotion(body, 'opacity', 0);
      S.tweenTo(fade.mv, 1, 0.18).finished.then(() => fade.destroy());
      return;
    }

    const timing = TIMING[plan.kind] ?? TIMING.compare;

    // The page area grows or shrinks with its content, from the height it had on screen.
    // Clipped on the vertical axis only, so the marks above each block stay visible.
    height.current?.stop();
    body.style.height = '';
    const natural = body.getBoundingClientRect().height;
    if (Math.abs(natural - plan.height) > 1) {
      height.current?.destroy(false);
      const follow = S.styleMotion(body, 'height', plan.height, 'px');
      height.current = follow;
      body.style.overflowY = 'clip';
      S.springTo(follow.mv, natural, { duration: timing.move, velocity: plan.heightSpeed }).finished.then(() => {
        if (height.current !== follow) return;
        follow.destroy();
        height.current = null;
        body.style.overflowY = '';
      });
    } else if (height.current) {
      height.current.destroy();
      height.current = null;
      body.style.overflowY = '';
    }

    const present = new Set();
    let entering = 0;
    body.querySelectorAll('[data-block]').forEach((element) => {
      const id = element.dataset.block;
      present.add(id);
      let held = blocks.current.get(id);
      if (held && held.element !== element) {
        held.motion.destroy();
        held = null;
      }
      if (!held) {
        held = { element, motion: S.elementMotion(element) };
        blocks.current.set(id, held);
      }
      const { motion } = held;
      const before = plan.rects.get(id);
      // Where its layout puts it now: what is drawn, less the offset it is still carrying.
      const drawn = element.getBoundingClientRect();
      const left = drawn.left - motion.x.get();
      const top = drawn.top - motion.y.get();
      if (before) {
        const speed = plan.speeds.get(id);
        const dx = before.left - left;
        const dy = before.top - top;
        motion.x.jump(dx);
        motion.y.jump(dy);
        motion.render();
        S.springTo(motion.x, 0, { duration: timing.move, velocity: speed?.x ?? 0 });
        S.springTo(motion.y, 0, { duration: timing.move, velocity: speed?.y ?? 0 });
        // A block that was still arriving keeps arriving.
        if (motion.o.get() < 1) S.springTo(motion.o, 1, { duration: timing.enter });
      } else {
        motion.x.jump(0);
        motion.y.jump(8);
        motion.o.jump(0);
        motion.render();
        const delay = timing.delay + Math.min(entering, 5) * timing.stagger;
        S.springTo(motion.y, 0, { duration: timing.enter, delay });
        S.springTo(motion.o, 1, { duration: timing.enter, delay });
        entering += 1;
      }
    });

    // Blocks that left: an inert copy fades where each one was drawn, from how it was drawn.
    blocks.current.forEach((held, id) => {
      if (present.has(id)) return;
      held.motion.destroy();
      blocks.current.delete(id);
    });
    const layer = ghostRef.current;
    if (layer) {
      const origin = layer.getBoundingClientRect();
      plan.rects.forEach((rect, id) => {
        if (present.has(id)) return;
        const copy = plan.copies.get(id);
        copy.removeAttribute('data-block');
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('inert', '');
        const start = plan.speeds.get(id)?.o ?? 1;
        Object.assign(copy.style, {
          position: 'absolute',
          left: `${rect.left - origin.left}px`,
          top: `${rect.top - origin.top}px`,
          width: `${rect.width}px`,
          margin: '0',
          transform: '',
          opacity: String(start),
        });
        layer.append(copy);
        const fade = S.styleMotion(copy, 'opacity', start);
        const ghost = { element: copy, fade };
        ghosts.current.add(ghost);
        S.tweenTo(fade.mv, 0, timing.leave).finished.then(() => {
          fade.destroy();
          copy.remove();
          ghosts.current.delete(ghost);
        });
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
