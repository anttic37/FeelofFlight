import * as THREE from 'three';
import { fbm1 } from './noise.js';

// Crash debris: on impact, whole assemblies shear off the plane model and
// tumble away as independent rigid bodies — bounce off the terrain, roll down
// slopes, splash and float on water. The fuselage keeps flying the existing
// wreck physics; the chase camera stays glued to it and never needs to know.
//
// Parts are detached by NAME from the built plane graph and re-centered on a
// pivot group (several assemblies keep their origin at the aircraft origin, so
// tumbling them directly would swing them on multi-metre lever arms). restore()
// puts every part back on its original parent with its original local
// transform, so R / T rebuild the intact plane exactly.

const G = 9.81;

// strength = impact speed (m/s) above which the part lets go (±25% per crash)
// Both airframes' shear points are listed; a name the mounted model lacks is simply not
// found and never lets go. KX-1 wings ('wing flex joint') carried the gear with them; the
// KX-2 parents its gear on the FIXED root segment inboard of the first flex joint, so its
// sheared wing leaves a root stub and the gear stays with the fuselage — which is also
// what the crash colliders then measure, since airframe.js reads the same names.
const PART_DEFS = [
  { name: 'Propeller assembly', strength: 7 },
  { name: 'Hamilton Standard four-blade propeller assembly', strength: 7 }, // P-51D
  { name: 'Left wing flex joint', strength: 15 },   // KX-1: takes gear + wheels along
  { name: 'Right wing flex joint', strength: 21 },
  { name: 'Left wing flex inboard', strength: 15 }, // KX-2 + P-51D: gear stays on the root stub
  { name: 'Right wing flex inboard', strength: 21 },
  { name: 'Tail wheel', strength: 19 },
  { name: 'Retractable tailwheel assembly', strength: 19 },                 // P-51D
  { name: 'Rudder hinge', strength: 26 },
  { name: 'Fabric-covered production rudder hinge', strength: 26 },         // P-51D
  { name: 'Elevator controller', strength: 30 },
  { name: 'Elevator control assembly', strength: 30 },                      // P-51D
  { name: 'Left stabilizer', strength: 34 },
  { name: 'Right stabilizer', strength: 34 },
  { name: 'Left all-metal horizontal stabilizer', strength: 34 },           // P-51D
  { name: 'Right all-metal horizontal stabilizer', strength: 34 },
];

export function createWreckage(scene, surfaceAt, heightAt) {
  const parts = [];
  const hits = []; // consumed by main: {pos, type, mag} ground impacts for fx/sound
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const tv = new THREE.Vector3();
  const tq = new THREE.Quaternion();

  function breakUp(plane, phys, severity) {
    if (parts.length) return;
    // sync the graph to the exact crash pose before measuring world transforms
    plane.group.position.copy(phys.pos);
    plane.group.quaternion.copy(phys.quat);
    plane.group.updateMatrixWorld(true);

    for (let i = 0; i < PART_DEFS.length; i++) {
      const def = PART_DEFS[i];
      const jitter = 0.75 + 0.5 * fbm1(phys.pos.x * 0.043 + i * 17.7, 5.1);
      if (severity < def.strength * jitter) continue;
      const obj = plane.group.getObjectByName(def.name);
      if (!obj) continue;

      box.setFromObject(obj);
      if (box.isEmpty()) continue;
      const center = box.getCenter(new THREE.Vector3());
      box.getSize(size);
      const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
      const restH = Math.min(0.9, Math.max(0.15, dims[1] * 0.35));

      const pivot = new THREE.Group();
      pivot.position.copy(center);
      scene.add(pivot);
      const parent = obj.parent;
      const localPos = obj.position.clone();
      const localQuat = obj.quaternion.clone();
      pivot.attach(obj); // keeps the part's world pose

      // fling outward from the fuselage + up, harder parts fly further
      const r1 = fbm1(i * 3.31 + phys.pos.z * 0.057, 2.9);
      const r2 = fbm1(i * 7.13 - phys.pos.x * 0.061, 6.1);
      const out = tv.copy(center).sub(phys.pos);
      out.y = 0;
      if (out.lengthSq() < 0.04) out.set(r1, 0, r2);
      out.normalize();
      const kick = 2 + severity * (0.12 + 0.1 * Math.abs(r1));
      const vel = phys.vel.clone().multiplyScalar(0.85);
      vel.addScaledVector(out, kick);
      vel.y += 1.5 + severity * 0.08 * (0.5 + Math.abs(r2));

      parts.push({
        obj, pivot, parent, localPos, localQuat, restH,
        vel,
        angVel: new THREE.Vector3(r1 * 8, (r1 - r2) * 6, r2 * 8),
        asleep: false,
        hitCd: 0,
      });
    }
  }

  function update(dt) {
    hits.length = 0;
    for (const p of parts) {
      if (p.asleep) continue;
      p.hitCd = Math.max(0, p.hitCd - dt);
      p.vel.y -= G * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 0.15));
      p.pivot.position.addScaledVector(p.vel, dt);

      const w = p.angVel;
      const wMag = w.length();
      if (wMag > 1e-6) {
        tv.copy(w).divideScalar(wMag);
        p.pivot.quaternion.multiply(tq.setFromAxisAngle(tv, Math.min(wMag, 9) * dt)).normalize();
      }

      const pos = p.pivot.position;
      const surf = surfaceAt(pos.x, pos.z);
      const water = surf.type === 'water';
      const gy = (water ? -0.3 : Math.max(surf.h, 0)) + p.restH;
      if (pos.y <= gy) {
        pos.y = gy;
        if (water) {
          if (p.vel.y < -3 && p.hitCd === 0 && hits.length < 3) {
            hits.push({ pos: pos.clone(), type: 'water', mag: Math.min(6, -p.vel.y * 0.7) });
            p.hitCd = 0.4;
          }
          p.vel.y = 0;
          p.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
          w.multiplyScalar(Math.max(0, 1 - dt * 3.5));
        } else {
          // bounce off the local terrain normal so debris kicks downhill
          const e = 2;
          const nx = heightAt(pos.x - e, pos.z) - heightAt(pos.x + e, pos.z);
          const nz = heightAt(pos.x, pos.z - e) - heightAt(pos.x, pos.z + e);
          tv.set(nx / (2 * e), 1, nz / (2 * e)).normalize();
          const vn = p.vel.dot(tv);
          if (vn < 0) {
            if (vn < -3 && p.hitCd === 0 && hits.length < 3) {
              hits.push({ pos: pos.clone(), type: surf.type === 'runway' ? 'runway' : 'grass', mag: Math.min(6, -vn * 0.7) });
              p.hitCd = 0.4;
            }
            p.vel.addScaledVector(tv, -vn * 1.35); // restitution 0.35
          }
          p.vel.x *= Math.max(0, 1 - dt * 1.3);
          p.vel.z *= Math.max(0, 1 - dt * 1.3);
          w.multiplyScalar(Math.max(0, 1 - dt * 1.6));
        }
        if (p.vel.lengthSq() < 0.25 && w.lengthSq() < 0.25) p.asleep = true;
      } else {
        w.multiplyScalar(Math.max(0, 1 - dt * 0.3));
      }
    }
  }

  function restore(plane) {
    for (const p of parts) {
      p.parent.add(p.obj);
      p.obj.position.copy(p.localPos);
      p.obj.quaternion.copy(p.localQuat);
      scene.remove(p.pivot);
    }
    parts.length = 0;
    hits.length = 0;
    if (plane) plane.group.updateMatrixWorld(true);
  }

  return { breakUp, update, restore, hits, get active() { return parts.length > 0; } };
}
