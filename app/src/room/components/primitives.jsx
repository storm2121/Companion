// The small shapes everything else is assembled from. No icon library: every glyph in
// this design is a text character (+ ← ✓ ↵ ··· ❙❙ →) or a hand-drawn SVG path.
//
// None of these hard-code a radius — they read the --room-r-* tokens, which the
// `handDrawn` preference swaps for square-ish ones in room.css.

export const Pill = ({ variant, className = '', children, ...rest }) => (
  <button
    type="button"
    className={['room-pill', variant && `room-pill--${variant}`, className].filter(Boolean).join(' ')}
    {...rest}
  >
    {children}
  </button>
);

export const Chip = ({ selected = false, className = '', children, ...rest }) => (
  <button
    type="button"
    aria-pressed={selected}
    className={['room-chip', className].filter(Boolean).join(' ')}
    {...rest}
  >
    {children}
  </button>
);

// 40×24, 1.6px border; on = ink fill with a paper-coloured knob.
export const Toggle = ({ on = false, label, onChange, ...rest }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-pressed={on}
    aria-label={label}
    className="room-toggle"
    onClick={() => onChange?.(!on)}
    {...rest}
  />
);

export const Segmented = ({ options = [], value, onChange, className = '' }) => (
  <div className={['room-seg', className].filter(Boolean).join(' ')} role="group">
    {options.map((option) => (
      <Chip key={option.id} selected={option.id === value} onClick={() => onChange?.(option.id)}>
        {option.label}
      </Chip>
    ))}
  </div>
);

export const Dot = ({ color, size = 7, style, ...rest }) => (
  <span
    className="room-dot"
    style={{ width: size, height: size, ...(color ? { background: color } : null), ...style }}
    {...rest}
  />
);

// A single hand-wobbled path — never a border-bottom. That is the whole point: a
// straight 1px line reads as software, this reads as pencil.
export const PencilRule = ({ width = '100%', opacity = 1, className = '' }) => (
  <div className={['room-rule', className].filter(Boolean).join(' ')} style={{ width, opacity }}>
    <svg
      className="room-rule-svg"
      width="100%"
      height="8"
      viewBox="0 0 400 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 4 C 70 2, 130 6.5, 200 4 S 330 1.5, 399 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  </div>
);

// A small curved arrow: tilt left; `flip` for tilt right. Photos on the page and on the board.
export const TiltIcon = ({ flip = false }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    focusable="false"
    aria-hidden="true"
    style={flip ? { transform: 'scaleX(-1)' } : undefined}
  >
    <path d="M3.2 5.2 A4.6 4.6 0 1 1 3.4 9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    <path
      d="M1.6 2.8 L3.2 5.4 L5.9 4.2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);
