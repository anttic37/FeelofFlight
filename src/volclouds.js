import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { CloudsEffect, CloudShape, CloudShapeDetail, LocalWeather, Turbulence } from '@takram/three-clouds';
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, DEFAULT_PRECOMPUTED_TEXTURES_URL } from '@takram/three-atmosphere';
import { STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial';

// The sky. Volumetric clouds via @takram/three-clouds — the same thing the
// three.js 3d-tiles example uses: a raymarched density field with shape and
// detail noise, a weather map, and temporal upscaling driven by blue noise.
// These replaced the old sprite cumulus outright, so this module owns the
// post-processing chain whenever it loads (?vclouds=0 falls back to plain).
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

  // SIZE VARIATION. The default localWeatherRepeat of 100 tiles the weather
  // texture 100x around the globe, so one tile spans ~400 km while our island is
  // a few km across — we only ever sample a near-uniform scrap of it and every
  // cloud comes out the same size. 250 brings the blobs down to something like
  // real cumulus spacing. Much higher and the coverage field averages out into
  // permanent overcast, plus the raymarch starts aliasing.
  clouds.coverage = 0.28;
  clouds.localWeatherRepeat.set(250, 250);
  clouds.localWeatherVelocity.set(0.00008, 0);
  clouds.turbulenceDisplacement = 120; // 350 frays the edges into spray

  // RAYMARCH RANGE — this is what makes the distant clouds hold together.
  // The stock march is sized for a geospatial viewer looking at weather 100+ km
  // away across the globe: steps start at 50 m and grow 1% each one up to
  // 1000 m, out to 200 km. Our camera's far plane is 12 km. So everything past
  // a few km was being crossed in strides far larger than a cloud layer is
  // deep, and distant clouds came out combed into regular vertical ribs — the
  // ribs fan with perspective because they are fixed-size gaps in world space,
  // which is what gave the sampling away. Holding the step constant over a ray
  // that stops near the far plane samples the whole visible range evenly.
  //
  // It costs nothing (measured p50 5.3 ms either way): rays terminate on
  // transmittance as soon as they are inside cloud, and empty sky is cheap at
  // any step size, so the long strides were only ever saving work nobody
  // needed. The artifact was invisible before only because the clouds were too
  // small and far to show it.
  clouds.clouds.minStepSize = 50;
  clouds.clouds.maxStepSize = 120;
  clouds.clouds.maxRayDistance = 15000;
  clouds.clouds.perspectiveStepScale = 1.0;

  // The secondary march toward the sun is what self-shadows a cloud. Two
  // iterations at 100 m is enough for cloudscapes viewed from far away and too
  // coarse from inside one, where it banded the nearer masses.
  clouds.clouds.maxIterationCountToSun = 6;
  clouds.clouds.minSecondaryStepSize = 40;
  clouds.clouds.secondaryStepScale = 1.6;

  // 512 across three cascades put visible steps in the cloud self-shadowing at
  // this range. The cascade split planes were showing up as flat vertical faces
  // slicing through the nearer clouds.
  clouds.shadow.mapSize.set(2048, 2048);

  // Four layers, used as size classes. Only three weather channels carry a
  // distribution — measured over the generated texture: r is sparse blobs (mean
  // 0.27), g sparser (0.16), b a smooth full-range bell (0.50). The a channel is
  // a constant 1.0, NOT a distribution: point a layer at it and you get
  // permanent overcast. weatherExponent thins a channel out, but note that
  // thinning the smooth b field yields FEWER, LARGER slabs rather than small
  // puffs, so b is only good for the high veil.
  //
  // The convective classes share ONE base altitude, because they should: in a
  // real cumulus field every cloud condenses at the same lifting condensation
  // level and they differ only in how far they climb. That is what makes the
  // bases line up flat while the tops vary — and it is where the size range
  // comes from. Two of them ride the same r channel on purpose: the strongest
  // cells of a field are exactly the ones that build deepest.
  //
  // Keep the depths within reach of the blob widths. A weather blob is a few km
  // across but often ribbon-shaped, and extruding a ribbon far enough vertically
  // stops reading as a cloud and starts reading as a curtain — 1700 m tall was
  // well over the line. Tops here run 1000/1320/1620 m off a 620 m base, which
  // is a visible spread without any of them turning into a wall.
  const LAYERS = [
    // the general population — small to medium
    { channel: 'r', altitude: 620, height: 380, densityScale: 0.40,
      weatherExponent: 1.0, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: true },
    // the strongest cells of that same field, climbing further
    { channel: 'r', altitude: 620, height: 700, densityScale: 0.46,
      weatherExponent: 2.2, shapeAlteringBias: 0.3, coverageFilterWidth: 0.35, shadow: true,
      profile: [0, 0, -0.6, 1.0] },
    // a decorrelated set of big ones. The stock density profile ramps UP with
    // height (0.25 + 0.75h), so density peaks exactly where the layer ceiling
    // cuts it off — that gives every cloud a flat sliced top, and on a deep
    // layer it turns marginal cells into thin vertical spikes, a sky full of
    // spray plumes. Tapering the other way keeps the mass low, so only strong
    // cores climb and the tops end where the cloud ends.
    { channel: 'g', altitude: 620, height: 1000, densityScale: 0.5,
      weatherExponent: 1.6, shapeAlteringBias: 0.3, coverageFilterWidth: 0.3, shadow: true,
      profile: [0, 0, -0.7, 1.0] },
    // thin high veil, for something to fly under and to give the sky depth
    { channel: 'b', altitude: 4200, height: 600, densityScale: 0.16,
      weatherExponent: 3.5, shapeAlteringBias: 0.3, coverageFilterWidth: 0.7, shadow: false,
      shapeDetailAmount: 0.5 },
  ];
  for (let i = 0; i < clouds.cloudLayers.length; i++) {
    const layer = clouds.cloudLayers[i], spec = LAYERS[i];
    if (!spec) { layer.densityScale = 0; continue; }
    const { profile, ...fields } = spec;
    Object.assign(layer, fields);
    if (profile) layer.densityProfile.set(...profile);
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
