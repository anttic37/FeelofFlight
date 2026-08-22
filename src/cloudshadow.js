import * as THREE from 'three';
import { ATMO } from './atmosphere.js';

// ---------------------------------------------------------------------------
// CLOUD SHADOWS.
//
// The volumetric deck already knows exactly where every cloud is: its coverage
// lives in the weather map volclouds.js renders, one channel per size class
// (r = the low convective deck whose base sits at 640 m). Nothing on the ground
// ever read it, so the island sat in flat sunlight under a sky full of cumulus —
// the single loudest "this is a render" tell an aerial view has.
//
// Nothing here raymarches anything. For a ground point we walk the sun ray up to
// cloud base, look up the coverage the deck has where that ray arrives, and take
// the DIRECT sun term down by it. Ambient, the sky environment and the aerial
// perspective are left alone, and that is what makes a shadowed hillside go
// blue-grey instead of black: a cloud blocks the sun, not the sky.
//
// Patched into three's shared chunks rather than into each material, for the same
// reason atmosphere.js patches the fog chunks — terrain, water, runways, scatter,
// landmarks and the plane all light through these same includes, so one patch
// reaches the whole scene and nothing can be forgotten. Must run before any
// material compiles.
// ---------------------------------------------------------------------------

// Same figure volclouds uses; the cloud library works in ECEF on a WGS84 globe.
const EARTH_R = 6378137;

// ---------------------------------------------------------------------------
// THE MAPPING FROM WORLD METRES TO WEATHER UV, and it is not the obvious one.
//
// The library samples the map through getCubeSphereUv, which near the centre of a
// face reduces to uv = 0.5 + 0.5 * sqrt(2) * lateral / R. The coordinate actually
// sampled is uv * repeat + offset, so
//
//     weatherUv = (0.5 * repeat + offset) + lateral / (sqrt(2) * R / repeat)
//
// — one fixed origin, plus metres over a TILE of sqrt(2) * R / repeat. That tile
// is exactly the capTileMetres() the island cap already works in (it is NOT the
// circumference over the repeat count; assuming that made every distance 4.44x
// too large, see the note over capTileMetres in volclouds.js). And volclouds picks
// `offset` precisely so the bracket lands on CAP_UV = 0.5 — the pin that keeps the
// island on the same piece of weather at every width.
//
// Both numbers are read back off the LIVE cloud object every frame rather than
// copied as constants, so the width slider cannot drift the shadows away from the
// clouds casting them.
//
// LATERAL AXES, read off the library's own getCubeSphereUv rather than reasoned
// about — a swapped or mirrored axis is invisible in a still (the shadows still
// look exactly like cloud shadows) and glaring in flight, so this is the one part
// that is not safe to infer. In three-clouds@0.7.6 build/shared.js:
//
//   vec3 n = normalize(position); ... f = abs(n);
//   else if (all(greaterThan(f.xx, f.yz)))   // the +/-X face, which is ours
//     m = c.x > 0.0 ? n.yz : vec2(-n.y, n.z);
//   ... uv = <relaxation>(m) * 0.5 + 0.5   ->  0.5 + 0.5 * sqrt(2) * m near m = 0
//
// so on the +X face the lateral pair is simply m = (n.y, n.z). worldToECEF puts
// ECEF = (R + wy, wx, -wz), giving n.y = wx/R and n.z = -wz/R. Hence u runs with
// +X and v runs with -Z.
const AXIS = { u: 1, v: -1 };

// Until the clouds land — they come off a CDN a couple of seconds after the world
// does — the sampler has to be something. Black means coverage 0 means no shadow,
// so the scene is simply unshadowed rather than briefly pitch dark.
function blackPixel() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export const CLOUD_SHADOW = {
  uCsMap:      { value: blackPixel() },
  uCsTileM:    { value: 100222 },          // sqrt(2) * R / 90, the default repeat
  uCsOrigin:   { value: new THREE.Vector2(0.5, 0.5) },
  // Base of the low convective deck. Shadow is cast from the FLOOR of the cloud,
  // which is where the light actually stops; using the mid-height would slide every
  // shadow downsun by half a cloud's depth. This is the NOMINAL base — patchLayerTops
  // lifts it per column, and with the sun at 45 degrees every 100 m of lift slides
  // that column's shadow 100 m downsun. Worth knowing before chasing a shadow that
  // sits slightly off its cloud; not worth a second raymarch to fix.
  uCsBase:     { value: 640 },
  // COVERAGE THRESHOLD, PINNED TO THE LAYERS' OWN BAR. Four size classes each clear
  // a different bar out of the same map — 0.46 for the softest, 0.745 for the
  // sharpest — and reproducing all four here would be a second copy of the cloud
  // model to keep in sync. Instead the 50% shadow contour is put exactly on 0.46,
  // where the first cloud starts to exist, and the softness spreads a penumbra
  // across it. Measured over a 128x128 grid spanning the island: weather clears
  // 0.46 on 17.2% of the ground, and this pair shadows 17.2% of it.
  uCsBar:      { value: 0.46 },
  uCsSoft:     { value: 0.16 },
  // How much of the sun a full cloud takes. Never 1: cumulus are not opaque, and a
  // real cloud shadow on a sunlit landscape is a dimming, not a hole.
  uCsStrength: { value: 0 },               // 0 until a weather map is bound
  // The SAME uniform object ATMO holds, under our own name. Sharing the object
  // shares the live SUN_DIR vector daynight rewrites in place; using our own name
  // keeps us out of a redeclaration fight with whatever water and groundfx declare
  // in the fragment shaders they inject.
  uCsSunDir: ATMO.uAtmSunDir,
  // camera.matrixWorld, i.e. the inverse view matrix. Recovers world space from
  // vViewPosition in the fragment, which is how this avoids owning any varying.
  uCsViewInv: { value: new THREE.Matrix4() },
  // 1 = fractal cloud-shaped edges, 0 = the old round-blob contour. A runtime A/B and
  // an off-switch; there is no reason to run at 0 in the game.
  uCsRagged: { value: 1 },
};

// The strength we ramp up to once the clouds land. Kept apart from the uniform so
// attach/detach and the day-night fade can both drive uCsStrength without either
// having to remember the authored value.
export const tune = { strength: 0.72 };

let patched = false;
export function patchCloudShadow() {
  if (patched) return;
  patched = true;

  // RIDE ON ATMO RATHER THAN INSTALLING A SECOND HOOK. A prototype hook of our own
  // looks like it works and does not: a material that assigns its own
  // onBeforeCompile SHADOWS the prototype outright, and the two that matter most
  // here — groundfx (all the terrain) and water — both do. Chaining does not help,
  // because the instance property replaces the prototype one rather than wrapping
  // it. Measured before this line existed: forcing the coverage bar to -1, which
  // should black out every lit surface, changed the frame by exactly 0 luminance.
  //
  // Both of those modules already merge ATMO by hand, and so does the prototype
  // hook, so folding these uniforms into ATMO reaches every one of them at once and
  // there is no second list of merge sites to keep in sync.
  Object.assign(ATMO, CLOUD_SHADOW);

  // WORLD POSITION WITHOUT TOUCHING THE VERTEX STAGE AT ALL.
  //
  // The obvious route is a varying: declare it in `common` (the one chunk every
  // material includes in both stages) and write it in project_vertex. That breaks
  // the game. `common` is not ours — @takram/three-clouds does
  // `#include <common>` in its own shaders, postprocessing compiles those as
  // GLSL ES 3.00, and `varying` is a reserved word there, so every cloud shader
  // fails to compile and the sky empties out. Compiled standalone to confirm:
  // "ERROR: 0:83: 'varying' : Illegal use of reserved word". project_vertex is no
  // better as a host — points, cube, backgroundCube and shadow all include it
  // WITHOUT uv_pars_vertex, so any pars chunk paired with it leaves those four
  // writing to an undeclared name.
  //
  // So: no varying, no vertex-side patch, nothing that can reach a shader we do not
  // own. This code only ever runs inside lights_fragment_begin, and that chunk opens
  // with `vec3 geometryPosition = - vViewPosition;` — so vViewPosition is guaranteed
  // in scope wherever we are, by the same construction that lets three light the
  // surface at all. One mat4 multiply per fragment recovers world space from it.
  //
  // uCsSunDir is ATMO's live sun vector, pointing FROM the surface TOWARD the sun.
  THREE.ShaderChunk.lights_pars_begin += `
uniform sampler2D uCsMap;
uniform vec2 uCsOrigin;
uniform float uCsTileM, uCsBase, uCsBar, uCsSoft, uCsStrength, uCsRagged;
uniform vec3 uCsSunDir;
uniform mat4 uCsViewInv;

// A smooth value noise for breaking the shadow contour. The weather map is one texture
// stretched over a continent (~312 m/texel), so a single bilinear tap through a smooth
// threshold can only ever make round soft blobs — which is exactly what the ground shadows
// were. The rendered clouds carry fractal shape and detail on top of that coverage, so their
// silhouettes are ragged; the shadow has to fake that same ragged edge or it reads as a coin
// on the grass instead of a cloud overhead.
float ffCsHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float ffCsNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);   // C1 smooth: no lattice creases in the shadow edge
  float a = ffCsHash(i), b = ffCsHash(i + vec2(1.0, 0.0));
  float c = ffCsHash(i + vec2(0.0, 1.0)), d = ffCsHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float ffCloudShadow() {
#ifdef FLAT_SHADED
  // NO vViewPosition ON FLAT-SHADED MATERIALS. three declares that varying inside
  // #ifndef FLAT_SHADED, so a flat-shaded material reaches lights_fragment_begin with
  // no view position at all and this function fails to COMPILE — taking the whole
  // material with it. That is not theoretical: the birds are MeshLambertMaterial with
  // flatShading:true, and their program had been failing to link, silently, from the
  // moment they were added. gl.getError() does not report a failed link, which is why
  // several regression passes came back clean while the birds were not drawing.
  // Flat-shaded surfaces simply go unshadowed; they are the birds and the (default-off)
  // scatter props, and a cloud shadow on a 2 m bird is worth nothing anyway.
  return 1.0;
#else
  if ( uCsStrength <= 0.0 ) return 1.0;
  // A sun on the horizon casts a shadow of unbounded length across the map, which
  // is meaningless and samples wildly; let the day-night dimming carry dusk.
  if ( uCsSunDir.y < 0.12 ) return 1.0;
  vec3 world = ( uCsViewInv * vec4( - vViewPosition, 1.0 ) ).xyz;
  float dy = uCsBase - world.y;
  if ( dy <= 0.0 ) return 1.0;                 // at or above cloud base: nothing overhead
  vec3 hit = world + uCsSunDir * ( dy / uCsSunDir.y );
  vec2 uv = uCsOrigin + vec2( ${AXIS.u.toFixed(1)} * hit.x, ${AXIS.v.toFixed(1)} * hit.z ) / uCsTileM;
  float cover = texture2D( uCsMap, uv ).r;
  // RAGGED EDGE. Two octaves of value noise at cumulus scale (~380 m and ~150 m) perturb the
  // coverage before the threshold, so the smooth round contour of the weather map breaks into
  // fractal cloud-shaped edges — the interior stays fully shadowed, the rim wanders in and out
  // the way a real cloud's does. A third slow octave adds broad light/dark mottling within the
  // shadow, which is what stops a big shadow reading as one flat grey disc.
  // FOUR-OCTAVE fBm, weighted toward the fine end for a wispy edge. Accuracy is not the
  // point — a cloud shadow reads by its torn, lacy outline, so the coverage is shredded
  // hard (about +/-0.7 in coverage space, several times the threshold width) from big
  // ~600 m lobes down to ~50 m wisps. Anywhere near the contour dissolves into fractal
  // fingers; the deep interior of a thick cloud still stays dark because even -0.7 leaves
  // it above the bar.
  vec2 q = hit.xz;
  float e = ( ffCsNoise( q * 0.00164 ) - 0.5 ) * 0.55
          + ( ffCsNoise( q * 0.00381 + 7.1 ) - 0.5 ) * 0.42
          + ( ffCsNoise( q * 0.00842 + 19.3 ) - 0.5 ) * 0.30
          + ( ffCsNoise( q * 0.01950 + 3.7 ) - 0.5 ) * 0.20;
  cover += e * uCsRagged;
  // FEATHER the threshold too, so the shredded edge is soft-wispy rather than a crisp
  // fractal cut — a cloud shadow has no hard rim.
  float soft = uCsSoft + 0.13 * uCsRagged;
  float shade = smoothstep( uCsBar - soft, uCsBar + soft, cover );
  // and break up the interior with two more octaves so a big shadow is a drifting,
  // patchy thing rather than one flat grey pool
  float mottle = ffCsNoise( q * 0.00110 + 4.7 ) * 0.62 + ffCsNoise( q * 0.00420 + 8.1 ) * 0.38;
  shade *= mix( 1.0, 0.66 + 0.34 * mottle, uCsRagged );
  return 1.0 - uCsStrength * shade;
#endif
}`;

  // THE HOOK. Multiplying the directional light's colour right after it is fetched
  // puts the cloud in front of the sun and nothing else: three's own cast shadow,
  // the specular, the wrap and the ambient all read the result naturally, and the
  // sky's irradiance is untouched.
  //
  // One targeted replacement on a chunk three has kept stable, and it is checked —
  // a missed patch here is a feature that silently does nothing, which is worse
  // than a crash.
  const NEEDLE = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(NEEDLE)) {
    console.error('[cloudshadow] lights_fragment_begin patch MISSED — three r' +
      THREE.REVISION + ' moved getDirectionalLightInfo; cloud shadows are off');
    return;
  }
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
    .replace(NEEDLE, NEEDLE + '\n\t\tdirectLight.color *= ffCloudShadow();');
}

// ---------------------------------------------------------------------------
// Bind the live weather map. Called when volclouds finishes loading; safe to call
// again if the cloud system is rebuilt.
export function attachCloudShadow(vc) {
  const clouds = vc && vc.clouds;
  const tex = clouds && clouds.localWeatherTexture;
  if (!tex) return false;
  // The map has to wrap: it tiles the globe, and a ground point far downsun of the
  // island samples well outside [0,1].
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  CLOUD_SHADOW.uCsMap.value = tex;
  CLOUD_SHADOW.uCsStrength.value = tune.strength;
  syncCloudShadow(vc);
  return true;
}

// The inverse view matrix, which has to be the one the frame is about to be drawn
// with — copying it before the camera update leaves the shadows a frame behind the
// view, which shows up as them sliding whenever you turn.
export function setCloudShadowView(camera) {
  CLOUD_SHADOW.uCsViewInv.value.copy(camera.matrixWorld);
}

// Re-read tile size and pin from the live cloud object. Cheap enough to call every
// frame, and it has to be called at least whenever the width slider moves.
export function syncCloudShadow(vc) {
  const clouds = vc && vc.clouds;
  if (!clouds) return;
  const repeat = clouds.localWeatherRepeat.x;
  CLOUD_SHADOW.uCsTileM.value = Math.SQRT2 * EARTH_R / repeat;
  const o = clouds.localWeatherOffset.x;
  const pin = (0.5 * repeat + o) % 1;
  CLOUD_SHADOW.uCsOrigin.value.setScalar(pin < 0 ? pin + 1 : pin);
}
