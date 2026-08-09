import { heightAt } from './heightcore.js';
import { measureParts } from './airframe.js';

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

// Ground patch: big enough that a fast wreck cannot slide off it, and no bigger, because
// SAMPLING IT IS THE WHOLE COST OF A CRASH. Measured: the build takes 9.5 ms, of which 7.4 ms
// (78%) is heightAt — 4225 calls at 65x65 — while the typed arrays are 0.2 ms and Rapier's own
// collider construction 1.9 ms. That lands on one frame, the one right after impact, against a
// 0.1 ms baseline, which is a dropped frame exactly when the screen is most interesting: the
// "slight stop" on contact.
// 1000 m at 44 cells keeps the CELL SIZE essentially unchanged (22.7 m against 21.9 m) and
// cuts the sample count by 52%, to 2025. The span still covers +-500 m against a longest
// measured slide of 345 m, so the wreck cannot reach the edge; there is no fidelity traded
// here, only patch that was never driven over.
const SPAN = 1000, CELLS = 44;

// The airframe is measured off the model, not typed here — see airframe.js. This is the whole
// point of the exercise: five sample points cannot catch a wing on a slope, a wing can, and it
// has to be the wing the model actually has.

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
  // Density per cubic metre of bounding box, not a total mass. The intact aeroplane measures
  // ~34 m^3 of boxes, so 29 puts it near a tonne — and a wreck that has lost both wings comes
  // out genuinely lighter, which is right, because the wings are lying in a field behind it.
  density: 29,
};

let RAPIER = null;
let loading = null;

export function preloadRapier() {
  if (!loading) loading = import(/* @vite-ignore */ CDN).then(async (m) => { await m.init(); RAPIER = m; return m; });
  return loading;
}

export function createRapierCrash(plane) {
  let world = null, body = null, ready = false, pending = false, parts = null;

  // ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE. main.js runs startWreck() and only THEN
  // wreckage.breakUp(), so at begin() the wings are still on an aeroplane that is about to
  // lose them. Building the colliders here would give the wreck a 10.7 m span it no longer
  // has and stand it up on wings that are not there — the exact float being fixed. So begin()
  // only arms; the body is built on the first step(), by which time breakUp() has run and the
  // scene graph is the truth.
  const begin = () => {
    if (!RAPIER) return false;                 // not loaded yet: caller keeps the built-in path
    pending = true;
    return true;
  };

  const build = (phys) => {
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
    // one box per assembly still attached to the model, measured this instant
    parts = measureParts(plane);
    for (const part of parts) {
      world.createCollider(
        R.ColliderDesc.cuboid(part.half[0], part.half[1], part.half[2])
          .setTranslation(part.pos[0], part.pos[1], part.pos[2])
          .setFriction(tune.airframeFriction).setRestitution(tune.restitution)
          .setDensity(tune.density),
        body,
      );
    }
    ready = true;
    return true;
  };

  const step = (phys, dt) => {
    if (pending) { pending = false; build(phys); }
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
    world = null; body = null; ready = false; pending = false;
  };

  return { begin, step, end, get active() { return ready; }, get parts() { return parts; } };
}
