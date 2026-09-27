// The modifier key this machine uses, for hints like "⌘+F" or "Ctrl-click".
// Hints only — every shortcut also has a visible button, so a wrong guess costs nothing.

const isApple =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');

export const MOD_KEY = isApple ? '⌘' : 'Ctrl';
