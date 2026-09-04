import * as THREE from 'three';

// TEMPORAL FOAM ACCUMULATION — the thing that makes a sea read from altitude.
//
// The water shader decides per pixel, per frame, whether a wave is breaking (steep, near its
// crest, on its downwind face) and paints a whitecap there. A real whitecap does not vanish
// the instant the crest passes: it spills, spreads, drifts downwind and fades over several
// seconds, leaving streaks that lie along the wind. Those streaks are what an aeroplane sees
// from 300 m up; a sea without them is a texture.
//
// This was built once before and reverted, and the post-mortem was exact: at 16 m per texel
// the buffer was coarser than the wave features being injected, so it accumulated aliased
// noise and advected noise is still noise (autocorrelation 0.004 along wind, 0.009 across —
// nothing). The fix it asked for is resolution, and a full-sea buffer at 4 m per texel is
// 16x the fill. So the buffer is a WINDOW: 2048 m across at 512^2, 4 m a texel, centred on
// the camera and stepped along in whole texels as the camera moves. Each frame reads the
// previous frame at the same WORLD position (shifted by the step and by the wind drift),
// texels that just entered the window start from zero, then decays and injects.
//
// The injection is the SAME breaking criterion the water shader uses, evaluated in world
// space with the same noise, the same octaves, the same uniforms by reference — so the
// accumulated foam lands exactly where the instantaneous whitecaps do and then outlives them.
const SIZE = 2048;      // metres across the window
const RES = 512;        // texels -> 4 m/texel
const TEXEL = SIZE / RES;
const TAU = 6.5;        // seconds for a whitecap to fade to 1/e
const DRIFT = 1.1;      // m/s the foam field drifts downwind (surface current + spread)

// the water's own noise and octave functions, copied rather than shared so this file cannot
// drift the water shader by accident (they are short; keep them identical)
const NOISE_GLSL = /* glsl */`
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
vec2 waveOctave(vec2 q, float freq, float across, float ang, float speed, float amp) {
  vec2 w = normalize(uWind);
  float c = cos(ang), s = sin(ang);
  vec2 wr = vec2(w.x * c - w.y * s, w.x * s + w.y * c);
  vec2 tr = vec2(-wr.y, wr.x);
  vec2 p = vec2(dot(q, wr), dot(q, tr) * across) * freq + vec2(uTime * speed, 0.0);
  vec2 g = pgrad(p);
  return (wr * g.x + tr * g.y) * amp;
}
float waveHeightOct(vec2 q, float freq, float across, float ang, float speed) {
  vec2 w = normalize(uWind);
  float c = cos(ang), s = sin(ang);
  vec2 wr = vec2(w.x * c - w.y * s, w.x * s + w.y * c);
  vec2 tr = vec2(-wr.y, wr.x);
  vec2 p = vec2(dot(q, wr), dot(q, tr) * across) * freq + vec2(uTime * speed, 0.0);
  return pnoise(p);
}`;

const FRAG = /* glsl */`
uniform sampler2D uPrev;
uniform vec2 uOrigin;      // world xz of this frame's window corner (texel-aligned)
uniform vec2 uShift;       // uv shift to read the previous frame at the same world point
uniform float uDecay;      // per-frame retention
uniform float uInject;     // per-frame injection gain
uniform vec2 uWind;
uniform float uTime;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  // previous foam at this world position: shifted by the window step and the wind drift;
  // anything that was outside last frame's window starts from nothing
  vec2 puv = vUv + uShift;
  float prev = 0.0;
  if (all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)))) prev = texture2D(uPrev, puv).r;
  // the injection: the water shader's breaking criterion, verbatim, at full amplitude (no
  // view-distance fades here — the buffer is the truth, the shader fades what it shows)
  vec2 q = uOrigin + vUv * ${SIZE.toFixed(1)};
  vec2 g2 = waveOctave(q, 0.040,  0.55, -0.31,  0.10,  1.09);
  vec2 g3 = waveOctave(q, 0.0098, 0.75,  0.14,  0.030, 0.92);
  vec2 gBig = g3 + g2 * 0.6;
  float steepMag = length(gBig);
  float hBig = waveHeightOct(q, 0.0098, 0.75, 0.14, 0.030)
             + waveHeightOct(q, 0.040,  0.55, -0.31, 0.10) * 0.6;
  vec2 wDir = normalize(uWind);
  float face = clamp(-dot(gBig / max(steepMag, 1e-4), wDir), 0.0, 1.0);
  float crest = smoothstep(0.02, 0.34, hBig);
  float steep = smoothstep(0.13, 0.30, steepMag);
  float breaking = steep * crest * (0.30 + 0.70 * face);
  float f = prev * uDecay + breaking * uInject;
  gl_FragColor = vec4(clamp(f, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

export function createFoamAccum(waterUniforms) {
  const mk = () => {
    const rt = new THREE.WebGLRenderTarget(RES, RES, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    return rt;
  };
  let read = mk(), write = mk();
  const uniforms = {
    uPrev: { value: read.texture },
    uOrigin: { value: new THREE.Vector2() },
    uShift: { value: new THREE.Vector2() },
    uDecay: { value: 1 },
    uInject: { value: 0 },
    uWind: waterUniforms.uWind,     // by reference: the sea and the buffer agree on the wind
    uTime: waterUniforms.uTime,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // what the water shader reads: the live texture, the window origin and size
  const out = {
    uFoamTex: { value: read.texture },
    uFoamOrigin: { value: new THREE.Vector2() },
    uFoamSize: { value: SIZE },
  };

  const origin = new THREE.Vector2(NaN, NaN);
  let lastT = -1;
  const _w = new THREE.Vector2();

  // Called once per frame BEFORE the main render, with the renderer (the water module never
  // sees one). Steps the window to the camera, then integrates one frame.
  // dtOverride: a fixed step for offline simulation/testing (the game passes nothing and
  // integrates on wall-clock, capped so a stalled tab does not dump seconds into one frame)
  function step(renderer, camera, dtOverride) {
    const now = performance.now() * 0.001;
    const dt = dtOverride != null ? dtOverride : (lastT < 0 ? 1 / 60 : Math.min(0.1, now - lastT));
    lastT = now;
    // window corner, snapped to whole texels so a step is an exact texel shift
    const ox = Math.floor((camera.position.x - SIZE * 0.5) / TEXEL) * TEXEL;
    const oz = Math.floor((camera.position.z - SIZE * 0.5) / TEXEL) * TEXEL;
    if (Number.isNaN(origin.x)) origin.set(ox, oz);
    // uv shift: previous frame's texel for this world point = this uv + (newOrigin - oldOrigin)/SIZE,
    // plus the wind drift (the foam field moves downwind, so read slightly UPWIND of here)
    _w.copy(waterUniforms.uWind.value).normalize().multiplyScalar(DRIFT * dt);
    uniforms.uShift.value.set((ox - origin.x - _w.x) / SIZE, (oz - origin.y - _w.y) / SIZE);
    origin.set(ox, oz);
    uniforms.uOrigin.value.copy(origin);
    uniforms.uDecay.value = Math.exp(-dt / TAU);
    uniforms.uInject.value = dt * 2.2;
    uniforms.uPrev.value = read.texture;

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled; renderer.xr.enabled = false;
    renderer.setRenderTarget(write);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;

    const t = read; read = write; write = t;
    out.uFoamTex.value = read.texture;
    out.uFoamOrigin.value.copy(origin);
  }

  return { step, uniforms: out, targets: () => ({ read, write }), SIZE, RES };
}
