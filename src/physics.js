import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Arcade-sim rigid body: thrust, drag, lift(AoA), gravity + torques from control
// surfaces, aerodynamic stability and damping. Body axes: forward -Z, up +Y, right +X.

const G = 9.81;
const RHO = 1.225;

const SPAWN_POS = new THREE.Vector3(0, 170, 1500);
const SPAWN_SPEED = 55;

export class FlightModel {
  constructor(heightAt) {
    this.heightAt = heightAt;

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

    // readouts
    this.speed = 0;
    this.aoa = 0;
    this.gLoad = 1;
    this.stalled = false;
    this.crashed = false;

    this._tmp = {
      v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
      q: new THREE.Quaternion(), force: new THREE.Vector3(), torque: new THREE.Vector3(),
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
  }

  update(dt, controls) {
    const t = this._tmp;
    this.time += dt;

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

    // --- forces (world frame) ---
    const force = t.force.set(0, -G * this.mass, 0);

    const fwd = t.v2.set(0, 0, -1).applyQuaternion(this.quat);
    const propEff = Math.max(0.35, 1 - speed / 220);
    force.addScaledVector(fwd, this.maxThrust * this.throttle * propEff);

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
      }
      // vertical turbulence gust
      force.y += fbm1(this.time * 0.45, 4) * 2200;
    } else {
      this.gLoad = 1;
    }

    this.vel.addScaledVector(force, dt / this.mass);
    this.pos.addScaledVector(this.vel, dt);

    // --- torques (body frame) ---
    const qn = Math.min(2.5, q / 1500);          // control authority factor
    const qnD = Math.max(0.55, qn);              // damping keeps a floor → mushy at low speed
    const qnS = Math.max(0.35, qn);              // stability floor → nose still drops in a deep stall
    const w = this.angVel;
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

    // ground / water collision
    const ground = Math.max(0, this.heightAt(this.pos.x, this.pos.z));
    if (this.pos.y < ground + 1.2) this.crashed = true;
  }

  get altitude() {
    return this.pos.y - Math.max(0, this.heightAt(this.pos.x, this.pos.z));
  }
}
