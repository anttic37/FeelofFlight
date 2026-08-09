import * as THREE from 'three';
import { patchAerialPerspective, SUN_DIR, buildSkyEnvironment } from './atmosphere.js';
// Rewrites three's shared fog chunks for sun-aware aerial perspective. Runs
// here, at the top of the body, because every material in the project is built
// inside a factory called further down — a material compiled before this point
// would bake in the stock flat-colour fog and silently miss the effect.
patchAerialPerspective();
import { createWorld, heightAt, surfaceAt } from './world.js';
import { createDayNight } from './daynight.js';
import { initGroundFX } from './groundfx.js';
import { RUNWAYS } from './runways.js';
import { buildPlane, updatePlaneVisual } from './crimson-kestrel.js'; // KX-1 with load-flexing wings
import { FlightModel } from './physics.js';
import { measureContacts } from './airframe.js';
import { ChaseCam } from './camera.js';
import { WingTrails } from './trails.js';
import { createFX } from './fx.js';
import { createWreckage } from './wreckage.js';
import { SoundFX } from './sound.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { setTerrainSeed, islandInfo } from './heightcore.js';
import { fbm1 } from './noise.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);
// bake the ground's splat detail before anything builds a material that wants it
initGroundFX(renderer);

const scene = new THREE.Scene();
// FAR PLANE 45 km, not 12. The ocean plane is already 80 km wide, so the hard
// line along the horizon was never the water running out — it was the far plane
// CLIPPING it, leaving bare sky dome above a sharp edge. Depth precision is
// governed almost entirely by NEAR (resolution at distance z goes as z²/near),
// so pushing far out nearly four times costs essentially nothing, while the sea
// now reaches the true horizon and fades into haze instead of stopping dead.
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 45000);

// a NEW island every launch: seed the terrain before anything samples it.
// ?seed=N pins an island you liked (?seed=0 is the classic hand-tuned one).
const seedParam = new URLSearchParams(location.search).get('seed');
const terrainSeed = seedParam !== null ? (Number(seedParam) >>> 0) : (Date.now() >>> 0);
setTerrainSeed(terrainSeed);
const isle = islandInfo();
console.log(`[flighfeel] island seed ${terrainSeed} (${isle.archetype}, ${isle.strips} strips) — revisit with ?seed=${terrainSeed}`);

const world = createWorld(scene);
// the sky becomes the ambient light source (see atmosphere.js) — after
// createWorld, because it needs the palette the dome was built with
buildSkyEnvironment(renderer, scene);
scene.environmentIntensity = 0.62;
// TIME OF DAY. Built after the environment bake, which captures a fresh dome at the midday
// palette on purpose: the env map is scaled per frame rather than re-baked, so it has to be
// baked from the light it represents at full strength.
const dayNight = createDayNight({
  scene, skyMat: world.skyMat, sun: world.sun, hemi: world.hemi,
  sunSpr: world.sunSpr, flare: world.flare, water: world.water,
});
dayNight.update(0);   // so frame one is already at the right time rather than at midday
window.__dn = dayNight;
// ?tod=0..1 pins the time of day (0 = dawn, 0.33 = noon, 0.67 = dusk, 0.85 = deep night)
const plane = buildPlane();
scene.add(plane.group);

const phys = new FlightModel(surfaceAt);
// Crashes go to a real rigid-body solver; ?physics=builtin keeps the hand-rolled one. The
// flight model is not touched either way — this only takes over once the airframe is broken.
// It is the default because the hand-rolled wreck CANNOT TOPPLE: give it perfectly correct
// contact points and it still comes to rest balanced on its nose in half of all steep dives,
// because nothing in it can turn an unstable pose into a stable one. Loaded in the background
// at startup, not at impact: it takes 665 ms, and a crash cannot wait for a download. If the
// load fails, wreckDriver is simply never attached and the built-in path carries on.
if (new URLSearchParams(location.search).get('physics') !== 'builtin') {
  import('./rapiercrash.js').then(async (m) => {
    await m.preloadRapier();
    phys.wreckDriver = m.createRapierCrash(plane);
    console.log('[ff] rapier crash solver armed');
  }).catch((e) => console.warn('[ff] rapier unavailable, keeping built-in wreck', e));
}
const input = new Input();
const chase = new ChaseCam(camera, heightAt);
const trails = new WingTrails(scene, plane.tipL, plane.tipR);
const fx = createFX(scene);
const wreckage = createWreckage(scene, surfaceAt, heightAt);
const sound = new SoundFX();
const hud = new HUD();

function syncPlaneToPhysics() {
  plane.group.position.copy(phys.pos);
  plane.group.quaternion.copy(phys.quat);
  plane.group.updateMatrixWorld(true);
}

// wings bend with lift load: 1 g rest, ~3.5 g = full +8° bow, pushovers droop
function updateWingFlex(dt) {
  const target = Math.max(-1, Math.min(1, (phys.gLoad - 1) / 2.5));
  input.wingFlexSm += (target - input.wingFlexSm) * Math.min(1, dt * 5);
  // pre-stall shudder: the wings visibly rattle as the margin closes, so the
  // warning is seen as well as heard — added AFTER the smoothing so it stays
  // fast and ragged instead of being averaged away
  const sm = phys.stallMargin || 0;
  if (sm > 0.02) input.wingFlexSm += fbm1(phys.time * 13.7, 17) * sm * sm * 0.5;
  // OVERDRIVE TREMBLE. Higher frequency and far smaller than the stall shudder, which is a
  // warning and should stay the louder of the two — this is the airframe buzzing under
  // power, not complaining. Also after the smoothing, or it averages into nothing.
  const od = phys.overdrive || 0;
  if (od > 0.02) input.wingFlexSm += Math.sin(phys.time * 71.3) * od * 0.035;
}

function reset(message) {
  wreckage.restore(plane); // reattach any sheared-off parts before flying again
  phys.reset();
  input.throttle = 0.65;
  syncPlaneToPhysics();
  chase.snap(phys);
  trails.reset();
  if (message) hud.msg(message);
}

input.onReset = () => reset('RESET');
input.onMute = () => hud.msg(sound.toggleMute() ? 'MUTED' : 'SOUND ON', 1200);
input.onGear = () => phys.toggleGear();
input.onFlaps = () => { if (phys.setFlaps) phys.setFlaps(((phys.flapSetting || 0) + 1) % 3); };
input.onCamera = () => hud.msg(`CAMERA ${chase.cycleTightness()}`, 1200);
input.onView = () => hud.msg(`VIEW ${chase.cycleView(phys)}`, 1200);
let runwayCycle = -1;
// PAUSE. Esc (or the Pause key) stops the simulation where it stands. The clouds keep
// evolving because they run off the render clock, not the sim — which is exactly what you
// want while tuning them: a still aeroplane and a live sky.
let paused = false;
let pausedByPanel = false;   // so closing the panel only un-pauses what it paused itself
const setPaused = (v) => {
  paused = v;
  input.paused = v;
  document.querySelector('#paused').style.display = v ? 'block' : 'none';
};
input.onPause = () => { setPaused(!paused); pausedByPanel = false; };

input.onTweak = () => {
  if (!tweak) { hud.msg('TUNING PANEL NEEDS THE CLOUDS — STILL LOADING', 1600); return; }
  const open = tweak.toggle();
  // opening the panel pauses for you, since the whole reason to open it is to stop
  // worrying about the aeroplane. Esc still toggles pause independently if you want to
  // watch it fly with the new numbers.
  if (open && !paused) { setPaused(true); pausedByPanel = true; }
  else if (!open && pausedByPanel) { setPaused(false); pausedByPanel = false; }
  hud.msg(open ? 'TUNING PANEL — PAUSED · ESC TO FLY' : 'TUNING PANEL CLOSED', 1400);
};
input.onFreeCam = () => {
  const on = chase.toggleFree(phys);
  input.freeCam = on;
  hud.msg(on ? 'FREE CAM — WASD MOVE · Q/E DOWN/UP · SHIFT FAST · Z SLOW · WHEEL SPEED · B EXIT'
             : 'FREE CAM OFF', on ? 4200 : 1200);
};
input.onRunwaySpawn = () => {
  wreckage.restore(plane);
  runwayCycle = (runwayCycle + 1) % RUNWAYS.length;
  const r = RUNWAYS[runwayCycle];
  // threshold at the +Z end, facing down the strip (yaw 0 faces -Z)
  const fx0 = -Math.sin(r.heading), fz0 = -Math.cos(r.heading);
  const back = r.length / 2 - 30;
  phys.resetTo({ x: r.x - fx0 * back, z: r.z - fz0 * back, y: r.elev + 1.55, yaw: r.heading, speed: 0, grounded: true, gearDown: true });
  input.throttle = 0;
  syncPlaneToPhysics();
  chase.snap(phys);
  trails.reset();
  hud.msg(`${(r.name || 'RUNWAY ' + (runwayCycle + 1)).toUpperCase()} — FULL THROTTLE, S TO ROTATE`, 3200);
};

// audio needs a user gesture
const startAudio = () => { sound.init(); };
window.addEventListener('keydown', startAudio, { once: true });
window.addEventListener('pointerdown', startAudio, { once: true });

// SOFT PASS: bloom over the whole frame. Antialiasing, soft shadow filtering
// and ACES tone mapping were already on, so the remaining softness three.js can
// give is post-processing — a light bleed off the brightest surfaces (snow,
// cloud tops, sun glints on water) that takes the hard digital edge off.
// Kept subtle and threshold-gated so midtones stay crisp. ?bloom=0 disables it.
let composer = null;
if (new URLSearchParams(location.search).get('bloom') !== '0') {
  // Threshold above 1: a bright daylit sky and sunlit snow sit near 1.0 in the
  // linear buffer, so anything lower blooms the entire frame into haze and
  // washes the greens and the sea out. Only genuine highlights should glow.
  // At this threshold the only thing hot enough to bloom is sun glint on the
  // water and the sun sprite itself — measured: grass, sky and snow pixels come
  // out identical to a direct render, so the pass costs nothing in contrast.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.19, 0.5, 1.25);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  // tone mapping and colour space move here: rendering into the composer's
  // float target skips them in the material shaders by design
  composer.addPass(new OutputPass());
}
// CLOUDS. Raymarched volumetrics (volclouds.js) took over from the old sprite
// cumulus. They come from packages on a CDN, so they arrive a couple of seconds
// after the world does and take over rendering when they land; until then, and
// if the fetch fails outright, the bloom composer above keeps drawing a normal
// (cloudless) sky rather than leaving a broken frame. ?vclouds=0 skips them.
//
// TWO CLOUD SYSTEMS LIVE SIDE BY SIDE, and the takram one (volclouds) is the default again
// because it simply looks better. It is a physically-based renderer — precomputed atmospheric
// scattering, real multiple scattering inside the volume, temporal reprojection paying for a
// far denser march — against skyclouds, which is a hand-rolled raymarch of baked 3D noise.
// The known cost of going back is the layer lid: minLayerHeights/maxLayerHeights are vec4
// uniforms, one top and bottom for the WHOLE sky, so a layer ceiling is an iso-height plane
// and that is the "cut" this system has always had.
//
// ?clouds=new selects skyclouds, which keeps the god rays, the ground cloud shadows and the
// tuning panel. ?vclouds=0 skips clouds entirely.
const CLOUD_KIND = new URLSearchParams(location.search).get('clouds') || 'old';
let volClouds = null;
let tweak = null;   // live tuning panel (P), built once the clouds land
if (new URLSearchParams(location.search).get('vclouds') !== '0') {
  const load = CLOUD_KIND === 'new'
    ? import('./skyclouds.js').then(m => m.createSkyClouds({ renderer, scene, camera, sunDir: SUN_DIR }))
    : import('./volclouds.js').then(m => m.createVolumetricClouds({ renderer, scene, camera, sunDir: SUN_DIR }));
  load
    .then(v => {
      volClouds = v;
      // one handle whichever system is running — skyclouds sets window.__sc from inside
      // itself, so without this the old clouds are unreachable from the console
      window.__clouds = v;
      v.setSize(window.innerWidth, window.innerHeight);
      // Both systems copy the sun at construction rather than sharing the live vector, so
      // either way daynight has to push to them — attachClouds handles whichever this is.
      dayNight.attachClouds(v);
      dayNight.update(0);
      console.log(`[flighfeel] ${CLOUD_KIND === 'new' ? 'sky' : 'volumetric'} clouds active`);
      // A PANEL EACH. They share the shell in panel.js but nothing else, because the two
      // expose nothing in common: skyclouds hands over a plain params object it re-reads
      // per frame, while the takram one is a library effect whose per-layer fields are
      // repacked into vec4 uniforms every frame. Both end up equally live; only the route
      // there differs. The game's own resize path is passed in so neither computes sizes.
      const applyResize = () => v.setSize(window.innerWidth, window.innerHeight);
      return CLOUD_KIND === 'new'
        ? import('./tweak.js').then(t => { tweak = t.initTweakPanel({ sc: v, applyResize }); })
        : import('./tweakvol.js').then(t => { tweak = t.initVolTweakPanel({ vc: v, applyResize }); });
    })
    .catch(e => console.error('[flighfeel] sky clouds failed:', e));
}
const draw = () => (volClouds ? volClouds.render()
  : composer ? composer.render() : renderer.render(scene, camera));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (volClouds) volClouds.setSize(window.innerWidth, window.innerHeight);
});

// debug / test hook — enough surface to step & render headlessly in tests
window.__ff = {
  phys, input, chase, reset, fx, trails, hud, sound, scene, camera, renderer, plane, world, wreckage,
  heightAt, surfaceAt, RUNWAYS, seed: terrainSeed,
  step(dt) {
    input.update(dt);
    const controls = { pitch: input.pitchSm, roll: input.rollSm, yaw: input.yawSm, throttle: input.throttle, brake: input.brake, overdrive: input.overdrive };
    // free cam and pause freeze the sim, as in the real loop. This has to be its OWN
    // branch: folding it into the `if (!phys.crashed)` condition drops the healthy
    // aeroplane into the else, which starts a wreck and drops it out of the sky.
    if (chase.free || paused) { /* frozen */ }
    else if (!phys.crashed) phys.update(dt, controls);
    else {
      if (!phys._wreck) { const sev = phys.vel.length(); phys.startWreck(); wreckage.breakUp(plane, phys, sev); phys.wreckContacts = measureContacts(plane); }
      phys.wreckUpdate(dt);
      phys.justWreckHit = 0;
    }
    syncPlaneToPhysics();
    updateWingFlex(dt);
    updatePlaneVisual(plane, input, phys, dt);
    if (wreckage.active) wreckage.update(dt);
    chase.update(dt, phys, input);
    trails.update(dt, phys);
    fx.update(dt, phys);
    world.update(chase.free ? chase.camera.position : phys.pos, simTime += dt);
    hud.update(phys, input, dayNight.state);
  },
  render() { draw(); },
};

reset();
hud.msg('FLY — G FOR GEAR, T FOR RUNWAY START', 2600);

const clock = new THREE.Clock();
let simTime = 0;
let odWasOn = false;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  input.update(dt);

  // The free camera FREEZES the simulation. An inspection camera you have to chase a
  // moving aeroplane with is not an inspection camera, and leaving the aircraft flying
  // itself while you look elsewhere just means finding it crashed when you come back.
  const frozen = chase.free || paused;
  // world time only feeds animation — ground drift, scatter sway, water, runway lights —
  // and terrain streaming ignores it, so holding it still is safe and stops the sea too
  if (!frozen) simTime += dt;
  // the sky holds still with everything else when paused or in the free camera — a pause
  // you can watch the sun set through is not a pause
  if (!frozen) dayNight.update(dt);
  const controls = { pitch: input.pitchSm, roll: input.rollSm, yaw: input.yawSm, throttle: input.throttle, brake: input.brake, overdrive: input.overdrive };
  const steps = 2;
  if (!frozen) for (let i = 0; i < steps && !phys.crashed; i++) phys.update(dt / steps, controls);

  // OVERDRIVE announce, on the input's latch rather than the spooled value, so the message
  // lands the instant the engine takes it instead of part way up the ramp.
  if (input._odOn !== odWasOn) {
    odWasOn = input._odOn;
    if (!frozen) hud.msg(odWasOn ? 'OVERDRIVE' : 'OVERDRIVE OFF', odWasOn ? 1400 : 900);
  }
  if (phys.justGearMoved) {
    phys.justGearMoved = false;
    sound.gearMove();
    hud.msg(phys.gearDown ? 'GEAR DOWN' : 'GEAR UP', 1100);
  }
  if (phys.justFlapsMoved) {
    phys.justFlapsMoved = false;
    if (sound.flapMove) sound.flapMove();
    hud.msg(phys.flapSetting ? `FLAPS ${phys.flapSetting}` : 'FLAPS UP', 1100);
  }
  if (phys.justTouchedDown != null) {
    const sink = phys.justTouchedDown;
    phys.justTouchedDown = null;
    sound.touchdown(sink);
    fx.touchdown(phys.pos, phys.onRunwaySurface ? 'runway' : 'grass', sink);
    hud.msg(sink < 1.8 ? 'BUTTER.' : 'TOUCHDOWN', 1800);
  }
  if (frozen && phys.crashed) {
    // a pause that leaves the wreck tumbling is not a pause. The impact branch below is
    // skipped too, so pausing mid-crash does not spawn debris and a bang while stopped.
  } else if (phys.crashed && !phys._wreck) {
    // impact moment: the airframe becomes a tumbling wreck — no auto-reset,
    // the crash plays out where it happened (R / T to fly again)
    const severity = phys.vel.length(); // before startWreck damps it
    phys.startWreck();
    wreckage.breakUp(plane, phys, severity);
    // AFTER breakUp, never before: whatever is still bolted on is the wreck, and its contact
    // points have to be that shape. Skip this and a fuselage whose wings are lying in a field
    // is still held up on contacts 5.5 m out to either side, floating.
    phys.wreckContacts = measureContacts(plane);
    input.throttle = 0; // engine dies with the airframe
    sound.crash();
    // no screen flash: a full-screen white wash is the one thing that reads as a rendering
    // fault rather than an impact, and it hides the crash you actually want to watch
    const reason = typeof phys.crashed === 'string' ? phys.crashed.toUpperCase() : '';
    hud.msg(reason ? `CRASHED — ${reason} · R TO RESTART` : 'CRASHED · R TO RESTART', 8000);
    const sc = surfaceAt(phys.pos.x, phys.pos.z);
    fx.touchdown(phys.pos, sc.type === 'water' ? 'water' : sc.type === 'runway' ? 'runway' : 'grass', 9);
  } else if (phys.crashed) {
    phys.wreckUpdate(dt);
    if (phys.justWreckHit) {
      const thud = phys.justWreckHit;
      phys.justWreckHit = 0;
      sound.touchdown(Math.min(6, thud));
      const sc = surfaceAt(phys.pos.x, phys.pos.z);
      fx.touchdown(phys.pos, sc.type === 'water' ? 'water' : sc.type === 'runway' ? 'runway' : 'grass', thud);
    }
  }

  sound.setBrake(input.brake);
  syncPlaneToPhysics();
  // FROZEN STOPS EVERYTHING THAT MOVES ON ITS OWN, and no more than that. The camera and
  // the terrain streamer keep running below, because you still want to look around while
  // stopped — and in free flight the streamer is the only thing loading ground under you.
  if (!frozen) {
    updateWingFlex(dt);
    updatePlaneVisual(plane, input, phys, dt);
    if (wreckage.active) {
      // after updatePlaneVisual: debris poses must win over control-surface writes
      wreckage.update(dt);
      for (const h of wreckage.hits) {
        sound.touchdown(Math.min(3, h.mag));
        fx.touchdown(h.pos, h.type, h.mag);
      }
    }
  }
  chase.update(dt, phys, input);
  if (!frozen) {
    trails.update(dt, phys);
    fx.update(dt, phys);
  }
  // stream terrain around the CAMERA in free flight, or you fly a few km out and the
  // island stops loading under you
  world.update(chase.free ? chase.camera.position : phys.pos, simTime);
  sound.update(dt, phys);
  hud.update(phys, input, dayNight.state);
  // the panel needs no per-frame tick: every control writes into the params object the
  // cloud pass already re-reads each frame

  draw();
});
