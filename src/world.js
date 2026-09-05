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
import { uGroundTime, setCoastCenter } from './groundfx.js';
import { createScatter } from './scatter.js';
import { SUN_DIR, SKY, createSkyMaterial } from './atmosphere.js';
import { createRunways } from './runways.js';
import { createWater } from './water.js';
import { createLandmarks } from './landmarks.js';
import { createShoreRibbon } from './shoreribbon.js';
import { createBirds } from './birds.js';
import { groundHitAlongSun } from './planeblob.js';

// Scene construction for the procedural island: sky/sun/lights, the static
// terrain mesh, vegetation scatter, runways, water. Clouds are not scene
// objects any more — they are raymarched in post by volclouds.js. The analytic
// height field lives in heightcore.js and the vertex-color rules in
// colorcore.js (both pure and worker-loadable); heightAt/surfaceAt are
// re-exported here so consumer imports are unchanged.

export { heightAt, surfaceAt } from './heightcore.js';

// SHADOWS ARE ALMOST INVISIBLE HERE, and that is the fact to know before touching
// them. TERRAIN DOES NOT CAST — tiles are receiveShadow only — so there is no hill
// shading its own valley; the only casters are the plane, scattered vegetation and
// the landmarks. Measured: toggling sun.castShadow entirely, with the plane 22 m
// above flat ground, moves 0.14% of the frame (on-vs-on control: exactly 0).
//
// A pass that widened the box to +/-420 at 4096, stood the light 1600 m back with
// far 3400, aimed it at the ground under the plane and snapped it to shadow texels
// was measured and REVERTED in full: across five spots the wider box changed 0.02%
// of the frame at best and nothing at four of them, for 4x the shadow-map fill, and
// the longer far plane changed 0.000% at 300, 900 and 1500 m AGL. None of it earned
// its keep. This is the original box, unchanged.

// THE PLANE'S SHADOW IS CUT BY THE FAR PLANE, NOT THE BOX. The plane and the spot its shadow
// lands on lie on the SAME light ray, so in the shadow camera's frame the shadow is always at
// the centre of the +/-160 m box however high you fly — the old note about it "leaving the box
// laterally" had the geometry wrong. What actually ends it is depth: the ground point sits at
// light-depth SHADOW_LIGHT_DIST + AGL / sunY, and with a fixed far of 1000 the shadow vanished
// above 410 m at noon and above ~100 m at a 10 degree sun. So the far plane now FOLLOWS the
// landing point every frame (see update), up to this cap, and the blob shadow takes over only
// past it: ~1500 m AGL at noon, ~360 m at 10 degrees. Bias is scaled with the range so its
// world-space size stays what it was tuned at.
export const SHADOW_LIGHT_DIST = 420;
export const SHADOW_FAR_CAP = 3200;
// shadowfade.js fades every shadow toward lit over the LAST 18% of the shadow camera's depth
// range (smoothstep 0.82..1.0 on depth) so casters stop snapping at the box edge. The landing
// point therefore has to sit BEFORE that band: the far plane is sized so it lands at this
// fraction of the range. Measured before this existed: with the landing point at 94-97% of the
// range the plane's shadow was 119 px at 600 m AGL and 0 px at 1200 m — faded out by the very
// thing meant to soften edges.
export const SHADOW_DEPTH_USE = 0.78;
const _sunHit = new THREE.Vector3();   // scratch for the per-frame landing-point march

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

  // DECORATIONS ARE OFF BY DEFAULT (see the long note below), and the placement scans are
  // the single most wasteful thing at boot when they are: thousands of heightAt + slopeAt
  // (4 heightAt) + vetoed() calls filling instance buffers that are then never added to the
  // scene. Declared here (was below) so each placement loop can be gated on it — with props
  // off the loops never run a single sample; with ?props=1 behaviour is byte-identical.
  const SHOW_PROPS = new URLSearchParams(location.search).get('props') === '1';

  // pines: dense in the western woods, plus mountain flanks below the snowline
  const MAXP = 1600;
  const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 6, 6), whiteFlat(), MAXP);
  let nP = 0, tp = 0;
  while (SHOW_PROPS && nP < MAXP && tp < MAXP * 28) {
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
  while (SHOW_PROPS && nD < MAXD && td < MAXD * 26) {
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
  while (SHOW_PROPS && nC1 + nC2 < MAXC * 2 && tc < MAXC * 50) {
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
  while (SHOW_PROPS && nR < MAXR && rt < MAXR * 22) {
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
  // replacement. ?props=1 puts them back. (SHOW_PROPS is declared up by the pines block so
  // the placement loops can skip their scans when props are off.)
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
  // LANDMARKS DEFERRED past first paint. createLandmarks runs two full-island site scans +
  // ridge walks + wire-clearance sampling (~128 ms of boot). They are additive props sitting
  // ON the terrain — not part of the no-hole shell — so building them a couple of frames in
  // just makes them stream like the tiles and clouds already do, with no gap in the ground.
  // The no-op stub covers update() for the ~2-frame gap; the update() below reads this outer
  // binding each frame, so the real object takes over the instant it is assigned.
  let landmarks = { update() {} };
  requestAnimationFrame(() => requestAnimationFrame(() => { landmarks = createLandmarks(scene); }));
  // NEAR-FIELD PROPS, OFF. They existed to give a sense of speed close to the ground,
  // and they do — but they read as scattered white pebbles and teal cones sitting ON
  // the terrain rather than as anything growing out of it, and at altitude they are a
  // pepper of specks over otherwise clean hillsides. The ground rush they were bought
  // for is now carried by the splat detail and the wash effects.
  // ?props=1 brings them back.
  const scatter = SHOW_PROPS
    ? createScatter(scene)
    : { update() {}, stats: () => ({ off: true }) };
  // ...and the OTHER empty band. The near-field props above fill the ground rush;
  // birds fill the 300 m to 1 km middle distance, which had nothing in it at all.
  const birds = createBirds(scene);

  // keep the sun (and its shadow box) and sky centered on the plane
  function update(planePos, time = 0) {
    // raw time, no wrap: value noise isn't periodic, so a wrap would visibly
    // reshuffle the cloud shadows; drift offsets stay float32-tiny for hours
    uGroundTime.value = time;
    // sunDir is SUN_DIR, which daynight.js rewrites in place, so the light and the disc
    // both follow the time of day without being told about it separately.
    // the coarse LOD layers stop drawing at the waterline inside this disc (groundfx COAST)
    setCoastCenter(planePos.x, planePos.z);
    sun.position.copy(planePos).addScaledVector(sunDir, SHADOW_LIGHT_DIST);
    sun.target.position.copy(planePos);
    // FAR PLANE FOLLOWS THE SHADOW'S LANDING POINT (see SHADOW_FAR_CAP). One flat-ground step
    // down-sun, one correction against the height there, plus a margin for relief below it.
    {
      // the same march the blob shadow uses, so both agree on where the shadow lands
      const t = groundHitAlongSun(planePos, heightAt, _sunHit);
      const far = Math.min(SHADOW_FAR_CAP, Math.max(700, (SHADOW_LIGHT_DIST + t + 40) / SHADOW_DEPTH_USE));
      const cam = sun.shadow.camera;
      if (Math.abs(cam.far - far) > 2) {
        cam.far = far;
        cam.updateProjectionMatrix();
        // constant bias is in NDC, so it scales with the depth range: keep its WORLD size at
        // the value it was tuned at (-0.0006 over the original 950 m range)
        sun.shadow.bias = -0.0006 * 950 / (far - cam.near);
      }
    }
    sky.position.set(planePos.x, 0, planePos.z);
    terrain.update(planePos);
    scatter.update(planePos, time);
    birds.update(planePos, time);
    runways.update(time);
    water.update(time);
    landmarks.update(time);
  }

  // the atmosphere handles go out so daynight.js can drive them; everything else here is
  // internal
  return {
    update, terrain, scatter, water, shoreRibbon, birds,
    skyMat: sky.material, sun, hemi, sunSpr,
    // getter, not a value: landmarks is built a couple of frames after this object is
    // returned, so a by-value field would freeze the no-op stub in place
    get landmarks() { return landmarks; },
  };
}
