export const AUTH_EMAIL_STORAGE_KEY = 'authEmail';
export const NOTE_DRAFT_STORAGE_PREFIX = 'companion-note-draft';
export const DASHBOARD_RETURN_CLASS_KEY = 'companion:returnClassId';
export const TEMPLATE_DRAFT_STORAGE_KEY = 'companion:new-note-draft';
export const TEMPLATE_RESULT_STORAGE_KEY = 'companion:new-note-template-result';

const isCompanionStorageKey = (key) =>
  key === AUTH_EMAIL_STORAGE_KEY ||
  key.startsWith('companion:') ||
  key.startsWith(`${NOTE_DRAFT_STORAGE_PREFIX}:`);

const removeMatchingKeys = (storage) => {
  if (!storage) return 0;
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isCompanionStorageKey(key)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
};

// Ordinary sign-out intentionally keeps offline notes. This is only called by the
// explicit "clear this device" action and never clears data owned by another origin.
export const clearCompanionWebStorage = ({ local, session } = {}) => {
  const localStore = local ?? globalThis.localStorage;
  const sessionStore = session ?? globalThis.sessionStorage;
  return {
    local: removeMatchingKeys(localStore),
    session: removeMatchingKeys(sessionStore),
  };
};

