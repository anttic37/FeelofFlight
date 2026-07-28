import * as THREE from 'three';
import { heightAt, runwayInfluence, biomeWeights } from './heightcore.js';
import { noise2 } from './noise.js';
import * as HC from './heightcore.js'; // _wD/_wH are live let-bindings set by biomeWeights

// GROUND RUSH: small props streamed in a tight radius around the plane —
// stones, grass tufts, scrub. Speed is only felt against things close enough
// to whip past, and the global vegetation is far too sparse and too big to do
// that job. Nothing here is meant to be looked at; it is meant to be a blur at
// the edge of vision when you are 10 m up.
//
// Placement is a world-aligned CELL GRID so props never pop or slide as the
// plane turns: a cell always yields the same props. Cells are built a few per
// frame from a queue — a full rebuild is ~1 ms of heightAt and would hitch
// every time the plane crossed a boundary (twice a second at cruise).

const CELL = 30;          // metres per cell
const RADIUS = 240;       // props live within this of the plane
const PER_CELL = 5;       // ~1000 live props: sparse enough to stay cheap, dense
                          // enough that something is always whipping past
const MAX = 1600;         // instance budget per mesh
const BUILD_PER_FRAME = 6;

// deterministic per-cell hash, same style as clouds.js
function rnd(ix, iz, k) {
  const s = Math.sin(ix * 127.1 + iz * 311.7 + k * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function createScatter(scene) {
  const geoRock = new THREE.DodecahedronGeometry(1, 0);
  const geoTuft = new THREE.ConeGeometry(0.5, 1, 4);   // closed: an open cone
  const geoBush = new THREE.IcosahedronGeometry(1, 0); // disappears edge-on
  // white base + per-instance colour, exactly like world.js's vegetation:
  // vertexColors:true would look for a geometry colour attribute these
  // primitives don't have, and instanceColor tints fine without it
  const mat = () => new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

  const kinds = [
    { mesh: new THREE.InstancedMesh(geoRock, mat(), MAX), n: 0 },
    { mesh: new THREE.InstancedMesh(geoTuft, mat(), MAX), n: 0 },
    { mesh: new THREE.InstancedMesh(geoBush, mat(), MAX), n: 0 },
  ];
  for (const k of kinds) {
    k.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    k.mesh.frustumCulled = false;   // instances move under us every frame
    k.mesh.castShadow = false;      // hundreds of tiny shadow casters cost more than they add
    k.mesh.receiveShadow = true;
    k.mesh.count = 0;
    scene.add(k.mesh);
    k.free = [];
    for (let i = MAX - 1; i >= 0; i--) k.free.push(i);
  }

  const cells = new Map();   // key -> [{kind, idx}]
  const pending = [];
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const eul = new THREE.Euler(), col = new THREE.Color();
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

  function place(kind, idx, x, y, z, s, sy, rot, r, g, b) {
    eul.set(rnd(x, z, 7) * 0.5 - 0.25, rot, rnd(z, x, 8) * 0.4 - 0.2);
    quat.setFromEuler(eul);
    pos.set(x, y, z);
    scl.set(s, sy, s);
    kind.mesh.setMatrixAt(idx, mtx.compose(pos, quat, scl));
    col.setRGB(r, g, b);
    kind.mesh.setColorAt(idx, col);
  }

  // build one cell: pick spots, reject water / runways / cliffs, choose a prop
  // type from the biome so desert gets stones and grassland gets tufts
  function buildCell(ix, iz) {
    const key = ix + ':' + iz;
    if (cells.has(key)) return;
    const slots = [];
    for (let p = 0; p < PER_CELL; p++) {
      const x = (ix + rnd(ix, iz, p * 3 + 1)) * CELL;
      const z = (iz + rnd(ix, iz, p * 3 + 2)) * CELL;
      const h = heightAt(x, z);
      if (h < 1.2) continue;                       // sea and beach wash
      // above the painted snowline (same jitter as colorcore) props read as
      // pepper specks scattered over the white caps — the exact artifact the
      // scree boulders had, so stop scatter there entirely
      if (h > 406 + (noise2(x * 0.006 + 3.7, z * 0.006) - 0.5) * 76) continue;
      if (runwayInfluence(x, z) > 0.02) continue;  // keep strips and aprons clean
      const slope = Math.abs(heightAt(x + 6, z) - heightAt(x - 6, z))
                  + Math.abs(heightAt(x, z + 6) - heightAt(x, z - 6));
      if (slope > 9) continue;                     // cliffs
      const r3 = rnd(ix, iz, p * 3 + 3);
      biomeWeights(x, z);
      // desert leans stony, wet ground leans grassy, high ground is bare rock
      const stony = Math.min(1, HC._wD * 1.3 + (h > 330 ? 1 : 0));
      let ki = r3 < 0.34 + stony * 0.5 ? 0 : (r3 < 0.78 ? 1 : 2);
      if (h > 330) ki = 0; // bare rock up high: nothing green grows on the tops
      const kind = kinds[ki];
      if (!kind.free.length) continue;
      const idx = kind.free.pop();
      const s = 0.32 + rnd(ix, iz, p * 3 + 4) * (ki === 0 ? 0.6 : ki === 1 ? 0.5 : 0.85);
      const sy = s * (ki === 1 ? 1.3 + rnd(ix, iz, p * 3 + 5) * 0.7 : 0.75 + rnd(ix, iz, p * 3 + 5) * 0.5);
      const t = rnd(ix, iz, p * 3 + 6);
      // tints borrowed from the ground palette so props sit in the terrain
      const rgb = ki === 0
        ? [0.42 + t * 0.16, 0.40 + t * 0.15, 0.37 + t * 0.13]
        : ki === 1
          ? [0.28 + t * 0.16, 0.36 + t * 0.20, 0.14 + t * 0.10]
          : [0.22 + t * 0.12, 0.31 + t * 0.14, 0.16 + t * 0.09];
      place(kind, idx, x, h + sy * (ki === 1 ? 0.45 : 0.3), z, s, sy, t * 6.283, rgb[0], rgb[1], rgb[2]);
      kind.mesh.instanceMatrix.needsUpdate = true;
      if (kind.mesh.instanceColor) kind.mesh.instanceColor.needsUpdate = true;
      if (idx + 1 > kind.mesh.count) kind.mesh.count = idx + 1;
      slots.push({ k: ki, idx });
    }
    cells.set(key, slots);
  }

  function dropCell(key) {
    const slots = cells.get(key);
    if (!slots) return;
    for (const s of slots) {
      const kind = kinds[s.k];
      kind.mesh.setMatrixAt(s.idx, HIDE);
      kind.mesh.instanceMatrix.needsUpdate = true;
      kind.free.push(s.idx);
    }
    cells.delete(key);
  }

  let lastIx = NaN, lastIz = NaN;

  function update(planePos) {
    const cx = Math.floor(planePos.x / CELL), cz = Math.floor(planePos.z / CELL);
    if (cx !== lastIx || cz !== lastIz) {
      lastIx = cx; lastIz = cz;
      const r = Math.ceil(RADIUS / CELL);
      pending.length = 0;
      for (let iz = cz - r; iz <= cz + r; iz++) {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          const dx = (ix + 0.5) * CELL - planePos.x, dz = (iz + 0.5) * CELL - planePos.z;
          if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
          if (!cells.has(ix + ':' + iz)) pending.push(ix, iz);
        }
      }
      // evict with a margin so a tight turn doesn't thrash the rim
      const dropR = (RADIUS + CELL * 2) * (RADIUS + CELL * 2);
      for (const key of cells.keys()) {
        const c = key.indexOf(':');
        const kx = +key.slice(0, c), kz = +key.slice(c + 1);
        const dx = (kx + 0.5) * CELL - planePos.x, dz = (kz + 0.5) * CELL - planePos.z;
        if (dx * dx + dz * dz > dropR) dropCell(key);
      }
    }
    for (let n = 0; n < BUILD_PER_FRAME && pending.length; n++) {
      const iz = pending.pop(), ix = pending.pop();
      buildCell(ix, iz);
    }
  }

  function stats() {
    let live = 0;
    for (const k of kinds) live += MAX - k.free.length;
    return { cells: cells.size, props: live, queued: pending.length / 2 };
  }

  return { update, stats };
}
