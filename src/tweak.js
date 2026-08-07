// Live tuning panel for SKYCLOUDS, the hand-rolled raymarch. Press P.
//
// Every control here writes straight into skyclouds' params object, which the cloud pass
// reads afresh each frame — so there is nothing to apply, nothing to rebuild, and no
// rebake. That was not true of the old panel: half its sliders were baked into a weather
// texture and needed a regenerate, which made tuning by feel impossible.
//
// The shell, and the reasoning behind the diff-based persistence, is in panel.js.

// Key bumped to v2 deliberately: every existing v1 store holds a full 45-slider snapshot
// written by the old save(), including cloud lighting values that predate the shading fix.
// Those would keep overriding the new defaults forever, since a restored value never
// equals the code default and so never gets pruned. Abandoning the old key is the only
// way to hand existing browsers the new defaults; anything retuned from here persists
// normally.
const STORE = 'flighfeel-tweak-sky-v2';

import { createPanel } from './panel.js';

export function initTweakPanel({ sc, applyResize }) {
  const p = sc.params;
  const defaults = JSON.parse(JSON.stringify({ layers: p.layers, island: p.island }));
  const { head, slider, finish } = createPanel({
    store: STORE,
    footer: 'P closes. Everything here is live — no rebake.',
  });

  head('render');
  slider('render', 'cloud res', () => p.cloudRes,
    v => { sc.setCloudRes(v); applyResize && applyResize(); }, 0.2, 1, 0.05);
  slider('render', 'max distance', () => p.maxDist, v => p.maxDist = v, 8000, 90000, 1000,
    v => (v / 1000).toFixed(0) + ' km');
  slider('render', 'wind speed', () => p.windSpeed, v => p.windSpeed = v, 0, 12, 0.1);

  head('island cap', 'how far cloud reaches from the island');
  slider('island', 'radius', () => p.island.radius, v => p.island.radius = v, 0, 40000, 250,
    v => (v / 1000).toFixed(1) + ' km');
  slider('island', 'fade', () => p.island.fade, v => p.island.fade = v, 250, 40000, 250,
    v => (v / 1000).toFixed(1) + ' km');
  slider('island', 'edge warp', () => p.island.edgeWarp, v => p.island.edgeWarp = v, 0, 20000, 200,
    v => (v / 1000).toFixed(1) + ' km');
  slider('island', 'open sea', () => p.island.seaFloorDensity,
    v => p.island.seaFloorDensity = v, 0, 1, 0.01);
  slider('island', 'centre X', () => p.island.centerX, v => p.island.centerX = v, -20000, 20000, 100,
    v => v.toFixed(0));
  slider('island', 'centre Z', () => p.island.centerZ, v => p.island.centerZ = v, -20000, 20000, 100,
    v => v.toFixed(0));

  head('lighting');
  slider('light', 'sun boost', () => p.sunBoost, v => p.sunBoost = v, 0, 24, 0.1);
  slider('light', 'ambient', () => p.ambientBoost, v => p.ambientBoost = v, 0, 2, 0.01);
  slider('light', 'base darken', () => p.baseDarken, v => p.baseDarken = v, 0, 1, 0.01);
  slider('light', 'silver lining', () => p.silver, v => p.silver = v, 0, 6, 0.05);
  slider('light', 'absorption', () => p.absorption, v => p.absorption = v, 0.005, 0.3, 0.005,
    v => v.toFixed(3));
  // The one that actually decides how lit the clouds look: it sets the optical depth of
  // the sun ray, so it is what darkens bases without touching tops. Was missing from the
  // panel entirely while it sat 12x too low.
  slider('light', 'self-shadow', () => p.lightAbsorb, v => p.lightAbsorb = v, 0.002, 0.08, 0.001,
    v => v.toFixed(3));
  slider('light', 'ms fill', () => p.msFalloff, v => p.msFalloff = v, 0, 0.9, 0.01);
  slider('light', 'ms scatter', () => p.msScatter, v => p.msScatter = v, 0.1, 1, 0.01);
  // 1.0 = every scattering octave on the single-scattering lobe, i.e. the old behaviour.
  slider('light', 'ms phase', () => p.msPhase, v => p.msPhase = v, 0.1, 1, 0.01);
  slider('light', 'powder', () => p.powderMix, v => p.powderMix = v, 0, 1, 0.01);
  // How finely the march samples inside cloud. This is what decides whether any of the
  // detail above is resolved at all — at 600 the clouds go back to flat blobs.
  slider('light', 'step fine', () => p.stepFine, v => p.stepFine = v, 25, 600, 5);

  head('weather');
  // The scale of the CLUSTERING, not of a cloud — how far apart the busy and clear parts of
  // the map are. Per-layer response lives with each layer below.
  slider('weather', 'field size', () => p.weatherSize, v => p.weatherSize = v, 3000, 60000, 500,
    v => (v / 1000).toFixed(1) + ' km');

  p.layers.forEach((L, i) => {
    const sec = 'L' + (i + 1);
    head(`${sec} ${L.name}`);
    slider(sec, 'base', () => L.base, v => L.base = v, 0, 12000, 50, v => v.toFixed(0) + ' m');
    slider(sec, 'top', () => L.top, v => L.top = v, 0, 14000, 50, v => v.toFixed(0) + ' m');
    slider(sec, 'density', () => L.density, v => L.density = v, 0, 3, 0.01);
    slider(sec, 'coverage', () => L.coverage, v => L.coverage = v, 0, 1, 0.01);
    slider(sec, 'cloud size', () => L.featureSize, v => L.featureSize = v, 600, 40000, 100,
      v => (v / 1000).toFixed(1) + ' km');
    slider(sec, 'detail size', () => L.detailSize, v => L.detailSize = v, 80, 6000, 20,
      v => v.toFixed(0) + ' m');
    // 0..1 was the range for the old one-sided term, where anything near 1 dissolved the
    // layer. Centred, it carves and fills, so useful values run well past 2 — the veil was
    // tuned hard against the 4 ceiling, so there is room to 8 now.
    slider(sec, 'detail', () => L.detailStrength, v => L.detailStrength = v, 0, 8, 0.02);
    slider(sec, 'billow', () => L.worleyMix, v => L.worleyMix = v, 0, 1, 0.01);
    slider(sec, 'flat base', () => L.flatBase, v => L.flatBase = v, 0, 1, 0.01);
    // How hard this layer follows the weather field: 0 is the old uniform sky.
    slider(sec, 'weather', () => L.weatherAmount, v => L.weatherAmount = v, 0, 1.4, 0.01);
    // Second shape octave. Only earns its texture fetch on layers whose cloud size stretches
    // the 64-texel shape field coarse enough to threshold into holes — past roughly 12 km.
    slider(sec, 'shape octave', () => L.shapeOctave, v => L.shapeOctave = v, 0, 1.5, 0.01);
  });

  return finish({
    slowLast: ['cloud res'],   // reallocates the buffer
    onCopy: () => ({ layers: p.layers, island: p.island,
      absorption: p.absorption, lightAbsorb: p.lightAbsorb, baseDarken: p.baseDarken,
      silver: p.silver, sunBoost: p.sunBoost, ambientBoost: p.ambientBoost,
      msFalloff: p.msFalloff, msScatter: p.msScatter, powderMix: p.powderMix,
      maxDist: p.maxDist, windSpeed: p.windSpeed, cloudRes: p.cloudRes }),
    onReset: () => {
      p.layers.forEach((L, i) => Object.assign(L, defaults.layers[i]));
      Object.assign(p.island, defaults.island);
    },
  });
}
