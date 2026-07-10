import * as THREE from 'three';

// Procedural low-poly plane, nose along -Z. Control surfaces are hinged groups
// so they visibly deflect: that "stick → surface → plane reacts" chain is the feel.

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra });
}

export function buildPlane() {
  const group = new THREE.Group();
  const red = mat(0xd64533);
  const cream = mat(0xf2e9d8);
  const dark = mat(0x2b333d);

  const add = (geo, material, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // fuselage + nose + canopy
  add(new THREE.BoxGeometry(0.9, 1.0, 6.4), red, 0, 0, -0.4);
  const nose = add(new THREE.ConeGeometry(0.48, 1.5, 8), cream, 0, 0, -4.3);
  nose.rotation.x = -Math.PI / 2;
  add(new THREE.BoxGeometry(0.72, 0.5, 1.6), mat(0x24404f, { roughness: 0.3 }), 0, 0.7, -1.3);

  // wings
  add(new THREE.BoxGeometry(11, 0.16, 1.7), cream, 0, 0.15, -0.5);
  add(new THREE.BoxGeometry(0.5, 0.2, 1.75), red, -5.3, 0.15, -0.5); // tip stripes
  add(new THREE.BoxGeometry(0.5, 0.2, 1.75), red, 5.3, 0.15, -0.5);

  // ailerons (hinged at leading edge of the flap)
  const mkFlap = (w, d, material) => {
    const g = new THREE.Group();
    add(new THREE.BoxGeometry(w, 0.09, d), material, 0, 0, d / 2, g);
    return g;
  };
  const aileronL = mkFlap(2.4, 0.55, red);
  aileronL.position.set(-3.9, 0.15, 0.35);
  const aileronR = mkFlap(2.4, 0.55, red);
  aileronR.position.set(3.9, 0.15, 0.35);
  group.add(aileronL, aileronR);

  // tail
  add(new THREE.BoxGeometry(4.2, 0.12, 1.1), cream, 0, 0.1, 2.55);
  const elevator = mkFlap(4.2, 0.5, red);
  elevator.position.set(0, 0.1, 3.1);
  group.add(elevator);

  add(new THREE.BoxGeometry(0.12, 1.6, 1.2), cream, 0, 0.9, 2.55); // fin
  const rudder = new THREE.Group();
  const rm = add(new THREE.BoxGeometry(0.09, 1.5, 0.5), red, 0, 0, 0.25, rudder);
  rudder.position.set(0, 0.95, 3.15);
  group.add(rudder);

  // propeller: spinner + blades + blur disc
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0, -5.1);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 8), dark);
  spinner.rotation.x = -Math.PI / 2;
  propGroup.add(spinner);
  const blades = new THREE.Group();
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.7, 0.05), dark);
  const b2 = b1.clone();
  b2.rotation.z = Math.PI / 2;
  blades.add(b1, b2);
  propGroup.add(blades);
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 24),
    new THREE.MeshBasicMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  propGroup.add(propDisc);
  group.add(propGroup);

  // wingtip anchors for trails
  const tipL = new THREE.Object3D();
  tipL.position.set(-5.55, 0.15, -0.2);
  const tipR = new THREE.Object3D();
  tipR.position.set(5.55, 0.15, -0.2);
  group.add(tipL, tipR);

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });

  return { group, blades, propDisc, aileronL, aileronR, elevator, rudder, tipL, tipR };
}

// input: smoothed control values from Input; throttle: actual spooled throttle
export function updatePlaneVisual(plane, input, throttle, dt) {
  plane.blades.rotation.z -= (5 + throttle * 55) * dt;
  plane.propDisc.material.opacity = Math.min(0.28, Math.max(0, throttle - 0.15) * 0.5);

  // roll right → left aileron trailing edge down, right up; rudder deflects into the turn
  const ail = input.rollSm * 0.45;
  plane.aileronL.rotation.x = ail;
  plane.aileronR.rotation.x = -ail;
  plane.elevator.rotation.x = -input.pitchSm * 0.45;
  plane.rudder.rotation.y = input.yawSm * 0.5;
}
