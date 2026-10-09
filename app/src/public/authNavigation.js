export const AUTH_RETURN_KEY = 'companion:auth-return';
export const DEFAULT_DESTINATION = '/dashboard';

// A login return address can only name an existing workspace route. URL parsing
// normalizes dot segments before the allowlist is checked.
export const authDestination = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_DESTINATION;
  }
  if (value.includes('\\') || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return DEFAULT_DESTINATION;
  }
  try {
    const url = new URL(value, 'https://companion.invalid');
    if (url.origin !== 'https://companion.invalid') return DEFAULT_DESTINATION;
    const allowed = /^\/(?:app|dashboard|settings|calendar|room(?:\/.*)?|class\/[^/]+(?:\/note\/[^/]+)?|template\/new)\/?$/;
    return allowed.test(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : DEFAULT_DESTINATION;
  } catch {
    return DEFAULT_DESTINATION;
  }
};

export const authHref = (page, destination) =>
  `${page}?next=${encodeURIComponent(authDestination(destination))}`;

// Email links may open a new tab. This small, origin-local value is only a path,
// and is covered by Companion's existing "clear this device" behavior.
export const rememberAuthDestination = (destination, storage) => {
  try {
    (storage ?? globalThis.localStorage)?.setItem(AUTH_RETURN_KEY, authDestination(destination));
  } catch {
    // Blocked storage: the signed-in workspace remains the fallback.
  }
};

export const readAuthDestination = (storage) => {
  try {
    return authDestination((storage ?? globalThis.localStorage)?.getItem(AUTH_RETURN_KEY));
  } catch {
    return DEFAULT_DESTINATION;
  }
};

export const clearAuthDestination = (storage) => {
  try {
    (storage ?? globalThis.localStorage)?.removeItem(AUTH_RETURN_KEY);
  } catch {
    // Storage may be unavailable in private browsing.
  }
};
