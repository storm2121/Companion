import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { buildEditorExtensions } from './extensions';

// TipTap-backed text block. Content is stored as HTML in block.value (backward
// compatible with existing notes); editing happens on a structured ProseMirror
// document, so spaces/sizes can't be corrupted and a caret font-size change applies
// only to the next typed text (stored marks).
const RichTextBlock = ({
  block,
  onChange,
  onRegister,
  onActivate,
  onFocusBlock,
  onStepFontSize,
  onLink,
}) => {
  // Guards onChange from firing during teardown (prevented the collapse/unmount
  // data-loss where an empty doc overwrote block.value).
  const aliveRef = useRef(true);
  const editorRef = useRef(null);

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: block.value || '',
    onUpdate: ({ editor: instance }) => {
      if (!aliveRef.current) return;
      onChange?.(instance.getHTML());
    },
    onFocus: ({ editor: instance }) => {
      onActivate?.(instance);
      onFocusBlock?.();
    },
    onSelectionUpdate: ({ editor: instance }) => {
      onActivate?.(instance);
    },
    editorProps: {
      attributes: {
        class: 'note-textarea tiptap-editor',
      },
      // Custom shortcuts that aren't TipTap defaults. event.code keeps them
      // keyboard-layout independent.
      handleKeyDown: (_view, event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod) return false;
        // Ctrl/Cmd+K → add/edit link (no Shift).
        if (!event.shiftKey && !event.altKey && event.code === 'KeyK') {
          event.preventDefault();
          onLink?.();
          return true;
        }
        if (!event.shiftKey) return false;
        if (event.code === 'Period') {
          event.preventDefault();
          onStepFontSize?.(1);
          return true;
        }
        if (event.code === 'Comma') {
          event.preventDefault();
          onStepFontSize?.(-1);
          return true;
        }
        if (event.code === 'Digit9') {
          event.preventDefault();
          editorRef.current?.chain().focus().toggleTaskList().run();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Register this block's editor instance with the parent so toolbar/context actions
  // can target it even when focus has moved to a toolbar control.
  useEffect(() => {
    aliveRef.current = true;
    if (editor) onRegister?.(editor);
    return () => {
      aliveRef.current = false;
      onRegister?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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
