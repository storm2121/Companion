import test from 'node:test';
import assert from 'node:assert/strict';
import { changedWords, changedShare } from '../src/public/wordDiff.js';

test('Sage word highlighting preserves all whitespace and marks a spelling fix', () => {
  const result = changedWords('take deliverys\tTuesday', 'take deliveries\tTuesday');
  assert.equal(result.map(token => token.text).join(''), 'take deliveries\tTuesday');
  assert.deepEqual(result.filter(token => token.changed).map(token => token.text), ['deliveries']);
});

test('Sage word highlighting distinguishes insertions from repeated words', () => {
  const result = changedWords('book a day ahead', 'book a full day ahead');
  assert.deepEqual(result.filter(token => token.changed).map(token => token.text), ['full']);
  const removal = changedWords('book a full day ahead', 'book a day ahead');
  assert.equal(removal.some(token => token.changed), false);
  assert.equal(removal.map(token => token.text).join(''), 'book a day ahead');
});

test('Sage word highlighting includes capitals and punctuation and handles an empty note', () => {
  const result = changedWords('mira says yes', 'Mira says yes.');
  assert.deepEqual(result.filter(token => token.changed).map(token => token.text), ['Mira', 'yes.']);
  assert.equal(changedShare(result), 2 / 3);
  assert.deepEqual(changedWords('', ''), []);
  assert.equal(changedShare([]), 0);
});
