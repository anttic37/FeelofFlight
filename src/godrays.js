import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

// GOD RAYS (crepuscular rays), screen space.
//
// WHY NOT THE PHYSICAL ONES. The takram clouds already march a shadow-length buffer and feed
// it into Bruneton's inscatter, which is the physically correct crepuscular term — and it is
// ON, and it was measured: toward a 10 degree sun, toggling it changed 0.35% of the frame.
// Over the few kilometres of air this island puts between you and the sun there is simply
// not enough inscattered light to carve visible shafts out of. Physically right, visually
// absent. Golden hour wants the shafts, so this fakes them the way every game does.
//
// The classic radial march: from each pixel, step toward the sun's screen position through
// an OCCLUSION mask and add up how much of the path was open sky. The mask is where this one
// earns its keep — the clouds are a post-process and never touch the depth buffer, so a stock
// god-rays effect sees straight through them. The cloud effect publishes its overlay buffer
// (colour + coverage alpha, the same texture the aerial pass composites), so occlusion is
// cloud alpha OR anything in the depth buffer (terrain, water, the aeroplane). Shafts then
// fan out between clouds and over ridgelines, which is where they belong.
//
// Strength rides the sun's altitude: full at golden hour, a whisper at noon, gone once the
// sun is below the horizon (the moon casts no shafts worth drawing). ?godrays=0 turns it off,
// and uStrength is the runtime A/B.
const FRAG = /* glsl */`
uniform sampler2D uOverlay;
uniform float uHasOverlay;
uniform vec2 uSunPos;       // sun in screen uv
uniform float uSunVis;      // 0..1: sun up and roughly in front of the camera
uniform float uStrength;
uniform vec3 uTint;
uniform float uAspect;

// how much of the sun this sample blocks: terrain/water/plane from depth, clouds from the
// overlay's coverage alpha. Sky is 0.
float ffOcc(vec2 p) {
  float d = readDepth(p);
  float solid = step(d, 0.9999);
  float cloud = uHasOverlay > 0.5 ? texture2D(uOverlay, p).a : 0.0;
  return max(solid, cloud);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (uStrength <= 0.0 || uSunVis <= 0.0) return;
  // the source: light lives where the sun's own pixel is open, then leaks along the ray
  vec2 toSun = uSunPos - uv;
  // aspect-correct the distance so the falloff is round on screen
  float dist = length(toSun * vec2(uAspect, 1.0));
  // rays reach a little under half a screen-height out from the sun, then die; the falloff
  // is steep so the open-sky halo stays a glow and the shafts carry the shape
  float reach = 1.0 - smoothstep(0.04, 0.46, dist);
  if (reach <= 0.0) return;
  reach *= reach;
  const int N = 40;
  vec2 stepv = toSun / float(N);
  float light = 0.0, wsum = 0.0;
  float w = 1.0;
  // per-pixel jitter breaks the banding of a 40-tap march into grain, which bloom then eats
  float j = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 p = uv + stepv * j;
  for (int i = 0; i < N; i++) {
    p += stepv;
    light += (1.0 - ffOcc(p)) * w;
    wsum += w;
    w *= 0.955;
  }
  light /= wsum;
  // a pixel that is itself solid still gets rays across it — shafts land on terrain — but
  // a little less, so the effect reads as light in the AIR in front of the hill
  float onSolid = step(depth, 0.9999);
  float amount = light * reach * uSunVis * uStrength * mix(1.0, 0.45, onSolid);
  outputColor.rgb = inputColor.rgb + uTint * amount;
}`;

export function createGodRays() {
  const uniforms = new Map([
    ['uOverlay', new THREE.Uniform(null)],
    ['uHasOverlay', new THREE.Uniform(0)],
    ['uSunPos', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
    ['uSunVis', new THREE.Uniform(0)],
    ['uStrength', new THREE.Uniform(0)],
    ['uTint', new THREE.Uniform(new THREE.Vector3(1.0, 0.86, 0.66))],
    ['uAspect', new THREE.Uniform(16 / 9)],
  ]);
  const effect = new Effect('ffGodRays', FRAG, {
    attributes: EffectAttribute.DEPTH,
    blendFunction: BlendFunction.NORMAL,   // the add is done in the shader against inputColor
    uniforms,
  });
  const enabled = new URLSearchParams(location.search).get('godrays') !== '0';
  // the authored strength curve; tune.strength scales it for the panel / A/B
  // 0.30, not more: the additive term reaches +1 per channel where the whole path is open
  // sky, so anything near 1.0 blows the sun's neighbourhood out to white (measured — 67% of
  // the frame changed at 0.85). This keeps the open-sky halo a warm glow and lets the
  // shafts, which are the DIFFERENCES the occluders cut into it, carry the effect.
  const tune = { strength: 0.30 };
  const _p = new THREE.Vector3(), _fwd = new THREE.Vector3();

  // sunDir: world-space unit vector toward the sun (ATMO's live SUN_DIR). overlayTex: the
  // cloud effect's atmosphereOverlay.map, which can be re-created when the clouds re-link.
  function update(sunDir, camera, overlayTex) {
    if (!enabled) { uniforms.get('uStrength').value = 0; return; }
    uniforms.get('uOverlay').value = overlayTex || null;
    uniforms.get('uHasOverlay').value = overlayTex ? 1 : 0;
    uniforms.get('uAspect').value = camera.aspect;
    // sun's screen position: a point far along the sun direction, projected
    // "behind" is tested against the camera's forward vector, NOT the projected z: a point
    // placed far out along the sun sits past the far plane, so its NDC z is > 1 even when
    // the sun is dead ahead, and that reads as behind. The projected x/y stay valid.
    _p.copy(camera.position).addScaledVector(sunDir, 1e5).project(camera);
    camera.getWorldDirection(_fwd);
    const behind = _fwd.dot(sunDir) <= 0.0;
    uniforms.get('uSunPos').value.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    // visible when up and in front; fade in over the first degrees above the horizon and
    // out again as the sun leaves the screen (rays from an off-screen sun still enter the
    // frame, so this fades over a margin outside it rather than at the edge)
    const up = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.10);
    const ox = Math.max(0, Math.abs(_p.x) - 1), oy = Math.max(0, Math.abs(_p.y) - 1);
    const onScreen = behind ? 0 : 1 - THREE.MathUtils.smoothstep(Math.max(ox, oy), 0.6, 1.4);
    uniforms.get('uSunVis').value = up * onScreen;
    // full at golden hour, a whisper at noon
    const lowSun = 1 - THREE.MathUtils.smoothstep(sunDir.y, 0.12, 0.55);
    uniforms.get('uStrength').value = tune.strength * (0.18 + 0.82 * lowSun);
  }

  return { effect, update, tune, uniforms };
}
