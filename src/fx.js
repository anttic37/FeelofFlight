import * as THREE from 'three';
import { SURFACE_TINT } from './atmosphere.js';

// Pooled ground-contact puffs: touchdown bursts + rolling dust. Normal
// blending (smoke/dust must read solid, not glowy), soft radial canvas
// sprite, fixed pool recycled round-robin — zero allocation at runtime.

// 120 was sized for ground contact alone. Exhaust runs ~60 puffs/s for about a second, so
// on the deck in overdrive it would evict the wash and dust it shares the pool with — the
// recycling is round-robin, and the newest spawn always wins.
const POOL = 200;
// Flame gets its own pool rather than sharing: it is additive where the smoke is not, and
// at ~46/s it would otherwise evict the smoke and dust from the shared round-robin.
const FLAME_POOL = 40;
const COL_FLAME = new THREE.Color(1.0, 0.42, 0.10);
const COL_SMOKE = new THREE.Color(0xd3d3cd); // grey-white, runway
const COL_DUST = new THREE.Color(0xb29062);  // sandy-brown, grass
const COL_SPRAY = new THREE.Color(0xe4f1f4); // pale, water
const COL_EXHAUST = new THREE.Color(0x4a4844); // dark, oily — engine smoke, not dust

function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createFX(scene) {
  const tex = makePuffTexture();
  const group = new THREE.Group();
  scene.add(group);

  const sprites = [];
  const age = new Float32Array(POOL);
  const life = new Float32Array(POOL); // -1 = free slot
  const vel = new Float32Array(POOL * 3);
  const s0 = new Float32Array(POOL);
  const s1 = new Float32Array(POOL);
  const op = new Float32Array(POOL);
  const spin = new Float32Array(POOL);
  let cursor = 0;
  let emitAcc = 0;
  let washAcc = 0;
  let odAcc = 0;
  let flAcc = 0;
  const p = new THREE.Vector3();   // scratch: exhaust spawn point, body -> world

  // --- flame pool: additive, tiny, gone in a tenth of a second
  const flames = [];
  const flAge = new Float32Array(FLAME_POOL);
  const flLife = new Float32Array(FLAME_POOL);   // -1 = free
  const flVel = new Float32Array(FLAME_POOL * 3);
  const flS0 = new Float32Array(FLAME_POOL);
  const flS1 = new Float32Array(FLAME_POOL);
  const flOp = new Float32Array(FLAME_POOL);
  let flCursor = 0;

  for (let i = 0; i < POOL; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0,
    }));
    s.visible = false;
    s.renderOrder = 5; // above terrain/water/clouds
    group.add(s);
    sprites.push(s);
    life[i] = -1;
  }

  for (let i = 0; i < FLAME_POOL; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0,
      blending: THREE.AdditiveBlending, color: COL_FLAME,
      // not tone mapped, like the sun sprite and the beacon: flame should sit at the top of
      // the range and bloom, not be pulled back down the ACES curve with the landscape
      toneMapped: false,
    }));
    s.visible = false;
    s.renderOrder = 6;   // above the smoke, so it is never dimmed by its own exhaust
    group.add(s);
    flames.push(s);
    flLife[i] = -1;
  }

  function spawnFlame(x, y, z, opac, size0, size1, dur, vx, vy, vz) {
    const i = flCursor;
    flCursor = (flCursor + 1) % FLAME_POOL;
    const s = flames[i];
    s.position.set(x, y, z);
    s.material.rotation = Math.random() * Math.PI * 2;
    s.scale.set(size0, size0, 1);
    s.visible = true;
    flAge[i] = 0;
    flLife[i] = dur;
    flS0[i] = size0;
    flS1[i] = size1;
    flOp[i] = opac;
    flVel[i * 3] = vx;
    flVel[i * 3 + 1] = vy;
    flVel[i * 3 + 2] = vz;
  }

  function spawn(x, y, z, color, opac, size0, size1, dur, vx, vy, vz) {
    const i = cursor;
    cursor = (cursor + 1) % POOL; // steal oldest slot when the pool is full
    const s = sprites[i];
    s.position.set(x, y, z);
    // TINTED AT SPAWN. A SpriteMaterial is unlit, so dust, spray and exhaust smoke were all
    // drawing their midday colours at every hour — grey-white spray kicking up under a red
    // sunset. Applied once per puff rather than per frame because there are 200 of these,
    // each with its own material; a puff lives a second or two, which is far shorter than
    // any part of the cycle, so it cannot drift far from the light it was born in.
    // Flame is deliberately NOT here: it is its own light source, and the same treatment
    // would have a fire turn blue at dusk.
    s.material.color.copy(color).multiply(SURFACE_TINT);
    s.material.rotation = Math.random() * Math.PI * 2;
    s.scale.set(size0, size0, 1);
    s.visible = true;
    age[i] = 0;
    life[i] = dur;
    s0[i] = size0;
    s1[i] = size1;
    op[i] = opac;
    spin[i] = (Math.random() - 0.5) * 1.6;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
  }

  // A DUST RING, NOT A CLOUD ON THE CAMERA. This used to spawn inside a 2 m radius of the
  // aeroplane's own centre, at up to 7 m across and 0.8 opacity — 18 of them, on top of an
  // 8 m airframe, so the thing you crashed vanished behind its own dust at the one moment
  // you want to watch it. Real impact dust is thrown OUT from the contact and hangs low; the
  // hole in the middle is what lets you see the wreck. So: spawn on a ring that starts
  // outside the wingspan, keep it at ground level rather than at the fuselage, and throw it
  // outward rather than up.
  // THE BURST IS SIZED BY WHAT ACTUALLY TOUCHES THE GROUND. `rad` is the half-width of the
  // contact, in metres, and every term below is derived from it.
  //
  // It used to be a fixed 6-11 m ring with puffs up to 6 m across, on the reasoning that it
  // should clear "the 10.7 m wingspan". Two things were wrong with that. The wingspan is not
  // what touches: on a landing it is the main gear, whose tyres are 1.65 m either side of the
  // centreline, so the dust appeared in a ring four to seven times wider than the thing making
  // it. And in a CRASH the wings are already gone — wreckage.js shears them at 15 m/s — so the
  // body throwing the dust is 0.68 m wide and the ring was up to sixteen times too big. Either
  // way the effect had no visible relationship to the aeroplane, which is exactly how it read.
  //
  // The small constants that survive are there so a narrow contact still makes a plume rather
  // than a point: dust spreads wider than the object dragging through it, just not by 16x.
  function touchdown(pos, groundType, sink, rad = 1.6) {
    const k = Math.min(1, Math.max(0, sink) / 6); // 6 m/s sink = max drama
    const color = groundType === 'grass' ? COL_DUST : groundType === 'water' ? COL_SPRAY : COL_SMOKE;
    // a wider contact disturbs more ground, so it throws more puffs — but not many more
    const n = Math.round(6 + k * 5 + Math.min(7, rad * 1.3));
    const s0 = 0.35 + rad * 0.30;                  // puff diameter at birth, from the contact
    for (let i = 0; i < n; i++) {
      // evenly spaced around the ring, jittered — clumps left bald patches on one side
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const r = rad * 0.55 + Math.random() * (rad * 0.9 + 1.1);
      const out = (1.4 + Math.random() * 1.8) * (0.55 + rad * 0.2);
      spawn(
        pos.x + Math.cos(a) * r, pos.y - 1.2 + Math.random() * 0.6, pos.z + Math.sin(a) * r,
        color, 0.42 + k * 0.18,
        s0 * (0.85 + Math.random() * 0.3), s0 * (2.6 + k * 1.6),
        1 + Math.random() * 0.4,
        Math.cos(a) * out, 0.5 + Math.random() * 1.2, Math.sin(a) * out,
      );
    }
  }

  function update(dt, phys) {
    // LOW PASS WASH: propwash and wingtip vortices scuff the surface when you
    // scream past a few metres up. Nothing sells "fast and low" like the ground
    // reacting to you — emitted behind and below, so it streams away astern.
    if (!phys.grounded && !phys.crashed && phys.speed > 28) {
      const agl = phys.altitude;
      if (agl < 18) {
        const k = (1 - agl / 18) * Math.min(1, (phys.speed - 28) / 40);
        washAcc += dt * k * 34;
        while (washAcc >= 1) {
          washAcc -= 1;
          // trail it ASTERN: spawned under the nose the plume is hidden by the
          // aircraft itself, and the puff spends its bright early life there
          const sp = Math.max(1, phys.speed);
          const back = 6 + Math.random() * 14;
          const bx = phys.pos.x - (phys.vel.x / sp) * back;
          const bz = phys.pos.z - (phys.vel.z / sp) * back;
          const s = phys.surfaceAt(bx, bz);
          const water = s.type === 'water';
          const gy = water ? 0.1 : Math.max(0, s.h);
          spawn(
            bx + (Math.random() - 0.5) * 11,
            gy + 0.4 + Math.random() * 0.9,
            bz + (Math.random() - 0.5) * 11,
            water ? COL_SPRAY : (s.type === 'runway' ? COL_SMOKE : COL_DUST),
            // the u^1.5 fade eats most of this, so it starts high on purpose
            (water ? 1.0 : 0.9) * k,
            2.6 + Math.random() * 1.6, 10 + Math.random() * 5,
            0.9 + Math.random() * 0.7,
            (Math.random() - 0.5) * 3, (water ? 1.8 : 1.1) + Math.random(), (Math.random() - 0.5) * 3,
          );
        }
      } else washAcc = 0;
    } else washAcc = 0;

    // EXHAUST SMOKE while the engine is being forced past its stop. Spawned at the stacks
    // and given the aircraft's own velocity minus a bit, so it falls astern instead of
    // hanging in the air where it was born — at 90 m/s a puff with no inherited velocity is
    // a stationary blob the aeroplane visibly flies away from.
    const od = phys.overdrive || 0;
    if (od > 0.05 && !phys.crashed) {
      // THIN. Both numbers matter and only one of them is obvious: at 60 puffs a second with
      // a one second life there are ~60 alive at once, all stacked along the same line
      // astern — which is exactly where the chase camera sits. Twenty overlapping puffs at
      // 0.5 alpha each are effectively opaque however "light" any single one looks, so the
      // rate had to come down with the opacity or it stays a wall you fly inside.
      odAcc += dt * od * 22;
      while (odAcc >= 1) {
        odAcc -= 1;
        // the stacks sit just behind and below the cowling, both sides
        const back = 2.4 + Math.random() * 1.2;
        const side = (Math.random() < 0.5 ? -1 : 1) * 0.7;
        p.set(side, -0.25, back).applyQuaternion(phys.quat).add(phys.pos);
        spawn(
          p.x, p.y, p.z,
          COL_EXHAUST,
          0.075 * od,
          0.4 + Math.random() * 0.3, 3.2 + Math.random() * 1.8,
          0.7 + Math.random() * 0.4,
          phys.vel.x * 0.72 + (Math.random() - 0.5) * 2,
          phys.vel.y * 0.72 + 0.6 + Math.random(),
          phys.vel.z * 0.72 + (Math.random() - 0.5) * 2,
        );
      }

      // FLAME at the stacks. Additive and very short-lived, so it reads as light coming off
      // the aeroplane rather than as more matter hanging behind it — which is the whole
      // reason it lives in its own pool instead of the smoke's: additive stacked on additive
      // brightens, it never occludes, so it can be dense without costing visibility.
      flAcc += dt * od * 46;
      while (flAcc >= 1) {
        flAcc -= 1;
        const side = (Math.random() < 0.5 ? -1 : 1) * (0.62 + Math.random() * 0.14);
        p.set(side, -0.22, 2.5 + Math.random() * 0.5).applyQuaternion(phys.quat).add(phys.pos);
        spawnFlame(
          p.x, p.y, p.z,
          0.55 + Math.random() * 0.45,
          0.28 + Math.random() * 0.22, 0.75 + Math.random() * 0.4,
          0.10 + Math.random() * 0.09,
          phys.vel.x, phys.vel.y, phys.vel.z,
        );
      }
    } else { odAcc = 0; flAcc = 0; }

    if (phys.grounded && phys.speed > 8) {
      emitAcc += dt * (1 + Math.min(1, (phys.speed - 8) / 32)); // 1-2 puffs/sec
      while (emitAcc >= 1) {
        emitAcc -= 1;
        const rwy = phys.onRunwaySurface;
        spawn(
          phys.pos.x + (Math.random() - 0.5) * 1.5,
          phys.pos.y - 1.5,
          phys.pos.z + (Math.random() - 0.5) * 1.5,
          rwy ? COL_SMOKE : COL_DUST,
          rwy ? 0.16 : 0.4,
          1 + Math.random() * 0.6, 2.5 + Math.random(),
          0.9 + Math.random() * 0.4,
          Math.random() - 0.5, 0.6 + Math.random() * 0.6, Math.random() - 0.5,
        );
      }
    } else {
      emitAcc = 0;
    }

    for (let i = 0; i < POOL; i++) {
      if (life[i] < 0) continue;
      age[i] += dt;
      const s = sprites[i];
      if (age[i] >= life[i]) {
        life[i] = -1;
        s.visible = false;
        continue;
      }
      const drag = Math.max(0, 1 - dt * 1.6);
      vel[i * 3] *= drag;
      vel[i * 3 + 2] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag + dt * 0.5; // buoyant drift as it thins
      s.position.x += vel[i * 3] * dt;
      s.position.y += vel[i * 3 + 1] * dt;
      s.position.z += vel[i * 3 + 2] * dt;
      s.material.rotation += spin[i] * dt;
      const t = age[i] / life[i];
      const sc = s0[i] + (s1[i] - s0[i]) * t;
      s.scale.set(sc, sc, 1);
      const u = 1 - t;
      s.material.opacity = op[i] * u * Math.sqrt(u);
    }

    // flame: no drag and no buoyancy — it is gone long before either would show. Fades on
    // t^2 so it dies hard rather than lingering as a soft orange smear.
    for (let i = 0; i < FLAME_POOL; i++) {
      if (flLife[i] < 0) continue;
      flAge[i] += dt;
      const s = flames[i];
      if (flAge[i] >= flLife[i]) {
        flLife[i] = -1;
        s.visible = false;
        continue;
      }
      s.position.x += flVel[i * 3] * dt;
      s.position.y += flVel[i * 3 + 1] * dt;
      s.position.z += flVel[i * 3 + 2] * dt;
      const t = flAge[i] / flLife[i];
      const sc = flS0[i] + (flS1[i] - flS0[i]) * t;
      s.scale.set(sc, sc, 1);
      const u = 1 - t;
      s.material.opacity = flOp[i] * u * u;
    }
  }

  return { touchdown, update };
}
