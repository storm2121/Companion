import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCheck,
  FaCopy,
  FaEllipsisH,
  FaMoon,
  FaPen,
  FaPlus,
  FaSearch,
  FaStar,
  FaSun,
  FaThumbtack,
  FaTimes,
  FaTrash,
} from 'react-icons/fa';
import { FaCog, FaFilePdf, FaFilter, FaRegCalendarAlt, FaSignOutAlt } from 'react-icons/fa';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createNote,
  deleteClass,
  deleteNote,
  deleteNoteTemplate,
  deleteNotes,
  fetchNotesForClasses,
  getNote,
  getNoteText,
  listenToClasses,
  listenToNoteTemplates,
  listenToNotes,
  moveNotes,
  renameClass,
  reorderClasses,
  reorderNotes,
  setClassNoteCount,
  setNotePinned,
  updateNote,
} from '../services/library';
import { useAuth } from '../context/authState';
import {
  DASHBOARD_RETURN_CLASS_KEY,
  TEMPLATE_DRAFT_STORAGE_KEY,
  TEMPLATE_RESULT_STORAGE_KEY,
} from '../utils/offlineData';
import AddClassSheet from '../components/classes/AddClassSheet';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import {
  createImageObjectName,
  IMAGE_ACCEPT,
  NOTE_IMAGE_MAX_BYTES,
  validateImageFile,
} from '../utils/imageUpload';
import { THEME_DEFAULT_MODE, THEME_OPTIONS, THEME_PRESETS } from '../themePresets';
import {
  DEFAULT_TEMPLATE_ID,
  NOTE_TEMPLATES,
  WORKSPACE_WIDTH,
  buildTemplateBlocks,
} from '../data/noteTemplates';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { eventCountdownLabel, eventDaysFromToday } from '../utils/eventTime';
import { exportNotePdf } from '../utils/exportPdf';

const toNoteMeta = (docSnap) => {
  const meta = { ...(docSnap.data() || {}) };
  delete meta.blocks;
  delete meta.canvasHeight;
  return { id: docSnap.id, ...meta };
};

// Session-scoped snapshot cache: when you navigate back from the calendar/editor the
// dashboard paints instantly from the last snapshot instead of flashing empty while
// the Firestore listeners re-attach. Listeners then refresh it silently.
const dashCache = {
  classes: [],
  selectedClassId: '',
  notesByClass: new Map(),
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const reorderList = (list, fromId, toId) => {
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return list;
  const updated = [...list];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  return updated;
};

const getNoteTimestamp = (note) => {
  const updated = note?.updatedAt?.toMillis?.();
  if (Number.isFinite(updated)) return updated;
  const created = note?.createdAt?.toMillis?.();
  if (Number.isFinite(created)) return created;
  return 0;
};

const normalizeThemeMode = (mode) => (THEME_PRESETS[mode] ? mode : THEME_DEFAULT_MODE);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const noteDate = (note) => note?.createdAt?.toDate?.() || note?.updatedAt?.toDate?.() || null;

const keyForDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayKeyOf = (note) => {
  const d = noteDate(note);
  if (!d) return 'earlier';
  return keyForDate(d);
};

const dayLabelOf = (key) => {
  if (key === 'earlier') return 'Earlier';
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const diff = Math.round((today - d) / 86400000);
  const stamp = `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (diff === 0) return `Today · ${stamp}`;
  if (diff === 1) return `Yesterday · ${stamp}`;
  return stamp;
};

const noteTimeLabel = (note) => {
  const d = noteDate(note);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Quick notes get a hot chip; custom-template notes a neutral one; everything else
// reads as a lecture note. Heuristic on title/template since notes don't store a kind.
const kindOf = (note) => {
  if (/^Quick Note( \d+)?$/i.test((note?.title || '').trim())) return { label: 'QCK', hot: true };
  if ((note?.templateId || '').startsWith(CUSTOM_TEMPLATE_PREFIX)) return { label: 'TPL', hot: false };
  return { label: 'LEC', hot: false };
};

const Grip = () => (
  <span className="grip" aria-hidden="true">
    <i /><i /><i /><i /><i /><i />
  </span>
);

// Fixed design canvas for built-in templates — deterministic geometry on every machine,
// tuned for the common 1280–1536px editor viewport.
const TEMPLATE_DESIGN_W = 1080;
const TEMPLATE_DESIGN_H = 720;

// Mini wireframe of a template: each block drawn as a tiny rounded rect, positioned by
// percentage of the template's design canvas.
const TemplatePreview = ({ template }) => {
  let rects;
  let viewW = TEMPLATE_DESIGN_W;
  let viewH = TEMPLATE_DESIGN_H;
  if (template.kind === 'custom') {
    rects = (template.blocks || []).filter((b) => Number.isFinite(b?.x) && Number.isFinite(b?.y));
    rects.forEach((b) => {
      viewW = Math.max(viewW, (b.x || 0) + (b.w || 200));
      viewH = Math.max(viewH, (b.y || 0) + (b.h || 150));
    });
  } else if (template.id === DEFAULT_TEMPLATE_ID) {
    rects = [{ x: (TEMPLATE_DESIGN_W - 640) / 2, y: 56, w: 640, h: 360 }];
  } else {
    rects = buildTemplateBlocks(template.id, {
      canvasWidth: TEMPLATE_DESIGN_W,
      canvasHeight: TEMPLATE_DESIGN_H,
    });
  }
  return (
    <span className="tpl-preview" aria-hidden="true">
      {rects.slice(0, 8).map((b, i) => (
        <i
          key={i}
          style={{
            left: `${((b.x || 0) / viewW) * 100}%`,
            top: `${((b.y || 0) / viewH) * 100}%`,
            width: `${(Math.max(b.w || 200, 40) / viewW) * 100}%`,
            height: `${(Math.max(b.h || 150, 30) / viewH) * 100}%`,
          }}
        />
      ))}
      {rects.length === 0 && <em className="tpl-preview-empty" />}
    </span>
  );
};
const CUSTOM_TEMPLATE_PREFIX = 'custom:';

const toCustomTemplateId = (id) => `${CUSTOM_TEMPLATE_PREFIX}${id}`;

const cloneTemplateBlocks = (blocks = []) => blocks.map((block) => ({ ...block }));

const Dashboard = () => {
  const { firebaseUser, profile, logout, updateThemeMode, applyThemeMode, updateNoteTemplateDefault } = useAuth();
  const [classes, setClasses] = useState(() => dashCache.classes);
  const [customTemplates, setCustomTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(() => dashCache.selectedClassId);
  const [notes, setNotes] = useState(
    () => dashCache.notesByClass.get(dashCache.selectedClassId) || [],
  );
  // Which class the `notes` array actually belongs to. Until the listener for a newly
  // selected class fires, `notes` still holds the previous class's docs — using it for
  // counts/heals would briefly mimic the previous class.
  const [notesClassId, setNotesClassId] = useState(() =>
    dashCache.notesByClass.has(dashCache.selectedClassId) ? dashCache.selectedClassId : '',
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState('class'); // 'class' | 'all'
  const [searchInContent, setSearchInContent] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [allNotes, setAllNotes] = useState([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [contentMatchIds, setContentMatchIds] = useState(() => new Set());
  const [contentSnippets, setContentSnippets] = useState(() => new Map());
  const [contentSearching, setContentSearching] = useState(false);
  const noteTextCacheRef = useRef(new Map());
  const filterMenuRef = useRef(null);
  const [mobilePane, setMobilePane] = useState('classes');
  const [menuOpenId, setMenuOpenId] = useState('');
  const [classEditTarget, setClassEditTarget] = useState(null);
  const [noteMenuOpenId, setNoteMenuOpenId] = useState('');
  const [noteMenuUp, setNoteMenuUp] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [draggingId, setDraggingId] = useState('');
  const [noteDraggingId, setNoteDraggingId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [noteDeleteTarget, setNoteDeleteTarget] = useState(null);
  const [noteDeleting, setNoteDeleting] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteModalMode, setNoteModalMode] = useState('create');
  const [noteModalNote, setNoteModalNote] = useState(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteSummary, setNoteSummary] = useState('');
  const [noteImageFile, setNoteImageFile] = useState(null);
  const [noteImagePreview, setNoteImagePreview] = useState('');
  const [noteFocus, setNoteFocus] = useState('title');
  const [noteSaving, setNoteSaving] = useState(false);
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [templatePromptOpen, setTemplatePromptOpen] = useState(false);
  const [templatePromptName, setTemplatePromptName] = useState('');
  const [templateDeleteTarget, setTemplateDeleteTarget] = useState(null);
  const [templateDeleting, setTemplateDeleting] = useState(false);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [themeMode, setThemeMode] = useState(THEME_DEFAULT_MODE);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [renamingClassId, setRenamingClassId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [clock, setClock] = useState('');
  const [toast, setToast] = useState(null);
  const [flashNoteId, setFlashNoteId] = useState('');
  const searchInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const dragDayKeyRef = useRef('');
  const titleRef = useRef(null);
  const summaryRef = useRef(null);
  const imageRef = useRef(null);
  const templatePromptRef = useRef(null);
  const preferredClassIdRef = useRef('');
  const templateRestoreDoneRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOnline = useNetworkStatus();
  const availableTemplates = useMemo(() => {
    const builtins = NOTE_TEMPLATES.map((template) => ({
      id: template.id,
      label: template.label,
      description:
        template.id === DEFAULT_TEMPLATE_ID ? 'One block, ready to type.' : template.description,
      autoTitlePrefix: template.autoTitlePrefix,
      layout: template.layout || null,
      kind: 'builtin',
      blocks: [],
      canvasHeight: 720,
    }));
    const custom = customTemplates.map((template) => ({
      id: toCustomTemplateId(template.id),
      sourceId: template.id,
      label: template.name || 'Custom template',
      description: 'Your custom layout.',
      autoTitlePrefix: template.name || 'Template',
      kind: 'custom',
      blocks: Array.isArray(template.blocks) ? template.blocks : [],
      canvasHeight: Number.isFinite(template.canvasHeight) ? template.canvasHeight : 720,
    }));
    return [...builtins, ...custom];
  }, [customTemplates]);
  const resolveTemplateById = useMemo(() => {
    const templateMap = new Map(availableTemplates.map((item) => [item.id, item]));
    return (id) => templateMap.get(id) || availableTemplates[0];
  }, [availableTemplates]);
  const moveOptions = useMemo(
    () => classes.filter((item) => item.id !== selectedClassId),
    [classes, selectedClassId],
  );

  useEffect(() => {
    const queryClassId = searchParams.get('class') || '';
    const stateClassId =
      typeof location.state?.selectedClassId === 'string' ? location.state.selectedClassId : '';
    let storedClassId = '';
    try {
      storedClassId = sessionStorage.getItem(DASHBOARD_RETURN_CLASS_KEY) || '';
    } catch {
      storedClassId = '';
    }
    const preferred = stateClassId || queryClassId || storedClassId;
    if (!preferred) return;
    preferredClassIdRef.current = preferred;
    setSelectedClassId((current) => (current === preferred ? current : preferred));
    if (storedClassId && storedClassId === preferred) {
      try {
        sessionStorage.removeItem(DASHBOARD_RETURN_CLASS_KEY);
      } catch {
        // Ignore storage cleanup failures in restricted environments.
      }
    }
  }, [location.state, searchParams]);

  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = listenToClasses(
      firebaseUser.uid,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setClasses(items);
        dashCache.classes = items;
        setSelectedClassId((current) => {
          const preferredClassId = preferredClassIdRef.current;
          if (preferredClassId) {
            preferredClassIdRef.current = '';
            if (items.some((item) => item.id === preferredClassId)) {
              return preferredClassId;
            }
          }
          if (current && items.find((item) => item.id === current)) return current;
          return items[0]?.id || '';
        });
      },
      (err) => console.error(err),
    );
    return () => unsub();
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) {
      setCustomTemplates([]);
      setTemplatesLoaded(false);
      return;
    }
    const unsub = listenToNoteTemplates(
      firebaseUser.uid,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setCustomTemplates(items);
        setTemplatesLoaded(true);
      },
      (err) => {
        console.error(err);
        setTemplatesLoaded(true);
      },
    );
    return () => unsub();
  }, [firebaseUser]);

  useEffect(() => {
    const queryClassId = searchParams.get('class');
    if (!queryClassId || selectedClassId !== queryClassId) return;
    const next = new URLSearchParams(searchParams);
    next.delete('class');
    setSearchParams(next, { replace: true });
  }, [selectedClassId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!firebaseUser || !selectedClassId) {
      setNotes([]);
      setNotesClassId('');
      return;
    }
    const classId = selectedClassId;
    const unsub = listenToNotes(
      firebaseUser.uid,
      classId,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => toNoteMeta(docSnap));
        const ordered = [...items].sort((a, b) => {
          const aHasOrder = Number.isFinite(a.order);
          const bHasOrder = Number.isFinite(b.order);
          if (aHasOrder && bHasOrder) return a.order - b.order;
          if (aHasOrder) return -1;
          if (bHasOrder) return 1;
          return getNoteTimestamp(b) - getNoteTimestamp(a);
        });
        setNotes(ordered);
        setNotesClassId(classId);
        dashCache.notesByClass.set(classId, ordered);
      },
      (err) => console.error(err),
    );
    return () => unsub();
  }, [firebaseUser, selectedClassId]);

  useEffect(() => {
    dashCache.selectedClassId = selectedClassId;
  }, [selectedClassId]);

  useEffect(() => {
    setSelectedNoteIds([]);
    setMoveTargetId('');
    setNoteDraggingId('');
    setSearch('');
  }, [selectedClassId]);

  // Self-heal: if a class's stored noteCount drifted from its real notes, correct it.
  // Debounced so it ignores the brief mismatch while an add/delete's increment propagates.
  // Gated on notesClassId so we never "heal" with the previous class's notes.
  useEffect(() => {
    if (!firebaseUser || !selectedClassId || notesClassId !== selectedClassId) return undefined;
    const cls = classes.find((item) => item.id === selectedClassId);
    if (!cls || (cls.noteCount || 0) === notes.length) return undefined;
    const timer = setTimeout(() => {
      setClassNoteCount(firebaseUser.uid, selectedClassId, notes.length).catch((err) =>
        console.error('Failed to reconcile note count', err),
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [firebaseUser, selectedClassId, notesClassId, notes.length, classes]);

  // Global search: pull note metadata across every class when the scope is "all".
  useEffect(() => {
    if (searchScope !== 'all' || !firebaseUser || !classes.length) return undefined;
    let cancelled = false;
    setGlobalLoading(true);
    fetchNotesForClasses(
      firebaseUser.uid,
      classes.map((c) => ({ id: c.id, name: c.name })),
    )
      .then((items) => {
        if (!cancelled) setAllNotes(items);
      })
      .catch((err) => console.error('Global notes fetch failed', err))
      .finally(() => {
        if (!cancelled) setGlobalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchScope, firebaseUser, classes]);

  useEffect(() => {
    if (!selectedNoteIds.length) return;
    setSelectedNoteIds((prev) => prev.filter((id) => notes.some((note) => note.id === id)));
  }, [notes, selectedNoteIds.length]);

  useEffect(() => {
    if (!selectedNoteIds.length) {
      setMoveTargetId('');
      return;
    }
    if (!moveOptions.length) {
      setMoveTargetId('');
      return;
    }
    if (!moveOptions.find((item) => item.id === moveTargetId)) {
      setMoveTargetId(moveOptions[0].id);
    }
  }, [selectedNoteIds.length, moveOptions, moveTargetId]);

  useEffect(() => {
    setThemeMode(normalizeThemeMode(profile?.themeMode));
  }, [profile?.themeMode]);

  useEffect(() => {
    if (!firebaseUser) return;
    const currentValue = normalizeThemeMode(profile?.themeMode);
    if (themeMode === currentValue) return;
    const timeout = setTimeout(() => {
      updateThemeMode(normalizeThemeMode(themeMode)).catch((err) => {
        console.error('Failed to update theme mode', err);
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [themeMode, firebaseUser, profile?.themeMode, updateThemeMode]);

  useEffect(() => {
    if (!noteModalOpen) return;
    if (noteFocus === 'summary') {
      summaryRef.current?.focus();
    } else if (noteFocus === 'image') {
      imageRef.current?.focus();
    } else {
      titleRef.current?.focus();
    }
  }, [noteModalOpen, noteFocus]);

  useEffect(() => {
    if (!noteModalOpen) return;
    if (noteImageFile) {
      const url = URL.createObjectURL(noteImageFile);
      setNoteImagePreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setNoteImagePreview(noteModalNote?.coverUrl || '');
  }, [noteModalOpen, noteImageFile, noteModalNote]);

  useEffect(() => {
    if (!templatePromptOpen) return;
    templatePromptRef.current?.focus();
  }, [templatePromptOpen]);

  useEffect(() => {
    templateRestoreDoneRef.current = false;
  }, [firebaseUser?.uid]);

  useEffect(() => {
    if (!firebaseUser || templateRestoreDoneRef.current) return;
    let draftRaw = '';
    let resultRaw = '';
    try {
      draftRaw = sessionStorage.getItem(TEMPLATE_DRAFT_STORAGE_KEY) || '';
      resultRaw = sessionStorage.getItem(TEMPLATE_RESULT_STORAGE_KEY) || '';
    } catch {
      draftRaw = '';
      resultRaw = '';
    }
    if (!draftRaw) return;
    let draft = null;
    let result = null;
    try {
      draft = JSON.parse(draftRaw);
    } catch {
      draft = null;
    }
    try {
      result = resultRaw ? JSON.parse(resultRaw) : null;
    } catch {
      result = null;
    }
    if (!draft || draft.uid !== firebaseUser.uid) {
      try {
        sessionStorage.removeItem(TEMPLATE_DRAFT_STORAGE_KEY);
        sessionStorage.removeItem(TEMPLATE_RESULT_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }
      return;
    }
    const resultTemplateId =
      result && result.uid === firebaseUser.uid && typeof result.templateId === 'string'
        ? result.templateId
        : '';
    if (
      resultTemplateId &&
      !availableTemplates.some((item) => item.id === resultTemplateId) &&
      !templatesLoaded
    ) {
      return;
    }
    templateRestoreDoneRef.current = true;
    try {
      sessionStorage.removeItem(TEMPLATE_DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(TEMPLATE_RESULT_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
    const resultTemplate =
      resultTemplateId && availableTemplates.some((item) => item.id === resultTemplateId)
        ? resultTemplateId
        : '';
    const draftTemplate =
      typeof draft.templateId === 'string' && availableTemplates.some((item) => item.id === draft.templateId)
        ? draft.templateId
        : '';
    const restoredTemplateId = resultTemplate || draftTemplate || DEFAULT_TEMPLATE_ID;
    const restoredClassId = typeof draft.classId === 'string' ? draft.classId : '';
    if (restoredClassId) {
      preferredClassIdRef.current = restoredClassId;
      setSelectedClassId((current) => current || restoredClassId);
    }
    setNoteMenuOpenId('');
    setNoteModalMode('create');
    setNoteModalNote(null);
    setNoteTitle(draft.noteTitle || '');
    setNoteSummary(draft.noteSummary || '');
    setNoteImageFile(null);
    setNoteImagePreview('');
    setNoteFocus('title');
    setTemplateId(restoredTemplateId);
    setNoteModalOpen(true);
  }, [firebaseUser, availableTemplates, templatesLoaded]);

  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const trimmedSearch = search.trim().toLowerCase();
  const searchTokens = useMemo(
    () => trimmedSearch.split(' ').map((token) => token.trim()).filter(Boolean),
    [trimmedSearch],
  );
  const searchActive = Boolean(trimmedSearch);

  const matchesMeta = (note) => {
    const tags = (note.tags || []).join(' ');
    const haystack = `${note.title || ''} ${note.summary || ''} ${tags} ${note.className || ''}`.toLowerCase();
    return searchTokens.every((token) => haystack.includes(token));
  };

  // "Search inside notes": fetch + match note content text (cache-first, debounced).
  useEffect(() => {
    if (!searchActive || !searchInContent || !firebaseUser) {
      setContentMatchIds(new Set());
      setContentSnippets(new Map());
      setContentSearching(false);
      return undefined;
    }
    const source =
      searchScope === 'all'
        ? allNotes
        : notes.map((note) => ({ ...note, classId: selectedClassId }));
    let cancelled = false;
    setContentSearching(true);
    const handle = setTimeout(async () => {
      const cache = noteTextCacheRef.current;
      const matches = new Set();
      const snippets = new Map();
      for (const note of source) {
        if (cancelled) return;
        if (matchesMeta(note)) {
          matches.add(note.id);
          continue;
        }
        const stamp =
          note.contentUpdatedAt?.toMillis?.() || note.updatedAt?.toMillis?.() || 0;
        const cacheKey = `${note.classId}:${note.id}:${stamp}`;
        let text = cache.get(cacheKey);
        if (text === undefined) {
          text = await getNoteText(firebaseUser.uid, note.classId, note.id);
          cache.set(cacheKey, text);
        }
        const lower = text.toLowerCase();
        if (searchTokens.every((token) => lower.includes(token))) {
          matches.add(note.id);
          // Excerpt around the first hit, original casing preserved.
          const token = searchTokens[0];
          const at = lower.indexOf(token);
          if (at >= 0) {
            const start = Math.max(0, at - 44);
            const end = Math.min(text.length, at + token.length + 64);
            snippets.set(note.id, {
              before: (start > 0 ? '…' : '') + text.slice(start, at),
              hit: text.slice(at, at + token.length),
              after: text.slice(at + token.length, end) + (end < text.length ? '…' : ''),
            });
          }
        }
      }
      if (!cancelled) {
        setContentMatchIds(matches);
        setContentSnippets(snippets);
        setContentSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // matchesMeta is derived from searchTokens (already a dep); intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, searchInContent, searchScope, allNotes, notes, selectedClassId, searchTokens, firebaseUser]);

  // Unified groups for the notes panel: pinned + day groups when browsing; class or
  // day groups when searching (scoped to this class or all classes).
  const displayGroups = useMemo(() => {
    const sortDays = (groups) =>
      groups.sort((a, b) =>
        a.key === 'earlier' ? 1 : b.key === 'earlier' ? -1 : b.key.localeCompare(a.key),
      );
    const toDayGroups = (list) => {
      const groups = [];
      list.forEach((note) => {
        const key = dayKeyOf(note);
        const existing = groups.find((group) => group.key === key);
        if (existing) existing.notes.push(note);
        else groups.push({ key, label: dayLabelOf(key), kind: 'day', notes: [note] });
      });
      return sortDays(groups);
    };

    if (!searchActive) {
      const pinned = notes.filter((note) => note.pinned);
      const rest = notes.filter((note) => !note.pinned);
      const groups = [];
      if (pinned.length) groups.push({ key: '__pinned', label: 'Pinned', kind: 'pinned', notes: pinned });
      return groups.concat(toDayGroups(rest));
    }

    const source =
      searchScope === 'all'
        ? allNotes
        : notes.map((note) => ({ ...note, classId: selectedClassId, className: selectedClass?.name }));
    const results = source.filter(
      (note) => matchesMeta(note) || (searchInContent && contentMatchIds.has(note.id)),
    );

    if (searchScope === 'all') {
      const byClass = [];
      results.forEach((note) => {
        const existing = byClass.find((group) => group.key === note.classId);
        if (existing) existing.notes.push(note);
        else byClass.push({ key: note.classId, label: note.className || 'Class', kind: 'class', notes: [note] });
      });
      return byClass.sort((a, b) => a.label.localeCompare(b.label));
    }
    return toDayGroups(results);
    // matchesMeta derived from searchTokens; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchActive,
    notes,
    searchScope,
    allNotes,
    selectedClassId,
    selectedClass,
    searchInContent,
    contentMatchIds,
    searchTokens,
  ]);

  const resultCount = useMemo(
    () => displayGroups.reduce((sum, group) => sum + group.notes.length, 0),
    [displayGroups],
  );
  const selectedNotes = useMemo(
    () => notes.filter((note) => selectedNoteIds.includes(note.id)),
    [notes, selectedNoteIds],
  );
  const defaultTemplateId = profile?.noteTemplateDefault || DEFAULT_TEMPLATE_ID;
  const defaultTemplate = useMemo(
    () => resolveTemplateById(defaultTemplateId),
    [defaultTemplateId, resolveTemplateById],
  );

  const getAutoTitle = (prefix) => {
    if (!prefix) return 'Untitled Note';
    const pattern = new RegExp(`^${escapeRegExp(prefix)}\\s*(\\d+)$`, 'i');
    let maxNumber = 0;
    notes.forEach((note) => {
      const title = note.title || '';
      const match = title.match(pattern);
      if (match) {
        const value = Number(match[1]);
        if (!Number.isNaN(value)) {
          maxNumber = Math.max(maxNumber, value);
        }
      }
    });
    return `${prefix} ${maxNumber + 1}`;
  };

  const getNextNoteOrder = () => {
    const maxOrder = notes.reduce((max, note) => {
      if (!Number.isFinite(note.order)) return max;
      return Math.max(max, note.order);
    }, -1);
    return maxOrder + 1;
  };

  const handleSelectClass = (classId) => {
    setSelectedClassId(classId);
    setMobilePane('notes');
    setMenuOpenId('');
    setNoteMenuOpenId('');
  };

  // Blocks for a NEW note from a template. Existing notes never hit this — they load
  // their own stored blocks — so this is safe to change. Layouts are built on the
  // fixed design canvas, then shifted to the center of the big editor workspace; the
  // editor auto-centers the viewport on the content when the note opens.
  const getTemplateBlocks = (template) => {
    if (template?.kind === 'custom') return cloneTemplateBlocks(template.blocks || []);
    const centerShift = Math.round((WORKSPACE_WIDTH - TEMPLATE_DESIGN_W) / 2);
    // Blank no longer means "empty void": seed one centered, ready-to-type text block.
    if (!template || template.id === DEFAULT_TEMPLATE_ID || template.id === 'blank') {
      return [
        {
          type: 'text',
          title: '',
          x: Math.round((WORKSPACE_WIDTH - 640) / 2),
          y: 56,
          w: 640,
          h: 360,
        },
      ];
    }
    return buildTemplateBlocks(template.id, {
      canvasWidth: TEMPLATE_DESIGN_W,
      canvasHeight: TEMPLATE_DESIGN_H,
    }).map((block) => ({ ...block, x: (block.x || 0) + centerShift }));
  };

  const findTemplateById = (id) => {
    if (typeof id !== 'string' || !id.trim()) return availableTemplates[0];
    const found = availableTemplates.find((item) => item.id === id);
    return found || availableTemplates[0];
  };

  const handleOpenCreateNote = () => {
    if (!selectedClassId) return;
    setNoteMenuOpenId('');
    setNoteModalMode('create');
    setNoteModalNote(null);
    setNoteTitle('');
    setNoteSummary('');
    setNoteImageFile(null);
    setNoteImagePreview('');
    setNoteFocus('title');
    setTemplateId(defaultTemplate?.id || DEFAULT_TEMPLATE_ID);
    setNoteModalOpen(true);
  };

  const handleQuickAddNote = async () => {
    if (!firebaseUser || !selectedClassId || quickAddBusy) return;
    setQuickAddBusy(true);
    try {
      const template = findTemplateById(defaultTemplate?.id || defaultTemplateId);
      const title = getAutoTitle(template.autoTitlePrefix || 'Quick Note');
      const nextOrder = getNextNoteOrder();
      const blocks = getTemplateBlocks(template);
      const noteId = await createNote(firebaseUser.uid, selectedClassId, {
        title,
        summary: '',
        coverUrl: '',
        blocks,
        canvasHeight: Number.isFinite(template.canvasHeight) ? template.canvasHeight : 720,
        templateId: template.id,
        order: nextOrder,
      });
      navigate(`/class/${selectedClassId}/note/${noteId}`);
    } catch (err) {
      console.error('Failed to quick add note', err);
    } finally {
      setQuickAddBusy(false);
    }
  };

  const beginTemplateBuilderFlow = (name) => {
    if (!firebaseUser || !selectedClassId) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const draft = {
      uid: firebaseUser.uid,
      classId: selectedClassId,
      noteTitle,
      noteSummary,
      templateId,
      savedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(TEMPLATE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      sessionStorage.removeItem(TEMPLATE_RESULT_STORAGE_KEY);
    } catch {
      // Ignore storage failures in restricted browsers.
    }
    setTemplatePromptOpen(false);
    setTemplatePromptName('');
    navigate('/template/new', {
      state: {
        templateMode: true,
        templateName: trimmedName,
      },
    });
  };

  const handleOpenTemplatePrompt = () => {
    if (noteModalMode !== 'create') return;
    setTemplatePromptName('');
    setTemplatePromptOpen(true);
  };

  const handleCloseTemplatePrompt = () => {
    setTemplatePromptOpen(false);
    setTemplatePromptName('');
  };

  const handleConfirmTemplatePrompt = () => {
    const trimmed = templatePromptName.trim();
    if (!trimmed) return;
    beginTemplateBuilderFlow(trimmed);
  };

  const requestTemplateDelete = (template) => {
    if (!template || template.kind !== 'custom') return;
    setTemplateDeleteTarget(template);
  };

  const cancelTemplateDelete = () => {
    if (templateDeleting) return;
    setTemplateDeleteTarget(null);
  };

  const confirmTemplateDelete = async () => {
    if (!firebaseUser || !templateDeleteTarget?.sourceId) return;
    setTemplateDeleting(true);
    try {
      await deleteNoteTemplate(firebaseUser.uid, templateDeleteTarget.sourceId);
      if (templateId === templateDeleteTarget.id) {
        setTemplateId(DEFAULT_TEMPLATE_ID);
      }
      if (profile?.noteTemplateDefault === templateDeleteTarget.id) {
        await updateNoteTemplateDefault(DEFAULT_TEMPLATE_ID);
          }
      setTemplateDeleteTarget(null);
    } catch (err) {
      console.error('Failed to delete custom template', err);
    } finally {
      setTemplateDeleting(false);
    }
  };

  const handleOpenEditNote = (note, focusField) => {
    setNoteMenuOpenId('');
    setNoteModalMode('edit');
    setNoteModalNote(note);
    setNoteTitle(note.title || '');
    setNoteSummary(note.summary || '');
    setNoteImageFile(null);
    setNoteImagePreview(note.coverUrl || '');
    setNoteFocus(focusField);
    setNoteModalOpen(true);
  };

  const closeNoteModal = useCallback(() => {
    if (noteSaving) return;
    setNoteModalOpen(false);
    setNoteModalNote(null);
    setNoteTitle('');
    setNoteSummary('');
    setNoteImageFile(null);
    setNoteImagePreview('');
    setTemplatePromptOpen(false);
    setTemplatePromptName('');
    setTemplateDeleteTarget(null);
    setTemplateDeleting(false);
  }, [noteSaving]);

  useEffect(() => {
    if (!noteModalOpen) return;
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeNoteModal();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [noteModalOpen, closeNoteModal]);

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      let h = n.getHours();
      const m = String(n.getMinutes()).padStart(2, '0');
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      setClock(`${h}:${m} ${ap}`);
    };
    tick();
    const iv = setInterval(tick, 10000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(toastTimerRef.current);
      clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const handlePointer = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!filterMenuOpen) return undefined;
    const handlePointer = (event) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [filterMenuOpen]);

  const uploadCover = async (noteId) => {
    if (!firebaseUser || !noteImageFile) return '';
    validateImageFile(noteImageFile, { maxBytes: NOTE_IMAGE_MAX_BYTES, label: 'Cover image' });
    const ref = storageRef(
      storage,
      `notes/${firebaseUser.uid}/${noteId}/${createImageObjectName(noteImageFile, 'cover')}`,
    );
    await uploadBytes(ref, noteImageFile, {
      contentType: noteImageFile.type || undefined,
      cacheControl: 'public,max-age=31536000,immutable',
    });
    return getDownloadURL(ref);
  };

  const handleSaveNote = async () => {
    if (!firebaseUser || !selectedClassId) return;
    if (!noteTitle.trim()) return;
    setNoteSaving(true);
    try {
      if (noteModalMode === 'create') {
        const template = findTemplateById(templateId || defaultTemplateId);
        const nextOrder = getNextNoteOrder();
        const blocks = getTemplateBlocks(template);
        const noteId = await createNote(firebaseUser.uid, selectedClassId, {
          title: noteTitle.trim(),
          summary: noteSummary.trim(),
          coverUrl: '',
          blocks,
          canvasHeight: Number.isFinite(template.canvasHeight) ? template.canvasHeight : 720,
          templateId: template.id,
          order: nextOrder,
        });
        if (noteImageFile) {
          const url = await uploadCover(noteId);
          await updateNote(firebaseUser.uid, selectedClassId, noteId, { coverUrl: url });
        }
        closeNoteModal();
        navigate(`/class/${selectedClassId}/note/${noteId}`);
      } else if (noteModalNote) {
        let coverUrl = noteModalNote.coverUrl || '';
        if (noteImageFile) {
          coverUrl = await uploadCover(noteModalNote.id);
        }
        await updateNote(firebaseUser.uid, selectedClassId, noteModalNote.id, {
          title: noteTitle.trim(),
          summary: noteSummary.trim(),
          coverUrl,
        });
        closeNoteModal();
      }
    } catch (err) {
      console.error('Failed to save note', err);
    } finally {
      setNoteSaving(false);
    }
  };

  const toggleMenu = (classId) => {
    setMenuOpenId((current) => (current === classId ? '' : classId));
  };

  const toggleNoteMenu = (noteId, event) => {
    // If the trigger sits in the bottom stretch of the screen, open the menu upward
    // so it never extends the scrollable list.
    if (event?.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      setNoteMenuUp(window.innerHeight - rect.bottom < 250);
    }
    setNoteMenuOpenId((current) => (current === noteId ? '' : noteId));
    setMenuOpenId('');
  };

  const openClassSheet = (target = null) => {
    setClassEditTarget(target);
    setMenuOpenId('');
    setSheetOpen(true);
  };

  const closeClassSheet = () => {
    setSheetOpen(false);
    setClassEditTarget(null);
  };

  const toggleNoteSelection = (noteId) => {
    setSelectedNoteIds((prev) =>
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId],
    );
  };

  const clearNoteSelection = () => {
    setSelectedNoteIds([]);
    setMoveTargetId('');
  };

  const requestBulkDelete = () => {
    if (!selectedNoteIds.length) return;
    setBulkDeleteOpen(true);
  };

  const cancelBulkDelete = () => {
    if (bulkDeleting) return;
    setBulkDeleteOpen(false);
  };

  const confirmBulkDelete = async () => {
    if (!firebaseUser || !selectedClassId || !selectedNoteIds.length) return;
    setBulkDeleting(true);
    try {
      const removed = selectedNoteIds.length;
      await deleteNotes(firebaseUser.uid, selectedClassId, selectedNoteIds);
      clearNoteSelection();
      setBulkDeleteOpen(false);
      showToast(`Deleted ${removed} ${removed === 1 ? 'note' : 'notes'}`);
    } catch (err) {
      console.error('Failed to delete notes', err);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleMoveNotes = async () => {
    if (!firebaseUser || !selectedClassId || !moveTargetId || !selectedNotes.length) return;
    setMoveBusy(true);
    try {
      const movedCount = selectedNotes.length;
      const targetName = classes.find((item) => item.id === moveTargetId)?.name || 'class';
      await moveNotes(firebaseUser.uid, selectedClassId, moveTargetId, selectedNotes);
      clearNoteSelection();
      showToast(`Moved ${movedCount} ${movedCount === 1 ? 'note' : 'notes'} to ${targetName}`);
    } catch (err) {
      console.error('Failed to move notes', err);
    } finally {
      setMoveBusy(false);
    }
  };

  const startRenameClass = (item) => {
    setRenamingClassId(item.id);
    setRenameDraft(item.name || '');
    setMenuOpenId('');
  };

  const cancelRenameClass = () => {
    setRenamingClassId('');
    setRenameDraft('');
  };

  const commitRenameClass = async (classId) => {
    const nextName = renameDraft.trim();
    const target = classes.find((item) => item.id === classId);
    if (!firebaseUser || !nextName || (target && nextName === target.name)) {
      cancelRenameClass();
      return;
    }
    try {
      await renameClass(firebaseUser.uid, classId, nextName);
      showToast('Renamed');
    } catch (err) {
      console.error('Failed to rename class', err);
    } finally {
      cancelRenameClass();
    }
  };

  const requestDelete = (item) => {
    setDeleteTarget(item);
    setMenuOpenId('');
  };

  const cancelDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
  };

  const confirmDelete = async () => {
    if (!firebaseUser || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClass(firebaseUser.uid, deleteTarget.id);
      showToast('Class deleted');
    } catch (err) {
      console.error('Failed to delete class', err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const requestNoteDelete = (note) => {
    setNoteDeleteTarget(note);
    setNoteMenuOpenId('');
  };

  const cancelNoteDelete = () => {
    if (noteDeleting) return;
    setNoteDeleteTarget(null);
  };

  const confirmNoteDelete = async () => {
    if (!firebaseUser || !selectedClassId || !noteDeleteTarget) return;
    setNoteDeleting(true);
    try {
      await deleteNote(firebaseUser.uid, selectedClassId, noteDeleteTarget.id);
      showToast('Note deleted');
    } catch (err) {
      console.error('Failed to delete note', err);
    } finally {
      setNoteDeleting(false);
      setNoteDeleteTarget(null);
    }
  };

  const handleDragStart = (event, classId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `class:${classId}`);
    setDraggingId(classId);
  };

  const handleClassDragEnter = (classId) => {
    if (!draggingId || draggingId === classId) return;
    setClasses((prev) => reorderList(prev, draggingId, classId));
  };

  const handleDragEnd = async () => {
    const wasDragging = draggingId;
    setDraggingId('');
    if (!wasDragging || !firebaseUser) return;
    try {
      await reorderClasses(firebaseUser.uid, classes);
    } catch (err) {
      console.error('Failed to reorder classes', err);
    }
  };

  // Live-swap drag: rows reorder under the cursor (within their day group); the new
  // order is persisted once, on drag end.
  const handleNoteDragStart = (event, note) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `note:${note.id}`);
    dragDayKeyRef.current = dayKeyOf(note);
    setNoteDraggingId(note.id);
  };

  const handleNoteDragEnter = (target) => {
    if (!noteDraggingId || noteDraggingId === target.id) return;
    if (dayKeyOf(target) !== dragDayKeyRef.current) return;
    setNotes((prev) => reorderList(prev, noteDraggingId, target.id));
  };

  const handleNoteDragEnd = async () => {
    const wasDragging = noteDraggingId;
    setNoteDraggingId('');
    dragDayKeyRef.current = '';
    if (!wasDragging || !firebaseUser || !selectedClassId) return;
    try {
      await reorderNotes(firebaseUser.uid, selectedClassId, notes);
    } catch (err) {
      console.error('Failed to reorder notes', err);
    }
  };

  const handleDuplicateNote = async (note) => {
    if (!firebaseUser || !selectedClassId) return;
    setNoteMenuOpenId('');
    try {
      const full = await getNote(firebaseUser.uid, selectedClassId, note.id);
      const createdId = await createNote(firebaseUser.uid, selectedClassId, {
        title: `${note.title || 'Untitled Note'} (copy)`,
        summary: note.summary || '',
        coverUrl: note.coverUrl || '',
        blocks: Array.isArray(full?.blocks) ? full.blocks : [],
        canvasHeight: Number.isFinite(full?.canvasHeight) ? full.canvasHeight : 720,
        templateId: note.templateId || '',
        order: getNextNoteOrder(),
      });
      setFlashNoteId(createdId);
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashNoteId(''), 900);
      showToast('Duplicated');
    } catch (err) {
      console.error('Failed to duplicate note', err);
    }
  };

  const handleTogglePin = async (note) => {
    const classId = note.classId || selectedClassId;
    if (!firebaseUser || !classId) return;
    setNoteMenuOpenId('');
    try {
      await setNotePinned(firebaseUser.uid, classId, note.id, !note.pinned);
      showToast(note.pinned ? 'Unpinned' : 'Pinned to top');
    } catch (err) {
      console.error('Failed to pin note', err);
    }
  };

  const openNoteRoute = (note) => {
    const classId = note.classId || selectedClassId;
    if (!classId) return;
    setNoteMenuOpenId('');
    navigate(
      `/class/${classId}/note/${note.id}`,
      searchActive ? { state: { searchQuery: search.trim() } } : undefined,
    );
  };

  const handleExportPdf = async (note) => {
    const classId = note.classId || selectedClassId;
    if (!firebaseUser || !classId) return;
    setNoteMenuOpenId('');
    showToast('Preparing PDF…');
    try {
      const full = await getNote(firebaseUser.uid, classId, note.id);
      exportNotePdf({
        title: note.title,
        className: note.className || selectedClass?.name || '',
        blocks: Array.isArray(full?.blocks) ? full.blocks : [],
      });
    } catch (err) {
      console.error('Failed to export PDF', err);
      showToast('Export failed');
    }
  };

  const classEmpty = classes.length === 0;
  const resultsEmpty = resultCount === 0;
  const firstName = (profile?.displayName || '').trim().split(/\s+/)[0] || 'there';
  const isLightTheme = THEME_PRESETS[normalizeThemeMode(themeMode)]?.attr === 'light';
  const todayKey = keyForDate(new Date());
  const upcomingEvents = useMemo(() => {
    const events = Object.values(profile?.events || {});
    return events
      .filter((ev) => ev?.date && eventDaysFromToday(ev.date) >= 0)
      .map((ev) => ({ ...ev, delta: eventDaysFromToday(ev.date) }))
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3);
  }, [profile?.events]);
  const toggleTheme = () => {
    const current = normalizeThemeMode(themeMode);
    const currentIndex = THEME_OPTIONS.findIndex((option) => option.id === current);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % THEME_OPTIONS.length;
    const nextMode = normalizeThemeMode(THEME_OPTIONS[nextIndex]?.id);
    setThemeMode(nextMode);
    applyThemeMode(nextMode);
  };
  const currentThemeLabel = THEME_OPTIONS.find((option) => option.id === normalizeThemeMode(themeMode))?.label;

  return (
    <div className="app-shell">
      <header className="app-bar topbar">
        <div className="app-bar-inner">
          <div className="brand">
            <h1>
              Companion<i>.</i>
            </h1>
            <span className="hello">{`${greeting()}, ${firstName}`}</span>
          </div>
          <div className="app-search search-pill">
            <FaSearch aria-hidden="true" />
            <input
              ref={searchInputRef}
              placeholder={
                searchScope === 'all'
                  ? 'Search all classes…'
                  : `Search in ${selectedClass?.name || 'your notes'}…`
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search notes"
            />
            {search ? (
              <button
                type="button"
                className="search-clear"
                title="Clear search"
                onClick={() => setSearch('')}
              >
                <FaTimes />
              </button>
            ) : (
              <kbd
                title="Keyboard shortcut: press Ctrl+K to jump to search"
                onClick={() => {
                  searchInputRef.current?.focus();
                  searchInputRef.current?.select();
                }}
              >
                Ctrl K
              </kbd>
            )}
            <div className="search-filter" ref={filterMenuRef}>
              <button
                type="button"
                className={`search-filter-btn ${searchScope === 'all' || searchInContent ? 'on' : ''}`}
                title="Search filters"
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
                onClick={() => setFilterMenuOpen((prev) => !prev)}
              >
                <FaFilter />
              </button>
              {filterMenuOpen && (
                <div className="search-filter-panel menu" role="menu">
                  <p className="search-filter-label">Search in</p>
                  <button
                    type="button"
                    className={searchScope === 'class' ? 'active' : ''}
                    onClick={() => setSearchScope('class')}
                  >
                    <FaCheck style={{ opacity: searchScope === 'class' ? 1 : 0 }} /> This class
                  </button>
                  <button
                    type="button"
                    className={searchScope === 'all' ? 'active' : ''}
                    onClick={() => setSearchScope('all')}
                  >
                    <FaCheck style={{ opacity: searchScope === 'all' ? 1 : 0 }} /> All classes
                  </button>
                  <div className="search-filter-divider" />
                  <button
                    type="button"
                    className={searchInContent ? 'active' : ''}
                    onClick={() => setSearchInContent((prev) => !prev)}
                  >
                    <FaCheck style={{ opacity: searchInContent ? 1 : 0 }} /> Search inside note text
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="app-actions top-right">
            {!isOnline && <span className="net-status offline">Offline</span>}
            <span className="clock">{clock}</span>
            <button
              type="button"
              className="cal-launch"
              onClick={() => navigate('/calendar')}
              title="Open calendar"
              aria-label="Open calendar"
            >
              <FaRegCalendarAlt />
              {upcomingEvents.length > 0 && <span className="cal-launch-badge">{upcomingEvents.length}</span>}
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              title={currentThemeLabel ? `Theme: ${currentThemeLabel} — click to switch` : 'Switch theme'}
              aria-label="Toggle light or dark theme"
            >
              <span className="theme-knob">{isLightTheme ? <FaSun /> : <FaMoon />}</span>
            </button>
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="avatar-btn"
                title="Account"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((prev) => !prev)}
                style={{ backgroundImage: `url(${profile?.photoUrl || ''})` }}
              >
                {!profile?.photoUrl && (profile?.displayName?.slice(0, 1).toUpperCase() || 'A')}
              </button>
              {userMenuOpen && (
                <div className="user-menu-panel" role="menu">
                  <div className="user-menu-head">
                    <strong>{profile?.displayName || 'Account'}</strong>
                    <span>{profile?.email || firebaseUser?.email || ''}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate('/settings');
                    }}
                  >
                    <FaCog /> Settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                  >
                    <FaSignOutAlt /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="app-layout" data-pane={mobilePane}>
        <aside className="pane pane-classes">
          <div className="pane-header side-head">
            <h3>Classes</h3>
            <button className="side-add" title="New class" onClick={() => openClassSheet()}>
              <FaPlus />
            </button>
          </div>
          <div className="pane-body">
            {classEmpty ? (
              <div className="empty-side">
                <p className="empty-big">A quiet start.</p>
                <p className="empty-small">Create your first class to keep notes organized.</p>
                <button className="btn btn-fill btn-sm" onClick={() => openClassSheet()}>
                  New class
                </button>
              </div>
            ) : (
              classes.map((item) => {
                const menuOpen = menuOpenId === item.id;
                const isSelected = item.id === selectedClassId;
                const count =
                  isSelected && notesClassId === item.id ? notes.length : item.noteCount || 0;
                return (
                  <div
                    key={item.id}
                    className={`class-row ${isSelected ? 'active' : ''} ${
                      draggingId === item.id ? 'dragging' : ''
                    } ${menuOpen ? 'menu-open' : ''}`}
                    style={{ '--class-color': item.color || 'var(--accent)' }}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectClass(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectClass(item.id);
                      }
                    }}
                    draggable={renamingClassId !== item.id}
                    onDragStart={(event) => handleDragStart(event, item.id)}
                    onDragEnter={() => handleClassDragEnter(item.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragEnd={handleDragEnd}
                  >
                    <Grip />
                    <span
                      className="class-dot"
                      style={item.color ? { background: item.color } : undefined}
                    />
                    {renamingClassId === item.id ? (
                      <input
                        className="class-rename-input"
                        value={renameDraft}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => commitRenameClass(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitRenameClass(item.id);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRenameClass();
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="class-name"
                        title={`${item.name} — double-click to rename`}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          startRenameClass(item);
                        }}
                      >
                        {item.name}
                      </span>
                    )}
                    <span className="class-count" title={`${count} ${count === 1 ? 'note' : 'notes'}`}>
                      {count}
                    </span>
                    <div className="class-row-actions">
                      <button
                        className={`dots ${menuOpen ? 'menu-open' : ''}`}
                        title="Class actions"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleMenu(item.id);
                        }}
                      >
                        <FaEllipsisH />
                      </button>
                      {menuOpen && (
                        <div className="class-menu menu" onClick={(event) => event.stopPropagation()} role="menu">
                          <button type="button" onClick={() => openClassSheet(item)}>
                            <FaPen /> Edit class
                          </button>
                          <button type="button" className="danger" onClick={() => requestDelete(item)}>
                            <FaTrash /> Delete class
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <p className="side-foot">⠿ drag to reorder</p>
          </div>

          {profile?.showUpcomingOnDashboard !== false && upcomingEvents.length > 0 && (
            <div className="side-upcoming">
              <div className="side-upcoming-head">
                <span>Upcoming</span>
                <button type="button" onClick={() => navigate('/calendar')} title="Open calendar">
                  <FaRegCalendarAlt />
                </button>
              </div>
              {upcomingEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="side-upcoming-item"
                  onClick={() => navigate('/calendar')}
                >
                  <span className="side-upcoming-dot" style={{ background: ev.color || 'var(--accent)' }} />
                  <span className="side-upcoming-title">{ev.title}</span>
                  <span className={`side-upcoming-when ${ev.delta <= 3 ? 'soon' : ''}`}>
                    {eventCountdownLabel(ev)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="pane pane-notes sheet">
          <div className="pane-header sheet-head">
            <div className="sheet-title">
              <h2>
                {searchActive && searchScope === 'all'
                  ? 'All classes'
                  : selectedClass
                    ? selectedClass.name
                    : 'Notes'}
              </h2>
              <p className="sheet-meta">
                {!selectedClass && searchScope !== 'all'
                  ? 'Select a class'
                  : searchActive && searchScope === 'all'
                    ? `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`
                    : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
                {searchActive && (
                  <span>
                    {' · '}
                    <b>{`${resultCount} ${resultCount === 1 ? 'match' : 'matches'}`}</b>
                    {(contentSearching || globalLoading) && (
                      <em className="meta-searching"> · searching…</em>
                    )}
                  </span>
                )}
              </p>
            </div>
            <div className="pane-actions">
              {selectedNoteIds.length > 0 && (
                <div className="note-bulk-toolbar">
                  <span className="status-text">{selectedNoteIds.length} selected</span>
                  <select
                    value={moveTargetId}
                    onChange={(event) => setMoveTargetId(event.target.value)}
                    disabled={!moveOptions.length || moveBusy}
                  >
                    {moveOptions.length ? (
                      moveOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Move to {item.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No other classes</option>
                    )}
                  </select>
                  <button
                    className="ghost-btn btn-sm"
                    onClick={handleMoveNotes}
                    disabled={!moveTargetId || moveBusy}
                  >
                    {moveBusy ? 'Moving...' : 'Transfer'}
                  </button>
                  <button
                    className="ghost-btn btn-sm danger"
                    onClick={requestBulkDelete}
                    disabled={moveBusy}
                  >
                    Delete
                  </button>
                  <button className="ghost-btn btn-sm" onClick={clearNoteSelection} disabled={moveBusy}>
                    Clear
                  </button>
                </div>
              )}
              <button
                className="btn btn-soft"
                onClick={handleQuickAddNote}
                disabled={!selectedClassId || quickAddBusy}
                title="Quick add with default template"
              >
                <FaPen /> {quickAddBusy ? 'Adding…' : 'Quick add'}
              </button>
              <button className="btn btn-fill" onClick={handleOpenCreateNote} disabled={!selectedClassId}>
                <FaPlus /> New note
              </button>
            </div>
          </div>
          <div className="pane-body sheet-body">
            {searchActive && searchInContent && (
              <div className="search-news" aria-live="polite">
                {contentSearching ? (
                  <p className="search-looking">
                    Leafing through your notes for <b>“{search.trim()}”</b>
                    <span className="search-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </p>
                ) : (
                  <p className="search-found">
                    {contentMatchIds.size > 0
                      ? `Found inside ${contentMatchIds.size} ${
                          contentMatchIds.size === 1 ? 'note' : 'notes'
                        }.`
                      : 'Nothing in the text — matches below are titles and summaries only.'}
                  </p>
                )}
              </div>
            )}
            {classEmpty ? (
              <div className="empty-state">
                <p className="empty-big">Nothing here yet.</p>
                <p className="empty-small">Create a class to start collecting notes.</p>
              </div>
            ) : searchActive && searchScope === 'all' && globalLoading && resultsEmpty ? (
              <div className="empty-state">
                <p className="empty-big">Searching all classes…</p>
              </div>
            ) : resultsEmpty ? (
              <div className="empty-state">
                <p className="empty-big">
                  {searchActive ? `No notes match “${search.trim()}”` : 'Nothing here yet.'}
                </p>
                <p className="empty-small">
                  {searchActive
                    ? searchInContent
                      ? 'Try a different word, or narrow the filter.'
                      : 'Try a different word, or turn on “Search inside note text”.'
                    : 'Capture your first thought — Quick add is right up there.'}
                </p>
              </div>
            ) : (
              <>
                {displayGroups.map((group) => {
                  const isGlobal = group.kind === 'class';
                  return (
                    <Fragment key={group.key}>
                      <div className="day">
                        <span
                          className={
                            group.kind === 'pinned'
                              ? 'day-label pinned'
                              : group.kind === 'class'
                                ? 'day-label class'
                                : `day-label${group.key === todayKey ? '' : ' past'}`
                          }
                        >
                          {group.kind === 'pinned' ? (
                            <>
                              <FaThumbtack /> Pinned
                            </>
                          ) : (
                            group.label
                          )}
                        </span>
                        <span className="day-rule" />
                      </div>
                      {group.notes.map((note) => {
                        const selected = selectedNoteIds.includes(note.id);
                        const menuOpen = noteMenuOpenId === note.id;
                        const kind = kindOf(note);
                        const openNote = () => openNoteRoute(note);
                        return (
                          <div
                            key={`${note.classId || selectedClassId}:${note.id}`}
                            className={`note-row ${selected ? 'selected' : ''} ${
                              noteDraggingId === note.id ? 'dragging' : ''
                            } ${menuOpen ? 'menu-open' : ''} ${
                              flashNoteId === note.id ? 'flash' : ''
                            } ${isGlobal ? 'global-result' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={openNote}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openNote();
                              }
                            }}
                            draggable={!searchActive && !isGlobal}
                            onDragStart={(event) => !isGlobal && handleNoteDragStart(event, note)}
                            onDragEnter={() => !isGlobal && handleNoteDragEnter(note)}
                            onDragOver={(event) => event.preventDefault()}
                            onDragEnd={handleNoteDragEnd}
                          >
                            {isGlobal ? (
                              <span className="note-row-spacer" />
                            ) : (
                              <>
                                <Grip />
                                <label
                                  className="note-check"
                                  onClick={(event) => event.stopPropagation()}
                                  title={selected ? 'Deselect note' : 'Select note'}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleNoteSelection(note.id)}
                                  />
                                  <span className="check" aria-hidden="true">
                                    <FaCheck />
                                  </span>
                                </label>
                              </>
                            )}
                            <span className={`kind${kind.hot ? ' hot' : ''}`}>{kind.label}</span>
                            {note.coverUrl && (
                              <span className="note-thumb-sm">
                                <img src={note.coverUrl} alt="" />
                              </span>
                            )}
                            <div className="note-body-cell">
                              <div className="note-title-line">
                                <span className="note-title-text">{note.title || 'Untitled Note'}</span>
                                {note.pinned && <FaThumbtack className="note-pin" />}
                              </div>
                              {searchInContent && contentSnippets.has(note.id) ? (
                              <div className="note-sub note-snippet">
                                {contentSnippets.get(note.id).before}
                                <mark>{contentSnippets.get(note.id).hit}</mark>
                                {contentSnippets.get(note.id).after}
                              </div>
                            ) : (
                              note.summary && <div className="note-sub">{note.summary}</div>
                            )}
                            </div>
                            <span className="note-time">{noteTimeLabel(note)}</span>
                            {!isGlobal && (
                              <div className="note-row-actions">
                                <button
                                  className={`dots ${menuOpen ? 'menu-open' : ''}`}
                                  title="Note actions"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleNoteMenu(note.id, event);
                                  }}
                                >
                                  <FaEllipsisH />
                                </button>
                                {menuOpen && (
                                  <div
                                    className={`note-menu menu ${noteMenuUp ? 'menu-up' : ''}`}
                                    role="menu"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <button type="button" onClick={() => handleTogglePin(note)}>
                                      <FaThumbtack /> {note.pinned ? 'Unpin' : 'Pin to top'}
                                    </button>
                                    <button type="button" onClick={() => handleOpenEditNote(note, 'title')}>
                                      <FaPen /> Edit details
                                    </button>
                                    <button type="button" onClick={() => handleDuplicateNote(note)}>
                                      <FaCopy /> Duplicate
                                    </button>
                                    <button type="button" onClick={() => handleExportPdf(note)}>
                                      <FaFilePdf /> Export as PDF
                                    </button>
                                    <button
                                      type="button"
                                      className="danger"
                                      onClick={() => requestNoteDelete(note)}
                                    >
                                      <FaTrash /> Delete note
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {!searchActive && (
                  <div className="caught-up">
                    <p>
                      That&apos;s everything in <b>{selectedClass?.name || 'this class'}</b> — your desk is
                      clear.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <nav className="mobile-nav">
        {['classes', 'notes'].map((pane) => (
          <button
            key={pane}
            className={mobilePane === pane ? 'active' : ''}
            onClick={() => setMobilePane(pane)}
          >
            {pane}
          </button>
        ))}
      </nav>

      <AddClassSheet
        open={sheetOpen}
        onClose={closeClassSheet}
        editTarget={classEditTarget}
        onSaved={showToast}
        onCreated={(id) => {
          preferredClassIdRef.current = id;
          setSelectedClassId(id);
          setMobilePane('notes');
        }}
      />

      {noteModalOpen && (
        <>
          <div className="overlay show" onClick={closeNoteModal} />
          <div
            className="modal open"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeNoteModal();
              }
            }}
          >
            <div className="modal-card note-modal-card" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>{noteModalMode === 'create' ? 'New note' : 'Update note'}</h3>
                <p className="status-text">Add a title, summary, and optional cover image.</p>
              </header>
              <div className="sheet-fields">
                <label>
                  Title
                  <input
                    ref={titleRef}
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Note title"
                  />
                </label>
                {noteModalMode === 'create' && (
                  <div className="template-picker">
                    <div className="template-header">
                      <span>Layout</span>
                    </div>
                    <div className="template-grid">
                      {availableTemplates.map((template) => {
                        const isDefault = template.id === defaultTemplateId;
                        return (
                          <div
                            key={template.id}
                            className={`template-card-wrap ${templateId === template.id ? 'active' : ''}`}
                          >
                            <button
                              type="button"
                              className={`template-card ${templateId === template.id ? 'active' : ''}`}
                              onClick={() => setTemplateId(template.id)}
                            >
                              <TemplatePreview template={template} />
                              <strong>{template.label}</strong>
                              {isDefault && <span className="tpl-default-badge">Default</span>}
                            </button>
                            {!isDefault && (
                              <button
                                type="button"
                                className="tpl-set-default"
                                title="Make this the default template"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  updateNoteTemplateDefault(template.id)
                                    .then(() => showToast(`${template.label} is now the default`))
                                    .catch((err) => console.error(err));
                                }}
                              >
                                <FaStar />
                              </button>
                            )}
                            {template.kind === 'custom' && (
                              <button
                                type="button"
                                className="template-card-delete"
                                title="Delete custom template"
                                aria-label={`Delete ${template.label}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  requestTemplateDelete(template);
                                }}
                              >
                                <FaTimes />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className="template-card template-card-create"
                        onClick={handleOpenTemplatePrompt}
                      >
                        <span className="tpl-create-plus">
                          <FaPlus />
                        </span>
                        <strong>Create your own</strong>
                      </button>
                    </div>
                  </div>
                )}
                <details className="note-more" open={noteModalMode === 'edit' ? true : undefined}>
                  <summary>More options</summary>
                  <label>
                    Brief summary
                    <textarea
                      ref={summaryRef}
                      value={noteSummary}
                      onChange={(e) => setNoteSummary(e.target.value)}
                      placeholder="Short summary for the dashboard"
                      rows={2}
                    />
                  </label>
                  <label className="file-tile">
                    Cover image
                    <input
                      ref={imageRef}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      onChange={(e) => setNoteImageFile(e.target.files?.[0] || null)}
                    />
                    <span className="file-tile-face">
                      {noteImageFile?.name || 'Choose an image…'}
                    </span>
                  </label>
                  {noteImagePreview && (
                    <div className="note-cover-preview">
                      <img src={noteImagePreview} alt="Note cover preview" />
                    </div>
                  )}
                </details>
              </div>
              <footer className="modal-actions">
                <button className="ghost-btn" onClick={closeNoteModal} disabled={noteSaving}>
                  Cancel
                </button>
                <button
                  className="primary-btn"
                  onClick={handleSaveNote}
                  disabled={noteSaving || !noteTitle.trim()}
                >
                  {noteSaving ? 'Saving...' : 'Confirm'}
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {templatePromptOpen && (
        <>
          <div className="overlay show" onClick={handleCloseTemplatePrompt} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card modal-card-sm">
              <header>
                <h3>Create custom template</h3>
                <p className="status-text">Give your template a name, then build it on the canvas.</p>
              </header>
              <div className="sheet-fields">
                <label>
                  Template name
                  <input
                    ref={templatePromptRef}
                    value={templatePromptName}
                    onChange={(event) => setTemplatePromptName(event.target.value)}
                    placeholder="e.g. Lecture split"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleConfirmTemplatePrompt();
                      }
                    }}
                  />
                </label>
              </div>
              <footer className="modal-actions">
                <button className="ghost-btn" onClick={handleCloseTemplatePrompt}>
                  Cancel
                </button>
                <button
                  className="primary-btn"
                  onClick={handleConfirmTemplatePrompt}
                  disabled={!templatePromptName.trim()}
                >
                  Continue
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {templateDeleteTarget && (
        <>
          <div className="overlay show" onClick={cancelTemplateDelete} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card modal-card-sm">
              <header>
                <h3>Delete template</h3>
                <p className="status-text">
                  Delete {templateDeleteTarget.label}? This cannot be undone.
                </p>
              </header>
              <footer className="modal-actions">
                <button className="ghost-btn" onClick={cancelTemplateDelete} disabled={templateDeleting}>
                  Cancel
                </button>
                <button className="danger-btn" onClick={confirmTemplateDelete} disabled={templateDeleting}>
                  {templateDeleting ? 'Deleting...' : 'Delete template'}
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {deleteTarget && (
        <>
          <div className="overlay show" onClick={cancelDelete} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card">
              <header>
                <h3>Delete class</h3>
                <p className="status-text">
                  Delete {deleteTarget.name}? This removes notes in the class.
                </p>
              </header>
              <footer className="modal-actions">
                <button className="ghost-btn" onClick={cancelDelete} disabled={deleting}>
                  Cancel
                </button>
                <button className="danger-btn" onClick={confirmDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete class'}
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {noteDeleteTarget && (
        <>
          <div className="overlay show" onClick={cancelNoteDelete} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card">
              <header>
                <h3>Delete note</h3>
                <p className="status-text">
                  Delete {noteDeleteTarget.title || 'this note'}? This cannot be undone.
                </p>
              </header>
              <footer className="modal-actions">
                <button className="ghost-btn" onClick={cancelNoteDelete} disabled={noteDeleting}>
                  Cancel
                </button>
                <button className="danger-btn" onClick={confirmNoteDelete} disabled={noteDeleting}>
                  {noteDeleting ? 'Deleting...' : 'Delete note'}
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {bulkDeleteOpen && (
        <>
          <div className="overlay show" onClick={cancelBulkDelete} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card">
              <header>
                <h3>Delete notes</h3>
                <p className="status-text">
                  Delete {selectedNoteIds.length} notes? This cannot be undone.
                </p>
              </header>
              <footer className="modal-actions">
                <button className="ghost-btn" onClick={cancelBulkDelete} disabled={bulkDeleting}>
                  Cancel
                </button>
                <button className="danger-btn" onClick={confirmBulkDelete} disabled={bulkDeleting}>
                  {bulkDeleting ? 'Deleting...' : 'Delete notes'}
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status">
          <FaCheck aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
