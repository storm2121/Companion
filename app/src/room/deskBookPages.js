// The opened book's pages (round eight, run 3) — PURE: the held picture on the window, the words on its
// paper (one quad per page, each line set true to the page's cup), the course's name and next class.
// See deskBook.js for what the book is and when it shows.

import { addDays, breakOn, cleanSchedule, meetsOn, parseYmd, WEEKDAY_NAMES, ymd } from './calendarDays.js';
import { fitSpineTitle } from './deskStage.js';

/* ── The picture on the window ──────────────────────────────────────────── */

// The top line's band (its pills) the book's words keep clear of, and the least margin round the book.
export const BOOK_TOP = 76;
export const BOOK_MARGIN = 4;

// The picture's place on the window (css px): as large as covers the window, but never so large that the
// book (`box`) leaves the window or its words (the pages' text areas) reach under the top line's band; the
// book centred on the window. Where the picture does not reach (a window wider than it at the scale the book
// allows), `bars`: the window's ground shows (the production pictures will carry a surround, as the stage's
// do).
// Run 3 with the production pictures: `extent` (the held picture's surround, scene2 held.surround: the room
// round the frame, -1050, -120, 3900 x 1320) is what covers the window, so the book takes the size its box
// allows and the surround fills the rest: no bars from 32:9 to 5:4. Without it, the frame alone.
export const heldFit = (view, held, { top = BOOK_TOP, margin = BOOK_MARGIN, extent = null } = {}) => {
  const [W, H] = held.frame;
  const ext = extent || { x: 0, y: 0, width: W, height: H };
  const [x0, y0, x1, y1] = held.box;
  const cy = (y0 + y1) / 2;
  const words = held.pages ? Math.min(...['left', 'right'].map((side) => Math.min(...held.pages[side].quad.map((p) => p[1])))) : y0;
  const cover = Math.max(view.width / ext.width, view.height / ext.height);
  const byWidth = Math.max(1, view.width - 2 * margin) / (x1 - x0);
  const byHeight = Math.max(1, view.height - 2 * margin) / (y1 - y0);
  const byBand = cy > words ? Math.max(0.05, view.height / 2 - top) / (cy - words) : Infinity;
  const scale = Math.min(cover, byWidth, byHeight, byBand);
  const width = W * scale;
  const height = H * scale;
  let left = view.width / 2 - ((x0 + x1) / 2) * scale;
  let topPx = view.height / 2 - cy * scale;
  // Over the whole window where it can be (never past the book's own place, nor past the extent's edge).
  const ew = ext.width * scale;
  const eh = ext.height * scale;
  const ex = ext.x * scale;
  const ey = ext.y * scale;
  left = ew >= view.width ? Math.min(-ex, Math.max(view.width - ew - ex, left)) : (view.width - ew) / 2 - ex;
  topPx = eh >= view.height ? Math.min(-ey, Math.max(view.height - eh - ey, topPx)) : (view.height - eh) / 2 - ey;
  return { scale, left, top: topPx, width, height, bars: ew < view.width - 0.5 || eh < view.height - 0.5 };
};
// A picture point (1x px) on the window.
export const onWindow = (fit, [x, y]) => [fit.left + x * fit.scale, fit.top + y * fit.scale];

/* ── Words on paper: one quad per page, and each line set true to the page's cup ── */

// The homography taking four points onto four points (3x3, row-major, h33 = 1).
export const homography = (src, dst) => {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
};
// Gaussian elimination with partial pivoting (small systems).
const solve = (A, b) => {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (!f) continue;
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
};
export const applyH = (h, [x, y]) => {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};
const invertH = (h) => {
  const [a, b, c, d, e, f, g, k, i] = h;
  const A = e * i - f * k;
  const B = -(d * i - f * g);
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  const inv = [A, -(b * i - c * k), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * k - b * g), a * e - b * d].map((v) => v / det);
  return inv.map((v) => v / inv[8]);
};
// CSS matrix3d (column-major) for a flat box's (x, y) through h.
export const matrix3dOf = (h) =>
  `matrix3d(${[h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]].map((v) => Number(v.toPrecision(10))).join(', ')})`;

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// The grid at a fraction down (fy) and across (fx) the text area (bilinear between its points), 1x px.
export const gridAt = (grid, fy, fx) => {
  const R = grid.length;
  const C = grid[0].length;
  const y = Math.max(0, Math.min(1, fy)) * (R - 1);
  const x = Math.max(0, Math.min(1, fx)) * (C - 1);
  const i = Math.min(Math.floor(y), R - 2);
  const j = Math.min(Math.floor(x), C - 2);
  const ty = y - i;
  const tx = x - j;
  const p = (r, c) => grid[r][c];
  return [0, 1].map((k) => p(i, j)[k] * (1 - tx) * (1 - ty) + p(i, j + 1)[k] * tx * (1 - ty) + p(i + 1, j)[k] * (1 - tx) * ty + p(i + 1, j + 1)[k] * tx * ty);
};

// One page on the window: its flat text box (css px, the text area's own size at this scale) and the
// homography (and CSS) taking that box onto the text area's corners.
export const pageOnWindow = (page, fit) => {
  const q = page.quad;
  const w = ((dist(q[0], q[1]) + dist(q[3], q[2])) / 2) * fit.scale;
  const h = ((dist(q[0], q[3]) + dist(q[1], q[2])) / 2) * fit.scale;
  const dst = q.map((p) => onWindow(fit, p));
  const H = homography([[0, 0], [w, 0], [w, h], [0, h]], dst);
  return { w, h, H, inv: invertH(H), css: matrix3dOf(H), page, fit };
};

// A line's own correction inside its page (run 3): the page's one quad leaves a line up to 1.7-2.3 css px
// off the grid at scale 1 (the paper cups: its lines bow, which no single quad can follow), so each line
// (or each column of a line, `from`..`to` across) is laid with a small 2D transform inside the page's quad,
// the least-squares fit of its own band to the grid. Returns a CSS matrix() for an element placed at
// (x, y) in the flat box with its transform-origin at 0 0.
const affineFit = (src, dst) => {
  // Normal equations for x' = a x + c y + e, y' = b x + d y + f.
  const N = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const ux = [0, 0, 0];
  const uy = [0, 0, 0];
  src.forEach(([x, y], k) => {
    const r = [x, y, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) N[i][j] += r[i] * r[j];
      ux[i] += r[i] * dst[k][0];
      uy[i] += r[i] * dst[k][1];
    }
  });
  const [a, c, e] = solve(N, ux);
  const [b, d, f] = solve(N, uy);
  return [a, b, c, d, e, f];
};
export const lineFix = (pw, y, height, from = 0, to = 1) => {
  const { w, h, inv, page, fit } = pw;
  const src = [];
  const dst = [];
  [y, y + height / 2, y + height].forEach((yy) => {
    for (let k = 0; k <= 8; k += 1) {
      const fx = from + ((to - from) * k) / 8;
      src.push([fx * w, yy]);
      dst.push(applyH(inv, onWindow(fit, gridAt(page.grid, yy / h, fx))));
    }
  });
  return affineFit(src, dst);
};
// The CSS for an element at flat (x, y) with the fix A.
export const fixCss = (A, x, y) => {
  const [a, b, c, d, e, f] = A;
  return `matrix(${[a, b, c, d, a * x + c * y + e, b * x + d * y + f].map((v) => Number(v.toPrecision(9))).join(', ')})`;
};
// Fixes looked up by a line's top (rounded to 1 css px) and its columns: computed once each.
// A page whose one quad holds every point of its grid within 1.5 css px (`page.flat`: the production
// pictures, 0.62 css px at the worst at scale 0.7) takes no fix: one flat quad per page.
const NO_FIX = [1, 0, 0, 1, 0, 0];
export const fixCache = (pw) => {
  if (pw.page?.flat) return () => NO_FIX;
  const memo = new Map();
  return (y, height, from = 0, to = 1) => {
    const key = `${Math.round(y)}:${Math.round(height)}:${from}:${to}`;
    if (!memo.has(key)) memo.set(key, lineFix(pw, Math.round(y), Math.round(height), from, to));
    return memo.get(key);
  };
};

// How far a line lands from where the grid says (css px, worst over every band `band` css px tall down the
// page): with the page's one quad only (`fixed` false), or with each line's own fix over `cols`.
export const quadError = (page, scale, { band = 20, cols = [[0, 1]], fixed = true } = {}) => {
  const fit = { scale, left: 0, top: 0 };
  const pw = pageOnWindow(page, fit);
  let worst = 0;
  for (let y = 0; y + band <= pw.h; y += 2) {
    cols.forEach(([from, to]) => {
      const A = fixed ? lineFix(pw, y, band, from, to) : [1, 0, 0, 1, 0, 0];
      [y, y + band / 2, y + band].forEach((yy) => {
        for (let k = 0; k <= 12; k += 1) {
          const fx = from + ((to - from) * k) / 12;
          const flat = [fx * pw.w, yy];
          const moved = [A[0] * flat[0] + A[2] * flat[1] + A[4], A[1] * flat[0] + A[3] * flat[1] + A[5]];
          worst = Math.max(worst, dist(applyH(pw.H, moved), onWindow(fit, gridAt(page.grid, yy / pw.h, fx))));
        }
      });
    });
  }
  return worst;
};

/* ── What the pages say ─────────────────────────────────────────────────── */

// The course's name on the left page: one or two lines at `size`, else two at `small`, else the spine's
// own rule (deskStage.js fitSpineTitle: abbreviated, spared, then cut) at `small`. `measure(text, size)`
// gives a line's width in css px.
const SMALL_WORDS = new Set(['of', 'the', 'a', 'an', 'and', '&', 'in', 'on', 'for', 'to', 'at', 'by', 'with', 'from']);
export const bookTitle = (name, { width, size, small, measure }) => {
  const text = String(name || '').trim().replace(/\s+/g, ' ');
  if (!text) return { lines: [], size };
  const words = text.split(' ');
  // A first line never ends on a small word ("Comparative Politics / of the Middle East", not "... of /
  // the Middle East"), unless no other break holds; of the rest, the most even.
  const twoAt = (s) => {
    if (measure(text, s) <= width) return [text];
    let best = null;
    for (let k = 1; k < words.length; k += 1) {
      const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      const widths = lines.map((line) => measure(line, s));
      if (Math.max(...widths) > width) continue;
      const loose = SMALL_WORDS.has(words[k - 1].toLowerCase());
      const balance = Math.abs(widths[0] - widths[1]);
      if (!best || (best.loose && !loose) || (best.loose === loose && balance < best.balance)) best = { lines, balance, loose };
    }
    return best ? best.lines : null;
  };
  const big = twoAt(size);
  if (big) return { lines: big, size };
  const less = twoAt(small);
  if (less) return { lines: less, size: small };
  const cut = fitSpineTitle(text, { width, height: small * 2.4, spineHeight: 80, base: small, floor: small, lineHeight: 1.2, measure: (line, s) => measure(line, s) });
  return { lines: cut.lines.length ? cut.lines : [text], size: small };
};

// A course's next class from now ("Today 13:30", "Tomorrow", "Wednesday 13:30"), within a fortnight and
// outside the breaks; '' when it has no schedule or none comes.
export const nextClass = (course, now = new Date(), breaks = []) => {
  const schedule = cleanSchedule(course?.schedule);
  if (!schedule) return '';
  const todayKey = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i <= 14; i += 1) {
    const key = addDays(todayKey, i);
    if (!meetsOn(schedule, key) || breakOn(breaks, key)) continue;
    if (i === 0 && schedule.time) {
      const [hh, mm] = schedule.time.split(':').map(Number);
      if (hh * 60 + mm <= nowMin) continue;
    }
    const day = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WEEKDAY_NAMES[parseYmd(key).getDay()];
    return schedule.time ? `${day} ${schedule.time}` : day;
  }
  return '';
};

// The held picture's file at a fit (fix run, Faults 2 and 3): its 2x file only where its 1x would be drawn up by more
// than 30% on the screen. (At 1.05 the owner's window, 1536 x 750 at 1.25, took the 2x held picture and surround,
// 31 + 82 MB decoded, and their first upload held the film's first frames 58 ms on the GPU; drawn 6% up, the 1x
// files look the same.)
export const heldDense = (scale, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) => scale * dpr > 1.3;

// Owner fixes (2026-11-23, E): the open book's OWN outline on the window: its boards' edge round the two pages, as two
// halves that meet on the spine (each { poly: TL TR BR BL, box: [x, y, w, h] }, window px) and the spine's x. The
// held picture is one whole frame (book, rest and table together); cut to this outline, the book in it is a thing
// that can move on its own: the book film lets it settle into its place while the page comes in.
// The boards pass the pages by these much (1x picture px, measured on prod1's held pictures: the paper's corners
// against the leather's; the paper dips toward the spine, so the boards pass it by more there).
export const BOOK_EDGE = { outLeft: 25, outRight: 20, top: 24, foot: 14, spine: 35 };
// `dpr`: each half's box is taken out to whole device pixels (its layer then lies on the pixel grid: with a box on a
// fraction of a pixel the half's layer was snapped and its words stood a pixel off where they stood before).
export const bookOutline = (pages, fit, edge = BOOK_EDGE, dpr = 0) => {
  const at = ([x, y]) => [Math.round((fit.left + x * fit.scale) * 100) / 100, Math.round((fit.top + y * fit.scale) * 100) / 100];
  const [lTL, lTR, lBR, lBL] = pages.left.page;
  const [rTL, rTR, rBR, rBL] = pages.right.page;
  const sx = (lTR[0] + lBR[0] + rTL[0] + rBL[0]) / 4;
  const sTop = Math.min(lTR[1], rTL[1]) - edge.spine;
  const sFoot = Math.max(lBR[1], rBL[1]) + edge.spine;
  const half = (poly) => {
    const p = poly.map(at);
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    const down = (v) => (dpr ? Math.floor(v * dpr) / dpr : v);
    const up = (v) => (dpr ? Math.ceil(v * dpr) / dpr : v);
    const x = down(Math.min(...xs));
    const y = down(Math.min(...ys));
    return { poly: p, box: [x, y, Math.round((up(Math.max(...xs)) - x) * 1000) / 1000, Math.round((up(Math.max(...ys)) - y) * 1000) / 1000] };
  };
  return {
    spine: at([sx, 0])[0],
    left: half([[lTL[0] - edge.outLeft, lTL[1] - edge.top], [sx, sTop], [sx, sFoot], [lBL[0] - edge.outLeft, lBL[1] + edge.foot]]),
    right: half([[sx, sTop], [rTR[0] + edge.outRight, rTR[1] - edge.top], [rBR[0] + edge.outRight, rBR[1] + edge.foot], [sx, sFoot]]),
  };
};
// A half's outline as a CSS clip-path in its own box.
export const outlineClip = ({ poly, box }) => `polygon(${poly.map(([x, y]) => `${(x - box[0]).toFixed(2)}px ${(y - box[1]).toFixed(2)}px`).join(', ')})`;
