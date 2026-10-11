// Fully synthesised audio: every sound effect and the music track are built
// from oscillators and noise at runtime with the Web Audio API.

import { clamp, rand } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.listenerX = 0;
    this.listenerY = 0;
    this.hearRange = 1400;
    this.intensity = 0; // 0..1 drives music layers
    this._lastPlay = {};
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.enabled = false;
      return;
    }
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);

    // A short synthetic room reverb for explosions and the music.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.5);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.25;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // Shared white noise buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Brown noise for rumbles.
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }

    this._buildEngine();
    this._buildRotor();
    this._musicInit();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setListener(x, y, range) {
    this.listenerX = x;
    this.listenerY = y;
    this.hearRange = range;
  }

  // Returns [gain, pan] for a world position, or null if inaudible.
  _spatial(x, y) {
    if (x === undefined) return [1, 0];
    const dx = x - this.listenerX, dy = y - this.listenerY;
    const d = Math.hypot(dx, dy);
    const g = 1 / (1 + (d / this.hearRange) ** 2 * 3);
    if (g < 0.03) return null;
    return [g, clamp(dx / this.hearRange, -0.85, 0.85)];
  }

  _out(gainValue, pan, reverb = 0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gainValue;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      p.pan.value = pan;
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.reverbSend);
    }
    return g;
  }

  _noiseSrc(buffer = this.noise) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  _env(param, t, peak, attack, decay, floor = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(floor, t + attack + decay);
  }

  // Throttle a sound so dozens of simultaneous triggers don't clip.
  _throttle(name, minGap) {
    const now = this.ctx.currentTime;
    if (this._lastPlay[name] && now - this._lastPlay[name] < minGap) return false;
    this._lastPlay[name] = now;
    return true;
  }

  play(name, x, y, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const sp = this._spatial(x, y);
    if (!sp) return;
    const fn = this['_' + name];
    if (fn) fn.call(this, sp[0] * (opts.volume ?? 1), sp[1], opts);
  }

  // --- Effects ---------------------------------------------------------------

  _cannon(vol, pan, opts) {
    if (!this._throttle('cannon', 0.03)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const big = opts.big ? 1.4 : 1;
    const out = this._out(vol * 0.9, pan, 0.6);
    // Sub thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 / big, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.35);
    const og = ctx.createGain();
    this._env(og.gain, t, 1.0, 0.003, 0.4 * big);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.6);
    // Blast body
    const n = this._noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.35);
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.9, 0.002, 0.45 * big);
    n.connect(lp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.7);
    // Crack
    const c = this._noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    this._env(cg.gain, t, 0.5, 0.001, 0.06);
    c.connect(hp).connect(cg).connect(out);
    c.start(t);
    c.stop(t + 0.1);
  }

  _mg(vol, pan) {
    if (!this._throttle('mg', 0.035)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.35, pan, 0.15);
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(900, 1400);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    this._env(g.gain, t, 1, 0.001, 0.07);
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.1);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.04);
    const og = ctx.createGain();
    this._env(og.gain, t, 0.4, 0.001, 0.04);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.06);
  }

  _laser(vol, pan) {
    if (!this._throttle('laser', 0.05)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.25, pan, 0.2);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.6, 0.002, 0.15);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }

  _explosion(vol, pan, opts) {
    if (!this._throttle('explosion' + (opts.size > 1.5 ? 'big' : ''), 0.04)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const size = opts.size ?? 1;
    const dur = 0.6 + size * 0.7;
    const out = this._out(vol * Math.min(1.3, 0.6 + size * 0.35), pan, 0.9);
    // Rumble (brown noise, long tail)
    const r = this._noiseSrc(this.brown);
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.setValueAtTime(900, t);
    rlp.frequency.exponentialRampToValueAtTime(60, t + dur);
    const rg = ctx.createGain();
    this._env(rg.gain, t, 1.2, 0.005, dur);
    r.connect(rlp).connect(rg).connect(out);
    r.start(t);
    r.stop(t + dur + 0.1);
    // Blast (white noise)
    const n = this._noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(150, t + dur * 0.6);
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.9, 0.002, dur * 0.6);
    n.connect(lp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + dur);
    // Sub drop
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(25, t + dur * 0.7);
    const og = ctx.createGain();
    this._env(og.gain, t, 1.0, 0.004, dur * 0.7);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + dur);
    // Debris crackle
    if (size > 0.8) {
      for (let i = 0; i < 5; i++) {
        const tt = t + 0.1 + Math.random() * dur * 0.6;
        const c = this._noiseSrc();
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.value = rand(1500, 4000);
        const cg = ctx.createGain();
        cg.gain.value = 0;
        cg.gain.setValueAtTime(0.0001, tt);
        cg.gain.linearRampToValueAtTime(0.25, tt + 0.002);
        cg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
        c.connect(hp).connect(cg).connect(out);
        c.start(tt);
        c.stop(tt + 0.08);
      }
    }
  }

  _hit(vol, pan) {
    // Metallic clang / ricochet.
    if (!this._throttle('hit', 0.03)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.4, pan, 0.3);
    const f = rand(500, 900);
    for (const mul of [1, 2.76, 5.4]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const g = ctx.createGain();
      this._env(g.gain, t, 0.5 / mul, 0.001, 0.25 / Math.sqrt(mul));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
    const n = this._noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.5, 0.001, 0.04);
    n.connect(hp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.06);
  }

  _ricochet(vol, pan) {
    if (!this._throttle('ricochet', 0.06)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.22, pan, 0.4);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = rand(2200, 3200);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.25);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.6, 0.002, 0.25);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }

  _thud(vol, pan, opts) {
    // Physical impact: tanks ramming, crates hitting walls.
    if (!this._throttle('thud', 0.05)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * clamp(opts.strength ?? 0.5, 0.1, 1) * 0.9, pan, 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    this._env(g.gain, t, 1, 0.002, 0.18);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.25);
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.7, 0.001, 0.1);
    n.connect(bp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.15);
  }

  _crunch(vol, pan) {
    // Crushing wood / bushes / fences.
    if (!this._throttle('crunch', 0.05)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.5, pan, 0.1);
    for (let i = 0; i < 4; i++) {
      const tt = t + i * rand(0.015, 0.04);
      const n = this._noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = rand(600, 2000);
      bp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.7, tt + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.06);
      n.connect(bp).connect(g).connect(out);
      n.start(tt);
      n.stop(tt + 0.08);
    }
  }

  _splash(vol, pan) {
    if (!this._throttle('splash', 0.15)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.35, pan, 0.2);
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.exponentialRampToValueAtTime(2500, t + 0.3);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.8, 0.02, 0.4);
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.5);
  }

  _missile(vol, pan) {
    if (!this._throttle('missile', 0.04)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.45, pan, 0.3);
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.9, 0.01, 0.6);
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.7);
  }

  _mortar(vol, pan) {
    // Distant 'thoomp' of artillery launching.
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.6, pan, 0.6);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const g = ctx.createGain();
    this._env(g.gain, t, 1, 0.005, 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }

  _whistle(vol, pan, opts) {
    // Incoming shell whistle over `dur` seconds.
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = opts.dur ?? 1.2;
    const out = this._out(vol * 0.12, pan, 0.3);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _pickup(vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.3, 0, 0.3);
    [72, 76, 79, 84].forEach((n, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = NOTE(n);
      const g = ctx.createGain();
      const tt = t + i * 0.05;
      g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.4, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.15);
    });
  }

  _powerup(vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.3, 0, 0.5);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(NOTE(48), t);
    o.frequency.exponentialRampToValueAtTime(NOTE(84), t + 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.6, 0.02, 0.6);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.7);
  }

  _ui(vol, pan, opts) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.2, 0);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = opts.freq ?? 880;
    const g = ctx.createGain();
    this._env(g.gain, t, 0.5, 0.002, 0.08);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }

  _boost(vol, pan) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.5, pan, 0.3);
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2500, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(800, t + 1.0);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.9, 0.05, 1.0);
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 1.2);
  }

  _alarm(vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.18, 0, 0.3);
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const tt = t + i * 0.45;
      o.frequency.setValueAtTime(440, tt);
      o.frequency.linearRampToValueAtTime(880, tt + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.6, tt + 0.03);
      g.gain.linearRampToValueAtTime(0.0001, tt + 0.4);
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 2000;
      o.connect(lp).connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.42);
    }
  }

  _shieldHit(vol, pan) {
    if (!this._throttle('shield', 0.05)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.3, pan, 0.4);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.2);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.7, 0.002, 0.2);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.25);
  }

  _stinger(vol, pan, opts) {
    // Short musical hit for wave start / level up.
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(vol * 0.35, 0, 0.8);
    const chord = opts.chord ?? [57, 60, 64, 69];
    chord.forEach((n) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5000, t);
        lp.frequency.exponentialRampToValueAtTime(300, t + 1.2);
        const g = ctx.createGain();
        this._env(g.gain, t, 0.25, 0.005, 1.3);
        o.connect(lp).connect(g).connect(out);
        o.start(t);
        o.stop(t + 1.4);
      }
    });
  }

  // --- Continuous engine loop ---------------------------------------------------

  _buildEngine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sfx);
    this.engineOut = out;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value = 3;
    lp.connect(out);
    this.engineLP = lp;

    this.engineOsc = [];
    for (const [type, mul, gain] of [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.35],
      ['sawtooth', 2.01, 0.15],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40 * mul;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(lp);
      o.start();
      this.engineOsc.push([o, mul]);
    }
    // Amplitude wobble for the diesel 'chug'.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain).connect(out.gain);
    lfo.start();
    this.engineLFO = lfo;
    this.engineLFOGain = lfoGain;

    // Track clatter: bandpassed noise whose level follows speed.
    const tn = this._noiseSrc();
    const tbp = ctx.createBiquadFilter();
    tbp.type = 'bandpass';
    tbp.frequency.value = 1800;
    tbp.Q.value = 3;
    const tg = ctx.createGain();
    tg.gain.value = 0;
    tn.connect(tbp).connect(tg).connect(this.sfx);
    tn.start();
    this.trackGain = tg;
    // Clatter tremolo
    const tl = ctx.createOscillator();
    tl.type = 'square';
    tl.frequency.value = 12;
    const tlg = ctx.createGain();
    tlg.gain.value = 0;
    tl.connect(tlg).connect(tg.gain);
    tl.start();
    this.trackLFO = tl;
    this.trackLFOGain = tlg;
  }

  updateEngine(throttle, speed, boosting, alive = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const load = clamp(Math.abs(throttle), 0, 1);
    const sp = clamp(speed / 420, 0, 1.5);
    const base = 32 + sp * 38 + load * 10 + (boosting ? 22 : 0);
    for (const [o, mul] of this.engineOsc) o.frequency.setTargetAtTime(base * mul, t, 0.08);
    this.engineLP.frequency.setTargetAtTime(220 + load * 500 + sp * 400 + (boosting ? 900 : 0), t, 0.1);
    this.engineLFO.frequency.setTargetAtTime(7 + sp * 14, t, 0.1);
    const vol = alive ? 0.14 + load * 0.12 + (boosting ? 0.1 : 0) : 0;
    this.engineOut.gain.setTargetAtTime(vol, t, 0.1);
    this.engineLFOGain.gain.setTargetAtTime(vol * 0.45, t, 0.1);
    const clatter = alive ? clamp(sp, 0, 1) * 0.05 : 0;
    this.trackGain.gain.setTargetAtTime(clatter, t, 0.1);
    this.trackLFOGain.gain.setTargetAtTime(clatter * 0.8, t, 0.1);
    this.trackLFO.frequency.setTargetAtTime(6 + sp * 22, t, 0.1);
  }

  _buildRotor() {
    const ctx = this.ctx;
    const n = this._noiseSrc(this.brown);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 13;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 1;
    lfo.connect(lfoG).connect(am.gain);
    n.connect(lp).connect(am).connect(g).connect(this.sfx);
    n.start();
    lfo.start();
    this.rotorGain = g;
  }

  // Loudness for the nearest helicopter (0 = none audible).
  updateRotor(level) {
    if (!this.ctx) return;
    this.rotorGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.5, this.ctx.currentTime, 0.15);
  }

  // --- Music --------------------------------------------------------------------
  // A driving 140bpm minor-key track: kick, snare, hats, bass and an arpeggio
  // lead that fades in as intensity rises.

  _musicInit() {
    this.bpm = 140;
    this.step = 0;
    this.nextNoteTime = 0;
    this.musicPlaying = false;
    // A minor, F, C, G progression (per bar)
    this.progression = [
      [45, [57, 60, 64]],
      [41, [57, 60, 65]],
      [48, [55, 60, 64]],
      [43, [55, 59, 62]],
    ];
  }

  startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this._musicTimer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    this.musicPlaying = false;
    clearInterval(this._musicTimer);
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, this.ctx.currentTime, 0.2);
    return this.musicOn;
  }

  _schedule() {
    const ctx = this.ctx;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 256;
    }
  }

  _playStep(step, t, dur) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const [root, chord] = this.progression[bar];
    const I = this.intensity;
    const bus = this.musicBus;
    const ctx = this.ctx;

    // Kick: four on the floor; extra syncopation when intense.
    if (s16 % 4 === 0 || (I > 0.6 && s16 === 14)) this._kick(t, bus);
    // Snare on 2 and 4
    if (s16 === 4 || s16 === 12) this._snare(t, bus, 0.5);
    if (I > 0.75 && (s16 === 15 || s16 === 7) && Math.random() < 0.5) this._snare(t, bus, 0.2);
    // Hats
    if (I > 0.15) this._hat(t, bus, s16 % 4 === 2 ? 0.16 : 0.07, s16 % 4 === 2 ? 0.08 : 0.03);

    // Bass: driving 8ths with octave jumps.
    if (s16 % 2 === 0) {
      const pattern = [0, 0, 12, 0, 0, 12, 0, 7];
      const n = root - 12 + pattern[(s16 / 2) % 8];
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6;
      lp.frequency.setValueAtTime(300 + I * 1400, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + dur * 1.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.55, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.9);
      o.connect(lp).connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur * 2);
    }

    // Pad: soft chord on bar start.
    if (s16 === 0) {
      for (const n of chord) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = NOTE(n);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.06, t + 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + dur * 16);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + dur * 16 + 0.05);
      }
    }

    // Arp lead fades in with intensity.
    if (I > 0.35) {
      const arp = [0, 1, 2, 1, 2, 0, 1, 2];
      const n = chord[arp[s16 % 8]] + 12 + (s16 >= 8 && I > 0.7 ? 12 : 0);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = NOTE(n);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2500;
      const g = ctx.createGain();
      const lvl = 0.05 * clamp((I - 0.35) / 0.4, 0, 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(lvl, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
      o.connect(lp).connect(g).connect(bus);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      g.connect(send).connect(this.reverbSend);
      o.start(t);
      o.stop(t + dur);
    }
  }

  _kick(t, bus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.32);
  }

  _snare(t, bus, lvl) {
    const ctx = this.ctx;
    const n = this._noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(hp).connect(g).connect(bus);
    n.start(t);
    n.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(lvl * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(bus);
    o.start(t);
    o.stop(t + 0.12);
  }

  _hat(t, bus, lvl, len) {
    const ctx = this.ctx;
    const n = this._noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(hp).connect(g).connect(bus);
    n.start(t);
    n.stop(t + len + 0.01);
  }
}

export const audio = new AudioEngine();
