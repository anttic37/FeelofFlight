import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, runwayInfluence, RUNWAYS } from './heightcore.js';
import { tintUnlit, ATMO } from './atmosphere.js';

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

// NOTHING TALL GOES IN AN APPROACH. runwayInfluence only covers the strip and the ground it
// flattens — it says nothing about the several kilometres of air you fly down to reach the
// threshold, so on its own it happily allowed a 46 m turbine on short final.
//
// This is the obstacle surface instead: a corridor off each threshold, along the extended
// centreline, WIDENING with distance the way a real one does. Local coordinates come from
// the same (_c, _s) basis the runway meshes are built in, so the corridor cannot disagree
// with the strip it belongs to.
const APPROACH_LEN = 5200;
function inApproach(x, z) {
  for (const r of RUNWAYS) {
    const dx = x - r.x, dz = z - r.z;
    const lx = dx * r._c - dz * r._s;          // across the strip
    const lz = dx * r._s + dz * r._c;          // along it
    const past = Math.abs(lz) - r.length / 2;  // distance out beyond a threshold
    if (past < -40 || past > APPROACH_LEN) continue;
    if (Math.abs(lx) < 330 + 0.17 * Math.max(0, past)) return true;
  }
  return false;
}

// A crest is simply a point most of whose surroundings are below it. Sampled at 230 m, which
// is wide enough to ignore the fine ridge noise and narrow enough to still resolve one hill.
function onCrest(x, z, h, need = 5) {
  let lower = 0;
  for (let a = 0; a < 8; a++) {
    const th = (a * Math.PI) / 4;
    if (heightAt(x + Math.cos(th) * 230, z + Math.sin(th) * 230) < h) lower++;
  }
  return lower >= need;
}

function siteOK(x, z, minH, maxSlope) {
  const h = heightAt(x, z);
  if (h < minH) return null;
  if (runwayInfluence(x, z) > 0.01) return null;
  if (inApproach(x, z)) return null;
  const gx = heightAt(x + 26, z) - heightAt(x - 26, z);
  const gz = heightAt(x, z + 26) - heightAt(x, z - 26);
  const slope = Math.hypot(gx, gz) / 52;
  if (slope > maxSlope) return null;
  return { x, z, h, slope, score: h - slope * 900 };
}

function pickSites(count, { minH, maxSlope, spacing, reach = 7200, skip = 0 }) {
  const cands = [];
  const STEP = 180;
  for (let x = -reach; x <= reach; x += STEP) {
    for (let z = -reach; z <= reach; z += STEP) {
      if (Math.hypot(x, z) > reach) continue;
      const c = siteOK(x, z, minH, maxSlope);
      if (c) cands.push(c);
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

// A WIND FARM FOLLOWS A RIDGE. Turbines chosen by "highest spot with clearance" land as a
// scatter of unrelated poles, because the filter has no notion of the LINE the hilltops form
// — and a real farm is sited along a crest precisely because that is where the wind is.
//
// So: take the best site as a seed and walk outward from it in both directions, each step
// choosing the heading that stays highest. Following the local maximum IS following the
// crest, and biasing toward carrying straight on stops the walk from turning back down its
// own ridge at the first bump.
function walkRidge(seed, perSide, spacing, minH, maxSlope, avoid = []) {
  const line = [seed];
  for (const sign of [1, -1]) {
    // start along the contour: the ridge runs across the slope, not down it
    const gx = heightAt(seed.x + 40, seed.z) - heightAt(seed.x - 40, seed.z);
    const gz = heightAt(seed.x, seed.z + 40) - heightAt(seed.x, seed.z - 40);
    let dx = -gz, dz = gx;
    const L = Math.hypot(dx, dz) || 1;
    dx = (dx / L) * sign; dz = (dz / L) * sign;
    let cur = seed;
    for (let i = 0; i < perSide; i++) {
      let best = null;
      // TWO STEP LENGTHS. With one fixed stride the walk dies at the first steep shoulder and
      // the farm comes out as two turbines — a shorter probe lets it step around a bad patch
      // and pick the ridge back up, which is what actually happened here.
      for (const step of [spacing, spacing * 0.62]) {
        for (let a = -0.75; a <= 0.75001; a += 0.125) {
          const ca = Math.cos(a), sa = Math.sin(a);
          const nx = dx * ca - dz * sa, nz = dx * sa + dz * ca;
          const px = cur.x + nx * step, pz = cur.z + nz * step;
          if (Math.hypot(px, pz) > 7000) continue;
          if (line.some(o => Math.hypot(o.x - px, o.z - pz) < spacing * 0.55)) continue;
          if (avoid.some(o => Math.hypot(o.x - px, o.z - pz) < spacing * 0.9)) continue;
          const c = siteOK(px, pz, minH, maxSlope);
          if (!c) continue;
          // THE WALK PICKS THE BEST CANDIDATE, WHICH IS NOT THE SAME AS A GOOD ONE. Without
          // these two it takes the least-bad step even when every option leaves the crest,
          // and the row ends up with a turbine 360 m below its neighbours sitting in a
          // hollow with six of its eight surroundings ABOVE it.
          // 4 of 8, not 5: a point in the MIDDLE of a ridge has higher ground on both sides
          // along the crest, so demanding a majority rejects exactly the positions a row of
          // turbines wants and left the farm with two. The hollow this is here to exclude
          // scored 2. The drop limit is likewise generous enough to follow a crest that
          // undulates, while still refusing to descend into a valley.
          if (cur.h - c.h > 110) continue;
          if (!onCrest(px, pz, c.h, 4)) continue;
          const score = c.score - Math.abs(a) * 55 - (step < spacing ? 40 : 0);
          if (!best || score > best.score2) best = { ...c, score2: score, nx, nz };
        }
        if (best) break;
      }
      if (!best) break;
      line.push(best);
      cur = best; dx = best.nx; dz = best.nz;
    }
  }
  return line;
}

// ── CONTACT PATCHES ───────────────────────────────────────────────────────────────────────
// A soft darkening on the ground at the foot of each structure, and the reason it exists is
// that the shadow map cannot do it: the sun's shadow camera is 160 m either side of the
// AEROPLANE, so a turbine is only ever in it if you are almost on top of one. Everywhere else
// a 90 m tower meets the hillside with no shadow, no occlusion, nothing — and an object with
// no contact darkening does not look like it is standing on the ground, it looks like it is
// in front of it. That single cue is most of what "pasted on" means.
//
// Deliberately SYMMETRIC rather than a cast shadow stretched along the sun. This is baked once
// and the sun here moves through a whole day; a real cast shadow would have to be rebuilt as
// it swings, and would be wrong the rest of the time. A radial patch reads as ambient
// occlusion and the disturbed ground that is genuinely there at the base of one of these, and
// it is right at every hour.
//
// MULTIPLY blending, so it is a darkening rather than a colour: white at the rim changes
// nothing, dark at the centre takes the ground down, and it tracks whatever the terrain is
// doing underneath at any time of day without being told. It conforms to the slope because
// every vertex takes its own heightAt — a flat disc would cut into a ridge, and ridges are
// exactly where these things are put.
function contactPatches(sites, radius, strength) {
  const RINGS = 3, SPOKES = 16;
  const per = 1 + RINGS * SPOKES;
  const pos = new Float32Array(sites.length * per * 3);
  const col = new Float32Array(sites.length * per * 3);
  const idx = [];
  let v = 0;
  for (const s of sites) {
    const base = v;
    // centre
    pos[v * 3] = s.x; pos[v * 3 + 1] = heightAt(s.x, s.z) + 0.25; pos[v * 3 + 2] = s.z;
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = 1 - strength;
    v++;
    for (let r = 1; r <= RINGS; r++) {
      const t = r / RINGS, rad = radius * t;
      // squared falloff: tight and dark against the tower, gone well before the rim, which
      // is what stops it reading as a painted disc
      const k = 1 - strength * (1 - t) * (1 - t);
      for (let a = 0; a < SPOKES; a++) {
        const th = a / SPOKES * Math.PI * 2;
        const x = s.x + Math.cos(th) * rad, z = s.z + Math.sin(th) * rad;
        pos[v * 3] = x; pos[v * 3 + 1] = heightAt(x, z) + 0.25; pos[v * 3 + 2] = z;
        col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = r === RINGS ? 1 : k;
        v++;
      }
    }
    for (let a = 0; a < SPOKES; a++) {
      const n = (a + 1) % SPOKES;
      idx.push(base, base + 1 + a, base + 1 + n);                 // inner fan
      for (let r = 0; r < RINGS - 1; r++) {
        const i0 = base + 1 + r * SPOKES, i1 = i0 + SPOKES;
        idx.push(i0 + a, i1 + a, i0 + n, i0 + n, i1 + a, i1 + n);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, blending: THREE.MultiplyBlending, transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    fog: false,   // it is a multiplier on ground that is already fogged; fogging it twice greys it out
  }));
  m.renderOrder = 1;
  m.frustumCulled = false;
  return m;
}

export function createLandmarks(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // NOT WHITE. 0xe9ecef was the brightest albedo anywhere in the world — brighter than sand,
  // brighter than the runway, brighter than the sky's own haze once the sun is low. A tower is
  // a vertical cylinder, so at dusk it catches the last of a low sun square-on while the
  // ground beside it is taking that same light at a grazing angle and going dark. Physically
  // correct and it still reads as pasted on, because nothing else in frame is allowed to be
  // that bright. Real turbines are an off-grey that sits mid-value at distance; taking the
  // albedo down lets the hemisphere light place them in the scene rather than on top of it.
  const steel = new THREE.MeshStandardMaterial({ color: 0x878d93, ...flat });
  const white = new THREE.MeshStandardMaterial({ color: 0xb9bec4, ...flat });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4e545c, ...flat });
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
  // 118 m, up from 74. The mast is the island's yardstick — the one object whose height you
  // are supposed to read the landscape against — and at 74 m it was shorter than the hills it
  // stood on, which is the wrong way round for something meant to be seen from the far side of
  // the island. Everything below scales with it rather than being re-typed.
  const MAST_H = 118;
  // a mast has a much smaller footprint than a turbine, so a smaller, softer patch
  group.add(contactPatches(masts, 10, 0.28));
  place(new THREE.CylinderGeometry(0.8, 2.4, MAST_H, 6), steel, masts, MAST_H / 2);
  place(new THREE.CylinderGeometry(4.2, 5.0, 2.0, 6), dark, masts, 1.0);          // footing
  // four collars now, not three: they are the only thing giving a needle a sense of height
  // from a distance, and a taller needle needs more of them to read as tall rather than near
  for (const f of [0.26, 0.46, 0.64, 0.82]) {
    const rr = 2.4 - 1.6 * f;
    place(new THREE.CylinderGeometry(rr + 0.7, rr + 0.7, 0.7, 6), dark, masts, MAST_H * f, false);
  }
  place(new THREE.BoxGeometry(7.0, 0.22, 0.22), steel, masts, MAST_H * 0.86, false);
  place(new THREE.BoxGeometry(0.22, 0.22, 5.2), steel, masts, MAST_H * 0.92, false);
  // LAMPS ABOVE 1.0 ON PURPOSE. These are MeshBasic, so the number IS the pixel — but the
  // composer runs a half-float buffer with bloom on it, so anything over 1 blooms instead of
  // clipping. That is what turns a 1.6 m ball into a light you can see from the next valley,
  // and it is why the red is pushed to 2.6 rather than the sphere being made bigger still.
  const mastLamps = place(new THREE.SphereGeometry(1.6, 8, 6), lampMat, masts, MAST_H + 1.8, false);
  // a second pair partway down, the way a tall mast is actually lit
  const midLamps = place(new THREE.SphereGeometry(1.15, 8, 6), lampMat, masts, MAST_H * 0.55, false);
  const _c = new THREE.Color();
  for (let i = 0; i < masts.length; i++) {
    mastLamps.setColorAt(i, _c.setRGB(2.6, 0.5, 0.38));
    midLamps.setColorAt(i, _c.setRGB(1.5, 0.3, 0.23));
  }

  // ── WIND FARMS: A SHORT LINE ON EACH RIDGE ──────────────────────────────
  //
  // Several ridges with 3-5 turbines each, not one long chain. A chain walked as far as the
  // terrain allows gives whatever the island happens to hand you — three on one seed and
  // nine on another — and nine in a row reads as a fence. Short rows on separate crests read
  // as what they are: someone picked the windy ridges and put a handful on each.
  //
  // Seeds skip the top of the candidate list so the farms take the tier below the masts
  // rather than fighting them for the same summits, and must themselves be on a crest or the
  // row starts on a shoulder and walks downhill from there.
  // LONGER ROWS ON PURPOSE, reversing the earlier call. The note above worried that nine in a
  // row "reads as a fence" — but a fence is what a ridge-top wind farm looks like from the
  // air, and that is the thing being asked for: a LINE you can follow along the crest and use
  // to read where the ridge goes. The short rows read as three unrelated clumps instead.
  // 5 either side, and a tighter 520 m spacing so a row stays on one crest instead of
  // striding off the end of it.
  const PER_SIDE = 5;          // up to 11 in a row
  const MIN_ROW = 4;
  const seedPool = pickSites(40, { minH: 150, maxSlope: 0.26, spacing: 1700, skip: 12 });
  const turbines = [];
  const farms = [];
  for (const s of seedPool) {
    if (farms.length >= 4) break;
    if (!onCrest(s.x, s.z, s.h, 6)) continue;
    // do not start a row on top of one already placed
    if (turbines.some(t => Math.hypot(t.x - s.x, t.z - s.z) < 1500)) continue;
    // maxSlope 0.44, not the 0.26 the seed was chosen with: a crest has steep FLANKS by
    // definition, and measuring slope over +/-26 m along a ridge picks that up. Holding the
    // walk to runway-grade ground stopped it dead after two turbines.
    const row = walkRidge(s, PER_SIDE, 520, 120, 0.44, turbines);
    if (row.length < MIN_ROW) continue;
    farms.push(row);
    turbines.push(...row);
  }
  // ALL YAWED TOGETHER. A farm faces the prevailing wind as one — the earlier per-turbine
  // scatter was meant to look natural and instead read as a set of unrelated poles, which is
  // the opposite of what a row of turbines looks like.
  turbines.forEach((t) => { t.yaw = 0.63; });

  const TOW_H = 46, BLADE = 21;
  // the ground goes down before the tower goes up — see contactPatches
  group.add(contactPatches(turbines, 13, 0.34));
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

  // ── POWER GRID ──────────────────────────────────────────────────────────
  //
  // The turbines, the masts and the strips were three unrelated things that happened to be on
  // the same island. Wiring them together is what turns them into infrastructure: a line of
  // pylons walking over a saddle tells you the farm on that ridge FEEDS the airfield, and it
  // gives the eye something man-made to follow across ground that is otherwise all hillside.
  // It also does the same job as the masts do for height — a pylon every 210 m is a ruler
  // lying across the terrain.
  //
  // Routes are straight. A real grid takes the easy line, but a straight run between two known
  // points is legible from the air in a way a wandering one is not, and it is the readability
  // that is worth having here.
  // SPAN 120, not 210, and that is the clearance fix rather than taller towers. A conductor
  // only clears ground its SUPPORTS clear: with pylons 210 m apart a straight run over ridged
  // terrain buries itself in every hump between them, and the check that catches it then
  // refuses most routes (5 legs -> 2). Standing them closer makes the wire follow the profile,
  // because each pylon sits on whatever the ground does there. Costs instances in a single
  // instanced draw, which is the cheapest thing in this file.
  const PYL_H = 30, SPAN = 120, WIRE_CLEAR = 3;
  const pylons = [];
  const wireVerts = [];
  // where a conductor attaches on each kind of node
  const topOf = (n) => n.h + n.top;
  function runLine(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz);
    if (L < 300 || L > 6000) return false;
    const ux = dx / L, uz = dz / L;
    // crossarms sit ACROSS the run: place() rotates about Y, and a Y-rotation by atan2(ux,uz)
    // sends local +X to (uz, -ux), which is the perpendicular we want.
    const yaw = Math.atan2(ux, uz);
    const n = Math.max(2, Math.round(L / SPAN));
    const pts = [{ x: a.x, z: a.z, y: topOf(a) }];
    const fresh = [];
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a.x + dx * t, z = a.z + dz * t;
      const h = heightAt(x, z);
      // A PYLON IN THE SEA IS WORSE THAN NO LINE AT ALL, and a route that clips a bay would
      // plant several. Abandon the whole run rather than place them: there is always another
      // pairing, and a grid with one missing leg still reads as a grid.
      if (h < 4) return false;
      // never inside the approach to a strip — runwayInfluence is what the rest of this file
      // uses to keep tall things away from short final
      if (runwayInfluence(x, z) > 0.02) return false;
      fresh.push({ x, z, h, yaw });
      pts.push({ x, z, y: h + PYL_H * 0.9 });
    }
    pts.push({ x: b.x, z: b.z, y: topOf(b) });

    // A WIRE IS NOT CHECKED BY CHECKING ITS POLES. Terrain was only sampled AT each pylon, so
    // any rise BETWEEN two of them was invisible and the conductor ran straight through the
    // hill: 80 of 560 wire points were under the ground the first time this ran. Walk each
    // span and require real clearance, sag included; if a span cannot make it, drop the whole
    // route rather than leave one leg buried. There is always another pairing.
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const sag = Math.min(7, Math.hypot(q.x - p.x, q.z - p.z) * 0.04);
      for (let s = 1; s < 8; s++) {
        const t = s / 8;
        const wy = p.y + (q.y - p.y) * t - sag * Math.sin(Math.PI * t);
        const gx = p.x + (q.x - p.x) * t, gz = p.z + (q.z - p.z) * t;
        const gh = heightAt(gx, gz);
        if (wy - gh < WIRE_CLEAR) return false;
        // NO LOW WIRE OVER AN AIRFIELD, EVER. Pylons were already forbidden inside
        // runwayInfluence, but the CONDUCTOR was not — so the final span simply leapt
        // from the last legal pylon clean across the strip. Measured on seed 777: 14
        // wire vertices hanging 14-19 m over the airfield, crossing the threshold. A
        // route that cannot reach its endpoint without dipping below 35 m over the
        // influence field is refused whole; there is always another pairing.
        if (wy - gh < 35 && runwayInfluence(gx, gz) > 0.02) return false;
      }
    }

    pylons.push(...fresh);
    // two conductors, one either side, sagging between supports
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const sag = Math.min(7, Math.hypot(q.x - p.x, q.z - p.z) * 0.04);
      for (const off of [-2.8, 2.8]) {
        const at = (t) => [
          p.x + (q.x - p.x) * t + uz * off,
          p.y + (q.y - p.y) * t - sag * Math.sin(Math.PI * t),
          p.z + (q.z - p.z) * t - ux * off,
        ];
        for (let s = 0; s < 5; s++) { wireVerts.push(...at(s / 5), ...at((s + 1) / 5)); }
      }
    }
    return true;
  }

  // Nodes: either end of each turbine row, every mast, every strip. Pairings are TRIED IN
  // ORDER OF DISTANCE rather than fixed to the nearest, because a route can now be refused
  // (water, an approach, or terrain it cannot clear) and a grid that gives up on the first
  // refusal ends up with legs missing for no reason a viewer could infer. Nearest first still
  // decides what it looks like; the rest are only there so a leg exists at all.
  const byDist = (from, list) => list.slice().sort((a, b) =>
    Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
  const mastNodes = masts.map(m => ({ x: m.x, z: m.z, h: m.h, top: MAST_H * 0.42 }));

  // A LINE ENDS ON SOMETHING, ALWAYS. The strip "node" used to be the runway CENTRE with
  // the conductor attached 14 m over the tarmac — a wire terminating on thin air, dangling
  // across the one place the player is guaranteed to fly low. Power arrives at an airfield
  // the way it arrives anywhere: at a small transformer house off to the side. So each
  // strip offers hut SITES beside itself (both verges, slid along the length until a spot
  // is flat, dry and outside runwayInfluence), the line terminates on the hut's gantry,
  // and the hut is only built if a line actually lands there.
  function hutSites(r, ri) {
    const out = [];
    for (const side of [-1, 1]) {
      let found = null;
      for (const d of [r.width / 2 + 46, r.width / 2 + 64, r.width / 2 + 86]) {
        for (const a of [0, -r.length * 0.24, r.length * 0.24]) {
          const lx = side * d, lz = a;
          const x = r.x + lx * r._c + lz * r._s;
          const z = r.z - lx * r._s + lz * r._c;
          const h = heightAt(x, z);
          if (h < 3) continue;                              // not on a beach or in the sea
          if (runwayInfluence(x, z) > 0.015) continue;      // off the graded pad
          if (Math.abs(heightAt(x + 7, z) - h) > 3.5
           || Math.abs(heightAt(x, z + 7) - h) > 3.5) continue; // needs level-ish ground
          found = { x, z, h, top: 6.1, ri };
          break;
        }
        if (found) break;
      }
      if (found) out.push(found);
    }
    return out;
  }
  const stripNodes = RUNWAYS.flatMap((r, ri) => hutSites(r, ri));

  // the transformer house itself: pad, brick hut, roof, and the take-off gantry whose
  // crossarm the conductors actually land on. Yawed so the crossarm sits across the line.
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9b988d, ...flat });
  const brick = new THREE.MeshStandardMaterial({ color: 0x84594a, ...flat });
  function buildSubstation(sN, yaw) {
    const hut = new THREE.Group();
    hut.position.set(sN.x, sN.h, sN.z);
    hut.rotation.y = yaw;
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      hut.add(m); return m; };
    add(new THREE.BoxGeometry(7.4, 0.5, 5.6), concrete, 0, 0.25, 0);
    add(new THREE.BoxGeometry(4.6, 3.0, 3.4), brick, 0, 2.0, 0);
    add(new THREE.BoxGeometry(5.0, 0.24, 3.8), dark, 0, 3.62, 0);
    add(new THREE.BoxGeometry(1.1, 2.0, 0.12), dark, 0.9, 1.5, 1.73);
    add(mergeGeometries([
      new THREE.CylinderGeometry(0.09, 0.09, 2.9, 5).translate(-1.4, 4.85, 0),
      new THREE.CylinderGeometry(0.09, 0.09, 2.9, 5).translate(1.4, 4.85, 0),
      new THREE.BoxGeometry(6.2, 0.22, 0.22).translate(0, 5.95, 0),
      new THREE.CylinderGeometry(0.09, 0.13, 0.5, 5).translate(-2.8, 6.2, 0),
      new THREE.CylinderGeometry(0.09, 0.13, 0.5, 5).translate(2.8, 6.2, 0),
    ]), steel, 0, 0, 0);
    group.add(hut);
  }
  let legs = 0;
  for (const row of farms) {
    const ends = [row[0], row[row.length - 1]].map(t => ({ x: t.x, z: t.z, h: t.h, top: TOW_H * 0.5 }));
    let done = false;
    for (const m of byDist(ends[0], mastNodes)) {
      for (const end of byDist(m, ends)) { if (runLine(end, m)) { legs++; done = true; break; } }
      if (done) break;
    }
  }
  const served = new Set();   // one hut per strip: its other-side candidate retires
  for (const m of mastNodes) {
    for (const s of byDist(m, stripNodes)) {
      if (served.has(s.ri)) continue;
      if (runLine(m, s)) {
        buildSubstation(s, Math.atan2(m.x - s.x, m.z - s.z));
        served.add(s.ri);
        legs++;
        break;
      }
    }
  }
  if (pylons.length) {
    const pylonGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.30, 1.05, PYL_H, 4).translate(0, PYL_H / 2, 0),
      new THREE.BoxGeometry(7.0, 0.34, 0.34).translate(0, PYL_H * 0.76, 0),
      new THREE.BoxGeometry(5.0, 0.30, 0.30).translate(0, PYL_H * 0.90, 0),
      new THREE.CylinderGeometry(1.5, 1.9, 0.8, 4).translate(0, 0.4, 0),
    ]);
    group.add(contactPatches(pylons, 6, 0.22));
    place(pylonGeo, steel, pylons, 0);
  }
  if (wireVerts.length) {
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wireVerts, 3));
    // tintUnlit, because LineBasicMaterial takes no light: without it the wires would hold
    // their midday value through dusk and glow faintly against a dark hillside at night.
    //
    // AND THEY FADE OUT WITH DISTANCE, unlike everything else. Fog is not enough for a
    // conductor: haze mixes a 1-2 px near-black stroke toward the sky colour, but a dark
    // stroke at half-haze is still a drawn line, and the grid read as crisp ink lines
    // along every distant ridge. A 3 cm wire is physically invisible beyond a couple of
    // km — so the conductors dissolve entirely by ~3.4 km and the PYLONS carry the line
    // of the grid from there, which is exactly how a real one reads from the air.
    // The instance onBeforeCompile SHADOWS the prototype ATMO hook (the v8.93 trap), so
    // the shared uniforms are re-merged here or the fog chunk would read zeros.
    const wireMat = tintUnlit(new THREE.LineBasicMaterial({ color: 0x353a42, transparent: true }));
    wireMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, ATMO);
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>',
        '#include <fog_fragment>\n  gl_FragColor.a *= 1.0 - smoothstep(1600.0, 3400.0, vFogDepth);');
    };
    const wires = new THREE.LineSegments(wireGeo, wireMat);
    wires.frustumCulled = false;   // one object spanning the island; its bounds are the island
    group.add(wires);
  }

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
    const on = (time % 3) < 1.3 ? 2.6 : 0.30;
    for (let i = 0; i < masts.length; i++) {
      mastLamps.setColorAt(i, _c.setRGB(on, on * 0.19, on * 0.15));
      midLamps.setColorAt(i, _c.setRGB(on * 0.58, on * 0.11, on * 0.09));
    }
    if (mastLamps.instanceColor) mastLamps.instanceColor.needsUpdate = true;
    if (midLamps.instanceColor) midLamps.instanceColor.needsUpdate = true;
  }

  // Position them once up front: the rotor matrices are only written by update(), so without
  // this every rotor sits at the world origin until the first frame ticks — which is exactly
  // what a fresh scene inspection shows, and would be a stack of blades at 0,0,0 on any
  // frame rendered before the sim starts.
  update(0);

  return { update, mastCount: masts.length, turbineCount: turbines.length,
    pylonCount: pylons.length, gridLegs: legs, farmCount: farms.length };
}
