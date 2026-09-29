import { useEffect, useReducer } from 'react';
import { MOD_KEY } from '../platform';

// The format strip — design 6c. A single outlined wobbly bar above the paper, holding
// groups separated by 1.6px dividers: size · B/I/U/S · ink · highlighters · align/list ·
// link. No icon library: every glyph is a text character.
//
// It acts on whichever TipTap editor last had the caret. RoomNote holds that editor in
// STATE and passes it in, so clicking a toolbar button (which blurs the editor) still
// applies to the right block.

const SIZES = [
  { id: 'body', label: 'Body', run: (c) => c.setParagraph().unsetFontSize() },
  { id: 'small', label: 'Small', run: (c) => c.setParagraph().setFontSize('14px') },
  { id: 'large', label: 'Large', run: (c) => c.setParagraph().setFontSize('21px') },
  { id: 'title', label: 'Title', run: (c) => c.unsetFontSize().toggleHeading({ level: 2 }) },
];

const INKS = ['#1f2622', '#6b5bd2', '#2e8b6a', '#c9792f', '#c24a6e'];
const MARKERS = ['#f6dc7a', '#bfe3d0', '#f5c7cf'];

const FormatStrip = ({ editor: given, onLink, onNewSection, sectionOn, onFind }) => {
  // Deleting the block you were typing in destroys its editor, but this strip can still be
  // holding it. Treat a destroyed editor as no editor, or the next click would throw.
  const editor = given && !given.isDestroyed ? given : null;

  // The strip re-renders on the active editor's own transactions. Without this, the
  // B/I/U/size states would be whatever they were when the editor was last swapped:
  // moving the caret changes what is active, but nothing in the parent re-renders.
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    editor.on('transaction', bump);
    return () => {
      editor.off('transaction', bump);
    };
  }, [editor]);

  // Every command runs through here so a strip click with no live editor is simply
  // ignored rather than throwing.
  const run = (fn) => () => {
    if (!editor || editor.isDestroyed) return;
    fn(editor.chain().focus());
  };

  const mark = (name) => (editor?.isActive(name) ? 'is-on' : '');
  const headingOn = Boolean(editor?.isActive('heading'));

  return (
    <div className="room-strip">
      <div className="room-strip-group">
        {SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            className={`room-strip-btn ${size.id === 'title' && headingOn ? 'is-on' : ''}`}
            onClick={run((chain) => size.run(chain).run())}
          >
            {size.label}
          </button>
        ))}
      </div>

      <div className="room-strip-group">
        <button type="button" className={`room-strip-btn ${mark('bold')}`} onClick={run((c) => c.toggleBold().run())}>
          <b>B</b>
        </button>
        <button type="button" className={`room-strip-btn ${mark('italic')}`} onClick={run((c) => c.toggleItalic().run())}>
          <i style={{ fontFamily: 'Georgia, serif' }}>I</i>
        </button>
        <button
          type="button"
          className={`room-strip-btn ${mark('underline')}`}
          onClick={run((c) => c.toggleUnderline().run())}
        >
          <u>U</u>
        </button>
        <button type="button" className={`room-strip-btn ${mark('strike')}`} onClick={run((c) => c.toggleStrike().run())}>
          <s>S</s>
        </button>
      </div>

      <div className="room-strip-group">
        {INKS.map((color) => (
          <button
            key={color}
            type="button"
            className="room-swatch room-strip-swatch"
            style={{ background: color }}
            aria-label={`Ink ${color}`}
            onClick={run((c) => c.setColor(color).run())}
          />
        ))}
      </div>

      <div className="room-strip-group">
        {MARKERS.map((color) => (
          <button
            key={color}
            type="button"
            className="room-swatch room-strip-swatch"
            style={{ background: color }}
            aria-label={`Highlighter ${color}`}
            onClick={run((c) => c.toggleHighlight({ color }).run())}
          />
        ))}
      </div>

      <div className="room-strip-group">
        <button type="button" className="room-strip-btn" onClick={run((c) => c.setTextAlign('left').run())}>
          ≡
        </button>
        <button
          type="button"
          className={`room-strip-btn ${mark('bulletList')}`}
          onClick={run((c) => c.toggleBulletList().run())}
        >
          • list
        </button>
      </div>

      <div className="room-strip-group">
        <button type="button" className={`room-strip-btn ${mark('link')}`} onClick={() => onLink?.()}>
          Link
        </button>
      </div>

      {/* Starts (or ends) a section at the block the caret is in. §n itself is derived
          from position, so there is no number to pick. */}
      <div className="room-strip-group">
        <button
          type="button"
          className={`room-strip-btn ${sectionOn ? 'is-on' : ''}`}
          onClick={() => onNewSection?.()}
          title={sectionOn ? 'Stop starting a section here' : 'Start a new section here — or type --- in an empty block'}
        >
          § Section
        </button>
      </div>

      {/* Visible, so nobody has to know the shortcut — the tooltip teaches it. */}
      <div className="room-strip-group">
        <button
          type="button"
          className="room-strip-btn"
          onClick={() => onFind?.()}
          title={`Find in this note (${MOD_KEY}+F)`}
        >
          Find
        </button>
      </div>
    </div>
  );
};

export default FormatStrip;
