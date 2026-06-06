import { Extension } from '@tiptap/core';

// Adds a `fontSize` attribute to the textStyle mark, plus set/unset commands.
// Because it is a mark, applying it with a collapsed cursor sets a *stored mark*:
// the size applies only to the next text typed at the caret, never to surrounding
// content. This is the behavior raw contentEditable could not provide.
export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) => {
          const value = typeof size === 'number' ? `${size}px` : size;
          return chain().setMark('textStyle', { fontSize: value }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export default FontSize;
