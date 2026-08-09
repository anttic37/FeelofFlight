import * as THREE from 'three';
import { noise2 } from './noise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  heightAt, surfaceAt, runwayInfluence, nearCorridor,
  canyonLocate, _cd, _cs, cWf, cWr, TRIBS, tribLocate, _td,
  pathPoint, _ppx, _ppz, _ppux, _ppuz, CANYON_PATH,
  HILLS_C, DESERT_C, FOREST_C, MTN_A, MTN_B,
} from './heightcore.js';
import { createTerrain } from './terrain.js';
import { uGroundTime } from './groundfx.js';
import { createScatter } from './scatter.js';
import { SUN_DIR, SKY, createSkyMaterial } from './atmosphere.js';
import { createRunways } from './runways.js';
import { createWater } from './water.js';
import { createLandmarks } from './landmarks.js';
import { createShoreRibbon } from './shoreribbon.js';

// Scene construction for the procedural island: sky/sun/lights, the static
// terrain mesh, vegetation scatter, runways, water. Clouds are not scene
// objects any more — they are raymarched in post by volclouds.js. The analytic
// height field lives in heightcore.js and the vertex-color rules in
// colorcore.js (both pure and worker-loadable); heightAt/surfaceAt are
// re-exported here so consumer imports are unchanged.

export { heightAt, surfaceAt } from './heightcore.js';

export function createWorld(scene) {
  // fogColor is now only a fallback: the patched fog chunk computes the haze
  // per pixel from the view direction (see atmosphere.js), so distance tints
  // warm toward the sun and cool away from it instead of one flat grey
  scene.fog = new THREE.Fog(new THREE.Color(0xbcd8ee), 1500, 6500);

  // sky dome: gradient, horizon haze and the sun's halo, evaluated per pixel.
  // Radius 8500 > fog.far so nothing in the world ever pokes through it. It does
  // NOT write depth — see createSkyMaterial, which explains why that matters to
  // the clouds.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8500, 24, 16), createSkyMaterial());
  scene.add(sky);

  const sunDir = SUN_DIR;

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

  // THE LENS FLARE IS GONE, and it had to go rather than be fixed. three's Lensflare tests
  // occlusion by stamping a 16x16 probe into the framebuffer, reading it back, and restoring
  // the pixels underneath with copyFramebufferToTexture. That restore does not survive this
  // project's post-processing composer, so the probe stayed on screen: a hard-edged 16x16
  // black square parked next to the sun. Measured directly — 256 dark pixels with the flare
  // present, 0 with it hidden, 256 again when restored, which is 16x16 exactly.
  // Setting depthWrite=false on the flare's own quad (a separate, real bug: three gives it an
  // opacity-0 MeshBasicMaterial that still wrote depth and punched the sky dome out behind it)
  // fixed that second problem and left the probe untouched, because the probe is drawn by the
  // addon's own render pass and nothing here can reach it.
  // Losing it costs little: the dome already draws its own Mie halo around the sun, the sun
  // sprite carries the bloom, and the flare had already been shrunk once because stacking it
  // on the dome's halo "turned the whole area into a lavender smear". daynight.js's
  // `if (flare)` guard means world.flare simply being absent is a supported state.

  // lights. The hemisphere light is now a FLOOR under the sky environment map
  // rather than the whole ambient term — main.js bakes the dome into
  // scene.environment, which carries the same idea with real directional
  // structure. Leaving hemi at its old strength on top of that just washed
  // everything out, so it drops to filling the gap the env map is weakest at:
  // deep creases the cube capture cannot see into.
  const hemi = new THREE.HemisphereLight(0xbad7f0, 0x5e6a4f, 0.34);
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
  // ...plus a strip re-tessellated ALONG the coast on top of them, so the waterline is a mesh
  // edge rather than wherever the square lattice happens to cross zero. See shoreribbon.js.
  const shoreRibbon = createShoreRibbon(scene);

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
  const hasGorge = CANYON_PATH.length > 1; // v6 islands only carve one on some archetypes
  while (nR < MAXR && rt < MAXR * 22) {
    rt++;
    const pick = hasGorge ? rt % 10 : 4 + (rt % 6); // no gorge: split between scree + shoreline
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
    // scree stops at the paint snowline (same jitter as colorcore): dark grey
    // dodecahedra above it read as pepper specks all over the white caps
    else if (pick < 7) { if (h < 40 || h > 406 + (noise2(x * 0.006 + 3.7, z * 0.006) - 0.5) * 76 || slopeAt(x, z) < 0.3) continue; }
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

  // DECORATIONS OFF. Flat-shaded cones, icosahedron blobs and cylinder cacti at a scale
  // where the aircraft is the only thing close enough to read as a model — from the air
  // they are a pepper of dark specks over otherwise clean hillsides, and they date the
  // whole scene against the terrain, water and sky around them.
  //
  // Kept as code rather than deleted: the placement rules (biome, slope, snowline and
  // corridor vetoes) are the useful part and would have to be written again for any
  // replacement. ?props=1 puts them back.
  const SHOW_PROPS = new URLSearchParams(location.search).get('props') === '1';
  if (SHOW_PROPS) {
    for (const m of [pines, trunks, leaves, cacti1, cacti2, rocks]) {
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  const runways = createRunways(scene);
  const water = createWater(scene, heightAt);
  // masts on the summits and a wind farm on the next tier down — built after the runways so
  // the site scan can reject anything sitting on a strip or its approach
  const landmarks = createLandmarks(scene);
  // NEAR-FIELD PROPS, OFF. They existed to give a sense of speed close to the ground,
  // and they do — but they read as scattered white pebbles and teal cones sitting ON
  // the terrain rather than as anything growing out of it, and at altitude they are a
  // pepper of specks over otherwise clean hillsides. The ground rush they were bought
  // for is now carried by the splat detail and the wash effects.
  // ?props=1 brings them back.
  const scatter = SHOW_PROPS
    ? createScatter(scene)
    : { update() {}, stats: () => ({ off: true }) };

  // keep the sun (and its shadow box) and sky centered on the plane
  function update(planePos, time = 0) {
    // raw time, no wrap: value noise isn't periodic, so a wrap would visibly
    // reshuffle the cloud shadows; drift offsets stay float32-tiny for hours
    uGroundTime.value = time;
    // sunDir is SUN_DIR, which daynight.js rewrites in place, so the light and the disc
    // both follow the time of day without being told about it separately.
    sun.position.copy(planePos).addScaledVector(sunDir, 420);
    sun.target.position.copy(planePos);
    sky.position.set(planePos.x, 0, planePos.z);
    terrain.update(planePos);
    scatter.update(planePos, time);
    runways.update(time);
    water.update(time);
    landmarks.update(time);
  }

  // the atmosphere handles go out so daynight.js can drive them; everything else here is
  // internal
  return {
    update, terrain, scatter, water, shoreRibbon,
    skyMat: sky.material, sun, hemi, sunSpr,
  };
}
