import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Aircraft-relative chase camera. Angular/radial damping gives follow weight
// without letting translation lag move the aim behind the eye at close zoom.
// Mouse: drag to orbit around the plane (eases back behind when released),
// wheel to zoom in/out.

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// How hard the angular tether follows the plane — cycled with C. Close zoom
// raises the response floor in every mode; wide shots retain their own feel.
const TIGHTNESS = [
  { name: 'TIGHT', response: 7.5, look: 4.5, speedLag: 0.4 },
  { name: 'NORMAL', response: 4.8, look: 2.2, speedLag: 1.0 },
  { name: 'LOOSE', response: 3.2, look: 1.4, speedLag: 1.7 },
  { name: 'FLOATY', response: 2.1, look: 0.9, speedLag: 2.6 },
];

// V cycles external views. No cockpit: this aircraft is an exterior game asset.
// The close view holds its orbit so small details can be inspected while flying.
// Wing-side is aft of the wing, looking AT the aircraft rather than past its nose.
const VIEWS = [
  { name: 'CHASE', zoomMin: -14, zoomMax: 110 },
  { name: 'CLOSE', zoomMin: -5.3, zoomMax: 40, distance: 11.5, fov: 58 },
  { name: 'WING SIDE', zoomMin: -3.7, zoomMax: 75,
    off: { x: 8.4, y: 2.6, z: 8.2 }, look: { x: 0, y: 0.18, z: -0.45 }, fov: 64 },
];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export class ChaseCam {
  constructor(camera, heightAt, domElement = window) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.pos = new THREE.Vector3();
    this.velC = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 62;
    this.time = 0;
    this.gLagSm = 0;   // smoothed G-pull camera lag
    this.accLagSm = 0; // smoothed speed-change lag (accel back, decel closer)
    this._prevSpeed = 0;
    this.mode = 1;     // TIGHTNESS index, default NORMAL
    this.view = 0;     // VIEWS index: 0 chase, 1 close orbit, 2 rear wing-side

    // mouse orbit + zoom
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoomOff = 0;
    this.zoomSm = 0;
    this._viewZoom = [0, 0, 0];
    this._dragging = false;
    this._lx = 0;
    this._ly = 0;
    this._pointerId = null;
    this._anchor = new THREE.Vector3();
    this._haveAnchor = false;

    domElement.addEventListener('pointerdown', e => {
      if ((e.button !== undefined && e.button !== 0) || e.isPrimary === false) return;
      this._dragging = true; this._lx = e.clientX; this._ly = e.clientY;
      this._pointerId = e.pointerId ?? null;
      if (e.pointerId !== undefined) domElement.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointermove', e => {
      if (!this._dragging) return;
      if (this._pointerId !== null && e.pointerId !== undefined && e.pointerId !== this._pointerId) return;
      if (e.buttons === 0) { this._dragging = false; this._pointerId = null; return; }
      const dx = e.clientX - this._lx, dy = e.clientY - this._ly;
      if (this.free) {
        // free look: absolute heading, and pitch stops just short of the poles so the
        // up vector never degenerates
        this.freeYaw -= dx * 0.0042;
        this.freePitch = Math.max(-1.5, Math.min(1.5, this.freePitch - dy * 0.0036));
      } else {
        this.orbitYaw -= dx * 0.006;
        this.orbitPitch += dy * 0.005;
        this.orbitPitch = Math.max(-1.25, Math.min(0.9, this.orbitPitch)); // negative = above the plane
      }
      this._lx = e.clientX;
      this._ly = e.clientY;
    });
    window.addEventListener('pointerup', () => { this._dragging = false; });
    window.addEventListener('pointercancel', () => { this._dragging = false; });
    domElement.addEventListener('lostpointercapture', () => { this._dragging = false; this._pointerId = null; });
    window.addEventListener('blur', () => { this._dragging = false; });
    domElement.addEventListener('wheel', e => {
      e.preventDefault();
      // Normalize pixel, line and page deltas for mice and trackpads alike.
      this.zoomBy(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 500 : 1));
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target?.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target?.tagName || '')) return;
      // Prefer the printed key, so +/− also work on non-US keyboard layouts.
      const direction = e.key === '+' || e.key === '=' ? -1 : e.key === '-' ? 1 :
        e.code === 'NumpadAdd' ? -1 : e.code === 'NumpadSubtract' ? 1 :
        !e.key && e.code === 'Equal' ? -1 : !e.key && e.code === 'Minus' ? 1 : 0;
      if (direction) { e.preventDefault(); this.zoomBy(direction * 100); }
    });
    window.addEventListener('contextmenu', e => e.preventDefault());

    // pilot head: a small sprung mass on the airframe. It lags acceleration,
    // sinks under g and rises when you unload, so the plane is felt through the
    // eye instead of the view being bolted rigidly to the fuselage.
    this.head = new THREE.Vector3();     // body-frame offset, metres
    this.headV = new THREE.Vector3();
    this._prevVel = new THREE.Vector3();
    this._haveVel = false;

    // FREE CAMERA (B). Detaches from the aeroplane entirely so the clouds can be
    // flown into and looked at from any angle — the chase cam can only ever see them
    // from wherever the aircraft happens to be, which is a poor way to judge a sky.
    // Its own yaw/pitch rather than the orbit angles, so coming back to chase does not
    // inherit a view pointing at nothing.
    this.free = false;
    this.freePos = new THREE.Vector3();
    this.freeVel = new THREE.Vector3();
    this.freeYaw = 0;
    this.freePitch = 0;
    this.freeSpeed = 70;     // m/s, wheel scales it

    // crash: the wreck tumbles, the camera must not (see update)
    this._wasCrashed = false;
    this._crashDir = new THREE.Vector3(0, 0, 1);
    this._crashSpeed = 0;
    this._crashDist = 30;
    this._crashZoom = 0;

    this._t = { fwd: new THREE.Vector3(), up: new THREE.Vector3(), mix: new THREE.Vector3(),
                des: new THREE.Vector3(), lt: new THREE.Vector3(), right: new THREE.Vector3(),
                a: new THREE.Vector3(), dir: new THREE.Vector3(),
                acc: new THREE.Vector3(), hd: new THREE.Vector3(), q: new THREE.Quaternion(),
                offset: new THREE.Vector3(), goal: new THREE.Vector3(), back: new THREE.Vector3(),
                aimUp: new THREE.Vector3(), wantUp: new THREE.Vector3(), cross: new THREE.Vector3(),
                stepQ: new THREE.Quaternion() };
  }

  cycleTightness() {
    this.mode = (this.mode + 1) % TIGHTNESS.length;
    return TIGHTNESS[this.mode].name;
  }

  get viewName() { return this.free ? 'FREE' : VIEWS[this.view].name; }

  zoomBy(deltaPixels) {
    if (!Number.isFinite(deltaPixels)) return;
    if (this.free) {
      this.freeSpeed = clamp(this.freeSpeed * Math.exp(-deltaPixels * 0.0012), 2, 4000);
      return;
    }
    const view = VIEWS[this.view];
    const step = deltaPixels * 0.012 * (1 + Math.max(0, this.zoomOff) * 0.055);
    this.zoomOff = clamp(this.zoomOff + step, view.zoomMin, view.zoomMax);
    this._viewZoom[this.view] = this.zoomOff;
  }

  setView(index, phys) {
    if (!Number.isInteger(index) || !VIEWS[index]) return this.viewName;
    this._viewZoom[this.view] = this.zoomOff;
    this.view = index;
    this.zoomOff = this._viewZoom[index];
    this.zoomSm = this.zoomOff;
    this.orbitYaw = 0; this.orbitPitch = 0; this._dragging = false;
    // Keep the current eye when switching: _followOffset takes the safe arc to the
    // new preset. A straight interpolation cuts through the fuselage at close range.
    if (phys && !this.free) {
      this.pos.copy(this.camera.position); this.look.copy(phys.pos);
      this.velC.set(0, 0, 0); this.accLagSm = 0; this._prevSpeed = phys.speed;
      this._anchor.copy(phys.pos); this._haveAnchor = true;
    }
    return this.viewName;
  }

  resetFraming(phys) {
    this.zoomOff = 0; this._viewZoom[this.view] = 0;
    this.orbitYaw = 0; this.orbitPitch = 0;
    this._dragging = false;
    if (phys && !this.free) {
      this.velC.set(0, 0, 0); this.accLagSm = 0; this._prevSpeed = phys.speed;
    }
  }

  // Enter free flight from exactly where the chase camera already is, aimed exactly
  // where it was aimed — so the toggle is a continuation of the shot rather than a
  // teleport, and toggling back drops you into the spring from behind the aeroplane.
  toggleFree(phys) {
    this.free = !this.free;
    if (this.free) {
      this.freePos.copy(this.camera.position);
      this.freeVel.set(0, 0, 0);
      const d = this.camera.getWorldDirection(this._t.dir);
      const len = d.length();
      if (len > 1e-4) {
        d.divideScalar(len);
        this.freeYaw = Math.atan2(-d.x, -d.z);
        this.freePitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
      }
    } else if (phys) {
      this.pos.copy(this.camera.position); this.look.copy(phys.pos);
      this.velC.set(0, 0, 0); this.accLagSm = 0; this._prevSpeed = phys.speed;
      this._anchor.copy(phys.pos); this._haveAnchor = true;
    }
    return this.free;
  }

  // Free flight. Held keys give a target velocity in the camera's own frame and the
  // actual velocity eases toward it, which is what keeps hand-held pans watchable —
  // stepping the position straight from the keys reads as a stutter at any speed.
  _updateFree(dt, input) {
    const t = this._t;
    const cp = Math.cos(this.freePitch), sp = Math.sin(this.freePitch);
    const cy = Math.cos(this.freeYaw), sy = Math.sin(this.freeYaw);
    const fwd = t.fwd.set(-sy * cp, sp, -cy * cp);
    const right = t.right.set(cy, 0, -sy);

    let f = 0, r = 0, u = 0;
    if (input) {
      f = input._key('KeyW', 'ArrowUp') - input._key('KeyS', 'ArrowDown');
      r = input._key('KeyD', 'ArrowRight') - input._key('KeyA', 'ArrowLeft');
      u = input._key('KeyE') - input._key('KeyQ');
    }
    const boost = input && input._key('ShiftLeft', 'ShiftRight') ? 5 : (input && input._key('KeyZ') ? 0.2 : 1);
    const spd = this.freeSpeed * boost;
    t.des.set(0, 0, 0)
      .addScaledVector(fwd, f * spd)
      .addScaledVector(right, r * spd)
      .addScaledVector(WORLD_UP, u * spd);
    this.freeVel.lerp(t.des, Math.min(1, dt * 6));
    this.freePos.addScaledVector(this.freeVel, dt);

    this.camera.position.copy(this.freePos);
    this._aim(t.lt.copy(this.freePos).add(fwd), WORLD_UP, dt);
    this.fov += (62 - this.fov) * Math.min(1, dt * 5);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  cycleView(phys) {
    return this.setView((this.view + 1) % VIEWS.length, phys);
  }

  snap(phys) {
    const t = this._t;
    const fwd = t.fwd.set(0, 0, -1).applyQuaternion(phys.quat);
    this.pos.copy(phys.pos).addScaledVector(fwd, -13).addScaledVector(WORLD_UP, 4);
    this.velC.set(0, 0, 0);
    this.look.copy(phys.pos);
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.accLagSm = 0;
    this._prevSpeed = phys.speed; // no lag spike from teleports
    this.head.set(0, 0, 0);
    this.headV.set(0, 0, 0);
    this._haveVel = false;        // teleports must not read as a huge acceleration
    this._wasCrashed = false;
    this._anchor.copy(phys.pos); this._haveAnchor = true;
  }

  // Follow in aircraft-relative space, on a SPHERE. Cartesian spring motion can
  // shortcut an orbit through the aircraft; world-space aim lag can leave the
  // look target behind the camera at 80 m/s. Position translation is transported
  // separately in update; only angle and distance lag behind a manoeuvre.
  _followOffset(desired, origin, angularRate, radialRate, dt) {
    const t = this._t;
    const current = t.offset.copy(this.pos).sub(origin);
    const goal = t.goal.copy(desired).sub(origin);
    const radius = Math.max(6.3, current.length());
    const goalRadius = Math.max(6.3, goal.length());
    if (current.lengthSq() < 1e-8) current.copy(goal);
    current.normalize(); goal.normalize();
    t.q.setFromUnitVectors(current, goal);
    const turn = 2 * Math.acos(clamp(t.q.w, -1, 1));
    // Preset switches and large drag events cannot demand a one-frame whip-pan.
    const angularBlend = Math.min(1 - Math.exp(-angularRate * dt), turn > 1e-6 ? 4.5 * dt / turn : 1);
    t.stepQ.identity().slerp(t.q, angularBlend);
    current.applyQuaternion(t.stepQ).normalize();
    const nextRadius = radius + (goalRadius - radius) * (1 - Math.exp(-radialRate * dt));
    this.pos.copy(origin).addScaledVector(current, nextRadius);
    this.velC.set(0, 0, 0);
  }

  // Aim stays on the aircraft; only roll is damped. Projecting the previous up
  // into the new view plane parallel-transports the horizon through verticals.
  // Never normalize a world-up + inverted-plane-up cancellation into a 180° flip.
  _aim(target, preferredUp, dt) {
    const t = this._t;
    const back = t.back.copy(this.camera.position).sub(target).normalize();
    const up = t.aimUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    up.addScaledVector(back, -up.dot(back));
    if (up.lengthSq() < 1e-6) {
      up.set(1, 0, 0).addScaledVector(back, -back.x);
      if (up.lengthSq() < 1e-6) up.set(0, 0, 1).addScaledVector(back, -back.z);
    }
    up.normalize();
    const want = t.wantUp.copy(preferredUp).addScaledVector(back, -preferredUp.dot(back));
    if (want.lengthSq() > 0.04) {
      want.normalize();
      const angle = Math.atan2(back.dot(t.cross.copy(up).cross(want)), clamp(up.dot(want), -1, 1));
      up.applyAxisAngle(back, clamp(angle * (1 - Math.exp(-dt * 5)), -dt * 1.6, dt * 1.6));
    }
    this.camera.up.copy(up);
    this.camera.lookAt(target);
  }

  _constrainEye(origin, groundClearance) {
    const eye = this.camera.position;
    // Raising an under-wing eye to the ground can collapse a safe orbit radius
    // into the fuselage. Resolve ground clearance AND aircraft clearance together.
    for (let pass = 0; pass < 4; pass++) {
      eye.y = Math.max(eye.y, Math.max(0, this.heightAt(eye.x, eye.z)) + groundClearance);
      const dx = eye.x - origin.x, dy = eye.y - origin.y, dz = eye.z - origin.z;
      if (dx * dx + dy * dy + dz * dz >= 6.3 * 6.3 - 1e-7) break;
      const horizontal = Math.hypot(dx, dz);
      const safeHorizontal = Math.sqrt(Math.max(0, 6.3 * 6.3 - dy * dy)) + 0.001;
      eye.x = origin.x + (horizontal > 1e-6 ? dx / horizontal : 0) * safeHorizontal;
      eye.z = origin.z + (horizontal > 1e-6 ? dz / horizontal : 1) * safeHorizontal;
    }
    eye.y = Math.max(eye.y, Math.max(0, this.heightAt(eye.x, eye.z)) + groundClearance);
  }

  // Pilot-head spring. Acceleration in BODY frame drives an offset in the
  // opposite direction (your head keeps going when the airframe changes
  // course), plus a vertical sag under g. Returns the offset in this.head.
  _updateHead(dt, phys) {
    const t = this._t;
    const acc = t.acc;
    if (this._haveVel && dt > 1e-4) {
      acc.copy(phys.vel).sub(this._prevVel).divideScalar(dt);
    } else {
      acc.set(0, 0, 0);
    }
    this._prevVel.copy(phys.vel);
    this._haveVel = true;
    // into body frame, then clamp: a crash spike must not fling the view
    acc.applyQuaternion(t.q.copy(phys.quat).invert());
    const gz = Math.max(-4, Math.min(4, ((phys.gLoad ?? 1) - 1)));
    const target = t.hd.set(
      Math.max(-9, Math.min(9, acc.x)) * -0.022,
      Math.max(-9, Math.min(9, acc.y)) * -0.014 - gz * 0.035,
      Math.max(-9, Math.min(9, acc.z)) * -0.020,
    );
    // critically-damped-ish spring so it settles without wobbling like jelly
    const k = 42, damp = 2 * Math.sqrt(k) * 0.85;
    this.headV.addScaledVector(t.a.copy(target).sub(this.head).multiplyScalar(k).addScaledVector(this.headV, -damp), dt);
    this.head.addScaledVector(this.headV, dt);
    const lim = 0.42; // hard cap — the head never leaves the cockpit
    this.head.set(
      Math.max(-lim, Math.min(lim, this.head.x)),
      Math.max(-lim, Math.min(lim, this.head.y)),
      Math.max(-lim, Math.min(lim, this.head.z)),
    );
  }

  update(dt, phys, input) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    const t = this._t;
    this.time += dt;
    if (this.free) { this._updateFree(dt, input); return; }
    if (this._haveAnchor) {
      const travel = t.a.copy(phys.pos).sub(this._anchor);
      this.pos.add(travel); this.look.add(travel);
    }
    this._anchor.copy(phys.pos); this._haveAnchor = true;
    this._updateHead(dt, phys);
    const fwd = t.fwd.set(0, 0, -1).applyQuaternion(phys.quat);
    const planeUp = t.up.set(0, 1, 0).applyQuaternion(phys.quat);

    this.zoomSm += (this.zoomOff - this.zoomSm) * Math.min(1, dt * 6);
    // External detail views follow the airframe directly, with damped zoom.
    // A crash always switches to the existing world-up observer behaviour.
    if (this.view !== 0 && !phys.crashed) {
      const v = VIEWS[this.view];
      if (this.view === 1) {
        const distance = Math.max(6.2, v.distance + this.zoomSm);
        const elevation = clamp(0.22 - this.orbitPitch, -1.2, 1.48);
        const yaw = 0.65 + this.orbitYaw;
        t.des.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation))
          .multiplyScalar(distance);
        t.lt.set(0, 0.18, 0);
      } else {
        if (!this._dragging) {
          const ease = 1 - Math.exp(-dt * 2.2);
          this.orbitYaw *= 1 - ease; this.orbitPitch *= 1 - ease;
        }
        t.lt.set(v.look.x, v.look.y, v.look.z);
        t.des.set(v.off.x, v.off.y, v.off.z).sub(t.lt);
        t.des.setLength(Math.max(8, t.des.length() + this.zoomSm));
        t.des.applyAxisAngle(WORLD_UP, this.orbitYaw);
        t.right.copy(WORLD_UP).cross(t.des).normalize();
        t.des.applyAxisAngle(t.right, this.orbitPitch);
      }
      t.des.add(t.lt).applyQuaternion(phys.quat).add(phys.pos);
      t.lt.applyQuaternion(phys.quat).add(phys.pos);
      this._followOffset(t.des, phys.pos, 10, 10, dt);
      this.camera.position.copy(this.pos);
      this._constrainEye(phys.pos, 0.65);
      this.pos.copy(this.camera.position); this.velC.set(0, 0, 0);
      this.look.copy(t.lt); this._wasCrashed = false;
      // Keep chase acceleration history current while a different view is active.
      this._prevSpeed = phys.speed; this.accLagSm = 0;
      this.fov += (v.fov - this.fov) * Math.min(1, dt * 5);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      this._aim(t.lt, this.view === 2 ? planeUp : WORLD_UP, dt);
      return;
    }

    // CRASH: the wreck tumbles, the camera must not. Everything below derives
    // from phys.quat — the up vector partly follows the plane's own up, and the
    // chase direction is the plane's forward — so once the airframe is cartwheeling
    // the view rolls and orbits with it, which is unwatchable and tells you
    // nothing. From the moment of impact the camera becomes an OBSERVER: world
    // up, and a viewing direction frozen at the direction it was already
    // watching from, so the wreck tumbles across a steady frame.
    const crashed = !!phys.crashed;
    if (crashed && !this._wasCrashed) {
      // Freeze the bearing we are already on — not the plane's, which by now is whatever
      // attitude it happened to break at.
      // NOT FLATTENED, and that was the camera diving at every impact. The desired position is
      // wreck + dir*dist + up*3.6, so zeroing dir.y does not merely change the bearing, it
      // drops the shot to 3.6 m above the wreck no matter where it was watching from. In a
      // dive -fwd points well UP, so the camera is high; measured on a 34 degree dive it sat
      // 34.2 m above the aeroplane at the moment of impact and then sank to 4.9 m over about a
      // second. That sink is the whole of the "camera wants to go down" on contact.
      // Flattening was never what kept the view level anyway: upMix is forced to WORLD_UP for
      // the entire crash a few lines below, so the roll this was guarding against cannot
      // happen. Keeping the full offset holds the exact framing the shot already had, which is
      // what every other frozen term here is for.
      this._crashDir.copy(this.pos).sub(phys.pos);
      if (this._crashDir.lengthSq() < 1e-6) this._crashDir.copy(fwd).setY(0).negate();
      this._crashDir.normalize();
      // ...but never fully overhead: a straight-down bearing leaves lookAt with no horizon to
      // orient against, and the view spins on the spot.
      if (this._crashDir.y > 0.85) { this._crashDir.y = 0.85; this._crashDir.normalize(); }
      // the speed the distance term keeps using for the rest of the crash
      this._crashSpeed = phys.speed;
      // ...and the standoff it already had. Freezing the terms that FEED the distance was
      // still not the whole story: the camera is a spring, and at the moment of impact it is
      // trailing well behind its own target because the aeroplane was fast. Hold the target
      // where the shot already is and the spring has nothing left to close — otherwise it
      // spends the next few seconds reeling itself in, which is the move being complained
      // about even with every distance term nailed down. Floored so a slow crash cannot
      // leave the wreck tumbling in the camera's lap.
      this._crashDist = Math.max(24, this.pos.distanceTo(phys.pos));
      this._crashZoom = this.zoomSm;
    }
    this._wasCrashed = crashed;

    // Orbit axes stay in one continuous body frame through rolls and loops.
    // Horizon stabilization is separate in _aim: mixing world/plane up here
    // used to cancel at certain inverted attitudes and flip both orbit axes.
    const upMix = t.mix.copy(crashed ? WORLD_UP : planeUp);

    // orbit eases back behind the plane when the mouse is released
    if (!this._dragging) {
      const rc = 1 - Math.exp(-dt * 2.2);
      this.orbitYaw -= this.orbitYaw * rc;
      this.orbitPitch -= this.orbitPitch * rc;
    }

    // G-lag: sustained pull eases the camera back a touch — pulls feel heavier
    const gk = Math.min(1, Math.max(0, ((phys.gLoad ?? 1) - 1) / 3));
    this.gLagSm += (gk - this.gLagSm) * Math.min(1, dt * 3.5);

    // speed-change lag: acceleration stretches the tether (camera falls back),
    // deceleration lets it surge closer. Builds fast, RELEASES slowly — the
    // camera doesn't catch back up the moment the speed settles.
    const tn = TIGHTNESS[this.mode];
    const acc = dt > 0 ? (phys.speed - this._prevSpeed) / dt : 0;
    this._prevSpeed = phys.speed;
    // ...but NOT ON A CRASH. That surge-closer is for easing off the throttle, where coming
    // in a little is the whole point; a crash is the hardest deceleration there is, so the
    // same rule slammed the camera onto the wreck at the exact moment there is most to look
    // at. Only the stretch-back half survives once the airframe is broken.
    // ...but NOT ON A CRASH, and clamping the target to zero was not enough on its own: the
    // tether is usually STRETCHED at the moment of impact, and with the target at zero that
    // stretch simply releases, walking the camera in by up to 14 m over the next few seconds.
    // Measured 44 m down to 19 m across a crash — slower than before but the same move. The
    // whole term is frozen instead, so the shot holds exactly the framing it had.
    let accTarget = Math.max(-8, Math.min(14, acc * 2.2)) * tn.speedLag;
    if (crashed) accTarget = this.accLagSm;
    const accRate = Math.abs(accTarget) > Math.abs(this.accLagSm) ? 3.0 : 0.55;
    this.accLagSm += (accTarget - this.accLagSm) * Math.min(1, dt * accRate);

    // and the speed term is held at the impact speed rather than following the wreck down to
    // nothing, so the shot does not creep in over the slide either
    const distSpeed = crashed ? this._crashSpeed : phys.speed;
    // Cinematic acceleration/G tugs are useful from afar, not at inspection range.
    const cinematic = clamp((this.zoomSm + 12) / 12, 0, 1);
    const dist = crashed
      ? Math.max(7, this._crashDist + this.zoomSm - this._crashZoom)
      : Math.max(6.5, 17 + distSpeed * 0.04 + this.zoomSm + cinematic * (this.gLagSm * 0.9 + this.accLagSm));
    const wide = clamp((dist - 6.5) / 12, 0, 1);
    // a crashed airframe's forward vector is meaningless, so hold the bearing
    // frozen at impact instead of orbiting with the tumble
    const dir = crashed ? t.dir.copy(this._crashDir) : t.dir.copy(fwd).negate();
    const orbitMag = Math.abs(this.orbitYaw) + Math.abs(this.orbitPitch);
    if (orbitMag > 1e-4) {
      dir.applyAxisAngle(upMix, this.orbitYaw);
      const rightAxis = t.right.copy(upMix).cross(dir).normalize();
      dir.applyAxisAngle(rightAxis, this.orbitPitch);
    }
    const des = t.des.copy(phys.pos).addScaledVector(dir, dist).addScaledVector(upMix, 1.6 + 2 * wide);

    // Damped angular tether: safe arcs, with a faster close-range response.
    const response = tn.response;
    const closeFollow = 1 - clamp((dist - 8) / 12, 0, 1);
    this._followOffset(des, phys.pos, Math.max(response, closeFollow * 10),
      Math.max(response, 7), dt);

    // Look slightly ahead in wide shots; near zoom centers the aircraft. The
    // target is already translated with the plane, so only this small local lead
    // is damped — never the plane's whole world-space motion.
    // Aim: lead the plane in flight, but sit straight on the wreck after a crash.
    // Leading along a tumbling forward vector would swing the aim around the
    // frame, and the g-load term spikes hard on impact.
    const ahead = crashed ? 0 : 4 * wide * cinematic / (1 + 3 * orbitMag);
    const gOff = crashed ? 0 : cinematic * Math.max(-0.8, Math.min(1.6, (phys.gLoad - 1) * 0.55));
    const lt = t.lt.copy(phys.pos).addScaledVector(fwd, ahead)
      .addScaledVector(crashed ? WORLD_UP : planeUp, 0.8 + gOff);
    this.look.lerp(lt, 1 - Math.exp(-dt * Math.max(tn.look, 12 * closeFollow)));

    // FOV stretches with speed
    const fovTarget = 58 + wide * (Math.min(84, Math.max(60, 62 + Math.max(0, phys.speed - 32) * 0.24)) - 58);
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // shake: speed² + PRE-stall burble (squared so it creeps in, then bites) +
    // stall break + flaps-overspeed buffet + airframe overspeed
    const sm = phys.stallMargin ?? 0;
    const motionScale = 0.08 + 0.92 * cinematic;
    const amp = motionScale * (Math.pow(phys.speed / 115, 2) * 0.25 + sm * sm * 0.45 + (phys.stalled ? 0.3 : 0)
      + (phys.flapBuffet ?? 0) * 0.35 + (phys.overspeed ?? 0) * 0.4);
    const right = t.right.copy(fwd).cross(upMix).normalize();
    // the chase camera feels the head spring too, at reduced weight — it reads
    // as the whole rig being shoved around rather than a floating tripod
    this.camera.position.copy(this.pos)
      .addScaledVector(right, fbm1(this.time * 6.5, 6) * amp + this.head.x * 1.6 * motionScale)
      .addScaledVector(upMix, fbm1(this.time * 7.1, 7) * amp + this.head.y * 1.6 * motionScale)
      .addScaledVector(fwd, this.head.z * -1.6 * motionScale);

    // never sink below the terrain
    t.hd.copy(this.camera.position);
    this._constrainEye(phys.pos, 1.6);
    // Feed only collision correction back into the tether, not the visual shake.
    this.pos.add(t.goal.copy(this.camera.position).sub(t.hd));

    this._aim(this.look, WORLD_UP, dt);
  }
}
