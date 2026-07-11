import * as THREE from 'three';
import { noise2 } from './noise.js';
import { heightAt } from './world.js'; // circular with world.js — only called inside createRunways, safe

// Landing strips + the shared feature anchors the terrain is shaped around.
// heading = radians about +Y; heading 0 -> long axis along world -Z.
// DESIGN: world.js builds the island around these anchors (biome centers, the
// canyon carve path, the summit plateau) so every strip's surroundings fit its
// theme by construction. runways.js never reads world.js bindings at module
// scope — only heightAt inside createRunways, after all modules evaluated.

// biome anchor points (world.js uses them for region masks + vegetation)
export const HILLS_C  = { x: 900,   z: 4200 };  // southern rolling hills
export const DESERT_C = { x: 4300,  z: 300 };   // eastern dunes + mesas
export const FOREST_C = { x: -4200, z: -100 };  // western woods
export const MTN_A    = { x: -3000, z: -2000 }; // mountain ridge west end
export const MTN_B    = { x: 1400,  z: -3100 }; // mountain ridge east end
export const PEAK     = { x: -350,  z: -2750 }; // highest summit (~650 m)

// Canyon carve waypoints, mountain foothills -> southeast sea. Segment [2]->[3]
// is straight (2482 m) and carries the Canyon strip dead-center, so the flat
// gorge floor runs clear for 800+ m past both thresholds by construction.
export const CANYON_PATH = [
  { x: 1250, z: -1250 }, { x: 2250, z: 550 }, { x: 3050, z: 2350 },
  { x: 4200, z: 4550 }, { x: 5350, z: 6350 },
];

// m = flattening margin; pad = base-terrain platform blend consumed by world.js.
// [3] heading matches CANYON_PATH segment [2]->[3]; [4] axis runs E-W along the
// range's south flank with PEAK ~810 m away, perpendicular to the approach.
export const RUNWAYS = [
  { name: 'Coast',  x: 250,   z: 6050,  heading: 0,       length: 450, width: 26, elev: 12,  m: 90, pad: 300 },
  { name: 'Desert', x: 4350,  z: 900,   heading: 0.28,    length: 620, width: 30, elev: 36,  m: 90, pad: 320 },
  { name: 'Forest', x: -4250, z: -300,  heading: 1.05,    length: 380, width: 22, elev: 64,  m: 70, pad: 260 },
  { name: 'Canyon', x: 3625,  z: 3450,  heading: -2.6599, length: 420, width: 24, elev: 72,  m: 60, pad: 220 },
  { name: 'Summit', x: 350,   z: -2350, heading: -1.64,   length: 340, width: 20, elev: 465, m: 70, pad: 300 },
  { name: 'Hills',  x: 1600,  z: 3850,  heading: 2.30,    length: 400, width: 24, elev: 104, m: 80, pad: 280 },
];
for (const r of RUNWAYS) {
  r._c = Math.cos(r.heading); r._s = Math.sin(r.heading);
  const reach = Math.hypot(r.length, r.width) / 2 + r.m + 2;
  r._r2 = reach * reach; // coarse circle reject for the hot per-sample loops
}

// blend weight: 1 on the strip, smoothstep down to 0 at r.m outside the rect
function stripWeight(r, x, z) {
  const dx = x - r.x, dz = z - r.z;
  if (dx * dx + dz * dz > r._r2) return 0;
  const lx = dx * r._c - dz * r._s, lz = dx * r._s + dz * r._c;
  const du = Math.abs(lx) - r.width * 0.5, dv = Math.abs(lz) - r.length * 0.5;
  if (du >= r.m || dv >= r.m) return 0;
  if (du <= 0 && dv <= 0) return 1;
  const d = Math.hypot(Math.max(0, du), Math.max(0, dv));
  if (d >= r.m) return 0;
  const t = d / r.m;
  return 1 - t * t * (3 - 2 * t);
}

export function onRunway(x, z) {
  for (const r of RUNWAYS) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > r._r2) continue;
    const lx = dx * r._c - dz * r._s, lz = dx * r._s + dz * r._c;
    if (Math.abs(lx) <= r.width * 0.5 && Math.abs(lz) <= r.length * 0.5) return true;
  }
  return false;
}

// max blend weight over all strips (0 clear .. 1 on asphalt). Extra helper used by
// world.js for vegetation exclusion and dirt tinting; not part of the shared contract.
export function runwayInfluence(x, z) {
  let w = 0;
  for (const r of RUNWAYS) w = Math.max(w, stripWeight(r, x, z));
  return w;
}

export function applyRunwayFlattening(x, z, baseH) {
  let h = baseH;
  for (const r of RUNWAYS) { // strips never overlap, order irrelevant
    const w = stripWeight(r, x, z);
    if (w > 0) h += (r.elev - h) * w;
  }
  return h;
}

export function createRunways(scene) {
  const group = new THREE.Group();

  // shared speckled asphalt canvas
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#45484d';
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 380; i++) {
    const v = (56 + noise2(i * 1.31, 7.7) * 30) | 0;
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
    ctx.fillRect((noise2(i * 0.73, 1.7) * 63) | 0, (noise2(2.9, i * 0.51) * 63) | 0, 2, 2);
  }

  const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xd6d6ca });
  const lightGeo = new THREE.SphereGeometry(0.42, 6, 5);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const amber = new THREE.Color(0xffb347), green = new THREE.Color(0x53e07a);
  const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  q.identity();

  for (const r of RUNWAYS) {
    const g = new THREE.Group();
    g.position.set(r.x, r.elev, r.z);
    g.rotation.y = r.heading;

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(r.width / 10, r.length / 10);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(r.width, r.length, 1, 10).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, flatShading: true })
    );
    strip.position.y = 0.08;
    strip.receiveShadow = true;
    g.add(strip);

    // white markings: centerline dashes + threshold piano bars
    const dashN = Math.floor((r.length - 64) / 30) + 1;
    const marks = new THREE.InstancedMesh(markGeo, markMat, dashN + 12);
    let mi = 0;
    for (let k = 0; k < dashN; k++) {
      p.set(0, 0.22, -(dashN - 1) * 15 + k * 30);
      s.set(0.9, 1, 5.5);
      marks.setMatrixAt(mi++, mtx.compose(p, q, s));
    }
    const slot = r.width / 6;
    for (const end of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        p.set(-r.width / 2 + (k + 0.5) * slot, 0.22, end * (r.length / 2 - 10));
        s.set(slot * 0.5, 1, 9);
        marks.setMatrixAt(mi++, mtx.compose(p, q, s));
      }
    }
    g.add(marks);

    // edge lights (amber) + threshold rows (green), unlit so they read as emissive
    const rows = Math.floor(r.length / 30) + 1;
    const lights = new THREE.InstancedMesh(lightGeo, lightMat, rows * 2 + 10);
    let li = 0;
    s.set(1, 1, 1);
    for (let k = 0; k < rows; k++) {
      const lz = -(rows - 1) * 15 + k * 30;
      for (const side of [-1, 1]) {
        p.set(side * (r.width / 2 + 1.7), 0.5, lz);
        lights.setMatrixAt(li, mtx.compose(p, q, s));
        lights.setColorAt(li++, amber);
      }
    }
    for (const end of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        p.set(-r.width / 2 + (k + 0.5) * (r.width / 5), 0.5, end * (r.length / 2 + 2.5));
        lights.setMatrixAt(li, mtx.compose(p, q, s));
        lights.setColorAt(li++, green);
      }
    }
    g.add(lights);
    group.add(g);
  }

  const flat = { flatShading: true, roughness: 1 };
  const cream = new THREE.MeshStandardMaterial({ color: 0xf0e3c6, ...flat });
  const red = new THREE.MeshStandardMaterial({ color: 0xb04a3a, ...flat });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8722c, side: THREE.DoubleSide, ...flat });

  // windsock at every strip, off the edge near a threshold (shared geometries)
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 7, 6);
  const sockGeo = new THREE.ConeGeometry(0.5, 2.6, 6, 1, true);
  const socks = [];
  for (const r of RUNWAYS) {
    const lx = r.width / 2 + 9, lz = r.length / 2 - 30;
    const wx = r.x + lx * r._c + lz * r._s, wz = r.z - lx * r._s + lz * r._c;
    const wsock = new THREE.Group();
    wsock.position.set(wx, heightAt(wx, wz), wz); // blended apron ground
    const pole = new THREE.Mesh(poleGeo, cream);
    pole.position.y = 3.5;
    pole.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.y = 6.9;
    const tilt = new THREE.Group();
    const sock = new THREE.Mesh(sockGeo, orange);
    sock.rotation.z = Math.PI / 2; // apex points local -X, mouth at the pole
    sock.position.x = -1.4;
    sock.castShadow = true;
    tilt.add(sock);
    pivot.add(tilt);
    wsock.add(pole, pivot);
    group.add(wsock);
    socks.push({ pivot, tilt, ph: socks.length * 2.7 });
  }

  // hangar shed beside the primary strip only, door facing the runway
  const r0 = RUNWAYS[0];
  const hx = r0.x + -46 * r0._c + 150 * r0._s, hz = r0.z - -46 * r0._s + 150 * r0._c;
  const hangar = new THREE.Group();
  hangar.position.set(hx, heightAt(hx, hz), hz);
  hangar.rotation.y = r0.heading;
  const body = new THREE.Mesh(new THREE.BoxGeometry(15, 5.6, 11), red);
  body.position.y = 2.4; // sunk slightly into the graded ground
  body.castShadow = true;
  body.receiveShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(9.8, 3.4, 4).rotateY(Math.PI / 4), cream);
  roof.scale.set(1.2, 1, 0.9);
  roof.position.y = 6.9;
  roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 4.4), new THREE.MeshStandardMaterial({ color: 0x4d3f36, ...flat }));
  door.rotation.y = Math.PI / 2;
  door.position.set(7.51, 2.1, 0);
  hangar.add(body, roof, door);
  group.add(hangar);

  scene.add(group);

  function update(time) {
    for (const w of socks) {
      w.pivot.rotation.y = 2.3 + (noise2(time * 0.1, 3.3 + w.ph) - 0.5) * 1.1;
      w.tilt.rotation.z = 0.35 - noise2(time * 0.6, 8.1 + w.ph) * 0.25;
    }
  }
  return { update };
}
