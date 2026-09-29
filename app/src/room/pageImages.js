// Photos on the page: how big (a share of the page's width) and how tilted they may be,
// and whether one is an upload or a web link left from before photos were uploaded.
//
// DOM-free: tests/room.unit.test.mjs loads it under Node.

export const IMAGE_MIN_SIZE = 25;
export const IMAGE_MAX_SIZE = 100;
export const IMAGE_MAX_TILT = 6;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// A size in whole percent of the page width; nothing set means the full width.
export const imageSize = (value) => clamp(Math.round(Number(value) || IMAGE_MAX_SIZE), IMAGE_MIN_SIZE, IMAGE_MAX_SIZE);

// A tilt in degrees, to one decimal, never past ±IMAGE_MAX_TILT.
export const imageTilt = (value) => Math.round(clamp(Number(value) || 0, -IMAGE_MAX_TILT, IMAGE_MAX_TILT) * 10) / 10;

// Uploaded photos live in the app's own storage; anything else is a link from before.
export const isUploadedImage = (url) => /^https:\/\/firebasestorage\.googleapis\.com\//.test(String(url || ''));
