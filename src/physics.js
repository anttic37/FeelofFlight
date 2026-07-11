import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Arcade-sim rigid body: thrust, drag, lift(AoA), gravity + torques from control
// surfaces, aerodynamic stability and damping. Body axes: forward -Z, up +Y, right +X.
// Ground mode: wheels snap to the surface, tires grip laterally, rudder steers,
// elevator keeps q-scaled authority so the plane rotates off naturally.

const G = 9.81;
const RHO = 1.225;

const SPAWN_POS = new THREE.Vector3(250, 120, 7600); // 1.3 km final over water to the Coast strip
const SPAWN_SPEED = 55;

const GEAR_TIME = 1.6;      // s to extend/retract
const STANCE_PITCH = 0.10;  // taildragger nose-up at rest
const FLAP_TIME = 1.2;      // s full travel up <-> full

// steady wind: velocity of the AIR MASS in world frame — 4.2 m/s FROM the
// southwest, i.e. the air moves toward the northeast (+x, -z)
const WIND_X = 3.0, WIND_Z = -2.9;
const WINGSPAN = 11;        // ground-effect fade height

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
    this.dihedral = 1200; // sideslip rolls the plane into the turn (kept at the regression-tested value)
    this.pitchDamp = 9000;
    this.yawDamp = 12000;
    this.rollDamp = 5200;
    this.trim = 0.10;          // built-in elevator trim → hands-off ~level at cruise
    this.gustDepth = 0.35;     // slow wind magnitude modulation (fraction of steady)
    this.oroBoost = 0.9;       // extra turbulence approaching terrain (fraction, at 15 m AGL)

    // state
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3(); // body frame, rad/s
    this.throttle = 0.65;              // actual (spooled)
    this.time = 0;

    // flaps
    this.flapSetting = 0;              // 0 up | 1 half | 2 full
    this.flapTransit = 0;              // 0..1 eased actual position
    this.justFlapsMoved = false;       // integrator clears
    this.flapBuffet = 0;               // 0..1 shake: flaps out past blowback speed

    // wind (steady + slow gusts), exposed for the HUD
    this.wind = new THREE.Vector3(WIND_X, 0, WIND_Z);
    this.airspeed = 0;

    // structural
    this.overG = 0;                    // 0..1 instantaneous past 4.5 g
    this.stress = 0;                   // 0..1 accumulated — 1 tears the wings off
    this.overspeed = 0;                // 0..1 past ~Vne

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
      va: new THREE.Vector3(), // air-relative velocity, world frame
      q: new THREE.Quaternion(), force: new THREE.Vector3(), torque: new THREE.Vector3(),
      e: new THREE.Euler(0, 0, 0, 'YXZ'),
    };

    this.reset();
  }

  reset() {
    this.pos.copy(SPAWN_POS);
    this.quat.setFromEuler(new THREE.Euler(0.05, 0, 0)); // slight nose-up, heading -Z
    // spawn at SPAWN_SPEED of AIRSPEED — drift with the air mass so the tuned
    // final-approach feel is identical whatever the wind is doing right now
    this.vel.set(this.wind.x, 0, -SPAWN_SPEED + this.wind.z);
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
    this.flapSetting = 0;
    this.flapTransit = 0;
    this.justFlapsMoved = false;
    this.flapBuffet = 0;
    this.overG = 0; this.stress = 0; this.overspeed = 0;
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
    this.flapSetting = 0;
    this.flapTransit = 0;
    this.justFlapsMoved = false;
    this.flapBuffet = 0;
    this.overG = 0; this.stress = 0; this.overspeed = 0;
  }

  toggleGear() {
    if (this.grounded) return; // can't cycle the gear on the ground
    this.gearDown = !this.gearDown;
    this.justGearMoved = true;
  }

  setFlaps(n) {
    n = clamp(Math.round(n), 0, 2);
    if (n === this.flapSetting) return;
    this.flapSetting = n;
    this.justFlapsMoved = true;
  }

  update(dt, controls) {
    const t = this._tmp;
    this.time += dt;

    this.gearTransit = this.gearDown
      ? Math.min(1, this.gearTransit + dt / GEAR_TIME)
      : Math.max(0, this.gearTransit - dt / GEAR_TIME);

    // flaps ease toward the selected detent
    const dft = dt / FLAP_TIME;
    this.flapTransit += clamp(this.flapSetting / 2 - this.flapTransit, -dft, dft);
    const ft = this.flapTransit;

    // throttle spool lag
    this.throttle += (controls.throttle - this.throttle) * Math.min(1, dt * 1.4);

    const agl = this.altitude;

    // wind: steady SW breeze + slow gusts (magnitude ±35%, heading wander ±10°),
    // eased down through the boundary layer — ~57% strength at the surface, full
    // by 60 m AGL. Keeps every strip landable and the low phugoid dip gentle.
    const bl = clamp(agl / 60, 0, 1);
    const gustM = (1 + this.gustDepth * fbm1(this.time * 0.11, 7)) * (0.55 + 0.45 * bl * bl * (3 - 2 * bl));
    const gustA = 0.175 * fbm1(this.time * 0.08, 8);
    const cga = Math.cos(gustA), sga = Math.sin(gustA);
    this.wind.set((WIND_X * cga + WIND_Z * sga) * gustM, 0, (WIND_Z * cga - WIND_X * sga) * gustM);

    const speed = this.vel.length(); // GROUND speed: friction, steering, landing checks
    this.speed = speed;
    const vAir = t.va.copy(this.vel).sub(this.wind); // AIR-relative: all aerodynamics
    const airSpeed = vAir.length();
    this.airspeed = airSpeed;

    // air-relative velocity in body frame (grounded slow-taxi keeps aoa/beta quiet
    // so a parked tailwind can't wrap atan2 into a giant fake stability torque)
    const invQ = t.q.copy(this.quat).invert();
    const vBody = t.v.copy(vAir).applyQuaternion(invQ);
    const aero = airSpeed > 4 && (!this.grounded || -vBody.z > 2);
    this.aoa = aero ? Math.atan2(-vBody.y, -vBody.z) : 0;
    const beta = aero ? Math.atan2(vBody.x, Math.max(1, -vBody.z)) : 0;
    const q = 0.5 * RHO * airSpeed * airSpeed;

    // ground effect: within a wingspan of the surface, induced drag fades to 45%
    // and lift firms up +8% — floaty flare
    const gh = clamp(1 - agl / WINGSPAN, 0, 1);
    const ge = gh * gh * (3 - 2 * gh); // 1 at the surface -> 0 by one wingspan up

    // lift coefficient with flaps and stall break (flaps lower the stall AoA)
    const stallEff = this.stallAoA - 0.03 * ft;
    let cl = this.clSlope * this.aoa + 0.55 * ft;
    const clMax = this.clSlope * stallEff;
    this.stalled = aero && Math.abs(this.aoa) > stallEff && airSpeed > 8;
    let cd = this.cd0 + this.inducedK * cl * cl * (1 - 0.55 * ge)
           + (0.035 + 0.06 * ft) * ft; // flap drag
    if (Math.abs(this.aoa) > stallEff) {
      const over = Math.abs(this.aoa) - stallEff;
      cl = Math.sign(this.aoa) * Math.max(0.25, clMax - over * 2.4) + 0.55 * ft;
      const sa = Math.sin(this.aoa);
      cd += 0.05 + 0.9 * sa * sa; // flat-plate drag when the wing lets go
    }
    cd += 0.022 * this.gearTransit; // gear hanging in the wind

    // flap blowback buffet past 62 m/s (shake flag only — no auto-retract)
    this.flapBuffet = ft > 0.05 ? clamp((airSpeed - 62) / 8, 0, 1) * ft : 0;
    this.overspeed = clamp((airSpeed - 108) / 18, 0, 1); // Vne ~115

    // --- forces (world frame) ---
    const force = t.force.set(0, -G * this.mass, 0);

    const fwd = t.v2.set(0, 0, -1).applyQuaternion(this.quat);
    const propEff = Math.max(0.35, 1 - airSpeed / 220);
    force.addScaledVector(fwd, this.maxThrust * this.throttle * propEff);

    let liftN = 0;
    if (aero) {
      const velDir = t.v3.copy(vAir).divideScalar(airSpeed);
      force.addScaledVector(velDir, -q * this.wingArea * cd); // drag

      // lift: body-up projected perpendicular to the air-relative velocity
      const bodyUp = t.v2.set(0, 1, 0).applyQuaternion(this.quat);
      const liftDir = bodyUp.addScaledVector(velDir, -bodyUp.dot(velDir));
      if (liftDir.lengthSq() > 1e-6) {
        liftDir.normalize();
        const lift = q * this.wingArea * cl * (1 + 0.08 * ge);
        force.addScaledVector(liftDir, lift);
        this.gLoad = lift / (this.mass * G);
        liftN = lift;
      }
      // fuselage side force from sideslip: this is what curves the flight path
      // under held rudder — without it the nose just crabs and the track stays
      // straight, so rudder "turns a bit but doesn't keep turning". Gated by
      // rudder input: ambient (wind-crab) sideslip adds NO side force, keeping
      // hands-off glides exactly on the regression-tested baseline.
      const bodyRight = t.v2.set(1, 0, 0).applyQuaternion(this.quat);
      force.addScaledVector(bodyRight, -beta * q * this.wingArea * 0.75 * Math.abs(controls.yaw));

      // vertical turbulence gust (not while rolling on wheels)
      if (!this.grounded) force.y += fbm1(this.time * 0.45, 4) * 2200;
    } else {
      this.gLoad = 1;
    }

    this.vel.addScaledVector(force, dt / this.mass);

    // structural stress: sustained 4.5 g+ tears the wings; overspeed pulls compound
    this.overG = this.grounded ? 0 : clamp((Math.abs(this.gLoad) - 4.5) / 2.5, 0, 1);
    if (this.overG > 0) {
      let rate = this.overG / 0.6;
      if (this.overspeed > 0.6 && this.gLoad > 3) rate *= 2;
      this.stress = Math.min(1, this.stress + rate * dt);
      if (this.stress >= 1) this.crashed = 'the wings tore off';
    } else {
      this.stress = Math.max(0, this.stress - dt / 3);
    }

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

      // wind weathervane: nothing parked, mild while rolling (same sign as -beta*yawStab)
      this._gYaw -= beta * 0.09 * clamp((speed - 2) / 18, 0, 1) * dt;
      // prop P-factor: gentle nose-left bias on the power, only once rolling
      this._gYaw += (480 * this.throttle * Math.max(0, 1 - airSpeed / 45) / this.inertia.y)
                  * Math.min(1, speed / 6) * dt;

      // wheels level the wings
      this._gBank += (0 - this._gBank) * Math.min(1, dt * 6);
      w.z += (0 - w.z) * Math.min(1, dt * 8);

      // pitch: elevator keeps flight authority; gear geometry pulls to stance when slow
      const tqx = (controls.pitch + this.trim) * this.elevPower * qn
                - this.aoa * this.pitchStab * qnS
                - w.x * this.pitchDamp * qnD
                - 900 * ft * qn; // flap balloon trim nudge
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
         - w.x * this.pitchDamp * qnD
         - 900 * ft * qn; // flaps balloon, then need nose-down retrim
    tq.y = -controls.yaw * this.rudPower * qn
         - beta * this.yawStab * qn
         - w.y * this.yawDamp * qnD
         + controls.roll * 700 * qn; // adverse yaw: aileron drags the nose opposite
    tq.z = -controls.roll * this.ailPower * qn
         + beta * this.dihedral * qn
         - w.z * this.rollDamp * qnD;
    if (Math.abs(this.aoa) > stallEff) {
      const over = Math.abs(this.aoa) - stallEff;
      tq.x -= Math.sign(this.aoa) * over * this.stallBreak * qnS; // stall break
      // stall wing-drop: slowly-wandering asymmetry — a different wing each time
      tq.z += fbm1(this.time * 0.16, 5) * (600 + 1400 * over) * qnS;
    }

    // prop torque / P-factor: high power at low airspeed rolls and yaws LEFT —
    // takeoff and climb-out want a touch of right rudder
    tq.z += 320 * this.throttle * Math.max(0, 1 - airSpeed / 55);
    tq.y += 480 * this.throttle * Math.max(0, 1 - airSpeed / 45);

    // overspeed airframe buffet past ~Vne
    if (this.overspeed > 0) {
      tq.x += fbm1(this.time * 3.7, 9) * 4200 * this.overspeed;
      tq.z += fbm1(this.time * 4.3, 10) * 5200 * this.overspeed;
      tq.y += fbm1(this.time * 3.1, 11) * 1600 * this.overspeed;
    }

    // turbulence: slow noise nudging pitch/roll, a little yaw — orographic factor
    // makes the air bumpier near the terrain (kept below elevator authority on final)
    const oh = clamp((120 - agl) / 105, 0, 1);
    const turb = (0.4 + Math.min(1.2, q / 3000)) * (1 + this.oroBoost * (oh * oh * (3 - 2 * oh)));
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
