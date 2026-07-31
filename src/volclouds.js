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
const WEATHER_REPEAT = +(PARAMS.get('wrepeat')) || 80;

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
// 0.75, CHOSEN FOR LOOK AND EXPENSIVE. Cost tracks buffer pixels and climbs steeply —
// measured on a moving camera, medians over alternating rounds:
//   temporal 1/16      7.8 ms
//   no history 0.35    9.2 ms   <- barely more than temporal
//   no history 0.42   14.7 ms
//   no history 0.58   24.0 ms
// 0.75 is past the end of that table. Re-measured against 0.45 on the four-level sky,
// five poses at 1920x1000, interleaved so thermal drift hits both equally:
//   0.45   7.8  9.2 10.5 12.9 10.4 ms
//   0.75  15.7 18.6 21.8 25.9 21.7 ms
// A flat 2.1x, i.e. roughly 40-64 fps where 0.45 gives 78-128. That is a deliberate
// trade for sharper silhouettes, not an oversight: at 0.45 the buffer upscales nearly
// 3x on a wide display and the edges go soft. Turn it down first if the frame rate
// matters more than the edges — it is by far the most expensive single number here.
//
// ?nohist=0 restores temporal reconstruction, ?cloudres= overrides the scale, and the
// tuning panel (P) has it as the "cloud res" slider.
const NO_HISTORY = PARAMS.get('nohist') !== '0';
const CLOUD_RES = Math.min(1, Math.max(0.25,
  +(PARAMS.get('cloudres')) || (NO_HISTORY ? 0.75 : 1)));

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
function renderWeatherMap(renderer, target, seed) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float uSeed;
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

      // Scattered blobs: one per lattice cell, jittered off the lattice so the grid does
      // not show, and each with its OWN radius. cover decides how many cells carry a blob
      // at all — that is what leaves real gaps between clouds.
      float blobs(vec2 uv, float freq, float s, float cover, float rMin, float rMax) {
        vec2 p = uv * freq;
        vec2 i = floor(p), f = fract(p);
        float m = 0.0;
        for (int y = -1; y <= 1; ++y) {
          for (int x = -1; x <= 1; ++x) {
            vec2 g = vec2(float(x), float(y));
            vec3 h = hash33(i + g, vec2(freq), s);
            if (h.z > cover) continue;                  // empty cell: real sky
            vec2 c = g + 0.15 + h.xy * 0.7;             // jittered centre
            float r = mix(rMin, rMax, fract(h.z * 7.31));
            float d = length(f - c) / r;
            m = max(m, 1.0 - smoothstep(0.35, 1.0, d)); // soft round falloff
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
        float big   = blobs(q, 30.0,  uSeed + 0.11, 0.26, 0.40, 0.85);
        float mid   = blobs(q, 60.0,  uSeed + 0.37, 0.30, 0.32, 0.68);
        float small = blobs(q, 120.0, uSeed + 0.73, 0.34, 0.26, 0.55);
        float r = max(max(big * 1.00, mid * 0.90), small * 0.78);

        // g: the big-mass channel — the same field biased hard toward the large class,
        // so layer 3 draws on genuinely bigger footprints instead of the same ones
        float g = max(big * 1.00, mid * 0.55);

        // b: cirrus. Smooth and broad, stretched along one axis so it streaks.
        // per-axis periods MUST match the per-axis frequencies, or the map does not join
        float b = vn(vec2(q.x * 5.0,  q.y * 17.0), vec2(5.0,  17.0)) * 0.6
                + vn(vec2(q.x * 11.0, q.y * 31.0), vec2(11.0, 31.0)) * 0.4;

        gl_FragColor = vec4(r, g, b, 1.0);
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
        gl_FragColor = vec4(v, v, uAdd > 0.5 ? 0.0 : 1.0, 1.0); // b (veil) left alone by both
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
  const bakeWeather = (repeat) => {
    if (USE_LIB_WEATHER) { weather.needsRender = true; weather.render(renderer, 0); }
    else renderWeatherMap(renderer, weather.renderTarget, 0.37);
    // ?cap=0 skips the island mask entirely — the mask boundary was a suspect for the
    // straight cuts, and it is baked into the map so there is no other way to A/B it
    if (PARAMS.get('cap') !== '0') applyIslandCap(renderer, weather, repeat);
    weather.texture.needsUpdate = true;
  };
  bakeWeather(WEATHER_REPEAT);
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
  clouds.coverage = 0.215;
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
  clouds.turbulenceDisplacement = 0; // tuned off — 120 frayed the edges, 350 sprayed them

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
  clouds.clouds.minStepSize = 50;
  clouds.clouds.maxStepSize = 120;
  // RANGE IS NOT THE CAMERA'S FAR PLANE. Capping this at 12-15 km to "match" the
  // far plane was wrong reasoning: the far plane clips scene GEOMETRY, while the
  // clouds are raymarched in post and composited, so nothing bounded them but
  // this number — and it was slicing the sky flat, cutting distant clouds in
  // half and leaving a hard band along the horizon.
  clouds.clouds.maxRayDistance = 60000;
  // ...and the step has to be allowed to grow again, or the iteration budget
  // (500) runs out at 50 m a step and the cut simply moves to 25 km instead.
  // Growth was never what caused the combing — maxStepSize 1000 was, and that
  // stays capped at 120.
  clouds.clouds.perspectiveStepScale = 1.005;

  // The secondary march toward the sun is what self-shadows a cloud. Two
  // iterations at 100 m is enough for cloudscapes viewed from far away and too
  // coarse from inside one, where it banded the nearer masses.
  clouds.clouds.maxIterationCountToSun = 6;
  clouds.clouds.minSecondaryStepSize = 40;
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
  const LAYERS = [
    // the general population — small to medium
    // SEPARATION comes from the exponent. At 1.0 the surviving coverage was a
    // connected carpet whose arms extruded into long chained masses; raising it
    // keeps only each blob's core, so clouds come out discrete with sky between
    // them, which is what a fair-weather field actually looks like.
    // FOUR SEPARATE LEVELS, not one deck. These used to sit at 580/620/680 — three
    // layers on essentially the same base, on the reasoning that one airmass has one
    // condensation level. True of a single fair-weather cumulus field, and it built a
    // sky with no depth: everything happened in one 2 km slab and there was nothing
    // above it but cirrus. Spreading them out gives four things to fly between and
    // through, and it is what a real sky does once there is more than one airmass in it:
    //
    //   850-1400    small puffs, the layer you climb through
    //   2500-2960   a thin sheet well above them
    //   3960-6450   big masses, the deep one
    //   6000-6890   cirrus, overlapping the tops of the masses
    //
    // The DENSITIES came down hard with this spread — 0.20 / 0.13 / 0.15 / 0.32 against
    // 0.44 / 0.60 / 0.82 / 0.45 before. That is the necessary counterpart: four decks
    // stacked over 6 km means far more of them along any given ray, so each has to be
    // thinner or the sky closes up into an overcast wall.
    // SIZE COMES FROM THE PER-LAYER BAR, not from global coverage and not from
    // localWeatherRepeat. Rearranging the library's threshold, a layer produces
    // nothing unless weather^exponent > (1 - cfw - coverage*heightScale)/(1 - cfw),
    // so coverageFilterWidth is per-layer coverage: raising it lowers the bar, each
    // cell's above-bar region widens, and in the lifted districts neighbours merge.
    // Global coverage does the same thing but to EVERY layer, including the cirrus
    // veil — at 0.42 the veil's bar goes negative and the upper sky turns into a
    // fizzy overcast sheet, which is what ruled that lever out. Per-layer keeps the
    // veil exactly as thin as it was.
    // ...and the density has to be put BACK when cfw goes up, because peak density is
    // coverage * heightScale / cfw — a wider filter spreads the same coverage over a
    // longer ramp and thins the cloud. Raising cfw without this makes clouds broader
    // and fainter, which reads as less cloud, not more.
    // cfw 0.60, NOT 0.66 — at 0.66 against coverage 0.30 this layer's bar works out to
    // (1 - 0.66 - 0.30)/0.34, which is nearly zero, so ANY weather above nothing made
    // faint cloud. Including the masked sea, which drew a thin haze line along the
    // whole horizon at cloud-base height: a full-width straight edge, the exact
    // artifact this has been chasing for days, arriving from a completely new
    // direction. At 0.60 the bar is 0.25 (weather > 0.46) against the sea's 0.07.
    { channel: 'r', altitude: 850, height: 550, densityScale: 0.20,
      weatherExponent: 2.35, shapeAlteringBias: 0.36, coverageFilterWidth: 0.61,
      shapeAmount: 0.83, shapeDetailAmount: 1.0, shadow: true, profile: BASE_SOFT },
    // the strongest cells of that same field, building a little deeper
    // 2.1, not 2.8. Past about 2.2 this layer keeps so little of the field that
    // its surviving regions shrink to a couple of weather texels, and at that
    // size they take the texel grid's shape instead of their own — isolated
    // rectangular clouds. The exponent buys separation right up until it starts
    // buying rectangles.
    { channel: 'r', altitude: 2500, height: 460, densityScale: 0.13,
      weatherExponent: 1.15, shapeAlteringBias: 0.49, coverageFilterWidth: 0.45,
      shapeAmount: 1.0, shapeDetailAmount: 1.0, shadow: true, profile: BASE_SOFT },
    // a decorrelated set of the biggest ones. The stock density profile ramps UP
    // with height (0.25 + 0.75h), so density peaks exactly where the layer
    // ceiling cuts it off — that gives every cloud a flat sliced top, and on a
    // deep layer it turns marginal cells into thin vertical spikes, a sky full
    // of spray plumes. Tapering the other way keeps the mass low, so only strong
    // cores climb and the tops end where the cloud ends.
    // THE BIG ONES. Size variation cannot come from a layer's height, because
    // every layer draws on the same weather field and so inherits the same
    // footprint — making one taller only builds curtains. It comes from the
    // EXPONENT, pushed the opposite way to the separation above: a LOW exponent
    // lets more of the field through, so neighbouring blobs merge into masses
    // several times the width of the scattered puffs. Depth still has to stay
    // moderate (880, not the 1150 that looked right on paper) or that wide
    // footprint extrudes straight back into vertical curtains. It also wants the
    // both-ends taper, hence the higher densityScale to make up for the hump only
    // peaking around a third of the way up.
    // THE BIAS HAS TO RISE WITH THE HEIGHT. shapeAlteringFunction is
    // 1 - (2*hf^bias - 1)^2, whose peak sits at hf = 0.5^(1/bias) — 10% of the way up
    // at bias 0.3, 37% at 0.62. That peak is where the coverage boost is strongest, so
    // at 0.3 a tall layer gets all its width crammed into the bottom tenth and tapers
    // away above: a pancake with a spike, not a tower. Moving the peak to a third of
    // the way up is what lets these build.
    { channel: 'g', altitude: 3960, height: 2490, densityScale: 0.15,
      weatherExponent: 1.25, shapeAlteringBias: 0.62, coverageFilterWidth: 0.64,
      shapeAmount: 1.0, shapeDetailAmount: 1.0, shadow: true, profile: BOTH_TAPER },
    // Thin high veil. It needs a profile that reaches zero at BOTH ends, not just
    // the top: the stock one sits at 0.25 density on the layer's floor, so the
    // veil was sliced off flat along its underside and squared off at the end of
    // every streak — those were the hard cut edges up near the horizon. Channel b
    // resolves into long thin ribbons (see the note above), which is right for
    // cirrus, but only once the ends actually feather out. This is
    // A*exp(b*h) + m*h + c solved for f(0) = f(1) = 0, peaking about 0.32 a third
    // of the way up; densityScale carries the rest.
    // cfw = 1 - coverage is the rule that HOLDS the veil steady: its bar is
    // (1 - cfw - coverage*hs)/(1 - cfw), so matching them keeps it at zero — thin and
    // translucent — and letting coverage rise alone drives the bar negative, the remap
    // clamps to full density over most of the layer, and the upper sky turns into a
    // fizzy grey sheet with sun rays combed through it.
    //
    // 0.86 against coverage 0.20 deliberately breaks that rule in the loose direction.
    // It puts the bar BELOW zero on purpose, which is the fizzy-sheet failure mode — but
    // only just, and paired with a 800 m layer and densityScale 0.45 it buys visible
    // cirrus streaks across the whole sky instead of a barely-there wash. Worth knowing
    // that this one is deliberately near an edge: push coverage up without pulling cfw
    // down and the upper sky goes to mush quickly.
    { channel: 'b', altitude: 6000, height: 890, densityScale: 0.32,
      weatherExponent: 4.0, shapeAlteringBias: 0.68, coverageFilterWidth: 0.79, shadow: false,
      shapeAmount: 0.87, shapeDetailAmount: 1.0, profile: [-1, -3, -0.95, 1] },
  ];
  for (let i = 0; i < clouds.cloudLayers.length; i++) {
    const layer = clouds.cloudLayers[i], spec = LAYERS[i];
    if (!spec) { layer.densityScale = 0; continue; }
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
  aerial.sky = true;
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
  const LUMINANCE_BOOST = 4;
  for (const key of ['SUN_SPECTRAL_RADIANCE_TO_LUMINANCE', 'SKY_SPECTRAL_RADIANCE_TO_LUMINANCE']) {
    const u = aerial.uniforms.get(key);
    if (u) u.value.multiplyScalar(LUMINANCE_BOOST);
  }

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

  window.__vc = { clouds, aerial, composer, textures, bloom, setWeatherRepeat }; // tuning handle, same idea as __ff

  return {
    clouds,
    setWeatherRepeat,
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => { procedural.forEach(p => p.dispose && p.dispose()); composer.dispose(); },
  };
}
