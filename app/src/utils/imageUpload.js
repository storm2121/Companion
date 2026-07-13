export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.avif';

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const validateImageFile = (file, { maxBytes, label = 'Image' }) => {
  if (!file) throw new Error(`${label} is missing.`);
  if (!Object.hasOwn(EXTENSIONS, file.type)) {
    throw new Error(`${label} must be a PNG, JPEG, WebP, GIF, or AVIF file. SVG is not allowed.`);
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(`${label} must be smaller than ${limitMb} MB.`);
  }
  return file;
};

export const createImageObjectName = (file, prefix = 'image') => {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}.${EXTENSIONS[file.type]}`;
};
