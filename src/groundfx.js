// Shared per-pixel ground detail for standard materials, injected via
// onBeforeCompile (same technique as the water shader): three octaves of
// value-noise albedo mottle that fade in by view distance, plus large soft
// cloud-shadow blobs drifting +x. Those blobs are their own noise field, not a
// projection of the volumetric clouds overhead — they only have to agree on
// drift direction and rough scale, and at a glance they do.
// Vertex colors only vary per-vertex (5-40 m), which reads as airbrushed
// plastic up close — this layer is what makes low flight feel fast.
//
// Main-thread only (terrain.js / runways.js import it; the worker never does).

export const uGroundTime = { value: 0 };

const NOISE_GLSL = `
uniform float uGroundTime;
varying vec3 vGWPos;
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
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
  float g1 = gnoise(ggp * 0.85);        // ~1 m grain — the ground-rush layer
  float g2 = gnoise(ggp * 0.11 + 7.3);  // ~9 m mottle
  float g3 = gnoise(ggp * 0.019 + 3.1); // ~50 m patchwork
  float f1 = 1.0 - smoothstep(40.0, 220.0, gdist);
  float f2 = 1.0 - smoothstep(300.0, 2200.0, gdist);
  float f3 = 1.0 - smoothstep(1500.0, 9000.0, gdist);
  float gm = (g1 - 0.5) * 0.10 * f1 + (g2 - 0.5) * 0.11 * f2 + (g3 - 0.5) * 0.065 * f3;
  // faint warm/cool lean only — stronger asymmetry read as moss blotches on sand
  diffuseColor.rgb *= 1.0 + vec3(gm * 1.07, gm, gm * 0.93);
}`;

export function injectGroundFX(material, { detail = true, clouds = true } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundTime = uGroundTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvGWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + NOISE_GLSL)
      .replace('#include <color_fragment>',
        '#include <color_fragment>' + (detail ? DETAIL_GLSL : '') + (clouds ? CLOUD_GLSL : ''));
  };
}
