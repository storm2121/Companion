import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import RoomShell from './RoomShell';
import { DataTrouble } from './components/primitives';
import { MenuCard } from './components/Overlay';
import CourseSheet from './components/CourseSheet';
import CourseFiles from './components/CourseFiles';
import { courseMeta } from './calendarDays';
import { noteStamp } from './roomData';
import { resolveMood, resolveRoomPrefs } from './roomPrefs';
import { bookLight } from './deskBook';
import { HELD_WAIT_MS, filmHome, getFilm, subscribeFilm } from './deskFilm';
import { filmPagePainted } from './deskFilmRun';
import { bookOutline, bookTitle, fixCache, fixCss, heldDense, heldFit, nextClass, outlineClip, pageOnWindow } from './deskBookPages';
import { useViewport } from './components/desk/useDeskBreakpoint';
import { plural } from './useCoursePage';
import './book.css';

// The course as the opened book (round eight, run 3; the harness's `?book=1` until the production
// pictures exist). The held picture fills the window (deskBookPages heldFit: the book whole, its words
// clear of the top line) and the course's words are laid on its two pages: each page is ONE flat box
// taken onto the text area's corners (matrix3d), and each line inside it carries a small 2D correction
// so it follows the paper's cup (deskBookPages lineFix: within 1.3 css px of the grid at scale 1).
// What the page DOES is useCoursePage's, the same as today's course page (RoomCourse).
//
// Left page: the name (two lines, then smaller, then the spine's cut), when and where it meets, the next
// class, how many notes, the newest note and its first two lines; at its foot New note, Edit, Files,
// Select (or, selecting, the selection's actions). Right page: every note, a line each (kind, title,
// date), pinned first then newest; it scrolls inside the page, its last line fading at the paper's foot.

// The two type settings offered (the harness's `booktype`): the room's own faces, or a book's.
const FACES = {
  room: { title: "'Bricolage Grotesque', system-ui, sans-serif", titleWeight: 600, text: "'Figtree', system-ui, sans-serif", label: "'Figtree', system-ui, sans-serif" },
  book: { title: "'EB Garamond', Georgia, serif", titleWeight: 600, text: "'EB Garamond', Georgia, serif", label: "'Figtree', system-ui, sans-serif" },
};

// A held picture that is not there (a light state whose file is not read): a page with nothing on it but its
// words' boxes, never a throw.
const EMPTY_PAGE = { quad: [[0, 0], [400, 0], [400, 600], [0, 600]], page: [[0, 0], [400, 0], [400, 600], [0, 600]], grid: [[[0, 0], [400, 0]], [[0, 600], [400, 600]]], flat: true };
const EMPTY_HELD = { frame: [1800, 1080], box: [0, 0, 1800, 1080], src: { x1: '', x2: '' }, pages: { left: EMPTY_PAGE, right: EMPTY_PAGE }, ground: '#1b1510', ink: '#261d16', soft: '#5a4636', action: '#6e2e14' };

// Sizes grow with the page (they are printed on it) but no word is ever under 13 css px.
const sizesAt = (scale, faces) => {
  const garamond = faces.text.includes('Garamond');
  const text = Math.max(garamond ? 15 : 14, (garamond ? 20 : 18.5) * scale);
  return {
    title: Math.max(24, 40 * scale),
    small: Math.max(20, 29 * scale),
    text,
    label: Math.max(13, 14 * scale),
    pitch: Math.round(text * 1.5),
  };
};

let measurer = null;
// Each width measured once (a name's lines are tried at every break and two sizes: 9 ms of a render, run 3 M4).
const measured = new Map();
// Owner fixes 3 (2026-11-23): a width is kept by whether ITS face was in when it was measured. It was kept by
// document.fonts.status, which reads 'loaded' both before the book's faces have been asked for and after they have
// come: a width measured with the fallback face (a book opened in the first moments of a visit, or by its address)
// was then kept for good, and a name that fits on one line stood on two, through the dissolve and after it.
// "In" = one of the family's declared faces of that weight has LOADED (document.fonts lists them). Not
// document.fonts.check(): it answers true while the faces' stylesheet has not arrived yet (nothing declared, so
// nothing to load), which is exactly when the fallback is measured (the dev server injects the stylesheet late).
const facesIn = new Set();
const familyOf = (family) => String(family).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
const faceIn = (family, weight) => {
  const name = familyOf(family);
  const key = `${weight} ${name}`;
  if (facesIn.has(key)) return 1;
  try {
    for (const face of document.fonts) {
      if (face.status !== 'loaded' || familyOf(face.family) !== name) continue;
      const range = String(face.weight || '').split(/\s+/).map(Number).filter(Number.isFinite);
      if (range.length && (weight < Math.min(...range) || weight > Math.max(...range))) continue;
      facesIn.add(key);
      return 1;
    }
  } catch {
    return 0;
  }
  return 0;
};
const measureWith = (family, weight) => (text, size) => {
  if (typeof document === 'undefined') return text.length * size * 0.5;
  const font = `${weight} ${size}px ${family}`;
  const key = `${font} ${faceIn(family, weight)}|${text}`;
  if (measured.has(key)) return measured.get(key);
  measurer = measurer || document.createElement('canvas').getContext('2d');
  measurer.font = font;
  const width = measurer.measureText(text).width;
  if (measured.size > 4000) measured.clear();
  measured.set(key, width);
  return width;
};

// Wrapped into at most `max` lines of `width`, the last one ended with an ellipsis if the text goes on.
const wrapLines = (text, width, measure, max = 2) => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let i = 0;
  for (; i < words.length && lines.length < max; i += 1) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= width || !line) line = next;
    else {
      lines.push(line);
      line = words[i];
    }
  }
  if (line && lines.length < max) lines.push(line);
  else if (line) i -= 1;
  if (i < words.length && lines.length) {
    let last = `${lines[lines.length - 1]}…`;
    while (measure(last) > width && last.length > 2) last = `${last.slice(0, -2).trimEnd()}…`;
    lines[lines.length - 1] = last;
  }
  return lines;
};

// One line on a page: at flat (x, y), `height` tall, its correction over the columns from..to.
// (`span`: inside a row's button, where a div may not stand.)
const Line = ({ fix, x = 0, y, width, height, from = 0, to = 1, className = '', style, span = false, children, ...rest }) => {
  const props = { className: `room-book-line ${className}`, style: { width, height, lineHeight: `${height}px`, transform: fixCss(fix(y, height, from, to), x, y), ...style }, ...rest };
  return span ? <span {...props}>{children}</span> : <div {...props}>{children}</div>;
};

const CourseBook = ({ page, preview = false, book, courseId = null }) => {
  const navigate = useNavigate();
  const { course, own, others, loading, trouble, retry, selected, selectMode, newNote } = page;
  const { setSheetOpen, setFilesOpen, sheetOpen, filesOpen, moveOpen, setMoveOpen, clearSelection, openOrSelect } = page;
  const { holdStart, holdMove, holdEnd, holdMenu, removeSelected, moveSelected, startSelecting } = page;
  const view = useViewport();
  // The light the book is held in: the desk's light state now (the production table registers it), else
  // night or day by the mood (the harness's stand-ins).
  const light = book.stateNow?.() || bookLight(resolveMood(resolveRoomPrefs(page.profile?.roomPrefs).mood));
  const held = book.held(light, course?.color) || EMPTY_HELD;
  // Night or day (book.css's inks round the picture), whatever the light state.
  const look = bookLight(light);
  const faces = FACES[book.type] || FACES.book;
  // With the production pictures the held picture's surround covers the window (no bars).
  const fit = useMemo(() => heldFit(view, held, { extent: held.extent || null }), [view, held]);
  const left = useMemo(() => pageOnWindow(held.pages.left, fit), [held, fit]);
  const right = useMemo(() => pageOnWindow(held.pages.right, fit), [held, fit]);
  const fixL = useMemo(() => fixCache(left), [left]);
  const fixR = useMemo(() => fixCache(right), [right]);
  const size = sizesAt(fit.scale, faces);
  // Measured with the faces in: measured before they load, the lines would break for a fallback.
  const [fontsIn, setFontsIn] = useState(0);
  useEffect(() => {
    let alive = true;
    // Its own faces asked for by name (fix run: `ready` alone resolved before the page's text had asked for them).
    const load = (font) => (document.fonts?.load ? document.fonts.load(font).catch(() => null) : null);
    let asked = false;
    const again = () => alive && asked && setFontsIn((n) => n + 1);
    Promise.all([load(`${faces.titleWeight} 40px ${faces.title}`), load(`400 20px ${faces.text}`), load(`600 20px ${faces.text}`), load(`400 14px ${faces.label}`)])
      .then(() => document.fonts?.ready)
      .then(() => {
        asked = true;
        again();
      });
    // Owner fixes 3: and measured again whenever faces come in later. Where the faces' stylesheet arrives after this
    // has asked (the dev server; a slow line), load() answers at once with nothing: the lines were then broken for
    // the fallback and stayed so.
    document.fonts?.addEventListener?.('loadingdone', again);
    return () => {
      alive = false;
      document.fonts?.removeEventListener?.('loadingdone', again);
    };
  }, [faces]);
  const facesAsked = fontsIn > 0;

  // While it is the page on the screen (not under the desk, pressed or opening): the book's page-wide
  // rules (book.css: no page scroll, the top line's pills over the picture), by its light.
  const film = useSyncExternalStore(subscribeFilm, getFilm, getFilm);
  const shown = !preview && film?.cover !== 'desk';
  useLayoutEffect(() => {
    if (!shown) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-desk-book', look);
    return () => root.removeAttribute('data-desk-book');
  }, [shown, look]);

  /* ── Left page ───────────────────────────────────────────────────────── */
  const W = left.w;
  const titleMeasure = useMemo(() => measureWith(faces.title, faces.titleWeight), [faces]);
  const textMeasure = useMemo(() => measureWith(faces.text, 400), [faces]);
  const name = course?.name || (loading || trouble === 'courses' ? '' : 'That course is gone');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fontsIn: measured again once the faces are in
  const title = useMemo(() => bookTitle(name, { width: W, size: size.title, small: size.small, measure: titleMeasure }), [name, W, size.title, size.small, titleMeasure, fontsIn]);
  const newest = own.find((note) => !note.pinned) || own[0];
  const breaks = page.profile?.roomPrefs?.breaks;
  const meets = course ? courseMeta(course, { professor: true }) : '';
  const next = course ? nextClass(course, new Date(), Array.isArray(breaks) ? breaks : []) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fontsIn: measured again once the faces are in
  const summary = useMemo(() => wrapLines(newest?.summary, W, (t) => textMeasure(t, size.text), 2), [newest?.summary, W, size.text, textMeasure, fontsIn]);

  const leftLines = [];
  let y = 0;
  const titleLine = Math.round(title.size * 1.15);
  title.lines.forEach((line, i) => {
    leftLines.push({ key: `t${i}`, y, height: titleLine, className: 'is-title', style: { fontSize: title.size }, text: line });
    y += titleLine;
  });
  y += Math.round(size.pitch * 0.45);
  if (trouble) {
    leftLines.push({ key: 'trouble', y, height: size.pitch, el: <DataTrouble trouble={trouble} onRetry={retry} className="room-book-trouble" /> });
    y += size.pitch;
  } else {
    [meets, next && `Next class: ${next}`, own.length ? plural(own.length, 'note') : ''].filter(Boolean).forEach((text, i) => {
      leftLines.push({ key: `m${i}`, y, height: size.pitch, text });
      y += size.pitch;
    });
  }
  if (newest && !trouble) {
    y += Math.round(size.pitch * 0.7);
    leftLines.push({ key: 'newest', y, height: size.pitch, className: 'is-strong', text: `Newest: ${newest.title || 'Untitled'}` });
    y += size.pitch;
    summary.forEach((text, i) => {
      leftLines.push({ key: `s${i}`, y, height: size.pitch, text });
      y += size.pitch;
    });
  }
  const footY = left.h - size.pitch;

  /* ── Right page: the notes ───────────────────────────────────────────── */
  const RW = right.w;
  // The list's three columns, sized to what they hold (the widest kind and date at this size), the title
  // taking the rest; each line's correction is fitted over its own column.
  const labelMeasure = useMemo(() => measureWith(faces.label, 400), [faces]);
  const cols = useMemo(() => {
    const label = (t) => labelMeasure(String(t).toUpperCase(), size.label) * 1.07;
    const kind = Math.max(label('Pinned'), ...own.map((note) => label(note.pinned ? 'Pinned' : note.kind || 'Note'))) + size.label * (selectMode ? 1.6 : 0.6);
    const date = Math.max(label('Yesterday'), ...own.map((note) => label(noteStamp(note)))) + size.label * 0.4;
    const a = Math.min(0.32, kind / RW);
    const b = Math.max(a + 0.3, 1 - Math.min(0.32, date / RW));
    return [a, b];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontsIn: measured again once the faces are in
  }, [own, RW, size.label, labelMeasure, selectMode, fontsIn]);
  const headH = Math.round(size.pitch * 1.3);
  const listTop = headH;
  const listBottom = right.h;
  const pitch = size.pitch;
  const [scroll, setScroll] = useState(0);
  const most = Math.max(0, own.length * pitch - (listBottom - listTop));
  const at = Math.min(scroll, most);
  const rowsRef = useRef(null);
  const onWheel = (event) => {
    if (!most) return;
    setScroll((s) => Math.max(0, Math.min(most, s + event.deltaY)));
  };
  // A row brought into view (keys), whole.
  const show = (i) => {
    const top = i * pitch;
    if (top < at) setScroll(top);
    else if (top + pitch > at + (listBottom - listTop)) setScroll(top + pitch - (listBottom - listTop));
  };
  const onRowKey = (i) => (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const j = Math.max(0, Math.min(own.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)));
    show(j);
    rowsRef.current?.querySelector(`[data-row="${j}"]`)?.focus({ preventScroll: true });
  };

  // The selection's Move menu, beside its word (outside the page: a menu on the paper would lean with it).
  const moveRef = useRef(null);
  const [moveAt, setMoveAt] = useState(null);
  useLayoutEffect(() => {
    if (!moveOpen) return;
    const r = moveRef.current?.getBoundingClientRect();
    if (r) setMoveAt({ left: r.left, bottom: window.innerHeight - r.top + 6 });
  }, [moveOpen]);

  const foot = selectMode ? (
    <>
      <span className="room-book-count">{selected.size ? `${selected.size} selected` : 'Pick the notes to move or delete'}</span>
      {selected.size > 0 && others.length > 0 && (
        <button ref={moveRef} type="button" className="room-book-action" data-menu-trigger="" aria-expanded={moveOpen} onClick={() => setMoveOpen((open) => !open)}>
          Move
        </button>
      )}
      {selected.size > 0 && (
        <button type="button" className="room-book-action" onClick={removeSelected}>
          Delete
        </button>
      )}
      <button type="button" className="room-book-action" onClick={clearSelection}>
        Cancel
      </button>
    </>
  ) : (
    <>
      <button type="button" className="room-book-action is-first" onClick={newNote} title="Or press N">
        + New note
      </button>
      {course && (
        <button type="button" className="room-book-action" onClick={() => setSheetOpen(true)} title="Name, colour, when it meets, room, professor">
          Edit
        </button>
      )}
      {own.length > 0 && (
        <button type="button" className="room-book-action" onClick={() => setFilesOpen(true)} title="Every photo on this course's notes">
          Files
        </button>
      )}
      {own.length > 0 && (
        <button type="button" className="room-book-action" onClick={startSelecting}>
          Select
        </button>
      )}
    </>
  );

  const dense = heldDense(fit.scale);
  const src = dense ? held.src.x2 : held.src.x1;
  const surroundSrc = held.surround ? (dense ? held.surround.x2 : held.surround.x1) : '';
  // Owner fixes (2026-11-23, E): the book is an OBJECT of its own on the page, so the film can move the book itself:
  // the held picture again, cut to the book's outline, as two halves that meet on the spine, each with its page's
  // words (deskBookPages bookOutline). At rest it lies exactly over the same picture in the ground under it (nothing
  // on the screen changes); in the film (a dissolve of the whole page over the desk) it is this that settles into its
  // place by a few pixels (deskFilmRun).
  const outline = useMemo(() => bookOutline(held.pages, fit, undefined, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1), [held, fit]);
  const pictureStyle = { left: fit.left, top: fit.top, width: fit.width, height: fit.height };
  const halfStyle = (half) => ({ left: half.box[0], top: half.box[1], width: half.box[2], height: half.box[3] });
  // (What a half draws is laid out in the window's own px, as before: its box only cuts it.)
  const innerStyle = (half) => ({ left: -half.box[0], top: -half.box[1], width: view.width, height: view.height });

  // Fix run: under the desk (pressed, opening), the page tells the film once it has been drawn whole: its pictures
  // decoded, its words laid out in their own faces with the course's data in, three frames since (deskFilmRun
  // PAINT_FRAMES). The film's last frame holds until then, so the swap never shows a page without its picture or
  // its words.
  const surroundRef = useRef(null);
  const pictureRef = useRef(null);
  const objectRef = useRef(null);
  const readyId = courseId || course?.id || '';
  // (Fix run 2: shown at once as well, e.g. back from a note: RoomLayout holds the note until this.)
  // Owner fixes 2 (2026-11-23): the book is never shown before it is WHOLE (`whole`, book.css [data-whole]): a page
  // reached without the film (a reload on the book, its link, the way back from a note) stays unseen until then, as
  // the film's page stays under the desk: the paper's words on a flat ground, the picture coming a moment later, was
  // "a note of this address" that showed and went. No picture to show (`src` empty): not whole. A page that cannot be
  // made whole (a face or a picture that never comes) is shown as it is after HELD_WAIT_MS.
  const [wholeFor, setWholeFor] = useState('');
  const whole = Boolean(src) && wholeFor === `${readyId}|${src}`;
  useEffect(() => {
    if (!facesAsked || loading || !readyId || !src) return undefined;
    let alive = true;
    const imgs = [surroundRef.current, pictureRef.current, ...(objectRef.current?.querySelectorAll('img') || [])].filter(Boolean);
    Promise.all(imgs.map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => null) : null))).then(() => {
      let n = 3;
      const step = () => {
        if (!alive) return;
        n -= 1;
        if (n > 0) requestAnimationFrame(step);
        else {
          setWholeFor(`${readyId}|${src}`);
          filmPagePainted(readyId);
        }
      };
      requestAnimationFrame(step);
    });
    return () => {
      alive = false;
    };
  }, [facesAsked, loading, readyId, src, surroundSrc]);
  useEffect(() => {
    if (whole || !readyId) return undefined;
    const timer = setTimeout(() => setWholeFor(`${readyId}|${src}`), HELD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [whole, readyId, src]);
  const vars = {
    '--book-ink': held.ink,
    '--book-soft': held.soft,
    '--book-action': held.action,
    '--book-ground': held.ground,
    '--book-title': faces.title,
    '--book-text': faces.text,
    '--book-label': faces.label,
    '--book-size': `${size.text}px`,
    '--book-label-size': `${size.label}px`,
  };

  return (
    <RoomShell back="Desk" onBack={() => navigate(filmHome())} ownTrouble>
      <div className="room-book" data-light={look} data-type={book.type || 'book'} data-course={readyId} data-whole={whole || wholeFor === `${readyId}|${src}` ? '' : undefined} style={vars} aria-label={course?.name || 'Course'}>
        {/* The held view round the book: the surround and the whole picture (the rest, the table, the book in it). */}
        <div className="room-book-ground" style={{ transformOrigin: `${outline.spine.toFixed(1)}px ${(outline.right.box[1] + outline.right.box[3] / 2).toFixed(1)}px` }}>
          {held.surround && (
            <img
              ref={surroundRef}
              className="room-book-picture"
              src={surroundSrc}
              alt=""
              draggable={false}
              decoding="async"
              style={{ left: fit.left + held.surround.box[0] * fit.scale, top: fit.top + held.surround.box[1] * fit.scale, width: held.surround.box[2] * fit.scale, height: held.surround.box[3] * fit.scale }}
            />
          )}
          {src && <img ref={pictureRef} className="room-book-picture" src={src} alt="" draggable={false} decoding="async" style={pictureStyle} />}
          {/* While the film plays (book.css): the rest without its book. The held picture has the book on it, so coming
              in under the moving book it showed a pale second book at the place the book was going to; this covers
              that with the rest's own wood (one flat tone, measured beside the book), until the book lies on it. */}
          <div className="room-book-rest" style={{ clipPath: `polygon(${[outline.left.poly[0], outline.left.poly[1], outline.right.poly[1], outline.right.poly[2], outline.right.poly[3], outline.left.poly[3]].map(([x, y]) => `${x}px ${y}px`).join(', ')})`, background: look === 'night' ? '#6f4027' : '#93614c' }} aria-hidden="true" />
        </div>
        {/* The book itself (see `outline` above). */}
        <div
          ref={objectRef}
          className="room-book-object"
          style={{ transformOrigin: `${outline.spine.toFixed(1)}px ${(outline.right.box[1] + outline.right.box[3] / 2).toFixed(1)}px` }}
        >
        {/* The left half first, as before (reading and Tab order). */}
        <div className="room-book-half is-left" style={halfStyle(outline.left)}>
        <div className="room-book-face is-front" style={{ clipPath: outlineClip(outline.left) }}>
        <div className="room-book-in" style={innerStyle(outline.left)}>
        {src && <img className="room-book-picture" src={src} alt="" draggable={false} decoding="async" style={pictureStyle} />}
        <div className="room-book-page is-left" style={{ width: left.w, height: left.h, transform: left.css }}>
          {leftLines.map((line) =>
            line.el ? (
              <Line key={line.key} fix={fixL} y={line.y} width={W} height={line.height}>
                {line.el}
              </Line>
            ) : (
              <Line key={line.key} fix={fixL} y={line.y} width={W} height={line.height} className={line.className} style={line.style} dir="auto">
                {line.key === 't0' ? <h1 className="room-book-name">{line.text}</h1> : line.text}
              </Line>
            ),
          )}
          <Line fix={fixL} y={footY} width={W} height={size.pitch} className="room-book-foot" role="toolbar" aria-label={selectMode ? 'Selected notes' : 'This course'}>
            {foot}
          </Line>
        </div>
        </div>
        </div>
        </div>
        <div className="room-book-half is-right" style={halfStyle(outline.right)}>
        <div className="room-book-face is-front" style={{ clipPath: outlineClip(outline.right) }}>
        <div className="room-book-in" style={innerStyle(outline.right)}>
        {src && <img className="room-book-picture" src={src} alt="" draggable={false} decoding="async" style={pictureStyle} />}
        <div className="room-book-page is-right" style={{ width: right.w, height: right.h, transform: right.css }} onWheel={onWheel}>
          {/* (Short lines: each fitted over the part of the page it takes.) */}
          <Line fix={fixR} y={0} width={RW * 0.5} height={headH} to={0.5} className="room-book-head">
            Notes
          </Line>
          {own.length === 0 && !loading && (
            <Line fix={fixR} y={listTop} width={RW * 0.8} height={pitch} to={0.8} className="room-book-empty">
              No notes yet.{' '}
              <button type="button" className="room-book-action" onClick={newNote}>
                + New note
              </button>
            </Line>
          )}
          <div ref={rowsRef} role="list" aria-label="Notes">
            {own.map((note, i) => {
              const top = listTop + i * pitch - at;
              if (top + pitch < listTop - 0.5 || top > listBottom + 0.5) return null;
              // The paper's foot: the line it cuts fades; above the list's top, nothing shows.
              const below = (top + pitch - listBottom) / pitch;
              // Above the list's top a line goes at once (it would cross the head), half a line's way.
              const above = (listTop - top) / (pitch / 2);
              const fade = Math.max(0, Math.min(1, 1 - Math.max(below > 0 ? below : 0, above > 0 ? above : 0)));
              const more = i === Math.floor((at + listBottom - listTop) / pitch) - 1 && own.length * pitch - at > listBottom - listTop + 1;
              const on = selected.has(note.id);
              return (
                <button
                  key={note.id}
                  type="button"
                  role="listitem"
                  data-row={i}
                  className={`room-book-row${on ? ' is-selected' : ''}${selectMode ? ' is-selecting' : ''}`}
                  style={{ opacity: more ? Math.min(fade, 0.45) : fade, visibility: fade <= 0.02 ? 'hidden' : undefined }}
                  aria-pressed={selectMode ? on : undefined}
                  onClick={openOrSelect(note)}
                  onKeyDown={onRowKey(i)}
                  onFocus={() => show(i)}
                  onPointerDown={holdStart(note)}
                  onPointerMove={holdMove}
                  onPointerUp={holdEnd}
                  onPointerCancel={holdEnd}
                  onContextMenu={holdMenu}
                >
                  {/* Three columns, each line's correction taken over its own (kind, title, date). */}
                  <Line span fix={fixR} x={0} y={top} width={RW * cols[0]} height={pitch} from={0} to={cols[0]} className="room-book-kind">
                    {selectMode && (
                      <span className="room-select-mark room-book-box" aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                    )}
                    {note.pinned ? 'Pinned' : note.kind || 'Note'}
                  </Line>
                  <Line span fix={fixR} x={RW * cols[0]} y={top} width={RW * (cols[1] - cols[0])} height={pitch} from={cols[0]} to={cols[1]} className="room-book-title" dir="auto">
                    {note.title || 'Untitled'}
                  </Line>
                  <Line span fix={fixR} x={RW * cols[1]} y={top} width={RW * (1 - cols[1])} height={pitch} from={cols[1]} to={1} className="room-book-date">
                    {noteStamp(note)}
                  </Line>
                </button>
              );
            })}
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
        {/* The picture's own corners and pages, for the harness's overlay (?bookgrid=1). */}
        {book.debugGrid && <BookGrid held={held} fit={fit} />}
      </div>
      {moveOpen && moveAt && (
        <MenuCard
          onClose={() => setMoveOpen(false)}
          style={{ position: 'fixed', left: moveAt.left, bottom: moveAt.bottom, zIndex: 41 }}
          items={others.map((target) => ({ id: target.id, label: target.name, onSelect: () => moveSelected(target) }))}
        />
      )}
      <CourseSheet open={sheetOpen && Boolean(course)} course={course} onClose={() => setSheetOpen(false)} />
      <CourseFiles open={filesOpen && Boolean(course)} course={course} notes={own} onClose={() => setFilesOpen(false)} />
    </RoomShell>
  );
};

// The grid the picture says (dots) over the page, for checking the words against it in the harness.
const BookGrid = ({ held, fit }) => (
  <svg className="room-book-grid" width="100%" height="100%" aria-hidden="true">
    {['left', 'right'].flatMap((side) =>
      held.pages[side].grid.flatMap((row, i) => row.map((p, j) => <circle key={`${side}${i}-${j}`} cx={fit.left + p[0] * fit.scale} cy={fit.top + p[1] * fit.scale} r="1.6" />)),
    )}
  </svg>
);

export default CourseBook;
