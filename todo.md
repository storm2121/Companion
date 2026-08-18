# Companion — TODO / backlog

Open items not yet built. Grouped by theme; rough priority noted. Done features (pin
notes, noteCount self-heal, global search + content filter, links + code blocks, image
paste/drop, settings page, in-app link/delete popouts, resizable code block) are **not**
listed here.

## Trust & security
- [x] **Email-verification gate** — done 2026-08: enforced in `firestore.rules`,
      `storage.rules`, `requireAuiUser`, `AuthContext`, `ProtectedRoute`, and a confirm
      card in `AuthHub` (resend + recheck). Email-link sign-in verifies implicitly.
- [x] **Abuse ceilings on the callables** — done 2026-08: `maxInstances` on all four,
      delete callables metered by note count via `deleteUsage/{uid}`.
- [ ] **Enforce App Check** on the callables. Code is ready (`ENFORCE_APP_CHECK` param +
      `VITE_FIREBASE_APPCHECK_SITE_KEY`); needs reCAPTCHA Enterprise registration in the
      console, then flip the param **after** confirming tokens arrive. _High priority._
- [ ] **Hard billing cap** — budget alerts only notify. Add a Cloud Functions
      invocations/day quota in the Cloud console, and/or a budget→Pub/Sub→disable-billing
      function.
- [ ] **Account deletion** in Settings (recursive data delete + reauth flow). Deferred —
      destructive, needs care.
- [ ] **noteCount via Cloud Function** for always-accurate counts (current fix self-heals
      on view). Needs Blaze plan + a Firestore trigger.

## Editor
- [x] **Export a note → PDF** — done 2026-07: print-pipeline export from the note ⋯ menu.
- [ ] **Export a note → Markdown** (Settings does full-workspace JSON; PDF is covered above).
- [ ] **Math (KaTeX)** — inline + block math for STEM notes.
- [ ] **Slash menu (`/`)** to insert blocks/formatting.
- [ ] **Markdown input rules** (`## `, `- `, etc.) for faster capture.
- [ ] **Word / character count** (per note or block).
- [ ] **Custom color picker** (replace native `<input type=color>` — gradient-click / Tab quirks).
- [ ] **Persist code-block width** (current resize is CSS-only, resets on reload — needs a node view).

## Organization & planning
- [ ] **Tags UI** — `tags` field already exists in data; add chips + filtering.
- [ ] **Due dates / reminders** (optional `dueAt` on notes + "due soon" cue).
- [x] **📅 Calendar view** — done 2026-07: month grid, day panel with countdowns, and an
      "Up next" spine, with an optional Upcoming widget on the dashboard.
- [ ] **Full command palette** (Ctrl+K is just search today — make it jump-to-class/note/action).

## Sharing & platform
- [ ] **Read-only share links** for a note (needs a public-read sharing model).
- [ ] **PWA / installable + offline-first** (Firestore persistence already on; add manifest + SW).
- [ ] **Mobile editing mode** (freeform drag canvas is rough on phones).
- [ ] **Real-time collaboration** (TipTap + Yjs) — large; only if multi-user is a goal.

## Polish
- [ ] **Style the file input** in the note-details modal (native "Choose File" breaks the design).

## Engineering health
- [ ] **Tests for the persistence layer** (delta save + legacy→map migration is the riskiest code).
- [x] **Remove dormant legacy contentEditable editor** — done 2026-07: ~16 KB of legacy
      source excised; TipTap is the only editor path.
- [ ] **CI** (GitHub Actions: build + lint + unit tests on push). Lint is at a clean baseline
      of 0 problems — CI would keep it there.
- [ ] **Error monitoring** (Sentry).
- [x] **Route-level code-splitting** — done 2026-07: NoteEditor/Settings/Calendar lazy;
      main bundle 981 KB → 882 KB, editor in its own chunk.
