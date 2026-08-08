import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, runwayInfluence, RUNWAYS } from './heightcore.js';

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
  const MAST_H = 74;
  // a mast has a much smaller footprint than a turbine, so a smaller, softer patch
  group.add(contactPatches(masts, 8, 0.26));
  place(new THREE.CylinderGeometry(0.5, 1.5, MAST_H, 6), steel, masts, MAST_H / 2);
  place(new THREE.CylinderGeometry(3.0, 3.6, 1.6, 6), dark, masts, 0.8);          // footing
  // three collars: the only thing giving a 74 m needle a sense of height from a distance
  for (const f of [0.34, 0.58, 0.80]) {
    const rr = 1.5 - 1.0 * f;
    place(new THREE.CylinderGeometry(rr + 0.55, rr + 0.55, 0.5, 6), dark, masts, MAST_H * f, false);
  }
  place(new THREE.BoxGeometry(4.6, 0.16, 0.16), steel, masts, MAST_H * 0.86, false);
  place(new THREE.BoxGeometry(0.16, 0.16, 3.4), steel, masts, MAST_H * 0.92, false);
  const mastLamps = place(new THREE.SphereGeometry(0.9, 7, 5), lampMat, masts, MAST_H + 1.2, false);
  const _c = new THREE.Color();
  for (let i = 0; i < masts.length; i++) mastLamps.setColorAt(i, _c.setRGB(1, 0.23, 0.18));

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
  const PER_SIDE = 2;          // 2 either side of the seed = up to 5 in a row
  const MIN_ROW = 3;           // a row of two is not a wind farm, it is two turbines
  const seedPool = pickSites(30, { minH: 150, maxSlope: 0.26, spacing: 1900, skip: 14 });
  const turbines = [];
  const farms = [];
  for (const s of seedPool) {
    if (farms.length >= 3) break;
    if (!onCrest(s.x, s.z, s.h, 6)) continue;
    // do not start a row on top of one already placed
    if (turbines.some(t => Math.hypot(t.x - s.x, t.z - s.z) < 1500)) continue;
    // maxSlope 0.44, not the 0.26 the seed was chosen with: a crest has steep FLANKS by
    // definition, and measuring slope over +/-26 m along a ridge picks that up. Holding the
    // walk to runway-grade ground stopped it dead after two turbines.
    const row = walkRidge(s, PER_SIDE, 620, 120, 0.44, turbines);
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
    const on = (time % 3) < 1.1 ? 1 : 0.12;
    for (let i = 0; i < masts.length; i++) {
      mastLamps.setColorAt(i, _c.setRGB(on, on * 0.23, on * 0.18));
    }
    if (mastLamps.instanceColor) mastLamps.instanceColor.needsUpdate = true;
  }

  // Position them once up front: the rotor matrices are only written by update(), so without
  // this every rotor sits at the world origin until the first frame ticks — which is exactly
  // what a fresh scene inspection shows, and would be a stack of blades at 0,0,0 on any
  // frame rendered before the sim starts.
  update(0);

  return { update, mastCount: masts.length, turbineCount: turbines.length };
}
