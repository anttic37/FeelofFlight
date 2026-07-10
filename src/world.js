import * as THREE from 'three';
import { fbm, noise2 } from './noise.js';
import { onRunway, applyRunwayFlattening, runwayInfluence, createRunways } from './runways.js';
import { createWater } from './water.js';
import { createClouds } from './clouds.js';

// Procedural island world: heightfield terrain with vertex colors, runways carved in,
// two tree species, boulders, sun disc + follow shadow, water/cloud modules wired in.

const ISLAND_R = 1750;

function baseHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  let m = 1 - (r / ISLAND_R) * (r / ISLAND_R);
  if (m <= 0) return -14 + m * 4;
  const b = fbm(x * 0.0013 + 7.3, z * 0.0013 + 3.1, 5) * 0.5 + 0.5;
  const detail = fbm(x * 0.006, z * 0.006, 3) * 6;
  return m * (Math.pow(b, 1.35) * 205 + detail) - 12;
}

export function heightAt(x, z) {
  return applyRunwayFlattening(x, z, baseHeight(x, z));
}

// reused result object — callers copy fields, never retain the reference
const _surf = { h: 0, type: 'grass' };
export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  _surf.h = h;
  _surf.type = onRunway(x, z) ? 'runway' : h <= 0.05 ? 'water' : 'grass';
  return _surf;
}

function smooth(a, b, t) {
  t = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createWorld(scene) {
  const skyHorizon = new THREE.Color(0xbcd8ee);
  scene.fog = new THREE.Fog(skyHorizon, 1200, 4600);

  // sky dome: vertical gradient + haze band hugging the horizon
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

  // terrain
  const seg = 200;
  const terrainGeo = new THREE.PlaneGeometry(4200, 4200, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  const tPos = terrainGeo.attributes.position;
  for (let i = 0; i < tPos.count; i++) tPos.setY(i, heightAt(tPos.getX(i), tPos.getZ(i)));
  terrainGeo.computeVertexNormals();
  const tNorm = terrainGeo.attributes.normal;
  const tCol = new Float32Array(tPos.count * 3);
  const cSandWet = new THREE.Color(0xb69b6c), cSand = new THREE.Color(0xdcc891),
        cGrassL = new THREE.Color(0x7fae57), cGrassD = new THREE.Color(0x466f37),
        cMeadow = new THREE.Color(0x9dbd63), cRock = new THREE.Color(0x8d8a82),
        cRockD = new THREE.Color(0x6e6b64), cSnow = new THREE.Color(0xeef2f4),
        cDirt = new THREE.Color(0x9b7f57);
  const c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i), h = tPos.getY(i);
    const jit = noise2(x * 0.02, z * 0.02);
    const forest = noise2(x * 0.0035 + 40.7, z * 0.0035 + 9.2); // big vegetation patches
    if (h < 0.7) c.copy(cSandWet).lerp(cSand, smooth(-0.6, 0.7, h)); // wet->dry sand band
    else if (h < 3.2) c.copy(cSand).lerp(cSandWet, jit * 0.15);
    else if (h < 10) c.copy(cSand).lerp(c2.copy(cGrassL).lerp(cGrassD, forest * 0.7), smooth(3.2, 10, h));
    else {
      c.copy(cGrassL).lerp(cGrassD, forest * 0.85);
      c.lerp(cMeadow, (1 - forest) * jit * 0.45);
      if (h > 90) c.lerp(cRock, smooth(90, 128, h));
    }
    const snowline = 148 + (noise2(x * 0.009 + 3.7, z * 0.009) - 0.5) * 26;
    if (h > snowline - 12) c.lerp(cSnow, smooth(snowline - 12, snowline + 8, h));
    const steep = smooth(0.28, 0.55, 1 - tNorm.getY(i)); // exposed rock on steep faces
    if (steep > 0 && h > 2) c.lerp(c2.copy(cRock).lerp(cRockD, jit * 0.7), steep * 0.9);
    const rw = runwayInfluence(x, z); // graded dirt aprons around the strips
    if (rw > 0) c.lerp(cDirt, rw * 0.9);
    tCol[i * 3] = c.r; tCol[i * 3 + 1] = c.g; tCol[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  function slopeAt(x, z) {
    const gx = heightAt(x + 7, z) - heightAt(x - 7, z);
    const gz = heightAt(x, z + 7) - heightAt(x, z - 7);
    return Math.hypot(gx, gz) / 14;
  }

  // trees: cone pines + trunk-and-blob deciduous, placed on stable noise scatter
  const MAXT = 700;
  const pineGeo = new THREE.ConeGeometry(1.6, 6, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5);
  const leafGeo = new THREE.IcosahedronGeometry(1.9, 1);
  const whiteFlat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  const pines = new THREE.InstancedMesh(pineGeo, whiteFlat(), MAXT);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x7a5a3c, flatShading: true, roughness: 1 }), MAXT);
  const leaves = new THREE.InstancedMesh(leafGeo, whiteFlat(), MAXT);
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const eul = new THREE.Euler();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  let nPine = 0, nDec = 0, tries = 0;
  while (nPine + nDec < MAXT && tries < MAXT * 40) {
    tries++;
    const x = (noise2(tries * 1.618, 0.7) * 2 - 1) * 1700;
    const z = (noise2(0.3, tries * 2.113) * 2 - 1) * 1700;
    const h = heightAt(x, z);
    if (h < 3.5 || h > 130) continue;
    if (runwayInfluence(x, z) > 0.02) continue;
    if (slopeAt(x, z) > 0.5) continue;
    const s = 0.7 + noise2(x * 0.5, z * 0.5);
    quat.setFromAxisAngle(up, noise2(x, z) * 6.28);
    const pick = noise2(x * 0.004 + 23.1, z * 0.004 + 61.7); // species patches
    if (h > 85 || pick > 0.52) {
      const sy = s * (0.85 + noise2(x * 2.7, z * 1.3) * 0.5);
      pos.set(x, h + 3 * sy - 0.35, z);
      scl.set(s, sy, s);
      pines.setMatrixAt(nPine, mtx.compose(pos, quat, scl));
      tint.setHSL(0.33 + noise2(z, x) * 0.05, 0.42, 0.2 + noise2(x * 3, z * 3) * 0.1);
      pines.setColorAt(nPine++, tint);
    } else {
      pos.set(x, h + 1.2 * s - 0.1, z);
      scl.set(s, s, s);
      trunks.setMatrixAt(nDec, mtx.compose(pos, quat, scl));
      pos.set(x, h + 2.3 * s, z);
      scl.set(s * 1.05, s * 0.8, s * 1.05);
      leaves.setMatrixAt(nDec, mtx.compose(pos, quat, scl));
      tint.setHSL(0.2 + noise2(z * 1.7, x * 1.7) * 0.09, 0.5, 0.28 + noise2(x * 5, z * 5) * 0.12);
      leaves.setColorAt(nDec++, tint);
    }
  }
  pines.count = nPine;
  trunks.count = nDec;
  leaves.count = nDec;
  for (const m of [pines, trunks, leaves]) {
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // boulders on the shoreline and steep slopes
  const MAXR = 120;
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), whiteFlat(), MAXR);
  let nR = 0, rt = 0;
  while (nR < MAXR && rt < 8000) {
    rt++;
    const x = (noise2(rt * 2.417 + 11.7, 5.3) * 2 - 1) * 1750;
    const z = (noise2(7.9, rt * 3.331 + 2.2) * 2 - 1) * 1750;
    const h = heightAt(x, z);
    if (h < -1.2 || h > 150) continue;
    if (runwayInfluence(x, z) > 0.02) continue;
    if (h >= 4.5 && slopeAt(x, z) < 0.4) continue; // inland only on scree slopes
    const s = 0.6 + noise2(x * 0.9 + 3, z * 0.9) * 1.9;
    pos.set(x, h + s * 0.35, z);
    eul.set(noise2(rt, 1.2) * 0.9, noise2(rt, 9.4) * 6.28, noise2(rt, 4.4) * 0.9);
    quat.setFromEuler(eul);
    scl.set(s * (0.8 + noise2(x, 5.5) * 0.5), s * (0.55 + noise2(6.1, z) * 0.4), s);
    rocks.setMatrixAt(nR, mtx.compose(pos, quat, scl));
    tint.setHSL(0.09, 0.05, 0.36 + noise2(x * 1.1, z * 1.3) * 0.2);
    rocks.setColorAt(nR++, tint);
  }
  rocks.count = nR;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);

  const runways = createRunways(scene);
  const water = createWater(scene, heightAt);
  const clouds = createClouds(scene);

  // keep the sun (and its shadow box) and sky centered on the plane
  function update(planePos, time = 0) {
    sun.position.copy(planePos).addScaledVector(sunDir, 420);
    sun.target.position.copy(planePos);
    sky.position.set(planePos.x, 0, planePos.z);
    runways.update(time);
    water.update(time);
    clouds.update(time, planePos);
  }

  return { update };
}
