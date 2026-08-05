// Keyboard + gamepad. Raw targets are smoothed here (the surfaces follow these),
// and the airframe's angular inertia adds the rest of the weight.

// How long you have to keep pushing the throttle past its stop before the engine gives you
// the last 40%, and how fast that intent bleeds away when you stop asking.
const OD_ARM_SECONDS = 1.0;
const OD_DROP_SECONDS = 0.45;

export class Input {
  constructor() {
    this.keys = new Set();
    this.pitch = 0; this.roll = 0; this.yaw = 0;          // targets [-1, 1]
    this.pitchSm = 0; this.rollSm = 0; this.yawSm = 0;     // smoothed (drives surfaces + physics)
    this.wingFlexSm = 0;                                   // G-load wing bend, written by main from physics
    this.throttle = 0.65;
    this.overdrive = 0;   // spooled 0..1, what the engine and the airframe actually feel
    this.odCharge = 0;    // 0..1 build-up while forcing the lever, for the HUD
    this._odOn = false;
    this.invertY = false;
    this.brake = false;
    this.onReset = null;
    this.onMute = null;
    this.onGear = null;
    this.onFlaps = null;
    this.onCamera = null;
    this.onView = null;
    this.onRunwaySpawn = null;
    this.onFreeCam = null;
    this.onTweak = null;
    this.onPause = null;
    this.paused = false;   // set by main; holds the controls still so nothing drifts
    this.freeCam = false;   // set by main; suppresses flight input while the camera flies
    this._gpGearHeld = false;

    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR' && this.onReset) this.onReset();
      if (e.code === 'KeyI') this.invertY = !this.invertY;
      if (e.code === 'KeyM' && this.onMute) this.onMute();
      if (e.code === 'KeyG' && this.onGear) this.onGear();
      if (e.code === 'KeyF' && this.onFlaps) this.onFlaps();
      if (e.code === 'KeyC' && this.onCamera) this.onCamera();
      if (e.code === 'KeyV' && this.onView) this.onView();
      if (e.code === 'KeyT' && this.onRunwaySpawn) this.onRunwaySpawn();
      if (e.code === 'KeyB' && this.onFreeCam) this.onFreeCam();
      if (e.code === 'KeyP' && this.onTweak) this.onTweak();
      if ((e.code === 'Escape' || e.code === 'Pause') && this.onPause) this.onPause();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _key(...codes) { return codes.some(c => this.keys.has(c)) ? 1 : 0; }

  update(dt) {
    // keyboard: flight-sim convention — S/Down = pull up, W/Up = nose down (flip with I)
    // FREE CAMERA TAKES THE STICK. It flies on the same WASD/QE keys, so without this
    // every camera move also feeds the aeroplane — pressing W to fly forward would put
    // the nose down and you would come back from admiring the sky to a smoking hole.
    // Paused counts as free-cam here for the same reason: the smoothed control targets
    // keep integrating from held keys even with physics stopped, so a key resting on the
    // stick during a pause would be waiting at full deflection when you unpause.
    const fc = this.freeCam || this.paused;
    let pitch = fc ? 0 : this._key('KeyS', 'ArrowDown') - this._key('KeyW', 'ArrowUp');
    let roll = fc ? 0 : this._key('KeyD', 'ArrowRight') - this._key('KeyA', 'ArrowLeft');
    let yaw = fc ? 0 : this._key('KeyE') - this._key('KeyQ');
    let thrRate = fc ? 0 : (this._key('KeyX', 'ShiftLeft', 'ShiftRight') - this._key('KeyZ')) * 0.55;

    // gamepad: left stick, triggers throttle, bumpers rudder, A brake, Y gear
    this.brake = !fc && this._key('Space') === 1;
    const gp = !fc && navigator.getGamepads && navigator.getGamepads()[0];
    if (gp) {
      const dz = v => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      roll += dz(gp.axes[0] || 0);
      pitch += dz(gp.axes[1] || 0); // stick back = pull up
      yaw += (gp.buttons[5]?.value || 0) - (gp.buttons[4]?.value || 0);
      thrRate += ((gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0)) * 0.9;
      this.brake = this.brake || !!gp.buttons[0]?.pressed;
      const gearBtn = !!gp.buttons[3]?.pressed;
      if (gearBtn && !this._gpGearHeld && this.onGear) this.onGear();
      this._gpGearHeld = gearBtn;
    }

    if (this.invertY) pitch = -pitch;
    this.pitch = Math.max(-1, Math.min(1, pitch));
    this.roll = Math.max(-1, Math.min(1, roll));
    this.yaw = Math.max(-1, Math.min(1, yaw));
    this.throttle = Math.max(0, Math.min(1, this.throttle + thrRate * dt));

    // OVERDRIVE: keep asking for more once the lever is already against the stop.
    //
    // There is no spare axis for it and no new key to learn — the gesture IS the throttle
    // input, held past the point where it stops doing anything. That reads as forcing the
    // engine rather than switching a mode on: full power is still full power, and this is
    // the bit beyond it you have to lean on to get.
    //
    // IT LATCHES. Once lit it stays lit on its own, and the only thing that puts it out is
    // pulling the power back off the gate. Requiring the key to stay held would make it a
    // "hold to boost" button, and then the throttle no longer means what it says — you would
    // be at 100% with the engine quietly dropping to 100% behind your back. Off the gate and
    // back on costs the full second again, so there is a real price to touching the throttle.
    const atMax = this.throttle >= 0.999;
    // charge only accumulates while ACTIVELY pushing, so it cannot arm by parking at 100%
    const pushing = !fc && thrRate > 0.01 && atMax;
    this.odCharge = pushing
      ? Math.min(1, this.odCharge + dt / OD_ARM_SECONDS)
      : Math.max(0, this.odCharge - dt / OD_DROP_SECONDS);
    if (this.odCharge >= 1) this._odOn = true;
    if (!atMax) { this._odOn = false; this.odCharge = 0; }
    // hold the arming bar full while it is lit, so the HUD reads "in" rather than draining
    if (this._odOn) this.odCharge = 1;
    const want = this._odOn ? 1 : 0;
    // spools in slower than it drops, so backing off is immediate and winding up is not
    this.overdrive += (want - this.overdrive) * Math.min(1, dt * (want ? 1.8 : 4.5));

    const s = Math.min(1, dt * 7);
    this.pitchSm += (this.pitch - this.pitchSm) * s;
    this.rollSm += (this.roll - this.rollSm) * s;
    this.yawSm += (this.yaw - this.yawSm) * s;
  }
}
