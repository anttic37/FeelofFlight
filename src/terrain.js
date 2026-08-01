import * as THREE from 'three';
import { heightAt, getTerrainSeed } from './heightcore.js';
import { terrainColor } from './colorcore.js';
import { bakeTile, buildTileIndex, tileVertexCount, bakeAOGrid, sampleAOGrid, applyAO } from './tilebake.js';
import { injectGroundFX } from './groundfx.js';

// The terrain engine. Two modes, selected by URL param:
//   ?terrain=static — EXACTLY the pre-dynamic path: one PlaneGeometry
//     15600^2 @ 500x500 baked synchronously. Pixel-identical A/B fallback.
//   default (dynamic) — hybrid shell + ring-LOD streamed tiles:
//     (a) a coarse full-island shell (251x251) baked synchronously at startup
//         and sunk 2.5 m, so there is NEVER a hole anywhere — fine tiles just
//         draw on top and win the z-buffer; the shell alone is only visible
//         beyond the outer tile ring where fog is >70%;
//     (b) world-aligned square tiles in three rings around the plane (5 m
//         triangles near, coarser out to 5.2 km), baked in a module worker
//         from the same analytic heightAt/terrainColor as everything else.
//         Each ring's meshes sink by a small y bias (0 / -0.9 / -1.8, shell
//         -2.5) so a coarser surface can never poke through a finer one, and
//         skirts on every tile hide the sub-pixel cracks at LOD handoffs.
// Physics/camera/HUD never touch any of this — they stay on analytic
// heightAt/surfaceAt, so collision cannot pop or wait on streaming.

// Anti-overlap between rings is CONSTRUCTIVE, not tuned: coarser rings bake a
// conservative lower envelope (minS = half-spacing min-taps in bakeTile) so
// they cannot rise above what finer rings show; a small shore-faded bias
// covers the residual concave overshoot between samples; per-ring
// polygonOffset settles any remaining same-pixel depth ties in favor of the
// finer ring. Sinks are render-only (physics is analytic).
const RINGS = [
  { lod: 0, tile: 480,  res: 96, radius: 1100, skirt: 5,  bias: 0,    minS: 0 },
  { lod: 1, tile: 960,  res: 64, radius: 3000, skirt: 8,  bias: -0.5, minS: 7.5 },
  { lod: 2, tile: 1920, res: 48, radius: 5200, skirt: 16, bias: -1,   minS: 20 },
];
const EVICT_PAD = 300;        // hysteresis: build at radius, evict at radius+300
const SHELL_Y = -4;
const SHELL_MINS = 31;        // shell min-tap span: half of its 62 m spacing
const SHELL_SEGS = 250;
const TELEPORT_D2 = 1500 * 1500; // jump larger than this = teleport, not flight
const LOOKAHEAD_FRAMES = 90;  // priority aim point ~1.5 s ahead at 60 Hz
const MAX_IN_FLIGHT = 2;

// full-island PlaneGeometry bake — the original static build, parameterized by
// segment count so the dynamic far shell (250) and the A/B static path (500)
// share one code path. Colors use the mesh's smooth vertex normals, exactly
// like the original loop.
function bakeIslandGeometry(segments, minSpan) {
  const geo = new THREE.PlaneGeometry(15600, 15600, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const tPos = geo.attributes.position;
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i);
    const h = heightAt(x, z);
    let hy = h;
    if (minSpan && h > 2) { // shore-faded + slope-gated envelope, same rule as bakeTile
      let mn = h;
      const h1 = heightAt(x + minSpan, z), h2 = heightAt(x - minSpan, z);
      const h3 = heightAt(x, z + minSpan), h4 = heightAt(x, z - minSpan);
      if (h1 < mn) mn = h1; if (h2 < mn) mn = h2;
      if (h3 < mn) mn = h3; if (h4 < mn) mn = h4;
      const grad = Math.hypot(h1 - h2, h3 - h4) / (2 * minSpan);
      const hf = h >= 10 ? 1 : h <= 6 ? 0 : (h - 6) / 4;
      const thLo = 0.30 - 0.23 * hf * hf * (3 - 2 * hf);
      const sRaw = (grad - thLo) / 0.15;
      const sw = sRaw <= 0 ? 0 : sRaw >= 1 ? 1 : sRaw * sRaw * (3 - 2 * sRaw);
      const t = h >= 12 ? 1 : (h - 2) / 10;
      hy = h + (mn - h) * t * t * (3 - 2 * t) * sw;
    }
    tPos.setY(i, hy);
  }
  geo.computeVertexNormals();
  const tNorm = geo.attributes.normal;
  const tCol = new Float32Array(tPos.count * 3);
  const _col = [0, 0, 0];
  // one AO lattice for the whole 15.6 km shell — per-vertex horizon sampling over 63k
  // vertices would cost seconds of startup for a field that varies over tens of metres
  bakeAOGrid(-7800, -7800, 15600, 64);
  for (let i = 0; i < tPos.count; i++) {
    const _ax = tPos.getX(i), _az = tPos.getZ(i), _ah = tPos.getY(i);
    terrainColor(_ax, _az, _ah, tNorm.getY(i), _col);
    if (_ah > 0.5) applyAO(_col, sampleAOGrid((_ax + 7800) / 15600, (_az + 7800) / 15600, 64), 0.62);
    tCol[i * 3] = _col[0]; tCol[i * 3 + 1] = _col[1]; tCol[i * 3 + 2] = _col[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  return geo;
}

// SMOOTH-SHADED GROUND. The terrain used to be flatShading, which throws away
// the analytic normals bakeTile computes and lights each triangle by its face
// normal instead. On a regular LOD grid that turns the mesh into a regular
// diagonal lattice of facets — and that lattice, not the detail texture, was
// what kept reading as "the ground repeats". It is most obvious on open slopes,
// where there is nothing else to look at, and the splat layer was only ever
// masking it. The normals are already there and already continuous across tile
// seams (they come from heightAt, not from the mesh), so using them costs
// nothing. ?facets=1 restores the old faceted look.
const FLAT_SHADE = new URLSearchParams(
  typeof location === 'undefined' ? '' : location.search).get('facets') === '1';

export function createTerrain(scene) {
  if (new URLSearchParams(location.search).get('terrain') === 'static') {
    // A/B fallback: today's static path, bit for bit (geometry — the ground
    // detail shader layer applies here too so both modes look the same)
    const staticMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: FLAT_SHADE, roughness: 1 });
    injectGroundFX(staticMat);
    const terrain = new THREE.Mesh(bakeIslandGeometry(500), staticMat);
    terrain.receiveShadow = true;
    scene.add(terrain);
    return {
      update() {},
      stats() { return { mode: 'static', tiles: 0, queued: 0, inFlight: 0, tris: 500000, built: 0, evicted: 0 }; },
      debugKeys() { return []; },
    };
  }

  // ---- dynamic mode ----
  // one material PER RING (never disposed on evict): identical looks, but
  // coarser rings carry growing polygonOffset so any same-pixel depth tie
  // resolves toward the finer ring — the depth-buffer half of anti-overlap
  function ringMaterial(po) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: FLAT_SHADE, roughness: 1,
      polygonOffset: po > 0, polygonOffsetFactor: po, polygonOffsetUnits: po,
    });
    injectGroundFX(mat);
    return mat;
  }
  const materials = [ringMaterial(0), ringMaterial(1), ringMaterial(2)];
  const shellMaterial = ringMaterial(3);

  // LOD sink is applied PER VERTEX, faded out below 12 m: sinking a whole
  // mesh moved its WATERLINE sideways by tens of meters (beach slopes are
  // ~1:20), so ring boundaries stepped along the coast. Poke-through only
  // happens on steep ground, which is always well above 12 m — the beach
  // keeps its exact shoreline at every LOD.
  // THE SHORE BAND GETS A SMALL SINK, NOT NONE.
  //
  // This used to fade the LOD bias to exactly zero below 2 m and only reach full at 12 m,
  // and bakeIslandGeometry's min-tap envelope is shore-faded the same way. Both fades
  // exist to stop the coarse surface dragging the coastline around, and both leave the
  // 0-12 m band — which is precisely the beach — with NO separation at all. There the
  // 62 m shell competes with fine tiles on equal terms, their coastlines disagree by up
  // to half a shell cell, and you fly along the water looking at two overlapping
  // shorelines.
  //
  // SHORE_FRAC keeps a fraction of the bias down there. It has to be small: this sinks
  // LAND, so the waterline creeps inland by the sink divided by the beach slope. At 0.35
  // of a -4 m shell bias that is ~1.4 m, tens of metres of coastline on a shallow beach —
  // invisible at the ranges where the shell is the only thing drawn, and the near view is
  // the fine tiles' anyway, which is the whole point.
  const SHORE_FRAC = 0.35;
  function sinkAboveShore(positions, bias) {
    for (let i = 1; i < positions.length; i += 3) {
      const y = positions[i];
      if (y <= -1) continue;              // already underwater: nothing to separate
      const t = y <= 2 ? 0 : y >= 12 ? 1 : (y - 2) / 10;
      const s = t * t * (3 - 2 * t);
      positions[i] = y + bias * (SHORE_FRAC + (1 - SHORE_FRAC) * s);
    }
  }

  // (a) far shell — synchronous, envelope-baked, small shore-faded sink
  const shellGeo = bakeIslandGeometry(SHELL_SEGS, SHELL_MINS);
  sinkAboveShore(shellGeo.attributes.position.array, SHELL_Y);
  const shell = new THREE.Mesh(shellGeo, shellMaterial);
  shell.receiveShadow = true;
  scene.add(shell);

  // (b) ring-LOD tiles
  const indexCache = new Map(); // res -> shared index array (one per res, ever)
  function tileIndex(res) {
    let a = indexCache.get(res);
    if (!a) { a = buildTileIndex(res); indexCache.set(res, a); }
    return a;
  }

  const tiles = new Map();    // key -> { mesh, ring, cx, cz }
  const pending = new Map();  // key -> job awaiting a worker slot
  const inFlight = new Map(); // job id -> job (max MAX_IN_FLIGHT)
  const finished = [];        // worker results awaiting apply (<=1 applied/update)
  const finishedKeys = new Set(); // keys parked in finished[] — the want-scan must
                                  // see them or every streamed tile gets baked twice
  let nextId = 1, built = 0, evicted = 0, trisLive = 0, dispatched = 0;

  const worker = new Worker(new URL('./terrainworker.js', import.meta.url), { type: 'module' });
  // the worker has its OWN heightcore instance — seed it before any bake job
  worker.postMessage({ type: 'seed', seed: getTerrainSeed() });
  worker.onmessage = (e) => {
    const job = inFlight.get(e.data.id);
    inFlight.delete(e.data.id);
    if (job) {
      finished.push({ job, positions: e.data.positions, colors: e.data.colors, normals: e.data.normals });
      finishedKeys.add(job.key);
    }
  };
  // a dead worker (404 after a server restart, module error, uncaught throw)
  // must not pin the in-flight slots forever and silently stall all streaming:
  // log once, requeue the lost jobs, and fall back to main-thread baking
  let workerDead = false;
  worker.onerror = worker.onmessageerror = (e) => {
    if (!workerDead) console.error('terrain worker failed — falling back to main-thread tile baking', e && (e.message || e.type));
    workerDead = true;
    for (const job of inFlight.values()) if (!pending.has(job.key) && !tiles.has(job.key)) pending.set(job.key, job);
    inFlight.clear();
  };

  function tileKey(lod, ix, iz) { return lod + ':' + ix + ':' + iz; }

  function addTile(key, ring, ix, iz, positions, colors, normals) {
    if (ring.bias !== 0) sinkAboveShore(positions, ring.bias);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(tileIndex(ring.res), 1));
    // shadow RECEIVING needs a normal attribute (shadowmap_vertex reads it);
    // flatShading ignores it for lighting, so the faceted look is unchanged.
    // Without this the plane's shadow silently vanishes on streamed tiles.
    // Normals come analytically from bakeTile (free there, seam-consistent);
    // the compute fallback covers a stale worker that omits them.
    if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    else geo.computeVertexNormals();
    const cx = (ix + 0.5) * ring.tile, cz = (iz + 0.5) * ring.tile;
    // analytic bounding sphere: tile bounds + center height +-400 m guess —
    // cheap, safe (island peaks ~650, features never move 400 m off their
    // center's height inside one tile) and skips a full computeBoundingSphere
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, heightAt(cx, cz), cz),
      Math.hypot(ring.tile * Math.SQRT2 / 2, 400 + ring.skirt));
    const mesh = new THREE.Mesh(geo, materials[ring.lod]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    scene.add(mesh);
    tiles.set(key, { mesh, ring, cx, cz });
    pending.delete(key); // a re-queued entry for a now-built tile is moot
    built++;
    trisLive += geo.index.count / 3;
  }

  function buildTileSync(ring, ix, iz) {
    const key = tileKey(ring.lod, ix, iz);
    if (tiles.has(key)) return;
    const n = tileVertexCount(ring.res) * 3;
    const positions = new Float32Array(n), colors = new Float32Array(n), normals = new Float32Array(n);
    bakeTile(ix * ring.tile, iz * ring.tile, ring.tile, ring.res, ring.skirt, positions, colors, ring.minS, normals);
    addTile(key, ring, ix, iz, positions, colors, normals);
    pending.delete(key); // if it was queued, the queue entry is now moot
  }

  // enumerate world-aligned tiles of one ring whose CENTER is within ring.radius
  function forEachRingTile(ring, px, pz, cb) {
    const r = ring.radius, t = ring.tile;
    const ix0 = Math.floor((px - r) / t), ix1 = Math.floor((px + r) / t);
    const iz0 = Math.floor((pz - r) / t), iz1 = Math.floor((pz + r) / t);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = (ix + 0.5) * t, cz = (iz + 0.5) * t;
        const dx = cx - px, dz = cz - pz;
        if (dx * dx + dz * dz <= r * r) cb(ring, ix, iz, cx, cz);
      }
    }
  }

  // a coarse tile is skipped ONLY if its entire square lies inside the finer
  // ring's guaranteed disk minus one fine-tile margin — deliberately
  // conservative: overlap is invisible (y biases + skirts), holes are the bug
  function coveredByFiner(finer, px, pz, ix, iz, t) {
    const guard = finer.radius - finer.tile;
    if (guard <= 0) return false;
    const g2 = guard * guard;
    for (let cz = 0; cz <= 1; cz++) {
      for (let cx = 0; cx <= 1; cx++) {
        const dx = (ix + cx) * t - px, dz = (iz + cz) * t - pz;
        if (dx * dx + dz * dz > g2) return false;
      }
    }
    return true;
  }

  function keyInFlight(key) {
    for (const j of inFlight.values()) if (j.key === key) return true;
    return false;
  }

  const _want = new Set();
  let lastX = NaN, lastZ = NaN, lookX = 0, lookZ = 0;
  let firstCall = true;

  function update(planePos) {
    const px = planePos.x, pz = planePos.z;

    if (firstCall) {
      // startup: the full LOD0 ring under the spawn bakes synchronously on the
      // main thread (same bakeTile the worker runs), so the ground under the
      // plane is high-res from the very first rendered frame
      firstCall = false;
      forEachRingTile(RINGS[0], px, pz, (ring, ix, iz) => buildTileSync(ring, ix, iz));
      lookX = px; lookZ = pz;
    } else {
      const jx = px - lastX, jz = pz - lastZ;
      if (jx * jx + jz * jz > TELEPORT_D2) {
        // teleport guard (T-spawn/reset): the plane must never sit on coarse
        // ground — bake its own LOD0 tile right now, stream the rest
        buildTileSync(RINGS[0], Math.floor(px / RINGS[0].tile), Math.floor(pz / RINGS[0].tile));
        lookX = px; lookZ = pz;
      } else {
        lookX = px + jx * LOOKAHEAD_FRAMES; // aim the build queue ~1.5 s ahead
        lookZ = pz + jz * LOOKAHEAD_FRAMES;
      }
    }
    lastX = px; lastZ = pz;

    // desired set: queue misses, drop stale queue entries
    _want.clear();
    for (let li = 0; li < RINGS.length; li++) {
      const finer = li > 0 ? RINGS[li - 1] : null;
      forEachRingTile(RINGS[li], px, pz, (ring, ix, iz, cx, cz) => {
        if (finer && coveredByFiner(finer, px, pz, ix, iz, ring.tile)) return;
        const key = tileKey(ring.lod, ix, iz);
        _want.add(key);
        if (!tiles.has(key) && !pending.has(key) && !keyInFlight(key) && !finishedKeys.has(key)) {
          pending.set(key, { key, ring, ix, iz, cx, cz });
        }
      });
    }
    for (const key of pending.keys()) if (!_want.has(key)) pending.delete(key);

    // evict with hysteresis; dispose geometry, never the shared material
    for (const [key, t] of tiles) {
      const dx = t.cx - px, dz = t.cz - pz;
      const rr = t.ring.radius + EVICT_PAD;
      if (dx * dx + dz * dz > rr * rr) {
        scene.remove(t.mesh);
        trisLive -= t.mesh.geometry.index.count / 3;
        t.mesh.geometry.dispose();
        tiles.delete(key);
        evicted++;
      }
    }

    // apply at most ONE finished bake per update — keeps the per-frame cost of
    // geometry creation + GPU upload bounded (the hitch budget)
    while (finished.length) {
      const { job, positions, colors, normals } = finished.shift();
      finishedKeys.delete(job.key);
      if (tiles.has(job.key)) continue; // teleport guard built it sync meanwhile
      const dx = job.cx - px, dz = job.cz - pz;
      const rr = job.ring.radius + EVICT_PAD;
      if (dx * dx + dz * dz > rr * rr) continue; // flown away — drop, don't upload
      addTile(job.key, job.ring, job.ix, job.iz, positions, colors, normals);
      break;
    }

    // dispatch: LOD ascending, then distance to the look-ahead point
    while (!workerDead && inFlight.size < MAX_IN_FLIGHT && pending.size) {
      let best = null, bestScore = Infinity;
      for (const job of pending.values()) {
        const dx = job.cx - lookX, dz = job.cz - lookZ;
        const score = job.ring.lod * 1e9 + dx * dx + dz * dz;
        if (score < bestScore) { bestScore = score; best = job; }
      }
      pending.delete(best.key);
      if (tiles.has(best.key)) continue; // already built — never re-dispatch
      const id = nextId++;
      inFlight.set(id, best);
      dispatched++;
      worker.postMessage({
        id, x0: best.ix * best.ring.tile, z0: best.iz * best.ring.tile,
        size: best.ring.tile, res: best.ring.res, skirt: best.ring.skirt, minSpan: best.ring.minS,
      });
    }
    // dead-worker fallback: keep the world streaming from the main thread,
    // one tile per update to respect the hitch budget
    if (workerDead && pending.size) {
      let best = null, bestScore = Infinity;
      for (const job of pending.values()) {
        const dx = job.cx - lookX, dz = job.cz - lookZ;
        const score = job.ring.lod * 1e9 + dx * dx + dz * dz;
        if (score < bestScore) { bestScore = score; best = job; }
      }
      pending.delete(best.key);
      buildTileSync(best.ring, best.ix, best.iz);
    }
  }

  function stats() {
    return {
      mode: 'dynamic', tiles: tiles.size, queued: pending.size,
      inFlight: inFlight.size, tris: trisLive, built, evicted, dispatched,
      workerDead, shellTris: SHELL_SEGS * SHELL_SEGS * 2,
    };
  }

  return { update, stats, debugKeys: () => [...tiles.keys()] };
}
