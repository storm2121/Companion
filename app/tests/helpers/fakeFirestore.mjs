// An in-memory stand-in for `firebase/firestore`, just large enough for the parts of
// src/services/library.js that the unit tests run (tests/library.unit.test.mjs redirects the
// import here). It keeps TWO copies of every document, as a device does: the server's and
// this device's cache. They only meet when something is read from the server or written.
//
//   fake.server / fake.cache   Map of 'a/b/c' path → plain data
//   fake.online = false        every server read fails, as it does with no connection
//   fake.hang = true           every server read never answers (a connection too slow to use)
//   fake.commits               write counts of each committed batch, in order

const MISSING = Symbol('known to be missing');
const TIMESTAMP = Symbol('serverTimestamp');
const DELETE = Symbol('deleteField');

export const fake = {
  server: new Map(),
  cache: new Map(),
  online: true,
  hang: false,
  commits: [],
  clock: 1000,
  reset() {
    this.server.clear();
    this.cache.clear();
    this.online = true;
    this.hang = false;
    this.commits = [];
    this.clock = 1000;
  },
  // Puts a document on the server, and on this device too unless `cached` is false.
  seed(path, data, { cached = true } = {}) {
    this.server.set(path, structuredClone(data));
    if (cached) this.cache.set(path, structuredClone(data));
  },
};

const stamp = () => {
  fake.clock += 1;
  const ms = fake.clock;
  return { ms, toMillis: () => ms };
};
const offline = () => Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const never = () => new Promise(() => {});

const snapshot = (path, data) => ({
  id: path.split('/').pop(),
  exists: () => data !== undefined && data !== MISSING,
  data: () => (data === undefined || data === MISSING ? undefined : { ...data }),
  get: (field) => (data && data !== MISSING ? data[field] : undefined),
});

let autoId = 0;
export const collection = (parent, ...segments) => ({ kind: 'collection', path: segments.join('/') });
export const doc = (parent, ...segments) => {
  if (parent?.kind === 'collection') {
    autoId += 1;
    return { kind: 'doc', path: `${parent.path}/${segments[0] || `auto${autoId}`}`, id: segments[0] || `auto${autoId}` };
  }
  return { kind: 'doc', path: segments.join('/'), id: segments[segments.length - 1] };
};

export const serverTimestamp = () => TIMESTAMP;
export const deleteField = () => DELETE;
export const increment = (by) => ({ increment: by });

const fromServer = async (ref) => {
  if (fake.hang) return never();
  if (!fake.online) throw offline();
  const data = fake.server.get(ref.path);
  fake.cache.set(ref.path, data === undefined ? MISSING : structuredClone(data));
  return snapshot(ref.path, data);
};
export const getDocFromServer = fromServer;
export const getDocFromCache = async (ref) => {
  if (!fake.cache.has(ref.path)) throw offline();
  return snapshot(ref.path, fake.cache.get(ref.path));
};
export const getDoc = async (ref) => {
  if (fake.online && !fake.hang) return fromServer(ref);
  return getDocFromCache(ref);
};

const childrenOf = (store, path) =>
  [...store.entries()].filter(([key, data]) => data !== MISSING && key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'));
export const getDocsFromServer = async (ref) => {
  if (fake.hang) return never();
  if (!fake.online) throw offline();
  const docs = childrenOf(fake.server, ref.path).map(([key, data]) => {
    fake.cache.set(key, structuredClone(data));
    return snapshot(key, data);
  });
  return { docs, size: docs.length, empty: !docs.length };
};
export const getDocs = getDocsFromServer;

const settle = (value, before) => {
  if (value === TIMESTAMP) return stamp();
  if (value && typeof value === 'object' && typeof value.increment === 'number') return (Number(before) || 0) + value.increment;
  return value;
};
const applyTo = (store, op) => {
  const current = store.get(op.path);
  const have = current !== undefined && current !== MISSING;
  if (op.kind === 'delete') {
    store.delete(op.path);
    return;
  }
  if (op.kind === 'set') {
    const next = op.merge && have ? { ...current } : {};
    Object.entries(op.data).forEach(([key, value]) => {
      next[key] = settle(value, next[key]);
    });
    store.set(op.path, next);
    return;
  }
  // update: dotted field paths, and the document has to exist.
  if (!have) throw Object.assign(new Error(`No document to update: ${op.path}`), { code: 'not-found' });
  const next = structuredClone(current);
  Object.entries(op.data).forEach(([field, value]) => {
    const keys = field.split('.');
    let at = next;
    keys.slice(0, -1).forEach((key) => {
      at[key] = at[key] && typeof at[key] === 'object' ? at[key] : {};
      at = at[key];
    });
    const last = keys[keys.length - 1];
    if (value === DELETE) delete at[last];
    else at[last] = settle(value, at[last]);
  });
  store.set(op.path, next);
};
const commitOps = async (ops) => {
  // A write lands on this device at once and on the server when there is one.
  ops.forEach((op) => applyTo(fake.cache, op));
  if (fake.online) ops.forEach((op) => applyTo(fake.server, op));
  fake.commits.push(ops.length);
};

export const writeBatch = () => {
  const ops = [];
  return {
    set: (ref, data, options) => ops.push({ kind: 'set', path: ref.path, data, merge: Boolean(options?.merge) }),
    update: (ref, data) => ops.push({ kind: 'update', path: ref.path, data }),
    delete: (ref) => ops.push({ kind: 'delete', path: ref.path }),
    commit: () => commitOps(ops),
  };
};
export const setDoc = (ref, data, options) => commitOps([{ kind: 'set', path: ref.path, data, merge: Boolean(options?.merge) }]);
export const updateDoc = (ref, data) => commitOps([{ kind: 'update', path: ref.path, data }]);
export const deleteDoc = (ref) => commitOps([{ kind: 'delete', path: ref.path }]);
export const addDoc = async (ref, data) => {
  const made = doc(ref);
  await setDoc(made, data);
  return made;
};

// Present because library.js imports them; nothing under test calls them.
export const query = (ref) => ref;
export const where = () => ({});
export const orderBy = () => ({});
export const onSnapshot = () => () => {};
export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
