import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { buildEditorExtensions } from './extensions';

// TipTap-backed replacement for the raw contentEditable text block. Content is stored
// as HTML in block.value (backward-compatible with existing notes), but editing happens
// on a structured ProseMirror document — so spaces/sizes can't be corrupted and a caret
// font-size change applies only to the next typed text (stored marks).
const RichTextBlock = ({ block, onChange, onEditorActive, onFocusBlock, onBlurEditor }) => {
  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: block.value || '',
    onUpdate: ({ editor: instance }) => {
      onChange?.(instance.getHTML());
    },
    onFocus: ({ editor: instance }) => {
      onEditorActive?.(instance);
      onFocusBlock?.();
    },
    onSelectionUpdate: ({ editor: instance }) => {
      onEditorActive?.(instance);
    },
    onBlur: () => {
      onBlurEditor?.();
    },
    editorProps: {
      attributes: {
        class: 'note-textarea tiptap-editor',
      },
    },
  });

  // Push external content changes (load, undo/redo) into the editor without stomping
  // the caret while the user is typing.
  useEffect(() => {
    if (!editor) return;
    const incoming = block.value || '';
    if (!editor.isFocused && editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, false);
    }
  }, [editor, block.value]);

  return (
    <div
      className="note-textarea-shell"
      style={{
        fontSize: `${block.fontSize || 12}px`,
        lineHeight: block.lineHeight || 1.4,
        color: block.textColor || 'var(--text)',
      }}
    >
      <EditorContent editor={editor} className="note-textarea-content" />
    </div>
  );
};

export default RichTextBlock;
