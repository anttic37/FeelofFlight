import { fbm as fbm_, noise2 as noise2_ } from './noise.js';

// ---- terrain seed: a NEW island every run ----
// One seed reshapes the whole island: every noise field below samples a
// seed-shifted domain, and per-seed "character" knobs scale biome amplitudes
// (mountain height, mesa/dune size, hill/forest relief, coastline warp).
// Anchors stay FIXED — runway positions, canyon path, biome centers — and
// platforms/corridors/flattening run after everything, so every seed is
// landable by construction. Seed 0 = the classic island (zero shift, knobs 1).
// setTerrainSeed must run before any sampling, in EVERY thread that imports
// this module (main thread AND the terrain worker).
let SX = 0, SZ = 0, SEED = 0;
let K_MTN = 1, K_MESA = 1, K_DUNE = 1, K_HILL = 1, K_FOR = 1, K_REL = 1, COAST_WARP = 760;
let K_SWELL = 0; // island-wide broad swells (~2.4 km) — 0 on the classic island
// island SILHOUETTE: direction-dependent radius scale built from 1-3 angular
// lobes — elongated, egg/comma, tri-lobed and bay-bitten outlines per seed.
// SH_ON false (classic) keeps the plain circular mask, bit for bit.
let SH_ON = false, SH_A1 = 0, SH_P1 = 0, SH_A2 = 0, SH_P2 = 0, SH_A3 = 0, SH_P3 = 0;
let SH_R2OUT = 75690000; // beyond-the-shelf early-out radius², shape-aware
function shapeS(theta) {
  const s = 1 + SH_A1 * Math.sin(theta + SH_P1) + SH_A2 * Math.sin(2 * theta + SH_P2) + SH_A3 * Math.sin(3 * theta + SH_P3);
  return s < 0.6 ? 0.6 : s > 1.42 ? 1.42 : s;
}
function h01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function setTerrainSeed(seed) {
  SEED = seed >>> 0;
  if (SEED === 0) {
    SX = SZ = 0; K_MTN = K_MESA = K_DUNE = K_HILL = K_FOR = K_REL = 1; K_SWELL = 0; COAST_WARP = 760;
    SH_ON = false; SH_R2OUT = 75690000; // classic circular mask, r 8700 early-out
    restoreClassicLayout(); // hand-tuned anchors, runways, canyon, tribs
  } else {
    SX = (h01(SEED * 0.013 + 11.7) - 0.5) * 30000;
    SZ = (h01(SEED * 0.017 + 23.1) - 0.5) * 30000;
    K_MTN  = 0.70 + 1.05 * h01(SEED * 0.019 + 5.2);  // peaks ~480-1200
    K_MESA = 0.60 + 1.30 * h01(SEED * 0.023 + 8.6);
    K_DUNE = 0.70 + 1.30 * h01(SEED * 0.029 + 2.9);
    K_HILL = 0.70 + 1.10 * h01(SEED * 0.031 + 14.3);
    K_FOR  = 0.70 + 1.00 * h01(SEED * 0.037 + 6.8);
    K_REL  = 0.80 + 1.20 * h01(SEED * 0.041 + 9.4);
    K_SWELL = 0.50 + 1.60 * h01(SEED * 0.047 + 12.1); // broad rolling uplands, +-17..70 m
    COAST_WARP = 700 + 500 * h01(SEED * 0.043 + 3.6); // bays/peninsulas vary, Coast strip stays dry
    SH_ON = true; // seeded silhouette: comma / elongated / tri-lobed outlines
    SH_A1 = 0.26 * h01(SEED * 0.053 + 4.9); SH_P1 = Math.PI * 2 * h01(SEED * 0.059 + 7.7);
    SH_A2 = 0.30 * h01(SEED * 0.061 + 1.4); SH_P2 = Math.PI * 2 * h01(SEED * 0.067 + 9.8);
    SH_A3 = 0.18 * h01(SEED * 0.071 + 3.2); SH_P3 = Math.PI * 2 * h01(SEED * 0.073 + 6.5);
    SH_R2OUT = 124000000; // r ~11.1 km covers the widest lobe + coast warp
    generateLayout(); // move the mountains, canyon, biomes AND the strips
  }
  rebuildDerived();
}
export function getTerrainSeed() { return SEED; }
// seeded noise: same functions, shifted domain. Exported so colorcore paints
// with the SAME fields (canyon bench jitter etc. must match the geometry).
export function seededNoise2(x, z) { return noise2_(x + SX, z + SZ); }
const noise2 = seededNoise2;
const fbm = (x, z, o) => fbm_(x + SX, z + SZ, o);

// The pure analytic terrain core — heightAt(x,z) and everything under it, plus
// the runway anchors/flattening it depends on. Dependency-free (noise.js only,
// no THREE), so it loads in a module Web Worker verbatim. heightAt is the
// single source of truth for the ground: physics, camera, HUD, water, minimap
// and every terrain tile bake all sample this one deterministic function.
// runways.js and world.js re-export the public pieces, so consumer imports
// are unchanged. Module-scratch scalars (_cd/_cs/.../_wH/...) keep the hot
// path allocation-free — non-reentrant, but fine single-threaded; never share
// one module instance across threads.

// ---- runway anchors + strip flattening (from runways.js) ----
// heading = radians about +Y; heading 0 -> long axis along world -Z.
// DESIGN: the island is built around these anchors (biome centers, the canyon
// carve path, the summit plateau) so every strip's surroundings fit its theme
// by construction.

// biome anchor points (region masks + vegetation)
export const HILLS_C  = { x: 900,   z: 4200 };  // southern rolling hills
export const DESERT_C = { x: 4300,  z: 300 };   // eastern dunes + mesas
export const FOREST_C = { x: -4200, z: -100 };  // western woods
export const MTN_A    = { x: -3000, z: -2000 }; // mountain ridge west end
export const MTN_B    = { x: 1400,  z: -3100 }; // mountain ridge east end
export const PEAK     = { x: -350,  z: -2750 }; // highest summit (~650 m)

// Canyon carve waypoints, mountain foothills -> southeast sea: a meandering
// ~9.5 km gorge (bends kept under ~30 deg so the capsule-union distance field
// stays clean). Segment [5]->[6] is straight (2290 m) and carries the Canyon
// strip dead-center, so the flat gorge floor runs clear for ~935 m past both
// thresholds by construction.
export const CANYON_PATH = [
  { x: 1150, z: -1350 }, { x: 1795, z: -600 }, { x: 2010, z: 420 },
  { x: 2620, z: 1130 }, { x: 2795, z: 2050 }, { x: 3095, z: 2435 },
  { x: 4155, z: 4465 }, { x: 4380, z: 5180 }, { x: 4310, z: 5920 },
  { x: 4560, z: 6480 }, { x: 5000, z: 7000 },
];

// m = flattening margin; pad = base-terrain platform blend consumed below.
// [3] heading matches CANYON_PATH segment [5]->[6]; [4] axis runs E-W along the
// range's south flank with PEAK ~810 m away, perpendicular to the approach.
export const RUNWAYS = [
  { name: 'Coast',  x: 250,   z: 6050,  heading: 0,       length: 450, width: 26, elev: 12,  m: 90, pad: 300 },
  { name: 'Desert', x: 4350,  z: 900,   heading: 0.28,    length: 620, width: 30, elev: 36,  m: 90, pad: 320 },
  { name: 'Forest', x: -4250, z: -300,  heading: 1.05,    length: 380, width: 22, elev: 64,  m: 70, pad: 260 },
  { name: 'Canyon', x: 3625,  z: 3450,  heading: -2.6599, length: 420, width: 24, elev: 72,  m: 60, pad: 220 },
  { name: 'Summit', x: 350,   z: -2350, heading: -1.64,   length: 340, width: 20, elev: 465, m: 70, pad: 300 },
  { name: 'Hills',  x: 1600,  z: 3850,  heading: 2.30,    length: 400, width: 24, elev: 104, m: 80, pad: 280 },
];
function computeRunwayDerived() {
  for (const r of RUNWAYS) {
    r._c = Math.cos(r.heading); r._s = Math.sin(r.heading);
    const reach = Math.hypot(r.length, r.width) / 2 + r.m + 2;
    r._r2 = reach * reach; // coarse circle reject for the hot per-sample loops
  }
}
computeRunwayDerived();

// blend weight: 1 on the strip, smoothstep down to 0 at r.m outside the rect
function stripWeight(r, x, z) {
  const dx = x - r.x, dz = z - r.z;
  if (dx * dx + dz * dz > r._r2) return 0;
  const lx = dx * r._c - dz * r._s, lz = dx * r._s + dz * r._c;
  const du = Math.abs(lx) - r.width * 0.5, dv = Math.abs(lz) - r.length * 0.5;
  if (du >= r.m || dv >= r.m) return 0;
  if (du <= 0 && dv <= 0) return 1;
  const d = Math.hypot(Math.max(0, du), Math.max(0, dv));
  if (d >= r.m) return 0;
  const t = d / r.m;
  return 1 - t * t * (3 - 2 * t);
}

export function onRunway(x, z) {
  for (const r of RUNWAYS) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > r._r2) continue;
    const lx = dx * r._c - dz * r._s, lz = dx * r._s + dz * r._c;
    if (Math.abs(lx) <= r.width * 0.5 && Math.abs(lz) <= r.length * 0.5) return true;
  }
  return false;
}

// max blend weight over all strips (0 clear .. 1 on asphalt). Extra helper used
// for vegetation exclusion and dirt tinting; not part of the shared contract.
export function runwayInfluence(x, z) {
  let w = 0;
  for (const r of RUNWAYS) w = Math.max(w, stripWeight(r, x, z));
  return w;
}

export function applyRunwayFlattening(x, z, baseH) {
  let h = baseH;
  for (const r of RUNWAYS) { // strips never overlap, order irrelevant
    const w = stripWeight(r, x, z);
    if (w > 0) h += (r.elev - h) * w;
  }
  return h;
}

// ---- island height field (from world.js) ----
// Procedural island, radius ~7000 m: five noise-warped biome regions (south
// hills, east desert, west forest, north+center mountains to ~650 m, and a
// meandering stepped-wall canyon system running to the southeast sea), all
// shaped AROUND the runway anchors above — per-strip terrain platforms and
// capped approach corridors guarantee every strip fits its theme by
// construction, then applyRunwayFlattening does the final grading.
// Island-wide domain-warped rolling relief + a small detail layer keep the
// lowlands reading as real terrain at altitude and at low-level speed.

const R_MASK = 7200; // radial falloff denominator; beach lands around r ~6600-7400

export function smooth(a, b, t) {
  t = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- mountain ridge segment MTN_A -> MTN_B ----
let _rgL = 1, _rgux = 1, _rguz = 0;
function computeRidge() {
  _rgL = Math.hypot(MTN_B.x - MTN_A.x, MTN_B.z - MTN_A.z);
  _rgux = (MTN_B.x - MTN_A.x) / _rgL; _rguz = (MTN_B.z - MTN_A.z) / _rgL;
}
computeRidge();
function ridgeDist(x, z) {
  let dx = x - MTN_A.x, dz = z - MTN_A.z;
  let t = dx * _rgux + dz * _rguz;
  t = t < 0 ? 0 : t > _rgL ? _rgL : t;
  dx -= _rgux * t; dz -= _rguz * t;
  return Math.hypot(dx, dz);
}

// ---- canyon path (smooth polyline distance) ----
const CSEG = [];
let CANYON_LEN = 1;
let CB_X0 = 1e9, CB_X1 = -1e9, CB_Z0 = 1e9, CB_Z1 = -1e9;
function computeCanyonSegs() {
  CSEG.length = 0;
  let acc = 0;
  for (let i = 0; i < CANYON_PATH.length - 1; i++) {
    const a = CANYON_PATH[i], b = CANYON_PATH[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    CSEG.push({ ax: a.x, az: a.z, ux: dx / len, uz: dz / len, len, s0: acc });
    acc += len;
  }
  CANYON_LEN = acc;
  CB_X0 = 1e9; CB_X1 = -1e9; CB_Z0 = 1e9; CB_Z1 = -1e9;
  for (const p of CANYON_PATH) {
    CB_X0 = Math.min(CB_X0, p.x - 1000); CB_X1 = Math.max(CB_X1, p.x + 1000);
    CB_Z0 = Math.min(CB_Z0, p.z - 1000); CB_Z1 = Math.max(CB_Z1, p.z + 1000);
  }
}
computeCanyonSegs();

// module scratch: distance to path, param 0..1 along it, signed lateral offset
export let _cd = 0, _cs = 0, _cx = 0;
export function canyonLocate(x, z) {
  if (x < CB_X0 || x > CB_X1 || z < CB_Z0 || z > CB_Z1) return false;
  let best = 1e18, bs = 0, side = 0;
  for (let i = 0; i < CSEG.length; i++) {
    const g = CSEG[i];
    const dx = x - g.ax, dz = z - g.az;
    let t = dx * g.ux + dz * g.uz;
    t = t < 0 ? 0 : t > g.len ? g.len : t;
    const px = dx - g.ux * t, pz = dz - g.uz * t;
    const d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; bs = g.s0 + t; side = dx * g.uz - dz * g.ux; }
  }
  _cd = Math.sqrt(best);
  _cs = bs / CANYON_LEN;
  _cx = side < 0 ? -_cd : _cd;
  return true;
}

export let _ppx = 0, _ppz = 0, _ppux = 0, _ppuz = 0; // pathPoint scratch (boulder scatter)
export function pathPoint(sN) {
  let t = sN * CANYON_LEN;
  for (let i = 0; i < CSEG.length; i++) {
    const g = CSEG[i];
    if (t <= g.len || i === CSEG.length - 1) {
      t = Math.min(t, g.len);
      _ppx = g.ax + g.ux * t; _ppz = g.az + g.uz * t;
      _ppux = g.ux; _ppuz = g.uz;
      return;
    }
    t -= g.len;
  }
}

// ---- canyon cross-section, all smooth functions of the along-path param s ----
// floor half-width 102-168 m (floor 200-340 wide), held at 170 around the strip
// segment so the corridor (half-width 144) never meets a wall base
const stripHold = (s) => smooth(0.43, 0.466, s) * (1 - smooth(0.704, 0.74, s));
export function cWf(s) {
  const v = 102 + 66 * noise2(s * 4.3 + 7.7, 2.5);
  return v + (170 - v) * stripHold(s);
}
export function cWr(s) { return 140 + 140 * noise2(s * 3.1 + 3.3, 8.8); } // stepped-wall run 140-280 m
// floor level: 140 in the foothills -> 72 held across the strip + 800 m
// approaches (thresholds sit at s 0.562/0.607) -> drowned estuary right where
// the island mask fades out (r ~7200), so the gorge flows into the sea
function cFl(s) { return 140 - 68 * smooth(0.03, 0.42, s) - 88 * smooth(0.692, 0.86, s); }
// rim height above the floor 140-230 m (+-22 lateral noise on top), easing off
// toward the mouth so the climb-out over the sea stays shallow
function cDepth(s) { return (128 + 112 * noise2(s * 3.9 + 11.3, 4.4)) * (1 - 0.4 * smooth(0.72, 0.88, s)); }
// dry-wash channel meander: lateral offset of the wash bed within the floor
export function washOff(s, wf) { return (noise2(s * 9.3 + 5.5, 6.2) - 0.5) * 2 * (wf - 58); }

// gorge cut: flat floor with a meandering 1.7 m dry-wash channel, walls
// quantized into 3 noise-jittered strata benches, raised tableland shoulders
// blending back into the biome over ~430 m
function carveCanyon(x, z, h) {
  const s = _cs, d = _cd;
  const wf = cWf(s), wr = cWr(s);
  if (d >= wf + wr + 430) return h;
  const fl = cFl(s);
  const rim = Math.max(h + 24, fl + cDepth(s) + (noise2(x * 0.0011 + 40.2, z * 0.0011 + 12.8) - 0.5) * 44);
  if (d < wf) {
    let f = fl + (noise2(x * 0.02 + 3.3, z * 0.02 + 6.1) - 0.5) * 2.4;
    const dw = Math.abs(_cx - washOff(s, wf));
    if (dw < 30) f -= 1.7 * (1 - smooth(6, 30, dw));
    return f;
  }
  if (d < wf + wr) {
    const t = (d - wf) / wr;
    // bench-edge jitter fades at both ends so the profile stays continuous
    const jA = smooth(0, 0.12, t) * (1 - smooth(0.85, 1, t)) * 0.16;
    let tj = t + (noise2(x * 0.006 + 9.4, z * 0.006 + 4.2) - 0.5) * 2 * jA;
    tj = tj < 0 ? 0 : tj > 0.9999 ? 0.9999 : tj;
    const u = tj * 3, bi = u | 0, fr = u - bi;
    const prof = 0.74 * ((bi + smooth(0.56, 0.97, fr)) / 3) + 0.26 * t;
    return fl + (rim - fl) * prof;
  }
  return rim + (h - rim) * smooth(0, 1, (d - wf - wr) / 430);
}

// ---- tributary gullies: short 2-bench side cuts notching the gorge shoulders,
// merged with min() so they fade out wherever the biome is already lower ----
const CLASSIC_TRIB_DEFS = [
  { pts: [{ x: 1780, z: 1780 }, { x: 2210, z: 1460 }, { x: 2620, z: 1130 }], joinFl: 85 },
  { pts: [{ x: 5150, z: 4760 }, { x: 4760, z: 4960 }, { x: 4380, z: 5180 }], joinFl: 59 },
];
export const TRIBS = [];
function buildTrib(tb) {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < tb.pts.length - 1; i++) {
    const a = tb.pts[i], b = tb.pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    segs.push({ ax: a.x, az: a.z, ux: dx / len, uz: dz / len, len, s0: acc });
    acc += len;
  }
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of tb.pts) {
    x0 = Math.min(x0, p.x - 420); x1 = Math.max(x1, p.x + 420);
    z0 = Math.min(z0, p.z - 420); z1 = Math.max(z1, p.z + 420);
  }
  return { segs, len: acc, joinFl: tb.joinFl, x0, x1, z0, z1 };
}
function computeTribs(defs) {
  TRIBS.length = 0;
  for (const d of defs) TRIBS.push(buildTrib(d));
}
computeTribs(CLASSIC_TRIB_DEFS);

export let _td = 0, _ts = 0; // module scratch: distance to tributary, param along it
export function tribLocate(tb, x, z) {
  if (x < tb.x0 || x > tb.x1 || z < tb.z0 || z > tb.z1) return false;
  let best = 1e18, bs = 0;
  for (let i = 0; i < tb.segs.length; i++) {
    const g = tb.segs[i];
    const dx = x - g.ax, dz = z - g.az;
    let t = dx * g.ux + dz * g.uz;
    t = t < 0 ? 0 : t > g.len ? g.len : t;
    const px = dx - g.ux * t, pz = dz - g.uz * t;
    const d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; bs = g.s0 + t; }
  }
  _td = Math.sqrt(best);
  _ts = bs / tb.len;
  return _td < 420;
}
function carveTribs(x, z, h) {
  for (let i = 0; i < TRIBS.length; i++) {
    const tb = TRIBS[i];
    if (!tribLocate(tb, x, z)) continue;
    const d = _td, sT = _ts;
    const wf = 34 + 44 * sT, wr = 80 + 50 * sT;
    if (d >= wf + wr + 240) continue;
    const fl = tb.joinFl + 46 * (1 - sT) * (1 - sT); // climbs upstream from the junction
    const rim = Math.max(h + 16, fl + 74 + 62 * sT);
    let g;
    if (d < wf) g = fl + (noise2(x * 0.02 + 3.3, z * 0.02 + 6.1) - 0.5) * 2;
    else if (d < wf + wr) {
      const t = (d - wf) / wr;
      const u = Math.min(t, 0.9999) * 2, bi = u | 0, fr = u - bi;
      g = fl + (rim - fl) * (0.7 * ((bi + smooth(0.5, 0.95, fr)) / 2) + 0.3 * t);
    } else g = rim + (h - rim) * smooth(0, 1, (d - wf - wr) / 240);
    if (g < h) h = g;
  }
  return h;
}

// ---- per-strip terrain platforms: pull the base terrain to strip elevation over
// a rect larger than the flattening margin, so grading never fights the biome ----
const PLATFORMS = [];
function computePlatforms() {
  PLATFORMS.length = 0;
  for (const r of RUNWAYS) {
    const hl = r.length / 2 + 70, hw = r.width / 2 + 55;
    const reach = Math.hypot(hl, hw) + r.pad;
    PLATFORMS.push({ x: r.x, z: r.z, c: r._c, s: r._s, elev: r.elev, hl, hw, pad: r.pad, r2: reach * reach });
  }
}
computePlatforms();
function applyPlatforms(x, z, h) {
  for (let i = 0; i < PLATFORMS.length; i++) {
    const p = PLATFORMS[i];
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz > p.r2) continue;
    const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;
    const du = Math.abs(lx) - p.hw, dv = Math.abs(lz) - p.hl;
    let w = 1;
    if (du > 0 || dv > 0) {
      const dd = Math.hypot(Math.max(0, du), Math.max(0, dv));
      if (dd >= p.pad) continue;
      const t = dd / p.pad;
      w = 1 - t * t * (3 - 2 * t);
    }
    h += (p.elev - h) * w;
  }
  return h;
}

// ---- approach corridors: soft height cap (~6.5% obstacle ramp) off both ends of
// every strip, so no biome feature can wander into short final ----
const CORRIDORS = [];
function computeCorridors() {
  CORRIDORS.length = 0;
  for (const r of RUNWAYS) {
    const ax = -r._s, az = -r._c;
    for (const e of [-1, 1]) {
      CORRIDORS.push({
        ox: r.x + e * ax * r.length / 2, oz: r.z + e * az * r.length / 2,
        ux: e * ax, uz: e * az, len: r.name === 'Coast' ? 1500 : 1400,
        hw: r.width * 3.5 + 60, base: r.elev + 4,
      });
    }
  }
}
computeCorridors();
function applyCorridors(x, z, h) {
  for (let i = 0; i < CORRIDORS.length; i++) {
    const c = CORRIDORS[i];
    const dx = x - c.ox, dz = z - c.oz;
    const along = dx * c.ux + dz * c.uz;
    if (along < 0 || along > c.len) continue;
    const lat = Math.abs(dx * c.uz - dz * c.ux);
    if (lat >= c.hw) continue;
    const cap = c.base + along * 0.065;
    if (h <= cap) continue;
    h += (cap - h) * (1 - smooth(c.hw - 70, c.hw, lat)) * (1 - smooth(c.len - 500, c.len, along));
  }
  return h;
}
export function nearCorridor(x, z) { // vegetation keep-out over the first stretch of final
  for (let i = 0; i < CORRIDORS.length; i++) {
    const c = CORRIDORS[i];
    const dx = x - c.ox, dz = z - c.oz;
    const along = dx * c.ux + dz * c.uz;
    if (along < -30 || along > 480) continue;
    if (Math.abs(dx * c.uz - dz * c.ux) < c.hw + 12) return true;
  }
  return false;
}

// ---- seeded island layout ----
// For seed != 0 the whole LAYOUT is generated, not just the noise: the biome
// compass spins to a seeded rotation, the ridge+peak move with the mountain
// sector, the canyon carves a fresh meander from the foothills to the sea, and
// all six strips are re-placed by theme rules (Coast on the shore with final
// over water, Canyon centered on the path's straight run, Summit on the flank
// below the peak, the rest near their biome centers, all nudged clear of the
// gorge). Everything derives from SEED alone so the worker regenerates the
// identical layout from its own setTerrainSeed call.
const CLASSIC = {
  anchors: [HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B, PEAK].map(p => ({ x: p.x, z: p.z })),
  runways: RUNWAYS.map(r => ({ x: r.x, z: r.z, heading: r.heading, elev: r.elev })),
  canyon: CANYON_PATH.map(p => ({ x: p.x, z: p.z })),
};
function restoreClassicLayout() {
  [HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B, PEAK].forEach((p, i) => {
    p.x = CLASSIC.anchors[i].x; p.z = CLASSIC.anchors[i].z;
  });
  RUNWAYS.forEach((r, i) => {
    const c = CLASSIC.runways[i];
    r.x = c.x; r.z = c.z; r.heading = c.heading; r.elev = c.elev;
  });
  CANYON_PATH.length = 0;
  for (const p of CLASSIC.canyon) CANYON_PATH.push({ x: p.x, z: p.z });
  computeTribs(CLASSIC_TRIB_DEFS);
}
function generateLayout() {
  const R1 = (k) => h01(SEED * 0.00097 + k * 7.13);
  const jit = (k, a) => (R1(k) - 0.5) * a;
  const TAU = Math.PI * 2;
  // radii scale with the silhouette so features keep their distance to THEIR
  // stretch of shore — a squeezed side pulls its biome and strip inward with it
  const setP = (o, a, r) => { const s = shapeS(a); o.x = Math.sin(a) * r * s; o.z = Math.cos(a) * r * s; };
  const dAng = (u, v) => Math.abs(Math.atan2(Math.sin(u - v), Math.cos(u - v)));

  // biome compass: mountains / forest / desert / hills around a seeded rotation
  const aM = R1(1) * TAU;
  const aF = aM + TAU * 0.25 + jit(2, 0.5);
  const aD = aM + TAU * 0.50 + jit(3, 0.5);
  const aH = aM + TAU * 0.75 + jit(4, 0.5);
  setP(PEAK, aM + jit(5, 0.12), 2750 + jit(6, 600));
  setP(FOREST_C, aF, 3900 + jit(7, 800));
  setP(DESERT_C, aD, 3900 + jit(8, 800));
  setP(HILLS_C, aH, 3800 + jit(9, 800));
  const rdir = aM + Math.PI / 2 + jit(10, 0.6); // ridge runs tangentially through the peak
  MTN_A.x = PEAK.x - Math.sin(rdir) * 2300; MTN_A.z = PEAK.z - Math.cos(rdir) * 2300;
  MTN_B.x = PEAK.x + Math.sin(rdir) * 2300; MTN_B.z = PEAK.z + Math.cos(rdir) * 2300;

  // canyon: foothills -> sea, exiting 100-160 deg around from the mountains.
  // Segments 4..7 share one angle => an exactly straight run for the strip,
  // landing its midpoint near s 0.55 where cFl holds the 72 m floor.
  const sgn = R1(11) < 0.5 ? 1 : -1;
  const aCan = aM + sgn * Math.PI * (0.55 + R1(12) * 0.34);
  const aStart = aM + (aCan - aM) * 0.28;
  const N = 10;
  CANYON_PATH.length = 0;
  const aStraight = aStart + (aCan - aStart) * 0.58;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let a = aStart + (aCan - aStart) * t + (i > 0 && i < N ? jit(20 + i, 0.15) : 0);
    if (i >= 4 && i <= 7) a = aStraight;
    const cs = shapeS(a); // estuary hits the mask at the same s on any silhouette
    CANYON_PATH.push({ x: Math.sin(a) * (1700 + 6400 * t) * cs, z: Math.cos(a) * (1700 + 6400 * t) * cs });
  }

  // nudge a point clear of the gorge (strips need floor+wall+shoulder+pad room)
  function nudgeClear(o, margin) {
    for (let iter = 0; iter < 12; iter++) {
      let best = 1e18, nx = 0, nz = 0;
      for (let i = 0; i < CANYON_PATH.length - 1; i++) {
        const a = CANYON_PATH[i], b = CANYON_PATH[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
        let t = ((o.x - a.x) * dx + (o.z - a.z) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = a.x + dx * t, cz = a.z + dz * t;
        const d2 = (o.x - cx) * (o.x - cx) + (o.z - cz) * (o.z - cz);
        if (d2 < best) { best = d2; nx = cx; nz = cz; }
      }
      const d = Math.sqrt(best);
      if (d >= margin) return;
      const ux = d > 1 ? (o.x - nx) / d : 1, uz = d > 1 ? (o.z - nz) / d : 0;
      o.x += ux * (margin - d + 50); o.z += uz * (margin - d + 50);
    }
  }

  // Coast: shoreline, radial heading => final approach over open water. Pick
  // the first candidate angle clear of the canyon mouth and the mountains.
  const cands = [aH + 0.8 + jit(30, 0.3), aH - 0.8 + jit(31, 0.3), aD + 0.8 + jit(32, 0.3), aF - 0.8 + jit(33, 0.3)];
  let aC = cands[0];
  for (const c of cands) if (dAng(c, aCan) > 0.55 && dAng(c, aM) > 0.9) { aC = c; break; }
  setP(RUNWAYS[0], aC, 6050);
  RUNWAYS[0].heading = Math.atan2(RUNWAYS[0].x, RUNWAYS[0].z) + jit(34, 0.15);

  // Desert / Forest / Hills strips near their biome centers, clear of the gorge
  const themed = [[1, DESERT_C], [2, FOREST_C], [5, HILLS_C]];
  for (let k = 0; k < 3; k++) {
    const r = RUNWAYS[themed[k][0]], cen = themed[k][1];
    r.x = cen.x + jit(40 + k, 1400); r.z = cen.z + jit(44 + k, 1400);
    r.heading = R1(48 + k) * TAU;
    const rr = Math.hypot(r.x, r.z), rCap = 5100 * shapeS(Math.atan2(r.x, r.z));
    if (rr > rCap) { r.x *= rCap / rr; r.z *= rCap / rr; }
    nudgeClear(r, 1150);
  }

  // Summit: on the flank below the peak, axis across the slope; elevation
  // follows the seed's mountain height
  const aIn = Math.atan2(-PEAK.x, -PEAK.z);
  RUNWAYS[4].x = PEAK.x + Math.sin(aIn) * 810; RUNWAYS[4].z = PEAK.z + Math.cos(aIn) * 810;
  RUNWAYS[4].heading = aIn + Math.PI / 2 + jit(52, 0.2);
  RUNWAYS[4].elev = Math.round(465 * K_MTN);
  nudgeClear(RUNWAYS[4], 1150);

  // Canyon strip: dead-center on the straight run, aligned with it
  const p5 = CANYON_PATH[5], p6 = CANYON_PATH[6];
  RUNWAYS[3].x = (p5.x + p6.x) / 2; RUNWAYS[3].z = (p5.z + p6.z) / 2;
  const cux = p6.x - p5.x, cuz = p6.z - p5.z, cuL = Math.hypot(cux, cuz);
  RUNWAYS[3].heading = Math.atan2(-cux / cuL, -cuz / cuL);
  RUNWAYS[3].elev = 72; // cFl holds the floor at 72 across the strip zone

  // tributary gullies join upstream (wp 2) and near the mouth (wp 8), angled
  // off the local path direction; join floor tracks cFl at the junction
  const tribDefs = [];
  for (let k = 0; k < 2; k++) {
    const j = k === 0 ? 2 : 8;
    const J = CANYON_PATH[j], Jp = CANYON_PATH[j - 1];
    const segd = Math.atan2(J.x - Jp.x, J.z - Jp.z);
    const side = R1(60 + k) < 0.5 ? 1 : -1;
    const ta = segd + side * (1.35 + jit(62 + k, 0.5));
    const p1 = { x: J.x + Math.sin(ta) * 440, z: J.z + Math.cos(ta) * 440 };
    const ta2 = ta + jit(64 + k, 0.6);
    const p2 = { x: p1.x + Math.sin(ta2) * 440, z: p1.z + Math.cos(ta2) * 440 };
    tribDefs.push({ pts: [p2, p1, { x: J.x, z: J.z }], joinFl: cFl(j / N) - 8 });
  }
  computeTribs(tribDefs);
}
function rebuildDerived() {
  computeRunwayDerived();
  computeRidge();
  computeCanyonSegs();
  computePlatforms();
  computeCorridors();
}

// ---- shared feature masks (height field AND vertex colors read these, so the
// paint always lands exactly on the feature) ----
const DUNE_CA = Math.cos(0.42), DUNE_SA = Math.sin(0.42);
export function duneRidge(x, z) { // anisotropic ridges stretched along the prevailing wind axis
  const u = x * DUNE_CA + z * DUNE_SA, v = z * DUNE_CA - x * DUNE_SA;
  return 1 - Math.abs(fbm(u * 0.00062 + 3.3, v * 0.0036 + 9.1, 2));
}
export function desertWash(x, z) { // dendritic shallow washes along fbm zero-contours
  return 1 - smooth(0.02, 0.062, Math.abs(fbm(x * 0.00058 + 27.4, z * 0.00058 + 14.9, 2)));
}
export function outcropMask(x, z) { // scattered grey rock bosses in the woods
  return smooth(0.72, 0.8, noise2(x * 0.0019 + 55.5, z * 0.0019 + 21.2));
}
function terrace(t) { // 3 flat benches with smooth risers, for cliff-banded mesa flanks
  if (t <= 0) return 0;
  const u = Math.min(t, 0.9999) * 3, i = u | 0, f = u - i;
  return (i + smooth(0.55, 0.96, f)) / 3;
}

// ---- biome height fields (only evaluated where their region weight matters) ----
function hillsH(x, z) { // rolling swells + knolls, with shallow valley lines
  const b = fbm(x * 0.00095 + 7.3, z * 0.00095 + 3.1, 4) * 0.5 + 0.5;
  let h = 16 + Math.pow(b, 1.3) * 118 * K_HILL + fbm(x * 0.0042, z * 0.0042, 2) * 7;
  h += smooth(0.66, 0.8, noise2(x * 0.0013 + 31.2, z * 0.0013 + 8.4)) * 26 * K_HILL; // knolls
  h -= (1 - smooth(0.02, 0.09, Math.abs(fbm(x * 0.00052 + 13.7, z * 0.00052 + 4.9, 2)))) * 13; // valleys
  return h;
}
function desertH(x, z) { // directional dune ridges + banded mesas + shallow washes
  const b = fbm(x * 0.0014 + 11.2, z * 0.0014 + 5.6, 3) * 0.5 + 0.5;
  const mf = fbm(x * 0.00085 + 31.7, z * 0.00085 + 17.3, 3);
  let h = 10 + b * 48 + Math.pow(duneRidge(x, z), 1.7) * 18 * K_DUNE;
  h += terrace(smooth(0.30, 0.44, mf)) * 88 * K_MESA + smooth(0.47, 0.55, mf) * 26 * K_MESA;
  return h - desertWash(x, z) * 4.4;
}
function forestH(x, z) { // gentle wooded terrain to ~180 with rocky outcrops
  const b = fbm(x * 0.0011 + 2.2, z * 0.0011 + 9.9, 4) * 0.5 + 0.5;
  let h = 22 + Math.pow(b, 1.2) * 158 * K_FOR + fbm(x * 0.005 + 1.1, z * 0.005, 2) * 6;
  return h + outcropMask(x, z) * (9 + 8 * noise2(x * 0.02 + 6.6, z * 0.02 + 1.9));
}
function mtnH(x, z, w) { // ridged fbm range + explicit summit bump at PEAK
  const rv = 1 - Math.abs(fbm(x * 0.0016 + 5.5, z * 0.0016 + 1.5, 5));
  const dx = x - PEAK.x, dz = z - PEAK.z;
  const h = 55 + Math.pow(rv, 1.6) * 330 * K_MTN * w + 120 * K_MTN * w
    + 290 * K_MTN * Math.exp(-(dx * dx + dz * dz) / 384400);
  const cap = 560 * K_MTN; // soft ceiling scales with the seed's mountain knob
  return h > cap ? cap + (h - cap) * 0.55 : h;
}

// noise-warped region weights around the biome anchors (module scratch, no alloc)
export let _wH = 0, _wD = 0, _wF = 0, _wM = 0;
export function biomeWeights(x, z) {
  const wx = x + (noise2(x * 0.00034 + 9.1, z * 0.00034 + 4.4) - 0.5) * 2300;
  const wz = z + (noise2(x * 0.00034 + 1.7, z * 0.00034 + 8.2) - 0.5) * 2300;
  _wH = 1 - smooth(1500, 4300, Math.hypot(wx - HILLS_C.x, wz - HILLS_C.z));
  _wD = 1 - smooth(1700, 4300, Math.hypot(wx - DESERT_C.x, wz - DESERT_C.z));
  _wF = 1 - smooth(1600, 4200, Math.hypot(wx - FOREST_C.x, wz - FOREST_C.z));
  _wM = 1 - smooth(650, 4200, ridgeDist(wx, wz)); // long tail: foothills roll out into the plains
}

function baseHeight(x, z) {
  const r2 = x * x + z * z;
  if (r2 > SH_R2OUT) return -20; // beyond the shelf everything has bottomed out
  const rr = Math.sqrt(r2) + (noise2(x * 0.00028 + 3.1, z * 0.00028 + 7.7) - 0.5) * COAST_WARP;
  const RM = SH_ON ? R_MASK * shapeS(Math.atan2(x, z)) : R_MASK;
  const m = 1 - (rr / RM) * (rr / RM);
  if (m <= 0) return Math.max(-20, -6 + m * 44); // underwater falloff to about -20
  biomeWeights(x, z);
  let sum = 0.06, h = 0.06 * 16; // faint generic-lowland floor bridges region gaps
  if (_wH > 0.012) { h += _wH * hillsH(x, z); sum += _wH; }
  if (_wD > 0.012) { h += _wD * desertH(x, z); sum += _wD; }
  if (_wF > 0.012) { h += _wF * forestH(x, z); sum += _wF; }
  if (_wM > 0.012) { h += _wM * mtnH(x, z, _wM); sum += _wM; }
  h = (h / sum) * Math.min(1, Math.pow(m, 0.85) * 1.3) - 6 + m * 12; // beach band at the rim
  // island-wide relief, faded at the shore: domain-warped mid-frequency rolling
  // (~300-900 m, +-15-35 m, halved in the already-ridged mountains), a small
  // detail layer (~45-95 m, +-3-6 m) so low-level flight reads speed, and a
  // subtle sand berm just above the waterline
  const mSh = smooth(0.03, 0.22, m);
  if (mSh > 0.01) {
    const rx = x + (noise2(x * 0.00085 + 21.4, z * 0.00085 + 3.3) - 0.5) * 640;
    const rz = z + (noise2(x * 0.00085 + 7.9, z * 0.00085 + 15.2) - 0.5) * 640;
    h += fbm(rx * 0.00135 + 4.7, rz * 0.00135 + 8.3, 3) * 40 * K_REL * (1 - 0.5 * _wM) * mSh;
    // seeded broad swells (~2.4 km wavelength): whole districts rise into
    // uplands or sink toward the sea — can pool inland lakes in deep dips.
    // Zero on the classic island; damped in the mountains (already tall).
    if (K_SWELL > 0) h += fbm(x * 0.00042 + 31.9, z * 0.00042 + 18.4, 2) * 34 * K_SWELL * (1 - 0.55 * _wM) * mSh;
    h += fbm(x * 0.0105 + 2.9, z * 0.0105 + 5.7, 2) * 7 * mSh;
    h += smooth(0.7, 2.2, h) * (1 - smooth(3.6, 6.5, h)) * (1.9 + noise2(x * 0.01 + 4.4, z * 0.01 + 0.8) * 1.4);
    // per-biome micro-detail — wavelengths only the 5 m tiled mesh can show
    // (the 31 m static grid aliased everything under ~60 m, so this layer was
    // pointless before dynamic terrain). Added BEFORE platforms/corridors/
    // flattening so strips and approaches stay graded by construction.
    if (_wM > 0.02) { // sharp rock crests + fine talus on the range
      const rk = 1 - Math.abs(fbm(x * 0.0074 + 17.1, z * 0.0074 + 6.3, 3));
      h += (rk * rk * 21 + fbm(x * 0.021 + 8.8, z * 0.021 + 2.4, 2) * 5) * _wM * mSh;
    }
    if (_wD > 0.02) { // wind ripples riding the big dunes, same prevailing axis
      const u = x * DUNE_CA + z * DUNE_SA, v = z * DUNE_CA - x * DUNE_SA;
      h += (1 - Math.abs(noise2(u * 0.0022 + 1.2, v * 0.03 + 7.5) * 2 - 1)) * 1.9 * _wD * mSh;
    }
    if (_wF > 0.02) h += fbm(x * 0.017 + 4.1, z * 0.017 + 12.6, 2) * 3.4 * _wF * mSh; // hummocky woods floor
    if (_wH > 0.02) h += fbm(x * 0.012 + 9.7, z * 0.012 + 0.6, 2) * 2.6 * _wH * mSh;  // grassy micro-rolls
  }
  if (canyonLocate(x, z)) { // gorge fades out with the island mask, so any
    const hc = carveCanyon(x, z, h); // seed's estuary meets the sea without a step
    h = hc + (h - hc) * (1 - smooth(0.02, 0.10, m));
  }
  h = carveTribs(x, z, h);
  h = applyPlatforms(x, z, h);
  return applyCorridors(x, z, h);
}

export function heightAt(x, z) {
  return applyRunwayFlattening(x, z, baseHeight(x, z));
}

// reused result object — callers copy fields, never retain the reference
const _surf = { h: 0, type: 'grass' };
export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  _surf.h = h;
  _surf.type = onRunway(x, z) ? 'runway' : h <= 0.05 ? 'water' : 'grass';
  return _surf;
}
