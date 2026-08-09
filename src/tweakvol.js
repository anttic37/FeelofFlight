// Live tuning panel for the TAKRAM clouds. Press P. Shell and persistence live in panel.js.
//
// WHAT IS LIVE HERE WAS MEASURED, NOT ASSUMED, because the answer is not obvious from the
// library's surface: the per-layer fields look like plain properties on plain objects, and
// the shader reads vec4s. They connect because updateSharedUniforms repacks every layer field
// into those vec4s on EVERY frame, and the clouds pass shares those exact uniform objects by
// reference. So writing layer.densityScale from a slider does reach the shader with no
// rebuild, no dirty flag, and no rebake — same immediacy the skyclouds panel has.
//
// Verified by perturbing each field and differencing frames against a 0.04 noise floor: every
// layer field, every march parameter and every lighting accessor moved the image. Worth
// recording HOW that check went wrong first, because it read as a flat "nothing is live":
// the probe camera was pointed at a patch of empty sky, so zeroing all four layer densities
// changed the frame by 0.54 and every per-layer test came back at the noise floor. Nothing
// was broken — there was simply no cloud in frame to remove. Any measurement here has to
// start by confirming there is cloud in the shot.
//
// The two genuinely slow controls are cloud size, which rebakes a 4096-square weather map,
// and resolution, which reallocates the render targets. Both run on mouse-up.

const STORE = 'flighfeel-tweak-vol-v1';

import { createPanel } from './panel.js';

export function initVolTweakPanel({ vc, applyResize }) {
  const C = vc.clouds;               // CloudsEffect
  const M = C.clouds;                // the primary raymarch parameters
  const L = C.cloudLayers;           // four layers, packed into vec4 uniforms each frame
  const defaults = {
    layers: L.map(l => ({
      altitude: l.altitude, height: l.height, densityScale: l.densityScale,
      weatherExponent: l.weatherExponent, shapeAlteringBias: l.shapeAlteringBias,
      coverageFilterWidth: l.coverageFilterWidth,
      shapeAmount: l.shapeAmount, shapeDetailAmount: l.shapeDetailAmount,
    })),
  };
  let repeat = vc.WEATHER_REPEAT;
  let boost = vc.LUMINANCE_BOOST;

  const { head, slider, toggle, note, finish } = createPanel({
    store: STORE,
    footer: 'P closes. Cloud size and resolution apply on release — everything else is live.',
  });

  const m = v => v.toFixed(0) + ' m';
  const km = v => (v / 1000).toFixed(1) + ' km';

  head('sky');
  // The one global lever, and it hits every layer at once — including the cirrus veil, whose
  // threshold is tuned to sit just the right side of zero. Push this up without pulling the
  // veil's own filter width down and the upper sky turns to fizzy overcast.
  slider('sky', 'coverage', () => C.coverage, v => C.coverage = v, 0, 0.6, 0.005,
    v => v.toFixed(3));
  // CLOUD WIDTH, and the only control over it. Height is a layer field, but width comes from
  // the size of the blobs in the weather map — which is the tile size, and the tile is baked.
  // Smaller repeat = bigger tile in world terms = bigger clouds. The island cap is baked into
  // that same map at a fixed UV, so the offset has to be re-pinned with it; setWeatherRepeat
  // does both. Roughly 8 ms, hence mouse-up only.
  slider('sky', 'cloud size', () => repeat, v => repeat = v, 30, 200, 5,
    v => (40000 / v).toFixed(0) + ' m', { commit: v => { repeat = vc.setWeatherRepeat(v); } });
  // THIS DROVE localWeatherVelocity UNTIL NOW, AND THAT WAS A ONE-WAY TRIP. That property
  // translates the whole sampled weather texture (updateSharedUniforms accumulates it into
  // localWeatherOffset every frame, and sampleWeather adds the offset to the uv) — and the
  // island cap is baked INTO that texture at a fixed uv, so what the slider actually moved
  // was the cap, sliding the cloud field off the island at 2 m/s per step and 100 m/s at the
  // end of the travel. Nothing about the image says the mask is the thing moving. Worse, it
  // could not be undone: the only two writes to localWeatherOffset in the project are the two
  // pin sites in volclouds.js, so returning the slider to 0 stopped the drift but left the cap
  // wherever it had walked to for the rest of the session, and panel.js persists any row that
  // differs from its code default, so one drag came back every boot. (Rebaking via cloud size
  // re-pins it — that was the only repair.) volclouds.js pins localWeatherVelocity to (0,0)
  // for precisely this reason and moves shapeVelocity instead, so the slider now drives that:
  // the noise churns THROUGH the field, lobes boil, footprints stay put. Units are shape
  // texture periods, so 0.0022 is about 1.5 m/s of internal motion; the y/z ratios reproduce
  // the shipped (0.0022, 0.0009, 0.0016), and 0.0002 divides 0.0022 exactly so merely touching
  // the control cannot quantise the code default away (see the sun size note below).
  // RENAMED FROM 'wind' DELIBERATELY, and the rename is the migration. panel.js persists a
  // diff keyed by section|label with no version, so keeping the old label would have fed a
  // saved localWeatherVelocity value — a number from a +/-0.001 range that meant something
  // else entirely — straight into shapeVelocity, whose default is 0.0022. Anyone with the
  // panel's settings saved would have come back to clouds churning about four times too
  // slowly, or backwards, with nothing on screen to say why. A new label is a new key: the
  // stale entry is simply never looked up, and 'churn' is what the control now does anyway.
  slider('sky', 'churn', () => C.shapeVelocity.x,
    v => C.shapeVelocity.set(v, v * 0.41, v * 0.73), 0, 0.02, 0.0002,
    v => v.toFixed(4));
  slider('sky', 'turbulence', () => C.turbulenceDisplacement,
    v => C.turbulenceDisplacement = v, 0, 500, 5, v => v.toFixed(0));
  note('turbulence frays cloud edges — 120 frayed, 350 sprayed, hence 0');

  head('lighting');
  // THE BIGGEST LOOK LEVER IN THE MODULE. The library emits physical luminance against an
  // exposure near 10; this scene is authored for 1.15, so the atmosphere's sun and sky
  // radiance get scaled to meet it. Too high and the whole cloud sits in the compressed
  // shoulder of the ACES curve, where a sunlit top and a shaded base land on the same white:
  // measured tonal range within cloud pixels was 15.6 at boost 8, 34.1 at 4, 46.3 at 2.
  // The MIDDAY value. daynight scales it down through dusk and hard down for moonlight, so
  // this is a reference rather than the number actually in the uniform right now — which is
  // also why it has its own setter: sharing one with daynight means daynight, writing every
  // frame, always wins and the slider appears not to work.
  slider('light', 'exposure bridge', () => boost, v => { boost = v; vc.setDayLuminance(v); },
    1, 12, 0.1);
  slider('light', 'scattering', () => C.scatteringCoefficient,
    v => C.scatteringCoefficient = v, 0, 3, 0.02);
  slider('light', 'absorption', () => C.absorptionCoefficient,
    v => C.absorptionCoefficient = v, 0, 0.5, 0.005, v => v.toFixed(3));
  // Two Henyey-Greenstein lobes mixed: 1 is the forward lobe that makes a cloud glow when
  // you fly toward the sun, 2 the backward one. The mix is how much of each.
  slider('light', 'forward lobe', () => C.scatterAnisotropy1,
    v => C.scatterAnisotropy1 = v, 0, 0.99, 0.01);
  slider('light', 'back lobe', () => C.scatterAnisotropy2,
    v => C.scatterAnisotropy2 = v, -0.99, 0.5, 0.01);
  slider('light', 'lobe mix', () => C.scatterAnisotropyMix,
    v => C.scatterAnisotropyMix = v, 0, 1, 0.01);
  slider('light', 'sky fill', () => C.skyLightScale, v => C.skyLightScale = v, 0, 3, 0.02);
  slider('light', 'ground bounce', () => C.groundBounceScale,
    v => C.groundBounceScale = v, 0, 3, 0.02);
  // Powder is the dark-edge term: it is what stops a cloud reading as a flat cut-out when
  // lit from behind, and it is also what over-darkens thin wisps if pushed.
  slider('light', 'powder', () => C.powderScale, v => C.powderScale = v, 0, 2, 0.02);
  slider('light', 'powder falloff', () => C.powderExponent,
    v => C.powderExponent = v, 1, 300, 1, v => v.toFixed(0));
  // STEP MATTERS HERE more than the range does. The default is the real sun, 0.004675 rad,
  // and a range input snaps to its step grid the moment it is dragged — at step 0.001 that
  // is a 21% quantisation, so merely touching this control and putting it back loses the
  // physical value for good and persists the rounded one as a diff. Caught by finding it in
  // the store after a sweep that never meant to change it.
  slider('light', 'sun size', () => C.sunAngularRadius,
    v => C.sunAngularRadius = v, 0.001, 0.03, 0.000025, v => v.toFixed(5));
  slider('light', 'ms octaves', () => M.multiScatteringOctaves,
    v => M.multiScatteringOctaves = Math.round(v), 1, 12, 1, v => v.toFixed(0));

  head('quality', 'cost lives here — check the frame time after touching these');
  slider('quality', 'resolution', () => C.resolutionScale, v => C.resolutionScale = v,
    0.25, 1, 0.05, undefined, { commit: () => applyResize && applyResize() });
  slider('quality', 'max steps', () => M.maxIterationCount,
    v => M.maxIterationCount = Math.round(v), 50, 1000, 10, v => v.toFixed(0));
  slider('quality', 'min step', () => M.minStepSize, v => M.minStepSize = v, 10, 400, 5, m);
  slider('quality', 'max step', () => M.maxStepSize, v => M.maxStepSize = v, 20, 2000, 10, m);
  slider('quality', 'ray distance', () => M.maxRayDistance,
    v => M.maxRayDistance = v, 5000, 200000, 1000, km);
  // The secondary march toward the sun is what self-shadows a cloud, so this is the control
  // that decides whether bases go dark — a quality knob doing a lighting job.
  slider('quality', 'steps to sun', () => M.maxIterationCountToSun,
    v => M.maxIterationCountToSun = Math.round(v), 1, 16, 1, v => v.toFixed(0));
  slider('quality', 'sun step', () => M.minSecondaryStepSize,
    v => M.minSecondaryStepSize = v, 10, 300, 5, m);
  slider('quality', 'sun step grow', () => M.secondaryStepScale,
    v => M.secondaryStepScale = v, 1, 3, 0.05);
  toggle('quality', 'accurate phase', () => M.accuratePhaseFunction,
    v => M.accuratePhaseFunction = v);
  toggle('quality', 'light shafts', () => C.lightShafts, v => C.lightShafts = v);
  toggle('quality', 'shape detail', () => C.shapeDetail, v => C.shapeDetail = v);
  toggle('quality', 'turbulence on', () => C.turbulence, v => C.turbulence = v);
  toggle('quality', 'haze', () => C.haze, v => C.haze = v);

  // ONE SECTION PER LIVE LAYER, not per uniform slot. The library's uniforms are vec4 so
  // cloudLayers is always four long whatever is actually in use; iterating it directly puts a
  // full set of sliders on a slot held at zero density, which reads as a layer that has
  // stopped working rather than one that was deliberately dropped.
  const NAMES = vc.LAYER_NAMES || [];
  L.slice(0, NAMES.length).forEach((layer, i) => {
    const sec = 'L' + (i + 1);
    head(`${sec} ${NAMES[i] || ''}`);
    slider(sec, 'base', () => layer.altitude, v => layer.altitude = v, 0, 12000, 10, m);
    slider(sec, 'depth', () => layer.height, v => layer.height = v, 50, 4000, 10, m);
    slider(sec, 'density', () => layer.densityScale, v => layer.densityScale = v, 0, 1.5, 0.005,
      v => v.toFixed(3));
    // PER-LAYER COVERAGE, effectively. Rearranging the library's threshold, a layer produces
    // nothing unless weather^exponent > (1 - cfw - coverage*heightScale)/(1 - cfw) — so a
    // wider filter lowers that bar, each cell's above-bar region widens, and neighbours
    // merge. Unlike global coverage it leaves the other three layers alone. Peak density is
    // coverage*heightScale/cfw, so widening also THINS: put density back or it reads as less
    // cloud rather than more.
    slider(sec, 'cover width', () => layer.coverageFilterWidth,
      v => layer.coverageFilterWidth = v, 0, 1, 0.005, v => v.toFixed(3));
    // Separation vs size, on one control. High keeps only each blob's core, so clouds come
    // out discrete with sky between them; low lets neighbours merge into masses several times
    // the width. Past about 2.2 a layer keeps so little of the field that its survivors shrink
    // to a couple of weather texels and take the texel grid's shape — isolated rectangles.
    slider(sec, 'separation', () => layer.weatherExponent,
      v => layer.weatherExponent = v, 0.5, 5, 0.05);
    // shapeAlteringFunction is 1 - (2*hf^bias - 1)^2, peaking at hf = 0.5^(1/bias) — a tenth
    // of the way up at 0.3, a third at 0.62. That peak is where the coverage boost is
    // strongest, so a tall layer at 0.3 crams its width into the bottom tenth and tapers
    // above: a pancake with a spike rather than a tower. It has to rise with the depth.
    slider(sec, 'bulge height', () => layer.shapeAlteringBias,
      v => layer.shapeAlteringBias = v, 0.1, 1.5, 0.01);
    // How much of the 3D shape noise erodes the coverage volume. This is the only thing that
    // breaks the extruded-prism look, so 0 is worth trying once just to see what the
    // underlying shape actually is.
    slider(sec, 'shape', () => layer.shapeAmount, v => layer.shapeAmount = v, 0, 1, 0.01);
    slider(sec, 'shape detail', () => layer.shapeDetailAmount,
      v => layer.shapeDetailAmount = v, 0, 1, 0.01);
  });

  return finish({
    // cloud size rebakes the weather map, resolution reallocates targets — once each, after
    // every other restored value has landed
    slowLast: ['cloud size', 'resolution'],
    onCopy: () => ({
      coverage: C.coverage, weatherRepeat: repeat, luminanceBoost: boost,
      turbulenceDisplacement: C.turbulenceDisplacement,
      scatteringCoefficient: C.scatteringCoefficient,
      absorptionCoefficient: C.absorptionCoefficient,
      scatterAnisotropy1: C.scatterAnisotropy1, scatterAnisotropy2: C.scatterAnisotropy2,
      scatterAnisotropyMix: C.scatterAnisotropyMix,
      skyLightScale: C.skyLightScale, groundBounceScale: C.groundBounceScale,
      powderScale: C.powderScale, powderExponent: C.powderExponent,
      march: {
        maxIterationCount: M.maxIterationCount, minStepSize: M.minStepSize,
        maxStepSize: M.maxStepSize, maxRayDistance: M.maxRayDistance,
        maxIterationCountToSun: M.maxIterationCountToSun,
        minSecondaryStepSize: M.minSecondaryStepSize,
        secondaryStepScale: M.secondaryStepScale,
        multiScatteringOctaves: M.multiScatteringOctaves,
      },
      // live layers only — a copied set including the zeroed spare slot is just noise to
      // paste back into the source
      layers: L.slice(0, NAMES.length).map(l => ({
        altitude: l.altitude, height: l.height, densityScale: l.densityScale,
        weatherExponent: l.weatherExponent, shapeAlteringBias: l.shapeAlteringBias,
        coverageFilterWidth: l.coverageFilterWidth,
        shapeAmount: l.shapeAmount, shapeDetailAmount: l.shapeDetailAmount,
      })),
    }),
    onReset: () => {
      L.forEach((layer, i) => Object.assign(layer, defaults.layers[i]));
      repeat = vc.setWeatherRepeat(vc.WEATHER_REPEAT);
      boost = vc.setDayLuminance(vc.LUMINANCE_BOOST);
    },
  });
}
