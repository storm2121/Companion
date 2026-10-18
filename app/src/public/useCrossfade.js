import { useEffect, useRef } from 'react';
import { springs } from './springLoader';

// A crossfade between two pictures of the same place (the room by day and by night): one number
// from 0 to 1, handed to `apply` on every frame it changes. It moves with a spring from wherever
// it is — a second change of mind mid-fade bends it — or, with reduced motion, as a short
// cross-fade; before the springs have arrived it is simply set. `ready` holds it until the
// picture it is going to has loaded.
export const useCrossfade = ({ value, ready = true, apply, reduce, duration = 0.9 }) => {
  const state = useRef({ mv: null, now: value, off: null });

  useEffect(() => {
    if (!ready) return;
    const S = springs();
    const held = state.current;
    if (!S) {
      held.now = value;
      apply(value);
      return;
    }
    if (!held.mv) {
      held.mv = S.value(held.now);
      held.off = held.mv.on('change', (next) => {
        held.now = next;
        apply(next);
      });
    }
    if (reduce) S.tweenTo(held.mv, value, 0.2);
    else S.springTo(held.mv, value, { duration });
  }, [value, ready, reduce, apply, duration]);

  useEffect(
    () => () => {
      const held = state.current;
      held.off?.();
      held.mv?.destroy();
      held.mv = null;
    },
    [],
  );

  return state;
};
