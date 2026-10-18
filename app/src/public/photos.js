import { useSyncExternalStore } from 'react';
import { IMAGES, NOTES } from './sceneData';

// The public pages' photographs: every capture has a desktop and a phone crop, each in two sizes
// (public/images/landing, WebP). Shared by the home (MarketingExperience.jsx), its window
// (HeroWindow.jsx) and Picture.jsx.

export const PHONE = '(max-width: 719px)';
export const PHONE_SIZES = 'calc(100vw - 32px)';
export const FRAME_SIZES = '(min-width: 1180px) 820px, (min-width: 900px) calc(100vw - 400px), calc(100vw - 44px)';
export const SHOWN_SIZES = '(min-width: 1180px) 720px, (min-width: 900px) calc(100vw - 460px), calc(100vw - 88px)';

const subscribePhone = (listener) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
export const readPhone = () => window.matchMedia(PHONE).matches;
export const usePhone = () => useSyncExternalStore(subscribePhone, readPhone, () => false);

export const srcSetOf = (photo) => `${IMAGES}/${photo.src}-small.webp ${photo.width / 2}w, ${IMAGES}/${photo.src}.webp ${photo.width}w`;

// Photographs are fetched as soon as a pointer or focus reaches a way to them, so they are there
// when they are shown.
const fetched = new Set();
export const fetchPhoto = (photo, sizes) => {
  if (!photo) return;
  const phone = readPhone();
  const source = phone ? photo.phone : photo;
  if (fetched.has(source.src)) return;
  fetched.add(source.src);
  const image = new Image();
  image.sizes = phone ? PHONE_SIZES : sizes;
  image.srcset = srcSetOf(source);
  image.src = `${IMAGES}/${source.src}.webp`;
};

export const fetchNote = (view) => {
  const note = NOTES[view];
  if (!note) return;
  fetchPhoto(note.photo ?? note.moods?.candlelight, FRAME_SIZES);
  if (note.moods) fetchPhoto(note.moods.rain, FRAME_SIZES);
  fetchPhoto(note.shown.photo, SHOWN_SIZES);
};

export const fetchOn = (view) => ({
  onPointerEnter: () => fetchNote(view),
  onFocus: () => fetchNote(view),
  onTouchStart: () => fetchNote(view),
});
