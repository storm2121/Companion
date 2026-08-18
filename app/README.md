# Companion

A calm, ADHD-friendly note-taking app for AUI students. Organize notes by class, capture
quickly, and write in a freeform, block-based canvas editor — with two warm themes
(**Daylight** & **Lamplight**).

**Live:** https://companion-c4a42.web.app · https://companion-c4a42.firebaseapp.com
**Firebase project:** `companion-c4a42`
**Repo:** https://github.com/storm2121/Companion (the app lives in the [`app/`](.) subfolder)

---

## Table of contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Local development](#local-development)
- [Available scripts](#available-scripts)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Firebase backend](#firebase-backend)
- [Build & deploy](#build--deploy)
- [Troubleshooting](#troubleshooting)
- [Current state & notes](#current-state--notes)

---

## Tech stack

| Area | Choice |
|---|---|
| UI | **React 19**, **react-router-dom 7** |
| Build | **Vite 7** (`@vitejs/plugin-react`) |
| Backend | **Firebase 12** — Auth, Cloud Firestore (offline persistent multi-tab cache), Storage |
| Editor | **TipTap 2** (ProseMirror) with a custom font-size mark + tables, task lists, etc. |
| Canvas | **react-rnd** (drag/resize blocks) |
| Icons | **react-icons** |
| Lint | ESLint 9 (flat config) |

---

## Repository layout

```
Companion/
├─ app/                      ← the web app (run all commands from here)
│  ├─ src/
│  │  ├─ pages/              AuthHub, AuthComplete, ProfileSetup, Dashboard,
│  │  │                      ClassNotes, NoteEditor, Settings, Calendar
│  │  ├─ components/         classes/ editor/ ui/ + ProtectedRoute
│  │  ├─ context/            AuthContext (auth + theme), authState
│  │  ├─ services/           library.js (all Firestore/Storage access), sage*.js
│  │  ├─ hooks/              useNetworkStatus…
│  │  ├─ utils/              exportPdf, imageUpload, eventTime, offlineData
│  │  ├─ data/               note templates
│  │  ├─ firebase.js         Firebase init (config + Firestore cache)
│  │  ├─ index.css           base + themes (Daylight/Lamplight, OKLCH)
│  │  ├─ dashboard-v3.css    dashboard redesign layer
│  │  ├─ calendar.css        calendar page layer
│  │  └─ refinements.css     latest override layer (imported last)
│  ├─ functions/             Sage AI + cascading deletion Cloud Functions
│  ├─ tests/                 unit tests + Firestore/Storage rules tests
│  ├─ scripts/               verify-hosting.mjs (security-header probe)
│  ├─ firebase.json          hosting + rules + functions config
│  ├─ .firebaserc            default project = companion-c4a42
│  ├─ firestore.rules        Firestore security rules
│  ├─ storage.rules          Storage security rules
│  ├─ database.rules.json    Realtime DB rules (locked; RTDB unused)
│  └─ firestore.indexes.json (no custom indexes)
├─ README.md                 project overview
└─ todo.md                   backlog
```

---

## Prerequisites

- **Node.js 20.19+** (22 LTS or 24 recommended — Vite 7 requires ≥ 20.19/22.12; Cloud
  Functions target Node 24)
- **npm** (ships with Node)
- **Firebase CLI** for deploys: `npm install -g firebase-tools`
- A **verified `@aui.ma` account** to actually log in and use the app (the app is domain-restricted)

---

## Local development

```bash
git clone https://github.com/storm2121/Companion.git
cd Companion/app          # IMPORTANT: everything runs from app/, not the repo root
npm install
npm run dev               # → http://localhost:5173
```

> The dev server talks to the **live cloud Firebase project** (there is no emulator setup),
> so you need network access and an `@aui.ma` login. Note that Firestore/Storage access is
> still governed by the **deployed** security rules — see [Build & deploy](#build--deploy).

To preview a production build locally:

```bash
npm run build
npm run preview
```

---

## Available scripts

Run from `app/`:

| Script | What it does |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build → `dist/` (what Firebase Hosting serves) |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests, then Firestore/Storage rules tests in local emulators |
| `npm run verify:hosting -- <url>` | Verify the deployed site's security response headers |

---

## Configuration

Firebase web config is in [`src/firebase.js`](src/firebase.js) and is **committed on purpose**.
A Firebase web `apiKey` is **not a secret** — it only identifies the project to the client.
All access is enforced server-side by **Firebase Auth + Security Rules**, not by hiding the key.
There are no private client-side secrets to set up. To stage Firebase App Check, set the
public reCAPTCHA Enterprise site key as `VITE_FIREBASE_APPCHECK_SITE_KEY`. Cloud Functions
uses the deploy parameter `ENFORCE_APP_CHECK`, which defaults to `false` for local testing;
enable it only after the deployed web client is sending valid App Check tokens.

If you ever point this at a different Firebase project, replace the `firebaseConfig` object in
`src/firebase.js` and the project id in `.firebaserc`.

---

## Architecture

**Auth & routing.** `AuthContext` owns Firebase auth and the active theme. Routes
([`src/App.jsx`](src/App.jsx)):

| Path | Page | Guard |
|---|---|---|
| `/` | AuthHub (login / register) | public |
| `/auth/complete` | email-link sign-in completion | public |
| `/setup` | ProfileSetup | signed-in |
| `/dashboard` | Dashboard (classes + notes) | signed-in + profile |
| `/class/:classId` | ClassNotes | signed-in + profile |
| `/class/:classId/note/:noteId` | NoteEditor | signed-in + profile |
| `/template/new` | NoteEditor (template builder) | signed-in + profile |

Sign-in is **email/password and email-link**, restricted to `@aui.ma` addresses.

**The editor.** Each note is a freeform canvas of draggable/resizable blocks (text or image).
Text blocks are **TipTap/ProseMirror** instances (bold/italic/underline/strike, font size &
family, color, highlight, alignment, lists, **task lists**, **tables**, placeholder). New blocks
auto-place into the highest-then-leftmost free space currently on screen.

**Delta persistence.** Note content is stored as a **block map** (`{ [id]: block }` + an
`order` array), so a single edit is saved as a small per-block delta rather than rewriting the
whole note. Saves are debounced and also mirrored to `localStorage` as a recovery draft. See
[`src/services/library.js`](src/services/library.js).

**Themes.** Two OKLCH palettes — **Daylight** (light) and **Lamplight** (dark) — driven by a
single `data-theme` attribute on `<html>`. The choice is saved to the user's profile.

---

## Firebase backend

### Firestore data model

```
users/{uid}                                  ← profile (displayName, themeMode, …)
users/{uid}/noteTemplates/{templateId}       ← saved custom templates
users/{uid}/classes/{classId}                ← class meta (name, color, noteCount, order)
users/{uid}/classes/{classId}/notes/{noteId} ← note meta (title, summary, coverUrl, order, …)
users/{uid}/classes/{classId}/notes/{noteId}/content/main
                                             ← note content (blocks map, order, canvasHeight)
```

Cloud Storage paths: `avatars/{uid}/…`, `notes/{uid}/{noteId}/…`, `templates/{uid}/…`.

### Security rules

- [`firestore.rules`](firestore.rules) and [`storage.rules`](storage.rules): a user can only
  read/write their own `users/{uid}/…` subtree, and only with an `@aui.ma` account.
- [`database.rules.json`](database.rules.json): Realtime Database is locked (`false`); RTDB is unused.
- [`firestore.indexes.json`](firestore.indexes.json): no custom composite indexes.

> **Rules are server-side and only take effect once deployed.** Editing the `.rules` files
> locally changes nothing until you `firebase deploy` them.

### Cloud Functions

[`functions/`](functions) runs on Node 24 and exports the Sage AI callable plus authenticated,
cascading note/class deletion callables. Sage keeps its provider key in the
`DEEPSEEK_API_KEY` Firebase secret and stores rate-limit counters in the server-only
`sageUsage/{uid}` collection.

Before the first Functions deploy:

```powershell
firebase functions:secrets:set DEEPSEEK_API_KEY
```

App Check is staged with the `ENFORCE_APP_CHECK` deploy parameter, which defaults to `false`
while the app is being tested. Set the web client's `VITE_FIREBASE_APPCHECK_SITE_KEY` first,
verify tokens in Firebase metrics, and then set the parameter to `true` on a later deploy.

### Offline cache and device clearing

Firestore uses its persistent multi-tab cache and note editing keeps UID-scoped recovery drafts
in browser storage. Normal sign-out intentionally preserves this data for faster reloads and
offline recovery. Settings also provides **Clear this device and sign out**, which removes only
Companion browser-storage keys and clears Firestore's local cache; other tabs must be closed so
Firebase can safely clear the shared IndexedDB database.

### Historical orphan-image cleanup

Future note/class deletions remove their Storage prefixes through authenticated callables. To
audit images left behind by deletions made before that change, run the Admin script from
`app/functions/`. It is read-only by default and requires Application Default Credentials:

```powershell
npm run cleanup:orphan-images -- --project companion-c4a42 --bucket companion-c4a42.firebasestorage.app
```

Review the dry-run list before allowing deletion. The project confirmation, 24-hour age window,
and 1,000-object ceiling are deliberate safety checks:

```powershell
npm run cleanup:orphan-images -- --project companion-c4a42 --bucket companion-c4a42.firebasestorage.app --delete --confirm-project companion-c4a42
```

---

## Build & deploy

All deploy commands run from **`app/`** (where `firebase.json` lives).

### One-time setup

```powershell
npm install -g firebase-tools     # if not installed
cd app
firebase login                    # use 'firebase login --reauth' if it gets stuck
firebase use companion-c4a42      # confirm the active project (it's the default)
```

### Full deploy (site + rules + functions)

**PowerShell** — quote the comma-separated target list, or it errors with "No targets match":

```powershell
cd app
npm run build
firebase deploy --only "hosting,firestore:rules,storage,functions"
```

> Note the targets: `firestore:rules` (Firestore supports `:rules`/`:indexes`), but plain
> `storage` for Storage rules — there is **no** `storage:rules` target (it errors with
> "Could not find rules for the following storage targets: rules").

**bash / Git Bash** (quotes optional):

```bash
cd app
npm run build
firebase deploy --only hosting,firestore:rules,storage,functions
```

This ships:

- **Hosting** — the contents of `dist/` (built by `npm run build`), with an SPA rewrite so
  client-side routes resolve to `index.html`.
- **Firestore rules** and **Storage rules**.
- **Cloud Functions** for Sage and recursive note/class deletion.

On success it prints the live URLs:

- https://companion-c4a42.web.app
- https://companion-c4a42.firebaseapp.com

After deployment, verify the public headers and smoke-test login, note loading, upload, Sage,
and deletion with a disposable test note:

```powershell
npm run verify:hosting -- https://companion-c4a42.web.app
```

Then **hard-refresh** the site (Ctrl+Shift+R) to drop the old cached bundle.

### Targeted deploys

```powershell
firebase deploy --only hosting                     # just the site (after npm run build)
firebase deploy --only "firestore:rules,storage"   # just security rules (no rebuild needed)
firebase deploy --only firestore:rules             # one ruleset
firebase deploy --only functions                   # Sage + deletion backend
```

> Rules deploys are independent of the build — you can push a rules fix without rebuilding.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error: Not in a Firebase app directory` | You're in the repo root. `cd app` first. |
| `No targets … match '--only hosting firestore …'` | PowerShell split the list. **Quote it**: `--only "hosting,firestore:rules,storage,functions"`. |
| `Could not find rules for the following storage targets: rules` | Wrong target — use `storage`, not `storage:rules` (only Firestore takes `:rules`). |
| `npm error … could not read package.json` | Same thing — run npm/firebase from `app/`, not the repo root. |
| App stuck on **"We couldn't load your profile"** / console `Missing or insufficient permissions` | The **deployed** rules are rejecting the read. Deploy rules (`--only "firestore:rules,storage"`) and confirm you're logged in with an `@aui.ma` account. |
| Login won't complete | `firebase login --reauth`; ensure the account is `@aui.ma`. |
| Old UI / white native scrollbar after deploy | Stale cache — hard-refresh (Ctrl+Shift+R). |
| A callable returns `not-found` | Deploy Functions with `firebase deploy --only functions`. |

---

## Current state & notes

- Access requires **a verified mailbox on the `@aui.ma` domain**. Both conditions are
  enforced in `firestore.rules`, `storage.rules`, and every callable (`requireAuiUser`) —
  the client-side gates in `AuthContext` / `ProtectedRoute` / `AuthHub` are UX, not the
  boundary. Email-link sign-in satisfies verification implicitly.
- **App Check is staged** behind the `ENFORCE_APP_CHECK` deploy parameter and is not yet
  enforced; see [`todo.md`](../todo.md).
- Callables carry `maxInstances` ceilings, and both Sage and the delete callables are
  metered per user per day in server-only counter collections.
- `npm run lint`, the production build, unit tests, and Firebase Rules tests pass locally.
- The checked-in Hosting headers require a Hosting deployment before they appear on the public
  site. Use `npm run verify:hosting -- https://companion-c4a42.web.app` after deployment.
- `react-rnd` is intentionally pinned to `10.5.2`. Version `10.5.3` currently pulls a
  `react-draggable` build that references Node's `process` global in the browser and prevents
  note canvases from opening under Vite.
- Remaining work and design decisions are tracked in [`todo.md`](../todo.md).
- No license is attached — the code is published to be read, not reused.
