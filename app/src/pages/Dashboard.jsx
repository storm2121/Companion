import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCog,
  FaEllipsisH,
  FaImage,
  FaMoon,
  FaPalette,
  FaPen,
  FaPlus,
  FaSearch,
  FaThumbtack,
  FaTimes,
  FaTrash,
} from 'react-icons/fa';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createNote,
  deleteClass,
  deleteNote,
  deleteNoteTemplate,
  deleteNotes,
  listenToClasses,
  listenToNoteTemplates,
  listenToNotes,
  moveNotes,
  reorderClasses,
  reorderNotes,
  updateClassColor,
  updateNote,
} from '../services/library';
import { useAuth } from '../context/AuthContext';
import AddClassSheet from '../components/classes/AddClassSheet';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { THEME_DEFAULT_MODE, THEME_OPTIONS, THEME_PRESETS } from '../themePresets';
import { DEFAULT_TEMPLATE_ID } from '../data/noteTemplates';
import useNetworkStatus from '../hooks/useNetworkStatus';

const CLASS_COLORS = ['#c8a46a', '#4a5a63', '#4b5b49', '#b49a62', '#3a3c42', '#586471', '#3e4c59'];

const toNoteMeta = (docSnap) => {
  const data = docSnap.data() || {};
  const { blocks, canvasHeight, ...meta } = data;
  return { id: docSnap.id, ...meta };
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
const DASHBOARD_RETURN_CLASS_KEY = 'companion:returnClassId';
const TEMPLATE_DRAFT_STORAGE_KEY = 'companion:new-note-draft';
const TEMPLATE_RESULT_STORAGE_KEY = 'companion:new-note-template-result';
const CUSTOM_TEMPLATE_PREFIX = 'custom:';

const toCustomTemplateId = (id) => `${CUSTOM_TEMPLATE_PREFIX}${id}`;

const cloneTemplateBlocks = (blocks = []) => blocks.map((block) => ({ ...block }));

const Dashboard = () => {
  const { firebaseUser, profile, logout, updateThemeMode, applyThemeMode, updateNoteTemplateDefault } = useAuth();
  const [classes, setClasses] = useState([]);
  const [customTemplates, setCustomTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [notes, setNotes] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mobilePane, setMobilePane] = useState('classes');
  const [menuOpenId, setMenuOpenId] = useState('');
  const [colorPickerId, setColorPickerId] = useState('');
  const [noteMenuOpenId, setNoteMenuOpenId] = useState('');
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [draggingId, setDraggingId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  const [noteDraggingId, setNoteDraggingId] = useState('');
  const [noteDragOverId, setNoteDragOverId] = useState('');
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
  const [templateDefault, setTemplateDefault] = useState(false);
  const [templatePromptOpen, setTemplatePromptOpen] = useState(false);
  const [templatePromptName, setTemplatePromptName] = useState('');
  const [templateDeleteTarget, setTemplateDeleteTarget] = useState(null);
  const [templateDeleting, setTemplateDeleting] = useState(false);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [themeMode, setThemeMode] = useState(THEME_DEFAULT_MODE);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const titleRef = useRef(null);
  const summaryRef = useRef(null);
  const imageRef = useRef(null);
  const themeMenuRef = useRef(null);
  const templatePromptRef = useRef(null);
  const preferredClassIdRef = useRef('');
  const templateRestoreDoneRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOnline = useNetworkStatus();
  const availableTemplates = useMemo(() => {
    const blankTemplate = {
      id: DEFAULT_TEMPLATE_ID,
      label: 'Blank',
      description: 'Start with an empty canvas.',
      autoTitlePrefix: 'Quick Note',
      kind: 'builtin',
      blocks: [],
      canvasHeight: 720,
    };
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
    return [blankTemplate, ...custom];
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
      return;
    }
    const unsub = listenToNotes(
      firebaseUser.uid,
      selectedClassId,
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
      },
      (err) => console.error(err),
    );
    return () => unsub();
  }, [firebaseUser, selectedClassId]);

  useEffect(() => {
    setSelectedNoteIds([]);
    setMoveTargetId('');
    setNoteDraggingId('');
    setNoteDragOverId('');
  }, [selectedClassId]);

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
    if (!themeMenuOpen) return;
    const handleClick = (event) => {
      if (!themeMenuRef.current) return;
      if (!themeMenuRef.current.contains(event.target)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [themeMenuOpen]);

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
    setTemplateDefault(Boolean(draft.templateDefault));
    setNoteModalOpen(true);
  }, [firebaseUser, availableTemplates, templatesLoaded]);

  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const trimmedSearch = search.trim().toLowerCase();
  const searchTokens = useMemo(
    () => trimmedSearch.split(' ').map((token) => token.trim()).filter(Boolean),
    [trimmedSearch],
  );
  const filteredNotes = useMemo(() => {
    if (!searchTokens.length) return notes;
    return notes.filter((note) => {
      const tagsText = (note.tags || []).join(' ');
      const haystack = `${note.title || ''} ${note.summary || ''} ${tagsText}`
        .toLowerCase()
        .trim();
      return searchTokens.every((token) => haystack.includes(token));
    });
  }, [notes, searchTokens]);
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
    setColorPickerId('');
    setNoteMenuOpenId('');
  };

  const getTemplateBlocks = (template) => {
    if (!template || template.kind !== 'custom') return [];
    return cloneTemplateBlocks(template.blocks || []);
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
    setTemplateDefault(false);
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
      templateDefault,
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
        setTemplateDefault(false);
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

  const closeNoteModal = () => {
    if (noteSaving) return;
    setNoteModalOpen(false);
    setNoteModalNote(null);
    setNoteTitle('');
    setNoteSummary('');
    setNoteImageFile(null);
    setNoteImagePreview('');
    setTemplateDefault(false);
    setTemplatePromptOpen(false);
    setTemplatePromptName('');
    setTemplateDeleteTarget(null);
    setTemplateDeleting(false);
  };

  const uploadCover = async (noteId) => {
    if (!firebaseUser || !noteImageFile) return '';
    const ref = storageRef(
      storage,
      `notes/${firebaseUser.uid}/${noteId}/cover-${Date.now()}-${noteImageFile.name}`,
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
        if (templateDefault) {
          await updateNoteTemplateDefault(template.id);
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
    setColorPickerId('');
  };

  const toggleNoteMenu = (noteId) => {
    setNoteMenuOpenId((current) => (current === noteId ? '' : noteId));
    setMenuOpenId('');
    setColorPickerId('');
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
      await deleteNotes(firebaseUser.uid, selectedClassId, selectedNoteIds);
      clearNoteSelection();
      setBulkDeleteOpen(false);
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
      await moveNotes(firebaseUser.uid, selectedClassId, moveTargetId, selectedNotes);
      clearNoteSelection();
    } catch (err) {
      console.error('Failed to move notes', err);
    } finally {
      setMoveBusy(false);
    }
  };

  const toggleColorPicker = (classId) => {
    setColorPickerId((current) => (current === classId ? '' : classId));
  };

  const handleColorPick = async (classId, color) => {
    if (!firebaseUser) return;
    try {
      await updateClassColor(firebaseUser.uid, classId, color);
    } catch (err) {
      console.error('Failed to update class color', err);
    } finally {
      setMenuOpenId('');
      setColorPickerId('');
    }
  };

  const requestDelete = (item) => {
    setDeleteTarget(item);
    setMenuOpenId('');
    setColorPickerId('');
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

  const handleDragOver = (event, classId) => {
    if (!draggingId || draggingId === classId) return;
    event.preventDefault();
    setDragOverId(classId);
  };

  const handleDrop = async (event, classId) => {
    if (!firebaseUser || !draggingId) return;
    event.preventDefault();
    const updated = reorderList(classes, draggingId, classId);
    if (updated === classes) {
      setDraggingId('');
      setDragOverId('');
      return;
    }
    setClasses(updated);
    setDraggingId('');
    setDragOverId('');
    try {
      await reorderClasses(firebaseUser.uid, updated);
    } catch (err) {
      console.error('Failed to reorder classes', err);
    }
  };

  const handleDragEnd = () => {
    setDraggingId('');
    setDragOverId('');
  };

  const handleNoteDragStart = (event, noteId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `note:${noteId}`);
    setNoteDraggingId(noteId);
  };

  const handleNoteDragOver = (event, noteId) => {
    if (!noteDraggingId || noteDraggingId === noteId) return;
    event.preventDefault();
    setNoteDragOverId(noteId);
  };

  const handleNoteDrop = async (event, noteId) => {
    if (!firebaseUser || !selectedClassId || !noteDraggingId) return;
    event.preventDefault();
    const updated = reorderList(notes, noteDraggingId, noteId);
    if (updated === notes) {
      setNoteDraggingId('');
      setNoteDragOverId('');
      return;
    }
    setNotes(updated);
    setNoteDraggingId('');
    setNoteDragOverId('');
    try {
      await reorderNotes(firebaseUser.uid, selectedClassId, updated);
    } catch (err) {
      console.error('Failed to reorder notes', err);
    }
  };

  const handleNoteDragEnd = () => {
    setNoteDraggingId('');
    setNoteDragOverId('');
  };

  const classEmpty = classes.length === 0;
  const notesEmpty = notes.length === 0;
  const filteredNotesEmpty = filteredNotes.length === 0;
  const appTitle = selectedClass ? `Classes / ${selectedClass.name}` : 'Classes';

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="app-title">
            <strong>Companion</strong>
            <span className="breadcrumb">{appTitle}</span>
          </div>
          <div className="app-search">
            <FaSearch />
            <input
              placeholder="Search notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search notes"
            />
          </div>
          <div className="app-actions">
            {!isOnline && <span className="net-status offline">Offline</span>}
            <div className="theme-control" ref={themeMenuRef}>
              <button
                type="button"
                className="theme-trigger"
                onClick={() => setThemeMenuOpen((prev) => !prev)}
                title="Choose theme"
              >
                <FaMoon />
                Theme
              </button>
              {themeMenuOpen && (
                <div className="theme-menu">
                  {THEME_OPTIONS.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`theme-option ${themeMode === mode.id ? 'active' : ''}`}
                      onClick={() => {
                        setThemeMode(mode.id);
                        applyThemeMode(mode.id);
                        setThemeMenuOpen(false);
                      }}
                    >
                      <span className="theme-swatch" style={{ background: mode.swatch }} />
                      {mode.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="icon-btn" title="Settings">
              <FaCog />
            </button>
            <button
              className="avatar-btn"
              title="Logout"
              onClick={logout}
              style={{ backgroundImage: `url(${profile?.photoUrl || ''})` }}
            >
              {!profile?.photoUrl && (profile?.displayName?.slice(0, 1).toUpperCase() || 'A')}
            </button>
          </div>
        </div>
      </header>

      <div className="app-layout" data-pane={mobilePane}>
        <aside className="pane pane-classes">
          <div className="pane-header">
            <div className="pane-title">
              <h3>Classes</h3>
              <span className="status-text">{classEmpty ? 'No classes yet' : `${classes.length} total`}</span>
            </div>
            <div className="pane-actions">
              <button className="icon-btn" title="New class" onClick={() => setSheetOpen(true)}>
                <FaPlus />
              </button>
            </div>
          </div>
          <div className="pane-body">
            {classEmpty ? (
              <div className="empty-inline">
                <p>Create your first class to keep notes organized.</p>
                <button className="primary-btn btn-sm" onClick={() => setSheetOpen(true)}>
                  New class
                </button>
              </div>
            ) : (
              classes.map((item) => {
                const menuOpen = menuOpenId === item.id;
                const colorOpen = colorPickerId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`class-row ${item.id === selectedClassId ? 'active' : ''} ${
                      draggingId === item.id ? 'dragging' : ''
                    } ${dragOverId === item.id ? 'drag-over' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectClass(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectClass(item.id);
                      }
                    }}
                    onDragOver={(event) => handleDragOver(event, item.id)}
                    onDrop={(event) => handleDrop(event, item.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="class-row-main">
                      <button
                        type="button"
                        className="drag-handle-btn"
                        title="Drag to reorder"
                        draggable
                        onDragStart={(event) => handleDragStart(event, item.id)}
                        onDragEnd={handleDragEnd}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="drag-handle-dots" aria-hidden="true" />
                      </button>
                      <span className="dot" style={{ background: item.color || 'var(--accent)' }} />
                      <div className="class-text">
                        <p title={item.name}>{item.name}</p>
                        <span>{item.noteCount || 0} notes</span>
                      </div>
                    </div>
                    <div className="class-row-actions">
                      <button
                        className="icon-btn ghost"
                        title="Class actions"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleMenu(item.id);
                        }}
                      >
                        <FaEllipsisH />
                      </button>
                      {menuOpen && (
                        <div className="class-menu" onClick={(event) => event.stopPropagation()} role="menu">
                          <button type="button" onClick={() => toggleColorPicker(item.id)}>
                            <FaPalette /> Change color
                          </button>
                          {colorOpen && (
                            <div className="color-swatches">
                              {CLASS_COLORS.map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  className={`swatch ${item.color === color ? 'active' : ''}`}
                                  style={{ background: color }}
                                  onClick={() => handleColorPick(item.id, color)}
                                  aria-label={`Set color ${color}`}
                                />
                              ))}
                            </div>
                          )}
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
          </div>
        </aside>

        <section className="pane pane-notes">
          <div className="pane-header">
            <div className="pane-title">
              <h3>Notes</h3>
              <span className="status-text">{selectedClass ? selectedClass.name : 'Select a class'}</span>
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
              <button className="ghost-btn btn-sm" onClick={handleOpenCreateNote} disabled={!selectedClassId}>
                <FaPlus /> New note
              </button>
              <button
                className="ghost-btn btn-sm"
                onClick={handleQuickAddNote}
                disabled={!selectedClassId || quickAddBusy}
                title="Quick add with default template"
              >
                <FaPen /> {quickAddBusy ? 'Adding...' : 'Quick add'}
              </button>
            </div>
          </div>
          <div className="pane-body">
            {classEmpty ? (
              <div className="empty-inline">
                <p>Choose a class to view notes.</p>
              </div>
            ) : filteredNotesEmpty ? (
              <div className="empty-inline">
                <p>
                  {notesEmpty
                    ? `No notes yet in ${selectedClass?.name || 'this class'}.`
                    : 'No matching notes.'}
                </p>
              </div>
            ) : (
              filteredNotes.map((note) => {
                const selected = selectedNoteIds.includes(note.id);
                const snippet = note.summary || (selected ? 'No summary yet.' : '');
                const hasSnippet = Boolean(snippet);
                const updatedAt = note.updatedAt?.toDate?.();
                const menuOpen = noteMenuOpenId === note.id;
                return (
                  <div
                    key={note.id}
                    className={`note-row ${selected ? 'selected' : ''} ${
                      noteDraggingId === note.id ? 'dragging' : ''
                    } ${noteDragOverId === note.id ? 'drag-over' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setNoteMenuOpenId('');
                      navigate(`/class/${selectedClassId}/note/${note.id}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setNoteMenuOpenId('');
                        navigate(`/class/${selectedClassId}/note/${note.id}`);
                      }
                    }}
                    onDragOver={(event) => handleNoteDragOver(event, note.id)}
                    onDrop={(event) => handleNoteDrop(event, note.id)}
                  >
                    <button
                      type="button"
                      className="drag-handle-btn"
                      title="Drag to reorder"
                      draggable
                      onDragStart={(event) => handleNoteDragStart(event, note.id)}
                      onDragEnd={handleNoteDragEnd}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="drag-handle-dots" aria-hidden="true" />
                    </button>
                    <label className="note-row-select" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleNoteSelection(note.id)}
                      />
                      <span aria-hidden="true" />
                    </label>
                    <div className="note-row-body">
                      <div className="note-thumb">
                        {note.coverUrl ? (
                          <img src={note.coverUrl} alt="" />
                        ) : (
                          <span>{(note.title || 'N').slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="note-row-content">
                        <div className="note-row-top">
                          <h4>{note.title || 'Untitled Note'}</h4>
                          {note.pinned && <FaThumbtack />}
                        </div>
                        {hasSnippet && <p className="note-row-snippet">{snippet}</p>}
                        <div className="note-row-meta">
                          <span>{updatedAt ? updatedAt.toLocaleDateString() : 'Just now'}</span>
                          <div className="note-row-tags">
                            {(note.tags || []).slice(0, 2).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="note-row-actions">
                      <button
                        className="icon-btn ghost"
                        title="Note actions"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleNoteMenu(note.id);
                        }}
                      >
                        <FaEllipsisH />
                      </button>
                      {menuOpen && (
                        <div className="note-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                          <button type="button" onClick={() => handleOpenEditNote(note, 'title')}>
                            <FaPen /> Edit title
                          </button>
                          <button type="button" onClick={() => handleOpenEditNote(note, 'summary')}>
                            <FaPen /> Edit summary
                          </button>
                          <button type="button" onClick={() => handleOpenEditNote(note, 'image')}>
                            <FaImage /> Change picture
                          </button>
                          <button type="button" className="danger" onClick={() => requestNoteDelete(note)}>
                            <FaTrash /> Delete note
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
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

      <AddClassSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {noteModalOpen && (
        <>
          <div className="overlay show" onClick={closeNoteModal} />
          <div className="modal open" role="dialog" aria-modal="true">
            <div className="modal-card">
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
                <label>
                  Brief summary (optional)
                  <textarea
                    ref={summaryRef}
                    value={noteSummary}
                    onChange={(e) => setNoteSummary(e.target.value)}
                    placeholder="Short summary for the dashboard"
                    rows={3}
                  />
                </label>
                <label>
                  Cover image (optional)
                  <input
                    ref={imageRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setNoteImageFile(e.target.files?.[0] || null)}
                  />
                </label>
                {noteImagePreview && (
                  <div className="note-cover-preview">
                    <img src={noteImagePreview} alt="Note cover preview" />
                  </div>
                )}
                {noteModalMode === 'create' && (
                  <div className="template-picker">
                    <div className="template-header">
                      <span>Template</span>
                      <label className="template-default-toggle">
                        <input
                          type="checkbox"
                          checked={templateDefault}
                          onChange={(event) => setTemplateDefault(event.target.checked)}
                        />
                        Set as default
                      </label>
                    </div>
                    <div className="template-grid">
                      {availableTemplates.map((template) => (
                        <div
                          key={template.id}
                          className={`template-card-wrap ${templateId === template.id ? 'active' : ''}`}
                        >
                          <button
                            type="button"
                            className={`template-card ${templateId === template.id ? 'active' : ''}`}
                            onClick={() => setTemplateId(template.id)}
                          >
                            <strong>{template.label}</strong>
                            <span>{template.description}</span>
                            {template.kind === 'custom' && <em>Custom</em>}
                          </button>
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
                      ))}
                      <button
                        type="button"
                        className="template-card template-card-create"
                        onClick={handleOpenTemplatePrompt}
                      >
                        <strong>Create your own</strong>
                        <span>Design a layout and save it for future notes.</span>
                      </button>
                    </div>
                    <p className="template-hint">
                      Default template: {defaultTemplate?.label || 'Blank'}
                    </p>
                  </div>
                )}
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
    </div>
  );
};

export default Dashboard;
