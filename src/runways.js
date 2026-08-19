import * as THREE from 'three';
import { noise2 } from './noise.js';
import { RUNWAYS, heightAt } from './heightcore.js';
import { injectGroundFX } from './groundfx.js';
import { tintUnlit } from './atmosphere.js';

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
  // Paint on tarmac, and paint is lit like anything else — but a MeshBasicMaterial is not, so
  // the markings held their midday grey while the runway under them went orange and then
  // dark. Tinted rather than converted to a lit material: these are instanced by the hundred
  // and stay flat and legible from the air, which is why they were Basic to begin with.
  const markMat = tintUnlit(new THREE.MeshBasicMaterial({ color: 0xd6d6ca }));
  const lightGeo = new THREE.SphereGeometry(0.42, 6, 5);
  // NOT tinted, and that is the point of the distinction: an edge light emits, so it should
  // look the same at every hour and simply stop being noticeable when the sun is up.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // the stalk under each lamp, and the low plates along the verge
  const poleStalkGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.95, 5);
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x6f7276, flatShading: true, roughness: 1 });
  const boardGeo = new THREE.BoxGeometry(0.14, 0.62, 1.5);
  // PUSHED ABOVE 1.0 SO THEY ACTUALLY GLOW. The whole lighting kit was here — edge rows,
  // thresholds, approach bars — but at hex colours every channel sat at or under 1.0,
  // and the bloom threshold is 1.25: not one lamp on the island could ever bloom. They
  // were dim beads at night, which is the one time a runway light earns its keep. Same
  // fix as the mast lamps (see landmarks.js): MeshBasic + the half-float composer keeps
  // values above 1.0, and bloom turns the excess into glow instead of clipping it. The
  // multipliers put the brightest channel near the masts' proven 2.4-2.6.
  const amber = new THREE.Color(0xffb347).multiplyScalar(2.4),
        green = new THREE.Color(0x53e07a).multiplyScalar(2.6);
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

    // edge lights (amber) + threshold rows (green), unlit so they read as emissive.
    // EACH ONE STANDS ON A POLE now: the lamps used to be spheres floating at 0.5 with
    // nothing under them, which from low down read as beads hovering over the grass. The
    // stalk is what makes them read as fittings planted in the ground.
    const rows = Math.floor(r.length / 30) + 1;
    const nLights = rows * 2 + 10;
    const lights = new THREE.InstancedMesh(lightGeo, lightMat, nLights);
    const poles = new THREE.InstancedMesh(poleStalkGeo, stalkMat, nLights);
    const LAMP_Y = 0.95;
    let li = 0;
    s.set(1, 1, 1);
    const placeLight = (lx, lz, col) => {
      p.set(lx, LAMP_Y, lz);
      lights.setMatrixAt(li, mtx.compose(p, q, s));
      lights.setColorAt(li, col);
      p.set(lx, LAMP_Y * 0.5, lz);           // stalk spans ground to lamp
      poles.setMatrixAt(li, mtx.compose(p, q, s));
      li++;
    };
    for (let k = 0; k < rows; k++) {
      const lz = -(rows - 1) * 15 + k * 30;
      for (const side of [-1, 1]) placeLight(side * (r.width / 2 + 1.7), lz, amber);
    }
    for (const end of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        placeLight(-r.width / 2 + (k + 0.5) * (r.width / 5), end * (r.length / 2 + 2.5), green);
      }
    }
    poles.count = li;
    poles.castShadow = true;
    g.add(lights, poles);

    // EDGE MARKER BOARDS down both verges, the low white plates that make the runway edge
    // legible on the ground when the lights are not lit. Spaced wider than the lamps so the
    // two patterns do not merge into one dotted line from the air.
    const boardN = Math.max(2, Math.floor(r.length / 90));
    const boards = new THREE.InstancedMesh(boardGeo, markMat, boardN * 2);
    let bi = 0;
    for (let k = 0; k < boardN; k++) {
      const lz = -r.length / 2 + 45 + k * 90;
      for (const side of [-1, 1]) {
        p.set(side * (r.width / 2 + 4.2), 0.42, lz);
        boards.setMatrixAt(bi++, mtx.compose(p, q, s));
      }
    }
    boards.count = bi;
    boards.castShadow = true;
    g.add(boards);

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
  // INSTANCED ACROSS THE STRIPS, which is what pays for the extra detail. Every part used
  // to be its own Mesh per runway, so an eight-strip island spent 48 draw calls on towers
  // alone; as instanced parts it is eleven however many strips the seed produces, and the
  // plinth, the gallery railing and the antenna cross-arm are then free.
  const UP = new THREE.Vector3(0, 1, 0);
  const tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1);
  const NT = RUNWAYS.length;
  const towerAt = RUNWAYS.map((r) => {
    // opposite side from the windsock, a third of the way along the strip
    const lx = -(r.width / 2 + 34), lz = -r.length / 2 + 110;
    const tx = r.x + lx * r._c + lz * r._s, tz = r.z - lx * r._s + lz * r._c;
    return { x: tx, y: heightAt(tx, tz) - 0.6, z: tz, h: r.heading };
  });
  const towerPart = (geo, mat, yy, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, NT);
    for (let i = 0; i < NT; i++) {
      const t = towerAt[i];
      tq.setFromAxisAngle(UP, t.h);
      tp.set(t.x, t.y + yy, t.z);
      mtx.compose(tp, tq, ts);
      im.setMatrixAt(i, mtx);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = shadow;
    group.add(im);
    return im;
  };

  // A splayed plinth and a tapering shaft read as something built to stand up in wind; the
  // old single barrel read as a pipe. The glazed band partway up is the stairwell, and it
  // is what gives the shaft a sense of scale from the air.
  towerPart(new THREE.CylinderGeometry(3.5, 4.2, 1.8, 8), concrete, 0.9);
  towerPart(new THREE.CylinderGeometry(2.0, 2.9, 10.2, 8), concrete, 6.9);
  towerPart(new THREE.CylinderGeometry(2.32, 2.32, 1.5, 8), glass, 8.4, false);
  towerPart(new THREE.CylinderGeometry(4.3, 4.3, 0.35, 8), concrete, 12.2);
  // gallery railing: a thin ring standing on the balcony edge
  towerPart(new THREE.TorusGeometry(4.15, 0.06, 4, 14).rotateX(Math.PI / 2), steel, 13.1, false);
  towerPart(new THREE.CylinderGeometry(3.5, 3.15, 2.6, 8), glass, 13.7);
  towerPart(new THREE.CylinderGeometry(3.9, 3.7, 0.5, 8), concrete, 15.2);
  towerPart(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 4), steel, 17.0, false);
  // antenna cross-arms, the detail that makes a mast read as a mast
  towerPart(new THREE.BoxGeometry(2.4, 0.07, 0.07), steel, 17.7, false);
  towerPart(new THREE.BoxGeometry(1.6, 0.07, 0.07), steel, 18.4, false);
  const beaconGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const beaconInst = towerPart(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 19.0, false);
  const _bc = new THREE.Color();
  for (let i = 0; i < NT; i++) beaconInst.setColorAt(i, _bc.setRGB(1, 1, 1));

  // APPROACH LIGHTS: five crossbars marching out from each threshold along the
  // extended centreline. Placed in WORLD space and sampled onto the terrain —
  // parented to the strip they would float or bury themselves, because the
  // approach corridor slopes away from the graded pad.
  const APP_BARS = 5, APP_W = 3;
  const appLights = new THREE.InstancedMesh(lightGeo, lightMat, RUNWAYS.length * 2 * APP_BARS * APP_W);
  let ai = 0;
  const whiteC = new THREE.Color(0xf2f6ff).multiplyScalar(2.2); // same >1.0 bloom trick as the edge lamps
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

  // ── AIRFIELD BUILDINGS, beside the primary strip ────────────────────────
  //
  // One red shed with a pyramid on top does not read as an aerodrome — it reads as a barn
  // that happens to be near a runway, which is what it looked like. What makes a small
  // field legible from the air is the APRON and the fact that things face it: a pale
  // concrete pad with the hangar mouth opening onto it, vehicles and tanks parked on it,
  // and everything squared to the runway rather than scattered.
  //
  // All of it is axis-aligned boxes and cylinders inside one group that carries the strip's
  // heading, so nothing here depends on getting a rotation order right.
  const r0 = RUNWAYS[0];
  const hx = r0.x + -52 * r0._c + 150 * r0._s, hz = r0.z - -52 * r0._s + 150 * r0._c;
  const yard = new THREE.Group();
  yard.position.set(hx, heightAt(hx, hz), hz);
  yard.rotation.y = r0.heading;
  group.add(yard);

  const panel = new THREE.MeshStandardMaterial({ color: 0xb9bcb4, ...flat });   // corrugated metal
  const roofMet = new THREE.MeshStandardMaterial({ color: 0x53585c, ...flat });
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x9d9c94, ...flat });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x6c7076, ...flat });

  const add = (geo, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    yard.add(m);
    return m;
  };

  // apron: the pad everything else sits on, running toward the runway edge
  add(new THREE.BoxGeometry(52, 0.35, 34), apronMat, 12, 0.12, 0, false);

  // MAIN HANGAR. Wide and shallow with a low ridge, which is the proportion of a real
  // general-aviation hangar; the old one was a house. The mouth faces the apron.
  add(new THREE.BoxGeometry(20, 7.2, 15), panel, -8, 3.4, 0);
  const ridge = add(new THREE.ConeGeometry(11.2, 2.6, 4).rotateY(Math.PI / 4), roofMet, -8, 8.2);
  ridge.scale.set(1.28, 1, 0.96);
  // eaves: a thin slab a little wider than the walls, so the roof has a lip and the wall
  // gets a shadow line under it instead of meeting the roof in a bare seam
  add(new THREE.BoxGeometry(21.6, 0.3, 16.4), roofMet, -8, 6.95, 0);
  // the door itself, inset, with sliding leaves
  add(new THREE.BoxGeometry(0.4, 5.6, 12.4), doorMat, 2.1, 2.9, 0, false);
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(0.22, 5.4, 0.18), panel, 2.35, 2.9, -5.2 + i * 2.08, false);
  }
  // office lean-to on the far end, lower and in the trim colour
  add(new THREE.BoxGeometry(6.4, 3.4, 7), red, -21, 1.7, 3.4);
  add(new THREE.BoxGeometry(7.0, 0.26, 7.6), roofMet, -21, 3.5, 3.4);
  add(new THREE.BoxGeometry(0.16, 1.1, 4.6), glass, -17.75, 2.3, 3.4, false);

  // FUEL: two horizontal tanks on stands. rotateZ puts a cylinder's axis along X, which is
  // the one cylinder transform that needs no thinking about.
  const tankGeo = new THREE.CylinderGeometry(1.5, 1.5, 6.4, 12).rotateZ(Math.PI / 2);
  for (const z of [-11.5, -7.6]) {
    add(tankGeo, cream, 20, 2.3, z);
    add(new THREE.BoxGeometry(0.5, 1.4, 0.5), steel, 17.6, 0.9, z, false);
    add(new THREE.BoxGeometry(0.5, 1.4, 0.5), steel, 22.4, 0.9, z, false);
  }

  // A windsock is not the only thing that moves on an airfield, but it is the only thing
  // that has to — these just have to be THERE, so they are static and cheap.
  add(new THREE.BoxGeometry(4.2, 1.5, 1.9), cream, 9, 0.95, 9.5);     // fuel bowser
  add(new THREE.BoxGeometry(1.7, 1.2, 1.7), red, 7.2, 1.5, 9.5);      // its cab
  add(new THREE.BoxGeometry(2.6, 1.1, 1.4), panel, 14, 0.75, 12.2);   // tug

  // perimeter posts along the back of the yard, instanced
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.5, 5);
  const posts = new THREE.InstancedMesh(postGeo, steel, 14);
  for (let i = 0; i < 14; i++) {
    tq.identity();
    tp.set(-30 + i * 4.4, 0.75, -17.5);
    mtx.compose(tp, tq, ts);
    posts.setMatrixAt(i, mtx);
  }
  posts.instanceMatrix.needsUpdate = true;
  yard.add(posts);

  scene.add(group);

  function update(time) {
    for (const w of socks) {
      w.pivot.rotation.y = 2.3 + (noise2(time * 0.1, 3.3 + w.ph) - 0.5) * 1.1;
      w.tilt.rotation.z = 0.35 - noise2(time * 0.6, 8.1 + w.ph) * 0.25;
    }
    // aerodrome beacon: a rotating lamp seen from a fixed point reads as a
    // sharp flash, not a fade — hence the narrow pulse rather than a sine
    // Instanced now, so the flash is per-instance colour and per-instance scale rather than
    // a material and a transform per tower.
    for (let i = 0; i < NT; i++) {
      const ph = (time * 0.55 + i * 1.37) % 1;
      const flash = ph < 0.11 ? 1 : (ph < 0.5 && ph > 0.39 ? 0.75 : 0.06);
      // x2.6 so the peak crosses the 1.25 bloom threshold: the pulse pattern was already
      // here, but it topped out at exactly 1.0 — a flash that could never actually flash
      beaconInst.setColorAt(i, _bc.setRGB(flash * 2.6, flash * (0.55 + 0.45 * flash) * 2.6, flash * 0.91));
      const sc = 0.55 + flash * 0.75;
      const t = towerAt[i];
      tq.setFromAxisAngle(UP, t.h);
      tp.set(t.x, t.y + 19.0, t.z);
      mtx.compose(tp, tq, ts.set(sc, sc, sc));
      beaconInst.setMatrixAt(i, mtx);
    }
    ts.set(1, 1, 1);
    beaconInst.instanceMatrix.needsUpdate = true;
    if (beaconInst.instanceColor) beaconInst.instanceColor.needsUpdate = true;
  }
  return { update };
}
