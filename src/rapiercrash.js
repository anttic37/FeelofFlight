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
  // 0.65, RE-TUNED because filleting the corners changed the regime. 0.45 was chosen when the
  // airframe was sharp boxes that PLOUGHED; a rounded body ROLLS, carries further on the same
  // number, and stops arriving at rest. Measured over four crashes at 190-256 km/h: 0.45 gives
  // 151 m and settles in 2 of 3, 0.65 gives 147 m and settles in 4 of 4, 7.3 s, with the jerk
  // slightly lower too. Almost the same distance, reliably ended.
  groundFriction: 0.65,
  airframeFriction: 0.65,
  // 0.01, not 0.06. An airframe arriving at 200 km/h is the SOFT body in this collision — it
  // folds, and folding returns almost nothing. Any real restitution makes it ping off the
  // ground like something hard, which is half of what reads as "two diamonds hitting".
  restitution: 0.01,
  linDamp: 0.01,
  // 0.12. Damping is the one thing that argues with a rolling capsule, and it does not need to
  // do the stopping — friction eats the speed on its own, and the wreck settles either way.
  // Measured across the same six crashes: 0.30 gives 1.57 turns, 0.12 gives 1.89, 0.05 gives
  // 1.07 and takes longest to stop. 0.12 rolls most and still comes to rest.
  angDamp: 0.12,
  // CRUMPLE. Rapier bodies are rigid by definition, so the energy a real airframe spends
  // deforming has to be taken out by hand or it stays in the tumble. On a hard contact this
  // bleeds SPIN, in proportion to how hard the hit was — the linear slide is left alone,
  // because sliding a long way is correct and was asked for; it is the snap into a new
  // rotation that reads as brittle.
  // 0.02, not 0.10. The crumple exists to kill the SNAP, not the tumble, and at 0.10 it was
  // killing both: 0.29 revolutions over a 135 m crash, which is a wreck sliding flat on its
  // belly. At 0.02 the same crashes turn 1.5-2.0 times and the snap stays gone.
  crumple: 0.02,
  // A box on flat ground only tips when friction can lift it over its own leading edge —
  // mu * h > b/2, which here means mu > 1.0 — and at friction 1.6 it does not roll either, it
  // just stops (58 m, 0.75 turns). Flat-ground friction is not how a wreck rolls. Rather than
  // model the soil catching a leading edge, the FUSELAGE IS A CAPSULE, which rolls because it
  // is round. Simpler, and it is the true shape of a fuselage anyway. See the collider loop.
  // Corner radius for the airframe boxes. Sharp box corners are what catch and pivot; a
  // filleted edge slides off. SMALL, and that is the whole lesson of tuning it: a fillet is a
  // continuum from box to cylinder, and anywhere past a few centimetres the airframe starts
  // ROLLING instead of sliding. At 0.16 m on a 1.36 m fuselage the wreck slid 280 m and came
  // to rest on its side at 90 degrees in four runs out of four, half of them never settling
  // at all — the same barrel failure as the capsule, just slower to arrive. 0.07 m takes the
  // knife off the edges and leaves the flats that stop it. Scaled by the part's own thinnest
  // half-extent so a 0.06 m elevator does not get a fillet wider than it is.
  fillet: 0.35, filletMax: 0.07,
  // Density per cubic metre of bounding box, not a total mass. The intact aeroplane measures
  // ~34 m^3 of boxes, so 29 puts it near a tonne — and a wreck that has lost both wings comes
  // out genuinely lighter, which is right, because the wings are lying in a field behind it.
  density: 29,
};

let RAPIER = null;
let loading = null;

// THE FIRST CRASH OF A SESSION COST 680 ms, every session, and no later one cost more than 17.
// Loading the module and calling init() is not enough: the collision pipeline itself — the
// trimesh/round-cuboid narrow phase, the island solver — only compiles the first time it is
// actually run, and that landed on the frame of the player's first impact. So a throwaway world
// of the same SHAPES is built and stepped here, at load, where a few hundred milliseconds cost
// nothing because it is off the critical path and the aeroplane is still on the runway.
// Deliberately the same shape types the real crash uses (trimesh ground, round cuboid body):
// warming a sphere-on-plane would compile none of the code that actually runs.
function warmUp(R) {
  const w = new R.World({ x: 0, y: -9.81, z: 0 });
  const n = 3, verts = new Float32Array(n * n * 3);
  for (let i = 0, o = 0; i < n; i++) for (let j = 0; j < n; j++, o += 3) {
    verts[o] = i * 10 - 10; verts[o + 1] = 0; verts[o + 2] = j * 10 - 10;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let i = 0, k = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = a + n;
    idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
  }
  const g = w.createRigidBody(R.RigidBodyDesc.fixed());
  w.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(0.6), g);
  const b = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 3, 0)
    .setLinvel(6, -8, 4).setCcdEnabled(true));
  w.createCollider(R.ColliderDesc.roundCuboid(0.6, 0.6, 3, 0.07).setDensity(29), b);
  // Long enough for it to land, tumble AND fall asleep, because sleeping is its own uncompiled
  // path: with a 45-step warm-up the first crash dropped from 680 ms to 11.5 ms and the cost
  // reappeared, whole, on the second one — the first crash that happened to come to rest
  // quickly. The island deactivation runs once and compiles once. Reading isSleeping() and
  // waking it again covers the query and wake sides too.
  for (let i = 0; i < 240; i++) w.step();
  b.isSleeping(); b.sleep(); w.step(); b.wakeUp(); w.step();
  w.free();
}

export function preloadRapier() {
  if (!loading) loading = import(/* @vite-ignore */ CDN).then(async (m) => {
    await m.init(); RAPIER = m;
    try { warmUp(m); } catch (e) { console.warn('[ff] rapier warm-up skipped', e); }
    return m;
  });
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
    // NOTHING HERE HAS A SHARP CORNER ANY MORE, and that is the whole of "it rolls like a
    // diamond". A box on a triangle mesh does not roll: it pivots about a vertex, stops dead
    // on an edge, and snaps into a new axis when the next corner catches. Two faceted solids
    // trading corners is exactly what it looked like, because that is exactly what it was.
    parts = measureParts(plane);
    for (const part of parts) {
      // THE FUSELAGE IS A CAPSULE, and everything else is a filleted box.
      //
      // A capsule is the true shape of a fuselage and it is the only shape here that can ROLL:
      // round bodies roll, boxes slide and occasionally trip. I had rejected it once for
      // rolling too freely — 197-312 m, resting on its side, not settled after ten seconds —
      // but rolling is the point. A wreck at 200 km/h tumbles; it does not skid to a halt flat
      // on its belly like a dropped crate, which is what the boxes gave (0.29 turns over
      // 135 m). Coming to rest on its side is also correct for a fuselage with both wings torn
      // off: the remaining body is 1.36 x 1.35 m in section, so "on its side" and "belly down"
      // are the same four faces. What DID have to be fixed is that it never stopped, and that
      // is friction and angular damping, not shape.
      const [hx, hy, hz] = part.half;
      let desc;
      if (part.name === 'Fuselage') {
        const rad = Math.min(hx, hy);
        desc = R.ColliderDesc.capsule(Math.max(0.05, hz - rad), rad)
          // Rapier capsules run along Y; the fuselage runs along Z, a quarter turn about X.
          .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });
      } else {
        // Wings, tail and fin keep their boxes with the edges taken off, so nothing has a
        // knife edge to catch and snap on. roundCuboid's radius is ADDED to the half-extents,
        // so they are shrunk by it first and the part stays the size the model says it is.
        const r = Math.min(tune.filletMax, Math.min(hx, hy, hz) * tune.fillet);
        desc = R.ColliderDesc.roundCuboid(
          Math.max(0.01, hx - r), Math.max(0.01, hy - r), Math.max(0.01, hz - r), r);
      }
      world.createCollider(
        desc
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
    if (hit > 1.5) {
      phys.justWreckHit = Math.min(8, hit * 0.8);
      // CRUMPLE. A Rapier body is rigid by definition, so the energy a real airframe spends
      // folding itself has nowhere to go and comes back out as spin — the wreck picks up a
      // new rotation on every hard contact and keeps it. Take it out on the way in instead,
      // scaled by how hard the hit was. SPIN ONLY: the linear slide is correct and is the
      // thing that was asked for; it is the snap into a new rotation that reads as brittle.
      const k = Math.max(0, 1 - Math.min(0.6, hit * tune.crumple));
      body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
      phys.angVel.multiplyScalar(k);
    }
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
