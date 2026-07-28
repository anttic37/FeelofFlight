import * as THREE from 'three';

// Atmosphere: the sky gradient and the aerial perspective that ties everything
// in the scene to it. This is the part that carries a landscape — distance
// reads as haze, and haze is not one flat colour: air scatters sunlight
// forward, so looking INTO the sun the haze goes bright and warm, and looking
// away from it it goes cool and blue. Get that one relationship right and a
// stylised scene starts to feel like it has real air in it.
//
// The sun never moves in this game, so its direction is compiled into the
// shaders as a constant instead of being carried as a uniform that every
// material would have to be handed and updated.

export const SUN_DIR = new THREE.Vector3(0.45, 0.75, 0.3).normalize();

// Authored in sRGB, used in LINEAR: everything downstream (the composer target,
// the terrain's vertex colours) works in linear space, and skipping the
// conversion is what makes hand-picked colours come out washed or muddy.
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
export const SKY = {
  zenith: lin(0x3d80cc),
  horizon: lin(0xc2dcef),
  haze: lin(0xe3edf5),
  glow: lin(0xffeccd),      // the sun's own halo on the dome
  hazeAway: lin(0xa8c4de),  // aerial perspective with the sun behind you
  hazeToward: lin(0xf6e8d2), // ...and with the sun in front of you
};

const f = (n) => n.toFixed(4);
const v3 = (c) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
// the sun as a GLSL literal, so every shader that needs it reads the same
// direction as the light itself rather than a hand-copied triple
export const SUN_GLSL = `vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)})`;

// ---------------------------------------------------------------------------
// AERIAL PERSPECTIVE. Patched into three's shared fog chunks rather than into
// each material: terrain, water, scatter, runways, the plane and the sprites
// all fog through these same includes, so one patch reaches the whole scene and
// nothing can be forgotten. Must run before any material compiles.
let patched = false;
export function patchAerialPerspective() {
  if (patched) return;
  patched = true;

  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogMu;   // cos angle between the view ray and the sun
#endif`;

  // mvPosition is in scope wherever three includes fog_vertex, and the camera
  // sits at the origin in view space — so the view ray is just its direction.
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec3 sunView = normalize((viewMatrix * vec4(${SUN_GLSL}, 0.0)).xyz);
  vFogMu = dot(normalize(mvPosition.xyz), sunView);
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogMu;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // forward scattering: haze warms and brightens toward the sun. The wide term
  // is the general glow, the tight one is the flare right around it.
  float fwd = clamp(vFogMu, 0.0, 1.0);
  vec3 haze = mix(${v3(SKY.hazeAway)}, ${v3(SKY.hazeToward)}, pow(fwd, 2.2));
  haze += ${v3(SKY.glow)} * pow(fwd, 14.0) * 0.35;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, fogFactor );
#endif`;
}

// ---------------------------------------------------------------------------
// SKY DOME. Was a 20x12 sphere carrying a vertex-colour gradient, which cannot
// express a sun glow at all — the mesh is far too coarse to hold one. Evaluating
// per pixel costs nothing on a single dome and buys the halo, the horizon haze
// and a zenith that actually deepens.
export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: true,
    uniforms: {
      uZenith: { value: SKY.zenith },
      uHorizon: { value: SKY.horizon },
      uHaze: { value: SKY.haze },
      uGlow: { value: SKY.glow },
    },
    vertexShader: `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uGlow;
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float up = clamp(d.y, 0.0, 1.0);
  float mu = clamp(dot(d, ${SUN_GLSL}), 0.0, 1.0);
  // the gradient: a low exponent keeps blue well down toward the horizon
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  // haze piles up along the horizon, where you look through the most air
  col = mix(col, uHaze, pow(1.0 - up, 7.0) * 0.9);
  // Mie forward scattering: a broad warm brightening across the sun's half of
  // the sky, plus the tight halo hugging the disc itself
  col += uGlow * (pow(mu, 3.0) * 0.10 + pow(mu, 26.0) * 0.55);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}
