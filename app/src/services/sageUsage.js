// Allowance arithmetic, client side.
//
// MIRROR of functions/lib/usage.js. The server recomputes the weight from the blocks it
// has validated, and that number is the one actually charged; this copy exists only so
// the popout can quote the price BEFORE you press Run. A unit test asserts the two agree
// on a table of inputs, because a UI that quotes 1 and charges 3 is worse than no quote
// at all.
//
// Kept free of any Firebase import on purpose: that is what lets the parity test load it
// directly under Node.

export const SAGE_WEIGHT_UNIT_CHARS = 12000;
export const SAGE_MAX_RUN_WEIGHT = 4;
const SAGE_MAX_SIZE_UNITS = 4;
const DEFAULT_DAILY_CAP = 10;

const clampWeight = (n, min, max) => Math.max(min, Math.min(n, max));

/** Total characters of authored text. Images contribute nothing — their pixels never
 *  reach the provider, only a placeholder does. */
export const sageContentChars = (blocks) =>
  (Array.isArray(blocks) ? blocks : []).reduce((total, block) => {
    if (!block || block.type === 'image') return total;
    const value = typeof block.value === 'string' ? block.value.length : 0;
    const title = typeof block.title === 'string' ? block.title.length : 0;
    return total + value + title;
  }, 0);

/** What one run will cost against the daily allowance: 1..SAGE_MAX_RUN_WEIGHT. */
export const sageRunWeight = (blocks, mode) => {
  const sizeUnits = clampWeight(
    Math.ceil(sageContentChars(blocks) / SAGE_WEIGHT_UNIT_CHARS) || 1,
    1,
    SAGE_MAX_SIZE_UNITS,
  );
  return mode === 'layout'
    ? Math.min(sizeUnits * 2, SAGE_MAX_RUN_WEIGHT)
    : Math.min(sizeUnits, SAGE_MAX_RUN_WEIGHT);
};

/** The allowance day, keyed exactly as the server keys it (UTC date). */
export const sageDayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Today's balance from the counter document, tolerant of it not existing yet.
 * A counter left over from a previous day carries only its OVERDRAFT forward — see
 * `openingCount` in functions/lib/usage.js; the rest of it is spent history.
 */
export const readSageBalance = (usage, todayKey = sageDayKey()) => {
  const cap = Number.isFinite(usage?.cap) ? usage.cap : DEFAULT_DAILY_CAP;
  const raw = Number.isFinite(usage?.count) ? usage.count : 0;
  const spent = usage?.date === todayKey ? raw : clampWeight(raw - cap, 0, cap);
  return { cap, spent, left: cap - spent, over: Math.max(0, spent - cap) };
};
