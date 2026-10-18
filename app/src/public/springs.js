import { animate, frame, motionValue } from 'motion';

// Every movement on the public pages, as springs (Motion). A spring starts from where a thing is
// on screen and carries the speed it already has, so a change of mind mid-flight bends the motion
// instead of restarting it. Critically damped (no bounce) by default; `duration` is how long it
// takes to visually settle. This module is its own chunk, fetched once the page has painted
// (springLoader.js): until it arrives a change simply happens, without motion.
//
// Values are written to the DOM once per frame, in Motion's render step: reads (measuring) only
// ever happen in event handlers and layout effects, never in the loop.

export const SPRING = { type: 'spring', bounce: 0, duration: 0.42 };

export const value = (initial) => motionValue(initial);

export const springTo = (mv, target, options = {}) => animate(mv, target, { ...SPRING, ...options });

// For fades that should take a set time (the reduced-motion cross-fades, a ghost leaving).
export const tweenTo = (mv, target, duration = 0.2, options = {}) =>
  animate(mv, target, { type: 'tween', ease: 'linear', duration, ...options });

const settled = (animations) => Promise.all(animations.map((animation) => animation.finished));

// An element's offset and opacity as live values: written as one transform and one opacity per
// frame, and cleared again at rest so nothing lingers in the styles.
export const elementMotion = (element) => {
  const x = motionValue(0);
  const y = motionValue(0);
  const o = motionValue(1);
  const render = () => {
    const tx = x.get();
    const ty = y.get();
    const op = o.get();
    element.style.transform = Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05 ? '' : `translate3d(${tx}px, ${ty}px, 0)`;
    element.style.opacity = op > 0.999 ? '' : String(Math.max(0, op));
  };
  const schedule = () => frame.render(render);
  const off = [x.on('change', schedule), y.on('change', schedule), o.on('change', schedule)];
  return {
    element,
    x,
    y,
    o,
    // Writes the values now, before the browser paints (after a jump in a layout effect).
    render,
    stop() {
      x.stop();
      y.stop();
      o.stop();
    },
    destroy() {
      off.forEach((unsubscribe) => unsubscribe());
      x.destroy();
      y.destroy();
      o.destroy();
      element.style.transform = '';
      element.style.opacity = '';
    },
  };
};

// One number written to a style property each frame (a height, an opacity).
export const styleMotion = (element, property, initial, unit = '') => {
  const mv = motionValue(initial);
  const render = () => {
    element.style[property] = `${mv.get()}${unit}`;
  };
  const off = mv.on('change', () => frame.render(render));
  render();
  return {
    mv,
    render,
    stop: () => mv.stop(),
    destroy(clear = true) {
      off();
      mv.destroy();
      if (clear) element.style[property] = '';
    },
  };
};

// The visible part of a flying sheet: four insets from its own box, each its own spring (2D
// motion split per axis, as it should be), drawn as one clip-path. Paint only — no layout.
export const clipMotion = (element, insets, radius) => {
  const sides = ['top', 'right', 'bottom', 'left'];
  const values = Object.fromEntries(sides.map((side) => [side, motionValue(insets[side])]));
  const render = () => {
    const [t, r, b, l] = sides.map((side) => Math.max(0, values[side].get()).toFixed(2));
    element.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${radius}px)`;
  };
  const offs = sides.map((side) => values[side].on('change', () => frame.render(render)));
  render();
  return {
    values,
    render,
    // Springs every side to `target`, from where it is now and as fast as it is moving.
    to(target, options = {}) {
      return settled(sides.map((side) => springTo(values[side], target[side], options)));
    },
    jump(target) {
      sides.forEach((side) => values[side].jump(target[side]));
      render();
    },
    stop() {
      sides.forEach((side) => values[side].stop());
    },
    destroy() {
      offs.forEach((unsubscribe) => unsubscribe());
      sides.forEach((side) => values[side].destroy());
    },
  };
};

// A flying sheet's box: where it is (x, y: a transform on `wrap`, the compositor's) and how big
// (w, h: a clip-path on `sheet`, paint only), four springs each from where it is and as fast as it
// is going. `size` is the wrap's own box, the largest the sheet will be.
export const boxMotion = (wrap, sheet, box, size, radius) => {
  const keys = ['x', 'y', 'w', 'h'];
  const values = Object.fromEntries(keys.map((key) => [key, motionValue(box[key])]));
  const render = () => {
    const x = values.x.get();
    const y = values.y.get();
    const right = Math.max(0, size.w - values.w.get());
    const bottom = Math.max(0, size.h - values.h.get());
    wrap.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    sheet.style.clipPath = `inset(0px ${right.toFixed(2)}px ${bottom.toFixed(2)}px 0px round ${radius}px)`;
  };
  const offs = keys.map((key) => values[key].on('change', () => frame.render(render)));
  render();
  return {
    values,
    render,
    to(target, options = {}) {
      return settled(keys.map((key) => springTo(values[key], target[key], options)));
    },
    stop() {
      keys.forEach((key) => values[key].stop());
    },
    destroy() {
      offs.forEach((unsubscribe) => unsubscribe());
      keys.forEach((key) => values[key].destroy());
    },
  };
};

