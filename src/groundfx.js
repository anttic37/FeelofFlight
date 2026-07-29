import { getDetailTexture } from './grounddetail.js';

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
export const uBumpScale = { value: 2.4 };

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
vec2 gCellOff(vec2 c) {
  return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
}
vec4 gNoTile(vec2 uv, vec2 ddx, vec2 ddy) {
  vec2 cell = uv * 0.27;                 // one random patch per ~60 m of ground
  vec2 ic = floor(cell), fc = fract(cell);
  vec2 w = fc * fc * (3.0 - 2.0 * fc);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 o = vec2(float(i), float(j));
      float bw = mix(1.0 - w.x, w.x, o.x) * mix(1.0 - w.y, w.y, o.y);
      acc += bw * textureGrad(uDetailTex, uv + gCellOff(ic + o), ddx, ddy);
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
}`;

// ?splat=0 turns the texture layer off — the A/B that tells you whether a change
// is the detail or the paint underneath it
const SPLAT_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('splat') !== '0';

export function injectGroundFX(material, { detail = true, clouds = true, splat = detail } = {}) {
  splat = splat && SPLAT_ON;
  if (splat && !uDetailTex.value) uDetailTex.value = getDetailTexture(null); // initGroundFX normally wins the race
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundTime = uGroundTime;
    shader.uniforms.uDetailTex = uDetailTex;
    shader.uniforms.uBumpScale = uBumpScale;
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
export function initGroundFX(renderer) { uDetailTex.value = getDetailTexture(renderer); }
