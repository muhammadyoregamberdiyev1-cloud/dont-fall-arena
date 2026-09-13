/**
 * All sound is synthesised with the WebAudio API — no audio files needed.
 * Call `unlock()` from the first user gesture.
 */

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.7;
    this.drone = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
    this.startDrone();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
    }
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Low ambient bed; its intensity follows how small the arena got. */
  startDrone() {
    if (!this.ctx || this.drone) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sine';
    o1.frequency.value = 55;
    o2.frequency.value = 82.5;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(o1.frequency);
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(g).connect(this.master);
    o1.start();
    o2.start();
    lfo.start();
    this.drone = { g, filt, o1, o2 };
  }

  setTension(t) {
    if (!this.drone || !this.ctx) return;
    const now = this.now();
    this.drone.g.gain.setTargetAtTime(0.035 + t * 0.075, now, 0.4);
    this.drone.filt.frequency.setTargetAtTime(320 + t * 900, now, 0.5);
    this.drone.o1.frequency.setTargetAtTime(55 + t * 14, now, 0.6);
  }

  /* ------------------------------------------------------------ primitives */

  tone({ freq = 440, to = null, dur = 0.15, type = 'sine', gain = 0.2, delay = 0, attack = 0.005 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.now() + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.2, freq = 900, q = 1, type = 'bandpass', sweepTo = null, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.now() + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * (dur + 0.05)));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ---------------------------------------------------------------- events */

  play(name, data = {}) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'crack':
        this.noise({ dur: 0.13, gain: 0.12, freq: 1500, sweepTo: 500, type: 'bandpass', q: 0.8 });
        this.tone({ freq: 220, to: 120, dur: 0.1, type: 'square', gain: 0.05 });
        break;
      case 'fall':
        this.noise({ dur: 0.34, gain: 0.2, freq: 800, sweepTo: 120, type: 'lowpass' });
        this.tone({ freq: 180, to: 60, dur: 0.3, type: 'triangle', gain: 0.12 });
        break;
      case 'quake':
        this.noise({ dur: 0.6, gain: 0.24, freq: 260, sweepTo: 60, type: 'lowpass' });
        this.tone({ freq: 90, to: 45, dur: 0.55, type: 'sawtooth', gain: 0.1 });
        break;
      case 'collapse':
        this.noise({ dur: 0.9, gain: 0.3, freq: 500, sweepTo: 40, type: 'lowpass' });
        this.tone({ freq: 140, to: 35, dur: 0.8, type: 'sawtooth', gain: 0.16 });
        this.tone({ freq: 70, to: 30, dur: 1.1, type: 'sine', gain: 0.2, delay: 0.05 });
        break;
      case 'dash':
        this.noise({ dur: 0.22, gain: 0.14, freq: 400, sweepTo: 2600, type: 'bandpass', q: 1.4 });
        break;
      case 'bump':
        this.tone({ freq: 300, to: 70, dur: 0.16, type: 'square', gain: 0.16 });
        this.noise({ dur: 0.14, gain: 0.16, freq: 1200, sweepTo: 300 });
        break;
      case 'slip':
        this.tone({ freq: 520, to: 320, dur: 0.12, type: 'triangle', gain: 0.08 });
        break;
      case 'doomed':
        this.tone({ freq: 880, dur: 0.09, type: 'square', gain: 0.07 });
        this.tone({ freq: 660, dur: 0.12, type: 'square', gain: 0.07, delay: 0.1 });
        break;
      case 'scramble':
        this.tone({ freq: 420, to: 780, dur: 0.14, type: 'triangle', gain: 0.1 });
        break;
      case 'fell':
        this.tone({ freq: 700, to: 90, dur: 0.75, type: 'sawtooth', gain: 0.16 });
        this.noise({ dur: 0.5, gain: 0.18, freq: 900, sweepTo: 100, type: 'lowpass' });
        this.tone({ freq: 120, to: 40, dur: 0.5, type: 'sine', gain: 0.18, delay: 0.35 });
        break;
      case 'shovedOff':
        this.tone({ freq: 620, to: 1200, dur: 0.16, type: 'square', gain: 0.08 });
        break;
      case 'powerup': {
        const base = 520;
        [0, 0.07, 0.14].forEach((d, i) =>
          this.tone({ freq: base * Math.pow(1.26, i), dur: 0.2, type: 'triangle', gain: 0.13, delay: d })
        );
        break;
      }
      case 'powerupSpawn':
        this.tone({ freq: 900, to: 1400, dur: 0.16, type: 'sine', gain: 0.06 });
        break;
      case 'powerupFade':
        this.tone({ freq: 700, to: 300, dur: 0.18, type: 'sine', gain: 0.05 });
        break;
      case 'stabilize':
        this.tone({ freq: 1200, to: 1800, dur: 0.12, type: 'sine', gain: 0.05 });
        break;
      case 'count':
        this.tone({ freq: 440, dur: 0.14, type: 'square', gain: 0.12 });
        break;
      case 'go':
        this.tone({ freq: 880, dur: 0.3, type: 'square', gain: 0.14 });
        this.tone({ freq: 1320, dur: 0.35, type: 'triangle', gain: 0.1, delay: 0.02 });
        break;
      case 'roundEnd':
        [523, 659, 784].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.12, delay: i * 0.09 })
        );
        break;
      case 'lose':
        [440, 370, 294].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.45, type: 'sawtooth', gain: 0.1, delay: i * 0.12 })
        );
        break;
      case 'matchEnd':
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.55, type: 'triangle', gain: 0.13, delay: i * 0.11 })
        );
        this.noise({ dur: 1.2, gain: 0.08, freq: 3000, sweepTo: 400, type: 'bandpass', delay: 0.2 });
        break;
      case 'click':
        this.tone({ freq: 660, to: 880, dur: 0.06, type: 'square', gain: 0.07 });
        break;
      case 'hover':
        this.tone({ freq: 420, dur: 0.04, type: 'sine', gain: 0.03 });
        break;
      case 'start':
        this.tone({ freq: 330, to: 990, dur: 0.35, type: 'sawtooth', gain: 0.1 });
        break;
      default:
        break;
    }
  }
}
