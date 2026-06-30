import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { FontSize } from './fontSize';

// Single source of truth for the editor schema. Used by the live editor and by any
// HTML <-> document conversion (migration), so parsing and serialization always agree.
export const buildEditorExtensions = () => [
  StarterKit,
  Underline,
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({
    placeholder: 'Write something…',
    showOnlyWhenEditable: true,
  }),
  Link.configure({
    openOnClick: false, // editing, not following — Ctrl/Cmd-click still opens
    autolink: true,
    linkOnPaste: true,
    HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
  }),
];
