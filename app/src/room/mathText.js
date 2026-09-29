// A math block's text, as KaTeX needs it.
//
// DOM-free: tests/room.unit.test.mjs loads it under Node.

// The rows a math block shows: one formula per line — except that an environment
// (\begin{aligned} … \end{aligned}, cases, matrices) keeps together however many lines it
// was written over, since KaTeX can only render it whole.
export const formulaRows = (tex) => {
  const rows = [];
  let open = [];
  let depth = 0;
  String(tex || '')
    .split('\n')
    .forEach((line) => {
      if (!line.trim()) return;
      open.push(line);
      depth += (line.match(/\\begin\{/g) || []).length - (line.match(/\\end\{/g) || []).length;
      if (depth <= 0) {
        rows.push(open.join('\n'));
        open = [];
        depth = 0;
      }
    });
  // An environment never closed is still shown, as written, rather than dropped.
  if (open.length) rows.push(open.join('\n'));
  return rows;
};

// LaTeX that came back through JSON written with single backslashes: the commands that
// turned into control characters (\f in \frac, \t in \times or \text, \b in \beta, \r in
// \rho) are put back, and $ / \[ \] / \( \) delimiters around a line are taken off. The same
// repair runs on the server (functions/lib/pageSage.js `cleanTex`); this one also covers
// answers from a server that predates it.
const CONTROL_TO_LATEX = { '\b': '\\b', '\f': '\\f', '\t': '\\t', '\r': '\\r', '\v': '\\v' };
// \n is also a real line break between formulas, so only the commands it could only be.
const NEWLINE_COMMAND =
  /\n(?=(?:abla|eq|eg|otin|ot|mid|leq|geq|parallel|exists|subseteq|supseteq|leftarrow|rightarrow|Leftarrow|Rightarrow|cong|sim|prec|succ|ewline)(?![a-z]))/g;

// Only the commands back — BEFORE anything trims: \f, \t and \r are whitespace to trim(),
// so a formula opening with \frac would lose its \f and become "rac{…}".
export const restoreTex = (value) =>
  String(value || '')
    .replace(NEWLINE_COMMAND, '\\n')
    .replace(/[\b\f\t\r\v]/g, (c) => CONTROL_TO_LATEX[c]);

export const cleanTex = (value) =>
  restoreTex(value)
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^\$\$?\s*|\s*\$\$?$/g, '')
        .replace(/^\\\[\s*|\s*\\\]$/g, '')
        .replace(/^\\\(\s*|\s*\\\)$/g, ''),
    )
    .filter(Boolean)
    .join('\n');
