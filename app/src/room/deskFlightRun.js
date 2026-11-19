import { useEffect, useLayoutEffect, useRef } from 'react';
import { smoothDamp } from './boardMotion';
import {
  FLIGHT_SMOOTH,
  boxOfRect,
  flightBox,
  flightProgress,
  flightSize,
  flightStyle,
  rememberReturn,
  takePick,
  takeReturn,
} from './deskFlight';

// "Open the book" (prototype Home): the cloth of the book you picked flies from where the book
// stood on the desk to the course page's title, and back home when you leave. One sheet in the
// room's flight layer (DeskFlightLayer, hosted by RoomLayout), moved by a transform and sized
// by a clip from its corner — nothing is scaled, so nothing is stretched; four critically
// damped springs (x, y, w, h: the room's smoothDamp) from where it is, so a new flight bends
// the old one instead of restarting. On arrival the real thing shows and the cloth fades.
// Still or reduced motion: no flight at all, everything simply is where it belongs.
//
// The harness can freeze a flight part way (globalThis.__deskFlightFreeze = 0..1) to draw it.

const CLOTH = new URL('./assets/desk/cloth.webp', import.meta.url).href;
const KEYS = ['x', 'y', 'w', 'h'];
const REST = 0.3;
const FADE_MS = 200;

let current = null;

const quiet = () =>
  document.documentElement.getAttribute('data-motion') === 'still' ||
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// The box an element's text takes (a title is as wide as its words, not its column).
const textBox = (element) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  return rect.width && rect.height ? boxOfRect(rect) : boxOfRect(element.getBoundingClientRect());
};

export const flyCover = ({ from, to, look = {}, onArrive }) => {
  current?.stop();
  const host = document.querySelector('[data-desk-flight]');
  const freeze = globalThis.__deskFlightFreeze;
  const frozen = typeof freeze === 'number';
  if (!host || !from || !to || (!frozen && quiet())) {
    onArrive?.();
    return;
  }
  const size = flightSize(from, to);
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: `${size.w}px`,
    height: `${size.h}px`,
    willChange: 'transform',
    transition: `opacity ${FADE_MS}ms ease`,
  });
  const sheet = document.createElement('div');
  Object.assign(sheet.style, {
    position: 'absolute',
    inset: '0',
    backgroundColor: look.cover || '#4a3a2e',
    backgroundImage: `url("${CLOTH}")`,
    backgroundPosition: look.clothAt || '0 0',
    backgroundSize: '256px 256px',
    backgroundBlendMode: 'multiply',
    boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.18)',
  });
  // The cover's words at their own size, from its corner: they go as the cloth opens toward a
  // title, and come back as it closes onto its book (`look.home`).
  const cover = look.home ? to : from;
  const words = document.createElement('div');
  words.textContent = look.title || '';
  Object.assign(words.style, {
    position: 'absolute',
    left: `${Math.round(cover.w * 0.13)}px`,
    top: `${Math.round(cover.h * 0.06)}px`,
    width: `${Math.round(cover.w * 0.78)}px`,
    color: look.ink || '#f4ecdd',
    font: `600 ${Math.max(12, Math.round(cover.w * 0.13))}px/1.05 var(--room-display, sans-serif)`,
    letterSpacing: '-0.015em',
  });
  sheet.append(words);
  wrap.append(sheet);
  host.append(wrap);

  const now = frozen ? flightBox(from, to, freeze) : { ...from };
  const speed = { x: 0, y: 0, w: 0, h: 0 };
  const render = () => {
    const style = flightStyle(now, size);
    wrap.style.transform = style.transform;
    sheet.style.clipPath = style.clipPath;
    const along = flightProgress(from, to, now);
    words.style.opacity = String(Math.max(0, look.home ? along * 1.8 - 0.8 : 1 - along * 1.8));
  };
  render();

  let raf = 0;
  let last = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (raf) cancelAnimationFrame(raf);
    onArrive?.();
    wrap.style.opacity = '0';
    setTimeout(() => wrap.remove(), FADE_MS + 40);
    if (current?.wrap === wrap) current = null;
  };
  const tick = (time) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
    last = time;
    let moving = false;
    KEYS.forEach((key) => {
      const next = smoothDamp(now[key], to[key], speed[key], FLIGHT_SMOOTH, dt);
      now[key] = next.value;
      speed[key] = next.velocity;
      if (Math.abs(now[key] - to[key]) > REST || Math.abs(speed[key]) > REST) moving = true;
    });
    if (!moving) KEYS.forEach((key) => (now[key] = to[key]));
    render();
    if (moving) raf = requestAnimationFrame(tick);
    else finish();
  };
  // Frozen (a render): it stays where it is, the title still waiting under it.
  if (!frozen) raf = requestAnimationFrame(tick);
  current = {
    wrap,
    // A new flight takes over: this one simply goes, the real thing showing at once.
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!done) {
        done = true;
        onArrive?.();
      }
      wrap.remove();
    },
  };
};

// The course page: if its course was just picked on the desk, its title waits, hidden, while
// the book's cloth flies to it; leaving, it leaves its title's place for the way home.
export const useCourseFlight = (courseId, titleRef) => {
  useLayoutEffect(() => {
    const title = titleRef.current;
    const pick = takePick(courseId);
    if (pick && title) {
      title.style.visibility = 'hidden';
      flyCover({
        from: boxOfRect(pick.rect),
        to: textBox(title),
        look: pick.look || {},
        onArrive: () => {
          title.style.visibility = '';
        },
      });
    }
    return () => {
      if (title?.isConnected) rememberReturn(textBox(title), courseId);
    };
  }, [courseId, titleRef]);
};

// The desk: coming back from a course, the cloth flies home to its book, which waits hidden.
// `lookOf(courseId)` gives the cloth.
export const useDeskReturn = (lookOf) => {
  const lookRef = useRef(lookOf);
  useEffect(() => {
    lookRef.current = lookOf;
  });
  // Only on arriving at the desk.
  useLayoutEffect(() => {
    const home = takeReturn();
    if (!home) return;
    const book = document.querySelector(`[data-course-id="${CSS.escape(home.courseId)}"]`);
    if (!book) return;
    const holder = book.closest('.room-stage-slab') || book;
    // On the stage the cloth lands on the book's spine (its words' box), not its whole picture.
    const target = holder.querySelector('.room-stage-spine') || book;
    holder.style.visibility = 'hidden';
    flyCover({
      from: boxOfRect(home.rect),
      to: boxOfRect(target.getBoundingClientRect()),
      look: { ...lookRef.current?.(home.courseId), home: true },
      onArrive: () => {
        holder.style.visibility = '';
      },
    });
  }, []);
};
