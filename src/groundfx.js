import * as THREE from 'three';
import { getDetailTexture } from './grounddetail.js';
import { ATMO } from './atmosphere.js';

// Shared per-pixel ground detail for standard materials, injected via
// onBeforeCompile (same technique as the water shader): value-noise albedo
// mottle that fades in by view distance, procedural splat detail blended by
// slope, a bump derived from that same sample, plus large soft cloud-shadow
// blobs drifting +x. Those blobs are their own noise field, not a projection of
// the volumetric clouds overhead — they only have to agree on drift direction
// and rough scale, and at a glance they do.
// Vertex colors only vary per-vertex (5-40 m), which reads as airbrushed
// plastic up close — this layer is what makes low flight feel fast.
//
// Main-thread only (terrain.js / runways.js import it; the worker never does).

export const uGroundTime = { value: 0 };
const uDetailTex = { value: null };
// live-tunable so the bump can be A/B'd from the console without a reload —
// window.__ff exposes it as groundBump
// 1.1, down from 2.4: the terrain is smooth-shaded now, and the flat facet
// normals had been masking half of this. On a smooth base the same bump reads
// roughly twice as strong.
export const uBumpScale = { value: 1.1 };

// THE ONE RULE THAT OWNS THE SHORELINE. The terrain is several overlapping layers — three LOD
// rings and a far shell — held apart vertically so they never z-fight. That works for opaque
// land and fails at the coast, twice over: a coarse chord crossing the waterline rises above
// the fine surface as a flat tongue over the sea, and everything sunk beneath the sea to hide
// it is visible anyway, because the water is clear in the shallows. The history here is ten
// coast commits and one full revert, each softening how much of a coarse layer shows at the
// waterline. None asked the PS2-era question: why is a coarse layer drawn there at all?
//
// Now it is not. Within uCoastR of the plane — inside the disc where the finest ring is
// guaranteed to be tiled — a coarse layer discards every fragment below its coast height:
// 0.6 m for ring 1 (15 m chords, kept as the safety net if a fine tile is still streaming),
// 2.5 m for ring 2 and the shell, whose 40 m and 162 m chords bridge shallow lagoons well
// ABOVE the water — measured by ray census over a tidal pool, the shell sat at +1.25 m over
// a bed at -0.47 m and drew the pool as a hexagon of sand. The finest ring and the shore
// ribbon own everything in the beach band; the coarse chords that made the ledges are simply
// never rasterised where you can see them. Failure is benign by construction: if the fine tile has not streamed in yet, the
// hole is under the water surface, which covers it. Beyond the disc nothing changes — there
// the coarse ring IS the finest present and must keep drawing. ?coastcut=0 is the A/B.
export const COAST = {
  uCoastCenter: { value: new THREE.Vector2(1e9, 1e9) },
  uCoastR: { value: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('coastcut') === '0') ? 0 : 1100 },
};
const COAST_Y = 0.6;   // metres above sea level; the beach's last 0.6 m and everything under water
export function setCoastCenter(x, z) { COAST.uCoastCenter.value.set(x, z); }

const NOISE_GLSL = `
uniform float uGroundTime;
uniform sampler2D uDetailTex;
uniform float uBumpScale;
varying vec3 vGWPos;
varying vec3 vGWNrm;
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Inigo Quilez's tile-breaking sample: two lookups at cell-hashed offsets,
// blended across the cell boundary. Gradients are passed in from the UNOFFSET
// coordinates, because the offsets make the derivatives discontinuous and the
// hardware would otherwise pick a different mip on each side of every cell.
vec3 gCellRand(vec2 c) {   // xy = uv offset, z = rotation
  return fract(sin(vec3(dot(c, vec2(127.1, 311.7)),
                        dot(c, vec2(269.5, 183.3)),
                        dot(c, vec2(419.2, 371.9)))) * 43758.5453);
}
// TWO THINGS THIS GETS RIGHT THAT THE FIRST VERSION DID NOT.
//
// 1. THE CELL MUST BE ABOUT THE SIZE OF THE REPEAT. It was one random patch per 60 m
//    against a texture that repeats every 16 m, so each randomised cell still contained
//    nearly four copies of the same tile side by side. Offsetting a cell does nothing
//    about repetition INSIDE that cell, and that residue is the crosshatch that was
//    still visible. Now ~18 m, so a cell holds about one copy.
//
// 2. OFFSET ALONE CANNOT BREAK A DIRECTIONAL MOTIF. A shifted copy of a woven pattern
//    is still the same weave running the same way, and the eye tracks direction far
//    more readily than phase. Each cell now gets its own ROTATION as well, which is
//    what actually destroys the grid. The gradients are rotated by the same matrix or
//    the hardware picks a mip for the unrotated footprint and the far field goes soft.
vec4 gNoTile(vec2 uv, vec2 ddx, vec2 ddy) {
  vec2 cell = uv * 0.9;                  // one random patch per ~18 m, near the repeat
  vec2 ic = floor(cell), fc = fract(cell);
  vec2 w = fc * fc * (3.0 - 2.0 * fc);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 o = vec2(float(i), float(j));
      float bw = mix(1.0 - w.x, w.x, o.x) * mix(1.0 - w.y, w.y, o.y);
      vec3 h = gCellRand(ic + o);
      float a = h.z * 6.2831853;
      float ca = cos(a), sa = sin(a);
      mat2 R = mat2(ca, -sa, sa, ca);
      acc += bw * textureGrad(uDetailTex, R * uv + h.xy, R * ddx, R * ddy);
      wsum += bw;
    }
  }
  return acc / max(wsum, 1e-4);
}`;

// pattern shifts toward -offset/scale: -(-0.0053)/0.0014 = +3.8 m/s eastward
const CLOUD_GLSL = `
vec2 gcp = vGWPos.xz * 0.0014 + uGroundTime * vec2(-0.0053, -0.0008);
float gcl = gnoise(gcp) * 0.62 + gnoise(gcp * 2.6 + 19.7) * 0.38;
diffuseColor.rgb *= 1.0 - 0.20 * smoothstep(0.58, 0.80, gcl);`;

const DETAIL_GLSL = `
{
  vec2 ggp = vGWPos.xz;
  float gdist = length(vViewPosition);
  float g2 = gnoise(ggp * 0.11 + 7.3);  // ~9 m mottle
  float g3 = gnoise(ggp * 0.019 + 3.1); // ~50 m patchwork
  float f2 = 1.0 - smoothstep(300.0, 2200.0, gdist);
  float f3 = 1.0 - smoothstep(1500.0, 9000.0, gdist);
  float gm = (g2 - 0.5) * 0.11 * f2 + (g3 - 0.5) * 0.065 * f3;
  // faint warm/cool lean only — stronger asymmetry read as moss blotches on sand
  diffuseColor.rgb *= 1.0 + vec3(gm * 1.07, gm, gm * 0.93);
}`;

// SPLAT DETAIL. One RGBA texture carries four materials' worth of light-and-dark
// (see grounddetail.js), so the blend is a single dot product instead of four
// texture reads. The weights come from slope, matching the bands colorcore bakes
// into the vertex colours, so the texture lands on the material it belongs to.
//
// ANTI-TILING, properly this time. The first attempt sampled two non-harmonic
// scales and combined them, on the theory that incommensurate periods would beat
// the repeat far enough out to hide it. They do not: the ground came out with a
// regular diamond crosshatch at the 16 m repeat, because two periodic functions
// combined are still periodic — you just get a longer period and a busier motif.
//
// This is Inigo Quilez's variant instead: hash each low-frequency cell to a
// random UV offset, sample twice with neighbouring cells' offsets, and blend
// across the boundary. The pattern still comes from one small texture, but the
// piece of it that lands on any given patch of ground is effectively random, so
// there is nothing to see repeating.
//
// It needs textureGrad. Offsetting the UVs makes their screen-space derivatives
// jump at every cell border, and the hardware picks the mip level from those
// derivatives — so with an ordinary sample you trade the tiling for a grid of
// mip seams. Passing the UNOFFSET gradients explicitly keeps the filtering
// continuous. WebGL2/GLSL3 has textureGrad natively; three's texture2D alias
// does not cover it, hence the direct call.
//
// gDet is deliberately declared at function scope, NOT inside a block: the
// normal perturbation below reads it, and recomputing it there would double the
// texture cost for nothing.
const SPLAT_GLSL = `
float gDet = 0.5;
float gDetFade = 0.0;
float gBumpFade = 0.0;
{
  float gsl = 1.0 - clamp(vGWNrm.y, 0.0, 1.0);
  float gdist = length(vViewPosition);
  // DISTANCE FADE. This used to run to 4.2 km, which is precisely where the
  // layer stops helping and starts hurting: past a few hundred metres one texel
  // is under a pixel, so the detail cannot resolve — all it can do is alias, and
  // any residue of the tiling is most legible out there where the ground is
  // compressed into a few rows of pixels. Gone by ~1.4 km, so the far field is
  // carried by the vertex colours and the aerial perspective, which is what
  // should be describing distance anyway.
  gDetFade = (1.0 - smoothstep(420.0, 1400.0, gdist)) * smoothstep(1.0, 5.0, vGWPos.y);
  // The bump gets its OWN, far shorter range. Derivative bump reads the screen-
  // space gradient of the detail, and when you look ACROSS ground rather than
  // down at it the two derivatives are wildly different scales, so the gradient
  // collapses onto one screen axis and the whole middle distance combs into
  // streaks. Close up the footprint is near-square and it behaves. Albedo has no
  // such problem, so it carries the texture out to the horizon and the bump only
  // adds the light response underfoot.
  gBumpFade = (1.0 - smoothstep(70.0, 320.0, gdist)) * smoothstep(1.0, 5.0, vGWPos.y);
  if (gDetFade > 0.002) {
    // A low-frequency WARP before the lookup. The cell-offset trick randomises
    // which piece of texture lands where, but its own cell lattice is still a
    // regular grid, and at a glance that grid is what was left of the tiling.
    // Bending the coordinates first means the lattice is no longer straight, so
    // there is no longer a regular anything to lock onto. gnoise is hashed from
    // world position and does not repeat at all over an island this size.
    vec2 gwp = vGWPos.xz;
    vec2 gwarp = vec2(gnoise(gwp * 0.0031 + 3.7), gnoise(gwp * 0.0031 + 19.1)) - 0.5;
    vec2 guv = (gwp + gwarp * 46.0) * 0.062;           // ~16 m per repeat
    vec2 gddx = dFdx(guv), gddy = dFdy(guv);
    vec4 gFine = gNoTile(guv, gddx, gddy);
    // The macro tap MODULATES the grain rather than multiplying into it. A
    // product of two noise fields is just noisier noise — it was reading as
    // static. Using the far coarser tap as an amplitude instead gives the grain
    // somewhere to be thick and somewhere to thin out, which is what ground
    // cover actually does and what stops it looking like sandpaper.
    // The macro amplitude comes from NOISE, not from the texture. It used to be
    // a plain texture sample at a sixth of the frequency, on the reasoning that
    // low-frequency repetition would not be visible — it was: at that scale the
    // tile is ~94 m, and a regular 94 m modulation over open ground is exactly
    // the sort of thing the eye locks onto. gnoise is hash-based and aperiodic,
    // it costs less than a texture read, and it cannot tile by construction.
    float gMac = gnoise(gwp * 0.0125 + 5.3) * 0.65 + gnoise(gwp * 0.041 + 11.9) * 0.35;
    vec4 gMacro = vec4(gMac);
    vec4 gt = clamp(vec4(0.5) + (gFine - 0.5) * (0.45 + 1.5 * gMacro), 0.0, 1.0);
    // material weights: turf on the flats, dry scrub as it tips, scree, then rock
    float wRock  = smoothstep(0.20, 0.46, gsl);
    float wScree = smoothstep(0.09, 0.26, gsl) * (1.0 - wRock);
    float wDry   = smoothstep(0.02, 0.15, gsl) * (1.0 - wRock - wScree);
    float wGrass = max(0.0, 1.0 - wRock - wScree - wDry);
    vec4 gw = vec4(wGrass, wDry, wScree, wRock);
    gw /= max(0.0001, gw.x + gw.y + gw.z + gw.w);
    gDet = clamp(dot(gt, gw), 0.0, 1.0);
    // rock and scree hold their contrast; turf stays gentler or it reads as dirt
    float gAmp = 0.34 + 0.36 * (wScree + wRock);
    diffuseColor.rgb *= 1.0 + (gDet - 0.5) * gAmp * gDetFade * 2.0;
  }
}`;

// BUMP. The albedo modulation above says where the light and dark are; this
// makes them respond to the sun, which is the difference between a printed
// pattern and a surface. Mikkelsen's derivative bump (the same construction
// three's own bumpmap chunk uses) turns the screen-space gradient of a height
// scalar into a world-space surface gradient — no tangents, no extra samples.
//
// It PERTURBS the existing normal rather than replacing it, because the terrain
// material is flatShading: overwriting would silently smooth-shade the whole
// island and throw away the faceted look.
const BUMP_GLSL = `
if (gBumpFade > 0.002) {
  vec3 gPx = dFdx(vGWPos), gPz = dFdy(vGWPos);
  vec3 gNw = normalize(vGWNrm);
  vec3 gR1 = cross(gPz, gNw), gR2 = cross(gNw, gPx);
  float gDen = dot(gPx, gR1);
  if (abs(gDen) > 1e-8) {
    vec3 gGrad = (gR1 * dFdx(gDet) + gR2 * dFdy(gDet)) / gDen;
    vec3 gGradV = (viewMatrix * vec4(gGrad, 0.0)).xyz;
    normal = normalize(normal - gGradV * (uBumpScale * gBumpFade));
  }
}
// SNOW LIGHTING RELAXATION — the shader half of the facet fix. Deep snow is a diffuser:
// its surface normal matters far less than on rock, because multiple scattering inside
// the pack launders the incident direction. Relaxing the lighting normal halfway toward
// world-up on snow pixels flattens the interpolated-normal facets that survive at
// LOD1/2 vertex pitch, at every distance, for ~9 ALU and no texture. The detector is
// palette-derived and verified in linear space: snow is the only ground whose blue
// channel is both high AND >= ~87% of green (cSnow b~0.91; the brightest sand and dune
// crest fail the ratio, sky never reaches this shader).
{
  float gSnow = smoothstep(0.55, 0.80, diffuseColor.b) * step(diffuseColor.g, diffuseColor.b * 1.15);
  if (gSnow > 0.01) {
    vec3 gUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    normal = normalize(mix(normal, gUpV, 0.5 * gSnow));
  }
}`;

// ?splat=0 turns the texture layer off — the A/B that tells you whether a change
// is the detail or the paint underneath it
const SPLAT_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('splat') !== '0';

export function injectGroundFX(material, { detail = true, clouds = true, splat = detail, coastCut = false, coastY = COAST_Y } = {}) {
  splat = splat && SPLAT_ON;
  if (splat && !uDetailTex.value) uDetailTex.value = getDetailTexture(null); // initGroundFX normally wins the race
  material.onBeforeCompile = (shader) => {
    // Assigning onBeforeCompile on the INSTANCE shadows the Material.prototype hook that
    // patchAerialPerspective installs, so the shared atmosphere uniforms have to be merged
    // here too. Without this the terrain compiles a fog chunk referencing uAtmSunDir that
    // nothing ever supplies — it reads as zero, and the ground alone stops responding to
    // the time of day while everything around it moves.
    Object.assign(shader.uniforms, ATMO);
    shader.uniforms.uGroundTime = uGroundTime;
    shader.uniforms.uDetailTex = uDetailTex;
    shader.uniforms.uBumpScale = uBumpScale;
    if (coastCut) {
      // see COAST above: this material is a coarse layer, and near the plane it does not
      // exist at or below the waterline. The discard sits first thing in main(), before any
      // lighting is paid for on a fragment that is about to be thrown away.
      shader.uniforms.uCoastCenter = COAST.uCoastCenter;
      shader.uniforms.uCoastR = COAST.uCoastR;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
  if (vGWPos.y < ${coastY.toFixed(2)} && distance(vGWPos.xz, uCoastCenter) < uCoastR) discard;`);
      shader.fragmentShader = 'uniform vec2 uCoastCenter;\nuniform float uCoastR;\n' + shader.fragmentShader;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWPos;\nvarying vec3 vGWNrm;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvGWNrm = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvGWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + NOISE_GLSL)
      .replace('#include <color_fragment>',
        '#include <color_fragment>' + (detail ? DETAIL_GLSL : '') + (splat ? SPLAT_GLSL : '')
        + (clouds ? CLOUD_GLSL : ''));
    if (splat) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + BUMP_GLSL);
    }
  };
}

// The texture wants the renderer only for its anisotropy cap, and the materials
// are built before anyone has a reason to pass one down — so let terrain.js hand
// it over once at startup instead of threading it through every call site.
//
// DEFERRED PAST FIRST PAINT. Baking the detail texture synchronously here cost ~200 ms of
// the boot. Instead we set a neutral 1x1 placeholder immediately — flat gray 128, against
// which the splat term resolves to *1 (a mathematical no-op, not a wrong look) and the
// derivative bump is 0 — so materials compile with a complete texture and no sync bake
// fires (injectGroundFX's fallback only bakes when uDetailTex.value is null). Two frames
// after first paint we bake the real texture and drop it onto the SAME uniform object, so
// every terrain/runway material picks it up with no recompile. The splat layer only acts
// within ~1.4 km and fades in over a frame or two — invisible behind the prep curtain.
export function initGroundFX(renderer) {
  const ph = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, THREE.RGBAFormat);
  ph.wrapS = ph.wrapT = THREE.RepeatWrapping;
  ph.minFilter = ph.magFilter = THREE.LinearFilter;
  ph.generateMipmaps = false;
  ph.needsUpdate = true;
  uDetailTex.value = ph;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    uDetailTex.value = getDetailTexture(renderer);
  }));
}
