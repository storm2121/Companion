// Shared by the home's two kinds of motion: a note opening on its own page (useSceneTransition.js)
// and the desk swapping the note shown under its cards (useCardFlight.js). Both carry what was
// clicked into a note's frame on a sheet that only changes shape: the pictures on it keep their
// own size, so nothing is ever stretched.

export const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
export const FADE = 'cubic-bezier(0.4, 0, 0.6, 1)';

export const onScreen = (element) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
};

export const box = (rect) => ({
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
});

// A copy of a picture exactly where it is drawn now, placed relative to `rect`. The whole
// <picture> is cloned, so the copy chooses the same source as the original (a page that has just
// mounted has not chosen yet: its currentSrc would still be empty).
export const copyOf = (image, rect) => {
  const drawn = image.getBoundingClientRect();
  const picture = image.parentElement?.tagName === 'PICTURE' ? image.parentElement : null;
  const copy = (picture ?? image).cloneNode(true);
  const copyImage = picture ? copy.querySelector('img') : copy;
  copy.removeAttribute('class');
  copyImage.removeAttribute('class');
  copyImage.removeAttribute('data-photo');
  copyImage.alt = '';
  copyImage.loading = 'eager';
  Object.assign(copyImage.style, { display: 'block', width: '100%', height: '100%', maxWidth: 'none' });
  Object.assign(copy.style, {
    position: 'absolute',
    display: 'block',
    left: `${drawn.left - rect.left}px`,
    top: `${drawn.top - rect.top}px`,
    width: `${drawn.width}px`,
    height: `${drawn.height}px`,
  });
  return copy;
};

// The sheet that carries `source` (a card, a preview) into `frame`: the frame's own surface, a
// clipped snapshot of the source, and the frame's photograph. Positions are relative to `origin`
// (the layer the sheet is drawn in), so the sheet can live in a fixed or a scrolling layer.
export const sheetFor = ({ source, frame, origin }) => {
  const relative = (rect) => ({
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  });
  const sourceRect = source.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const surface = getComputedStyle(frame);
  const sheet = document.createElement('div');
  sheet.className = 'mx-flight-sheet';
  sheet.style.backgroundColor = surface.backgroundColor;
  sheet.style.boxShadow = `inset 0 0 0 1px ${surface.borderTopColor}`;
  const photo = frame.querySelector('img[data-photo]') ?? frame.querySelector('img');
  const photoCopy = photo ? copyOf(photo, frameRect) : null;
  if (photoCopy) sheet.append(photoCopy);
  const shot = source.querySelector('img') ?? source.closest('[data-stage]')?.querySelector('img');
  const snapshot = document.createElement('div');
  snapshot.className = 'mx-flight-card';
  Object.assign(snapshot.style, { width: `${sourceRect.width}px`, height: `${sourceRect.height}px` });
  if (shot) snapshot.append(copyOf(shot, sourceRect));
  sheet.append(snapshot);
  return { sheet, snapshot, photoCopy, from: box(relative(sourceRect)), to: box(relative(frameRect)) };
};
