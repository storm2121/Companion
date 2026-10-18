// Shared by the home's two kinds of motion: a note opening on its own page (useSceneTransition.js)
// and the desk swapping the note shown under its cards (useCardFlight.js). Both carry what was
// clicked into a note's frame on a sheet: the sheet travels from the source's place to the
// frame's (a transform) and changes size on the way (a clip-path), carrying a clipped snapshot of
// the source and the frame's photograph, each at its own size and anchored to the sheet's corner,
// so nothing is ever stretched and nothing is laid out again while it flies (springs.js boxMotion:
// four springs, x, y, width and height, each from where it is).

export const RADIUS = 18;

export const onScreen = (element) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
};

// A copy of a picture exactly where it is drawn now, placed relative to `origin`. The whole
// <picture> is cloned, so the copy chooses the same source as the original (a page that has just
// mounted has not chosen yet: its currentSrc would still be empty).
export const copyOf = (image, origin) => {
  const drawn = image.getBoundingClientRect();
  const picture = image.parentElement?.tagName === 'PICTURE' ? image.parentElement : null;
  const copy = (picture ?? image).cloneNode(true);
  const copyImage = picture ? copy.querySelector('img') : copy;
  copy.removeAttribute('class');
  copy.removeAttribute('style');
  copyImage.removeAttribute('class');
  copyImage.removeAttribute('data-photo');
  copyImage.alt = '';
  copyImage.loading = 'eager';
  Object.assign(copyImage.style, { display: 'block', width: '100%', height: '100%', maxWidth: 'none' });
  Object.assign(copy.style, {
    position: 'absolute',
    display: 'block',
    left: `${drawn.left - origin.left}px`,
    top: `${drawn.top - origin.top}px`,
    width: `${drawn.width}px`,
    height: `${drawn.height}px`,
  });
  return copy;
};

const shownImage = (element) => element?.querySelector('img[data-photo]') ?? element?.querySelector('img');

// The sheet that carries `source` (a card, the window, a ⌘K row) into `frame`. Positions are
// relative to `origin` (the layer it is drawn in: fixed to the screen, or scrolling with a tile).
//   wrap      moves (transform); its drop shadow follows the sheet's outline
//   sheet     the frame's own surface, cut to the size on show (clip-path)
//   photo     the frame's photograph, where the frame will show it
//   snapshot  a clipped copy of what the source shows, as the source shows it
//   from/to   the sheet's box { x, y, w, h }: the source's, the frame's; size: the wrap's own
export const sheetFor = ({ source, frame, origin }) => {
  const sourceView = source.getBoundingClientRect();
  const frameView = frame.getBoundingClientRect();
  const from = { x: sourceView.left - origin.left, y: sourceView.top - origin.top, w: sourceView.width, h: sourceView.height };
  const to = { x: frameView.left - origin.left, y: frameView.top - origin.top, w: frameView.width, h: frameView.height };
  const size = { w: Math.max(from.w, to.w), h: Math.max(from.h, to.h) };
  const wrap = document.createElement('div');
  wrap.className = 'mx-flight-wrap';
  Object.assign(wrap.style, { left: '0px', top: '0px', width: `${size.w}px`, height: `${size.h}px` });
  const sheet = document.createElement('div');
  sheet.className = 'mx-flight-sheet';
  sheet.style.backgroundColor = getComputedStyle(frame).backgroundColor;
  wrap.append(sheet);

  const image = shownImage(frame);
  const photo = image ? copyOf(image, { left: frameView.left, top: frameView.top }) : null;
  if (photo) sheet.append(photo);

  const snapshot = document.createElement('div');
  snapshot.className = 'mx-flight-card';
  Object.assign(snapshot.style, { left: '0px', top: '0px', width: `${from.w}px`, height: `${from.h}px` });
  const shot = shownImage(source) ?? source.closest('[data-stage]')?.querySelector('img');
  if (shot) snapshot.append(copyOf(shot, { left: sourceView.left, top: sourceView.top }));
  else snapshot.classList.add('is-plain');
  sheet.append(snapshot);

  return { wrap, sheet, snapshot, photo, from, to, size };
};
