import { exportUserData } from '../services/library';
import { isYmd } from './calendarDays';
import { inboxLines } from './inboxLines';
import { noteToMarkdown, safeName, uniqueNamer, zipFiles } from './markdownExport';

// "Export everything" as Markdown (design 6e): one folder per course, one .md file per note
// — room and classic notes alike — plus Inbox.md and Calendar.md, zipped and downloaded.
//
// It reads through the same `exportUserData` the JSON export uses, so both exports see the
// same data. PHOTOS are fetched and packed beside their note: Firebase's download endpoint
// answers cross-origin reads (`Access-Control-Allow-Origin: *`, checked 2026-09-28), so no
// bucket CORS rule is needed. If a fetch is ever refused or the connection drops, the export
// stops asking and every remaining photo stays a link to where it lives online.

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_PHOTOS = 300;
const PHOTO_TIMEOUT_MS = 15000;

const fetchPhoto = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { mode: 'cors', signal: controller.signal });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    return { bytes: new Uint8Array(await res.arrayBuffer()), ext: EXT[type] || 'img' };
  } finally {
    clearTimeout(timer);
  }
};

const millis = (value) => value?.toMillis?.() ?? (Number.isFinite(value) ? value : undefined);

const listItem = (text) => `- ${String(text || '').replace(/\s*\n\s*/g, ' ').trim()}`;

// { bytes, notes, photosPacked, photosLinked }
export const exportMarkdown = async (uid, { onProgress } = {}) => {
  const data = await exportUserData(uid);
  const files = [];
  const name = uniqueNamer();
  const courseNames = new Map((data.classes || []).map((course) => [course.id, course.name || '']));
  const total = (data.classes || []).reduce((sum, course) => sum + (course.notes || []).length, 0);
  let done = 0;
  let packed = 0;
  let linked = 0;
  let canFetch = true;

  for (const course of data.classes || []) {
    const folder = safeName(course.name, 'Course');
    for (const raw of course.notes || []) {
      const note = { ...raw, updatedAtMs: millis(raw.updatedAt), createdAtMs: millis(raw.createdAt) };
      const title = safeName(note.title);

      // Which photos this note shows, in order — then pack what can be packed.
      const urls = [];
      noteToMarkdown(note, course.name, (url) => {
        if (!urls.includes(url)) urls.push(url);
        return url;
      });
      const local = new Map();
      for (const url of urls) {
        if (canFetch && packed < MAX_PHOTOS) {
          try {
            const photo = await fetchPhoto(url);
            if (photo) {
              const path = name(`${folder}/photos`, `${title} ${local.size + 1}`, `.${photo.ext}`);
              files.push({ path, data: photo.bytes });
              local.set(url, path.slice(folder.length + 1));
              packed += 1;
              continue;
            }
          } catch {
            // Refused (usually CORS) or offline: stop asking, link the rest.
            canFetch = false;
          }
        }
        linked += 1;
      }

      const markdown = noteToMarkdown(note, course.name, (url) => (local.has(url) ? encodeURI(local.get(url)) : url));
      files.push({ path: name(folder, title, '.md'), data: markdown });
      done += 1;
      onProgress?.({ done, total });
    }
  }

  const lines = inboxLines(data.profile?.inbox);
  if (lines.length) {
    files.push({ path: name('', 'Inbox', '.md'), data: `# Inbox\n\n${lines.map((line) => listItem(line.text)).join('\n')}\n` });
  }

  const events = Object.values(data.profile?.events || {})
    .filter((event) => event && isYmd(event.date))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')));
  if (events.length) {
    const rows = events.map((event) => {
      const course = event.courseId ? courseNames.get(event.courseId) : '';
      return listItem(`${event.date}${event.time ? ` ${event.time}` : ''} — ${event.title || 'Untitled'}${course ? ` · ${course}` : ''}`);
    });
    files.push({ path: name('', 'Calendar', '.md'), data: `# Calendar\n\n${rows.join('\n')}\n` });
  }

  return { bytes: zipFiles(files), notes: done, photosPacked: packed, photosLinked: linked };
};

export const downloadBytes = (bytes, filename, type = 'application/zip') => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
