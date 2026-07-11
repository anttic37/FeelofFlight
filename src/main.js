import * as THREE from 'three';
import { createWorld, heightAt, surfaceAt } from './world.js';
import { RUNWAYS } from './runways.js';
import { buildPlane, updatePlaneVisual } from './plane.js';
import { FlightModel } from './physics.js';
import { ChaseCam } from './camera.js';
import { WingTrails } from './trails.js';
import { createFX } from './fx.js';
import { SoundFX } from './sound.js';
import { Input } from './input.js';
import { HUD } from './hud.js';

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

const world = createWorld(scene);
const plane = buildPlane();
scene.add(plane.group);

const phys = new FlightModel(surfaceAt);
const input = new Input();
const chase = new ChaseCam(camera, heightAt);
const trails = new WingTrails(scene, plane.tipL, plane.tipR);
const fx = createFX(scene);
const sound = new SoundFX();
const hud = new HUD();

function syncPlaneToPhysics() {
  plane.group.position.copy(phys.pos);
  plane.group.quaternion.copy(phys.quat);
  plane.group.updateMatrixWorld(true);
}

function reset(message) {
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
let runwayCycle = -1;
input.onRunwaySpawn = () => {
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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debug / test hook — enough surface to step & render headlessly in tests
window.__ff = {
  phys, input, chase, reset, fx, trails, hud, sound, scene, camera, renderer, plane, world,
  heightAt, surfaceAt, RUNWAYS,
  step(dt) {
    input.update(dt);
    const controls = { pitch: input.pitchSm, roll: input.rollSm, yaw: input.yawSm, throttle: input.throttle, brake: input.brake };
    if (!phys.crashed) phys.update(dt, controls);
    syncPlaneToPhysics();
    updatePlaneVisual(plane, input, phys, dt);
    chase.update(dt, phys);
    trails.update(dt, phys);
    fx.update(dt, phys);
    world.update(phys.pos, simTime += dt);
    hud.update(phys, input);
  },
  render() { renderer.render(scene, camera); },
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
  if (phys.justTouchedDown != null) {
    const sink = phys.justTouchedDown;
    phys.justTouchedDown = null;
    sound.touchdown(sink);
    fx.touchdown(phys.pos, phys.onRunwaySurface ? 'runway' : 'grass', sink);
    hud.msg(sink < 1.8 ? 'BUTTER.' : 'TOUCHDOWN', 1800);
  }
  if (phys.crashed) {
    sound.crash();
    hud.flash();
    const reason = typeof phys.crashed === 'string' ? phys.crashed.toUpperCase() : '';
    reset(reason ? `CRASHED — ${reason}` : 'CRASHED');
  }

  sound.setBrake(input.brake);
  syncPlaneToPhysics();
  updatePlaneVisual(plane, input, phys, dt);
  chase.update(dt, phys);
  trails.update(dt, phys);
  fx.update(dt, phys);
  world.update(phys.pos, simTime);
  sound.update(dt, phys);
  hud.update(phys, input);

  renderer.render(scene, camera);
});
