import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Spring chase camera. The lag between plane and camera is deliberate — it is
// most of the "feel". Partial roll-follow, speed-driven FOV, noise shake.
// Mouse: drag to orbit around the plane (eases back behind when released),
// wheel to zoom in/out.

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class ChaseCam {
  constructor(camera, heightAt) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.pos = new THREE.Vector3();
    this.velC = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 62;
    this.time = 0;

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
      this.orbitYaw -= (e.clientX - this._lx) * 0.006;
      this.orbitPitch += (e.clientY - this._ly) * 0.005;
      this.orbitPitch = Math.max(-1.25, Math.min(0.9, this.orbitPitch)); // negative = above the plane
      this._lx = e.clientX;
      this._ly = e.clientY;
    });
    window.addEventListener('pointerup', () => { this._dragging = false; });
    window.addEventListener('blur', () => { this._dragging = false; });
    window.addEventListener('wheel', e => {
      this.zoomOff = Math.max(-6.5, Math.min(22, this.zoomOff + e.deltaY * 0.012));
    }, { passive: true });
    window.addEventListener('contextmenu', e => e.preventDefault());

    this._t = { fwd: new THREE.Vector3(), up: new THREE.Vector3(), mix: new THREE.Vector3(),
                des: new THREE.Vector3(), lt: new THREE.Vector3(), right: new THREE.Vector3(),
                a: new THREE.Vector3(), dir: new THREE.Vector3() };
  }

  snap(phys) {
    const t = this._t;
    const fwd = t.fwd.set(0, 0, -1).applyQuaternion(phys.quat);
    this.pos.copy(phys.pos).addScaledVector(fwd, -13).addScaledVector(WORLD_UP, 4);
    this.velC.set(0, 0, 0);
    this.look.copy(phys.pos);
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  update(dt, phys) {
    const t = this._t;
    this.time += dt;
    const fwd = t.fwd.set(0, 0, -1).applyQuaternion(phys.quat);
    const planeUp = t.up.set(0, 1, 0).applyQuaternion(phys.quat);

    // camera up: mostly world, a bit of plane roll so banking reads on screen
    const upMix = t.mix.copy(WORLD_UP).multiplyScalar(0.75).addScaledVector(planeUp, 0.25).normalize();

    // orbit eases back behind the plane when the mouse is released
    if (!this._dragging) {
      const rc = 1 - Math.exp(-dt * 2.2);
      this.orbitYaw -= this.orbitYaw * rc;
      this.orbitPitch -= this.orbitPitch * rc;
    }
    this.zoomSm += (this.zoomOff - this.zoomSm) * Math.min(1, dt * 6);

    const dist = 11.5 + phys.speed * 0.03 + this.zoomSm;
    const dir = t.dir.copy(fwd).negate();
    const orbitMag = Math.abs(this.orbitYaw) + Math.abs(this.orbitPitch);
    if (orbitMag > 1e-4) {
      dir.applyAxisAngle(upMix, this.orbitYaw);
      const rightAxis = t.right.copy(upMix).cross(dir).normalize();
      dir.applyAxisAngle(rightAxis, this.orbitPitch);
    }
    const des = t.des.copy(phys.pos).addScaledVector(dir, dist).addScaledVector(upMix, 3.6);

    // loose spring toward desired position (slightly underdamped → a touch of float)
    const k = 26, damp = 2 * Math.sqrt(k) * 0.92;
    t.a.copy(des).sub(this.pos).multiplyScalar(k).addScaledVector(this.velC, -damp);
    this.velC.addScaledVector(t.a, dt);
    this.pos.addScaledVector(this.velC, dt);

    // look slightly ahead of the plane; when orbiting, center on the plane itself.
    // Deliberately loose aim: a slow spring (2.2/s) plus a G-load offset push the
    // plane away from screen center in maneuvers; the camera catches up afterwards.
    const ahead = 9 / (1 + 3 * orbitMag);
    const gOff = Math.max(-0.8, Math.min(1.6, (phys.gLoad - 1) * 0.55));
    const lt = t.lt.copy(phys.pos).addScaledVector(fwd, ahead).addScaledVector(planeUp, 0.8 + gOff);
    this.look.lerp(lt, 1 - Math.exp(-dt * 2.2));

    // FOV stretches with speed
    const fovTarget = Math.min(84, Math.max(60, 62 + Math.max(0, phys.speed - 32) * 0.24));
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // shake: speed² + stall buffet
    const amp = Math.pow(phys.speed / 115, 2) * 0.25 + (phys.stalled ? 0.55 : 0);
    const right = t.right.copy(fwd).cross(upMix).normalize();
    this.camera.position.copy(this.pos)
      .addScaledVector(right, fbm1(this.time * 6.5, 6) * amp)
      .addScaledVector(upMix, fbm1(this.time * 7.1, 7) * amp);

    // never sink below the terrain
    const gy = Math.max(0, this.heightAt(this.camera.position.x, this.camera.position.z)) + 1.6;
    if (this.camera.position.y < gy) this.camera.position.y = gy;
    if (this.pos.y < gy) this.pos.y = gy;

    this.camera.up.copy(upMix);
    this.camera.lookAt(this.look);
  }
}
