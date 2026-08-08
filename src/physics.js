import * as THREE from 'three';
import { fbm1 } from './noise.js';
import { RUNWAYS } from './heightcore.js';

// Arcade-sim rigid body: thrust, drag, lift(AoA), gravity + torques from control
// surfaces, aerodynamic stability and damping. Body axes: forward -Z, up +Y, right +X.
// Ground mode: wheels snap to the surface, tires grip laterally, rudder steers,
// elevator keeps q-scaled authority so the plane rotates off naturally.

const G = 9.81;
const RHO = 1.225;

// air spawn: ~1.55 km final over water to the Coast strip (RUNWAYS[0]),
// computed at reset time because the seeded layout moves the strip
const SPAWN_SPEED = 55;

// Overdrive: the fraction of extra thrust on top of the normal 100% gate, so 0.50 is a
// 150% engine. Exported because the tachometer reads out the same number — the gauge saying
// 150% and the airframe getting 140% would be a lie told by two files that disagree.
export const OD_GAIN = 0.50;

const GEAR_TIME = 1.6;      // s to extend/retract
const STANCE_PITCH = 0.10;  // taildragger nose-up at rest
const FLAP_TIME = 1.2;      // s full travel up <-> full

// steady wind: velocity of the AIR MASS in world frame — 4.2 m/s FROM the
// southwest, i.e. the air moves toward the northeast (+x, -z)
const WIND_X = 3.0, WIND_Z = -2.9;
const WINGSPAN = 11;        // ground-effect fade height

// Where a WRECK actually touches, in body axes (fwd -Z, up +Y, right +X). The airframe is
// ~11 m across and ~8 m long, and treating it as a point meant a wing could be buried in a
// hillside while the centre sat politely 0.9 m above the ground under it. These are also the
// lever arms the contact response torques about, which is what lets a tip dig in and throw
// the thing over rather than everything pivoting about the centre of mass.
const WRECK_CONTACTS = [
  [0, -0.2, -4.2],   // nose
  [0, 0.35, 3.6],    // tail
  [-5.5, 0.1, 0.2],  // left tip
  [5.5, 0.1, 0.2],   // right tip
  [0, -0.9, 0],      // belly
];

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
    this.overdrive = 0;   // 0..1 spooled, 1 = the extra OD_GAIN is fully in
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
    this.stallMargin = 0;              // 0..1 approaching the break — pre-stall warning
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
    const r0 = RUNWAYS[0]; // Coast strip: spawn 1.55 km out on final, over water
    const fx = -Math.sin(r0.heading), fz = -Math.cos(r0.heading); // strip forward axis
    this.pos.set(r0.x - fx * 1550, Math.max(120, r0.elev + 108), r0.z - fz * 1550);
    this.quat.setFromEuler(new THREE.Euler(0.05, r0.heading, 0)); // slight nose-up, down the axis
    // spawn at SPAWN_SPEED of AIRSPEED — drift with the air mass so the tuned
    // final-approach feel is identical whatever the wind is doing right now
    this.vel.set(this.wind.x + fx * SPAWN_SPEED, 0, this.wind.z + fz * SPAWN_SPEED);
    this.angVel.set(0, 0, 0);
    this.throttle = 0.65;
    this.crashed = false;
    this.stalled = false;
    this.stallMargin = 0;
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
    this._wreck = false; this.justWreckHit = 0; this.wreckSettled = false;
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
    this.stallMargin = 0;
    this.gLoad = 1;
    this.justTouchedDown = null;
    this.justGearMoved = false;
    this.onRunwaySurface = surf.type === 'runway';
    this.flapSetting = 0;
    this.flapTransit = 0;
    this.justFlapsMoved = false;
    this.flapBuffet = 0;
    this.overG = 0; this.stress = 0; this.overspeed = 0;
    this._wreck = false; this.justWreckHit = 0; this.wreckSettled = false;
  }

  // ---- wreck: after a crash the airframe becomes a tumbling rigid body ----
  // It bounces, skids and settles where it fell instead of freezing/teleporting.
  // R / T reset as usual. Deterministic: the tumble kick is seeded by location.
  startWreck() {
    if (this._wreck) return;
    this._wreck = true;
    const s = this.vel.length();
    const r1 = fbm1(this.pos.x * 0.137 + this.pos.z * 0.071, 3.3);
    const r2 = fbm1(this.pos.z * 0.113 - this.pos.x * 0.059, 7.7);
    this.angVel.set(r1 * (2.5 + s * 0.06), r2 * (1.5 + s * 0.04), (r1 - r2) * (2.5 + s * 0.06));
    // 0.86, not 0.7. Something arriving at 200 km/h does not lose a third of its speed to the
    // first touch — it keeps most of it and spends the rest sliding.
    this.vel.multiplyScalar(0.86);
    this.justWreckHit = Math.min(9, 2 + s * 0.07);
  }

  wreckUpdate(dt) {
    const t = this._tmp;
    this.vel.y -= G * dt;
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 0.2)); // battered-airframe drag
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    const wMag = w.length();
    if (wMag > 1e-6) {
      const axis = t.v.copy(w).divideScalar(wMag);
      this.quat.multiply(t.q.setFromAxisAngle(axis, Math.min(wMag, 6) * dt)).normalize();
    }
    // ---- AIRFRAME CONTACT, not a point ----------------------------------------------
    // The wreck used to be a single point held 0.9 m over whatever was under its centre, so
    // an 11 m wingspan passed through hillsides and the tail hung in the air off a lip. Five
    // points carry the actual shape: nose, tail, both tips and the belly. Whichever is
    // deepest sets the height and, more usefully, provides the LEVER — a wingtip catching a
    // slope is what pitches the thing over sideways, and that only exists if the contact has
    // somewhere to be other than the centre of mass.
    let deepest = -Infinity, surf = null;
    t.v3.set(0, 0, 0);
    for (let i = 0; i < WRECK_CONTACTS.length; i++) {
      const c = WRECK_CONTACTS[i];
      t.v.set(c[0], c[1], c[2]).applyQuaternion(this.quat);
      const s = this.surfaceAt(this.pos.x + t.v.x, this.pos.z + t.v.z);
      const g = s.type === 'water' ? -0.5 : Math.max(s.h, 0);
      const pen = g - (this.pos.y + t.v.y);
      if (pen > deepest) { deepest = pen; surf = s; t.v3.copy(t.v); }
    }
    const water = surf.type === 'water';
    if (deepest > 0) {
      this.pos.y += deepest;
      // the contact pushes back on the airframe where it actually touched: a lever arm
      // crossed with the ground normal is the axis that lifts that point, so a dug-in tip
      // levers the wreck over instead of the whole body rising politely on the spot
      const lever = t.v3.lengthSq();
      if (lever > 1e-4 && !water) {
        t.v2.set(t.v3.z, 0, -t.v3.x); // t.v3 x WORLD_UP, the axis that raises that point
        const m = t.v2.length();
        if (m > 1e-4) {
          // Small, because this is a CORRECTION and not a motor. The position has already
          // been lifted clear by `deepest`, so all this owes is the rotational half of the
          // same push; at five times this it fed the tumble every frame it touched and the
          // wreck wound up to twelve rotations and never came to rest.
          t.v2.divideScalar(m).applyQuaternion(t.q.copy(this.quat).invert());
          w.addScaledVector(t.v2, Math.min(0.9, deepest * 1.6) * Math.min(1, dt * 6));
        }
      }
      // floating is not rolling: grounded=true on water made fx throw brown
      // skid dust off the sea while the wreck slid to a stop
      this.grounded = !water;
      this.onRunwaySurface = surf.type === 'runway';
      if (water) { // splashdown: heavy drag, no bounce, settle afloat
        if (this.vel.y < -2) this.justWreckHit = Math.min(8, -this.vel.y * 0.9);
        this.vel.y = 0;
        this.vel.multiplyScalar(Math.max(0, 1 - dt * 2.6));
        w.multiplyScalar(Math.max(0, 1 - dt * 3));
      } else {
        if (this.vel.y < -1.5) this.justWreckHit = Math.min(8, -this.vel.y * 0.8);
        this.vel.y = Math.abs(this.vel.y) * 0.34; // bounce with heavy loss
        // A SLIDE IS A DECELERATION, NOT A DECAY. Scaling the horizontal velocity by a
        // per-frame fraction is exponential, so it takes the same TIME to stop from any
        // speed: at the old 1 - dt*2.4 that is 8.6% of the speed left after one second, and
        // an airframe arriving at 200 km/h came to rest in about a second and a car's length.
        // Friction does not work like that — it takes a roughly constant force off, so the
        // distance grows with the square of the speed and a fast crash slides a long way.
        // 5.2 m/s^2 on open ground is about half a g, which is what a tumbling airframe
        // digging into grass actually manages; asphalt is smoother and lets it run further.
        const decel = (surf.type === 'runway' ? 3.4 : 5.2) * dt;
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (hs > 1e-4) {
          const k = Math.max(0, 1 - decel / hs);
          this.vel.x *= k; this.vel.z *= k;
        }
        // A SLIDE IS NOT A TUMBLE, and there was no way for it to become one: the spin came
        // entirely from the kick at the moment of impact and then decayed, so the airframe
        // turned about 0.7 of a revolution across a 117 m slide and read as a sledge. What
        // was missing is the coupling — friction acts at the GROUND, below the centre of
        // mass, so it keeps torquing the wreck over its own nose for as long as it is still
        // travelling. The linear motion is what pays for the tumble.
        //
        // Driven TOWARD a speed-dependent rate rather than added to, so it cannot wind up
        // without limit and it falls away on its own as the wreck slows, which is also what
        // ends the tumble without needing a separate rule for it.
        const spin = w.length();
        // Capped at 6 to match the ceiling the integrator already applies to the rotation
        // itself — driving past that is spin the eye never sees. The rate has to be brisk
        // against the damping below or the two settle well short: at dt*2.6 the balance sat
        // around 0.6 of the target and a 200 km/h crash still only turned one and a half
        // times, which is a roll rather than a tumble.
        const spinTarget = Math.min(6.0, hs * 0.19);
        if (spinTarget > spin && hs > 1e-4) {
          const n1 = fbm1(this.pos.x * 0.021 + this.pos.z * 0.013, 3.3);
          const n2 = fbm1(this.pos.z * 0.019 - this.pos.x * 0.011, 7.7);
          // IT WAS ROLLING BACKWARDS, and the axis is why. This was being set in BODY axes
          // with a positive X, and a positive body-X rotation carries the top toward +Z —
          // which is AFT, since forward is -Z. So the wreck cartwheeled the wrong way up its
          // own slide. The axis is not a body constant at all: it is the ground normal
          // crossed into the direction of TRAVEL, WORLD_UP x velocity, which sends the top
          // over in the direction the thing is actually going. Rotated into body axes at the
          // end because that is the frame angVel is integrated in, and it has to be
          // recomputed every frame — the body is tumbling, so any fixed body axis drifts
          // away from the one the ground is really pushing on.
          t.v2.set(this.vel.z, 0, -this.vel.x).divideScalar(hs);
          // and a little noise, so it is not a clean somersault every single time
          t.v2.x += 0.24 * n1; t.v2.y += 0.28 * n2; t.v2.z += 0.24 * (n1 - n2);
          t.v2.normalize().applyQuaternion(t.q.copy(this.quat).invert());
          w.addScaledVector(t.v2, (spinTarget - spin) * Math.min(1, dt * 5.0));
        }
        w.multiplyScalar(Math.max(0, 1 - dt * 0.9));
      }
    } else {
      this.grounded = false;
      w.multiplyScalar(Math.max(0, 1 - dt * 0.35));
    }
    this.speed = this.vel.length();
    this.airspeed = this.speed;
    this.gLoad = 1;
    this.stalled = false;
    this.stallMargin = 0;
    this.overspeed = 0;
    // "resting on the ground" is now a contact test rather than a height test: deepest is the
    // penetration of whichever part is lowest, so >= -0.05 means something is actually
    // touching. w is re-read because the tumble above may have changed it since wMag.
    this.wreckSettled = deepest >= -0.05 && this.speed < 0.7 && w.length() < 0.4;
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

    // OVERDRIVE. The engine has 40% more than the gate normally lets through; forcing the
    // lever past its stop opens it. Spooled separately and SLOWER than the throttle so it
    // arrives as a surge you feel building rather than a step in the numbers.
    //
    // It multiplies thrust only. Nothing else in here is touched, so the whole airframe —
    // prop torque, P-factor, the drag rise, Vne buffet — responds to the extra power on its
    // own terms rather than through a special case, and running it fast enough to shake the
    // wings is something the flight model already knows how to punish.
    this.overdrive += ((controls.overdrive || 0) - this.overdrive) * Math.min(1, dt * 0.9);

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

    // PRE-STALL MARGIN: how far into the last ~4 deg before the break we are,
    // 0 well clear -> 1 at the break itself. A real wing warns for seconds
    // before it lets go — separated air off the root thumps the tail — and that
    // warning is most of the seat-of-the-pants feel in slow flight and the
    // flare. Camera, sound and the wing flex all read this, so the airplane
    // starts talking BEFORE `stalled` flips.
    this.stallMargin = aero && airSpeed > 12
      ? clamp((Math.abs(this.aoa) - (stallEff - 0.075)) / 0.075, 0, 1) : 0;

    // --- forces (world frame) ---
    const force = t.force.set(0, -G * this.mass, 0);

    const fwd = t.v2.set(0, 0, -1).applyQuaternion(this.quat);
    const propEff = Math.max(0.35, 1 - airSpeed / 220);
    force.addScaledVector(fwd, this.maxThrust * this.throttle * propEff * (1 + OD_GAIN * this.overdrive));

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
      force.addScaledVector(bodyRight, -beta * q * this.wingArea * 1.1 * Math.abs(controls.yaw));

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
    // rudder banks the plane toward ~29° into the turn (gated by rudder input):
    // the tilted lift vector turns the flight path far harder than the skid
    // alone, and a touch of automatic back pressure pulls the nose through the
    // turn instead of letting it dive
    if (controls.yaw !== 0) {
      const ry = 2 * (this.quat.x * this.quat.y + this.quat.w * this.quat.z); // world-y of body-right
      const bank = Math.asin(clamp(ry, -1, 1)); // negative = banked right
      const ryd = Math.abs(controls.yaw);
      tq.z += (-0.5 * controls.yaw - bank) * 4500 * qn * ryd;
      tq.x += ryd * Math.min(0.6, Math.abs(bank)) * 2600 * qn;
    }
    if (Math.abs(this.aoa) > stallEff) {
      const over = Math.abs(this.aoa) - stallEff;
      tq.x -= Math.sign(this.aoa) * over * this.stallBreak * qnS; // stall break
      // stall wing-drop: slowly-wandering asymmetry — a different wing each time
      tq.z += fbm1(this.time * 0.16, 5) * (600 + 1400 * over) * qnS;
    }
    // pre-stall burble: fast, small, RANDOM shaking that grows as the margin
    // closes. Deliberately weaker than elevator authority — it is a warning you
    // feel through the airframe, never a loss of control on its own.
    if (this.stallMargin > 0) {
      const sm = this.stallMargin * this.stallMargin;
      tq.x += fbm1(this.time * 9.3, 12) * 1500 * sm;
      tq.z += fbm1(this.time * 11.7, 13) * 2100 * sm;
      tq.y += fbm1(this.time * 8.1, 14) * 700 * sm;
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
