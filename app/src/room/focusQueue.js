// The block a shortcut (or a fresh insert) just created, so its first field takes the caret
// when it mounts. Module-level on purpose: the block that asked is unmounting as the new one
// arrives, so no component outlives the handover.
let pending = null;

export const focusWhenMounted = (id) => {
  pending = id;
};

export const isPendingFocus = (id) => pending === id;

export const clearPendingFocus = (id) => {
  if (pending === id) pending = null;
};
