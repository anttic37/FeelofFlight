import * as THREE from 'three';
import { createWorld, heightAt } from './world.js';
import { buildPlane, updatePlaneVisual } from './plane.js';
import { FlightModel } from './physics.js';
import { ChaseCam } from './camera.js';
import { WingTrails } from './trails.js';
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

const phys = new FlightModel(heightAt);
const input = new Input();
const chase = new ChaseCam(camera, heightAt);
const trails = new WingTrails(scene, plane.tipL, plane.tipR);
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

// audio needs a user gesture
const startAudio = () => { sound.init(); };
window.addEventListener('keydown', startAudio, { once: true });
window.addEventListener('pointerdown', startAudio, { once: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debug / test hook
window.__ff = { phys, input, chase, reset };

reset();
hud.msg('FLY', 1600);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  input.update(dt);

  const controls = { pitch: input.pitchSm, roll: input.rollSm, yaw: input.yawSm, throttle: input.throttle };
  const steps = 2;
  for (let i = 0; i < steps && !phys.crashed; i++) phys.update(dt / steps, controls);

  if (phys.crashed) {
    sound.crash();
    hud.flash();
    reset('CRASHED');
  }

  syncPlaneToPhysics();
  updatePlaneVisual(plane, input, phys.throttle, dt);
  chase.update(dt, phys);
  trails.update(dt, phys);
  world.update(phys.pos);
  sound.update(dt, phys);
  hud.update(phys);

  renderer.render(scene, camera);
});
