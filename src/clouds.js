import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise2 } from './noise.js';
import { heightAt } from './heightcore.js';

// Puffy cumulus. Each cloud is built like a real one rather than a row of
// blobs: a FLAT BASE layer of wide puffs straddling the condensation level,
// then 2-6 lobes of stacked, shrinking puffs billowing up out of it — the
// cauliflower crown that reads as "cloud" instead of "pile of pebbles".
// Four size classes (fair-weather puff / heap / tower / raft) give the sky
// silhouette variety, and a baked vertical vertex-colour gradient shades
// undersides blue-grey so the volume reads even in flat lighting.
// One draw call per cloud (all puffs merged). Drift +X with wraparound over a
// 20 km box centered on the island.
// TERRAIN-AWARE: seeded islands peak anywhere from ~480 to ~1200 m, so each
// cloud eases up to stay >=200 m over the ridge it is drifting across instead
// of trusting a fixed band tuned for the classic 650 m island.

const COUNT = 72;
const BOX = 20000;
const HALF = BOX / 2;

// HOW REAL CUMULUS DECIDE WHERE AND HOW BIG TO BE — three rules, all visible:
//
// 1. THEY SHARE A FLAT BASE. Convective cloud bases sit at the lifting
//    condensation level, set by the air mass's temperature and dew point, so
//    every cumulus in that air mass condenses at the same ALTITUDE — a parcel
//    rising from a valley and one from a hilltop both stop at the same level.
//    That is why a real cumulus field looks sliced flat underneath, and why
//    hills tall enough simply end up wearing their cloud. Scattering bases over
//    a per-class altitude band, as this did, is the tell-tale sign of clouds
//    placed by hand.
//
// 2. THEY FORM OVER LAND. Cumulus are the visible tops of thermals, and
//    thermals come off ground the sun has heated. Over open sea there is no
//    such heating, so the sky is largely clear and what little forms is small
//    and flat. Over an island you get the classic ring of cloud that marks the
//    land from far out to sea — free navigation, and it is what really happens.
//
// 3. SMALL ONES VASTLY OUTNUMBER BIG ONES. Cumulus sizes follow a power law,
//    not a uniform spread: a sky is mostly scraps and puffs with a few giants.
//    Sampling uniformly inside each class produced a suspicious sameness.
//
// Layer clouds are NOT convective — stratocumulus rafts and stratus streaks
// form by gentle lifting of a whole slab of air, so they keep their own high
// levels and ignore the thermal rules above.
//
// w/d = half extents, h = build height, y = base band (layer clouds only).
// squash flattens every puff in the cloud (sheets, not balls); crown scales the
// per-level taper, so a value above 1 WIDENS a stack as it climbs = anvil.
// conv = convective: shares the LCL and needs land under it to grow.
const LCL = 620;          // cloud base above ground level, metres
const CLASSES = [
  // shred: torn scraps, the smallest thing in the sky
  { p: 0.15, w: [18, 62],   d: [15, 52],   h: [12, 38],   conv: 1, base: [2, 4],   lobes: [1, 2], squash: 0.6 },
  // fair-weather puff: small and rounded — kept low so its crown is one or two
  // fat bumps; taller made these read as a stack of coins at distance
  { p: 0.23, w: [48, 135],  d: [40, 110],  h: [40, 95],   conv: 1, base: [5, 8],   lobes: [2, 3] },
  // heap cumulus: the workhorse — wide flat base, fat crown
  { p: 0.22, w: [110, 290], d: [90, 215],  h: [105, 265], conv: 1, base: [6, 9],   lobes: [3, 5] },
  // congestus tower: one or two fat stacks climbing out of a broad base
  { p: 0.11, w: [150, 330], d: [125, 270], h: [230, 470], conv: 1, base: [5, 8],   lobes: [1, 2] },
  // anvil: the big one — climbs high and spreads out at the top
  { p: 0.05, w: [190, 400], d: [160, 330], h: [380, 700], conv: 1, base: [7, 10],  lobes: [1, 2], crown: 1.17 },
  // stratocumulus raft: long, low-relief bank spanning half a kilometre
  { p: 0.16, w: [280, 660], d: [150, 350], h: [70, 165],  y: [700, 1320],  base: [10, 15], lobes: [4, 6] },
  // stratus streak: a thin sheet drawn out by the wind, high and flat
  { p: 0.08, w: [380, 900], d: [70, 185],  h: [30, 70],   y: [1150, 1950], base: [12, 18], lobes: [2, 4], squash: 0.42 },
];

// Uniform deterministic stream. The raw hash, NOT noise2: value noise
// interpolates toward 0.5, which is why every old cloud came out the same
// middling size — the extremes of each range were never actually drawn.
function rnd(i, k) {
  const s = Math.sin(i * 127.1 + k * 311.7 + 13.7) * 43758.5453123;
  return s - Math.floor(s);
}
const span = (i, k, r) => r[0] + (r[1] - r[0]) * rnd(i, k);
const spanI = (i, k, r) => r[0] + Math.floor(rnd(i, k) * (r[1] - r[0] + 0.999));
// power-law draw: pow(u, 2) crowds the result toward the small end of the
// range, which is how cumulus sizes actually distribute — a sky of scraps and
// puffs with the occasional giant, instead of everything landing mid-sized
const spanP = (i, k, r) => { const u = rnd(i, k); return r[0] + (r[1] - r[0]) * u * u; };
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createClouds(scene) {
  // indexed icospheres (detail >=1 => smooth sphere normals; uv dropped so the
  // seam verts merge too) — 42 verts instead of 240 per puff, and there are
  // ~900 puffs in the sky. Puffs over ~85 m read their polygon silhouette from
  // the cockpit, so those get the finer sphere; small ones never need it.
  const puffLo = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('uv'));
  const puffHi = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('uv'));

  // depthWrite MUST stay on. With it off, every puff's silhouette and fresnel
  // rim shows through the puffs in front of it, so an overlapping stack renders
  // as a pile of onion rings ("wedding cake") instead of one billowing mass.
  // Writing depth makes each cloud occlude itself; clouds are still sorted
  // back-to-front against each other, so the soft fringe blends correctly.
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff, vertexColors: true,
    emissive: 0xdae6f2, emissiveIntensity: 0.3,
    transparent: true, opacity: 0.96, depthWrite: true,
  });
  // EDGE EROSION. The puffs are spheres, and a sphere's giveaway is a perfectly
  // circular silhouette — no amount of stacking hides it. So the rim gets eaten
  // away per-pixel by 3D value noise: where the noise runs low near the
  // silhouette the fragment is thrown away entirely, tearing the outline into
  // wisps and shreds. This is the cheap half of what a raymarched volume buys
  // you — it only touches cloud pixels and costs no geometry, no 3D texture and
  // no marching loop, but it kills the "pile of balls" read.
  //
  // The noise is sampled in OBJECT space, not world space: clouds drift, and a
  // world-space pattern would crawl through them as they moved, boiling. A
  // per-cloud seed attribute offsets it so no two clouds erode identically.
  //
  // Fully eroded pixels MUST discard, not just fade — the material writes depth,
  // and a transparent-but-depth-writing pixel would punch an invisible occluder.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float cseed;
varying vec3 vLocal;
varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLocal = position;
vSeed = cseed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLocal;
varying float vSeed;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x),
                 mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x),
                 mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <opaque_fragment>', `{
  float rim = 1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
  vec3 np = vLocal + vec3(vSeed * 37.1, vSeed * 17.7, vSeed * 91.3);
  float n = vn3(np * 0.06) * 0.62 + vn3(np * 0.15) * 0.38;
  n = clamp((n - 0.5) * 1.45 + 0.5, 0.0, 1.0);   // widen the contrast
  // Erosion has to reach INWARD from the silhouette to be visible: rim*rim
  // confined it to a hairline band at the exact edge and read as nothing.
  // A smoothstep over the outer band tears the outline properly, and the
  // 1.3 overdrive lets low-noise patches clamp to zero and be discarded,
  // which is what actually shreds the circle instead of just fading it.
  float e = smoothstep(0.16, 0.78, rim);
  diffuseColor.a *= clamp(1.0 - e * smoothstep(0.68, 0.33, n) * 1.45, 0.0, 1.0);
  diffuseColor.a *= mix(1.0, 0.62, pow(rim, 2.5)); // fringe on what survives
  if (diffuseColor.a < 0.06) discard;
}
#include <opaque_fragment>`);
  };

  const clouds = [];
  const parts = [];
  let puffTotal = 0;

  for (let i = 0; i < COUNT; i++) {
    // pick a class by weight
    let pick = rnd(i, 0), cls = CLASSES[CLASSES.length - 1];
    for (let c = 0; c < CLASSES.length; c++) {
      if (pick < CLASSES[c].p) { cls = CLASSES[c]; break; }
      pick -= CLASSES[c].p;
    }
    // POSITION FIRST — the ground under a convective cloud decides how big it
    // gets, so it has to be known before the geometry is sized.
    let a = rnd(i, 6) * Math.PI * 2;
    let r = 300 + rnd(i, 7) * 9200;
    let cxp = Math.cos(a) * r, czp = Math.sin(a) * r;
    let ground = heightAt(cxp, czp);
    if (cls.conv) {
      // thermals need heated land: hunt a few times for ground before settling.
      // Failing that the cloud stays put as a small flat marine puff, which is
      // exactly what forms over open water.
      for (let tryN = 0; tryN < 5 && ground < 3; tryN++) {
        a = rnd(i, 40 + tryN) * Math.PI * 2;
        r = 300 + rnd(i, 60 + tryN) * 5600; // hunt in over the island, not the ocean
        cxp = Math.cos(a) * r; czp = Math.sin(a) * r;
        ground = heightAt(cxp, czp);
      }
    }
    // thermal strength: nothing over water, more over high sun-baked ground
    const land = smooth01(0, 45, ground);
    const th = cls.conv ? 0.12 + 0.88 * land * (0.72 + 0.28 * smooth01(0, 420, ground)) : 1;

    const W = spanP(i, 1, cls.w) * (0.55 + 0.45 * th);
    const D = spanP(i, 2, cls.d) * (0.55 + 0.45 * th);
    // vertical development is the part thermals really drive: a marine puff is
    // a pancake, the same cloud over a hot hillside towers
    const H = spanP(i, 3, cls.h) * (0.3 + 0.7 * th);
    const squash = cls.squash || 1, crown = cls.crown || 1;
    // constant across this cloud, different for every cloud: shifts the erosion
    // noise so two clouds never tear along the same pattern
    const cseed = rnd(i, 13) * 190;
    parts.length = 0;

    // one puff -> a scaled/translated icosphere with the height gradient baked
    // into vertex colours (t = 0 at the cloud base, 1 at its top)
    const addPuff = (px, py, pz, rx, ry, rz) => {
      const g = (rx > 85 || rz > 85 ? puffHi : puffLo).clone();
      g.scale(rx, ry, rz);       // applyMatrix4 fixes the normals for non-uniform scale
      g.translate(px, py, pz);
      const pa = g.attributes.position;
      const col = new Float32Array(pa.count * 3);
      for (let v = 0; v < pa.count; v++) {
        let t = pa.getY(v) / H;
        t = t <= 0 ? 0 : t >= 1 ? 1 : t;
        const s = t * t * (3 - 2 * t);
        col[v * 3] = 0.55 + 0.45 * s;
        col[v * 3 + 1] = 0.62 + 0.38 * s;
        col[v * 3 + 2] = 0.74 + 0.26 * s;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const seeds = new Float32Array(pa.count);
      seeds.fill(cseed);
      g.setAttribute('cseed', new THREE.BufferAttribute(seeds, 1));
      parts.push(g);
    };

    // 1) FLAT BASE: wide puffs on a disc, centres only ~0.45 of a radius up so
    // their fattest part sits at the base plane — the silhouette bottom comes
    // out level like a real condensation level, not scalloped
    const baseN = spanI(i, 4, cls.base);
    for (let b = 0; b < baseN; b++) {
      const a = rnd(i, 20 + b) * Math.PI * 2;
      const rr = Math.sqrt(rnd(i, 60 + b)); // sqrt => uniform over the disc
      const rx = W * (0.30 + 0.18 * rnd(i, 100 + b));
      const rz = D * (0.34 + 0.20 * rnd(i, 140 + b));
      const ry = Math.min(rx, rz) * (0.60 + 0.28 * rnd(i, 180 + b)) * squash;
      addPuff(Math.cos(a) * rr * W * 0.72, ry * (0.40 + 0.16 * rnd(i, 220 + b)), Math.sin(a) * rr * D * 0.72, rx, ry, rz);
    }

    // 2) CROWN: each lobe is a stack of gently tapering puffs climbing out of
    // the base. The vertical STEP is derived from the puff radii themselves
    // (0.58 of the two radii => ~40% overlap), never from height/levels —
    // spacing a fixed number of levels over the cloud height leaves gaps at
    // the top and the stack reads as a string of beads instead of a tower.
    // Levels therefore emerge: rafts get 1-2, congestus towers 7-9.
    const lobes = spanI(i, 5, cls.lobes);
    for (let l = 0; l < lobes; l++) {
      const a = rnd(i, 260 + l) * Math.PI * 2;
      const rr = 0.12 + 0.5 * rnd(i, 300 + l);
      const lx = Math.cos(a) * rr * W, lz = Math.sin(a) * rr * D;
      const lobeH = H * (0.55 + 0.45 * rnd(i, 340 + l)); // uneven lobe heights
      const leanA = rnd(i, 380 + l) * Math.PI * 2;       // wind shear: the whole
      const leanS = 0.06 + 0.16 * rnd(i, 420 + l);       // stack leans one way
      const leanX = Math.cos(leanA) * leanS, leanZ = Math.sin(leanA) * leanS;
      // Puff radius follows the LOBE HEIGHT, not just the cloud footprint: a
      // tall stack of small spheres is a worm, not a tower. ~0.32 of the height
      // keeps congestus near a 2:1 aspect; the W floor keeps short clouds
      // chunky and the W cap stops a stack from outgrowing its own base.
      const rT = Math.min(W * 0.42, Math.max(lobeH * 0.32, W * 0.22));
      let rx = rT * (0.86 + 0.28 * rnd(i, 460 + l));
      let rz = Math.min(D * 0.52, rT) * (0.86 + 0.28 * rnd(i, 500 + l));
      let ry = Math.min(rx, rz) * (0.82 + 0.28 * rnd(i, 540 + l)) * squash;
      let y = ry * 0.55, prevRy = ry;
      for (let k = 0; k < 12 && y + ry * 0.6 < lobeH; k++) {
        addPuff(
          lx + leanX * y + (rnd(i, 580 + l * 13 + k) - 0.5) * rx * 0.6, y,
          lz + leanZ * y + (rnd(i, 720 + l * 13 + k) - 0.5) * rz * 0.6,
          rx, ry, rz);
        // gentle taper: 0.84^7 spikes the tip to 30% and reads as a spire.
        // crown > 1 pushes it past 1 so the stack FLARES as it climbs — the
        // spreading head of an anvil rather than a cone.
        const taper = (0.90 + 0.06 * rnd(i, 860 + l * 13 + k)) * crown;
        rx *= taper; rz *= taper; ry *= taper;
        y += (prevRy + ry) * 0.58;
        prevRy = ry;
      }
    }

    puffTotal += parts.length;
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.renderOrder = 2;
    // Convective bases sit at one shared ALTITUDE, not one shared height above
    // the ground. A parcel rising from a valley and one rising from a hilltop
    // both condense where the air mass reaches its dew point, so the whole
    // field bottoms out on the same level — which is exactly why a real cumulus
    // sky looks like it was sliced flat underneath. (Tying the base to the
    // terrain instead gave a 500 m spread and lost the effect entirely.)
    // Hills that reach this level simply end up wearing their cloud.
    const baseY = cls.conv ? LCL + (rnd(i, 8) - 0.5) * 80 : span(i, 8, cls.y);
    mesh.position.set(cxp, baseY, czp);
    mesh.rotation.y = rnd(i, 9) * Math.PI * 2;
    scene.add(mesh);
    clouds.push({
      mesh, baseY, x0: mesh.position.x,
      y: Math.max(baseY, heightAt(mesh.position.x, mesh.position.z) + 200),
      speed: 3.2 + rnd(i, 10) * 1.9,
      bobF: 0.06 + rnd(i, 11) * 0.05,
      bobP: rnd(i, 12) * Math.PI * 2,
    });
  }

  let lastT = 0;
  function update(time, planePos) {
    const dt = Math.min(0.1, Math.max(0, time - lastT));
    lastT = time;
    const k = Math.min(1, dt * 1.4); // vertical ease — brisk enough to clear rising ridges
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const x = c.x0 + time * c.speed + HALF;
      const wx = x - Math.floor(x / BOX) * BOX - HALF;
      c.mesh.position.x = wx;
      // ride >=200 m above whatever ridge is under the drift lane right now
      const want = Math.max(c.baseY, heightAt(wx, c.mesh.position.z) + 200);
      c.y += (want - c.y) * k;
      c.mesh.position.y = c.y + Math.sin(time * c.bobF + c.bobP) * 2.5;
    }
  }

  return { update, puffTotal };
}
