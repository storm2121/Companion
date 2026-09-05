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

## Sage (AI)
- [x] **Take layout away from the model** — done 2026-09: the prompt no longer carries
      geometry; `services/sageLayout.js` composes the page from semantic roles and
      `services/sageMeasure.js` measures real heights. Thinking model dropped, three
      output modes (`patch`/`reflow`/`layout`), payload cap derived from the output
      budget, provider-fault cap refunds, add-ons capped at 3, popout split into
      run + presets.
- [x] **Show the daily allowance, and price runs by size** — done 2026-09:
      `sageUsage/{uid}` is owner-readable, the popout quotes "costs N of your M left
      today", runs weigh 1-4 by size x mode, and the per-user cap overdrafts rather than
      blocking a run that does not quite fit (the debt carries to the next day).
- [ ] **Make `DAILY_CAP` a `defineInt` param** so the allowance can be changed from the
      console instead of needing a functions redeploy. Currently a hardcoded constant.
- [ ] **Fit-to-content action for hand-made blocks** — `reflowSageBlocks` already does
      exactly this; it just needs a menu entry (block ⋯ menu, and/or a canvas-wide
      "tidy up"). Cheap win now that real measurement exists.
- [ ] **Let the student re-tag a block role** (block ⋯ menu → role), so a wrong guess is
      one click to fix and re-running the layout improves instead of re-rolling.
- [ ] **Split oversized notes across calls** instead of refusing at `MAX_PAYLOAD_CHARS` —
      would also give partial results rather than all-or-nothing.
- [ ] **Phase 2: quiz generation + rubric grading** (`sageQuiz`/`sageGrade`) — full spec
      in `LifeCycle.md` §9. The one place the thinking model may genuinely earn its keep.

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

## Landing page & launch
- [ ] **Public landing page** — `/` is still the login form, so there is nowhere to send
      someone who has not heard of the app. Plan agreed 2026-09: a static `index.html`
      (zero JS, ~5 KB) with the React app moved to `app.html` and the `**` hosting rewrite
      pointed at it — hosting resolves static files before rewrites, so the landing has to
      BE `index.html`. Needs a second Vite entry plus a dev-only fallback plugin so dev
      matches prod, and the rename must land in the same change or dev breaks.
- [ ] **Screenshots for it**: `public/images/shot-canvas.png`, `shot-sage.png`, and a
      `social-card.png` (1200x630) for `og:image`.
- [ ] **Self-host Instrument Sans/Serif** instead of the Google Fonts import, then narrow
      the CSP back down (drop the `fonts.googleapis.com`/`fonts.gstatic.com` allowances
      added 2026-09). Removes a render-blocking third-party request.
- [ ] **Replace the placeholder crest** (`public/images/crest-placeholder.svg`) with a real
      mark.

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
