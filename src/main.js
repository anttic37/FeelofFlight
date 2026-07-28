import * as THREE from 'three';
import { patchAerialPerspective, SUN_DIR } from './atmosphere.js';
// Rewrites three's shared fog chunks for sun-aware aerial perspective. Runs
// here, at the top of the body, because every material in the project is built
// inside a factory called further down — a material compiled before this point
// would bake in the stock flat-colour fog and silently miss the effect.
patchAerialPerspective();
import { createWorld, heightAt, surfaceAt } from './world.js';
import { RUNWAYS } from './runways.js';
import { buildPlane, updatePlaneVisual } from './crimson-kestrel.js'; // KX-1 with load-flexing wings
import { FlightModel } from './physics.js';
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000);

// a NEW island every launch: seed the terrain before anything samples it.
// ?seed=N pins an island you liked (?seed=0 is the classic hand-tuned one).
const seedParam = new URLSearchParams(location.search).get('seed');
const terrainSeed = seedParam !== null ? (Number(seedParam) >>> 0) : (Date.now() >>> 0);
setTerrainSeed(terrainSeed);
const isle = islandInfo();
console.log(`[flighfeel] island seed ${terrainSeed} (${isle.archetype}, ${isle.strips} strips) — revisit with ?seed=${terrainSeed}`);

const world = createWorld(scene);
const plane = buildPlane();
scene.add(plane.group);

const phys = new FlightModel(surfaceAt);
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
// SPIKE (?vclouds=1): hand rendering to the volumetric-cloud composer instead.
// Loaded lazily so the normal game never pays for the extra packages, and set
// up so a failure leaves the ordinary renderer running.
let volClouds = null;
if (new URLSearchParams(location.search).get('vclouds') === '1') {
  import('./volclouds.js')
    .then(m => m.createVolumetricClouds({ renderer, scene, camera, sunDir: SUN_DIR }))
    .then(v => {
      volClouds = v;
      v.setSize(window.innerWidth, window.innerHeight);
      world.clouds.setVisible(false); // the geometry clouds would double up
      console.log('[flighfeel] volumetric clouds active');
    })
    .catch(e => console.error('[flighfeel] volumetric clouds failed:', e));
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
    const controls = { pitch: input.pitchSm, roll: input.rollSm, yaw: input.yawSm, throttle: input.throttle, brake: input.brake };
    if (!phys.crashed) phys.update(dt, controls);
    else {
      if (!phys._wreck) { const sev = phys.vel.length(); phys.startWreck(); wreckage.breakUp(plane, phys, sev); }
      phys.wreckUpdate(dt);
      phys.justWreckHit = 0;
    }
    syncPlaneToPhysics();
    updateWingFlex(dt);
    updatePlaneVisual(plane, input, phys, dt);
    if (wreckage.active) wreckage.update(dt);
    chase.update(dt, phys);
    trails.update(dt, phys);
    fx.update(dt, phys);
    world.update(phys.pos, simTime += dt);
    hud.update(phys, input);
  },
  render() { draw(); },
};

reset();
hud.msg('FLY — G FOR GEAR, T FOR RUNWAY START', 2600);

const clock = new THREE.Clock();
let simTime = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  simTime += dt;
  input.update(dt);

  const controls = { pitch: input.pitchSm, roll: input.rollSm, yaw: input.yawSm, throttle: input.throttle, brake: input.brake };
  const steps = 2;
  for (let i = 0; i < steps && !phys.crashed; i++) phys.update(dt / steps, controls);

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
  if (phys.crashed && !phys._wreck) {
    // impact moment: the airframe becomes a tumbling wreck — no auto-reset,
    // the crash plays out where it happened (R / T to fly again)
    const severity = phys.vel.length(); // before startWreck damps it
    phys.startWreck();
    wreckage.breakUp(plane, phys, severity);
    input.throttle = 0; // engine dies with the airframe
    sound.crash();
    hud.flash();
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
  chase.update(dt, phys);
  trails.update(dt, phys);
  fx.update(dt, phys);
  world.update(phys.pos, simTime);
  sound.update(dt, phys);
  hud.update(phys, input);

  draw();
});
