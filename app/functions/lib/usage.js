// Sage allowance arithmetic — the pure part, kept out of index.js so it can be unit
// tested without booting firebase-admin.
//
// `src/services/sage.js` mirrors `sageRunWeight` so the popout can show what a run will
// cost BEFORE you press it. The two are duplicated on purpose (the server is CommonJS,
// the client is an ESM bundle, and neither can import the other), and a unit test asserts
// they agree on a table of inputs so they cannot drift. The server's answer is always the
// one that gets charged.

// One "unit" of allowance is about this much note. Twelve thousand characters is roughly a
// 1,800-word note — a normal lecture's worth — so an ordinary note costs exactly 1 and the
// cap reads as "10 notes a day".
const WEIGHT_UNIT_CHARS = 12000;
// Nothing may cost more than this, however big the note or heavy the mode. It is also
// what bounds the overdraft below: the most anyone can end a day owing.
const MAX_RUN_WEIGHT = 4;
const MAX_SIZE_UNITS = 4;

const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

/** Total characters of authored text in a set of blocks. Images contribute nothing —
 *  their pixels never reach the provider, only a placeholder does. */
const sageContentChars = (blocks) =>
  (Array.isArray(blocks) ? blocks : []).reduce((total, block) => {
    if (!block || block.type === 'image') return total;
    const value = typeof block.value === 'string' ? block.value.length : 0;
    const title = typeof block.title === 'string' ? block.title.length : 0;
    return total + value + title;
  }, 0);

/**
 * What one run costs against the daily allowance.
 *
 * Size drives it, because size drives both halves of the provider bill — a longer note is
 * more tokens in AND more tokens back. A full rebuild doubles it: that mode is the only
 * one that re-emits every block, and it gets three times the output budget.
 *
 * @param {Array} blocks the note's blocks
 * @param {'patch'|'reflow'|'layout'} mode the run mode the server picked
 * @returns {number} 1..MAX_RUN_WEIGHT
 */
const sageRunWeight = (blocks, mode) => {
  const sizeUnits = clamp(Math.ceil(sageContentChars(blocks) / WEIGHT_UNIT_CHARS) || 1, 1, MAX_SIZE_UNITS);
  return mode === 'layout' ? Math.min(sizeUnits * 2, MAX_RUN_WEIGHT) : Math.min(sizeUnits, MAX_RUN_WEIGHT);
};

/**
 * Where a counter starts on a given day, carrying yesterday's overdraft as debt.
 *
 * Overspend is BORROWED, never free: end a day 3 over and tomorrow opens at 3, so the
 * long-run average is exactly `cap` per day no matter how the runs are shaped. The debt
 * is itself capped at `cap`, so a single huge run can cost you at most one full day —
 * never a lockout that compounds.
 */
const openingCount = (usage, today, cap) => {
  if (!usage || typeof usage !== 'object') return 0;
  const count = Number.isFinite(usage.count) ? usage.count : 0;
  if (usage.date === today) return count;
  return clamp(count - cap, 0, cap);
};

/**
 * Decide a single charge against an allowance.
 *
 * `allowOverdraft` is the per-user allowance: it refuses only once you have actually spent
 * your allowance, so a 3-unit note never gets blocked for being 1 short — you go over and
 * repay it tomorrow. Being told "this costs 3, you have 2, come back tomorrow" is the kind
 * of arithmetic that makes a tool feel hostile.
 *
 * Without it (the app-wide counter, and deletes) the charge must fit, because that ceiling
 * is protecting the bill rather than being fair to one person.
 *
 * @returns {{blocked: boolean, count: number, opening: number, remaining: number}}
 */
const applyCharge = ({ usage, today, cap, weight = 1, allowOverdraft = false }) => {
  const opening = openingCount(usage, today, cap);
  const blocked = allowOverdraft ? opening >= cap : opening + weight > cap;
  const count = blocked ? opening : opening + weight;
  return { blocked, count, opening, remaining: Math.max(0, cap - count) };
};

module.exports = {
  WEIGHT_UNIT_CHARS,
  MAX_RUN_WEIGHT,
  MAX_SIZE_UNITS,
  sageContentChars,
  sageRunWeight,
  openingCount,
  applyCharge,
};
