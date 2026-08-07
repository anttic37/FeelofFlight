import * as THREE from 'three';
import { SUN_DIR, ATMO } from './atmosphere.js';

// Time of day. A 10 minute day and a 5 minute night, starting at a random point in the
// cycle so no two sessions open on the same light.
//
// SUN_DIR CARRIES THE DOMINANT LIGHT, not the sun specifically: it is the sun while the sun
// is up and the moon once it is well down. Everything downstream already points at one
// direction — the directional light and its shadow box, the sun sprite, the lens flare
// anchor, the shared fog uniform, the cloud raymarch, the water glitter — so switching what
// that direction MEANS lights the whole scene by moonlight for free, and the night is
// flyable rather than a black screen. The moon is a dim, cold, small-haloed sun.
//
// The palette is keyed on the SUN's altitude, which keeps going negative after sunset. One
// continuous variable then drives dusk and night, while the moon's arc (a mirror of the
// sun's) decides where the light comes from.

const PARAMS = new URLSearchParams(location.search);
const num = (k, d) => (PARAMS.get(k) != null ? +PARAMS.get(k) : d);

export const DAY_SECONDS = num('day', 600);
export const NIGHT_SECONDS = num('night', 300);
const CYCLE = DAY_SECONDS + NIGHT_SECONDS;

// Noon tops out at 45 degrees rather than overhead. A high sun lands nearly along every
// surface normal at once and flattens terrain into shaded blobs — the same reason the fixed
// sun sat at 28. This arc still crosses 28 twice a day.
const MAX_ALT = THREE.MathUtils.degToRad(num('sunmax', 45));
const AZ_SWEEP = Math.PI;
// so local noon points where the old fixed sun did, and the tuned midday look is reproduced
// exactly rather than approximately
const AZ_NOON = Math.atan2(0.3, 0.45);
const AZ_START = AZ_NOON - AZ_SWEEP * 0.5;

// The light direction never sits exactly on the horizon. At altitude 0 a directional light
// is perfectly horizontal, so shadows run past the shadow camera's far plane and stripe the
// ground. The palette is what sells a sunset; the geometry only has to stay sane.
const MIN_ALT = THREE.MathUtils.degToRad(1.7);

// Hand over to the moon well below the horizon, not at it. Between 0 and here the sky still
// has afterglow and the directional term is nearly off, so the 180 degree azimuth jump
// lands in the one moment almost nothing is keyed to it.
const MOON_SWAP = THREE.MathUtils.degToRad(-6);

// How far below the horizon the PHYSICAL atmosphere is allowed to follow the sun — it lights
// the clouds and the aerial haze, and it has no moon, so an unfloored sun leaves black clouds
// hanging in a moonlit world. Parked on the horizon it stands in for moonlight: measured at
// midnight the brightest cloud reaches 62 against a ground of 31, so they read as lit without
// becoming the lamp. That number climbs fast — 125 by +2 degrees and 169 by +5, which is the
// clouds-are-the-only-lit-thing look already rejected once. Below the horizon it collapses
// just as fast, to 13 by -1.5. Nothing above the model tracks this; the sky comes from the
// palette, so this trades against the clouds alone.
const NIGHT_FLOOR = THREE.MathUtils.degToRad(num('nightfloor', 0));

// The env column below is a FRACTION of full daylight, scaled by this. 0.62 is the tuned
// environmentIntensity the scene already shipped with, so the +45 row reproduces it exactly.
const ENV_BASE = num('env', 0.62);

const lin = (h) => new THREE.Color(h).convertSRGBToLinear();
// cloud colours are authored in LINEAR already (skyclouds builds them from raw components),
// so they must not be sRGB-decoded a second time
const raw = (r, g, b) => new THREE.Color().setRGB(r, g, b);

// Keyed on sun altitude in DEGREES. Rows below MOON_SWAP carry moonlight colours and rows
// above carry sunlight, so the crossover blends cold into warm exactly where the light
// source itself changes.
//
// The +45 row is the palette the game was tuned at, value for value, so midday is unchanged
// from before time of day existed.
const STOPS = [
  // MOONLIGHT HAS TO LIGHT THE WORLD, NOT JUST THE CLOUDS.
  //
  // The clouds carry their own light budget — sunColor and ambientSky multiplied by the
  // cloud pass's own sunBoost — while the terrain is lit by the scene lights, and only the
  // scene lights were being taken down at night. Measured at midnight against a matching
  // noon frame, cloud mean over ground mean was 1.0 at noon and 5.8 at midnight: the ground
  // fell to 19 while the clouds stayed at 111, which is a black world under a lit sky.
  //
  // Fixed from both ends, since the two are independent: the moon's own light terms come up
  // about 4x (ground 19 -> 36) and the cloud radiance comes down to 0.55 (cloud 111 -> 80),
  // landing at a ratio of 2.2. Clouds still read brighter than terrain, which is right —
  // they are nearer the light and scatter hard — but the night is now 5.6x darker than noon
  // rather than a black frame with white cut-outs in it.
  { alt: -90,
    zenith: 0x05070f, horizon: 0x0b1120, haze: 0x141c30, glow: 0x46557e,
    light: 0x9fb6dc, lightI: 0.86,
    hemiSky: 0x33415e, hemiGround: 0x191d26, hemiI: 0.36,
    env: 0.30, halo: 0.10, sunPower: 0.0, fogNear: 1200, fogFar: 7000,
    cloudSun: [0.187, 0.231, 0.330], cloudAmb: [0.030, 0.041, 0.072] },

  { alt: -20,
    zenith: 0x070b18, horizon: 0x101a30, haze: 0x1a2440, glow: 0x4c5c86,
    light: 0x9fb6dc, lightI: 0.77,
    hemiSky: 0x394765, hemiGround: 0x1c202a, hemiI: 0.33,
    env: 0.28, halo: 0.12, sunPower: 0.0, fogNear: 1200, fogFar: 7000,
    cloudSun: [0.150, 0.187, 0.271], cloudAmb: [0.028, 0.038, 0.065] },

  // Moonrise. The moon is only a few degrees up, so the ground is genuinely dim here and the
  // fix is NOT to crank the light — a 6 degree moon out-lighting a 45 degree one is worse
  // than the problem. The clouds come down instead: they run bright near moonrise because a
  // low light source puts them in forward scatter, which is real but exaggerated by the
  // cloud pass's sunBoost.
  { alt: -6,
    zenith: 0x121d3c, horizon: 0x2c3a5e, haze: 0x3a4a70, glow: 0x6b7ba4,
    light: 0xa9bee0, lightI: 0.50,
    hemiSky: 0x45557a, hemiGround: 0x24272f, hemiI: 0.26,
    env: 0.24, halo: 0.25, sunPower: 0.05, fogNear: 1300, fogFar: 6800,
    cloudSun: [0.119, 0.145, 0.205], cloudAmb: [0.028, 0.037, 0.059] },

  { alt: -2,
    zenith: 0x1d3057, horizon: 0x8a5f5a, haze: 0x9c6f60, glow: 0xd88a55,
    light: 0xd08a58, lightI: 0.30,
    hemiSky: 0x5a6785, hemiGround: 0x2e2b2a, hemiI: 0.16,
    env: 0.22, halo: 0.85, sunPower: 0.45, fogNear: 1400, fogFar: 6600,
    cloudSun: [0.62, 0.36, 0.22], cloudAmb: [0.150, 0.170, 0.260] },

  { alt: 1,
    zenith: 0x27508f, horizon: 0xd9884e, haze: 0xe8a070, glow: 0xffb070,
    light: 0xffa860, lightI: 0.95,
    hemiSky: 0x8296b4, hemiGround: 0x453a30, hemiI: 0.22,
    env: 0.42, halo: 1.35, sunPower: 1.0, fogNear: 1450, fogFar: 6550,
    cloudSun: [1.00, 0.58, 0.32], cloudAmb: [0.280, 0.300, 0.420] },

  { alt: 8,
    zenith: 0x2f63a8, horizon: 0xf0c39a, haze: 0xf3d3b4, glow: 0xffd9a8,
    light: 0xffd2a0, lightI: 1.95,
    hemiSky: 0xa8c2dd, hemiGround: 0x54503c, hemiI: 0.28,
    env: 0.74, halo: 1.12, sunPower: 1.0, fogNear: 1480, fogFar: 6520,
    cloudSun: [1.00, 0.82, 0.62], cloudAmb: [0.440, 0.520, 0.700] },

  { alt: 20,
    zenith: 0x3a76bd, horizon: 0xd2e2f0, haze: 0xe0ebf3, glow: 0xffeccd,
    hazeAway: 0xa8c4de, hazeToward: 0xf6e8d2,
    light: 0xfff0d8, lightI: 2.42,
    hemiSky: 0xb6d3ed, hemiGround: 0x5b6650, hemiI: 0.32,
    env: 0.93, halo: 1.0, sunPower: 1.0, fogNear: 1500, fogFar: 6500,
    cloudSun: [1.00, 0.95, 0.88], cloudAmb: [0.540, 0.660, 0.860] },

  { alt: 45,
    zenith: 0x3d80cc, horizon: 0xc2dcef, haze: 0xe3edf5, glow: 0xffeccd,
    hazeAway: 0xa8c4de, hazeToward: 0xf6e8d2,
    light: 0xfff4e0, lightI: 2.60,
    hemiSky: 0xbad7f0, hemiGround: 0x5e6a4f, hemiI: 0.34,
    env: 1.00, halo: 1.0, sunPower: 1.0, fogNear: 1500, fogFar: 6500,
    cloudSun: [1.00, 0.97, 0.92], cloudAmb: [0.580, 0.700, 0.900] },
];

// TWO COLOUR PATHS, and mixing them up costs a whole stop of saturation.
//
// ColorManagement is enabled, so new THREE.Color(hex) ALREADY lands in linear working
// space. Light colours therefore take the hex straight — calling convertSRGBToLinear on
// top converts twice: 0xfff4e0 becomes (1, 0.797, 0.515) where the DirectionalLight this
// replaces was (1, 0.905, 0.745), i.e. markedly warmer and more saturated than the tuned
// look. Shader UNIFORMS are the opposite case: three uploads them untouched, so those do
// need the explicit conversion, which is why the rest of the project's colours use lin().
// HAZE IS DERIVED FROM THE SKY, not authored beside it.
//
// It was two independent columns, and they drifted apart the moment the sky started moving:
// at sunset the horizon went orange while hazeAway stayed the daytime steel blue, so distant
// ridges sat there as cold blue cut-outs against a warm sky. Aerial perspective IS the sky
// seen through air — whatever a distant surface fades toward has to be the colour of the sky
// behind it, at every time of day, or the two read as separate pictures.
//
// Looking away from the sun that is the sky near the horizon pulled slightly toward the
// zenith; looking into it, the horizon pulled most of the way to the sun's own glow. The
// two daylight rows that the game was tuned against keep their measured values so midday is
// untouched; every other row derives, and so can never disagree with its own sky again.
// Measured at sunset over the pixels hazeAway actually drives, as red/blue against the sky
// right above them (sky 2.99): pull 0 -> gap 0.76, 0.10 -> 0.84, 0.18 -> 0.90, 0.25 -> 0.95,
// 0.35 -> 1.03. Matching improves all the way to zero, but a little zenith in the away-haze
// is real — the sky away from the sun IS cooler higher up — so this takes most of the
// improvement and keeps the falloff.
const HAZE_AWAY_ZENITH = 0.12;
const HAZE_TOWARD_GLOW = 0.85;
const UNIFORM_COLORS = ['zenith', 'horizon', 'haze', 'glow', 'hazeAway', 'hazeToward'];
const LIGHT_COLORS = ['light', 'hemiSky', 'hemiGround'];
const COLOR_KEYS = [...UNIFORM_COLORS, ...LIGHT_COLORS];
const NUM_KEYS = ['lightI', 'hemiI', 'env', 'halo', 'sunPower', 'fogNear', 'fogFar'];
const TABLE = STOPS.map((s) => {
  const o = { alt: THREE.MathUtils.degToRad(s.alt) };
  for (const k of UNIFORM_COLORS) if (s[k] != null) o[k] = lin(s[k]);
  if (o.hazeAway == null) {
    o.hazeAway = o.horizon.clone().lerp(o.zenith, HAZE_AWAY_ZENITH);
  }
  if (o.hazeToward == null) {
    o.hazeToward = o.horizon.clone().lerp(o.glow, HAZE_TOWARD_GLOW);
  }
  for (const k of LIGHT_COLORS) o[k] = new THREE.Color(s[k]);
  for (const k of NUM_KEYS) o[k] = s[k];
  o.cloudSun = raw(...s.cloudSun);
  o.cloudAmb = raw(...s.cloudAmb);
  return o;
});

export function createDayNight({ scene, skyMat, sun, hemi, sunSpr, flare, water }) {
  // Random start, so a session can open at dawn, noon or the middle of the night.
  // ?tod=0..1 pins it: 0 dawn, 0.33 noon, 0.67 dusk, 0.85 deep night.
  let clock = num('tod', Math.random()) * CYCLE;

  const P = {};
  for (const k of COLOR_KEYS) P[k] = new THREE.Color();
  P.cloudSun = new THREE.Color();
  P.cloudAmb = new THREE.Color();

  const moonDir = new THREE.Vector3();
  const trueSunDir = new THREE.Vector3();
  // lightColor/lightLevel are published for the INSTRUMENT PANEL, which is a 2D canvas and
  // therefore lit by nothing at all unless it is told what the sun is doing.
  const state = {
    sunAlt: 0, isNight: false, phase: 0, clock: 0,
    lightColor: new THREE.Color(1, 1, 1), lightLevel: 1,
  };
  let clouds = null;

  const sample = (alt) => {
    let i = 0;
    while (i < TABLE.length - 2 && alt > TABLE[i + 1].alt) i++;
    const a = TABLE[i], b = TABLE[i + 1];
    const t = THREE.MathUtils.clamp((alt - a.alt) / (b.alt - a.alt), 0, 1);
    for (const k of COLOR_KEYS) P[k].lerpColors(a[k], b[k], t);
    P.cloudSun.lerpColors(a.cloudSun, b.cloudSun, t);
    P.cloudAmb.lerpColors(a.cloudAmb, b.cloudAmb, t);
    for (const k of NUM_KEYS) P[k] = a[k] + (b[k] - a[k]) * t;
  };

  function update(dt) {
    clock = (clock + dt) % CYCLE;
    const day = clock < DAY_SECONDS;
    const u = day ? clock / DAY_SECONDS : (clock - DAY_SECONDS) / NIGHT_SECONDS;
    // sun altitude arcs up over the day and mirrors below the horizon over the night, so it
    // is one continuous signal across the whole cycle
    const sunAlt = (day ? 1 : -1) * Math.sin(Math.PI * u) * MAX_ALT;
    const sunAz = AZ_START + u * AZ_SWEEP + (day ? 0 : Math.PI);
    const useMoon = sunAlt < MOON_SWAP;

    // the moon mirrors the sun: as far above the horizon as the sun is below it, and half a
    // turn away in bearing, so it genuinely crosses the sky over the night
    const alt = Math.max(useMoon ? -sunAlt : sunAlt, MIN_ALT);
    const az = useMoon ? sunAz + Math.PI : sunAz;
    const ca = Math.cos(alt);
    SUN_DIR.set(ca * Math.cos(az), Math.sin(alt), ca * Math.sin(az)).normalize();

    // THE TRUE SUN, kept separately, because one consumer is a physical model rather than a
    // palette. takram's atmosphere derives the whole sky from where the sun actually is, so
    // handing it SUN_DIR paints full daylight at midnight — the moon arrives as a light 40
    // degrees UP and the model has no idea it is not the sun. It gets the real thing, below
    // the horizon and all, and produces its own twilight. NIGHT_FLOOR stops it at deep
    // twilight rather than letting it run to true black: there is no moon in that model, so
    // the alternative to a floor is a black sky over a moonlit world.
    const trueAlt = Math.max(sunAlt, NIGHT_FLOOR);
    const tca = Math.cos(trueAlt);
    trueSunDir.set(tca * Math.cos(sunAz), Math.sin(trueAlt), tca * Math.sin(sunAz)).normalize();

    sample(sunAlt);

    // --- shared atmosphere uniforms: one write each, reaches every material
    ATMO.uAtmHazeAway.value.copy(P.hazeAway);
    ATMO.uAtmHazeToward.value.copy(P.hazeToward);
    ATMO.uAtmGlow.value.copy(P.glow);
    ATMO.uAtmSunPower.value = P.sunPower;

    // --- sky dome
    if (skyMat) {
      skyMat.uniforms.uZenith.value.copy(P.zenith);
      skyMat.uniforms.uHorizon.value.copy(P.horizon);
      skyMat.uniforms.uHaze.value.copy(P.haze);
      skyMat.uniforms.uGlow.value.copy(P.glow);
      skyMat.uniforms.uSunHalo.value = P.halo;
    }

    // --- lights. The env map is baked once at the midday palette, so it is scaled rather
    // than re-baked: a PMREM pass per frame would cost more than everything else here put
    // together, and intensity carries almost all of the day-to-night difference.
    if (sun) { sun.color.copy(P.light); sun.intensity = P.lightI; }
    if (hemi) {
      hemi.color.copy(P.hemiSky); hemi.groundColor.copy(P.hemiGround);
      hemi.intensity = P.hemiI;
    }
    if (scene) {
      scene.environmentIntensity = P.env * ENV_BASE;
      if (scene.fog) {
        scene.fog.color.copy(P.hazeAway);
        scene.fog.near = P.fogNear; scene.fog.far = P.fogFar;
      }
    }

    // --- the disc itself: the sun sprite becomes the moon, small and cold. The lens flare
    // is a SUN effect and is switched off entirely at night rather than dimmed — ghosts
    // tracking a moon across the screen read as a bug.
    if (sunSpr) {
      sunSpr.position.copy(SUN_DIR).multiplyScalar(7800);
      sunSpr.scale.setScalar(useMoon ? 700 : 2200);
      // P.light, not P.glow: a MATERIAL colour is uploaded as authored, so it wants the
      // light path's single conversion rather than the uniform path's explicit one.
      sunSpr.material.color.copy(P.light);
    }
    if (flare) flare.visible = !useMoon && sunAlt > 0;

    // --- water: its sun direction and sky colours were cloned at construction
    if (water && water.uniforms) {
      const w = water.uniforms;
      if (w.uSunDir) w.uSunDir.value.copy(SUN_DIR);
      if (w.uZenith) w.uZenith.value.copy(P.zenith);
      if (w.uHorizon) w.uHorizon.value.copy(P.horizon);
      if (w.uHaze) w.uHaze.value.copy(P.haze);
    }

    // --- clouds. Two systems, and neither shares the live vector: skyclouds clones it into
    // its own uniforms, volclouds stores it in earth-centred space behind a transform. Both
    // therefore have to be pushed to, and which one this is decides how.
    if (clouds && clouds.cloudPass) {
      const u2 = clouds.cloudPass.march.uniforms;
      u2.sunDir.value.copy(SUN_DIR);
      u2.sunColor.value.copy(P.cloudSun);
      u2.ambientSky.value.copy(P.cloudAmb);
    } else if (clouds && clouds.setSun) {
      // takram lights the volume from its own atmosphere model, so it wants the direction
      // and nothing else — colour comes out of the scattering rather than being handed in.
      // The TRUE sun, not SUN_DIR: see where trueSunDir is built.
      clouds.setSun(trueSunDir);
    }

    state.sunAlt = sunAlt; state.isNight = useMoon;
    state.phase = clock / CYCLE; state.clock = clock;
    // What the panel is lit BY: the directional colour, and a level that folds in the fill
    // terms so a dial does not go black the moment the sun dips below the horizon while the
    // sky is plainly still bright.
    state.lightColor.copy(P.light);
    state.lightLevel = Math.min(1, P.lightI / 2.6 + P.hemiI * 0.55 + P.env * 0.30);
    moonDir.copy(SUN_DIR);
  }

  return {
    update, state,
    attachClouds(sc) { clouds = sc; },
    // for the HUD/debug: hours on a 24 h face, midday at 12
    hours() {
      const day = clock < DAY_SECONDS;
      const u = day ? clock / DAY_SECONDS : (clock - DAY_SECONDS) / NIGHT_SECONDS;
      return day ? 6 + u * 12 : (18 + u * 12) % 24;
    },
  };
}
