// The desk's quads -> CSS (prototype Home, the stage in DeskStage.jsx) — PURE.
//
// Blender renders the room from one camera and writes, for every surface that carries words
// (the notebook's pages, each book's spine, the scrap, the frame's opening), its four corners
// in stage px (scene.json: TL, TR, BR, BL). Words are real HTML, laid out flat at a chosen
// size and carried onto their quad by the one projective map (a homography) that takes the
// element's rectangle to those corners — as a CSS matrix3d, so they sit exactly where the
// render says, foreshortened as the surface is. A homography maps straight lines to straight
// lines: a line of text stays a line, only drawn in perspective.

const EPS = 1e-12;

// Solve the 8x8 system A x = b by Gaussian elimination with partial pivoting.
const solve = (A, b) => {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < EPS) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
};

// The 3x3 homography (row-major, h33 = 1) taking the four points `from` to `to`
// ([[x, y], ...] in the same order), or null when they are degenerate.
export const homography = (from, to) => {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(u, v);
  }
  const h = solve(A, b);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
};

// A point through the homography.
export const apply = (H, [x, y]) => {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
};

// The homography taking an element's own rectangle (0,0)-(width,height) to `quad`.
export const rectToQuad = (quad, width, height) =>
  homography(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    quad,
  );

const fixed = (n) => {
  const v = Number(n.toFixed(9));
  return Object.is(v, -0) ? 0 : v;
};

// matrix3d's terms by significant digits, not decimals: its perspective terms are ~1e-5, and
// nine decimals of those moved a far corner by 1e-4 px.
const sig = (n) => {
  const v = Number(n.toPrecision(12));
  return Object.is(v, -0) ? 0 : v;
};

// The CSS transform that draws an element of `width` x `height` (transform-origin 0 0, at the
// stage's origin) on `quad`, every value scaled by `scale` (the stage's px per scene px).
// matrix3d is column-major; the homography's third row becomes the w column.
export const quadMatrix3d = (quad, width, height, scale = 1) => {
  const scaled = quad.map(([x, y]) => [x * scale, y * scale]);
  const H = rectToQuad(scaled, width, height);
  if (!H) return 'none';
  const [a, b, c, d, e, f, g, h, i] = H;
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].map(sig).join(', ')})`;
};

// The same quad as a 2D matrix() (round seven, the lettering study's (c)): text under a 2D
// transform takes the browser's ordinary raster path, a matrix3d puts it on a layer of its own
// resampled by the compositor. The affine through the quad's mean edges: its centre and the mean of
// its opposite edges exact, each corner off by a quarter of the quad's departure from a
// parallelogram (quadSkew). `snap` ({ x, y, dpr }: the element's containing block's place in the
// window, css px, and the device pixel ratio) puts the element's origin on a whole device pixel
// (the study's (d)).
export const quadMatrix2d = (quad, width, height, scale = 1, snap = null) => {
  const q = quad.map(([x, y]) => [x * scale, y * scale]);
  const [tl, tr, br, bl] = q;
  const ax = [(tr[0] - tl[0] + br[0] - bl[0]) / (2 * width), (tr[1] - tl[1] + br[1] - bl[1]) / (2 * width)];
  const ay = [(bl[0] - tl[0] + br[0] - tr[0]) / (2 * height), (bl[1] - tl[1] + br[1] - tr[1]) / (2 * height)];
  const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
  const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
  let e = cx - ax[0] * (width / 2) - ay[0] * (height / 2);
  let f = cy - ax[1] * (width / 2) - ay[1] * (height / 2);
  if (snap && snap.dpr) {
    e += Math.round((snap.x + e) * snap.dpr) / snap.dpr - (snap.x + e);
    f += Math.round((snap.y + f) * snap.dpr) / snap.dpr - (snap.y + f);
  }
  return `matrix(${[ax[0], ax[1], ay[0], ay[1], e, f].map(sig).join(', ')})`;
};

// How far a quad is from a parallelogram, in its own px: |tl + br - tr - bl|. The 2D matrix puts
// each corner within a quarter of it of the homography's.
export const quadSkew = (quad) => {
  const [tl, tr, br, bl] = quad;
  return Math.hypot(tl[0] + br[0] - tr[0] - bl[0], tl[1] + br[1] - tr[1] - bl[1]);
};

// The lettering's transform: the 2D matrix where its corners land within FLAT_ERROR of a device
// pixel of the homography's (every spine label on the piles: their taper is a few hundredths of a
// px), else the homography (its origin snapped too).
export const FLAT_ERROR = 0.5;
export const quadTransform = (quad, width, height, scale = 1, snap = null) => {
  const dpr = snap?.dpr || 1;
  if ((quadSkew(quad) / 4) * scale * dpr <= FLAT_ERROR) return quadMatrix2d(quad, width, height, scale, snap);
  const m = quadMatrix3d(quad, width, height, scale);
  if (!snap || !snap.dpr || m === 'none') return m;
  const v = m.slice(9, -1).split(',').map(Number);
  // matrix3d's translation is its 13th and 14th terms over its 16th.
  const w = v[15] || 1;
  const x = v[12] / w;
  const y = v[13] / w;
  v[12] += (Math.round((snap.x + x) * snap.dpr) / snap.dpr - (snap.x + x)) * w;
  v[13] += (Math.round((snap.y + y) * snap.dpr) / snap.dpr - (snap.y + y)) * w;
  return `matrix3d(${v.map(sig).join(', ')})`;
};

// The axis-aligned box around a quad: [left, top, width, height].
export const quadBox = (quad) => {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
};

// A quad's own size, as an element laid out flat should take it: the mean of its opposite
// edges (so text keeps its proportions; the homography adds only the taper).
export const quadSize = (quad) => {
  const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  return {
    width: (len(quad[0], quad[1]) + len(quad[3], quad[2])) / 2,
    height: (len(quad[0], quad[3]) + len(quad[1], quad[2])) / 2,
  };
};

// How much farther one end of a quad is than the other, as drawn: its bottom edge's length
// over its top edge's (the notebook's pages: 1.098, under the owner's 1.10).
export const quadTaper = (quad) => {
  const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  return len(quad[3], quad[2]) / len(quad[0], quad[1]);
};

// A polygon for CSS clip-path, its points relative to `box` ([left, top]) and scaled.
export const clipPolygon = (points, box, scale = 1) =>
  `polygon(${points.map(([x, y]) => `${fixed((x - box[0]) * scale)}px ${fixed((y - box[1]) * scale)}px`).join(', ')})`;
