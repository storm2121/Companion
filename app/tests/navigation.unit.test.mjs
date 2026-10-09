import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_RETURN_KEY,
  authDestination,
  authHref,
  clearAuthDestination,
  readAuthDestination,
  rememberAuthDestination,
} from '../src/public/authNavigation.js';

test('login returns to workspace routes, preserving search and fragment', () => {
  for (const destination of ['/app', '/dashboard', '/room', '/room/notes?tag=project', '/room/note/course/note#section-2', '/class/course/note/note', '/calendar']) {
    assert.equal(authDestination(destination), destination);
  }
  assert.equal(authHref('/register', '/room/notes?tag=project'), '/register?next=%2Froom%2Fnotes%3Ftag%3Dproject');
});

test('login rejects external and public return addresses, including normalized paths', () => {
  for (const destination of [null, '', 'https://example.com', '//example.com', '/\\example.com', '/login', '/register', '/auth/complete', '/room/../../login', '/unknown', '/%2F%2Fexample.com', '/room\u0000']) {
    assert.equal(authDestination(destination), '/dashboard');
  }
});

test('email-link return path survives a new tab and is cleared when consumed', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  rememberAuthDestination('/room/note/course/note', storage);
  assert.equal(readAuthDestination(storage), '/room/note/course/note');
  clearAuthDestination(storage);
  assert.equal(values.has(AUTH_RETURN_KEY), false);
  assert.equal(readAuthDestination(storage), '/dashboard');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => rememberAuthDestination('/room', blocked));
  assert.doesNotThrow(() => clearAuthDestination(blocked));
  assert.equal(readAuthDestination(blocked), '/dashboard');
});

test('blocked access to browser storage does not break password login routing', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.doesNotThrow(() => rememberAuthDestination('/room'));
    assert.doesNotThrow(() => clearAuthDestination());
    assert.equal(readAuthDestination(), '/dashboard');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
