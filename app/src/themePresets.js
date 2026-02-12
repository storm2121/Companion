export const THEME_DEFAULT_MODE = 'stone';

export const THEME_PRESETS = {
  mist: {
    bg: '#eceff2',
    surface1: '#e5e9ee',
    surface2: '#dfe4ea',
    surface3: '#d5dce4',
    border: 'rgba(0, 0, 0, 0.08)',
    text: '#1b232b',
    textSecondary: '#3f4a55',
    textMuted: '#5b6670',
    accent: '#7b6741',
    accentHover: '#8a7550',
    accentPressed: '#6b5837',
    scrollTrack: 'rgba(191, 200, 209, 0.74)',
    scrollTrackAlt: 'rgba(206, 214, 223, 0.9)',
    scrollThumb: 'rgba(122, 132, 143, 0.74)',
    scrollThumbAlt: 'rgba(154, 164, 174, 0.8)',
    scrollThumbHover: 'rgba(103, 113, 124, 0.9)',
    scrollThumbHoverAlt: 'rgba(137, 147, 157, 0.94)',
    scrollThumbBorder: 'rgba(232, 237, 242, 0.95)',
  },
  stone: {
    bg: '#2a2e33',
    surface1: '#31363c',
    surface2: '#3a4148',
    surface3: '#434c55',
    border: 'rgba(255, 255, 255, 0.1)',
    text: '#f0f2f4',
    textSecondary: '#c8ced6',
    textMuted: '#a1a9b2',
    accent: '#c8a46a',
    accentHover: '#d6b57a',
    accentPressed: '#b89255',
    scrollTrack: 'rgba(31, 36, 43, 0.9)',
    scrollTrackAlt: 'rgba(43, 49, 58, 0.94)',
    scrollThumb: 'rgba(122, 132, 145, 0.72)',
    scrollThumbAlt: 'rgba(150, 160, 171, 0.8)',
    scrollThumbHover: 'rgba(145, 155, 167, 0.9)',
    scrollThumbHoverAlt: 'rgba(173, 182, 191, 0.95)',
    scrollThumbBorder: 'rgba(28, 33, 40, 0.95)',
  },
};

export const THEME_OPTIONS = [
  { id: 'stone', label: 'Stone', swatch: THEME_PRESETS.stone.bg },
  { id: 'mist', label: 'Mist', swatch: THEME_PRESETS.mist.bg },
];
