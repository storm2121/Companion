# Companion

A calm, focus-friendly note-taking app for university students. Notes are organized by class
and written on a **freeform block canvas** — draggable, resizable rich-text and image blocks
that snap to their neighbours — rather than in a single linear document.

Built with React 19, Vite 7, TipTap/ProseMirror, and Firebase (Auth, Firestore, Storage,
Cloud Functions).

> **Live:** https://companion-c4a42.web.app — sign-in is restricted to a single university
> email domain (`@aui.ma`), so the deployment is not open for public sign-up.

---

## What's interesting in here

**Delta persistence for a block canvas.** Note content is stored as a block *map*
(`{ [blockId]: block }`) plus an `order` array, not an array of blocks. A single keystroke
saves as a per-block field-path delta instead of rewriting the whole note, and the previous
snapshot is diffed in the client before any write goes out. Legacy array-shaped notes are
migrated to the map schema on read.
→ [`app/src/services/library.js`](app/src/services/library.js)

**Magnet snapping with live alignment guides.** Blocks snap to neighbouring edges, centres,
and a consistent gutter while dragging. The guides are drawn by mutating ref'd DOM nodes
directly inside the drag handler — routing them through React state would re-render the whole
editor on every mousemove.
→ [`app/src/pages/NoteEditor.jsx`](app/src/pages/NoteEditor.jsx)

**An LLM feature with a real trust boundary.** "Sage" rewrites and re-lays-out a note. The
provider key never reaches the browser — the client calls a Cloud Function that:

- validates every inbound block (id regex, type allowlist, geometry clamps, length caps);
- replaces image values with a placeholder so private Storage download URLs are never sent to
  the provider;
- routes free-text student input through a sanitizer and an explicit trust rule, so note
  content can't hijack the system prompt;
- re-validates the model's output — the model cannot invent, duplicate, or retype an image
  block, and all geometry is re-clamped server-side;
- enforces a per-user daily quota in a collection the client cannot write to at all.

The layout half of the prompt is closer to a spec than a request: the model is given the exact
grid equations, a six-pattern row library, and a per-request seed for variety.
→ [`app/functions/index.js`](app/functions/index.js)

**Security rules as the actual boundary.** Firestore and Storage both default-deny and scope
every path to the authenticated UID; Storage additionally enforces content-type allowlists and
per-prefix size caps. Deletion runs server-side through authenticated callables that remove the
Storage prefix *before* the Firestore documents, so a partial failure can't strand
bearer-URL-accessible images. Hosting ships a CSP and the usual hardening headers.
→ [`app/firestore.rules`](app/firestore.rules) · [`app/storage.rules`](app/storage.rules) ·
[`app/firebase.json`](app/firebase.json)

**Two OKLCH themes** — Daylight and Lamplight — driven by a single `data-theme` attribute, with
the palettes living entirely in CSS custom properties.

---

## Stack

| Area | Choice |
|---|---|
| UI | React 19, react-router-dom 7 |
| Build | Vite 7 |
| Editor | TipTap 2 (ProseMirror) — custom font-size mark, tables, task lists |
| Canvas | react-rnd |
| Backend | Firebase 12 — Auth, Firestore, Storage, Cloud Functions (Node 24) |
| Tests | `node --test` unit tests + Firebase rules tests on the emulators |
| Lint | ESLint 9 (flat config), clean baseline |

---


## Project status

A personal project, actively built between February and July 2026, running in production for
its intended users. Some hardening steps are staged behind deploy parameters while the app is
in testing; remaining work is tracked in [`todo.md`](todo.md).

No license is attached: the code is published to be read, not reused.
