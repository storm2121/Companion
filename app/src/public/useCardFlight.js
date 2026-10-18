import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { RADIUS, onScreen, sheetFor } from './flight';
import { springs } from './springLoader';

// The desk on the home page shows one note under its cards (MarketingExperience.jsx). Picking
// another card brings that card's note out of it: a sheet springs from the card's outline to the
// note's frame, carrying a clipped snapshot of the card and the new note's photograph at their
// own sizes, while the note that was showing fades where it was. The frame's height follows, so
// the page below moves instead of jumping. The real note is in place from the first frame; the
// motion is paint only (the height follow aside).
//
// Every part starts from where it is on screen: a second pick mid-flight leaves the first sheet
// to fade from wherever it had got to, and the height carries on from its present height and
// speed. Nothing waits for anything.
//
//   capture(card)   just before the pick is shown: what flies, and what leaves
//   cancel()        stop and clear now — a change of width, motion turned off, unmount
//
// The sheet is drawn in `layerRef`, a layer inside the tile (it scrolls with the page).
const MOVE = { duration: 0.46 };

export const useCardFlight = ({ frameRef, layerRef, reduce }) => {
  const pending = useRef(null);
  // The flight in the air: { wrap, clip, fades: [motion], height: motion }.
  const live = useRef(null);

  // `keep`: leave the styles as they are drawn now (a sheet that goes on fading by itself).
  const clear = useCallback((run, keep = false) => {
    if (!run) return;
    run.clip?.destroy();
    run.fades.forEach((fade) => fade.destroy(!keep));
    run.wrap?.remove();
    run.leavers.forEach((leaver) => {
      leaver.fade.destroy();
      leaver.element.remove();
    });
  }, []);

  const cancel = useCallback(() => {
    pending.current = null;
    const run = live.current;
    live.current = null;
    if (!run) return;
    clear(run);
    run.height?.destroy();
    const frame = frameRef.current;
    if (frame) {
      frame.style.opacity = '';
      frame.style.overflow = '';
    }
  }, [clear, frameRef]);

  const capture = useCallback(
    (card) => {
      const S = springs();
      const frame = frameRef.current;
      if (reduce || !S || !frame || !layerRef.current || !onScreen(frame)) {
        cancel();
        return;
      }
      const run = live.current;
      // The height as it is drawn now (mid-follow, if a flight is still landing) and its speed.
      const speed = run?.height?.mv.getVelocity() ?? 0;
      run?.clip?.stop();
      run?.height?.stop();
      const picture = frame.querySelector('picture');
      pending.current = {
        card: onScreen(card) ? card : null,
        height: frame.getBoundingClientRect().height,
        speed,
        // What is on show leaves: the sheet still in the air, or else the note in the frame.
        leaving: run?.wrap ? null : picture ? { copy: picture.cloneNode(true), rect: picture.getBoundingClientRect() } : null,
      };
    },
    [cancel, frameRef, layerRef, reduce],
  );

  // After the commit that shows the new note: play the change. Before paint, so nothing flashes.
  useLayoutEffect(() => {
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    const S = springs();
    const frame = frameRef.current;
    const layer = layerRef.current;
    if (!S || !frame || !layer) return;
    const previous = live.current;
    const origin = layer.getBoundingClientRect();
    const run = { wrap: null, clip: null, fades: [], leavers: [], height: previous?.height ?? null };
    live.current = run;

    // The sheet that was in the air fades from where it got to; the leavers it had keep fading.
    if (previous) {
      previous.clip?.stop();
      if (previous.wrap) {
        const sheet = previous.wrap;
        const fade = S.styleMotion(sheet, 'opacity', Number(getComputedStyle(sheet).opacity) || 1);
        const leaver = { element: sheet, fade };
        run.leavers.push(leaver);
        S.tweenTo(fade.mv, 0, 0.18).finished.then(() => {
          fade.destroy();
          sheet.remove();
          run.leavers = run.leavers.filter((item) => item !== leaver);
        });
        previous.wrap = null;
      }
      run.leavers.push(...previous.leavers);
      previous.leavers = [];
      clear(previous, true);
    }

    // The frame takes the new note's height, springing from the height it had on screen.
    frame.style.height = '';
    const natural = frame.getBoundingClientRect().height;
    if (Math.abs(natural - plan.height) > 1) {
      run.height?.destroy(false);
      run.height = S.styleMotion(frame, 'height', plan.height, 'px');
      frame.style.overflow = 'hidden';
      S.springTo(run.height.mv, natural, { ...MOVE, velocity: plan.speed }).finished.then(() => {
        if (live.current?.height !== run.height) return;
        run.height.destroy();
        run.height = null;
        frame.style.overflow = '';
      });
    } else if (run.height) {
      run.height.destroy();
      run.height = null;
      frame.style.overflow = '';
    }

    // The note that was showing fades where it was.
    if (plan.leaving) {
      const { copy, rect } = plan.leaving;
      copy.removeAttribute('class');
      copy.removeAttribute('style');
      Object.assign(copy.style, {
        position: 'absolute',
        display: 'block',
        left: `${rect.left - origin.left}px`,
        top: `${rect.top - origin.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${RADIUS}px`,
        overflow: 'hidden',
      });
      const image = copy.querySelector('img');
      if (image) Object.assign(image.style, { display: 'block', width: '100%', height: '100%' });
      layer.append(copy);
      const fade = S.styleMotion(copy, 'opacity', 1);
      const leaver = { element: copy, fade };
      run.leavers.push(leaver);
      S.tweenTo(fade.mv, 0, 0.18).finished.then(() => {
        fade.destroy();
        copy.remove();
        run.leavers = run.leavers.filter((item) => item !== leaver);
      });
    }

    const land = () => {
      if (live.current !== run) return;
      frame.style.opacity = '';
      clear({ ...run, leavers: [] });
      run.wrap = null;
      run.clip = null;
      run.fades = [];
    };

    if (plan.card) {
      // The frame's content waits under the sheet until it lands.
      frame.style.opacity = '0';
      const { wrap, sheet, snapshot, photo, from, to, size } = sheetFor({ source: plan.card, frame, origin });
      layer.append(wrap);
      run.wrap = wrap;
      run.clip = S.boxMotion(wrap, sheet, from, size, RADIUS);
      const snap = S.styleMotion(snapshot, 'opacity', 1);
      run.fades.push(snap);
      S.tweenTo(snap.mv, 0, 0.16);
      if (photo) {
        const appear = S.styleMotion(photo, 'opacity', 0);
        run.fades.push(appear);
        S.tweenTo(appear.mv, 1, 0.24);
      }
      run.clip.to(to, MOVE).then(land);
    } else {
      // No card on screen to come from: the new note fades in where it is.
      const appear = S.styleMotion(frame, 'opacity', 0);
      run.fades.push(appear);
      S.tweenTo(appear.mv, 1, 0.22, { delay: 0.1 }).finished.then(() => {
        if (live.current !== run) return;
        appear.destroy();
        run.fades = run.fades.filter((item) => item !== appear);
      });
    }
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
