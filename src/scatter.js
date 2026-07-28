import * as THREE from 'three';
import { heightAt, runwayInfluence, biomeWeights } from './heightcore.js';
import { terrainColor } from './colorcore.js';
import { noise2 } from './noise.js';
import * as HC from './heightcore.js'; // _wD/_wH are live let-bindings set by biomeWeights

// GROUND RUSH: small props streamed around the plane — stones, slabs, tufts,
// scrub, dead sticks, fallen logs. Speed is only felt against things close
// enough to whip past, and the global vegetation is far too sparse and too big
// to do that job. Nothing here is meant to be looked at; it is meant to be a
// blur at the edge of vision when you are 10 m up.
//
// Placement is a world-aligned CELL GRID so props never pop or slide as the
// plane turns: a cell always yields the same props. Cells are built a few per
// frame from a queue — building the whole disc at once is milliseconds of
// heightAt and would hitch every time the plane crossed a boundary.

const CELL = 36;          // metres per cell
const RADIUS = 480;       // props live within this of the plane
const PER_CELL = 6;
// A prop does NOT appear when its cell is built — it waits until the plane is
// inside its OWN hashed distance and then grows to size over GROW_S. Cells are
// square and built in lockstep, so without this the whole neighbourhood snaps
// into existence at one radius and the eye reads a moving ring of pop-in.
// The range is deliberately wide: some props are already there at the horizon
// of the field, others only turn up when they are almost underneath you.
const APPEAR_MIN = 0.22;  // fraction of RADIUS a prop can wait until
const GROW_S = 0.55;      // seconds from nothing to full size
const BUILD_PER_FRAME = 6;

// deterministic per-cell hash, same style as clouds.js
function rnd(ix, iz, k) {
  const s = Math.sin(ix * 127.1 + iz * 311.7 + k * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function createScatter(scene) {
  // Per-kind instance caps sized to how often each is actually picked. The
  // whole matrix buffer re-uploads whenever any instance moves, so an
  // oversized cap for a rare prop costs bandwidth every frame for nothing.
  //   anchor = how far up its own height the origin sits (keeps it on the deck)
  //   rock   = the ground itself, greenery = plants, dead = bleached/grey
  const KINDS = [
    { geo: new THREE.DodecahedronGeometry(1, 0), cap: 1500, anchor: 0.30, tone: 'rock' },
    { geo: new THREE.IcosahedronGeometry(1, 0), cap: 900, anchor: 0.32, tone: 'rock' },
    { geo: new THREE.BoxGeometry(1, 0.3, 1.35), cap: 520, anchor: 0.16, tone: 'rock' },   // slab
    { geo: new THREE.ConeGeometry(0.5, 1, 4), cap: 900, anchor: 0.45, tone: 'leaf' },     // tuft
    { geo: new THREE.IcosahedronGeometry(1, 1), cap: 700, anchor: 0.35, tone: 'leaf' },   // bush
    { geo: new THREE.ConeGeometry(0.13, 1.7, 3), cap: 380, anchor: 0.5, tone: 'dead' },   // dead stick
    { geo: new THREE.CylinderGeometry(0.34, 0.4, 3, 6).rotateZ(Math.PI / 2), cap: 300, anchor: 0.22, tone: 'dead' }, // log
    // WINTER. Above the snowline the ground was left completely bare because
    // grey boulders up there read as pepper specks over the white caps. The
    // answer is not "no props", it is props the colour of the snow they sit
    // in: wind-carved drifts, buried boulders with only a shoulder showing,
    // and the odd wind-scoured rock. 'snow' tone keeps them near-white.
    { geo: new THREE.IcosahedronGeometry(1, 1), cap: 420, anchor: 0.18, tone: 'snow', soft: true },  // drift mound
    { geo: new THREE.DodecahedronGeometry(1, 0), cap: 340, anchor: 0.16, tone: 'snow', soft: true }, // buried boulder
    { geo: new THREE.ConeGeometry(0.62, 1.5, 5), cap: 260, anchor: 0.42, tone: 'ice', soft: true },  // scoured rock
  ];
  const N_KINDS = KINDS.length;

  const kinds = KINDS.map(k => {
    // `soft` = the snow set. Flat-shaded facets turned their shadow sides
    // near-black, and on a white cap that reads as pepper again — the very
    // thing the winter props exist to avoid. Smooth normals plus an emissive
    // floor stands in for the subsurface scattering that keeps real snow
    // bright on its shaded side, so the forms read by gradient alone.
    const mesh = new THREE.InstancedMesh(k.geo,
      // white base + per-instance colour, exactly like world.js's vegetation:
      // vertexColors:true would look for a geometry colour attribute these
      // primitives don't have, and instanceColor tints fine without it
      k.soft
        ? new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc9d8e6, emissiveIntensity: 0.5 })
        : new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), k.cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;  // instances move under us every frame
    mesh.castShadow = false;     // hundreds of tiny casters cost more than they add
    mesh.receiveShadow = true;
    mesh.count = 0;
    scene.add(mesh);
    const free = [];
    for (let i = k.cap - 1; i >= 0; i--) free.push(i);
    return { mesh, free, anchor: k.anchor, tone: k.tone };
  });

  const cells = new Map();   // key -> array of prop records
  const pending = [];
  const waiting = [];        // placed but not yet near enough to appear
  const growing = [];        // currently scaling up
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const eul = new THREE.Euler(), col = new THREE.Color();
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  const _gc = [0, 0, 0];
  const _w = new Float64Array(N_KINDS);

  // ground colour under a prop, straight from the terrain palette, so a stone
  // on red canyon rock is red and the same stone on a dune is sand-coloured.
  // Deferred until the prop actually appears — dormant props that get evicted
  // before their distance comes up never pay for it.
  function tintFor(p) {
    const gx = (heightAt(p.x + 4, p.z) - heightAt(p.x - 4, p.z)) / 8;
    const gz = (heightAt(p.x, p.z + 4) - heightAt(p.x, p.z - 4)) / 8;
    terrainColor(p.x, p.z, p.h, 1 / Math.sqrt(1 + gx * gx + gz * gz), _gc);
    const v = 0.76 + p.shade * 0.38;
    const tone = kinds[p.k].tone;
    if (tone === 'rock') {
      const lum = (_gc[0] + _gc[1] + _gc[2]) / 3;
      return [(_gc[0] * 0.55 + lum * 0.45) * v, (_gc[1] * 0.55 + lum * 0.45) * v, (_gc[2] * 0.55 + lum * 0.45) * v];
    }
    if (tone === 'dead') { // bleached driftwood/deadwood: warm, desaturated, pale
      const lum = (_gc[0] + _gc[1] + _gc[2]) / 3;
      return [(lum * 0.9 + 0.16) * v, (lum * 0.82 + 0.13) * v, (lum * 0.66 + 0.09) * v];
    }
    // snow sits ON the snow: barely darker than the ground, with a cool cast so
    // the form reads by shading alone. Any real contrast up here is pepper.
    if (tone === 'snow') {
      const w = 0.9 + p.shade * 0.12;
      return [_gc[0] * w, _gc[1] * w, _gc[2] * (w + 0.03)];
    }
    if (tone === 'ice') { // wind-scoured: a shade more blue and a touch darker
      const w = 0.8 + p.shade * 0.12;
      return [_gc[0] * w * 0.97, _gc[1] * w, _gc[2] * (w + 0.06)];
    }
    // greenery pulls toward foliage but keeps the ground's warmth; a few
    // bushes flower, which is most of what breaks up a green hillside
    const flower = p.shade > 0.88;
    const m = 0.56;
    const fr = flower ? 0.42 : 0.17, fg = flower ? 0.26 : 0.34, fb = flower ? 0.30 : 0.13;
    return [(_gc[0] * (1 - m) + fr * m) * v, (_gc[1] * (1 - m) + fg * m) * v, (_gc[2] * (1 - m) + fb * m) * v];
  }

  // write one instance at a given growth fraction (0..1); props rise out of the
  // ground as they grow instead of inflating in place
  function writeProp(p, e) {
    const kind = kinds[p.k];
    eul.set(p.tx, p.rot, p.tz);
    quat.setFromEuler(eul);
    const sy = p.sy * e;
    pos.set(p.x, p.h + sy * kind.anchor, p.z);
    scl.set(p.sx * e, sy, p.sz * e);
    kind.mesh.setMatrixAt(p.idx, mtx.compose(pos, quat, scl));
    kind.mesh.instanceMatrix.needsUpdate = true;
  }

  // build one cell: pick spots, reject water / runways / cliffs, weight the
  // prop types by biome so desert gets stones and grassland gets scrub
  function buildCell(ix, iz) {
    const key = ix + ':' + iz;
    if (cells.has(key)) return;
    const slots = [];
    for (let p = 0; p < PER_CELL; p++) {
      const x = (ix + rnd(ix, iz, p * 4 + 1)) * CELL;
      const z = (iz + rnd(ix, iz, p * 4 + 2)) * CELL;
      const h = heightAt(x, z);
      if (h < 1.2) continue;                       // sea and beach wash
      // the painted snowline (same jitter as colorcore) switches the whole
      // prop set over to the winter kinds rather than ending the scatter
      const snowline = 406 + (noise2(x * 0.006 + 3.7, z * 0.006) - 0.5) * 76;
      const snow = h > snowline;
      // high ground is wind-swept: thinner cover, and it stops the white caps
      // from looking as busy as the meadows
      if (snow && rnd(ix, iz, p * 4 + 9) > 0.55) continue;
      if (runwayInfluence(x, z) > 0.02) continue;  // keep strips and aprons clean
      const slope = Math.abs(heightAt(x + 6, z) - heightAt(x - 6, z))
                  + Math.abs(heightAt(x, z + 6) - heightAt(x, z - 6));
      if (slope > 9) continue;                     // cliffs
      biomeWeights(x, z);
      // stony: desert and high ground. green: everything else, fading out as
      // the ground dries or climbs. Weights, not a chain of ifs, so a spot can
      // be a bit of both and the mix shifts gradually across a biome edge.
      const stony = Math.min(1, HC._wD * 1.3 + Math.max(0, (h - 240) / 120));
      const green = Math.max(0, 1 - stony);
      const low = Math.max(0, 1 - h / 160); // logs and reeds are a lowland thing
      _w[0] = snow ? 0 : 0.85 + stony * 1.7;
      _w[1] = snow ? 0 : 0.55 + stony * 1.15;
      _w[2] = snow ? 0 : 0.22 + stony * 0.75;
      _w[3] = snow ? 0 : green * 1.6;
      _w[4] = snow ? 0 : green * 1.0;
      _w[5] = snow ? 0 : 0.2 + HC._wD * 0.55;
      _w[6] = snow ? 0 : green * 0.4 * low;
      // winter set — drifts dominate, boulders and scoured rock punctuate
      _w[7] = snow ? 1.7 : 0;
      _w[8] = snow ? 0.85 : 0;
      _w[9] = snow ? 0.5 : 0;
      let sum = 0;
      for (let i = 0; i < N_KINDS; i++) sum += _w[i];
      let pick = rnd(ix, iz, p * 4 + 3) * sum, ki = N_KINDS - 1;
      for (let i = 0; i < N_KINDS; i++) { pick -= _w[i]; if (pick <= 0) { ki = i; break; } }

      const t = rnd(ix, iz, p * 4 + 4);
      const a = rnd(x, z, 11), b = rnd(z, x, 12), c = rnd(x, h, 13);
      // drifts are big and low; everything else keeps its own size band
      const base = ki === 7 ? 1.5 + t * 2.6
        : ki === 8 ? 0.7 + t * 1.1
        : ki === 9 ? 0.5 + t * 0.8
        : 0.32 + t * (ki <= 2 ? 0.62 : ki === 3 ? 0.5 : ki === 4 ? 0.8 : ki === 5 ? 0.55 : 0.7);
      // per-axis scale: without this every stone is a radially symmetric lump.
      // Drifts stretch hard on one axis — wind builds them in long ridges.
      const sx = base * (ki === 7 ? 0.8 + a * 1.5 : 0.72 + a * 0.62);
      const sz = base * (ki === 7 ? 0.8 + b * 1.5 : 0.72 + b * 0.62);
      const sy = base * (ki === 3 ? 1.3 + c * 0.8 : ki === 5 ? 1.1 + c * 0.7
        : ki === 7 ? 0.16 + c * 0.14 : ki === 8 ? 0.4 + c * 0.3 : 0.7 + c * 0.6);
      const ad = (APPEAR_MIN + (1 - APPEAR_MIN) * rnd(ix, iz, p * 4 + 5)) * RADIUS;
      slots.push({
        k: ki, idx: -1, x, z, h, sx, sy, sz, rot: t * 6.283,
        // logs lie down, everything else only leans a little
        tx: ki === 6 ? rnd(x, z, 14) * 0.3 - 0.15 : rnd(x, z, 7) * 0.5 - 0.25,
        tz: rnd(z, x, 8) * 0.4 - 0.2,
        appearD2: ad * ad, shade: rnd(z, h, 15), grow: 0, alive: true,
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
            const rgb = tintFor(p);
            col.setRGB(rgb[0], rgb[1], rgb[2]);
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
    const per = [];
    for (let i = 0; i < kinds.length; i++) {
      const n = KINDS[i].cap - kinds[i].free.length;
      live += n; per.push(n);
    }
    return { cells: cells.size, props: live, per, waiting: waiting.length, growing: growing.length, queued: pending.length / 2 };
  }

  return { update, stats };
}
