import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Procedural volumetric clouds, following the CK42BB/procedural-clouds-threejs skill:
// a fullscreen raymarch through a 3D density field, Henyey-Greenstein two-lobe phase,
// an inner light march for self-shadowing, Beer-Lambert with a powder term for bright
// thin edges, and a silver lining when the sun is behind.
//
// WHY THIS REPLACED THE PREVIOUS SYSTEM, since it is the whole point: the old one drove
// density from a 2D weather map, density = weather(x, z) * profile(height). A function
// of that form has flat vertical sides (the footprint extruded) and a flat top and base
// (the threshold crossing solves to height = constant). Those are the hard edges, and
// they are not reachable by tuning, because no parameter in that expression is a
// function of horizontal position. Here density is a genuine function of all three
// coordinates, so the class of artefact does not exist to be fixed.
//
// THE ONE DELIBERATE DEPARTURE from the skill's shader: its noise is analytic sin-hash,
// roughly 270 sin() per density sample. The march takes 64 steps, each needing density
// once, six more for the light march and one for the silver lining — about 450 density
// samples per pixel, so ~120k sin() per pixel. That does not run. The same Perlin and
// Worley fields are baked once into 3D textures here and sampled instead, which is what
// the skill's own performance notes call for.

const PARAMS = new URLSearchParams(location.search);
const num = (k, d) => (PARAMS.get(k) != null ? +PARAMS.get(k) : d);

// Render scale for the cloud buffer. Cost is close to quadratic in this, and it is by
// far the most expensive number in the file.
const CLOUD_RES = Math.min(1, Math.max(0.2, num('cloudres', 0.7)));
const MAX_STEPS = Math.round(num('steps', 72));
const LIGHT_STEPS = Math.round(num('lsteps', 6));
const NLAYERS = 3;
const SHADOW_RES = Math.round(num('shadowres', 512));
const SHADOW_STEPS = Math.round(num('shadowsteps', 14));
const RAY_SAMPLES = Math.round(num('raysamples', 24));

// ---------------------------------------------------------------------------
// 3D NOISE, baked on the CPU into tiling textures.
//
// Integer hash rather than sin(): sin-hash loses precision at large coordinates and
// bands visibly, and this runs a few million times at load.
function hash3i(x, y, z, seed) {
  let h = (x * 374761393) ^ (y * 668265263) ^ (z * 1274126177) ^ (seed * 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise on a lattice that WRAPS at per, so every texture tiles seamlessly in all
// three axes. A non-tiling 3D noise shows as a repeating hard plane every period, which
// would put straight edges back in by a different route.
function vnoise3(x, y, z, per, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const m = (v) => ((v % per) + per) % per;
  const h = (a, b, c) => hash3i(m(ix + a), m(iy + b), m(iz + c), seed);
  const lerp = (t, a, b) => a + t * (b - a);
  return lerp(uz,
    lerp(uy, lerp(ux, h(0,0,0), h(1,0,0)), lerp(ux, h(0,1,0), h(1,1,0))),
    lerp(uy, lerp(ux, h(0,0,1), h(1,0,1)), lerp(ux, h(0,1,1), h(1,1,1))));
}

function fbm3(x, y, z, per, seed, octaves) {
  let sum = 0, amp = 1, f = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise3(x * f, y * f, z * f, per * f, seed + i * 17) * amp;
    max += amp; amp *= 0.5; f *= 2;
  }
  return sum / max;
}

// Worley (cellular). Inverted it gives the billowy, cauliflower look that separates a
// cumulus from a cloud-shaped lump of fbm.
function worley3(x, y, z, freq, seed) {
  const px = x * freq, py = y * freq, pz = z * freq;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  let best = 1e9;
  const m = (v) => ((v % freq) + freq) % freq;
  for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
  for (let dx = -1; dx <= 1; dx++) {
    const cx = m(ix + dx), cy = m(iy + dy), cz = m(iz + dz);
    const ddx = dx + hash3i(cx, cy, cz, seed) - fx;
    const ddy = dy + hash3i(cx, cy, cz, seed + 101) - fy;
    const ddz = dz + hash3i(cx, cy, cz, seed + 211) - fz;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d < best) best = d;
  }
  return Math.min(1, Math.sqrt(best));
}

// Base shape, 64^3. R = fbm, G = inverted Worley (low), B = inverted Worley (high).
// The shader mixes them per layer, so a cumulus can be billowy and a veil smooth off
// the same texture without a rebake.
function makeShapeTexture(N = 64) {
  const data = new Uint8Array(N * N * N * 4);
  const s = 1 / N;
  for (let z = 0; z < N; z++)
  for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const u = x * s, v = y * s, w = z * s;
    const i = (((z * N) + y) * N + x) * 4;
    data[i]     = Math.max(0, Math.min(255, fbm3(u * 4, v * 4, w * 4, 4, 7, 4) * 255));
    data[i + 1] = Math.max(0, Math.min(255, (1 - worley3(u, v, w, 4, 31)) * 255));
    data[i + 2] = Math.max(0, Math.min(255, (1 - worley3(u, v, w, 8, 57)) * 255));
    data[i + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Detail, 32^3. Three Worley octaves — this is the erosion that eats the surface into
// wisps and is what stops the silhouette reading as a blob.
function makeDetailTexture(N = 32) {
  const data = new Uint8Array(N * N * N * 4);
  const s = 1 / N;
  let sum = 0;
  for (let z = 0; z < N; z++)
  for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const u = x * s, v = y * s, w = z * s;
    const d = (1 - worley3(u, v, w, 4, 11)) * 0.55
            + (1 - worley3(u, v, w, 8, 23)) * 0.30
            + (1 - worley3(u, v, w, 16, 37)) * 0.15;
    const i = (((z * N) + y) * N + x) * 4;
    const q = Math.max(0, Math.min(255, d * 255));
    data[i] = data[i + 1] = data[i + 2] = q;
    data[i + 3] = 255;
    sum += q / 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  // Carried to the shader so the detail term can be centred exactly. Three inverted
  // Worley octaves do NOT average 0.5 — assuming they did would bias every sample toward
  // erosion, which is the bug this whole term just came out of.
  t.userData.mean = sum / (N * N * N);
  return t;
}

// ---------------------------------------------------------------------------
// The density field, shared verbatim between the view raymarch and the shadow pass.
// Splitting it out is the whole trick behind cloud shadows being cheap here: the shadow
// map is the SAME field marched toward the sun instead of toward the eye, so the shadows
// cannot disagree with the clouds casting them.
const CLOUD_FIELD = /* glsl */`
precision highp float;
precision highp sampler3D;

uniform sampler3D shapeTex;
uniform sampler3D detailTex;
uniform float detailMid;   // the detail texture's own mean, measured at bake time
uniform float time;

// per layer
uniform float lBase[NLAYERS];
uniform float lTop[NLAYERS];
uniform float lCoverage[NLAYERS];
uniform float lShapeScale[NLAYERS];
uniform float lDetailScale[NLAYERS];
uniform float lDetailStrength[NLAYERS];
uniform float lWorleyMix[NLAYERS];
uniform float lDensity[NLAYERS];
uniform float lFlatBase[NLAYERS];

uniform float slabMin;
uniform float slabMax;
uniform float lightStep;
uniform float lightAbsorb;

// island cap
uniform vec2  islandCenter;
uniform float islandFull;   // full cover out to this radius, metres
uniform float islandFade;   // fade over this many further metres
uniform float islandFloor;  // density multiplier far out to sea (0 = clear)
uniform float islandWarp;   // how far the edge wanders, metres

uniform vec2  windDirection;
uniform float windSpeed;

#define PI 3.14159265

float remap(float v, float lo, float hi, float nlo, float nhi) {
  return nlo + (clamp(v, lo, hi) - lo) / max(hi - lo, 1e-5) * (nhi - nlo);
}

// ─── Island cap ─────────────────────────────────────
// Cumulus are thermal: they need warm ground pumping air up, which an island gives and
// cool open ocean does not. So the deck lives over the island and a little way out, and
// the sea beyond stays clear. Also the cheapest way to stop the sky being a uniform
// ceiling to the horizon in every direction.
//
// The edge is warped by the shape noise so it is a weather boundary rather than a drawn
// circle — a clean radial smoothstep reads as exactly what it is from the air.
float islandMask(vec3 p) {
  float d = length(p.xz - islandCenter);
  d += (texture(shapeTex, vec3(p.xz * 0.000045, 0.37)).r - 0.5) * islandWarp;
  float m = 1.0 - smoothstep(islandFull, islandFull + islandFade, d);
  return mix(islandFloor, 1.0, m);
}

// ─── Density ────────────────────────────────────────
// A genuine function of all three coordinates, summed over layers. The vertical
// envelope multiplies a 3D field rather than a 2D one, so the top and the sides are
// surfaces, not planes.
float cloudDensity(vec3 p, float lod) {
  if (p.y < slabMin || p.y > slabMax) return 0.0;
  vec3 wind = vec3(windDirection.x, 0.0, windDirection.y) * windSpeed * time;
  float total = 0.0;

  for (int i = 0; i < NLAYERS; i++) {
    if (lDensity[i] <= 0.0) continue;
    float span = lTop[i] - lBase[i];
    if (span <= 0.0) continue;
    float a = (p.y - lBase[i]) / span;
    if (a < 0.0 || a > 1.0) continue;

    vec3 sp = (p + wind) * lShapeScale[i];
    vec4 s = texture(shapeTex, sp);
    float base = mix(s.r, s.g * 0.65 + s.b * 0.35, lWorleyMix[i]);

    // Altitude envelope. flatBase pushes the lower shoulder tight, which is what makes a
    // cumulus sit on a crisp condensation level instead of fading in from nothing.
    float lo = mix(0.30, 0.04, lFlatBase[i]);
    float altEnv = smoothstep(0.0, lo, a) * smoothstep(1.0, 0.60, a);

    // Coverage threshold against a HEIGHT-VARYING bar, so the crossing is not an
    // iso-height surface — this is what keeps the top from going flat.
    float bar = 1.0 - lCoverage[i] * altEnv;
    float shape = remap(base, bar, min(bar + 0.32, 1.0), 0.0, 1.0);
    if (shape <= 0.0) continue;

    if (lod < 0.5) {
      float d = texture(detailTex, (p + wind * 2.0) * lDetailScale[i]).r;
      float dm = mix(d, 1.0 - d, smoothstep(0.25, 0.75, a));   // whippy low, fluffy high
      // CENTRED ON THE TEXTURE'S OWN MEAN, so detail CARVES AND FILLS.
      //
      // As plain dm * strength this could only ever raise the erosion floor, so it
      // subtracted and never added: turning detail up did not put lobes on a cloud, it
      // dissolved the sky. MEASURED at fixed coverage, strength 0.52 -> 0.75 -> 0.92 took
      // cloud cover 6.5% -> 1.4% -> 0.2%. Centred, the same knob bumps the surface out
      // where the noise is below its mean and bites in where it is above, which is what
      // makes a cauliflower edge instead of a shrinking blob.
      //
      // The midpoint has to flip with dm: the mix above inverts the field with altitude,
      // and an uninverted mean would bias every high sample one way.
      float mid = mix(detailMid, 1.0 - detailMid, smoothstep(0.25, 0.75, a));
      shape = remap(shape, (dm - mid) * lDetailStrength[i], 1.0, 0.0, 1.0);
    }
    total += max(shape, 0.0) * altEnv * lDensity[i];
  }
  return total * islandMask(p);
}
`;

// ─── Cloud shadow map ───────────────────────────────
// A small top-down transmittance texture: for every world XZ in a square that follows
// the camera, march the density field TOWARD THE SUN and write exp(-tau). The composite
// pass then reconstructs each pixel's world position from scene depth and looks the
// value up, so the shadows land on terrain, water, runways and the aircraft at once
// without touching a single one of their materials.
//
// Marching toward the sun rather than straight down matters: a low sun throws shadows a
// long way downwind of the cloud, and a vertical projection would pin every shadow
// directly under its cloud, which looks wrong the moment the sun is not overhead.
const SHADOW_FRAG = CLOUD_FIELD + /* glsl */`
uniform vec3 sunDir;
uniform vec2 shadowOrigin;   // world XZ of the texture's (0,0) corner
uniform float shadowExtent;  // metres covered by the texture
uniform float shadowDensity;
varying vec2 vUv;

void main() {
  vec3 p = vec3(shadowOrigin.x + vUv.x * shadowExtent, 0.0,
                shadowOrigin.y + vUv.y * shadowExtent);
  // A sun near the horizon makes the slab traversal arbitrarily long; clamp so the step
  // count stays meaningful instead of smearing one sample over kilometres.
  float sy = max(sunDir.y, 0.15);
  float t0 = (slabMin - p.y) / sy;
  float t1 = (slabMax - p.y) / sy;
  float dt = (t1 - t0) / float(SHADOW_STEPS);
  float tau = 0.0;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    // lod 1 skips the detail erosion: shadow edges are soft anyway and it halves the
    // texture fetches in the hottest loop in the file
    tau += cloudDensity(p + sunDir * (t0 + (float(i) + 0.5) * dt), 1.0) * dt;
  }
  gl_FragColor = vec4(exp(-tau * shadowDensity), 0.0, 0.0, 1.0);
}
`;

const RAYMARCH_FRAG = CLOUD_FIELD + /* glsl */`
uniform vec3  cameraPos;
uniform mat4  invProjection;
uniform mat4  invView;
uniform vec3  camForward;
uniform vec3  sunDir;
uniform vec3  sunColor;
uniform vec3  ambientSky;
uniform sampler2D sceneDepth;
uniform float absorptionCoeff;
uniform float maxDist;
uniform float baseDarken;
uniform float silverStrength;
uniform float sunBoost;
uniform float ambientBoost;
uniform float msFalloff;
uniform float msScatter;
uniform float powderMix;
uniform float stepFine;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;

// ─── Phase ──────────────────────────────────────────
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
float cloudPhase(float c) { return hg(c, 0.62) * 0.7 + hg(c, -0.3) * 0.3; }

// THE STEP MUST BE SCALED TO A LAYER, NOT TO THE SLAB.
//
// This used to derive its step from (slabMax - slabMin), the full vertical extent of
// every layer together. That is fine for one deck, and quietly wrong the moment there is
// more than one: with layers at 1100-2400, 2600-5200 and 6400-7600 the slab spans 6500 m,
// so the step became 595 m. The high veil is 1200 m thick, so the FIRST step out of it
// already cleared slabMax, cloudDensity early-outs above that, and the layer accumulated
// no self-shadowing at all — it came out uniformly lit, with no sun on it. The lower
// decks lost most of their shading the same way.
//
// lightStep comes from the THINNEST active layer instead, so six steps stay inside the
// cloud they started in and actually integrate the density that shadows it. The gap
// between decks costs nothing: cloudDensity returns 0 there anyway.
// THE LIGHT MARCH NEEDS ITS OWN COEFFICIENT, and losing that is why the upper decks had
// no sun on them at all.
//
// accum here is density integrated over METRES, so a single cloud contributes on the
// order of 1000. Feeding that through exp(-accum * absorptionCoeff) with the view
// march's 0.055 gives exp(-76), which is zero to every bit of float precision. Every
// cloud thick enough to be visible came out fully self-shadowed and lit by ambient
// alone — flat, sunless, and completely insensitive to the march itself: sweeping the
// step from 10 m to 3000 m moved the frame by 0.01 of a grey level, because the result
// was saturated at both ends no matter what was sampled.
//
// The reference shader scaled this accumulation by 0.001 for exactly this reason and I
// dropped it when rewriting the march. Restored as an explicit uniform rather than a
// magic constant, so the optical depth THROUGH a cloud stays around 1-3 where the Beer
// curve actually has shape, and so it can be tuned without touching the view march's
// alpha, which wants a completely different scale.
//
// POWDER DOES NOT BELONG IN THE LIGHT MARCH, and having it here was why the clouds looked
// unlit no matter what anything was set to.
//
// This used to end with mix(beer, beer * powder, 0.5). powder = 1 - exp(-2 * tau) is ZERO
// when tau is zero — and tau IS zero at the sunlit top of a cloud, because there is no
// cloud above it to shadow it. So the brightest surface in the sky came back at exactly
// 0.5, while the shadowed base, where tau is large and powder is ~1, was left completely
// untouched. It compressed the one end that should have been left alone.
//
// MEASURED, in linear HDR straight off the cloud target, before the composite and before
// tone mapping: fully opaque cloud pixels spanned p5 0.279 to p95 0.479 — a bright-to-dark
// ratio of 1.72:1, where real cumulus run 10:1 or more. The lit top was pinned at ~0.48
// and NOTHING raised it: lightAbsorb x37 moved it to 0.452, ambientBoost 0 to 0.252,
// baseDarken 0.10 to 0.351. Every lever only ever darkened the base.
//
// sunBoost cannot fix that, and this is worth stating plainly because two sweeps were
// spent on it: sunBoost is a MULTIPLY, and a multiply cannot change a ratio. Raising it
// only slides 1.72:1 further up the ACES shoulder, where the curve compresses harder — so
// brightness went up and contrast went DOWN, which is exactly what the sweep showed
// (sun 9.5 -> range 76, sun 40 -> range 36, back to the original).
//
// Transmittance toward the sun is exp(-tau), full stop. Powder is a VIEW-side effect (the
// dark rim on a thin edge seen against the sun) and now lives in the main loop keyed on
// local density, where it darkens wisps without touching lit tops.
//
// The multiple-scattering octaves matter once this is pure Beer: a single exponential
// sends deep interiors to black, and real clouds are bright inside precisely because light
// bounces around in them. Octaves with decaying contribution and decaying extinction are
// the standard cheap stand-in. Normalising by the tau=0 sum keeps a fully lit top at 1.0,
// so the march returns a true 0..1 fraction of sunlight and sunBoost stays an exposure
// control rather than a fudge factor.
float lightMarch(vec3 p) {
  float accum = 0.0;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    p += sunDir * lightStep;
    accum += cloudDensity(p, 1.0) * lightStep;
  }
  float tau = accum * lightAbsorb;
  float ms = 0.0, norm = 0.0, contrib = 1.0, extinct = 1.0;
  for (int o = 0; o < MS_OCTAVES; o++) {
    ms   += contrib * exp(-tau * extinct);
    norm += contrib;
    contrib *= msFalloff;
    extinct *= msScatter;
  }
  return ms / max(norm, 1e-4);
}

vec2 intersectSlab(vec3 ro, vec3 rd, float yMin, float yMax) {
  if (abs(rd.y) < 1e-6) {
    return (ro.y > yMin && ro.y < yMax) ? vec2(0.0, maxDist) : vec2(1.0, 0.0);
  }
  float t0 = (yMin - ro.y) / rd.y, t1 = (yMax - ro.y) / rd.y;
  if (t0 > t1) { float tmp = t0; t0 = t1; t1 = tmp; }
  return vec2(max(t0, 0.0), t1);
}

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}

void main() {
  vec4 clip = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 view = invProjection * clip;
  view.xyz /= view.w;
  vec3 rd = normalize((invView * vec4(view.xyz, 0.0)).xyz);
  vec3 ro = cameraPos;

  vec2 slab = intersectSlab(ro, rd, slabMin, slabMax);
  slab.y = min(slab.y, maxDist);

  // Do not draw cloud in front of terrain. Without this the deck paints over mountains.
  float dz = texture(sceneDepth, vUv).r;
  if (dz < 1.0) {
    slab.y = min(slab.y, linearDepth(dz) / max(dot(rd, camForward), 1e-4));
  }
  if (slab.x >= slab.y) { gl_FragColor = vec4(0.0); return; }

  float cosT = dot(rd, sunDir);
  float phase = cloudPhase(cosT);

  // THE STEP MUST NOT BE THE SLAB LENGTH OVER A FIXED COUNT, and this was the whole reason
  // the clouds had no detail in them.
  //
  // slab is the vertical extent of every active layer — 1100 to 7600 m — so a ray that is
  // anywhere near level stays inside it until it runs out at maxDist. MEASURED:
  //   level at 1500 m       slab length 46000 m   ->  step 639 m
  //   climbing 6 deg        slab length 46000 m   ->  step 639 m
  //   45 deg up             slab length  9192 m   ->  step 128 m
  //   straight up           slab length  6501 m   ->  step  90 m
  // Clouds are a few hundred metres across, so level flight sampled one or two points per
  // cloud and the detail erosion was being applied at a frequency the march could not
  // resolve. It was worst at exactly the angle the game is played at, and fine looking
  // straight up, which is why it read as "flat" from the cockpit and looked fine in a
  // top-down test shot.
  //
  // Two-tier marching instead: stride through empty air, refine on contact. Almost the
  // whole slab is empty — a near-level ray crosses tens of km of clear sky between decks —
  // so the coarse stride costs little and the fine step is spent only where there is cloud.
  // Both scale with distance, because a cloud 20 km out covers few enough pixels that
  // resolving its lobes is wasted work.
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233)) + time) * 43758.5453);
  float step = stepFine * 3.0;
  float t = slab.x + jitter * step;
  float miss = 0.0;

  vec4 result = vec4(0.0);
  for (int i = 0; i < MAX_STEPS; i++) {
    if (result.a > 0.985 || t > slab.y) break;
    vec3 p = ro + rd * t;
    float density = cloudDensity(p, t > 22000.0 ? 1.0 : 0.0);

    // max() rather than a stepFine-derived lower bound so coarse >= fine ALWAYS: clamp()
    // with min > max is undefined in GLSL, and deriving the bound from stepFine made that
    // reachable simply by dragging the slider up.
    float fine   = clamp(t * 0.012, stepFine, stepFine * 6.0);
    float coarse = max(fine, clamp(t * 0.070, 180.0, 1200.0));

    if (density > 0.002) {
      // Refine on contact. Holding fine for one empty sample too (miss < 2) keeps a thin
      // gap between two lobes from throwing the march straight back to the coarse stride.
      step = fine;
      float light = lightMarch(p);
      vec3 col = sunColor * light * phase * sunBoost + ambientSky * ambientBoost;

      // Powder, moved here off the light march. This is the dark rim on a thin edge seen
      // TOWARD the sun, so it keys on local density and on cosT, and a dense lit top —
      // where it used to cost half the brightness — is left alone.
      float powder = 1.0 - exp(-density * 4.0);
      col *= mix(1.0, powder, powderMix * max(cosT, 0.0));

      float edge = cloudDensity(p + sunDir * 220.0, 1.0);
      float silver = pow(max(1.0 - edge, 0.0), 3.0) * pow(max(-cosT, 0.0), 3.0);
      col += sunColor * silver * silverStrength;

      // Bases sit in their own shadow.
      float a = clamp((p.y - slabMin) / max(slabMax - slabMin, 1.0), 0.0, 1.0);
      col *= mix(baseDarken, 1.0, smoothstep(0.0, 0.7, a));

      float alpha = 1.0 - exp(-density * step * absorptionCoeff);
      result.rgb += col * alpha * (1.0 - result.a);
      result.a += alpha * (1.0 - result.a);
      miss = 0.0;
    } else {
      miss += 1.0;
      if (miss >= 2.0) step = coarse;
    }
    t += step;
  }
  gl_FragColor = clamp(result, 0.0, 64.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tClouds;
uniform sampler2D tShadow;
uniform sampler2D sceneDepth;
uniform mat4 invProjection;
uniform mat4 invView;
uniform vec2 shadowOrigin;
uniform float shadowExtent;
uniform float shadowStrength;
uniform vec3 shadowTint;
uniform float shadowCeiling;   // no cloud shadow above the lowest cloud base
uniform vec2  sunUv;
uniform float sunVisible;
uniform vec3  rayColor;
uniform float rayExposure, rayDensity, rayWeight, rayDecay;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;

void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  float dz = texture2D(sceneDepth, vUv).r;

  // CLOUD SHADOWS. Applied here rather than in every ground material: the depth buffer
  // gives world position for whatever the pixel actually is, so terrain, water, runways,
  // props and the aircraft all get shadowed from one place.
  //
  // This darkens the composited colour rather than only the direct-light term, which is
  // not strictly correct — a shadowed patch loses a little ambient it should keep. The
  // tint compensates: shadowed ground is pulled slightly BLUE rather than just dimmed,
  // which is what losing the sun but keeping the sky actually looks like.
  if (dz < 1.0 && shadowStrength > 0.0) {
    vec4 clip = vec4(vUv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0);
    vec4 vp = invProjection * clip;
    vp /= vp.w;
    vec3 wp = (invView * vec4(vp.xyz, 1.0)).xyz;
    if (wp.y < shadowCeiling) {
      vec2 suv = (wp.xz - shadowOrigin) / shadowExtent;
      // feather the last 6% so the edge of the map is never a visible square
      vec2 fade = smoothstep(vec2(0.0), vec2(0.06), suv)
                * (1.0 - smoothstep(vec2(0.94), vec2(1.0), suv));
      float edge = fade.x * fade.y;
      if (edge > 0.0) {
        float lit = texture2D(tShadow, clamp(suv, 0.0, 1.0)).r;
        float s = (1.0 - lit) * shadowStrength * edge;
        scene.rgb = scene.rgb * (1.0 - s) + scene.rgb * shadowTint * s;
      }
    }
  }

  vec4 c = texture2D(tClouds, vUv);          // premultiplied
  vec3 outCol = scene.rgb * (1.0 - c.a) + c.rgb;

  // ── GOD RAYS ──
  // A radial blur, but of an OCCLUSION MASK rather than of the image — that is the
  // difference between shafts and a smear. Sky contributes light, anything with geometry
  // or cloud in front of it contributes nothing, so streaks emerge from every gap
  // between occluders and stop dead where the occluder is solid.
  //
  // This lives inside the composite rather than in a pass of its own for a concrete
  // reason: the pass after this one reads a swapped buffer, so scene depth would sit on
  // the target being written and sampling it would be a framebuffer feedback loop. Here
  // rt1's colour and depth are read while rt2 is written, which is already safe and
  // already set up for the cloud shadows.
  if (rayExposure > 0.0 && sunVisible > 0.0) {
    vec2 dstep = (vUv - sunUv) * (rayDensity / float(RAY_SAMPLES));
    vec2 uv = vUv;
    float illum = 1.0, accum = 0.0;
    for (int i = 0; i < RAY_SAMPLES; i++) {
      uv -= dstep;
      float d = texture2D(sceneDepth, uv).r;
      // SKY TEST ON LINEAR DEPTH, not on the raw buffer. With near 0.5 and far 45000 the
      // depth buffer is wildly non-linear: terrain at 10 km sits at 0.99996, so any
      // plausible raw threshold classifies distant ground as sky and the shafts smear the
      // landscape into streaks radiating from the sun. Linearising makes the test mean
      // what it says.
      float lin = (2.0 * cameraNear * cameraFar)
                / (cameraFar + cameraNear - (d * 2.0 - 1.0) * (cameraFar - cameraNear));
      // cloud alpha shadows the shaft too, so beams break up on the cloud field and not
      // only on terrain
      float open = step(cameraFar * 0.92, lin) * (1.0 - texture2D(tClouds, uv).a);
      accum += dot(texture2D(tDiffuse, uv).rgb, vec3(0.2126, 0.7152, 0.0722)) * open * illum;
      illum *= rayDecay;
    }
    accum *= rayWeight / float(RAY_SAMPLES);
    // fade out toward the screen edge, and with sunVisible, so turning away from the sun
    // dims the shafts rather than switching them off
    float fall = 1.0 - smoothstep(0.15, 1.15, length(vUv - sunUv));
    outCol += rayColor * accum * rayExposure * fall * sunVisible;
  }

  gl_FragColor = vec4(outCol, scene.a);
}
`;

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------------------------------------------------------------------------
class CloudPass extends Pass {
  constructor(camera, shapeTex, detailTex, sunDir, params) {
    super();
    this.needsSwap = true;
    this.camera = camera;
    this.params = params;
    this._fwd = new THREE.Vector3();
    this._sunP = new THREE.Vector3();
    this.resScale = params.cloudRes;
    this._size = new THREE.Vector2(1, 1);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });

    const arr = (v) => ({ value: new Float32Array(NLAYERS).fill(v) });
    this.march = new THREE.ShaderMaterial({
      defines: { MAX_STEPS, LIGHT_STEPS, NLAYERS, MS_OCTAVES: 3 },
      uniforms: {
        shapeTex: { value: shapeTex }, detailTex: { value: detailTex },
        detailMid: { value: detailTex.userData.mean },
        sceneDepth: { value: null },
        cameraPos: { value: new THREE.Vector3() },
        invProjection: { value: new THREE.Matrix4() },
        invView: { value: new THREE.Matrix4() },
        camForward: { value: new THREE.Vector3() },
        sunDir: { value: sunDir.clone() },
        sunColor: { value: new THREE.Color(1.0, 0.97, 0.92) },
        ambientSky: { value: new THREE.Color(0.58, 0.70, 0.90) },
        time: { value: 0 },
        lBase: arr(0), lTop: arr(0), lCoverage: arr(0), lShapeScale: arr(0),
        lDetailScale: arr(0), lDetailStrength: arr(0), lWorleyMix: arr(0),
        lDensity: arr(0), lFlatBase: arr(0),
        slabMin: { value: 0 }, slabMax: { value: 1 }, lightStep: { value: 200 },
        lightAbsorb: { value: 0.030 },
        islandCenter: { value: new THREE.Vector2() },
        islandFull: { value: 0 }, islandFade: { value: 1 },
        islandFloor: { value: 0 }, islandWarp: { value: 0 },
        absorptionCoeff: { value: 0.055 }, maxDist: { value: 46000 },
        baseDarken: { value: 0.65 }, silverStrength: { value: 1.1 },
        sunBoost: { value: 18 }, ambientBoost: { value: 0.16 },
        msFalloff: { value: 0.5 }, msScatter: { value: 0.5 },
        powderMix: { value: 0.4 }, stepFine: { value: 60 },
        windDirection: { value: new THREE.Vector2() }, windSpeed: { value: 0 },
        cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: RAYMARCH_FRAG,
      depthTest: false, depthWrite: false,
    });

    // Cloud shadow map. R8 is plenty — this is a single transmittance scalar and the
    // result is blurred by its own texel size on the ground anyway.
    this.shadowTarget = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    });
    this._shadowOrigin = new THREE.Vector2();

    // The shadow material shares the field uniforms with the march by REFERENCE, so the
    // panel moving a layer moves the shadow it casts in the same frame. Anything less
    // and the two drift apart the moment a value changes.
    const m = this.march.uniforms;
    this.shadow = new THREE.ShaderMaterial({
      defines: { NLAYERS, SHADOW_STEPS },
      uniforms: {
        shapeTex: m.shapeTex, detailTex: m.detailTex, detailMid: m.detailMid, time: m.time,
        lBase: m.lBase, lTop: m.lTop, lCoverage: m.lCoverage, lShapeScale: m.lShapeScale,
        lDetailScale: m.lDetailScale, lDetailStrength: m.lDetailStrength,
        lWorleyMix: m.lWorleyMix, lDensity: m.lDensity, lFlatBase: m.lFlatBase,
        slabMin: m.slabMin, slabMax: m.slabMax,
        islandCenter: m.islandCenter, islandFull: m.islandFull,
        islandFade: m.islandFade, islandFloor: m.islandFloor, islandWarp: m.islandWarp,
        windDirection: m.windDirection, windSpeed: m.windSpeed,
        sunDir: m.sunDir,
        shadowOrigin: { value: this._shadowOrigin },
        shadowExtent: { value: params.shadowExtent },
        shadowDensity: { value: params.shadowDensity },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SHADOW_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tClouds: { value: this.target.texture },
        tShadow: { value: this.shadowTarget.texture },
        sceneDepth: { value: null },
        invProjection: m.invProjection, invView: m.invView,
        shadowOrigin: { value: this._shadowOrigin },
        shadowExtent: { value: params.shadowExtent },
        shadowStrength: { value: params.shadowStrength },
        shadowTint: { value: new THREE.Color(0.62, 0.72, 0.92) },
        shadowCeiling: { value: 1e9 },
        sunUv: { value: new THREE.Vector2(0.5, 0.5) },
        sunVisible: { value: 0 },
        rayColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
        rayExposure: { value: params.godExposure },
        rayDensity: { value: params.godDensity },
        rayWeight: { value: params.godWeight },
        rayDecay: { value: params.godDecay },
        cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
      },
      defines: { RAY_SAMPLES },

      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.quadMarch = new FullScreenQuad(this.march);
    this.quadShadow = new FullScreenQuad(this.shadow);
    this.quadComposite = new FullScreenQuad(this.composite);
  }

  setSize(w, h) {
    this._size.set(w, h);
    this.target.setSize(Math.max(1, Math.round(w * this.resScale)),
                        Math.max(1, Math.round(h * this.resScale)));
  }

  // the panel changes cloud res live; re-derive the buffer from the size we were given
  applyResScale(s) { this.resScale = s; this.setSize(this._size.x, this._size.y); }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.march.uniforms, cam = this.camera, p = this.params;
    cam.getWorldDirection(this._fwd);
    u.cameraPos.value.copy(cam.position);
    u.invProjection.value.copy(cam.projectionMatrixInverse);
    u.invView.value.copy(cam.matrixWorld);
    u.camForward.value.copy(this._fwd);
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;
    u.sceneDepth.value = readBuffer.depthTexture;

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < NLAYERS; i++) {
      const L = p.layers[i];
      u.lBase.value[i] = L.base; u.lTop.value[i] = L.top;
      u.lCoverage.value[i] = L.coverage; u.lShapeScale.value[i] = 1 / Math.max(1, L.featureSize);
      u.lDetailScale.value[i] = 1 / Math.max(1, L.detailSize);
      u.lDetailStrength.value[i] = L.detailStrength;
      u.lWorleyMix.value[i] = L.worleyMix; u.lDensity.value[i] = L.density;
      u.lFlatBase.value[i] = L.flatBase;
      if (L.density > 0 && L.top > L.base) { lo = Math.min(lo, L.base); hi = Math.max(hi, L.top); }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    u.slabMin.value = lo; u.slabMax.value = hi;
    // Light-march step from the THINNEST active layer, not the slab. Six steps then stay
    // inside the deck they started in; sizing it to the slab meant one step cleared the
    // thinnest layer entirely and that layer got no self-shadowing — it rendered as if
    // the sun were not there. Clamped so a very thin veil cannot drive the step so small
    // that the march never reaches the cloud above it.
    let thin = Infinity;
    for (let i = 0; i < NLAYERS; i++) {
      const L = p.layers[i];
      if (L.density > 0 && L.top > L.base) thin = Math.min(thin, L.top - L.base);
    }
    if (!isFinite(thin)) thin = hi - lo;
    u.lightStep.value = Math.min(600, Math.max(90, thin / LIGHT_STEPS * 1.15));
    u.lightAbsorb.value = p.lightAbsorb;

    u.islandCenter.value.set(p.island.centerX, p.island.centerZ);
    u.islandFull.value = p.island.radius;
    u.islandFade.value = Math.max(1, p.island.fade);
    u.islandFloor.value = p.island.seaFloorDensity;
    u.islandWarp.value = p.island.edgeWarp;
    u.absorptionCoeff.value = p.absorption; u.maxDist.value = p.maxDist;
    u.baseDarken.value = p.baseDarken; u.silverStrength.value = p.silver;
    u.sunBoost.value = p.sunBoost; u.ambientBoost.value = p.ambientBoost;
    u.msFalloff.value = p.msFalloff; u.msScatter.value = p.msScatter;
    u.powderMix.value = p.powderMix; u.stepFine.value = p.stepFine;
    u.windDirection.value.set(p.windX, p.windZ); u.windSpeed.value = p.windSpeed;
    u.time.value = p.time;

    // ── cloud shadow map ──
    // The region follows the camera but is SNAPPED TO ITS OWN TEXEL GRID. Without that
    // the whole map slides by a fraction of a texel every frame and the shadow edges
    // crawl and shimmer across the ground, which is far more distracting than having no
    // shadows at all.
    const cs = this.composite.uniforms;
    if (p.shadowStrength > 0) {
      const ext = p.shadowExtent;
      const texel = ext / SHADOW_RES;
      this._shadowOrigin.set(
        Math.floor((cam.position.x - ext * 0.5) / texel) * texel,
        Math.floor((cam.position.z - ext * 0.5) / texel) * texel);
      this.shadow.uniforms.shadowExtent.value = ext;
      this.shadow.uniforms.shadowDensity.value = p.shadowDensity;
      cs.shadowExtent.value = ext;
      // never shadow anything at or above the lowest cloud base — an aircraft flying
      // over the top of the deck must not pick up the shadow of the deck below it
      cs.shadowCeiling.value = lo;
      renderer.setRenderTarget(this.shadowTarget);
      this.quadShadow.render(renderer);
    }
    cs.shadowStrength.value = p.shadowStrength;
    // Only bind depth when the shadow branch will actually sample it. With shadows off
    // this is null and the composite never touches a texture it is writing through.
    // depth feeds BOTH the cloud-shadow lookup and the god-ray occlusion mask
    cs.sceneDepth.value = (p.shadowStrength > 0 || p.godExposure > 0)
      ? readBuffer.depthTexture : null;
    cs.rayExposure.value = p.godExposure;
    cs.rayDensity.value = p.godDensity;
    cs.rayWeight.value = p.godWeight;
    cs.rayDecay.value = p.godDecay;
    // Project a point along the SUN DIRECTION rather than a world position: the sun is at
    // infinity, so its screen position must not drift as the aircraft flies, and
    // anchoring it to a world point does exactly that. Any positive distance along the
    // ray gives the same screen point, so use one comfortably INSIDE the far plane —
    // a point at 1e6 is past camera.far, which pushes NDC z above 1 and then reads as
    // "behind the camera" even when the sun is dead ahead.
    this._sunP.copy(cam.position).addScaledVector(u.sunDir.value, cam.far * 0.4).project(cam);
    cs.sunUv.value.set(this._sunP.x * 0.5 + 0.5, this._sunP.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(this._sunP.x), Math.abs(this._sunP.y));
    // Behind-camera is a dot against the view direction, not an NDC test — NDC z cannot
    // distinguish "behind" from "beyond the far plane".
    const ahead = this._fwd.dot(u.sunDir.value) > 0;
    // Fade over the last stretch of screen so turning away from the sun dims the shafts
    // instead of switching them off at the frame edge.
    cs.sunVisible.value = ahead
      ? 1 - Math.min(1, Math.max(0, (off - 1.0) / 0.8)) : 0;
    cs.cameraNear.value = cam.near;
    cs.cameraFar.value = cam.far;

    renderer.setRenderTarget(this.target);
    renderer.clear();
    this.quadMarch.render(renderer);

    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (!this.renderToScreen) renderer.clear();
    this.quadComposite.render(renderer);
  }

  dispose() {
    this.target.dispose(); this.shadowTarget.dispose();
    this.march.dispose(); this.shadow.dispose(); this.composite.dispose();
    this.quadShadow.dispose();
    this.quadMarch.dispose(); this.quadComposite.dispose();
  }
}

// ---------------------------------------------------------------------------
export async function createSkyClouds({ renderer, scene, camera, sunDir }) {
  const t0 = performance.now();
  const shapeTex = makeShapeTexture(64);
  const detailTex = makeDetailTexture(32);
  const bakeMs = Math.round(performance.now() - t0);

  // THREE LAYERS. featureSize and detailSize are in METRES — the size of the thing you
  // are asking for — rather than the reciprocal the shader wants, because 1/9000 is not
  // a number anyone can tune by feel.
  const params = {
    cloudRes: CLOUD_RES,
    layers: [
      // detailSize down ~40% and detailStrength up ~3.8x across the board. Both only became
      // usable once the detail term was centred and the march stopped stepping over it:
      // at these strengths the old one-sided term erased the sky. MEASURED on one seed,
      // same page load, cloud cover held at 35.3 -> 35.4% while silhouette raggedness went
      // 0.061 -> 0.107 and interior lobe structure 0.80 -> 1.24.
      { name: 'cumulus',   base: num('l1base', 1100), top: num('l1top', 2400),
        coverage: num('l1cov', 0.42), featureSize: num('l1size', 5200),
        detailSize: num('l1det', 420), detailStrength: num('l1dstr', 2.0),
        worleyMix: num('l1worley', 0.72), density: num('l1den', 1.05),
        flatBase: num('l1flat', 0.85) },
      { name: 'big masses', base: num('l2base', 2600), top: num('l2top', 5200),
        coverage: num('l2cov', 0.40), featureSize: num('l2size', 11000),
        detailSize: num('l2det', 660), detailStrength: num('l2dstr', 1.75),
        worleyMix: num('l2worley', 0.50), density: num('l2den', 0.85),
        flatBase: num('l2flat', 0.35) },
      { name: 'high veil', base: num('l3base', 6400), top: num('l3top', 7600),
        coverage: num('l3cov', 0.30), featureSize: num('l3size', 26000),
        detailSize: num('l3det', 1560), detailStrength: num('l3dstr', 2.3),
        worleyMix: num('l3worley', 0.15), density: num('l3den', 0.30),
        flatBase: num('l3flat', 0.0) },
    ],
    // ISLAND CAP. radius is how far the full deck reaches from the island centre, fade
    // is how far it takes to die out beyond that, and seaFloorDensity is what survives
    // over open ocean (0 = a clear sea, which is the point of having the cap at all).
    island: {
      centerX: num('icx', 0), centerZ: num('icz', 0),
      radius: num('iradius', 9000),
      fade: num('ifade', 11000),
      seaFloorDensity: num('isea', 0.0),
      edgeWarp: num('iwarp', 5200),
    },
    absorption: num('absorb', 0.055),
    // Separate from absorption: this one runs against a path measured in metres, so it
    // needs a much smaller scale to land where the Beer curve has shape.
    //
    // THIS WAS 0.0016 AND THAT WAS ROUGHLY 12x TOO SMALL. Fixing the earlier exp(-76)
    // saturation overshot in the other direction: 0.0016 puts optical depth around 0.2,
    // where exp(-tau) is ~0.8 for everything and the whole cloud comes back uniformly lit.
    // Isolating the sun term (no ambient, no base ramp) and sweeping it showed exactly
    // where the shading lives — bright-to-dark ratio across opaque cloud pixels:
    //   0.0016 -> 1.8    0.008 -> 3.9    0.020 -> 13.2    0.050 -> 101
    // and the lit top barely moves across that whole sweep (p95 0.425 -> 0.382), so this
    // darkens bases WITHOUT dimming tops, which is the one axis sunBoost/ambient/baseDarken
    // could never move.
    lightAbsorb: num('lightabsorb', 0.030),
    maxDist: num('maxdist', 46000),
    // CLOUD SHADOWS. extent is the square of world the map covers, centred on the
    // camera; density is how hard the cloud attenuates on the way to the sun; strength
    // is how much of the ground's light it takes away.
    shadowExtent: num('shadowext', 16000),
    shadowDensity: num('shadowden', 0.30),
    // ON. The lookup was correct all along — what broke it was the depth feedback loop
    // above, which blacked the frame whenever shadows were enabled, so every A/B I ran
    // was really strength-0 against strength-0. ?shadow=0 turns them off.
    shadowStrength: num('shadow', 0.55),
    // GOD RAYS. exposure is the master; 0 disables the loop entirely.
    godExposure: num('rays', 0.42),
    godDensity: num('raydensity', 0.72),
    godWeight: num('rayweight', 0.85),
    godDecay: num('raydecay', 0.965),
    // Less fake vertical ramp than before: with lightAbsorb finally in range the cloud
    // shadows itself for real, so this no longer has to stand in for that.
    baseDarken: num('basedark', 0.65),
    silver: num('silver', 1.1),
    // sunBoost is up because the light march now returns a true 0..1 fraction of sunlight
    // (it used to cap at 0.5), and ambient is down hard because a flat additive floor is
    // what was compressing the ratio: it lifts the shadowed base far more, in relative
    // terms, than it lifts the lit top.
    sunBoost: num('sunboost', 18),
    ambientBoost: num('ambient', 0.16),
    // Multiple scattering in the light march. falloff is how much each octave contributes
    // relative to the last, scatter is how much less it is extinguished. Lower falloff
    // means less bounced light filling the interior, so MORE contrast and darker cores.
    msFalloff: num('msfall', 0.5),
    msScatter: num('msscat', 0.5),
    // View-side powder: dark rims on thin edges seen toward the sun.
    powderMix: num('powder', 0.4),
    // In-cloud march step in metres at close range, the control over how much shape
    // actually gets resolved. Scales with distance inside the shader.
    stepFine: num('stepfine', 60),
    windX: 0.82, windZ: 0.57,
    windSpeed: num('wind', 1.6),
    time: 0,
  };

  // Own render target so the cloud pass can read scene depth and keep the deck behind
  // the mountains. EffectComposer's default target has no depth texture.
  const dpr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.depthTexture = new THREE.DepthTexture(1, 1);
  rt.depthTexture.type = THREE.UnsignedIntType;

  const composer = new EffectComposer(renderer, rt);
  // EffectComposer clones this target for its swap buffer, and the clone copies the SAME
  // DepthTexture object. That is a feedback loop waiting to happen: RenderPass writes
  // scene depth into renderTarget1, and the cloud composite samples that depth while
  // writing into renderTarget2 — one texture attached to both framebuffers. GL may return
  // anything, and here it returned a black frame, silently, with no shader or GL error.
  //
  // DETACHING it from the swap buffer is the obvious fix and it is wrong: the raymarch
  // reads the same sampler to clamp rays against terrain, and whenever it resolved to the
  // detached buffer the sampler returned 0, which the clamp read as solid geometry at the
  // near plane, so every ray exited before it started and the sky came out empty.
  //
  // Give the swap buffer its OWN depth attachment instead. Nothing reads it, so its
  // contents do not matter; what matters is that the texture being sampled is no longer
  // attached to the framebuffer being written.
  if (composer.renderTarget2) {
    const d2 = new THREE.DepthTexture(1, 1);
    d2.type = THREE.UnsignedIntType;
    composer.renderTarget2.depthTexture = d2;
  }
  composer.addPass(new RenderPass(scene, camera));
  const cloudPass = new CloudPass(camera, shapeTex, detailTex, sunDir, params);
  composer.addPass(cloudPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.19, 0.5, 1.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let lastW = 1, lastH = 1;
  const api = {
    params, composer, cloudPass, bloom, bakeMs, NLAYERS,
    setSize(w, h) {
      lastW = w; lastH = h;
      composer.setSize(w, h);
      cloudPass.setSize(w * dpr, h * dpr);
      bloom.setSize(w, h);
    },
    setCloudRes(s) {
      params.cloudRes = s;
      cloudPass.applyResScale(s);
    },
    render(dt = 0.016) { params.time += dt; composer.render(); },
    dispose() {
      cloudPass.dispose(); shapeTex.dispose(); detailTex.dispose(); composer.dispose();
    },
  };
  window.__sc = api;
  console.log(`[flighfeel] sky clouds ready (noise bake ${bakeMs} ms)`);
  return api;
}
