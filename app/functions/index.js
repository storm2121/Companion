const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineBoolean, defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');

admin.initializeApp();

const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', {
  default: false,
  description: 'Reject callable requests without valid Firebase App Check tokens.',
});
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL_QUICK = 'deepseek-chat'; // V4 Flash non-thinking (rename to v4 id after 2026-07-24)
const MODEL_THINKING = 'deepseek-reasoner'; // V4 Flash thinking
const DAILY_CAP = 10;
const MAX_PAYLOAD_CHARS = 90000;
const MAX_RESULT_CHARS = 120000;
const MAX_BLOCKS = 160;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const AUI_EMAIL = /^[^@\s]+@aui\.ma$/i;
const PRIVATE_IMAGE_VALUE = '[private image omitted]';
const GRID = { bandX: 660, bandRight: 1740, x0: 822, fullW: 756, topY: 56 };

// ---- Canvas geometry (mirrors the client: WORKSPACE_WIDTH=2400, design band 1080,
// content column 756, gutter 20). The AI receives these as hard equations.
const LAYOUT_MATH = `
CANVAS GEOMETRY (obey these equations EXACTLY — they mirror the app's grid):
- Workspace width = 2400. The visible content band is x in [660, 1740] (1080 wide, centered).
- Content column: X0 = 822, FULL_W = 756 (the centered writing column).
- Gutter G = 20 between any two blocks, on both axes.
- Column layouts inside the content column:
  1 column: x = 822, w = 756
  2 columns: w = (756 - 20) / 2 = 368; x_left = 822, x_right = 822 + 368 + 20 = 1210
  3 columns: w = (756 - 2*20) / 3 = 238; x1 = 822, x2 = 1080, x3 = 1338
- Vertical flow: first row starts at y = 56; each next row starts at
  y = (max bottom edge of the row above) + 20, where bottom edge = y + h.
- Height estimate for a text block of width w holding N visible characters:
  charsPerLine = floor(w / 8.2); lines = ceil(N / charsPerLine) + (1 extra per heading or list item);
  h = 64 + lines * 24, clamped to [140, 1100]. Round x, y, w, h to integers.
- Blocks must NEVER overlap: for every pair A, B at least one must hold:
  A.x + A.w + 20 <= B.x  OR  B.x + B.w + 20 <= A.x  OR
  A.y + A.h + 20 <= B.y  OR  B.y + B.h + 20 <= A.y.
- canvasHeight = (max bottom edge) + 120, minimum 720.

VISUAL DESIGN GUIDELINES:
- Reading order is top to bottom, left to right. The opening/overview block is full width.
- Put tightly related concepts side by side (2 columns max for prose; 3 only for short lists).
- Long prose, tables and code stay full width (1 column). Never place x < 660.
- Prefer fewer, well-sized blocks over many tiny ones. Image blocks: you may reposition them
  on the same grid but never change their value, w or h.

LAYOUT RECIPES (a balanced study-sheet, NOT one long stack — this matters):
- Recipe "overview + pairs": full-width overview first, then related concepts as 2-column
  side-by-side pairs, then a full-width synthesis/summary.
- Recipe "two-over-one": a 2-column pair (e.g. concept vs counter-example), then a
  full-width elaboration below; repeat.
- Recipe "list rail": 3 columns ONLY for short parallel items (definitions, pros/cons,
  steps) of ~6 lines or less each.
- HARD RULE: when the result has 4 or more blocks, AT LEAST ONE THIRD of them must sit in
  2- or 3-column rows. A single stacked column is acceptable only when nearly every block
  is long continuous prose, a wide table, or code.
- Blocks sharing a row should end up with similar heights (within ~30%); balance by
  choosing what goes side by side, not by padding content.

WORKED GEOMETRY EXAMPLE (5 text blocks — the shape to aim for):
{"blocks":[
  {"x":822,"y":56,"w":756,"h":220},   ← overview, full width
  {"x":822,"y":296,"w":368,"h":320},  ← concept A (left column)
  {"x":1210,"y":296,"w":368,"h":320}, ← concept B (right column, same row)
  {"x":822,"y":636,"w":756,"h":260},  ← detail, full width
  {"x":822,"y":916,"w":756,"h":180}], ← summary, full width
 "canvasHeight":1216}`;

const STYLE_INSTRUCTIONS = {
  polish: `Fix ONLY typos, grammar, punctuation and casing inside each block's HTML text.
Do NOT rephrase sentences and do NOT move/resize/merge blocks: return every block with its
original id, x, y, w, h, title and type unchanged — only "value" may differ.`,
  restructure: `Reorganize the whole note for clarity: merge fragmented blocks, split walls of
text, add semantic headings (<h2>/<h3>) and lists, order ideas logically. You MAY create,
merge and delete text blocks, and you MUST lay every block out again using the canvas
geometry equations and design guidelines below. Give short meaningful titles to blocks.`,
  examples: `Keep the author's wording and structure, but after each concept add a short
concrete example or analogy (1-3 sentences, or a small code sample in <pre><code> for
programming content). Blocks grow: re-estimate each block's height with the height equation
and re-flow y positions so nothing overlaps. Keep every block's id, x and w.`,
  simplify: `Rewrite each block in plain, shorter sentences a tired student can absorb.
Preserve meaning, keep technical terms but explain them inline. Keep each block's id, x, y,
w, h, title and type — only "value" changes (it may get shorter).`,
};

// Optional add-ons composed on top of a base style (from the Customize popout).
const ADDON_INSTRUCTIONS = {
  fillGaps: `ADD-ON "complete missing info": where the note skips a definition, a step in a
derivation/process, or an obvious piece of the topic, add it — inside the most fitting
existing block, or as a new block when substantial. Stay strictly on the note's topic.`,
  deepen: `ADD-ON "go deeper": expand each main idea with more depth — consequences, edge
cases, the "why" behind the facts. Prefer enriching existing blocks; create a new block
only for a genuinely distinct sub-topic.`,
  tldr: `ADD-ON "TL;DR": add one full-width block titled "TL;DR" placed FIRST (y = 56,
every other block flows below it) containing 3-6 bullet points summarizing the whole note.`,
  glossary: `ADD-ON "key terms": add one full-width block titled "Key terms" placed LAST,
listing the important terms as "<b>term</b> — one-line definition" bullets.`,
};

const ADDON_GEOMETRY_BRIDGE = `Add-ons override the base style's geometry freeze ONLY as
far as needed: existing blocks keep their ids, but heights may be re-estimated with the
height equation and rows re-flowed (y positions) to make room for added content or blocks.`;

const OUTPUT_CONTRACT = `
OUTPUT: return ONLY a JSON object (no markdown fences, no commentary):
{"blocks":[{"id":"<original id when the block continues an existing one, else null>",
"type":"text"|"image","title":"<short or empty>","value":"<HTML>","x":int,"y":int,"w":int,"h":int}],
"canvasHeight":int}
HTML in "value" may use ONLY: p, h1, h2, h3, ul, ol, li, table, tr, td, th, pre, code,
blockquote, b, strong, i, em, u, s, a, br, span. No scripts, no style tags, no img in text.`;

const dayKey = () => new Date().toISOString().slice(0, 10);

const enforceDailyCap = async (uid) => {
  // Usage is deliberately outside users/{uid}: profile documents are client-writable.
  const ref = admin.firestore().doc(`sageUsage/${uid}`);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const usage = snap.exists ? snap.data() : {};
    const count = usage.date === dayKey() ? usage.count || 0 : 0;
    if (count >= DAILY_CAP) {
      throw new HttpsError(
        'resource-exhausted',
        'Sage has done a lot today — your daily limit resets tomorrow.',
      );
    }
    tx.set(
      ref,
      { date: dayKey(), count: count + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
};

const requireAuiUser = (request) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  // Email verification remains optional while the product is in testing.
  if (typeof email !== 'string' || !AUI_EMAIL.test(email)) {
    throw new HttpsError('permission-denied', 'An @aui.ma account is required.');
  }
  return uid;
};

const clampInt = (value, min, max, fallback) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
};

const prepareSageBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_BLOCKS) {
    throw new HttpsError('invalid-argument', 'Sage received an invalid number of blocks.');
  }
  const seen = new Set();
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') {
      throw new HttpsError('invalid-argument', 'Sage received an invalid block.');
    }
    const id = typeof block.id === 'string' ? block.id : '';
    if (!SAFE_ID.test(id) || seen.has(id)) {
      throw new HttpsError('invalid-argument', 'Sage received an invalid block id.');
    }
    seen.add(id);
    const type = block.type === 'image' ? 'image' : block.type === 'text' ? 'text' : '';
    if (!type) throw new HttpsError('invalid-argument', 'Sage received an invalid block type.');
    const value =
      type === 'image'
        ? PRIVATE_IMAGE_VALUE
        : typeof block.value === 'string'
          ? block.value.slice(0, 60000)
          : '';
    return {
      id,
      type,
      title: typeof block.title === 'string' ? block.title.slice(0, 120) : '',
      value,
      x: clampInt(block.x, 0, 2400, GRID.x0),
      y: clampInt(block.y, 0, 200000, GRID.topY),
      w: clampInt(block.w, 160, 1512, GRID.fullW),
      h: clampInt(block.h, 140, 1400, 240),
    };
  });
};

const sanitizeSageResult = (result, originalBlocks) => {
  if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) {
    throw new HttpsError('internal', 'Sage returned an unusable result — please try again.');
  }
  if (result.blocks.length > MAX_BLOCKS) {
    throw new HttpsError('internal', 'Sage returned too many blocks — please try again.');
  }
  const originals = new Map(originalBlocks.map((block) => [block.id, block]));
  const used = new Set();
  const blocks = [];

  for (const candidate of result.blocks) {
    if (!candidate || typeof candidate !== 'object') continue;
    const type = candidate.type === 'image' ? 'image' : candidate.type === 'text' ? 'text' : '';
    if (!type) continue;
    const candidateId = typeof candidate.id === 'string' && SAFE_ID.test(candidate.id) ? candidate.id : '';
    const original = candidateId ? originals.get(candidateId) : null;

    // The provider cannot invent, duplicate, or change the type of private image blocks.
    if (type === 'image' && (!original || original.type !== 'image' || used.has(original.id))) {
      continue;
    }

    const canReuseId = original && original.type === type && !used.has(original.id);
    const id = canReuseId ? original.id : randomUUID();
    used.add(id);

    const isImage = type === 'image';
    const w = isImage
      ? original.w
      : clampInt(candidate.w, 160, 1512, GRID.fullW);
    const h = isImage
      ? original.h
      : clampInt(candidate.h, 140, 1400, 240);
    const boundedW = Math.min(w, GRID.bandRight - GRID.bandX);
    const x = clampInt(candidate.x, GRID.bandX, GRID.bandRight - boundedW, GRID.x0);
    const y = clampInt(candidate.y, GRID.topY, 200000, GRID.topY);

    blocks.push({
      id,
      type,
      title: typeof candidate.title === 'string' ? candidate.title.slice(0, 120) : '',
      value: isImage
        ? PRIVATE_IMAGE_VALUE
        : typeof candidate.value === 'string'
          ? candidate.value.slice(0, 60000)
          : '',
      x,
      y,
      w: boundedW,
      h,
    });
  }

  if (!blocks.length) {
    throw new HttpsError('internal', 'Sage returned an unusable result — please try again.');
  }
  const maxBottom = blocks.reduce((max, block) => Math.max(max, block.y + block.h), 0);
  return { blocks, canvasHeight: Math.max(720, maxBottom + 120) };
};

const callDeepSeek = async (model, system, user, maxTokens) => {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY.value()}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('AI provider error', res.status, detail.slice(0, 500));
    throw new HttpsError('internal', `AI provider error (${res.status}).`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    const stripped = content.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
    return JSON.parse(stripped);
  }
};

const requireResourceId = (value, label) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  }
  return value;
};

const deleteStoragePrefix = async (prefix) => {
  await admin.storage().bucket().deleteFiles({ prefix, force: true });
};

const deleteNoteForUser = async (uid, classId, noteId) => {
  const db = admin.firestore();
  const noteRef = db.doc(`users/${uid}/classes/${classId}/notes/${noteId}`);
  const snap = await noteRef.get();
  // Storage first prevents a successful database deletion from leaving bearer URLs alive.
  await deleteStoragePrefix(`notes/${uid}/${noteId}/`);
  if (!snap.exists) return false;
  await db.recursiveDelete(noteRef);
  return true;
};

const DELETE_CALLABLE_OPTIONS = {
  region: 'europe-west1',
  timeoutSeconds: 300,
  memory: '256MiB',
  cors: true,
  invoker: 'public',
  enforceAppCheck: ENFORCE_APP_CHECK,
};

exports.sageImprove = onCall(
  {
    region: 'europe-west1',
    secrets: [DEEPSEEK_API_KEY],
    timeoutSeconds: 300,
    memory: '256MiB',
    // Callables still need the browser preflight answered and the underlying
    // Cloud Run service publicly invokable (auth is enforced inside via request.auth).
    cors: true,
    invoker: 'public',
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request) => {
    const uid = requireAuiUser(request);
    const { styleId, noteTitle, blocks, canvasHeight, addons, topic } = request.data || {};
    const style = STYLE_INSTRUCTIONS[styleId];
    if (!style) throw new HttpsError('invalid-argument', 'Unknown style.');
    const addonList = (Array.isArray(addons) ? addons : []).filter((a) => ADDON_INSTRUCTIONS[a]);
    const topicName = typeof topic === 'string' ? topic.trim().slice(0, 120) : '';
    const providerBlocks = prepareSageBlocks(blocks);
    const payload = JSON.stringify({
      noteTitle: typeof noteTitle === 'string' ? noteTitle.slice(0, 200) : '',
      canvasHeight: clampInt(canvasHeight, 720, 200000, 720),
      blocks: providerBlocks,
    });
    if (payload.length > MAX_PAYLOAD_CHARS) {
      throw new HttpsError('invalid-argument', 'This note is too large for Sage in one pass.');
    }

    await enforceDailyCap(uid);

    // Any add-on can grow or insert blocks, so add-ons always pull in the layout math.
    const needsLayout = styleId === 'restructure' || styleId === 'examples' || addonList.length > 0;
    const system = `You are Sage, the writing and layout assistant inside Companion, a
student note-taking app with a freeform block canvas. A note is an array of blocks
(type "text" with HTML in "value", or "image" whose value/w/h must never change).
${topicName ? `The note's topic, given by the student: "${topicName}".` : ''}
TASK STYLE = ${styleId}.
${style}
${addonList.map((a) => ADDON_INSTRUCTIONS[a]).join('\n')}
${addonList.length ? ADDON_GEOMETRY_BRIDGE : ''}
${needsLayout ? LAYOUT_MATH : ''}
${OUTPUT_CONTRACT}`;

    const result = await callDeepSeek(
      styleId === 'restructure' ? MODEL_THINKING : MODEL_QUICK,
      system,
      payload,
      16000,
    );

    if (JSON.stringify(result).length > MAX_RESULT_CHARS) {
      throw new HttpsError('internal', 'Sage returned too much content — please try again.');
    }
    return sanitizeSageResult(result, providerBlocks);
  },
);

exports.deleteNoteCascade = onCall(DELETE_CALLABLE_OPTIONS, async (request) => {
  const uid = requireAuiUser(request);
  const classId = requireResourceId(request.data?.classId, 'class id');
  const noteId = requireResourceId(request.data?.noteId, 'note id');
  const deleted = await deleteNoteForUser(uid, classId, noteId);
  if (deleted) {
    const classRef = admin.firestore().doc(`users/${uid}/classes/${classId}`);
    await classRef
      .update({ noteCount: admin.firestore.FieldValue.increment(-1) })
      .catch((err) => {
        if (err?.code !== 5) throw err;
      });
  }
  return { deleted };
});

exports.deleteNotesCascade = onCall(DELETE_CALLABLE_OPTIONS, async (request) => {
  const uid = requireAuiUser(request);
  const classId = requireResourceId(request.data?.classId, 'class id');
  const rawIds = Array.isArray(request.data?.noteIds) ? request.data.noteIds : [];
  const noteIds = [...new Set(rawIds.map((id) => requireResourceId(id, 'note id')))];
  if (!noteIds.length || noteIds.length > 100) {
    throw new HttpsError('invalid-argument', 'Choose between 1 and 100 notes.');
  }
  let deleted = 0;
  for (let offset = 0; offset < noteIds.length; offset += 10) {
    const results = await Promise.all(
      noteIds.slice(offset, offset + 10).map((noteId) => deleteNoteForUser(uid, classId, noteId)),
    );
    deleted += results.filter(Boolean).length;
  }
  if (deleted) {
    const classRef = admin.firestore().doc(`users/${uid}/classes/${classId}`);
    await classRef
      .update({ noteCount: admin.firestore.FieldValue.increment(-deleted) })
      .catch((err) => {
        if (err?.code !== 5) throw err;
      });
  }
  return { deleted };
});

exports.deleteClassCascade = onCall(DELETE_CALLABLE_OPTIONS, async (request) => {
  const uid = requireAuiUser(request);
  const classId = requireResourceId(request.data?.classId, 'class id');
  const db = admin.firestore();
  const classRef = db.doc(`users/${uid}/classes/${classId}`);
  const classSnap = await classRef.get();
  if (!classSnap.exists) return { deleted: false };
  const notesSnap = await classRef.collection('notes').get();
  const noteIds = notesSnap.docs.map((doc) => doc.id);
  for (let offset = 0; offset < noteIds.length; offset += 10) {
    await Promise.all(
      noteIds
        .slice(offset, offset + 10)
        .map((noteId) => deleteStoragePrefix(`notes/${uid}/${noteId}/`)),
    );
  }
  await db.recursiveDelete(classRef);
  return { deleted: true, deletedNotes: noteIds.length };
});
