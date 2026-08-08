import * as THREE from 'three';
import { SKY, SUN_DIR } from './atmosphere.js';
import { getTerrainSeed } from './heightcore.js';

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
// 240, not 300. The only thing the vertex grid has to carry is the swell, whose
// shortest wavelength is ~150 m; at 240 the pitch is 68 m, comfortably inside Nyquist.
// 300 was 180k triangles for detail no wave could use — the single largest mesh in the
// scene, spent on nothing.
const SEG = 240;      // 241^2 ≈ 58k verts, ~68 m pitch
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
    // Exponent and amplitude of the sun glitter. BOTH matter and they pull against each
    // other: the exponent sets how wide the path is, the amplitude sets how far into
    // clipping the middle of it goes. At 26 and 9.0 anything within ~23 degrees of the
    // mirror direction reached 1.0 and the path stopped being sparkle at all — it became
    // one white sheet, which is the "total white specular".
    // Swept at a 6 degree sun with the camera low and looking straight down the path, as
    // the percentage of water pixels at pure white / near white:
    //   exp 26 amp 9.0 (was)   2.00%  9.23%     <- the white sheet
    //   exp 60 amp 4.0         0      3.53%
    //   exp 96 amp 3.2         0      2.09%     <- here
    //   exp 96 amp 1.8         0      0.92%     (path getting faint)
    // A tighter lobe is what turns a sheet back into sparkle: fewer pixels qualify at all,
    // so the ones that do can stay bright without the whole path fusing into white.
    uGlint: { value: 96.0 },
    uGlintAmp: { value: 3.2 },
    uHazeNear: { value: 1800.0 },
    uHazeFar: { value: 15000.0 },
    uChop: { value: 1.0 },
    uCaps: { value: 0.22 },
    uFoam: { value: 1.0 },
    // How much of the wave field reaches the BODY colour rather than only the reflection.
    // Set against the LAND, since matching it is the whole point — the ground beside it is
    // the reference for what "this planet" looks like. Measured from 520 m looking straight
    // down, median local deviation and the share of dead-flat pixels: land 1.53 and 35%,
    // sea 0.66 and 60% before, 1.60 and 34% at this value. 0.55 overshoots to 2.16 and 25%,
    // which is the sea coming out GRAINIER than the ground — the same mismatch mirrored.
    uBodyWave: { value: 0.35 },
    // THE SHORE FIELD. Depth sampled per FRAGMENT instead of interpolated from a vertex
    // attribute on a 68 m lattice — see shoreworker.js for why that lattice was the whole
    // problem. Null and 0 until the worker delivers, and the vertex attribute carries it in
    // the meantime, so the sea looks exactly as it did during the first few seconds and then
    // sharpens rather than popping in from nothing.
    uShoreTex: { value: null },
    uShoreOn: { value: 0 },
    uShoreSize: { value: SIZE },
    uWind: { value: new THREE.Vector2(0.82, 0.57).normalize() },
    uSubsurface: { value: new THREE.Color().setRGB(0.045, 0.185, 0.135) },
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
varying float vWaveAmp;
varying vec3 vWorldPos;`)
      // Long swells only: wavelengths ~150 / ~165 / ~200 m, all well above the 55 m
      // grid pitch's Nyquist limit, so there is no vertex-sampling shimmer.
      // DEAD FLAT until ~2 m of real depth: vertical motion in the contact zone slides
      // the waterline sideways across the beach slope and saw-tooths the coast.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vShoreDepth = shoreDepth;
vWaveAmp = waveAmp;
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
uniform float uGlint, uGlintAmp, uChop, uHazeNear, uHazeFar, uCaps, uFoam, uBodyWave;
uniform sampler2D uShoreTex;
uniform float uShoreOn, uShoreSize;
uniform vec2 uWind;
uniform vec3 uSubsurface;
varying float vShoreDepth;
varying float vWaveAmp;
varying vec3 vWorldPos;

// Value noise. Unlike products of sines it never forms a repeating lattice, which is
// what made the previous ripple shading moire.
//
// QUINTIC interpolation, not cubic. Cubic smoothstep is C1: its second derivative jumps
// at every cell boundary, and since the surface normal here IS a derivative of this
// noise, that jump shows up directly as diamond-shaped facets on the water. Quintic is
// C2, so the normal field is smooth across cells.
float wnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Surface slope. CENTRAL difference, not forward: a forward difference is biased half a
// step in +x/+z, which tilts every wave the same way and reads as a directional sheen.
vec2 wgrad(vec2 p) {
  const float e = 0.09;
  return vec2(wnoise(p + vec2(e, 0.0)) - wnoise(p - vec2(e, 0.0)),
              wnoise(p + vec2(0.0, e)) - wnoise(p - vec2(0.0, e)));
}

// GRADIENT (Perlin) noise for the wave field, not value noise.
//
// Value noise is one smooth bump per lattice cell, so its slope field is a grid of
// bumps. That is disguised while octaves point in different directions, but combing them
// all along the wind ALIGNED their lattices and the grid became plainly visible as
// rectangular blocks on the water. Gradient noise is zero at every lattice point with
// the variation in between, so it has no per-cell blob to give the grid away.
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float pnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
                 dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
                 dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
vec2 pgrad(vec2 p) {
  const float e = 0.07;
  return vec2(pnoise(p + vec2(e, 0.0)) - pnoise(p - vec2(e, 0.0)),
              pnoise(p + vec2(0.0, e)) - pnoise(p - vec2(0.0, e)));
}

// ONE WAVE OCTAVE, in its own wind-aligned frame.
//
// Wind waves are ANISOTROPIC: they travel along the wind and their crests run across it,
// so the surface varies quickly along the wind and stays coherent for a long way across.
// Coordinates are rotated into (along, across) with the across axis compressed, which
// stretches features into crest lines, and the resulting slope is rotated straight back
// out so octaves can be summed in world space.
//
// Each octave takes its own ANGLE OFFSET. With every octave on exactly the same axis the
// lattices line up and reinforce into a visible grid; a few degrees apart is enough to
// break that while still reading as one wind direction.
vec2 waveOctave(vec2 q, float freq, float across, float ang, float speed, float amp) {
  vec2 w = normalize(uWind);
  float c = cos(ang), s = sin(ang);
  vec2 wr = vec2(w.x * c - w.y * s, w.x * s + w.y * c);
  vec2 tr = vec2(-wr.y, wr.x);
  vec2 p = vec2(dot(q, wr), dot(q, tr) * across) * freq + vec2(uTime * speed, 0.0);
  vec2 g = pgrad(p);
  return (wr * g.x + tr * g.y) * amp;
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

// THE TWO SHEETS WERE DOUBLE-BLENDING, which is the stray polygon of deep blue that shows
// up over the shallows. The detailed sheet is deliberately see-through in shallow water so
// the sand reads through it — and 0.9 m underneath sits the far ocean, carrying a hardcoded
// shoreDepth of 60, i.e. deep-ocean colour, on 3.75 km quads. So the "seabed" you saw through
// the shallows was the far plane, and its tessellation gave the edges. MEASURED: hiding the
// far plane changed 12.3% of the frame, with a peak delta of 254 — it was not a subtle tint,
// it was the dominant surface in those pixels.
//
// vWaveAmp is 0 only on the far plane, which makes it a free identity test. Discarded where
// the detailed sheet covers AND is still opaque; past 15 km the sheet has begun its own
// dissolve toward the horizon and the far plane has to be there to back it, or the sea would
// fade to sky in the middle distance.
if (vWaveAmp < 0.5 && viewDist < 15000.0
    && abs(vWorldPos.x) < 8100.0 && abs(vWorldPos.z) < 8100.0) discard;

// ── surface normal: four octaves, each fading as it approaches sub-pixel ──
// AMPLITUDES ARE SMALL ON PURPOSE. The previous set produced slopes around 45 degrees;
// open water sits nearer 5-15, and everything above that reads as crumpled foil rather
// than sea. It also drove the whitecap term, which was firing across the whole near
// field and painting the white blotches.
//
// There is a fourth octave at ~2.4 m now. The old set bottomed out at 8.7 m, so close
// water had nothing finer than a car-length and looked like slow blobs; wind chop is
// what makes the surface near the aircraft read as water at all.
// THE TWO FINEST OCTAVES WERE BEING DELETED WHILE STILL SEVERAL PIXELS WIDE, which is most
// of why close water had no texture in it. A normal only has to go away once it approaches
// the pixel scale; below that it aliases and its energy belongs in roughness. Above it, it
// is free detail. At 62 degrees over 720 px a pixel is 0.0015 rad, so:
//
//   chop  2.4 m faded out by  260 m -> still 6.14 px wide
//   fine  7.6 m faded out by 1400 m -> still 3.61 px wide
//   mid    25 m faded out by 9000 m ->      1.85 px   (correct)
//   swell 102 m faded out by 52 km  ->      1.31 px   (correct)
//
// The two coarse octaves were sized right and the two fine ones were thrown away three
// times and twice too early. These fade out at ~2.2 px instead, which is where they stop
// being resolvable rather than where they stop being convenient.
float fChop  = 1.0 - smoothstep(60.0, 720.0, viewDist);
float fFine  = 1.0 - smoothstep(300.0, 2300.0, viewDist);
float fMid   = 1.0 - smoothstep(900.0, 9000.0, viewDist);
float fSwell = 1.0 - smoothstep(6000.0, 52000.0, viewDist);
// Every octave lives in wind space and travels ALONG the wind. Longer waves are less
// anisotropic than short ones, which is how real seas behave: chop is strongly combed by
// the wind, big swell much less so.
vec2 q = vWorldPos.xz;

// GUSTS. A real sea is never evenly rough — the wind lands in patches and you get
// cat's-paws of dark ripple between glassier lanes. Without this the chop is uniform
// across the whole surface, which is a large part of why it read as a noise texture
// rather than as water.
// THE DRIFT RATE IS WHAT MAKES THIS READ AS PAINTED ON. The pattern is 625 m across and
// the time term moved it at speed/freq = 0.012/0.0016 = 7.5 m/s, so from an aeroplane doing
// 70 it is pinned to the sea like a texture rather than blowing across it. 0.045 puts it at
// 28 m/s, which is a squall line moving over the water at a believable clip and, more to the
// point, visibly moving relative to you.
//
// The contrast came down with it: +/-50% of the chop amplitude over a 625 m patch is what
// made these read as distinct light and dark FEATURES rather than as the sea being unevenly
// ruffled. +/-28% still breaks up the uniform chop without drawing shapes.
float gust = 0.72 + 0.56 * (0.5 + pnoise(q * 0.0016 + vec2(uTime * 0.045, 0.0)));

//                    freq     across  angle   speed  amplitude
vec2 g2 = waveOctave(q, 0.040,  0.55,  -0.31,  0.10,  1.09);  // kept for whitecaps
vec2 g3 = waveOctave(q, 0.0098, 0.75,   0.14,  0.030, 0.92);
vec2 g = waveOctave(q, 0.415,  0.34,   0.00,  0.62,  1.13) * (fChop * gust)
       + waveOctave(q, 0.132,  0.42,   0.22,  0.26,  1.26) * (fFine * mix(1.0, gust, 0.7))
       + g2 * fMid
       + g3 * fSwell;
g *= uChop;

// ── DEPTH, PER FRAGMENT ───────────────────────────────────────────────────────────────
// Everything below that reads the shore reads THIS, not the varying. Sqrt-encoded on the
// way in, so squaring is the decode; the precision that buys sits exactly where the beach
// is. Falls back to the interpolated attribute until the bake lands.
float shoreD = vShoreDepth;
if (uShoreOn > 0.5) {
  vec2 shoreUv = vWorldPos.xz / uShoreSize + 0.5;
  float e = texture2D(uShoreTex, shoreUv).r;
  shoreD = 64.0 * e * e;
}

// flatten right at the shore so the foam band does not crawl
g *= smoothstep(0.0, 1.2, shoreD);
vec3 wN = normalize(vec3(-g.x, 1.0, -g.y));

// ── depth palette: turquoise shallows -> lagoon -> deep ocean ──
vec3 body = mix(uShallow, uMid, smoothstep(0.0, 4.0, shoreD));
body = mix(body, uDeep, smoothstep(4.0, 22.0, shoreD));
// slow drifting patches: real seas are never one flat tint
// Same problem as the gusts: 192 m and 625 m tints creeping at 2-4 m/s are features painted
// on the sea. Sped up to drift like the water they are tinting.
float pat = wnoise(vWorldPos.xz * 0.0052 + vec2(uTime * 0.032, -uTime * 0.024))
          + wnoise(vWorldPos.xz * 0.0016 + vec2(-uTime * 0.020, uTime * 0.013));
body *= 0.90 + 0.10 * pat;

// ── SEEN FROM ABOVE THE SURFACE IS A LENS, NOT A MIRROR ──────────────────────────────
// Fresnel is 0.02 at normal incidence, so looking straight down the reflection carries two
// percent of the picture and the body colour carries the other ninety-eight — and the body
// colour had no idea the waves were there. Every octave computed above was feeding the
// reflection and the specular, both of which all but vanish from overhead. That is why
// the sea reads as flat navy with foam pasted on: measured from 520 m looking down, 62% of
// water pixels sat within 1/255 of their neighbourhood against 32% for the land beside it,
// while the top 1% of water pixels were more than twice as loud as the land's. Not too
// little variation — all of it in the wrong places.
//
// What is missing is refraction, not reflection. A facet tilted toward the sun lets more
// light down into the water and returns more of it; one tilted away returns less. Lambert
// on the TRANSMITTED side, normalised so a flat sea is unchanged and only the departure
// from flat shows up.
//
// It needs no view-angle gating, which is the neat part: it multiplies the body colour,
// whose weight in the final mix is already (1 - F). Looking down, F is 0.02 and this carries
// everything; at grazing incidence F approaches 1, body drops out, and the term fades
// exactly where a real sea stops being transparent and starts being a mirror.
float lamFlat = max(uSunDir.y, 0.05);
float lam = clamp(dot(wN, uSunDir), 0.0, 1.0);
body *= mix(1.0, clamp(lam / lamFlat, 0.45, 1.7), uBodyWave);

// ── Fresnel: transparent underfoot, mirror at the horizon ──
// Schlick with F0 = 0.02, water's real normal-incidence reflectance.
float ct = clamp(dot(wN, V), 0.0, 1.0);
float F = 0.02 + 0.98 * pow(1.0 - ct, 5.0);
vec3 R = reflect(-V, wN);
R.y = abs(R.y);                       // never sample below the horizon
vec3 refl = skyAt(R);
diffuseColor.rgb = mix(body, refl, F);

// ── subsurface: sunlight coming THROUGH a wave face ──
// The green-teal glow on the sunward side of a crest, from light scattering inside the
// water rather than off it. Cheap version: strongest when looking roughly toward the sun
// and the surface is tilted, gated by (1 - F) so it only appears where we can see INTO
// the water rather than where it has become a mirror.
float sub = pow(max(dot(V, -uSunDir), 0.0), 3.0) * smoothstep(0.04, 0.30, length(g));
diffuseColor.rgb += uSubsurface * sub * (1.0 - F) * smoothstep(1.0, 6.0, shoreD);

// ── whitecaps, on the SWELL only and genuinely rare ──
// Driven by the large octave rather than by total slope: total slope is dominated by the
// fine chop, which is present everywhere, so keying off it whitewashed the entire near
// field. A whitecap is a big wave breaking, not a ripple.
float swellSteep = length(g3 * fSwell + g2 * 0.6 * fMid);
float steep = smoothstep(0.15, 0.32, swellSteep);
float capMask = smoothstep(8.0, 24.0, shoreD);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.92, 0.98), steep * capMask * uCaps);

// ── SHORELINE ────────────────────────────────────────────────────────────────
// The old version was an opaque sheet with a white band painted along its edge, and
// that is exactly what it looked like: a plane laid on top of the island and cut off
// where the two met. Three things fix it, and none of them are the foam.
//
// 1. WATER IS NOT OPAQUE. In a metre of clear water you see the sand through it. The
//    shoreline you actually recognise is the GRADIENT from sand, through green, into
//    blue — the waterline itself is barely an edge at all. An opaque sheet cannot
//    express that no matter how its edge is painted.
// 2. SURF BREAKS ON DEPTH, NOT DISTANCE. A wave breaks where the water shallows to
//    about its own height, so the break line follows the depth CONTOUR. That is why
//    real surf bends around a headland and bunches over a bar, and why a band at a
//    fixed distance from the shore reads as a drawn outline.
// 3. THE WATERLINE MOVES. Swash runs up the beach and drains back. A static edge is a
//    cut; an edge that breathes is a shore.

// SWASH: the whole waterline advances and retreats, so every depth-driven term below
// moves with it rather than the foam sliding across a fixed edge.
float swash = sin(uTime * 0.75) * 0.30 + sin(uTime * 0.41 + 1.7) * 0.16;
float sd = shoreD + swash;

// CLARITY: transparent in the shallows so the sea floor reads through, opaque by the
// time it is deep. Fresnel overrides it — even a puddle mirrors the sky end-on, so at
// grazing angles the water must stay opaque or the beach shows through the reflection.
float clarity = smoothstep(0.0, 5.0, sd);
diffuseColor.a *= max(mix(0.08, 1.0, clarity), F);

// SETS rolling shoreward. The phase advances with depth, so the crests travel up the
// slope; the two low-frequency sines bend them along the coast so they are not parallel
// stripes across the whole island.
float sets = sin(sd * 3.0 - uTime * 1.5
                 + sin(vWorldPos.x * 0.019) * 2.3 + sin(vWorldPos.z * 0.016) * 2.3);
float breakBand = (1.0 - smoothstep(0.0, 2.8, sd)) * smoothstep(0.10, 0.85, sets);
// the persistent lace right at the edge, where the last of the wave is still draining
float edge = 1.0 - smoothstep(0.0, 1.0, sd);
float foam = clamp(breakBand * 0.8 + edge * edge * 0.95, 0.0, 1.0) * uFoam;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 0.99), foam);
// foam floats ON the water: opaque even in ten centimetres of it
diffuseColor.a = max(diffuseColor.a, foam);

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
totalEmissiveRadiance += vec3(1.0, 0.97, 0.90) * glint * F * uGlintAmp * (0.25 + 0.75 * fMid) * (1.0 - hz);`)

      // As the normal octaves fade out their energy has to go somewhere or distant water
      // turns into a mirror. Roughness rises to carry it, which is what keeps the far sea
      // reading as textured rather than as polished glass.
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
// Starts further out than it did, because the fine octaves now survive to 720 and 2300 m.
// Roughness is here to carry the energy of normals that have GONE; ramping it up while they
// are still being drawn just smears detail that is still resolvable.
roughnessFactor = mix(0.055, 0.34, smoothstep(1200.0, 26000.0, viewDist));`);
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
  // 16 SEGMENTS, NOT 220. This plane carries no vertex waves (waveAmp 0), and every
  // single thing that shades it — Fresnel, the reflected sky, the wave normals, the haze
  // fade — is evaluated per FRAGMENT. The only per-vertex quantity is vWorldPos, which
  // interpolates exactly across a flat plane no matter how few triangles it has. 220
  // segments was 97k triangles producing a result identical to 512.
  const farGeo = new THREE.PlaneGeometry(FAR, FAR, 16, 16);
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

  // ── shore field ─────────────────────────────────────────────────────────
  // 2048 over 16.4 km is 8 m a texel, against the 68 m lattice this replaces and the 5 m the
  // terrain draws its own side of the waterline at. Off-thread because it is 4.2 million
  // heightAt calls at 0.87 us each — 3.7 seconds, which is a freeze on the main thread and
  // nothing at all here. ?shorefield=0 falls back to the old vertex attribute.
  const SHORE_RES = 2048;
  if (new URLSearchParams(location.search).get('shorefield') !== '0') {
    try {
      const sw = new Worker(new URL('./shoreworker.js', import.meta.url), { type: 'module' });
      sw.onerror = (e) => {
        console.error('[flighfeel] shore field bake failed — keeping the vertex attribute',
          e && (e.message || e.type));
        sw.terminate();
      };
      sw.onmessage = (e) => {
        const tex = new THREE.DataTexture(e.data.data, e.data.res, e.data.res,
          THREE.RedFormat, THREE.UnsignedByteType);
        // LINEAR, and it matters: nearest would put the 8 m texel grid straight back into
        // the foam line as a staircase, which is the shape of the bug being fixed.
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        shared.uShoreTex.value = tex;
        shared.uShoreSize.value = e.data.size;
        shared.uShoreOn.value = 1;
        console.log(`[flighfeel] shore field ${e.data.res}^2 (${(e.data.size / e.data.res).toFixed(1)} m/texel)`);
        sw.terminate();
      };
      sw.postMessage({ type: 'seed', seed: getTerrainSeed() });
      sw.postMessage({ size: SIZE, res: SHORE_RES });
    } catch (err) {
      console.error('[flighfeel] shore field worker unavailable', err);
    }
  }

  function update(time) {
    // wrap at 2000π: every uTime factor has ≤3 decimals, so k·2000π is a whole number
    // of cycles — seamless wrap, and float32 phase precision never degrades
    uTime.value = time % 6283.18530718;
  }

  window.__water = { material: mat, uniforms: shared, sheet: water, far };
  return { update, material: mat, uniforms: shared };
}
