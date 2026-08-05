import * as THREE from 'three';

// Pooled ground-contact puffs: touchdown bursts + rolling dust. Normal
// blending (smoke/dust must read solid, not glowy), soft radial canvas
// sprite, fixed pool recycled round-robin — zero allocation at runtime.

// 120 was sized for ground contact alone. Exhaust runs ~60 puffs/s for about a second, so
// on the deck in overdrive it would evict the wash and dust it shares the pool with — the
// recycling is round-robin, and the newest spawn always wins.
const POOL = 200;
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
  const p = new THREE.Vector3();   // scratch: exhaust spawn point, body -> world

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

  function spawn(x, y, z, color, opac, size0, size1, dur, vx, vy, vz) {
    const i = cursor;
    cursor = (cursor + 1) % POOL; // steal oldest slot when the pool is full
    const s = sprites[i];
    s.position.set(x, y, z);
    s.material.color.copy(color);
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

  function touchdown(pos, groundType, sink) {
    const k = Math.min(1, Math.max(0, sink) / 6); // 6 m/s sink = max drama
    const color = groundType === 'grass' ? COL_DUST : groundType === 'water' ? COL_SPRAY : COL_SMOKE;
    const n = Math.round(10 + k * 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2;
      const out = 1 + Math.random() * 2;
      spawn(
        pos.x + Math.cos(a) * r, pos.y + 0.2 + Math.random() * 0.5, pos.z + Math.sin(a) * r,
        color, 0.55 + k * 0.25,
        (1.5 + Math.random() * 0.5) * (1 + k * 0.5), (4 + Math.random()) * (1 + k * 0.5),
        1 + Math.random() * 0.4,
        Math.cos(a) * out, 1 + Math.random() * 2, Math.sin(a) * out,
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
      odAcc += dt * od * 60;
      while (odAcc >= 1) {
        odAcc -= 1;
        // the stacks sit just behind and below the cowling, both sides
        const back = 2.4 + Math.random() * 1.2;
        const side = (Math.random() < 0.5 ? -1 : 1) * 0.7;
        p.set(side, -0.25, back).applyQuaternion(phys.quat).add(phys.pos);
        spawn(
          p.x, p.y, p.z,
          COL_EXHAUST,
          0.52 * od,
          0.45 + Math.random() * 0.35, 6.5 + Math.random() * 3.5,
          0.85 + Math.random() * 0.55,
          phys.vel.x * 0.72 + (Math.random() - 0.5) * 2,
          phys.vel.y * 0.72 + 0.6 + Math.random(),
          phys.vel.z * 0.72 + (Math.random() - 0.5) * 2,
        );
      }
    } else odAcc = 0;

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
  }

  return { touchdown, update };
}
