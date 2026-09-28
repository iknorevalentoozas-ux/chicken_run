// Tiny synthesized sound kit — no audio files needed.
const Sfx = (() => {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const ok = () => ctx && ctx.state === 'running';

  function tone(freq, dur, type = 'sine', vol = 0.3, freqEnd = null, when = 0) {
    if (!ok()) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, type, f0, f1, when = 0, q = 1) {
    if (!ok()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // A single chicken "syllable": buzzy saw through a vocal-ish band-pass, with vibrato.
  function cluck(when, dur, f0, fPeak, f1, vol = 0.35) {
    if (!ok()) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    const bp = ctx.createBiquadFilter(), bp2 = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(fPeak, t + dur * 0.25);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    lfo.frequency.value = 34;
    lg.gain.value = fPeak * 0.06;
    lfo.connect(lg).connect(o.frequency);
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 2.5;
    bp2.type = 'peaking'; bp2.frequency.value = 2600; bp2.gain.value = 8;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(bp2).connect(g).connect(master);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }

  return {
    init,
    whoosh() { noise(0.24, 0.3, 'bandpass', 500, 2800, 0, 1.4); },
    step() { noise(0.035, 0.035, 'highpass', 2500, 1800); },
    pow() {
      tone(320, 0.1, 'triangle', 0.4, 110);
      noise(0.08, 0.3, 'bandpass', 1800, 500, 0, 0.9);
    },
    bonk() {
      tone(260, 0.2, 'sine', 0.7, 60);
      tone(140, 0.12, 'square', 0.18, 70);
      noise(0.06, 0.45, 'lowpass', 4000, 700);
    },
    bukaak(p = 1) {
      cluck(0.05, 0.07, 480 * p, 560 * p, 430 * p, 0.28);
      cluck(0.16, 0.07, 500 * p, 590 * p, 450 * p, 0.28);
      cluck(0.28, 0.5, 620 * p, 950 * p, 420 * p, 0.38);
    },
    cluck(p = 1) { cluck(0, 0.08, 520 * p, 620 * p, 460 * p, 0.2); },
    splat() {
      noise(0.35, 0.4, 'lowpass', 900, 120);
      tone(180, 0.35, 'sine', 0.35, 50);
    },
    beep(f = 660) { tone(f, 0.12, 'square', 0.12); },
    go() { tone(990, 0.35, 'square', 0.14); tone(1320, 0.35, 'triangle', 0.12, null, 0.05); },
    warn() { tone(880, 0.07, 'square', 0.1); },
    hurry() { tone(520, 0.09, 'square', 0.13); tone(390, 0.09, 'square', 0.13, null, 0.1); },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.12, null, i * 0.1));
      tone(1047, 0.6, 'triangle', 0.2, null, 0.42);
      tone(1319, 0.6, 'triangle', 0.14, null, 0.42);
    },
    sad() { [392, 349, 311].forEach((f, i) => tone(f, 0.3, 'triangle', 0.16, null, i * 0.22)); },
    pop() { tone(700, 0.08, 'sine', 0.2, 1200); },
    honk(p = 1) { tone(330 * p, 0.18, 'square', 0.08); tone(415 * p, 0.18, 'square', 0.06); },
  };
})();
