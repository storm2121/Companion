import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  AVATAR_MAX_BYTES,
  createImageObjectName,
  NOTE_IMAGE_MAX_BYTES,
  validateImageFile,
} from '../src/utils/imageUpload.js';
import { sanitizeSageLayout } from '../src/services/sageLayout.js';
import { clearCompanionWebStorage } from '../src/utils/offlineData.js';

const require = createRequire(import.meta.url);
const { liveNoteKey, storageNoteKey } = require('../functions/scripts/cleanup-orphan-note-images.js');

const makeStorage = (entries) => {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
  };
};

test('image validation rejects SVG and oversized files', () => {
  assert.throws(
    () => validateImageFile({ type: 'image/svg+xml', size: 100 }, { maxBytes: AVATAR_MAX_BYTES }),
    /SVG is not allowed/,
  );
  assert.throws(
    () =>
      validateImageFile(
        { type: 'image/png', size: NOTE_IMAGE_MAX_BYTES + 1 },
        { maxBytes: NOTE_IMAGE_MAX_BYTES },
      ),
    /smaller than 10 MB/,
  );
  const valid = { type: 'image/png', size: 1024 };
  assert.equal(validateImageFile(valid, { maxBytes: AVATAR_MAX_BYTES }), valid);
  assert.match(createImageObjectName(valid, 'avatar'), /^avatar-[A-Za-z0-9-]+\.png$/);
});

test('Sage layout preserves private images and canonicalizes unsafe or duplicate ids', () => {
  const originals = [
    { id: 'text-1', type: 'text', value: '<p>Original</p>', x: 822, y: 56, w: 756, h: 200 },
    {
      id: 'image-1',
      type: 'image',
      value: 'https://storage.example/private-token',
      x: 822,
      y: 276,
      w: 320,
      h: 180,
    },
  ];
  const result = sanitizeSageLayout(
    [
      { id: 'text-1', type: 'text', value: '<p>Improved</p>', x: 822, y: 56, w: 756, h: 200 },
      { id: 'text-1', type: 'text', value: '<p>Duplicate</p>', x: 822, y: 276, w: 756, h: 200 },
      { id: 'bad.dot', type: 'text', value: '<p>New</p>', x: 822, y: 496, w: 756, h: 200 },
      { id: 'image-1', type: 'image', value: 'provider-value', x: 822, y: 716, w: 10, h: 10 },
      { id: 'invented-image', type: 'image', value: 'provider-value', x: 822, y: 936, w: 10, h: 10 },
    ],
    originals,
  );

  assert.ok(result);
  assert.equal(result.blocks.length, 4);
  assert.equal(new Set(result.blocks.map((block) => block.id)).size, result.blocks.length);
  result.blocks.forEach((block) => assert.match(block.id, /^[A-Za-z0-9_-]{1,128}$/));
  const image = result.blocks.find((block) => block.type === 'image');
  assert.equal(image.value, originals[1].value);
  assert.equal(image.w, originals[1].w);
  assert.equal(image.h, originals[1].h);
  assert.equal(result.blocks.filter((block) => block.id === 'text-1').length, 1);
});

test('secure device clearing removes only Companion browser data', () => {
  const local = makeStorage({
    authEmail: 'student@aui.ma',
    'companion-note-draft:user:class:note': '{"blocks":[]}',
    'companion:future-setting': 'value',
    unrelated: 'keep me',
  });
  const session = makeStorage({
    'companion:new-note-draft': '{"uid":"user"}',
    'another-app': 'keep me too',
  });

  assert.deepEqual(clearCompanionWebStorage({ local, session }), { local: 3, session: 1 });
  assert.equal(local.getItem('unrelated'), 'keep me');
  assert.equal(session.getItem('another-app'), 'keep me too');
  assert.equal(local.getItem('companion:future-setting'), null);
  assert.equal(session.getItem('companion:new-note-draft'), null);
});

test('orphan cleanup only recognizes canonical note paths', () => {
  assert.equal(
    liveNoteKey('users/user-1/classes/class-1/notes/note-1'),
    'user-1/note-1',
  );
  assert.equal(liveNoteKey('users/user-1/noteTemplates/note-1'), null);
  assert.equal(storageNoteKey('notes/user-1/note-1/image.png'), 'user-1/note-1');
  assert.equal(storageNoteKey('notes/user-1/orphan-file.png'), null);
  assert.equal(storageNoteKey('templates/user-1/template-1/image.png'), null);
});
