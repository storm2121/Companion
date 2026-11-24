# Desk: status

Updated 2026-11-23. Everything after the "desk switch" commit is **not committed yet**.

## Done
- [x] Cloud rendering set up. Final pictures: night and day, lamp on/off, candle in two spots. Spent $10.48 of the $16 limit.
- [x] Desk sits behind the Home switch in Settings (committed).
- [x] 18 book spots: three stacks of five, a near stack of two, one flat book.
- [x] Move books by drag, keyboard or menu, with undo. Stacking works.
- [x] Lamp switch. One candle with two spots.
- [x] Small notebook (starts a new note). Big notebook (greeting, where you left off).
- [x] Book opening and closing animation, about 0.4 s.
- [x] Fixed today: "← Desk" not clickable, clicking through an open book, address not updating.
- [x] Fixed today: outlines show every spot a carried book or the candle can go.
- [x] Fixed today: lights change smoothly (lamp, day/night, candle).
- [x] Fixed today: leaving a small-notebook note returns to the desk.
- [x] Fixed 23 Nov evening: another page flashing when a book opens; reloading on a book.
- [x] Book opening replaced by a plain 0.3 s dissolve (0.15 s with Motion on "Still"). Nothing turns or slides.
- [x] Cleanup: the hidden night window's rain no longer runs behind the desk (page work at rest: 2 ms a second, was 61-65).
- [x] Cleanup: no grain layer over the desk or open book; the other time of day is no longer downloaded on every visit (new visitor: 4.96 MB, was 6.42).
- [x] Tests (236), linter and build pass. Old app code untouched.

## Next
- [ ] **You:** run `npm run dev`, then try the new opening, the lights and the highlights.
- [ ] To-do list opened from the small notebook: add, tick, reorder, delete. Decided, not built.
- [ ] Commit the work.

## Later (not built)
- [ ] Bookshelf: keep books there, stand at it, drag books to it.
- [ ] Move the big notebook closer.
- [ ] Street outside the window.
- [ ] Big notebook's left page as a schedule.
- [ ] Phones and small windows (they still get the old desk).

## Known small flaws
- A dropped book's top face changes light a moment after landing.
- First book opened after a reload takes about 0.6 s; later ones about 0.3 s.
- Switching night/day for the first time on a slow connection waits about a second before the fade starts.
- One slow frame inside the candle's light change.
- The night window shows for up to a second while the desk loads.
- At night, leather colours are hard to tell apart; the left stack looks near black.
- The flat book's label is too narrow for long names.
- The new opening was only checked at night, not by day.
- Not yet clicked through by hand: small notebook's way back, day/night change.

## Your decisions
- The desk's pictures stay in memory under an open note (about 130 MB) so coming back is instant. Keep, or let go after a few minutes?
- Hide the night window while the desk loads?
- Wider label on the flat book (about $1 of cloud credit).
- Pictures in git or not (179 MB).
- Set up a cloud agent for the bookshelf work?
- Fable builds from now on, or only this batch?

## Hosting numbers
- Pictures on disk: 148 MB (Firebase Hosting gives 10 GB free).
- A new visitor downloads about 5 MB for the desk on a normal screen (measured before the last fixes; re-measure before launch). Return visits: pictures come from the browser cache.
- Free transfer is 360 MB a day, so roughly 70 new visitors a day at no cost. Beyond that $0.15 per GB: about $0.75 per 1,000 new visitors.
- No server compute: the pictures are static files. Database use: one small write per move.

## Removed on purpose
- The mini jot note (replaced by the small notebook).
- Three candles down to one.
- No pen, desk calendar, clock or lofi radio.

## Parked
- The tuning pass (three runs left).
- Native app: discussed only.
