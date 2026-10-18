import { RAMP, rainMix } from './rainMix';

// The window's rain, heard (HeroWindow.jsx's "Rain sound", off until the visitor turns it on).
// Made here, no recording: a bed of pink noise (the body of the rain), a little band-passed hiss
// (the spray), and a stereo track of single drops striking the pane — ticks, and now and then a
// small bubble ringing — all looped at lengths that do not share a beat, with a slow gust in the
// bed so it never sits still. Mixed to the room (rainMix.js): more rain by day. Every start, stop
// and change ramps over RAMP (400 ms); hiding the tab stops it, and coming back resumes it if it
// is still on. Its own chunk, fetched when the visitor reaches for the button.
//
//   createRainSound(context)  ->  { play(mood), stop(), setMood(mood), destroy() }
//   The AudioContext is made by the caller inside the click, so the browser lets it start.

const seamless = (context, seconds, channels, fill) => {
  const rate = context.sampleRate;
  const length = Math.round(rate * seconds);
  const fade = Math.round(rate * 0.25);
  const buffer = context.createBuffer(channels, length, rate);
  for (let channel = 0; channel < channels; channel += 1) {
    const raw = new Float32Array(length + fade);
    fill(raw);
    const out = buffer.getChannelData(channel);
    // The end fades into the beginning (equal power: the two are unrelated noise), so the loop
    // has no seam.
    for (let i = 0; i < length; i += 1) {
      if (i < fade) {
        const k = i / fade;
        out[i] = raw[i] * Math.sqrt(k) + raw[length + i] * Math.sqrt(1 - k);
      } else {
        out[i] = raw[i];
      }
    }
  }
  return buffer;
};

// Pink noise (Paul Kellet's filter): the even, low-weighted roar of steady rain.
const pink = (data) => {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
};

const white = (data) => {
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.5;
};

// Single drops on the pane, scattered left to right: mostly ticks (a few milliseconds of bright
// noise), sometimes a bubble ringing as it closes (its pitch rising).
const dropTrack = (context, seconds, perSecond) => {
  const rate = context.sampleRate;
  const length = Math.round(rate * seconds);
  const buffer = context.createBuffer(2, length, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const count = Math.round(seconds * perSecond);
  for (let n = 0; n < count; n += 1) {
    const start = Math.floor(Math.random() * length);
    const pan = Math.random() * 2 - 1;
    const toLeft = Math.cos(((pan + 1) * Math.PI) / 4);
    const toRight = Math.sin(((pan + 1) * Math.PI) / 4);
    const gain = 0.06 + Math.random() ** 2 * 0.45;
    const add = (i, value) => {
      const at = (start + i) % length;
      left[at] += value * toLeft;
      right[at] += value * toRight;
    };
    if (Math.random() < 0.72) {
      const span = Math.round(rate * (0.003 + Math.random() * 0.006));
      let low = 0;
      for (let i = 0; i < span; i += 1) {
        const noise = Math.random() * 2 - 1;
        low += 0.5 * (noise - low);
        add(i, (noise - low) * Math.exp(-i / (span * 0.22)) * gain);
      }
    } else {
      const span = Math.round(rate * (0.018 + Math.random() * 0.03));
      const from = 1300 + Math.random() * 2400;
      let phase = 0;
      for (let i = 0; i < span; i += 1) {
        phase += (2 * Math.PI * from * (1 + (1.6 * i) / span)) / rate;
        const attack = Math.min(1, i / (rate * 0.0007));
        add(i, Math.sin(phase) * Math.exp(-i / (span * 0.2)) * attack * gain * 0.5);
      }
    }
  }
  return buffer;
};

export const createRainSound = (context) => {
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);

  const loop = (buffer) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  };

  // The bed, with a slow gust riding on its level.
  const bed = loop(seamless(context, 4.3, 1, pink));
  const bedTone = context.createBiquadFilter();
  bedTone.type = 'lowpass';
  bedTone.Q.value = 0.4;
  const bedGain = context.createGain();
  bed.connect(bedTone).connect(bedGain).connect(master);
  const gust = context.createOscillator();
  gust.frequency.value = 0.07;
  const gustDepth = context.createGain();
  gustDepth.gain.value = 0.04;
  gust.connect(gustDepth).connect(bedGain.gain);

  const hiss = loop(seamless(context, 3.1, 1, white));
  const hissTone = context.createBiquadFilter();
  hissTone.type = 'bandpass';
  hissTone.frequency.value = 3600;
  hissTone.Q.value = 0.7;
  const hissGain = context.createGain();
  hiss.connect(hissTone).connect(hissGain).connect(master);

  // Drawn densely once; the mix sets how many are heard by how loud they are.
  const drops = loop(dropTrack(context, 7.7, rainMix('rain').rate));
  const dropTone = context.createBiquadFilter();
  dropTone.type = 'highpass';
  dropTone.frequency.value = 450;
  const dropGain = context.createGain();
  drops.connect(dropTone).connect(dropGain).connect(master);

  const now = context.currentTime;
  [bed, hiss, drops, gust].forEach((node) => node.start(now));

  let wanted = false;
  let mood = 'rain';
  let suspendTimer = 0;
  let closed = false;

  const mixTo = (next, seconds = RAMP) => {
    const mix = rainMix(next);
    const at = context.currentTime;
    const tau = seconds / 3;
    bedGain.gain.setTargetAtTime(mix.bed, at, tau);
    hissGain.gain.setTargetAtTime(mix.hiss, at, tau);
    dropGain.gain.setTargetAtTime(mix.drops, at, tau);
    bedTone.frequency.setTargetAtTime(mix.tone, at, tau);
    // Fewer drops at night: the quiet ones fall under the bed, the loud ones still land.
    dropTone.frequency.setTargetAtTime(next === 'candlelight' ? 900 : 450, at, tau);
  };
  mixTo(mood, 0.001);

  const ramp = (to, seconds) => {
    const at = context.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(master.gain.value, at);
    master.gain.linearRampToValueAtTime(to, at + seconds);
  };

  const fadeIn = () => {
    window.clearTimeout(suspendTimer);
    const go = () => ramp(1, RAMP);
    if (context.state === 'suspended') context.resume().then(go, () => {});
    else go();
  };

  const fadeOut = (seconds = RAMP) => {
    ramp(0, seconds);
    window.clearTimeout(suspendTimer);
    // Silent and still: let the device rest.
    suspendTimer = window.setTimeout(() => {
      if (!closed && (!wanted || document.visibilityState === 'hidden')) context.suspend().catch(() => {});
    }, seconds * 1000 + 60);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') fadeOut(0.12);
    else if (wanted) fadeIn();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    play(next = mood) {
      wanted = true;
      mood = next;
      mixTo(mood, 0.001);
      if (document.visibilityState !== 'hidden') fadeIn();
    },
    stop() {
      wanted = false;
      fadeOut();
    },
    setMood(next) {
      if (next === mood) return;
      mood = next;
      mixTo(mood);
    },
    destroy() {
      if (closed) return;
      closed = true;
      wanted = false;
      window.clearTimeout(suspendTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      ramp(0, 0.08);
      window.setTimeout(() => {
        [bed, hiss, drops, gust].forEach((node) => {
          try {
            node.stop();
          } catch {
            // Already stopped.
          }
        });
        context.close().catch(() => {});
      }, 120);
    },
  };
};
