import * as THREE from 'three';

// Atmosphere: the sky gradient and the aerial perspective that ties everything
// in the scene to it. This is the part that carries a landscape — distance
// reads as haze, and haze is not one flat colour: air scatters sunlight
// forward, so looking INTO the sun the haze goes bright and warm, and looking
// away from it it goes cool and blue. Get that one relationship right and a
// stylised scene starts to feel like it has real air in it.
//
// THE SUN MOVES NOW, so its direction can no longer be a compiled-in constant.
//
// It used to be a GLSL literal, on the reasoning that a uniform would have to be handed
// to every material and updated. That reasoning had a hole in it: three uploads
// shader.uniforms[name].value per material every frame, so if every material is handed
// THE SAME uniform OBJECT, writing .value once reaches all of them. No traversal, no
// registry, nothing to keep in sync. That is what ATMO below is, and patchAerialPerspective
// installs it on Material.prototype so nothing has to remember to opt in.
//
// SUN_DIR is now LIVE — daynight.js writes into it in place rather than replacing it, so
// anything holding the reference keeps working. Anything that CLONED it at construction
// (water, the cloud pass) has to be pushed to explicitly; daynight does that.
export const SUN_DIR = new THREE.Vector3(0.45, 0.2876, 0.3).normalize();

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

// ---------------------------------------------------------------------------
// THE SHARED ATMOSPHERE UNIFORMS. One object per quantity, handed by reference to every
// material that compiles, so daynight.js writes each of these exactly once per frame.
//
// Names are prefixed uAtm because they are injected into materials that already have their
// own injected uniforms (groundfx, water) and a collision would be a duplicate GLSL
// declaration — which fails at compile time in a shader nobody edited.
export const ATMO = {
  uAtmSunDir:      { value: SUN_DIR },              // live vector, mutated in place
  uAtmHazeAway:    { value: SKY.hazeAway.clone() },
  uAtmHazeToward:  { value: SKY.hazeToward.clone() },
  uAtmGlow:        { value: SKY.glow.clone() },
  // 1 in full day, 0 at night. Scales the forward-scatter flare so the haze does not keep
  // a bright warm rim around the moon.
  uAtmSunPower:    { value: 1 },
};

// ---------------------------------------------------------------------------
// AERIAL PERSPECTIVE. Patched into three's shared fog chunks rather than into
// each material: terrain, water, scatter, runways, the plane and the sprites
// all fog through these same includes, so one patch reaches the whole scene and
// nothing can be forgotten. Must run before any material compiles.
let patched = false;
export function patchAerialPerspective() {
  if (patched) return;
  patched = true;

  // EVERY MATERIAL GETS THE SHARED UNIFORMS, via the prototype hook rather than a call at
  // each construction site — the whole point of patching the shared chunks is that nothing
  // can be forgotten, and per-material opt-in would put that hole straight back.
  //
  // An instance that assigns its own onBeforeCompile SHADOWS this, so the two that do
  // (groundfx, water) merge ATMO themselves. Chaining here would not help: the instance
  // property replaces the prototype one outright.
  const proto = THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
    Object.assign(shader.uniforms, ATMO);
    if (proto) proto.call(this, shader, renderer);
  };

  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  uniform vec3 uAtmSunDir;
  varying float vFogDepth;
  varying float vFogMu;   // cos angle between the view ray and the sun
#endif`;

  // mvPosition is in scope wherever three includes fog_vertex, and the camera
  // sits at the origin in view space — so the view ray is just its direction.
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec3 sunView = normalize((viewMatrix * vec4(uAtmSunDir, 0.0)).xyz);
  vFogMu = dot(normalize(mvPosition.xyz), sunView);
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 uAtmHazeAway;
  uniform vec3 uAtmHazeToward;
  uniform vec3 uAtmGlow;
  uniform float uAtmSunPower;
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
  vec3 haze = mix(uAtmHazeAway, uAtmHazeToward, pow(fwd, 2.2));
  haze += uAtmGlow * pow(fwd, 14.0) * 0.35 * uAtmSunPower;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, fogFactor );
#endif`;
}

// ---------------------------------------------------------------------------
// SKY DOME. Was a 20x12 sphere carrying a vertex-colour gradient, which cannot
// express a sun glow at all — the mesh is far too coarse to hold one. Evaluating
// per pixel costs nothing on a single dome and buys the halo, the horizon haze
// and a zenith that actually deepens.
// ---------------------------------------------------------------------------
// SKY AS THE LIGHT SOURCE. The hemisphere light approximates "blue from above,
// ground bounce from below" with two flat colours; the actual sky is brighter
// toward the horizon, brighter again around the sun, and we already evaluate all
// of that per pixel. So render our own dome into a cube map once at startup and
// let three use it as the irradiance/specular environment. Costs one 128px cube
// render plus a PMREM pass at load, nothing per frame.
//
// Captured from a FRESH dome rather than the live one: the real sky carries the
// sun sprite and the lens flare as children, and baking a sun disc into the
// environment would double-count the directional light that already represents
// it. Tone mapping is disabled for the capture — the env map feeds the lighting
// maths, which happens well before tone mapping, so a tone-mapped capture would
// apply the curve twice.
export function buildSkyEnvironment(renderer, scene) {
  const tmp = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), createSkyMaterial());
  tmp.add(dome);
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(1, 3000, cubeRT);
  cam.update(renderer, tmp);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cubeRT.texture);
  renderer.toneMapping = prevTone;
  scene.environment = env.texture;
  pmrem.dispose();
  cubeRT.dispose();
  dome.geometry.dispose();
  dome.material.dispose();
  return env.texture;
}

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    // MUST NOT write depth. The dome is a radius-8500 sphere that rides the
    // plane, and the volumetric clouds are composited in post against the scene
    // depth buffer — so anything the raymarch finds beyond the dome's shell
    // counts as hidden behind it and is thrown away. That capped the whole sky
    // at 8.5 km, and because the dome is only 24x16 segments the cut followed
    // its flat facets: clouds came out sliced into boxes and pyramids with
    // straight edges. Harmless while the clouds were sprites living near the
    // plane; fatal once they became a raymarched field reaching the horizon.
    // depthTest stays on, so terrain still draws over the dome as before.
    depthWrite: false,
    uniforms: {
      // Cloned per material: buildSkyEnvironment makes a SECOND dome to bake the
      // environment from, and that one must stay at the midday palette rather than follow
      // the live sky, or re-baking it would be the only way to keep it sane.
      uZenith: { value: SKY.zenith.clone() },
      uHorizon: { value: SKY.horizon.clone() },
      uHaze: { value: SKY.haze.clone() },
      uGlow: { value: SKY.glow.clone() },
      // shared by reference — the dome's sun is the same sun as everything else's
      uAtmSunDir: ATMO.uAtmSunDir,
      // how much of a disc halo to draw: full for the sun, much tighter for the moon
      uSunHalo: { value: 1 },
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
uniform vec3 uAtmSunDir;
uniform float uSunHalo;
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float up = clamp(d.y, 0.0, 1.0);
  float mu = clamp(dot(d, uAtmSunDir), 0.0, 1.0);
  // the gradient: a low exponent keeps blue well down toward the horizon
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  // haze piles up along the horizon, where you look through the most air
  col = mix(col, uHaze, pow(1.0 - up, 7.0) * 0.9);
  // Mie forward scattering: a broad warm brightening across the sun's half of
  // the sky, plus the tight halo hugging the disc itself
  // The broad term is what makes a sunset: it washes the sun's whole half of the sky, so
  // it has to shrink for the moon or the night sky lights up around it like a small sun.
  col += uGlow * (pow(mu, 3.0) * 0.10 * uSunHalo + pow(mu, 26.0) * 0.55);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}
