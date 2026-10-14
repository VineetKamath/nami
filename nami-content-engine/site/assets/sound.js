// All sound is synthesized with Web Audio: no files, tiny, and it can only start after a user gesture.
let ctx = null;
let master, ambientGain, noiseGain, noiseFilter, analyser;
let enabled = false;

const now = () => ctx.currentTime;

function noiseBuffer(seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  master.connect(analyser).connect(ctx.destination);

  // Ambient pad: detuned saws through a slowly breathing low-pass, very quiet.
  ambientGain = ctx.createGain();
  ambientGain.gain.value = 0.0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  lp.Q.value = 6;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 260;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start();
  for (const [f, detune] of [[55, -8], [82.41, 6], [110, 3], [164.81, -4]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g).connect(lp);
    o.start();
  }
  // Rain texture: filtered noise under the pad.
  const rain = ctx.createBufferSource();
  rain.buffer = noiseBuffer(3);
  rain.loop = true;
  const rainF = ctx.createBiquadFilter();
  rainF.type = 'highpass';
  rainF.frequency.value = 2400;
  const rainG = ctx.createGain();
  rainG.gain.value = 0.05;
  rain.connect(rainF).connect(rainG).connect(ambientGain);
  rain.start();
  lp.connect(ambientGain);
  ambientGain.connect(master);

  // Tuner static: band-passed noise whose gain is driven by the dial.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(2);
  n.loop = true;
  noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1800;
  noiseFilter.Q.value = 0.7;
  noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  n.connect(noiseFilter).connect(noiseGain).connect(master);
  n.start();
}

export const sound = {
  get enabled() { return enabled; },
  get analyser() { return enabled ? analyser : null; },

  async enable() {
    init();
    if (ctx.state === 'suspended') await ctx.resume();
    enabled = true;
    master.gain.cancelScheduledValues(now());
    master.gain.setTargetAtTime(0.9, now(), 0.4);
    ambientGain.gain.setTargetAtTime(0.11, now(), 2.5);
    try { localStorage.setItem('nami-sound', 'on'); } catch {}
  },

  disable() {
    enabled = false;
    if (ctx) master.gain.setTargetAtTime(0, now(), 0.15);
    try { localStorage.setItem('nami-sound', 'off'); } catch {}
  },

  // Short sine blip for hovers; pitch can follow the element.
  blip(freq = 880, vol = 0.05) {
    if (!enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, now());
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, now() + 0.06);
    g.gain.setValueAtTime(0, now());
    g.gain.linearRampToValueAtTime(vol, now() + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.12);
    o.connect(g).connect(master);
    o.start();
    o.stop(now() + 0.14);
  },

  // Tactile click: a tiny noise burst plus a low thump.
  click() {
    if (!enabled) return;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(0.05);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.04);
    s.connect(f).connect(g).connect(master);
    s.start();
    this.blip(140, 0.08);
  },

  // Typing tick for text scramble.
  tick() {
    if (!enabled) return;
    this.blip(1800 + Math.random() * 1200, 0.012);
  },

  // Rising arpeggio when the signal locks.
  chime() {
    if (!enabled) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = now() + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 1.3);
    });
  },

  // 0 = clean signal, 1 = full static.
  setStatic(amount, centerHz = 1800) {
    if (!ctx) return;
    noiseGain.gain.setTargetAtTime(enabled ? amount * 0.16 : 0, now(), 0.05);
    noiseFilter.frequency.setTargetAtTime(centerHz, now(), 0.05);
  },
};
