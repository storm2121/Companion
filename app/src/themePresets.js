export const THEME_DEFAULT_MODE = 'stone';

// The palettes themselves live in index.css (:root = Lamplight, html[data-theme='light']
// = Daylight) so CSS stays the single source of truth. These entries carry the ids that
// profiles already store ('stone'/'mist'), the data-theme attribute each maps to, and
// swatch colors for UI affordances.
export const THEME_PRESETS = {
  mist: {
    attr: 'light',
    bg: 'oklch(0.968 0.007 85)',
    accent: 'oklch(0.705 0.13 66)',
  },
  stone: {
    attr: 'dark',
    bg: 'oklch(0.215 0.006 78)',
    accent: 'oklch(0.8 0.125 70)',
  },
};

export const THEME_OPTIONS = [
  { id: 'stone', label: 'Lamplight', swatch: THEME_PRESETS.stone.bg },
  { id: 'mist', label: 'Daylight', swatch: THEME_PRESETS.mist.bg },
];
