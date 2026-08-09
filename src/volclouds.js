import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, ToneMappingEffect, ToneMappingMode, BloomEffect } from 'postprocessing';
import { CloudsEffect, CloudShape, CloudShapeDetail, LocalWeather, Turbulence } from '@takram/three-clouds';
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, DEFAULT_PRECOMPUTED_TEXTURES_URL } from '@takram/three-atmosphere';
import { STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial';

// The sky. Volumetric clouds via @takram/three-clouds — the same thing the
// three.js 3d-tiles example uses: a raymarched density field with shape and
// detail noise, a weather map, and temporal upscaling driven by blue noise.
// These replaced the old sprite cumulus outright, so this module owns the
// post-processing chain whenever it loads (?vclouds=0 falls back to plain).
//
// The one genuinely awkward part is that the library is GEOSPATIAL: it works
// on a WGS84 ellipsoid in ECEF coordinates, where "up" is away from Earth's
// centre and cloud altitudes are metres above sea level. Our world is a small
// flat y-up scene. The bridge is worldToECEFMatrix — we declare that our
// origin sits on the equator at sea level and hand it the axis mapping, after
// which its altitudes line up with ours one-for-one.

const EARTH_R = 6378137;

// How many times the weather map wraps the globe. Declared up here because the
// island cap has to be baked into that map at generation time, and it needs the
// tile size in metres — so this value must be known BEFORE the map is rendered,
// not set later alongside coverage.
// ?wrepeat= overrides it for tuning: it is the one knob for cloud SIZE, and the
// only way to compare sizes is to look at two of them.
const PARAMS = new URLSearchParams(location.search);
// 75, not 120. This is cloud WIDTH, and it is half of an aspect ratio whose other half
// (layer height) was the only one exposed — which is how the deck ended up as vertical
// curtains with flat sides. Measured against a straight-wall detector that scores the
// longest contiguous run of vertical discontinuity in a frame, at a pose where the wall
// is unmistakable: width 120 scores 182, width 60 scores 77, width 40 scores 48. Height
// alone does almost nothing — 2300 -> 1200 scored 150.
const WEATHER_REPEAT = +(PARAMS.get('wrepeat')) || 90;

// How hard to round the joins between blobs in the weather map. 0 restores plain max(),
// which is what produced the creases — see the smax() comment in renderWeatherMap.
// ?smooth=0 is the A/B.
const SMOOTH_K = PARAMS.get('smooth') != null ? +PARAMS.get('smooth') : 1;

// NO TEMPORAL HISTORY. This is where the grain came from.
//
// By default the library renders only 1/16 of the cloud pixels each frame (a quarter
// of each axis) and rebuilds the frame by reprojecting the previous one. It is cheap,
// but every screenshot all session had a sprayed, dithered look on the clouds that I
// kept putting down to a static camera warming up. It was not: it is the
// reconstruction. Rendering a COMPLETE but smaller cloud buffer with no history at all
// removes it — same density field, same shapes, but the lobes resolve cleanly and the
// cirrus stops being speckle. Reprojection also smears anything that does not move
// with the world, which for a chase camera means the aeroplane itself.
//
// 0.30, and this is BY FAR THE MOST EXPENSIVE NUMBER IN THE FILE. Cost tracks buffer
// pixels, so it is very close to quadratic in this scale. Three points on the four-level
// sky, five poses at 1920x1000, interleaved so thermal drift hits every setting equally:
//   0.30   6.3  6.1  6.8  8.5  6.8 ms    118-164 fps
//   0.45   7.8  9.2 10.5 12.9 10.4 ms     78-128 fps
//   0.75  16.4 18.4 23.0 26.5 22.0 ms     38-61 fps
// 0.30 against 0.75 is 3.1x for a difference that is hard to see: the cloud silhouettes
// soften slightly and small distant puffs lose a little edge, but the shapes, the
// shading and the layering are all identical — none of that lives in this buffer.
// Nothing else in this module comes close to buying that much frame time.
//
// The floor is 0.25 (clamped below). Under about 0.3 the upscale starts eating small
// clouds outright rather than just softening them.
//
// ?nohist=0 restores temporal reconstruction, ?cloudres= overrides the scale, and the
// tuning panel (P) has it as the "cloud res" slider.
const NO_HISTORY = PARAMS.get('nohist') !== '0';
const CLOUD_RES = Math.min(1, Math.max(0.25,
  +(PARAMS.get('cloudres')) || (NO_HISTORY ? 0.30 : 1)));

// our world: +X east, +Y up, -Z north (so +Z is south)
// ECEF at lat 0 lon 0: +X is up through the surface, +Y east, +Z north
function worldToECEF() {
  return new THREE.Matrix4().set(
    0, 1, 0, EARTH_R,   // world X (east)  -> ECEF Y
    1, 0, 0, 0,         // world Y (up)    -> ECEF X
    0, 0, -1, 0,        // world Z (south) -> ECEF -Z
    0, 0, 0, 1,
  );
}

// ---------------------------------------------------------------------------
// ISLAND CLOUD CAP. Cumulus are thermal: they need a warm surface pumping air
// upward, which land gives and cool open ocean does not. A tropical island
// characteristically wears a cap of cloud while the sea around it stays clear —
// so instead of one uniform deck to the horizon, the convective cloud lives over
// the island and a little way out, and beyond that the sky opens up.
//
// It also happens to be the strongest available cure for the saturated slabs:
// the "cuts" come from the BOUNDARY of regions where the ray fully attenuates,
// and a deck that runs to the horizon guarantees enormous sightlines through
// cloud. Ending the deck a few km offshore ends most of those sightlines.
//
// Implemented by multiplying the generated weather map, which is cheaper and
// simpler than it sounds: a fullscreen quad with multiply blending
// (blendSrc = DstColor, blendDst = Zero → dst * src) needs no read-back of a
// 4096² texture and no second target. Only the r and g channels are masked;
// b carries the high veil, and cirrus is synoptic rather than thermal, so it has
// no business caring where the island is.
// TILE SIZE IS NOT THE EQUATOR OVER THE REPEAT COUNT, and getting that wrong is
// what made the first version of this cap useless. localWeatherRepeat counts
// repeats across a CUBE-SPHERE FACE, not around the circumference: the library's
// getGlobeUv is getCubeSphereUv, and near the centre of a face that reduces to
// uv = 0.5 + 0.5 * sqrt(2) * lateral / R. So one uv unit spans sqrt(2) * R, and a
// tile is sqrt(2) * R / repeat = 75 km at repeat 120 — not the 334 km that
// 2*pi*R/repeat gives. Assuming the circumference made every distance in here
// 4.44x too large, so a cap meant to cover a 7-8 km island actually died 2-4 km
// out (measured looking straight up: cloud overhead 87% at 2 km, 1.7% at 4 km).
// That near, hard, all-round boundary is exactly what reads as a straight wall of
// cloud from the cockpit.
function capTileMetres(repeat) {
  return Math.SQRT2 * EARTH_R / repeat;
}

// PIN THE ISLAND TO ONE SPOT IN THE WEATHER TEXTURE.
//
// The world origin lands at texture uv fract(0.5 * repeat), which is 0 for an even repeat
// and 0.5 for an odd one — so every single step of the width control dropped the island
// somewhere completely different in the map, and how much cloud it got was a lottery.
// Measured overhead cover against width, with no offset: 2.98, 2.51, 3.19, 3.84, 2.12,
// 2.49, 2.25, 2.61, 1.79, 3.44, 1.01. No trend at all, just noise — which is why 45 gave
// a sky and 40 gave almost nothing, and why the control was impossible to tune with.
//
// localWeatherOffset shifts where the origin samples, so choosing it per repeat makes the
// island sit on the SAME piece of weather at every width. Changing width then zooms that
// piece in and out, which is what the control was supposed to mean.
const CAP_UV = 0.5;
function weatherOffsetFor(repeat) {
  const o = (CAP_UV - 0.5 * repeat) % 1;
  return o < 0 ? o + 1 : o;
}

// ---------------------------------------------------------------------------
// OUR OWN WEATHER MAP, replacing the library's generated one.
//
// The library's LocalWeather is a single-frequency CELLULAR noise: Voronoi cells that
// tile the plane, all the same size, packed edge to edge. Everything wrong with the
// cloud shapes traces back to it. Every cloud came out the same size because every cell
// is; clouds sat shoulder to shoulder because Voronoi covers the plane with no gaps; and
// the footprints were polygons, which extruded into the prisms with flat vertical sides
// that read as walls.
//
// A cumulus field is not a tessellation. It is SPARSE, ISOLATED blobs of WIDELY VARYING
// size on an empty background. So this builds exactly that: three octaves of scattered
// round blobs, each octave a different size class, combined with max() rather than a sum.
//
// max() is the important part and the reason this is not just more fbm. Summing octaves
// makes every blob a lumpy version of the same average size and fills the gaps between
// them; taking the max keeps each blob its own size and leaves the background at zero, so
// a small puff next to a big mass stays a small puff instead of merging into grey soup.
function renderWeatherMap(renderer, target, seed, smooth = SMOOTH_K) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: seed }, uSmooth: { value: smooth } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float uSeed;
      uniform float uSmooth;   // 0 = plain max, the old creased field (?smooth=0)
      varying vec2 vUv;

      // hash on a lattice that WRAPS at per, so the whole map tiles.
      // per is per-AXIS. It used to be a single float, which is fine while both axes run
      // at the same frequency but silently breaks the moment they do not: the cirrus uses
      // 5 across and 17 down, so x reached only 5 before the tile ended while the lattice
      // was told to wrap at 17, and the map did not join up. Measured as a 48x brightness
      // jump along one vertical line — a straight edge across the sky, every tile.
      vec3 hash33(vec2 p, vec2 per, float s) {
        p = mod(p, per);
        vec3 q = fract(vec3(p.x, p.y, p.x + p.y) * vec3(0.1031, 0.1030, 0.0973) + s);
        q += dot(q, q.yzx + 33.33);
        return fract((q.xxy + q.yzz) * q.zyx);
      }

      // SMOOTH MAX. Worth having, but NOT the cause of the big walls — see below.
      //
      // max(a, b) is continuous in VALUE but its GRADIENT jumps where a == b. That is a
      // crease: no hole, no seam, nothing a value-difference detector can see, which is
      // why scanning the map for straight edges comes back clean at every threshold. The
      // renderer extrudes this 2D map vertically, so a crease CURVE in the map becomes a
      // crease PLANE in the sky — a fold with a lit face and a shaded face, running the
      // full height of the layer. Every blob junction was making one.
      //
      // Measured with a Hough transform over a 240-pose grid, scoring the most edge
      // pixels sharing one straight line: worst case 130 px with plain max, 90 px with
      // this. A real 31% — but it does NOT touch the dominant wall, and the A/B frames at
      // the worst pose are indistinguishable. That wall is the layer LID (a horizontal
      // cut, not a vertical fold) and it needs a different fix.
      //
      // Recorded because it cost time: the first straight-edge detector scored the
      // longest contiguous run of vertical discontinuity, which fires just as hard on an
      // ordinary near-vertical cloud silhouette. It called a wall-free frame worse than a
      // walled one. Straightness needs a straightness measure, not a run length.
      //
      // The k term is what rounds the fold. Beyond |a - b| > k this is EXACTLY max, so
      // isolated blobs keep their own size and the background stays at zero (the whole
      // point of using max over a sum). Only the junctions change.
      float smax(float a, float b, float k) {
        k *= uSmooth;
        if (k <= 0.0) return max(a, b);
        float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
        return mix(b, a, h) + k * h * (1.0 - h);
      }

      // Scattered blobs: one per lattice cell, jittered off the lattice so the grid does
      // not show, and each with its OWN radius. cover decides how many cells carry a blob
      // at all — that is what leaves real gaps between clouds.
      // THREE CANDIDATE BLOBS PER CELL, NOT ONE. Flying high with shapeAmount at 0 strips
      // off the noise that normally hides the geometry, and the raw field turned out to be
      // laid out in visible REGULAR ROWS. One blob per lattice cell, jittered over only
      // 0.7 of a cell, quantises the spacing to the grid — no amount of coverage or
      // density hides a rhythm, and the eye finds it instantly.
      //
      // Three independent draws per cell, each with its own hash and its own accept roll,
      // and full-cell jitter, gets close to Poisson placement: cells can hold nothing,
      // one, or a tight pair, and the spacing histogram stops having a spike at the cell
      // pitch. cover is per DRAW, so it is a third of what it was for the same total.
      //
      // The 5x5 neighbourhood is not optional with full jitter — a blob centred at 0.95
      // with radius 0.85 reaches 1.8 cells, so a 3x3 search clips blobs at the cell
      // boundary and puts back straight edges of a different kind. Cost is irrelevant:
      // this bakes once into a 4096 texture, it is not a per-frame path.
      float blobs(vec2 uv, float freq, float s, float cover, float rMin, float rMax) {
        vec2 p = uv * freq;
        vec2 i = floor(p), f = fract(p);
        float m = 0.0;
        for (int y = -2; y <= 2; ++y) {
          for (int x = -2; x <= 2; ++x) {
            vec2 g = vec2(float(x), float(y));
            for (int k = 0; k < 3; ++k) {
              vec3 h = hash33(i + g, vec2(freq), s + float(k) * 19.73);
              if (h.z > cover) continue;                // empty draw: real sky
              vec2 c = g + 0.05 + h.xy * 0.9;           // jittered centre, full cell
              float r = mix(rMin, rMax, fract(h.z * 7.31 + float(k) * 0.41));
              float d = length(f - c) / r;
              m = smax(m, 1.0 - smoothstep(0.35, 1.0, d), 0.12); // soft round falloff
            }
          }
        }
        return m;
      }

      // low-frequency warp, so blob outlines are organic rather than circular
      float vn(vec2 p, vec2 per) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash33(i, per, 3.7).x, b = hash33(i + vec2(1,0), per, 3.7).x;
        float c = hash33(i + vec2(0,1), per, 3.7).x, d = hash33(i + vec2(1,1), per, 3.7).x;
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      void main() {
        vec2 uv = vUv;
        // warp amplitude is in uv, kept small so blobs deform rather than tear apart
        vec2 w = vec2(vn(uv * 12.0, vec2(12.0)), vn(uv * 12.0 + 5.3, vec2(12.0))) - 0.5;
        vec2 q = uv + w * 0.045;

        // THREE SIZE CLASSES, max-combined. Frequencies are integers so each octave wraps
        // with the texture, and they stay tied to the TILE rather than to metres — that is
        // what keeps the width control meaningful, since widening the tile widens every
        // class together. At the default 75 (a 120 km tile) these are roughly 4 km, 2 km
        // and 1 km blobs. Getting this wrong is dramatic: the first attempt used 14, which
        // is an 8.6 km blob, and the camera simply ended up inside one.
        // cover is now per DRAW and there are three draws per cell, so these are a third
        // of the old 0.26 / 0.30 / 0.34 — same amount of sky covered, placed irregularly.
        float big   = blobs(q, 30.0,  uSeed + 0.11, 0.087, 0.40, 0.85);
        float mid   = blobs(q, 60.0,  uSeed + 0.37, 0.100, 0.32, 0.68);
        float small = blobs(q, 120.0, uSeed + 0.73, 0.113, 0.26, 0.55);
        float r = smax(smax(big * 1.00, mid * 0.90, 0.14), small * 0.78, 0.14);

        // g: the big-mass channel — the same field biased hard toward the large class,
        // so layer 3 draws on genuinely bigger footprints instead of the same ones
        float g = smax(big * 1.00, mid * 0.55, 0.16);

        // b: cirrus. Smooth and broad, stretched along one axis so it streaks.
        // per-axis periods MUST match the per-axis frequencies, or the map does not join
        float b = vn(vec2(q.x * 5.0,  q.y * 17.0), vec2(5.0,  17.0)) * 0.6
                + vn(vec2(q.x * 11.0, q.y * 31.0), vec2(11.0, 31.0)) * 0.4;

        // a: PER-COLUMN CLOUD TOP, and the alpha channel exists for exactly this.
        // The library's maxLayerHeights is a vec4 — ONE top per layer, globally. Since
        // the weather map is 2D, density is weather(x,z) * profile(height), so the
        // surface where density crosses the coverage threshold solves to height =
        // constant. A flat lid, guaranteed by construction, on every cloud in the sky.
        // This channel is read back in the patched sampleWeather (see patchLayerTops)
        // to scale each column's top independently, which is the only thing that turns
        // that lid into a surface. Low frequency on purpose: cloud tops vary over
        // kilometres, not metres, and high frequency here would just read as noise.
        float a = vn(q * 7.0,  vec2(7.0))  * 0.65
                + vn(q * 17.0, vec2(17.0)) * 0.35;

        gl_FragColor = vec4(r, g, b, a);
      }`,
    depthTest: false, depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const prev = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = true;              // this pass OWNS the map, unlike the bakes
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.autoClear = prevAutoClear;
  mat.dispose();
}

// THE FADE IS NOT AS SOFT AS IT LOOKS, because the mask lands upstream of a
// nonlinear threshold. The library computes
//   lw = pow(weather, weatherExponent)
//   density = remapClamped(mix(lw, 1, cfw), factor, factor + cfw), factor = 1 - coverage*heightScale
// so nothing survives at all unless lw > (1 - cfw - coverage*heightScale)/(1 - cfw).
// At best height that is weather > 0.75 for the sharp layer (cfw 0.35, exp 2.1)
// and > 0.46 for the soft ones. Multiplying the map by m therefore stops
// producing cloud once m falls past those values — not at uFloor. So the floor is
// almost decorative, the kill lands only ~40% of the way through the smoothstep
// for the sharpest layer and ~70% for the softest, and the fade has to be spread
// wide for the transition to read. The upside is that the layers then die at
// different radii, which feathers the edge instead of ending it all at once.
// ---------------------------------------------------------------------------
// PER-COLUMN CLOUD TOPS. The one structural fix for the flat lid.
//
// The library declares minLayerHeights / maxLayerHeights as vec4 uniforms — a single
// top per LAYER, shared by the whole sky. Combined with a 2D weather map that makes
// density = weather(x, z) * profile(height), the surface where density crosses the
// coverage threshold solves to height = constant. Every cloud gets a dead flat lid and
// a dead flat base, and no parameter can change that because none of them are functions
// of horizontal position.
//
// Measured before writing this, on three flight poses, with a straightness metric and a
// grain metric side by side: coverageFilterWidth and shapeAlteringBias DO reduce the
// straight edges, but they buy every point of it with speckle, near enough one for one
// (-57% wall / +95% grain, -41% / +89%, -26% / +107%). They are not a fix, they are a
// trade. Setting shapeAmount to 0 makes the walls twice as bad, which confirms the 3D
// shape noise was the only thing breaking the lid at all.
//
// So: patch sampleWeather to read a per-column top out of the weather map's alpha
// channel and scale each column's ceiling with it. Nothing else in the shader changes.
// Done through onBeforeCompile rather than by forking the package, so a version bump
// only breaks the string match — which throws loudly here instead of silently doing
// nothing. ?lidvary=0 disables it for comparison.
const LID_VARY = PARAMS.get('lidvary') != null ? +PARAMS.get('lidvary') : 0.5;

const LID_TARGET =
  'weather.heightFraction = remapClamped(vec4(height), minLayerHeights, maxLayerHeights);';

function patchLayerTops(clouds, amount) {
  // BOTH ends move, and the base is the one that matters most. The first version varied
  // only the ceiling and bought a mere -12% on the worst pose, because the worst poses
  // are underneath a deck looking at its FLOOR, which was still perfectly flat. The
  // second sample is the same channel read at a shifted uv, which decorrelates it from
  // the ceiling for free rather than spending another texture.
  //
  // The base moves far less than the top on purpose: a real cumulus field has a genuinely
  // flat base, because the lifting condensation level is the same for the whole airmass.
  // Flat is correct there; a razor edge is not. The top has no such excuse.
  const replacement = `
  vec2 ffUv = uv * localWeatherRepeat + localWeatherOffset;
  float ffTop = textureLod(localWeatherTexture, ffUv, mipLevel).a;
  float ffBot = textureLod(localWeatherTexture, ffUv + vec2(0.37, 0.19), mipLevel).a;
  vec4 ffSpan = maxLayerHeights - minLayerHeights;
  vec4 ffMin = minLayerHeights + ffSpan * (${(amount * 0.34).toFixed(3)} * ffBot);
  vec4 ffMax = minLayerHeights + ffSpan * mix(${(1 - amount).toFixed(3)}, 1.0, ffTop);
  weather.heightFraction = remapClamped(vec4(height), ffMin, max(ffMax, ffMin + 1.0));`;

  const seen = new WeakSet();
  let patched = 0, candidates = 0;
  const visit = (m) => {
    if (!m || !m.isMaterial || seen.has(m)) return;
    seen.add(m);
    if (typeof m.fragmentShader !== 'string' || !m.fragmentShader.includes('sampleWeather')) return;
    candidates++;
    if (!m.fragmentShader.includes(LID_TARGET)) return;
    m.fragmentShader = m.fragmentShader.split(LID_TARGET).join(replacement);
    m.needsUpdate = true;
    patched++;
  };
  for (const pass of [clouds.cloudsPass, clouds.shadowPass]) {
    if (!pass) continue;
    for (const k of Object.keys(pass)) { const v = pass[k]; if (v && v.isMaterial) visit(v); }
    visit(pass.currentMaterial);
  }
  return { patched, candidates };
}

function applyIslandCap(renderer, weather, repeat) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTileM: { value: capTileMetres(repeat) },
      // The island is pinned to CAP_UV by localWeatherOffset (see weatherOffsetFor), so
      // the mask goes there rather than wherever fract(0.5 * repeat) happened to land.
      uOrigin: { value: new THREE.Vector2().setScalar(CAP_UV) },
      // TUCKED IN OVER THE ISLAND. The shore reaches RM_BASE * shapeS() + coast warp,
      // at most ~8 km on any seed (7200 * 1.0 classic, 5400 * 1.3 seeded). Full cover
      // deliberately stops SHORT of that at 5.5 km, so the outer coast sits in the
      // fade and the cloud thins as it reaches the water — which is what actually
      // happens, since the thermals come off the warm interior and die over the sea.
      // The layers give out around 9.5 km, plus wherever the warp pushes them.
      uFull: { value: 5500 },
      uFade: { value: 11000 },
      // THE FLOOR HAS TO TRACK COVERAGE. Coverage sets the bar the masked field must
      // clear, so a floor that keeps the sea clear at coverage 0.30 leaks cloud all
      // the way to the fade limit at 0.44 — measured as the cap's outer cloud jumping
      // from 19.9 km to 25.6 km. 0.08 holds it up to coverage ~0.5: the strongest
      // offshore cell reaches 0.9 * 0.08 = 0.07 against a bar of 0.13. It also widens
      // the fade's USABLE range — the transition now spans almost the whole smoothstep
      // instead of only its first 40% — so the edge is more gradual, not less.
      uFloor: { value: 0.08 },
      uWarp: { value: 2400 },   // how far the edge wanders off a circle
      // CLUSTERING — see the note above the function.
      // ?cluster=0 switches the district field off, because it is baked into the weather
      // map and there is otherwise no way to A/B it at runtime
      uQuiet: { value: PARAMS.get('cluster') === '0' ? 1 : 0.66 },   // quiet districts held down
      // 0.64, up from 0.52. With no temporal averaging to blur it, a district of cells
      // that only PARTLY merge reads as popcorn lace rather than cloud — dozens of
      // separate little puffs at 5-15 km. Lifting harder finishes the merge.
      uLift: { value: PARAMS.get('cluster') === '0' ? 0 : 0.64 },   // active districts blended toward 1
      // Integer cells per tile so the lattice wraps seamlessly, sized for a ~10 km
      // district — two or three of them across the cap.
      uFreq: { value: Math.max(2, Math.round(capTileMetres(repeat) / 10000)) },
      uAdd: { value: 0 },        // 0 = the multiply pass, 1 = the additive pass
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float uTileM, uFull, uFade, uFloor, uWarp, uQuiet, uLift, uFreq, uAdd;
      uniform vec2 uOrigin;
      varying vec2 vUv;
      // Value noise on a lattice that wraps at uPer, so the district field tiles with
      // the texture and there is no seam to hide.
      float h21(vec2 p, float per) {
        p = mod(p, vec2(per));
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vn(vec2 p, float per) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic: C2, no lattice creases
        return mix(mix(h21(i, per),                h21(i + vec2(1.0, 0.0), per), u.x),
                   mix(h21(i + vec2(0.0, 1.0), per), h21(i + vec2(1.0), per), u.x), u.y);
      }
      void main() {
        // The island can straddle the texture wrap, so measure from uOrigin and
        // wrap the difference into [-0.5, 0.5) before scaling to metres —
        // otherwise the cap lands in a corner, or in the wrong place entirely.
        vec2 q = vUv - uOrigin;
        vec2 p = (q - floor(q + 0.5)) * uTileM;
        // A perfect circle of cloud looks as manufactured as a straight wall
        // does, and its tangent is a straight edge too. Integer harmonics of the
        // bearing wander the edge by a few km and are seamless by construction —
        // they close on themselves at 2pi with no wrap to hide.
        float a = atan(p.y, p.x);
        float warp = 0.55 * sin(a * 3.0 + 0.7) + 0.34 * sin(a * 5.0 + 2.1)
                   + 0.22 * sin(a * 8.0 + 4.3) + 0.13 * sin(a * 13.0 + 1.2);
        // Normalised to [0,1] and SUBTRACTED, so the edge only ever moves OUTWARD.
        // Added symmetrically, the harmonics sum to +-1.24 and would pull full cover
        // in to uFull - 5200 m on the worst bearing — a bite out of the cap that
        // leaves a third of the island under clear sky, and the outermost-cloud
        // measurement cannot see it because it reports the max over all bearings.
        float r = length(p) - (warp * 0.403 + 0.5) * uWarp;
        float m = mix(1.0, uFloor, smoothstep(uFull, uFade, r));
        // Districts of merged masses and districts of scattered puffs. Two octaves,
        // both wrapping, sampled on the raw uv so the field is continuous across the
        // fold seam that p has.
        float cl = vn(vUv * uFreq, uFreq) * 0.64
                 + vn(vUv * uFreq * 2.0, uFreq * 2.0) * 0.36;
        // The two passes together compute mix(weather, 1, t) — a blend TOWARD FULL,
        // not a flat offset. That distinction is the whole thing: a flat +0.26 leaves
        // the gaps at 0.26, still under the 0.46 the softest layer needs, so nothing
        // merged. Blending toward 1 lifts the deep gaps a lot and the peaks barely,
        // which closes gaps at t = 0.5 while leaving the cell cores as cores. The
        // sharp layer's 0.745 bar still only passes those cores, so an active district
        // becomes one broad mass with denser knots in it rather than a flat blob.
        float t = uLift * smoothstep(0.42, 0.95, cl);
        float v = uAdd > 0.5
          // ADD the t. Masked by m too, or the sea would gain what the first pass took.
          ? m * t
          // MULTIPLY by (1 - t), and hold the quiet districts down while we are here.
          : m * (1.0 - t) * mix(uQuiet, 1.0, smoothstep(0.0, 0.58, cl));
        // b (veil) left alone by both passes, and so is a (per-column cloud top) — the
        // add pass MUST write 0 there or dst + 1.0 saturates the channel to white and
        // every column gets the same top again, silently undoing the lid fix.
        gl_FragColor = vec4(v, v, uAdd > 0.5 ? 0.0 : 1.0, uAdd > 0.5 ? 0.0 : 1.0);
      }`,
    depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,   // dst * src
    blendDst: THREE.ZeroFactor,
  });
  // TWO PASSES, because multiply alone cannot merge cells. The cellular field is
  // bright centres separated by dark gaps, and scaling it scales both together —
  // the gaps stay proportionally as deep, so the threshold contour keeps every cell
  // separate no matter how hard the district is lifted (measured: clustering by
  // multiply alone left the biggest cloud at 2.2 km, unchanged). ADDING is what
  // closes a gap, because it raises the minima toward the bar without touching the
  // ratio. So: multiply to suppress the quiet districts, then add to merge the
  // active ones.
  const add = mat.clone();
  add.uniforms.uAdd.value = 1;
  add.blendSrc = THREE.OneFactor;   // dst + src
  add.blendDst = THREE.OneFactor;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const prev = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;               // must NOT wipe the weather we just made
  renderer.setRenderTarget(weather.renderTarget);
  renderer.render(scene, cam);
  scene.children[0].material = add;
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.autoClear = prevAutoClear;
  mat.dispose(); add.dispose();
}

export async function createVolumetricClouds({ renderer, scene, camera, sunDir }) {
  // Atmosphere lookup tables. The generator computes these on the GPU but
  // drives itself across animation frames, so the loader is both simpler and
  // faster here (~1.3 s from CDN) and needs no frame pump.
  const textures = await new Promise((resolve, reject) => {
    new PrecomputedTexturesLoader().load(DEFAULT_PRECOMPUTED_TEXTURES_URL, resolve, undefined, reject);
  });

  const clouds = new CloudsEffect(camera, { resolutionScale: CLOUD_RES });
  clouds.transmittanceTexture = textures.transmittanceTexture;
  clouds.irradianceTexture = textures.irradianceTexture;
  clouds.scatteringTexture = textures.scatteringTexture;
  clouds.higherOrderScatteringTexture = textures.higherOrderScatteringTexture;
  if (textures.singleMieScatteringTexture) clouds.singleMieScatteringTexture = textures.singleMieScatteringTexture;

  // Shape, detail, weather and turbulence are all generated on the GPU rather
  // than downloaded — the package ships procedural versions, which suits a
  // project that has no asset pipeline at all.
  const procedural = [];
  const shape = new CloudShape(); shape.render(renderer, 0); clouds.shapeTexture = shape.texture; procedural.push(shape);
  const detail = new CloudShapeDetail(); detail.render(renderer, 0); clouds.shapeDetailTexture = detail.texture; procedural.push(detail);
  // The weather map is generated at 512 and stretched over a tile the size of a
  // continent — at our localWeatherRepeat that is 312 m per texel. Edge-on you
  // never notice, but seen from ABOVE the coverage threshold runs along the
  // bilinear texel grid and the cloud field comes out as axis-aligned blocks.
  // The generator has no size parameter (LocalWeather hard-codes 512), but the
  // shader derives its UVs from geometry, so resizing the target before the one
  // render it does is enough: 78 m per texel, and the blocks go away.
  // 4096, and the reason is worth writing down: the resolution that matters is
  // METRES PER TEXEL, not the texture size. Enlarging the clouds (localWeather-
  // Repeat 250 -> 150) enlarged the tile too, so at 2048 the grid coarsened from
  // 78 m to 130 m per texel — and the layer that keeps only the field's peaks
  // then had surviving regions just two or three texels across. A few texels of a
  // thresholded bilinear field IS a rectangle, extruded into a literal cube of
  // cloud. 4096 puts it back to 65 m and the cubes go with it.
  // LocalWeather is still constructed, but only for its render target and texture — the
  // wrapping, filtering and mipmaps are already set up correctly on it. What goes INTO
  // that target is ours now (see renderWeatherMap). ?libweather=1 puts the library's
  // cellular field back, for comparison.
  const weather = new LocalWeather();
  weather.renderTarget.setSize(4096, 4096);
  weather.size = 4096;
  const USE_LIB_WEATHER = PARAMS.get('libweather') === '1';
  const bakeWeather = (repeat, smooth = SMOOTH_K) => {
    if (USE_LIB_WEATHER) { weather.needsRender = true; weather.render(renderer, 0); }
    else renderWeatherMap(renderer, weather.renderTarget, 0.37, smooth);
    // ?cap=0 skips the island mask entirely — the mask boundary was a suspect for the
    // straight cuts, and it is baked into the map so there is no other way to A/B it
    if (PARAMS.get('cap') !== '0') applyIslandCap(renderer, weather, repeat);
    weather.texture.needsUpdate = true;
  };
  bakeWeather(WEATHER_REPEAT);

  // Patch the library's sampleWeather so each column gets its own ceiling. Loud on
  // failure: if a package bump moves that line, silence here would look exactly like
  // the fix working badly, and I would spend the debugging on the wrong thing.
  if (LID_VARY > 0) {
    const r = patchLayerTops(clouds, LID_VARY);
    if (r.patched === 0) console.error('[volclouds] layer-top patch MISSED —',
      r.candidates, 'cloud materials seen, none matched. Lid fix is NOT active.');
  }
  clouds.localWeatherTexture = weather.texture; procedural.push(weather);
  const turb = new Turbulence(); turb.render(renderer, 0); clouds.turbulenceTexture = turb.texture; procedural.push(turb);

  // Blue noise drives the temporal sampling. Non-fatal if it fails to load —
  // the clouds just get noisier — so it must not block startup.
  const stbnTargets = [clouds];
  new STBNLoader().load(DEFAULT_STBN_URL, (t) => { for (const o of stbnTargets) o.stbnTexture = t; }, undefined, () => {});

  const w2e = worldToECEF();
  clouds.worldToECEFMatrix.copy(w2e);
  clouds.ecefToWorldMatrix.copy(w2e).invert();
  clouds.sunDirection.copy(sunDir).transformDirection(w2e).normalize();

  // SIZE VARIATION. The default localWeatherRepeat of 100 tiles the weather
  // texture 100x around the globe, so one tile spans ~400 km while our island is
  // a few km across — we only ever sample a near-uniform scrap of it and every
  // cloud comes out the same size. 250 brings the blobs down to something like
  // real cumulus spacing. Much higher and the coverage field averages out into
  // permanent overcast, plus the raymarch starts aliasing.
  // FEWER BUT BIGGER. These two numbers have to move together, and that is the
  // whole trick. localWeatherRepeat is the only control over blob SIZE (smaller
  // number = bigger tile in world terms = bigger clouds); coverage is the
  // threshold, so lowering it makes clouds both fewer AND smaller.
  //
  // Enlarging alone is a trap: at repeat 100 with coverage still 0.30 the deck
  // got so continuous that 44% of the frame was optically saturated — every ray
  // fully attenuating — up from 12%. That saturation is what produced the hard
  // rectangular "cuts": a fully-attenuated region renders featureless, so the
  // boundary of the saturated area becomes a visible edge, and with a continuous
  // deck that boundary follows a layer's footprint and reads as a rectangle.
  //
  // Bigger AND sparser together gets both: 120 / 0.24 put saturation back to
  // about 9% while the clouds were noticeably larger and separated by real sky,
  // so what saturation remained was cloud-shaped instead of slab-shaped.
  //
  // The island cap then did far more for the same problem than the sizing did —
  // it ends the deck a few km offshore, which ends the long sightlines — so
  // coverage goes back UP to 0.30. Over the island that is a proper cumulus cap
  // rather than a thin scatter, and saturation still measures ~3% against the
  // ~12% we started from.
  // BACK TO 0.30 NOW THE LAYERS ARE TALL. 0.34 was right for a flat deck, but the
  // convective layers are 2.6x deeper than they were and the cap is tucked in over the
  // island, so the same coverage puts a third of the frame in fully-attenuated cloud
  // and buries the island. The lever is savagely nonlinear here — 0.30 / 0.26 / 0.22
  // measure 12.4% / 4.1% / almost nothing saturated — and 0.30 is the one that keeps a
  // full sky. Size no longer needs it: it comes from the height and from the tighter
  // cap concentrating the same cloud over less ground. The veil's own filter width
  // still has to track it (see the layer note), hence 1 - 0.30.
  // 0.20 for OUR weather map. The threshold has to be re-tuned from scratch whenever the
  // field changes, and this one is sparse where the library's tessellated the plane: its
  // blobs sit on empty background, so the same coverage that gave a fair-weather sky
  // before now puts the camera inside a cloud. Re-tuned by sweeping: 0.20 gives rounded,
  // varied, well-separated cumulus; 0.27 starts closing the gaps; 0.34 is overcast.
  clouds.coverage = 0.19;
  clouds.localWeatherRepeat.set(WEATHER_REPEAT, WEATHER_REPEAT);
  // WIND HAS TO COME OUT OF THE WEATHER MAP NOW, and this is the price of baking
  // the island cap into it. localWeatherOffset accumulates velocity * dt in TILE
  // units, so 0.00008 was translating the sampled field at 0.00008 * 75 km = 6 m/s
  // — and the cap rides along with it, sliding off the island by 3.6 km in ten
  // minutes and 20 km in an hour. Nobody would connect that to wind; it would just
  // look like the clouds wandered out to sea.
  //
  // No loss, because 6 m/s of translation is invisible from an aeroplane doing 60.
  // What actually reads as living cloud is the shape noise moving THROUGH the
  // field, which shapeVelocity does without touching the footprint: the lobes
  // churn and the tops boil while each cloud stays where it belongs. Units are
  // shape-texture periods, so 0.0022 is about 1.5 m/s of internal motion.
  clouds.localWeatherVelocity.set(0, 0);
  clouds.shapeVelocity.set(0.0022, 0.0009, 0.0016);
  // and the pin itself — must match what applyIslandCap baked at CAP_UV
  {
    const o = weatherOffsetFor(WEATHER_REPEAT);
    clouds.localWeatherOffset.set(o, o);
  }
  // 25, not 0 and not 120: enough to break the edges up without the fraying that ruled the
  // higher values out. The old note said "tuned off" — that was against a different weather
  // field, and the amount a cloud edge can take depends on how solid the body behind it is.
  clouds.turbulenceDisplacement = 25;

  // --- SCATTERING. All of these sat at library defaults until now, which is why none of them
  // appeared here before: the panel exposed them, and these are what came back.
  // scatteringCoefficient below 1 and a real absorption term together take the plastic
  // brightness off the interior; the two anisotropy lobes at 0.22 / -0.38 are a much weaker
  // forward lobe than the stock 0.7, so a cloud stops flaring white the moment the sun gets
  // behind it and keeps its form instead.
  clouds.scatteringCoefficient = 0.76;
  clouds.absorptionCoefficient = 0.09;
  clouds.scatterAnisotropy1 = 0.22;
  clouds.scatterAnisotropy2 = -0.38;
  clouds.scatterAnisotropyMix = 0.5;
  // more sky fill, less bounce off the ground — an island is mostly sea, and sea returns very
  // little upward compared to the land this defaulted for
  clouds.skyLightScale = 1.18;
  clouds.groundBounceScale = 0.56;

  // WHAT THE UNDERLYING SHAPE ACTUALLY IS, since it took setting shapeAmount to zero to
  // see it: the weather map is 2D. A cloud is that 2D footprint EXTRUDED vertically and
  // cut top and bottom by the density profile — so before any erosion, every cloud is a
  // prism. Round cell, cylinder; elongated cell, a long capsule; and the sides are
  // vertical by construction. That is the "underlying shape inside which the clouds are
  // rendered", and no layer parameter can change it, because it is the model.
  //
  // shapeAmount is the ONLY thing that breaks the prism — it is how much of the 3D shape
  // noise is allowed to eat into the footprint. At 0 you see bare prisms; at 1.0 the
  // vertical faces are chewed through. Measured on the straight-wall detector: 0.8 scores
  // 85, 0.95 scores 67, 1.0 scores 66. So it runs at 1.0 now. The remaining structure is
  // the prism showing through wherever the noise happens not to cut deep enough, and the
  // real cure for that is a wider footprint (see WEATHER_REPEAT) so the prism is squat
  // rather than tower-shaped.
  //
  // CLOUD SHAPE — this is what stops them looking like carved boxes. The shape
  // noise that erodes the coverage volume into lobes defaults to a 3333 m
  // wavelength (repeat 0.0003), which is WIDER THAN A WHOLE CLOUD: it barely
  // varies across one, so nothing carves the sides and you get a slab with a
  // flat top and vertical walls.
  //
  // But this value is also the WORLD-SPACE TILING PERIOD of the shape texture,
  // and that is the trap. 833 m gave lovely lobes and repeated them every 833 m,
  // so neighbouring clouds came out as copies and the sky read as a grid. Going
  // to a flat 2000 m killed the repeat and the lobes with it: the noise barely
  // varied across a 600 m cloud, so nothing carved it and clouds fused into long
  // smooth pipes. The two requirements pull in opposite directions.
  //
  // The way out is that this is a Vector3, not a scalar. Giving each axis its own
  // NON-COMMENSURATE period lets the 3D pattern repeat only at the common
  // multiple of the three, which is far past anything on screen. The y period is
  // deliberately the shortest: clouds are only 260-760 m deep, so vertical detail
  // has to be finer than horizontal to show at all.
  //
  // AND IT MUST BE SHORTER THAN THE CLOUD. At ~960 m the noise barely changed
  // across a 600 m cloud, so it could not chew through a coverage edge — and
  // those edges are the real source of the boxiness. The weather map is bilinear,
  // and a thresholded bilinear field has contours that follow its texel quads,
  // which are AXIS-ALIGNED in texture space; with only ~8 texels across a cloud
  // you get long straight silhouette edges lined up with two fixed world
  // directions. That is why clouds kept showing hard vertical sides no matter
  // what the coverage was doing. Noise at ~600 m breaks those edges up. Much
  // finer than ~450 m and it stops shaping and starts dissolving.
  clouds.shapeRepeat.set(0.0007, 0.0006, 0.0006); // ~1429 / 1667 / 1667 m

  // RAYMARCH RANGE — this is what makes the distant clouds hold together.
  // The stock march is sized for a geospatial viewer looking at weather 100+ km
  // away across the globe: steps start at 50 m and grow 1% each one up to
  // 1000 m, out to 200 km. Our camera's far plane is 12 km. So everything past
  // a few km was being crossed in strides far larger than a cloud layer is
  // deep, and distant clouds came out combed into regular vertical ribs — the
  // ribs fan with perspective because they are fixed-size gaps in world space,
  // which is what gave the sampling away. Holding the step constant over a ray
  // that stops near the far plane samples the whole visible range evenly.
  //
  // It costs nothing (measured p50 5.3 ms either way): rays terminate on
  // transmittance as soon as they are inside cloud, and empty sky is cheap at
  // any step size, so the long strides were only ever saving work nobody
  // needed. The artifact was invisible before only because the clouds were too
  // small and far to show it.
  clouds.clouds.maxIterationCount = 410;
  clouds.clouds.minStepSize = 65;
  clouds.clouds.maxStepSize = 120;
  // RANGE IS NOT THE CAMERA'S FAR PLANE. Capping this at 12-15 km to "match" the
  // far plane was wrong reasoning: the far plane clips scene GEOMETRY, while the
  // clouds are raymarched in post and composited, so nothing bounded them but
  // this number — and it was slicing the sky flat, cutting distant clouds in
  // half and leaving a hard band along the horizon.
  // 18 km, DELIBERATELY BACK INSIDE the range this warns about, and the warning above is
  // still true in general — it is the island cap that makes it safe here. Cloud density is
  // masked to a radius around the island, so past about 20 km there is nothing left to cut;
  // the flat slice and the hard horizon band happened when this bounded real cloud. Checked
  // rather than assumed: sampling the horizon band against 60 km finds no step in cloud cover
  // across it. Raise the cap radius and this has to come back up with it.
  clouds.clouds.maxRayDistance = 18000;
  // ...and the step has to be allowed to grow again, or the iteration budget
  // runs out at 65 m a step and the cut simply moves closer instead.
  // Growth was never what caused the combing — maxStepSize 1000 was, and that
  // stays capped at 120.
  clouds.clouds.perspectiveStepScale = 1.005;

  // The secondary march toward the sun is what self-shadows a cloud. Two
  // iterations at 100 m is enough for cloudscapes viewed from far away and too
  // coarse from inside one, where it banded the nearer masses.
  clouds.clouds.maxIterationCountToSun = 7;
  clouds.clouds.minSecondaryStepSize = 80;
  clouds.clouds.secondaryStepScale = 1.6;

  // 512 across three cascades put visible steps in the cloud self-shadowing at
  // this range. The cascade split planes were showing up as flat vertical faces
  // slicing through the nearer clouds.
  // 1024 rather than 2048, because the shadow pass turned out to be where the taller
  // layers actually cost their time: 2.5 ms of the 12, more than the primary march's
  // step size (50 -> 95 m bought only 1.1 ms, and visibly washed out the shading) and
  // far more than the ray range (60 -> 16 km bought 0.2 ms, since empty sky is nearly
  // free). Checked for the 512 failure at both cruise and close range — no cascade
  // faces, no banding, just slightly softer self-shadowing.
  clouds.shadow.mapSize.set(1024, 1024);

  // Four layers, used as size classes. Only three weather channels carry a
  // distribution — measured over the generated texture: r is sparse blobs (mean
  // 0.27), g sparser (0.16), b a smooth full-range bell (0.50). The a channel is
  // a constant 1.0, NOT a distribution: point a layer at it and you get
  // permanent overcast. weatherExponent thins a channel out, but note that
  // thinning the smooth b field yields FEWER, LARGER slabs rather than small
  // puffs, so b is only good for the high veil.
  //
  // The convective classes share ONE base altitude, because they should: in a
  // real cumulus field every cloud condenses at the same lifting condensation
  // level and they differ only in how far they climb. That is what makes the
  // bases line up flat while the tops vary — and it is where the size range
  // comes from. Two of them ride the same r channel on purpose: the strongest
  // cells of a field are exactly the ones that build deepest.
  //
  // Keep the depths WELL under the blob widths. Real fair-weather cumulus are
  // far wider than they are deep — flat-bottomed lozenges with bumpy tops — and
  // a weather blob here is a few km across, so depths of a few hundred metres
  // are what read as cloud. Push a ribbon-shaped blob up past a kilometre and it
  // stops being a cloud and becomes a curtain. Tops run 880/1040/1240 m off a
  // 620 m base: enough spread to see, flat enough to look right.
  //
  // shapeDetailAmount is back to the library's own 1.0. It was cut to 0.45 because at
  // full strength the deck read as lace instead of mass — but that was against the
  // library's tessellated cellular weather map, where every cell already touched its
  // neighbours and the fine erosion had only thin walls to chew through. On the blob map
  // the clouds are solid bodies with space around them, so full detail carves surface
  // texture rather than holes, and it also removes the sprayed dust that was hanging
  // around the edges. Costs nothing measurable: 6.92 ms against 7.09 at 0.45.
  //
  // Worth remembering as a general point — a value tuned against one weather field is not
  // transferable to another. Half the numbers in this file were re-derived when the map
  // changed and this one was simply missed.
  // DENSITY MUST REACH ZERO AT THE CEILING. This is the one that kept producing
  // "sliced" clouds. A profile of (linear -0.6, constant 1.0) looks like a taper
  // and reads like one in the code, but it still leaves 0.4 density at the top of
  // the layer — and the layer ends there, so every cloud gets cut flat across.
  // Seen from below you rarely notice; from above the whole field is slabs.
  // Ending at exactly 0 is what gives them rounded tops. A linear ramp beats an
  // exponential here: the exponential spends most of its range near zero, which
  // thins the cloud out from the base up and puts the boxiness back.
  const TOP_TAPER = [0, 0, -1.0, 1.0];
  // ...BUT A KNIFE-EDGE BASE IS ITS OWN ARTIFACT, and it is the one that survived
  // everything else. Full density at h=0 makes the underside a mathematical plane,
  // and a plane seen at a shallow angle is a perfectly straight line — so from low
  // altitude the deck ends in horizontal razor edges that run the width of the
  // frame, plus rectangular shelves where a distant layer saturates through its
  // whole depth. Visible in the raymarch's own alpha buffer as straight-sided red
  // strips while the near cumulus cores are correctly lobed.
  //
  // A*exp(b*h) + m*h + c with A = -1, b = -14, c = 1, m = -1: zero at both ends,
  // but the rise happens in the bottom 19% of the layer instead of instantly, so
  // the base is soft over ~50-95 m and the plane stops being a plane. That is still
  // short enough to read as a flat cumulus base from level flight, which is the
  // reason TOP_TAPER existed. It peaks at 0.74 rather than 1.0, and the missing
  // optical depth is welcome: it is saturation that was drawing the edges.
  const BASE_SOFT = [-1, -14, -1, 1];
  // Zero at BOTH ends, for the deepest layer. A top-only taper leaves full
  // density on the layer floor, which is right for a flat cumulus base — but on
  // a layer this deep the cells that only just clear the coverage threshold then
  // hang below it as thin full-strength columns, and the big clouds grew a beard
  // of tendrils. Fading the base as well lets those marginal cells stay faint.
  // The flat-based look still comes from the two shallower layers, which carry
  // most of the sky.
  const BOTH_TAPER = [-1, -2.4, -0.909, 1];
  // THREE LAYERS, NOT FOUR, AND EVERY NUMBER HERE WAS SET BY EYE FROM THE PANEL rather than
  // derived. That is the point of the panel, and it is worth saying plainly: the previous set
  // was reasoned out one constraint at a time and this one beat it in a couple of minutes of
  // dragging. Where the old reasoning still explains WHY a control does what it does it is
  // kept below, because that is what makes the next pass quick — but it no longer explains
  // these particular values, and it should not be read as if it does.
  //
  // The cirrus veil is gone: too high to fly among, and it was the one layer that had to be
  // held on a knife edge (its threshold sat deliberately just below zero, so any nudge to
  // global coverage turned the upper sky to fizzy mush). The library's uniforms are vec4, so
  // four slots always exist — the unused one is simply left at zero density below.
  //
  //   640-1070    small puffs, the layer you climb through
  //   2490-3630   the deep one, where the masses build
  //   6610-7210   a thin sheet above them
  //
  // NOTE THE ROLES SWAPPED. The deep layer used to be the third; it is now the second, so
  // the profiles below no longer line up with the reasoning that named them — see the
  // profile note on each.
  const LAYERS = [
    // SEPARATION comes from the exponent. At 1.0 the surviving coverage is a connected
    // carpet whose arms extrude into long chained masses; raising it keeps only each blob's
    // core, so clouds come out discrete with sky between them. This layer runs BELOW 1.0 on
    // purpose — it is the low scatter, and letting it connect up is what makes it read as a
    // broken field near the ground rather than as separate puffs floating in a row.
    // SIZE COMES FROM THE PER-LAYER BAR, not from global coverage and not from
    // localWeatherRepeat. Rearranging the library's threshold, a layer produces nothing
    // unless weather^exponent > (1 - cfw - coverage*heightScale)/(1 - cfw), so
    // coverageFilterWidth is per-layer coverage: raising it lowers the bar, each cell's
    // above-bar region widens, and in the lifted districts neighbours merge. Global coverage
    // does the same to EVERY layer at once, which is why it is the blunt one.
    // ...and density has to come BACK when cfw goes up, because peak density is
    // coverage * heightScale / cfw — a wider filter spreads the same coverage over a longer
    // ramp and THINS the cloud. Raise cfw alone and it reads as less cloud, not more.
    // Watch the bar against the masked sea, which sits at 0.07: drive it near zero and the
    // sea makes faint cloud too, which draws a thin haze line along the whole horizon at
    // cloud-base height — a full-width straight edge, and a nasty one to diagnose.
    { channel: 'r', altitude: 640, height: 430, densityScale: 0.26,
      weatherExponent: 0.75, shapeAlteringBias: 0.32, coverageFilterWidth: 0.70,
      shapeAmount: 0.75, shapeDetailAmount: 0.78, shadow: true, profile: BASE_SOFT },
    // THE DEEP ONE. 1820 m of it, and a high exponent so only the strongest cells survive to
    // fill it — that combination is what builds masses rather than curtains. Depth alone
    // cannot do it: every layer draws on the same weather field and so inherits the same
    // footprint, so making one taller without thinning the field just extrudes it upward.
    // THE BIAS HAS TO RISE WITH THE DEPTH. shapeAlteringFunction is 1 - (2*hf^bias - 1)^2,
    // peaking at hf = 0.5^(1/bias) — a tenth of the way up at 0.3, a third at 0.62. That peak
    // is where the coverage boost is strongest, so a tall layer at a low bias crams its width
    // into the bottom tenth and tapers away above: a pancake with a spike, not a tower. 0.67
    // puts the widest part just over a third up, which is where a cumulus actually carries it.
    // PROFILE: this is now the deep layer but it keeps BASE_SOFT, which was chosen for the
    // shallow ones — full density on the floor, softened over the bottom ~19%. The both-ends
    // taper exists precisely for depth like this, since cells that only just clear the
    // threshold otherwise hang below as thin full-strength columns and grow a beard of
    // tendrils. Checked rather than assumed before leaving it: masking cloud by what
    // disappears when the layers are zeroed, then measuring each image column's underside
    // against the median of its 41-column neighbourhood, no column on seed 3282622387 hangs
    // more than 10 px below its neighbours from 900 m, 1400 m or 2600 m — mean deviation
    // 0.97/0.55/1.14 px. BOTH_TAPER measures no better and is worse from above (1.79). So
    // the beard is a density problem, not a depth problem, and this is the first thing to
    // suspect if the layer ever grows one.
    { channel: 'r', altitude: 2490, height: 1140, densityScale: 0.125,
      weatherExponent: 2.45, shapeAlteringBias: 0.67, coverageFilterWidth: 0.505,
      shapeAmount: 1.0, shapeDetailAmount: 0.87, shadow: true, profile: BASE_SOFT },
    // A thin sheet on its own channel, so it is decorrelated from the two below and drifts
    // across them instead of sitting directly on top. Low bias because it is shallow: the
    // widest part wants to be near the floor when there are only 600 m to play with.
    // PROFILE: BOTH_TAPER, which reaches zero at the base as well as the ceiling. Chosen
    // originally for a deep layer and inherited here, but it happens to be right for a high
    // sheet for a different reason — the stock profile sits at 0.25 density on the floor, so
    // a thin layer gets sliced off flat along its underside and squared off at the end of
    // every streak, which is what hard cut edges near the horizon look like.
    // 0.78, AND THE ONLY HARD CONSTRAINT ON THIS NUMBER IS THAT IT STAY BELOW 1 - coverage.
    // The library's coverage stage is
    //   factor  = 1 - coverage * shapeAlteringFunction(heightFraction, bias)
    //   density = remapClamped(mix(localWeather, 1, cfw), factor, factor + cfw)
    // so the layer produces nothing unless weather^exponent > (1 - cfw - coverage*hs)/(1 - cfw).
    // At the shipped cfw 0.88 against coverage 0.19 that numerator is 0.12 - 0.19*hs, which
    // goes NEGATIVE for hs > 0.6316 — at bias 0.46 that is heightFraction 0.029..0.622, 59%
    // of the layer's 600 m. Over that span the bar is below zero, so the layer passed density
    // at weather = 0: it had stopped reading the weather map at all, and therefore escaped the
    // island cap, which works by writing r and g in that map (applyIslandCap, and its uFloor
    // 0.08 cannot hold a bar that is already negative). What that looked like is worth
    // recording because it is NOT the obvious failure: shapeAmount 1.0 erodes the 0.0795 that
    // cleared the bar down to a ~0.0044 peak, so it was never a solid lid — it was a faint
    // veil over the whole world at 6.6-7.2 km, thickening into a band a few degrees above the
    // horizon where the 18 km ray clamp shortens the crossing through the sheet. Exactly the
    // knife-edge the old cirrus veil was deleted for (see the note above LAYERS), which is why
    // the coverage note at the top of this file says the veil's filter width has to track
    // coverage — this layer inherited the veil's job and stopped tracking.
    // 0.78 puts the bar back at (1 - 0.19 - 0.78)/0.22 = 0.136 at the height where hs peaks,
    // higher everywhere else, so g^2.55 has to beat it: g > 0.46 at best, 0.51 over most of
    // the layer — the big-class cores only, which the cap's multiply then confines to the
    // island. DENSITY DELIBERATELY UNCHANGED at 0.26: peak density is coverage*hs/cfw, so
    // narrowing the filter RAISES the peak (0.216 -> 0.244). The put-density-back note on the
    // first layer is about WIDENING and runs the other way. maxRayDistance stays at 18000 for
    // the same reason it was set there — with the sheet gated back onto the island the clamp
    // has nothing left to cut.
    { channel: 'g', altitude: 6610, height: 600, densityScale: 0.26,
      weatherExponent: 2.55, shapeAlteringBias: 0.46, coverageFilterWidth: 0.78,
      shapeAmount: 1.0, shapeDetailAmount: 0.79, shadow: true, profile: BOTH_TAPER },
  ];
  // Names for the tuning panel, so its sections match what the layers actually are now
  // rather than what they were called when the roles were the other way round.
  const LAYER_NAMES = ['puffs', 'masses', 'high sheet'];
  for (let i = 0; i < clouds.cloudLayers.length; i++) {
    const layer = clouds.cloudLayers[i], spec = LAYERS[i];
    // The uniforms are vec4, so there are always four slots whatever we use. An unused one
    // is zeroed AND taken out of the shadow mask: zero density draws nothing, but the mask
    // is a separate bit and a dead layer left in it still costs the shadow pass work.
    if (!spec) { layer.densityScale = 0; layer.shadow = false; continue; }
    const { profile, ...fields } = spec;
    Object.assign(layer, fields);
    if (profile) layer.densityProfile.set(...profile);
  }

  // CloudsEffect only RENDERS the cloud buffer — it hands the result to an
  // AerialPerspectiveEffect to composite, via atmosphereOverlay/Shadow. On its
  // own it sets a SKIP_RENDERING define and draws nothing, which is exactly
  // what we saw: a scene with no clouds in it. They must share one EffectPass,
  // clouds first.
  // Deferred sun/sky lighting is left OFF: it needs a normal G-buffer pass and
  // would replace the scene's own lighting, which is a far bigger change than
  // this spike is meant to test.
  const aerial = new AerialPerspectiveEffect(camera);
  // SKY OFF, so our own dome shows through. This module predates the day/night cycle and
  // used to own the background outright, which is fine when there is nothing else to agree
  // with — but the palette now drives fog, water and light colour together, and a physical
  // sky that does not follow it puts an orange haze under a cool blue sunset. Measured at
  // dusk: the dome runs red/blue 1.23 while this model sits at 0.56. What is wanted back is
  // the old CLOUDS, so takram keeps the volume and the aerial haze and gives up the sky.
  aerial.sky = false;
  aerial.sunLight = false;
  aerial.skyLight = false;
  aerial.transmittanceTexture = textures.transmittanceTexture;
  aerial.irradianceTexture = textures.irradianceTexture;
  aerial.scatteringTexture = textures.scatteringTexture;
  aerial.higherOrderScatteringTexture = textures.higherOrderScatteringTexture;
  if (textures.singleMieScatteringTexture) aerial.singleMieScatteringTexture = textures.singleMieScatteringTexture;
  // read-only getters onto its uniform values: copy INTO them. (And there is no
  // ecefToWorldMatrix here — that one exists only on CloudsEffect.)
  aerial.worldToECEFMatrix.copy(w2e);
  aerial.sunDirection.copy(clouds.sunDirection);
  stbnTargets.push(aerial);

  // EXPOSURE BRIDGE — this is what makes the whole thing usable.
  // The library emits physical luminance and its own examples run the renderer
  // at an exposure near 10; this scene is hand-authored for 1.15. Raising the
  // global exposure is a dead end, because it lifts the terrain too and the
  // island blows out to white. But these two constants scale the atmosphere's
  // sun and sky radiance ONLY, and nothing in our scene is lit by them — our
  // materials use their own lights. So the clouds can be brought up to meet the
  // terrain instead of dragging the terrain up to meet them.
  // 8 is the balance point: below it distant clouds stay pink-grey, above it
  // the aerial inscatter scales too and the landscape starts hazing over.
  // 4, NOT 8, and this is what stopped the clouds looking like flat paint.
  //
  // The boost scales the atmosphere's sun and sky radiance to meet a scene authored for
  // exposure 1.15. At 8 the whole cloud sat in the compressed shoulder of the ACES curve,
  // so every value from a sunlit top to a shaded base landed on nearly the same white.
  // The modelling was in the HDR buffer the whole time; tone mapping was throwing it out.
  // Measured as the tonal range WITHIN cloud pixels: 15.6 at boost 8, 34.1 at 4, 46.3 at
  // 2 — so halving the boost doubles the shading.
  //
  // The old note said 8 was the balance point because below it distant clouds went
  // pink-grey. That was written when the clouds were a thin deck and there was little
  // modelling to lose. With four levels and real depth the trade is the other way round.
  // Absorption is NOT the lever here, for the record: 0 to 0.8 moved the range 15.6 to
  // 17.8, which is nothing.
  const LUMINANCE_BOOST = 4.5;
  // Kept as UNSCALED originals plus a setter, rather than multiplied in place and forgotten.
  // Multiplying in place is one-way: the only record of the 1x value is gone the moment it
  // runs, so a second call compounds instead of setting, and the panel could never do more
  // than push it further up. These are shared with the clouds effect too — both read the same
  // atmosphere constants — so the two have to be written together or the volume and the haze
  // disagree about how bright the sun is.
  const LUM_KEYS = ['SUN_SPECTRAL_RADIANCE_TO_LUMINANCE', 'SKY_SPECTRAL_RADIANCE_TO_LUMINANCE'];
  const lumBase = new Map();
  for (const key of LUM_KEYS) {
    for (const [tag, fx] of [['aerial', aerial], ['clouds', clouds]]) {
      const u = fx.uniforms && fx.uniforms.get(key);
      if (u && u.value && u.value.clone) lumBase.set(tag + '|' + key, u.value.clone());
    }
  }
  // TWO WRITERS, SO TWO FACTORS. The panel sets how bright the model is at midday; daynight
  // scales that down through dusk and right down for moonlight. Collapsing them into one
  // setter means whichever wrote last wins, and since daynight writes every frame that is
  // always daynight — the panel's slider would move and then be undone before it was seen.
  let dayLuminance = LUMINANCE_BOOST;
  let lumScale = 1;
  const applyLuminance = () => {
    const boost = dayLuminance * lumScale;
    for (const key of LUM_KEYS) {
      for (const [tag, fx] of [['aerial', aerial], ['clouds', clouds]]) {
        const u = fx.uniforms && fx.uniforms.get(key);
        const base = lumBase.get(tag + '|' + key);
        if (u && base) u.value.copy(base).multiplyScalar(boost);
      }
    }
    return boost;
  };
  const setDayLuminance = (v) => { dayLuminance = v; applyLuminance(); return v; };
  const setLuminanceScale = (s) => { lumScale = s; applyLuminance(); return s; };
  applyLuminance();

  // THE LINK. CloudsEffect renders the cloud buffer and announces it by
  // dispatching change events carrying atmosphereOverlay / atmosphereShadow;
  // AerialPerspectiveEffect is what actually composites them. Nothing connects
  // the two automatically, so without this the clouds render every frame into a
  // buffer nobody reads, the effect raises its SKIP_RENDERING define, and the
  // sky comes out empty — which is exactly the symptom that cost the most time
  // here.
  const link = () => {
    aerial.overlay = clouds.atmosphereOverlay;
    aerial.shadow = clouds.atmosphereShadow;
    aerial.shadowLength = clouds.atmosphereShadowLength;
  };
  clouds.events.addEventListener('change', (e) => {
    if (e.property === 'atmosphereOverlay' || e.property === 'atmosphereShadow'
      || e.property === 'atmosphereShadowLength') link();
  });
  link();

  // MULTISAMPLING HAS TO BE ASKED FOR HERE. The renderer is built with
  // antialias:true, but that only ever applied to the DEFAULT framebuffer — the
  // moment this composer took over we stopped drawing to it, and every terrain
  // edge, runway marking and wingtip went aliased without anything reporting it.
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: Math.min(4, renderer.capabilities.maxSamples),
  });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));

  // AFTER the effect is attached to a composer, so switching the mode resizes render
  // targets that actually have a size — set before this and it reallocates 0x0 ones.
  clouds.temporalUpscale = !NO_HISTORY;
  clouds.shadow.temporalPass = !NO_HISTORY;
  clouds.shadow.temporalJitter = !NO_HISTORY;

  // BLOOM, restored. The old UnrealBloomPass lived on main.js's composer, which
  // this one bypasses entirely, so the flag-gated spike quietly took the glow
  // off the water glints and the sunlit cloud edges when it became the default.
  //
  // It runs AFTER the clouds are composited so their highlights can bloom, and
  // BEFORE tone mapping because bloom is a linear-light operation — put it after
  // the ACES curve and it spreads already-compressed values, which reads as haze.
  //
  // The threshold is the whole game. A daylit sky and sunlit snow sit near 1.0
  // in this buffer, so anything much below that blooms the entire frame into
  // fog; only genuine highlights should glow.
  const bloom = new BloomEffect({
    intensity: 0.7,
    luminanceThreshold: 1.25,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    radius: 0.62,
  });
  // ?bloom=0 already existed for main.js's composer; it has to be honoured here
  // too or the flag silently stops working the moment this path takes over.
  if (new URLSearchParams(location.search).get('bloom') === '0') bloom.intensity = 0;
  composer.addPass(new EffectPass(camera, bloom,
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

  // A FAILED GL CALL ON EVERY SINGLE FRAME, and the console was the reason nobody saw it.
  // postprocessing 6.39.1's RenderPass declares needsDepthBlit, so after it runs the composer
  // blits that depth into its own depthRenderTarget. On this renderer that blit is invalid —
  // GL_INVALID_OPERATION, "Read and write depth stencil attachments cannot be the same image"
  // — and it fired once per rendered frame forever. It looked like three startup warnings
  // because Chrome deduplicates identical WebGL messages; counting with gl.getError instead
  // gives 60 errors in 60 frames, 20 in 20, 40 in 40.
  //
  // Nothing consumes the result. Neither EffectPass sets needsDepthTexture, and render()
  // assigns inputBuffer.depthTexture = this.depthTexture before every pass, so the clouds
  // read scene depth from the input buffer and never from depthRenderTarget. Skipping it is
  // measurably free: sim frozen and the temporal clouds converged, the frame differs from the
  // blitting version in 0.07% of pixels — which is exactly the noise floor of the same
  // configuration rendered twice (0.07%).
  //
  // Guarded rather than deleted: if a pass is ever added that genuinely needs the depth
  // texture, the blit comes back and the underlying attachment conflict has to be solved
  // properly instead.
  const _blitDepth = composer.blitDepthBuffer.bind(composer);
  composer.blitDepthBuffer = (rt) => {
    if (composer.passes.some(p => p.enabled && p.needsDepthTexture)) _blitDepth(rt);
  };

  // CLOUD WIDTH, made adjustable without a reload. This is the control that has been
  // out of reach all along: nothing in the layer settings sets how WIDE a cloud is.
  // Height is a layer field, but width comes from the size of the blobs in the weather
  // map, which is the tile size — and the tile is baked, so it needed a page reload and
  // could never be compared against anything. That is how a layer ended up 2300 m tall
  // on a footprint too narrow to carry it, which is what a vertical slab with flat sides
  // IS. Re-rendering the map is a 4096 square pass plus the two bake passes: far too slow
  // per frame, instant on mouse-up.
  const setWeatherRepeat = (repeat) => {
    clouds.localWeatherRepeat.set(repeat, repeat);
    // pin first: the mask is baked at CAP_UV, so the offset has to put the island there
    const o = weatherOffsetFor(repeat);
    clouds.localWeatherOffset.set(o, o);
    bakeWeather(repeat);
    return repeat;
  };

  window.__vc = { clouds, aerial, composer, textures, bloom, setWeatherRepeat, bakeWeather, WEATHER_REPEAT }; // tuning handle, same idea as __ff

  return {
    clouds,
    aerial,
    setWeatherRepeat,
    setDayLuminance,      // the panel: how bright the model is at midday
    setLuminanceScale,    // daynight: the day-to-moonlight multiplier on top of it
    LUMINANCE_BOOST,
    WEATHER_REPEAT,
    LAYER_NAMES,
    // TIME OF DAY did not exist when this module was written — the sun was fixed, so its
    // direction was set once at construction and never touched again. daynight.js rewrites
    // SUN_DIR in place every frame, so this is the hook that lets the old clouds follow it.
    //
    // Both effects need it: CloudsEffect lights the volume, AerialPerspectiveEffect does the
    // scattering, and they are separate objects that share nothing. The ECEF transform has to
    // be reapplied each time — sunDirection is stored in earth-centred space, not world.
    setSun(dir) {
      clouds.sunDirection.copy(dir).transformDirection(w2e).normalize();
      aerial.sunDirection.copy(clouds.sunDirection);
    },
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => { procedural.forEach(p => p.dispose && p.dispose()); composer.dispose(); },
  };
}
