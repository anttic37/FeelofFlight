import * as THREE from 'three';

// SHADOWS FADE AT THE EDGE OF THE BOX INSTEAD OF SNAPPING.
//
// The sun's shadow camera is a 320 m square that follows the aeroplane, about 580 m deep
// below it. three's getShadow() returns "fully lit" for anything outside that frustum, with
// no transition: a pylon acquires a crisp shadow the instant it enters the box and loses it
// the instant it leaves, and the aeroplane's own shadow snaps onto the ground as you
// descend through the far plane. From the air that reads as a rectangle of shadow sliding
// over the world with you.
//
// Same technique as the fog and cloud-shadow patches: rewrite the SHARED chunk once, before
// any material compiles, so every shadow-receiving material gets it and nothing can be
// forgotten. The original directional getShadow is renamed and wrapped; the wrapper blends
// the result toward lit over the outer ~30% of the map laterally and the last ~18% of its
// depth. Point-light shadows (getPointShadow) are untouched — there are none here.
//
// The wrapper lives inside the same #ifdef USE_SHADOWMAP as the function it wraps: this
// chunk is included by every material, and only defines the raw function when shadows are
// on — an unguarded wrapper would fail to compile on everything else.
let patched = false;
export function patchShadowFade() {
  if (patched) return;
  if (new URLSearchParams(location.search).get("nofade")==="1") { patched=true; return; }
  patched = true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const SIG = 'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord )';
  if (!chunk.includes(SIG)) {
    console.error('[shadowfade] shadowmap_pars_fragment patch MISSED on three r' + THREE.REVISION
      + ' — shadows will still pop at the box edge');
    return;
  }
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(SIG,
    'float getShadowRaw( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord )')
  + `
#ifdef USE_SHADOWMAP
${SIG} {
  float s = getShadowRaw( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );
  vec3 c = shadowCoord.xyz / shadowCoord.w;
  float edge = max( abs( c.x * 2.0 - 1.0 ), abs( c.y * 2.0 - 1.0 ) );
  float fade = max( smoothstep( 0.70, 0.97, edge ), smoothstep( 0.82, 1.0, c.z ) );
  return mix( s, 1.0, fade );
}
#endif`;
}
