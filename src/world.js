import * as THREE from 'three';
import { fbm, noise2 } from './noise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  onRunway, applyRunwayFlattening, runwayInfluence, createRunways,
  RUNWAYS, CANYON_PATH, HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B, PEAK,
} from './runways.js';
import { createWater } from './water.js';
import { createClouds } from './clouds.js';

// Procedural island, radius ~7000 m: five noise-warped biome regions (south
// hills, east desert, west forest, north+center mountains to ~650 m, and a
// canyon gorge running to the southeast sea), all shaped AROUND the runway
// anchors from runways.js — per-strip terrain platforms and capped approach
// corridors guarantee every strip fits its theme by construction, then
// applyRunwayFlattening does the final exact grading.

const R_MASK = 7200; // radial falloff denominator; beach lands around r ~6600-7400

function smooth(a, b, t) {
  t = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- mountain ridge segment MTN_A -> MTN_B ----
const _rgL = Math.hypot(MTN_B.x - MTN_A.x, MTN_B.z - MTN_A.z);
const _rgux = (MTN_B.x - MTN_A.x) / _rgL, _rguz = (MTN_B.z - MTN_A.z) / _rgL;
function ridgeDist(x, z) {
  let dx = x - MTN_A.x, dz = z - MTN_A.z;
  let t = dx * _rgux + dz * _rguz;
  t = t < 0 ? 0 : t > _rgL ? _rgL : t;
  dx -= _rgux * t; dz -= _rguz * t;
  return Math.hypot(dx, dz);
}

// ---- canyon path (smooth polyline distance) ----
const CSEG = [];
let _acc = 0;
for (let i = 0; i < CANYON_PATH.length - 1; i++) {
  const a = CANYON_PATH[i], b = CANYON_PATH[i + 1];
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  CSEG.push({ ax: a.x, az: a.z, ux: dx / len, uz: dz / len, len, s0: _acc });
  _acc += len;
}
const CANYON_LEN = _acc;
let CB_X0 = 1e9, CB_X1 = -1e9, CB_Z0 = 1e9, CB_Z1 = -1e9;
for (const p of CANYON_PATH) {
  CB_X0 = Math.min(CB_X0, p.x - 850); CB_X1 = Math.max(CB_X1, p.x + 850);
  CB_Z0 = Math.min(CB_Z0, p.z - 850); CB_Z1 = Math.max(CB_Z1, p.z + 850);
}

let _cd = 0, _cs = 0; // module scratch: distance to path, param 0..1 along it
function canyonLocate(x, z) {
  if (x < CB_X0 || x > CB_X1 || z < CB_Z0 || z > CB_Z1) return false;
  let best = 1e18, bs = 0;
  for (let i = 0; i < CSEG.length; i++) {
    const g = CSEG[i];
    const dx = x - g.ax, dz = z - g.az;
    let t = dx * g.ux + dz * g.uz;
    t = t < 0 ? 0 : t > g.len ? g.len : t;
    const px = dx - g.ux * t, pz = dz - g.uz * t;
    const d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; bs = g.s0 + t; }
  }
  _cd = Math.sqrt(best);
  _cs = bs / CANYON_LEN;
  return true;
}

let _ppx = 0, _ppz = 0, _ppux = 0, _ppuz = 0; // pathPoint scratch (boulder scatter)
function pathPoint(sN) {
  let t = sN * CANYON_LEN;
  for (let i = 0; i < CSEG.length; i++) {
    const g = CSEG[i];
    if (t <= g.len || i === CSEG.length - 1) {
      t = Math.min(t, g.len);
      _ppx = g.ax + g.ux * t; _ppz = g.az + g.uz * t;
      _ppux = g.ux; _ppuz = g.uz;
      return;
    }
    t -= g.len;
  }
}

// gorge cut: flat floor (~72 m at the strip), steep strata walls 170-270 m above
// it, raised tableland shoulders blending back to the biome over ~430 m
function carveCanyon(x, z, h) {
  const s = _cs, d = _cd;
  const wf = 128 + 62 * smooth(0.30, 0.62, s); // floor half-width 128 -> 190 m
  if (d >= wf + 535) return h;
  const fl = 135 - 63 * smooth(0.04, 0.40, s) - 88 * smooth(0.70, 0.99, s); // 135 -> 72 -> sea
  const rim = Math.max(h + 26, fl + 172 + noise2(x * 0.0012 + 40.2, z * 0.0012 + 12.8) * 96);
  if (d < wf) return fl + (noise2(x * 0.02 + 3.3, z * 0.02 + 6.1) - 0.5) * 2.4;
  if (d < wf + 105) return fl + (rim - fl) * smooth(0, 1, (d - wf) / 105);
  return rim + (h - rim) * smooth(0, 1, (d - wf - 105) / 430);
}

// ---- per-strip terrain platforms: pull the base terrain to strip elevation over
// a rect larger than the flattening margin, so grading never fights the biome ----
const PLATFORMS = RUNWAYS.map((r) => {
  const hl = r.length / 2 + 70, hw = r.width / 2 + 55;
  const reach = Math.hypot(hl, hw) + r.pad;
  return { x: r.x, z: r.z, c: r._c, s: r._s, elev: r.elev, hl, hw, pad: r.pad, r2: reach * reach };
});
function applyPlatforms(x, z, h) {
  for (let i = 0; i < PLATFORMS.length; i++) {
    const p = PLATFORMS[i];
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz > p.r2) continue;
    const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;
    const du = Math.abs(lx) - p.hw, dv = Math.abs(lz) - p.hl;
    let w = 1;
    if (du > 0 || dv > 0) {
      const dd = Math.hypot(Math.max(0, du), Math.max(0, dv));
      if (dd >= p.pad) continue;
      const t = dd / p.pad;
      w = 1 - t * t * (3 - 2 * t);
    }
    h += (p.elev - h) * w;
  }
  return h;
}

// ---- approach corridors: soft height cap (~6.5% obstacle ramp) off both ends of
// every strip, so no biome feature can wander into short final ----
const CORRIDORS = [];
for (const r of RUNWAYS) {
  const ax = -r._s, az = -r._c;
  for (const e of [-1, 1]) {
    CORRIDORS.push({
      ox: r.x + e * ax * r.length / 2, oz: r.z + e * az * r.length / 2,
      ux: e * ax, uz: e * az, len: r.name === 'Coast' ? 1500 : 1400,
      hw: r.width * 3.5 + 60, base: r.elev + 4,
    });
  }
}
function applyCorridors(x, z, h) {
  for (let i = 0; i < CORRIDORS.length; i++) {
    const c = CORRIDORS[i];
    const dx = x - c.ox, dz = z - c.oz;
    const along = dx * c.ux + dz * c.uz;
    if (along < 0 || along > c.len) continue;
    const lat = Math.abs(dx * c.uz - dz * c.ux);
    if (lat >= c.hw) continue;
    const cap = c.base + along * 0.065;
    if (h <= cap) continue;
    h += (cap - h) * (1 - smooth(c.hw - 70, c.hw, lat)) * (1 - smooth(c.len - 500, c.len, along));
  }
  return h;
}
function nearCorridor(x, z) { // vegetation keep-out over the first stretch of final
  for (let i = 0; i < CORRIDORS.length; i++) {
    const c = CORRIDORS[i];
    const dx = x - c.ox, dz = z - c.oz;
    const along = dx * c.ux + dz * c.uz;
    if (along < -30 || along > 480) continue;
    if (Math.abs(dx * c.uz - dz * c.ux) < c.hw + 12) return true;
  }
  return false;
}

// ---- biome height fields (only evaluated where their region weight matters) ----
function hillsH(x, z) { // rolling green hills to ~130
  const b = fbm(x * 0.00095 + 7.3, z * 0.00095 + 3.1, 4) * 0.5 + 0.5;
  return 16 + Math.pow(b, 1.3) * 118 + fbm(x * 0.0042, z * 0.0042, 2) * 7;
}
function desertH(x, z) { // soft dunes < ~80 plus clamped flat-topped mesas to ~150
  const b = fbm(x * 0.0014 + 11.2, z * 0.0014 + 5.6, 3) * 0.5 + 0.5;
  const dn = Math.abs(fbm(x * 0.004 + z * 0.0013, z * 0.0021, 2)); // stretched ripples
  const mf = fbm(x * 0.00085 + 31.7, z * 0.00085 + 17.3, 3);
  return 10 + b * 52 + dn * 16 + smooth(0.30, 0.40, mf) * 82 + smooth(0.46, 0.54, mf) * 28;
}
function forestH(x, z) { // gentle wooded terrain to ~180
  const b = fbm(x * 0.0011 + 2.2, z * 0.0011 + 9.9, 4) * 0.5 + 0.5;
  return 22 + Math.pow(b, 1.2) * 158 + fbm(x * 0.005 + 1.1, z * 0.005, 2) * 6;
}
function mtnH(x, z, w) { // ridged fbm range + explicit summit bump at PEAK
  const rv = 1 - Math.abs(fbm(x * 0.0016 + 5.5, z * 0.0016 + 1.5, 5));
  const dx = x - PEAK.x, dz = z - PEAK.z;
  const h = 55 + Math.pow(rv, 1.6) * 330 * w + 120 * w + 290 * Math.exp(-(dx * dx + dz * dz) / 384400);
  return h > 560 ? 560 + (h - 560) * 0.55 : h; // soft ceiling: tops out ~650
}

// noise-warped region weights around the biome anchors (module scratch, no alloc)
let _wH = 0, _wD = 0, _wF = 0, _wM = 0;
function biomeWeights(x, z) {
  const wx = x + (noise2(x * 0.00034 + 9.1, z * 0.00034 + 4.4) - 0.5) * 2300;
  const wz = z + (noise2(x * 0.00034 + 1.7, z * 0.00034 + 8.2) - 0.5) * 2300;
  _wH = 1 - smooth(1500, 4300, Math.hypot(wx - HILLS_C.x, wz - HILLS_C.z));
  _wD = 1 - smooth(1700, 4300, Math.hypot(wx - DESERT_C.x, wz - DESERT_C.z));
  _wF = 1 - smooth(1600, 4200, Math.hypot(wx - FOREST_C.x, wz - FOREST_C.z));
  _wM = 1 - smooth(700, 3400, ridgeDist(wx, wz));
}

function baseHeight(x, z) {
  const r2 = x * x + z * z;
  if (r2 > 75690000) return -20; // beyond r 8700 the shelf has fully bottomed out
  const rr = Math.sqrt(r2) + (noise2(x * 0.00028 + 3.1, z * 0.00028 + 7.7) - 0.5) * 760;
  const m = 1 - (rr / R_MASK) * (rr / R_MASK);
  if (m <= 0) return Math.max(-20, -6 + m * 44); // underwater falloff to about -20
  biomeWeights(x, z);
  let sum = 0.06, h = 0.06 * 16; // faint generic-lowland floor bridges region gaps
  if (_wH > 0.012) { h += _wH * hillsH(x, z); sum += _wH; }
  if (_wD > 0.012) { h += _wD * desertH(x, z); sum += _wD; }
  if (_wF > 0.012) { h += _wF * forestH(x, z); sum += _wF; }
  if (_wM > 0.012) { h += _wM * mtnH(x, z, _wM); sum += _wM; }
  h = (h / sum) * Math.min(1, Math.pow(m, 0.85) * 1.3) - 6 + m * 12; // beach band at the rim
  if (canyonLocate(x, z)) h = carveCanyon(x, z, h);
  h = applyPlatforms(x, z, h);
  return applyCorridors(x, z, h);
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

  // terrain
  const terrainGeo = new THREE.PlaneGeometry(15600, 15600, 440, 440);
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
        cDirt = new THREE.Color(0x9b7f57), cDesert = new THREE.Color(0xd9bd7e),
        cOchre = new THREE.Color(0xc0904f), cSage = new THREE.Color(0x9aa468),
        cForL = new THREE.Color(0x4d7a39), cForD = new THREE.Color(0x2f5129),
        cMtnLow = new THREE.Color(0x8a7355), cRubble = new THREE.Color(0xa9825c),
        cDeep = new THREE.Color(0x35635d);
  const strata = [0x8f4a34, 0xb46b46, 0xc98f5f, 0x7c4030].map((v) => new THREE.Color(v));
  const c = new THREE.Color(), c2 = new THREE.Color();
  let ar = 0, ag = 0, ab = 0;
  const addC = (col, w) => { ar += col.r * w; ag += col.g * w; ab += col.b * w; };
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i), h = tPos.getY(i);
    const jit = noise2(x * 0.02, z * 0.02);
    const patch = noise2(x * 0.0035 + 40.7, z * 0.0035 + 9.2); // big vegetation patches
    biomeWeights(x, z);
    const sum = _wH + _wD + _wF + _wM + 0.06;
    ar = ag = ab = 0;
    c2.copy(cGrassL).lerp(cGrassD, patch * 0.8).lerp(cMeadow, (1 - patch) * jit * 0.5);
    addC(c2, _wH + 0.06); // hills double as the generic lowland fill
    if (_wD > 0.004) {
      c2.copy(cDesert).lerp(cOchre, smooth(0.35, 0.75, noise2(x * 0.0012 + 8.8, z * 0.0012 + 2.2)));
      if (jit > 0.72) c2.lerp(cSage, 0.45);
      addC(c2, _wD);
    }
    if (_wF > 0.004) { c2.copy(cForL).lerp(cForD, 0.3 + patch * 0.6); addC(c2, _wF); }
    if (_wM > 0.004) { c2.copy(cMtnLow).lerp(cRock, smooth(90, 300, h)).lerp(cRockD, jit * 0.4); addC(c2, _wM); }
    c.setRGB(ar / sum, ag / sum, ab / sum);
    // exposed rock on steep faces (warm-toned where the desert dominates)
    const steep = smooth(0.28, 0.55, 1 - tNorm.getY(i));
    if (steep > 0 && h > 2) {
      c2.copy(cRock).lerp(cRockD, jit * 0.7);
      if (_wD / sum > 0.5) c2.copy(cOchre).lerp(strata[1], 0.5);
      c.lerp(c2, steep * 0.85);
    }
    // canyon: layered red/brown strata on the walls, rubble on the floor
    if (canyonLocate(x, z)) {
      const wf = 128 + 62 * smooth(0.30, 0.62, _cs);
      if (_cd < wf) c.lerp(cRubble, 0.55);
      else if (_cd < wf + 330) {
        const band = h * 0.045 + jit * 0.8;
        const bi = ((band | 0) % 4 + 4) % 4;
        c2.copy(strata[bi]).lerp(strata[(bi + 1) % 4], (band - Math.floor(band)) * 0.6);
        const wallW = smooth(wf - 35, wf + 15, _cd) * (1 - smooth(wf + 150, wf + 320, _cd));
        c.lerp(c2, wallW * (0.35 + 0.65 * smooth(0.2, 0.5, 1 - tNorm.getY(i))));
      }
    }
    // coastal beach band: wet -> dry sand, then blend up into the biome
    if (h < 0.7) c.copy(cSandWet).lerp(cSand, smooth(-0.6, 0.7, h));
    else if (h < 9) { c2.copy(cSand).lerp(cSandWet, jit * 0.15).lerp(c, smooth(3.2, 9, h)); c.copy(c2); }
    if (h < -2.5) c.lerp(cDeep, smooth(2.5, 13, -h) * 0.75);
    // snow above ~420, noise-jittered
    const snowline = 420 + (noise2(x * 0.006 + 3.7, z * 0.006) - 0.5) * 76;
    if (h > snowline - 14) c.lerp(cSnow, smooth(snowline - 14, snowline + 10, h));
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
  // shared vegetation rejection: strips, short final, and the gorge itself
  function vetoed(x, z) {
    if (runwayInfluence(x, z) > 0.02) return true;
    if (canyonLocate(x, z) && _cd < 380) return true;
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
    if (h < 3.5 || h > 125) continue;
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
    if (h < 8 || h > 115) continue;
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
      const wfv = 128 + 62 * smooth(0.30, 0.62, sN);
      const mag = (wfv - 45 + noise2(rt * 2.3, 3.1) * 375) * (noise2(rt * 0.77, 9.9) > 0.5 ? 1 : -1);
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
    runways.update(time);
    water.update(time);
    clouds.update(time, planePos);
  }

  return { update };
}
