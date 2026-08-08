import * as THREE from 'three';

// WHAT SHAPE IS THE AEROPLANE, ACTUALLY.
//
// Both crash paths used to answer that from constants typed by hand, and both were wrong in
// every dimension: the wing chord was 1.6 m against a real 2.71, the fin sat at z 3.4 against a
// real 2.55, the fuselage was 18% too fat. Worse, the constants described the INTACT aeroplane,
// while wreckage.js shears the wings off at 15 m/s — so a fuselage with no wings was still
// being held up on contact points 5.5 m out to either side, and came to rest balanced in the
// air on wings that were lying in a field two hundred metres back. That is the floating.
//
// So nothing here is typed. The parts are measured off the live scene graph at the moment they
// are needed, which means the colliders match the model however the model changes, and a part
// that has sheared off is simply not found and contributes nothing.
//
// Boxes, in the aeroplane's own frame (fwd -Z, up +Y, right +X).
const PARTS = [
  'Fuselage',
  'Canopy glass',
  'Left wing flex joint',
  'Right wing flex joint',
  'Vertical stabilizer',
  'Rudder hinge',
  'Left stabilizer',
  'Right stabilizer',
  'Tail wheel',
];
// 'Propeller assembly' is deliberately absent. Its bounding box is the swept DISC, 3 x 3 m,
// and a 3 m cube on the nose is not what the aeroplane hits the ground with. It also shears at
// 7 m/s, so in a crash it has essentially always gone.

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const _tmp = new THREE.Box3();
const _size = new THREE.Vector3();
const _ctr = new THREE.Vector3();

// The local AABB of one subtree, WITHOUT touching the live transform. Box3.setFromObject works
// in world space, so measuring a banked aeroplane that way gives the box of the rotated shape,
// which is bigger than the shape and wrong. Each mesh's own geometry box is carried into the
// group's frame instead, so the answer is the same whatever attitude the crash happened at.
function localBox(obj, inv) {
  _box.makeEmpty();
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _tmp.copy(o.geometry.boundingBox);
    _m.multiplyMatrices(inv, o.matrixWorld);
    _tmp.applyMatrix4(_m);
    _box.union(_tmp);
  });
  return _box.isEmpty() ? null : _box;
}

// Every part still attached, as { name, half:[x,y,z], pos:[x,y,z] } in body-local metres.
export function measureParts(plane) {
  const g = plane.group;
  g.updateWorldMatrix(true, false);
  _inv.copy(g.matrixWorld).invert();
  const out = [];
  for (const name of PARTS) {
    const obj = g.getObjectByName(name);
    if (!obj) continue;                       // sheared off: it is not part of the wreck
    const b = localBox(obj, _inv);
    if (!b) continue;
    b.getSize(_size); b.getCenter(_ctr);
    out.push({
      name,
      // a floor on thickness: an elevator is 0.10 m thick and a zero-depth collider is a
      // degenerate one. 0.04 half-extent is thinner than anything that matters and still solid.
      half: [Math.max(_size.x / 2, 0.04), Math.max(_size.y / 2, 0.04), Math.max(_size.z / 2, 0.04)],
      pos: [_ctr.x, _ctr.y, _ctr.z],
    });
  }
  return out;
}

// The extremes of whatever is left, as the five contact points the built-in wreck integrator
// carries. Same measurement, so both paths agree about how wide the aeroplane is.
export function measureContacts(plane) {
  const parts = measureParts(plane);
  if (!parts.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.pos[0] - p.half[0]); maxX = Math.max(maxX, p.pos[0] + p.half[0]);
    minY = Math.min(minY, p.pos[1] - p.half[1]); maxY = Math.max(maxY, p.pos[1] + p.half[1]);
    minZ = Math.min(minZ, p.pos[2] - p.half[2]); maxZ = Math.max(maxZ, p.pos[2] + p.half[2]);
  }
  const cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
  return [
    [0, cy, minZ],      // nose
    [0, cy, maxZ],      // tail
    [minX, cy, cz],     // left tip  — 5.35 m out with wings, 0.93 without
    [maxX, cy, cz],     // right tip
    [0, minY, cz],      // belly
  ];
}
