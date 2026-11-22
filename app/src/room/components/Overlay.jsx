import { useEffect, useRef } from 'react';
import Paper from './Paper';

// Design 6 has no modals anywhere in its six screens, but full parity needs a surface
// for create-course, edit profile, link, template pick and Sage. The agreed answer
// (dualmode.md §4.2): an overlay is ANOTHER SHEET OF PAPER set down on the desk.
//
// No black scrim — the vignette deepens. No title bar, no X button. Esc or a click on
// the ground dismisses it. Destructive confirms do not use this at all; they delete and
// offer undo instead.

/* ── Keyboard focus ───────────────────────────────────────────────────────────
   A sheet says it is a dialog and the ··· card says it is a menu, and both roles promise
   things about focus: it moves in when they open, it stays in while they are open, and it
   goes back to where it was when they close. Without that a sheet opened over a page that
   Tab still walked through behind it.                                               */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
// Something to type into or choose from. A sheet with none (a confirm) takes focus itself:
// landing on its first button would put Enter on "Clear" before the question was read.
const FIELD =
  'input:not([disabled]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea:not([disabled]), select:not([disabled])';

const shown = (el) => el.getClientRects().length > 0;
const stopsIn = (node) => [...(node?.querySelectorAll(FOCUSABLE) || [])].filter(shown);

// What had focus before a sheet or a menu took it. Followed as focus moves, because by the
// time a sheet's effect runs, its own autoFocus field already has focus and the menu row
// that opened it is gone.
let lastOutside = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    if (!event.target?.closest?.('.room-overlay, .room-menu')) lastOutside = event.target;
  });
}

// Only when nothing else has taken focus: closing by going somewhere else keeps that.
const giveFocusBack = (el) => {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (el?.isConnected) el.focus({ preventScroll: true });
};

// `label` names the sheet for assistive tech when it has no visible title.
export const Overlay = ({ open, onClose, title, label, children }) => {
  const groundRef = useRef(null);
  // Callers pass a new `onClose` each render; the effect below must run once per opening.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const ground = groundRef.current;
    const sheet = ground?.querySelector('.room-overlay-sheet');
    const active = document.activeElement;
    const opener = sheet?.contains(active) ? lastOutside : active;
    // A sheet that focused a field of its own keeps it; any other gets its first field.
    if (sheet && !sheet.contains(active)) {
      ([...sheet.querySelectorAll(FIELD)].find(shown) || sheet).focus({ preventScroll: true });
    }

    const onKey = (event) => {
      // Only the sheet on top answers: search can open over another sheet.
      const sheets = document.querySelectorAll('.room-overlay');
      if (sheets[sheets.length - 1] !== ground) return;
      if (event.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !sheet) return;
      const stops = stopsIn(sheet);
      const at = document.activeElement;
      const first = stops[0];
      const last = stops[stops.length - 1];
      let next = null;
      if (!stops.length) next = sheet;
      else if (!sheet.contains(at) || at === sheet) next = event.shiftKey ? last : first;
      else if (event.shiftKey && at === first) next = last;
      else if (!event.shiftKey && at === last) next = first;
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      giveFocusBack(opener);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={groundRef}
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
        tabIndex={-1}
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
//
// Focus goes to the first row when it opens; ↑ ↓ Home End move between rows; Tab and Esc
// close it; and focus returns to the button that opened it.
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

  useEffect(() => {
    const card = cardRef.current;
    const trigger = card?.parentElement?.querySelector('[data-menu-trigger]') || document.activeElement;
    // A sheet opened from one of these rows returns to the trigger too: the row will be gone.
    lastOutside = trigger;
    card?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => giveFocusBack(trigger);
  }, []);

  const onKeyDown = (event) => {
    const rows = [...(cardRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % rows.length;
    else if (event.key === 'ArrowUp') next = at <= 0 ? rows.length - 1 : at - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'Tab') {
      // Leaving the menu closes it; focus goes back to its button, as with Esc.
      event.preventDefault();
      onClose?.();
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    rows[next].focus();
  };

  return (
    <Paper ref={cardRef} className="room-menu" style={style} role="menu" onKeyDown={onKeyDown}>
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
