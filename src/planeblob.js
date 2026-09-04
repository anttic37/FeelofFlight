import * as THREE from 'three';
import { SUN_DIR } from './atmosphere.js';

// THE PLANE'S SHADOW ABOVE THE SHADOW CAMERA'S REACH.
//
// The real shadow is a shadow-map silhouette; its camera's far plane follows the shadow's
// landing point up to SHADOW_FAR_CAP (world.js), which puts the handover at ~1500 m AGL at
// noon and ~360 m at a 10 degree sun. Past that the plane had no shadow at all, and a thing
// with no shadow floats over the world instead of flying through it. This takes over there,
// cross-faded in over the 60 m above exactly the AGL where main.js stops the real one, so
// there is always one shadow and never two.
//
// IT IS THE PLANE'S SHAPE, NOT A BLOB. A soft radial disc read as a smudge; a Mustang's shadow
// from a kilometre up is still recognisably wings and a fuselage. The texture is a top-down
// silhouette, and its orientation on the ground is not guessed: the aircraft's forward and
// wing axes are PROJECTED ALONG THE SUN onto the ground, and those two ground vectors are the
// affine frame the silhouette is drawn in. Heading alignment, the foreshortening of a banked
// wing and the down-sun shear of its raised tip all fall out of that one projection for free.
// The penumbra (the sun is half a degree wide) grows with height as a gentle scale-up plus
// a fade, because a real one goes to a rumour on the ground by a few kilometres.
//
// No instance onBeforeCompile here, on purpose: the material rides the prototype atmosphere
// hook untouched, so it fogs correctly and cannot fall into the v8.93 trap. Normal blending
// with a black alpha texture, because multiply blending ignores alpha entirely.
const SPAN = 11.3;      // P-51D wingspan, m
const LENGTH = 9.8;     // nose to tail, m

function silhouetteTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  // canvas: +x = right wing, +y = tail (so the nose points UP the canvas, toward -y)
  const cx = S / 2, cy = S / 2;
  const px = S / Math.max(SPAN, LENGTH) * 0.86;   // metres -> pixels, with a margin for the blur
  ctx.translate(cx, cy);
  ctx.scale(px, px);
  ctx.fillStyle = 'rgba(0,0,0,1)';
  const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); };
  // fuselage: a long lozenge, nose at -4.9, tail at +4.9, widest at the wing root
  ctx.beginPath();
  ctx.ellipse(0, 0.3, 0.62, 4.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // wing: laminar-flow planform, straight-ish leading edge, tapered, slight sweep
  poly([[-5.65, 0.35], [-5.65, 1.05], [-0.7, 1.75], [0.7, 1.75], [5.65, 1.05], [5.65, 0.35], [0.7, -0.75], [-0.7, -0.75]]);
  // horizontal stabiliser
  poly([[-2.15, 3.85], [-2.15, 4.25], [-0.4, 4.7], [0.4, 4.7], [2.15, 4.25], [2.15, 3.85], [0.4, 3.4], [-0.4, 3.4]]);
  // soften the edge: a real shadow from altitude has a penumbra long before this texture
  // is magnified, and a crisp cut-out reads as a sticker
  const soft = document.createElement('canvas');
  soft.width = soft.height = S;
  const sctx = soft.getContext('2d');
  sctx.filter = 'blur(3px)';
  sctx.drawImage(cv, 0, 0);
  const tex = new THREE.CanvasTexture(soft);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// WHERE THE SHADOW ACTUALLY LANDS: march down the sun ray against the height field until it
// goes under the ground. A flat-ground solve ("AGL / sunY down-sun, then correct for the
// height there") is wrong exactly when it matters — at a low sun the ray grazes for a
// kilometre or more and the first ridge in the way catches the shadow long before the flat
// point, which can be 1.5 km past it. Steps grow with distance (a shadow 2 km away does not
// need 8 m precision), so a worst-case 6 km ray is ~90 heightAt calls; typical is ~20.
// Returns the distance along the ray; `out` gets the hit point. Falls back to the flat solve
// if the ray leaves the island without touching down (open sea, or a sun on the horizon).
// Shared with world.js, which sizes the shadow camera's far plane off the same answer.
export function groundHitAlongSun(pos, heightAt, out) {
  const sy = Math.max(SUN_DIR.y, 0.03);
  let d = 6, last = 0;
  while (d < 6000) {
    const x = pos.x - SUN_DIR.x * d, y = pos.y - sy * d, z = pos.z - SUN_DIR.z * d;
    const g = Math.max(0, heightAt(x, z));
    if (y <= g) {
      // one bisection step back into the last free span, for a cleaner landing height
      const dm = (last + d) * 0.5;
      const xm = pos.x - SUN_DIR.x * dm, zm = pos.z - SUN_DIR.z * dm, ym = pos.y - sy * dm;
      const gm = Math.max(0, heightAt(xm, zm));
      if (ym <= gm) { out.set(xm, gm, zm); return dm; }
      out.set(x, g, z); return d;
    }
    last = d;
    d += Math.max(8, d * 0.06);
  }
  const t = Math.max(0, pos.y - Math.max(0, heightAt(pos.x, pos.z))) / sy;
  const fx = pos.x - SUN_DIR.x * t, fz = pos.z - SUN_DIR.z * t;
  out.set(fx, Math.max(0, heightAt(fx, fz)), fz);
  return t;
}

export function createPlaneBlob(scene, heightAt) {
  const mat = new THREE.MeshBasicMaterial({
    map: silhouetteTexture(), color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  // unit quad in XZ: local +x = canvas right, local +z = canvas DOWN (tail); nose is -z
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _x = new THREE.Vector3(), _z = new THREE.Vector3(), _y = new THREE.Vector3(), _o = new THREE.Vector3();

  // the ground shadow of a 3D vector: slide it along the sun until it lies flat
  const shadowOf = (v, out) => out.set(v.x - SUN_DIR.x * (v.y / SUN_DIR.y), 0, v.z - SUN_DIR.z * (v.y / SUN_DIR.y));

  const _hit = new THREE.Vector3();

  // pos: aircraft position; fadeStartAGL: where main.js stops the real shadow; quat: the
  // aircraft's orientation (phys.quat), which is what gives the silhouette its heading and bank.
  function update(pos, fadeStartAGL, quat) {
    const groundUnder = Math.max(0, heightAt(pos.x, pos.z));
    const agl = pos.y - groundUnder;
    const sunUp = Math.max(0, SUN_DIR.y);
    let k = THREE.MathUtils.smoothstep(agl, fadeStartAGL, fadeStartAGL + 60)
      * (1 - THREE.MathUtils.smoothstep(agl, 1800, 3600))
      * THREE.MathUtils.smoothstep(sunUp, 0.02, 0.12);
    if (k <= 0.002) { mesh.visible = false; return; }
    mesh.visible = true;
    mat.opacity = 0.6 * k;

    // where it lands: the first ground the sun ray meets (see groundHitAlongSun)
    groundHitAlongSun(pos, heightAt, _hit);
    const gx = _hit.x, gy = _hit.y, gz = _hit.z;

    // the silhouette's frame on the ground: the shadows of the wing axis and the fuselage
    // axis. Penumbra grows with height: a little larger, and the fade above does the rest.
    const grow = 1 + agl * 0.00045;
    _right.set(1, 0, 0).applyQuaternion(quat);
    _fwd.set(0, 0, -1).applyQuaternion(quat);
    shadowOf(_right, _x).multiplyScalar(SPAN * grow);
    shadowOf(_fwd, _z).multiplyScalar(-LENGTH * grow);   // local +z is the tail, forward is -z
    // guard the degenerate case of a vertical wing at a horizon sun: never let an axis vanish
    if (_x.lengthSq() < 1) _x.set(SPAN * 0.3, 0, 0);
    if (_z.lengthSq() < 1) _z.set(0, 0, LENGTH * 0.3);
    _y.copy(_up);
    _o.set(gx, gy + 0.35, gz);
    mesh.matrix.makeBasis(_x, _y, _z).setPosition(_o);
    mesh.matrixWorld.copy(mesh.matrix);
  }

  return { update, mesh, groundHit: (p, out) => groundHitAlongSun(p, heightAt, out) };
}
