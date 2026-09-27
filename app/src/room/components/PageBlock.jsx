import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildEditorExtensions } from '../../components/editor/extensions';
import {
  BLOCK_CALLOUT,
  BLOCK_CHECKLIST,
  BLOCK_CODE,
  BLOCK_IMAGE,
  BLOCK_MATH,
  BLOCK_TEXT,
  BLOCK_TWO_COLUMN,
  COLUMN_BLOCK_TYPES,
  createBlock,
} from '../pageBlocks';

// One block in the page. Rich types host a TipTap editor built from the SHARED schema
// (`components/editor/extensions.js`) — contextweb calls that the single source of truth,
// and reusing it keeps room and classic note HTML mutually parseable.
//
// The teardown guard is carried over deliberately: without `aliveRef`, an unmount fires
// onUpdate with an empty document and wipes the block. That was a real data-loss bug
// (contextweb §5) and it would return here verbatim.
//
// A two-column block holds two LISTS of ordinary blocks (`colA`/`colB`), so a column can
// contain code, a checklist or a callout — not just prose. Columns never nest another
// two-column: that is the one type `COLUMN_BLOCK_TYPES` leaves out.

const RichText = ({ value, onChange, onFocus, placeholder, className = '' }) => {
  const aliveRef = useRef(true);
  // The HTML this editor currently shows. Typing updates it on the way OUT, so the value
  // that comes back in from the parent matches and is ignored; a value that differs came
  // from somewhere else — Sage, a version switch — and is loaded into the editor. Without
  // this the editor only ever read `value` once, at mount: Sage's rewrite reached the saved
  // note but not the screen, and the next keystroke wrote the old text back over it.
  const shownRef = useRef(value || '');
  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: value || '',
    onUpdate: ({ editor: instance }) => {
      if (!aliveRef.current) return;
      const html = instance.getHTML();
      shownRef.current = html;
      onChange?.(html);
    },
    onFocus: ({ editor: instance }) => onFocus?.(instance),
    // Only a selection the person made: loading Sage's text (setContent) also moves the
    // selection, and must not make that block the "active" one under the toolbar.
    onSelectionUpdate: ({ editor: instance }) => {
      if (instance.isFocused) onFocus?.(instance);
    },
    editorProps: {
      attributes: {
        class: `room-prose ${className}`.trim(),
        'data-placeholder': placeholder || '',
      },
    },
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const next = value || '';
    if (!editor || editor.isDestroyed || next === shownRef.current) return;
    shownRef.current = next;
    // `false`: loading a new value is not an edit, so it must not echo back out as one.
    editor.commands.setContent(next, false);
  }, [editor, value]);

  return <EditorContent editor={editor} />;
};

// The body of any single block. Shared by top-level blocks and column children, which is
// what lets a column hold the same things the page can.
const BlockBody = ({ block, accent, onChange, onFocus }) => {
  const patch = (fields) => onChange?.({ ...block, ...fields });

  if (block.type === BLOCK_CALLOUT) {
    return (
      <div
        className="room-callout"
        style={accent ? { borderLeftColor: accent, background: `${accent}14` } : undefined}
      >
        <input
          className="room-callout-label"
          value={block.label || ''}
          onChange={(e) => patch({ label: e.target.value })}
          aria-label="Callout label"
          style={accent ? { color: accent } : undefined}
        />
        <RichText
          value={block.value}
          onChange={(value) => patch({ value })}
          onFocus={onFocus}
          placeholder="What was said"
        />
      </div>
    );
  }

  if (block.type === BLOCK_CODE || block.type === BLOCK_MATH) {
    const isCode = block.type === BLOCK_CODE;
    return (
      <div className="room-code">
        {isCode && (
          <input
            className="room-code-lang"
            value={block.lang || ''}
            onChange={(e) => patch({ lang: e.target.value })}
            aria-label="Language"
          />
        )}
        <textarea
          className="room-code-area"
          value={block.value || ''}
          onChange={(e) => patch({ value: e.target.value })}
          onFocus={() => onFocus?.(null)}
          placeholder={isCode ? 'Paste or write code' : 'Write the expression'}
          rows={Math.max(3, (block.value || '').split('\n').length)}
          spellCheck={false}
        />
      </div>
    );
  }

  if (block.type === BLOCK_IMAGE) {
    return (
      <div className="room-image">
        {block.value ? (
          <img src={block.value} alt={block.alt || ''} loading="lazy" decoding="async" />
        ) : (
          <div className="room-scene-inner">Paste an image address below.</div>
        )}
        <input
          className="room-field"
          value={block.value || ''}
          onChange={(e) => patch({ value: e.target.value })}
          onFocus={() => onFocus?.(null)}
          placeholder="Image address"
          aria-label="Image address"
        />
      </div>
    );
  }

  return (
    <div className={block.type === BLOCK_CHECKLIST ? 'room-checklist' : undefined}>
      <RichText
        value={block.value}
        onChange={(value) => patch({ value })}
        onFocus={onFocus}
        placeholder="Write something"
      />
    </div>
  );
};

const Column = ({ items, accent, onChange, onFocus, label }) => {
  const [adding, setAdding] = useState(false);

  const patchChild = (next) =>
    onChange(items.map((item) => (item.id === next.id ? next : item)));

  const addChild = (type) => {
    onChange([...items, createBlock(type)]);
    setAdding(false);
  };

  const removeChild = (id) => onChange(items.filter((item) => item.id !== id));

  return (
    <div className="room-col">
      {items.map((child) => (
        <div key={child.id} className="room-col-item">
          <button
            type="button"
            className="room-gutter-btn room-col-x"
            onClick={() => removeChild(child.id)}
            aria-label="Remove from this column"
          >
            ×
          </button>
          <BlockBody block={child} accent={accent} onChange={patchChild} onFocus={onFocus} />
        </div>
      ))}

      {adding ? (
        <div className="room-plus-menu">
          {COLUMN_BLOCK_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              className="room-chip"
              onClick={() => addChild(type.id)}
            >
              {type.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="room-col-add"
          onClick={() => setAdding(true)}
          aria-label={`Add to ${label}`}
        >
          + Add
        </button>
      )}
    </div>
  );
};

const PageBlock = ({ block, sectionIndex, accent, onChange, onFocus }) => {
  const marker = sectionIndex ? <span className="room-section-mark">§{sectionIndex}</span> : null;

  if (block.type === BLOCK_TWO_COLUMN) {
    return (
      <div className="room-block room-two-col">
        <div>
          {marker}
          <Column
            label="the left column"
            items={block.colA || []}
            accent={accent}
            onFocus={onFocus}
            onChange={(colA) => onChange?.({ ...block, colA })}
          />
        </div>
        <div>
          <Column
            label="the right column"
            items={block.colB || []}
            accent={accent}
            onFocus={onFocus}
            onChange={(colB) => onChange?.({ ...block, colB })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="room-block">
      {marker}
      <BlockBody
        block={block}
        accent={accent}
        onChange={(next) => onChange?.({ ...next, type: next.type || BLOCK_TEXT })}
        onFocus={onFocus}
      />
    </div>
  );
};

export default PageBlock;
