import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { EASE, FADE, onScreen, sheetFor } from './flight';

// The desk on the home page shows one note under its cards (MarketingExperience.jsx). Picking
// another card brings that card's note out of it: the note that was showing fades where it was,
// and a sheet grows from the card's outline to the note's frame, carrying a clipped snapshot of
// the card and the new note's photograph at their own sizes. The frame's height follows, so the
// page below moves instead of jumping. The real note is in place from the first frame; all of
// this is paint only.
//
//   capture(card)   just before the pick is shown: what flies, and the note that leaves
//   cancel()        stop now — another pick, a change of width, motion turned off, unmount
//
// The sheet is drawn in `layerRef`, a layer inside the section (it scrolls with the page).
export const useCardFlight = ({ frameRef, layerRef, reduce }) => {
  const pending = useRef(null);
  const live = useRef({ animations: [], cleanups: [] });

  const cancel = useCallback(() => {
    pending.current = null;
    const { animations, cleanups } = live.current;
    live.current = { animations: [], cleanups: [] };
    animations.forEach((animation) => animation.cancel());
    cleanups.forEach((cleanup) => cleanup());
  }, []);

  const capture = useCallback(
    (card) => {
      cancel();
      const frame = frameRef.current;
      if (reduce || !frame || !layerRef.current || typeof frame.animate !== 'function' || !onScreen(frame)) return;
      const picture = frame.querySelector('picture');
      pending.current = {
        card: onScreen(card) ? card : null,
        rect: frame.getBoundingClientRect(),
        leaving: picture ? { copy: picture.cloneNode(true), rect: picture.getBoundingClientRect() } : null,
      };
    },
    [cancel, frameRef, layerRef, reduce],
  );

  // After the commit that shows the new note: play the change. Before paint, so nothing flashes.
  useLayoutEffect(() => {
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    const frame = frameRef.current;
    const layer = layerRef.current;
    if (!frame || !layer) return;
    const origin = layer.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const run = { animations: [], cleanups: [] };
    live.current = run;
    const play = (element, keyframes, options) => {
      const animation = element.animate(keyframes, { easing: EASE, fill: 'both', ...options });
      run.animations.push(animation);
      return animation.finished;
    };
    const ended = [];

    // The frame takes the new note's height while its content waits for the sheet.
    frame.style.opacity = '0';
    run.cleanups.push(() => {
      frame.style.opacity = '';
    });
    if (Math.abs(frameRect.height - plan.rect.height) > 1) {
      ended.push(play(frame, [{ height: `${plan.rect.height}px` }, { height: `${frameRect.height}px` }], { duration: 420 }));
    }

    // The note that was showing fades where it was.
    if (plan.leaving) {
      const { copy, rect } = plan.leaving;
      copy.removeAttribute('class');
      Object.assign(copy.style, {
        position: 'absolute',
        display: 'block',
        left: `${rect.left - origin.left}px`,
        top: `${rect.top - origin.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      const image = copy.querySelector('img');
      if (image) Object.assign(image.style, { display: 'block', width: '100%', height: '100%' });
      layer.append(copy);
      run.cleanups.push(() => copy.remove());
      play(copy, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: FADE });
    }

    if (plan.card) {
      const { sheet, snapshot, photoCopy, from, to } = sheetFor({ source: plan.card, frame, origin });
      layer.append(sheet);
      run.cleanups.push(() => sheet.remove());
      ended.push(play(sheet, [from, to], { duration: 420 }));
      play(snapshot, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: FADE });
      if (photoCopy) play(photoCopy, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: FADE });
    } else {
      // No card on screen to come from: the new note fades in where it is.
      ended.push(play(frame, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 120, easing: FADE }));
    }

    Promise.all(ended).then(
      () => {
        if (live.current === run) cancel();
      },
      () => {},
    );
  });

  // Stop on unmount, when motion is turned off, and when the width changes.
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
