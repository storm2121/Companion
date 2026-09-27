import { staggerStyle } from '../roomPrefs';

// A sheet of paper on the desk. Every card in the room is one.
//
// The tilt is a STATIC rotation passed through the --room-paper-tilt custom property
// rather than written into the style transform directly, so the `handDrawn: off`
// preference can flatten every sheet at once by setting --room-tilt to 0 in CSS —
// no component here has to know the preference exists.
//
// `interactive` renders a <button> and adds the hover behaviour the design specifies:
// it lifts 5px AND straightens to 0°. It never scales.

// `ref` is forwarded because the note editor's connectors measure against the paper's
// right edge. React 19 passes ref as an ordinary prop, so no forwardRef is needed.
const Paper = ({
  ref,
  tilt = 0,
  interactive = false,
  flat = false,
  stagger,
  className = '',
  style,
  children,
  ...rest
}) => {
  const classes = [
    'room-paper',
    interactive && 'room-paper--interactive',
    flat && 'room-paper--flat',
    Number.isFinite(stagger) && 'room-rise',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const merged = {
    '--room-paper-tilt': `${tilt}deg`,
    ...(Number.isFinite(stagger) ? staggerStyle(stagger) : null),
    ...style,
  };

  if (interactive) {
    return (
      <button type="button" ref={ref} className={classes} style={merged} {...rest}>
        {children}
      </button>
    );
  }

  return (
    <div ref={ref} className={classes} style={merged} {...rest}>
      {children}
    </div>
  );
};

export default Paper;
