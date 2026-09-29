import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MathToolContext } from '../mathContext';
import { fillSnippet } from '../mathSymbols';
import MathView from './MathView';

// A math block. Read: the formula, typeset. Click it and it opens for editing — the LaTeX
// source above, the live result below — and the note's sticky toolbar turns into the math
// toolbar (MathStrip) while the caret is here. The toolbar inserts at the caret without
// taking focus away, so symbols can be clicked in one after another.

const MathBlock = ({ block, onChange, onFocus, autoFocus = false }) => {
  const setMathTool = useContext(MathToolContext);
  const areaRef = useRef(null);
  const caretRef = useRef(null);
  const latest = useRef({ block, onChange });
  const wantFocus = useRef(autoFocus);
  const [editing, setEditing] = useState(() => autoFocus || !block.value);

  useEffect(() => {
    latest.current = { block, onChange };
  }, [block, onChange]);

  // Inserts a toolbar snippet at the caret (a selection lands in its first slot). Reads only
  // refs, so one function serves the block's whole life.
  const insert = useCallback((tex) => {
    const el = areaRef.current;
    if (!el) return;
    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const { text, caret } = fillSnippet(tex, value.slice(start, end));
    caretRef.current = start + caret;
    const { block: current, onChange: change } = latest.current;
    change?.({ ...current, value: value.slice(0, start) + text + value.slice(end) });
  }, []);

  // Taking the caret — from a shortcut, a fresh insert, or a click on the typeset formula.
  // The field is focused ONCE, from here, after it exists; and whenever it holds the caret
  // the math toolbar is claimed DIRECTLY, on every run. Both matter: a focus made from code
  // as the field appears does not reliably reach onFocus, and React's development re-run
  // (which also detaches refs) clears the claim once — so the claim must be re-made, not
  // made once. Traced in the room-harness.
  useEffect(() => {
    if (!editing) return;
    const el = areaRef.current;
    if (wantFocus.current && el) {
      wantFocus.current = false;
      el.focus();
    }
    if (el && document.activeElement === el) setMathTool?.({ id: block.id, insert });
  }, [editing, setMathTool, block.id, insert]);

  // After an insertion re-renders the value, put the caret where the snippet wants it.
  useEffect(() => {
    const el = areaRef.current;
    const caret = caretRef.current;
    if (!el || caret === null) return;
    caretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [block.value]);

  // Leaving the note (or deleting the block) with the caret here must not leave the math
  // toolbar showing for a formula that is gone. (Development's re-run clears it too, and the
  // effect above claims it straight back.)
  useEffect(
    () => () => setMathTool?.((tool) => (tool?.id === block.id ? null : tool)),
    [setMathTool, block.id],
  );

  const open = () => {
    wantFocus.current = true;
    setEditing(true);
  };

  return (
    <div className={`room-math${editing ? ' is-editing' : ''}`}>
      {editing ? (
        <>
          <textarea
            ref={areaRef}
            className="room-code-area room-math-area"
            value={block.value || ''}
            onChange={(event) => onChange?.({ ...block, value: event.target.value })}
            onFocus={() => {
              onFocus?.(null);
              setMathTool?.({ id: block.id, insert });
            }}
            onBlur={() => {
              setMathTool?.((tool) => (tool?.id === block.id ? null : tool));
              if ((latest.current.block.value || '').trim()) setEditing(false);
            }}
            placeholder="x^2 + y^2 = r^2 — or use the math toolbar above"
            rows={Math.max(2, (block.value || '').split('\n').length)}
            spellCheck={false}
          />
          <MathView tex={block.value} className="room-math-preview" placeholder="The formula shows here." />
        </>
      ) : (
        <button type="button" className="room-math-open" onClick={open} aria-label="Edit this formula">
          <MathView tex={block.value} />
        </button>
      )}
    </div>
  );
};

export default MathBlock;
