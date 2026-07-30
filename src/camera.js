import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Spring chase camera. The lag between plane and camera is deliberate — it is
// most of the "feel". Partial roll-follow, speed-driven FOV, noise shake.
// Mouse: drag to orbit around the plane (eases back behind when released),
// wheel to zoom in/out.

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// how hard the camera is glued to the plane — cycled with C. k = spring
// stiffness, damp = damping ratio (1 critical, lower floats), look = aim lag
const TIGHTNESS = [
  { name: 'TIGHT', k: 60, damp: 1.0, look: 4.5, speedLag: 0.4 },
  { name: 'NORMAL', k: 26, damp: 0.92, look: 2.2, speedLag: 1.0 },
  { name: 'LOOSE', k: 12, damp: 0.85, look: 1.4, speedLag: 1.7 },
  { name: 'FLOATY', k: 6, damp: 0.8, look: 0.9, speedLag: 2.6 },
];

// V cycles rigid onboard views between the chase cam: cockpit (pilot's head
// behind the windscreen) and wing (mounted just outboard of the right tip,
// looking forward along the wing — shows the flex, ailerons and ground rush).
// Offsets are body-frame (fwd = -Z), applied with the plane's quaternion.
const VIEWS = [
  { name: 'CHASE' },
  { name: 'COCKPIT', off: { x: 0, y: 1.18, z: -0.42 }, look: { x: 0, y: 0.9, z: -60 }, fov: 72 },
  { name: 'WING', off: { x: 6.2, y: 1.05, z: 1.7 }, look: { x: 1.2, y: 0.4, z: -30 }, fov: 66 },
];

export class ChaseCam {
  constructor(camera, heightAt) {
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
    this.view = 0;     // VIEWS index: 0 chase, 1 cockpit, 2 wing

    // mouse orbit + zoom
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoomOff = 0;
    this.zoomSm = 0;
    this._dragging = false;
    this._lx = 0;
    this._ly = 0;

    window.addEventListener('pointerdown', e => { this._dragging = true; this._lx = e.clientX; this._ly = e.clientY; });
    window.addEventListener('pointermove', e => {
      if (!this._dragging) return;
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
    window.addEventListener('blur', () => { this._dragging = false; });
    // Zoom range runs much further back now (34 -> 110 m of extra tether), and
    // the step scales with how far out you already are: fine control close to
    // the aircraft where a metre matters, and you are not scrolling for a week
    // to get out to the wide shots.
    window.addEventListener('wheel', e => {
      if (this.free) {
        // in free flight the wheel is the throttle, not a zoom — geometric so one
        // scroll gesture covers walking pace to crossing the island
        this.freeSpeed = Math.max(2, Math.min(4000, this.freeSpeed * Math.exp(-e.deltaY * 0.0012)));
        return;
      }
      const step = e.deltaY * 0.012 * (1 + Math.max(0, this.zoomOff) * 0.055);
      this.zoomOff = Math.max(-8, Math.min(110, this.zoomOff + step));
    }, { passive: true });
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

    this._t = { fwd: new THREE.Vector3(), up: new THREE.Vector3(), mix: new THREE.Vector3(),
                des: new THREE.Vector3(), lt: new THREE.Vector3(), right: new THREE.Vector3(),
                a: new THREE.Vector3(), dir: new THREE.Vector3(),
                acc: new THREE.Vector3(), hd: new THREE.Vector3(), q: new THREE.Quaternion() };
  }

  cycleTightness() {
    this.mode = (this.mode + 1) % TIGHTNESS.length;
    return TIGHTNESS[this.mode].name;
  }

  // Enter free flight from exactly where the chase camera already is, aimed exactly
  // where it was aimed — so the toggle is a continuation of the shot rather than a
  // teleport, and toggling back drops you into the spring from behind the aeroplane.
  toggleFree(phys) {
    this.free = !this.free;
    if (this.free) {
      this.freePos.copy(this.camera.position);
      this.freeVel.set(0, 0, 0);
      const d = this._t.dir.copy(this.look).sub(this.camera.position);
      const len = d.length();
      if (len > 1e-4) {
        d.divideScalar(len);
        this.freeYaw = Math.atan2(-d.x, -d.z);
        this.freePitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
      }
    } else if (phys) {
      this.snap(phys);
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
    this.camera.up.copy(WORLD_UP);
    this.camera.lookAt(t.lt.copy(this.freePos).add(fwd));
    this.fov += (62 - this.fov) * Math.min(1, dt * 5);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  cycleView(phys) {
    this.view = (this.view + 1) % VIEWS.length;
    if (this.view === 0 && phys) this.snap(phys); // spring restarts from behind the plane
    return VIEWS[this.view].name;
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
    const t = this._t;
    this.time += dt;
    if (this.free) { this._updateFree(dt, input); return; }
    this._updateHead(dt, phys);
    const fwd = t.fwd.set(0, 0, -1).applyQuaternion(phys.quat);
    const planeUp = t.up.set(0, 1, 0).applyQuaternion(phys.quat);

    // rigid onboard views (V): bolted to the airframe — no spring, no orbit,
    // just a touch of buffet so speed and stall still reach the eye
    if (this.view !== 0) {
      const v = VIEWS[this.view];
      const sm = phys.stallMargin ?? 0;
      // engine vibration: always there, strongest at high power and low speed
      const vib = 0.010 * (phys.throttle ?? 0) * (1 - Math.min(1, phys.speed / 120));
      const amp = Math.pow(phys.speed / 115, 2) * 0.09 + sm * sm * 0.20 + (phys.stalled ? 0.14 : 0)
        + (phys.flapBuffet ?? 0) * 0.12 + (phys.overspeed ?? 0) * 0.15;
      // head offset rides in the body frame, so it leans with the airframe
      this.camera.position.set(v.off.x + this.head.x, v.off.y + this.head.y, v.off.z + this.head.z)
        .applyQuaternion(phys.quat).add(phys.pos)
        .addScaledVector(planeUp, fbm1(this.time * 7.1, 7) * amp + fbm1(this.time * 41, 15) * vib)
        .addScaledVector(fwd, fbm1(this.time * 37, 16) * vib);
      t.lt.set(v.look.x, v.look.y, v.look.z).applyQuaternion(phys.quat).add(phys.pos);
      this.fov += (v.fov - this.fov) * Math.min(1, dt * 5);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      this.camera.up.copy(planeUp);
      this.camera.lookAt(t.lt);
      return; // cycleView snaps the spring when we come back to CHASE
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
      // freeze the bearing we are already on, flattened — not the plane's, which
      // by now is whatever attitude it happened to break at
      this._crashDir.copy(this.pos).sub(phys.pos);
      this._crashDir.y = 0;
      if (this._crashDir.lengthSq() < 1e-6) this._crashDir.copy(fwd).setY(0).negate();
      this._crashDir.normalize();
    }
    this._wasCrashed = crashed;

    // camera up: mostly world in level flight so banking reads on screen, but as
    // the nose leaves level (loops, verticals) blend toward the plane's own up —
    // a world-locked up flips/spins the view when fwd nears +-Y.
    const sv = Math.min(1, Math.max(0, (Math.abs(fwd.y) - 0.45) / 0.45));
    const steep = sv * sv * (3 - 2 * sv); // smoothstep(0.45, 0.9, |fwd.y|)
    const upMix = crashed
      ? t.mix.copy(WORLD_UP)
      : t.mix.copy(WORLD_UP).multiplyScalar(0.75 * (1 - steep))
          .addScaledVector(planeUp, 0.25 + 0.75 * steep).normalize();

    // orbit eases back behind the plane when the mouse is released
    if (!this._dragging) {
      const rc = 1 - Math.exp(-dt * 2.2);
      this.orbitYaw -= this.orbitYaw * rc;
      this.orbitPitch -= this.orbitPitch * rc;
    }
    this.zoomSm += (this.zoomOff - this.zoomSm) * Math.min(1, dt * 6);

    // G-lag: sustained pull eases the camera back a touch — pulls feel heavier
    const gk = Math.min(1, Math.max(0, ((phys.gLoad ?? 1) - 1) / 3));
    this.gLagSm += (gk - this.gLagSm) * Math.min(1, dt * 3.5);

    // speed-change lag: acceleration stretches the tether (camera falls back),
    // deceleration lets it surge closer. Builds fast, RELEASES slowly — the
    // camera doesn't catch back up the moment the speed settles.
    const tn = TIGHTNESS[this.mode];
    const acc = dt > 0 ? (phys.speed - this._prevSpeed) / dt : 0;
    this._prevSpeed = phys.speed;
    const accTarget = Math.max(-8, Math.min(14, acc * 2.2)) * tn.speedLag;
    const accRate = Math.abs(accTarget) > Math.abs(this.accLagSm) ? 3.0 : 0.55;
    this.accLagSm += (accTarget - this.accLagSm) * Math.min(1, dt * accRate);

    const dist = Math.max(7, 17 + phys.speed * 0.04 + this.zoomSm + this.gLagSm * 0.9 + this.accLagSm);
    // a crashed airframe's forward vector is meaningless, so hold the bearing
    // frozen at impact instead of orbiting with the tumble
    const dir = crashed ? t.dir.copy(this._crashDir) : t.dir.copy(fwd).negate();
    const orbitMag = Math.abs(this.orbitYaw) + Math.abs(this.orbitPitch);
    if (orbitMag > 1e-4) {
      dir.applyAxisAngle(upMix, this.orbitYaw);
      const rightAxis = t.right.copy(upMix).cross(dir).normalize();
      dir.applyAxisAngle(rightAxis, this.orbitPitch);
    }
    const des = t.des.copy(phys.pos).addScaledVector(dir, dist).addScaledVector(upMix, 3.6);

    // spring toward desired position; stiffness/damping come from the C-cycled
    // tightness mode (underdamped modes hover and float around the plane)
    const k = tn.k, damp = 2 * Math.sqrt(k) * tn.damp;
    t.a.copy(des).sub(this.pos).multiplyScalar(k).addScaledVector(this.velC, -damp);
    this.velC.addScaledVector(t.a, dt);
    this.pos.addScaledVector(this.velC, dt);

    // look slightly ahead of the plane; when orbiting, center on the plane itself.
    // Deliberately loose aim: a slow spring (2.2/s) plus a G-load offset push the
    // plane away from screen center in maneuvers; the camera catches up afterwards.
    // Aim: lead the plane in flight, but sit straight on the wreck after a crash.
    // Leading along a tumbling forward vector would swing the aim around the
    // frame, and the g-load term spikes hard on impact.
    const ahead = crashed ? 0 : 9 / (1 + 3 * orbitMag);
    const gOff = crashed ? 0 : Math.max(-0.8, Math.min(1.6, (phys.gLoad - 1) * 0.55));
    const lt = t.lt.copy(phys.pos).addScaledVector(fwd, ahead)
      .addScaledVector(crashed ? WORLD_UP : planeUp, 0.8 + gOff);
    this.look.lerp(lt, 1 - Math.exp(-dt * tn.look));

    // FOV stretches with speed
    const fovTarget = Math.min(84, Math.max(60, 62 + Math.max(0, phys.speed - 32) * 0.24));
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // shake: speed² + PRE-stall burble (squared so it creeps in, then bites) +
    // stall break + flaps-overspeed buffet + airframe overspeed
    const sm = phys.stallMargin ?? 0;
    const amp = Math.pow(phys.speed / 115, 2) * 0.25 + sm * sm * 0.45 + (phys.stalled ? 0.3 : 0)
      + (phys.flapBuffet ?? 0) * 0.35 + (phys.overspeed ?? 0) * 0.4;
    const right = t.right.copy(fwd).cross(upMix).normalize();
    // the chase camera feels the head spring too, at reduced weight — it reads
    // as the whole rig being shoved around rather than a floating tripod
    this.camera.position.copy(this.pos)
      .addScaledVector(right, fbm1(this.time * 6.5, 6) * amp + this.head.x * 1.6)
      .addScaledVector(upMix, fbm1(this.time * 7.1, 7) * amp + this.head.y * 1.6)
      .addScaledVector(fwd, this.head.z * -1.6);

    // never sink below the terrain
    const gy = Math.max(0, this.heightAt(this.camera.position.x, this.camera.position.z)) + 1.6;
    if (this.camera.position.y < gy) this.camera.position.y = gy;
    if (this.pos.y < gy) this.pos.y = gy;

    this.camera.up.copy(upMix);
    this.camera.lookAt(this.look);
  }
}
