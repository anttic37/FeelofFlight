import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, runwayInfluence } from './heightcore.js';

// Radio masts on the high ground and a wind farm along a ridge. Both exist for the same
// reason: an island of bare hills gives you nothing to judge SIZE or DISTANCE against, and a
// mast you know is 70 m tall does that instantly. They are also the only things out there
// that move, which is what makes the landscape feel occupied rather than modelled.
//
// SITES ARE CHOSEN, NOT RANDOM. The scan is deterministic and driven by heightAt, so a given
// seed always puts them in the same places — a landmark that moves between sessions is not a
// landmark. Candidates must be high, must be gentle enough to build on, and must be clear of
// the runways; then they are taken greedily with a minimum spacing so they read as a line of
// separate structures instead of a clump.

const flat = { flatShading: true, roughness: 1 };

function pickSites(count, { minH, maxSlope, spacing, reach = 7200, skip = 0 }) {
  const cands = [];
  const STEP = 180;
  for (let x = -reach; x <= reach; x += STEP) {
    for (let z = -reach; z <= reach; z += STEP) {
      if (Math.hypot(x, z) > reach) continue;
      const h = heightAt(x, z);
      if (h < minH) continue;
      if (runwayInfluence(x, z) > 0.01) continue;      // never on a strip or its approach
      const gx = heightAt(x + 26, z) - heightAt(x - 26, z);
      const gz = heightAt(x, z + 26) - heightAt(x, z - 26);
      const slope = Math.hypot(gx, gz) / 52;
      if (slope > maxSlope) continue;
      cands.push({ x, z, h, slope, score: h - slope * 900 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands.slice(skip)) {
    if (out.length >= count) break;
    if (out.some(o => Math.hypot(o.x - c.x, o.z - c.z) < spacing)) continue;
    out.push(c);
  }
  return out;
}

export function createLandmarks(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, ...flat });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, ...flat });
  const dark = new THREE.MeshStandardMaterial({ color: 0x596069, ...flat });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });

  const mtx = new THREE.Matrix4();
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
  const qy = new THREE.Quaternion(), qs = new THREE.Quaternion();

  const place = (geo, mat, sites, yOff, shadow = true, scale = null) => {
    const im = new THREE.InstancedMesh(geo, mat, sites.length);
    for (let i = 0; i < sites.length; i++) {
      Q.setFromAxisAngle(UP, sites[i].yaw || 0);
      P.set(sites[i].x, sites[i].h + yOff, sites[i].z);
      mtx.compose(P, Q, scale || S);
      im.setMatrixAt(i, mtx);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = shadow;
    group.add(im);
    return im;
  };

  // ── RADIO MASTS ─────────────────────────────────────────────────────────
  // Highest ground on the island, well apart. A guyed mast is a very thin thing, so what
  // sells it at distance is not the shaft but the STACK of bands up it and the light on top.
  const masts = pickSites(3, { minH: 210, maxSlope: 0.34, spacing: 2600 });
  const MAST_H = 74;
  place(new THREE.CylinderGeometry(0.5, 1.5, MAST_H, 6), steel, masts, MAST_H / 2);
  place(new THREE.CylinderGeometry(3.0, 3.6, 1.6, 6), dark, masts, 0.8);          // footing
  // three collars: the only thing giving a 74 m needle a sense of height from a distance
  for (const f of [0.34, 0.58, 0.80]) {
    const rr = 1.5 - 1.0 * f;
    place(new THREE.CylinderGeometry(rr + 0.55, rr + 0.55, 0.5, 6), dark, masts, MAST_H * f, false);
  }
  place(new THREE.BoxGeometry(4.6, 0.16, 0.16), steel, masts, MAST_H * 0.86, false);
  place(new THREE.BoxGeometry(0.16, 0.16, 3.4), steel, masts, MAST_H * 0.92, false);
  const mastLamps = place(new THREE.SphereGeometry(0.9, 7, 5), lampMat, masts, MAST_H + 1.2, false);
  const _c = new THREE.Color();
  for (let i = 0; i < masts.length; i++) mastLamps.setColorAt(i, _c.setRGB(1, 0.23, 0.18));

  // ── WIND FARM ───────────────────────────────────────────────────────────
  // Skips the very top of the candidate list so the turbines take the next tier of ground
  // rather than fighting the masts for the same three summits.
  const turbines = pickSites(7, { minH: 150, maxSlope: 0.26, spacing: 1150, skip: 12 });
  // all facing roughly into the prevailing wind, with a little scatter so the farm does not
  // look stamped — real ones yaw together but never exactly
  turbines.forEach((t, i) => { t.yaw = 0.63 + Math.sin(i * 2.4) * 0.22; });

  const TOW_H = 46, BLADE = 21;
  place(new THREE.CylinderGeometry(0.85, 1.9, TOW_H, 8), white, turbines, TOW_H / 2);
  place(new THREE.CylinderGeometry(2.9, 3.4, 1.2, 8), dark, turbines, 0.6);
  place(new THREE.BoxGeometry(2.1, 2.2, 6.4), white, turbines, TOW_H + 0.9);

  // ROTOR AS ONE MERGED GEOMETRY, so the whole spinning assembly is a single instanced draw
  // however many turbines there are — three separate blade meshes per turbine would be 21
  // draws and 21 matrices to keep in step. Built in a frame whose spin axis is +Z, so the
  // per-frame update is just yaw * spin and the blades stay in their own plane.
  const bladeParts = [];
  for (let b = 0; b < 3; b++) {
    const blade = new THREE.BoxGeometry(0.95, BLADE, 0.28);
    blade.translate(0, BLADE / 2 + 1.1, 0);
    blade.rotateZ((b * Math.PI * 2) / 3);
    bladeParts.push(blade);
  }
  bladeParts.push(new THREE.CylinderGeometry(1.0, 1.0, 1.5, 8).rotateX(Math.PI / 2));
  const rotorGeo = mergeGeometries(bladeParts);
  const rotors = new THREE.InstancedMesh(rotorGeo, white, turbines.length);
  rotors.castShadow = true;
  group.add(rotors);
  const rotorAt = turbines.map((t, i) => ({
    x: t.x, y: t.h + TOW_H + 0.9, z: t.z, yaw: t.yaw,
    // hub sits ahead of the tower on the upwind side
    ox: -Math.sin(t.yaw) * 3.6, oz: -Math.cos(t.yaw) * 3.6,
    speed: 0.85 + (i % 3) * 0.11, phase: i * 1.9,
  }));

  function update(time) {
    for (let i = 0; i < rotorAt.length; i++) {
      const t = rotorAt[i];
      qy.setFromAxisAngle(UP, t.yaw);
      qs.setFromAxisAngle(FWD, time * t.speed + t.phase);
      Q.copy(qy).multiply(qs);
      P.set(t.x + t.ox, t.y, t.z + t.oz);
      mtx.compose(P, Q, S);
      rotors.setMatrixAt(i, mtx);
    }
    rotors.instanceMatrix.needsUpdate = true;
    // mast lamps: slow synchronised red night-warning blink, the aviation standard
    const on = (time % 3) < 1.1 ? 1 : 0.12;
    for (let i = 0; i < masts.length; i++) {
      mastLamps.setColorAt(i, _c.setRGB(on, on * 0.23, on * 0.18));
    }
    if (mastLamps.instanceColor) mastLamps.instanceColor.needsUpdate = true;
  }

  // Position them once up front: the rotor matrices are only written by update(), so without
  // this every rotor sits at the world origin until the first frame ticks — which is exactly
  // what a fresh scene inspection shows, and would be a stack of blades at 0,0,0 on any
  // frame rendered before the sim starts.
  update(0);

  return { update, mastCount: masts.length, turbineCount: turbines.length };
}
