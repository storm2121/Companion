import { useEffect, useRef } from 'react';
import Paper from './Paper';

// Design 6 has no modals anywhere in its six screens, but full parity needs a surface
// for create-course, edit profile, link, template pick and Sage. The agreed answer
// (dualmode.md §4.2): an overlay is ANOTHER SHEET OF PAPER set down on the desk.
//
// No black scrim — the vignette deepens. No title bar, no X button. Esc or a click on
// the ground dismisses it. Destructive confirms do not use this at all; they delete and
// offer undo instead.

// `label` names the sheet for assistive tech when it has no visible title.
export const Overlay = ({ open, onClose, title, label, children }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="room-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <Paper
        className="room-overlay-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title || label}
      >
        {title && <h2 className="room-overlay-title">{title}</h2>}
        {children}
      </Paper>
    </div>
  );
};

// The ··· menu: a small anchored paper card. Plain text rows, no icons, hairline
// dividers. Same paper, no tilt.
//
// Closes on Esc and on any press outside it. The button that opens it carries
// `data-menu-trigger`, and presses on that are ignored here — otherwise pressing it to
// close the menu would close it on pointerdown and reopen it on click.
export const MenuCard = ({ items = [], onClose, style }) => {
  const cardRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const onPress = (event) => {
      if (cardRef.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-menu-trigger]')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [onClose]);

  return (
    <Paper ref={cardRef} className="room-menu" style={style} role="menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="room-menu-item"
          onClick={() => {
            item.onSelect?.();
            onClose?.();
          }}
        >
          {item.label}
        </button>
      ))}
    </Paper>
  );
};
