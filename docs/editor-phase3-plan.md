# Phase 3 — Structured Editor Migration (design / greenlight doc)

Status: **proposed, not started.** Phases 1 (bug fixes) and 2 (delta persistence) shipped on
branch `editor-fixes-delta-persistence`. This doc is what to approve before starting Phase 3.

## Why
Today the text core is hand-rolled `contentEditable` + regex cleanup (`cleanupFontSizeArtifacts`,
`normalizeLegacyFontNodes`, paste sanitizer). Phase 1 made it *correct*, but the underlying model is
still "browser-generated HTML that we repair after the fact." That class of bug (spaces, sizes,
paste junk) never fully goes away with contentEditable — you only whack-a-mole it.

A **structured document model** stores the note as data (typed nodes/marks), renders deterministically,
and makes spaces/sizes/paste *impossible* to corrupt because there's no HTML to repair. This is what
Google Docs / MS Loop do. Phase 3 is the investment that ends the bug class for good.

**This is optional.** The reported bugs are already fixed. Phase 3 buys long-term consistency and
maintainability, at the cost of a multi-session rewrite with real regression risk.

## Framework
**Recommended: TipTap** (ProseMirror-based, React bindings).
- Built-in: tables, task lists (checklists), `TextStyle`+`FontSize`/`FontFamily`/`Color`/`Highlight`
  marks, alignment, history (undo/redo), and an HTML <-> JSON bridge for migration.
- Fastest path to feature parity with the current toolbar.
- Cost: heaviest bundle of the options (the app is already a 970 kB single chunk — code-split this).

Alternative: **Lexical** (Meta) — lighter, cleaner node API, but tables/checklists/font controls are
more hand-built. Choose if bundle size matters more than time-to-parity.

## Architecture
- Keep the react-rnd block canvas, lock/priority/collapse, templates, image blocks — **unchanged**.
- Replace only the **text block body**: each text block renders its own small TipTap editor instance.
- `block.value` stores the block's content. Store **TipTap/ProseMirror JSON** (canonical, structured)
  and treat HTML as import/export only.
- **Reuse Phase 2 persistence as-is** — delta saves don't care whether `block.value` is HTML or JSON.

## Feature-parity checklist (must re-implement against TipTap)
- [ ] Marks: bold, italic, underline, strikethrough
- [ ] Font size (TextStyle + FontSize), font family, text color, highlight color
- [ ] Paragraph: alignment (left/center/right/justify), line-height
- [ ] Lists: bullet, ordered, **checklist (TaskList/TaskItem)**
- [ ] Blockquote
- [ ] **Tables** (insert, add/remove row/col, resize) — Table/TableRow/TableCell extensions
- [ ] Paste: rely on ProseMirror's schema-validated paste (replaces the custom sanitizer)
- [ ] Toolbar wiring: replace `document.execCommand`/`applySelectionCommand` with TipTap `editor.chain()`
- [ ] Font-size input + held-selection highlight behavior
- [ ] Undo/redo: use TipTap history (drop the bespoke history stack for text; keep it for block layout)
- [ ] Copy/paste text *style* feature

## Migration (data)
- Existing notes store contentEditable HTML in `block.value`. TipTap can ingest HTML directly
  (`generateJSON(html, extensions)`), so on first open convert HTML -> JSON once and persist (the
  Phase 2 delta save handles writing it back).
- Keep a reader that accepts both HTML (legacy) and JSON during the transition.

## Rollout (low-risk)
1. Add a feature flag (e.g. `editorV2`) and a new text-block renderer; old renderer stays default.
2. Build TipTap block behind the flag; reach feature parity using the checklist above.
3. Dogfood on a test class. Validate paste, tables, checklists, sizes, save/reload.
4. Flip default to v2 for new notes; lazily migrate old notes on open.
5. Remove the contentEditable code + cleanup helpers once v2 is the only path.

## Risks
- **Regression risk** across a feature-rich editor — mitigated by the flag + parity checklist + keeping
  the old path until v2 is proven.
- **Bundle size** — mitigated by dynamic-importing the editor (also fixes the existing 970 kB chunk warning).
- **Per-block editor instances** (many TipTap instances on one canvas) — validate performance early with
  a note that has 20+ text blocks.

## Effort
Multi-session. Rough milestones: (1) flag + bare TipTap block + JSON persistence, (2) marks + paragraph
+ font controls, (3) lists + checklists + blockquote, (4) tables, (5) migration + cutover + cleanup.
