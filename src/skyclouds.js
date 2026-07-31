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
// roughly 270 sin() per density sample. The march takes ~80 steps, each needing density
// once, six more for the light march and one for the silver lining — about 640 density
// samples per pixel, so ~170k sin() per pixel. That does not run. The same Perlin and
// Worley fields are baked once into 3D textures here and sampled instead, which is what
// the skill's own performance notes call for.

const PARAMS = new URLSearchParams(location.search);
const num = (k, d) => (PARAMS.get(k) != null ? +PARAMS.get(k) : d);

// Render scale for the cloud buffer. Cost is close to quadratic in this, and it is by
// far the most expensive number in the file.
const CLOUD_RES = Math.min(1, Math.max(0.2, num('cloudres', 0.7)));
const MAX_STEPS = Math.round(num('steps', 64));
const LIGHT_STEPS = Math.round(num('lsteps', 6));

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
// three axes. A non-tiling 3D noise shows as a repeating hard plane every period.
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
    const ox = hash3i(cx, cy, cz, seed);
    const oy = hash3i(cx, cy, cz, seed + 101);
    const oz = hash3i(cx, cy, cz, seed + 211);
    const ddx = dx + ox - fx, ddy = dy + oy - fy, ddz = dz + oz - fz;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d < best) best = d;
  }
  return Math.min(1, Math.sqrt(best));
}

// Base shape, 64^3. R = fbm, G = inverted Worley (low), B = inverted Worley (high).
// The shader mixes them, so the balance stays tunable without a rebake.
function makeShapeTexture(N = 64) {
  const data = new Uint8Array(N * N * N * 4);
  const s = 1 / N;
  for (let z = 0; z < N; z++)
  for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const u = x * s, v = y * s, w = z * s;
    const f = fbm3(u * 4, v * 4, w * 4, 4, 7, 4);
    const w1 = 1 - worley3(u, v, w, 4, 31);
    const w2 = 1 - worley3(u, v, w, 8, 57);
    const i = (((z * N) + y) * N + x) * 4;
    data[i] = Math.max(0, Math.min(255, f * 255));
    data[i + 1] = Math.max(0, Math.min(255, w1 * 255));
    data[i + 2] = Math.max(0, Math.min(255, w2 * 255));
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
  for (let z = 0; z < N; z++)
  for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const u = x * s, v = y * s, w = z * s;
    const d = (1 - worley3(u, v, w, 4, 11)) * 0.55
            + (1 - worley3(u, v, w, 8, 23)) * 0.30
            + (1 - worley3(u, v, w, 16, 37)) * 0.15;
    const i = (((z * N) + y) * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, d * 255));
    data[i + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
const RAYMARCH_FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;

uniform sampler3D shapeTex;
uniform sampler3D detailTex;
uniform sampler2D sceneDepth;

uniform vec3  cameraPos;
uniform mat4  invProjection;
uniform mat4  invView;
uniform vec3  sunDir;
uniform vec3  sunColor;
uniform vec3  ambientSky;
uniform float time;

uniform float cloudBase;
uniform float cloudTop;
uniform float coverage;
uniform float shapeScale;
uniform float detailScale;
uniform float detailStrength;
uniform float worleyMix;
uniform float absorptionCoeff;
uniform float densityScale;
uniform float maxDist;
uniform float baseDarken;
uniform float silverStrength;
uniform vec2  windDirection;
uniform float windSpeed;
uniform float cameraNear;
uniform float cameraFar;

varying vec2 vUv;

#define PI 3.14159265

float remap(float v, float lo, float hi, float nlo, float nhi) {
  return nlo + (clamp(v, lo, hi) - lo) / max(hi - lo, 1e-5) * (nhi - nlo);
}

// ─── Density ────────────────────────────────────────
// A genuine function of all three coordinates. The vertical envelope multiplies a 3D
// field rather than a 2D one, so the top and the sides are surfaces, not planes.
float cloudDensity(vec3 p, float lod) {
  float altNorm = (p.y - cloudBase) / (cloudTop - cloudBase);
  if (altNorm < 0.0 || altNorm > 1.0) return 0.0;

  vec3 wind = vec3(windDirection.x, 0.0, windDirection.y) * windSpeed * time;
  vec3 sp = (p + wind) * shapeScale;

  vec4 s = texture(shapeTex, sp);
  float base = mix(s.r, s.g * 0.65 + s.b * 0.35, worleyMix);

  // Altitude envelope: soft in at the base, tapering out toward the top.
  float altEnv = smoothstep(0.0, 0.12, altNorm) * smoothstep(1.0, 0.62, altNorm);

  // Coverage threshold. The remap is against a HEIGHT-VARYING bar, so the crossing is
  // not an iso-height surface — this is the part that keeps the top from going flat.
  float bar = 1.0 - coverage * altEnv;
  float shape = remap(base, bar, min(bar + 0.32, 1.0), 0.0, 1.0);
  if (shape <= 0.0) return 0.0;

  // Detail erosion, skipped at distance where it would only alias.
  if (lod < 0.5) {
    vec3 dp = (p + wind * 2.0) * detailScale;
    float d = texture(detailTex, dp).r;
    // whippy at the base, fluffy at the top
    float dm = mix(d, 1.0 - d, smoothstep(0.25, 0.75, altNorm));
    shape = remap(shape, dm * detailStrength, 1.0, 0.0, 1.0);
  }

  return max(shape, 0.0) * altEnv * densityScale;
}

// ─── Phase ──────────────────────────────────────────
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
float cloudPhase(float c) { return hg(c, 0.62) * 0.7 + hg(c, -0.3) * 0.3; }

// ─── Light march ────────────────────────────────────
float lightMarch(vec3 p) {
  float stepL = (cloudTop - cloudBase) / float(LIGHT_STEPS) * 0.7;
  float accum = 0.0;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    p += sunDir * stepL;
    accum += cloudDensity(p, 1.0) * stepL;
  }
  float beer = exp(-accum * absorptionCoeff);
  float powder = 1.0 - exp(-accum * absorptionCoeff * 2.0);
  return mix(beer, beer * powder, 0.5);
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

  vec2 slab = intersectSlab(ro, rd, cloudBase, cloudTop);
  slab.y = min(slab.y, maxDist);

  // Do not draw cloud in front of terrain. Without this the deck paints over mountains.
  float dz = texture(sceneDepth, vUv).r;
  if (dz < 1.0) {
    float sceneT = linearDepth(dz) / max(dot(rd, normalize((invView * vec4(0,0,-1,0)).xyz)), 1e-4);
    slab.y = min(slab.y, sceneT);
  }
  if (slab.x >= slab.y) { gl_FragColor = vec4(0.0); return; }

  float cosT = dot(rd, sunDir);
  float phase = cloudPhase(cosT);

  float stepSize = (slab.y - slab.x) / float(MAX_STEPS);
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233)) + time) * 43758.5453);
  float t = slab.x + jitter * stepSize;

  vec4 result = vec4(0.0);
  for (int i = 0; i < MAX_STEPS; i++) {
    if (result.a > 0.985 || t > slab.y) break;
    vec3 p = ro + rd * t;
    float lodT = t > 22000.0 ? 1.0 : 0.0;
    float density = cloudDensity(p, lodT);

    if (density > 0.002) {
      float light = lightMarch(p);
      vec3 col = sunColor * light * phase * 7.5 + ambientSky * 0.55;

      // Silver lining: bright rim where the sun is behind a thin edge.
      float edge = cloudDensity(p + sunDir * 220.0, 1.0);
      float silver = pow(max(1.0 - edge, 0.0), 3.0) * pow(max(-cosT, 0.0), 3.0);
      col += sunColor * silver * silverStrength;

      // Bases sit in their own shadow.
      float altNorm = (p.y - cloudBase) / (cloudTop - cloudBase);
      col *= mix(baseDarken, 1.0, smoothstep(0.0, 0.75, altNorm));

      float alpha = 1.0 - exp(-density * stepSize * absorptionCoeff);
      result.rgb += col * alpha * (1.0 - result.a);
      result.a += alpha * (1.0 - result.a);
    }
    t += stepSize;
  }

  gl_FragColor = clamp(result, 0.0, 64.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tClouds;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  vec4 c = texture2D(tClouds, vUv);          // premultiplied
  gl_FragColor = vec4(scene.rgb * (1.0 - c.a) + c.rgb, scene.a);
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

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });

    this.march = new THREE.ShaderMaterial({
      defines: { MAX_STEPS: MAX_STEPS, LIGHT_STEPS: LIGHT_STEPS },
      uniforms: {
        shapeTex: { value: shapeTex }, detailTex: { value: detailTex },
        sceneDepth: { value: null },
        cameraPos: { value: new THREE.Vector3() },
        invProjection: { value: new THREE.Matrix4() },
        invView: { value: new THREE.Matrix4() },
        sunDir: { value: sunDir.clone() },
        sunColor: { value: new THREE.Color(1.0, 0.97, 0.92) },
        ambientSky: { value: new THREE.Color(0.58, 0.70, 0.90) },
        time: { value: 0 },
        cloudBase: { value: params.cloudBase },
        cloudTop: { value: params.cloudTop },
        coverage: { value: params.coverage },
        shapeScale: { value: params.shapeScale },
        detailScale: { value: params.detailScale },
        detailStrength: { value: params.detailStrength },
        worleyMix: { value: params.worleyMix },
        absorptionCoeff: { value: params.absorptionCoeff },
        densityScale: { value: params.densityScale },
        maxDist: { value: params.maxDist },
        baseDarken: { value: params.baseDarken },
        silverStrength: { value: params.silverStrength },
        windDirection: { value: new THREE.Vector2(params.windX, params.windZ) },
        windSpeed: { value: params.windSpeed },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: RAYMARCH_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.composite = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tClouds: { value: this.target.texture } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.quadMarch = new FullScreenQuad(this.march);
    this.quadComposite = new FullScreenQuad(this.composite);
  }

  setSize(w, h) {
    this.target.setSize(Math.max(1, Math.round(w * CLOUD_RES)),
                        Math.max(1, Math.round(h * CLOUD_RES)));
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.march.uniforms;
    const cam = this.camera;
    u.cameraPos.value.copy(cam.position);
    u.invProjection.value.copy(cam.projectionMatrixInverse);
    u.invView.value.copy(cam.matrixWorld);
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;
    u.sceneDepth.value = readBuffer.depthTexture;

    const p = this.params;
    u.cloudBase.value = p.cloudBase; u.cloudTop.value = p.cloudTop;
    u.coverage.value = p.coverage; u.shapeScale.value = p.shapeScale;
    u.detailScale.value = p.detailScale; u.detailStrength.value = p.detailStrength;
    u.worleyMix.value = p.worleyMix; u.absorptionCoeff.value = p.absorptionCoeff;
    u.densityScale.value = p.densityScale; u.maxDist.value = p.maxDist;
    u.baseDarken.value = p.baseDarken; u.silverStrength.value = p.silverStrength;
    u.windDirection.value.set(p.windX, p.windZ); u.windSpeed.value = p.windSpeed;
    u.time.value = p.time;

    renderer.setRenderTarget(this.target);
    renderer.clear();
    this.quadMarch.render(renderer);

    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (!this.renderToScreen) renderer.clear();
    this.quadComposite.render(renderer);
  }

  dispose() {
    this.target.dispose(); this.march.dispose(); this.composite.dispose();
    this.quadMarch.dispose(); this.quadComposite.dispose();
  }
}

// ---------------------------------------------------------------------------
export async function createSkyClouds({ renderer, scene, camera, sunDir }) {
  const t0 = performance.now();
  const shapeTex = makeShapeTexture(64);
  const detailTex = makeDetailTexture(32);
  const bakeMs = Math.round(performance.now() - t0);

  // partlyCloudy, from the skill's presets, moved up to our altitudes: the aircraft
  // cruises at 1-5 km and wants something to fly between rather than a low deck.
  const params = {
    cloudBase: num('cbase', 1400),
    cloudTop: num('ctop', 4200),
    coverage: num('coverage', 0.46),
    // 1/metres. 1/9000 puts the base shape's features at kilometre scale.
    shapeScale: num('sscale', 1 / 9000),
    detailScale: num('dscale', 1 / 900),
    detailStrength: num('dstr', 0.50),
    worleyMix: num('wmix', 0.55),
    absorptionCoeff: num('absorb', 0.055),
    densityScale: num('density', 1.0),
    maxDist: num('maxdist', 46000),
    baseDarken: num('basedark', 0.55),
    silverStrength: num('silver', 1.1),
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
  composer.addPass(new RenderPass(scene, camera));
  const cloudPass = new CloudPass(camera, shapeTex, detailTex, sunDir, params);
  composer.addPass(cloudPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.19, 0.5, 1.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const api = {
    clouds: null,          // no third-party effect object; params is the handle
    params, composer, cloudPass, bakeMs,
    setSize(w, h) {
      composer.setSize(w, h);
      cloudPass.setSize(w * dpr, h * dpr);
      bloom.setSize(w, h);
    },
    render(dt = 0.016) {
      params.time += dt;
      composer.render();
    },
    dispose() {
      cloudPass.dispose(); shapeTex.dispose(); detailTex.dispose(); composer.dispose();
    },
  };
  window.__sc = api;
  console.log(`[flighfeel] sky clouds ready (noise bake ${bakeMs} ms)`);
  return api;
}
