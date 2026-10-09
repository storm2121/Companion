// Which words of an edited line are new, compared with the line it was edited from: a longest
// common subsequence over whitespace-separated words. Case and punctuation count, so "mira" ->
// "Mira" and "8" -> "8." are changes — what a clean-up actually did. Pure; the lines are short.
//
// Returns the edited line as tokens that keep its spaces: [{ text, changed }].
export const changedWords = (before, after) => {
  const old = before.split(/\s+/).filter(Boolean);
  const parts = after.split(/(\s+)/).filter((part) => part !== '');
  const words = parts.filter((part) => !/^\s+$/.test(part));

  const n = old.length;
  const m = words.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = old[i] === words[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const kept = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (old[i] === words[j]) {
      kept[j] = true;
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  let word = 0;
  return parts.map((part) => {
    if (/^\s+$/.test(part)) return { text: part, changed: false };
    const changed = !kept[word];
    word += 1;
    return { text: part, changed };
  });
};

// Share of words that changed: a light clean-up marks its few words; a rewrite marks none,
// because marking every word marks nothing.
export const changedShare = (tokens) => {
  const words = tokens.filter((token) => token.text.trim());
  if (!words.length) return 0;
  return words.filter((token) => token.changed).length / words.length;
};
