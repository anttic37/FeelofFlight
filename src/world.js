import * as THREE from 'three';
import { noise2 } from './noise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  heightAt, surfaceAt, runwayInfluence, nearCorridor,
  canyonLocate, _cd, _cs, cWf, cWr, TRIBS, tribLocate, _td,
  pathPoint, _ppx, _ppz, _ppux, _ppuz,
  HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B,
} from './heightcore.js';
import { createTerrain } from './terrain.js';
import { createRunways } from './runways.js';
import { createWater } from './water.js';
import { createClouds } from './clouds.js';

// Scene construction for the procedural island: sky/sun/lights, the static
// terrain mesh, vegetation scatter, runways, water, clouds. The analytic
// height field lives in heightcore.js and the vertex-color rules in
// colorcore.js (both pure and worker-loadable); heightAt/surfaceAt are
// re-exported here so consumer imports are unchanged.

export { heightAt, surfaceAt } from './heightcore.js';

export function createWorld(scene) {
  const skyHorizon = new THREE.Color(0xbcd8ee);
  scene.fog = new THREE.Fog(skyHorizon, 1500, 6500);

  // sky dome: vertical gradient + haze band hugging the horizon (radius 8500 > fog.far)
  const skyGeo = new THREE.SphereGeometry(8500, 20, 12);
  const zenith = new THREE.Color(0x4f8fd4);
  const cHaze = new THREE.Color(0xe4edf3);
  const colors = [];
  const posAttr = skyGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i) / 8500;
    const c = skyHorizon.clone().lerp(zenith, Math.max(0, y) ** 0.7);
    if (y < 0.16) c.lerp(cHaze, Math.min(1, (0.16 - y) / 0.22) * 0.8);
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  scene.add(sky);

  const sunDir = new THREE.Vector3(0.45, 0.75, 0.3).normalize();

  // sun disc + glow: additive canvas sprite riding on the dome
  const sunCv = document.createElement('canvas');
  sunCv.width = sunCv.height = 256;
  const sctx = sunCv.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,252,242,1)');
  grad.addColorStop(0.12, 'rgba(255,246,218,1)');
  grad.addColorStop(0.2, 'rgba(255,233,183,0.45)');
  grad.addColorStop(0.45, 'rgba(255,219,158,0.14)');
  grad.addColorStop(1, 'rgba(255,214,150,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);
  const sunTex = new THREE.CanvasTexture(sunCv);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  sunSpr.position.copy(sunDir).multiplyScalar(7800);
  sunSpr.scale.set(2200, 2200, 1);
  sky.add(sunSpr);

  // lights
  const hemi = new THREE.HemisphereLight(0xbad7f0, 0x5e6a4f, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1000;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  // terrain — static single mesh or streamed ring-LOD tiles (see terrain.js);
  // either way heightAt stays the ground truth for physics/camera/vegetation
  const terrain = createTerrain(scene);

  function slopeAt(x, z) {
    const gx = heightAt(x + 7, z) - heightAt(x - 7, z);
    const gz = heightAt(x, z + 7) - heightAt(x, z - 7);
    return Math.hypot(gx, gz) / 14;
  }
  // shared vegetation rejection: strips, short final, the gorge and its gullies
  function vetoed(x, z) {
    if (runwayInfluence(x, z) > 0.02) return true;
    if (canyonLocate(x, z) && _cd < cWf(_cs) + cWr(_cs) + 60) return true;
    for (let k = 0; k < TRIBS.length; k++) if (tribLocate(TRIBS[k], x, z) && _td < 230) return true;
    return nearCorridor(x, z);
  }

  const whiteFlat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const eul = new THREE.Euler();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  // pines: dense in the western woods, plus mountain flanks below the snowline
  const MAXP = 1600;
  const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 6, 6), whiteFlat(), MAXP);
  let nP = 0, tp = 0;
  while (nP < MAXP && tp < MAXP * 28) {
    tp++;
    let x, z;
    if (tp % 4 === 0) {
      const t = noise2(tp * 1.618 + 4.4, 2.2);
      x = MTN_A.x + (MTN_B.x - MTN_A.x) * t + (noise2(tp * 2.71, 8.9) - 0.5) * 4200;
      z = MTN_A.z + (MTN_B.z - MTN_A.z) * t + (noise2(5.3, tp * 1.93) - 0.5) * 4200;
    } else { // center-biased blob over the west woods (independent 1D noises per axis)
      x = FOREST_C.x + (noise2(tp * 1.618, 0.7) * 2 - 1) * 1750;
      z = FOREST_C.z + (noise2(0.3, tp * 2.113) * 2 - 1) * 1750;
    }
    const h = heightAt(x, z);
    if (h < 4 || h > 406 + (noise2(x * 0.006 + 3.7, z * 0.006) - 0.5) * 76) continue; // below snow
    if (vetoed(x, z)) continue;
    if (slopeAt(x, z) > 0.55) continue;
    const s = 0.7 + noise2(x * 0.5, z * 0.5);
    const sy = s * (0.85 + noise2(x * 2.7, z * 1.3) * 0.5);
    quat.setFromAxisAngle(up, noise2(x, z) * 6.28);
    pos.set(x, h + 3 * sy - 0.35, z);
    scl.set(s, sy, s);
    pines.setMatrixAt(nP, mtx.compose(pos, quat, scl));
    tint.setHSL(0.33 + noise2(z, x) * 0.05, 0.42, 0.2 + noise2(x * 3, z * 3) * 0.1);
    pines.setColorAt(nP++, tint);
  }
  pines.count = nP;

  // deciduous: trunk-and-blob trees over the southern hills
  const MAXD = 1100;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5),
    new THREE.MeshStandardMaterial({ color: 0x7a5a3c, flatShading: true, roughness: 1 }), MAXD);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 1), whiteFlat(), MAXD);
  let nD = 0, td = 0;
  while (nD < MAXD && td < MAXD * 26) {
    td++;
    const x = HILLS_C.x + (noise2(td * 1.618 + 9.9, 0.31) * 2 - 1) * 2150;
    const z = HILLS_C.z + (noise2(0.7, td * 2.113 + 0.3) * 2 - 1) * 2150;
    const h = heightAt(x, z);
    if (h < 3.5 || h > 145) continue; // hills carry knolls + relief now
    if (vetoed(x, z)) continue;
    if (slopeAt(x, z) > 0.5) continue;
    const s = 0.7 + noise2(x * 0.5, z * 0.5);
    quat.setFromAxisAngle(up, noise2(x, z) * 6.28);
    pos.set(x, h + 1.2 * s - 0.1, z);
    scl.set(s, s, s);
    trunks.setMatrixAt(nD, mtx.compose(pos, quat, scl));
    pos.set(x, h + 2.3 * s, z);
    scl.set(s * 1.05, s * 0.8, s * 1.05);
    leaves.setMatrixAt(nD, mtx.compose(pos, quat, scl));
    tint.setHSL(0.2 + noise2(z * 1.7, x * 1.7) * 0.09, 0.5, 0.28 + noise2(x * 5, z * 5) * 0.12);
    leaves.setColorAt(nD++, tint);
  }
  trunks.count = nD;
  leaves.count = nD;

  // cacti: low-poly saguaros (cylinder trunk + cylinder arms), desert only
  const cacTrunk = new THREE.CylinderGeometry(0.34, 0.44, 3.4, 6).translate(0, 1.7, 0);
  const cacStubR = new THREE.CylinderGeometry(0.18, 0.2, 1.1, 5).rotateZ(Math.PI / 2).translate(0.62, 1.5, 0);
  const cacArmR = new THREE.CylinderGeometry(0.18, 0.21, 1.5, 5).translate(1.1, 2.35, 0);
  const cacStubL = new THREE.CylinderGeometry(0.16, 0.18, 0.9, 5).rotateZ(Math.PI / 2).translate(-0.5, 1.05, 0);
  const cacArmL = new THREE.CylinderGeometry(0.16, 0.19, 1.1, 5).translate(-0.88, 1.7, 0);
  const cacGeo1 = mergeGeometries([cacTrunk, cacStubR, cacArmR]); // one arm
  const cacGeo2 = mergeGeometries([cacTrunk.clone(), cacStubR.clone(), cacArmR.clone(), cacStubL, cacArmL]);
  const MAXC = 225; // per variant, 450 total
  const cacti1 = new THREE.InstancedMesh(cacGeo1, whiteFlat(), MAXC);
  const cacti2 = new THREE.InstancedMesh(cacGeo2, whiteFlat(), MAXC);
  let nC1 = 0, nC2 = 0, tc = 0;
  while (nC1 + nC2 < MAXC * 2 && tc < MAXC * 50) {
    tc++;
    const x = DESERT_C.x + (noise2(tc * 1.618 + 5.5, 0.13) * 2 - 1) * 2350;
    const z = DESERT_C.z + (noise2(0.9, tc * 2.113 + 2.6) * 2 - 1) * 2350;
    const h = heightAt(x, z);
    if (h < 8 || h > 125) continue;
    if (vetoed(x, z)) continue;
    if (slopeAt(x, z) > 0.38) continue;
    const s = 0.75 + noise2(x * 0.7, z * 0.7) * 0.85;
    quat.setFromAxisAngle(up, noise2(x, z) * 6.28);
    pos.set(x, h - 0.05, z);
    scl.set(s, s * (0.85 + noise2(x * 2.1, z * 3.3) * 0.6), s);
    tint.setHSL(0.23 + noise2(z * 1.3, x * 1.3) * 0.05, 0.3, 0.28 + noise2(x * 4, z * 4) * 0.12);
    if (tc % 2 === 0 && nC1 < MAXC) {
      cacti1.setMatrixAt(nC1, mtx.compose(pos, quat, scl));
      cacti1.setColorAt(nC1++, tint);
    } else if (nC2 < MAXC) {
      cacti2.setMatrixAt(nC2, mtx.compose(pos, quat, scl));
      cacti2.setColorAt(nC2++, tint);
    }
  }
  cacti1.count = nC1;
  cacti2.count = nC2;

  // boulders: canyon walls/floor edges, mountain scree, shorelines
  const MAXR = 900;
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), whiteFlat(), MAXR);
  let nR = 0, rt = 0;
  while (nR < MAXR && rt < MAXR * 22) {
    rt++;
    const pick = rt % 10;
    let x, z, red = false;
    if (pick < 4) { // canyon (low-discrepancy param along the path)
      const sN = 0.06 + ((rt * 0.618034) % 1) * 0.86;
      pathPoint(sN);
      const wfv = cWf(sN);
      const mag = (wfv - 45 + noise2(rt * 2.3, 3.1) * 430) * (noise2(rt * 0.77, 9.9) > 0.5 ? 1 : -1);
      x = _ppx - _ppuz * mag;
      z = _ppz + _ppux * mag;
      red = true;
    } else if (pick < 7) { // mountain scree
      const t = noise2(rt * 3.37 + 1.1, 7.7);
      x = MTN_A.x + (MTN_B.x - MTN_A.x) * t + (noise2(rt * 2.417 + 11.7, 5.3) - 0.5) * 3400;
      z = MTN_A.z + (MTN_B.z - MTN_A.z) * t + (noise2(7.9, rt * 3.331 + 2.2) - 0.5) * 3400;
    } else { // shoreline ring (golden-angle sequence for uniform coverage)
      const a = rt * 2.39996, rad = 6350 + noise2(rt * 1.13, 7.3) * 800;
      x = Math.cos(a) * rad;
      z = Math.sin(a) * rad;
    }
    const h = heightAt(x, z);
    if (pick < 4) { if (h < -1) continue; }
    else if (pick < 7) { if (h < 40 || h > 620 || slopeAt(x, z) < 0.3) continue; }
    else if (h < -1.5 || h > 4.5) continue;
    if (runwayInfluence(x, z) > 0.02 || nearCorridor(x, z)) continue;
    const s = red ? 1.1 + noise2(x * 0.9 + 3, z * 0.9) * 2.5 : 0.6 + noise2(x * 0.9 + 3, z * 0.9) * 1.9;
    pos.set(x, h + s * 0.35, z);
    eul.set(noise2(rt, 1.2) * 0.9, noise2(rt, 9.4) * 6.28, noise2(rt, 4.4) * 0.9);
    quat.setFromEuler(eul);
    scl.set(s * (0.8 + noise2(x, 5.5) * 0.5), s * (0.55 + noise2(6.1, z) * 0.4), s);
    rocks.setMatrixAt(nR, mtx.compose(pos, quat, scl));
    if (red) tint.setHSL(0.05, 0.32, 0.3 + noise2(x * 1.1, z * 1.3) * 0.12);
    else tint.setHSL(0.09, 0.05, 0.36 + noise2(x * 1.1, z * 1.3) * 0.2);
    rocks.setColorAt(nR++, tint);
  }
  rocks.count = nR;

  for (const m of [pines, trunks, leaves, cacti1, cacti2, rocks]) {
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  const runways = createRunways(scene);
  const water = createWater(scene, heightAt);
  const clouds = createClouds(scene);

  // keep the sun (and its shadow box) and sky centered on the plane
  function update(planePos, time = 0) {
    sun.position.copy(planePos).addScaledVector(sunDir, 420);
    sun.target.position.copy(planePos);
    sky.position.set(planePos.x, 0, planePos.z);
    terrain.update(planePos);
    runways.update(time);
    water.update(time);
    clouds.update(time, planePos);
  }

  return { update, terrain };
}
