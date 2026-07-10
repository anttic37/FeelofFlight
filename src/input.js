// Keyboard + gamepad. Raw targets are smoothed here (the surfaces follow these),
// and the airframe's angular inertia adds the rest of the weight.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pitch = 0; this.roll = 0; this.yaw = 0;          // targets [-1, 1]
    this.pitchSm = 0; this.rollSm = 0; this.yawSm = 0;     // smoothed (drives surfaces + physics)
    this.throttle = 0.65;
    this.invertY = false;
    this.onReset = null;
    this.onMute = null;

    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR' && this.onReset) this.onReset();
      if (e.code === 'KeyI') this.invertY = !this.invertY;
      if (e.code === 'KeyM' && this.onMute) this.onMute();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _key(...codes) { return codes.some(c => this.keys.has(c)) ? 1 : 0; }

  update(dt) {
    // keyboard: flight-sim convention — S/Down = pull up, W/Up = nose down (flip with I)
    let pitch = this._key('KeyS', 'ArrowDown') - this._key('KeyW', 'ArrowUp');
    let roll = this._key('KeyD', 'ArrowRight') - this._key('KeyA', 'ArrowLeft');
    let yaw = this._key('KeyE') - this._key('KeyQ');
    let thrRate = (this._key('KeyX', 'ShiftLeft', 'ShiftRight') - this._key('KeyZ')) * 0.55;

    // gamepad: left stick, triggers throttle, bumpers rudder
    const gp = navigator.getGamepads && navigator.getGamepads()[0];
    if (gp) {
      const dz = v => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      roll += dz(gp.axes[0] || 0);
      pitch += dz(gp.axes[1] || 0); // stick back = pull up
      yaw += (gp.buttons[5]?.value || 0) - (gp.buttons[4]?.value || 0);
      thrRate += ((gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0)) * 0.9;
    }

    if (this.invertY) pitch = -pitch;
    this.pitch = Math.max(-1, Math.min(1, pitch));
    this.roll = Math.max(-1, Math.min(1, roll));
    this.yaw = Math.max(-1, Math.min(1, yaw));
    this.throttle = Math.max(0, Math.min(1, this.throttle + thrRate * dt));

    const s = Math.min(1, dt * 7);
    this.pitchSm += (this.pitch - this.pitchSm) * s;
    this.rollSm += (this.roll - this.rollSm) * s;
    this.yawSm += (this.yaw - this.yawSm) * s;
  }
}
