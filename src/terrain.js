import * as THREE from 'three';
import { heightAt, getTerrainSeed } from './heightcore.js';
import { terrainColor } from './colorcore.js';
import { bakeTile, buildTileIndex, tileVertexCount } from './tilebake.js';

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

// bias/skirt sizing: a ring's linear interpolation can miss the true surface
// by ~spacing * slope. v7 mountains reach ~60% grades, so LOD1 (15 m spacing)
// needs ~3 m of sink and LOD2 (40 m) ~8 m, or the coarser mesh pokes through
// the finer one on steep faces and reads as a second, serrated terrain layer.
// Sinks are render-only (physics is analytic) and sub-pixel at ring distance.
const RINGS = [
  { lod: 0, tile: 480,  res: 96, radius: 1100, skirt: 6,  bias: 0 },
  { lod: 1, tile: 960,  res: 64, radius: 3000, skirt: 14, bias: -3 },
  { lod: 2, tile: 1920, res: 48, radius: 5200, skirt: 30, bias: -8 },
];
const EVICT_PAD = 300;        // hysteresis: build at radius, evict at radius+300
const SHELL_Y = -10;
const SHELL_SEGS = 250;
const TELEPORT_D2 = 1500 * 1500; // jump larger than this = teleport, not flight
const LOOKAHEAD_FRAMES = 90;  // priority aim point ~1.5 s ahead at 60 Hz
const MAX_IN_FLIGHT = 2;

// full-island PlaneGeometry bake — the original static build, parameterized by
// segment count so the dynamic far shell (250) and the A/B static path (500)
// share one code path. Colors use the mesh's smooth vertex normals, exactly
// like the original loop.
function bakeIslandGeometry(segments) {
  const geo = new THREE.PlaneGeometry(15600, 15600, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const tPos = geo.attributes.position;
  for (let i = 0; i < tPos.count; i++) tPos.setY(i, heightAt(tPos.getX(i), tPos.getZ(i)));
  geo.computeVertexNormals();
  const tNorm = geo.attributes.normal;
  const tCol = new Float32Array(tPos.count * 3);
  const _col = [0, 0, 0];
  for (let i = 0; i < tPos.count; i++) {
    terrainColor(tPos.getX(i), tPos.getZ(i), tPos.getY(i), tNorm.getY(i), _col);
    tCol[i * 3] = _col[0]; tCol[i * 3 + 1] = _col[1]; tCol[i * 3 + 2] = _col[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  return geo;
}

export function createTerrain(scene) {
  if (new URLSearchParams(location.search).get('terrain') === 'static') {
    // A/B fallback: today's static path, bit for bit
    const terrain = new THREE.Mesh(bakeIslandGeometry(500),
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    terrain.receiveShadow = true;
    scene.add(terrain);
    return {
      update() {},
      stats() { return { mode: 'static', tiles: 0, queued: 0, inFlight: 0, tris: 500000, built: 0, evicted: 0 }; },
      debugKeys() { return []; },
    };
  }

  // ---- dynamic mode ----
  // ONE material shared by the shell and every tile (never disposed on evict)
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  // LOD sink is applied PER VERTEX, faded out below 12 m: sinking a whole
  // mesh moved its WATERLINE sideways by tens of meters (beach slopes are
  // ~1:20), so ring boundaries stepped along the coast. Poke-through only
  // happens on steep ground, which is always well above 12 m — the beach
  // keeps its exact shoreline at every LOD.
  function sinkAboveShore(positions, bias) {
    for (let i = 1; i < positions.length; i += 3) {
      const y = positions[i];
      const t = y <= 2 ? 0 : y >= 12 ? 1 : (y - 2) / 10;
      positions[i] = y + bias * t * t * (3 - 2 * t);
    }
  }

  // (a) far shell — synchronous, coarse, sunk below every tile bias
  const shellGeo = bakeIslandGeometry(SHELL_SEGS);
  sinkAboveShore(shellGeo.attributes.position.array, SHELL_Y);
  const shell = new THREE.Mesh(shellGeo, material);
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
      finished.push({ job, positions: e.data.positions, colors: e.data.colors });
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

  function addTile(key, ring, ix, iz, positions, colors) {
    if (ring.bias !== 0) sinkAboveShore(positions, ring.bias);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(tileIndex(ring.res), 1));
    const cx = (ix + 0.5) * ring.tile, cz = (iz + 0.5) * ring.tile;
    // analytic bounding sphere: tile bounds + center height +-400 m guess —
    // cheap, safe (island peaks ~650, features never move 400 m off their
    // center's height inside one tile) and skips a full computeBoundingSphere
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, heightAt(cx, cz), cz),
      Math.hypot(ring.tile * Math.SQRT2 / 2, 400 + ring.skirt));
    const mesh = new THREE.Mesh(geo, material);
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
    const positions = new Float32Array(n), colors = new Float32Array(n);
    bakeTile(ix * ring.tile, iz * ring.tile, ring.tile, ring.res, ring.skirt, positions, colors);
    addTile(key, ring, ix, iz, positions, colors);
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
      const { job, positions, colors } = finished.shift();
      finishedKeys.delete(job.key);
      if (tiles.has(job.key)) continue; // teleport guard built it sync meanwhile
      const dx = job.cx - px, dz = job.cz - pz;
      const rr = job.ring.radius + EVICT_PAD;
      if (dx * dx + dz * dz > rr * rr) continue; // flown away — drop, don't upload
      addTile(job.key, job.ring, job.ix, job.iz, positions, colors);
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
        size: best.ring.tile, res: best.ring.res, skirt: best.ring.skirt,
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
