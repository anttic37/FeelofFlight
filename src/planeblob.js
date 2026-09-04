import * as THREE from 'three';
import { SUN_DIR } from './atmosphere.js';

// THE PLANE'S SHADOW ABOVE THE SHADOW BOX.
//
// The real shadow is a shadow-map silhouette inside a +/-160 m box that follows the plane, so
// above ~185 m AGL at noon (lower at low sun) the shadow falls outside its own box and simply
// vanishes — main.js already stops the airframe casting up there, since nothing would land.
// From that height up the plane had no shadow at all, and a thing with no shadow floats over
// the world instead of flying through it. This is the cheap fix: a soft dark ellipse laid on
// the ground at the sun-projected point, cross-faded in exactly where the real shadow stops
// being drawn, so there is always one shadow and never two.
//
// It is honest about what a shadow from altitude looks like: the penumbra grows with height
// (the sun is half a degree wide), it stretches downsun at low sun, and it fades out with
// height because a real one does — by ~2 km it is a rumour on the ground.
//
// No instance onBeforeCompile here, on purpose: the material rides the prototype atmosphere
// hook untouched, so it fogs correctly and cannot fall into the v8.93 trap. Normal blending
// with a black radial-alpha texture, because multiply blending ignores alpha and would need
// the fade-toward-white dance the ground decals do.
export function createPlaneBlob(scene, heightAt) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.3)');
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
  const _sunH = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
  // PlaneGeometry faces +z in its own frame; this lays it flat into the basis' x/z plane
  const _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  // fadeStartAGL: the height above which main.js stops the real shadow — the blob ramps in
  // over the 40 m above it, so the handover is a cross-fade rather than a swap.
  function update(pos, fadeStartAGL) {
    const groundUnder = Math.max(0, heightAt(pos.x, pos.z));
    const agl = pos.y - groundUnder;
    const sunUp = Math.max(0, SUN_DIR.y);
    // strength: in above the real shadow's limit, out again with height, gone when the light is down
    let k = THREE.MathUtils.smoothstep(agl, fadeStartAGL, fadeStartAGL + 40)
      * (1 - THREE.MathUtils.smoothstep(agl, 600, 2200))
      * THREE.MathUtils.smoothstep(sunUp, 0.02, 0.12);
    if (k <= 0.002) { mesh.visible = false; return; }
    mesh.visible = true;
    mat.opacity = 0.55 * k;

    // where the shadow lands: walk down-sun from the plane until the ray meets the ground.
    // One flat-ground step first, then one correction against the height there — enough for
    // hills at these ranges, and cheap.
    const sy = Math.max(SUN_DIR.y, 0.08);
    let t = agl / sy;
    let gx = pos.x - SUN_DIR.x * t, gz = pos.z - SUN_DIR.z * t;
    let gy = Math.max(0, heightAt(gx, gz));
    t = (pos.y - gy) / sy;
    gx = pos.x - SUN_DIR.x * t; gz = pos.z - SUN_DIR.z * t;
    gy = Math.max(0, heightAt(gx, gz));
    mesh.position.set(gx, gy + 0.35, gz);

    // lie on the local slope
    const h1 = heightAt(gx + 6, gz) - heightAt(gx - 6, gz);
    const h2 = heightAt(gx, gz + 6) - heightAt(gx, gz - 6);
    _n.set(-h1 / 12, 1, -h2 / 12).normalize();
    // size: the airframe's footprint plus a penumbra that grows with height; stretched
    // down-sun by the sun's slant, capped so a sunset does not paint a runway
    const r = 6 + agl * 0.012;
    const stretch = Math.min(2.8, 1 / Math.max(SUN_DIR.y, 0.35));
    _sunH.set(SUN_DIR.x, 0, SUN_DIR.z);
    if (_sunH.lengthSq() < 1e-6) _sunH.set(1, 0, 0);
    _sunH.normalize();
    // basis on the slope: x along the sun's ground direction, z across it, y = normal
    _x.copy(_sunH).addScaledVector(_n, -_sunH.dot(_n)).normalize();
    _z.crossVectors(_x, _n).normalize();
    _m.makeBasis(_x, _n, _z);
    _q.setFromRotationMatrix(_m);
    mesh.quaternion.copy(_q).multiply(_flat);
    mesh.scale.set(r * 2 * stretch, r * 2 * 0.85, 1);
  }

  return { update, mesh };
}
