import test from 'node:test';
import assert from 'node:assert/strict';
import { MOOD_CHOICES, clockText, isChoice, isDaytime, moodAt, statusText } from '../src/public/windowMood.js';
import { CREATE_GROUP, buildFindIndex, findRows } from '../src/public/findIndex.js';
import { RAIN_MIX, RAMP, rainMix } from '../src/public/rainMix.js';

const at = (hours, minutes = 0) => new Date(2026, 9, 18, hours, minutes);

// ── The window follows the visitor's clock, as the app does ────────────────────────────────

test('the window is Rain from 06:00 until 18:00, Candlelight otherwise (the room’s own rule)', () => {
  assert.equal(moodAt('auto', at(5, 59)), 'candlelight');
  assert.equal(moodAt('auto', at(6, 0)), 'rain');
  assert.equal(moodAt('auto', at(14, 32)), 'rain');
  assert.equal(moodAt('auto', at(17, 59)), 'rain');
  assert.equal(moodAt('auto', at(18, 0)), 'candlelight');
  assert.equal(moodAt('auto', at(0, 25)), 'candlelight');
  assert.equal(isDaytime(at(12)), true);
  assert.equal(isDaytime(at(23)), false);
});

test('a room picked on the window overrides the clock; anything unknown follows it', () => {
  assert.equal(moodAt('rain', at(23, 0)), 'rain');
  assert.equal(moodAt('candlelight', at(12, 0)), 'candlelight');
  assert.equal(moodAt('lamp', at(12, 0)), 'rain');
  assert.equal(moodAt(undefined, at(21, 0)), 'candlelight');
  assert.deepEqual(MOOD_CHOICES.map((choice) => choice.id), ['auto', 'rain', 'candlelight']);
  assert.equal(isChoice('auto'), true);
  assert.equal(isChoice('day'), false);
});

test('the top line writes the time as the app does: 24-hour, two digits', () => {
  assert.equal(clockText(at(9, 5)), '09:05');
  assert.equal(clockText(at(0, 0)), '00:00');
  assert.equal(clockText(at(23, 59)), '23:59');
  assert.equal(statusText('rain', at(14, 32)), 'Rain · 14:32');
  assert.equal(statusText('candlelight', at(21, 7)), 'Candlelight · 21:07');
});

// ── ⌘K on the home, over the room's own search ─────────────────────────────────────────────

const INDEX = buildFindIndex({
  notes: [
    {
      id: 'weekend-list',
      title: 'Weekend list',
      group: 'Everyday',
      tags: ['at-home'],
      path: '/desk/weekend-list',
      body: ['Saturday morning', 'Pick up coffee on the way to the market. The bike shop opens at ten.', 'Back up the photos'],
    },
    {
      id: 'harbor-review',
      title: 'Harbor review',
      group: 'Working Notes',
      tags: ['decisions', 'next-steps'],
      path: '/desk/harbor-review',
      body: ['Tuesday’s review', 'Keep the pilot to two sites.', 'Confirm the delivery windows'],
    },
    {
      id: 'sampling-notes',
      title: 'Sampling notes',
      group: 'Systems & Signals',
      tags: ['week-03'],
      path: '/desk/sampling-notes',
      body: [
        'From a wave to a sequence',
        'Remember: A faster-looking pattern can become a slower one when the sampling rate is too low. That ambiguity is aliasing.',
        'What to check',
      ],
    },
    {
      id: 'call-with-mira',
      title: 'Call with Mira — north site',
      group: 'Working Notes',
      tags: ['field-team'],
      path: '/sage',
      body: ['loading door is 2.4m high. anything taller goes thru the yard gate'],
    },
  ],
  groups: ['Everyday', 'Working Notes', 'Systems & Signals'],
});

test('⌘K finds a note by any word in it, with the words around it from that line only', () => {
  const rows = findRows(INDEX, 'aliasing', { mood: 'rain' });
  assert.equal(rows[0].kind, 'note');
  assert.equal(rows[0].label, 'Sampling notes');
  assert.equal(rows[0].hint, 'Systems & Signals');
  assert.equal(rows[0].path, '/desk/sampling-notes');
  assert.equal(rows[0].snippet.match, 'aliasing');
  assert.match(rows[0].snippet.before, /ambiguity is $/);
  assert.doesNotMatch(rows[0].snippet.after, /What to check/);
  assert.doesNotMatch(rows[0].snippet.before, /¶/);
  // What was typed can always become a note, last on the list.
  assert.equal(rows.at(-1).label, 'New note “aliasing”');
  assert.equal(rows.at(-1).hint, CREATE_GROUP);
  assert.equal(rows.at(-1).kind, 'inert');
});

test('⌘K folds case and accents, and ranks a title before a word in the text', () => {
  assert.equal(findRows(INDEX, 'ALIASÍNG')[0].label, 'Sampling notes');
  const review = findRows(INDEX, 'review');
  assert.equal(review[0].label, 'Harbor review');
  assert.equal(review[0].snippet, null);
});

test('⌘K changes the room, never offering the one already on show', () => {
  const day = findRows(INDEX, 'switch', { mood: 'rain' });
  assert.deepEqual(day.filter((row) => row.kind === 'mood').map((row) => row.mood), ['candlelight']);
  const night = findRows(INDEX, 'sw ra', { mood: 'candlelight' });
  assert.equal(night[0].label, 'Switch to Rain');
  assert.equal(night[0].mood, 'rain');
  // Naming an action plainly does not offer a note by that name.
  assert.equal(night.some((row) => row.label.startsWith('New note')), false);
  // A word only in an action's keywords still finds it, after the notes.
  assert.ok(findRows(INDEX, 'night', { mood: 'rain' }).some((row) => row.label === 'Switch to Candlelight'));
});

test('⌘K adds an event only in words, and tags find their notes', () => {
  const event = findRows(INDEX, 'add an event')[0];
  assert.equal(event.label, 'Add an event');
  assert.equal(event.kind, 'inert');
  assert.match(event.says, /your own desk/);
  const tagged = findRows(INDEX, '#field');
  assert.deepEqual(tagged.map((row) => row.label), ['Call with Mira — north site']);
  assert.equal(tagged[0].hint, '#field-team');
  assert.equal(tagged[0].path, '/sage');
});

test('⌘K with nothing typed shows the desk and the other room; never more than the limit', () => {
  const idle = findRows(INDEX, '   ', { mood: 'candlelight' });
  assert.deepEqual(idle.map((row) => row.label), ['Weekend list', 'Harbor review', 'Sampling notes', 'Call with Mira — north site', 'Switch to Rain']);
  assert.equal(findRows(INDEX, 'e', { limit: 3 }).length <= 3, true);
  assert.deepEqual(findRows(INDEX, 'zzzz').map((row) => row.kind), ['inert']);
  assert.ok(findRows(INDEX, 'Everyday').some((row) => row.kind === 'group' && row.path === '/desk'));
});

// ── The rain, heard ────────────────────────────────────────────────────────────────────────

test('rain by day is fuller and brighter than candlelight’s drizzle', () => {
  const day = rainMix('rain');
  const night = rainMix('candlelight');
  for (const key of ['bed', 'hiss', 'drops', 'tone', 'rate']) assert.ok(day[key] > night[key], key);
  assert.equal(RAMP, 0.4);
});

test('the mix stays within 0–1 and anything unknown reads as rain', () => {
  assert.deepEqual(rainMix('lamp'), rainMix('rain'));
  const quiet = rainMix('rain', 0.5);
  assert.equal(quiet.bed, RAIN_MIX.rain.bed / 2);
  assert.equal(quiet.tone, RAIN_MIX.rain.tone);
  const loud = rainMix('rain', 9);
  for (const key of ['bed', 'hiss', 'drops']) assert.ok(loud[key] <= 1 && loud[key] >= 0);
  assert.equal(rainMix('candlelight', 0).bed, 0);
});
