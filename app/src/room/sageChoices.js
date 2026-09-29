// What Sage can be asked to do in the room, in the room's words. The ids are the server's
// (functions/lib/pageSage.js — GOALS, EXTRAS, VOICES); the goals and most extras share
// their ids with classic's, so a server without the page path still understands them.

export const SAGE_GOALS = [
  { id: 'polish', label: 'Clean it up', hint: 'Typos, grammar, punctuation. Your words stay yours.' },
  { id: 'simplify', label: 'Make it clearer', hint: 'Tangled sentences, said plainly' },
  { id: 'examples', label: 'Explain more', hint: 'The why, the skipped step, an example right where it helps' },
  { id: 'restructure', label: 'Study sheet', hint: 'Rebuilt: sections, key terms side by side, formulas typeset' },
];

export const SAGE_EXTRAS = [
  { id: 'tldr', label: 'TL;DR on top', hint: 'Three to five bullets that carry the note' },
  { id: 'formulas', label: 'Typeset formulas', hint: 'Formulas written as text become math blocks' },
  { id: 'glossary', label: 'Key terms', hint: 'Term — definition, at the end' },
  { id: 'questions', label: 'Quiz me', hint: 'Three to five questions to test yourself, at the end' },
  { id: 'todos', label: 'To-do list', hint: 'Deadlines and “review this” gathered into a checklist' },
  { id: 'emphasize', label: 'Highlight', hint: 'The one phrase per idea worth remembering' },
  { id: 'mnemonics', label: 'Memory hooks', hint: 'For the lists that refuse to stick' },
  { id: 'deepen', label: 'Go deeper', hint: 'Consequences, edge cases, the why behind the facts' },
];

// The extras a server without the page path knows (classic's ADDON_INSTRUCTIONS).
export const CLASSIC_ADDONS = ['tldr', 'glossary', 'questions', 'emphasize', 'mnemonics', 'deepen', 'fillGaps'];

// How Sage talks in the note it leaves you. The work itself is the same in every voice.
export const SAGE_VOICES = [
  { id: 'buddy', label: 'Study buddy', hint: 'Warm, a little playful', line: 'Talks like a study buddy' },
  { id: 'coach', label: 'Coach', hint: 'Direct — and tells you what to practise next', line: 'Talks like a coach' },
  { id: 'quiet', label: 'Just the facts', hint: 'One plain line about what changed', line: 'Keeps it short' },
];

// What the Run pill says while Sage works, keyed by the goal that leads the run.
export const SAGE_PHRASES = {
  polish: ['Reading your note…', 'Hunting typos…', 'Negotiating with commas…', 'Putting capitals back…'],
  simplify: ['Reading your note…', 'Untangling sentences…', 'Cutting the fluff…', 'Translating lecture-speak…'],
  examples: ['Reading your note…', 'Asking “but why?”…', 'Finding a good example…', 'Filling the skipped steps…'],
  restructure: [
    'Reading the whole thing…',
    'Finding the through-line…',
    'Sorting ideas into sections…',
    'Lining up key terms…',
    'Typesetting formulas…',
  ],
  default: ['Reading your note…', 'Thinking it over…', 'Almost there…'],
};
