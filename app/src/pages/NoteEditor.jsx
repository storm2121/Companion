import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaArrowLeft,
  FaAlignCenter,
  FaAlignJustify,
  FaAlignLeft,
  FaAlignRight,
  FaBold,
  FaCheckSquare,
  FaChevronDown,
  FaChevronUp,
  FaCode,
  FaCopy,
  FaEllipsisH,
  FaFont,
  FaImage,
  FaIndent,
  FaItalic,
  FaLink,
  FaLock,
  FaLockOpen,
  FaListOl,
  FaListUl,
  FaOutdent,
  FaPaste,
  FaPlus,
  FaQuoteRight,
  FaStar,
  FaStrikethrough,
  FaTable,
  FaTrash,
  FaUnderline,
  FaUndo,
} from 'react-icons/fa';
import { Rnd } from 'react-rnd';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createNoteTemplate, getNote, saveNoteContentDelta, updateNote } from '../services/library';
import { WORKSPACE_WIDTH } from '../data/noteTemplates';
import { useAuth } from '../context/AuthContext';
import ScreenLoader from '../components/ui/ScreenLoader';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import useNetworkStatus from '../hooks/useNetworkStatus';
// Lazy-loaded so TipTap is code-split into its own chunk and never weighs down the
// main bundle while the cutover flag is off.
const RichTextBlock = lazy(() => import('../components/editor/RichTextBlock'));

const PAGE_HEIGHT = 720;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const PRIORITY_Z_OFFSET = 100000;
const COLLAPSED_HEIGHT = 34;
const AUTO_SAVE_IDLE_MS = 22000;
const LOCAL_DRAFT_IDLE_MS = 1000;
const META_TOUCH_INTERVAL_MS = 120000;
const DRAFT_STORAGE_PREFIX = 'companion-note-draft';
const DASHBOARD_RETURN_CLASS_KEY = 'companion:returnClassId';
const TEMPLATE_DRAFT_STORAGE_KEY = 'companion:new-note-draft';
const TEMPLATE_RESULT_STORAGE_KEY = 'companion:new-note-template-result';
const CUSTOM_TEMPLATE_PREFIX = 'custom:';
const HISTORY_LIMIT = 20;
const TEXT_HISTORY_IDLE_MS = 1200;
const TABLE_PICKER_ROWS = 8;
const TABLE_PICKER_COLS = 10;
const TABLE_ROW_RESIZE_STEP = 10;
const TABLE_COLUMN_RESIZE_STEP = 24;
const MIN_TABLE_WIDTH = 140;
const MIN_TABLE_HEIGHT = 96;
const TABLE_HANDLE_DIRECTIONS = ['nw', 'ne', 'sw', 'se'];
const FONT_FAMILY_OPTIONS = [
  { value: '"Instrument Sans"', label: 'Instrument Sans' },
  { value: 'Manrope', label: 'Manrope' },
  { value: 'Georgia', label: 'Georgia' },
  { value: '"Times New Roman"', label: 'Times New Roman' },
  { value: 'Arial', label: 'Arial' },
  { value: '"Courier New"', label: 'Courier' },
];
const LINE_SPACING_OPTIONS = [
  { value: 1, label: '1.0' },
  { value: 1.15, label: '1.15' },
  { value: 1.4, label: '1.4' },
  { value: 1.6, label: '1.6' },
  { value: 1.8, label: '1.8' },
  { value: 2, label: '2.0' },
];

const BLOCK_DEFAULTS = {
  text: { w: 340, h: 240, fontSize: 14 },
  image: { w: 280, h: 200 },
};
// The canvas is a large workspace (always at least viewport-wide); the viewport
// auto-centers on the note's content when it opens.
const PAGE_WIDTH = WORKSPACE_WIDTH;
// Magnet snapping: when a dragged block's edge lands near another block's edge, its
// center line, or a 20px-gutter neighbor slot, it clicks into alignment.
const SNAP_THRESHOLD = 6;
const SNAP_GAP = 20;

const stripZeroWidth = (html) => (typeof html === 'string' ? html.replace(/\u200b/g, '') : '');

const clampColorChannel = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
};

const normalizeHexColor = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{8,}$/.test(trimmed)) return `#${trimmed.slice(1, 7)}`.toLowerCase();
  return fallback;
};

const rgbPartsToHex = (parts) => {
  const channels = parts.slice(0, 3).map((entry) => {
    if (typeof entry === 'string' && entry.endsWith('%')) {
      const percent = Number.parseFloat(entry);
      return clampColorChannel((percent / 100) * 255);
    }
    return clampColorChannel(Number.parseFloat(entry));
  });
  if (channels.some((num) => Number.isNaN(num))) return '';
  return `#${channels.map((num) => num.toString(16).padStart(2, '0')).join('')}`;
};

const toHexColor = (value) => {
  if (!value) return '';
  const normalizedHex = normalizeHexColor(value, '');
  if (normalizedHex) return normalizedHex;
  if (value === 'transparent') return '';
  const rgbaMatch = value.match(/rgba?\(([^)]+)\)/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]
      .replace(/\//g, ',')
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (parts.length >= 4) {
      const alphaRaw = parts[3];
      const alpha = alphaRaw.endsWith('%')
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw);
      if (Number.isFinite(alpha) && alpha <= 0) return '';
    }
    if (parts.length >= 3) {
      return rgbPartsToHex(parts);
    }
  }
  const looseParts = (value.match(/[\d.]+%?/g) || []).slice(0, 3);
  if (looseParts.length < 3) return '';
  return rgbPartsToHex(looseParts);
};

const cloneBlocks = (items = []) => items.map((block) => ({ ...block }));

const stripHtmlToPlainText = (html) => {
  if (typeof html !== 'string' || !html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Paragraph/heading boundaries become newlines so "first line" means first block.
    doc.body.querySelectorAll('p, h1, h2, h3, li, br, div').forEach((el) => {
      el.appendChild(doc.createTextNode('\n'));
    });
    return (doc.body.textContent || '').replace(/\u200B/g, '');
  } catch {
    return html.replace(/<[^>]*>/g, ' ');
  }
};

// Baseline of what is persisted, used to diff future saves. Mirrors getBlocksSnapshot so
// the first diff after load doesn't falsely flag every block as changed.
const buildContentBaseline = (blocks, canvasHeight) => {
  const blocksJson = new Map();
  const order = [];
  (blocks || []).forEach((block) => {
    if (!block?.id) return;
    order.push(block.id);
    const persistedBlock =
      block.type === 'text' ? { ...block, value: stripZeroWidth(block.value || '') } : block;
    blocksJson.set(block.id, JSON.stringify(persistedBlock));
  });
  return { blocksJson, order, canvasHeight };
};

const getBlockId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const resolveBlockType = (type) => (type === 'image' ? 'image' : 'text');

const normalizeBlocks = (blocks = []) =>
  blocks.map((block, index) => {
    const type = resolveBlockType(block.type);
    const defaults = BLOCK_DEFAULTS[type];
    const w = Number.isFinite(block.w) ? block.w : defaults.w;
    const h = Number.isFinite(block.h) ? block.h : defaults.h;
    const x = Number.isFinite(block.x) ? block.x : (index % 2) * (w + 24);
    const y = Number.isFinite(block.y) ? block.y : Math.floor(index / 2) * (h + 24);
    const zIndex = Number.isFinite(block.zIndex) ? block.zIndex : index + 1;
    return {
      id: block.id || getBlockId(),
      type,
      value: typeof block.value === 'string' ? block.value : '',
      title: typeof block.title === 'string' ? block.title : '',
      locked: Boolean(block.locked),
      priority: Boolean(block.priority),
      collapsed: Boolean(block.collapsed),
      restoreHeight: Number.isFinite(block.restoreHeight) ? block.restoreHeight : null,
      bgColor: typeof block.bgColor === 'string' ? block.bgColor : '',
      zIndex,
      fontSize: Number.isFinite(block.fontSize) ? block.fontSize : defaults.fontSize || 14,
      lineHeight: Number.isFinite(block.lineHeight) ? block.lineHeight : 1.4,
      textColor: typeof block.textColor === 'string' ? block.textColor : '',
      bold: Boolean(block.bold),
      underline: Boolean(block.underline),
      x,
      y,
      w,
      h,
    };
  });

const getMaxZIndex = (items, predicate) =>
  items.reduce((max, item) => (predicate(item) ? Math.max(max, item.zIndex || 0) : max), 0);

const NoteEditor = () => {
  const { classId, noteId } = useParams();
  const location = useLocation();
  const isTemplateMode = location.pathname === '/template/new';
  const templateBuilderName =
    typeof location.state?.templateName === 'string' && location.state.templateName.trim()
      ? location.state.templateName.trim()
      : 'Custom template';
  const { firebaseUser } = useAuth();
  const [note, setNote] = useState(() =>
    isTemplateMode ? { title: templateBuilderName, templateBuilder: true } : null,
  );
  const [blocks, setBlocks] = useState([]);
  const [canvasHeight, setCanvasHeight] = useState(PAGE_HEIGHT);
  const [saveStatus, setSaveStatus] = useState('All changes saved');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [blockMenuOpenId, setBlockMenuOpenId] = useState('');
  const [activeBlockId, setActiveBlockId] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDropActive, setImageDropActive] = useState(false);
  const [toolbarFontSize, setToolbarFontSize] = useState(BLOCK_DEFAULTS.text.fontSize);
  const [toolbarFontFamily, setToolbarFontFamily] = useState(FONT_FAMILY_OPTIONS[0].value);
  const [toolbarColor, setToolbarColor] = useState('#ffffff');
  const [toolbarHighlightColor, setToolbarHighlightColor] = useState('#fff2a8');
  const [toolbarBold, setToolbarBold] = useState(false);
  const [toolbarItalic, setToolbarItalic] = useState(false);
  const [toolbarUnderline, setToolbarUnderline] = useState(false);
  const [toolbarStrike, setToolbarStrike] = useState(false);
  const [toolbarBullets, setToolbarBullets] = useState(false);
  const [toolbarNumbered, setToolbarNumbered] = useState(false);
  const [toolbarChecklist, setToolbarChecklist] = useState(false);
  const [toolbarLink, setToolbarLink] = useState(false);
  const [toolbarCodeBlock, setToolbarCodeBlock] = useState(false);
  const [toolbarAlign, setToolbarAlign] = useState('left');
  const [toolbarLineSpacing, setToolbarLineSpacing] = useState(1.4);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(BLOCK_DEFAULTS.text.fontSize));
  const [fontSizeEditing, setFontSizeEditing] = useState(false);
  const [copiedTextStyle, setCopiedTextStyle] = useState(null);
  const [toolbarMode, setToolbarMode] = useState('full');
  const [toolbarSection, setToolbarSection] = useState('text');
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkEditing, setLinkEditing] = useState(false);
  const [deleteBlockId, setDeleteBlockId] = useState('');
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tablePickerHover, setTablePickerHover] = useState({ rows: 2, cols: 2 });
  const [tablePickerPos, setTablePickerPos] = useState({ left: 12, top: 72 });
  const [blockMenuPos, setBlockMenuPos] = useState({ left: 12, top: 72 });
  const [renamingBlockId, setRenamingBlockId] = useState('');
  const [blockTitleDraft, setBlockTitleDraft] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const addMenuRef = useRef(null);
  const toolbarMoreRef = useRef(null);
  const tablePickerTriggerRef = useRef(null);
  const tablePickerPopoverRef = useRef(null);
  const blockMenuPanelRef = useRef(null);
  const blockMenuTriggerRefs = useRef({});
  const contextMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const canvasScrollRef = useRef(null);
  const canvasRef = useRef(null);
  const dragDepthRef = useRef(0);
  const addImageBlockRef = useRef(null);
  const snapGuideVRef = useRef(null);
  const snapGuideHRef = useRef(null);
  const activeEditorRef = useRef(null);
  const lastActiveBlockIdRef = useRef('');
  const editorsByBlockRef = useRef({});
  const tiptapSelectionRef = useRef(null);
  const skipNextFontSizeBlurCommitRef = useRef(false);
  const blocksRef = useRef(blocks);
  const canvasHeightRef = useRef(canvasHeight);
  const textDraftsRef = useRef({});
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const historyTimeoutRef = useRef(null);
  const suppressHistoryRef = useRef(false);
  const textTypingRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveTimeoutRef = useRef(null);
  const flushSaveRef = useRef(null);
  const localDraftTimeoutRef = useRef(null);
  const changeVersionRef = useRef(0);
  const lastSavedVersionRef = useRef(0);
  const lastMetaTouchRef = useRef(0);
  // Persistence baseline: a hash of what is currently in Firestore, used to diff and
  // write only the blocks that actually changed. blocksSchemaRef tracks whether the
  // stored doc is already on the map schema ('map') or still legacy ('array').
  const lastSavedContentRef = useRef({ blocksJson: new Map(), order: [], canvasHeight: PAGE_HEIGHT });
  const blocksSchemaRef = useRef('array');
  const saveStatusRef = useRef(saveStatus);
  const blockDraggingRef = useRef(false);
  const navigate = useNavigate();
  const isOnline = useNetworkStatus();
  const returnToDashboardClass = useCallback(() => {
    if (isTemplateMode) {
      let preferredClassId = '';
      try {
        const cached = sessionStorage.getItem(TEMPLATE_DRAFT_STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          preferredClassId =
            typeof parsed?.classId === 'string' && parsed.classId.trim() ? parsed.classId : '';
        }
      } catch {
        preferredClassId = '';
      }
      if (preferredClassId) {
        navigate(`/dashboard?class=${encodeURIComponent(preferredClassId)}`, {
          state: { selectedClassId: preferredClassId },
        });
      } else {
        navigate('/dashboard');
      }
      return;
    }
    if (classId) {
      try {
        sessionStorage.setItem(DASHBOARD_RETURN_CLASS_KEY, classId);
      } catch {
        // Ignore storage write issues and fall back to query+state.
      }
      navigate(`/dashboard?class=${encodeURIComponent(classId)}`, {
        state: { selectedClassId: classId },
      });
      return;
    }
    navigate('/dashboard');
  }, [navigate, classId, isTemplateMode]);

  useEffect(() => {
    if (!classId) return undefined;
    return () => {
      try {
        sessionStorage.setItem(DASHBOARD_RETURN_CLASS_KEY, classId);
      } catch {
        // Ignore storage write issues in restricted environments.
      }
    };
  }, [classId]);

  const draftKey = useMemo(() => {
    if (!firebaseUser || isTemplateMode) return '';
    return `${DRAFT_STORAGE_PREFIX}:${firebaseUser.uid}:${classId}:${noteId}`;
  }, [firebaseUser, classId, noteId, isTemplateMode]);

  const updateSaveStatus = useCallback((next) => {
    if (saveStatusRef.current === next) return;
    saveStatusRef.current = next;
    setSaveStatus(next);
  }, []);

  const seedTextDrafts = useCallback((items) => {
    const nextDrafts = {};
    items.forEach((block) => {
      if (block.type === 'text') {
        nextDrafts[block.id] = stripZeroWidth(block.value || '');
      }
    });
    textDraftsRef.current = nextDrafts;
  }, []);

  const getBlocksSnapshot = useCallback(() => {
    const drafts = textDraftsRef.current;
    return blocksRef.current.map((block) => {
      if (block.type !== 'text') return block;
      const draftValue = drafts[block.id];
      const nextValue = typeof draftValue === 'string' ? stripZeroWidth(draftValue) : block.value;
      if (typeof nextValue !== 'string' || nextValue === block.value) return block;
      return { ...block, value: nextValue };
    });
  }, []);

  const flushSave = useCallback(async (reason = 'idle') => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (isTemplateMode || !firebaseUser || !note || note.missing) return;
    if (!dirtyRef.current) return;
    if (savingRef.current) return;
    if (lastSavedVersionRef.current === changeVersionRef.current) return;
    savingRef.current = true;
    updateSaveStatus('Saving...');
    const saveVersion = changeVersionRef.current;
    try {
      // Diff the current snapshot against the last persisted baseline so only the
      // blocks that actually changed get written (or one full rewrite to migrate a
      // legacy array note onto the map schema).
      const snapshot = getBlocksSnapshot();
      const snapshotHeight = canvasHeightRef.current;
      const baseline = lastSavedContentRef.current;
      const order = snapshot.map((block) => block.id);
      const snapshotJson = new Map(snapshot.map((block) => [block.id, JSON.stringify(block)]));
      const changedBlocks = {};
      snapshot.forEach((block) => {
        if (baseline.blocksJson.get(block.id) !== snapshotJson.get(block.id)) {
          changedBlocks[block.id] = block;
        }
      });
      const removedBlockIds = [];
      baseline.blocksJson.forEach((_value, id) => {
        if (!snapshotJson.has(id)) removedBlockIds.push(id);
      });
      const orderChanged =
        order.length !== baseline.order.length ||
        order.some((id, index) => baseline.order[index] !== id);
      const canvasChanged = snapshotHeight !== baseline.canvasHeight;
      const needsFullRewrite = blocksSchemaRef.current !== 'map';

      const settleClean = () => {
        lastSavedVersionRef.current = saveVersion;
        if (changeVersionRef.current === saveVersion) {
          dirtyRef.current = false;
          updateSaveStatus('All changes saved');
          if (draftKey) localStorage.removeItem(draftKey);
        } else {
          dirtyRef.current = true;
          updateSaveStatus('Unsaved changes');
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = setTimeout(() => {
            const handler = flushSaveRef.current;
            if (handler) void handler('idle');
          }, AUTO_SAVE_IDLE_MS);
        }
      };

      if (
        !needsFullRewrite &&
        !Object.keys(changedBlocks).length &&
        !removedBlockIds.length &&
        !orderChanged &&
        !canvasChanged
      ) {
        // No material change (e.g. a formatting toggle that cancelled out).
        settleClean();
        return;
      }

      const now = Date.now();
      const shouldTouchMeta =
        reason === 'visibility' ||
        reason === 'unload' ||
        reason === 'unmount' ||
        now - lastMetaTouchRef.current >= META_TOUCH_INTERVAL_MS;

      if (needsFullRewrite) {
        await saveNoteContentDelta(
          firebaseUser.uid,
          classId,
          noteId,
          { fullRewrite: true, allBlocks: snapshot, canvasHeight: snapshotHeight },
          { touchMeta: shouldTouchMeta },
        );
      } else {
        await saveNoteContentDelta(
          firebaseUser.uid,
          classId,
          noteId,
          {
            changedBlocks,
            removedBlockIds,
            order: orderChanged ? order : null,
            canvasHeight: canvasChanged ? snapshotHeight : undefined,
          },
          { touchMeta: shouldTouchMeta },
        );
      }

      if (shouldTouchMeta) {
        lastMetaTouchRef.current = now;
      }
      // The stored doc now matches `snapshot` (and is on the map schema), regardless of
      // any edits that landed during the await.
      blocksSchemaRef.current = 'map';
      lastSavedContentRef.current = {
        blocksJson: snapshotJson,
        order,
        canvasHeight: snapshotHeight,
      };
      // Auto-title: while the note still carries a placeholder name ("Quick Note 3",
      // "Untitled Note"), adopt the first line the user actually wrote.
      if (/^(quick note( \d+)?|untitled( note)?)$/i.test((note?.title || '').trim())) {
        const firstText = snapshot.find(
          (block) => block.type === 'text' && stripHtmlToPlainText(block.value).trim(),
        );
        const derived = firstText
          ? stripHtmlToPlainText(firstText.value).trim().split('\n')[0].slice(0, 60).trim()
          : '';
        if (derived && derived !== note.title) {
          try {
            await updateNote(firebaseUser.uid, classId, noteId, { title: derived });
            setNote((prev) => (prev ? { ...prev, title: derived } : prev));
          } catch (err) {
            console.warn('Auto-title failed', err);
          }
        }
      }
      settleClean();
    } catch (err) {
      console.error('Failed to save note', err);
      updateSaveStatus('Save failed. Changes kept locally.');
    } finally {
      savingRef.current = false;
    }
  }, [isTemplateMode, firebaseUser, note, classId, noteId, draftKey, getBlocksSnapshot, updateSaveStatus]);

  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const handler = flushSaveRef.current;
      if (handler) {
        void handler('idle');
      }
    }, AUTO_SAVE_IDLE_MS);
  }, []);

  const scheduleLocalDraft = useCallback(() => {
    if (!draftKey) return;
    if (localDraftTimeoutRef.current) clearTimeout(localDraftTimeoutRef.current);
    localDraftTimeoutRef.current = setTimeout(() => {
      const payload = {
        blocks: getBlocksSnapshot(),
        canvasHeight: canvasHeightRef.current,
        updatedAt: Date.now(),
      };
      try {
        localStorage.setItem(draftKey, JSON.stringify(payload));
      } catch (err) {
        console.warn('Failed to cache local draft', err);
      }
    }, LOCAL_DRAFT_IDLE_MS);
  }, [draftKey, getBlocksSnapshot]);

  const markDirty = () => {
    dirtyRef.current = true;
    changeVersionRef.current += 1;
    updateSaveStatus('Unsaved changes');
    scheduleLocalDraft();
    scheduleSave();
  };

  const pushHistory = useCallback(
    (reason) => {
      if (suppressHistoryRef.current || !note || note.missing) return;
      const snapshot = {
        blocks: cloneBlocks(getBlocksSnapshot()),
        canvasHeight: canvasHeightRef.current,
        ts: Date.now(),
        reason,
      };
      historyRef.current = [...historyRef.current, snapshot].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setHistoryVersion((prev) => prev + 1);
    },
    [getBlocksSnapshot, note],
  );

  const scheduleTextIdleReset = useCallback(() => {
    if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
    historyTimeoutRef.current = setTimeout(() => {
      textTypingRef.current = false;
    }, TEXT_HISTORY_IDLE_MS);
  }, []);

  const applyHistorySnapshot = useCallback(
    (snapshot) => {
      if (!snapshot) return;
      suppressHistoryRef.current = true;
      const normalized = normalizeBlocks(snapshot.blocks || []);
      setBlocks(normalized);
      seedTextDrafts(normalized);
      setCanvasHeight(Number.isFinite(snapshot.canvasHeight) ? snapshot.canvasHeight : PAGE_HEIGHT);
      setActiveBlockId('');
      setBlockMenuOpenId('');
      setAddMenuOpen(false);
      suppressHistoryRef.current = false;
      markDirty();
    },
    [seedTextDrafts],
  );

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    canvasHeightRef.current = canvasHeight;
  }, [canvasHeight]);

  useEffect(() => {
    if (isTemplateMode) {
      const normalized = normalizeBlocks([]);
      setNote({ title: templateBuilderName, templateBuilder: true });
      setBlocks(normalized);
      seedTextDrafts(normalized);
      setCanvasHeight(PAGE_HEIGHT);
      dirtyRef.current = false;
      changeVersionRef.current = 0;
      lastSavedVersionRef.current = 0;
      lastMetaTouchRef.current = Date.now();
      blocksSchemaRef.current = 'map';
      lastSavedContentRef.current = buildContentBaseline(normalized, PAGE_HEIGHT);
      updateSaveStatus('Template draft');
      historyRef.current = [
        { blocks: cloneBlocks(normalized), canvasHeight: PAGE_HEIGHT, ts: Date.now(), reason: 'load-template' },
      ];
      futureRef.current = [];
      setHistoryVersion((prev) => prev + 1);
      return;
    }
    const loadNote = async () => {
      if (!firebaseUser) return;
      const data = await getNote(firebaseUser.uid, classId, noteId);
      if (data) {
        setNote(data);
        const normalizedBlocks = normalizeBlocks(data.blocks || []);
        const initialHeight = Number.isFinite(data.canvasHeight) ? data.canvasHeight : PAGE_HEIGHT;
        setBlocks(normalizedBlocks);
        seedTextDrafts(normalizedBlocks);
        setCanvasHeight(initialHeight);
        dirtyRef.current = false;
        changeVersionRef.current = 0;
        lastSavedVersionRef.current = 0;
        lastMetaTouchRef.current = Date.now();
        // Baseline always reflects what is in Firestore (the remote doc), even when a
        // newer local draft is restored below — so the first save writes the delta
        // between the draft and what's actually persisted.
        blocksSchemaRef.current = data.blocksSchema || 'array';
        lastSavedContentRef.current = buildContentBaseline(normalizedBlocks, initialHeight);
        updateSaveStatus('All changes saved');
        historyRef.current = [
          { blocks: cloneBlocks(normalizedBlocks), canvasHeight: initialHeight, ts: Date.now(), reason: 'load' },
        ];
        futureRef.current = [];
        setHistoryVersion((prev) => prev + 1);
        if (draftKey) {
          try {
            const cached = localStorage.getItem(draftKey);
            if (cached) {
              const parsed = JSON.parse(cached);
              const cachedAt = Number(parsed?.updatedAt) || 0;
              const remoteAt = data.updatedAt?.toDate?.()?.getTime?.() || 0;
              if (cachedAt > remoteAt) {
                const cachedBlocks = normalizeBlocks(parsed.blocks || []);
                setBlocks(cachedBlocks);
                seedTextDrafts(cachedBlocks);
                setCanvasHeight(Number.isFinite(parsed.canvasHeight) ? parsed.canvasHeight : initialHeight);
                dirtyRef.current = true;
                changeVersionRef.current += 1;
                updateSaveStatus('Unsaved changes');
                scheduleSave();
                historyRef.current = [
                  {
                    blocks: cloneBlocks(cachedBlocks),
                    canvasHeight: Number.isFinite(parsed.canvasHeight) ? parsed.canvasHeight : initialHeight,
                    ts: Date.now(),
                    reason: 'restore',
                  },
                ];
                futureRef.current = [];
                setHistoryVersion((prev) => prev + 1);
              } else {
                localStorage.removeItem(draftKey);
              }
            }
          } catch (err) {
            console.warn('Failed to restore cached draft', err);
          }
        }
      } else {
        setNote({ missing: true });
      }
    };
    loadNote();
  }, [
    isTemplateMode,
    templateBuilderName,
    firebaseUser,
    classId,
    noteId,
    draftKey,
    scheduleSave,
    seedTextDrafts,
    updateSaveStatus,
  ]);

  useEffect(() => {
    if (isTemplateMode || !note || note.missing || !firebaseUser) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushSave('visibility');
      }
    };
    const handleBeforeUnload = () => {
      void flushSave('unload');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isTemplateMode, note, firebaseUser, classId, noteId, flushSave]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (localDraftTimeoutRef.current) clearTimeout(localDraftTimeoutRef.current);
      if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
      void flushSave('unmount');
    };
  }, [flushSave]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const handleClick = (event) => {
      if (!addMenuRef.current) return;
      if (!addMenuRef.current.contains(event.target)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [addMenuOpen]);

  useEffect(() => {
    const syncToolbarMode = () => {
      const width = window.innerWidth;
      if (width < 1024) {
        setToolbarMode('segmented');
      } else if (width < 1280) {
        setToolbarMode('compact');
      } else {
        setToolbarMode('full');
      }
    };
    syncToolbarMode();
    window.addEventListener('resize', syncToolbarMode);
    return () => window.removeEventListener('resize', syncToolbarMode);
  }, []);

  useEffect(() => {
    setToolbarMoreOpen(false);
    if (toolbarMode !== 'segmented') {
      setToolbarSection('text');
    }
  }, [toolbarMode]);

  useEffect(() => {
    if (!toolbarMoreOpen) return;
    const handleClick = (event) => {
      const target = event.target;
      if (target instanceof Element && toolbarMoreRef.current?.contains(target)) return;
      setToolbarMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [toolbarMoreOpen]);

  useEffect(() => {
    if (!tablePickerOpen) return;
    const handleClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (tablePickerTriggerRef.current?.contains(target)) return;
      if (tablePickerPopoverRef.current?.contains(target)) return;
      setTablePickerOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tablePickerOpen]);

  useEffect(() => {
    const active = blocks.find((item) => item.id === activeBlockId);
    const hasActiveText = Boolean(active && active.type === 'text');
    if (!hasActiveText) {
      setTablePickerOpen(false);
      setToolbarMoreOpen(false);
    }
  }, [activeBlockId, blocks]);

  useEffect(() => {
    if (!tablePickerOpen) return;
    const syncPosition = () => {
      const rect = tablePickerTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popoverWidth = 220;
      const popoverHeight = 220;
      const nextLeft = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
      const nextTop = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - popoverHeight - 8));
      setTablePickerPos({ left: nextLeft, top: nextTop });
    };
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [tablePickerOpen]);

  const syncBlockMenuPosition = useCallback((id) => {
    if (!id) return;
    const trigger = blockMenuTriggerRefs.current[id];
    if (!(trigger instanceof HTMLElement)) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panel = blockMenuPanelRef.current;
    const panelWidth = panel?.offsetWidth || 236;
    const panelHeight = panel?.offsetHeight || 292;
    const gap = 8;

    let nextLeft = triggerRect.right - panelWidth;
    let nextTop = triggerRect.bottom + gap;
    if (nextTop + panelHeight > window.innerHeight - gap) {
      nextTop = triggerRect.top - panelHeight - gap;
    }
    if (nextTop < gap) {
      nextTop = Math.max(gap, window.innerHeight - panelHeight - gap);
    }
    if (nextLeft + panelWidth > window.innerWidth - gap) {
      nextLeft = window.innerWidth - panelWidth - gap;
    }
    if (nextLeft < gap) {
      nextLeft = gap;
    }
    setBlockMenuPos({ left: Math.round(nextLeft), top: Math.round(nextTop) });
  }, []);

  useEffect(() => {
    if (!blockMenuOpenId) return;
    const syncPosition = () => syncBlockMenuPosition(blockMenuOpenId);
    const rafId = requestAnimationFrame(syncPosition);
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [blockMenuOpenId, syncBlockMenuPosition, blocks]);

  useEffect(() => {
    if (!blockMenuOpenId) return;
    const handleClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.block-menu-panel') || target.closest('.block-menu-trigger')) return;
      setBlockMenuOpenId('');
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setBlockMenuOpenId('');
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [blockMenuOpenId]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const handleClick = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.note-context-menu')) return;
      setContextMenu(null);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!activeBlockId) return;
    const editor = editorsByBlockRef.current[activeBlockId];
    if (!editor) return;
    requestAnimationFrame(() => {
      if (!editor.isDestroyed && !editor.isFocused) editor.commands.focus();
    });
  }, [activeBlockId]);

  const activeTextBlock = useMemo(() => {
    const block = blocks.find((item) => item.id === activeBlockId);
    if (!block || block.type !== 'text') return null;
    return block;
  }, [blocks, activeBlockId]);
  const activeTextId = activeTextBlock?.id || '';
  const textControlsDisabled = !activeTextId;
  const activeFontSize = activeTextBlock?.fontSize || BLOCK_DEFAULTS.text.fontSize;
  const activeLineSpacing = activeTextBlock?.lineHeight || 1.4;
  const activeTextColor = activeTextBlock?.textColor || '#ffffff';
  const fontSizeValue = toolbarFontSize || activeFontSize;
  const colorValue = normalizeHexColor(toolbarColor || activeTextColor, '#ffffff');
  const highlightColorValue = normalizeHexColor(toolbarHighlightColor, '#fff2a8');
  const lineSpacingValue = toolbarLineSpacing || activeLineSpacing;
  const blockMenuBlock = useMemo(() => {
    if (!blockMenuOpenId) return null;
    return blocks.find((item) => item.id === blockMenuOpenId) || null;
  }, [blockMenuOpenId, blocks]);
  const contextMenuBlock = useMemo(() => {
    if (!contextMenu?.blockId) return null;
    return blocks.find((item) => item.id === contextMenu.blockId) || null;
  }, [contextMenu?.blockId, blocks]);
  const canvasWidth = useMemo(() => {
    const maxRightEdge = blocks.reduce((max, block) => {
      const defaultWidth = BLOCK_DEFAULTS[block.type]?.w || BLOCK_DEFAULTS.text.w;
      const width = Number.isFinite(block.w) ? block.w : defaultWidth;
      const x = Number.isFinite(block.x) ? block.x : 0;
      return Math.max(max, x + width);
    }, PAGE_WIDTH);
    return Math.max(PAGE_WIDTH, Math.ceil(maxRightEdge + 40));
  }, [blocks]);

  // On open, scroll the viewport so the note's content sits centered horizontally
  // (workspace-center for empty notes). Runs once per mount, after first paint.
  const initialCenterDoneRef = useRef(false);
  useEffect(() => {
    if (initialCenterDoneRef.current) return;
    if (!note || note.missing) return;
    const scroller = canvasScrollRef.current;
    if (!scroller) return;
    initialCenterDoneRef.current = true;
    requestAnimationFrame(() => {
      const target = blocks.length
        ? (Math.min(...blocks.map((b) => b.x || 0)) +
            Math.max(...blocks.map((b) => (b.x || 0) + (b.w || BLOCK_DEFAULTS.text.w)))) /
          2
        : canvasWidth / 2;
      scroller.scrollLeft = Math.max(0, Math.round(target - scroller.clientWidth / 2));
    });
  }, [note, blocks, canvasWidth]);

  // ---- In-note find (armed by the dashboard search when opening a note) ----
  // Highlights use the CSS Custom Highlight API: zero DOM/document mutation, so the
  // note content is never touched and vanishes cleanly on dismiss.
  const [findInfo, setFindInfo] = useState(null); // { query, count, index }
  const findRangesRef = useRef([]);
  const findArmedRef = useRef(false);

  const clearFind = useCallback(() => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete('companion-find');
      CSS.highlights.delete('companion-find-current');
    }
    findRangesRef.current = [];
    setFindInfo(null);
  }, []);

  const scrollToFindIndex = useCallback((idx) => {
    const item = findRangesRef.current[idx];
    if (!item) return;
    try {
      const rect = item.range.getBoundingClientRect();
      const scroller = canvasScrollRef.current;
      if (scroller) {
        const sRect = scroller.getBoundingClientRect();
        scroller.scrollTop += rect.top - sRect.top - sRect.height / 2 + 40;
        scroller.scrollLeft += rect.left - sRect.left - sRect.width / 2;
      }
      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set('companion-find-current', new Highlight(item.range));
      }
    } catch {
      // Range detached (content changed) — dismiss quietly.
      clearFind();
    }
  }, [clearFind]);

  const gotoFind = (delta) => {
    setFindInfo((prev) => {
      if (!prev || !prev.count) return prev;
      const next = (prev.index + delta + prev.count) % prev.count;
      scrollToFindIndex(next);
      return { ...prev, index: next };
    });
  };

  const runFind = useCallback(
    (query) => {
      const q = (query || '').toLowerCase();
      if (!q) return;
      const ranges = [];
      blocksRef.current
        .filter((block) => block.type === 'text' && !block.collapsed)
        .forEach((block) => {
          const rootEl = editorsByBlockRef.current[block.id]?.view?.dom;
          if (!rootEl) return;
          const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const text = node.nodeValue || '';
            const lower = text.toLowerCase();
            let at = lower.indexOf(q);
            while (at !== -1) {
              const range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, at + q.length);
              ranges.push({ range });
              at = lower.indexOf(q, at + q.length);
            }
          }
        });
      findRangesRef.current = ranges;
      if (ranges.length && typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set('companion-find', new Highlight(...ranges.map((r) => r.range)));
      }
      setFindInfo({ query, count: ranges.length, index: 0 });
      if (ranges.length) scrollToFindIndex(0);
    },
    [scrollToFindIndex],
  );

  // Arm once: wait (poll briefly) for the lazy TipTap editors to mount, then find.
  useEffect(() => {
    const q = location.state?.searchQuery;
    if (!q || findArmedRef.current || !note || note.missing) return undefined;
    findArmedRef.current = true;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const textBlocks = blocksRef.current.filter((b) => b.type === 'text' && !b.collapsed);
      const ready = textBlocks.length > 0 && textBlocks.every((b) => editorsByBlockRef.current[b.id]);
      if (ready || tries > 16) {
        clearInterval(timer);
        if (ready) setTimeout(() => runFind(q), 120);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [note, location.state, runFind]);

  // Esc dismisses the find pill (before anything else handles it).
  useEffect(() => {
    if (!findInfo) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        clearFind();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [findInfo, clearFind]);

  useEffect(() => {
    if (!blockMenuOpenId) return;
    if (blockMenuBlock) return;
    setBlockMenuOpenId('');
  }, [blockMenuOpenId, blockMenuBlock]);

  useEffect(() => {
    if (fontSizeEditing) return;
    setFontSizeDraft(String(fontSizeValue || BLOCK_DEFAULTS.text.fontSize));
  }, [fontSizeValue, fontSizeEditing]);

  useEffect(() => {
    if (!activeTextBlock) return;
    setToolbarFontSize(activeTextBlock.fontSize || BLOCK_DEFAULTS.text.fontSize);
    setToolbarLineSpacing(activeTextBlock.lineHeight || 1.4);
    setToolbarColor(activeTextBlock.textColor || '#ffffff');
    setToolbarHighlightColor('#fff2a8');
    setToolbarFontFamily(FONT_FAMILY_OPTIONS[0].value);
    setToolbarBold(false);
    setToolbarItalic(false);
    setToolbarUnderline(false);
    setToolbarStrike(false);
    setToolbarBullets(false);
    setToolbarNumbered(false);
    setToolbarChecklist(false);
    setToolbarAlign('left');
  }, [activeTextBlock?.id]);

  // Place a new block in the highest-then-leftmost free space that is *currently on
  // screen*. The search is bounded to the visible viewport (scroll window), scans
  // top -> bottom then left -> right, and skips anything that would overlap an existing
  // block (collapsed blocks use their small live height). If the visible area is full,
  // it drops at the top-left of the viewport anyway.
  const getNextPosition = (size) => {
    const gap = 20;
    const step = 20;
    const blockW = Number.isFinite(size?.w) ? size.w : BLOCK_DEFAULTS.text.w;
    const blockH = Number.isFinite(size?.h) ? size.h : BLOCK_DEFAULTS.text.h;
    const scroller = canvasScrollRef.current;
    const canvasEl = canvasRef.current;

    // Visible window expressed in canvas coordinates. The canvas is a centered page,
    // so its origin is offset from the scroll viewport — map via bounding rects.
    let viewLeft = 0;
    let viewTop = 0;
    const viewW = scroller?.clientWidth ?? canvasEl?.clientWidth ?? PAGE_WIDTH;
    const viewH = scroller?.clientHeight ?? 560;
    if (scroller && canvasEl) {
      const scrollerRect = scroller.getBoundingClientRect();
      const canvasRect = canvasEl.getBoundingClientRect();
      viewLeft = Math.max(0, scrollerRect.left - canvasRect.left);
      viewTop = Math.max(0, scrollerRect.top - canvasRect.top);
    }
    const fallback = { x: Math.round(viewLeft), y: Math.round(viewTop) };

    const rects = blocksRef.current.map((block) => {
      const defaults = BLOCK_DEFAULTS[block.type] || BLOCK_DEFAULTS.text;
      return {
        x: Number.isFinite(block.x) ? block.x : 0,
        y: Number.isFinite(block.y) ? block.y : 0,
        w: Number.isFinite(block.w) ? block.w : defaults.w,
        h: Number.isFinite(block.h) ? block.h : defaults.h,
      };
    });

    const collides = (x, y) =>
      rects.some(
        (r) =>
          x < r.x + r.w + gap &&
          x + blockW + gap > r.x &&
          y < r.y + r.h + gap &&
          y + blockH + gap > r.y,
      );

    // Stay inside both the visible window and the page bounds.
    const canvasW = canvasEl?.clientWidth ?? PAGE_WIDTH;
    const canvasH = canvasEl?.clientHeight ?? canvasHeightRef.current;
    const maxX = Math.min(viewLeft + viewW, canvasW) - blockW;
    const maxY = Math.min(viewTop + viewH, canvasH) - blockH;
    if (maxX < viewLeft || maxY < viewTop) return fallback; // block bigger than viewport

    for (let y = viewTop; y <= maxY; y += step) {
      for (let x = viewLeft; x <= maxX; x += step) {
        if (!collides(x, y)) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    return fallback;
  };

  // Magnet: when a dragged block is near another block's edges, its center lines, or a
  // neighbor slot one 20px gutter away, it clicks into exact alignment. Returns the
  // snapped position plus guide-line coordinates (canvas space) for live feedback.
  const snapToNeighbors = (blockId, rawX, rawY, w, h) => {
    let x = rawX;
    let y = rawY;
    let bestDx = SNAP_THRESHOLD + 1;
    let bestDy = SNAP_THRESHOLD + 1;
    let guideX = null;
    let guideY = null;
    blocksRef.current.forEach((other) => {
      if (other.id === blockId || other.collapsed) return;
      const ox = Number.isFinite(other.x) ? other.x : 0;
      const oy = Number.isFinite(other.y) ? other.y : 0;
      const ow = Number.isFinite(other.w) ? other.w : BLOCK_DEFAULTS.text.w;
      const oh = Number.isFinite(other.h) ? other.h : BLOCK_DEFAULTS.text.h;
      // [candidate x for the dragged block, guide line to draw]
      const xCandidates = [
        [ox, ox], // left edges align
        [ox + ow - w, ox + ow], // right edges align
        [ox + ow + SNAP_GAP, ox + ow + SNAP_GAP], // sit right of neighbor, one gutter
        [ox - w - SNAP_GAP, ox - SNAP_GAP], // sit left of neighbor, one gutter
        [ox + (ow - w) / 2, ox + ow / 2], // vertical centers align
      ];
      const yCandidates = [
        [oy, oy],
        [oy + oh - h, oy + oh],
        [oy + oh + SNAP_GAP, oy + oh + SNAP_GAP],
        [oy - h - SNAP_GAP, oy - SNAP_GAP],
        [oy + (oh - h) / 2, oy + oh / 2],
      ];
      xCandidates.forEach(([cx, gx]) => {
        const d = Math.abs(rawX - cx);
        if (d < bestDx && cx >= 0) {
          bestDx = d;
          x = cx;
          guideX = gx;
        }
      });
      yCandidates.forEach(([cy, gy]) => {
        const d = Math.abs(rawY - cy);
        if (d < bestDy && cy >= 0) {
          bestDy = d;
          y = cy;
          guideY = gy;
        }
      });
    });
    const xSnapped = bestDx <= SNAP_THRESHOLD;
    const ySnapped = bestDy <= SNAP_THRESHOLD;
    return {
      x: Math.round(xSnapped ? x : rawX),
      y: Math.round(ySnapped ? y : rawY),
      guideX: xSnapped ? Math.round(guideX) : null,
      guideY: ySnapped ? Math.round(guideY) : null,
    };
  };

  // Live guide lines while dragging — drawn by mutating the ref'd elements directly so
  // per-mousemove updates never re-render the (heavy) editor tree.
  const updateSnapGuides = (guideX, guideY) => {
    const v = snapGuideVRef.current;
    const hEl = snapGuideHRef.current;
    if (v) {
      if (guideX === null) {
        v.style.display = 'none';
      } else {
        v.style.display = 'block';
        v.style.left = `${guideX}px`;
      }
    }
    if (hEl) {
      if (guideY === null) {
        hEl.style.display = 'none';
      } else {
        hEl.style.display = 'block';
        hEl.style.top = `${guideY}px`;
      }
    }
  };

  const selectBlock = (id, options = {}) => {
    const { raise = true } = options;
    setActiveBlockId((current) => (current === id ? current : id));
    if (!raise) return;
    setBlocks((prev) => {
      const target = prev.find((item) => item.id === id);
      if (!target) return prev;
      const maxZ = getMaxZIndex(prev, (item) => item.priority === target.priority);
      if ((target.zIndex || 0) >= maxZ) return prev;
      const nextZ = maxZ + 1;
      return prev.map((item) => (item.id === id ? { ...item, zIndex: nextZ } : item));
    });
  };

  const addTextBlock = () => {
    const size = BLOCK_DEFAULTS.text;
    const position = getNextPosition(size);
    const blockId = getBlockId();
    textDraftsRef.current[blockId] = '';
    pushHistory('add-text');
    setBlocks((prev) => {
      const nextZ = getMaxZIndex(prev, (item) => !item.priority) + 1;
      return [
        ...prev,
        {
          id: blockId,
          type: 'text',
          value: '',
          title: '',
          locked: false,
          priority: false,
          collapsed: false,
          restoreHeight: null,
          bgColor: '',
          zIndex: nextZ,
          fontSize: size.fontSize,
          lineHeight: 1.4,
          textColor: '',
          bold: false,
          underline: false,
          ...size,
          ...position,
        },
      ];
    });
    markDirty();
    setAddMenuOpen(false);
  };

  const loadImageDimensions = (file) =>
    new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ width: BLOCK_DEFAULTS.image.w, height: BLOCK_DEFAULTS.image.h });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });

  const fitImageSize = (width, height) => {
    const maxWidth = Math.max(240, (canvasRef.current?.clientWidth || 720) - 80);
    const maxHeight = 360;
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    return {
      w: Math.round(width * scale),
      h: Math.round(height * scale),
    };
  };

  const addImageBlock = async (file) => {
    if (!file || !firebaseUser) return;
    if (!isOnline) {
      updateSaveStatus('Offline: image upload unavailable');
      setAddMenuOpen(false);
      return;
    }
    setImageUploading(true);
    try {
      const { width, height } = await loadImageDimensions(file);
      const size = fitImageSize(width, height);
      const assetPath = isTemplateMode
        ? `templates/${firebaseUser.uid}/${Date.now()}-${file.name}`
        : `notes/${firebaseUser.uid}/${noteId}/${Date.now()}-${file.name}`;
      const ref = storageRef(storage, assetPath);
      await uploadBytes(ref, file, {
        contentType: file.type || undefined,
        cacheControl: 'public,max-age=31536000,immutable',
      });
      const url = await getDownloadURL(ref);
      const position = getNextPosition(size);
      pushHistory('add-image');
      setBlocks((prev) => {
        const nextZ = getMaxZIndex(prev, (item) => !item.priority) + 1;
        return [
          ...prev,
          {
            id: getBlockId(),
            type: 'image',
            value: url,
            title: '',
            locked: false,
            priority: false,
            collapsed: false,
            restoreHeight: null,
            bgColor: '',
            zIndex: nextZ,
            textColor: '',
            bold: false,
            underline: false,
            fontSize: 14,
            ...size,
            ...position,
          },
        ];
      });
      markDirty();
    } catch (err) {
      console.error('Failed to upload image', err);
    } finally {
      setImageUploading(false);
      setAddMenuOpen(false);
    }
  };

  // Keep a stable reference for the document-level paste listener (avoids stale closures).
  addImageBlockRef.current = addImageBlock;

  const dropHasFiles = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('Files');

  const handleCanvasDragEnter = (event) => {
    if (isTemplateMode || !dropHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setImageDropActive(true);
  };

  const handleCanvasDragOver = (event) => {
    if (isTemplateMode || !dropHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleCanvasDragLeave = (event) => {
    if (!dropHasFiles(event)) return;
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setImageDropActive(false);
    }
  };

  const handleCanvasDrop = async (event) => {
    if (isTemplateMode || !dropHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setImageDropActive(false);
    const files = Array.from(event.dataTransfer.files || []).filter((file) =>
      (file.type || '').startsWith('image/'),
    );
    for (const file of files) {
      await addImageBlock(file);
    }
  };

  // Paste an image from the clipboard anywhere in the editor → drop it on the canvas.
  useEffect(() => {
    if (isTemplateMode) return undefined;
    const onPaste = (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type && item.type.startsWith('image/'));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      addImageBlockRef.current?.(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isTemplateMode]);

  // Open the OS file picker. Must run synchronously inside the click handler to keep
  // the user-activation the dialog requires (deferring via rAF/timeout drops it).
  const openImagePicker = () => {
    const input = fileInputRef.current;
    if (!input) return;
    input.click();
    setAddMenuOpen(false);
  };

  const updateBlock = (id, updates, options = {}) => {
    if (typeof updates.value === 'string') {
      textDraftsRef.current[id] = stripZeroWidth(updates.value);
    }
    if (options.recordHistory) {
      pushHistory(options.reason || 'update');
    }
    setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, ...updates } : block)));
    if (!options.skipDirty) {
      markDirty();
    }
  };

  const toggleBlockMenu = (id) => {
    setBlockMenuOpenId((current) => (current === id ? '' : id));
    selectBlock(id);
  };

  // After the context menu renders, measure it and keep it beside the cursor:
  // clamp horizontally, flip upward when it would overflow the bottom edge.
  useEffect(() => {
    if (!contextMenu) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = contextMenu.x;
    let top = contextMenu.y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, contextMenu.y - rect.height);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${top}px`;
  }, [contextMenu]);

  const startBlockRename = (block) => {
    setRenamingBlockId(block.id);
    setBlockTitleDraft(block.title || '');
    setBlockMenuOpenId('');
  };

  const commitBlockRename = (id) => {
    const next = blockTitleDraft.trim();
    const target = blocksRef.current.find((item) => item.id === id);
    if (target && next !== (target.title || '')) {
      updateBlock(id, { title: next }, { recordHistory: true, reason: 'rename-block' });
    }
    setRenamingBlockId('');
    setBlockTitleDraft('');
  };

  const togglePriority = (id) => {
    pushHistory('priority');
    setBlocks((prev) => {
      const target = prev.find((item) => item.id === id);
      if (!target) return prev;
      const nextPriority = !target.priority;
      const nextZ = getMaxZIndex(prev, (item) => item.priority === nextPriority) + 1;
      return prev.map((item) =>
        item.id === id ? { ...item, priority: nextPriority, zIndex: nextZ } : item,
      );
    });
    markDirty();
  };

  const deleteBlock = (id) => {
    pushHistory('delete');
    delete textDraftsRef.current[id];
    delete editorsByBlockRef.current[id];
    setBlocks((prev) => prev.filter((block) => block.id !== id));
    markDirty();
    if (blockMenuOpenId === id) setBlockMenuOpenId('');
    if (activeBlockId === id) setActiveBlockId('');
  };

  const confirmDeleteBlock = (id) => {
    if (id) setDeleteBlockId(id);
  };

  const toggleCollapseBlock = (id) => {
    pushHistory('collapse');
    setBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== id) return block;
        if (!block.collapsed) {
          const restoreHeight = Number.isFinite(block.h)
            ? block.h
            : BLOCK_DEFAULTS[block.type]?.h || 160;
          return { ...block, collapsed: true, restoreHeight, h: COLLAPSED_HEIGHT };
        }
        const nextHeight =
          Number.isFinite(block.restoreHeight) ? block.restoreHeight : BLOCK_DEFAULTS[block.type]?.h || 160;
        return { ...block, collapsed: false, restoreHeight: null, h: nextHeight };
      }),
    );
    markDirty();
  };

  const handleRichTextChange = (id, html) => {
    if (findRangesRef.current.length) clearFind();
    if (!textTypingRef.current) {
      pushHistory('text');
      textTypingRef.current = true;
    }
    textDraftsRef.current[id] = stripZeroWidth(html);
    markDirty();
    scheduleTextIdleReset();
  };

  const canUndo = useMemo(() => historyRef.current.length > 1, [historyVersion]);

  const handleUndo = () => {
    if (historyRef.current.length <= 1) return;
    const currentSnapshot = {
      blocks: cloneBlocks(getBlocksSnapshot()),
      canvasHeight: canvasHeightRef.current,
      ts: Date.now(),
      reason: 'undo-current',
    };
    const previousSnapshot = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [currentSnapshot, ...futureRef.current].slice(0, HISTORY_LIMIT);
    setHistoryVersion((prev) => prev + 1);
    applyHistorySnapshot(previousSnapshot);
  };

  // --- TipTap bridge (Phase 3) -------------------------------------------------
  // Reads formatting state from the active TipTap editor into the toolbar.
  const syncToolbarFromTiptap = useCallback((editor) => {
    if (!editor) return;
    const textStyle = editor.getAttributes('textStyle');
    const sizePx = Number.parseInt(textStyle.fontSize || '', 10);
    if (Number.isFinite(sizePx)) {
      setToolbarFontSize(sizePx);
    }
    const family = (textStyle.fontFamily || '').split(',')[0]?.replace(/["']/g, '').trim();
    const matchedFamily = FONT_FAMILY_OPTIONS.find((option) =>
      family?.toLowerCase()?.includes(option.value.replace(/["']/g, '').toLowerCase()),
    );
    setToolbarFontFamily(matchedFamily?.value || FONT_FAMILY_OPTIONS[0].value);
    const colorHex = toHexColor(textStyle.color || '');
    if (colorHex) setToolbarColor(colorHex);
    const highlightHex = toHexColor(editor.getAttributes('highlight').color || '');
    if (highlightHex) setToolbarHighlightColor(highlightHex);
    setToolbarBold(editor.isActive('bold'));
    setToolbarItalic(editor.isActive('italic'));
    setToolbarUnderline(editor.isActive('underline'));
    setToolbarStrike(editor.isActive('strike'));
    setToolbarBullets(editor.isActive('bulletList'));
    setToolbarNumbered(editor.isActive('orderedList'));
    setToolbarChecklist(editor.isActive('taskList'));
    setToolbarLink(editor.isActive('link'));
    setToolbarCodeBlock(editor.isActive('codeBlock'));
    if (editor.isActive({ textAlign: 'center' })) setToolbarAlign('center');
    else if (editor.isActive({ textAlign: 'right' })) setToolbarAlign('right');
    else if (editor.isActive({ textAlign: 'justify' })) setToolbarAlign('justify');
    else setToolbarAlign('left');
  }, []);

  const handleTiptapEditorActive = useCallback(
    (editor, blockId) => {
      activeEditorRef.current = editor;
      if (blockId) lastActiveBlockIdRef.current = blockId;
      syncToolbarFromTiptap(editor);
    },
    [syncToolbarFromTiptap],
  );

  const registerBlockEditor = useCallback((blockId, editor) => {
    if (editor) {
      editorsByBlockRef.current[blockId] = editor;
    } else {
      delete editorsByBlockRef.current[blockId];
      if (activeEditorRef.current && !Object.values(editorsByBlockRef.current).includes(activeEditorRef.current)) {
        activeEditorRef.current = null;
      }
    }
  }, []);

  // Resolve the editor a toolbar/context action should target, and the block id.
  const resolveActiveBlockId = () => activeTextId || lastActiveBlockIdRef.current || '';
  const resolveActiveEditor = () => {
    const id = resolveActiveBlockId();
    return editorsByBlockRef.current[id] || activeEditorRef.current || null;
  };

  // Capture the active editor's selection before a focus-stealing control (native
  // select, color picker, popups) takes focus, so we can restore it on apply.
  const rememberTiptapSelection = () => {
    const editor = resolveActiveEditor();
    if (!editor) {
      tiptapSelectionRef.current = null;
      return;
    }
    const { from, to } = editor.state.selection;
    tiptapSelectionRef.current = { from, to };
  };

  const applyTiptapTableAction = (action, options) => {
    const editor = resolveActiveEditor();
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (action) {
      case 'insertTable':
        chain.insertTable({
          rows: Math.max(1, Number(options?.rows) || 2),
          cols: Math.max(1, Number(options?.cols) || 2),
          withHeaderRow: false,
        });
        break;
      case 'tableRow':
        chain.addRowAfter();
        break;
      case 'tableColumn':
        chain.addColumnAfter();
        break;
      case 'tableDeleteRow':
        chain.deleteRow();
        break;
      case 'tableDeleteColumn':
        chain.deleteColumn();
        break;
      case 'tableDeleteTable':
        chain.deleteTable();
        break;
      default:
        // Row-height / column-width steppers have no TipTap equivalent — tables resize
        // by dragging column borders (resizable: true).
        return;
    }
    chain.run();
  };

  // Maps a toolbar updates object to TipTap commands. With a collapsed caret these set
  // stored marks, so the format applies only to the next typed text.
  const applyTiptapAction = (updates) => {
    const editor = resolveActiveEditor();
    if (!editor) return;
    if (updates.tableAction) {
      applyTiptapTableAction(updates.tableAction, updates.tableOptions);
      return;
    }
    let chain = editor.chain().focus();
    // Restore a selection captured before a focus-stealing control opened, so the
    // format lands on the text the user had selected.
    const stored = tiptapSelectionRef.current;
    if (stored && Number.isFinite(stored.from) && stored.from !== stored.to) {
      const max = editor.state.doc.content.size;
      chain = chain.setTextSelection({
        from: Math.min(stored.from, max),
        to: Math.min(stored.to, max),
      });
    }
    tiptapSelectionRef.current = null;
    if (updates.fontSize !== undefined) chain.setFontSize(`${updates.fontSize}px`);
    if (updates.textColor) chain.setColor(updates.textColor);
    if (updates.highlightColor) chain.setHighlight({ color: updates.highlightColor });
    if (updates.fontFamily) chain.setFontFamily(updates.fontFamily);
    if (updates.bold !== undefined) chain.toggleBold();
    if (updates.italic !== undefined) chain.toggleItalic();
    if (updates.underline !== undefined) chain.toggleUnderline();
    if (updates.strike !== undefined) chain.toggleStrike();
    if (updates.bullets) chain.toggleBulletList();
    if (updates.numbered) chain.toggleOrderedList();
    if (updates.checklist) chain.toggleTaskList();
    if (updates.quote) chain.toggleBlockquote();
    if (updates.codeBlock) chain.toggleCodeBlock();
    if (updates.align) chain.setTextAlign(updates.align);
    if (updates.link !== undefined) {
      if (updates.link) chain.extendMarkRange('link').setLink({ href: updates.link });
      else chain.extendMarkRange('link').unsetLink();
    }
    chain.run();
  };

  // Link button → open the in-app link popout (prefilled when editing an existing link).
  const handleLinkAction = () => {
    const editor = resolveActiveEditor();
    if (!editor) return;
    rememberTiptapSelection();
    const previous = editor.getAttributes('link')?.href || '';
    setLinkDraft(previous);
    setLinkEditing(Boolean(previous) || editor.isActive('link'));
    setLinkModalOpen(true);
  };

  const closeLinkModal = () => {
    setLinkModalOpen(false);
    setLinkDraft('');
    setLinkEditing(false);
  };

  const commitLink = () => {
    const url = linkDraft.trim();
    if (!url) {
      applyToolbarAction({ link: '' });
      closeLinkModal();
      return;
    }
    const href = /^(https?:|mailto:|tel:|#|\/)/i.test(url) ? url : `https://${url}`;
    applyToolbarAction({ link: href });
    closeLinkModal();
  };

  const removeLink = () => {
    applyToolbarAction({ link: '' });
    closeLinkModal();
  };

  const clampFontSize = (value) => Math.max(MIN_FONT_SIZE, Math.min(Math.round(value), MAX_FONT_SIZE));

  const readFontSizeAtCursor = (editor) => {
    const attr = editor.getAttributes('textStyle').fontSize;
    const parsed = Number.parseInt(attr || '', 10);
    if (Number.isFinite(parsed)) return parsed;
    const block = blocksRef.current.find((item) => item.id === resolveActiveBlockId());
    return block?.fontSize || BLOCK_DEFAULTS.text.fontSize;
  };

  // Absolute set (font-size number input). Selection → that whole selection becomes the
  // size; collapsed caret → a stored mark so only the next typed text takes it. Never
  // touches the block base (which would rescale every other line + the line spacing).
  const applyFontSize = (size) => {
    const nextSize = clampFontSize(size);
    setToolbarFontSize(nextSize);
    const editor = resolveActiveEditor();
    if (!editor) return;
    applyTiptapAction({ fontSize: nextSize });
  };

  // Increment/decrement. On a selection, bumps EACH text run by delta so mixed sizes
  // keep their differences (30+25 → 31+26, not both equal). On a collapsed caret, sets
  // a stored mark at current±delta for the next typed text only — never the block base.
  const stepFontSizeTiptap = (delta) => {
    const editor = resolveActiveEditor();
    if (!editor) return;
    const { state } = editor;
    const markType = state.schema.marks.textStyle;
    const { from, to, empty } = state.selection;

    if (empty || !markType) {
      const next = clampFontSize(readFontSizeAtCursor(editor) + delta);
      setToolbarFontSize(next);
      editor.chain().focus().setFontSize(`${next}px`).run();
      return;
    }

    const block = blocksRef.current.find((item) => item.id === resolveActiveBlockId());
    const blockBase = block?.fontSize || BLOCK_DEFAULTS.text.fontSize;
    let tr = state.tr;
    let anchorSize = null;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      if (start >= end) return;
      const existing = node.marks.find((mark) => mark.type === markType);
      const current = Number.parseInt(existing?.attrs?.fontSize || '', 10);
      const base = Number.isFinite(current) ? current : blockBase;
      const next = clampFontSize(base + delta);
      if (anchorSize === null) anchorSize = next;
      const attrs = { ...(existing ? existing.attrs : {}), fontSize: `${next}px` };
      tr = tr.addMark(start, end, markType.create(attrs));
    });
    if (tr.docChanged) {
      editor.view.focus();
      editor.view.dispatch(tr);
    }
    if (anchorSize !== null) setToolbarFontSize(anchorSize);
  };

  const commitFontSizeInput = (rawValue) => {
    const candidate = typeof rawValue === 'string' ? rawValue : fontSizeDraft;
    const parsed = Number.parseInt(candidate, 10);
    const fallback = fontSizeValue || BLOCK_DEFAULTS.text.fontSize;
    if (Number.isFinite(parsed)) {
      applyFontSize(parsed);
      setFontSizeDraft(String(Math.max(MIN_FONT_SIZE, Math.min(parsed, MAX_FONT_SIZE))));
      return;
    }
    setFontSizeDraft(String(fallback));
  };

  const stepFontSize = (delta) => {
    stepFontSizeTiptap(delta);
  };

  const applyToolbarAction = (updates) => {
    const blockId = resolveActiveBlockId();
    if (!blockId) return;
    // Line spacing is a block-level property (applied on the editor shell) and must
    // not require an active editor/selection.
    if (updates.lineSpacing !== undefined) {
      updateBlock(blockId, { lineHeight: updates.lineSpacing }, { recordHistory: true, reason: 'line-spacing' });
    }
    const editorUpdates = { ...updates };
    delete editorUpdates.lineSpacing;
    if (Object.keys(editorUpdates).length) applyTiptapAction(editorUpdates);
  };

  const handleFontSizeInputChange = (event) => {
    const nextValue = event.target.value.replace(/[^\d]/g, '');
    setFontSizeDraft(nextValue);
  };

  const copyCurrentStyle = () => {
    const editor = resolveActiveEditor();
    if (!editor) return;
      const ts = editor.getAttributes('textStyle');
      const hl = editor.getAttributes('highlight');
      const sizePx = Number.parseInt(ts.fontSize || '', 10);
      const align = editor.isActive({ textAlign: 'center' })
        ? 'center'
        : editor.isActive({ textAlign: 'right' })
          ? 'right'
          : editor.isActive({ textAlign: 'justify' })
            ? 'justify'
            : 'left';
      setCopiedTextStyle({
        fontSize: Number.isFinite(sizePx)
          ? sizePx
          : activeTextBlock?.fontSize || BLOCK_DEFAULTS.text.fontSize,
        fontFamily: (ts.fontFamily || '').split(',')[0]?.replace(/["']/g, '').trim() || '',
        textColor: toHexColor(ts.color || '') || '',
        highlightColor: toHexColor(hl.color || '') || '',
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        align,
        lineSpacing: activeTextBlock?.lineHeight || 1.4,
      });
  };

  const pasteCopiedStyle = () => {
    if (!copiedTextStyle) return;
    const editor = resolveActiveEditor();
    const blockId = resolveActiveBlockId();
    if (!editor || !blockId) return;
      pushHistory('paste-style');
      const chain = editor.chain().focus();
      if (copiedTextStyle.fontSize) chain.setFontSize(`${copiedTextStyle.fontSize}px`);
      if (copiedTextStyle.fontFamily) chain.setFontFamily(copiedTextStyle.fontFamily);
      if (copiedTextStyle.textColor) chain.setColor(copiedTextStyle.textColor);
      if (copiedTextStyle.highlightColor) chain.setHighlight({ color: copiedTextStyle.highlightColor });
      else chain.unsetHighlight();
      if (copiedTextStyle.align) chain.setTextAlign(copiedTextStyle.align);
      chain.run();
      if (editor.isActive('bold') !== copiedTextStyle.bold) editor.chain().focus().toggleBold().run();
      if (editor.isActive('italic') !== copiedTextStyle.italic) editor.chain().focus().toggleItalic().run();
      if (editor.isActive('underline') !== copiedTextStyle.underline) editor.chain().focus().toggleUnderline().run();
      if (editor.isActive('strike') !== copiedTextStyle.strike) editor.chain().focus().toggleStrike().run();
      updateBlock(blockId, { lineHeight: copiedTextStyle.lineSpacing || 1.4 });
  };

  const handleToolbarButtonMouseDown = (event) => {
    rememberTiptapSelection();
    event.preventDefault();
  };

  const handleToolbarFieldMouseDown = () => {
    rememberTiptapSelection();
  };

  const toggleTablePicker = () => {
    if (textControlsDisabled) return;
    if (!tablePickerOpen) {
      setTablePickerHover({ rows: 2, cols: 2 });
      const rect = tablePickerTriggerRef.current?.getBoundingClientRect();
      if (rect) {
        const popoverWidth = 220;
        const popoverHeight = 220;
        const nextLeft = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
        const nextTop = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - popoverHeight - 8));
        setTablePickerPos({ left: nextLeft, top: nextTop });
      }
    }
    setTablePickerOpen((prev) => !prev);
  };

  const executeContextAction = (action) => {
    const menu = contextMenu;
    if (!menu) return;
    const blockId = menu.blockId;

    if (action === 'add-text') {
      addTextBlock();
      setContextMenu(null);
      return;
    }
    if (action === 'add-photo') {
      openImagePicker();
      setContextMenu(null);
      return;
    }
    if (action === 'add-page') {
      increaseCanvas();
      setContextMenu(null);
      return;
    }

    if (!blockId) return;
    selectBlock(blockId);

    if (action === 'delete-block') {
      setContextMenu(null);
      confirmDeleteBlock(blockId);
      return;
    }
    if (action === 'toggle-lock') {
      updateBlock(
        blockId,
        { locked: !Boolean(contextMenuBlock?.locked) },
        { recordHistory: true, reason: 'pin' },
      );
      setContextMenu(null);
      return;
    }
    if (action === 'toggle-priority') {
      togglePriority(blockId);
      setContextMenu(null);
      return;
    }

    const tableCommandMap = {
      'table-row-add': { command: 'tableRow' },
      'table-col-add': { command: 'tableColumn' },
      'table-row-delete': { command: 'tableDeleteRow' },
      'table-col-delete': { command: 'tableDeleteColumn' },
      'table-delete': { command: 'tableDeleteTable' },
      'table-row-grow': { command: 'tableRowHeight', value: { delta: TABLE_ROW_RESIZE_STEP } },
      'table-row-shrink': { command: 'tableRowHeight', value: { delta: -TABLE_ROW_RESIZE_STEP } },
      'table-col-grow': { command: 'tableColumnWidth', value: { delta: TABLE_COLUMN_RESIZE_STEP } },
      'table-col-shrink': { command: 'tableColumnWidth', value: { delta: -TABLE_COLUMN_RESIZE_STEP } },
    };
    const tableCommand = tableCommandMap[action];
    if (tableCommand) {
      pushHistory('table-context');
      applyTiptapTableAction(tableCommand.command, tableCommand.value || null);
      setContextMenu(null);
      return;
    }

    const formatTiptapMap = {
      'fmt-bold': { bold: true },
      'fmt-italic': { italic: true },
      'fmt-underline': { underline: true },
      'fmt-strike': { strike: true },
    };
    if (formatTiptapMap[action]) {
      pushHistory('format-context');
      const editor = editorsByBlockRef.current[blockId];
      if (editor) {
        activeEditorRef.current = editor;
        lastActiveBlockIdRef.current = blockId;
        tiptapSelectionRef.current = null;
        applyTiptapAction(formatTiptapMap[action]);
      }
      setContextMenu(null);
    }
  };

  const handleCanvasContextMenu = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Raw cursor position; the post-render effect measures the real menu and
    // clamps/flips it, so short menus stay glued to the mouse.
    const nextX = event.clientX;
    const nextY = event.clientY;

    setTablePickerOpen(false);
    setBlockMenuOpenId('');

    const blockNode = target.closest('[data-block-id]');
    const blockId = blockNode?.getAttribute('data-block-id') || '';

    if (!blockId) {
      event.preventDefault();
      setContextMenu({ type: 'canvas', x: nextX, y: nextY, blockId: '' });
      return;
    }

    const block = blocksRef.current.find((item) => item.id === blockId);
    if (!block) return;
    event.preventDefault();
    selectBlock(blockId);

    if (block.type === 'text') {
      editorsByBlockRef.current[blockId]?.commands.focus();
      const inTable = Boolean(target.closest('td,th,table'));
      setContextMenu({ type: inTable ? 'table' : 'text', x: nextX, y: nextY, blockId });
      return;
    }

    setContextMenu({ type: 'block', x: nextX, y: nextY, blockId });
  };

  const increaseCanvas = () => {
    pushHistory('canvas');
    setCanvasHeight((prev) => prev + PAGE_HEIGHT);
    markDirty();
    setAddMenuOpen(false);
  };

  const handleSaveTemplate = async () => {
    if (!isTemplateMode || !firebaseUser || templateSaving) return;
    const name = templateBuilderName.trim();
    if (!name) return;
    setTemplateSaving(true);
    try {
      const blocksSnapshot = cloneBlocks(getBlocksSnapshot());
      const createdId = await createNoteTemplate(firebaseUser.uid, {
        name,
        blocks: blocksSnapshot,
        canvasHeight: canvasHeightRef.current,
      });
      let preferredClassId = '';
      try {
        const cachedDraft = sessionStorage.getItem(TEMPLATE_DRAFT_STORAGE_KEY);
        if (cachedDraft) {
          const parsedDraft = JSON.parse(cachedDraft);
          preferredClassId =
            typeof parsedDraft?.classId === 'string' && parsedDraft.classId.trim()
              ? parsedDraft.classId
              : '';
        }
        if (preferredClassId) {
          sessionStorage.setItem(DASHBOARD_RETURN_CLASS_KEY, preferredClassId);
        }
        sessionStorage.setItem(
          TEMPLATE_RESULT_STORAGE_KEY,
          JSON.stringify({
            uid: firebaseUser.uid,
            templateId: `${CUSTOM_TEMPLATE_PREFIX}${createdId}`,
            createdAt: Date.now(),
          }),
        );
      } catch {
        // Ignore storage failures and still navigate back.
      }
      if (preferredClassId) {
        navigate(`/dashboard?class=${encodeURIComponent(preferredClassId)}`, {
          state: { selectedClassId: preferredClassId },
        });
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('Failed to save template', err);
    } finally {
      setTemplateSaving(false);
    }
  };

  const toolbarFontGroup = (
    <div className="text-command-group">
      <select
        value={toolbarFontFamily}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarFieldMouseDown}
        onChange={(event) => {
          const nextFamily = event.target.value;
          setToolbarFontFamily(nextFamily);
          applyToolbarAction({ fontFamily: nextFamily });
        }}
        title="Font family"
      >
        {FONT_FAMILY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => stepFontSize(-1)}
        title="Decrease font size (Ctrl+Shift+,)"
      >
        -
      </button>
      <span className={`font-size-input-wrap ${fontSizeEditing ? 'editing' : ''}`}>
        <input
          type="number"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={fontSizeEditing ? fontSizeDraft : String(fontSizeValue)}
          disabled={textControlsDisabled}
          onMouseDown={handleToolbarFieldMouseDown}
          onFocus={(event) => {
            setFontSizeEditing(true);
            setFontSizeDraft(String(fontSizeValue || BLOCK_DEFAULTS.text.fontSize));
            event.currentTarget.select();
          }}
          onBlur={(event) => {
            const skipCommit = skipNextFontSizeBlurCommitRef.current;
            skipNextFontSizeBlurCommitRef.current = false;
            setFontSizeEditing(false);
            if (!skipCommit) {
              commitFontSizeInput(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              skipNextFontSizeBlurCommitRef.current = true;
              commitFontSizeInput(event.currentTarget.value);
              setFontSizeEditing(false);
              event.currentTarget.blur();
              requestAnimationFrame(() => {
                resolveActiveEditor()?.commands.focus();
              });
            } else if (event.key === 'Escape') {
              event.preventDefault();
              skipNextFontSizeBlurCommitRef.current = true;
              setFontSizeEditing(false);
              setFontSizeDraft(String(fontSizeValue || BLOCK_DEFAULTS.text.fontSize));
              event.currentTarget.blur();
            }
          }}
          onChange={handleFontSizeInputChange}
          title="Font size"
        />
      </span>
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => stepFontSize(1)}
        title="Increase font size (Ctrl+Shift+.)"
      >
        +
      </button>
    </div>
  );

  const toolbarColorGroup = (
    <div className="text-command-group">
      <input
        type="color"
        value={colorValue}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarFieldMouseDown}
        onChange={(event) => {
          const nextColor = normalizeHexColor(event.target.value, colorValue);
          setToolbarColor(nextColor);
          applyToolbarAction({ textColor: nextColor });
        }}
        title="Text color"
      />
      <input
        type="color"
        value={highlightColorValue}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarFieldMouseDown}
        onChange={(event) => {
          const nextColor = normalizeHexColor(event.target.value, highlightColorValue);
          setToolbarHighlightColor(nextColor);
          applyToolbarAction({ highlightColor: nextColor });
        }}
        title="Highlight color"
      />
    </div>
  );

  const toolbarStyleGroup = (
    <div className="text-command-group">
      <button
        type="button"
        className={toolbarBold ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ bold: !toolbarBold })}
        title="Bold (Ctrl+B)"
      >
        <FaBold />
      </button>
      <button
        type="button"
        className={toolbarItalic ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ italic: !toolbarItalic })}
        title="Italic (Ctrl+I)"
      >
        <FaItalic />
      </button>
      <button
        type="button"
        className={toolbarUnderline ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ underline: !toolbarUnderline })}
        title="Underline (Ctrl+U)"
      >
        <FaUnderline />
      </button>
      <button
        type="button"
        className={toolbarStrike ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ strike: !toolbarStrike })}
        title="Strikethrough (Ctrl+Shift+S)"
      >
        <FaStrikethrough />
      </button>
    </div>
  );

  const toolbarAlignGroup = (
    <div className="text-command-group">
      <button
        type="button"
        className={toolbarAlign === 'left' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'left' })}
        title="Align left (Ctrl+Shift+L)"
      >
        <FaAlignLeft />
      </button>
      <button
        type="button"
        className={toolbarAlign === 'center' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'center' })}
        title="Align center (Ctrl+Shift+E)"
      >
        <FaAlignCenter />
      </button>
      <button
        type="button"
        className={toolbarAlign === 'right' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'right' })}
        title="Align right (Ctrl+Shift+R)"
      >
        <FaAlignRight />
      </button>
      <button
        type="button"
        className={toolbarAlign === 'justify' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'justify' })}
        title="Justify (Ctrl+Shift+J)"
      >
        <FaAlignJustify />
      </button>
    </div>
  );

  const toolbarParagraphGroup = (
    <div className="text-command-group">
      <select
        value={lineSpacingValue}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarFieldMouseDown}
        onChange={(event) => {
          const nextValue = Number.parseFloat(event.target.value);
          if (!Number.isFinite(nextValue)) return;
          setToolbarLineSpacing(nextValue);
          applyToolbarAction({ lineSpacing: nextValue });
        }}
        title="Line spacing"
      >
        {LINE_SPACING_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ outdent: true })}
        title="Outdent"
      >
        <FaOutdent />
      </button>
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ indent: true })}
        title="Indent"
      >
        <FaIndent />
      </button>
    </div>
  );

  const toolbarListGroup = (
    <div className="text-command-group">
      <button
        type="button"
        className={toolbarBullets ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ bullets: true })}
        title="Bulleted list (Ctrl+Shift+8)"
      >
        <FaListUl />
      </button>
      <button
        type="button"
        className={toolbarNumbered ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ numbered: true })}
        title="Numbered list (Ctrl+Shift+7)"
      >
        <FaListOl />
      </button>
      <button
        type="button"
        className={toolbarChecklist ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ checklist: true })}
        title="Checklist (Ctrl+Shift+9)"
      >
        <FaCheckSquare />
      </button>
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ quote: true })}
        title="Quote (Ctrl+Shift+B)"
      >
        <FaQuoteRight />
      </button>
      <button
        type="button"
        className={toolbarLink ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={handleLinkAction}
        title="Link (Ctrl+K)"
      >
        <FaLink />
      </button>
      <button
        type="button"
        className={toolbarCodeBlock ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ codeBlock: true })}
        title="Code block (Ctrl+Alt+C)"
      >
        <FaCode />
      </button>
    </div>
  );

  const toolbarStyleClipboardGroup = (
    <div className="text-command-group">
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={copyCurrentStyle}
        title="Copy style"
      >
        <FaCopy />
      </button>
      <button
        type="button"
        disabled={textControlsDisabled || !copiedTextStyle}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={pasteCopiedStyle}
        title="Paste style"
      >
        <FaPaste />
      </button>
    </div>
  );

  const toolbarTableGroup = (
    <div className="text-command-group">
      <div className="table-picker-wrap" ref={tablePickerTriggerRef}>
        <button
          type="button"
          disabled={textControlsDisabled}
          onMouseDown={handleToolbarButtonMouseDown}
          onClick={toggleTablePicker}
          title="Insert table"
        >
          <FaTable />
        </button>
      </div>
    </div>
  );

  const toolbarCompactMore = (
    <div className="toolbar-more-wrap" ref={toolbarMoreRef}>
      <button
        type="button"
        className={toolbarMoreOpen ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => setToolbarMoreOpen((prev) => !prev)}
        title="More tools"
      >
        <FaEllipsisH />
      </button>
      {toolbarMoreOpen && !textControlsDisabled && (
        <div
          className="toolbar-more-panel"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          {toolbarAlignGroup}
          {toolbarParagraphGroup}
          {toolbarStyleClipboardGroup}
        </div>
      )}
    </div>
  );

  const segmentedGroups = {
    text: (
      <>
        {toolbarFontGroup}
        {toolbarColorGroup}
        {toolbarStyleGroup}
      </>
    ),
    paragraph: (
      <>
        {toolbarAlignGroup}
        {toolbarParagraphGroup}
        {toolbarListGroup}
      </>
    ),
    insert: <>{toolbarTableGroup}</>,
    more: <>{toolbarStyleClipboardGroup}</>,
  };

  if (!note) {
    return <ScreenLoader note="Preparing note..." />;
  }

  if (note.missing) {
    return (
      <div className="gate-shell">
        <div className="gate-card centered">
          <p className="status-text">Note not found.</p>
          <button className="ghost-btn" onClick={returnToDashboardClass}>
            Return to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`page-shell note-page-shell ${isTemplateMode ? 'template-mode' : ''}`}>
      <header className={`note-topbar compact ${isTemplateMode ? '' : 'no-title'}`}>
        <button
          className="ghost-btn note-back"
          onClick={returnToDashboardClass}
          title="Back to notes"
          aria-label="Back to notes"
        >
          <FaArrowLeft />
          <span className="note-back-label">Back</span>
        </button>
        {isTemplateMode && (
          <span className="template-mode-pill" title="Template creation mode">
            Template mode: {templateBuilderName}
          </span>
        )}
        <div className="note-toolbar">
          <div className={`text-command-bar ${toolbarMode} ${textControlsDisabled ? 'disabled' : ''}`}>
            {toolbarMode === 'segmented' && (
              <div className="toolbar-section-tabs">
                {[
                  { id: 'text', label: 'Text' },
                  { id: 'paragraph', label: 'Paragraph' },
                  { id: 'insert', label: 'Insert' },
                  { id: 'more', label: 'More' },
                ].map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={toolbarSection === section.id ? 'active' : ''}
                    disabled={textControlsDisabled}
                    onMouseDown={handleToolbarButtonMouseDown}
                    onClick={() => setToolbarSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            )}
            <div className={`toolbar-groups ${toolbarMode}`}>
              {toolbarMode === 'full' && (
                <>
                  {toolbarFontGroup}
                  {toolbarColorGroup}
                  {toolbarStyleGroup}
                  {toolbarAlignGroup}
                  {toolbarParagraphGroup}
                  {toolbarListGroup}
                  {toolbarStyleClipboardGroup}
                  {toolbarTableGroup}
                </>
              )}
              {toolbarMode === 'compact' && (
                <>
                  {toolbarFontGroup}
                  {toolbarColorGroup}
                  {toolbarStyleGroup}
                  {toolbarListGroup}
                  {toolbarTableGroup}
                  {toolbarCompactMore}
                </>
              )}
              {toolbarMode === 'segmented' && segmentedGroups[toolbarSection]}
            </div>
          </div>
          {!isOnline && <span className="net-status offline note-offline-pill">Offline</span>}
        </div>
      </header>
      <section className="note-editor">
        {imageDropActive && (
          <div className="canvas-drop-overlay" aria-hidden="true">
            <div className="canvas-drop-hint">
              <FaImage />
              <span>Drop image to add</span>
            </div>
          </div>
        )}
        <div
          className="note-canvas-scroll"
          ref={canvasScrollRef}
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
          <div
            className="note-canvas"
            ref={canvasRef}
            style={{ height: `${canvasHeight}px`, width: `${canvasWidth}px` }}
            onContextMenu={handleCanvasContextMenu}
            onMouseDown={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) {
                setBlockMenuOpenId('');
                setContextMenu(null);
                return;
              }
              if (
                target.closest('.block-menu-panel') ||
                target.closest('.block-menu-trigger') ||
                target.closest('.add-block-menu')
              ) {
                return;
              }
              setBlockMenuOpenId('');
              setContextMenu(null);
            }}
          >
            <span ref={snapGuideVRef} className="snap-guide snap-guide-v" aria-hidden="true" />
            <span ref={snapGuideHRef} className="snap-guide snap-guide-h" aria-hidden="true" />
            {blocks.map((block) => {
              const isActive = block.id === activeBlockId;
              const layer = block.priority ? PRIORITY_Z_OFFSET + block.zIndex : block.zIndex;
              const blockBackground = block.bgColor || '';
              return (
                <Rnd
                  key={block.id}
                  bounds="parent"
                  size={{ width: block.w, height: block.h }}
                  position={{ x: block.x, y: block.y }}
                  onDragStart={() => {
                    blockDraggingRef.current = true;
                    selectBlock(block.id, { raise: false });
                  }}
                  onDrag={(event, data) => {
                    const preview = snapToNeighbors(block.id, data.x, data.y, block.w, block.h);
                    updateSnapGuides(preview.guideX, preview.guideY);
                  }}
                  onDragStop={(event, data) => {
                    blockDraggingRef.current = false;
                    updateSnapGuides(null, null);
                    if (data.x === block.x && data.y === block.y) return;
                    const snapped = snapToNeighbors(block.id, data.x, data.y, block.w, block.h);
                    pushHistory('move');
                    setBlocks((prev) => {
                      const target = prev.find((item) => item.id === block.id);
                      if (!target) return prev;
                      const maxZ = getMaxZIndex(prev, (item) => item.priority === target.priority);
                      const nextZ = Math.max(maxZ + 1, target.zIndex || 0);
                      return prev.map((item) =>
                        item.id === block.id
                          ? { ...item, x: snapped.x, y: snapped.y, zIndex: nextZ }
                          : item,
                      );
                    });
                    markDirty();
                  }}
                  onResizeStart={() => {
                    blockDraggingRef.current = true;
                    selectBlock(block.id, { raise: false });
                  }}
                  onResizeStop={(event, dir, ref, delta, position) => {
                    blockDraggingRef.current = false;
                    const nextWidth = ref.offsetWidth;
                    const nextHeight = ref.offsetHeight;
                    if (
                      position.x === block.x &&
                      position.y === block.y &&
                      nextWidth === block.w &&
                      nextHeight === block.h
                    ) {
                      return;
                    }
                    pushHistory('resize');
                    updateBlock(block.id, {
                      x: position.x,
                      y: position.y,
                      w: nextWidth,
                      h: nextHeight,
                    });
                  }}
                  dragHandleClassName="note-block-header"
                  lockAspectRatio={block.type === 'image'}
                  minWidth={block.type === 'image' ? 180 : 160}
                  minHeight={block.collapsed ? COLLAPSED_HEIGHT : block.type === 'image' ? 140 : 140}
                  disableDragging={block.locked}
                  enableResizing={!block.locked && !block.collapsed}
                  style={{ zIndex: layer, overflow: 'visible' }}
                  onMouseDown={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest('.note-textarea')) {
                      return;
                    }
                    selectBlock(block.id, { raise: false });
                  }}
                >
                  <div
                    data-block-id={block.id}
                    className={`note-block ${isActive ? 'active' : ''} ${block.locked ? 'locked' : ''} ${
                      block.collapsed ? 'collapsed' : ''
                    } ${block.priority ? 'priority' : ''}`}
                  >
                    <div className="note-block-shell" data-block-id={block.id} style={blockBackground ? { background: blockBackground } : undefined}>
                      <div
                        className="note-block-header"
                        style={blockBackground ? { background: blockBackground } : undefined}
                        title={block.locked ? 'Pinned' : 'Drag to move'}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          toggleCollapseBlock(block.id);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setContextMenu(null);
                          toggleBlockMenu(block.id);
                        }}
                      >
                        {renamingBlockId === block.id ? (
                          <input
                            className="block-title-input"
                            value={blockTitleDraft}
                            autoFocus
                            placeholder={block.type === 'text' ? 'Text block' : 'Image block'}
                            onMouseDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onChange={(event) => setBlockTitleDraft(event.target.value)}
                            onBlur={() => commitBlockRename(block.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitBlockRename(block.id);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setRenamingBlockId('');
                                setBlockTitleDraft('');
                              }
                            }}
                          />
                        ) : (
                          <span
                            className={`note-block-title ${block.title ? '' : 'muted'}`}
                            title="Double-click to rename"
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              startBlockRename(block);
                            }}
                          >
                            {block.priority && (
                              <FaStar className="note-block-priority-star" aria-label="Priority" />
                            )}
                            {block.title || (block.type === 'text' ? 'Text block' : 'Image block')}
                          </span>
                        )}
                        <div className="note-block-actions">
                          <button
                            type="button"
                            className="block-collapse-trigger"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleCollapseBlock(block.id);
                            }}
                            title={block.collapsed ? 'Expand' : 'Collapse'}
                          >
                            {block.collapsed ? <FaChevronDown /> : <FaChevronUp />}
                          </button>
                          <button
                            type="button"
                            className="block-menu-trigger"
                            ref={(el) => {
                              if (el) {
                                blockMenuTriggerRefs.current[block.id] = el;
                              } else {
                                delete blockMenuTriggerRefs.current[block.id];
                              }
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleBlockMenu(block.id);
                            }}
                          >
                            <FaEllipsisH />
                          </button>
                        </div>
                      </div>
                      {/* Body stays mounted when collapsed (hidden via CSS) so the
                          TipTap editor instance and its content/undo survive collapse. */}
                      {(
                        <div
                          className={`note-block-body${block.collapsed ? ' note-block-body-collapsed' : ''}`}
                        >
                          {block.type === 'text' ? (
                            <Suspense fallback={null}>
                              <RichTextBlock
                                block={block}
                                onChange={(html) => handleRichTextChange(block.id, html)}
                                onRegister={(instance) => registerBlockEditor(block.id, instance)}
                                onActivate={(instance) => handleTiptapEditorActive(instance, block.id)}
                                onFocusBlock={() => selectBlock(block.id, { raise: false })}
                                onStepFontSize={stepFontSize}
                                onLink={handleLinkAction}
                              />
                            </Suspense>
                          ) : (
                            <img className="note-image" src={block.value} alt="Note asset" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Rnd>
              );
            })}
          </div>
        </div>
      </section>
      <div className="note-fab" ref={addMenuRef}>
        <button
          type="button"
          className="note-action-btn"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo last change"
        >
          <FaUndo />
        </button>
        <button
          type="button"
          className="add-block-btn"
          onClick={() => setAddMenuOpen((prev) => !prev)}
          onMouseDown={(event) => event.preventDefault()}
          title="Add block"
        >
          <FaPlus />
        </button>
          {addMenuOpen && (
            <div className="add-block-menu" onMouseDown={(event) => event.preventDefault()}>
              <button type="button" onClick={addTextBlock} onMouseDown={(event) => event.preventDefault()}>
                <FaFont /> Text block
              </button>
              <button
                type="button"
                onClick={openImagePicker}
                disabled={imageUploading}
              >
                <FaImage /> {imageUploading ? 'Uploading...' : 'Photo block'}
              </button>
              <button type="button" onClick={increaseCanvas} onMouseDown={(event) => event.preventDefault()}>
                <FaPlus /> Extend canvas
              </button>
            </div>
          )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-hidden="true"
          tabIndex={-1}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addImageBlock(file);
            e.target.value = '';
          }}
        />
      </div>
      {isTemplateMode && (
        <div className="template-save-dock">
          <button
            type="button"
            className="primary-btn"
            onClick={handleSaveTemplate}
            disabled={templateSaving}
          >
            {templateSaving ? 'Saving template...' : 'Save template'}
          </button>
        </div>
      )}
      {blockMenuOpenId && blockMenuBlock && (
        <div
          ref={blockMenuPanelRef}
          className="block-menu-panel floating"
          style={{ left: `${blockMenuPos.left}px`, top: `${blockMenuPos.top}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="block-menu-row">
            <label htmlFor={`title-${blockMenuBlock.id}`}>Title</label>
            <input
              id={`title-${blockMenuBlock.id}`}
              value={blockMenuBlock.title}
              placeholder="Add a title"
              onChange={(event) => updateBlock(blockMenuBlock.id, { title: event.target.value })}
            />
          </div>
          {blockMenuBlock.type === 'text' && (
            <div className="block-menu-row">
              <label htmlFor={`bg-${blockMenuBlock.id}`}>Block color</label>
              <div className="block-color-row">
                <input
                  id={`bg-${blockMenuBlock.id}`}
                  type="color"
                  value={blockMenuBlock.bgColor || '#161b21'}
                  onChange={(event) =>
                    updateBlock(
                      blockMenuBlock.id,
                      { bgColor: event.target.value },
                      { recordHistory: true, reason: 'bg-color' },
                    )
                  }
                />
                <button
                  type="button"
                  className="block-color-reset"
                  onClick={() =>
                    updateBlock(blockMenuBlock.id, { bgColor: '' }, { recordHistory: true, reason: 'bg-color' })
                  }
                >
                  Reset
                </button>
              </div>
            </div>
          )}
          <div className="block-menu-actions">
            <button
              type="button"
              onClick={() => updateBlock(blockMenuBlock.id, { locked: !blockMenuBlock.locked })}
            >
              {blockMenuBlock.locked ? <FaLockOpen /> : <FaLock />}
              {blockMenuBlock.locked ? 'Unpin' : 'Pin'}
            </button>
            <button type="button" onClick={() => togglePriority(blockMenuBlock.id)}>
              <FaStar />
              {blockMenuBlock.priority ? 'Priority on' : 'Priority off'}
            </button>
            <button type="button" className="danger" onClick={() => confirmDeleteBlock(blockMenuBlock.id)}>
              <FaTrash />
              Delete
            </button>
          </div>
        </div>
      )}
      {tablePickerOpen && !textControlsDisabled && (
        <div
          ref={tablePickerPopoverRef}
          className="table-picker-popover floating"
          style={{ left: `${tablePickerPos.left}px`, top: `${tablePickerPos.top}px` }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          <div className="table-picker-grid">
            {Array.from({ length: TABLE_PICKER_ROWS }).map((_, rowIndex) =>
              Array.from({ length: TABLE_PICKER_COLS }).map((__, colIndex) => {
                const active =
                  rowIndex + 1 <= tablePickerHover.rows && colIndex + 1 <= tablePickerHover.cols;
                return (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    type="button"
                    className={`table-picker-cell ${active ? 'active' : ''}`}
                    onMouseEnter={() =>
                      setTablePickerHover({
                        rows: rowIndex + 1,
                        cols: colIndex + 1,
                      })
                    }
                    onClick={() => {
                      applyToolbarAction({
                        tableAction: 'insertTable',
                        tableOptions: {
                          rows: rowIndex + 1,
                          cols: colIndex + 1,
                        },
                      });
                      setTablePickerOpen(false);
                    }}
                    aria-label={`Insert ${rowIndex + 1} by ${colIndex + 1} table`}
                  />
                );
              }),
            )}
          </div>
          <p>{`${tablePickerHover.rows} x ${tablePickerHover.cols}`}</p>
        </div>
      )}
      {contextMenu && (
        <div
          className="note-context-menu"
          ref={contextMenuRef}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.type === 'canvas' && (
            <>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('add-text')}
              >
                Add text block
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('add-photo')}
              >
                Add photo block
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('add-page')}
              >
                Extend canvas
              </button>
            </>
          )}
          {contextMenu.type === 'text' && (
            <>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('fmt-bold')}
              >
                Bold
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('fmt-italic')}
              >
                Italic
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('fmt-underline')}
              >
                Underline
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('fmt-strike')}
              >
                Strikethrough
              </button>
              <hr />
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('delete-block')}
              >
                Delete block
              </button>
            </>
          )}
          {contextMenu.type === 'table' && (
            <>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-row-add')}
              >
                Add row below
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-col-add')}
              >
                Add column right
              </button>
              <hr />
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-row-grow')}
              >
                Row taller
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-row-shrink')}
              >
                Row shorter
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-col-grow')}
              >
                Column wider
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-col-shrink')}
              >
                Column narrower
              </button>
              <hr />
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-row-delete')}
              >
                Delete row
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-col-delete')}
              >
                Delete column
              </button>
              <hr />
              <button
                type="button"
                className="danger"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('table-delete')}
              >
                Delete table
              </button>
            </>
          )}
          {contextMenu.type === 'block' && (
            <>
              <hr />
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('toggle-lock')}
              >
                {contextMenuBlock?.locked ? 'Unpin block' : 'Pin block'}
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('toggle-priority')}
              >
                {contextMenuBlock?.priority ? 'Priority off' : 'Priority on'}
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => executeContextAction('delete-block')}
              >
                Delete block
              </button>
            </>
          )}
        </div>
      )}

      {findInfo && (
        <div className="find-pill" role="status">
          {findInfo.count > 0 ? (
            <>
              <span className="find-pill-q">“{findInfo.query}”</span>
              <span className="find-pill-count">
                {findInfo.index + 1} of {findInfo.count}
              </span>
              <button type="button" onClick={() => gotoFind(-1)} title="Previous match">
                <FaChevronUp />
              </button>
              <button type="button" onClick={() => gotoFind(1)} title="Next match">
                <FaChevronDown />
              </button>
            </>
          ) : (
            <span className="find-pill-count">No matches for “{findInfo.query}”</span>
          )}
          <button type="button" className="find-pill-close" onClick={clearFind} title="Dismiss (Esc)">
            ✕
          </button>
        </div>
      )}
      {linkModalOpen && (
        <>
          <div className="overlay show" onClick={closeLinkModal} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card">
              <header>
                <h3>{linkEditing ? 'Edit link' : 'Add link'}</h3>
                <p className="status-text">Paste or type a URL — it opens in a new tab.</p>
              </header>
              <div className="sheet-fields">
                <label>
                  URL
                  <input
                    autoFocus
                    value={linkDraft}
                    placeholder="https://example.com"
                    onChange={(event) => setLinkDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitLink();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        closeLinkModal();
                      }
                    }}
                  />
                </label>
              </div>
              <footer className="modal-actions">
                {linkEditing && (
                  <button type="button" className="ghost-btn danger" onClick={removeLink}>
                    Remove
                  </button>
                )}
                <button type="button" className="ghost-btn" onClick={closeLinkModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-fill"
                  onClick={commitLink}
                  disabled={!linkDraft.trim()}
                >
                  {linkEditing ? 'Update' : 'Add link'}
                </button>
              </footer>
            </div>
          </div>
        </>
      )}

      {deleteBlockId && (
        <>
          <div className="overlay show" onClick={() => setDeleteBlockId('')} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card">
              <header>
                <h3>Delete block?</h3>
                <p className="status-text">You can undo this with the ↺ button.</p>
              </header>
              <footer className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setDeleteBlockId('')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => {
                    const id = deleteBlockId;
                    setDeleteBlockId('');
                    deleteBlock(id);
                  }}
                >
                  Delete block
                </button>
              </footer>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NoteEditor;
