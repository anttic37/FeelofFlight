import { heightAt } from './heightcore.js';

// A SPIKE: hand the crash to Rapier instead of our own wreck integrator, behind ?physics=rapier.
// The flight model is untouched — this only takes over once the airframe is already broken,
// which is the one place a real solver buys something we cannot easily hand-roll: an actual
// SHAPE hitting actual ground, so a wingtip digs in and levers the thing over because the wing
// is there, not because a lever term was written to make it happen.
//
// It is loaded from a CDN as prebuilt WASM, so the no-build-step rule survives: rapier3d-compat
// inlines its own binary, so there is no second fetch and no bundler. Measured 665 ms from
// import to ready, and none of it is paid unless a crash happens with the flag on.
//
// TRIMESH, NOT HEIGHTFIELD, and that is a deliberate retreat. Rapier has a heightfield collider
// and it would be the natural fit, but its index-to-axis convention did not match what I
// assumed — a two-cell test field with heights varying along one index rested probes at -8.7
// and 14 where the mapping I had predicted 2.5 and 8.5. Rather than reverse-engineer a
// convention I would then be relying on, the ground goes in as a triangle mesh built from our
// own heightAt samples, where every vertex position is ours and there is nothing to get wrong.
const CDN = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';

// Ground patch: big enough that a fast wreck cannot slide off it. The longest slide measured
// on the hand-rolled path was 260 m from 300 km/h, so 1400 m centred on the impact is roomy.
const SPAN = 1400, CELLS = 64;

// The airframe as it actually is, in body axes (fwd -Z, up +Y, right +X). This is the whole
// point of the exercise: five sample points cannot catch a wing on a slope, a wing can.
const PARTS = [
  { h: [0.8, 0.8, 4.0], p: [0, 0, 0] },        // fuselage
  { h: [5.5, 0.15, 0.8], p: [0, -0.1, 0.3] },  // wing
  { h: [1.8, 0.12, 0.5], p: [0, 0.2, 3.4] },   // tailplane
  { h: [0.12, 0.9, 0.5], p: [0, 0.9, 3.4] },   // fin
];

// One named place for everything the crash FEELS like, because these are the numbers that get
// swept. Friction is the one that matters and 0.35 is deliberate: torn metal on grass is not a
// tyre on tarmac, and the first pass at 0.85/0.9 stopped a 200 km/h wreck in 22 m where the
// hand-rolled path took 89. Rapier averages the two colliders' friction, so both sides are set.
export const tune = {
  groundFriction: 0.45,
  airframeFriction: 0.45,
  restitution: 0.06,
  linDamp: 0.01,
  angDamp: 0.14,
  mass: 1000,
};

let RAPIER = null;
let loading = null;

export function preloadRapier() {
  if (!loading) loading = import(/* @vite-ignore */ CDN).then(async (m) => { await m.init(); RAPIER = m; return m; });
  return loading;
}

export function createRapierCrash() {
  let world = null, body = null, ready = false;

  const begin = (phys) => {
    if (!RAPIER) return false;                 // not loaded yet: caller keeps the built-in path
    end();  // a World is WASM memory the GC cannot see, so an unpaired begin() leaks it for good
    const R = RAPIER;
    world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.integrationParameters.dt = 1 / 60;

    // ground, as our own samples
    const cx = phys.pos.x, cz = phys.pos.z, cell = SPAN / CELLS;
    const n = CELLS + 1;
    const verts = new Float32Array(n * n * 3);
    for (let i = 0, o = 0; i < n; i++) {
      const x = cx - SPAN / 2 + i * cell;
      for (let j = 0; j < n; j++, o += 3) {
        const z = cz - SPAN / 2 + j * cell;
        verts[o] = x; verts[o + 1] = Math.max(heightAt(x, z), -1.0); verts[o + 2] = z;
      }
    }
    const idx = new Uint32Array(CELLS * CELLS * 6);
    for (let i = 0, k = 0; i < CELLS; i++) {
      for (let j = 0; j < CELLS; j++) {
        const a = i * n + j, b = a + n;
        idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
        idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
      }
    }
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
    world.createCollider(
      R.ColliderDesc.trimesh(verts, idx).setFriction(tune.groundFriction).setRestitution(tune.restitution),
      ground,
    );

    // the airframe, carrying the state it broke with
    const q = phys.quat;
    body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(phys.pos.x, phys.pos.y, phys.pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(phys.vel.x, phys.vel.y, phys.vel.z)
        .setAngvel({ x: phys.angVel.x, y: phys.angVel.y, z: phys.angVel.z })
        // CONTINUOUS COLLISION, because a wreck arriving at 80 m/s covers 1.3 m a step and a
        // wing is 0.3 m thick — without it the first contact is simply missed and the airframe
        // is under the hill before anyone notices
        .setCcdEnabled(true)
        .setLinearDamping(tune.linDamp).setAngularDamping(tune.angDamp),
    );
    for (const part of PARTS) {
      world.createCollider(
        R.ColliderDesc.cuboid(part.h[0], part.h[1], part.h[2])
          .setTranslation(part.p[0], part.p[1], part.p[2])
          .setFriction(tune.airframeFriction).setRestitution(tune.restitution)
          // a quarter of the mass in each part, so the total is tune.mass however the boxes
          // are shaped — density is per-volume and the fuselage is 30x the fin
          .setDensity(tune.mass * 0.25 / (8 * part.h[0] * part.h[1] * part.h[2] + 1e-6)),
        body,
      );
    }
    ready = true;
    return true;
  };

  const step = (phys, dt) => {
    if (!ready) return false;
    world.integrationParameters.dt = Math.min(dt, 1 / 30);
    const before = body.linvel();
    world.step();
    const t = body.translation(), r = body.rotation(), v = body.linvel(), w = body.angvel();
    phys.pos.set(t.x, t.y, t.z);
    phys.quat.set(r.x, r.y, r.z, r.w);
    phys.vel.set(v.x, v.y, v.z);
    phys.angVel.set(w.x, w.y, w.z);
    // a sharp loss of speed in one step IS the impact, which is what the dust and the thump
    // are keyed off — read it from the solver rather than guessing at contacts
    const hit = Math.hypot(before.x - v.x, before.y - v.y, before.z - v.z);
    if (hit > 1.5) phys.justWreckHit = Math.min(8, hit * 0.8);
    const surf = phys.surfaceAt(t.x, t.z);
    phys.grounded = surf.type !== 'water' && t.y - Math.max(surf.h, 0) < 3.0;
    phys.onRunwaySurface = surf.type === 'runway';
    phys.speed = phys.vel.length();
    phys.airspeed = phys.speed;
    phys.gLoad = 1; phys.stalled = false; phys.stallMargin = 0; phys.overspeed = 0;
    phys.wreckSettled = body.isSleeping()
      || (phys.speed < 0.7 && Math.hypot(w.x, w.y, w.z) < 0.4 && phys.grounded);
    return true;
  };

  const end = () => {
    if (world) world.free();
    world = null; body = null; ready = false;
  };

  return { begin, step, end, get active() { return ready; } };
}
