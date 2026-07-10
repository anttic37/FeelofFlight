import * as THREE from 'three';
import { fbm, noise2 } from './noise.js';

// Procedural island world: heightfield terrain with vertex colors, ocean,
// instanced trees, blobby clouds to punch through, sun with a follow shadow.

const ISLAND_R = 1750;

export function heightAt(x, z) {
  const r = Math.sqrt(x * x + z * z);
  let m = 1 - (r / ISLAND_R) * (r / ISLAND_R);
  if (m <= 0) return -14 + m * 4;
  const b = fbm(x * 0.0013 + 7.3, z * 0.0013 + 3.1, 5) * 0.5 + 0.5;
  const detail = fbm(x * 0.006, z * 0.006, 3) * 6;
  return m * (Math.pow(b, 1.35) * 205 + detail) - 12;
}

export function createWorld(scene) {
  const skyHorizon = new THREE.Color(0xbcd8ee);
  scene.fog = new THREE.Fog(skyHorizon, 1200, 4600);

  // sky dome with vertical gradient
  const skyGeo = new THREE.SphereGeometry(8500, 20, 12);
  const zenith = new THREE.Color(0x4f8fd4);
  const colors = [];
  const posAttr = skyGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i) / 8500;
    const c = skyHorizon.clone().lerp(zenith, Math.max(0, y) ** 0.7);
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  scene.add(sky);

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
  const sunDir = new THREE.Vector3(0.45, 0.75, 0.3).normalize();

  // terrain
  const seg = 140;
  const terrainGeo = new THREE.PlaneGeometry(4200, 4200, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  const tPos = terrainGeo.attributes.position;
  const tCol = [];
  const cSand = new THREE.Color(0xd8c58f), cGrass = new THREE.Color(0x6fa552),
        cGrass2 = new THREE.Color(0x4c7a3d), cRock = new THREE.Color(0x8d8a82),
        cSnow = new THREE.Color(0xeef2f4);
  const c = new THREE.Color();
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i);
    const h = heightAt(x, z);
    tPos.setY(i, h);
    const jitter = noise2(x * 0.02, z * 0.02);
    if (h < 2) c.copy(cSand);
    else if (h < 10) c.copy(cSand).lerp(cGrass, (h - 2) / 8);
    else if (h < 75) c.copy(cGrass).lerp(cGrass2, jitter);
    else if (h < 115) c.copy(cGrass2).lerp(cRock, (h - 75) / 40);
    else if (h < 150) c.copy(cRock);
    else c.copy(cRock).lerp(cSnow, Math.min(1, (h - 150) / 30));
    tCol.push(c.r, c.g, c.b);
  }
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(tCol, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ocean
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000),
    new THREE.MeshStandardMaterial({ color: 0x1e5d8c, roughness: 0.45, metalness: 0.25, transparent: true, opacity: 0.96 })
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // trees
  const treeGeo = new THREE.ConeGeometry(1.7, 5.5, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  const TREES = 550;
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, TREES);
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quatY = new THREE.Quaternion(), scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const green = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < TREES && tries < TREES * 30) {
    tries++;
    const x = (noise2(tries * 1.618, 0.7) * 2 - 1) * 1700;
    const z = (noise2(0.3, tries * 2.113) * 2 - 1) * 1700;
    const h = heightAt(x, z);
    if (h < 4 || h > 90) continue;
    const s = 0.7 + noise2(x * 0.5, z * 0.5) * 1.0;
    pos.set(x, h + 2.4 * s, z);
    quatY.setFromAxisAngle(up, noise2(x, z) * 6.28);
    scl.set(s, s, s);
    mtx.compose(pos, quatY, scl);
    trees.setMatrixAt(placed, mtx);
    green.setHSL(0.31 + noise2(z, x) * 0.06, 0.45, 0.28 + noise2(x * 3, z * 3) * 0.12);
    trees.setColorAt(placed, green);
    placed++;
  }
  trees.count = placed;
  trees.castShadow = true;
  trees.receiveShadow = true;
  scene.add(trees);

  // clouds
  const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
  // unlit: squashed instance scales break normals, and flat cartoon-white reads better anyway
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf2f7fc, transparent: true, opacity: 0.82, depthWrite: false });
  const CLOUDS = 46;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUDS);
  for (let i = 0; i < CLOUDS; i++) {
    const a = noise2(i * 3.7, 1.1) * Math.PI * 4;
    const r = 300 + noise2(i * 1.3, 8.8) * 2300;
    pos.set(Math.cos(a) * r, 240 + noise2(i * 2.9, 4.2) * 300, Math.sin(a) * r);
    quatY.setFromAxisAngle(up, noise2(i, i) * 6.28);
    scl.set(28 + noise2(i, 2) * 45, 9 + noise2(i, 3) * 10, 22 + noise2(i, 5) * 38);
    mtx.compose(pos, quatY, scl);
    clouds.setMatrixAt(i, mtx);
  }
  clouds.renderOrder = 2;
  scene.add(clouds);

  // keep the sun (and its shadow box) and sky centered on the plane
  function update(planePos) {
    sun.position.copy(planePos).addScaledVector(sunDir, 420);
    sun.target.position.copy(planePos);
    sky.position.set(planePos.x, 0, planePos.z);
  }

  return { update, heightAt };
}
