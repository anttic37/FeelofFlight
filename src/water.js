import * as THREE from 'three';

// Shore-aware animated ocean. A detailed grid sheet around the island gets
// traveling sine waves + shallow-water tint + shoreline foam + normal sparkle,
// injected into MeshStandardMaterial via onBeforeCompile so fog/lights/shadows
// keep working. A huge plain far plane fills the horizon underneath it.

const SIZE = 16400; // covers island r~7000 + shore band
const SEG = 300; // 301^2 ≈ 90k verts

export function createWater(scene, heightAt) {
  const uTime = { value: 0 };

  // far ocean: plain dark blue horizon fill just below the detailed sheet
  // material params AND color space mirror the sheet exactly: the sheet's
  // shader writes its open-sea color as raw LINEAR values, so the far fill
  // must be set with setRGB (linear working space) — a hex constructor would
  // be sRGB-converted and the sheet's square edge shows as a shaded wedge.
  const farMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.15 });
  farMat.color.setRGB(0.075, 0.28, 0.46);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), farMat);
  far.rotation.x = -Math.PI / 2;
  // well below the deepest wave trough (0.15 lift - 0.68 amplitude = -0.53):
  // at -0.25 the troughs touched it exactly and the whole ocean z-flickered
  far.position.y = -2.0;
  scene.add(far);

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2); // baked flat so shader `position` == world position
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  // 5-tap smoothed depth: the raw 55 m vertex sampling made the foam and
  // shallow-tint bands zigzag along the shore at grid resolution
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = -heightAt(x, z)
      + (-heightAt(x + 38, z)) + (-heightAt(x - 38, z))
      + (-heightAt(x, z + 38)) + (-heightAt(x, z - 38));
    depth[i] = Math.max(0, d / 5);
  }
  geo.setAttribute('shoreDepth', new THREE.BufferAttribute(depth, 1));

  const mat = new THREE.MeshStandardMaterial({ color: 0x1e5d8c, roughness: 0.3, metalness: 0.15 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute float shoreDepth;
varying float vShoreDepth;
varying vec2 vWPos;`)
      // long swells only: wavelengths ~150 / ~155 / ~203 m — all safely above the
      // ~55 m grid pitch's Nyquist limit (110 m), so no vertex-sampling shimmer.
      // DEAD FLAT until ~2 m of real depth: any vertical wave motion near the
      // contact zone slides the waterline sideways across the shallow beach
      // slope and saw-tooths the coast at grid resolution.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vShoreDepth = shoreDepth;
vWPos = position.xz;
float wDamp = clamp((shoreDepth - 1.8) * 0.55, 0.0, 1.0);
transformed.y += wDamp * (0.15
  + sin(position.x * 0.042 + uTime * 0.9) * 0.3
  + sin((position.x * 0.7 + position.z * 0.8) * 0.038 - uTime * 1.25) * 0.22
  + sin(position.z * 0.031 + uTime * 0.65) * 0.16);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vShoreDepth;
varying vec2 vWPos;
// cheap value noise for the water surface — unlike sine products it never
// forms a repeating lattice, which killed the old ripple shading
float wnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// three-stage depth palette: turquoise shallows -> lagoon blue -> open sea
diffuseColor.rgb = mix(vec3(0.16, 0.56, 0.53), vec3(0.10, 0.42, 0.58), smoothstep(0.0, 3.0, vShoreDepth));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.28, 0.46), smoothstep(3.0, 14.0, vShoreDepth));
// slow drifting brightness patches — real seas are never one flat tint
float pat = wnoise(vWPos * 0.0052 + vec2(uTime * 0.011, -uTime * 0.008));
pat += wnoise(vWPos * 0.0016 + vec2(-uTime * 0.006, uTime * 0.004));
diffuseColor.rgb *= 0.93 + 0.07 * pat;
float foamBand = 1.0 - smoothstep(0.0, 2.4, vShoreDepth);
float stripes = sin(uTime * 1.7 - vShoreDepth * 4.2 + sin(vWPos.x * 0.23) * 1.9 + sin(vWPos.y * 0.19) * 1.9);
float foam = foamBand * foamBand * smoothstep(0.25, 0.95, stripes) * 0.7;
foam = max(foam, (1.0 - smoothstep(0.0, 0.9, vShoreDepth)) * 0.85);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.97, 1.0), clamp(foam, 0.0, 1.0));`)
      // per-pixel ripple normals from TWO independently scrolling noise fields
      // (the procedural version of dual scrolling normal maps — the standard
      // real-time water technique). Noise gradients never form a lattice, so
      // the old sine-product moire cannot occur; amplitude still fades with
      // view distance so far water reads calm.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float rippleAtt = 1.0 - smoothstep(300.0, 2600.0, length(vViewPosition)) * 0.8;
vec2 q1 = vWPos * 0.043 + vec2(uTime * 0.062, uTime * 0.037);
vec2 q2 = vWPos * 0.0128 + vec2(-uTime * 0.021, uTime * 0.0146);
float n1 = wnoise(q1), n2 = wnoise(q2);
float nx = (wnoise(q1 + vec2(0.13, 0.0)) - n1) * 0.55 + (wnoise(q2 + vec2(0.11, 0.0)) - n2) * 0.85;
float nz = (wnoise(q1 + vec2(0.0, 0.13)) - n1) * 0.55 + (wnoise(q2 + vec2(0.0, 0.11)) - n2) * 0.85;
normal = normalize(normal + rippleAtt * vec3(nx, 0.0, nz));`);
  };

  const water = new THREE.Mesh(geo, mat);
  water.receiveShadow = true;
  scene.add(water);

  function update(time) {
    // wrap at 2000π: every uTime factor has ≤3 decimals, so k·2000π is a whole
    // number of cycles — seamless wrap, and float32 phase precision never degrades
    uTime.value = time % 6283.18530718;
  }

  return { update };
}
