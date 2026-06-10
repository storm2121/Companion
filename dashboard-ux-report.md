# Dashboard & End-to-End Flow — UX Report
**Date:** June 10, 2026  
**Tester:** Claude (automated live browser testing)  
**App:** Companion — React + Vite SPA, Firebase backend  
**URL tested:** `localhost:5173/dashboard`  
**Scope:** Dashboard design, class/note management, create-note flow, enter-note flow, leave-note flow, overall product readiness

---

## Summary

| Category | Count |
|---|---|
| Critical bugs | 3 |
| High bugs | 6 |
| Medium bugs | 8 |
| UX/polish issues | 8 |
| Working well | 12 |

---

## 🔴 Critical Bugs

### 1. User avatar click navigates to Register/Login page — no logout confirmation
**Steps:** Click the user avatar (top-right corner of header).  
**Result:** The app immediately navigates to `localhost:5173/` — the Register/Login auth page. The user is taken out of the app with no confirmation, no "are you sure?", and no way to tell this would happen. The avatar does not show a dropdown menu; it is wired directly to a navigation action.  
**Expected:** Clicking an avatar should open a profile dropdown with options (Profile, Settings, Sign out). A direct navigational logout with no warning is a catastrophic UX anti-pattern.  
**Impact:** Any user who accidentally clicks the avatar loses their session context entirely.

---

### 2. "Loading profile..." hangs indefinitely on fresh tab load (Firestore permissions error)
**Steps:** Open the app in a new browser tab and navigate to `/dashboard`.  
**Result:** The page shows "Loading profile..." forever. No spinner animation. No timeout. No error message. No retry button. Console shows:
```
FirebaseError: Missing or insufficient permissions. (AuthContext.jsx:147)
FirebaseError: Missing or insufficient permissions. (Dashboard.jsx:192)
```
The profile listener throws a permissions error but the UI never reflects this — it stays on the loading screen permanently.  
**Impact:** Users who open a new tab get a completely broken, unrecoverable session. There is no fallback, error state, or way to proceed without a hard reload. Even hard reloads do not always resolve it.

---

### 3. Search bar is completely non-functional
**Steps:** Click the search bar → type "lecture" → press Enter.  
**Result:** Nothing happens. The notes panel does not filter. The class list does not filter. No dropdown of results appears. No navigation occurs. The search bar accepts text input and focus styling (amber border) but does not execute any search logic.  
**Impact:** The search bar is visually prominent (centered in the header, ~500px wide) and implies a core feature. It is entirely placeholder.

---

## 🟠 High Bugs

### 4. Settings gear is non-functional
**Steps:** Click the gear icon in the top-right header.  
**Result:** Nothing happens. No settings panel, no modal, no dropdown. The icon receives a hover/active state visually but triggers no action.  
**Impact:** Users who want to change account settings, preferences, or other configurations have no path.

---

### 5. Color picker dropdown overlaps class rows — swatch clicks mis-target
**Steps:** Click "..." on a class → click "Change color" → the color swatch panel expands inline. Now click one of the swatches.  
**Result:** The swatch dropdown overlaps the class items below it. Clicking a color swatch (which visually appears over another class row) registers as a click on the class row beneath, not the swatch. The color is not changed, and the class below gets selected instead.  
**Root cause:** The dropdown expands downward without enough z-index separation or repositioning. Pointer events fall through to the underlying class items.  
**Impact:** Color changing is functionally broken when the target class is not at the bottom of the list.

---

### 6. "Back" navigation shows empty state flash before content loads
**Steps:** Open a note from the dashboard → click "← Back".  
**Result:** The dashboard momentarily renders the empty state: "No classes yet / Create your first class to keep notes organized. / [New class button]" — for approximately 3–4 seconds — before the real class list loads. The breadcrumb shows bare "Classes" instead of "Classes / [ClassName]".  
**Impact:** Disorienting. Users who click Back quickly and then click a class item while in the empty state may not see their expected classes. The empty state is designed for new users; showing it to an existing user every time they leave a note is jarring.

---

### 7. Class note count in sidebar is sometimes stale / inaccurate
**Observed:**
- "TEST3" sidebar item showed "8 notes" but the notes panel for TEST3 showed "No notes yet in TEST3." (0 notes visible).
- "Paradigm" showed "2 notes" at session start, then "3 notes", then "4 notes" as new notes were created — but the sidebar count lagged behind the panel count in some states.  
**Impact:** Users cannot trust the note count as a reliable indicator of content.

---

### 8. Quick add lands on a completely blank canvas with no onboarding hint
**Steps:** On the dashboard, click "✏️ Quick add".  
**Result:** A new note is created instantly (named "Quick Note N") and the user is immediately dropped into an empty note editor — no text blocks, no content, no hint. The canvas shows only the dotted background pattern and the toolbar.  
**Impact:** First-time or new users have no idea what to do. There is no "Click + to add a block" hint, no default text block, and no empty-state guidance. The "Preparing note..." intermediate screen appears during this transition, which is good, but landing on a void canvas is disorienting.

---

### 9. Note opening is slow (~3–4 seconds) with no progress indication
**Steps:** Click any note row on the dashboard.  
**Result:** The entire screen goes black/dark with "Preparing note..." text in the center (very faint, hard to read). This lasts 3–4 seconds before the editor loads.  
**Issues:** (a) The text "Preparing note..." is very low-contrast against the dark background — barely readable. (b) There is no spinner or progress bar. (c) No skeleton/preview of the note content. (d) The transition back to a previous scroll position on the canvas is not preserved.

---

## 🟡 Medium Bugs

### 10. Class context menu missing "Rename" option
**Steps:** Click "..." on any class.  
**Result:** The menu shows only: "Change color" and "Delete class". There is no "Rename" option.  
**Impact:** Users cannot rename a class after creating it without deleting and recreating it.

---

### 11. Note context menu label "Change picture" misrepresents full functionality
**Steps:** Click "..." on a note row.  
**Result:** The menu shows: "Edit title", "Edit summary", "Change picture", "Delete note".  
**Issue:** "Change picture" opens an "Update note" modal containing **all three fields** — title, summary, and cover image — not just the picture. A user who wants to rename a note would logically click "Edit title" (which opens the same modal), making "Change picture" redundant and confusing. Having both "Edit title" and "Change picture" open the same modal is inconsistent.  
**Recommendation:** Remove "Edit title" and "Edit summary" as separate items. Have "Change picture" renamed to "Edit note details" or "Update note" — or inline the rename as a double-click on the note title.

---

### 12. Native `<input type="file">` is unstyled in modals
**Observed in:** "New note" modal and "Update note" modal.  
**Result:** The cover image upload uses a raw browser-native file input button ("Choose File / No file chosen") that breaks the visual design language. Every other input uses a custom-styled dark rounded field.

---

### 13. Duplicate note names allowed
**Observed:** Paradigm class contained two notes both named "Lecture 3" (one from 6/8, one from 6/10). No uniqueness check is enforced during creation.  
**Impact:** Users cannot reliably distinguish notes by name in the list.

---

### 14. "1 notes" grammar error on class items with single note
**Observed:** Multiple classes (e.g., "e.g", "EGR 4356") showed "1 notes" instead of "1 note".

---

### 15. Search bar retains stale text after navigating away and back
**Steps:** Type in the search bar → click a note → click Back.  
**Result:** The search bar still shows the previously typed text ("lecture"). It is not cleared on navigation. Since search doesn't work, this is doubly confusing.

---

### 16. "New note" and "Quick add" available even with no class selected
**Observed:** When no class is selected (notes panel says "Select a class"), the "+ New note" and "✏️ Quick add" buttons are still visible and active in the header. Clicking them when no class context is active creates a note in an ambiguous or incorrect class.

---

### 17. Color theme is extremely limited — only 2 options
**Observed:** The theme toggle cycles between "Stone" (dark) and "Mist" (light). There are only 2 themes despite the prominent toggle button in the header.

---

### 18. "New Class" modal appears as semi-transparent overlay on notes panel
**Steps:** Click the "+" button next to "Classes".  
**Result:** The "New Class" form appears rendered over the notes panel, with the note rows visible behind it at reduced opacity. It does not render as a true centered modal with a dark scrim behind it.  
**Impact:** Visually messy. The form fields feel unstable because content bleeds through.

---

## 🔵 UX / Polish Issues

### 19. No hover state on class list items
Class rows have no hover highlight. The cursor changes to a pointer but the row background does not change. Combined with the always-visible drag handles and "..." menu, it is hard to tell what is clickable.

### 20. Drag handles visible at all times (visual noise)
Both the class list and note list show drag-handle icons (⠿) on every row at all times, even when the user is not about to drag. These add visual noise. Standard practice is to show drag handles only on hover.

### 21. Breadcrumb "Classes / Paradigm" is not clickable
The breadcrumb in the header (below "Companion") shows the navigation path but neither "Classes" nor "Paradigm" is a clickable link. There is no way to navigate up a level without the "← Back" button from inside a note.

### 22. Note row checkbox — purpose is unclear
Every note row has a checkbox on the left. It can be checked/unchecked but there is no bulk action toolbar that appears when notes are selected. The checkbox has no visible function.

### 23. "Preparing note..." text is very low contrast
The loading text during note opening is rendered in a very dark gray on a dark background. It is barely readable. Contrast ratio is likely below WCAG AA minimum (4.5:1).

### 24. No confirmation on "Delete class"
Clicking "Delete class" in the class context menu immediately deletes the class with no confirmation dialog. Given that a class can contain many notes, this is a destructive action with no safeguard.

### 25. Auth page email placeholder is domain-locked ("you@aui.ma")
The login/register page shows `you@aui.ma` as the email placeholder, confirming the product is restricted to AUI students. While intentional, this should be clearly communicated on the dashboard or onboarding, not discovered accidentally when the avatar is clicked.

### 26. No "move note to another class" option
Notes can only be deleted from the dashboard — there is no way to move a note to a different class without recreating it.

---

## ✅ What Works Well

| Feature | Notes |
|---|---|
| Two-panel dashboard layout | Clean, well-structured |
| Class switching | Instant, no perceptible latency |
| Note list with rich previews | Photo thumbnail + subtitle shown when available |
| Note context menu (4 options) | Edit title, Edit summary, Change picture, Delete note |
| Class context menu | Change color, Delete class |
| Color picker swatch UI | Inline expansion is a nice pattern (execution has hit-target bug) |
| "New note" modal | Clean design, good template selection (Blank, Math, Custom) |
| Note templates | Blank / Math / Create your own — good discoverability |
| "Quick add" speed | Zero friction note creation |
| Quick Note auto-naming | "Quick Note N" naming is sensible |
| Theme toggle (Stone ↔ Mist) | Instant, full-app re-theme |
| Empty state design | "No notes yet in X" and "Choose a class" states are clean |
| New Class modal | Clear form, good placeholder ("e.g. CSC 2302"), color theme dropdown |
| "← Back" from note editor | Returns to dashboard correctly |
| Note editor entry flow | Click note → "Preparing note..." → editor loads |
| Dashboard loads correctly after Back navigation | (with a brief delay) |
| Notes panel scrollbar | Visible and functional |

---

## End-to-End Flow Assessment

### Create note flow
**"+ New note":** Dashboard → modal (title, summary, template, cover image) → confirm → note editor. Clean, good template selection. Loses points for unstyled file input.  
**"Quick add":** Dashboard → instant creation → blank canvas. Fast but no guidance on landing.  
**Rating: 3/5** — functional but missing: blank canvas onboarding, unstyled file input, slow load with no progress.

### Enter note flow
Dashboard note click → "Preparing note..." (3-4s, low-contrast) → editor loads.  
**Rating: 2/5** — works but the loading experience is poor: no skeleton, near-invisible loading text, no animation.

### Leave note flow
"← Back" button → brief empty state flash → dashboard loads (~4s delay).  
**Rating: 2/5** — functional but the empty-state flash is disorienting and the delay is noticeable.

### Overall dashboard UX
Clean layout, well-thought-out two-panel structure, good note preview cards. Severely undermined by: non-functional search, non-functional settings, the avatar logout trap, and the loading state issues.  
**Rating: 2.5/5**

---

## Priority Fix List

**Fix before any user testing:**
1. Bug #1 — Avatar click logs user out (wire to profile dropdown instead)
2. Bug #3 — Search bar does nothing (implement or hide)
3. Bug #2 — Loading profile failure has no error/retry state
4. Bug #4 — Settings gear does nothing (implement or hide)

**Fix before public release:**
5. Bug #6 — Empty state flash on Back navigation
6. Bug #5 — Color picker click-through to underlying class rows
7. Bug #9 — "Preparing note..." is near-invisible
8. Bug #8 — Quick add lands on void canvas (add a default empty text block)
9. UX #19 — Add hover states to class/note rows
10. UX #24 — Add "Delete class" confirmation dialog
11. Bug #10 — Add "Rename class" to class context menu
12. Bug #14 — Fix "1 notes" → "1 note" grammar

**Polish pass:**
13. Bug #12 — Style the file input in modals
14. Bug #11 — Consolidate "Edit title"/"Edit summary"/"Change picture" into one "Edit note" option
15. UX #22 — Implement bulk select or remove checkbox from note rows
16. UX #21 — Make breadcrumb clickable for navigation
17. UX #20 — Show drag handles only on hover
18. Bug #16 — Disable "New note"/"Quick add" when no class is selected
19. Bug #15 — Clear search input on navigation

---

*Report generated from live automated browser testing session. No code changes were made during testing.*
