import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Paper from './Paper';
import { IMAGE_ACCEPT } from '../../utils/imageUpload';
import { aspectOf } from '../imageScale';
import { tiltForKey } from '../roomPrefs';
import { imageTilt } from '../pageImages';
import { TiltIcon } from './primitives';
import { createBoardMotion } from '../boardMotion';
import {
  BOARD_TAIL,
  PIN_GAP,
  nudgeOverrides,
  pinHeight,
  pinRatio,
  resizeWidth,
  resolveRail,
  settleRail,
} from '../railLayout';

// The right rail — design 6c, reworked after real use.
//
// On the dark ground beside the paper: a short outline, then a BOARD you hang photos on.
// Photos are not tied to sections; each hangs at a height you choose. Drag to move, pull
// the corner to resize (the shape is locked), and photos never overlap.
//
// Three rules keep it fast and calm, and all three are load-bearing:
//
//   1. Layout is PURE (railLayout.js). Heights are derived from width and aspect ratio,
//      never measured — no ResizeObserver, no rect read on a timer. That loop was the freeze.
//   2. Motion is a critically damped spring (boardMotion.js) writing transforms straight
//      onto the DOM. React never renders a position, so a drag never re-renders the editor.
//   3. React hears about a change once — when the pointer lifts — as merge-patches.

const DRAG_THRESHOLD = 4;

// A pointer that has been still this long before letting go has no speed to hand on —
// the last measured speed is stale, and keeping it would fling the photo on release.
const STALE_THROW_MS = 80;

// How close to the top or bottom of the window a drag has to come before the page scrolls
// with it, and how fast it scrolls at the very edge (px/s).
const EDGE = 72;
const EDGE_SPEED = 900;

// The outline is exactly this many rows tall, always. It scrolls inside itself beyond
// that, and — because its height never changes — adding a section never shifts the board
// (and every photo on it) further down.
const OUTLINE_ROWS = 4;

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

const isStill = () =>
  document.documentElement.getAttribute('data-motion') === 'still' || Boolean(reducedMotion?.matches);

// Module-level on purpose: they close over nothing from a render, so the layout effect
// below depends only on what it really depends on.
const engineFor = (ref) => {
  if (!ref.current) {
    ref.current = createBoardMotion({
      write: (item) => {
        item.node.style.transform = `translate3d(0, ${item.y}px, 0)`;
      },
      isStill,
    });
  }
  return ref.current;
};

const setBoardHeight = (ref, height) => {
  if (ref.current) ref.current.style.height = height ? `${height}px` : '';
};

// A board photo's tilt: the one you gave it, else the slight one its id always gets.
const tiltOf = (pin) => (Number.isFinite(pin?.tilt) ? pin.tilt : tiltForKey(pin?.id));

const PinRail = ({
  sections,
  currentSection,
  pins,
  online,
  uploading,
  onJumpToSection,
  onChangePins,
  onRemovePin,
  onAddFiles,
}) => {
  const boardRef = useRef(null);
  const outlineRef = useRef(null);
  const fileRef = useRef(null);
  const nodes = useRef(new Map());
  const gesture = useRef(null);
  const motionRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const layout = useMemo(() => resolveRail(pins), [pins]);

  // The engine is created on first use, never during render.
  const motion = () => engineFor(motionRef);

  // Every photo aimed at its slot whenever the layout changes. Before paint, so a photo
  // never flashes at the top of the board on its first frame.
  useLayoutEffect(() => {
    const engine = engineFor(motionRef);
    const present = new Set();
    pins.forEach((pin) => {
      const node = nodes.current.get(pin.id);
      const slot = layout.slots[pin.id];
      if (!node || !slot) return;
      present.add(pin.id);
      engine.aim(pin.id, node, slot.top);
    });
    engine.items.forEach((_, id) => {
      if (!present.has(id)) engine.forget(id);
    });
    engine.kick();
    if (!gesture.current) setBoardHeight(boardRef, pins.length ? layout.height : 0);
  }, [layout, pins]);

  useEffect(() => () => motionRef.current?.stop(), []);

  // Keep the section you are reading visible inside the short outline.
  useEffect(() => {
    const box = outlineRef.current;
    if (!box || !currentSection) return;
    const item = box.querySelector(`[data-section="${CSS.escape(currentSection)}"]`);
    if (!item) return;
    const top = item.offsetTop;
    if (top >= box.scrollTop && top + item.offsetHeight <= box.scrollTop + box.clientHeight) return;
    box.scrollTo({
      top: top - (box.clientHeight - item.offsetHeight) / 2,
      behavior: isStill() ? 'auto' : 'smooth',
    });
  }, [currentSection]);

  /* ── Gestures ───────────────────────────────────────────────────────────── */

  // Where the photo under the pointer is, from where the pointer is AND how far the page
  // has scrolled since the drag began — the board scrolls with the page, so an auto-scroll
  // has to move the photo even when the pointer does not.
  //
  // `time` is the event's own timestamp (or the frame clock during an auto-scroll): more
  // accurate than reading the clock here, since it is when the pointer actually moved.
  const trackMove = (g, time) => {
    const raw = Math.min(
      g.maxTop,
      Math.max(0, Math.round(g.startTop + (g.clientY - g.startClientY) + (window.scrollY - g.startScrollY))),
    );
    const now = time;
    const dt = Math.max(1, now - g.lastTime) / 1000;
    // Smoothed, so one jittery pointer event cannot fling a photo on release.
    g.velocity = 0.7 * ((raw - g.lastY) / dt) + 0.3 * g.velocity;
    g.lastY = raw;
    g.lastTime = now;
    g.value = raw;

    const engine = motion();
    engine.hold(g.id, raw, g.velocity);
    const preview = resolveRail(pins, { [g.id]: { y: raw } });
    pins.forEach((pin) => {
      if (pin.id === g.id) return;
      const node = nodes.current.get(pin.id);
      if (node) engine.aim(pin.id, node, preview.slots[pin.id].top);
    });
    engine.kick();
    setBoardHeight(boardRef, Math.max(preview.height, raw + preview.slots[g.id].h + BOARD_TAIL));
  };

  // Runs every frame while a photo is lifted: scrolls the page when the pointer rests near
  // the top or bottom edge, faster the closer it gets.
  const edgeScroll = (dt) => {
    const g = gesture.current;
    if (!g || g.kind !== 'move' || !g.moved) return;
    let speed = 0;
    if (g.clientY < EDGE) speed = -EDGE_SPEED * (1 - g.clientY / EDGE);
    else if (g.clientY > window.innerHeight - EDGE) {
      speed = EDGE_SPEED * (1 - (window.innerHeight - g.clientY) / EDGE);
    }
    if (!speed) return;
    // Stop at the ends: the top of the page, and the photo's lowest allowed spot.
    if (speed < 0 && window.scrollY <= 0) return;
    if (speed > 0 && g.value >= g.maxTop) return;
    window.scrollBy(0, speed * dt);
    trackMove(g, g.lastTime + dt * 1000);
  };

  const begin = (event, pin, kind) => {
    if (event.button !== 0) return;
    const node = nodes.current.get(pin.id);
    const slot = layout.slots[pin.id];
    if (!node || !slot) return;
    node.setPointerCapture(event.pointerId);
    // Start from where the photo IS, which may be mid-glide, not where it is heading.
    const at = motion().items.get(pin.id)?.y ?? slot.top;
    // How low it may go: to the end of the page as it stands now. Measured once, here —
    // a gesture-start read, not a loop. Without a floor, the board growing under a photo
    // resting on the bottom edge made the page longer, which kept it scrolling, forever.
    const boardTop = (boardRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    const pageFloor = document.documentElement.scrollHeight - boardTop - slot.h - PIN_GAP;
    gesture.current = {
      kind,
      id: pin.id,
      node,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollY: window.scrollY,
      startTop: at,
      maxTop: Math.max(at, layout.end, pageFloor),
      fromW: slot.w,
      ratio: pinRatio(pin),
      lastY: at,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
      value: null,
    };
    // A resize lifts at once; a move waits for the threshold, so a plain click on a photo
    // never shifts it.
    if (kind === 'resize') node.classList.add('is-lifted');
  };

  const move = (event) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    g.clientX = event.clientX;
    g.clientY = event.clientY;

    if (g.kind === 'move') {
      if (!g.moved) {
        const dx = g.clientX - g.startClientX;
        const dy = g.clientY - g.startClientY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        g.moved = true;
        g.node.classList.add('is-lifted');
        motion().during(edgeScroll);
      }
      trackMove(g, event.timeStamp);
      return;
    }

    const w = resizeWidth(g.fromW, g.ratio, g.clientX - g.startClientX, g.clientY - g.startClientY);
    if (w === g.value) return;
    g.moved = true;
    g.value = w;
    const pin = pins.find((item) => item.id === g.id);
    g.node.style.width = `${w}px`;
    g.node.style.height = `${pinHeight({ ...pin, w }, w)}px`;
    const preview = resolveRail(pins, { [g.id]: { w } });
    const engine = motion();
    pins.forEach((item) => {
      if (item.id === g.id) return;
      const node = nodes.current.get(item.id);
      if (node) engine.aim(item.id, node, preview.slots[item.id].top);
    });
    engine.kick();
    setBoardHeight(boardRef, preview.height);
  };

  const release = (g, pointerId) => {
    gesture.current = null;
    motion().during(null);
    g.node.classList.remove('is-lifted');
    if (g.node.hasPointerCapture?.(pointerId)) g.node.releasePointerCapture(pointerId);
  };

  // Settle, then tell React once, as patches. The engine is already gliding everything
  // to the same slots React is about to confirm, so nothing jumps.
  const commit = (overrides) => {
    const patches = settleRail(pins, overrides);
    if (patches.length) onChangePins?.(patches);
  };

  const end = (event) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    release(g, event.pointerId);
    if (!g.moved || g.value == null) return;
    const overrides = g.kind === 'move' ? { [g.id]: { y: g.value } } : { [g.id]: { w: g.value } };
    const final = resolveRail(pins, overrides);
    const engine = motion();
    // The photo in hand glides into its slot, keeping the speed it was moving at — unless
    // the hand had already stopped.
    if (g.kind === 'move') {
      if (event.timeStamp - g.lastTime > STALE_THROW_MS) engine.hold(g.id, g.value, 0);
      engine.release(g.id, final.slots[g.id].top);
    }
    pins.forEach((pin) => {
      if (pin.id === g.id && g.kind === 'move') return;
      const node = nodes.current.get(pin.id);
      if (node) engine.aim(pin.id, node, final.slots[pin.id].top);
    });
    engine.kick();
    setBoardHeight(boardRef, final.height);
    commit(overrides);
  };

  // Lost the pointer without a pointerup (the tab lost focus, the node went away): glide
  // everything back to where it was.
  const cancel = (event) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    release(g, event.pointerId);
    const engine = motion();
    if (g.kind === 'move') engine.release(g.id, layout.slots[g.id]?.top ?? 0);
    const slot = layout.slots[g.id];
    if (g.kind === 'resize' && slot) {
      g.node.style.width = `${slot.w}px`;
      g.node.style.height = `${slot.h}px`;
    }
    pins.forEach((pin) => {
      const node = nodes.current.get(pin.id);
      if (node && pin.id !== g.id) engine.aim(pin.id, node, layout.slots[pin.id].top);
    });
    engine.kick();
    setBoardHeight(boardRef, layout.height);
  };

  const keyboard = (pin) => (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      commit(nudgeOverrides(pins, pin.id, event.key === 'ArrowUp' ? -1 : 1));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemovePin?.(pin);
    }
  };

  // Photos from older notes arrive without a known shape. The first load teaches the
  // board their real proportions; after that the guard makes this a no-op.
  const learnShape = (pin) => (event) => {
    if (Number(pin.ar) > 0) return;
    const ar = aspectOf(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
    if (ar) commit({ [pin.id]: { ar } });
  };

  const dropAt = (event) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    const box = boardRef.current?.getBoundingClientRect();
    onAddFiles?.(files, box ? Math.max(0, Math.round(event.clientY - box.top)) : undefined);
  };

  return (
    <aside
      className={`room-rail room-rise${dragOver ? ' is-drop' : ''}`}
      style={{ animationDelay: '0.14s' }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
      }}
      onDrop={dropAt}
    >
      {sections.length > 0 && (
        <div className="room-outline-wrap">
          <div className="room-outline-head">
            <span className="room-stamp">On this page</span>
            {sections.length > OUTLINE_ROWS && (
              <span className="room-stamp">{sections.length} sections</span>
            )}
          </div>
          <nav
            ref={outlineRef}
            className="room-outline"
            style={{ '--outline-rows': OUTLINE_ROWS }}
            aria-label="On this page"
          >
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                data-section={section.id}
                className={`room-outline-item${section.id === currentSection ? ' is-current' : ''}`}
                aria-current={section.id === currentSection ? 'location' : undefined}
                onClick={() => onJumpToSection?.(section.id)}
                title={section.title}
              >
                <span className="room-outline-num">§{section.index}</span>
                {section.title}
              </button>
            ))}
          </nav>
        </div>
      )}

      <div ref={boardRef} className={`room-board${pins.length ? '' : ' is-empty'}`}>
        {!pins.length && (
          <p className="room-board-empty">
            {uploading
              ? 'Adding it…'
              : online
                ? 'Drop a photo here to hang it beside the page.'
                : 'Photos can be added once you are back online.'}
          </p>
        )}

        {pins.map((pin) => {
          const slot = layout.slots[pin.id];
          return (
            <div
              key={pin.id}
              ref={(node) => {
                if (node) nodes.current.set(pin.id, node);
                else nodes.current.delete(pin.id);
              }}
              className="room-hang"
              tabIndex={0}
              role="group"
              aria-label="Photo. Drag to move it, arrow keys to nudge it, Delete to take it down."
              style={{ width: slot.w, height: slot.h }}
              onPointerDown={(event) => {
                if (event.target.closest('button, [data-grip]')) return;
                begin(event, pin, 'move');
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onKeyDown={keyboard(pin)}
            >
              <Paper className="room-hang-card" tilt={tiltOf(pin)}>
                {pin.value && (
                  // Lazy: a photo far down the board is not fetched until you scroll near
                  // it. Safe now that layout never waits on an image to know its size.
                  <img
                    src={pin.value}
                    alt={pin.alt || ''}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onLoad={learnShape(pin)}
                  />
                )}
              </Paper>

              <button
                type="button"
                className="room-hang-x"
                onClick={() => onRemovePin?.(pin)}
                aria-label="Take this photo down"
              >
                ×
              </button>

              {/* Tilt it like a print pinned to the board. Its own tilt until you set one. */}
              <span className="room-hang-tilt">
                <button
                  type="button"
                  className="room-hang-btn"
                  onClick={() => onChangePins?.([{ id: pin.id, tilt: imageTilt(tiltOf(pin) - 1.5) }])}
                  aria-label="Tilt this photo left"
                  title="Tilt left"
                >
                  <TiltIcon />
                </button>
                <button
                  type="button"
                  className="room-hang-btn"
                  onClick={() => onChangePins?.([{ id: pin.id, tilt: imageTilt(tiltOf(pin) + 1.5) }])}
                  aria-label="Tilt this photo right"
                  title="Tilt right"
                >
                  <TiltIcon flip />
                </button>
              </span>

              <span
                className="room-hang-grip"
                data-grip=""
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  begin(event, pin, 'resize');
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" focusable="false">
                  <path
                    d="M2.5 10.5 L10.5 2.5 M6.5 10.5 L10.5 6.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>
            </div>
          );
        })}
      </div>

      <div className="room-board-foot">
        {uploading && pins.length > 0 && <span className="room-stamp">Adding it…</span>}
        {online ? (
          <button
            type="button"
            className="room-board-add"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            + Add a photo
          </button>
        ) : (
          pins.length > 0 && <span className="room-stamp">Offline · photos need a connection</span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            if (files.length) onAddFiles?.(files);
          }}
        />
      </div>
    </aside>
  );
};

export default PinRail;
