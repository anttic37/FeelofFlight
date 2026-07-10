import * as THREE from 'three';

// Procedural low-poly plane, nose along -Z. Control surfaces are hinged groups
// so they visibly deflect: that "stick → surface → plane reacts" chain is the feel.
// Origin sits on the prop axis; main wheel contact is at y ≈ -1.57 with gear down.

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra });
}

// box tapered at its +Y end: top verts scaled in x/z and swept back by shift
function taperTop(w, h, d, sx, sz, shift = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
    p.setX(i, p.getX(i) * sx);
    p.setZ(i, p.getZ(i) * sz + shift);
  }
  g.computeVertexNormals();
  return g;
}

// box tapered at the outboard (sign) end — wing/tailplane halves
function wingPanel(len, thick, chord, sign, sy, sz, shift) {
  const g = new THREE.BoxGeometry(len, thick, chord);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getX(i) * sign > 0) {
    p.setY(i, p.getY(i) * sy);
    p.setZ(i, p.getZ(i) * sz + shift);
  }
  g.computeVertexNormals();
  return g;
}

// octagonal loft nose→tail; material groups: 0 = red top+sides, 1 = cream belly
function fuselageGeo() {
  const S = [
    { z: -3.55, w: 0.42, h: 0.44, y: -0.02 },
    { z: -2.7, w: 0.56, h: 0.6, y: 0 },
    { z: -1.45, w: 0.6, h: 0.66, y: 0.02 },
    { z: -0.05, w: 0.55, h: 0.62, y: 0.05 },
    { z: 1.35, w: 0.4, h: 0.46, y: 0.15 },
    { z: 2.5, w: 0.24, h: 0.3, y: 0.27 },
    { z: 3.5, w: 0.1, h: 0.13, y: 0.35 },
  ];
  const R = 8, pos = [];
  for (const s of S) for (let k = 0; k < R; k++) {
    const a = ((k + 0.5) / R) * Math.PI * 2;
    pos.push(Math.cos(a) * s.w, Math.sin(a) * s.h + s.y, s.z);
  }
  const nose = pos.length / 3;
  pos.push(0, S[0].y, S[0].z - 0.08);
  const tail = nose + 1;
  pos.push(0, S[S.length - 1].y, S[S.length - 1].z + 0.06);
  const top = [], belly = [];
  for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < R; k++) {
    const k2 = (k + 1) % R;
    const a = i * R + k, b = i * R + k2, c = a + R, d = b + R;
    // quads whose mid-angle points down go cream; sides/top red
    const arr = Math.sin(((k + 1) / R) * Math.PI * 2) < -0.35 ? belly : top;
    arr.push(a, b, c, b, d, c);
  }
  const last = (S.length - 1) * R;
  for (let k = 0; k < R; k++) {
    const k2 = (k + 1) % R;
    top.push(nose, k2, k, tail, last + k, last + k2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(top.concat(belly));
  g.addGroup(0, top.length, 0);
  g.addGroup(top.length, belly.length, 1);
  g.computeVertexNormals();
  return g;
}

function discTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(225,228,232,0)');
  grad.addColorStop(0.5, 'rgba(225,228,232,0.3)');
  grad.addColorStop(0.86, 'rgba(240,242,244,0.65)');
  grad.addColorStop(1, 'rgba(240,242,244,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildPlane() {
  const group = new THREE.Group();
  const red = mat(0xd64533);
  const cream = mat(0xf2e9d8);
  const dark = mat(0x2b333d, { metalness: 0.35, roughness: 0.6 });
  const steel = mat(0x59616c, { metalness: 0.5, roughness: 0.55 });
  const tire = mat(0x1c2126, { roughness: 0.95 });

  const add = (geo, material, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // fuselage: red top/sides, cream belly
  group.add(new THREE.Mesh(fuselageGeo(), [red, cream]));

  // engine cowl ring, exhaust stubs, belly scoop
  add(new THREE.CylinderGeometry(0.5, 0.47, 0.45, 12), dark, 0, -0.01, -3.6).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const e = add(new THREE.CylinderGeometry(0.04, 0.055, 0.3, 6), steel, s * 0.53, -0.2, -3.1 + i * 0.27);
    e.rotation.set(Math.PI / 2, s * 0.25, 0);
  }
  add(new THREE.BoxGeometry(0.34, 0.22, 0.8), cream, 0, -0.58, -2.85);

  // framed canopy: tinted glass shell + sill/spine + three frame hoops
  const glass = mat(0x22394a, { roughness: 0.2, metalness: 0.4 });
  const canopy = new THREE.Group();
  canopy.position.set(0, 0.64, -0.75);
  add(taperTop(0.64, 0.52, 1.7, 0.42, 0.55, -0.15), glass, 0, 0.26, 0, canopy);
  add(new THREE.BoxGeometry(0.74, 0.06, 1.8), red, 0, 0.02, 0, canopy);
  add(new THREE.BoxGeometry(0.07, 0.05, 0.94), red, 0, 0.53, -0.15, canopy);
  const mkHoop = (z, tilt) => {
    const hp = new THREE.Group();
    hp.position.set(0, 0.26, z);
    hp.rotation.x = tilt;
    add(new THREE.BoxGeometry(0.36, 0.07, 0.1), red, 0, 0.27, 0, hp);
    add(new THREE.BoxGeometry(0.07, 0.6, 0.1), red, -0.25, 0, 0, hp).rotation.z = -0.33;
    add(new THREE.BoxGeometry(0.07, 0.6, 0.1), red, 0.25, 0, 0, hp).rotation.z = 0.33;
    canopy.add(hp);
  };
  mkHoop(-0.68, 0.45); // raked windshield frame
  mkHoop(0.02, 0);
  mkHoop(0.5, -0.7);
  group.add(canopy);
  add(taperTop(0.5, 0.45, 1.4, 0.3, 0.5, 0.3), red, 0, 0.66, 0.85); // turtledeck
  add(new THREE.BoxGeometry(0.04, 0.32, 0.05), cream, 0, 1.0, 1.3); // antenna mast

  const tipGeo = new THREE.SphereGeometry(1, 8, 5);
  const navGeo = new THREE.SphereGeometry(0.06, 6, 4);
  // flaps hinge at their leading edge: mesh sits behind (+z of) the group origin
  const mkFlap = (w, d, material) => {
    const g = new THREE.Group();
    add(new THREE.BoxGeometry(w, 0.09, d), material, 0, 0, d / 2, g);
    return g;
  };

  // wings: two halves with dihedral; front panel tapers, trailing edge is
  // filler box inboard + flush aileron outboard; red band + capped tip
  const buildWing = (sign, navMat) => {
    const wg = new THREE.Group();
    wg.position.set(sign * 0.55, -0.25, -0.5);
    wg.rotation.z = sign * 0.07; // ~4 deg dihedral
    add(wingPanel(4.7, 0.22, 1.5, sign, 0.5, 0.75, 0.1), cream, sign * 2.35, 0, -0.3, wg);
    add(new THREE.BoxGeometry(2.3, 0.13, 0.5), cream, sign * 1.15, -0.02, 0.65, wg);
    const aileron = mkFlap(2.2, 0.5, red);
    aileron.position.set(sign * 3.4, 0, 0.4);
    wg.add(aileron);
    add(new THREE.BoxGeometry(0.5, 0.28, 1.1), red, sign * 4.25, 0, -0.2, wg);
    add(tipGeo, red, sign * 4.72, 0, -0.2, wg).scale.set(0.32, 0.1, 0.58);
    add(navGeo, navMat, sign * 5.0, 0, -0.38, wg);
    if (sign < 0) add(new THREE.BoxGeometry(0.035, 0.035, 0.5), steel, sign * 3.7, -0.02, -1.05, wg); // pitot
    const tip = new THREE.Object3D();
    tip.position.set(sign * 5.0, 0, -0.2);
    wg.add(tip);
    group.add(wg);
    return { aileron, tip };
  };
  const wl = buildWing(-1, mat(0xff4433, { emissive: 0xff2211, emissiveIntensity: 1.8 }));
  const wr = buildWing(1, mat(0x35e05a, { emissive: 0x14d840, emissiveIntensity: 1.8 }));

  // tail: tailplane halves + elevator, swept fin with cream stripe + rudder
  for (const sign of [-1, 1]) {
    add(wingPanel(1.75, 0.12, 1.05, sign, 0.6, 0.55, 0.18), cream, sign * 0.98, 0.36, 2.45);
    add(tipGeo, cream, sign * 1.9, 0.36, 2.52).scale.set(0.14, 0.05, 0.34);
  }
  const elevator = mkFlap(3.1, 0.55, red);
  elevator.position.set(0, 0.36, 2.98);
  group.add(elevator);
  add(taperTop(0.13, 1.5, 1.15, 0.7, 0.45, 0.3), red, 0, 1.25, 2.6);
  add(new THREE.BoxGeometry(0.17, 0.3, 0.85), cream, 0, 1.2, 2.72).rotation.x = -0.6;
  const rudder = new THREE.Group();
  rudder.position.set(0, 1.2, 3.2);
  add(taperTop(0.08, 1.4, 0.5, 0.8, 0.7, 0.08), red, 0, 0.05, 0.26, rudder);
  group.add(rudder);

  // lights: red/green wingtip nav (built in buildWing), white tail, blinking fin beacon
  const beaconMat = mat(0x7a1512, { emissive: 0xff2020, emissiveIntensity: 0.15 });
  add(new THREE.BoxGeometry(0.06, 0.05, 0.06), dark, 0, 2.01, 2.9);
  const beacon = add(new THREE.SphereGeometry(0.07, 6, 4), beaconMat, 0, 2.07, 2.9);
  add(navGeo, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.5 }), 0, 0.36, 3.6);

  // propeller: red spinner, 3 tapered blades, canvas radial-gradient blur disc
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0, -3.8);
  add(new THREE.ConeGeometry(0.24, 0.52, 10), red, 0, 0, -0.26, propGroup).rotation.x = -Math.PI / 2;
  const bladeGeo = new THREE.BoxGeometry(0.18, 1.3, 0.06);
  {
    const p = bladeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setX(i, p.getX(i) * 0.55);
    bladeGeo.computeVertexNormals();
  }
  const blades = new THREE.Group();
  blades.position.z = -0.08;
  const propM = mat(0x23282e, { metalness: 0.3, roughness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    add(bladeGeo, propM, 0, 0.7, 0, holder).rotation.y = 0.45; // blade pitch
    blades.add(holder);
  }
  propGroup.add(blades);
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 28),
    new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  propDisc.position.z = -0.16;
  propGroup.add(propDisc);
  group.add(propGroup);

  // retractable mains: pivot under the wing, leg folds inboard into the belly
  const buildGear = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 1.35, -0.42, -0.7);
    add(new THREE.BoxGeometry(0.14, 0.28, 0.5), cream, side * 1.35, -0.32, -0.7); // fixed pivot fairing
    add(new THREE.BoxGeometry(0.1, 0.9, 0.16), steel, 0, -0.42, 0, g);
    add(new THREE.BoxGeometry(0.05, 0.95, 0.34), cream, side * 0.12, -0.42, 0, g); // gear door
    const spin = new THREE.Group();
    spin.position.set(0, -0.85, 0);
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), tire, 0, 0, 0, spin).rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 8), red, 0, 0, 0, spin).rotation.z = Math.PI / 2;
    g.add(spin);
    group.add(g);
    return { g, spin };
  };
  const gl = buildGear(-1), gr = buildGear(1);

  // fixed tail wheel
  const tailWheel = new THREE.Group();
  tailWheel.position.set(0, 0, 3.05);
  add(new THREE.BoxGeometry(0.06, 0.45, 0.09), steel, 0, -0.2, 0.05, tailWheel).rotation.x = 0.22;
  const tailWheelSpin = new THREE.Group();
  tailWheelSpin.position.set(0, -0.44, 0.12);
  add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 8), tire, 0, 0, 0, tailWheelSpin).rotation.z = Math.PI / 2;
  tailWheel.add(tailWheelSpin);
  group.add(tailWheel);

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  propDisc.castShadow = false;

  return {
    group, blades, propDisc,
    aileronL: wl.aileron, aileronR: wr.aileron, elevator, rudder,
    tipL: wl.tip, tipR: wr.tip,
    gearL: gl.g, gearR: gr.g, tailWheel,
    wheelL: gl.spin, wheelR: gr.spin, tailWheelSpin, beacon, blinkT: 0,
  };
}

const _compat = { throttle: 0, gearTransit: 1, grounded: false, speed: 0 };

// input: smoothed controls (.pitchSm/.rollSm/.yawSm); phys: .throttle/.gearTransit/.grounded/.speed
export function updatePlaneVisual(plane, input, phys, dt) {
  if (typeof phys === 'number') { _compat.throttle = phys; phys = _compat; } // pre-gear main.js passed bare throttle

  plane.blades.rotation.z -= (4 + phys.throttle * 58) * dt;
  plane.propDisc.material.opacity = Math.min(0.3, Math.max(0, phys.throttle - 0.12) * 0.55);

  // roll right → left aileron trailing edge down, right up; pull → elevator
  // trailing edge up; yaw right → rudder trailing edge right
  const ail = input.rollSm * 0.5;
  plane.aileronL.rotation.x = ail;
  plane.aileronR.rotation.x = -ail;
  plane.elevator.rotation.x = -input.pitchSm * 0.5;
  plane.rudder.rotation.y = input.yawSm * 0.55;

  // legs swing inboard/up as gearTransit → 0
  const fold = (1 - (phys.gearTransit === undefined ? 1 : phys.gearTransit)) * 1.95;
  plane.gearL.rotation.z = fold;
  plane.gearR.rotation.z = -fold;

  if (phys.grounded && phys.speed > 0.2) {
    const spin = (phys.speed / 0.3) * dt;
    plane.wheelL.rotation.x -= spin;
    plane.wheelR.rotation.x -= spin;
    plane.tailWheelSpin.rotation.x -= spin * 2;
  }

  plane.blinkT = (plane.blinkT + dt) % 1; // ~1 Hz fin beacon
  plane.beacon.material.emissiveIntensity = plane.blinkT < 0.16 ? 3.2 : 0.15;
}
