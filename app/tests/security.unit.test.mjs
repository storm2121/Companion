import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  AVATAR_MAX_BYTES,
  createImageObjectName,
  NOTE_IMAGE_MAX_BYTES,
  validateImageFile,
} from '../src/utils/imageUpload.js';
import {
  applySagePatch,
  composeSageLayout,
  refitSageBlocks,
  stripDuplicateHeading,
  sanitizeSageLayout,
  SAGE_LAYOUT_LIMITS,
} from '../src/services/sageLayout.js';
import { clearCompanionWebStorage } from '../src/utils/offlineData.js';
// Firebase-free on purpose, so the allowance parity test can load it directly.
import { readSageBalance, sageRunWeight } from '../src/services/sageUsage.js';

const require = createRequire(import.meta.url);
const { liveNoteKey, storageNoteKey } = require('../functions/scripts/cleanup-orphan-note-images.js');
// The server's own copy of the allowance arithmetic — the one that actually charges.
const serverUsage = require('../functions/lib/usage.js');

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

test('Sage layout engine composes roles into columns without overlap', () => {
  const originals = [{ id: 'a', type: 'text', value: '<p>old</p>', x: 660, y: 56, w: 880, h: 200 }];
  const result = composeSageLayout(
    [
      { ref: 'r1', id: null, role: 'lead', title: 'Overview', value: '<p>The big picture.</p>' },
      { ref: 'r2', id: 'a', role: 'concept', title: 'Trees', value: '<p>A tree is a graph without cycles.</p>' },
      { ref: 'r3', id: null, role: 'example', attachTo: 'r2', title: 'Example', value: '<p>A linked list.</p>' },
      { ref: 'r4', id: null, role: 'caveat', attachTo: 'r2', title: 'Careful', value: '<p>Cycles break it.</p>' },
      { ref: 'r5', id: null, role: 'summary', title: 'TL;DR', value: '<ul><li>Acyclic</li></ul>' },
    ],
    originals,
  );

  assert.ok(result);
  assert.equal(result.blocks.length, 5);

  const byTitle = Object.fromEntries(result.blocks.map((block) => [block.title, block]));
  // lead and summary take the full design band; a concept carrying asides takes the main column
  assert.deepEqual([byTitle.Overview.x, byTitle.Overview.w], [660, 1080]);
  assert.deepEqual([byTitle['TL;DR'].x, byTitle['TL;DR'].w], [660, 1080]);
  assert.deepEqual([byTitle.Trees.x, byTitle.Trees.w], [660, 710]);
  // the attached example sits beside its parent, not under it
  assert.equal(byTitle.Example.y, byTitle.Trees.y);
  assert.ok(byTitle.Example.x > byTitle.Trees.x + byTitle.Trees.w);
  // a caveat is a margin note, so it breaks the band deliberately — but stays legal
  assert.ok(byTitle.Careful.x >= 660 - 110);
  result.blocks.forEach((block) => assert.ok(block.x + block.w <= 1740 + 110));
  // the block that continued an existing one kept its id; the rest got fresh ones
  assert.equal(byTitle.Trees.id, 'a');
  assert.equal(new Set(result.blocks.map((b) => b.id)).size, 5);
  // roles survive onto the blocks, and nothing overlaps
  assert.equal(byTitle.Careful.role, 'caveat');
  for (const a of result.blocks) {
    for (const b of result.blocks) {
      if (a === b) continue;
      const g = SAGE_LAYOUT_LIMITS.MIN_GAP;
      const apart =
        a.x + a.w + g <= b.x || b.x + b.w + g <= a.x || a.y + a.h + g <= b.y || b.y + b.h + g <= a.y;
      assert.ok(apart, `${a.title} overlaps ${b.title}`);
    }
  }
});

test('Sage patch edits only named blocks and keeps the student formatting', () => {
  const current = [
    { id: 'one', type: 'text', value: '<p>teh cat</p>', title: 'A', x: 660, y: 56, w: 880, h: 200, fontSize: 18, bgColor: '#eee', locked: true },
    { id: 'two', type: 'text', value: '<p>untouched</p>', title: 'B', x: 660, y: 276, w: 880, h: 200, fontSize: 14 },
  ];
  const result = applySagePatch(current, {
    mode: 'reflow',
    changed: [{ id: 'one', value: '<p>the cat</p>' }],
    added: [{ afterId: 'one', title: 'New', value: '<p>fresh</p>', role: 'example' }],
  });

  assert.ok(result);
  assert.equal(result.editedCount, 1);
  assert.equal(result.addedCount, 1);
  const byId = Object.fromEntries(result.blocks.map((block) => [block.title, block]));
  assert.equal(byId.A.value, '<p>the cat</p>');
  // untouched blocks come back byte-for-byte
  assert.equal(byId.B.value, '<p>untouched</p>');
  // per-block formatting is the student's, not Sage's, so it survives the pass
  assert.equal(byId.A.fontSize, 18);
  assert.equal(byId.A.bgColor, '#eee');
  assert.equal(byId.A.locked, true);
  // the new block lands between its anchor and what followed it
  assert.ok(byId.New.y > byId.A.y);
  assert.ok(byId.B.y > byId.New.y);
});

test('Sage patch reports an empty result rather than inventing changes', () => {
  const current = [{ id: 'one', type: 'text', value: '<p>fine</p>', title: 'A', x: 660, y: 56, w: 880, h: 200 }];
  const result = applySagePatch(current, { mode: 'patch', changed: [] });
  assert.ok(result);
  assert.equal(result.editedCount, 0);
  assert.equal(result.addedCount, 0);
  assert.equal(result.blocks[0].value, '<p>fine</p>');
  // an id the provider invented cannot become a write
  const invented = applySagePatch(current, { mode: 'patch', changed: [{ id: 'nope', value: '<p>evil</p>' }] });
  assert.equal(invented.editedCount, 0);
  assert.equal(invented.blocks[0].value, '<p>fine</p>');
});

test('Sage layout keeps the tight tier of the spacing scale', () => {
  // Two asides on one concept stack 8px apart. The de-overlap guard used to treat any
  // gap under the 20px column gutter as a collision and silently rewrite it to 20,
  // which flattened the 8/20/48 scale down to one spacing everywhere.
  const result = composeSageLayout(
    [
      { ref: 'c', id: null, role: 'concept', title: 'Idea', value: '<p>A long enough explanation to matter.</p>' },
      { ref: 'e1', id: null, role: 'example', attachTo: 'c', title: 'One', value: '<p>First.</p>' },
      { ref: 'e2', id: null, role: 'example', attachTo: 'c', title: 'Two', value: '<p>Second.</p>' },
    ],
    [],
  );
  assert.ok(result);
  const byTitle = Object.fromEntries(result.blocks.map((b) => [b.title, b]));
  assert.equal(byTitle.One.x, byTitle.Two.x, 'stacked asides share the aside column');
  assert.equal(byTitle.Two.y - (byTitle.One.y + byTitle.One.h), SAGE_LAYOUT_LIMITS.MIN_GAP);
  // and the section tier still opens a real gap before a summary
  const withLead = composeSageLayout(
    [
      { ref: 'a', id: null, role: 'concept', title: 'A', value: '<p>Body text here.</p>' },
      { ref: 'b', id: null, role: 'summary', title: 'B', value: '<p>Wrap up.</p>' },
    ],
    [],
  );
  const a = withLead.blocks.find((b) => b.title === 'A');
  const b = withLead.blocks.find((b) => b.title === 'B');
  assert.equal(b.y - (a.y + a.h), 48);
});

test('Sage layout flows the two columns independently', () => {
  // A short concept carrying two tall margin notes used to leave a void beneath itself:
  // every row was a full-width band that ended at its tallest cell, so the next block in
  // the reading column waited for the rail to finish. The columns now flow separately.
  const long = `<p>${'word '.repeat(400)}</p>`;
  const result = composeSageLayout(
    [
      { ref: 'c1', id: null, role: 'concept', title: 'Short', value: '<p>Brief.</p>' },
      { ref: 'a1', id: null, role: 'example', attachTo: 'c1', title: 'Tall one', value: long },
      { ref: 'a2', id: null, role: 'example', attachTo: 'c1', title: 'Tall two', value: long },
      { ref: 'c2', id: null, role: 'concept', title: 'Next', value: '<p>Follows on.</p>' },
    ],
    [],
  );
  assert.ok(result);
  const b = Object.fromEntries(result.blocks.map((x) => [x.title, x]));
  const railBottom = Math.max(b['Tall one'].y + b['Tall one'].h, b['Tall two'].y + b['Tall two'].h);
  // "Next" follows "Short" in the reading column, without waiting for the rail
  assert.equal(b.Next.y, b.Short.y + b.Short.h + SAGE_LAYOUT_LIMITS.SPACE.normal);
  assert.ok(b.Next.y < railBottom, 'reading column must not wait for the margin rail');
  assert.equal(b.Next.x, b.Short.x, 'both stay in the reading column');
  // and a margin note never floats above the block it belongs to
  assert.ok(b['Tall one'].y >= b.Short.y);
});

test('Sage refit grows a short block and pushes only its own column', () => {
  const blocks = [
    { id: 'main1', type: 'text', title: 'Main', value: '<p>a</p>', x: 660, y: 56, w: 710, h: 200 },
    { id: 'rail1', type: 'text', title: 'Rail', value: '<p>b</p>', x: 1390, y: 56, w: 350, h: 400 },
    { id: 'main2', type: 'text', title: 'Below', value: '<p>c</p>', x: 660, y: 276, w: 710, h: 200 },
  ];
  const refit = refitSageBlocks(blocks, new Map([['main1', 60]]));
  assert.ok(refit);
  const b = Object.fromEntries(refit.blocks.map((x) => [x.title, x]));
  assert.equal(b.Main.h, 260, 'the short block absorbs the shortfall');
  assert.equal(b.Below.y, 336, 'what sits under it moves down by exactly that much');
  assert.equal(b.Rail.y, 56, 'the other column does not move');
  // nothing to correct is not a change
  assert.equal(refitSageBlocks(blocks, new Map()), null);
});

test('Sage strips a heading that only repeats the block title', () => {
  assert.equal(
    stripDuplicateHeading('<h2>Traversal Orders</h2><p>a</p>', 'Traversal Orders'),
    '<p>a</p>',
  );
  // entity differences and trailing punctuation still count as the same title
  assert.equal(
    stripDuplicateHeading('<h3>Confusions &amp; Exam Flags:</h3><p>a</p>', 'Confusions & Exam Flags'),
    '<p>a</p>',
  );
  // a heading that genuinely says something else is left alone
  assert.equal(
    stripDuplicateHeading('<h2>Why it matters</h2><p>a</p>', 'Traversal Orders'),
    '<h2>Why it matters</h2><p>a</p>',
  );
});

test('Sage run weight: client and server formulas cannot drift', () => {
  const block = (chars) => ({ type: 'text', title: '', value: 'x'.repeat(chars) });
  const cases = [
    [[block(10)], 'patch'],
    [[block(10)], 'layout'],
    [[block(12000)], 'patch'],
    [[block(12001)], 'patch'],
    [[block(12001)], 'layout'],
    [[block(30000)], 'patch'],
    [[block(30000)], 'layout'],
    [[block(52000)], 'patch'],
    [[block(52000)], 'layout'],
    [[block(6000), block(6000)], 'reflow'],
    [[], 'patch'],
    [[{ type: 'image', value: 'https://example/private', title: 'pic' }], 'layout'],
  ];
  for (const [blocks, mode] of cases) {
    assert.equal(
      sageRunWeight(blocks, mode),
      serverUsage.sageRunWeight(blocks, mode),
      `client and server disagree for ${mode} / ${serverUsage.sageContentChars(blocks)} chars`,
    );
  }
  // the shape of the curve itself, pinned
  assert.equal(sageRunWeight([block(500)], 'patch'), 1, 'an ordinary note costs one run');
  assert.equal(sageRunWeight([block(500)], 'layout'), 2, 'a rebuild of it costs two');
  assert.equal(sageRunWeight([block(30000)], 'patch'), 3, 'a long note costs more');
  assert.equal(sageRunWeight([block(52000)], 'layout'), 4, 'nothing exceeds the ceiling');
  // an image contributes nothing: its pixels never reach the provider
  assert.equal(sageRunWeight([{ type: 'image', value: 'x'.repeat(50000) }], 'patch'), 1);
});

test('Sage allowance overdrafts, then repays itself the next day', () => {
  const { applyCharge } = serverUsage;
  const cap = 10;
  // a charge that does not fit is still allowed through — being told "this costs 3, you
  // have 2, come back tomorrow" is the arithmetic that makes a tool feel hostile
  const over = applyCharge({ usage: { date: 'd1', count: 9 }, today: 'd1', cap, weight: 4, allowOverdraft: true });
  assert.equal(over.blocked, false);
  assert.equal(over.count, 13);
  // ...but once the allowance is actually spent, it stops
  const spent = applyCharge({ usage: { date: 'd1', count: 13 }, today: 'd1', cap, weight: 1, allowOverdraft: true });
  assert.equal(spent.blocked, true);
  assert.equal(spent.count, 13, 'a blocked charge writes nothing');
  // tomorrow opens owing exactly what was borrowed
  const next = applyCharge({ usage: { date: 'd1', count: 13 }, today: 'd2', cap, weight: 1, allowOverdraft: true });
  assert.equal(next.opening, 3);
  assert.equal(next.remaining, 6);
  // a normal day's spend is history, not debt
  const clean = applyCharge({ usage: { date: 'd1', count: 10 }, today: 'd2', cap, weight: 1, allowOverdraft: true });
  assert.equal(clean.opening, 0);
  // debt never compounds past one full day, so nobody is locked out for a week
  const huge = applyCharge({ usage: { date: 'd1', count: 999 }, today: 'd2', cap, weight: 1, allowOverdraft: true });
  assert.equal(huge.opening, cap);
  assert.equal(huge.blocked, true);
  // the app-wide counter gets no overdraft: it is protecting the bill
  const strict = applyCharge({ usage: { date: 'd1', count: 9 }, today: 'd1', cap, weight: 4 });
  assert.equal(strict.blocked, true);
});

test('Sage balance reads the same way on the client', () => {
  assert.deepEqual(readSageBalance(null, 'd1'), { cap: 10, spent: 0, left: 10, over: 0 });
  assert.deepEqual(readSageBalance({ date: 'd1', count: 3, cap: 10 }, 'd1'), {
    cap: 10,
    spent: 3,
    left: 7,
    over: 0,
  });
  // yesterday's overdraft carries; yesterday's ordinary spend does not
  assert.deepEqual(readSageBalance({ date: 'd0', count: 13, cap: 10 }, 'd1'), {
    cap: 10,
    spent: 3,
    left: 7,
    over: 0,
  });
  assert.deepEqual(readSageBalance({ date: 'd0', count: 10, cap: 10 }, 'd1'), {
    cap: 10,
    spent: 0,
    left: 10,
    over: 0,
  });
  // and an exhausted day reports it
  const out = readSageBalance({ date: 'd1', count: 12, cap: 10 }, 'd1');
  assert.equal(out.left <= 0, true);
  assert.equal(out.over, 2);
});
