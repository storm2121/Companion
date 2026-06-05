import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaArrowLeft,
  FaArrowRight,
  FaArrowUp,
  FaArrowDown,
  FaAlignCenter,
  FaAlignJustify,
  FaAlignLeft,
  FaAlignRight,
  FaBold,
  FaCheckSquare,
  FaChevronDown,
  FaChevronUp,
  FaCopy,
  FaEllipsisH,
  FaFont,
  FaImage,
  FaIndent,
  FaItalic,
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
import { createNoteTemplate, getNote, saveNoteContentDelta } from '../services/library';
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
const NUDGE_HOLD_DELAY_MS = 180;
const NUDGE_CLICK_DISTANCE = 180;
const NUDGE_HOLD_DISTANCE = 14;
const TABLE_PICKER_ROWS = 8;
const TABLE_PICKER_COLS = 10;
const TABLE_ROW_RESIZE_STEP = 10;
const TABLE_COLUMN_RESIZE_STEP = 24;
const MIN_TABLE_WIDTH = 140;
const MIN_TABLE_HEIGHT = 96;
const TABLE_HANDLE_DIRECTIONS = ['nw', 'ne', 'sw', 'se'];
const HELD_SELECTION_HIGHLIGHT_KEY = 'companion-held-selection';
const FONT_FAMILY_OPTIONS = [
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
  text: { w: 260, h: 180, fontSize: 12 },
  image: { w: 280, h: 200 },
};

const LEGACY_FONT_SIZE_MAP = {
  '1': 10,
  '2': 13,
  '3': 16,
  '4': 18,
  '5': 24,
  '6': 32,
  '7': 48,
};

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

const normalizeLegacyFontNodes = (root) => {
  if (!root) return;
  root.querySelectorAll('font').forEach((fontNode) => {
    const span = document.createElement('span');
    const existingStyle = fontNode.getAttribute('style');
    if (existingStyle) span.setAttribute('style', existingStyle);
    const declaredSize = fontNode.getAttribute('size');
    const inlineSize = (fontNode.style?.fontSize || '').trim();
    const pxMatch = inlineSize.match(/^([\d.]+)px$/i);
    let resolvedPx = null;
    if (pxMatch) {
      resolvedPx = Number.parseFloat(pxMatch[1]);
    } else if (declaredSize && LEGACY_FONT_SIZE_MAP[declaredSize]) {
      resolvedPx = LEGACY_FONT_SIZE_MAP[declaredSize];
    }
    // Only pin a font-size when the legacy node actually declared one. Forcing a
    // fallback here was overriding inherited sizes and snapping pasted text to the
    // block's base size.
    if (Number.isFinite(resolvedPx)) {
      span.style.fontSize = `${Math.max(MIN_FONT_SIZE, Math.min(resolvedPx, MAX_FONT_SIZE))}px`;
    }
    const face = fontNode.getAttribute('face');
    if (face && !span.style.fontFamily) span.style.fontFamily = face;
    const color = fontNode.getAttribute('color');
    if (color && !span.style.color) span.style.color = color;
    while (fontNode.firstChild) span.appendChild(fontNode.firstChild);
    fontNode.replaceWith(span);
  });
};

const clearInlineFontSizeInFragment = (fragment) => {
  if (!fragment) return;
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
  const elements = [];
  while (walker.nextNode()) {
    elements.push(walker.currentNode);
  }
  elements.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.removeProperty('font-size');
    node.style.removeProperty('line-height');
    node.style.removeProperty('margin-top');
    node.style.removeProperty('margin-bottom');
    node.style.removeProperty('padding-top');
    node.style.removeProperty('padding-bottom');
    if (node.tagName === 'FONT') {
      node.removeAttribute('size');
    }
  });
};

const unwrapElementKeepChildren = (element) => {
  if (!(element instanceof HTMLElement) || !element.parentNode) return;
  const fragment = document.createDocumentFragment();
  while (element.firstChild) {
    fragment.appendChild(element.firstChild);
  }
  element.replaceWith(fragment);
};

const isWhitespaceLike = (value) => stripZeroWidth(value || '').replace(/\u00a0/g, ' ').trim() === '';

const elementHasOnlyBreakLikeContent = (element) => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.matches('[data-note-table-shell], [data-note-table], table')) return false;
  const children = Array.from(element.childNodes);
  if (!children.length) return true;
  return children.every((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      return isWhitespaceLike(child.textContent || '');
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return true;
    const childElement = child;
    if (childElement.tagName === 'BR') return true;
    return elementHasOnlyBreakLikeContent(childElement);
  });
};

const stripZeroWidthTextNodes = (root, options = {}) => {
  const { skipWithin = null } = options;
  if (!(root instanceof HTMLElement)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  textNodes.forEach((node) => {
    if (!(node instanceof Text)) return;
    if (skipWithin && skipWithin.contains(node)) return;
    if (!node.nodeValue?.includes('\u200b')) return;
    node.nodeValue = node.nodeValue.replace(/\u200b/g, '');
    if ((node.nodeValue || '').length > 0) return;
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  });
};

const cleanupFontSizeArtifacts = (root, options = {}) => {
  if (!(root instanceof HTMLElement)) return;
  const { keepNode = null } = options;
  normalizeLegacyFontNodes(root);
  stripZeroWidthTextNodes(root, { skipWithin: keepNode });
  const formattingNodes = Array.from(root.querySelectorAll('*'));
  formattingNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node === root) return;
    if (node.matches('[data-note-table-shell], [data-note-table], table, tr, td, th')) return;
    if (keepNode && (node === keepNode || keepNode.contains(node))) return;

    const touchesKeepNode = Boolean(keepNode && node.contains(keepNode));
    const breakOnly = elementHasOnlyBreakLikeContent(node);
    const hadFontSizing =
      Boolean(node.style.fontSize) ||
      Boolean(node.style.lineHeight) ||
      Boolean(node.style.marginTop) ||
      Boolean(node.style.marginBottom) ||
      Boolean(node.style.paddingTop) ||
      Boolean(node.style.paddingBottom) ||
      node.tagName === 'FONT' ||
      node.hasAttribute('size');
    if (touchesKeepNode || breakOnly) {
      if (node.style.fontSize) node.style.removeProperty('font-size');
      if (node.style.lineHeight) node.style.removeProperty('line-height');
      if (node.tagName === 'FONT') node.removeAttribute('size');
    }
    if (breakOnly) {
      node.style.removeProperty('font-size');
      node.style.removeProperty('line-height');
      node.style.removeProperty('margin-top');
      node.style.removeProperty('margin-bottom');
      node.style.removeProperty('padding-top');
      node.style.removeProperty('padding-bottom');
      if (node.tagName === 'FONT') {
        node.removeAttribute('size');
      }
      const isInlineWrapper = node.tagName === 'SPAN' || node.tagName === 'FONT';
      const containsBreak = Boolean(node.querySelector?.('br'));
      const visibleTextLength = stripZeroWidth(node.textContent || '').length;
      // Only drop genuinely-empty inline style wrappers (font-size artifacts).
      // Never delete blank lines (<br>) or whitespace text — doing so was eating
      // user spaces and collapsing intentional blank lines.
      if (hadFontSizing && isInlineWrapper && !containsBreak && visibleTextLength === 0) {
        node.remove();
        return;
      }
    }
    if ((node.tagName === 'SPAN' || node.tagName === 'FONT') && node.style.length === 0 && breakOnly) {
      unwrapElementKeepChildren(node);
    }
  });

  const emptySpans = Array.from(root.querySelectorAll('span'));
  emptySpans.forEach((span) => {
    if (!(span instanceof HTMLElement)) return;
    if (keepNode && (span === keepNode || span.contains(keepNode))) return;
    const hasTable = span.querySelector('[data-note-table-shell="true"]');
    const hasBreak = span.querySelector('br');
    // Truly empty wrappers only — a span holding a real space must survive so the
    // space between words is preserved.
    if (!hasTable && !hasBreak && stripZeroWidth(span.textContent || '').length === 0) {
      span.remove();
    }
  });
};

const PASTE_ALLOWED_TAGS = new Set([
  'P', 'DIV', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP',
  'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
  'CODE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

const PASTE_REMOVE_TAGS = [
  'script', 'style', 'meta', 'link', 'head', 'title', 'iframe', 'object', 'embed',
  'noscript', 'form', 'input', 'textarea', 'button', 'select', 'option', 'svg', 'img',
  'video', 'audio', 'canvas',
];

const PASTE_STYLE_BASE = new Set([
  'color', 'background-color', 'background', 'font-size', 'font-family', 'font-weight',
  'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'line-height',
]);

const PASTE_STYLE_TABLE = new Set([
  'border', 'border-color', 'border-width', 'border-style', 'padding', 'width', 'height',
  'min-width', 'vertical-align',
]);

const normalizePasteFontSize = (raw) => {
  const trimmed = (raw || '').trim();
  const pxMatch = trimmed.match(/^([\d.]+)px$/i);
  const ptMatch = trimmed.match(/^([\d.]+)pt$/i);
  let px = null;
  if (pxMatch) px = Number.parseFloat(pxMatch[1]);
  else if (ptMatch) px = Number.parseFloat(ptMatch[1]) * (96 / 72);
  if (!Number.isFinite(px)) return '';
  return `${Math.round(Math.max(MIN_FONT_SIZE, Math.min(px, MAX_FONT_SIZE)))}px`;
};

const sanitizePasteStyle = (element) => {
  const style = element.style;
  if (!style || style.length === 0) {
    element.removeAttribute('style');
    return;
  }
  const isTableCell = ['TABLE', 'TR', 'TD', 'TH'].includes(element.tagName);
  const kept = [];
  for (let index = 0; index < style.length; index += 1) {
    const prop = style.item(index);
    const allowed = PASTE_STYLE_BASE.has(prop) || (isTableCell && PASTE_STYLE_TABLE.has(prop));
    if (!allowed) continue;
    let value = style.getPropertyValue(prop);
    if (prop === 'font-size') {
      value = normalizePasteFontSize(value);
      if (!value) continue;
    }
    kept.push([prop, value]);
  }
  element.removeAttribute('style');
  kept.forEach(([prop, value]) => element.style.setProperty(prop, value));
};

// Sanitize pasted HTML in a detached container: drop dangerous/structural nodes,
// unwrap unknown tags (keeping their text), and strip every attribute except a
// safe inline-style allow-list. This is what lets us stop running destructive
// cleanup on every render — junk is cleaned once, at the door.
const sanitizePastedFragment = (container) => {
  if (!(container instanceof HTMLElement)) return;
  PASTE_REMOVE_TAGS.forEach((tag) => {
    container.querySelectorAll(tag).forEach((node) => node.remove());
  });
  // Convert <font> → <span style> first so face/color/size survive the attr scrub.
  normalizeLegacyFontNodes(container);
  Array.from(container.querySelectorAll('*')).forEach((element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return;
    if (!PASTE_ALLOWED_TAGS.has(element.tagName)) {
      unwrapElementKeepChildren(element);
      return;
    }
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name === 'style') return;
      if (element.tagName === 'A' && name === 'href') {
        if (/^\s*javascript:/i.test(attr.value)) element.removeAttribute(attr.name);
        return;
      }
      if ((element.tagName === 'TD' || element.tagName === 'TH') && (name === 'colspan' || name === 'rowspan')) {
        return;
      }
      element.removeAttribute(attr.name);
    });
    sanitizePasteStyle(element);
  });
};

const escapeHtmlForPaste = (value) =>
  (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\r?\n/)
    .join('<br>');

const cloneBlocks = (items = []) => items.map((block) => ({ ...block }));

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
  const [toolbarAlign, setToolbarAlign] = useState('left');
  const [toolbarLineSpacing, setToolbarLineSpacing] = useState(1.4);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(BLOCK_DEFAULTS.text.fontSize));
  const [fontSizeEditing, setFontSizeEditing] = useState(false);
  const [copiedTextStyle, setCopiedTextStyle] = useState(null);
  const [toolbarMode, setToolbarMode] = useState('full');
  const [toolbarSection, setToolbarSection] = useState('text');
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [heldSelectionRects, setHeldSelectionRects] = useState([]);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tablePickerHover, setTablePickerHover] = useState({ rows: 2, cols: 2 });
  const [tablePickerPos, setTablePickerPos] = useState({ left: 12, top: 72 });
  const [blockMenuPos, setBlockMenuPos] = useState({ left: 12, top: 72 });
  const [historyVersion, setHistoryVersion] = useState(0);
  const addMenuRef = useRef(null);
  const toolbarMoreRef = useRef(null);
  const tablePickerTriggerRef = useRef(null);
  const tablePickerPopoverRef = useRef(null);
  const blockMenuPanelRef = useRef(null);
  const blockMenuTriggerRefs = useRef({});
  const fileInputRef = useRef(null);
  const canvasScrollRef = useRef(null);
  const canvasRef = useRef(null);
  const textRefs = useRef({});
  const selectionRangeRef = useRef(null);
  const heldSelectionRangeRef = useRef(null);
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
  const nudgeAnimationRef = useRef(null);
  const nudgePressTimeoutRef = useRef(null);
  const nudgeHoldActiveRef = useRef(false);
  const nudgePressedRef = useRef(false);
  const nudgeVectorRef = useRef({ x: 0, y: 0 });
  const blockDraggingRef = useRef(false);
  const tableResizeRef = useRef(null);
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
      const domValue = textRefs.current[block.id]?.innerHTML;
      const nextValue =
        typeof draftValue === 'string' ? stripZeroWidth(draftValue) : stripZeroWidth(domValue);
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
      selectionRangeRef.current = null;
      heldSelectionRangeRef.current = null;
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
      if (tableResizeRef.current?.end) {
        tableResizeRef.current.end();
      }
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
    const element = textRefs.current[activeBlockId];
    if (!element) return;
    requestAnimationFrame(() => {
      element.focus();
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
    }, 720);
    return Math.max(720, Math.ceil(maxRightEdge + 40));
  }, [blocks]);

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
    selectionRangeRef.current = null;
    heldSelectionRangeRef.current = null;
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

  const normalizeTableShells = (root) => {
    if (!(root instanceof HTMLElement)) return;

    root.querySelectorAll('[data-table-resize-handle]').forEach((handle) => {
      if (!(handle instanceof HTMLElement)) return;
      const direction = handle.getAttribute('data-table-resize-handle');
      const shell = handle.closest('.note-table-shell');
      if (!shell || handle.parentElement !== shell || !TABLE_HANDLE_DIRECTIONS.includes(direction || '')) {
        handle.remove();
      }
    });

    root.querySelectorAll('.note-table-shell').forEach((shellNode) => {
      if (!(shellNode instanceof HTMLElement)) return;
      const table = shellNode.querySelector('table[data-note-table="true"], table');
      if (!(table instanceof HTMLTableElement)) {
        shellNode.remove();
        return;
      }
      table.setAttribute('data-note-table', 'true');
      table.style.width = '100%';
      table.style.height = '100%';
      table.style.tableLayout = 'fixed';
      table.style.borderCollapse = 'collapse';

      const existing = new Set();
      Array.from(shellNode.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        const direction = child.getAttribute('data-table-resize-handle');
        if (direction && TABLE_HANDLE_DIRECTIONS.includes(direction)) {
          existing.add(direction);
        }
      });
      TABLE_HANDLE_DIRECTIONS.forEach((direction) => {
        if (existing.has(direction)) return;
        const handle = document.createElement('span');
        handle.className = `note-table-resize-handle note-table-resize-${direction}`;
        handle.setAttribute('data-table-resize-handle', direction);
        handle.setAttribute('contenteditable', 'false');
        shellNode.appendChild(handle);
      });
    });
  };

  const handleTextInput = (id, html, root) => {
    if (!textTypingRef.current) {
      pushHistory('text');
      textTypingRef.current = true;
    }
    if (root instanceof HTMLElement) {
      normalizeTableShells(root);
      html = root.innerHTML;
    }
    textDraftsRef.current[id] = stripZeroWidth(html);
    markDirty();
    scheduleTextIdleReset();
  };

  const handleEditorPaste = (event, blockId) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    event.preventDefault();
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');
    let payload = '';
    if (html && html.trim()) {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      sanitizePastedFragment(holder);
      cleanupFontSizeArtifacts(holder, { fallbackPx: BLOCK_DEFAULTS.text.fontSize });
      payload = holder.innerHTML;
    } else if (text) {
      payload = escapeHtmlForPaste(text);
    }
    if (!payload) return;
    if (!textTypingRef.current) {
      pushHistory('paste');
      textTypingRef.current = true;
    }
    document.execCommand('insertHTML', false, payload);
    const root = textRefs.current[blockId];
    if (root instanceof HTMLElement) {
      normalizeTableShells(root);
      textDraftsRef.current[blockId] = stripZeroWidth(root.innerHTML);
    }
    markDirty();
    scheduleTextIdleReset();
  };

  const rememberSelection = useCallback(
    (preferredBlockId) => {
      const blockId = preferredBlockId || activeTextId;
      if (!blockId) return;
      const root = textRefs.current[blockId];
      const selection = document.getSelection();
      if (!root || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      selectionRangeRef.current = range.cloneRange();
    },
    [activeTextId],
  );

  const setSelectionRangeSafe = (root, range, options = {}) => {
    const { fallbackToEnd = false } = options;
    const selection = document.getSelection();
    if (!root || !range || !selection) return false;

    const assignRange = (nextRange) => {
      try {
        selection.removeAllRanges();
        selection.addRange(nextRange);
        return true;
      } catch {
        return false;
      }
    };

    const validRange =
      range.startContainer &&
      range.endContainer &&
      Boolean(range.startContainer.isConnected) &&
      Boolean(range.endContainer.isConnected) &&
      root.contains(range.startContainer) &&
      root.contains(range.endContainer);

    if (validRange && assignRange(range)) {
      return true;
    }
    if (!fallbackToEnd) return false;

    try {
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(root);
      fallbackRange.collapse(false);
      if (assignRange(fallbackRange)) {
        selectionRangeRef.current = fallbackRange.cloneRange();
        return true;
      }
    } catch {
      // Ignore fallback selection errors.
    }
    return false;
  };

  const placeCaretFromPoint = (root, x, y) => {
    if (!root) return false;
    const selection = document.getSelection();
    if (!selection) return false;
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.setEnd(position.offsetNode, position.offset);
      }
    }
    if (!range) return false;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
    if (!setSelectionRangeSafe(root, range)) return false;
    const active = document.getSelection();
    if (active && active.rangeCount > 0) {
      selectionRangeRef.current = active.getRangeAt(0).cloneRange();
    }
    return Boolean(active && active.rangeCount > 0);
  };

  const clearHeldSelectionHighlight = useCallback(() => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete(HELD_SELECTION_HIGHLIGHT_KEY);
    }
    setHeldSelectionRects([]);
  }, []);

  const showHeldSelectionHighlight = useCallback(() => {
    const range = selectionRangeRef.current;
    const root = activeTextId ? textRefs.current[activeTextId] : null;
    if (!range || !root || range.collapsed) {
      setHeldSelectionRects([]);
      return;
    }
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
      setHeldSelectionRects([]);
      return;
    }
    const nextRects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }));
    setHeldSelectionRects(nextRects);

    const supportsCustomHighlights =
      typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight !== 'undefined';
    if (!supportsCustomHighlights) return;
    try {
      const highlight = new Highlight(range.cloneRange());
      CSS.highlights.set(HELD_SELECTION_HIGHLIGHT_KEY, highlight);
    } catch {
      // Ignore browser-specific range/highlight errors and keep overlay fallback.
    }
  }, [activeTextId]);

  const syncToolbarFromSelection = useCallback(() => {
    if (!activeTextId) return;
    const root = textRefs.current[activeTextId];
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    if (!root.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    selectionRangeRef.current = range.cloneRange();
    const anchorNode =
      selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    if (anchorNode instanceof HTMLElement) {
      const styles = window.getComputedStyle(anchorNode);
      const size = Number.parseInt(styles.fontSize || '', 10);
      if (Number.isFinite(size)) {
        setToolbarFontSize(size);
      }
      const family = (styles.fontFamily || '')
        .split(',')[0]
        ?.replace(/["']/g, '')
        .trim();
      const matchedFamily = FONT_FAMILY_OPTIONS.find((option) =>
        family?.toLowerCase()?.includes(option.value.replace(/["']/g, '').toLowerCase()),
      );
      setToolbarFontFamily(matchedFamily?.value || FONT_FAMILY_OPTIONS[0].value);
      const hexColor = toHexColor(styles.color || '');
      if (hexColor) {
        setToolbarColor(hexColor);
      }
      const highlightHex = toHexColor(styles.backgroundColor || '');
      if (highlightHex) {
        setToolbarHighlightColor(highlightHex);
      }
      const checklistParent = anchorNode.closest('ul[data-checklist="true"]');
      setToolbarChecklist(Boolean(checklistParent));
    }
    setToolbarBold(document.queryCommandState('bold'));
    setToolbarItalic(document.queryCommandState('italic'));
    setToolbarUnderline(document.queryCommandState('underline'));
    setToolbarStrike(document.queryCommandState('strikeThrough'));
    setToolbarBullets(document.queryCommandState('insertUnorderedList'));
    setToolbarNumbered(document.queryCommandState('insertOrderedList'));
    if (document.queryCommandState('justifyCenter')) {
      setToolbarAlign('center');
    } else if (document.queryCommandState('justifyRight')) {
      setToolbarAlign('right');
    } else if (document.queryCommandState('justifyFull')) {
      setToolbarAlign('justify');
    } else {
      setToolbarAlign('left');
    }
  }, [activeTextId]);

  useEffect(() => {
    if (!activeTextId) return;
    const handleSelectionChange = () => {
      if (blockDraggingRef.current) return;
      syncToolbarFromSelection();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [activeTextId, syncToolbarFromSelection]);

  useEffect(() => {
    if (!fontSizeEditing) {
      clearHeldSelectionHighlight();
    }
  }, [fontSizeEditing, clearHeldSelectionHighlight]);

  useEffect(() => () => clearHeldSelectionHighlight(), [clearHeldSelectionHighlight]);

  useEffect(() => {
    if (!fontSizeEditing) return;
    const syncHeldHighlight = () => showHeldSelectionHighlight();
    window.addEventListener('resize', syncHeldHighlight);
    window.addEventListener('scroll', syncHeldHighlight, true);
    return () => {
      window.removeEventListener('resize', syncHeldHighlight);
      window.removeEventListener('scroll', syncHeldHighlight, true);
    };
  }, [fontSizeEditing, showHeldSelectionHighlight]);

  const restoreSelection = (root) => {
    if (!root || !selectionRangeRef.current) return false;
    const range = selectionRangeRef.current;
    return setSelectionRangeSafe(root, range);
  };

  const applyFontSizeToSelection = (root, value) => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
    const nextSize = `${Math.max(MIN_FONT_SIZE, Math.min(Number(value) || BLOCK_DEFAULTS.text.fontSize, MAX_FONT_SIZE))}px`;
    normalizeLegacyFontNodes(root);
    if (range.collapsed) {
      const span = document.createElement('span');
      span.style.fontSize = nextSize;
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      cleanupFontSizeArtifacts(root, { keepNode: span, fallbackPx: activeTextBlock?.fontSize || BLOCK_DEFAULTS.text.fontSize });
      const nextRange = document.createRange();
      const targetNode = span.firstChild || span;
      const targetOffset =
        targetNode.nodeType === Node.TEXT_NODE
          ? Math.min(1, targetNode.nodeValue?.length || 0)
          : Math.min(1, targetNode.childNodes?.length || 0);
      nextRange.setStart(targetNode, targetOffset);
      nextRange.setEnd(targetNode, targetOffset);
      if (!setSelectionRangeSafe(root, nextRange, { fallbackToEnd: true })) return false;
      const active = document.getSelection();
      if (active && active.rangeCount > 0) {
        selectionRangeRef.current = active.getRangeAt(0).cloneRange();
        return true;
      }
      return false;
    }
    const extracted = range.extractContents();
    clearInlineFontSizeInFragment(extracted);
    const span = document.createElement('span');
    span.style.fontSize = nextSize;
    span.appendChild(extracted);
    range.insertNode(span);
    cleanupFontSizeArtifacts(root, { keepNode: span, fallbackPx: activeTextBlock?.fontSize || BLOCK_DEFAULTS.text.fontSize });
    stripZeroWidthTextNodes(root);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    if (!setSelectionRangeSafe(root, nextRange, { fallbackToEnd: true })) return false;
    const active = document.getSelection();
    if (active && active.rangeCount > 0) {
      selectionRangeRef.current = active.getRangeAt(0).cloneRange();
    }
    root.normalize();
    return true;
  };

  const applySelectionCommand = (id, command, value) => {
    const element = textRefs.current[id];
    if (!element) return false;
    const ensureEditorSelection = () => {
      const selection = document.getSelection();
      const hasSelectionInside =
        selection && selection.rangeCount > 0 && element.contains(selection.anchorNode);
      if (!hasSelectionInside && !restoreSelection(element)) {
        return false;
      }
      if (document.activeElement !== element) {
        element.focus({ preventScroll: true });
        if (!restoreSelection(element)) {
          const active = document.getSelection();
          const activeInside = active && active.rangeCount > 0 && element.contains(active.anchorNode);
          if (!activeInside) return false;
        }
      }
      return true;
    };
    if (!ensureEditorSelection()) {
      return false;
    }
    const activeSelection = document.getSelection();
    if (!activeSelection || activeSelection.rangeCount === 0 || !element.contains(activeSelection.anchorNode)) {
      return false;
    }
    if (command === 'fontSize') {
      const currentRange = activeSelection.getRangeAt(0);
      if (currentRange.collapsed) {
        const heldRange = heldSelectionRangeRef.current;
        if (
          heldRange &&
          !heldRange.collapsed &&
          element.contains(heldRange.startContainer) &&
          element.contains(heldRange.endContainer)
        ) {
          setSelectionRangeSafe(element, heldRange.cloneRange(), { fallbackToEnd: true });
        }
      }
    }

    if (command === 'fontSize') {
      applyFontSizeToSelection(element, value);
    } else if (command === 'highlightColor') {
      document.execCommand('styleWithCSS', false, true);
      const applied = document.execCommand('hiliteColor', false, value);
      if (!applied) {
        document.execCommand('backColor', false, value);
      }
    } else if (command === 'checklist') {
      const anchorElement =
        activeSelection.anchorNode?.nodeType === Node.ELEMENT_NODE
          ? activeSelection.anchorNode
          : activeSelection.anchorNode?.parentElement;
      const existingChecklist =
        anchorElement instanceof HTMLElement ? anchorElement.closest('ul[data-checklist="true"]') : null;
      if (existingChecklist instanceof HTMLElement) {
        existingChecklist.removeAttribute('data-checklist');
        existingChecklist.style.listStyle = '';
        existingChecklist.style.paddingLeft = '';
        existingChecklist.querySelectorAll('li').forEach((item) => {
          item.textContent = item.textContent?.replace(/^\s*☐\s*/, '') || '';
        });
      } else {
        const range = activeSelection.getRangeAt(0);
        const selectedText = activeSelection.toString().trim();
        const listHtml = `<ul data-checklist="true" style="list-style:none;padding-left:1.2em;"><li>☐ ${
          selectedText || ''
        }</li></ul>`;
        document.execCommand('insertHTML', false, listHtml);
      }
    } else if (command === 'insertTable') {
      const rows = Math.max(1, Number(value?.rows) || 2);
      const cols = Math.max(1, Number(value?.cols) || 2);
      const rowsHtml = Array.from({ length: rows })
        .map(
          () =>
            `<tr>${Array.from({ length: cols })
              .map(
                () =>
                  '<td style="border:1px solid rgba(255,255,255,0.24);padding:6px;min-width:80px;"><br></td>',
              )
              .join('')}</tr>`,
        )
        .join('');
      const handlesHtml = ['nw', 'ne', 'sw', 'se']
        .map(
          (direction) =>
            `<span class="note-table-resize-handle note-table-resize-${direction}" data-table-resize-handle="${direction}" contenteditable="false"></span>`,
        )
        .join('');
      const tableHtml = `<div data-note-table-shell="true" class="note-table-shell" style="width:340px;max-width:100%;height:180px;"><table data-note-table="true" style="border-collapse:collapse;width:100%;height:100%;table-layout:fixed;">${rowsHtml}</table>${handlesHtml}</div><p><br></p>`;
      document.execCommand('insertHTML', false, tableHtml);
    } else if (
      command === 'tableRow' ||
      command === 'tableColumn' ||
      command === 'tableDeleteRow' ||
      command === 'tableDeleteColumn' ||
      command === 'tableDeleteTable' ||
      command === 'tableRowHeight' ||
      command === 'tableColumnWidth'
    ) {
      const anchorElement =
        activeSelection.anchorNode?.nodeType === Node.ELEMENT_NODE
          ? activeSelection.anchorNode
          : activeSelection.anchorNode?.parentElement;
      const tableFromAnchor =
        anchorElement instanceof HTMLElement ? anchorElement.closest('table[data-note-table="true"],table') : null;
      const shellFromAnchor =
        anchorElement instanceof HTMLElement ? anchorElement.closest('.note-table-shell') : null;
      if (command === 'tableDeleteTable') {
        if (shellFromAnchor instanceof HTMLElement) {
          shellFromAnchor.remove();
        } else if (tableFromAnchor instanceof HTMLTableElement) {
          tableFromAnchor.remove();
        }
        textDraftsRef.current[id] = stripZeroWidth(element.innerHTML);
        markDirty();
        syncToolbarFromSelection();
        return true;
      }
      const cell = anchorElement instanceof HTMLElement ? anchorElement.closest('td,th') : null;
      if (!(cell instanceof HTMLTableCellElement)) return false;
      const row = cell.parentElement;
      const table = cell.closest('table');
      if (!(row instanceof HTMLTableRowElement) || !(table instanceof HTMLTableElement)) return false;
      const cellIndex = cell.cellIndex;

      if (command === 'tableRow') {
        const newRow = row.cloneNode(true);
        Array.from(newRow.cells).forEach((item) => {
          item.innerHTML = '<br>';
        });
        row.insertAdjacentElement('afterend', newRow);
      } else if (command === 'tableColumn') {
        Array.from(table.rows).forEach((rowItem) => {
          const refCell = rowItem.cells[cellIndex];
          const newCell = rowItem.insertCell(cellIndex + 1);
          newCell.innerHTML = '<br>';
          newCell.style.cssText = refCell?.style?.cssText || newCell.style.cssText;
        });
      } else if (command === 'tableDeleteRow') {
        if (table.rows.length <= 1) {
          table.remove();
        } else {
          row.remove();
        }
      } else if (command === 'tableDeleteColumn') {
        const isSingleColumn = Array.from(table.rows).every((rowItem) => rowItem.cells.length <= 1);
        if (isSingleColumn) {
          table.remove();
        } else {
          Array.from(table.rows).forEach((rowItem) => {
            if (rowItem.cells[cellIndex]) {
              rowItem.deleteCell(cellIndex);
            }
          });
        }
      } else if (command === 'tableRowHeight') {
        const delta = Number(value?.delta) || 0;
        const baseHeight = Number.parseFloat(row.style.height || '') || Math.round(row.getBoundingClientRect().height);
        const nextHeight = Math.max(24, baseHeight + delta);
        row.style.height = `${nextHeight}px`;
        Array.from(row.cells).forEach((rowCell) => {
          rowCell.style.height = `${nextHeight}px`;
        });
      } else if (command === 'tableColumnWidth') {
        const delta = Number(value?.delta) || 0;
        Array.from(table.rows).forEach((rowItem) => {
          const colCell = rowItem.cells[cellIndex];
          if (!(colCell instanceof HTMLTableCellElement)) return;
          const baseWidth =
            Number.parseFloat(colCell.style.width || '') || Math.round(colCell.getBoundingClientRect().width);
          const nextWidth = Math.max(56, baseWidth + delta);
          colCell.style.width = `${nextWidth}px`;
          colCell.style.minWidth = `${nextWidth}px`;
        });
      }
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
    if (updates.fontSize !== undefined) {
      applySelectionCommand(id, 'fontSize', updates.fontSize);
    }
    if (updates.textColor) {
      applySelectionCommand(id, 'foreColor', updates.textColor);
    }
    if (updates.highlightColor) {
      applySelectionCommand(id, 'highlightColor', updates.highlightColor);
    }
    if (updates.fontFamily) {
      applySelectionCommand(id, 'fontName', updates.fontFamily);
    }
    if (updates.bold !== undefined) {
      applySelectionCommand(id, 'bold');
    }
    if (updates.italic !== undefined) {
      applySelectionCommand(id, 'italic');
    }
    if (updates.underline !== undefined) {
      applySelectionCommand(id, 'underline');
    }
    if (updates.strike !== undefined) {
      applySelectionCommand(id, 'strikeThrough');
    }
    if (updates.bullets) {
      applySelectionCommand(id, 'insertUnorderedList');
    }
    if (updates.numbered) {
      applySelectionCommand(id, 'insertOrderedList');
    }
    if (updates.checklist) {
      applySelectionCommand(id, 'checklist');
    }
    if (updates.quote) {
      applySelectionCommand(id, 'formatBlock', '<blockquote>');
    }
    if (updates.indent) {
      applySelectionCommand(id, 'indent');
    }
    if (updates.outdent) {
      applySelectionCommand(id, 'outdent');
    }
    if (updates.align) {
      const alignCommandMap = {
        left: 'justifyLeft',
        center: 'justifyCenter',
        right: 'justifyRight',
        justify: 'justifyFull',
      };
      const command = alignCommandMap[updates.align];
      if (command) {
        applySelectionCommand(id, command);
      }
    }
    if (updates.lineSpacing !== undefined) {
      updateBlock(id, { lineHeight: updates.lineSpacing }, { skipDirty: true });
      markDirty();
    }
    if (updates.tableAction) {
      applySelectionCommand(id, updates.tableAction, updates.tableOptions || null);
    }
  };

  const applyFontSize = (size) => {
    if (!activeTextId) return;
    const nextSize = Math.max(MIN_FONT_SIZE, Math.min(size, MAX_FONT_SIZE));
    setToolbarFontSize(nextSize);
    updateTextStyle(activeTextId, { fontSize: nextSize });
  };

  const restoreHeldSelectionForFontSize = () => {
    if (!activeTextId) return;
    const root = textRefs.current[activeTextId];
    const heldRange = heldSelectionRangeRef.current || selectionRangeRef.current;
    if (!root || !heldRange) return;
    try {
      if (!root.contains(heldRange.startContainer) || !root.contains(heldRange.endContainer)) return;
      const nextRange = heldRange.cloneRange();
      selectionRangeRef.current = nextRange.cloneRange();
      root.focus({ preventScroll: true });
      setSelectionRangeSafe(root, nextRange, { fallbackToEnd: true });
    } catch {
      // Ignore detached-range errors and let regular selection flow continue.
    }
  };

  const commitFontSizeInput = (rawValue) => {
    const candidate = typeof rawValue === 'string' ? rawValue : fontSizeDraft;
    const parsed = Number.parseInt(candidate, 10);
    const fallback = fontSizeValue || BLOCK_DEFAULTS.text.fontSize;
    if (Number.isFinite(parsed)) {
      restoreHeldSelectionForFontSize();
      applyFontSize(parsed);
      setFontSizeDraft(String(Math.max(MIN_FONT_SIZE, Math.min(parsed, MAX_FONT_SIZE))));
      return;
    }
    setFontSizeDraft(String(fallback));
  };

  const stepFontSize = (delta) => {
    applyFontSize((fontSizeValue || BLOCK_DEFAULTS.text.fontSize) + delta);
  };

  const applyToolbarAction = (updates) => {
    if (!activeTextId) return;
    updateTextStyle(activeTextId, updates);
  };

  const handleFontSizeInputChange = (event) => {
    const nextValue = event.target.value.replace(/[^\d]/g, '');
    setFontSizeDraft(nextValue);
  };

  const copyCurrentStyle = () => {
    if (!activeTextId) return;
    const root = textRefs.current[activeTextId];
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
      return;
    }
    const node =
      selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    if (!(node instanceof HTMLElement)) return;
    const styles = window.getComputedStyle(node);
    const copied = {
      fontSize: Number.parseInt(styles.fontSize || '', 10) || BLOCK_DEFAULTS.text.fontSize,
      fontFamily: (styles.fontFamily || '').split(',')[0]?.replace(/["']/g, '').trim() || 'Manrope',
      textColor: toHexColor(styles.color || '') || '#ffffff',
      highlightColor: toHexColor(styles.backgroundColor || ''),
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
      align: document.queryCommandState('justifyCenter')
        ? 'center'
        : document.queryCommandState('justifyRight')
          ? 'right'
          : document.queryCommandState('justifyFull')
            ? 'justify'
            : 'left',
      lineSpacing: activeTextBlock?.lineHeight || 1.4,
    };
    setCopiedTextStyle(copied);
  };

  const pasteCopiedStyle = () => {
    if (!activeTextId || !copiedTextStyle) return;
    pushHistory('paste-style');
    applySelectionCommand(activeTextId, 'fontSize', copiedTextStyle.fontSize);
    applySelectionCommand(activeTextId, 'fontName', copiedTextStyle.fontFamily);
    applySelectionCommand(activeTextId, 'foreColor', copiedTextStyle.textColor);
    if (copiedTextStyle.highlightColor) {
      applySelectionCommand(activeTextId, 'highlightColor', copiedTextStyle.highlightColor);
    }
    if (document.queryCommandState('bold') !== copiedTextStyle.bold) {
      applySelectionCommand(activeTextId, 'bold');
    }
    if (document.queryCommandState('italic') !== copiedTextStyle.italic) {
      applySelectionCommand(activeTextId, 'italic');
    }
    if (document.queryCommandState('underline') !== copiedTextStyle.underline) {
      applySelectionCommand(activeTextId, 'underline');
    }
    if (document.queryCommandState('strikeThrough') !== copiedTextStyle.strike) {
      applySelectionCommand(activeTextId, 'strikeThrough');
    }
    const alignCommandMap = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
      justify: 'justifyFull',
    };
    const alignCommand = alignCommandMap[copiedTextStyle.align];
    if (alignCommand) {
      applySelectionCommand(activeTextId, alignCommand);
    }
    updateBlock(activeTextId, { lineHeight: copiedTextStyle.lineSpacing || 1.4 }, { skipDirty: true });
    markDirty();
  };

  const handleToolbarButtonMouseDown = (event) => {
    rememberSelection();
    event.preventDefault();
  };

  const handleToolbarFieldMouseDown = () => {
    rememberSelection();
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
      fileInputRef.current?.click();
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
    rememberSelection(blockId);

    if (action === 'delete-block') {
      deleteBlock(blockId);
      setContextMenu(null);
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
      applySelectionCommand(blockId, tableCommand.command, tableCommand.value || null);
      setContextMenu(null);
      return;
    }

    const formatCommandMap = {
      'fmt-bold': 'bold',
      'fmt-italic': 'italic',
      'fmt-underline': 'underline',
      'fmt-strike': 'strikeThrough',
    };
    const formatCommand = formatCommandMap[action];
    if (formatCommand) {
      pushHistory('format-context');
      applySelectionCommand(blockId, formatCommand);
      setContextMenu(null);
    }
  };

  const handleCanvasContextMenu = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const menuWidth = 240;
    const menuHeight = 320;
    const nextX = Math.min(event.clientX, window.innerWidth - menuWidth);
    const nextY = Math.min(event.clientY, window.innerHeight - menuHeight);

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
      const root = textRefs.current[blockId];
      if (root) {
        root.focus();
        placeCaretFromPoint(root, event.clientX, event.clientY);
      }
      const inTable = Boolean(
        target.closest('td,th,table,.note-table-shell,[data-table-resize-handle]'),
      );
      syncToolbarFromSelection();
      setContextMenu({ type: inTable ? 'table' : 'text', x: nextX, y: nextY, blockId });
      return;
    }

    setContextMenu({ type: 'block', x: nextX, y: nextY, blockId });
  };

  const handleTableResizeHandleMouseDown = (event, blockId) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const direction = target.getAttribute('data-table-resize-handle');
    if (!direction) return;

    const editorRoot = textRefs.current[blockId];
    const shell = target.closest('.note-table-shell');
    const table = shell instanceof HTMLElement ? shell.querySelector('table[data-note-table="true"]') : null;
    if (!(editorRoot instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(table instanceof HTMLTableElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setTablePickerOpen(false);
    selectBlock(blockId, { raise: false });
    pushHistory('table-resize');

    const startRect = shell.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = Number.parseFloat(shell.style.width || '') || startRect.width;
    const startHeight = Number.parseFloat(shell.style.height || '') || startRect.height;
    const startMarginLeft = Number.parseFloat(shell.style.marginLeft || '') || 0;
    const startMarginTop = Number.parseFloat(shell.style.marginTop || '') || 0;

    shell.style.width = `${Math.max(MIN_TABLE_WIDTH, Math.round(startWidth))}px`;
    shell.style.height = `${Math.max(MIN_TABLE_HEIGHT, Math.round(startHeight))}px`;
    table.style.width = '100%';
    table.style.height = '100%';

    let finished = false;
    blockDraggingRef.current = true;

    const handleMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const resizeWest = direction.includes('w');
      const resizeNorth = direction.includes('n');

      let nextWidth = resizeWest ? startWidth - dx : startWidth + dx;
      let nextHeight = resizeNorth ? startHeight - dy : startHeight + dy;
      let nextMarginLeft = startMarginLeft;
      let nextMarginTop = startMarginTop;

      if (resizeWest) {
        nextMarginLeft = startMarginLeft + dx;
      }
      if (resizeNorth) {
        nextMarginTop = startMarginTop + dy;
      }

      if (nextWidth < MIN_TABLE_WIDTH) {
        if (resizeWest) {
          nextMarginLeft += nextWidth - MIN_TABLE_WIDTH;
        }
        nextWidth = MIN_TABLE_WIDTH;
      }
      if (nextHeight < MIN_TABLE_HEIGHT) {
        if (resizeNorth) {
          nextMarginTop += nextHeight - MIN_TABLE_HEIGHT;
        }
        nextHeight = MIN_TABLE_HEIGHT;
      }

      shell.style.width = `${Math.round(nextWidth)}px`;
      shell.style.height = `${Math.round(nextHeight)}px`;
      shell.style.marginLeft = `${Math.round(nextMarginLeft)}px`;
      shell.style.marginTop = `${Math.round(nextMarginTop)}px`;
    };

    const finishResize = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', finishResize);
      blockDraggingRef.current = false;
      textDraftsRef.current[blockId] = stripZeroWidth(editorRoot.innerHTML);
      markDirty();
      tableResizeRef.current = null;
    };

    tableResizeRef.current = { end: finishResize };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', finishResize);
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
        title="Decrease font size"
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
            rememberSelection();
            if (selectionRangeRef.current) {
              try {
                heldSelectionRangeRef.current = selectionRangeRef.current.cloneRange();
              } catch {
                heldSelectionRangeRef.current = null;
              }
            } else {
              heldSelectionRangeRef.current = null;
            }
            showHeldSelectionHighlight();
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
            clearHeldSelectionHighlight();
            heldSelectionRangeRef.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              skipNextFontSizeBlurCommitRef.current = true;
              commitFontSizeInput(event.currentTarget.value);
              setFontSizeEditing(false);
              clearHeldSelectionHighlight();
              heldSelectionRangeRef.current = null;
              event.currentTarget.blur();
              requestAnimationFrame(() => {
                const root = activeTextId ? textRefs.current[activeTextId] : null;
                root?.focus();
              });
            } else if (event.key === 'Escape') {
              event.preventDefault();
              skipNextFontSizeBlurCommitRef.current = true;
              setFontSizeEditing(false);
              setFontSizeDraft(String(fontSizeValue || BLOCK_DEFAULTS.text.fontSize));
              clearHeldSelectionHighlight();
              heldSelectionRangeRef.current = null;
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
        title="Increase font size"
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
        title="Bold"
      >
        <FaBold />
      </button>
      <button
        type="button"
        className={toolbarItalic ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ italic: !toolbarItalic })}
        title="Italic"
      >
        <FaItalic />
      </button>
      <button
        type="button"
        className={toolbarUnderline ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ underline: !toolbarUnderline })}
        title="Underline"
      >
        <FaUnderline />
      </button>
      <button
        type="button"
        className={toolbarStrike ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ strike: !toolbarStrike })}
        title="Strikethrough"
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
        title="Align left"
      >
        <FaAlignLeft />
      </button>
      <button
        type="button"
        className={toolbarAlign === 'center' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'center' })}
        title="Align center"
      >
        <FaAlignCenter />
      </button>
      <button
        type="button"
        className={toolbarAlign === 'right' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'right' })}
        title="Align right"
      >
        <FaAlignRight />
      </button>
      <button
        type="button"
        className={toolbarAlign === 'justify' ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ align: 'justify' })}
        title="Justify"
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
        title="Bulleted list"
      >
        <FaListUl />
      </button>
      <button
        type="button"
        className={toolbarNumbered ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ numbered: true })}
        title="Numbered list"
      >
        <FaListOl />
      </button>
      <button
        type="button"
        className={toolbarChecklist ? 'active' : ''}
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ checklist: true })}
        title="Checklist"
      >
        <FaCheckSquare />
      </button>
      <button
        type="button"
        disabled={textControlsDisabled}
        onMouseDown={handleToolbarButtonMouseDown}
        onClick={() => applyToolbarAction({ quote: true })}
        title="Quote block"
      >
        <FaQuoteRight />
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
            rememberSelection();
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
        <button className="ghost-btn note-back" onClick={returnToDashboardClass} title="Back">
          <FaArrowLeft />
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
        <div className="note-canvas-scroll" ref={canvasScrollRef}>
          <div
            className="note-canvas"
            ref={canvasRef}
            style={{ height: `${canvasHeight}px`, width: `max(100%, ${canvasWidth}px)` }}
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
                  onDragStop={(event, data) => {
                    blockDraggingRef.current = false;
                    if (data.x === block.x && data.y === block.y) return;
                    pushHistory('move');
                    setBlocks((prev) => {
                      const target = prev.find((item) => item.id === block.id);
                      if (!target) return prev;
                      const maxZ = getMaxZIndex(prev, (item) => item.priority === target.priority);
                      const nextZ = Math.max(maxZ + 1, target.zIndex || 0);
                      return prev.map((item) =>
                        item.id === block.id ? { ...item, x: data.x, y: data.y, zIndex: nextZ } : item,
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
                      {!block.collapsed && (
                        <div className="note-block-body">
                          {block.type === 'text' ? (
                            <div
                              ref={(el) => {
                                if (!el) return;
                                textRefs.current[block.id] = el;
                                if (document.activeElement === el) return;
                                const desired = textDraftsRef.current[block.id] ?? block.value ?? '';
                                if (el.innerHTML !== desired) {
                                  el.innerHTML = desired;
                                  // Normalize/clean only when we (re)hydrate from a trusted
                                  // source (load, undo/redo). Running the destructive cleanup
                                  // on every render is what deleted spaces and reset sizes.
                                  normalizeLegacyFontNodes(el);
                                  cleanupFontSizeArtifacts(el, {
                                    fallbackPx: block.fontSize || BLOCK_DEFAULTS.text.fontSize,
                                  });
                                  textDraftsRef.current[block.id] = stripZeroWidth(el.innerHTML);
                                }
                              }}
                              className="note-textarea"
                              data-block-id={block.id}
                              contentEditable
                              suppressContentEditableWarning
                              onMouseDown={(event) => handleTableResizeHandleMouseDown(event, block.id)}
                              onPaste={(event) => handleEditorPaste(event, block.id)}
                              onInput={(event) =>
                                handleTextInput(block.id, event.currentTarget.innerHTML, event.currentTarget)
                              }
                              onFocus={() => selectBlock(block.id, { raise: false })}
                              onMouseUp={syncToolbarFromSelection}
                              onKeyUp={syncToolbarFromSelection}
                              style={{
                                fontSize: `${block.fontSize || BLOCK_DEFAULTS.text.fontSize}px`,
                                lineHeight: block.lineHeight || 1.4,
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
                  </div>
                </Rnd>
              );
            })}
          </div>
        </div>
        <div className="canvas-nudge canvas-nudge-side" aria-label="Scroll canvas controls">
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
            <button type="button" className="danger" onClick={() => deleteBlock(blockMenuBlock.id)}>
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
            rememberSelection();
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
      {heldSelectionRects.length > 0 && (
        <div className="held-selection-overlay" aria-hidden>
          {heldSelectionRects.map((rect, index) => (
            <span
              key={`${rect.left}-${rect.top}-${rect.width}-${rect.height}-${index}`}
              className="held-selection-rect"
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }}
            />
          ))}
        </div>
      )}
      {contextMenu && (
        <div
          className="note-context-menu"
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
                Add page
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
    </div>
  );
};

export default NoteEditor;
