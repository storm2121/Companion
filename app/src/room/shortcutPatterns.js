// Markdown-style shortcuts that turn an EMPTY text block into one of the room's own blocks.
// Typed at the very start of the block and finished with a space:
//
//   ```  (or ```python)  → a code block          $$  → a math block
//   >>                   → a callout             ||  → two columns
//   §                    → the block starts (or stops starting) a section
//   ---                  → the block starts a section — the room's divider. No space
//                          needed: like Markdown's rule, it fires on the third dash
//
// TipTap's shortcuts keep working exactly as before — # ## ### for headings, - and 1. for
// lists, [ ] for a checklist, **bold**, *italic*, ~~strike~~, `code`, ==highlight==, > for
// a quote — and --- is still a rule anywhere but an empty block. These only add what TipTap
// does not have. (Many keyboards have no § key; --- is the one everybody can type.)
//
// DOM-free: tests/room.unit.test.mjs loads it under Node.

export const BLOCK_SHORTCUTS = [
  { kind: 'code', find: /^```([a-z0-9+#.-]*)\s$/i },
  { kind: 'math', find: /^\$\$\s$/ },
  { kind: 'callout', find: /^>>\s$/ },
  { kind: 'columns', find: /^\|\|\s$/ },
  { kind: 'section', find: /^§\s$/ },
  { kind: 'divider', find: /^---$/ },
];

// The shortcut a line of text (ending in the character just typed) asks for, if any.
export const shortcutFor = (text) => {
  for (const shortcut of BLOCK_SHORTCUTS) {
    const match = shortcut.find.exec(String(text || ''));
    if (match) return { kind: shortcut.kind, match };
  }
  return null;
};

// Shown in the + menu beside each block type, so the shortcut is discoverable.
export const SHORTCUT_HINTS = {
  code: '```',
  math: '$$',
  callout: '>>',
  twoColumn: '||',
  checklist: '[ ]',
};
