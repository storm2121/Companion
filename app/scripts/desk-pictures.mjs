// The desk's production pictures (round eight, run 3): their home in the app, and the data the page reads.
//
//   node scripts/desk-pictures.mjs              copy + data
//   node scripts/desk-pictures.mjs --data-only  the data alone (the pictures already copied)
//   node scripts/desk-pictures.mjs --src <prod folder> --out <public folder>
//
// From Blender's production set (room-harness/blender/out-cloud/prod1: six light-state folders of WebP
// pictures, 1x and 2x, and scene2.json, which says what each is and how the page stacks them: its
// README.md), this copies the six state folders to public/assets/desk-p1/ and writes the page's data
// split in two kinds of file there:
//   core.json      small, fetched when the desk opens: the frame and crop, the surround, the camera, the
//                  places (levels, quads, hit areas), the fill, room and draw orders, the leathers, the lamp,
//                  the small notebook, the candles, the gilt tones, the held book's geometry, and per state
//                  its look, candle and lamp and the name of its own file;
//   <state>.json   one per light state, fetched when that state is first needed: its layers (each picture's
//                  1x and 2x file, its box, `res` for soft layers, `quad` for gilt strips, `blend`), its
//                  pairs and its held entries (the held book in each leather, and its surround).
// Picture paths stay relative to the folder (night/set-lit.webp ...): the page prefixes the folder's URL.
//
// THE FOLDER'S NAME IS ITS VERSION. Hosting serves /assets/** with a year's immutable cache
// (firebase.json), so a person who has fetched desk-p1/night/set-lit.webp keeps it. Pictures that change
// after a deploy must go out under a NEW folder name (desk-p2, ...), with the page's DESK_PICTURES constant
// (room/deskTableData.js) moved to it; never overwrite a deployed folder's files.
//
// public/assets/desk-p1/ is in the repository's .gitignore (about 240 MB): whether the pictures are
// committed is the owner's decision. Without the folder the desk draws round seven's stage (RoomDesk), as
// before.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : fallback;
};
const SRC = arg('--src', join(APP, 'room-harness', 'blender', 'out-cloud', 'prod1'));
const OUT = arg('--out', join(APP, 'public', 'assets', 'desk-p1'));
const DATA_ONLY = process.argv.includes('--data-only');
// The old stage's scene (round seven): the wall frame's opening and outer edge, which the production data
// does not carry (the frame hangs where it hung: the same camera, the same frame).
const OLD_SCENE = join(APP, 'src', 'room', 'assets', 'desk', 'scene.json');

const scene = JSON.parse(readFileSync(join(SRC, 'scene2.json'), 'utf8'));
const old = JSON.parse(readFileSync(OLD_SCENE, 'utf8'));
const STATES = Object.keys(scene.states);

const kb = (bytes) => Math.round(bytes / 102.4) / 10;

/* ── The pictures ─────────────────────────────────────────────────────────── */

if (!DATA_ONLY) {
  mkdirSync(OUT, { recursive: true });
  STATES.forEach((state) => {
    const from = join(SRC, state);
    const to = join(OUT, state);
    rmSync(to, { recursive: true, force: true });
    // Only the pictures: the folder's own json files are the builder's (scene2.json holds the same).
    cpSync(from, to, { recursive: true, filter: (path) => statSync(path).isDirectory() || path.endsWith('.webp') });
  });
}

/* ── The data ─────────────────────────────────────────────────────────────── */

// Every picture a state names, on disk (1x and 2x): a missing one is reported and left out.
const missing = [];
const layerOf = (state, name, rec) => {
  const out = { x1: rec.x1, x2: rec.x2, box: rec.box };
  if (rec.res) out.res = rec.res;
  if (rec.quad) out.quad = rec.quad;
  if (rec.blend) out.blend = rec.blend.split(' ')[0];
  if (rec.bytes) out.bytes = rec.bytes;
  [rec.x1, rec.x2].forEach((file) => {
    if (!existsSync(join(OUT, file))) missing.push(`${state}: ${name} (${file})`);
  });
  return out;
};

// Per state: its look, candle and lamp, and its file. (scene2's `tones` has no nightC1Lamp: the page
// takes nightC1's there, the same candle place; reported to the picture builder.)
const states = Object.fromEntries(
  STATES.map((state) => {
    const s = scene.states[state];
    return [state, { look: s.look, candle: s.candle, lamp: Boolean(s.lamp), file: `${state}.json`, tones: scene.tones[state] ? state : state.replace(/Lamp$/, '') }];
  }),
);

// The places without the builder's own check lists (violations: empty by construction).
const places = Object.fromEntries(
  Object.entries(scene.places).map(([key, place]) => {
    const { violations, ...rest } = place;
    void violations;
    return [key, rest];
  }),
);

const { states: heldStates, metrics, ...heldGeometry } = scene.held;
const core = {
  version: 'desk-p1',
  note: 'The desk\'s production pictures (round eight run 2, prod1) as the page reads them. Written by app/scripts/desk-pictures.mjs from scene2.json; stage px at 1x; quads TL, TR, BR, BL.',
  stage: scene.stage,
  crop: scene.crop,
  surround: scene.surround,
  camera: scene.camera,
  horizonY: scene.horizonY,
  farEdgeY: scene.farEdgeY,
  frame: { opening: old.quads.frameOpening, outer: old.quads.frameOuter },
  places,
  fillOrder: scene.fillOrder,
  roomOrder: scene.roomOrder,
  drawOrder: scene.drawOrder,
  leathers: scene.leathers,
  labelOf: scene.labelOf,
  notebook: scene.notebook,
  pocket: scene.pocket,
  lamp: scene.lamp,
  candles: scene.candles,
  tones: scene.tones,
  held: { ...heldGeometry, quadError: metrics?.quad_error_css, contrast: metrics?.contrast?.oxblood },
  states,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'core.json'), JSON.stringify(core));
const sizes = [`core.json ${kb(statSync(join(OUT, 'core.json')).size)} kB`];
STATES.forEach((state) => {
  const s = scene.states[state];
  const layers = Object.fromEntries(Object.entries(s.layers).map(([name, rec]) => [name, layerOf(state, name, rec)]));
  const held = Object.fromEntries(Object.entries(heldStates[state] || {}).map(([name, rec]) => [name, layerOf(state, name, rec)]));
  writeFileSync(join(OUT, `${state}.json`), JSON.stringify({ state, layers, pairs: s.pairs, held }));
  sizes.push(`${state}.json ${kb(statSync(join(OUT, `${state}.json`)).size)} kB (${Object.keys(layers).length} layers, ${Object.keys(s.pairs).length} pairs)`);
});

const total = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? total(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
console.log(`desk pictures: ${SRC} -> ${OUT}${DATA_ONLY ? ' (data only)' : ''}`);
sizes.forEach((line) => console.log(`  ${line}`));
console.log(`  on disk: ${Math.round(total(OUT) / 1048576)} MB`);
// And the other way round: every picture on disk is named by the data (an unnamed one is a leftover).
const named = new Set();
STATES.forEach((state) => {
  Object.values(scene.states[state].layers).forEach((rec) => [rec.x1, rec.x2].forEach((f) => named.add(f)));
  Object.values(heldStates[state] || {}).forEach((rec) => [rec.x1, rec.x2].forEach((f) => named.add(f)));
});
const unnamed = STATES.flatMap((state) =>
  existsSync(join(OUT, state)) ? readdirSync(join(OUT, state)).filter((f) => f.endsWith('.webp') && !named.has(`${state}/${f}`)).map((f) => `${state}/${f}`) : [],
);
console.log(`  pictures named ${named.size}; on disk and unnamed: ${unnamed.length}${unnamed.length ? ` (${unnamed.slice(0, 6).join(', ')} ...)` : ''}`);
if (unnamed.length) process.exitCode = 1;
if (missing.length) {
  console.log(`  MISSING ${missing.length}:`);
  missing.slice(0, 40).forEach((line) => console.log(`    ${line}`));
  process.exitCode = 1;
} else console.log('  every named picture is on disk');
