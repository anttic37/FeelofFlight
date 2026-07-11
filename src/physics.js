import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Arcade-sim rigid body: thrust, drag, lift(AoA), gravity + torques from control
// surfaces, aerodynamic stability and damping. Body axes: forward -Z, up +Y, right +X.
// Ground mode: wheels snap to the surface, tires grip laterally, rudder steers,
// elevator keeps q-scaled authority so the plane rotates off naturally.

const G = 9.81;
const RHO = 1.225;

const SPAWN_POS = new THREE.Vector3(0, 170, 1500);
const SPAWN_SPEED = 55;

const GEAR_TIME = 1.6;      // s to extend/retract
const STANCE_PITCH = 0.10;  // taildragger nose-up at rest

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export class FlightModel {
  constructor(surfaceAt) {
    this.surfaceAt = surfaceAt;

    // airframe
    this.mass = 1000;
    this.wingArea = 16;
    this.clSlope = 4.2;        // per radian
    this.stallAoA = 0.32;      // ~18 deg
    this.cd0 = 0.05;
    this.inducedK = 0.07;
    this.maxThrust = 5200;
    this.inertia = new THREE.Vector3(3200, 4800, 1600); // pitch, yaw, roll

    // control effectiveness / stability (torques at reference q)
    this.elevPower = 6500;
    this.ailPower = 7800;
    this.rudPower = 2600;
    this.pitchStab = 9000;
    this.stallBreak = 38000;   // extra nose-down past the stall
    this.yawStab = 15000;
    this.dihedral = 1200;
    this.pitchDamp = 9000;
    this.yawDamp = 12000;
    this.rollDamp = 5200;
    this.trim = 0.10;          // built-in elevator trim → hands-off ~level at cruise

    // state
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3(); // body frame, rad/s
    this.throttle = 0.65;              // actual (spooled)
    this.time = 0;

    // gear / ground
    this.gearDown = false;
    this.gearTransit = 0;              // 0 up .. 1 down
    this.grounded = false;
    this.onRunwaySurface = false;
    this.justTouchedDown = null;       // sink m/s on touchdown frame; integrator clears
    this.justGearMoved = false;        // integrator clears
    // grounded attitude is authoritative in yaw/pitch/bank, rebuilt into quat
    this._gYaw = 0; this._gPitch = 0; this._gBank = 0;

    // readouts
    this.speed = 0;
    this.aoa = 0;
    this.gLoad = 1;
    this.stalled = false;
    this.crashed = false;              // false | reason string

    this._tmp = {
      v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
      q: new THREE.Quaternion(), force: new THREE.Vector3(), torque: new THREE.Vector3(),
      e: new THREE.Euler(0, 0, 0, 'YXZ'),
    };

    this.reset();
  }

  reset() {
    this.pos.copy(SPAWN_POS);
    this.quat.setFromEuler(new THREE.Euler(0.05, 0, 0)); // slight nose-up, heading -Z
    this.vel.set(0, 0, -SPAWN_SPEED);
    this.angVel.set(0, 0, 0);
    this.throttle = 0.65;
    this.crashed = false;
    this.stalled = false;
    this.gLoad = 1;
    this.gearDown = false;
    this.gearTransit = 0;
    this.grounded = false;
    this.onRunwaySurface = false;
    this.justTouchedDown = null;
    this.justGearMoved = false;
    this._gYaw = 0; this._gPitch = 0; this._gBank = 0;
  }

  resetTo({ x, z, y, yaw, speed, grounded, gearDown }) {
    const t = this._tmp;
    this.gearDown = !!gearDown;
    this.gearTransit = this.gearDown ? 1 : 0;
    this.grounded = !!grounded;
    const surf = this.surfaceAt(x, z);
    const contact = Math.max(0, surf.h);
    const gearH = this.gearTransit > 0.5 ? 1.55 : 0.9;
    this._gYaw = yaw || 0;
    this._gPitch = this.grounded ? STANCE_PITCH : 0; // sit on the tailwheel from frame one
    this._gBank = 0;
    this.quat.setFromEuler(t.e.set(this._gPitch, this._gYaw, 0));
    this.pos.set(x, this.grounded ? contact + gearH : (y != null ? y : contact + 170), z);
    const fwd = t.v.set(0, 0, -1).applyQuaternion(this.quat);
    this.vel.copy(fwd).multiplyScalar(speed || 0);
    this.angVel.set(0, 0, 0);
    this.throttle = this.grounded ? 0 : 0.65;
    this.crashed = false;
    this.stalled = false;
    this.gLoad = 1;
    this.justTouchedDown = null;
    this.justGearMoved = false;
    this.onRunwaySurface = surf.type === 'runway';
  }

  toggleGear() {
    if (this.grounded) return; // can't cycle the gear on the ground
    this.gearDown = !this.gearDown;
    this.justGearMoved = true;
  }

  update(dt, controls) {
    const t = this._tmp;
    this.time += dt;

    this.gearTransit = this.gearDown
      ? Math.min(1, this.gearTransit + dt / GEAR_TIME)
      : Math.max(0, this.gearTransit - dt / GEAR_TIME);

    // throttle spool lag
    this.throttle += (controls.throttle - this.throttle) * Math.min(1, dt * 1.4);

    const speed = this.vel.length();
    this.speed = speed;

    // velocity in body frame
    const invQ = t.q.copy(this.quat).invert();
    const vBody = t.v.copy(this.vel).applyQuaternion(invQ);
    const aero = speed > 4;
    this.aoa = aero ? Math.atan2(-vBody.y, -vBody.z) : 0;
    const beta = aero ? Math.atan2(vBody.x, Math.max(1, -vBody.z)) : 0;
    const q = 0.5 * RHO * speed * speed;

    // lift coefficient with stall break
    let cl = this.clSlope * this.aoa;
    const clMax = this.clSlope * this.stallAoA;
    this.stalled = aero && Math.abs(this.aoa) > this.stallAoA && speed > 8;
    let cd = this.cd0 + this.inducedK * cl * cl;
    if (Math.abs(this.aoa) > this.stallAoA) {
      const over = Math.abs(this.aoa) - this.stallAoA;
      cl = Math.sign(this.aoa) * Math.max(0.25, clMax - over * 2.4);
      const sa = Math.sin(this.aoa);
      cd += 0.05 + 0.9 * sa * sa; // flat-plate drag when the wing lets go
    }
    cd += 0.022 * this.gearTransit; // gear hanging in the wind

    // --- forces (world frame) ---
    const force = t.force.set(0, -G * this.mass, 0);

    const fwd = t.v2.set(0, 0, -1).applyQuaternion(this.quat);
    const propEff = Math.max(0.35, 1 - speed / 220);
    force.addScaledVector(fwd, this.maxThrust * this.throttle * propEff);

    let liftN = 0;
    if (aero) {
      const velDir = t.v3.copy(this.vel).divideScalar(speed);
      force.addScaledVector(velDir, -q * this.wingArea * cd); // drag

      // lift: body-up projected perpendicular to velocity
      const bodyUp = t.v2.set(0, 1, 0).applyQuaternion(this.quat);
      const liftDir = bodyUp.addScaledVector(velDir, -bodyUp.dot(velDir));
      if (liftDir.lengthSq() > 1e-6) {
        liftDir.normalize();
        const lift = q * this.wingArea * cl;
        force.addScaledVector(liftDir, lift);
        this.gLoad = lift / (this.mass * G);
        liftN = lift;
      }
      // vertical turbulence gust (not while rolling on wheels)
      if (!this.grounded) force.y += fbm1(this.time * 0.45, 4) * 2200;
    } else {
      this.gLoad = 1;
    }

    this.vel.addScaledVector(force, dt / this.mass);

    if (this.grounded) {
      // tires grip: damp sideways velocity toward the wheel track
      const fx = -Math.sin(this._gYaw), fz = -Math.cos(this._gYaw);
      const along = this.vel.x * fx + this.vel.z * fz;
      const grip = Math.min(1, dt * 5);
      this.vel.x -= (this.vel.x - fx * along) * grip;
      this.vel.z -= (this.vel.z - fz * along) * grip;
      // rolling / brake friction as horizontal decel
      let mu = this.onRunwaySurface ? 0.025 : 0.09;
      if (controls.brake) mu += this.onRunwaySurface ? 0.40 : 0.30;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 1e-6) {
        const k = Math.max(0, hs - mu * G * dt) / hs;
        this.vel.x *= k; this.vel.z *= k;
      }
      // wheels pinned: ground reaction cancels ALL vertical velocity until the
      // liftoff check fires — otherwise lift tilts the velocity vector up,
      // which bleeds AoA and lift self-caps just below the liftoff threshold
      this.vel.y = 0;
    }

    this.pos.addScaledVector(this.vel, dt);

    const surf = this.surfaceAt(this.pos.x, this.pos.z);
    const contact = Math.max(0, surf.h);
    const gearHeight = this.gearTransit > 0.5 ? 1.55 : 0.9; // wheels vs belly
    this.onRunwaySurface = surf.type === 'runway';

    const qn = Math.min(2.5, q / 1500);          // control authority factor
    const qnD = Math.max(0.55, qn);              // damping keeps a floor → mushy at low speed
    const qnS = Math.max(0.35, qn);              // stability floor → nose still drops in a deep stall
    const w = this.angVel;

    if (this.grounded) {
      if (surf.type === 'water') this.crashed = 'rolled into the sea';
      this.gLoad = 1;
      this.stalled = false;

      // rudder steering: strong at taxi speed, fades as the rudder takes over
      const steerRate = (1.4 + (0.15 - 1.4) * clamp((speed - 3) / 37, 0, 1)) * Math.min(1, speed / 3);
      this._gYaw -= controls.yaw * steerRate * dt;
      w.y = -controls.yaw * steerRate;

      // wheels level the wings
      this._gBank += (0 - this._gBank) * Math.min(1, dt * 6);
      w.z += (0 - w.z) * Math.min(1, dt * 8);

      // pitch: elevator keeps flight authority; gear geometry pulls to stance when slow
      const tqx = (controls.pitch + this.trim) * this.elevPower * qn
                - this.aoa * this.pitchStab * qnS
                - w.x * this.pitchDamp * qnD;
      w.x += (tqx / this.inertia.x) * dt;
      this._gPitch += w.x * dt;
      const slow = Math.max(0, 1 - speed / 18);
      this._gPitch += (STANCE_PITCH - this._gPitch) * Math.min(1, dt * 4 * slow);
      if (this._gPitch < -0.06) { this._gPitch = -0.06; if (w.x < 0) w.x = 0; } // prop guard
      if (this._gPitch > 0.32) { this._gPitch = 0.32; if (w.x > 0) w.x = 0; }   // tail strike guard
      // yaw-then-pitch: default XYZ order would corrupt pitch into roll on
      // runways whose heading isn't 0
      this.quat.setFromEuler(t.e.set(this._gPitch, this._gYaw, this._gBank, 'YXZ'));

      if (liftN > 1.02 * this.mass * G) {
        this.grounded = false; // rotation takeoff
      } else {
        this.pos.y = contact + gearHeight; // wheels follow the terrain
        if (this.vel.y < 0) this.vel.y = 0;
      }
      return;
    }

    // --- torques (body frame) ---
    const tq = t.torque.set(0, 0, 0);

    const pitchIn = controls.pitch + this.trim;
    tq.x = pitchIn * this.elevPower * qn
         - this.aoa * this.pitchStab * qnS
         - w.x * this.pitchDamp * qnD;
    if (Math.abs(this.aoa) > this.stallAoA) {
      tq.x -= Math.sign(this.aoa) * (Math.abs(this.aoa) - this.stallAoA) * this.stallBreak * qnS;
    }
    tq.y = -controls.yaw * this.rudPower * qn
         - beta * this.yawStab * qn
         - w.y * this.yawDamp * qnD;
    tq.z = -controls.roll * this.ailPower * qn
         + beta * this.dihedral * qn
         - w.z * this.rollDamp * qnD;

    // turbulence: slow noise nudging pitch/roll, a little yaw
    const turb = 0.4 + Math.min(1.2, q / 3000);
    tq.x += fbm1(this.time * 0.55, 1) * 1500 * turb;
    tq.z += fbm1(this.time * 0.62, 2) * 2300 * turb;
    tq.y += fbm1(this.time * 0.4, 3) * 500 * turb;

    w.x += (tq.x / this.inertia.x) * dt;
    w.y += (tq.y / this.inertia.y) * dt;
    w.z += (tq.z / this.inertia.z) * dt;
    w.multiplyScalar(Math.max(0, 1 - dt * 0.25)); // tiny universal damping
    const wMag = w.length();
    if (wMag > 4) w.multiplyScalar(4 / wMag);

    // integrate orientation (body-frame angular velocity)
    if (wMag > 1e-6) {
      const axis = t.v.copy(w).divideScalar(wMag);
      this.quat.multiply(t.q.setFromAxisAngle(axis, wMag * dt)).normalize();
    }

    // ground / water contact: land if gentle + gear down + level, otherwise crash
    if (this.pos.y <= contact + gearHeight && (this.vel.y <= 0 || this.pos.y <= contact)) {
      const fwdG = t.v2.set(0, 0, -1).applyQuaternion(this.quat);
      const yawG = Math.atan2(-fwdG.x, -fwdG.z);
      const pitchG = Math.asin(clamp(fwdG.y, -1, 1));
      const rightG = t.v3.set(1, 0, 0).applyQuaternion(this.quat);
      const bankG = Math.atan2(rightG.y, Math.hypot(rightG.x, rightG.z));
      const sink = -this.vel.y;
      if (surf.type === 'water') this.crashed = 'splashed into the sea';
      else if (this.pos.y < contact - 1.5) this.crashed = 'hit the ground'; // slammed a slope
      else if (this.gearTransit <= 0.9) this.crashed = 'belly landing';
      else if (sink >= 6) this.crashed = 'came in too hard';
      else if (Math.abs(bankG) >= 0.25) this.crashed = 'wingtip caught the ground';
      else if (speed >= 75) this.crashed = 'too fast';
      else if (pitchG < -0.08 || pitchG > 0.35) this.crashed = 'nosed over';
      else {
        this.grounded = true;
        this.gearDown = true; // weight-on-wheels cancels any retraction in progress
        this.justTouchedDown = Math.max(0, sink);
        this.vel.y = 0;
        this.pos.y = contact + gearHeight;
        this._gYaw = yawG; this._gPitch = pitchG; this._gBank = bankG;
        this.stalled = false;
        this.gLoad = 1;
      }
    }
  }

  get altitude() {
    return this.pos.y - Math.max(0, this.surfaceAt(this.pos.x, this.pos.z).h);
  }
}
