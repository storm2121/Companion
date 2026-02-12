import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaArrowLeft,
  FaArrowRight,
  FaArrowUp,
  FaArrowDown,
  FaBold,
  FaChevronDown,
  FaChevronUp,
  FaEllipsisH,
  FaFont,
  FaImage,
  FaLock,
  FaLockOpen,
  FaListUl,
  FaPlus,
  FaStar,
  FaTrash,
  FaUnderline,
  FaUndo,
} from 'react-icons/fa';
import { Rnd } from 'react-rnd';
import { useNavigate, useParams } from 'react-router-dom';
import { getNote, updateNote } from '../services/library';
import { useAuth } from '../context/AuthContext';
import ScreenLoader from '../components/ui/ScreenLoader';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import useNetworkStatus from '../hooks/useNetworkStatus';

const PAGE_HEIGHT = 720;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const PRIORITY_Z_OFFSET = 100000;
const COLLAPSED_HEIGHT = 34;
const AUTO_SAVE_IDLE_MS = 3000;
const LOCAL_DRAFT_IDLE_MS = 1000;
const FORCE_SAVE_INTERVAL_MS = 60000;
const DRAFT_STORAGE_PREFIX = 'companion-note-draft';
const HISTORY_LIMIT = 20;
const TEXT_HISTORY_IDLE_MS = 1200;
const NUDGE_HOLD_DELAY_MS = 180;
const NUDGE_CLICK_DISTANCE = 180;
const NUDGE_HOLD_DISTANCE = 14;

const BLOCK_DEFAULTS = {
  text: { w: 260, h: 180, fontSize: 12 },
  image: { w: 280, h: 200 },
};

const stripZeroWidth = (html) => (typeof html === 'string' ? html.replace(/\u200b/g, '') : '');

const toHexColor = (value) => {
  if (!value) return '';
  if (value.startsWith('#')) return value;
  const matches = value.match(/\d+/g);
  if (!matches || matches.length < 3) return '';
  const [r, g, b] = matches.map((entry) => Number(entry));
  if ([r, g, b].some((num) => Number.isNaN(num))) return '';
  return `#${[r, g, b].map((num) => num.toString(16).padStart(2, '0')).join('')}`;
};

const cloneBlocks = (items = []) => items.map((block) => ({ ...block }));

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
  const { firebaseUser } = useAuth();
  const [note, setNote] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [canvasHeight, setCanvasHeight] = useState(PAGE_HEIGHT);
  const [saveStatus, setSaveStatus] = useState('All changes saved');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [blockMenuOpenId, setBlockMenuOpenId] = useState('');
  const [activeBlockId, setActiveBlockId] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [toolbarFontSize, setToolbarFontSize] = useState(BLOCK_DEFAULTS.text.fontSize);
  const [toolbarColor, setToolbarColor] = useState('#ffffff');
  const [toolbarBold, setToolbarBold] = useState(false);
  const [toolbarUnderline, setToolbarUnderline] = useState(false);
  const [toolbarBullets, setToolbarBullets] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const addMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const canvasScrollRef = useRef(null);
  const canvasRef = useRef(null);
  const textRefs = useRef({});
  const selectionRangeRef = useRef(null);
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
  const forceSaveRef = useRef(null);
  const localDraftTimeoutRef = useRef(null);
  const changeVersionRef = useRef(0);
  const lastSavedVersionRef = useRef(0);
  const saveStatusRef = useRef(saveStatus);
  const nudgeAnimationRef = useRef(null);
  const nudgePressTimeoutRef = useRef(null);
  const nudgeHoldActiveRef = useRef(false);
  const nudgePressedRef = useRef(false);
  const nudgeVectorRef = useRef({ x: 0, y: 0 });
  const navigate = useNavigate();
  const isOnline = useNetworkStatus();

  const draftKey = useMemo(() => {
    if (!firebaseUser) return '';
    return `${DRAFT_STORAGE_PREFIX}:${firebaseUser.uid}:${classId}:${noteId}`;
  }, [firebaseUser, classId, noteId]);

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
      const domValue = textRefs.current[block.id]?.innerHTML;
      const nextValue =
        typeof draftValue === 'string' ? stripZeroWidth(draftValue) : stripZeroWidth(domValue);
      if (typeof nextValue !== 'string' || nextValue === block.value) return block;
      return { ...block, value: nextValue };
    });
  }, []);

  const flushSave = useCallback(async (_reason = 'idle') => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (!firebaseUser || !note || note.missing) return;
    if (!dirtyRef.current) return;
    if (savingRef.current) return;
    if (lastSavedVersionRef.current === changeVersionRef.current) return;
    savingRef.current = true;
    updateSaveStatus('Saving...');
    const saveVersion = changeVersionRef.current;
    const payload = {
      blocks: getBlocksSnapshot(),
      canvasHeight: canvasHeightRef.current,
    };
    try {
      await updateNote(firebaseUser.uid, classId, noteId, payload);
      lastSavedVersionRef.current = saveVersion;
      if (changeVersionRef.current === saveVersion) {
        dirtyRef.current = false;
        updateSaveStatus('All changes saved');
        if (draftKey) {
          localStorage.removeItem(draftKey);
        }
      } else {
        dirtyRef.current = true;
        updateSaveStatus('Unsaved changes');
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          const handler = flushSaveRef.current;
          if (handler) {
            void handler('idle');
          }
        }, AUTO_SAVE_IDLE_MS);
      }
    } catch (err) {
      console.error('Failed to save note', err);
      updateSaveStatus('Save failed. Changes kept locally.');
    } finally {
      savingRef.current = false;
    }
  }, [firebaseUser, note, classId, noteId, draftKey, getBlocksSnapshot, updateSaveStatus]);

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
      selectionRangeRef.current = null;
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
  }, [firebaseUser, classId, noteId, draftKey, scheduleSave, seedTextDrafts, updateSaveStatus]);

  useEffect(() => {
    if (!note || note.missing || !firebaseUser) return;
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
    forceSaveRef.current = setInterval(() => {
      void flushSave('force');
    }, FORCE_SAVE_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (forceSaveRef.current) clearInterval(forceSaveRef.current);
    };
  }, [note, firebaseUser, classId, noteId, flushSave]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (localDraftTimeoutRef.current) clearTimeout(localDraftTimeoutRef.current);
      if (forceSaveRef.current) clearInterval(forceSaveRef.current);
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
    if (!activeBlockId) return;
    const element = textRefs.current[activeBlockId];
    if (!element) return;
    requestAnimationFrame(() => {
      element.focus();
    });
  }, [activeBlockId]);

  const statusLabel = useMemo(() => saveStatus, [saveStatus]);
  const activeTextBlock = useMemo(() => {
    const block = blocks.find((item) => item.id === activeBlockId);
    if (!block || block.type !== 'text') return null;
    return block;
  }, [blocks, activeBlockId]);
  const activeTextId = activeTextBlock?.id || '';
  const textControlsDisabled = !activeTextId;
  const activeFontSize = activeTextBlock?.fontSize || BLOCK_DEFAULTS.text.fontSize;
  const activeTextColor = activeTextBlock?.textColor || '#ffffff';
  const fontSizeValue = toolbarFontSize || activeFontSize;
  const colorValue = toolbarColor || activeTextColor;
  const canvasWidth = useMemo(() => {
    const maxRightEdge = blocks.reduce((max, block) => {
      const defaultWidth = BLOCK_DEFAULTS[block.type]?.w || BLOCK_DEFAULTS.text.w;
      const width = Number.isFinite(block.w) ? block.w : defaultWidth;
      const x = Number.isFinite(block.x) ? block.x : 0;
      return Math.max(max, x + width);
    }, 720);
    return Math.max(720, Math.ceil(maxRightEdge + 40));
  }, [blocks]);

  useEffect(() => {
    if (!activeTextBlock) return;
    setToolbarFontSize(activeTextBlock.fontSize || BLOCK_DEFAULTS.text.fontSize);
    setToolbarColor(activeTextBlock.textColor || '#ffffff');
    setToolbarBold(false);
    setToolbarUnderline(false);
    setToolbarBullets(false);
    selectionRangeRef.current = null;
  }, [activeTextBlock?.id]);

  const getNextPosition = (size) => {
    const gap = 20;
    const width = canvasRef.current?.clientWidth || 720;
    const columnWidth = size.w + gap;
    const columns = Math.max(1, Math.floor((width + gap) / columnWidth));
    const index = blocks.length;
    return {
      x: (index % columns) * columnWidth,
      y: Math.floor(index / columns) * (size.h + gap),
    };
  };

  const selectBlock = (id) => {
    setActiveBlockId(id);
    setBlocks((prev) => {
      const target = prev.find((item) => item.id === id);
      if (!target) return prev;
      const maxZ = getMaxZIndex(prev, (item) => item.priority === target.priority);
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
      const ref = storageRef(storage, `notes/${firebaseUser.uid}/${noteId}/${Date.now()}-${file.name}`);
      await uploadBytes(ref, file);
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
    setBlocks((prev) => prev.filter((block) => block.id !== id));
    markDirty();
    if (blockMenuOpenId === id) setBlockMenuOpenId('');
    if (activeBlockId === id) setActiveBlockId('');
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

  const handleTextInput = (id, html) => {
    if (!textTypingRef.current) {
      pushHistory('text');
      textTypingRef.current = true;
    }
    textDraftsRef.current[id] = stripZeroWidth(html);
    markDirty();
    scheduleTextIdleReset();
  };

  const rememberSelection = useCallback(() => {
    if (!activeTextId) return;
    const root = textRefs.current[activeTextId];
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    if (!root.contains(selection.anchorNode)) return;
    selectionRangeRef.current = selection.getRangeAt(0).cloneRange();
  }, [activeTextId]);

  const syncToolbarFromSelection = useCallback(() => {
    if (!activeTextId) return;
    const root = textRefs.current[activeTextId];
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    if (!root.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    selectionRangeRef.current = range.cloneRange();
    const node =
      selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    if (node instanceof HTMLElement) {
      const styles = window.getComputedStyle(node);
      const size = Number.parseInt(styles.fontSize || '', 10);
      if (Number.isFinite(size)) {
        setToolbarFontSize(size);
      }
      const hexColor = toHexColor(styles.color || '');
      if (hexColor) {
        setToolbarColor(hexColor);
      }
    }
    setToolbarBold(document.queryCommandState('bold'));
    setToolbarUnderline(document.queryCommandState('underline'));
    setToolbarBullets(document.queryCommandState('insertUnorderedList'));
  }, [activeTextId]);

  useEffect(() => {
    if (!activeTextId) return;
    const handleSelectionChange = () => {
      syncToolbarFromSelection();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [activeTextId, syncToolbarFromSelection]);

  const restoreSelection = (root) => {
    const selection = document.getSelection();
    if (!root || !selectionRangeRef.current || !selection) return false;
    const range = selectionRangeRef.current;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const applyFontSizeToSelection = (root, value) => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
    const nextSize = `${value}px`;
    if (range.collapsed) {
      const span = document.createElement('span');
      span.style.fontSize = nextSize;
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      const nextRange = document.createRange();
      nextRange.setStart(span.firstChild, 1);
      nextRange.setEnd(span.firstChild, 1);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      return true;
    }
    const span = document.createElement('span');
    span.style.fontSize = nextSize;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    return true;
  };

  const applySelectionCommand = (id, command, value) => {
    const element = textRefs.current[id];
    if (!element) return false;
    element.focus();
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
      restoreSelection(element);
    }
    if (command === 'fontSize') {
      applyFontSizeToSelection(element, value);
    } else {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(command, false, value);
    }
    textDraftsRef.current[id] = stripZeroWidth(element.innerHTML);
    markDirty();
    syncToolbarFromSelection();
    return true;
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

  const updateTextStyle = (id, updates) => {
    if (!id) return;
    pushHistory('format');
    if (updates.fontSize) {
      applySelectionCommand(id, 'fontSize', updates.fontSize);
    }
    if (updates.textColor) {
      applySelectionCommand(id, 'foreColor', updates.textColor);
    }
    if (updates.bold !== undefined) {
      applySelectionCommand(id, 'bold');
    }
    if (updates.underline !== undefined) {
      applySelectionCommand(id, 'underline');
    }
    if (updates.bullets) {
      applySelectionCommand(id, 'insertUnorderedList');
    }
  };

  const applyFontSize = (size) => {
    if (!activeTextId) return;
    const nextSize = Math.max(MIN_FONT_SIZE, Math.min(size, MAX_FONT_SIZE));
    setToolbarFontSize(nextSize);
    updateTextStyle(activeTextId, { fontSize: nextSize });
  };

  const stepFontSize = (delta) => {
    applyFontSize((fontSizeValue || BLOCK_DEFAULTS.text.fontSize) + delta);
  };

  const stopNudge = useCallback(() => {
    if (nudgeAnimationRef.current) {
      cancelAnimationFrame(nudgeAnimationRef.current);
      nudgeAnimationRef.current = null;
    }
    nudgeHoldActiveRef.current = false;
  }, []);

  const clearNudgePressTimer = useCallback(() => {
    if (nudgePressTimeoutRef.current) {
      clearTimeout(nudgePressTimeoutRef.current);
      nudgePressTimeoutRef.current = null;
    }
  }, []);

  const runNudgeFrame = useCallback(() => {
    if (!nudgeHoldActiveRef.current) return;
    const scroller = canvasScrollRef.current;
    if (!scroller) return;
    const { x, y } = nudgeVectorRef.current;
    scroller.scrollBy({
      left: x * NUDGE_HOLD_DISTANCE,
      top: y * NUDGE_HOLD_DISTANCE,
      behavior: 'auto',
    });
    nudgeAnimationRef.current = requestAnimationFrame(runNudgeFrame);
  }, []);

  const startNudgeHold = useCallback(
    (x, y) => {
      nudgeVectorRef.current = { x, y };
      if (nudgeHoldActiveRef.current) return;
      nudgeHoldActiveRef.current = true;
      nudgeAnimationRef.current = requestAnimationFrame(runNudgeFrame);
    },
    [runNudgeFrame],
  );

  const nudgeOnce = useCallback((x, y) => {
    const scroller = canvasScrollRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      left: x * NUDGE_CLICK_DISTANCE,
      top: y * NUDGE_CLICK_DISTANCE,
      behavior: 'smooth',
    });
  }, []);

  const handleNudgePressStart = useCallback(
    (x, y) => (event) => {
      event.preventDefault();
      nudgePressedRef.current = true;
      clearNudgePressTimer();
      stopNudge();
      nudgePressTimeoutRef.current = setTimeout(() => {
        startNudgeHold(x, y);
      }, NUDGE_HOLD_DELAY_MS);
    },
    [clearNudgePressTimer, startNudgeHold, stopNudge],
  );

  const handleNudgePressEnd = useCallback(
    (x, y) => (event) => {
      event.preventDefault();
      if (!nudgePressedRef.current) return;
      nudgePressedRef.current = false;
      const wasHolding = nudgeHoldActiveRef.current;
      clearNudgePressTimer();
      stopNudge();
      if (!wasHolding) {
        nudgeOnce(x, y);
      }
    },
    [clearNudgePressTimer, nudgeOnce, stopNudge],
  );

  const increaseCanvas = () => {
    pushHistory('canvas');
    setCanvasHeight((prev) => prev + PAGE_HEIGHT);
    markDirty();
    setAddMenuOpen(false);
  };

  useEffect(() => {
    const handleGlobalRelease = () => {
      nudgePressedRef.current = false;
      clearNudgePressTimer();
      stopNudge();
    };
    window.addEventListener('mouseup', handleGlobalRelease);
    window.addEventListener('touchend', handleGlobalRelease);
    window.addEventListener('touchcancel', handleGlobalRelease);
    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('touchend', handleGlobalRelease);
      window.removeEventListener('touchcancel', handleGlobalRelease);
    };
  }, [clearNudgePressTimer, stopNudge]);

  if (!note) {
    return <ScreenLoader note="Preparing note..." />;
  }

  if (note.missing) {
    return (
      <div className="gate-shell">
        <div className="gate-card centered">
          <p className="status-text">Note not found.</p>
          <button className="ghost-btn" onClick={() => navigate('/dashboard')}>
            Return to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell note-page-shell">
      <header className="note-topbar compact">
        <button className="ghost-btn note-back" onClick={() => navigate('/dashboard')} title="Back">
          <FaArrowLeft />
        </button>
        <div className="note-title-wrap">
          <h3 className="note-title">{note.title || 'Untitled Note'}</h3>
        </div>
        <div className="note-toolbar">
          {!isOnline && <span className="net-status offline">Offline</span>}
          <div className="canvas-nudge" aria-label="Scroll canvas controls">
            <button
              type="button"
              className="canvas-nudge-btn"
              title="Scroll down"
              onMouseDown={handleNudgePressStart(0, 1)}
              onMouseUp={handleNudgePressEnd(0, 1)}
              onTouchStart={handleNudgePressStart(0, 1)}
              onTouchEnd={handleNudgePressEnd(0, 1)}
            >
              <FaArrowDown />
            </button>
            <button
              type="button"
              className="canvas-nudge-btn"
              title="Scroll up"
              onMouseDown={handleNudgePressStart(0, -1)}
              onMouseUp={handleNudgePressEnd(0, -1)}
              onTouchStart={handleNudgePressStart(0, -1)}
              onTouchEnd={handleNudgePressEnd(0, -1)}
            >
              <FaArrowUp />
            </button>
            <button
              type="button"
              className="canvas-nudge-btn"
              title="Scroll left"
              onMouseDown={handleNudgePressStart(-1, 0)}
              onMouseUp={handleNudgePressEnd(-1, 0)}
              onTouchStart={handleNudgePressStart(-1, 0)}
              onTouchEnd={handleNudgePressEnd(-1, 0)}
            >
              <FaArrowLeft />
            </button>
            <button
              type="button"
              className="canvas-nudge-btn"
              title="Scroll right"
              onMouseDown={handleNudgePressStart(1, 0)}
              onMouseUp={handleNudgePressEnd(1, 0)}
              onTouchStart={handleNudgePressStart(1, 0)}
              onTouchEnd={handleNudgePressEnd(1, 0)}
            >
              <FaArrowRight />
            </button>
          </div>
          <span className="status-text">{statusLabel}</span>
        </div>
      </header>
      <section className="note-editor">
        <div className="note-canvas-scroll" ref={canvasScrollRef}>
          <div
            className="note-canvas"
            ref={canvasRef}
            style={{ height: `${canvasHeight}px`, width: `max(100%, ${canvasWidth}px)` }}
            onMouseDown={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) {
                setBlockMenuOpenId('');
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
            }}
          >
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
                    onDragStop={(event, data) => {
                      if (data.x === block.x && data.y === block.y) return;
                      pushHistory('move');
                      updateBlock(block.id, { x: data.x, y: data.y });
                    }}
                    onResizeStop={(event, dir, ref, delta, position) => {
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
                    selectBlock(block.id);
                  }}
                >
                  <div
                    className={`note-block ${isActive ? 'active' : ''} ${block.locked ? 'locked' : ''} ${
                      block.collapsed ? 'collapsed' : ''
                    }`}
                  >
                    <div className="note-block-shell" style={blockBackground ? { background: blockBackground } : undefined}>
                      <div
                        className="note-block-header"
                        style={blockBackground ? { background: blockBackground } : undefined}
                        title={block.locked ? 'Pinned' : 'Drag to move'}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          toggleCollapseBlock(block.id);
                        }}
                      >
                        <span className={`note-block-title ${block.title ? '' : 'muted'}`}>
                          {block.title || (block.type === 'text' ? 'Text block' : 'Image block')}
                        </span>
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
                      {!block.collapsed && (
                        <div className="note-block-body">
                          {block.type === 'text' ? (
                            <div
                              ref={(el) => {
                                if (!el) return;
                                textRefs.current[block.id] = el;
                                const desired = textDraftsRef.current[block.id] ?? block.value ?? '';
                                if (document.activeElement === el) return;
                                if (el.innerHTML !== desired) {
                                  el.innerHTML = desired;
                                }
                              }}
                              className="note-textarea"
                              contentEditable
                              suppressContentEditableWarning
                              onInput={(event) => handleTextInput(block.id, event.currentTarget.innerHTML)}
                              onFocus={() => selectBlock(block.id)}
                              onMouseUp={syncToolbarFromSelection}
                              onKeyUp={syncToolbarFromSelection}
                              style={{
                                fontSize: `${block.fontSize || BLOCK_DEFAULTS.text.fontSize}px`,
                                color: block.textColor || 'var(--text)',
                                fontWeight: block.bold ? 700 : 400,
                                textDecoration: block.underline ? 'underline' : 'none',
                              }}
                            />
                          ) : (
                            <img className="note-image" src={block.value} alt="Note asset" />
                          )}
                        </div>
                      )}
                    </div>
                    {blockMenuOpenId === block.id && (
                      <div className="block-menu-panel">
                        <div className="block-menu-row">
                          <label htmlFor={`title-${block.id}`}>Title</label>
                          <input
                            id={`title-${block.id}`}
                            value={block.title}
                            placeholder="Add a title"
                            onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                          />
                        </div>
                        {block.type === 'text' && (
                          <div className="block-menu-row">
                            <label htmlFor={`bg-${block.id}`}>Block color</label>
                            <div className="block-color-row">
                              <input
                                id={`bg-${block.id}`}
                                type="color"
                                value={block.bgColor || '#161b21'}
                                onChange={(event) =>
                                  updateBlock(block.id, { bgColor: event.target.value }, { recordHistory: true, reason: 'bg-color' })
                                }
                              />
                              <button
                                type="button"
                                className="block-color-reset"
                                onClick={() => updateBlock(block.id, { bgColor: '' }, { recordHistory: true, reason: 'bg-color' })}
                              >
                                Reset
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="block-menu-actions">
                          <button type="button" onClick={() => updateBlock(block.id, { locked: !block.locked })}>
                            {block.locked ? <FaLockOpen /> : <FaLock />}
                            {block.locked ? 'Unpin' : 'Pin'}
                          </button>
                          <button type="button" onClick={() => togglePriority(block.id)}>
                            <FaStar />
                            {block.priority ? 'Priority on' : 'Priority off'}
                          </button>
                          <button type="button" className="danger" onClick={() => deleteBlock(block.id)}>
                            <FaTrash />
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </Rnd>
              );
            })}
          </div>
        </div>
      </section>
      <div className="note-fab" ref={addMenuRef}>
        <div
          className={`fab-text-panel ${textControlsDisabled ? 'disabled' : ''}`}
          onMouseDown={rememberSelection}
        >
          <span className="fab-text-icon" aria-hidden="true">
            <FaFont />
          </span>
          <div className="fab-text-controls">
            <div className="fab-text-size">
            <button
              type="button"
              className={toolbarBullets ? 'active' : ''}
              disabled={textControlsDisabled}
              onMouseDown={(event) => {
                rememberSelection();
                event.preventDefault();
              }}
                onClick={() => stepFontSize(-1)}
                aria-label="Decrease font size"
              >
                -
              </button>
              <span>{fontSizeValue}px</span>
              <button
                type="button"
                disabled={textControlsDisabled}
                onMouseDown={(event) => {
                  rememberSelection();
                  event.preventDefault();
                }}
                onClick={() => stepFontSize(1)}
                aria-label="Increase font size"
              >
                +
              </button>
            </div>
            <input
              type="color"
              value={colorValue}
              disabled={textControlsDisabled}
              onMouseDown={() => {
                rememberSelection();
              }}
              onChange={(event) => {
                const nextColor = event.target.value;
                setToolbarColor(nextColor);
                if (activeTextId) {
                  updateTextStyle(activeTextId, { textColor: nextColor });
                }
              }}
            />
              <button
                type="button"
                className={toolbarBold ? 'active' : ''}
                disabled={textControlsDisabled}
                onMouseDown={(event) => {
                  rememberSelection();
                  event.preventDefault();
                }}
                onClick={() =>
                  activeTextId ? updateTextStyle(activeTextId, { bold: !toolbarBold }) : null
                }
              >
                <FaBold />
              </button>
              <button
                type="button"
                className={toolbarUnderline ? 'active' : ''}
                disabled={textControlsDisabled}
                onMouseDown={(event) => {
                  rememberSelection();
                  event.preventDefault();
                }}
                onClick={() =>
                  activeTextId ? updateTextStyle(activeTextId, { underline: !toolbarUnderline }) : null
                }
              >
                <FaUnderline />
              </button>
              <button
                type="button"
                disabled={textControlsDisabled}
                onMouseDown={(event) => {
                  rememberSelection();
                  event.preventDefault();
                }}
                onClick={() => (activeTextId ? updateTextStyle(activeTextId, { bullets: true }) : null)}
              >
              <FaListUl />
            </button>
          </div>
        </div>
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
                onClick={() => fileInputRef.current?.click()}
                disabled={imageUploading}
                onMouseDown={(event) => event.preventDefault()}
              >
                <FaImage /> {imageUploading ? 'Uploading...' : 'Photo block'}
              </button>
              <button type="button" onClick={increaseCanvas} onMouseDown={(event) => event.preventDefault()}>
                <FaPlus /> Add page
              </button>
            </div>
          )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addImageBlock(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};

export default NoteEditor;
