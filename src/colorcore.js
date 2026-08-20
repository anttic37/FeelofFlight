// seededNoise2: the seed-shifted domain heightcore samples — paint must read
// the SAME fields (canyon bench jitter aligns color bands to the geometry).
// At seed 0 it is byte-identical to raw noise2.
import {
  seededNoise2 as noise2, heightAt,
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
      cHeath = C(0x9a8f58), cForWarm = C(0x6b8546),
      cSnowShade = C(0xd4dde8),
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

// THE RELIEF PROBE. One fixed-radius 4-tap cross of heightAt, shared by everything below
// that needs to know the SHAPE of the ground rather than its slope: signed relief
// (_rel > 0 = concave, sitting below its surroundings; < 0 = convex, standing proud)
// drives the drainage darkening, the crest lightening and the snow drift, and the probe
// gradient gives snow a fixed-scale slope that cannot alias with the LOD lattice. R = 30
// so the probe reads landforms, not the 9 m mottle — and because it is a pure function
// of (x, z) it bakes identically at every LOD and on both threads.
let _gxP = 0, _gzP = 0, _rel = 0;

// The probe for ONE point, exported so bakeTile can evaluate it on a coarse lattice:
// per-vertex it costs 4 heightAt per vertex and took the bake from 26.8 to 10.9 tiles/s.
// The field's finest content is ~2R = 60 m wavelength, so a 20 m world-aligned lattice
// samples it Nyquist-safe and bilerp reconstructs it: 15x fewer taps on LOD0, and since
// every ring's tile origin is a multiple of 20 m, LOD0 and LOD1 read the IDENTICAL
// lattice — cross-LOD consistency by construction rather than by hope.
// out3[0..2] = gx, gz, rel.
export function reliefProbe(x, z, h, out3) {
  const R = 30;
  const hE = heightAt(x + R, z), hW = heightAt(x - R, z);
  const hS = heightAt(x, z + R), hN = heightAt(x, z - R);
  out3[0] = (hE - hW) / (2 * R);
  out3[1] = (hS - hN) / (2 * R);
  out3[2] = ((hE + hW + hS + hN) * 0.25 - h) / R;
}
const _p3 = [0, 0, 0];

// h = heightAt(x, z) at this vertex; normalY = smooth vertex normal Y component;
// writes linear r,g,b (0..1 floats) into out[0..2]. No allocations.
// coarse = true skips the relief probe (the synchronous startup shell budget).
// pgx/pgz/prel: probe values supplied by the caller (bakeTile's lattice); when omitted
// and not coarse, the probe is evaluated here per-vertex.
export function terrainColor(x, z, h, normalY, out, coarse = false, pgx, pgz, prel) {
  const jit = noise2(x * 0.02, z * 0.02);
  const patch = noise2(x * 0.0035 + 40.7, z * 0.0035 + 9.2); // big vegetation patches
  biomeWeights(x, z);
  if (pgx !== undefined) {
    _gxP = pgx; _gzP = pgz; _rel = prel;
  } else if (!coarse && h > 0.5) {
    reliefProbe(x, z, h, _p3);
    _gxP = _p3[0]; _gzP = _p3[1]; _rel = _p3[2];
  } else {
    _gxP = _gzP = _rel = 0;
  }
  const sum = _wH + _wD + _wF + _wM + 0.06;
  ar = ag = ab = 0;
  set2(cGrassL); lerp2(cGrassD, patch * 0.8); lerp2(cMeadow, (1 - patch) * jit * 0.5);
  // LANDUSE MOSAIC. patch (285 m) and the moisture field (2.2 km) bracket exactly the
  // scale a pilot actually reads from 300-900 m up, and between them there was nothing:
  // measured over a hillside frame, kilometres of grass came out as one khaki wash. A
  // ~770 m quilt with EDGES — thresholded, not a smooth blend — breaks the wash into
  // districts of lusher meadow and parched heath the way real land divides at that scale,
  // and the sharpish transitions are what make it read as fields rather than as noise.
  const quilt = noise2(x * 0.0013 + 101.7, z * 0.0013 + 55.3);
  lerp2(cMeadow, smooth(0.55, 0.70, quilt) * 0.6);
  lerp2(cHeath, (1 - smooth(0.30, 0.44, quilt)) * 0.5);
  addC2(_wH + 0.06); // hills double as the generic lowland fill
  if (_wD > 0.004) {
    set2(cDesert); lerp2(cOchre, smooth(0.35, 0.75, noise2(x * 0.0012 + 8.8, z * 0.0012 + 2.2)));
    if (jit > 0.72) lerp2(cSage, 0.45);
    addC2(_wD);
  }
  if (_wF > 0.004) {
    // FOREST IS NOT ONE DARK. The old ramp ran dark cForL to darker cForD — a canopy with
    // no bright component at all, which is why whole forested districts collapsed into a
    // single flat mass in every wide shot. Real forest from the air is broken two ways:
    // the canopy itself drifts warm and cool over hundreds of metres, and it has HOLES —
    // clearings and meadows reading grass-bright against the trees. The clearing field is
    // thresholded hard (~15% of forest area at 1.1 km scale) because a clearing has an
    // edge; blended soft it would just be more mush.
    set2(cForL); lerp2(cForD, 0.25 + patch * 0.55);
    lerp2(cForWarm, smooth(0.52, 0.78, noise2(x * 0.0023 + 3.3, z * 0.0023 + 71.2)) * 0.45);
    const clr = smooth(0.60, 0.75, noise2(x * 0.0009 + 77.1, z * 0.0009 + 31.4));
    if (clr > 0.01) lerp2(cMeadow, clr * 0.8);
    addC2(_wF);
  }
  if (_wM > 0.004) { set2(cMtnLow); lerp2(cRock, smooth(90, 300, h)); lerp2(cRockD, jit * 0.4); addC2(_wM); }
  _r = ar / sum; _g = ag / sum; _b = ab / sum;
  // CONTINENT-SCALE DRIFT. One ~5 km field tilting the whole palette warm or cool by a few
  // percent. Invisible up close; from 1500 m it is the difference between an island painted
  // in one session and land that weathered differently on different coasts.
  const drift = noise2(x * 0.00019 + 400.5, z * 0.00019 + 118.8) - 0.5;
  _r *= 1 + drift * 0.10; _g *= 1 + drift * 0.04; _b *= 1 - drift * 0.07;
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
  // ── DRAINAGE, drawn ────────────────────────────────────────────────────────────────
  // The heightfield has real concavities — gullies, tributaries, the folds between
  // hills — and until now the paint was blind to them: a slope and the channel incised
  // into it got the same colour, which is why valleys read as flat washes from the air.
  // The drainage net is the skeleton every relief painter draws first, and it is
  // sun-free: this is enclosure, not shading, so it survives the moving sun. Channels
  // darken ASYMMETRICALLY (red loses most, blue least — a hollow loses warm ground
  // bounce but keeps cool skylight) and go a step lusher where water would linger.
  const vall = smooth(0.015, 0.10, _rel) * smooth(4, 12, h) * (1 - smooth(340, 460, h));
  if (vall > 0.01) {
    lerp1(cGrassD, vall * 0.22 * (1 - (_wD / sum) * 0.85)); // desert keeps its own washes
    _r *= 1 - vall * 0.13; _g *= 1 - vall * 0.09; _b *= 1 - vall * 0.05;
  }
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
  // ── CREST SEPARATION, the inverse of the drainage term ─────────────────────────────
  // Convex ground stands into the wind and the light: crest LINES get a warm luminance
  // lift and a wind-scoured heath shift, which is what visually separates a ridge from
  // the slope hanging off it — before this, both were the same colour and the crest only
  // existed in silhouette. The ecological alibi keeps it honest: scoured crests really
  // do carry heath over grass. Gated back in the desert so it cannot fight duneRidge's
  // painted crests, and to half strength on steep rock where the slope bands own the look.
  const crest = smooth(0.012, 0.08, -_rel) * smooth(20, 45, h)
              * (1 - 0.5 * smooth(0.3, 0.5, _wD / sum));
  if (crest > 0.01) {
    lerp1(cHeath, crest * (1 - steep) * 0.25);
    _r *= 1 + crest * 0.10; _g *= 1 + crest * 0.07; _b *= 1 + crest * 0.02;
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
  // THE SHED SLOPE COMES FROM THE PROBE, NOT THE LOD LATTICE. normalY is sampled at the
  // ring's own vertex pitch, so at LOD1/2 (15-40 m) the shed gate flipped per-vertex on
  // high-curvature caps — those are the hard triangle facets on every distant peak. The
  // probe's fixed 30 m stencil is a pure function of position: the same cover boundary at
  // every LOD, band-limited so a 40 m lattice can actually resolve it. normalY survives
  // only as a 10% "ruffle" that lets LOD0 keep its fine margin texture without being able
  // to flip cover at distance.
  const nyF = (_gxP !== 0 || _gzP !== 0)
    ? 1 / Math.sqrt(1 + _gxP * _gxP + _gzP * _gzP) : normalY;
  const shed = 1 - smooth(0.13, 0.42, 1 - nyF);          // ~29 deg -> ~55 deg
  const ruffle = 1 - smooth(0.13, 0.42, 1 - normalY);
  // DRIFT: snow FILLS hollows and the wind STRIPS crests — the snowline slides down into
  // concave ground (+45 m at most) and up off convex ground (-30 m), which breaks the
  // painted-on contour line into fingers and cornices that follow the landform.
  const snowShift = Math.max(-30, Math.min(45, _rel * 600));
  const cover = smooth(snowline - 26 - snowShift, snowline + 40 - snowShift, h)
              * shed * (0.90 + 0.10 * ruffle);
  if (cover > 0.004) {
    // deep snow is whiter; the thin fringe keeps more of the ground under it
    set2(cSnow); lerp2(cRockD, (1 - cover) * 0.5);
    // snow is never flat white: two octaves of sastrugi-scale grain toward a shaded
    // blue-grey, so a cap is a surface with weather on it rather than a decal
    const sgr = noise2(x * 0.034 + 8.8, z * 0.034 + 2.6) * 0.6
              + noise2(x * 0.115 + 21.3, z * 0.115 + 9.9) * 0.4;
    lerp2(cSnowShade, sgr * 0.16);
    // cool it where the surface turns away from the sky, warm the sunlit tops a hair
    _b2 += (0.055 - 0.03 * nyF) * cover;
    lerp12(cover * 0.94);
  }
  // ── HYPSOMETRIC CONTRAST — vertical aerial perspective, baked ──────────────────────
  // Relief maps grade tone with elevation because the eye expects altitude to carry
  // light: lowlands sit under more air, so they desaturate toward a cool neutral, while
  // highlands gain chroma and a whisper of warm luminance. 5-6% at the extremes —
  // this term must be FELT as depth, never seen as a gradient. Luminance-and-warmth
  // only (no hue rotation), so it composes with the moisture/dry olive shifts instead
  // of double-dipping, and it sits after snow so the caps cannot clip.
  const hypHi = smooth(140, 480, h) * 0.06;
  const hypLo = (1 - smooth(15, 130, h)) * 0.05;
  const hypLum = 0.35 * _r + 0.5 * _g + 0.15 * _b;
  if (hypLo > 0.001) {
    _r += (hypLum - _r) * hypLo * 1.2;
    _g += (hypLum - _g) * hypLo;
    _b += (hypLum - _b) * hypLo * 0.6;
  }
  if (hypHi > 0.001) {
    _r = hypLum + (_r - hypLum) * (1 + hypHi) + hypHi * hypLum * 0.035;
    _g = hypLum + (_g - hypLum) * (1 + hypHi) + hypHi * hypLum * 0.025;
    _b = hypLum + (_b - hypLum) * (1 + hypHi) + hypHi * hypLum * 0.008;
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
  if (rw > 0.5) {
    // The margin m is 60-90 m around a strip only ~26 m wide, so ANY generous share of
    // that falloff is a dirt field several times the width of the runway, reaching well
    // past both thresholds. Painting only the top third of the falloff keeps it to a
    // shoulder of roughly 20-30 m — which is what a strip actually wears — and the noise
    // on the threshold stops that shoulder being a parallel-sided outline.
    const edge = 0.62 + 0.22 * noise2(x * 0.045 + 5.1, z * 0.045 + 9.3);
    const p = smooth(edge, 0.985, rw);
    if (p > 0.004) lerp1(cDirt, p * 0.72);
  }
  out[0] = _r; out[1] = _g; out[2] = _b;
}
