import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { useAuth } from '../context/authState';
import {
  deleteRoomTemplate,
  getNoteFresh,
  saveNoteContentDelta,
  saveRoomTemplate,
  setNotePinned,
  updateNote,
} from '../services/library';
import {
  createImageObjectName,
  NOTE_IMAGE_MAX_BYTES,
  validateImageFile,
} from '../utils/imageUpload';
import { exportNotePdf } from '../utils/exportPdf';
import useNetworkStatus from '../hooks/useNetworkStatus';
import RoomShell from './RoomShell';
import Paper from './components/Paper';
import PageBlock from './components/PageBlock';
import FormatStrip from './components/FormatStrip';
import MathStrip from './components/MathStrip';
import { MathToolContext } from './mathContext';
import { focusWhenMounted } from './focusQueue';
import { SHORTCUT_HINTS } from './shortcutPatterns';
import PinRail from './components/PinRail';
import SagePanel from './components/SagePanel';
import NoteTags from './components/NoteTags';
import { cleanTags, withTags } from './noteTags';
import { usePageActions } from './roomCommands';
import { Chip, Dot, PencilRule, Pill } from './components/primitives';
import { MenuCard, Overlay } from './components/Overlay';
import { aspectOf, IMMUTABLE_CACHE, prepareImage } from './imageScale';
import { DEFAULT_PIN_WIDTH, resolveRail, settleRail } from './railLayout';
import { useRoomCourses } from './roomData';
import { clearMatches, collectMatches, findLabel, paintMatches, revealMatch, stepIndex } from './noteFind';
import { instantiate, isBlankPage, PAGE_TEMPLATES, savedTemplates, structureOf } from './pageTemplates';
import {
  BLOCK_CALLOUT,
  BLOCK_CHECKLIST,
  BLOCK_CODE,
  BLOCK_IMAGE,
  BLOCK_MATH,
  BLOCK_TEXT,
  BLOCK_TWO_COLUMN,
  BLOCK_TYPES,
  createBlock,
  createPin,
  diffBlocks,
  fromStored,
  pageBlocksOf,
  railBlocksOf,
  sectionsOf,
  snapshotOf,
  startingBlocks,
  toPdfBlocks,
} from './pageBlocks';

// Note editor — design 6c. One sheet of paper, blocks in document order, and a board on
// the right for photos.
//
// No coordinates on the page: a block's height is whatever its content is. The board has
// coordinates, but they are derived, never measured (railLayout.js).
//
// Saving reuses classic's `saveNoteContentDelta` untouched: per-block field paths, so a
// keystroke writes one block rather than the document.

const SAVE_DEBOUNCE_MS = 900;
const UNDO_MS = 6000;

// ⌘K's "Insert …" actions: what each block is called there, and what else finds it.
const INSERT_ACTIONS = [
  { type: BLOCK_MATH, label: 'Insert a formula', keywords: ['math', 'equation', 'latex', 'katex', '$$'] },
  { type: BLOCK_CODE, label: 'Insert code', keywords: ['snippet', 'program', '```'] },
  { type: BLOCK_CALLOUT, label: 'Insert a callout', keywords: ['prof said', 'box', 'important', 'remember'] },
  { type: BLOCK_CHECKLIST, label: 'Insert a checklist', keywords: ['todo', 'tasks', 'checkbox'] },
  { type: BLOCK_TWO_COLUMN, label: 'Insert two columns', keywords: ['split', 'side by side', 'compare'] },
  { type: BLOCK_TEXT, label: 'Insert text', keywords: ['paragraph', 'writing'] },
];

// The ··· menu's rows, as ⌘K finds them.
const MENU_KEYWORDS = {
  pin: ['pinned', 'top'],
  pdf: ['print', 'download', 'save'],
  find: ['search', 'ctrl f'],
  structure: ['template', 'reuse'],
  back: ['course', 'leave'],
};

const savedStamp = (date) =>
  `Saved ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const prefersStill = () =>
  document.documentElement.getAttribute('data-motion') === 'still' ||
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The reading-position observer. Module-level so it closes over nothing from a render:
// only refs and a state setter, all stable. It watches a thin band near the top of the
// window and reports the section of the first block inside it.
const bandObserverFor = (observerRef, inBandRef, orderRef, ownerRef, onSection) => {
  if (!observerRef.current && typeof IntersectionObserver !== 'undefined') {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute('data-block-id');
          if (entry.isIntersecting) inBandRef.current.add(id);
          else inBandRef.current.delete(id);
        });
        let first = '';
        let firstAt = Infinity;
        inBandRef.current.forEach((id) => {
          const at = orderRef.current.get(id);
          if (at !== undefined && at < firstAt) {
            firstAt = at;
            first = id;
          }
        });
        // Between two blocks the band can be empty — keep the section you were in.
        const section = first && ownerRef.current.get(first);
        if (section) onSection(section);
      },
      { rootMargin: '-18% 0px -72% 0px' },
    );
  }
  return observerRef.current;
};

/* ── One block on the page ─────────────────────────────────────────────────────
   Memoised, with every callback stable, so a keystroke re-renders the block being typed
   in and nothing else. Before this, every block (and every TipTap editor in it)
   re-rendered on every keystroke.                                                   */

const BlockRow = memo(function BlockRow({
  block,
  sectionIndex,
  accent,
  plusOpen,
  onChange,
  onFocusBlock,
  onTogglePlus,
  onInsertAfter,
  onToggleSection,
  onRemove,
  registerNode,
  isLast,
}) {
  const handleFocus = useCallback((editor) => onFocusBlock(block.id, editor), [onFocusBlock, block.id]);

  return (
    <div
      className={`room-block-shell${isLast ? ' is-last' : ''}`}
      data-block-id={block.id}
      ref={(node) => registerNode(block.id, node)}
    >
      <div className="room-gutter-tools">
        <button
          type="button"
          className="room-plus"
          onClick={() => onTogglePlus(block.id)}
          aria-label="Add a block"
          aria-expanded={plusOpen}
        >
          +
        </button>
      </div>

      <div className="room-block-tools">
        <button
          type="button"
          className={`room-gutter-btn ${block.section ? 'is-on' : ''}`}
          onClick={() => onToggleSection(block)}
          title={block.section ? 'Stop starting a section here' : 'Start a section here'}
        >
          §
        </button>
        <button
          type="button"
          className="room-gutter-btn"
          onClick={() => onRemove(block)}
          aria-label="Delete this block"
        >
          ×
        </button>
      </div>

      <PageBlock
        block={block}
        sectionIndex={sectionIndex}
        accent={accent}
        onChange={onChange}
        onFocus={handleFocus}
      />

      {plusOpen && (
        <div className="room-plus-menu">
          {BLOCK_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              className="room-chip"
              onClick={() => onInsertAfter(block.id, type.id)}
            >
              {type.label}
              {SHORTCUT_HINTS[type.id] && <span className="room-chip-hint">{SHORTCUT_HINTS[type.id]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/* ── The editor ─────────────────────────────────────────────────────────────── */

const RoomNote = ({ courseId, noteId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { firebaseUser, profile } = useAuth();
  const { courses } = useRoomCourses();
  const online = useNetworkStatus();
  const course = courses.find((item) => item.id === courseId);

  const [blocks, setBlocks] = useState([]);
  const [title, setTitle] = useState('');
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState([]);
  // Whether the tag field under the title is open — here so ⌘K's "Add a tag" can open it.
  const [tagging, setTagging] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [plusAt, setPlusAt] = useState(null);
  const [undo, setUndo] = useState(null);
  // Sage: whether its panel is showing, and whether this note has a "before Sage" version.
  const [sageOpen, setSageOpen] = useState(false);
  // { id, insert } while a formula has the caret — the dock then shows the math toolbar.
  const [mathTool, setMathTool] = useState(null);
  const [sageVersions, setSageVersions] = useState({ has: false, view: 'improved' });

  // Find in this note. Arriving from ⌘K search carries the query, so the note opens with
  // find already on it and the first match in view.
  const [findOpen, setFindOpen] = useState(() => Boolean(location.state?.find));
  const [findQuery, setFindQuery] = useState(() => String(location.state?.find || ''));
  const [findState, setFindState] = useState({ count: 0, index: 0 });
  const findInputRef = useRef(null);
  const matchesRef = useRef([]);
  // The current match lives here; `findState` only mirrors it for display. Painting from
  // inside a setState updater would be a side effect React may run twice.
  const findIndexRef = useRef(0);
  // Bumped when search sends you here again: re-arming find must re-reveal the first match
  // even when the query is the same one already open.
  const [findArrival, setFindArrival] = useState(0);
  const arrivalKeyRef = useRef(location.key);
  const pageRef = useRef(null);

  // Templates.
  const [templatesDismissed, setTemplatesDismissed] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [uploading, setUploading] = useState(false);

  // State, not a ref: the format strip has to re-render when the caret moves to a
  // different block, and a ref would never trigger that.
  const [activeEditor, setActiveEditor] = useState(null);
  const [activeBlockId, setActiveBlockId] = useState('');

  const lastSavedRef = useRef({});
  const saveTimerRef = useRef(null);
  const undoTimerRef = useRef(null);
  const retryRef = useRef({ timer: null, delay: 0 });
  const pendingRef = useRef(0);
  const flushRef = useRef(null);
  // False once the editor has gone. A write refused AFTER you left must not schedule a
  // retry: that retry would be refused too, and schedule another — a loop outliving the page.
  const aliveRef = useRef(true);
  const savedTitleRef = useRef('');
  // Whether anything has been written since the note opened — a late server copy may only
  // replace a page nobody has touched.
  const touchedRef = useRef(false);
  const sectionNodes = useRef(new Map());

  // Which § you are reading, for the outline. Tracked by an IntersectionObserver on a thin
  // band near the top of the window — it fires only when a block crosses that band, never
  // per scroll frame, and nothing it does feeds back into layout.
  const [currentSection, setCurrentSection] = useState('');
  const observerRef = useRef(null);
  const inBandRef = useRef(new Set());
  const ownerRef = useRef(new Map());
  const orderRef = useRef(new Map());

  // A mirror of `blocks` for the debounced save, the unmount flush and delete's undo
  // index — all of which run outside render. Written in an effect: assigning during
  // render is a lint error and is not safe under concurrent rendering.
  const blocksRef = useRef([]);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const sections = useMemo(() => sectionsOf(blocks), [blocks]);
  const pageBlocks = useMemo(() => pageBlocksOf(blocks), [blocks]);
  const pins = useMemo(() => railBlocksOf(blocks), [blocks]);

  // One lookup per render. The old per-block `sectionIndexOf` rebuilt every section —
  // and stripped every section's HTML — once for EACH block, on every keystroke.
  const sectionIndexById = useMemo(
    () => new Map(sections.map((section) => [section.id, section.index])),
    [sections],
  );

  /* ── Load ───────────────────────────────────────────────────────────────────
     From the server whenever it answers within a moment, from this device when it does
     not (library.js `getNoteFresh`). The old cache-first read showed whatever this device
     saw last, so a note edited on another device — or on the deployed site after editing on
     localhost — opened in its old version here. A server answer that arrives after the
     device's copy is on screen replaces it only if nothing has been written yet;
     otherwise what is being written wins, and the status line says so.            */
  useEffect(() => {
    if (!firebaseUser || !courseId || !noteId) return undefined;
    let cancelled = false;
    const show = (note) => {
      const loaded = (note.blocks || []).map(fromStored);
      const next = loaded.length ? loaded : startingBlocks();
      setBlocks(next);
      savedTitleRef.current = note.title || 'Untitled';
      setTitle(note.title === 'Untitled' ? '' : note.title || '');
      setPinned(Boolean(note.pinned));
      setTags(cleanTags(note.tags));
      setSageVersions({
        has: Boolean(note.sageHasVersions),
        view: note.sageView === 'original' ? 'original' : 'improved',
      });
      lastSavedRef.current = snapshotOf(next);
    };
    // What the page was opened from, to tell whether a later answer says anything new.
    const versionOf = (note) => JSON.stringify([note.title, note.blocks, note.tags, note.pinned]);
    touchedRef.current = false;
    getNoteFresh(firebaseUser.uid, courseId, noteId)
      .then(({ note, later }) => {
        if (cancelled) return;
        if (!note) {
          setStatus('That note is gone');
          setLoading(false);
          return;
        }
        show(note);
        setLoading(false);
        later?.then((fresh) => {
          if (cancelled || !fresh || versionOf(fresh) === versionOf(note)) return;
          if (touchedRef.current) {
            setStatus('Changed on another device — reopen the note to see that version');
            return;
          }
          show(fresh);
        });
      })
      .catch((err) => {
        console.error('Could not open that note', err);
        setStatus('Could not open this note');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, courseId, noteId]);

  /* ── Save ───────────────────────────────────────────────────────────────────
     A save counts as saved the moment it is HANDED to Firestore. With the persistent
     cache the write is already durable on this device and queued for the server; its
     promise only settles when the server answers.

     The old flush waited for that answer before moving on. Offline the answer never came,
     so every pause re-sent every edit made since the connection dropped — dozens of
     redundant writes queued, all billed on reconnect. Now each flush sends only what
     changed since the previous one, online or not.

     Offline writes WAIT; they do not fail. So a rejection is a real refusal (rules,
     quota, bad data): its changes are put back to be re-sent, with backoff.          */
  const flush = useCallback(() => {
    if (!firebaseUser || !courseId || !noteId) return;
    const current = blocksRef.current;
    const before = lastSavedRef.current;
    const delta = diffBlocks(current, before);
    if (!delta.changed) return;

    lastSavedRef.current = snapshotOf(current);
    pendingRef.current += 1;

    saveNoteContentDelta(firebaseUser.uid, courseId, noteId, {
      changedBlocks: delta.changedBlocks,
      removedBlockIds: delta.removedBlockIds,
      order: delta.order,
    })
      .then(() => {
        pendingRef.current -= 1;
        retryRef.current.delay = 0;
        if (pendingRef.current === 0) setStatus(savedStamp(new Date()));
      })
      .catch((err) => {
        pendingRef.current -= 1;
        console.error('Save refused', err);
        const next = { ...lastSavedRef.current };
        Object.keys(delta.changedBlocks).forEach((id) => {
          delete next[id];
        });
        delta.removedBlockIds.forEach((id) => {
          next[id] = before[id] || { id };
        });
        lastSavedRef.current = next;
        if (!aliveRef.current) return;
        // One line of plain text, never a toast or a modal.
        setStatus('Not saved yet — trying again');
        const delay = Math.min(60_000, (retryRef.current.delay || 2_500) * 2);
        retryRef.current.delay = delay;
        clearTimeout(retryRef.current.timer);
        retryRef.current.timer = setTimeout(() => flushRef.current?.(), delay);
      });
  }, [firebaseUser, courseId, noteId]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const scheduleSave = useCallback(() => {
    touchedRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Sage replaces the page wholesale — an answer, or a version swap. It rides the same
  // debounced save as typing, and the delta diff writes only the blocks that changed.
  const getBlocks = useCallback(() => blocksRef.current, []);
  const replaceBlocks = useCallback(
    (next) => {
      setBlocks(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  // Flush on the way out so a fast exit never loses the last keystroke.
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      clearTimeout(retryRef.current.timer);
      flush();
    },
    [flush],
  );

  // …and when the tab is hidden or closed. React never unmounts on a page unload, so
  // without this the last second of typing before closing the tab was simply lost.
  useEffect(() => {
    const now = () => {
      clearTimeout(saveTimerRef.current);
      flushRef.current?.();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', now);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', now);
    };
  }, []);

  /* ── Reading position ─────────────────────────────────────────────────── */
  useEffect(() => {
    const owner = new Map();
    const order = new Map();
    let section = '';
    pageBlocks.forEach((block, index) => {
      if (block.section) section = block.id;
      owner.set(block.id, section);
      order.set(block.id, index);
    });
    ownerRef.current = owner;
    orderRef.current = order;
  }, [pageBlocks]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  /* ── Editing ──────────────────────────────────────────────────────────────
     Every handler below is stable, so the memoised rows only re-render for their own
     block's changes.                                                            */

  const changeBlock = useCallback(
    (next) => {
      setBlocks((prev) => prev.map((block) => (block.id === next.id ? next : block)));
      scheduleSave();
    },
    [scheduleSave],
  );

  // Patches to several blocks at once — a board move can push the photos below it.
  // MERGED into the current blocks, never swapped in whole: see settleRail for why a
  // whole-object replace loses changes.
  const patchBlocks = useCallback(
    (patches) => {
      if (!patches?.length) return;
      const byId = new Map(patches.map((patch) => [patch.id, patch]));
      setBlocks((prev) =>
        prev.map((block) => (byId.has(block.id) ? { ...block, ...byId.get(block.id) } : block)),
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const togglePlus = useCallback((id) => setPlusAt((current) => (current === id ? null : id)), []);

  // By id, not by index: the page and the board share one array, so a page index is
  // not a position in it.
  const insertAfter = useCallback(
    (id, type) => {
      const fresh = createBlock(type);
      // A new block is for writing in: its first field takes the caret when it mounts.
      focusWhenMounted(type === BLOCK_TWO_COLUMN ? fresh.colA[0].id : fresh.id);
      setBlocks((prev) => {
        const at = prev.findIndex((block) => block.id === id);
        const next = [...prev];
        next.splice(at < 0 ? prev.length : at + 1, 0, fresh);
        return next;
      });
      setPlusAt(null);
      scheduleSave();
    },
    [scheduleSave],
  );

  // Deletes never ask. They happen, and offer undo (dualmode.md §4.2). The index is read
  // from the full array so undo puts the block back exactly where it was.
  const removeBlock = useCallback(
    (block) => {
      const index = blocksRef.current.findIndex((item) => item.id === block.id);
      setBlocks((prev) => prev.filter((item) => item.id !== block.id));
      setUndo({ block, index: index < 0 ? blocksRef.current.length : index });
      scheduleSave();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_MS);
    },
    [scheduleSave],
  );

  const restore = () => {
    if (!undo) return;
    setBlocks((prev) => {
      const next = [...prev];
      next.splice(Math.min(undo.index, next.length), 0, undo.block);
      return next;
    });
    setUndo(null);
    scheduleSave();
  };

  const toggleSection = useCallback(
    (block) => changeBlock({ ...block, section: !block.section }),
    [changeBlock],
  );

  const focusBlock = useCallback((id, editor) => {
    setActiveEditor(editor);
    setActiveBlockId(id);
  }, []);

  const registerNode = useCallback((id, node) => {
    const previous = sectionNodes.current.get(id);
    if (previous && previous !== node) {
      observerRef.current?.unobserve(previous);
      inBandRef.current.delete(id);
    }
    if (node) {
      sectionNodes.current.set(id, node);
      bandObserverFor(observerRef, inBandRef, orderRef, ownerRef, setCurrentSection)?.observe(node);
    } else {
      sectionNodes.current.delete(id);
    }
  }, []);

  const jumpToSection = useCallback((id) => {
    sectionNodes.current
      .get(id)
      ?.scrollIntoView({ behavior: prefersStill() ? 'auto' : 'smooth', block: 'start' });
  }, []);

  /* ── The board ────────────────────────────────────────────────────────── */

  // `y` is where on the board the photos should hang; without one they go under the
  // last photo. Prepared (scaled) BEFORE validating — the size limit applies to what is
  // actually uploaded, not to the phone's original. One bad file never stops the rest.
  const addPhotos = useCallback(
    async (files, y) => {
      if (!firebaseUser || !files?.length) return;
      // Storage has no offline queue: an upload attempted offline just hangs. The board
      // itself says photos need a connection, so there is nothing to start here.
      if (!navigator.onLine) return;
      setUploading(true);
      let failed = 0;
      for (const file of files) {
        try {
          const ready = await prepareImage(file);
          validateImageFile(ready.file, { maxBytes: NOTE_IMAGE_MAX_BYTES, label: 'Image' });
          const ref = storageRef(
            storage,
            `notes/${firebaseUser.uid}/${noteId}/${createImageObjectName(ready.file, 'pin')}`,
          );
          // Cached for a year and marked immutable: every photo lives at a unique name and
          // never changes, so a device downloads it once — reopening a note costs the server
          // nothing, and the photo still shows when the connection is gone.
          await uploadBytes(ref, ready.file, {
            contentType: ready.file.type,
            cacheControl: IMMUTABLE_CACHE,
          });
          const url = await getDownloadURL(ref);
          setBlocks((prev) => {
            const rail = railBlocksOf(prev);
            const pin = createPin(BLOCK_IMAGE, {
              value: url,
              w: DEFAULT_PIN_WIDTH,
              ar: aspectOf(ready.width, ready.height),
              y: Number.isFinite(y) ? y : resolveRail(rail).end,
            });
            const patches = new Map(settleRail([...rail, pin]).map((patch) => [patch.id, patch]));
            const apply = (block) =>
              patches.has(block.id) ? { ...block, ...patches.get(block.id) } : block;
            return [...prev.map(apply), apply(pin)];
          });
        } catch (err) {
          failed += 1;
          console.error('Could not add that photo', err);
        }
      }
      setUploading(false);
      scheduleSave();
      if (failed) {
        setStatus(failed === files.length ? 'That photo would not attach' : 'Some photos would not attach');
      }
    },
    [firebaseUser, noteId, scheduleSave],
  );

  /* ── Everything else ──────────────────────────────────────────────────── */

  // Only when it changed: this ran on every blur, so clicking into the title and out
  // again cost a write each time.
  const saveTitle = () => {
    if (!firebaseUser) return;
    const next = title.trim() || 'Untitled';
    if (next === savedTitleRef.current) return;
    savedTitleRef.current = next;
    updateNote(firebaseUser.uid, courseId, noteId, { title: next }).catch((err) =>
      console.error('Could not rename', err),
    );
  };

  // Tags are few and change one at a time, so each change is written as it happens — not
  // awaited: it lands in the local cache at once, online or not.
  const saveTags = (next) => {
    setTags(next);
    if (!firebaseUser) return;
    updateNote(firebaseUser.uid, courseId, noteId, { tags: next }).catch((err) =>
      console.error('Could not save the tags', err),
    );
  };

  const openTag = (tag) => navigate(`/room/notes?tag=${encodeURIComponent(tag)}`);

  const applyLink = () => {
    const editor = activeEditor;
    const url = linkUrl.trim();
    if (editor && !editor.isDestroyed) {
      if (url) editor.chain().focus().setLink({ href: url }).run();
      else editor.chain().focus().unsetLink().run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  };

  /* ── Find ───────────────────────────────────────────────────────────────────
     Ctrl/⌘+F opens it; Enter / Shift+Enter or ← → step; Esc closes. Matching is redone
     when the query changes AND when the note does, so the count never goes stale while
     you type elsewhere. It marks text through the CSS Custom Highlight API, which never
     touches the editor's document, so finding cannot dirty the note or cause a save. */

  const closeFind = useCallback(() => {
    clearMatches();
    matchesRef.current = [];
    findIndexRef.current = 0;
    setFindOpen(false);
    setFindQuery('');
    setFindState({ count: 0, index: 0 });
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        // Whatever short phrase is selected becomes the search.
        const picked = window.getSelection?.()?.toString().trim() || '';
        if (picked && picked.length <= 60 && !picked.includes('\n')) setFindQuery(picked);
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.select());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!findOpen) return undefined;
    const timer = setTimeout(() => {
      const matches = findQuery.trim() ? collectMatches(pageRef.current, findQuery.trim()) : [];
      matchesRef.current = matches;
      const index = Math.min(findIndexRef.current, Math.max(matches.length - 1, 0));
      findIndexRef.current = index;
      paintMatches(matches, index);
      setFindState({ count: matches.length, index });
    }, 120);
    return () => clearTimeout(timer);
  }, [findOpen, findQuery, blocks]);

  // Search sending you to the note that is ALREADY open does not remount the editor (it is
  // keyed by note), so the query that arrived with this navigation is armed here. The first
  // arrival is handled by the state initialisers above; this is every one after it.
  useEffect(() => {
    const query = location.state?.find;
    if (!query || arrivalKeyRef.current === location.key) return undefined;
    arrivalKeyRef.current = location.key;
    const frame = requestAnimationFrame(() => {
      setFindQuery(String(query));
      setFindOpen(true);
      setFindArrival((n) => n + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [location.key, location.state]);

  // A new query starts from its first match, and brings it into view — as does the note
  // finishing loading, for a query that arrived with it from search.
  useEffect(() => {
    if (!findOpen || loading) return undefined;
    const timer = setTimeout(() => {
      findIndexRef.current = 0;
      paintMatches(matchesRef.current, 0);
      setFindState({ count: matchesRef.current.length, index: 0 });
      revealMatch(matchesRef.current[0], prefersStill());
    }, 160);
    return () => clearTimeout(timer);
  }, [findOpen, findQuery, loading, findArrival]);

  const openFind = () => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
  };

  const stepFind = (delta) => {
    const matches = matchesRef.current;
    if (!matches.length) return;
    const index = stepIndex(findIndexRef.current, matches.length, delta);
    findIndexRef.current = index;
    setFindState({ count: matches.length, index });
    paintMatches(matches, index);
    revealMatch(matches[index], prefersStill());
  };

  useEffect(() => () => clearMatches(), []);

  /* ── Templates ──────────────────────────────────────────────────────────────
     Offered only while the note is blank; the row goes the moment anything is written. */

  const customTemplates = useMemo(() => savedTemplates(profile?.roomTemplates), [profile?.roomTemplates]);
  const showTemplates = !loading && !templatesDismissed && isBlankPage(pageBlocks, pins.length);

  const applyTemplate = (template) => {
    const fresh = instantiate(template.blocks);
    setBlocks((prev) => [...fresh, ...railBlocksOf(prev)]);
    scheduleSave();
    // The sheet's stamp in the course grid: LECTURE, READING, REVIEW.
    if (template.kind && firebaseUser) {
      updateNote(firebaseUser.uid, courseId, noteId, { kind: template.kind }).catch((err) =>
        console.error('Could not label the note', err),
      );
    }
  };

  const saveStructure = () => {
    if (!firebaseUser) return;
    const { saved } = saveRoomTemplate(firebaseUser.uid, {
      name: templateName,
      blocks: structureOf(pageBlocks),
    });
    saved.catch((err) => console.error('Could not save that template', err));
    setSaveTemplateOpen(false);
    setTemplateName('');
  };

  const activeBlock = pageBlocks.find((item) => item.id === activeBlockId);

  // The section the caret is in — else the one being read. It is what Sage's "This section"
  // sends. A caret inside a column counts as being in the column's block.
  const focusSection = useMemo(() => {
    const at = pageBlocks.findIndex(
      (item) =>
        item.id === activeBlockId ||
        (item.type === BLOCK_TWO_COLUMN && [...(item.colA || []), ...(item.colB || [])].some((child) => child.id === activeBlockId)),
    );
    for (let i = at; i >= 0; i -= 1) {
      if (pageBlocks[i].section) return pageBlocks[i].id;
    }
    return currentSection || sections[0]?.id || '';
  }, [pageBlocks, activeBlockId, currentSection, sections]);

  const menuItems = [
    {
      id: 'pin',
      label: pinned ? 'Unpin from the top' : 'Pin to the top',
      onSelect: () => {
        setPinned(!pinned);
        setNotePinned(firebaseUser.uid, courseId, noteId, !pinned).catch((err) => console.error(err));
      },
    },
    {
      id: 'pdf',
      label: 'Export as PDF',
      onSelect: () =>
        exportNotePdf({
          title: title.trim() || 'Untitled',
          className: course?.name,
          blocks: toPdfBlocks(blocksRef.current),
        }),
    },
    { id: 'find', label: 'Find in this note', onSelect: openFind },
    {
      id: 'structure',
      label: "Save this note's structure",
      onSelect: () => {
        setTemplateName(title.trim() && title.trim() !== 'Untitled' ? title.trim() : '');
        setSaveTemplateOpen(true);
      },
    },
    { id: 'back', label: 'Back to the course', onSelect: () => navigate(`/room/course/${courseId}`) },
  ];

  // What ⌘K offers while this note is open: Sage, tags, the ··· menu, and a new block
  // after the one the caret was last in (or at the end).
  usePageActions(() => {
    if (loading) return [];
    const insertTarget = pageBlocks.some((item) => item.id === activeBlockId)
      ? activeBlockId
      : pageBlocks[pageBlocks.length - 1]?.id;
    return [
      {
        id: 'note-sage',
        label: 'Ask Sage about this note',
        keywords: ['ai', 'improve', 'tidy', 'organize', 'summarize', 'rewrite', 'fix'],
        run: () => setSageOpen(true),
      },
      { id: 'note-tag', label: 'Add a tag', keywords: ['tags', 'label', '#'], run: () => setTagging(true) },
      // Typing "#exam" in ⌘K offers "Tag this note #exam".
      {
        id: 'note-tag-with',
        forTag: true,
        label: 'Tag this note',
        has: (tag) => tags.includes(tag),
        run: (tag) => saveTags(withTags(tags, tag)),
      },
      ...menuItems.map((item) => ({
        id: `note-${item.id}`,
        label: item.label,
        keywords: MENU_KEYWORDS[item.id],
        run: item.onSelect,
      })),
      ...INSERT_ACTIONS.map((action) => ({
        id: `note-insert-${action.type}`,
        label: action.label,
        keywords: ['add', 'block', 'new', ...action.keywords],
        run: () => insertAfter(insertTarget, action.type),
      })),
    ].map((action) => ({ hint: 'This note', ...action }));
  });

  return (
    <MathToolContext.Provider value={setMathTool}>
    <RoomShell
      back={course?.name || 'Course'}
      onBack={() => navigate(`/room/course/${courseId}`)}
      trailing={
        <>
          <span className="room-stamp room-saved">
            {online ? status : 'Offline · saved on this device'}
          </span>
          <Pill
            variant="accent"
            onClick={() => setSageOpen((shown) => !shown)}
            aria-expanded={sageOpen}
            disabled={loading}
          >
            <Dot />
            Sage
          </Pill>
          <span style={{ position: 'relative' }}>
            <button
              type="button"
              className="room-topline-link"
              data-menu-trigger=""
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More"
              aria-expanded={menuOpen}
            >
              ···
            </button>
            {menuOpen && (
              <MenuCard
                items={menuItems}
                onClose={() => setMenuOpen(false)}
                style={{ position: 'absolute', top: 34, right: 0 }}
              />
            )}
          </span>
        </>
      }
    >
      <div className="room-note">
        <div className="room-note-main">
          <div className="room-strip-dock">
            {mathTool ? (
              <MathStrip tool={mathTool} />
            ) : (
              <FormatStrip
                editor={activeEditor}
                onLink={() => setLinkOpen(true)}
                onNewSection={() => activeBlock && toggleSection(activeBlock)}
                sectionOn={activeBlock?.section}
                onFind={openFind}
              />
            )}
            {findOpen && (
              <div className="room-find" role="search">
                <input
                  ref={findInputRef}
                  className="room-find-input"
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      stepFind(e.shiftKey ? -1 : 1);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      closeFind();
                    }
                  }}
                  placeholder="Find in this note"
                  aria-label="Find in this note"
                  autoFocus
                />
                <span className="room-stamp room-find-count" aria-live="polite">
                  {findQuery.trim() ? findLabel(findState.index, findState.count) : ''}
                </span>
                <button
                  type="button"
                  className="room-find-btn"
                  onClick={() => stepFind(-1)}
                  disabled={!findState.count}
                  aria-label="Previous match"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="room-find-btn"
                  onClick={() => stepFind(1)}
                  disabled={!findState.count}
                  aria-label="Next match"
                >
                  →
                </button>
                <button type="button" className="room-find-btn" onClick={closeFind} aria-label="Close find">
                  ×
                </button>
              </div>
            )}
          </div>

          <Paper className="room-page" tilt={0.3} stagger={1} ref={pageRef}>
            <div className="room-page-meta">
              <span className="room-stamp">{course?.name}</span>
              {/* On a phone the save status moves here, out of a top line with no room for it. */}
              <span className="room-stamp room-saved room-saved--inline">
                {online ? status : 'Offline · saved on this device'}
              </span>
            </div>

            <input
              className="room-page-title"
              value={title}
              onChange={(e) => {
                touchedRef.current = true;
                setTitle(e.target.value);
              }}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              placeholder="Untitled"
              aria-label="Note title"
            />
            {!loading && (
              <NoteTags
                tags={tags}
                onChange={saveTags}
                onOpenTag={openTag}
                adding={tagging}
                onAdding={setTagging}
              />
            )}
            <div style={{ width: 64, marginTop: 18, color: 'var(--room-ink)' }}>
              <PencilRule />
            </div>

            {showTemplates && (
              <div className="room-templates">
                <span className="room-stamp">Start from</span>
                <div className="room-seg">
                  {PAGE_TEMPLATES.map((template) => (
                    <Chip key={template.id} onClick={() => applyTemplate(template)}>
                      {template.label}
                    </Chip>
                  ))}
                  {customTemplates.map((template) => (
                    <span key={template.id} className="room-template-own">
                      <Chip onClick={() => applyTemplate(template)}>{template.name}</Chip>
                      <button
                        type="button"
                        className="room-template-forget"
                        onClick={() =>
                          deleteRoomTemplate(firebaseUser.uid, template.id).catch((err) =>
                            console.error('Could not forget that template', err),
                          )
                        }
                        aria-label={`Forget the ${template.name} template`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <Chip onClick={() => setTemplatesDismissed(true)}>Blank</Chip>
                </div>
              </div>
            )}

            {loading ? (
              <p className="room-setting-copy" style={{ marginTop: 30 }}>
                Opening…
              </p>
            ) : (
              pageBlocks.map((block, index) => (
                <BlockRow
                  key={block.id}
                  isLast={index === pageBlocks.length - 1}
                  block={block}
                  sectionIndex={sectionIndexById.get(block.id) || 0}
                  accent={course?.color}
                  plusOpen={plusAt === block.id}
                  onChange={changeBlock}
                  onFocusBlock={focusBlock}
                  onTogglePlus={togglePlus}
                  onInsertAfter={insertAfter}
                  onToggleSection={toggleSection}
                  onRemove={removeBlock}
                  registerNode={registerNode}
                />
              ))
            )}
          </Paper>
        </div>

        <PinRail
          sections={sections}
          currentSection={currentSection || sections[0]?.id || ''}
          pins={pins}
          online={online}
          uploading={uploading}
          onJumpToSection={jumpToSection}
          onChangePins={patchBlocks}
          onRemovePin={removeBlock}
          onAddFiles={addPhotos}
        />
      </div>

      <SagePanel
        open={sageOpen}
        onClose={() => setSageOpen(false)}
        courseId={courseId}
        noteId={noteId}
        noteTitle={title.trim() || 'Untitled'}
        blocks={blocks}
        getBlocks={getBlocks}
        onReplace={replaceBlocks}
        versions={sageVersions}
        onVersions={setSageVersions}
        online={online}
        sections={sections}
        focusSection={focusSection}
        tags={tags}
        onAddTag={(tag) => saveTags(withTags(tags, tag))}
      />

      {undo && (
        <div className="room-undo">
          {undo.block.rail ? 'Photo taken down' : 'Block deleted'}
          <button type="button" className="room-you-action" onClick={restore}>
            Undo
          </button>
        </div>
      )}

      <Overlay
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        title="Save this note's structure"
      >
        <p className="room-setting-copy" style={{ fontSize: 15 }}>
          Its headings, sections and block types become a template. What you wrote under them
          stays in this note. It will show on every new blank note, next to Lecture and Reading.
        </p>
        <input
          className="room-field"
          style={{ marginTop: 16 }}
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveStructure();
          }}
          placeholder="Call it something"
          aria-label="Template name"
          maxLength={40}
          autoFocus
        />
        <div className="room-seg" style={{ marginTop: 22 }}>
          <Pill variant="primary" onClick={saveStructure}>
            Save it
          </Pill>
          <Pill onClick={() => setSaveTemplateOpen(false)}>Cancel</Pill>
        </div>
      </Overlay>

      <Overlay open={linkOpen} onClose={() => setLinkOpen(false)} title="Link">
        <input
          className="room-field"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://"
          aria-label="Address"
          autoFocus
        />
        <div className="room-seg" style={{ marginTop: 22 }}>
          <Pill variant="primary" onClick={applyLink}>
            {linkUrl.trim() ? 'Link it' : 'Remove the link'}
          </Pill>
          <Pill onClick={() => setLinkOpen(false)}>Cancel</Pill>
        </div>
      </Overlay>
    </RoomShell>
    </MathToolContext.Provider>
  );
};

// Keyed by the note, so opening another note is a fresh editor rather than the same one
// with its params swapped. Otherwise a keystroke landing while the next note loads would
// be saved INTO that next note — its save handler already points there while the old
// blocks are still on screen.
const RoomNoteRoute = () => {
  const { courseId, noteId } = useParams();
  return <RoomNote key={`${courseId}/${noteId}`} courseId={courseId} noteId={noteId} />;
};

export default RoomNoteRoute;
