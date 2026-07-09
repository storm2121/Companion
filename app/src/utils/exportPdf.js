// Export a note as PDF via the browser's print pipeline: we assemble a clean,
// print-styled document in a hidden same-origin iframe and call print() — the user
// picks "Save as PDF". Vector text, no extra dependencies.

const esc = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DEFAULT_TITLES = /^(text block|image block)$/i;

// Reading order: top→bottom, then left→right for blocks on the same band.
const readingOrder = (blocks = []) =>
  [...blocks].sort((a, b) => {
    const ay = a.y || 0;
    const by = b.y || 0;
    if (Math.abs(ay - by) > 40) return ay - by;
    return (a.x || 0) - (b.x || 0);
  });

export const exportNotePdf = ({ title, className, blocks }) => {
  const date = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sections = readingOrder(blocks)
    .map((block) => {
      const heading =
        block.title && !DEFAULT_TITLES.test(block.title.trim())
          ? `<h2>${esc(block.title)}</h2>`
          : '';
      if (block.type === 'image') {
        return block.value ? `<section>${heading}<img src="${esc(block.value)}" /></section>` : '';
      }
      // block.value is TipTap-generated HTML from the user's own note.
      return `<section>${heading}<div class="content">${block.value || ''}</div></section>`;
    })
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title || 'Note')}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  @page { margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Instrument Sans', system-ui, sans-serif;
    color: #2b2620;
    font-size: 12.5px;
    line-height: 1.55;
    margin: 0;
  }
  header.doc {
    border-bottom: 2px solid #c8a46a;
    padding-bottom: 10px;
    margin-bottom: 22px;
  }
  header.doc h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.02em; }
  header.doc p { margin: 0; color: #8a7f6e; font-size: 12px; }
  footer.doc {
    position: fixed;
    bottom: -12mm;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 10px;
    color: #b3a893;
  }
  footer.doc i { font-style: normal; font-weight: 700; }
  section { margin-bottom: 18px; break-inside: avoid-page; }
  section h2 {
    font-size: 15px;
    margin: 0 0 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid #e8e0d0;
    letter-spacing: -0.01em;
  }
  img { max-width: 100%; border-radius: 6px; }
  .content p { margin: 0 0 6px; }
  .content ul, .content ol { margin: 4px 0; padding-left: 22px; }
  .content ul[data-type='taskList'] { list-style: none; padding-left: 4px; }
  .content ul[data-type='taskList'] li { display: flex; gap: 7px; align-items: baseline; }
  .content blockquote {
    border-left: 3px solid #d8cdb8;
    margin: 6px 0;
    padding-left: 10px;
    color: #6f6656;
  }
  .content pre {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    background: #f5f1e8;
    border: 1px solid #e8e0d0;
    border-radius: 6px;
    padding: 8px 10px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .content code { font-family: 'Courier New', monospace; font-size: 11px; background: #f5f1e8; padding: 0 3px; border-radius: 3px; }
  .content table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  .content td, .content th { border: 1px solid #d8cdb8; padding: 4px 7px; vertical-align: top; }
  .content a { color: #8a6c35; }
</style>
</head>
<body>
  <header class="doc">
    <h1>${esc(title || 'Untitled note')}</h1>
    <p>${esc(className || '')}${className ? ' · ' : ''}${esc(date)}</p>
  </header>
  ${sections || '<p>(This note is empty.)</p>'}
  <footer class="doc"><i>Companion.</i></footer>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  const fire = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      // Remove after the dialog closes (afterprint isn't fully reliable cross-browser).
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = cleanup;
      }
      setTimeout(cleanup, 60000);
    }
  };
  // Give fonts/images a beat to arrive so the first page isn't unstyled.
  setTimeout(fire, 450);
};
