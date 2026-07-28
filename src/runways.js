import * as THREE from 'three';
import { noise2 } from './noise.js';
import { RUNWAYS, heightAt } from './heightcore.js';
import { injectGroundFX } from './groundfx.js';

// Runway meshes, markings, lights, windsocks + the hangar. The strips, the
// shared feature anchors and the flattening math live in heightcore.js (pure,
// worker-loadable); they are re-exported here so consumer imports are
// unchanged. The old world.js<->runways.js circular import is gone — both now
// depend one-way on heightcore.js, and heightAt is safe to call anywhere.
export {
  HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B, PEAK, CANYON_PATH, RUNWAYS,
  onRunway, runwayInfluence, applyRunwayFlattening,
} from './heightcore.js';

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
    const stripMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, flatShading: true });
    injectGroundFX(stripMat, { detail: false }); // cloud shadows cross the asphalt too
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(r.width, r.length, 1, 10).rotateX(-Math.PI / 2),
      stripMat
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

  // CONTROL TOWER at every strip: shaft, glazed cab, gallery, mast and a
  // flashing aerodrome beacon. Stands off the side opposite the windsock so
  // the two read as one little airfield rather than a cluster of poles.
  // (No transmission material on the glazing — it triggers three's
  // transmission pass, which renders the ocean shader black.)
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd7d2c4, ...flat });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b4256, ...flat, roughness: 0.35, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d9298, ...flat });
  const shaftGeo = new THREE.CylinderGeometry(2.0, 2.9, 11, 8);
  const galleryGeo = new THREE.CylinderGeometry(4.3, 4.3, 0.35, 8);
  const glassGeo = new THREE.CylinderGeometry(3.5, 3.15, 2.6, 8);
  const capGeo = new THREE.CylinderGeometry(3.9, 3.7, 0.5, 8);
  const mastGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.2, 4);
  const beaconGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const beacons = [];
  for (const r of RUNWAYS) {
    // opposite side from the windsock, a third of the way along the strip
    const lx = -(r.width / 2 + 34), lz = -r.length / 2 + 110;
    const tx = r.x + lx * r._c + lz * r._s, tz = r.z - lx * r._s + lz * r._c;
    const tower = new THREE.Group();
    tower.position.set(tx, heightAt(tx, tz) - 0.6, tz);
    tower.rotation.y = r.heading;
    const shaft = new THREE.Mesh(shaftGeo, concrete);
    shaft.position.y = 5.5;
    const gallery = new THREE.Mesh(galleryGeo, concrete);
    gallery.position.y = 11.1;
    const cab = new THREE.Mesh(glassGeo, glass);
    cab.position.y = 12.5;
    const cap = new THREE.Mesh(capGeo, concrete);
    cap.position.y = 14;
    const mast = new THREE.Mesh(mastGeo, steel);
    mast.position.y = 15.8;
    const beacon = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    beacon.position.y = 17.6;
    for (const m of [shaft, gallery, cab, cap]) { m.castShadow = true; m.receiveShadow = true; }
    tower.add(shaft, gallery, cab, cap, mast, beacon);
    group.add(tower);
    beacons.push({ beacon, ph: beacons.length * 1.37 });
  }

  // APPROACH LIGHTS: five crossbars marching out from each threshold along the
  // extended centreline. Placed in WORLD space and sampled onto the terrain —
  // parented to the strip they would float or bury themselves, because the
  // approach corridor slopes away from the graded pad.
  const APP_BARS = 5, APP_W = 3;
  const appLights = new THREE.InstancedMesh(lightGeo, lightMat, RUNWAYS.length * 2 * APP_BARS * APP_W);
  let ai = 0;
  const whiteC = new THREE.Color(0xf2f6ff);
  s.set(1.25, 1.25, 1.25); // a touch larger than the edge lights: seen from far out
  for (const r of RUNWAYS) {
    for (const end of [-1, 1]) {
      for (let bar = 1; bar <= APP_BARS; bar++) {
        const lz = end * (r.length / 2 + bar * 58);
        for (let k = -1; k <= 1; k++) {
          const lx = k * 5.0;
          const wx = r.x + lx * r._c + lz * r._s, wz = r.z - lx * r._s + lz * r._c;
          p.set(wx, Math.max(0.2, heightAt(wx, wz)) + 0.45, wz);
          appLights.setMatrixAt(ai, mtx.compose(p, q, s));
          appLights.setColorAt(ai++, whiteC);
        }
      }
    }
  }
  appLights.count = ai;
  group.add(appLights);

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
    // aerodrome beacon: a rotating lamp seen from a fixed point reads as a
    // sharp flash, not a fade — hence the narrow pulse rather than a sine
    for (const b of beacons) {
      const ph = (time * 0.55 + b.ph) % 1;
      const flash = ph < 0.11 ? 1 : (ph < 0.5 && ph > 0.39 ? 0.75 : 0.06);
      b.beacon.material.color.setRGB(flash, flash * (0.55 + 0.45 * flash), flash * 0.35);
      const sc = 0.55 + flash * 0.75;
      b.beacon.scale.set(sc, sc, sc);
    }
  }
  return { update };
}
