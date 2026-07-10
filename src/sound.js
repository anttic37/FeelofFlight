// Web Audio synth: engine (detuned saws through a lowpass) + wind (filtered noise).
// Pitch and volume track throttle and airspeed; wind pulses during stall buffet.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.time = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(ctx.destination);

    // engine
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.oscs = [];
    for (const detune of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 80;
      o.detune.value = detune;
      o.connect(this.engFilter);
      o.start();
      this.oscs.push(o);
    }

    // wind: looped noise buffer through a bandpass
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
  }

  update(dt, phys) {
    if (!this.ctx) return;
    this.time += dt;
    const t = this.ctx.currentTime;
    const thr = phys.throttle, spd = phys.speed;

    const engFreq = 42 + thr * 78 + spd * 0.25;
    this.oscs.forEach(o => o.frequency.setTargetAtTime(engFreq, t, 0.06));
    this.engFilter.frequency.setTargetAtTime(300 + thr * 950 + spd * 4, t, 0.08);
    this.engGain.gain.setTargetAtTime(this.muted ? 0 : 0.045 + thr * 0.16, t, 0.08);

    let wind = Math.min(0.5, Math.pow(spd / 95, 2) * 0.45);
    if (phys.stalled) wind *= 1 + 0.5 * Math.sin(this.time * Math.PI * 2 * 9); // buffet
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : wind, t, 0.05);
    this.windFilter.frequency.setTargetAtTime(280 + spd * 13, t, 0.1);
  }

  crash() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
