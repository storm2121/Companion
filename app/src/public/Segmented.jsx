import { useId, useLayoutEffect, useRef } from 'react';
import { springs } from './springLoader';
import { useReducedMotion } from './useReducedMotion';

// A segmented control: native radios (arrow keys, a screen reader's own announcements), drawn as
// a row of words with one raised pill behind the chosen one. The pill moves with a spring from
// wherever it is, so changing your mind mid-move bends it instead of jumping; it is cut out of a
// full-width layer by a clip-path (paint only), and casts its shadow through a filter on that
// layer so the shadow follows the cut. Before the springs arrive, or with reduced motion, it is
// simply placed.
//
//   options  [{ id, label, title? }]   label may be a node ("Before<span> Sage</span>")
//   tone     'light' (on a white surface) | 'glass' (on a material over a picture)
const Segmented = ({ name, label, options, value, onChange, tone = 'light', className = '' }) => {
  const uid = useId();
  const rootRef = useRef(null);
  const pillRef = useRef(null);
  const motionRef = useRef(null);
  const lastRef = useRef(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const root = rootRef.current;
    const pill = pillRef.current;
    if (!root || !pill) return undefined;
    const place = (animate) => {
      const active = root.querySelector('[data-on="true"]');
      if (!active) return;
      // Offsets, not client rects: a pressed option (scaled) or a moving ancestor never skews it.
      const insets = {
        top: active.offsetTop,
        right: root.clientWidth - active.offsetLeft - active.offsetWidth,
        bottom: root.clientHeight - active.offsetTop - active.offsetHeight,
        left: active.offsetLeft,
      };
      const S = springs();
      // The springs may arrive after the first placing: they start from where the pill was.
      if (S && !motionRef.current) motionRef.current = S.clipMotion(pill, lastRef.current ?? insets, 999);
      if (motionRef.current && animate && !reduce) motionRef.current.to(insets, { duration: 0.34 });
      else if (motionRef.current) motionRef.current.jump(insets);
      else pill.style.clipPath = `inset(${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px round 999px)`;
      lastRef.current = insets;
    };
    place(root.dataset.placed === 'true');
    root.dataset.placed = 'true';
    // A change of size (a font arriving, a wrap) re-places the pill where it belongs.
    const observer = new ResizeObserver(() => place(false));
    observer.observe(root);
    return () => observer.disconnect();
  }, [value, reduce]);

  useLayoutEffect(
    () => () => {
      motionRef.current?.destroy();
      motionRef.current = null;
    },
    [],
  );

  return (
    <div ref={rootRef} className={`pub-seg pub-seg--${tone} ${className}`} role="radiogroup" aria-label={label}>
      <span className="pub-seg-shadow" aria-hidden="true">
        <span className="pub-seg-pill" ref={pillRef} />
      </span>
      {options.map((option) => (
        <label key={option.id} className="pub-seg-option" data-on={option.id === value} title={option.title}>
          <input
            type="radio"
            name={`${name}-${uid}`}
            value={option.id}
            checked={option.id === value}
            onChange={() => onChange(option.id)}
          />
          <span className="pub-seg-label">{option.label}</span>
        </label>
      ))}
    </div>
  );
};

export default Segmented;
