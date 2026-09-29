import { useState } from 'react';
import { MATH_GROUPS, MATH_TEXT } from '../mathSymbols';

// The math toolbar: takes the format strip's place while the caret is in a formula. One
// group of symbols at a time (Build · Greek · Symbols · Arrows), plus Text for words inside
// a formula — never a wall of buttons.
//
// Every button acts on mouse DOWN with preventDefault, so the formula keeps the caret and
// symbols can be clicked in one after another.

const keep = (event) => event.preventDefault();

const MathStrip = ({ tool }) => {
  const [groupId, setGroupId] = useState(MATH_GROUPS[0].id);
  const group = MATH_GROUPS.find((item) => item.id === groupId) || MATH_GROUPS[0];

  return (
    <div className="room-strip room-math-strip" role="toolbar" aria-label="Math">
      <div className="room-strip-group">
        {MATH_GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`room-strip-btn room-math-tab${item.id === group.id ? ' is-on' : ''}`}
            onMouseDown={keep}
            onClick={() => setGroupId(item.id)}
            aria-pressed={item.id === group.id}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="room-strip-group room-math-symbols">
        {group.items.map((item) => (
          <button
            key={item.tex}
            type="button"
            className="room-strip-btn room-math-sym"
            onMouseDown={keep}
            onClick={() => tool?.insert(item.tex)}
            title={`${item.title} — ${item.tex.trim()}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="room-strip-group">
        <button
          type="button"
          className="room-strip-btn"
          onMouseDown={keep}
          onClick={() => tool?.insert(MATH_TEXT.tex)}
          title={MATH_TEXT.title}
        >
          {MATH_TEXT.label}
        </button>
      </div>
    </div>
  );
};

export default MathStrip;
