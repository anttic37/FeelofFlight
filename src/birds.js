import * as THREE from 'three';
import { heightAt } from './heightcore.js';
import { ATMO } from './atmosphere.js';

// ---------------------------------------------------------------------------
// BIRDS.
//
// The middle distance is the emptiest part of this world. The ground has detail,
// the sky has cloud, and between them — the 300 m to 1 km band you spend the whole
// flight looking through — there is nothing at all, and nothing moving. A landscape
// with no animals in it reads as a model of a place rather than a place, and the
// cure is cheap: a few dozen specks that soar, circle and scatter.
//
// Everything is ONE draw call. A bird is two triangles; the wings flap in the
// vertex shader off a per-instance phase, so nothing is rebuilt per frame and the
// only upload is the instance matrices.
//
// Deliberately NOT the near-field props' approach. Those (scatter.js) sit on a
// world-aligned cell grid because a static prop that slides or pops is instantly
// wrong. Birds move on their own, so they need no such anchoring — they are simply
// recycled out of the ring behind you into the ring ahead, and faded in over a
// second and a half at a range where a 2 m bird is barely a pixel wide.
// ---------------------------------------------------------------------------

const PARAMS = new URLSearchParams(location.search);
const OFF = PARAMS.get('birds') === '0';

const FLOCKS = +(PARAMS.get('flocks')) || 9;
const MAX_PER_FLOCK = 14;
const CAP = FLOCKS * MAX_PER_FLOCK;

// The ring birds live in. SPAWN sits just inside DESPAWN so a recycled flock
// re-enters at the far edge of vision, never in the middle of it.
const SPAWN_MIN = 620, SPAWN_MAX = 900, DESPAWN = 1150;
const FADE_S = 1.5;

// How close the plane has to come before a flock breaks. 55 m is about a wingspan
// and a half of clearance — near enough that you know you did it.
const STARTLE_R = 55;

const rnd = (a, b) => a + Math.random() * (b - a);

// A bird from above: two triangles meeting at the spine, swept back, with the tips
// lifted into a shallow dihedral so a gliding bird is never a perfectly flat line.
function birdGeometry() {
  const g = new THREE.BufferGeometry();
  const t = 0.06;                       // tip rise, in half-spans
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0.20, -1, t, 0.0, 0, 0, -0.25,   // left wing
    0, 0, 0.20, 0, 0, -0.25, 1, t, 0.0,   // right wing
  ]), 3));
  g.computeVertexNormals();
  return g;
}

export function createBirds(scene) {
  if (OFF) return { update() {}, stats: () => ({ off: true }) };

  const mesh = new THREE.InstancedMesh(birdGeometry(),
    // flatShading derives the normal from screen-space derivatives, which means it
    // shades the FLAPPED wing correctly for free — a stored normal attribute would
    // still describe the rest pose. Lambert, not Basic: a bird has to go dark at
    // dusk with everything else, and against a bright sky it is a silhouette anyway.
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide }),
    CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;    // they move under us every frame
  mesh.castShadow = false;       // a 2 m caster 400 m up contributes nothing
  mesh.receiveShadow = false;
  mesh.count = 0;

  // phase and amplitude of the wingbeat, per bird. Uploaded whole each frame — it is
  // 14 flocks' worth of floats, far cheaper than reasoning about dirty ranges.
  const flap = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2), 2);
  flap.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aFlap', flap);

  mesh.material.onBeforeCompile = (shader) => {
    // Assigning onBeforeCompile on the INSTANCE shadows the Material.prototype hook,
    // so the shared uniforms have to be merged by hand here — same contract groundfx
    // and water live under. ATMO carries the cloud-shadow uniforms too, so this one
    // line is also what lets a bird fly through a cloud shadow.
    Object.assign(shader.uniforms, ATMO);
    shader.vertexShader = 'attribute vec2 aFlap;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
{
  // Rotating the wing properly about the spine costs a sin/cos pair and looks the
  // same at this size, so the beat is a vertical displacement that grows toward the
  // tip, plus a slight fold inward — the shortening is what sells it as a wing
  // rather than a bending plank.
  float w = abs( transformed.x );
  float f = sin( aFlap.x ) * aFlap.y;
  transformed.y += f * pow( w, 1.3 ) * 0.55;
  transformed.x *= 1.0 - 0.18 * abs( f ) * w;
}`);
  };
  scene.add(mesh);

  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3();
  const quat = new THREE.Quaternion(), scl = new THREE.Vector3(), eul = new THREE.Euler();
  const col = new THREE.Color();
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

  // Plumage. Mostly dark — against sky or ground a bird is a silhouette — with a
  // minority of pale seabirds, which are the ones that actually catch the sun.
  function plumage() {
    const r = Math.random();
    if (r < 0.22) return [0.86, 0.87, 0.84];        // gull white
    if (r < 0.40) return [0.42, 0.38, 0.31];        // brown raptor
    return [0.13 + Math.random() * 0.1, 0.13 + Math.random() * 0.09, 0.14 + Math.random() * 0.1];
  }

  const flocks = [];
  for (let i = 0; i < FLOCKS; i++) flocks.push(newFlock(null));

  function newFlock(planePos) {
    const n = 4 + Math.floor(Math.random() * (MAX_PER_FLOCK - 4));
    const f = {
      c: new THREE.Vector3(), heading: rnd(0, Math.PI * 2),
      // Thermal soaring: the flock orbits a column while drifting downwind. Turn
      // rate and radius are per-flock so no two circle in step.
      turn: rnd(0.10, 0.34) * (Math.random() < 0.5 ? -1 : 1),
      speed: rnd(7, 15),
      orbit: rnd(35, 110), orbitPh: rnd(0, Math.PI * 2),
      climb: rnd(-0.5, 1.4),
      agl: rnd(35, 180),
      startle: 0, fade: 0,
      birds: [],
    };
    for (let i = 0; i < n; i++) {
      f.birds.push({
        // loose cluster, wider across than deep, the way a soaring flock stacks
        o: new THREE.Vector3(rnd(-26, 26), rnd(-14, 14), rnd(-26, 26)),
        span: rnd(0.9, 1.4),
        rate: rnd(3.4, 6.2), ph: rnd(0, Math.PI * 2),
        amp: rnd(0.5, 0.95),
        bob: rnd(0, Math.PI * 2),
        col: plumage(),
      });
    }
    placeFlock(f, planePos);
    return f;
  }

  function placeFlock(f, planePos) {
    const a = rnd(0, Math.PI * 2), d = rnd(SPAWN_MIN, SPAWN_MAX);
    const x = (planePos ? planePos.x : 0) + Math.cos(a) * d;
    const z = (planePos ? planePos.z : 0) + Math.sin(a) * d;
    f.c.set(x, Math.max(0, heightAt(x, z)) + f.agl, z);
    f.fade = 0;
    f.startle = 0;
  }

  let last = -1;
  let live = 0;

  function update(planePos, time = 0) {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, time - last));
    last = time;

    let n = 0;
    for (const f of flocks) {
      if (f.c.distanceTo(planePos) > DESPAWN) placeFlock(f, planePos);
      f.fade = Math.min(1, f.fade + dt / FADE_S);

      // STARTLE. The flock breaks outward and beats hard, then re-forms. Measured
      // against the flock centre rather than per bird: a flock scatters as a unit,
      // and one bird reacting while its neighbours glide on looks like a bug.
      const near = f.c.distanceTo(planePos);
      if (near < STARTLE_R) f.startle = 1;
      f.startle = Math.max(0, f.startle - dt * 0.45);

      f.heading += f.turn * dt * (1 + f.startle * 2.2);
      f.orbitPh += dt * f.speed / Math.max(8, f.orbit);
      const sp = f.speed * (1 + f.startle * 1.6);
      f.c.x += Math.sin(f.heading) * sp * dt;
      f.c.z += Math.cos(f.heading) * sp * dt;
      // Climb while soaring, dive while fleeing, and never below the ridge.
      f.c.y += (f.climb - f.startle * 9) * dt;
      const floor = Math.max(0, heightAt(f.c.x, f.c.z)) + 18;
      const ceil = Math.max(0, heightAt(f.c.x, f.c.z)) + 240;
      if (f.c.y < floor) f.c.y = floor;
      if (f.c.y > ceil) f.c.y = ceil;

      for (const b of f.birds) {
        if (n >= CAP) break;
        b.ph += dt * b.rate * (1 + f.startle * 1.9);
        b.bob += dt * 0.7;
        // The scatter: offsets pushed outward and upward while startled.
        const push = 1 + f.startle * 1.9;
        pos.set(f.c.x + b.o.x * push + Math.cos(f.orbitPh + b.bob) * f.orbit * 0.35,
          f.c.y + b.o.y * push + Math.sin(b.bob) * 1.6 + f.startle * 6,
          f.c.z + b.o.z * push + Math.sin(f.orbitPh + b.bob) * f.orbit * 0.35);
        // Face the flock's heading, banked into the turn — a soaring bird is
        // always leaning, and a level one reads as a paper dart.
        eul.set(0, f.heading, -f.turn * 1.7 * (1 + f.startle));
        quat.setFromEuler(eul);
        const s = b.span * f.fade;
        scl.set(s, s, s * 1.15);
        mtx.compose(pos, quat, scl);
        mesh.setMatrixAt(n, mtx);
        col.setRGB(b.col[0], b.col[1], b.col[2]);
        mesh.setColorAt(n, col);
        // Wings go still and wide when soaring, hard and deep when fleeing.
        flap.array[n * 2] = b.ph;
        flap.array[n * 2 + 1] = b.amp * (0.45 + f.startle * 0.75);
        n++;
      }
    }
    for (let i = n; i < live; i++) mesh.setMatrixAt(i, HIDE);
    live = n;
    mesh.count = Math.max(n, 0);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    flap.needsUpdate = true;
  }

  return {
    update,
    stats: () => ({ flocks: flocks.length, birds: live,
      startled: flocks.filter(f => f.startle > 0.01).length }),
  };
}
