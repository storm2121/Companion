// How loud the window's rain is, and how bright (rainSound.js plays it; the visitor turns it on).
// Rain by day is a steady rain: a fuller bed, more hiss, more drops on the glass. Candlelight is a
// drizzle heard from a warm room: quieter, darker, sparser. Pure, so the levels can be tested
// (tests/public-window.unit.test.mjs); rainSound.js eases between them on the audio graph.
//
//   bed    the body of the rain: filtered pink noise, its gain
//   hiss   the fine spray on the glass: band-passed noise, its gain
//   drops  single drops striking the pane, their gain
//   tone   the bed's low-pass cut-off in Hz: brighter by day, duller through a warm room
//   rate   how often a drop strikes, per second (the drop track is drawn from it)

export const RAIN_MIX = {
  rain: { bed: 0.3, hiss: 0.09, drops: 0.34, tone: 1700, rate: 9 },
  candlelight: { bed: 0.15, hiss: 0.035, drops: 0.22, tone: 820, rate: 3.5 },
};

// The ramp every start, stop and mood change takes, in seconds.
export const RAMP = 0.4;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// The mix for a mood ('rain' | 'candlelight'), scaled by an overall level (0 – 1). Anything else
// reads as rain. Gains never leave 0 – 1.
export const rainMix = (mood, level = 1) => {
  const base = RAIN_MIX[mood] ?? RAIN_MIX.rain;
  const k = clamp01(level);
  return { ...base, bed: clamp01(base.bed * k), hiss: clamp01(base.hiss * k), drops: clamp01(base.drops * k) };
};
