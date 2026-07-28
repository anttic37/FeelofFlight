import * as THREE from 'three';
import { heightAt, runwayInfluence, biomeWeights } from './heightcore.js';
import { terrainColor } from './colorcore.js';
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
// A prop does NOT appear when its cell is built — it waits until the plane is
// inside its OWN hashed distance and then grows to size over GROW_S. Cells are
// square and built in lockstep, so without this the whole neighbourhood snaps
// into existence at one radius and the eye reads a moving ring of pop-in.
const APPEAR_MIN = 0.5;   // fraction of RADIUS: nearest a prop can wait until
const GROW_S = 0.55;      // seconds from nothing to full size
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

  const cells = new Map();   // key -> array of prop records
  const pending = [];
  const waiting = [];        // placed but not yet near enough to appear
  const growing = [];        // currently scaling up
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const eul = new THREE.Euler(), col = new THREE.Color();
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  const _gc = [0, 0, 0];

  // ground colour under a prop, straight from the terrain palette, so a stone
  // on red canyon rock is red and the same stone on a dune is sand-coloured
  function groundTint(x, z, h, out) {
    const gx = (heightAt(x + 4, z) - heightAt(x - 4, z)) / 8;
    const gz = (heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
    terrainColor(x, z, h, 1 / Math.sqrt(1 + gx * gx + gz * gz), out);
  }

  // write one instance at a given growth fraction (0..1); props rise out of the
  // ground as they grow instead of inflating in place
  function writeProp(p, e) {
    const kind = kinds[p.k];
    eul.set(p.tx, p.rot, p.tz);
    quat.setFromEuler(eul);
    const sy = p.sy * e;
    pos.set(p.x, p.h + sy * p.anchor, p.z);
    scl.set(p.s * e, sy, p.s * e);
    kind.mesh.setMatrixAt(p.idx, mtx.compose(pos, quat, scl));
    kind.mesh.instanceMatrix.needsUpdate = true;
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
      const s = 0.32 + rnd(ix, iz, p * 3 + 4) * (ki === 0 ? 0.6 : ki === 1 ? 0.5 : 0.85);
      const sy = s * (ki === 1 ? 1.3 + rnd(ix, iz, p * 3 + 5) * 0.7 : 0.75 + rnd(ix, iz, p * 3 + 5) * 0.5);
      const t = rnd(ix, iz, p * 3 + 6);
      // TINT FROM THE GROUND: sample the terrain palette here and shade the
      // prop from it, so stones on red canyon rock come out red and the same
      // stone on a dune comes out sand. Rocks stay near the ground colour
      // (a shade darker, slightly desaturated); greenery pulls toward foliage
      // but keeps the ground's warmth so biomes still read as one palette.
      groundTint(x, z, h, _gc);
      const v = 0.78 + t * 0.34;
      let cr, cg, cb;
      if (ki === 0) {
        const lum = (_gc[0] + _gc[1] + _gc[2]) / 3;
        cr = (_gc[0] * 0.55 + lum * 0.45) * v;
        cg = (_gc[1] * 0.55 + lum * 0.45) * v;
        cb = (_gc[2] * 0.55 + lum * 0.45) * v;
      } else {
        const m = ki === 1 ? 0.5 : 0.62; // how far toward foliage green
        cr = (_gc[0] * (1 - m) + 0.17 * m) * v;
        cg = (_gc[1] * (1 - m) + 0.34 * m) * v;
        cb = (_gc[2] * (1 - m) + 0.13 * m) * v;
      }
      // each prop waits for its OWN distance before appearing
      const ad = (APPEAR_MIN + (1 - APPEAR_MIN) * rnd(ix, iz, p * 3 + 7)) * RADIUS;
      slots.push({
        k: ki, idx: -1, x, z, h, s, sy, rot: t * 6.283,
        tx: rnd(x, z, 7) * 0.5 - 0.25, tz: rnd(z, x, 8) * 0.4 - 0.2,
        anchor: ki === 1 ? 0.45 : 0.3,
        appearD2: ad * ad, cr, cg, cb, grow: 0, alive: true,
      });
    }
    cells.set(key, slots);
    for (const p of slots) waiting.push(p);
  }

  function freeProp(p) {
    if (p.idx < 0) return;
    const kind = kinds[p.k];
    kind.mesh.setMatrixAt(p.idx, HIDE);
    kind.mesh.instanceMatrix.needsUpdate = true;
    kind.free.push(p.idx);
    p.idx = -1;
  }

  function dropCell(key) {
    const slots = cells.get(key);
    if (!slots) return;
    for (const p of slots) { p.alive = false; freeProp(p); } // lists prune lazily
    cells.delete(key);
  }

  let lastIx = NaN, lastIz = NaN, lastT = 0;

  function update(planePos, time = 0) {
    const dt = Math.min(0.1, Math.max(0, time - lastT));
    lastT = time;
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

    // waiting -> growing, each at its own distance (swap-pop keeps it O(n))
    for (let i = waiting.length - 1; i >= 0; i--) {
      const p = waiting[i];
      let take = false;
      if (!p.alive) take = true;
      else {
        const dx = p.x - planePos.x, dz = p.z - planePos.z;
        if (dx * dx + dz * dz < p.appearD2) {
          const kind = kinds[p.k];
          if (kind.free.length) {
            p.idx = kind.free.pop();
            if (p.idx + 1 > kind.mesh.count) kind.mesh.count = p.idx + 1;
            col.setRGB(p.cr, p.cg, p.cb);
            kind.mesh.setColorAt(p.idx, col);
            if (kind.mesh.instanceColor) kind.mesh.instanceColor.needsUpdate = true;
            p.grow = 0;
            writeProp(p, 0.001);
            growing.push(p);
            take = true;
          }
        }
      }
      if (take) { waiting[i] = waiting[waiting.length - 1]; waiting.pop(); }
    }

    // grow to full size — smoothstep, so they swell out of the ground rather
    // than blinking into existence at full scale
    for (let i = growing.length - 1; i >= 0; i--) {
      const p = growing[i];
      let done = !p.alive;
      if (p.alive) {
        p.grow = Math.min(1, p.grow + dt / GROW_S);
        const e = p.grow * p.grow * (3 - 2 * p.grow);
        writeProp(p, e);
        done = p.grow >= 1;
      }
      if (done) { growing[i] = growing[growing.length - 1]; growing.pop(); }
    }
  }

  function stats() {
    let live = 0;
    for (const k of kinds) live += MAX - k.free.length;
    return { cells: cells.size, props: live, waiting: waiting.length, growing: growing.length, queued: pending.length / 2 };
  }

  return { update, stats };
}
