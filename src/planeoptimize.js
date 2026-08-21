import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// MERGE THE AIRFRAME'S STATIC DETAIL INTO A HANDFUL OF DRAWS.
//
// The hero aircraft are 250-300 meshes each, and three issues one draw call per mesh
// however many share a material — so the aeroplane alone was ~260 draw calls every frame,
// the largest single cost in the scene. Most of those meshes are STATIC relative to some
// moving part: fuselage rivets, panel lines, exhaust stacks, cowl fasteners sit still
// relative to the fuselage; wing skins, gun-bay panels and markings sit still relative to
// the wing (which flexes). Merging each such cluster into one geometry per material cuts
// the draw count hard without changing a pixel.
//
// THE THREE RULES THAT KEEP IT SAFE:
//   1. A MOVABLE part is never merged and never merged INTO another cluster — it keeps its
//      own node so it can still animate. Movable = every Object3D the plane's return object
//      exposes (ailerons, flaps, elevator, rudder, gear, wheels, doors, prop, spinner,
//      canopy, tailwheel, the wing-flex joints, the wingtip markers).
//   2. A COLLIDER part is never merged — airframe.js/wreckage.js find it by name at crash
//      time, and a merged blob has no name. Protected by the exact name list passed in.
//   3. Each mergeable mesh joins the cluster of its NEAREST movable ancestor, and the merged
//      geometry is parented to that ancestor with its transform baked in — so a wing detail
//      merged under the outboard flex joint still bends with the wing, and a fuselage detail
//      merged under the group stays put. Nothing changes how anything moves.
//
// Transparent decals (the star-and-bars) are left alone: merging them would fix their draw
// order relative to the paint under them, and there are only a handful.
export function mergeStaticPlaneMeshes(plane, protectedNames) {
  const group = plane.group;
  const movable = new Set();
  for (const k of Object.keys(plane)) {
    const v = plane[k];
    if (v && v.isObject3D) movable.add(v);
    else if (Array.isArray(v)) v.forEach((x) => { if (x && x.isObject3D) movable.add(x); });
  }
  const protectedSet = new Set(protectedNames);

  const nearestCluster = (o) => {
    let n = o.parent;
    while (n && n !== group) { if (movable.has(n)) return n; n = n.parent; }
    return group;
  };

  // gather candidates first (mutating the graph while traversing it is asking for trouble)
  const candidates = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (movable.has(o)) return;                 // a movable part itself
    if (protectedSet.has(o.name)) return;       // a named collider
    const m = o.material;
    if (Array.isArray(m) || m.transparent) return;  // multi-material / decals: leave alone
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    candidates.push(o);
  });

  // Bucket by (cluster, material, EXACT kept-attribute signature). mergeGeometries needs
  // every geometry in a call to share the same attribute names AND itemSizes AND index
  // state, and the P-51D mixes all three — so the key carries name:itemSize for each of the
  // standard attributes that survive, and every clone is forced non-indexed, which makes
  // index-mixing impossible and the merge bulletproof. Extra/interleaved attributes are
  // dropped (the terrain-style detail shader reads none of them).
  const STD = ['position', 'normal', 'uv', 'color'];
  const buckets = new Map();
  const _m = new THREE.Matrix4();
  for (const o of candidates) {
    const root = nearestCluster(o);
    const g = o.geometry;
    const kept = STD.filter((n) => g.attributes[n]);
    const sig = kept.map((n) => n + ':' + g.attributes[n].itemSize).join(',');
    const key = root.uuid + '|' + o.material.uuid + '|' + sig;
    let b = buckets.get(key);
    if (!b) { b = { root, material: o.material, geoms: [], sources: [] }; buckets.set(key, b); }
    // bake the transform from the cluster root down to this mesh into a geometry clone
    root.updateWorldMatrix(true, false);
    o.updateWorldMatrix(true, false);
    _m.copy(root.matrixWorld).invert().multiply(o.matrixWorld);
    let gc = g.clone();
    gc.applyMatrix4(_m);
    for (const name of Object.keys(gc.attributes)) {
      if (!STD.includes(name)) gc.deleteAttribute(name);
    }
    if (gc.index) gc = gc.toNonIndexed();   // uniform: no bucket can mix indexed + not
    b.geoms.push(gc);
    b.sources.push(o);
  }

  let mergedDraws = 0, removed = 0;
  const mergedMeshes = [];
  for (const b of buckets.values()) {
    if (b.geoms.length < 2) { b.geoms.forEach((gc) => gc.dispose && gc.dispose()); continue; } // no win from a lone mesh
    const merged = mergeGeometries(b.geoms, false);
    if (!merged) { b.geoms.forEach((gc) => gc.dispose && gc.dispose()); continue; }
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.name = 'merged static detail';
    mesh.castShadow = false;      // detail geometry adds nothing to the ground silhouette
    mesh.receiveShadow = b.sources[0].receiveShadow;
    mesh.frustumCulled = false;   // it spans the cluster; its bounds move with the plane
    b.root.add(mesh);
    mergedMeshes.push(mesh);
    mergedDraws++;
    for (const s of b.sources) { s.parent && s.parent.remove(s); s.geometry.dispose(); removed++; }
    b.geoms.forEach((gc) => gc.dispose && gc.dispose());
  }
  return { removed, mergedDraws, netDrawsSaved: removed - mergedDraws };
}
