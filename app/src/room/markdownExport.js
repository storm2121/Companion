// "Export everything — Markdown + photos, one folder per course" (design 6e).
//
// The pure half: a small reader for the HTML the note editors write (TipTap's schema — it
// is well-formed, so a tag-and-text reader is enough), Markdown for a room page AND a
// classic canvas note (every note exports, whichever design wrote it), safe file names,
// and a minimal zip writer (stored, not compressed — Markdown is small and photos are
// already compressed). exportMarkdown.js does the fetching and the download.
//
// DOM-free and Firebase-free: tests/room.unit.test.mjs loads it under Node.

import {
  BLOCK_CALLOUT,
  BLOCK_CODE,
  BLOCK_IMAGE,
  BLOCK_MATH,
  BLOCK_TWO_COLUMN,
  decodeEntities,
  pageBlocksOf,
  railBlocksOf,
} from './pageBlocks.js';

/* ── Reading HTML ─────────────────────────────────────────────────────────── */

const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr', 'col', 'meta', 'link']);
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;

const readAttrs = (source) => {
  const attrs = {};
  for (const match of String(source || '').matchAll(ATTR)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
};

// A tree of { tag, attrs, children } and { text } nodes.
export const readHtml = (html) => {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  for (const match of String(html || '').matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (match[4] !== undefined) {
      top.children.push({ text: decodeEntities(match[4]) });
      continue;
    }
    if (!match[2]) continue; // a comment
    const tag = match[2].toLowerCase();
    if (match[1]) {
      // A closing tag closes the nearest open one of its name; a stray one is ignored.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node = { tag, attrs: readAttrs(match[3]), children: [] };
    top.children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(match[3])) stack.push(node);
  }
  return root;
};

const textOf = (node) =>
  node.text !== undefined ? node.text : (node.children || []).map(textOf).join('');

/* ── Writing Markdown ─────────────────────────────────────────────────────── */

const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'a', 'span', 'mark', 'br', 'img', 'sub', 'sup', 'small', 'label']);

// Characters that would otherwise start Markdown formatting mid-sentence.
const escapeText = (text) => text.replace(/([\\`*_[\]])/g, '\\$1');

// `**bold **` is not bold: keep the spaces outside the markers.
const wrap = (marker, inner) => {
  if (!inner.trim()) return inner;
  const lead = inner.match(/^\s*/)[0];
  const tail = inner.match(/\s*$/)[0];
  return `${lead}${marker}${inner.trim()}${marker}${tail}`;
};

const inlineOf = (nodes) => nodes.map(inlineOne).join('');

const inlineOne = (node) => {
  if (node.text !== undefined) return escapeText(node.text.replace(/\s+/g, ' '));
  const inner = () => inlineOf(node.children);
  switch (node.tag) {
    case 'strong':
    case 'b':
      return wrap('**', inner());
    case 'em':
    case 'i':
      return wrap('*', inner());
    case 's':
    case 'strike':
    case 'del':
      return wrap('~~', inner());
    case 'code': {
      const code = textOf(node);
      const fence = code.includes('`') ? '``' : '`';
      return `${fence}${code}${fence}`;
    }
    case 'a': {
      const label = inner().trim() || node.attrs.href || '';
      return node.attrs.href ? `[${label}](${node.attrs.href})` : label;
    }
    case 'br':
      return '  \n';
    case 'img':
      return node.attrs.src ? `![${node.attrs.alt || ''}](${node.attrs.src})` : '';
    case 'input':
      return '';
    default:
      return inner();
  }
};

const cleanLine = (text) => text.replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') ? '  \n' : '\n')).trim();

const indent = (text, pad) =>
  text
    .split('\n')
    .map((line) => (line ? `${pad}${line}` : line))
    .join('\n');

const listOf = (node) => {
  const ordered = node.tag === 'ol';
  const task = node.attrs['data-type'] === 'taskList';
  let n = Number(node.attrs.start) || 1;
  return node.children
    .filter((child) => child.tag === 'li')
    .map((li) => {
      const marker = task
        ? `- [${li.attrs['data-checked'] === 'true' ? 'x' : ' '}]`
        : ordered
          ? `${(n += 1) - 1}.`
          : '-';
      const nested = li.children.filter((child) => child.tag === 'ul' || child.tag === 'ol');
      const body = blocksOf(li.children.filter((child) => !nested.includes(child) && child.tag !== 'label')).join('\n');
      const pad = ' '.repeat(marker.length + 1);
      const [first = '', ...rest] = body.split('\n');
      let out = `${marker} ${first}`.trimEnd();
      if (rest.length) out += `\n${indent(rest.join('\n'), pad)}`;
      nested.forEach((list) => {
        out += `\n${indent(listOf(list), pad)}`;
      });
      return out;
    })
    .join('\n');
};

const tableOf = (node) => {
  const rows = [];
  const walk = (n) =>
    (n.children || []).forEach((child) => {
      if (child.tag === 'tr') rows.push(child);
      else if (child.children) walk(child);
    });
  walk(node);
  if (!rows.length) return '';
  const cells = rows.map((row) =>
    row.children
      .filter((cell) => cell.tag === 'td' || cell.tag === 'th')
      .map((cell) => cleanLine(blocksOf(cell.children).join(' ')).replace(/\n/g, ' ').replace(/\|/g, '\\|')),
  );
  const width = Math.max(...cells.map((row) => row.length));
  const line = (row) => `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`;
  return [line(cells[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...cells.slice(1).map(line)].join('\n');
};

// Block-level Markdown for a list of nodes: an array of paragraphs, headings, lists…
// Inline nodes sitting at block level (bare text, a lone <strong>) are gathered into one
// paragraph.
const blocksOf = (nodes) => {
  const out = [];
  let run = [];
  const flush = () => {
    const text = cleanLine(inlineOf(run));
    if (text) out.push(text);
    run = [];
  };
  nodes.forEach((node) => {
    if (node.text !== undefined || INLINE.has(node.tag)) {
      run.push(node);
      return;
    }
    flush();
    const heading = /^h([1-6])$/.exec(node.tag);
    if (heading) {
      const text = cleanLine(inlineOf(node.children)).replace(/\s*\n\s*/g, ' ');
      if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
    } else if (node.tag === 'p') {
      const text = cleanLine(inlineOf(node.children));
      if (text) out.push(text);
    } else if (node.tag === 'ul' || node.tag === 'ol') {
      const list = listOf(node);
      if (list) out.push(list);
    } else if (node.tag === 'blockquote') {
      const inner = blocksOf(node.children).join('\n\n');
      if (inner) out.push(inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n'));
    } else if (node.tag === 'pre') {
      out.push(`\`\`\`\n${textOf(node).replace(/\n$/, '')}\n\`\`\``);
    } else if (node.tag === 'table') {
      const table = tableOf(node);
      if (table) out.push(table);
    } else if (node.tag === 'hr') {
      out.push('---');
    } else {
      out.push(...blocksOf(node.children));
    }
  });
  flush();
  return out;
};

export const htmlToMarkdown = (html) => blocksOf(readHtml(html).children).join('\n\n');

/* ── Notes ────────────────────────────────────────────────────────────────── */

const quote = (text) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

// One room block. `photo(url)` says how a photo is referenced: its address, or a file
// packed next to the note.
const pageBlockMarkdown = (block, photo) => {
  if (!block) return '';
  if (block.type === BLOCK_CODE) return `\`\`\`${block.lang || ''}\n${block.value || ''}\n\`\`\``;
  if (block.type === BLOCK_MATH) return block.value ? `$$\n${block.value}\n$$` : '';
  if (block.type === BLOCK_IMAGE) return block.value ? `![${block.alt || ''}](${photo(block.value)})` : '';
  if (block.type === BLOCK_TWO_COLUMN) {
    return [...(block.colA || []), ...(block.colB || [])]
      .map((child) => pageBlockMarkdown(child, photo))
      .filter(Boolean)
      .join('\n\n');
  }
  const body = htmlToMarkdown(block.value);
  if (block.type === BLOCK_CALLOUT) {
    const label = String(block.label || '').trim();
    return quote([label ? `**${escapeText(label)}**` : '', body].filter(Boolean).join('\n\n'));
  }
  // A checklist's HTML is a task list, which htmlToMarkdown writes as "- [x]" lines.
  return body;
};

export const pageToMarkdown = (blocks = [], photo = (url) => url) => {
  const parts = pageBlocksOf(blocks).map((block) => pageBlockMarkdown(block, photo)).filter(Boolean);
  const board = railBlocksOf(blocks)
    .filter((pin) => pin.type === BLOCK_IMAGE && pin.value)
    .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
  if (board.length) {
    parts.push('## Photos', ...board.map((pin) => `![${pin.alt || ''}](${photo(pin.value)})`));
  }
  return parts.join('\n\n');
};

const DEFAULT_TITLE = /^(block|text|image|note)( \d+)?$/i;

// A classic note: blocks sit on a canvas, so they are read top to bottom, then left to
// right — the same order classic's PDF export uses.
export const canvasToMarkdown = (blocks = [], photo = (url) => url) =>
  [...blocks]
    .filter(Boolean)
    .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0))
    .map((block) => {
      if (block.type === 'image') return block.value ? `![](${photo(block.value)})` : '';
      const title = String(block.title || '').trim();
      const body = htmlToMarkdown(block.value);
      return [title && !DEFAULT_TITLE.test(title) ? `### ${escapeText(title)}` : '', body].filter(Boolean).join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n');

// The blocks of a stored note, whatever its age: the map + order schema, or a legacy array.
export const storedBlocks = (note) => {
  const content = note?.content;
  if (content?.blocks && !Array.isArray(content.blocks) && typeof content.blocks === 'object') {
    const order = Array.isArray(content.order) ? content.order : Object.keys(content.blocks);
    const seen = new Set(order);
    return [
      ...order.map((id) => content.blocks[id]).filter(Boolean),
      ...Object.entries(content.blocks)
        .filter(([id]) => !seen.has(id))
        .map(([, block]) => block),
    ];
  }
  if (Array.isArray(content?.blocks)) return content.blocks;
  return Array.isArray(note?.blocks) ? note.blocks : [];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

// A whole note as a Markdown file: its title, one quiet line of where and when, the body.
export const noteToMarkdown = (note, courseName, photo = (url) => url) => {
  const blocks = storedBlocks(note);
  const page = note?.format === 'page';
  const when = dayOf(note?.updatedAtMs ?? note?.createdAtMs);
  const meta = [courseName, page ? note?.kind || '' : 'classic desk', when ? `updated ${when}` : '']
    .filter(Boolean)
    .join(' · ');
  const body = page ? pageToMarkdown(blocks, photo) : canvasToMarkdown(blocks, photo);
  return [`# ${escapeText(String(note?.title || 'Untitled').trim() || 'Untitled')}`, meta ? `*${meta}*` : '', body]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
};

/* ── Files ────────────────────────────────────────────────────────────────── */

// A name every file system accepts: no separators or reserved characters, no trailing
// dot or space (Windows), not a reserved device name, and not absurdly long.
export const safeName = (name, fallback = 'Untitled') => {
  let clean = [...String(name || '')]
    .filter((ch) => ch.charCodeAt(0) > 31)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) clean = `${clean}-`;
  return clean || fallback;
};

// Gives each file in a folder its own name: "Notes.md", "Notes (2).md"…
export const uniqueNamer = () => {
  const used = new Set();
  return (folder, base, ext) => {
    let name = `${base}${ext}`;
    for (let n = 2; used.has(`${folder}/${name}`.toLowerCase()); n += 1) name = `${base} (${n})${ext}`;
    used.add(`${folder}/${name}`.toLowerCase());
    return folder ? `${folder}/${name}` : name;
  };
};

/* ── Zip (stored) ─────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosTime = (date) =>
  ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31);
const dosDate = (date) =>
  (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);

// files: [{ path, data: Uint8Array | string }] -> the bytes of a .zip. Names are UTF-8
// (flag bit 11), so accented course names survive on every modern unzip.
export const zipFiles = (files, when = new Date()) => {
  const encoder = new TextEncoder();
  const time = dosTime(when);
  const date = dosDate(when);
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach(({ path, data }) => {
    const name = encoder.encode(path);
    const body = typeof data === 'string' ? encoder.encode(data) : data;
    const crc = crc32(body);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, body);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, body.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + body.length;
  });

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  parts.forEach((part) => {
    out.set(part, at);
    at += part.length;
  });
  return out;
};
