import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
export { sanitizeSageLayout } from './sageLayout';

export const SAGE_STYLES = [
  { id: 'polish', label: 'Polish', hint: 'Fix typos & grammar, keep my words' },
  { id: 'restructure', label: 'Restructure', hint: 'Reorganize into a clean layout' },
  { id: 'examples', label: 'Add examples', hint: 'Concrete examples after each concept' },
  { id: 'simplify', label: 'Simplify', hint: 'Plain language, shorter sentences' },
];

// Optional add-ons the Customize popout can stack on a base style (ids match the
// ADDON_INSTRUCTIONS map in functions/index.js).
export const SAGE_ADDONS = [
  { id: 'fillGaps', label: 'Complete missing info', hint: 'Fill gaps the note skips over' },
  { id: 'deepen', label: 'Go deeper', hint: 'More detail, consequences, edge cases' },
  { id: 'tldr', label: 'TL;DR on top', hint: 'Summary block first' },
  { id: 'glossary', label: 'Key-terms glossary', hint: 'Term — definition list at the end' },
];

const PRIVATE_IMAGE_VALUE = '[private image omitted]';

export const callSageImprove = async ({ styleId, noteTitle, blocks, canvasHeight, addons = [], topic = '' }) => {
  const fn = httpsCallable(functions, 'sageImprove', { timeout: 300000 });
  const payloadBlocks = blocks.map((b) => ({
    id: b.id,
    type: b.type,
    title: b.title || '',
    // The provider only needs image geometry; never send bearer-style Storage URLs.
    value: b.type === 'image' ? PRIVATE_IMAGE_VALUE : b.value || '',
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
  }));
  const res = await fn({ styleId, noteTitle, blocks: payloadBlocks, canvasHeight, addons, topic });
  return res.data;
};

// Serif-italic status lines for the thinking panel.
export const SAGE_PHRASES = {
  polish: ['Reading your note…', 'Dusting off the typos…', 'Straightening punctuation…'],
  restructure: [
    'Reading your note…',
    'Finding the through-line…',
    'Measuring the grid…',
    'Placing blocks by the numbers…',
  ],
  examples: ['Reading your note…', 'Thinking of good examples…', 'Weaving them in…'],
  simplify: ['Reading your note…', 'Untangling the long sentences…', 'Making it breathe…'],
};
