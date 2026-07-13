const GRID = { bandX: 660, bandRight: 1740, x0: 822, fullW: 756, gutter: 20, topY: 56 };
const SAFE_BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;

const createBlockId = () =>
  globalThis.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Defense in depth for the provider response: retain only canonical fields, preserve
// private images from trusted local state, and ensure every persisted id is unique/safe.
export const sanitizeSageLayout = (aiBlocks, originalBlocks) => {
  const originalsById = new Map(originalBlocks.map((block) => [block.id, block]));
  const usedIds = new Set();
  const cleaned = [];
  (Array.isArray(aiBlocks) ? aiBlocks : []).forEach((block) => {
    if (!block || (block.type !== 'text' && block.type !== 'image')) return;
    const original = typeof block.id === 'string' ? originalsById.get(block.id) : null;
    const isImage = block.type === 'image';
    if (isImage && (!original || original.type !== 'image' || usedIds.has(original.id))) return;

    const canReuseId =
      original &&
      original.type === block.type &&
      SAFE_BLOCK_ID.test(original.id) &&
      !usedIds.has(original.id);
    let id = canReuseId ? original.id : createBlockId();
    while (usedIds.has(id) || !SAFE_BLOCK_ID.test(id)) id = createBlockId();
    usedIds.add(id);

    const value = isImage ? original.value : typeof block.value === 'string' ? block.value.slice(0, 60000) : '';
    let w = isImage ? original.w : Math.round(Number(block.w) || GRID.fullW);
    let h = isImage ? original.h : Math.round(Number(block.h) || 240);
    w = Math.max(160, Math.min(w, GRID.fullW * 2));
    h = Math.max(140, Math.min(h, 1400));
    let x = Math.round(Number(block.x));
    let y = Math.round(Number(block.y));
    if (!Number.isFinite(x)) x = GRID.x0;
    if (!Number.isFinite(y)) y = GRID.topY;
    x = Math.max(GRID.bandX, Math.min(x, GRID.bandRight - Math.min(w, GRID.fullW)));
    y = Math.max(GRID.topY, y);
    cleaned.push({
      id,
      type: block.type,
      title: typeof block.title === 'string' ? block.title.slice(0, 120) : '',
      value,
      x,
      y,
      w,
      h,
    });
  });
  if (!cleaned.length) return null;

  cleaned.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < cleaned.length; i += 1) {
    const cur = cleaned[i];
    let moved = true;
    while (moved) {
      moved = false;
      for (let j = 0; j < i; j += 1) {
        const prev = cleaned[j];
        const overlapX = cur.x < prev.x + prev.w + GRID.gutter && prev.x < cur.x + cur.w + GRID.gutter;
        const overlapY = cur.y < prev.y + prev.h + GRID.gutter && prev.y < cur.y + cur.h + GRID.gutter;
        if (overlapX && overlapY) {
          cur.y = prev.y + prev.h + GRID.gutter;
          moved = true;
        }
      }
    }
  }
  const maxBottom = cleaned.reduce((max, block) => Math.max(max, block.y + block.h), 0);
  return { blocks: cleaned, canvasHeight: Math.max(720, maxBottom + 120) };
};
