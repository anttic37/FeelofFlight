// seededNoise2: the seed-shifted domain heightcore samples — paint must read
// the SAME fields (canyon bench jitter aligns color bands to the geometry).
// At seed 0 it is byte-identical to raw noise2.
import {
  seededNoise2 as noise2,
  smooth, biomeWeights, _wH, _wD, _wF, _wM,
  canyonLocate, _cd, _cs, _cx, cWf, cWr, washOff,
  TRIBS, tribLocate, _td, _ts,
  duneRidge, desertWash, outcropMask, runwayInfluence,
} from './heightcore.js';

// The pure terrain vertex-color rules — the ground's entire art direction:
// biome-weighted base blend, steep-face rock, desert strata/dune/wash tints,
// forest outcrops, scree aprons, canyon bench strata, tributary tint, beach
// bands, underwater tint, snowline, runway dirt aprons. Dependency-free (no
// THREE) so it bakes in a module Web Worker; world.js's static build calls it
// too, which keeps it pixel-identical to the original THREE.Color loop.

// sRGB hex -> linear-sRGB channel, the exact math new THREE.Color(hex) applies
// (ColorManagement on, working space linear-sRGB) — keeps floats bit-identical
function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
function C(hex) {
  return {
    r: srgbToLinear(((hex >> 16) & 255) / 255),
    g: srgbToLinear(((hex >> 8) & 255) / 255),
    b: srgbToLinear((hex & 255) / 255),
  };
}

const cSandWet = C(0xb69b6c), cSand = C(0xdcc891),
      cGrassL = C(0x86a862), cGrassD = C(0x4c6b3d),
      cMeadow = C(0x9dbd63), cRock = C(0x8d8a82),
      cRockD = C(0x6e6b64), cSnow = C(0xeef2f4),
      cDirt = C(0x9b7f57), cDesert = C(0xd9bd7e),
      cOchre = C(0xc0904f), cSage = C(0x9aa468),
      cForL = C(0x557a44), cForD = C(0x365233),
      cMtnLow = C(0x8a7355), cRubble = C(0xa9825c),
      cDeep = C(0x35635d), cWashBed = C(0xd8c6a0),
      cCrest = C(0xead9a8), cScree = C(0x8f8a81),
      cRiser = C(0x5f3020);
const strata = [0x8f4a34, 0xb46b46, 0xc98f5f, 0x7c4030].map(C);
const benchCol = [strata[3], strata[0], strata[1]]; // canyon benches, bottom -> top

// module scratch mirroring the original loop's THREE.Color temporaries c and c2
// (same operations in the same order, so every float matches bit for bit)
let _r = 0, _g = 0, _b = 0;    // c
let _r2 = 0, _g2 = 0, _b2 = 0; // c2
let ar = 0, ag = 0, ab = 0;    // biome blend accumulator
function set2(col) { _r2 = col.r; _g2 = col.g; _b2 = col.b; }          // c2.copy(col)
function lerp2(col, w) { _r2 += (col.r - _r2) * w; _g2 += (col.g - _g2) * w; _b2 += (col.b - _b2) * w; } // c2.lerp(col, w)
function lerp1(col, w) { _r += (col.r - _r) * w; _g += (col.g - _g) * w; _b += (col.b - _b) * w; }       // c.lerp(col, w)
function lerp12(w) { _r += (_r2 - _r) * w; _g += (_g2 - _g) * w; _b += (_b2 - _b) * w; }                 // c.lerp(c2, w)
function addC2(w) { ar += _r2 * w; ag += _g2 * w; ab += _b2 * w; }     // addC(c2, w)

// h = heightAt(x, z) at this vertex; normalY = smooth vertex normal Y component;
// writes linear r,g,b (0..1 floats) into out[0..2]. No allocations.
export function terrainColor(x, z, h, normalY, out) {
  const jit = noise2(x * 0.02, z * 0.02);
  const patch = noise2(x * 0.0035 + 40.7, z * 0.0035 + 9.2); // big vegetation patches
  biomeWeights(x, z);
  const sum = _wH + _wD + _wF + _wM + 0.06;
  ar = ag = ab = 0;
  set2(cGrassL); lerp2(cGrassD, patch * 0.8); lerp2(cMeadow, (1 - patch) * jit * 0.5);
  addC2(_wH + 0.06); // hills double as the generic lowland fill
  if (_wD > 0.004) {
    set2(cDesert); lerp2(cOchre, smooth(0.35, 0.75, noise2(x * 0.0012 + 8.8, z * 0.0012 + 2.2)));
    if (jit > 0.72) lerp2(cSage, 0.45);
    addC2(_wD);
  }
  if (_wF > 0.004) { set2(cForL); lerp2(cForD, 0.3 + patch * 0.6); addC2(_wF); }
  if (_wM > 0.004) { set2(cMtnLow); lerp2(cRock, smooth(90, 300, h)); lerp2(cRockD, jit * 0.4); addC2(_wM); }
  _r = ar / sum; _g = ag / sum; _b = ab / sum;
  // MOISTURE. One low-frequency field so whole districts share a character
  // rather than the tone flickering hill by hill, gated by height: uplands are
  // exposed and run dry and olive, sheltered low ground stays green. Without
  // this the island is a single saturated green from the beach to the snowline,
  // which is the other half of why it reads as painted rather than grown.
  const dry = smooth(0.40, 0.70, noise2(x * 0.00045 + 61.3, z * 0.00045 + 22.9)) * smooth(70, 430, h);
  if (dry > 0.01) lerp1(cSage, dry * 0.36);
  // damp valley floors — low AND flat, where water would actually collect
  const damp = (1 - smooth(0.008, 0.06, 1 - normalY)) * (1 - smooth(30, 150, h));
  if (damp > 0.01) lerp1(cGrassD, damp * 0.28);
  // SLOPE IS THE MATERIAL. 1 - normalY is 0.015 at 10 deg, 0.13 at 30, 0.29 at
  // 45 — so the old rock ramp (0.28 -> 0.55) only ever fired above ~44 deg, and
  // every gentler face on the island, which is nearly all of it, came out one
  // flat green. Real hillsides grade: grass holds the flats, thins to dry scrub
  // and soil where the slope steepens, then breaks to scree and bare rock.
  // Three overlapping bands, each a smoothstep of slope, gets that for free —
  // no extra sampling, and it reads at every distance because it is baked into
  // the vertex colour rather than a near-field shader trick.
  const steep = smooth(0.20, 0.46, 1 - normalY);   // ~36 deg -> ~56 deg: bare rock
  const midSl = smooth(0.02, 0.17, 1 - normalY) * (1 - steep); // ~11 -> ~34 deg
  if (midSl > 0.01 && h > 3) {
    // dry soil and thinning scrub on the flanks. Warmer and less saturated than
    // the grass, so a hillside separates from the valley floor by tone as well
    // as by shading — that separation is most of what reads as "terrain".
    set2(cSage); lerp2(cDirt, 0.28 + jit * 0.44);
    lerp12(midSl * 0.5);
  }
  // exposed rock on steep faces; desert cliffs get height-banded strata (mesas)
  if (steep > 0 && h > 2) {
    set2(cRock); lerp2(cRockD, jit * 0.7);
    if (_wD / sum > 0.45) {
      const band = h * 0.055 + jit * 0.9;
      const bi = ((band | 0) % 4 + 4) % 4;
      set2(strata[bi]); lerp2(strata[(bi + 1) % 4], (band - Math.floor(band)) * 0.5); lerp2(cOchre, 0.3);
    }
    lerp12(steep * 0.85);
  }
  // desert flats: sunlit dune crests vs shadowed flanks, pale dry-wash beds
  const wDs = _wD / sum;
  if (wDs > 0.3 && h > 4 && steep < 0.3) {
    // Dunes only exist on ground flat enough to hold blown sand. `steep < 0.3`
    // passes slopes up to ~40 deg, so the long parallel crest streaks were
    // being draped straight over hillsides — they ignore the topography
    // entirely and read as strips laid ON the terrain rather than part of it.
    // Full strength under ~8 deg, gone by ~20 — a dune field is flat ground,
    // and anything steeper carries the streaks across the topography.
    const dFlat = 1 - smooth(0.010, 0.060, 1 - normalY);
    if (dFlat > 0.02) {
      const rv = duneRidge(x, z);
      if (rv > 0.62) lerp1(cCrest, smooth(0.62, 0.95, rv) * 0.4 * wDs * dFlat);
      else lerp1(cOchre, (1 - rv) * 0.1 * wDs * dFlat);
    }
    // wash beds are drainage — they belong in the low flat ground too, but
    // they wind with the land instead of cutting across it, so a gentler gate
    const wm = desertWash(x, z);
    if (wm > 0.05) lerp1(cWashBed, wm * 0.5 * wDs * (1 - smooth(0.06, 0.2, 1 - normalY)));
  }
  // forest rocky outcrops go grey
  if (_wF / sum > 0.3) {
    const om = outcropMask(x, z);
    if (om > 0.02) { set2(cRock); lerp2(cRockD, jit * 0.5); lerp12(om * 0.85); }
  }
  // scree aprons skirting the mountain bases
  if (_wM / sum > 0.2 && h > 40 && h < 250) {
    const scr = smooth(0.1, 0.3, 1 - normalY) * smooth(42, 80, h) * (1 - smooth(175, 245, h));
    if (scr > 0.02) {
      set2(cScree); lerp2(cRubble, 0.3); lerp2(cRockD, jit * 0.35);
      lerp12(scr * 0.6 * Math.min(1, _wM * 1.6));
    }
  }
  // canyon: strata banded to the wall benches, rubble floor + pale wash bed
  if (canyonLocate(x, z)) {
    const wfC = cWf(_cs), wrC = cWr(_cs);
    if (_cd < wfC) {
      lerp1(cRubble, 0.5);
      const dw = Math.abs(_cx - washOff(_cs, wfC));
      if (dw < 28) lerp1(cWashBed, (1 - smooth(8, 28, dw)) * 0.6);
    } else if (_cd < wfC + wrC + 60) {
      const t = Math.min(1, (_cd - wfC) / wrC);
      const jA = smooth(0, 0.12, t) * (1 - smooth(0.85, 1, t)) * 0.16;
      let tj = t + (noise2(x * 0.006 + 9.4, z * 0.006 + 4.2) - 0.5) * 2 * jA;
      tj = tj < 0 ? 0 : tj > 0.9999 ? 0.9999 : tj;
      const u = tj * 3, bi = u | 0, fr = u - bi;
      const riser = smooth(0.56, 0.97, fr);
      set2(benchCol[bi]); lerp2(bi < 2 ? benchCol[bi + 1] : strata[2], riser * 0.65);
      lerp2(cRiser, riser * (1 - riser) * 1.2); // shadowed riser faces
      if (riser < 0.2) lerp2(cRubble, 0.18);    // dusty bench tops
      const wallW = smooth(wfC - 40, wfC + 20, _cd) * (1 - smooth(wfC + wrC, wfC + wrC + 60, _cd));
      lerp12(wallW * (0.5 + 0.5 * steep));
    }
  }
  // tributary gullies: light strata tint, only where the cut actually landed
  // (the min() merge means the gully fades out over lower ground)
  for (let k = 0; k < TRIBS.length; k++) {
    if (!tribLocate(TRIBS[k], x, z)) continue;
    const wfT = 34 + 44 * _ts, wrT = 80 + 50 * _ts;
    const flT = TRIBS[k].joinFl + 46 * (1 - _ts) * (1 - _ts);
    if (_td < wfT) {
      if (Math.abs(h - flT) < 5) lerp1(cRubble, 0.4);
    } else if (_td < wfT + wrT + 30 && h > flT - 4 && h < flT + 158) {
      set2(strata[1]); lerp2(strata[0], jit * 0.5);
      lerp12((0.3 + 0.55 * steep) * (1 - smooth(wfT + wrT - 20, wfT + wrT + 30, _td)) * 0.8);
    }
  }
  // coastal beach band: wet -> dry sand, then blend up into the biome
  if (h < 0.7) { _r = cSandWet.r; _g = cSandWet.g; _b = cSandWet.b; lerp1(cSand, smooth(-0.6, 0.7, h)); }
  else if (h < 9) { // c2.copy(cSand).lerp(cSandWet, jit*0.15).lerp(c, smooth(3.2,9,h)); c.copy(c2)
    set2(cSand); lerp2(cSandWet, jit * 0.15);
    const t = smooth(3.2, 9, h);
    _r2 += (_r - _r2) * t; _g2 += (_g - _g2) * t; _b2 += (_b - _b2) * t;
    _r = _r2; _g = _g2; _b = _b2;
  }
  if (h < -2.5) lerp1(cDeep, smooth(2.5, 13, -h) * 0.75);
  // SNOW. Was height alone: one noise-jittered line at 420 with a 24 m transition,
  // lerping the whole way to near-white. That gives caps that look dipped in paint —
  // pure white, a hard scalloped rim at a single frequency, and snow clinging to
  // vertical cliff faces where in reality it slides straight off.
  //
  // Three things fix it, and they are all things real snow does.
  //
  // 1. STEEP GROUND SHEDS IT. Above about 30 degrees snow starts to slide and the rock
  //    shows through; by 55 it is bare. This is what breaks the cap into ribs and
  //    gullies that follow the mountain instead of a smooth white shell over it.
  // 2. THE LINE IS NOT ONE FREQUENCY. A broad ~600 m drift decides which side of a
  //    massif holds snow, and a finer ~130 m term ruffles the rim. One frequency reads
  //    as a scallop pattern immediately.
  // 3. IT NEVER REACHES PURE WHITE. Even deep snow keeps some of the rock beneath it
  //    at the edges, and the shaded side is blue rather than grey — snow is bright
  //    enough in shadow that skylight dominates, which is why it photographs blue.
  const snowBroad = (noise2(x * 0.0017 + 3.7, z * 0.0017) - 0.5) * 88;
  const snowFine = (noise2(x * 0.0076 + 19.4, z * 0.0076 + 5.1) - 0.5) * 30;
  const snowline = 455 + snowBroad + snowFine;
  const shed = 1 - smooth(0.13, 0.42, 1 - normalY);      // ~29 deg -> ~55 deg
  const cover = smooth(snowline - 26, snowline + 40, h) * shed;
  if (cover > 0.004) {
    // deep snow is whiter; the thin fringe keeps more of the ground under it
    set2(cSnow); lerp2(cRockD, (1 - cover) * 0.5);
    // cool it where the surface turns away from the sky, warm the sunlit tops a hair
    _b2 += (0.055 - 0.03 * normalY) * cover;
    lerp12(cover * 0.94);
  }
  // RUNWAY APRON. runwayInfluence is a rounded RECTANGLE — it has to be, because the
  // same field grades the terrain flat and a strip needs a clean platform to sit on.
  // Painting dirt straight over that field inherits the rectangle, and what you see from
  // the air is a tan billboard around the runway with four visible corners, far wider
  // than anything a strip would actually wear into the ground.
  //
  // The PAINT does not need the rectangle. Threshold it well up the falloff so the dirt
  // stays close to the tarmac, and jitter that threshold with noise so the edge is
  // ragged. The graded platform underneath is unchanged — this is purely what colour
  // sits on it.
  const rw = runwayInfluence(x, z);
  if (rw > 0.12) {
    const edge = 0.30 + 0.34 * noise2(x * 0.035 + 5.1, z * 0.035 + 9.3);
    const p = smooth(edge, 0.94, rw);
    if (p > 0.004) lerp1(cDirt, p * 0.8);
  }
  out[0] = _r; out[1] = _g; out[2] = _b;
}
