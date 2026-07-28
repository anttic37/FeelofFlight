// Web Audio synth: engine (detuned saws through a lowpass) + wind (filtered noise).
// Pitch and volume track throttle and airspeed; wind pulses during stall buffet.
// The looped noise buffer also feeds ground-roll rumble and brake-squeal paths.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.braking = false;
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
    this.noiseBuf = buf;
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

    // ground-roll rumble: second path off the same noise source
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    src.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);

    // airframe creak: very low slow-attack groan off the same noise, under g-load
    this.creakFilter = ctx.createBiquadFilter();
    this.creakFilter.type = 'lowpass';
    this.creakFilter.frequency.value = 90;
    this.creakFilter.Q.value = 4;
    this.creakGain = ctx.createGain();
    this.creakGain.gain.value = 0;
    src.connect(this.creakFilter);
    this.creakFilter.connect(this.creakGain);
    this.creakGain.connect(this.master);
    this._creakPrev = 0;

    // pre-stall burble: separated air off the wing root thumping the tail —
    // a low, ragged rush that rides in over the last few degrees before the
    // break. Same noise source, its own lowpass so it sits under the wind.
    this.burbleFilter = ctx.createBiquadFilter();
    this.burbleFilter.type = 'lowpass';
    this.burbleFilter.frequency.value = 320;
    this.burbleFilter.Q.value = 1.6;
    this.burbleGain = ctx.createGain();
    this.burbleGain.gain.value = 0;
    src.connect(this.burbleFilter);
    this.burbleFilter.connect(this.burbleGain);
    this.burbleGain.connect(this.master);

    // stall horn: the reed warner every light aircraft has. Square wave through
    // a gentle lowpass so it reads as a cheap buzzer, not a synth tone.
    this.hornOsc = ctx.createOscillator();
    this.hornOsc.type = 'square';
    this.hornOsc.frequency.value = 840;
    this.hornFilter = ctx.createBiquadFilter();
    this.hornFilter.type = 'lowpass';
    this.hornFilter.frequency.value = 2400;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornOsc.connect(this.hornFilter);
    this.hornFilter.connect(this.hornGain);
    this.hornGain.connect(this.master);
    this.hornOsc.start();

    // brake squeal: narrow bandpass path, driven only via setBrake()
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 2300;
    this.squealFilter.Q.value = 14;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    src.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(this.master);

    src.start();
  }

  setBrake(on) {
    this.braking = !!on;
  }

  update(dt, phys) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try { this.ctx.resume().catch(() => {}); } catch (e) {}
    }
    this.time += dt;
    const t = this.ctx.currentTime;
    const thr = phys.throttle, spd = phys.speed;

    const engFreq = 42 + thr * 78 + spd * 0.25;
    this.oscs.forEach(o => o.frequency.setTargetAtTime(engFreq, t, 0.06));
    this.engFilter.frequency.setTargetAtTime(300 + thr * 950 + spd * 4, t, 0.08);
    this.engGain.gain.setTargetAtTime(this.muted ? 0 : 0.045 + thr * 0.16, t, 0.08);

    // wind: gain cap and filter keep rising past 95 m/s with overspeed — the
    // scream gets louder, brighter and rougher the deeper into the red you go
    const ovs = Math.min(1, Math.max(0, phys.overspeed ?? 0));
    let wind = Math.min(0.5 + ovs * 0.4, Math.pow(spd / 95, 2) * 0.45);
    if (phys.stalled) wind *= 1 + 0.5 * Math.sin(this.time * Math.PI * 2 * 9); // buffet
    if (ovs > 0) wind *= 1 + 0.18 * ovs * Math.sin(this.time * Math.PI * 2 * 11); // flutter
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : wind, t, 0.05);
    this.windFilter.frequency.setTargetAtTime(280 + spd * 13 + ovs * 950, t, 0.1);
    this.windFilter.Q.setTargetAtTime(0.55 + ovs * 1.5, t, 0.2);

    // airframe creak: sustained g bends the wings — slow attack, slow AM wobble
    const drive = Math.min(1, (phys.overG ?? 0) + Math.abs((phys.gLoad ?? 1) - 1) / 3);
    const wob = 0.62 + 0.28 * Math.sin(this.time * 2.3) + 0.1 * Math.sin(this.time * 0.83);
    const creak = this.muted ? 0 : drive * 0.05 * wob;
    this.creakGain.gain.setTargetAtTime(creak, t, creak > this._creakPrev ? 0.45 : 0.15);
    this._creakPrev = creak;
    this.creakFilter.frequency.setTargetAtTime(72 + drive * 28 + Math.sin(this.time * 1.7) * 12, t, 0.2);

    // rolling rumble: silent parked, clearly audible around 30 m/s
    const roll = phys.grounded ? Math.min(0.4, Math.pow(spd / 30, 1.4) * 0.34) : 0;
    this.rumbleGain.gain.setTargetAtTime(this.muted ? 0 : roll, t, 0.09);
    this.rumbleFilter.frequency.setTargetAtTime(90 + spd * 4, t, 0.15);

    // pre-stall burble + horn. The burble is amplitude-modulated at ~14 Hz so
    // it thumps rather than hisses, and it keeps running once fully stalled;
    // the horn comes in over the last third of the margin.
    const sm = Math.min(1, Math.max(0, phys.stallMargin ?? 0));
    const thump = 0.72 + 0.28 * Math.sin(this.time * Math.PI * 2 * 14);
    const burble = this.muted ? 0 : sm * sm * 0.30 * thump;
    this.burbleGain.gain.setTargetAtTime(burble, t, 0.05);
    this.burbleFilter.frequency.setTargetAtTime(220 + sm * 340, t, 0.1);
    const horn = this.muted ? 0 : Math.max(0, (sm - 0.62) / 0.38) * 0.055;
    this.hornGain.gain.setTargetAtTime(horn, t, 0.05);

    const sq = (phys.grounded && spd > 6 && this.braking) ? Math.min(0.06, 0.018 + spd * 0.0012) : 0;
    this.squealGain.gain.setTargetAtTime(this.muted ? 0 : sq, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(2200 + Math.sin(this.time * 23) * 260, t, 0.05);
  }

  // ~1.6s servo whir: filtered saw sweeps down then back up, ends with a clunk
  gearMove() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.8);
    o.frequency.exponentialRampToValueAtTime(145, t + 1.55);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.06);
    g.gain.setValueAtTime(0.045, t + 1.45);
    g.gain.linearRampToValueAtTime(0, t + 1.6);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 1.62);
    const c = ctx.createOscillator();
    c.type = 'sine';
    c.frequency.setValueAtTime(120, t + 1.5);
    c.frequency.exponentialRampToValueAtTime(55, t + 1.62);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.09, t + 1.5);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 1.66);
    c.connect(cg);
    cg.connect(this.master);
    c.start(t + 1.5);
    c.stop(t + 1.68);
  }

  // ~1.2s flap servo: softer, slower and higher-pitched than the gear whir
  flapMove() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.55);
    o.frequency.exponentialRampToValueAtTime(195, t + 1.12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.026, t + 0.18);
    g.gain.setValueAtTime(0.026, t + 1.0);
    g.gain.linearRampToValueAtTime(0, t + 1.2);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 1.22);
  }

  // tire chirp + thud; sink ~1 m/s subtle, ~5 m/s heavy
  touchdown(sink) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1, Math.max(0.12, (sink - 0.4) / 4.6));
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
    f.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 + 0.22 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.15);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.08 + 0.4 * k, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.28);
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
