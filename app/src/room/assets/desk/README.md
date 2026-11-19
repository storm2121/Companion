# Desk prototype pictures and film (`room/desk.css`, `DeskStage.jsx`, `Desk.jsx`)

Every picture and film the desk prototype (`RoomDesk.jsx`) uses.

- **Wide screens (the stage, round five):** pictures RENDERED for this repo in Blender from one
  seated camera (`app/room-harness/blender/`), plus `scene.json`, which says where each picture
  goes and where the page puts its words. Their textures are CC0 scans; the town beyond the
  window is a Poly Haven HDRI (CC0; one by night, one by day). See *The stage* below.
- **Phones and tablets (the flow desk, rounds one and two):** the pictures in the first table;
  four from CC0 sources, the candle and the flame film from one Pexels video (the Pexels
  License, not CC0), the rest drawn by scripts (PIL).

Removed in round four, with the seated CSS 3D scene and its WebGL desk: `wood-normal.webp`,
`wood-rough.webp`, `flame-alpha.webm`, `candle-tall-night.webp`, `candle-tall-day.webp`,
`spill.webp`, `junction.webp`, `pool.webp`.

## The flow desk

| File | Source | Licence | Pixels | Bytes |
|---|---|---|---|---|
| `wood.webp` | ambientCG **Wood051**, 1K JPG, Color map — https://ambientcg.com/a/Wood051 (zip: https://ambientcg.com/get?file=Wood051_1K-JPG.zip) | CC0 1.0 — https://docs.ambientcg.com/license/ | 1024 × 1024 | 111,514 |
| `cloth.webp` | Poly Haven **Book Pattern**, 1k JPG, colour 1 — https://polyhaven.com/a/book_pattern (file: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/book_pattern/book_pattern_col1_1k.jpg) | CC0 1.0 — https://polyhaven.com/license | 512 × 512 | 39,934 |
| `flame.webm` | Pexels video **7034332**, "Close Up Shot of a Candle Flame" — https://www.pexels.com/video/close-up-shot-of-a-candle-flame-7034332/ (file: https://videos.pexels.com/video-files/7034332/7034332-hd_1080_1920_25fps.mp4) | Pexels License — https://www.pexels.com/license/ (free to use and modify, no attribution needed; not CC0) | 120 × 240, 4.4 s | 15,366 |
| `flame.mp4` | the same | Pexels License | 120 × 240, 4.4 s | 19,368 |
| `candle-night.webp` | the same video: its candle, matted, with a dish drawn by the script | Pexels License (candle), made for this repo (dish) | 241 × 172 | 5,114 |
| `candle-day.webp` | the same | the same | 241 × 172 | 5,284 |
| `candle-light.webp` | drawn (PIL) | made for this repo | 700 × 450 | 2,896 |
| `desk-back.webp` | drawn (PIL) | made for this repo | 8 × 96 | 82 |
| `notebook-gutter.webp` | drawn (PIL) | made for this repo | 64 × 4 | 82 |
| `book-pages-h.webp`, `book-pages-v.webp` | drawn (PIL) | made for this repo | 2 × 14, 14 × 2 | 52, 54 |
| `nb-stack-h.webp`, `nb-stack-v.webp` | drawn (PIL) | made for this repo | 2 × 32, 32 × 2 | 92, 88 |
| `nb-curl-night.webp`, `nb-curl-day.webp` | drawn (PIL) | made for this repo | 60 × 60 | 1,416, 1,436 |
| `ribbon.webp` | drawn (PIL) | made for this repo | 44 × 360 | 1,368 |

No clean CC0 photograph of an unlit pillar candle was found. The Openverse and Wikimedia
Commons candidates were composites, carried a watermark or label, or were rust-red church
candles. So the candle is the one standing under the filmed flame. The brief allowed Pexels.

## How each was made

**wood.webp**: dark oiled oak for the desk top, a CSS background tiled at 1024px.
1. `Wood051_1K-JPG_Color.jpg` from the zip (1024 × 1024). Seamless at source: checked by tiling
   it 2 × 2 and looking at both seams; no seam, so it tiles (no 2048 strip needed).
2. Graded warm: red × 1.08, blue × 0.86 (per channel), then PIL `ImageEnhance.Color` 1.15 and
   `ImageEnhance.Contrast` 1.08. Mean ≈ rgb(73, 50, 35).
3. WebP quality 90, method 6 (q92 was over 120 KB). No 2x copy: shown 1:1, the 1x is sharp at
   1440 (desk-02/03 renders), so `image-set` was not needed.

**cloth.webp**: book cloth, laid over each course's colour with `background-blend-mode:
multiply`, so every course is its own dyed cloth (`deskLayout.coverTone`).
1. `book_pattern_col1_1k.jpg` (olive bookcloth, 1024 × 1024, tileable) → greyscale.
2. Lanczos to 512 × 512 (shown at 256 CSS px: 2x for sharp screens, the tile stays seamless).
3. Levels: mean moved to 223 (0.875), deviation × 0.95. Decoded result: mean 0.875, σ 0.044.
   These two numbers ARE `CLOTH_MEAN` (0.875) and `CLOTH_SPREAD` (0.09 ≈ 2σ) in
   `deskLayout.js`, which the title-ink contrast rule depends on. If you rebuild the tile,
   measure it again and update both.
4. WebP quality 58 (fine noise compresses poorly; this is the highest quality under 40 KB).

**flame.webm, flame.mp4**: the candle's flame, a film on black screened onto the wood
(`mix-blend-mode: screen`: black adds nothing), so it needs no alpha channel.
1. The 1080 × 1920 file, 140 frames from 12.5 s exported as PNG.
2. The clip zooms out slowly. Each frame was steadied first: the candle's width, its centre
   and its top were measured every 5th frame, a straight line was fitted to each, and every
   frame was cropped and scaled about the wick by those lines (a 900 × 1800 window in
   frame-0 pixels). The wick stays put and the flame keeps its size.
3. Everything below the wick's base is black, so the wax would not brighten the room under
   `screen`. The edge is softened by a Gaussian of 6 at the 4x working size. Values under 14
   are crushed to 0 and the rest is stretched back to 0–255.
4. 110 frames (4.4 s at 25 fps) from frame 4. The last 0.8 s cross-fades into the first, so
   the loop has no seam.
5. Built at 240 × 480, then Lanczos to 120 × 240 by ffmpeg. At its largest (174 × 0.36 =
   63 CSS px tall, 2x) it looked no different from the 240 × 480 build.
   - VP9: `-crf 30 -b:v 0 -deadline good -cpu-used 1 -row-mt 1`.
   - H.264 High: `-crf 20 -preset veryslow -tune film -movflags +faststart`.
   - Both yuv420p, with no audio.

**candle-night.webp, candle-day.webp**: the candle and its dish, as one picture per mood.
They cross-fade with the mood (desk.css `.room-desk-candle-photo`).
1. Taken from the film's first exported frame: the pillar, cropped (x 150–950, y 1360–1920),
   matted from its black ground by luminance (`(luma − 38) / 46`). Above the rim, only the
   bright and neutral wax is kept; the charred wick and the flame's foot are removed.
   Gaussian blur 1.2 on the matte.
2. Made into a full pillar. Its last 24 rows are repeated down to 1.12 × its width, darker
   toward the foot (`1 − 0.32·t^1.3`: the flame lights the top). The foot is the front half
   of an ellipse.
3. Grades:
   - Night: R × 1.1 + 10, G × 0.9 + 8, B × 0.66 + 5 (honeyed, lit by its own flame).
   - Day: the wax's luminance × 1.3 tinted (1, 0.955, 0.855). This is ivory, because the
     film's wax is faintly blue-grey. It is 6% lighter on the window's side (left) and
     10% darker on the far side.
4. A brass dish drawn under it at 4x supersampling:
   - an ellipse 2·99.8 × 2·17.4 px with a turned-down side 8.1 px deep;
   - a rolled rim lit from above at night, or from the upper left by day, with a narrow
     specular;
   - the bowl's wall in shadow and a floor with a faint grain;
   - a soft contact shadow kept well inside the picture, so its edge never shows as a box.
   The rim's front lip passes in front of the candle's foot. A 2px charred wick tip is drawn
   above the waxed wick.
5. The candle's body is 107 px wide (2x). Quality 88, method 6, `exact`.
   - Built by `make_candle.py FRAME OUT 1.16`.
   - The wick's top lands at 48.9 %, 53.1 % of the candle's box. Those are
     `CANDLE_WICK_X/Y` in `deskLayout.js` and the drawn flame's place in desk.css. If you
     rebuild, measure again.

**candle-light.webp**: the candle's light on the flow desk's wood (phones and tablets, which
have no light pass), screened onto it at opacity .5.
- 700 × 450, black outside an ellipse filling the frame; inside, intensity
  `0.86 · (1 − d²)^2.4` (d = elliptical distance from the centre, 0–1) times a warm colour
  (255, 168 − 30d, 88 − 40d), ±0.8 level of seeded noise (seed 7) against banding.
- WebP quality 82.

**desk-back.webp**: where the desk meets the wall, a soft darkening along the back edge,
blended with `mix-blend-mode: multiply` (static; hidden once the light pass draws).
- 8 × 96 grey ramp, value `0.42 + 0.58 · (1 − (1 − t)^2.6)` from the wall (t = 0) to 96px.
- Lossless WebP; repeated across the desk.

**notebook-gutter.webp**: the notebook's pages curving down into the spine (normal alpha,
no blending).
- 64 × 4, black with alpha `0.5 · (1 − t)^2.2`, t = distance from the centre line (0–1).
- Lossless WebP; stretched to the notebook's height.

**Stage 2 detail pictures** (all drawn at 2x, lossless, from `build_detail_assets.py`):
- `book-pages-h/-v`: a book's page block seen edge-on, 7 CSS px deep. Cream (222, 210, 186)
  leaves with gaps between gatherings at 0.84 and 0.92. `-v` is the same turned 90°.
- `nb-stack-h/-v`: the notebook's page stack, 16 CSS px deep. 20–22 hairlines of
  (128, 120, 108) at alpha 0.28–0.55, 1.25–1.75 px apart (seeded, not quite even). One
  picture serves both moods.
- `nb-curl-night/-day`: the right page's lifted corner, 30 CSS px.
  - The flap's underside is shaded across the bend in 24 flat steps, drawn at 4x and reduced,
    with a lighter crease line.
  - Its own soft shadow is kept inside the corner.
  - The night copy uses the room's dark glass colours; the day copy uses its paper.
- `ribbon`: grosgrain in a muted red (138, 45, 36), 9 CSS px wide, cut in a V.
  - Ribs about 1 CSS px apart; the selvedges are darker, the right one darker still.
  - Its own small shadow is offset right and down.

The scripts that made these (`build_desk_assets.py`, `build_light_maps.py`,
`build_detail_assets.py`, `make_flame_loop.py`, `make_candle.py`, `flame_alpha.py`,
`build_scene_assets.py`) live outside the repo, in a session scratchpad. The steps above are complete enough to repeat them.

## The stage (wide screens)

Rendered by Blender 4.5.10 LTS (Cycles on the GPU, OptiX denoiser, AgX view, camera white balance
3400 K by night and 4300 K by day) at 3600 x 2160: a NATIVE frame of 1800 x 1080 stage px at 2x,
from one seated camera — level at (0, -0.45, 1.10) m, 22 mm on a 36 mm sensor, its lens shifted so
the horizon sits 26.5% down the frame, f/2.8 focused on the notebook. Inside it the DESIGN CROP,
what a 1440 x 810 window shows: 1440 x 810 at (180, 88), where the horizon is 24.45% and the
table's far edge 49.52% down (scene.json `crop`). `scene.py` builds the study from numbers (metres;
the table's top at 0.74 m), `render.py` renders each pass, `post.py` checks, trims, encodes and
writes `scene.json`. Every picture comes at 1x and 2x, WebP; the page takes the 2x files when a
stage px is drawn at 1.25 device px or more (`deskStage.js` pictureDensity), else the 1x.

The SURROUND (round six): each set is also rendered at 3900 x 1320 (7800 x 2640 at 2x) with the
same lens and pixel scale (the sensor widened with the image, the shift recomputed), so the frame's
1800 x 1080 is its exact centre (1050 px each side, 120 above and below at 1x); the margin ships as
`surround-<mood>` (the centre a transparent hole, 2 px inside the frame's edge: the page draws it
over the frame's own picture) and, round seven, `surround-night-lit` (the wide room lit by the
candle, holed the same way: the page draws it over the dark one at the light's opacity, no blend;
round six's `surround-light` was a screened layer), loaded with the centre where the window reaches
past the frame. With it no desktop window shows bars, 32:9 down to
5:4; it is not in the per-mood budget below (its bytes are listed after it).

| Texture used in the render | Source | Licence | For |
|---|---|---|---|
| ambientCG **Wood051** 2K (Color, Roughness, Displacement) | https://ambientcg.com/a/Wood051 (zip: https://ambientcg.com/get?file=Wood051_2K-JPG.zip) | CC0 1.0 | the oak table (one tile 1.2 m, roughness 0.55-0.72) |
| ambientCG **Wood067** 1K (Color, Roughness, Displacement) | https://ambientcg.com/a/Wood067 | CC0 1.0 | walnut: the stand, the frames, the shelf, the window, the floor |
| ambientCG **Fabric036** 1K (Color, Displacement, NormalGL, Roughness) | https://ambientcg.com/a/Fabric036 (zip: https://ambientcg.com/get?file=Fabric036_1K-JPG.zip) | CC0 1.0 | the courses' books' cloth (one tile 5 cm; colour as luminance only), the notebook's linen, the lamp's shade, the shelf books' weave |
| ambientCG **Plaster001** 1K (Color, Roughness, Displacement) | https://ambientcg.com/a/Plaster001 (zip: https://ambientcg.com/get?file=Plaster001_1K-JPG.zip) | CC0 1.0 | the walls and ceiling, tinted warm grey |
| Poly Haven **Book Pattern** 1k, colour 1 | https://polyhaven.com/a/book_pattern | CC0 1.0 | (rounds four and five's book cloth; no longer used) |
| ambientCG **Leather014** 1K (Color, NormalGL, Roughness; Displacement unused) | https://ambientcg.com/a/Leather014 (zip: https://ambientcg.com/get?file=Leather014_1K-JPG.zip) | CC0 1.0 | round six's leather study only, style A: full calf (one tile 30 cm; colour as luminance only) |
| ambientCG **Leather021** 1K (Color, NormalGL, Roughness; Displacement unused) | https://ambientcg.com/a/Leather021 (zip: https://ambientcg.com/get?file=Leather021_1K-JPG.zip) | CC0 1.0 | the books (the owner's pick, B): morocco, its pebbled grain (one tile 50 cm: pebbles ~2.5 mm, 2 px at the stage's least 1x scale; normal 2.6; colour as luminance only, its own dark range stretched to 0.64-1.24 of the albedo) |
| ambientCG **Leather033A** 1K (Color, NormalGL, Roughness; Displacement unused) | https://ambientcg.com/a/Leather033A (zip: https://ambientcg.com/get?file=Leather033A_1K-JPG.zip) | CC0 1.0 | round six's leather study only, style C: a worn half-leather spine and corners (one tile 30 cm) |
| ambientCG **Leather037** 1K (Color, NormalGL, Roughness; Displacement unused) | https://ambientcg.com/a/Leather037 (zip: https://ambientcg.com/get?file=Leather037_1K-JPG.zip) | CC0 1.0 | the books' two labels (the title's, the count's) and the gilt lettering's grain (one tile 15 cm) |
| Poly Haven HDRI **vignaioli_night** 4K (.hdr), Greg Zaal (backplates Rico Cilliers) — https://polyhaven.com/a/vignaioli_night (file: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/vignaioli_night_4k.hdr) | CC0 1.0 — https://polyhaven.com/license | the world beyond the window by night |
| Poly Haven HDRI **vignaioli** 4K (.hdr), Greg Zaal (backplates Rico Cilliers) — https://polyhaven.com/a/vignaioli (file: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/vignaioli_4k.hdr) | CC0 1.0 | the world beyond the window by day |

The two HDRIs are the scene's world, unchanged (no grading), seen only through the window's rainy
glass and the lens's f/2.8 depth of field. Both moods look out on the same small square of a
Ligurian town, its pink facades and its lamp post. The two panoramas were shot 58 m and seven
hours apart (Poly Haven's coordinates: 44.0988, 9.73777 by day; 44.0992, 9.73823 by night), so one
yaw cannot show one place in both: by night the world is turned 60 degrees about the vertical, by
day 100 degrees, the two views of the square chosen from renders of the window all the way round.
Rays that look at the world (from the camera or refracted through the glass) and rays it lights
each get their own strength: night 0.40 and 0.35, day 1.0 and 1.0. At night 24 small lights
between 14 and 40 m, mostly warm, sparkle in the depth of field.

Only the JPG maps were used from each texture download (each zip also holds a .blend, .usdc,
.mtlx and .tres; none was opened). Everything else is procedural: the rain on the glass, the
candle's wax (subsurface, its rim glowing when lit), brass, the books' page blocks (ivory paper
with uneven sheet edges, yellowed toward the ends) and their head and tail bands.

The books (round six: the owner's pick of the study, B, morocco with a label). Each pile place
(twelve a pile) is an antiquarian leather book from a deterministic table: width 0.26-0.295 m and
depth 0.18-0.20 m by place, thickness 3.6-5.8 cm, a spine rounded out by 14% of the thickness, four
raised bands at 5%, 20%, 80% and 95% of its length (jittered by place), each with a gilt fillet on
either side and the tool's pressed line beside it, boards with worn rounded edges, a page block of
visible sheets with sprinkled edges, endbands. The morocco: Leather021 at one tile per 50 cm,
normal 2.6, its colour map's own range (90% of it between 0.0074 and 0.025 in linear luminance)
stretched to 0.64-1.24 of the albedo, its median at 0.83 (round five's cloth mapping, 0.05-0.45,
clamped this dark map to a single value: the first leather renders had no grain at all, even at
2x), roughness varied across each board (never glossy), smoother and
lighter wear on the bands' ridges and the corners, faint scuffs and an age speckle. The title's
label fills the panel between the second and third bands (6.5 mm clear of their centres) and the
count has its own small label in the right end panel (a volume label, as old sets have): both raised
0.45 mm with a bevelled edge and following the spine's curve (flat, the first label sank into the
spine's bulge and the first books render showed none), the title's ringed by gilt rules. The
leather and labels are rendered neutral (albedo 0.30) and the page multiplies the course's leather
into the leather and a contrasting leather into the labels (deskStage.js leatherOf / labelOf: the
course colour's hue picks oxblood, chestnut, tan, bottle green or navy, no hue black; labels black,
a black book's a deep oxblood), each under its own per-mood mask: the leather's (or label's)
share of each pixel's light as the book lies over that mood's room, times the share of that light
that is diffuse (a twin render with the leathers' specular off), so the leather's highlights stay
the light's colour. The dyes (scene.json leatherDyes, labelDyes) were measured in the study: per
tone, the render in that tone over the neutral one in that model, (colour - specular) / diffuse, the
median where the leather is whole; by day with 15% less chroma (OKLab, lightness kept), for restraint.
A moved book's look follows its place, its colour its course.

The gilt (fillets, rules and lettering) is one material: gold leaf (0.60, 0.40, 0.14 by the place's
brightness 0.90-1.08), metallic, roughness 0.30-0.48, the fillets rubbed through in a few places
(each fillet follows the spine's curve in 20 rows: in 6, its rows' chords sank into the curve and it
came out as a dashed line, like stitching; the lettering's copy is whole gold, its wear the strip's
alpha below). By its
own light the gilt, a metal facing the chair, mirrored the dark room by night (a dark copper, 1.1 to
1.7:1 on a black label) and the pale walls by day, so a large soft light behind the chair lights the
books alone (light linking) and only in reflections (glossy rays), as a photographer's reflector:
100 W by night (3200 K), 80 W by day (4300 K); the matte leather hardly sees it. The page letters
each title and count in that gilt: per place and mood `post.py` takes the gilt render of the book
(its leather and labels lettered all over in the same gilt, pressed into the label's grain, under
the room's light), flattens the label's quad out of it, multiplies the label's grain (from the
object render) into it and puts a per-place wear in its alpha (broad rubbed patches on a title's
strip, small flecks, the grain's pores; a count, one or a few figures, has no broad patch); the page fills the letters with that strip (`background-clip: text`) over a
pressed layer (the leather in the letters where the gold is worn) and an impression lit from the
mood's light (an SVG filter: by night the candle low on the left, by day the window above).
Round seven tools the lettering by its size on the screen: from 18 device px a letter (2x screens,
big windows, the near book's cover) as above; under it (the stage at its least scale on an ordinary
screen) no filter, the pressed layer one device pixel below the gold, and the place's flat gilt under
the strip at 0.73 (where the wear leaves least, the letter is still 85% gold); the strip is always
its 2x file, the lettering carried by a 2D matrix where its label is flat (every spine's) and its
origin on a whole device pixel. The faces (round seven): titles in EB Garamond Bold 700 (Georg
Duffner, Octavio Pardo) in its true small caps (run three: run two's Spectral SC 600, about 20% wider
than round six's Cormorant SC, cut far more titles), their Arabic in Amiri Bold 700 (Khaled Hosny),
counts in Spectral SC Bold 700's lining figures (Production Type; crisper than EB Garamond 800 by the
study's M); all SIL Open Font License 1.1, loaded from Google Fonts for the stage only, not shipped
here. The fits count their advance widths, measured once with a canvas in the harness
(room-harness/advances.html: EB Garamond 700's small caps over printable ASCII, Amiri 700's letters as
they stand inside a word, Spectral SC 700's figures 0.561em each).

The capture card is cream paper (0.84, 0.80, 0.70) in a walnut holder. By candlelight alone its
darkest 5% held a near-black ink at only 3.7:1, so by night the card takes a little light of its
own, seen only by the camera (an emission of the paper's colour in a 2700 K light, strength 0.3,
for camera rays only, so it lights nothing else): 6.5:1 for the ink, 5.0:1 for the 0.85 hint.

How the layers are made. The SET (the room by night without and with the candle's light, and by
day) is rendered with what never moves in it but unseen by the camera: the notebook on its stand,
the candle, the capture card in its walnut holder (round six: an upright index card, its words
standing up instead of lying flat) and the frame cast their shadows, bounce their light and hide what they hide
in the varnish exactly as in a whole render, while their own pixels come from their OBJECT layers.
Each object is rendered alone at 2x (everything else a hole to the camera that still shades and
lights it; the window's glass kept), its render border its own box with a margin. Each book's
SHADOW comes from its pile's CHAIN: the whole room at 1x with that pile's books 0..k (k from none
to eleven, the other pile away). Book k's layer is the change from link k-1 to link k, per pixel
the least alpha `a` and a colour `C` with `before * (1 - a) + C * a = after`: its shadow, the
reflection it hides and the light it bounces, drawn over what the page has drawn so far (each
book's layer just before the book), so a pile's shadows add up as the whole render's do. On the
books below it carries only their shade (black), so it darkens their dye instead of covering it;
where the book itself stands it is filled in from around it. These layers are soft and reach most
of the room, so their files are a quarter (1x) and half (2x) of the stage's px (`res` 0.25), drawn
up by the browser. Pile R's layers stay off pile L's books (its chain has no pile L). `post.py`
fails loudly if an object touches its render border or a book's object loses any pixel of its
cloth silhouette. Until round 5B the shadows came from shadow catchers: per book they multiplied
where they met, and they could not give back the light the white books and pages bounce. The
stage's candle is `candle-look-<mood>.webp`: in rounds four and five it was written as
`candle-<mood>.webp`, over the flow desk's own candle above, which 5B put back from the script's
kept output (the 5,114 and 5,284 bytes listed above). Round six found that reassigning an
object's materials (`materials.clear()`) reset every face to the first slot, so the 5B books
rendered their page blocks and bands in cloth (and the cloth masks covered them): `scene.py`
set_slots keeps each face's slot, and the books were rendered again.

Checked against Blender's whole render of the same room (`b-06-truth-*`: piles of four and three,
512 samples; `python -I post.py compare`, the full 1800 x 1080 frame, the frame's opening left
out): by night the composite is within mean 2.17 and p99 13 of 255, on the table mean 3.41 and
p99 12; by day mean 2.22 and p99 15, on the table mean 2.43 and p99 10. With the shadow catchers
(before 5B) the table was p99 98 by night and 84 by day.

The NEAR place (round seven, the planner's gate B): one, `N0`, a book lying flat on the near table,
cover up, at (0.15, 0.42) m, yawed 15 degrees (0.28 x 0.19 m, 4.6 cm thick), between the notebook and
the card: the book a student brings closer. The same morocco, bands and labels as the piles; on the
front board a title label inside four gilt rules (raised 0.45 mm, bevelled) and a count plate in the
corner by the fore-edge (scene.json `quads.covers`, `coverLabels`, `coverCounts`, `nearHulls`, and
`nearPlaces`). Its object layers are rendered with piles of four and three in the room as holes: the
cover faces up and mirrors what stands behind it (with no piles it mirrored the window, a cool sheen
33 levels of blue over the whole render's warm cover by night). Its gilt has its own reflector,
BOOKS_GLINT's twin in the cover's mirror direction (up and behind it, before the back wall), glossy
rays only, the near book only: 10 W by night (without it the cover's gilt was a dark copper, 0.37 of
white, 2.5:1 on its black label; with it the piles' gold, 0.82, 11:1), none by day (the cover
mirrors the bright window: a pale gold). Its shadow is the change from the room without it to the
room with it, both with piles of four and three (with no piles its layer took away a reflection in
the varnish the page's piles had already hidden), only where it changes the room (the change
blurred over 6 px from 1.5 to 3 levels, grown 12 px: elsewhere the two links differ by the path
tracer's noise alone), over every pile place only its shade (black: the page's piles vary), at half
the stage's px; the page draws it last, over both piles. Against Blender's whole render with piles
of four and three and the near book (`b-09-truth-*`, `python -I post.py compare-near C0 C1`; run
three: the count plates drawn, as the truth has them): by night mean 2.03, p99 13, on the table mean
2.77 and p99 10, around the near book (its outline grown 60 px) p99 18; by day mean 2.39, p99 16, on
the table mean 2.85 and p99 11, around the near book p99 15. With the candle beside the card (C1):
by night mean 2.72, p99 38, on the table mean 2.14 and p99 10, around the near book p99 40 (the
cover's grain lit at a grazing angle from the right: speckle, its mean difference under one level in
each channel); by day mean 2.48, p99 18, the table p99 11, the near book p99 15.

Round seven, RUN THREE (the planner's §8):
- COUNT PLATES: each book's count plate (scene.py slot 7) is its own layer, `plate-<place>-<mood>` (24
  pile places and N0, both moods). render.py draws each book with the plate see-through (the end
  panel's leather under it shows, the plate casts nothing) and the plate alone (every other face held
  out); the cloth and label masks see through it too. The page draws the plate, dyed with the label's
  leather under its own picture as mask, only where it letters a count: EMPTY MEANS ABSENT, no empty
  black plate.
- THE CANDLE'S PLACES: C0 by the notebook (-0.38, 0.28) and C1 beside the card (0.60, 0.40): its
  dish's true box on the screen (every vertex of the candle and its dish, as scene.json's) 1585-1776
  px at 1x, 24 px inside the frame's 1800, 13 px clear of the card. The brief's (0.55, 0.28) reached
  1819 px; (0.52, 0.28), first rendered on a test of the dish's axis points alone, reached 1800.4 by its
  true box and was rendered again; (0.45, 0.62), behind the card, overlapped the card and pile R's
  bottom spines on the screen (candle_proposal.py CANDIDATES=1..3, candidates_rule.py: by night C1
  lights the near table 1.13x as C0 does, the pages' ink 16.5:1 and 16:1, the card's 4.9:1). Each place has its own whole night (moods `night`
  and `nightC1`: the sets dark and lit, the surround, every object, every book and its chain, the near
  book and its links, the lit set and its breath; files `*-nightC1*`); by day the set WITHOUT the
  candle is `set-day-base`, and per place the candle alone (`candle-look-<place>-day`) and its link
  (`candle-link-<place>-day`: the change from the room without it to the room with it there, its shadow
  and what it hides in the varnish, half the stage's px; C1's runs on about 330 px past the frame's
  right edge over the surround, from the same pair rendered wide round that edge, render.py
  WIDE_LINK, 12 s each: in the 60 px both share, the room agrees to a mean of 1 level and the
  change to a mean of 0.75, p99 4). scene.json `candles.<place>`: at, name, night,
  points (its wick and flame), box, day. The page fetches only the chosen place's night.
- THE NEAR BOOK BY DAY: lit by its reflector (3 W, 3000 K, glossy rays only, the near books only) and
  NOT by the window's area light (light linking): its gilt strip [0.80, 0.75, 0.71], near the piles'
  day gold [0.79, 0.71, 0.60], where it mirrored the overcast window silver, [0.90, 0.90, 0.87] (the
  sweep, the window off: 3 W, 6 W [0.84, 0.78, 0.72], 12 W [0.88, 0.81, 0.75]; a warm reflector with
  the window still on it: [0.93, 0.90, 0.87]; a darker leaf: [0.88, 0.85, 0.83]); its cover darker,
  worn rather than new (the window no longer on it).
- THE BOOKS' SHADOWS PAST THE FRAME: the surround is rendered without the piles, so a book's change
  to the room past the frame (its shadow, the light it takes from the table) was cut at the frame's
  edge: at 1920 x 950 a step on the table of 18 levels by night and 29 by day with twelve courses,
  28 and 76 with thirty, and 29 to 46 along the frame's foot. Every chain link is rendered again wide
  at half the stage's px (render.py wide_half, `out/assets/<mood>/chain/wide-chain-*`: both piles'
  26 links and the near place's 2, per mood and for C1's night, about 32 s each), and `post.py
  wide-shadows` gives each book its layer PAST the frame, `slab-<place>-shadow-wide-<mood>`
  (scene.json `shadowWide`): the change between its wide links, brought up to 1x, kept outside the
  frame and 16 px inside its edge, at an eighth of the stage's px (it is soft). Its frame layer is
  unchanged (`shadow`, exactly books()'s and near()'s). The page loads and draws the wide layers only
  with the surround, in one layer per mood clipped to the room outside the frame (nothing stands out
  there), so the stage's budget is unchanged; theirs is the surround's (scene.json
  `wideShadowBudget`).
- THE FACE: titles in EB Garamond Bold 700's true small caps (the planner's bounded check: 5.0% of the
  30-title set cut at 1x and 44.6% at the least scale against Cormorant's 7.6% and 48.9% and Spectral
  SC 600's 28.8% and 63.9%; M at the owner's window 0.465 against Spectral's 0.443); its advances
  measured as Spectral's were (advances.html).

The night's LIGHT (round seven): the lit set (`set-night-lit`, the render with the candle's light)
is drawn opaque over the dark one at the light's opacity, which is exactly round six's screened
layer at that opacity, with no blend at frame time (the screened light breathing over the whole
stage made the compositor redraw it every frame: 34.6 ms at the 95th percentile at rest by night on
an Intel UHD, 7.1 ms after); the breathing is `set-night-breath`, the dark set around the wick, its
alpha an ellipse (320 x 240 stage px, whole within 35% of its radii), faded in and out over the lit
one at 0 to 0.09. The flame film for the stage is `flame-stage.webm` (below).

The stage's files (all made by `post.py` from the renders; licences: the textures and HDRIs above, CC0; the renders themselves are the project's own):

| File (1x; 2x adds @2x) | Box at 1x (x, y, w, h) | KB 1x / 2x | What |
|---|---|---|---|
| `set-night-base.webp` | 0, 0, 1800, 1080 | 30.3 / 83.3 | the room by night without the piles or the candle's light (what never moves unseen by the camera, its shadows in) |
| `set-night-lit.webp` | 0, 0, 1800, 1080 | 37.2 / 98.9 | round seven: the room by night lit by the candle, drawn opaque over the base at the light's opacity (round six's `set-night-candle`, screened, is gone) |
| `set-night-breath.webp` | 7, 480, 641, 481 | 34.8 / 62.4 | the base around the wick, its alpha an ellipse: the candle's breathing, faded over the lit room at 0 to 0.09 |
| `candle-look-night.webp` | 216, 701, 215, 180 | 5.6 / 13.0 | the candle and dish (no flame), alone |
| `notebook-night.webp` | 205, 265, 648, 433 | 11.8 / 27.8 | the notebook on its stand, alone (its shadow is in the base) |
| `scrap-night.webp` | 1369, 619, 208, 178 | 4.8 / 9.5 | the capture card in its walnut holder, alone (its shadow is in the base) |
| `frame-night.webp` | 1414, 153, 157, 118 | 3.0 / 10.2 | the frame on the wall, alone; the opening a hole |
| `frame-light-night.webp` | 1442, 178, 101, 69 | 1.2 / 4.1 | a white card in the opening: how the room lights the picture (multiplied) |
| `flame-night.webp` | 313, 650, 28, 76 | 1.3 / 2.5 | the rendered flame, the fallback where the film cannot play |
| `frame-glass-night.webp` | 1429, 164, 130, 97 | 0.1 / 0.2 | the frame glass's reflection on black (screened) |
| `slab-L0-night.webp` … `slab-R11-night.webp` (24) | per pile place | 81.6 / 200.7 in all | each pile place's leather book alone (neutral leather and label; the page dyes both) |
| `slab-L0-shadow-night.webp` … (24) | per pile place | 170.9 / 627.0 in all | each book's change to its pile's chain: its shadow, the reflection it hides, the light it bounces (files a quarter and half of the stage's px, drawn up) |
| `leather-L0-night.webp` … (24) | within each book's box | 188.9 / 463.8 in all | each book's leather dye mask: the leather's share of the light as it lies over this mood's room, times the share of it that is diffuse (the leather's colour is multiplied under it) |
| `label-L0-night.webp` … (24) | within each book's box | 85.4 / 235.3 in all | the same for its two labels (the title's and the count's; their contrasting leather) |
| `gilt-L0-night.webp` … (24) | the title label's quad | 43.5 / 104.6 in all | each place's gilt strip: its title label rendered as solid gilt under this mood's light, flattened, the label's grain multiplied in, a wear in its alpha (the page fills the title's letters with it) |
| `gilt-count-L0-night.webp` … (24) | the count label's quad | 7.9 / 13.1 in all | the same for the count's label |
| `set-day-base.webp` | 0, 0, 1800, 1080 | 36.1 / 97.7 | the room by day without the piles (what never moves unseen by the camera, its shadows in; the candle out) |
| `candle-look-day.webp` | 216, 701, 215, 180 | 4.6 / 11.3 | the candle and dish (no flame), alone |
| `notebook-day.webp` | 205, 265, 648, 433 | 10.6 / 24.5 | the notebook on its stand, alone (its shadow is in the base) |
| `scrap-day.webp` | 1369, 619, 208, 178 | 4.2 / 9.1 | the capture card in its walnut holder, alone (its shadow is in the base) |
| `frame-day.webp` | 1414, 153, 157, 118 | 3.2 / 10.8 | the frame on the wall, alone; the opening a hole |
| `frame-light-day.webp` | 1442, 178, 101, 69 | 1.2 / 4.2 | a white card in the opening: how the room lights the picture (multiplied) |
| `frame-glass-day.webp` | 1430, 164, 129, 96 | 0.3 / 0.5 | the frame glass's reflection on black (screened) |
| `slab-L0-day.webp` … `slab-R11-day.webp` (24) | per pile place | 93.9 / 205.0 in all | each pile place's leather book alone (neutral leather and label; the page dyes both) |
| `slab-L0-shadow-day.webp` … (24) | per pile place | 340.6 / 1266.7 in all | each book's change to its pile's chain: its shadow, the reflection it hides, the light it bounces (files a quarter and half of the stage's px, drawn up) |
| `leather-L0-day.webp` … (24) | within each book's box | 162.4 / 418.3 in all | each book's leather dye mask: the leather's share of the light as it lies over this mood's room, times the share of it that is diffuse (the leather's colour is multiplied under it) |
| `label-L0-day.webp` … (24) | within each book's box | 77.7 / 221.1 in all | the same for its two labels (the title's and the count's; their contrasting leather) |
| `gilt-L0-day.webp` … (24) | the title label's quad | 38.8 / 89.4 in all | each place's gilt strip: its title label rendered as solid gilt under this mood's light, flattened, the label's grain multiplied in, a wear in its alpha (the page fills the title's letters with it) |
| `gilt-count-L0-day.webp` … (24) | the count label's quad | 7.3 / 11.6 in all | the same for the count's label |
| `flame.webm`, `flame.mp4` | at the wick | as built | the filmed flame (round one), screened (the flow desk; the mp4 on the stage where the alpha film will not play: Safari) |
| `flame-stage.webm` | at the wick | 46.9 | round seven: the same film with an alpha channel, drawn plainly on the stage (a screened film made the compositor redraw the whole stage for each of its frames). Made from `flame.webm`'s 110 frames: alpha the brightest channel (under 3 levels none), the colour un-premultiplied where alpha is 0.25 or more and carried smoothly outward from there (a Gaussian of 6 px) below it, so the codec keeps it small; VP9 yuva420p, `-crf 45 -b:v 0 -row-mt 1 -auto-alt-ref 0 -g 110`, ffmpeg 8.0.1. Pexels License, as the film |
| `slab-N0-night.webp`, `slab-N0-day.webp` | 914, 618, 393, 230 | 9.8 / 21.3; 9.5 / 20.3 | round seven: the near book alone, by night and by day (neutral leather and labels; the page dyes both) |
| `slab-N0-shadow-night.webp`, `-day` | 330, 474, 1470, 578; 800, 298, 620, 718 | 33.1 / 119.7; 14.4 / 53.6 | its change to the room (shadow, what it hides in the varnish; files a half and the stage's px) |
| `leather-N0-night.webp`, `-day` | within its box | 32.0 / 76.6; 25.3 / 59.9 | its leather's dye mask |
| `label-N0-night.webp`, `-day` | within its box | 8.4 / 26.9; 7.8 / 25.6 | its labels' dye mask (the title's label and the count's plate) |
| `gilt-N0-night.webp`, `-day` | the cover label's quad | 2.2 / 5.5; 2.1 / 5.0 | its title's gilt strip |
| `gilt-count-N0-night.webp`, `-day` | the count plate's quad | 0.6 / 1.3; 0.5 / 1.1 | its count's gilt strip |
| `plate-L0-night.webp` … `plate-R11-day.webp`, `plate-N0-<mood>` (50) | each count plate's own box | night 17.2 / 32.1; day 19.0 / 32.5 in all | run three: each book's count plate alone (the book's own picture is rendered without it); the page draws it, dyed with the label's leather, only where it letters a count |
| `candle-look-C0-day.webp` | 216, 701, 215, 180 | 4.6 / 11.4 | run three: the candle by day at C0 (by the notebook), alone |
| `candle-link-C0-day.webp` | 116, 650, 526, 312 | 6.4 / 20.7 | its change to the day's room there (its shadow, what it hides in the varnish; half the stage's px) |
| `candle-look-C1-day.webp` | 1581, 645, 199, 146 | 4.4 / 8.6 | run three: the candle by day at C1 (beside the card), alone |
| `candle-link-C1-day.webp` | 1530, 634, 678, 410 | 10.8 / 41.8 | its change to the day's room there (its shadow, what it hides in the varnish; half the stage's px) |
| every night file again as `*-nightC1*` (`set-nightC1-base`, `set-nightC1-lit`, `set-nightC1-breath`, `slab-L0-nightC1` …, `surround-nightC1`, `surround-nightC1-lit`) | as today's | night C1 707.9 / 1915.9 | run three: the whole night with the candle beside the card (C1): the room lit from there, every book, its shadows and masks, the near book |
| `slab-L0-shadow-wide-<mood>.webp` … (`shadowWide`, the books whose layer reaches past the frame) | past the frame, within the surround's extent | night 39.3 / 128.9; day 64.8 / 242.9; nightC1 36.5 / 112.2 in all | run three: each book's shadow past the frame, over the surround (rendered without the piles), at an eighth of the stage's px; loaded and drawn only with the surround |
| `scene.json` | — | — | camera, crop, horizon, far edge, every box and quad (spines, their labels), the leathers' dyes, spine, label and gilt tones, surround, budget |

Budget per mood (pictures, masks, gilt strips and count plates, a full desk of 24 books; round seven run three): night (the candle by the notebook) 708.0 KB at 1x, 1967.5 KB at 2x; day 778.1 KB at 1x, 2364.1 KB at 2x; the night with the candle beside the card (nightC1, fetched only when it stands there) 707.9 KB at 1x, 1915.9 KB at 2x (the ceiling: 1.3 MB and 2.6 MB). The near place apart, loaded only while a book lies there: night 85.9 KB at 1x, 253.5 KB at 2x; day 62.7 KB at 1x, 175.8 KB at 2x; nightC1 87.4 KB at 1x, 261.6 KB at 2x.

The surround (not in the budget; loaded only where the window reaches past the frame):

| File (1x; 2x adds @2x) | Box at 1x | KB 1x / 2x |
|---|---|---|
| `surround-night.webp` | -1050, -120, 3900, 1320 | 24.4 / 127.8 |
| `surround-night-lit.webp` | -1050, -120, 3900, 1320 | 33.0 / 162.0 |
| `surround-day.webp` | -1050, -120, 3900, 1320 | 47.0 / 199.4 |

Surround per mood (run three): night 57.4 KB at 1x, 289.8 KB at 2x; day 47.0 KB at 1x, 199.4 KB at 2x; nightC1 58.1 KB at 1x, 288.0 KB at 2x. With it, the books' shadows past the frame (`shadowWide`, a full desk): night 39.3 KB at 1x, 128.9 KB at 2x; day 64.8 KB at 1x, 242.9 KB at 2x; nightC1 36.5 KB at 1x, 112.2 KB at 2x.
