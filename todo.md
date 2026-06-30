# Companion — TODO / backlog

Open items not yet built. Grouped by theme; rough priority noted. Done features (pin
notes, noteCount self-heal, global search + content filter, links + code blocks, image
paste/drop, settings page, in-app link/delete popouts, resizable code block) are **not**
listed here.

## Trust & security
- [ ] **Re-enable email verification** (or OTP-on-signup). Currently OFF — anyone with any
      `@aui.ma` string can register unverified. _High priority._ Re-add
      `request.auth.token.email_verified == true` in `firestore.rules`/`storage.rules`,
      re-enable the gate in `AuthContext`/`ProtectedRoute`, redeploy rules.
- [ ] **Account deletion** in Settings (recursive data delete + reauth flow). Deferred —
      destructive, needs care.
- [ ] **noteCount via Cloud Function** for always-accurate counts (current fix self-heals
      on view). Needs Blaze plan + a Firestore trigger.

## Editor
- [ ] **Export a note → PDF / Markdown / print** (Settings only does full-workspace JSON today).
- [ ] **Math (KaTeX)** — inline + block math for STEM notes.
- [ ] **Slash menu (`/`)** to insert blocks/formatting.
- [ ] **Markdown input rules** (`## `, `- `, etc.) for faster capture.
- [ ] **Word / character count** (per note or block).
- [ ] **Custom color picker** (replace native `<input type=color>` — gradient-click / Tab quirks).
- [ ] **Persist code-block width** (current resize is CSS-only, resets on reload — needs a node view).

## Organization & planning
- [ ] **Tags UI** — `tags` field already exists in data; add chips + filtering.
- [ ] **Due dates / reminders** (optional `dueAt` on notes + "due soon" cue).
- [ ] **📅 Calendar view** — month/agenda of notes by date.
      - Decision pending: **created-date timeline** (quick, data exists) vs **due-date planner**
        (pairs with due dates above).
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
- [ ] **Remove dormant legacy contentEditable editor** (~1500 lines behind the now-permanent TipTap flag).
- [ ] **CI** (GitHub Actions: build + lint on push) and clear the ~20 pre-existing lint errors.
- [ ] **Error monitoring** (Sentry).
- [ ] **Route-level code-splitting** (main bundle ~980 KB; lazy-load the editor route).
