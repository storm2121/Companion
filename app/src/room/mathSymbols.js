// The math toolbar's contents. Four small groups, one shown at a time — enough to write a
// lecture's formulas without a wall of buttons. Each item inserts LaTeX (KaTeX renders it).
//
// In a snippet, `#` marks a slot. The first slot takes whatever was selected (so selecting
// "a+b" and pressing Fraction gives \frac{a+b}{}); the caret lands in the first EMPTY slot.
//
// DOM-free: tests/room.unit.test.mjs loads it under Node.

export const MATH_GROUPS = [
  {
    id: 'build',
    label: 'Build',
    items: [
      { label: 'a⁄b', tex: '\\frac{#}{#}', title: 'Fraction' },
      { label: 'x²', tex: '^{#}', title: 'Power' },
      { label: 'x₂', tex: '_{#}', title: 'Subscript' },
      { label: '√', tex: '\\sqrt{#}', title: 'Square root' },
      { label: 'ⁿ√', tex: '\\sqrt[#]{#}', title: 'Root' },
      { label: 'Σ', tex: '\\sum_{#}^{#} ', title: 'Sum' },
      { label: '∫', tex: '\\int_{#}^{#} ', title: 'Integral' },
      { label: 'lim', tex: '\\lim_{# \\to #} ', title: 'Limit' },
      { label: '( )', tex: '\\left( # \\right)', title: 'Brackets that grow' },
      { label: '[⋮]', tex: '\\begin{bmatrix} # & # \\\\ # & # \\end{bmatrix}', title: 'Matrix' },
      { label: 'x̄', tex: '\\overline{#}', title: 'Bar' },
      { label: 'v⃗', tex: '\\vec{#}', title: 'Vector' },
    ],
  },
  {
    id: 'greek',
    label: 'Greek',
    items: [
      ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'],
      ['θ', 'theta'], ['λ', 'lambda'], ['μ', 'mu'], ['π', 'pi'], ['ρ', 'rho'],
      ['σ', 'sigma'], ['φ', 'phi'], ['ω', 'omega'], ['Δ', 'Delta'], ['Σ', 'Sigma'], ['Ω', 'Omega'],
    ].map(([label, name]) => ({ label, tex: `\\${name} `, title: name })),
  },
  {
    id: 'symbols',
    label: 'Symbols',
    items: [
      ['±', 'pm', 'Plus or minus'], ['×', 'times', 'Times'], ['÷', 'div', 'Divide'],
      ['·', 'cdot', 'Dot'], ['≤', 'le', 'At most'], ['≥', 'ge', 'At least'],
      ['≠', 'ne', 'Not equal'], ['≈', 'approx', 'About'], ['∞', 'infty', 'Infinity'],
      ['∈', 'in', 'In'], ['∉', 'notin', 'Not in'], ['⊂', 'subset', 'Subset'],
      ['∪', 'cup', 'Union'], ['∩', 'cap', 'Intersection'], ['∀', 'forall', 'For all'],
      ['∃', 'exists', 'Exists'], ['∂', 'partial', 'Partial'], ['∇', 'nabla', 'Nabla'],
    ].map(([label, name, title]) => ({ label, tex: `\\${name} `, title })),
  },
  {
    id: 'arrows',
    label: 'Arrows',
    items: [
      ['→', 'to', 'To'], ['←', 'leftarrow', 'From'], ['↔', 'leftrightarrow', 'Both ways'],
      ['⇒', 'Rightarrow', 'Implies'], ['⇔', 'Leftrightarrow', 'If and only if'],
      ['↦', 'mapsto', 'Maps to'], ['↑', 'uparrow', 'Up'], ['↓', 'downarrow', 'Down'],
    ].map(([label, name, title]) => ({ label, tex: `\\${name} `, title })),
  },
];

// Words inside a formula, set upright: \text{...}.
export const MATH_TEXT = { label: 'Text', tex: '\\text{#}', title: 'Words inside the formula' };

// { text, caret } for inserting `tex` with `selected` placed in its first slot.
export const fillSnippet = (tex, selected = '') => {
  const parts = String(tex).split('#');
  if (parts.length === 1) return { text: parts[0], caret: parts[0].length };
  let text = parts[0];
  let caret = -1;
  for (let i = 1; i < parts.length; i += 1) {
    if (i === 1 && selected) text += selected;
    else if (caret < 0) caret = text.length;
    text += parts[i];
  }
  return { text, caret: caret < 0 ? text.length : caret };
};
