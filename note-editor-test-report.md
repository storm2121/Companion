# Note Editor — Full UX & Bug Report
**Date:** June 6, 2026  
**Tester:** Claude (automated live browser testing)  
**App:** React + Vite SPA, TipTap rich text editor, Firebase backend  
**URL tested:** `localhost:5173/class/fawaKujkUqtOTGWgKeoR/note/UUeIRT9AOVbQz2vaWkPT`

---

## Summary

| Category | Count |
|---|---|
| Critical bugs | 3 |
| High bugs | 5 |
| Medium bugs | 6 |
| UX/polish issues | 7 |
| Working features | 23 |

---

## 🔴 Critical Bugs

### 1. Collapse → Expand destroys all TipTap content
**Steps:** Click the `^` collapse button in a text block header → click again to expand.  
**Result:** The TipTap editor remounts with an empty document. All content is gone. Ctrl+Z inside the editor does not restore it. The canvas-level undo button (↺) *can* recover it, but most users will not know this.  
**Root cause:** When collapsed, the TipTap component is unmounted from the DOM. On expand it remounts fresh, calling `useEditor({ content: block.value || '' })`. If the `onUpdate` callback fired with an empty HTML string during unmounting, it overwrote `block.value` in React state before remount. The new editor then initializes to `''`.  
**Impact:** Catastrophic data loss risk for any user who collapses a block.

---

### 2. Context menu format actions (Bold/Italic/Underline/Strikethrough) are broken
**Steps:** Select text in a TipTap block → right-click → click Bold (or Italic/Underline/Strikethrough).  
**Result:** Nothing happens. The format is not applied.  
**Root cause:** `executeContextAction()` calls `applySelectionCommand(blockId, formatCommand)` which is the legacy `document.execCommand` path. With `USE_TIPTAP_EDITOR = true`, this path does nothing because the TipTap editor does not use `contentEditable` in the same way. The correct path is `applyTiptapAction(blockId, formatCommand)`.  
**Both Bold and Italic were tested and confirmed broken.**

---

### 3. Photo block button is completely non-functional
**Steps:** Click the `+` FAB button → click "Photo block".  
**Result:** Nothing happens. No photo block is added. No file picker opens. The FAB menu remains open. The button is not disabled.  
**Root cause:** Unknown (would require code inspection), but programmatic `.click()`, pointer event dispatch, and repeated coordinate-based clicking all failed silently.  
**Impact:** Photo blocks cannot be added to notes at all.

---

## 🟠 High Bugs

### 4. Copy Style / Paste Style does not work with TipTap
**Steps:** Select bold text → click "Copy Style" toolbar button → select other text → click "Paste Style".  
**Result:** No formatting is applied to the target text.  
**Root cause:** `pasteCopiedStyle()` calls `applySelectionCommand(blockId, cmd)` — the legacy `execCommand` path — even when `USE_TIPTAP_EDITOR = true`. It should call `applyTiptapAction`.  Additionally, `copyCurrentStyle()` uses deprecated `document.queryCommandState()` which may not correctly read TipTap's mark state.

---

### 5. Line spacing dropdown does not apply
**Steps:** Click inside a TipTap text block → click the line-height dropdown → select a value (e.g. 1.6).  
**Result:** Line spacing is not applied.  
**Root cause:** The line-height selector is a custom popup with `onClick` handlers. When the popup item is clicked, focus has already left the TipTap editor, so `activeTextId` is null. The `updateTextStyle` function returns early without applying the change.

---

### 6. Font size +/- does not change existing text without selection
**Steps:** Click inside a TipTap block (no text selected) → click `+` or `-` font-size buttons.  
**Result:** The toolbar counter increments/decrements but no visible text size changes.  
**Root cause:** Without a selection, TipTap's `setFontSize` stores the size as a mark for the *next typed character* only. Existing text is not affected. Block-level base font size is only changed via `updateTextStyle` (the direct number input), not via the +/- buttons in this code path.

---

### 7. Block color picker: gradient click closes without applying; Tab leaks into editor
**Two sub-bugs:**

**7a.** Clicking anywhere in the gradient area of the color picker closes the picker without applying the selected color. Only the hex/RGB input fields can be used to set a value.

**7b.** After filling the R, G, B fields and pressing Tab, the Tab keystroke escapes the color picker focus and lands in the TipTap editor — which then inserts the last typed characters as text content. Tested: typing "160" into the B field then pressing Tab caused "160" to appear in the note.

---

### 8. Font family native `<select>` loses TipTap focus and selection
**Steps:** Select text in TipTap → click the font family `<select>` → choose a font from the native dropdown.  
**Result:** The native OS dropdown opening steals focus from TipTap, clearing the selection. The font change fires but with no selection it only marks the *next typed character*, not the originally selected text.  
**Workaround found during testing:** Programmatically setting the select value via `form_input` tool fires the `change` event without the OS focus grab, which successfully applied Georgia to the selected text.

---

## 🟡 Medium Bugs

### 9. Canvas scrollbar is invisible
**CSS rule:** `.note-canvas-scroll { scrollbar-color: transparent transparent; }`  
**Result:** The canvas can be scrolled (via mouse wheel and the pan arrows), but there is zero visual indication of scroll position or canvas size. Users have no way to know how far they have scrolled or how much content is off-screen.

---

### 10. Task/checkbox list items render as plain white squares
**Steps:** Insert a task list item via the ✓ toolbar button.  
**Result:** Checkboxes display as solid white squares instead of interactive checkbox UI. The "Task to do" and "Another task" items in the test block both showed white squares instead of actual checkboxes. Clicking the square had no visible toggle effect.

---

### 11. Priority toggle: no visual indicator on block
**Steps:** Open "..." menu → click "Priority off" (turns to "Priority on").  
**Result:** The internal state changes (menu label flips to "Priority on"), but there is no star, badge, border highlight, or any visible indicator on the block itself to show it is high-priority.

---

### 12. Bullet list nesting: "Item three" escapes the list
**Content observed:** A bullet list containing "Item one" → "Item two" (nested) → "Item three". "Item three" renders as a plain paragraph outside the list, not as a third bullet. This is a content/HTML structure bug where the list terminates prematurely.

---

### 13. Add page / page navigation unclear
**Steps:** Click `+` FAB → "Add page".  
**Result:** The FAB menu closes but no visible change occurs on canvas. DOM inspection showed only 1 `page-shell` element. The four navigation arrows (↓↑←→) on the right edge function as canvas pan/scroll buttons, not page navigators — all four were clickable and scrolled the canvas view. It is unclear whether a second page was actually created.

---

### 14. Block delete has no confirmation dialog
**Steps:** Right-click on a block → "Delete block".  
**Result:** Block is immediately and permanently deleted with no confirmation prompt. While canvas undo can recover it, there is no warning before a potentially destructive action.

---

## 🔵 UX / Polish Issues

### 15. Block header font size is illegibly small
**CSS:** `.note-block-header { font-size: 0.7rem; }` = **10.5px**  
At default system font size the block header text ("Text block", block title) is barely readable. Minimum recommended body text is 12–14px.

### 16. Default canvas text base size is 12px
`BLOCK_DEFAULTS = { text: { fontSize: 12 } }`  
12px is at the low end of readability, especially in a note-taking context. 14–16px would serve most users better.

### 17. Toolbar buttons are 28px tall
`.text-command-group button { height: 28px; }` (24px on mobile)  
Small touch targets. The minimum recommended tap target is 44×44px (Apple HIG / WCAG).

### 18. Toolbar color defaults to white
`toolbarColor` initial state is hardcoded to `'#ffffff'`, and `activeTextColor` falls back to `'#ffffff'` regardless of the block's `textColor` value. When a block with a non-white text color is focused, the toolbar color swatch does not reflect the actual text color until the selection changes.

### 19. Back button has no label
The top-left navigation is a bare `←` icon with no label. There is no indication of where it navigates to (back to class notes list).

### 20. Canvas has no spatial orientation cues
The infinite canvas has no grid, no page border/shadow, and no zoom level indicator. After scrolling, users have no way to orient themselves or know how content is laid out relative to the viewport. Combined with the invisible scrollbar (bug #9), the experience of navigating a large canvas is disorienting.

### 21. No keyboard shortcut to toggle collapse
Block collapse requires clicking a small `^` icon. Given the critical content-wipe bug (#1), this is also a safety concern.

---

## ✅ Confirmed Working Features

| Feature | Notes |
|---|---|
| TipTap editor loads and accepts typed input | ✅ |
| Bold via Ctrl+B and toolbar button | ✅ |
| Italic via Ctrl+I and toolbar button | ✅ |
| Underline via Ctrl+U and toolbar button | ✅ |
| Strikethrough via toolbar button | ✅ |
| Bullet list via toolbar | ✅ |
| Numbered list via toolbar | ✅ |
| Nested list (Tab key for indent inside list) | ✅ |
| Blockquote via toolbar | ✅ |
| Table insertion via toolbar | ✅ |
| Horizontal alignment (L/C/R/Justify) | ✅ |
| Font family via native select (programmatic workaround) | ✅ (with workaround) |
| Font size direct number input (block-level) | ✅ |
| Font size +/- when text is selected | ✅ |
| Text color via RGB input fields | ✅ (gradient click broken) |
| Highlight/background color | ✅ |
| Canvas-level undo (↺ button) | ✅ |
| Block title rename (via "..." menu) | ✅ |
| Pin / Unpin block | ✅ (prevents drag) |
| Priority toggle | ✅ (state changes, no visual) |
| Block collapse | ✅ (CAUTION: critical bug #1) |
| Block drag to reposition (when unpinned) | ✅ |
| Block resize by dragging edges | ✅ |
| Add text block via FAB | ✅ |
| Delete block via context menu | ✅ |
| Cross-block copy/paste (Ctrl+C / Ctrl+V) | ✅ |
| Canvas scroll via mouse wheel | ✅ |
| Canvas pan via arrow buttons | ✅ |

---

## Priority Recommendations

**Fix immediately (blocking usability):**
1. Bug #1 — Collapse/expand content wipe (data loss)
2. Bug #3 — Photo block non-functional
3. Bug #2 — Context menu format actions broken

**Fix before next user test:**
4. Bug #4 — Copy/Paste Style (wrong code path)
5. Bug #5 — Line spacing dropdown loses focus
6. Bug #9 — Invisible canvas scrollbar
7. UX #15 — Block header 10.5px font size
8. UX #16 — Default 12px base font size

**Polish pass:**
9. Bug #7b — Tab key leaks from color picker into editor
10. Bug #10 — Checkbox rendering (white squares)
11. Bug #11 — Priority: add visual indicator on block
12. Bug #8 — Font family select focus loss (consider custom dropdown)
13. UX #18 — Toolbar color not reflecting active block's text color
14. UX #20 — Add grid/orientation to canvas

---
*Report generated from live automated browser testing session.*
