import { fbm as fbm_, noise2 as noise2_, pnoise2 as pnoise2_ } from './noise.js';

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
let K_ROLL = 0;  // v6.1 rolling-ground amplitude — gen islands are NEVER flat
// island SILHOUETTE: direction-dependent radius scale built from 1-3 angular
// lobes — elongated, egg/comma, tri-lobed and bay-bitten outlines per seed.
// SH_ON false (classic) keeps the plain circular mask, bit for bit.
let SH_ON = false, SH_A1 = 0, SH_P1 = 0, SH_A2 = 0, SH_P2 = 0, SH_A3 = 0, SH_P3 = 0;
let SH_R2OUT = 75690000; // beyond-the-shelf early-out radius², shape-aware
// seeded islands are scaled to 75% so the widest silhouette lobe + coast warp
// stays well inside the baked far shell (+-7800) — land past the shell edge
// has no ground mesh under it and shimmers. Heights do NOT scale: same peaks,
// same swells, just a tighter island. Classic seed 0 keeps 7200 / scale 1.
let RM_BASE = 7200, LSCALE = 1;
let GEN_ON = false; // seed!=0: v6 feature-grammar islands (classic template retired)
function shapeS(theta) {
  const s = 1 + SH_A1 * Math.sin(theta + SH_P1) + SH_A2 * Math.sin(2 * theta + SH_P2) + SH_A3 * Math.sin(3 * theta + SH_P3);
  return s < 0.6 ? 0.6 : s > 1.3 ? 1.3 : s;
}
function h01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function setTerrainSeed(seed) {
  SEED = seed >>> 0;
  if (SEED === 0) {
    SX = SZ = 0; K_MTN = K_MESA = K_DUNE = K_HILL = K_FOR = K_REL = 1; K_SWELL = 0; K_ROLL = 0; COAST_WARP = 760;
    K_RANGE = 0.00021; K_THR = 0.55; K_ERO = 0; RIV_W = 0;
    SH_ON = false; SH_R2OUT = 75690000; RM_BASE = 7200; LSCALE = 1; GEN_ON = false; // classic island
    restoreClassicLayout(); // hand-tuned anchors, runways, canyon, tribs
  } else {
    SX = (h01(SEED * 0.013 + 11.7) - 0.5) * 30000;
    SZ = (h01(SEED * 0.017 + 23.1) - 0.5) * 30000;
    K_MTN  = 0.70 + 1.05 * h01(SEED * 0.019 + 5.2);  // peaks ~480-1200
    K_MESA = 0.60 + 1.30 * h01(SEED * 0.023 + 8.6);
    K_DUNE = 0.70 + 1.30 * h01(SEED * 0.029 + 2.9);
    K_HILL = 0.70 + 1.10 * h01(SEED * 0.031 + 14.3);
    K_FOR  = 0.70 + 1.00 * h01(SEED * 0.037 + 6.8);
    K_REL  = 0.70 + 1.60 * h01(SEED * 0.041 + 9.4); // uplands 165-540 m before mountains
    K_RANGE = 0.00024 + 0.00018 * h01(SEED * 0.089 + 15.8); // one great range ... 3-4 massifs
    K_THR = 0.48 + 0.16 * h01(SEED * 0.097 + 21.2); // how much land the ranges claim
    K_ERO = 0.3 + 0.45 * h01(SEED * 0.101 + 7.4);   // gully-band strength
    ERO_SOFT = 0.2 + 1.0 * h01(SEED * 0.103 + 18.6); // soft rounded ... sharp stepped
    RIV_W = h01(SEED * 0.107 + 2.3) < 0.25 ? 0 : 0.012 + 0.014 * h01(SEED * 0.109 + 9.9); // some islands riverless
    LSCALE = 0.75; RM_BASE = 7200 * LSCALE; // 5400 — tighter island, same heights
    K_SWELL = 0.50 + 1.60 * h01(SEED * 0.047 + 12.1); // broad rolling uplands, +-17..70 m
    K_ROLL = 38 + 37 * h01(SEED * 0.083 + 6.6); // 38-75 m rolling ground under everything
    COAST_WARP = (700 + 500 * h01(SEED * 0.043 + 3.6)) * LSCALE; // ragged shore, scaled with the island
    SH_ON = true; // seeded silhouette: comma / elongated / tri-lobed outlines
    SH_A1 = 0.26 * h01(SEED * 0.053 + 4.9); SH_P1 = Math.PI * 2 * h01(SEED * 0.059 + 7.7);
    SH_A2 = 0.30 * h01(SEED * 0.061 + 1.4); SH_P2 = Math.PI * 2 * h01(SEED * 0.067 + 9.8);
    SH_A3 = 0.18 * h01(SEED * 0.071 + 3.2); SH_P3 = Math.PI * 2 * h01(SEED * 0.073 + 6.5);
    SH_R2OUT = 61000000; // r ~7.8 km: widest lobe (5400*1.3) + warp stays inside the shell
    GEN_ON = true;
    generateIsland(); // compose a fresh island from big features + discovered strips
  }
  rebuildDerived();
}
export function getTerrainSeed() { return SEED; }
// seeded noise: same functions, shifted domain. Exported so colorcore paints
// with the SAME fields (canyon bench jitter etc. must match the geometry).
export function seededNoise2(x, z) { return noise2_(x + SX, z + SZ); }
const noise2 = seededNoise2;
const fbm = (x, z, o) => fbm_(x + SX, z + SZ, o);
const pnoise = (x, z) => pnoise2_(x + SX, z + SZ);

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

// ---- ridged relief: what turns round fBm blobs into land ----
// Plain fBm is isotropic. Every hill comes out a dome, slopes are convex in all
// directions, and water has nowhere to go — the eye reads it as blobs, not
// terrain. Ridged noise peaks along the field's ZERO CONTOURS instead, and a
// zero contour is a connected line, so you get ridgelines that run and branch,
// spurs coming off them, and the ground between two ridges falling into a
// valley. That is the whole difference between our hills and a real hillside.
//
// Octave coupling (each octave scaled by the previous octave's ridge value) is
// what makes ridges branch rather than corrugate: detail piles onto high ground
// and valley floors stay smooth, which is also how erosion actually works.
//
// Two continuity rules, both learned the hard way here:
//   - the abs is SMOOTHED (sqrt(n²+eps²)), because a raw abs creases along its
//     zero contour and an unsmoothed crease aliases into a dashed hairline at
//     coarse LOD — the same fix the mountain term already carries;
//   - the octave weight is a smooth ramp, never a min()/clamp. A clamp puts a
//     slope discontinuity wherever it saturates, and that discontinuity is
//     multiplied into the next octave's amplitude, which draws exactly the kind
//     of contour line this codebase has been bitten by twice.
// Returns [0,1], mean ~0.34.
// Octave count and falloff matter more than they look. Four octaves at the
// usual 0.5 falloff lays four INDEPENDENT ridge networks over each other and
// the long lines mash into cellular blobs — the exact isotropic look we are
// trying to escape. Three octaves at 0.38, with the coupling nearly zeroing
// detail off-ridge, keeps one dominant ridge network and hangs spurs off it.
function ridgedMF(x, z, f, oct) {
  let sum = 0, norm = 0, amp = 0.5, freq = f, w = 1;
  for (let i = 0; i < oct; i++) {
    const n = pnoise(x * freq, z * freq);
    let r = 1 - Math.sqrt(n * n + 0.0016); // smoothed |n|, crest rounded ~0.04 wide
    r *= r;                                // square: narrow the crest, widen the flanks
    sum += r * w * amp;
    norm += amp;
    w = 0.1 + 0.9 * r;                     // smooth coupling, no clamp
    amp *= 0.38; freq *= 2.07;
  }
  return sum / norm;
}
// Domain-warped ridges, so ridgelines wander like real ones instead of running
// as straight parallel corrugations. Centred on the field's MEASURED mean
// (0.524 over a 16 km sample at these octave settings) so that adding this layer
// reshapes the ground without raising the whole island — get this wrong and
// every coastline moves.
const RIDGE_MEAN = 0.524;
function ridgeRelief(x, z, f, oct, wa, k) {
  const wx = x + (noise2(x * 0.00031 + k, z * 0.00031 + k * 0.7) - 0.5) * wa;
  const wz = z + (noise2(x * 0.00031 + k * 1.9, z * 0.00031 + k * 1.3) - 0.5) * wa;
  return ridgedMF(wx, wz, f, oct) - RIDGE_MEAN;
}
// Unwarped variant for the fine gully layer: at a ~180 m wavelength the warp is
// smaller than the feature it is bending and buys nothing visible, while costing
// two noise samples in the hottest function in the project.
function ridgeReliefF(x, z, f, oct) {
  return ridgedMF(x, z, f, oct) - RIDGE_MEAN;
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
  // ONE noise sample for all corridors: it only depends on position, and this
  // runs inside heightAt for every vertex on the island.
  // Wandering the lane sideways breaks the ruler-straight edges — a graded
  // approach should read as a natural gap between hills, not a runway-length
  // scar ruled across the terrain.
  const warp = (noise2(x * 0.0042 + 31.7, z * 0.0042 + 12.3) - 0.5) * 78;
  for (let i = 0; i < CORRIDORS.length; i++) {
    const c = CORRIDORS[i];
    const dx = x - c.ox, dz = z - c.oz;
    const along = dx * c.ux + dz * c.uz;
    if (along < 0 || along > c.len) continue;
    const lat = Math.abs(dx * c.uz - dz * c.ux + warp);
    if (lat >= c.hw) continue;
    const cap = c.base + along * 0.065;
    const over = h - cap;
    if (over <= 0) continue;
    // SOFT ONSET. `h += (cap - h)` switched on the instant h passed the cap,
    // so the cut had a slope crease exactly along the h == cap contour — a
    // long thin line winding across every hillside near a strip. over²/(over+6)
    // starts with zero value AND zero slope at the contour, so the cut fades
    // in; it costs at most ~6 m of residual clearance, inside the tolerance
    // approachOK already allows.
    const cut = over * over / (over + 3.5);
    // wide lateral falloff: any trimming reads as a natural saddle, not a
    // slot with walls (site selection already avoids big cuts — see siteOK)
    h -= cut * (1 - smooth(c.hw * 0.3, c.hw, lat)) * (1 - smooth(c.len - 500, c.len, along));
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
  runways: RUNWAYS.map(r => ({ ...r })), // full copies — seeded islands vary the strip COUNT
  canyon: CANYON_PATH.map(p => ({ x: p.x, z: p.z })),
};
function restoreClassicLayout() {
  [HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B, PEAK].forEach((p, i) => {
    p.x = CLASSIC.anchors[i].x; p.z = CLASSIC.anchors[i].z;
  });
  RUNWAYS.length = 0;
  for (const c of CLASSIC.runways) RUNWAYS.push({ ...c });
  CANYON_PATH.length = 0;
  for (const p of CLASSIC.canyon) CANYON_PATH.push({ x: p.x, z: p.z });
  computeTribs(CLASSIC_TRIB_DEFS);
}
// ---- v7: layered-noise terrain — the recipe (nearly) every game uses ----
// No hand-placed landforms. Elevation = domain-warped fBm pushed through a
// redistribution curve (gentle lowland common, uplands rare), plus ridged-fBm
// MOUNTAINS confined to seeded range regions of a low-frequency mask, with a
// soft height ceiling. Detail exists at every scale because the octaves carry
// it — nothing can read as stamped, terraced or flat. Lakes are found (calm
// low ground), not invented. Strips are discovered on the result.
const LAKES = []; // {x, z, rx, rz, c, s, d} soft elliptical depressions
let MTN_AMP = 0;  // per-seed ridge crest budget
// range-region shape: frequency sets HOW MANY separate massifs fit on the
// island (low = one great range, high = 3-4 scattered ones); threshold sets
// how much land they claim. A second mask family at 1.7x frequency adds
// independent smaller massifs, so multi-mountain islands are common.
let K_RANGE = 0.00021, K_THR = 0.55;
// erosion + rivers (after Simon Storl-Schulke's three.js infinite terrain:
// terraced gully bands = smoothstepped PINGPONGED noise as a multiplier, and
// rivers = channels along |fbm| zero-contours, cut below the water plane)
let K_ERO = 0, ERO_SOFT = 0.6, RIV_W = 0; // 0 = off (classic island)
// The mask's transition band is the real slope budget: the whole ridge budget
// (up to ~850 m) is multiplied in across it, so a narrow band stands the range
// up like a wall out of flat ground — that, not the ridge noise, was making the
// near-vertical white flanks. Widening the band spreads the same rise over
// roughly twice the ground and costs no peak height at all.
function rangeMask(x, z) {
  const r1 = smooth(K_THR - 0.14, K_THR + 0.44, fbm(x * K_RANGE + 51.7, z * K_RANGE + 17.3, 2) * 0.5 + 0.5);
  const r2 = smooth(0.46, 0.90, fbm(x * K_RANGE * 1.7 + 88.3, z * K_RANGE * 1.7 + 41.9, 2) * 0.5 + 0.5);
  return Math.max(r1, r2 * 0.85);
}
let ARCH = 0;
const ARCH_NAMES = ['ROLLING', 'HIGHLAND', 'MOUNTAIN'];
export function islandInfo() { return { archetype: ARCH_NAMES[ARCH], strips: RUNWAYS.length }; }

// ---- terrain CHARACTER: what stops one island being one formula ----
// Every relief term below scales with `dist` and with h — but both of those are
// about HOW HIGH the ground is, not what KIND of ground it is. So at any given
// elevation the whole island got the same gullies at the same strength, and
// flying across it you passed the same hillside over and over.
//
// These two fields vary the STYLE instead of the amount, at ~3.5 km so they are
// district-sized: you fly out of smooth downs into rugged gullied country, and
// over tableland that breaks into benches. They are deliberately independent of
// each other and of `dist`, so height and character do not correlate — rugged
// lowland and smooth uplands both exist.
function charRough(x, z) { // 0 = smooth downs, 1 = heavily gullied
  return smooth(-0.5, 0.5, fbm(x * 0.00029 + 63.7, z * 0.00029 + 24.1, 2));
}
function charBench(x, z) { // 0 = rounded, 1 = stepped tableland
  return smooth(0.42, 0.78, noise2(x * 0.00024 + 12.9, z * 0.00024 + 51.3));
}

function genTerrainHeight(x, z) {
  const r2 = x * x + z * z;
  if (r2 > SH_R2OUT) return -20;
  const rr = Math.sqrt(r2) + (noise2(x * 0.00028 + 3.1, z * 0.00028 + 7.7) - 0.5) * COAST_WARP;
  const RM = RM_BASE * shapeS(Math.atan2(x, z));
  const m = 1 - (rr / RM) * (rr / RM);
  if (m <= 0) return Math.max(-20, -6 + m * 44);
  // base elevation: warp -> 6-octave fBm -> redistribution curve.
  // The linear term keeps lowlands alive (~rolling 15-45 m), the power term
  // makes uplands rare and tall.
  const wx = x + (noise2(x * 0.0002 + 31.4, z * 0.0002 + 8.8) - 0.5) * 1800;
  const wz = z + (noise2(x * 0.0002 + 3.9, z * 0.0002 + 21.6) - 0.5) * 1800;
  const e = fbm(wx * 0.00035 + 5.5, wz * 0.00035 + 1.5, 6) * 0.5 + 0.5;
  // district multiplier: whole neighborhoods sit high or low (~5 km, x0.62-1.47)
  const dist = 0.62 + 0.85 * (fbm(x * 0.00013 + 15.9, z * 0.00013 + 71.2, 2) * 0.5 + 0.5);
  let h = 4 + K_ROLL * 0.62 * e * 2.4 + 260 * K_REL * Math.pow(e, 2.6) * dist;
  // medium relief: hills riding on the base (~600 m wavelength, +-16..50 m).
  // Mostly RIDGED now — the round fBm is kept at partial weight so slopes still
  // have some softness between the crests, but the shape of the hill comes from
  // the ridge field. Faded out below ~25 m so the coastal flats and the beach
  // contour stay smooth (a ridge crossing the waterline serrates it).
  const rough = charRough(x, z), bench = charBench(x, z);
  const relAmp = (16 + 22 * (K_REL - 0.7)) * dist;
  h += fbm(x * 0.0016 + 40.4, z * 0.0016 + 12.7, 3) * relAmp * 0.45;
  // ridge strength now swings 0.4x .. 1.8x across the island rather than sitting
  // at one value everywhere
  h += ridgeRelief(x, z, 0.0010, 3, 900, 6.3) * relAmp * 4.5 * (0.55 + 0.75 * rough) * smooth(2, 25, h);
  // close detail: the texture you read at low level (~160 m, grows with ground).
  // Faded out below ~9 m so it can't wiggle the waterline into sawtooth —
  // beaches and the shoreline contour stay smooth curves.
  h += fbm(x * 0.006 + 3.2, z * 0.006 + 55.8, 2) * (3.5 + Math.min(6.5, h * 0.04)) * smooth(1.5, 9, h);
  // FINE GULLY RIDGING — the layer you actually read at low level. The big ridge
  // field above shapes hills at a kilometre; this one puts the 80-200 m spurs and
  // draws on their flanks, which is what stops a hillside reading as a painted
  // dome when you are 300 m over it. Scaled with height so lowland stays gentle,
  // and held off the shore so the waterline contour stays smooth.
  // FINE DRAINAGE. This layer used the ridge field CENTRED, so it added as much
  // as it subtracted — and at a 180 m wavelength a field that bumps up and down
  // everywhere reads as a carpet of rounded worms, not as terrain. It was most of
  // why the ground looked like one formula stamped over the whole island.
  //
  // A hillside is mostly smooth slope with occasional incised draws, so keep only
  // the negative half and let it CUT. The smoothstep weight is what makes that
  // safe: a bare max(0, ·) creases along its own zero contour, and a crease
  // scaled by tens of metres is exactly the dashed hairline this codebase has
  // been bitten by twice. Weighting by the depth itself gives zero value AND
  // zero slope at the contour.
  // Cut along the ridge field's PEAKS, not its troughs. The peaks trace the
  // noise's zero contours, which are connected LINES — exactly the shape a draw
  // wants. The troughs are the broad regions between those lines, so cutting
  // there gave a hillside pocked with isolated round craters. Cubing keeps the
  // term near zero off the line and sharp on it, and it is smooth everywhere so
  // nothing creases.
  // Depth is the whole difference between drainage and brain coral: at ~85 m of
  // cut the channels stop being draws in a hillside and become a maze with walls.
  // A draw is a shallow feature — a few tens of metres at most — and the eye
  // reads the NETWORK, not the depth.
  const line = ridgeReliefF(x, z, 0.0042, 2) + RIDGE_MEAN;
  h -= line * line * line * (13 + Math.min(23, h * 0.085))
    * (0.3 + 0.8 * rough) * smooth(6, 40, h);
  // TABLELAND. Where the bench field is high, part of the elevation is quantised
  // into steps: flat benches with short risers between them, the shape you get
  // from horizontally bedded rock rather than from soil creep. The same
  // continuous-terrace construction the desert mesas use — (i + smoothstep(frac))
  // stays C0 across every step boundary, so there is no cliff-line artifact, just
  // a flat tread and a steep riser. Held off low ground so beaches and coastal
  // flats keep their smooth contours.
  if (bench > 0.02) {
    const stepH = 34 + 26 * noise2(x * 0.00041 + 7.3, z * 0.00041 + 19.7);
    const t = h / stepH, i = Math.floor(t), fr = t - i;
    const stepped = (i + smooth(0.52, 0.94, fr)) * stepH;
    h += (stepped - h) * bench * 0.6 * smooth(45, 110, h);
  }
  // mountains: ridged fBm, only inside the range regions, favoring high base
  const rmk = rangeMask(x, z);
  if (rmk > 0.01) {
    // smoothed |fbm|: the raw abs has a C0 crease along its zero-contour, and
    // at the mask FRINGE (rmk ~0.02) that crease still scales by MTN_AMP into
    // a 3-7 m knife-edge wrinkle winding across the foothill grass — renders
    // as a dashed dark hairline at every LOD. sqrt(f²+ε²) rounds the crest
    // (~25 m radius); dividing by (1-ε) keeps full peaks at their height.
    // 0.00085 put a full ridge cycle in ~1.2 km, so a 900 m crest climbed its
    // own height in 600 m — 55 deg flanks and, once the soft ceiling flattened
    // the top, a smooth white dome with near-vertical walls. Broadening the
    // field spreads the SAME height over half again the distance.
    const rf = fbm(x * 0.00055 + 9.1, z * 0.00055 + 4.7, 4);
    const rv = Math.max(0, (1 - Math.sqrt(rf * rf + 0.001225)) / 0.965); // sqrt>1 at |fbm|→1 would NaN the pow
    // smooth(0.01,0.05,·) zeroes the term EXACTLY at the skip gate: the raw
    // rmk>0.01 cutoff stepped the ground 0.5-3 m along the whole mask contour
    // — a dashed hairline sweeping across the foothills (dashes = the step
    // height oscillating with rv along the boundary).
    h += rmk * smooth(0.01, 0.05, rmk) * Math.pow(rv, 1.9) * MTN_AMP * (0.55 + 0.45 * e);
  }
  // erosion bands (Storl-Schulke): smoothstep -> biome-softness power ->
  // pingpong triangle -> height-scaled multiplier. Carves terraced gullies
  // and sediment ledges into slopes; the higher the ground, the harder it
  // erodes; never cuts more than ~40% so ridgelines survive.
  if (K_ERO > 0 && h > 30) {
    const en = fbm(x * 0.0008 + 61.2, z * 0.0008 + 27.8, 3) * 0.5 + 0.5;
    let ero = Math.pow(en * en * (3 - 2 * en), 1 + ERO_SOFT);
    ero = 1 - Math.abs((ero * 2) % 2 - 1); // pingpong to a banded triangle wave
    ero = ero * ero * (3 - 2 * ero);       // round the triangle: its corners are
                                           // slope discontinuities, and scaled by
                                           // height they read as creased terraces
    const eStr = K_ERO * Math.min(1, h / 300);
    h *= 1 - eStr + eStr * (0.5 + 0.5 * ero);
  }
  // rivers: winding channels along |fbm| zero-contours. On low ground the
  // floor dips to -2.2 so the water plane fills them (real waterways); higher
  // up they become dry valleys and fade out before the mountains.
  if (RIV_W > 0 && h > 8 && h < 220) { // >8: stop short of the beach so broad
    const rn = Math.abs(fbm(x * 0.00052 + 91.3, z * 0.00052 + 44.9, 4)); // coastal flats can't flood into lagoons
    // SLOPE-LIMITED valleys, not slots. Three rules, all continuous in h:
    // (1) depth is capped (9 + 0.6h, max 24) — no more sea-level canyons
    //     through 40 m hills (the old h<45 floor branch also JUMPED ~37 m at
    //     that contour, drawing a cliff line across the island);
    // (2) the bank edge WIDENS with depth (~2.3 m of span per metre of cut)
    //     so wall slope stays ~25 deg — every LOD ring resolves it; narrower
    //     profiles rendered as serrated whole-cell teeth along the rims;
    // (3) water fill (floor < 0) only where the banks are lower than ~20 m.
    if (rn < RIV_W * 8.5) {
      const cut = Math.min(24, 9 + h * 0.6);
      const floor = Math.max(-2.2, h - cut);
      const depth = h - floor;
      let riv = 1 - smooth(RIV_W * 1.4, RIV_W * (1.9 + depth * 0.27), rn);
      if (riv > 0) {
        riv = riv * riv * (3 - 2 * riv);
        h += (floor - h) * riv * smooth(8, 13, h) * (1 - smooth(90, 220, h));
      }
    }
  }
  if (h > 1000) h = 1000 + (h - 1000) * 0.65; // soft ceiling: tallest seeds ~1350
  h *= Math.min(1, Math.pow(m, 0.8) * 1.4); // island mask
  h += smooth(0.7, 2.2, h) * (1 - smooth(3.6, 6.5, h)) * (1.9 + noise2(x * 0.01 + 4.4, z * 0.01 + 0.8) * 1.4);
  // swash step: steepen the last half-meter into the sea — on a near-flat
  // beach the 5 m flat-shaded facets crossing y=0 zigzag the waterline by
  // meters; a steeper contact slope shrinks that below visible size
  h -= 1.4 * (1 - smooth(-0.2, 0.9, h));
  for (let i = 0; i < LAKES.length; i++) {
    const L = LAKES[i];
    const dx = x - L.x, dz = z - L.z;
    const eL = Math.hypot((dx * L.c - dz * L.s) / L.rx, (dx * L.s + dz * L.c) / L.rz);
    const w = 1 - smooth(0.55, 1.05, eL);
    if (w > 0) h += (Math.min(h, -L.d) - h) * w; // soft shores, floor below the water plane
  }
  return h;
}
function baseHeightGen(x, z) {
  return applyCorridors(x, z, applyPlatforms(x, z, genTerrainHeight(x, z)));
}

function biomeWeightsGen(x, z) { // standard moisture-map biomes + the range mask
  const rmk = rangeMask(x, z); // MUST match the geometry's mask or paint drifts
  const mo = fbm(x * 0.00028 + 77.7, z * 0.00028 + 33.1, 2) * 0.5 + 0.5; // moisture field
  _wM = rmk;                                          // rock/snow where the ranges are
  _wF = smooth(0.55, 0.72, mo) * (1 - rmk * 0.7);     // forests in the wet zones
  _wD = (1 - smooth(0.3, 0.45, mo)) * (1 - rmk);      // deserts in the dry zones
  _wH = 0.34;                                         // grass fills the rest
}

// name pools per site character; first unused name wins, then roman suffixes
const NAME_POOLS = {
  coast: ['Bay', 'Shore', 'Cove', 'Sands'],
  high: ['Rim', 'Col', 'Crag', 'Shelf'],
  desert: ['Dunes', 'Mesa', 'Flats'],
  forest: ['Glade', 'Pines'],
  open: ['Meadow', 'Downs', 'Field', 'Vale'],
};
function pickName(pool, used) {
  for (const n of NAME_POOLS[pool]) if (!used.has(n)) { used.add(n); return n; }
  for (let i = 2; ; i++) {
    const n = NAME_POOLS[pool][0] + ' ' + 'II III IV V VI'.split(' ')[i - 2];
    if (!used.has(n)) { used.add(n); return n; }
  }
}

function generateIsland() {
  const R1 = (k) => h01(SEED * 0.00131 + k * 3.77);
  const jit = (k, a) => (R1(k) - 0.5) * a;
  const TAU = Math.PI * 2;
  const place = (a, rFrac) => { // absolute point at a fraction of the local shore radius
    const r = RM_BASE * shapeS(a) * rFrac;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r };
  };
  CANYON_PATH.length = 0; computeTribs([]); // v7 has no gorge (the classic island keeps its own)
  RUNWAYS.length = 0;
  LAKES.length = 0;

  // ---- v7 probe: the terrain is pure noise, so LEARN it instead of placing it.
  // One grid pass finds vegetation anchors, calm low ground for lakes, the
  // highest summit, and how mountainous the island came out.
  MTN_AMP = (340 + R1(92) * 520) * K_MTN; // ridge crest budget: meek 240 ... mighty 1500
  let peakH = -1e9, px = 0, pz = 0;
  let mtnCells = 0, landCells = 0;
  let bestF = 0, fx = 0, fz = 0, bestD = 0, dx0 = 0, dz0 = 0, bestH = 0, hx0 = 0, hz0 = 0;
  const lakeCand = [];
  const step = RM_BASE * 0.052;
  for (let gx = -13; gx <= 13; gx++) for (let gz = -13; gz <= 13; gz++) {
    const x = gx * step + jit(500 + gx * 27 + gz, step * 0.5);
    const z = gz * step + jit(560 + gx * 27 + gz, step * 0.5);
    const h = genTerrainHeight(x, z);
    if (h < 4) continue;
    landCells++;
    if (h > peakH) { peakH = h; px = x; pz = z; }
    biomeWeightsGen(x, z);
    if (_wM > 0.45) mtnCells++;
    if (_wF > bestF && h > 15 && h < 240) { bestF = _wF; fx = x; fz = z; }
    if (_wD > bestD && h > 10 && h < 160) { bestD = _wD; dx0 = x; dz0 = z; }
    if (_wH > bestH && h > 12 && h < 120) { bestH = _wH; hx0 = x; hz0 = z; }
    if (h > 10 && h < 42) { // lake candidates: low AND locally calm
      let lo = h, hi = h;
      for (const o of [[520, 0], [-520, 0], [0, 520], [0, -520]]) {
        const hh = genTerrainHeight(x + o[0], z + o[1]);
        if (hh < lo) lo = hh; if (hh > hi) hi = hh;
      }
      if (hi - lo < 24) lakeCand.push({ x, z });
    }
  }
  PEAK.x = px; PEAK.z = pz; // vegetation anchors follow the probed terrain
  MTN_A.x = px - 700; MTN_A.z = pz; MTN_B.x = px + 700; MTN_B.z = pz;
  FOREST_C.x = fx; FOREST_C.z = fz;
  HILLS_C.x = hx0; HILLS_C.z = hz0;
  if (bestD > 0.32) { DESERT_C.x = dx0; DESERT_C.z = dz0; }
  else { const o = place(R1(97) * TAU, 2.2); DESERT_C.x = o.x; DESERT_C.z = o.z; } // wet island: cacti sampler finds only sea
  const mtnCover = landCells ? mtnCells / landCells : 0;
  ARCH = mtnCover > 0.2 ? 2 : mtnCover > 0.07 ? 1 : 0; // MOUNTAIN / HIGHLAND / ROLLING

  // 0-2 lakes where the ground was already low and calm
  const nLakes = Math.floor(R1(98) * 2.999);
  for (let k = 0; k < nLakes && lakeCand.length > 0; k++) {
    const pick = lakeCand[Math.floor(R1(99 + k) * lakeCand.length) % lakeCand.length];
    let ok = true;
    for (const L of LAKES) if (Math.hypot(pick.x - L.x, pick.z - L.z) < 2300) ok = false;
    if (!ok) continue;
    const rot = R1(102 + k) * TAU;
    LAKES.push({ x: pick.x, z: pick.z, rx: 430 + R1(104 + k) * 380, rz: 300 + R1(106 + k) * 260,
      c: Math.cos(rot), s: Math.sin(rot), d: 6 + R1(108 + k) * 5 });
  }
  // ---- strip discovery: 4-8 sites found on the RAW terrain ----
  const used = new Set();
  const N = 4 + Math.floor(R1(120) * 4.999);
  const sep2 = 1500 * 1500;
  const farFromStrips = (x, z) => {
    for (const r of RUNWAYS) { const dx = x - r.x, dz = z - r.z; if (dx * dx + dz * dz < sep2) return false; }
    return true;
  };
  const siteOK = (x, z, heading, len, maxDev) => {
    if (CANYON_PATH.length > 1 && canyonLocate(x, z) && _cd < 950) return false; // off the gorge
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    let min = 1e9, max = -1e9;
    for (let t = -0.5; t <= 0.5; t += 0.25) {
      for (const w of [-0.5, 0.5]) {
        const h = genTerrainHeight(x + fx * t * len + fz * w * 40, z + fz * t * len - fx * w * 40);
        if (h < min) min = h; if (h > max) max = h;
      }
    }
    return min > 5 && (max - min) <= maxDev;
  };
  const pushStrip = (name, x, z, heading, elev, len, wid) => RUNWAYS.push({
    name, x, z, heading, length: len, width: wid, elev,
    m: 70 + Math.round(R1(200 + RUNWAYS.length) * 20), pad: 300 + Math.round(R1(210 + RUNWAYS.length) * 100),
  });
  // a runway end needs SPACE: terrain along both finals must stay under the
  // 6.5% obstacle ramp (a small knick is tolerable, a hillside is not) — if it
  // doesn't, the corridor cap would carve visible trenches through the hills,
  // so such sites are rejected instead of graded
  const approachOK = (x, z, heading, len, elev, tol, hardMax = 30) => {
    for (const e of [-1, 1]) {
      const fx = -Math.sin(heading) * e, fz = -Math.cos(heading) * e;
      let bad = 0;
      // out to 1400 to match the corridor length, not 1200: ridged terrain puts
      // real hills at that range and the old probe never looked there
      for (let d = 240; d <= 1400; d += 120) {
        const hh = genTerrainHeight(x + fx * (len / 2 + d), z + fz * (len / 2 + d));
        const over = hh - (elev + 4 + d * 0.065);
        // A COUNT IS NOT ENOUGH. The tolerance exists to forgive a knick, but it
        // forgave any single sample no matter how tall, and once the terrain
        // grew ridges that let a whole hillside sit on short final. The corridor
        // cap cannot save it either — it fades out over its last 500 m by
        // design, so an obstacle far down the approach is never graded away.
        // Reject outright on anything that is a hill rather than a bump.
        if (over > hardMax) return false;
        if (over > 12) bad++;
      }
      if (bad > tol) return false;
    }
    return true;
  };

  // 1) the coastal home strip (spawn final comes in over water toward it).
  // The island MUST end up with one, so this cannot just filter — it scores.
  // The old version took the first site that passed and, failing that, dropped a
  // strip at an arbitrary bearing with no checks at all. That fallback was
  // harmless while it almost never fired; the moment the terrain grew ridges and
  // the approach test got stricter it started firing regularly, and an unchecked
  // placement is exactly how you get a 200 m hill on short final. Now the worst
  // case is the least-bad real candidate instead of a random one.
  {
    let best = null, bestOver = 1e9;
    for (let k = 0; k < 60; k++) {
      const a = R1(130) * TAU + k * 2.39996;
      const rad = RM_BASE * shapeS(a) * 0.84;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      const heading = Math.atan2(x, z) + jit(131 + k, 0.2);
      const hRaw = genTerrainHeight(x, z);
      if (hRaw < 6 || hRaw > 48) continue; // rolling ground raised the shore band
      if (!siteOK(x, z, heading, 560, 48)) continue;
      // worst obstruction above the 6.5% ramp along either final
      let over = 0;
      for (const e of [-1, 1]) {
        const fx = -Math.sin(heading) * e, fz = -Math.cos(heading) * e;
        for (let d = 240; d <= 1400; d += 120) {
          const hh = genTerrainHeight(x + fx * (280 + d), z + fz * (280 + d));
          const o = hh - (hRaw + 4 + d * 0.065);
          if (o > over) over = o;
        }
      }
      if (over < bestOver) { bestOver = over; best = { x, z, heading, hRaw }; }
      if (over <= 12) break; // clear enough — stop looking
    }
    if (best) {
      pushStrip(pickName('coast', used), best.x, best.z, best.heading,
        Math.round(best.hRaw), 520 + Math.round(R1(132) * 120), 26);
    } else { // no shore band at all on this island (all cliff or all sea)
      const a = R1(130) * TAU, rad = RM_BASE * shapeS(a) * 0.84;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      pushStrip('Bay', x, z, Math.atan2(x, z), 12, 520, 26);
    }
  }

  // 2) a high shelf near the summit, when the island grew real mountains —
  // walk candidate bearings around the peak and take the first whose finals
  // are clear enough (looser tolerance: a shelf may trim a small shoulder);
  // if every side is walled in, the island simply has no summit strip
  if (peakH > 380) {
    const aIn = Math.atan2(-PEAK.x, -PEAK.z);
    for (let k = 0; k < 8; k++) {
      const b = aIn + k * 0.785 + jit(140 + k, 0.3);
      const hx = PEAK.x + Math.sin(b) * 850;
      const hz = PEAK.z + Math.cos(b) * 850;
      const hh = genTerrainHeight(hx, hz);
      if (hh < 40) continue;
      const heading = b + Math.PI / 2 + jit(148 + k, 0.2);
      if (!approachOK(hx, hz, heading, 340, hh, 3, 55)) continue; // a shelf is expected to be tight
      pushStrip(pickName('high', used), hx, hz, heading, Math.round(hh), 340, 20);
      break;
    }
  }

  // 3) fill the rest by suitability search (two passes, second is lenient)
  for (const maxDev of [30, 60]) { // rolling ground: platforms grade harder
    let tries = 0;
    while (RUNWAYS.length < N && tries < 160) {
      tries++;
      const a = R1(150) * TAU + tries * 2.39996;
      const rFrac = 0.12 + ((R1(151) + tries * 0.618034) % 1) * 0.62;
      const p = place(a, rFrac);
      const heading = ((R1(152) + tries * 0.381966) % 1) * TAU;
      const len = 380 + Math.round(((R1(153) + tries * 0.7548) % 1) * 240);
      if (!farFromStrips(p.x, p.z)) continue;
      if (!siteOK(p.x, p.z, heading, len, maxDev)) continue;
      const hRaw = genTerrainHeight(p.x, p.z);
      // both finals need space. The first pass insists on genuinely clear
      // approaches; the second accepts a rougher one rather than leave the
      // island with too few strips to fly between.
      if (!approachOK(p.x, p.z, heading, len, hRaw, 1, maxDev === 30 ? 30 : 55)) continue;
      biomeWeightsGen(p.x, p.z);
      const pool = hRaw > 260 ? 'high' : _wD > 0.45 ? 'desert' : _wF > 0.45 ? 'forest' : 'open';
      pushStrip(pickName(pool, used), p.x, p.z, heading, Math.round(hRaw), len, 20 + Math.round(((R1(154) + tries * 0.29) % 1) * 10));
    }
    if (RUNWAYS.length >= N) break;
  }
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
export function biomeWeights(x, z) { // region radii scale with the island (LSCALE 1 on classic)
  if (GEN_ON) return biomeWeightsGen(x, z); // v6 islands: zones come from the composed regions
  const wx = x + (noise2(x * 0.00034 + 9.1, z * 0.00034 + 4.4) - 0.5) * 2300 * LSCALE;
  const wz = z + (noise2(x * 0.00034 + 1.7, z * 0.00034 + 8.2) - 0.5) * 2300 * LSCALE;
  _wH = 1 - smooth(1500 * LSCALE, 4300 * LSCALE, Math.hypot(wx - HILLS_C.x, wz - HILLS_C.z));
  _wD = 1 - smooth(1700 * LSCALE, 4300 * LSCALE, Math.hypot(wx - DESERT_C.x, wz - DESERT_C.z));
  _wF = 1 - smooth(1600 * LSCALE, 4200 * LSCALE, Math.hypot(wx - FOREST_C.x, wz - FOREST_C.z));
  _wM = 1 - smooth(650 * LSCALE, 4200 * LSCALE, ridgeDist(wx, wz)); // long tail: foothills roll into the plains
}

function baseHeight(x, z) {
  const r2 = x * x + z * z;
  if (r2 > SH_R2OUT) return -20; // beyond the shelf everything has bottomed out
  const rr = Math.sqrt(r2) + (noise2(x * 0.00028 + 3.1, z * 0.00028 + 7.7) - 0.5) * COAST_WARP;
  const RM = SH_ON ? RM_BASE * shapeS(Math.atan2(x, z)) : RM_BASE;
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
    // Same split as the generated path: the round layer at partial weight for
    // softness, the ridge field carrying the shape. This is what gives the
    // lowland hills crests and spurs instead of leaving them as domes.
    const relW = 40 * K_REL * (1 - 0.5 * _wM) * mSh;
    h += fbm(rx * 0.00135 + 4.7, rz * 0.00135 + 8.3, 3) * relW * 0.45;
    h += ridgeRelief(x, z, 0.0012, 3, 760, 2.7) * relW * 4.5 * smooth(2, 25, h);
    // seeded broad swells (~2.4 km wavelength): whole districts rise into
    // uplands or sink toward the sea — can pool inland lakes in deep dips.
    // Zero on the classic island; damped in the mountains (already tall).
    if (K_SWELL > 0) h += fbm(x * 0.00042 + 31.9, z * 0.00042 + 18.4, 2) * 34 * K_SWELL * (1 - 0.55 * _wM) * mSh;
    h += fbm(x * 0.0105 + 2.9, z * 0.0105 + 5.7, 2) * 7 * mSh;
    // fine gully ridging (see the generated path): hillside spurs and draws at
    // 80-200 m, the scale low-level flight actually reads
    h += ridgeReliefF(x, z, 0.0055, 2) * (22 + Math.min(40, h * 0.16)) * smooth(6, 40, h) * mSh;
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
  return applyRunwayFlattening(x, z, GEN_ON ? baseHeightGen(x, z) : baseHeight(x, z));
}

// reused result object — callers copy fields, never retain the reference
const _surf = { h: 0, type: 'grass' };
export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  _surf.h = h;
  _surf.type = onRunway(x, z) ? 'runway' : h <= 0.05 ? 'water' : 'grass';
  return _surf;
}
