import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { CloudsEffect, CloudShape, CloudShapeDetail, LocalWeather, Turbulence } from '@takram/three-clouds';
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, DEFAULT_PRECOMPUTED_TEXTURES_URL } from '@takram/three-atmosphere';
import { STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial';

// SPIKE — volumetric clouds via @takram/three-clouds, behind ?vclouds=1.
// This is the real thing from the three.js 3d-tiles example: a raymarched
// density field with shape and detail noise, a weather map, and temporal
// upscaling driven by blue noise. It replaces our geometry clouds and takes
// over the post-processing chain, so it stays flag-gated until we decide.
//
// The one genuinely awkward part is that the library is GEOSPATIAL: it works
// on a WGS84 ellipsoid in ECEF coordinates, where "up" is away from Earth's
// centre and cloud altitudes are metres above sea level. Our world is a small
// flat y-up scene. The bridge is worldToECEFMatrix — we declare that our
// origin sits on the equator at sea level and hand it the axis mapping, after
// which its altitudes line up with ours one-for-one.

const EARTH_R = 6378137;

// our world: +X east, +Y up, -Z north (so +Z is south)
// ECEF at lat 0 lon 0: +X is up through the surface, +Y east, +Z north
function worldToECEF() {
  return new THREE.Matrix4().set(
    0, 1, 0, EARTH_R,   // world X (east)  -> ECEF Y
    1, 0, 0, 0,         // world Y (up)    -> ECEF X
    0, 0, -1, 0,        // world Z (south) -> ECEF -Z
    0, 0, 0, 1,
  );
}

export async function createVolumetricClouds({ renderer, scene, camera, sunDir }) {
  // Atmosphere lookup tables. The generator computes these on the GPU but
  // drives itself across animation frames, so the loader is both simpler and
  // faster here (~1.3 s from CDN) and needs no frame pump.
  const textures = await new Promise((resolve, reject) => {
    new PrecomputedTexturesLoader().load(DEFAULT_PRECOMPUTED_TEXTURES_URL, resolve, undefined, reject);
  });

  const clouds = new CloudsEffect(camera);
  clouds.transmittanceTexture = textures.transmittanceTexture;
  clouds.irradianceTexture = textures.irradianceTexture;
  clouds.scatteringTexture = textures.scatteringTexture;
  clouds.higherOrderScatteringTexture = textures.higherOrderScatteringTexture;
  if (textures.singleMieScatteringTexture) clouds.singleMieScatteringTexture = textures.singleMieScatteringTexture;

  // Shape, detail, weather and turbulence are all generated on the GPU rather
  // than downloaded — the package ships procedural versions, which suits a
  // project that has no asset pipeline at all.
  const procedural = [];
  const shape = new CloudShape(); shape.render(renderer, 0); clouds.shapeTexture = shape.texture; procedural.push(shape);
  const detail = new CloudShapeDetail(); detail.render(renderer, 0); clouds.shapeDetailTexture = detail.texture; procedural.push(detail);
  const weather = new LocalWeather(); weather.render(renderer, 0); clouds.localWeatherTexture = weather.texture; procedural.push(weather);
  const turb = new Turbulence(); turb.render(renderer, 0); clouds.turbulenceTexture = turb.texture; procedural.push(turb);

  // Blue noise drives the temporal sampling. Non-fatal if it fails to load —
  // the clouds just get noisier — so it must not block startup.
  const stbnTargets = [clouds];
  new STBNLoader().load(DEFAULT_STBN_URL, (t) => { for (const o of stbnTargets) o.stbnTexture = t; }, undefined, () => {});

  const w2e = worldToECEF();
  clouds.worldToECEFMatrix.copy(w2e);
  clouds.ecefToWorldMatrix.copy(w2e).invert();
  clouds.sunDirection.copy(sunDir).transformDirection(w2e).normalize();

  // Our cumulus live at ~620 m with a few hundred metres of depth; the library
  // defaults are tuned for a much deeper sky.
  clouds.coverage = 0.32;
  clouds.localWeatherVelocity.set(0.00008, 0);
  if (clouds.cloudLayers && clouds.cloudLayers.length) {
    const l0 = clouds.cloudLayers[0];
    l0.altitude = 620; l0.height = 420; l0.densityScale = 0.25;
    for (let i = 1; i < clouds.cloudLayers.length; i++) clouds.cloudLayers[i].densityScale = 0;
  }

  // CloudsEffect only RENDERS the cloud buffer — it hands the result to an
  // AerialPerspectiveEffect to composite, via atmosphereOverlay/Shadow. On its
  // own it sets a SKIP_RENDERING define and draws nothing, which is exactly
  // what we saw: a scene with no clouds in it. They must share one EffectPass,
  // clouds first.
  // Deferred sun/sky lighting is left OFF: it needs a normal G-buffer pass and
  // would replace the scene's own lighting, which is a far bigger change than
  // this spike is meant to test.
  const aerial = new AerialPerspectiveEffect(camera);
  aerial.sky = true;
  aerial.sunLight = false;
  aerial.skyLight = false;
  aerial.transmittanceTexture = textures.transmittanceTexture;
  aerial.irradianceTexture = textures.irradianceTexture;
  aerial.scatteringTexture = textures.scatteringTexture;
  aerial.higherOrderScatteringTexture = textures.higherOrderScatteringTexture;
  if (textures.singleMieScatteringTexture) aerial.singleMieScatteringTexture = textures.singleMieScatteringTexture;
  // read-only getters onto its uniform values: copy INTO them. (And there is no
  // ecefToWorldMatrix here — that one exists only on CloudsEffect.)
  aerial.worldToECEFMatrix.copy(w2e);
  aerial.sunDirection.copy(clouds.sunDirection);
  stbnTargets.push(aerial);

  // EXPOSURE BRIDGE — this is what makes the whole thing usable.
  // The library emits physical luminance and its own examples run the renderer
  // at an exposure near 10; this scene is hand-authored for 1.15. Raising the
  // global exposure is a dead end, because it lifts the terrain too and the
  // island blows out to white. But these two constants scale the atmosphere's
  // sun and sky radiance ONLY, and nothing in our scene is lit by them — our
  // materials use their own lights. So the clouds can be brought up to meet the
  // terrain instead of dragging the terrain up to meet them.
  // 8 is the balance point: below it distant clouds stay pink-grey, above it
  // the aerial inscatter scales too and the landscape starts hazing over.
  const LUMINANCE_BOOST = 8;
  for (const key of ['SUN_SPECTRAL_RADIANCE_TO_LUMINANCE', 'SKY_SPECTRAL_RADIANCE_TO_LUMINANCE']) {
    const u = aerial.uniforms.get(key);
    if (u) u.value.multiplyScalar(LUMINANCE_BOOST);
  }

  // THE LINK. CloudsEffect renders the cloud buffer and announces it by
  // dispatching change events carrying atmosphereOverlay / atmosphereShadow;
  // AerialPerspectiveEffect is what actually composites them. Nothing connects
  // the two automatically, so without this the clouds render every frame into a
  // buffer nobody reads, the effect raises its SKIP_RENDERING define, and the
  // sky comes out empty — which is exactly the symptom that cost the most time
  // here.
  const link = () => {
    aerial.overlay = clouds.atmosphereOverlay;
    aerial.shadow = clouds.atmosphereShadow;
    aerial.shadowLength = clouds.atmosphereShadowLength;
  };
  clouds.events.addEventListener('change', (e) => {
    if (e.property === 'atmosphereOverlay' || e.property === 'atmosphereShadow'
      || e.property === 'atmosphereShadowLength') link();
  });
  link();

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));
  composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

  window.__vc = { clouds, aerial, composer, textures }; // tuning handle, same idea as __ff

  return {
    clouds,
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => { procedural.forEach(p => p.dispose && p.dispose()); composer.dispose(); },
  };
}
