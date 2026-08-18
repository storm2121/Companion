import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
export { sanitizeSageLayout } from './sageLayout';

// Goals are MULTI-SELECT: each one is a distinct, composable job (ids match
// STYLE_INSTRUCTIONS in functions/index.js — the server merges the selected set).
export const SAGE_STYLES = [
  { id: 'polish', label: 'Fix mistakes', hint: 'Typos, grammar, punctuation — your wording stays' },
  { id: 'simplify', label: 'Simplify wording', hint: 'Rewrites long sentences in plain language' },
  { id: 'examples', label: 'Add examples', hint: 'A concrete example after each concept' },
  { id: 'restructure', label: 'Restructure layout', hint: 'Rebuilds blocks & columns into a clean study sheet' },
];

// Optional add-ons stacked on the goals (ids match ADDON_INSTRUCTIONS in functions/index.js).
export const SAGE_ADDONS = [
  { id: 'fillGaps', label: 'Complete missing info', hint: 'Fill gaps the note skips over' },
  { id: 'deepen', label: 'Go deeper', hint: 'More detail, consequences, edge cases' },
  { id: 'tldr', label: 'TL;DR on top', hint: 'Summary block first' },
  { id: 'glossary', label: 'Key-terms glossary', hint: 'Term — definition list at the end' },
  { id: 'questions', label: 'Self-test questions', hint: '3-5 questions block at the end' },
  { id: 'emphasize', label: 'Highlight key points', hint: 'Bolds the one crucial line per idea' },
  { id: 'mnemonics', label: 'Memory hooks', hint: 'Mnemonics for hard-to-remember lists' },
];

const PRIVATE_IMAGE_VALUE = '[private image omitted]';

export const callSageImprove = async ({
  styles = [],
  noteTitle,
  blocks,
  canvasHeight,
  addons = [],
  topic = '',
  comment = '',
}) => {
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
  // styleId rides along for backward compatibility: an older deployed function that
  // predates multi-select goals still runs the first goal instead of erroring.
  const res = await fn({
    styles,
    styleId: styles[0] || 'polish',
    noteTitle,
    blocks: payloadBlocks,
    canvasHeight,
    addons,
    topic,
    comment,
  });
  return res.data;
};

// Serif-italic status lines for the thinking panel, keyed by the FIRST selected goal
// (`default` covers add-on-only runs and unknown keys).
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
  default: ['Reading your note…', 'Gathering the good ideas…', 'Working on it…'],
};
