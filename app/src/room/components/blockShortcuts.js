import { Extension, InputRule } from '@tiptap/core';
import { BLOCK_SHORTCUTS } from '../shortcutPatterns';

// The room's block shortcuts (shortcutPatterns.js) as TipTap input rules. Added ON TOP of
// the shared schema by the room's rich text only — never in components/editor/extensions.js,
// which classic uses and which is frozen. Rules only: the saved HTML is exactly as before.
//
// A rule fires only in an otherwise EMPTY block (one paragraph holding just the marker) and
// only when the block's handlers say yes (`allow`); anything else falls through to TipTap's
// own rules. The marker is deleted here; the block conversion itself (`apply`) runs a tick
// later, after the editor has reported its now-empty text — so the conversion is the last
// word. The handlers live in the extension's storage, handed over by `setShortcutHandlers`.
export const RoomBlockShortcuts = Extension.create({
  name: 'roomBlockShortcuts',
  priority: 1000,

  addStorage() {
    return { handlers: null };
  },

  addInputRules() {
    return BLOCK_SHORTCUTS.map(
      ({ kind, find }) =>
        new InputRule({
          find,
          handler: ({ state, range, match }) => {
            const handlers = this.storage.handlers;
            const { doc } = state;
            // The just-typed space is not in the document yet; everything else must be the marker.
            if (doc.childCount !== 1 || doc.textContent.length !== match[0].length - 1) return null;
            if (!handlers?.allow(kind)) return null;
            state.tr.delete(range.from, range.to);
            setTimeout(() => handlers.apply(kind, match), 0);
            return undefined;
          },
        }),
    );
  },
});

// The block's current handlers ({ allow, apply }), or null for a block without shortcuts.
export const setShortcutHandlers = (editor, handlers) => {
  if (!editor || editor.isDestroyed || !editor.storage?.roomBlockShortcuts) return;
  editor.storage.roomBlockShortcuts.handlers = handlers || null;
};
