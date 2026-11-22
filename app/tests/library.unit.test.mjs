// The room's own reads and writes in src/services/library.js, run against an in-memory
// Firestore (tests/helpers/fakeFirestore.mjs) that keeps a server copy and a device copy apart.
// The real file is what runs: only its three imports — `firebase/firestore`,
// `firebase/functions` and `../firebase` — are pointed at the fakes.
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import test from 'node:test';

const FIRESTORE = new URL('./helpers/fakeFirestore.mjs', import.meta.url).href;
const APP = new URL('./helpers/fakeFirebaseApp.mjs', import.meta.url).href;

// Needs Node's in-thread module hooks (22.15+). Without them the tests are skipped, not failed.
const canHook = typeof nodeModule.registerHooks === 'function';
let library = null;
let fake = null;
if (canHook) {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'firebase/firestore') return { url: FIRESTORE, shortCircuit: true };
      if (specifier === 'firebase/functions') return { url: APP, shortCircuit: true };
      if (specifier === '../firebase' && context.parentURL?.endsWith('/src/services/library.js')) {
        return { url: APP, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  ({ fake } = await import(FIRESTORE));
  library = await import('../src/services/library.js');
}
const it = (name, fn) => test(name, { skip: canHook ? false : 'needs node:module registerHooks' }, fn);

const UID = 'u1';
const note = (classId, id) => `users/${UID}/classes/${classId}/notes/${id}`;
const content = (classId, id, docId = 'main') => `${note(classId, id)}/content/${docId}`;
const course = (classId) => `users/${UID}/classes/${classId}`;
const page = (text) => ({ blocks: { b1: { id: 'b1', type: 'text', value: text } }, order: ['b1'], canvasHeight: 720 });

const twoCourses = () => {
  fake.reset();
  fake.seed(course('A'), { name: 'A', noteCount: 3 });
  fake.seed(course('B'), { name: 'B', noteCount: 0 });
};

/* ── moveRoomNotes ─────────────────────────────────────────────────────────── */

it('room move: what moves is the SERVER copy, not this device’s older one', async () => {
  twoCourses();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page', tags: ['midterm'] });
  // Edited on another device: the server is ahead of what this device cached.
  fake.server.set(content('A', 'n1'), page('<p>NEW, written on the phone</p>'));
  fake.cache.set(content('A', 'n1'), page('<p>old, cached on the laptop</p>'));

  const result = await library.moveRoomNotes(UID, 'A', 'B', [{ id: 'n1', title: 'Heaps' }]);

  assert.deepEqual(result, { moved: 1, missing: 0 });
  assert.equal(fake.server.get(content('B', 'n1')).blocks.b1.value, '<p>NEW, written on the phone</p>');
  assert.equal(fake.server.get(note('B', 'n1')).title, 'Heaps');
  assert.deepEqual(fake.server.get(note('B', 'n1')).tags, ['midterm']);
  assert.equal(fake.server.has(note('A', 'n1')), false);
  assert.equal(fake.server.has(content('A', 'n1')), false);
  assert.equal(fake.server.get(course('A')).noteCount, 2);
  assert.equal(fake.server.get(course('B')).noteCount, 1);
});

it('room move: every content doc goes along — Sage’s original and improved too', async () => {
  twoCourses();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page', sageHasVersions: true });
  fake.seed(content('A', 'n1', 'main'), page('<p>improved</p>'));
  fake.seed(content('A', 'n1', 'original'), page('<p>as first written</p>'));
  fake.seed(content('A', 'n1', 'improved'), page('<p>improved</p>'));

  await library.moveRoomNotes(UID, 'A', 'B', [{ id: 'n1' }]);

  assert.equal(fake.server.get(content('B', 'n1', 'original')).blocks.b1.value, '<p>as first written</p>');
  assert.equal(fake.server.get(content('B', 'n1', 'improved')).blocks.b1.value, '<p>improved</p>');
  assert.equal(fake.server.get(content('B', 'n1', 'main')).blocks.b1.value, '<p>improved</p>');
  ['main', 'original', 'improved'].forEach((docId) => {
    assert.equal(fake.server.has(content('A', 'n1', docId)), false, `${docId} left behind`);
  });
});

it('room move: refused, and nothing written, when the server cannot be read', async () => {
  twoCourses();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page' });
  fake.seed(content('A', 'n1'), page('<p>text</p>'));
  const before = JSON.stringify([...fake.server.entries()]);

  // No connection: the read fails.
  fake.online = false;
  await assert.rejects(library.moveRoomNotes(UID, 'A', 'B', [{ id: 'n1' }]), { code: 'move/unreadable' });
  // A connection that never answers: the wait gives up.
  fake.online = true;
  fake.hang = true;
  await assert.rejects(library.moveRoomNotes(UID, 'A', 'B', [{ id: 'n1' }], { waitMs: 20 }), {
    code: 'move/unreadable',
  });

  assert.equal(JSON.stringify([...fake.server.entries()]), before);
  assert.deepEqual(fake.commits, []);
  assert.equal(fake.cache.has(note('B', 'n1')), false);
});

it('room move: a note the server no longer has is left out, not recreated', async () => {
  twoCourses();
  fake.seed(note('A', 'n1'), { title: 'Kept', format: 'page' });
  fake.seed(content('A', 'n1'), page('<p>kept</p>'));
  // Deleted on another device; this device still lists it from its cache.
  fake.cache.set(note('A', 'n2'), { title: 'Deleted elsewhere', format: 'page' });

  const result = await library.moveRoomNotes(UID, 'A', 'B', [{ id: 'n1' }, { id: 'n2' }]);

  assert.deepEqual(result, { moved: 1, missing: 1 });
  assert.equal(fake.server.has(note('B', 'n2')), false);
  assert.equal(fake.server.get(course('B')).noteCount, 1);
});

it('room move: nothing to do is not an error, and a large move stays under the batch limit', async () => {
  twoCourses();
  assert.deepEqual(await library.moveRoomNotes(UID, 'A', 'A', [{ id: 'n1' }]), { moved: 0, missing: 0 });
  assert.deepEqual(await library.moveRoomNotes(UID, 'A', 'B', []), { moved: 0, missing: 0 });

  fake.server.get(course('A')).noteCount = 150;
  const ids = Array.from({ length: 150 }, (_, i) => `n${i}`);
  ids.forEach((id) => {
    fake.seed(note('A', id), { title: id, format: 'page' });
    ['main', 'original', 'improved'].forEach((docId) => fake.seed(content('A', id, docId), page(id)));
  });

  const result = await library.moveRoomNotes(UID, 'A', 'B', ids.map((id) => ({ id })));

  assert.equal(result.moved, 150);
  assert.ok(fake.commits.length > 1, 'split into several batches');
  assert.ok(Math.max(...fake.commits) <= 500, `a batch of ${Math.max(...fake.commits)} writes`);
  assert.equal(fake.server.get(course('A')).noteCount, 0);
  assert.equal(fake.server.get(course('B')).noteCount, 150);
  assert.equal(fake.server.get(content('B', 'n149', 'original')).blocks.b1.value, 'n149');
});

/* ── getNoteFresh: a note whose content cannot be read ────────────────────── */

it('room open: content on neither the server nor this device is UNAVAILABLE, not an empty page', async () => {
  fake.reset();
  // The course's note list put the note itself on this device; its page was never opened here.
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page' });
  fake.seed(content('A', 'n1'), page('<p>the real note</p>'), { cached: false });
  fake.online = false;

  const opened = await library.getNoteFresh(UID, 'A', 'n1', { waitMs: 20 });

  assert.equal(opened.unavailable, true);
  assert.equal(opened.note.title, 'Heaps');
  assert.deepEqual(opened.note.blocks, []);
});

it('room open: a page that was read is never called unavailable — cached, fresh, or truly empty', async () => {
  fake.reset();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page' });
  fake.seed(content('A', 'n1'), page('<p>cached here</p>'));
  fake.seed(note('A', 'n2'), { title: 'Blank', format: 'page' });
  fake.seed(content('A', 'n2'), { blocks: {}, order: [], canvasHeight: 720 });

  // Offline with a cached page: it opens from this device.
  fake.online = false;
  const cached = await library.getNoteFresh(UID, 'A', 'n1', { waitMs: 20 });
  assert.equal(cached.unavailable, false);
  assert.equal(cached.fresh, false);
  assert.equal(cached.note.blocks[0].value, '<p>cached here</p>');
  // Offline with a cached page that really is empty: a blank note, free to write on.
  const blank = await library.getNoteFresh(UID, 'A', 'n2', { waitMs: 20 });
  assert.equal(blank.unavailable, false);
  assert.deepEqual(blank.note.blocks, []);

  // Online: the server's copy.
  fake.online = true;
  fake.server.set(content('A', 'n1'), page('<p>newer on the server</p>'));
  const fresh = await library.getNoteFresh(UID, 'A', 'n1', { waitMs: 200 });
  assert.equal(fresh.unavailable, false);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.note.blocks[0].value, '<p>newer on the server</p>');
});

it('room open: a slow server hands over the real page later, for a note held as unavailable', async () => {
  fake.reset();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page' });
  fake.seed(content('A', 'n1'), page('<p>the real note</p>'), { cached: false });
  // The server read is slower than the wait: answer it by hand after the first result.
  fake.hang = true;
  const opened = await library.getNoteFresh(UID, 'A', 'n1', { waitMs: 20 });
  assert.equal(opened.unavailable, true);
  assert.ok(opened.later, 'the server answer is still expected');
});

it('classic move is as it was: it still copies this device’s cached page', async () => {
  twoCourses();
  fake.seed(note('A', 'n1'), { title: 'Heaps' });
  fake.server.set(content('A', 'n1'), page('<p>server</p>'));
  fake.cache.set(content('A', 'n1'), page('<p>cache</p>'));

  await library.moveNotes(UID, 'A', 'B', [{ id: 'n1', title: 'Heaps' }]);

  assert.equal(fake.server.get(content('B', 'n1')).blocks.b1.value, '<p>cache</p>');
});

/* ── saveSageAnswer (run room2) ────────────────────────────────────────────── */

it('sage answer for a note that was left: the page, the “before” copy and the marks land together', async () => {
  fake.reset();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page' });
  fake.seed(content('A', 'n1'), {
    blocks: { b1: { id: 'b1', type: 'text', value: '<p>one</p>' }, b2: { id: 'b2', type: 'text', value: '<p>two</p>' } },
    order: ['b1', 'b2'],
    canvasHeight: 720,
  });

  await library.saveSageAnswer(UID, 'A', 'n1', {
    changedBlocks: { b1: { id: 'b1', type: 'text', value: '<p>one, tidied</p>' }, b3: { id: 'b3', type: 'callout', value: '<p>new</p>' } },
    removedBlockIds: ['b2'],
    order: ['b1', 'b3'],
    original: [
      { id: 'b1', type: 'text', value: '<p>one</p>' },
      { id: 'b2', type: 'text', value: '<p>two</p>' },
    ],
    canvasHeight: 720,
  });

  const main = fake.server.get(content('A', 'n1'));
  assert.deepEqual(main.order, ['b1', 'b3']);
  assert.equal(main.blocks.b1.value, '<p>one, tidied</p>');
  assert.equal(main.blocks.b3.type, 'callout');
  assert.equal('b2' in main.blocks, false);
  const before = fake.server.get(content('A', 'n1', 'original'));
  assert.deepEqual(before.order, ['b1', 'b2']);
  assert.equal(before.blocks.b2.value, '<p>two</p>');
  const meta = fake.server.get(note('A', 'n1'));
  assert.equal(meta.sageHasVersions, true);
  assert.equal(meta.sageView, 'improved');
  assert.equal(meta.title, 'Heaps');
  assert.equal(fake.commits.at(-1), 3, 'one batch: page, note, copy');
});

it('sage answer for a note that was left: a later run keeps the first “before” copy', async () => {
  fake.reset();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page', sageHasVersions: true, sageView: 'improved' });
  fake.seed(content('A', 'n1'), page('<p>after the first run</p>'));
  fake.seed(content('A', 'n1', 'original'), page('<p>as the student wrote it</p>'));

  await library.saveSageAnswer(UID, 'A', 'n1', {
    changedBlocks: { b1: { id: 'b1', type: 'text', value: '<p>after the second run</p>' } },
    order: ['b1'],
    original: null,
  });

  assert.equal(fake.server.get(content('A', 'n1')).blocks.b1.value, '<p>after the second run</p>');
  assert.equal(fake.server.get(content('A', 'n1', 'original')).blocks.b1.value, '<p>as the student wrote it</p>');
});

it('sage answer for a note that was deleted meanwhile: refused, nothing banked, nothing marked', async () => {
  fake.reset();
  fake.seed(course('A'), { name: 'A' });

  await assert.rejects(
    library.saveSageAnswer(UID, 'A', 'gone', {
      changedBlocks: { b1: { id: 'b1', type: 'text', value: '<p>x</p>' } },
      order: ['b1'],
      original: [{ id: 'b1', type: 'text', value: '<p>before</p>' }],
    }),
  );

  assert.equal(fake.server.has(content('A', 'gone')), false);
  assert.equal(fake.server.has(content('A', 'gone', 'original')), false);
  assert.equal(fake.server.has(note('A', 'gone')), false);
});

it('sage answer: an answer with no page order is refused before anything is written', async () => {
  fake.reset();
  fake.seed(note('A', 'n1'), { title: 'Heaps', format: 'page' });
  fake.seed(content('A', 'n1'), page('<p>one</p>'));
  await assert.rejects(library.saveSageAnswer(UID, 'A', 'n1', { changedBlocks: { b1: { id: 'b1', type: 'text', value: '<p>x</p>' } } }));
  assert.equal(fake.server.get(content('A', 'n1')).blocks.b1.value, '<p>one</p>');
});
