import * as THREE from 'three';
import { heightAt, getTerrainSeed } from './heightcore.js';
import { terrainColor } from './colorcore.js';
import { bakeTile, buildTileIndex, tileVertexCount, bakeAOGrid, sampleAOGrid, applyAO } from './tilebake.js';
import { injectGroundFX } from './groundfx.js';

// The terrain engine. Two modes, selected by URL param:
//   ?terrain=static — EXACTLY the pre-dynamic path: one PlaneGeometry
//     15600^2 @ 500x500 baked synchronously. Pixel-identical A/B fallback.
//   default (dynamic) — hybrid shell + ring-LOD streamed tiles:
//     (a) a coarse full-island shell (251x251) baked synchronously at startup,
//         so there is NEVER a hole anywhere — fine tiles just draw on top and
//         win the z-buffer; the shell alone is only visible beyond the outer
//         tile ring where fog is >70%;
//     (b) world-aligned square tiles in three rings around the plane (5 m
//         triangles near, coarser out to 5.2 km), baked in a module worker
//         from the same analytic heightAt/terrainColor as everything else.
//         Skirts on every tile hide the sub-pixel cracks at LOD handoffs.
// Physics/camera/HUD never touch any of this — they stay on analytic
// heightAt/surfaceAt, so collision cannot pop or wait on streaming.

// ANTI-OVERLAP IS ONE MECHANISM: A COARSE LAYER IS NOT DRAWN WHERE A FINER ONE COVERS IT.
// See uHoleR below — a fragment discard whose radius is measured from real tile coverage.
// Nothing overlaps, so nothing has to be pushed out of anything's way, and every layer can
// render heightAt exactly.
//
// It replaces five mechanisms that were all trying to keep apart surfaces that should not
// have been in the same place: a min-tap envelope, a per-ring y-sink, a slope gate, a shore
// fade and a height gate. Every one of them was switched off near the waterline — which is
// precisely why the coarse shell sat up to 2.8 m above the sea bed there and showed through
// the water as flat sheets. Physics is analytic and never saw any of it.
//
// Per-ring polygonOffset stays for what it is actually good at: same-pixel depth ties in the
// HOLE_MARGIN band where a coarse layer still overlaps. It moves no geometry.
// EVERY layer renders the terrain exactly — no envelope, no bias, no min-span.
const RINGS = [
  { lod: 0, tile: 480,  res: 96, radius: 1100, skirt: 5  },
  { lod: 1, tile: 960,  res: 64, radius: 3000, skirt: 8  },
  { lod: 2, tile: 1920, res: 48, radius: 5200, skirt: 16 },
];
const EVICT_PAD = 300;        // hysteresis: build at radius, evict at radius+300
const SHELL_SEGS = 250;
// NO LAYER TAKES AN ENVELOPE — every one renders the terrain exactly. An envelope wide enough
// to GUARANTEE a coarse layer never rises above a finer one has to lower it by roughly its own
// cell size, and that is ruinous: measured, it costs the shell 54 m of mean height on high
// ground and drops the island's peak from 748 m to 576 m, and costs ring2 37 m. Guaranteed
// non-overshoot and an honest silhouette are in direct conflict — but only while two layers
// are drawing the same ground. Stop doing that and both come free.
const HOLE_MARGIN = 120;   // keep the coarse layer across this much of the covered zone's edge
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
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i);
    tPos.setY(i, heightAt(x, z));
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

  // EACH COARSE LAYER IS CUT AWAY WHERE THE FINER ONES HAVE IT COVERED.
  //
  // This beats every envelope because it removes the overlap instead of hiding it: inside the
  // hole the layer contributes no fragments at all, so it cannot show through the sea at the
  // coast, and outside it that layer is the only thing drawn so it renders terrain exactly.
  //
  // The radius is measured, not assumed: it is the distance to the nearest tile that is
  // WANTED BUT NOT YET BUILT, so the hole only ever opens over ground that is genuinely
  // covered. At startup and after a teleport that distance is small, the hole shuts, and the
  // shell fills everything exactly as before — the no-holes-ever guarantee is unchanged.
  // ?terrainhole=0 turns the cutting off and puts every layer back to drawing everywhere.
  // It is here because the cut is the one change that could produce a HOLE rather than an
  // overlap, and a hole is far worse than the artifact it fixes: one reload tells you which
  // of the two you are looking at without needing a build.
  // EVERY LAYER GETS AN INNER *AND* AN OUTER EDGE, so each one owns an annulus and no two of
  // them are ever drawn on the same ground. Cutting only the inner edge was not enough and the
  // reason is worth keeping: ring1's hole was 641 m, but ring0's TILES run out to ~1400 m,
  // because a ring's coverage is a union of squares and the hole is a circle inside it. So
  // from 641 m out to wherever ring0's tiles happened to end, both layers drew the identical
  // surface — measured 0.014, 0.005, 0.007 and 0.000 m apart. That is z-fighting by
  // construction, and it is what the flicker was.
  //
  // polygonOffset cannot fix it either, which is why it is not the answer here: the two
  // surfaces do not merely coincide, they CROSS. ring1's 15 m chords cut through ring0's 5 m
  // ones over a ridge, so ring1 is genuinely above by more than any constant bias.
  //
  // The boundaries share a single number — layer N's outer radius IS layer N+1's inner radius
  // — so the tests are complementary (< R against >= R) and can leave neither an overlap nor a
  // seam. It is also less overdraw than before: each layer rasterises a band, not a disc.
  const HOLE_ON = new URLSearchParams(location.search).get('terrainhole') !== '0';
  const holeC = new THREE.Vector2(0, 0);
  function cutHole(mat) {
    if (!HOLE_ON) return;
    const inner = mat.onBeforeCompile;   // groundfx got here first; chain, do not replace
    mat.onBeforeCompile = (shader, renderer) => {
      if (inner) inner(shader, renderer);
      shader.uniforms.uHoleC = { value: holeC };
      shader.uniforms.uHoleR = { value: 0 };   // inner edge: nearer than this, someone finer draws
      shader.uniforms.uOuterR = { value: 0 };  // outer edge: 0 means "to the horizon" (the shell)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform vec2 uHoleC;\nuniform float uHoleR;\nuniform float uOuterR;')
        // vGWPos is groundfx's world-position varying; discard before anything is computed
        .replace('#include <clipping_planes_fragment>',
          'float _hd = distance(vGWPos.xz, uHoleC);\n'
          + 'if (_hd < uHoleR) discard;\n'
          + 'if (uOuterR > 0.0 && _hd >= uOuterR) discard;\n'
          + '#include <clipping_planes_fragment>');
      mat.userData.shader = shader;
    };
  }
  // ring0 is cut too now — not on the inside, where it is always the truth, but on the OUTSIDE,
  // where its tiles run past the radius ring1 has taken over.
  cutHole(materials[0]); cutHole(materials[1]); cutHole(materials[2]); cutHole(shellMaterial);

  // There is no y-sink any more. It was a second mechanism doing the envelope's job less
  // well: it moved LAND down, so it dragged every coarse coastline inland by the sink over
  // the beach slope, which forced it to be faded out near the shore, which is what left the
  // shore unprotected. The envelope moves a vertex down only as far as the terrain it spans
  // actually goes, so it cannot invent a coastline, and it needs no fade.

  // (a) far shell — synchronous, envelope-baked
  const shellGeo = bakeIslandGeometry(SHELL_SEGS);
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
    bakeTile(ix * ring.tile, iz * ring.tile, ring.tile, ring.res, ring.skirt, positions, colors, normals);
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
  const _gap = new Float64Array(RINGS.length);   // nearest wanted-but-unbuilt tile, per ring
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

    // desired set: queue misses, drop stale queue entries. nearestGap tracks the closest
    // ground we WANT a tile on but do not have — the shell must keep covering from there out.
    _want.clear();
    for (let li = 0; li < RINGS.length; li++) _gap[li] = Infinity;
    for (let li = 0; li < RINGS.length; li++) {
      const finer = li > 0 ? RINGS[li - 1] : null;
      forEachRingTile(RINGS[li], px, pz, (ring, ix, iz, cx, cz) => {
        if (finer && coveredByFiner(finer, px, pz, ix, iz, ring.tile)) return;
        const key = tileKey(ring.lod, ix, iz);
        _want.add(key);
        if (!tiles.has(key)) {
          // distance from the plane to the nearest point of this missing tile
          const t = ring.tile;
          const dx = Math.max(ix * t - px, 0, px - (ix + 1) * t);
          const dz = Math.max(iz * t - pz, 0, pz - (iz + 1) * t);
          const d = Math.hypot(dx, dz);
          if (d < _gap[li]) _gap[li] = d;
          if (!pending.has(key) && !keyInFlight(key) && !finishedKeys.has(key)) {
            pending.set(key, { key, ring, ix, iz, cx, cz });
          }
        }
      });
    }
    for (const key of pending.keys()) if (!_want.has(key)) pending.delete(key);

    // EACH LAYER STOPS WHERE THE FINER ONES HAVE IT COVERED. `covered` accumulates the radius
    // inside which every layer finer than this one is complete — the smaller of that layer's
    // own reach and the distance to its nearest tile that is wanted but not yet built. So the
    // hole only ever opens over ground something finer is genuinely drawing, and at startup or
    // after a teleport it shuts to zero and the coarse layers cover everything, exactly as
    // they always did. That is the no-holes-ever guarantee, kept without a single bias.
    holeC.set(px, pz);
    let minGap = Infinity;   // nearest hole in ANY finer ring, whichever ring it is in
    let bound = 0;           // running band boundary; monotonic outward, see below
    for (let li = 0; li < RINGS.length; li++) {
      if (_gap[li] < minGap) minGap = _gap[li];
      // Coverage by the finer layers is their UNION, so the reach that counts is the
      // OUTERMOST finer ring's — RINGS[li].radius — not the smallest of them. Taking the
      // smallest pinned every layer to ring0's 1100 m and left ring2 and the shell drawing
      // over ring1 all the way out to 3 km, which is the overlap this is here to remove.
      // ring.radius admits a tile by its CENTRE (forEachRingTile, above), so the disc that
      // ring actually TILES is radius minus half a tile diagonal — a point sits up to
      // tile*SQRT2/2 from its own tile's centre, and if that centre fell outside radius the
      // tile was never wanted, never queued, never built, and _gap never saw it (_gap is
      // written only inside the forEachRingTile callback, so it can only measure WANTED
      // tiles). Passing ring.radius here treated an inclusion radius as a coverage guarantee
      // and cut the coarse layers over an annulus the finer rings never tile: 339 / 679 /
      // 1358 m wide at the worst bearing, all far beyond HOLE_MARGIN=120, so nothing at all
      // was drawn there and the sea/haze showed through as huge saturated patches — the
      // holes reported after the shoreline/LOD rewrite. Before that rewrite the shell drew
      // everywhere, so the centre-based want scan was never asked to be a coverage
      // guarantee; making it one is what exposed the error.
      // coveredByFiner() already does exactly this correction on the same quantity
      // (guard = finer.radius - finer.tile) before treating a centre radius as coverage;
      // this line was the one place that subtracted nothing.
      // Steady-state hole radii go 980 / 2880 / 5080 -> 640.59 / 2201.18 / 3722.35, i.e. the
      // genuinely-tiled discs minus HOLE_MARGIN. The overlap this restores is confined to
      // the outer bands (ring2 + shell beyond 3722 m) where fog is already >45%.
      const covered = Math.min(RINGS[li].radius - RINGS[li].tile * Math.SQRT1_2, minGap);
      // THE BOUNDARY CAN ONLY EVER MOVE OUTWARD, and forgetting that is what made the whole
      // terrain flicker while flying forward. `covered` is min(this ring's reach, nearest
      // missing tile): the reach grows with each ring but the gap SHRINKS, so the sequence is
      // not monotonic. One missing ring1 tile at 500 m while ring0 is complete to 761 gave
      // ring1 the band [761, 500] — inverted, drawing nothing — and handed ring2 an inner edge
      // of 500, so ring0 and ring2 both drew across 500-761 m. Two layers on the same ground
      // again, and the band walks with the aeroplane, which is why it flickered rather than
      // sitting still.
      //
      // Clamping the running boundary outward is not a fudge, it is the correct statement of
      // what is covered: coverage is the UNION of the finer layers, so ground already claimed
      // by ring0 stays claimed even when ring1 has a hole in it. A ring whose gap falls behind
      // the boundary simply gets an empty band and contributes nothing, and the next layer out
      // picks up from the boundary — in the worst case that is the shell, which is always
      // there. No overlap, and still no hole.
      bound = Math.max(bound, Math.max(0, covered - HOLE_MARGIN));
      // The SAME number is this layer's outer edge and the next one's inner edge, so the two
      // tests are complementary and cannot leave a seam or an overlap between them.
      const shIn = materials[li].userData.shader;
      if (shIn) shIn.uniforms.uOuterR.value = bound;
      const mat = li + 1 < RINGS.length ? materials[li + 1] : shellMaterial;
      const sh = mat.userData.shader;
      if (sh) sh.uniforms.uHoleR.value = bound;
    }

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
