import * as THREE from 'three';
import { SKY, SUN_DIR } from './atmosphere.js';

// Shore-aware animated ocean.
//
// WHAT MAKES WATER READ AS WATER, in rough order of how much it matters, because the
// previous version had a reasonable wave field and still looked like painted plastic:
//
//   1. FRESNEL. Water is nearly transparent looking straight down and nearly a mirror
//      at grazing angles. That single fact is most of what a photograph of the sea
//      shows: dark blue at your feet, sky-bright toward the horizon. Without it the sea
//      is one flat tint everywhere, which is exactly what it was.
//   2. A REFLECTED SKY, not a constant. The bright band near the horizon is the sky
//      being reflected, so it has to come from the same gradient the sky dome draws or
//      the two disagree at the join.
//   3. SUN GLITTER. A broad path of sparkle toward the sun, produced by the wave
//      normals, not by a specular highlight on a flat plane.
//   4. DETAIL ALL THE WAY OUT. The old ripples faded to nothing by 2.6 km, so anything
//      further than that was mirror-flat. Real sea keeps texture to the horizon.
//
// Detail is three octaves with distance-dependent fades, and roughness RISES as they
// drop out — that is the honest trade, since a normal that has become sub-pixel must go
// away or it aliases into crawling noise, and the energy it carried belongs in roughness.
//
// THE HORIZON SEAM is also fixed here. There used to be a detailed sheet over a plain
// far plane with a different material, and the join between them was a hard step across
// the water, plainly visible from 1 km up. Both meshes now share one material and differ
// only in an attribute: waveAmp turns vertex displacement off on the far plane, whose
// 400 m vertex pitch could not carry a 150 m wave anyway.

const SIZE = 16400;   // detailed sheet: covers island r~7000 plus a shore band
const SEG = 300;      // 301^2 ≈ 90k verts, ~55 m pitch
// THE FAR OCEAN MUST FIT INSIDE camera.far, CORNERS INCLUDED. At 90 km across, the
// corners sat at 63.6 km against a 45 km far clip, so they were clipped — and the clip
// boundary of a perspective frustum is a PLANE, which cuts the ocean along a straight
// line in world space. That is the hard "tent" edge at the horizon, and it is why no
// amount of haze tuning removed it: the water was not fading out, it was being cut off.
// 60 km across puts the corners at 42.4 km, inside the 45 km clip, so nothing is cut and
// the horizon is the fade instead of the frustum.
const FAR = 60000;

export function createWater(scene, heightAt) {
  const uTime = { value: 0 };

  const shared = {
    uTime,
    uSunDir: { value: SUN_DIR.clone() },
    uZenith: { value: SKY.zenith.clone ? SKY.zenith.clone() : SKY.zenith },
    uHorizon: { value: SKY.horizon.clone ? SKY.horizon.clone() : SKY.horizon },
    // linear working space throughout — these are never sRGB-decoded
    uDeep: { value: new THREE.Color().setRGB(0.012, 0.055, 0.115) },
    uMid: { value: new THREE.Color().setRGB(0.030, 0.150, 0.260) },
    uHaze: { value: SKY.haze.clone() },
    uShallow: { value: new THREE.Color().setRGB(0.085, 0.400, 0.430) },
    uGlint: { value: 26.0 },
    uHazeNear: { value: 1800.0 },
    uHazeFar: { value: 15000.0 },
    uChop: { value: 1.0 },
  };

  // FOG OFF, deliberately. The shared aerial perspective fades everything to hazeAway /
  // hazeToward, but the sky dome draws its horizon in SKY.horizon, and those are not the
  // same colour. On terrain nobody notices; on an ocean that runs to the horizon in every
  // direction the mismatch is a hard pale line right along the join, which is the "white
  // line at the horizon" that has been in every screenshot for weeks. The water fades to
  // the sky's OWN colour in the view bearing instead, so the two meet exactly.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.08, metalness: 0.0, fog: false, transparent: true,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute float shoreDepth;
attribute float waveAmp;
varying float vShoreDepth;
varying vec3 vWorldPos;`)
      // Long swells only: wavelengths ~150 / ~165 / ~200 m, all well above the 55 m
      // grid pitch's Nyquist limit, so there is no vertex-sampling shimmer.
      // DEAD FLAT until ~2 m of real depth: vertical motion in the contact zone slides
      // the waterline sideways across the beach slope and saw-tooths the coast.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vShoreDepth = shoreDepth;
float wDamp = clamp((shoreDepth - 1.8) * 0.55, 0.0, 1.0) * waveAmp;
transformed.y += wDamp * (0.15
  + sin(position.x * 0.042 + uTime * 0.9) * 0.34
  + sin((position.x * 0.7 + position.z * 0.8) * 0.038 - uTime * 1.25) * 0.26
  + sin(position.z * 0.031 + uTime * 0.65) * 0.18);
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec3 uSunDir, uZenith, uHorizon, uDeep, uMid, uShallow, uHaze;
uniform float uGlint, uChop, uHazeNear, uHazeFar;
varying float vShoreDepth;
varying vec3 vWorldPos;

// Value noise. Unlike products of sines it never forms a repeating lattice, which is
// what made the previous ripple shading moire.
float wnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// gradient of the noise, which is the surface slope — two extra taps per octave
vec2 wgrad(vec2 p, float e) {
  float n = wnoise(p);
  return vec2(wnoise(p + vec2(e, 0.0)) - n, wnoise(p + vec2(0.0, e)) - n);
}
// The sky this water reflects. Same gradient the dome draws, so the two agree where
// they meet — a reflected constant shows up immediately as a mismatch at the horizon.
vec3 skyAt(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
  // the sky brightens around the sun, and so does its reflection
  float s = max(dot(d, uSunDir), 0.0);
  return c + uHorizon * pow(s, 6.0) * 0.35;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 V = normalize(cameraPosition - vWorldPos);
float viewDist = length(cameraPosition - vWorldPos);

// ── surface normal: three octaves, each fading as it approaches sub-pixel ──
float fFine  = 1.0 - smoothstep(120.0, 1100.0, viewDist);
float fMid   = 1.0 - smoothstep(900.0, 9000.0, viewDist);
float fSwell = 1.0 - smoothstep(6000.0, 52000.0, viewDist);
vec2 p1 = vWorldPos.xz * 0.115 + vec2(uTime * 0.21, uTime * 0.13);
vec2 p2 = vWorldPos.xz * 0.034 + vec2(-uTime * 0.075, uTime * 0.052);
vec2 p3 = vWorldPos.xz * 0.0082 + vec2(uTime * 0.021, -uTime * 0.016);
vec2 g = wgrad(p1, 0.18) * (2.30 * fFine)
       + wgrad(p2, 0.15) * (1.55 * fMid)
       + wgrad(p3, 0.13) * (1.15 * fSwell);
g *= uChop;
// flatten right at the shore so the foam band does not crawl
g *= smoothstep(0.0, 1.2, vShoreDepth);
vec3 wN = normalize(vec3(-g.x, 1.0, -g.y));

// ── depth palette: turquoise shallows -> lagoon -> deep ocean ──
vec3 body = mix(uShallow, uMid, smoothstep(0.0, 4.0, vShoreDepth));
body = mix(body, uDeep, smoothstep(4.0, 22.0, vShoreDepth));
// slow drifting patches: real seas are never one flat tint
float pat = wnoise(vWorldPos.xz * 0.0052 + vec2(uTime * 0.011, -uTime * 0.008))
          + wnoise(vWorldPos.xz * 0.0016 + vec2(-uTime * 0.006, uTime * 0.004));
body *= 0.90 + 0.10 * pat;

// ── Fresnel: transparent underfoot, mirror at the horizon ──
// Schlick with F0 = 0.02, water's real normal-incidence reflectance.
float ct = clamp(dot(wN, V), 0.0, 1.0);
float F = 0.02 + 0.98 * pow(1.0 - ct, 5.0);
vec3 R = reflect(-V, wN);
R.y = abs(R.y);                       // never sample below the horizon
vec3 refl = skyAt(R);
diffuseColor.rgb = mix(body, refl, F);

// ── whitecaps on the steepest water, thinning with distance ──
float steep = smoothstep(0.55, 1.15, length(g)) * (0.35 + 0.65 * fMid);
float capMask = smoothstep(6.0, 20.0, vShoreDepth);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.92, 0.98), steep * capMask * 0.5);

// ── shoreline foam ──
float foamBand = 1.0 - smoothstep(0.0, 2.4, vShoreDepth);
float stripes = sin(uTime * 1.7 - vShoreDepth * 4.2 + sin(vWorldPos.x * 0.23) * 1.9 + sin(vWorldPos.z * 0.19) * 1.9);
float foam = foamBand * foamBand * smoothstep(0.25, 0.95, stripes) * 0.7;
foam = max(foam, (1.0 - smoothstep(0.0, 0.9, vShoreDepth)) * 0.85);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.97, 1.0), clamp(foam, 0.0, 1.0));

// ── aerial perspective, into the sky's own colour along this bearing ──
// Saturates at 22 km, well inside the far plane's 45 km half-extent, so the plane's
// square edge is fully sky-coloured before it is ever reached. That edge was showing
// as a polygonal horizon.
float hz = smoothstep(uHazeNear, uHazeFar, viewDist);
// DISSOLVE rather than colour-match. Fading the water toward a haze colour only works
// if that colour is exactly what the sky dome draws behind it, and it is not — the
// residual mismatch was still a visible line at the horizon. Fading ALPHA instead lets
// the real sky show through, so the match is exact by construction. Complete by 27 km,
// inside the plane's 30 km edge, so the geometry boundary is never reached.
diffuseColor.a *= 1.0 - smoothstep(17000.0, 27000.0, viewDist);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(skyAt(normalize(vec3(-V.x, 0.035, -V.z))), uHaze, 0.72), hz);`)

      // Sun glitter goes in as emissive so it adds to outgoing light rather than being
      // multiplied by it. A specular highlight on a plane is one blob; a glitter PATH
      // needs the wave normals, which is why it is computed from wN and not from the
      // material's own specular.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float glint = pow(max(dot(R, uSunDir), 0.0), uGlint);
// (1 - hz) so the glitter dies with the haze rather than burning through it
totalEmissiveRadiance += vec3(1.0, 0.97, 0.90) * glint * F * 9.0 * (0.25 + 0.75 * fMid) * (1.0 - hz);`)

      // As the normal octaves fade out their energy has to go somewhere or distant water
      // turns into a mirror. Roughness rises to carry it, which is what keeps the far sea
      // reading as textured rather than as polished glass.
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.055, 0.34, smoothstep(400.0, 26000.0, viewDist));`);
  };

  // ── detailed sheet ──────────────────────────────────────────────────────
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);            // baked flat so shader `position` == world xz
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  // 5-tap smoothed depth: raw 55 m vertex sampling made the foam and shallow-tint
  // bands zigzag along the shore at grid resolution
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = -heightAt(x, z)
      + (-heightAt(x + 38, z)) + (-heightAt(x - 38, z))
      + (-heightAt(x, z + 38)) + (-heightAt(x, z - 38));
    depth[i] = Math.max(0, d / 5);
  }
  geo.setAttribute('shoreDepth', new THREE.BufferAttribute(depth, 1));
  geo.setAttribute('waveAmp', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1));

  const water = new THREE.Mesh(geo, mat);
  water.receiveShadow = true;
  scene.add(water);

  // ── far ocean ───────────────────────────────────────────────────────────
  // Same material, so there is no shading step at the join. Segmented enough that the
  // Fresnel term and the reflected sky vary across it rather than being flat-shaded per
  // huge triangle; waveAmp 0 because a 400 m vertex pitch cannot carry a 150 m wave.
  const farGeo = new THREE.PlaneGeometry(FAR, FAR, 220, 220);
  farGeo.rotateX(-Math.PI / 2);
  const fc = farGeo.attributes.position.count;
  farGeo.setAttribute('shoreDepth', new THREE.BufferAttribute(new Float32Array(fc).fill(60), 1));
  farGeo.setAttribute('waveAmp', new THREE.BufferAttribute(new Float32Array(fc), 1));
  const far = new THREE.Mesh(farGeo, mat);
  // just under the deepest wave trough (0.15 - 0.78): at -0.25 the troughs touched it
  // exactly and the whole ocean z-flickered
  far.position.y = -0.9;
  far.renderOrder = -1;
  scene.add(far);

  function update(time) {
    // wrap at 2000π: every uTime factor has ≤3 decimals, so k·2000π is a whole number
    // of cycles — seamless wrap, and float32 phase precision never degrades
    uTime.value = time % 6283.18530718;
  }

  window.__water = { material: mat, uniforms: shared, sheet: water, far };
  return { update, material: mat, uniforms: shared };
}
