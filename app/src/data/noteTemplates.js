export const DEFAULT_TEMPLATE_ID = 'blank';

// The editor canvas is a large fixed workspace (always at least viewport-wide).
// Template content is laid out around its center, and the editor auto-scrolls to
// center the content on open — full working space and centered layouts on any screen.
export const WORKSPACE_WIDTH = 2400;

const DEFAULT_CANVAS_WIDTH = 720;
const DEFAULT_CANVAS_HEIGHT = 720;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const NOTE_TEMPLATES = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start with an empty canvas.',
    blocks: [],
    autoTitlePrefix: 'Quick Note',
  },
  {
    id: 'single',
    label: 'Single Focus',
    description: 'One centered block for focused writing.',
    autoTitlePrefix: 'Note',
    layout: 'single',
  },
  {
    id: 'double',
    label: 'Two Columns',
    description: 'Two centered blocks side by side.',
    autoTitlePrefix: 'Session',
    layout: 'double',
  },
  {
    id: 'two-over-one',
    label: 'Two Above One',
    description: 'Two blocks on top, one wide block below.',
    autoTitlePrefix: 'Lecture',
    layout: 'two-over-one',
  },
  {
    id: 'triple-stack',
    label: 'Three Stack',
    description: 'Three centered blocks in a vertical flow.',
    autoTitlePrefix: 'Outline',
    layout: 'triple-stack',
  },
];

export const getTemplateById = (id) =>
  NOTE_TEMPLATES.find((template) => template.id === id) || NOTE_TEMPLATES[0];

export const buildTemplateBlocks = (id, options = {}) => {
  const template = getTemplateById(id);
  if (template.id === 'blank') return [];
  const canvasWidth = clamp(
    Number(options.canvasWidth) || DEFAULT_CANVAS_WIDTH,
    320,
    1600,
  );
  const canvasHeight = clamp(
    Number(options.canvasHeight) || DEFAULT_CANVAS_HEIGHT,
    420,
    2000,
  );
  const contentWidth = Math.round(canvasWidth * 0.7);
  const contentX = Math.round((canvasWidth - contentWidth) / 2);
  const colGap = clamp(Math.round(canvasWidth * 0.05), 28, 64);
  const rowGap = clamp(Math.round(canvasHeight * 0.05), 28, 80);
  const colWidth = Math.max(240, Math.round((contentWidth - colGap) / 2));

  if (template.layout === 'single') {
    const height = clamp(Math.round(canvasHeight * 0.42), 240, 420);
    const y = Math.max(36, Math.round((canvasHeight - height) / 2));
    return [{ type: 'text', title: 'Main', x: contentX, y, w: contentWidth, h: height }];
  }

  if (template.layout === 'double') {
    const height = clamp(Math.round(canvasHeight * 0.36), 220, 360);
    const y = Math.max(36, Math.round((canvasHeight - height) / 2));
    return [
      { type: 'text', title: 'Left', x: contentX, y, w: colWidth, h: height },
      { type: 'text', title: 'Right', x: contentX + colWidth + colGap, y, w: colWidth, h: height },
    ];
  }

  if (template.layout === 'two-over-one') {
    const topHeight = clamp(Math.round(canvasHeight * 0.3), 200, 300);
    const bottomHeight = clamp(Math.round(canvasHeight * 0.34), 240, 360);
    const totalHeight = topHeight + rowGap + bottomHeight;
    const y = Math.max(28, Math.round((canvasHeight - totalHeight) / 2));
    return [
      { type: 'text', title: 'Top Left', x: contentX, y, w: colWidth, h: topHeight },
      {
        type: 'text',
        title: 'Top Right',
        x: contentX + colWidth + colGap,
        y,
        w: colWidth,
        h: topHeight,
      },
      { type: 'text', title: 'Bottom', x: contentX, y: y + topHeight + rowGap, w: contentWidth, h: bottomHeight },
    ];
  }

  if (template.layout === 'triple-stack') {
    const blockHeight = clamp(Math.round(canvasHeight * 0.22), 180, 260);
    const totalHeight = blockHeight * 3 + rowGap * 2;
    const y = Math.max(24, Math.round((canvasHeight - totalHeight) / 2));
    return [
      { type: 'text', title: 'Section 1', x: contentX, y, w: contentWidth, h: blockHeight },
      { type: 'text', title: 'Section 2', x: contentX, y: y + blockHeight + rowGap, w: contentWidth, h: blockHeight },
      {
        type: 'text',
        title: 'Section 3',
        x: contentX,
        y: y + (blockHeight + rowGap) * 2,
        w: contentWidth,
        h: blockHeight,
      },
    ];
  }

  return (template.blocks || []).map((block) => ({ ...block }));
};
