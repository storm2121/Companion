// Get an image ready to upload: scaled down, and with its real dimensions known.
//
// Scaling: a photo straight off a phone (4000×3000, 8–12 MB) is far more than a ~300px
// board slot or an 88px avatar needs. Uploading it whole costs storage, bandwidth and a
// heavy decode every time the note opens. `createImageBitmap` decodes off the main thread
// where the browser supports it.
//
// Dimensions: the board lays photos out from their aspect ratio rather than by measuring
// the DOM (see railLayout.js), so knowing the shape at upload time means a new photo's
// frame is exactly right from its first render.
//
// Order matters to callers: prepare FIRST, validate the result second. Validating the
// original rejected any photo over the 10 MB note limit, even though it would have been
// a few hundred KB once scaled.

// The board is at most 364px wide; 1400px covers that even on a 3x screen, and a
// portrait photo at full width on a 2x one. Anything larger is bytes nobody sees.
const MAX_EDGE = 1400;
const QUALITY = 0.82;

// Every upload lives at a unique name and never changes, so it can be cached for a year
// and marked immutable: a device downloads each photo ONCE, reopening a note costs the
// server nothing, and photos still show with no connection. `private` keeps shared caches
// from storing a user's photos. Without this, Storage serves `max-age=0` and every view
// went back to the server.
export const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

// Whether this browser can ENCODE WebP (decoding is universal). Safari before 16.4 hands
// back a PNG when asked for WebP, which is why the blob's actual type is checked below.
let webpEncode = null;
const canEncodeWebp = () => {
  if (webpEncode === null) {
    try {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      webpEncode = probe.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpEncode = false;
    }
  }
  return webpEncode;
};

// Small in pixels but heavy in bytes (a PNG screenshot, say) is still worth re-encoding.
const REENCODE_ABOVE = 600 * 1024;

// Refused before decoding: decoding something this large is itself the freeze.
export const RAW_MAX_BYTES = 40 * 1024 * 1024;

// Animated GIFs lose their animation through a canvas, and SVGs have no business being
// rasterised, so both keep their original bytes. Their dimensions are still read.
const KEEP_BYTES = /^image\/(gif|svg\+xml)$/;

const decode = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

// → { file, width, height }. `width`/`height` are 0 when the image could not be decoded;
// the caller's validation then decides whether the original is acceptable at all.
export const prepareImage = async (file, maxEdge = MAX_EDGE) => {
  if (!file) throw new Error('No image to add.');
  if (file.size > RAW_MAX_BYTES) throw new Error('That image is too large to add.');

  let source;
  try {
    source = await decode(file);
  } catch {
    return { file, width: 0, height: 0 };
  }

  const width = source.width || 0;
  const height = source.height || 0;
  const scale = width && height ? Math.min(1, maxEdge / Math.max(width, height)) : 1;

  // Nothing to gain from a re-encode: keep the original bytes.
  if ((scale === 1 && file.size <= REENCODE_ABOVE) || KEEP_BYTES.test(file.type)) {
    source.close?.();
    return { file, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();

  // WebP where the browser can write it — about a quarter smaller than JPEG at the same
  // look, and it keeps transparency, so it serves PNGs too. Otherwise PNG stays PNG.
  const wanted = canEncodeWebp() ? 'image/webp' : file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, wanted, QUALITY));
  if (!blob || blob.size >= file.size) return { file, width, height };

  const type = blob.type || wanted;
  const extension = { 'image/webp': '.webp', 'image/png': '.png' }[type] || '.jpg';
  const name = file.name.replace(/\.[^.]+$/, '') + extension;
  return {
    file: new File([blob], name, { type, lastModified: Date.now() }),
    width: canvas.width,
    height: canvas.height,
  };
};

// Aspect ratio as stored on a board photo — rounded, so float noise never reads as a change.
export const aspectOf = (width, height) =>
  width > 0 && height > 0 ? Math.round((width / height) * 1000) / 1000 : undefined;
