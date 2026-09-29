import { useEffect, useRef } from 'react';
import { formulaRows } from '../mathText';

// A formula, typeset. KaTeX (and its stylesheet and fonts) load the first time any math is
// shown — only inside the room's editor, so nothing else ever downloads them. Fonts are
// bundled with the app, so the site's CSP (font-src 'self') is enough.
//
// The element has no React children: its content is written here, first as the plain
// source (while KaTeX loads, or if it cannot), then as KaTeX's output. One line of source
// is one displayed line — except an environment written over several lines, which stays
// one formula (mathText.js). `trust: false` keeps \href and friends out.

let katexLoading = null;
const loadKatex = () => {
  katexLoading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([mod]) => mod.default || mod,
  );
  return katexLoading;
};

const OPTIONS = {
  displayMode: true,
  throwOnError: false,
  errorColor: '#c9792f',
  strict: 'ignore',
  trust: false,
  output: 'html',
};

const MathView = ({ tex, className = '', placeholder = '' }) => {
  const ref = useRef(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const lines = formulaRows(tex);
    if (!lines.length) {
      host.textContent = placeholder;
      host.classList.add('is-empty');
      return undefined;
    }
    host.classList.remove('is-empty');
    host.textContent = lines.join('\n');
    let alive = true;
    loadKatex()
      .then((katex) => {
        if (!alive) return;
        host.replaceChildren(
          ...lines.map((line) => {
            const row = document.createElement('div');
            katex.render(line, row, OPTIONS);
            return row;
          }),
        );
      })
      .catch(() => {
        // Offline and never loaded: the source stays readable as it is.
      });
    return () => {
      alive = false;
    };
  }, [tex, placeholder]);

  return <div ref={ref} className={`room-math-view ${className}`.trim()} />;
};

export default MathView;
