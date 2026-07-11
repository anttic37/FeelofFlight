import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise2 } from './noise.js';

// Puffy cumulus: each cloud is 5-9 overlapping smooth-shaded ellipsoid puffs
// merged into one geometry (one draw call per cloud, ~80 clouds). Lambert with
// smooth normals + emissive keeps undersides bright — no dark faceted faces.
// Drift +X with wraparound over a 20 km box centered on the island.

const COUNT = 80;
const BOX = 20000;
const HALF = BOX / 2;

export function createClouds(scene) {
  const puffGeo = new THREE.IcosahedronGeometry(1, 1); // detail 1 => smooth sphere normals
  const mat = new THREE.MeshLambertMaterial({
    color: 0xf7fafd, emissive: 0xdfe9f2, emissiveIntensity: 0.42,
    transparent: true, opacity: 0.88, depthWrite: false,
  });
  // fresnel alpha fade softens silhouette edges; injected before opaque_fragment
  // where lambert's per-fragment `normal` and vViewPosition are in scope (r164)
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
      `float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.5);
diffuseColor.a *= mix(1.0, 0.35, fres);
#include <opaque_fragment>`);
  };

  const clouds = [];
  const parts = [];
  for (let i = 0; i < COUNT; i++) {
    const puffs = 5 + Math.floor(noise2(i * 3.1, 0.5) * 4.999);
    const spanX = 55 + noise2(i * 1.9, 7.7) * 62;
    const spanZ = 34 + noise2(i * 4.3, 9.2) * 42;
    parts.length = 0;
    for (let p = 0; p < puffs; p++) {
      const t = p / (puffs - 1);
      const big = 1 - Math.abs(t - 0.5) * 0.9; // fat middle, tapered ends
      const g = puffGeo.clone();
      g.scale(
        (24 + noise2(i * 5.1, p * 3.3) * 24) * big,
        (12 + noise2(i * 2.7, p * 6.1) * 8) * big,
        (20 + noise2(i * 7.9, p * 1.7) * 20) * big
      );
      g.translate(
        (t - 0.5) * spanX * 2 + (noise2(p * 1.7, i * 2.3) - 0.5) * 17,
        (noise2(p * 8.1, i * 6.7) - 0.5) * 11,
        (noise2(i * 1.3, p * 4.9) - 0.5) * spanZ * 2
      );
      parts.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.renderOrder = 2;
    const a = noise2(i * 3.7, 1.1) * Math.PI * 4;
    const r = 300 + noise2(i * 1.3, 8.8) * 9200;
    // 260-700 m: around and above the 650 m peaks; the ~500 m ones sit near the summit strip
    const baseY = 260 + noise2(i * 2.9, 4.2) * 440;
    mesh.position.set(Math.cos(a) * r, baseY, Math.sin(a) * r);
    mesh.rotation.y = noise2(i * 6.1, 2.2) * Math.PI * 2;
    scene.add(mesh);
    clouds.push({
      mesh, baseY, x0: mesh.position.x,
      speed: 3.2 + noise2(i * 9.7, 3.3) * 1.6,
      bobF: 0.06 + noise2(i * 5.5, 1.7) * 0.05,
      bobP: noise2(i * 8.3, 6.1) * Math.PI * 2,
    });
  }

  function update(time, planePos) {
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const x = c.x0 + time * c.speed + HALF;
      c.mesh.position.x = x - Math.floor(x / BOX) * BOX - HALF;
      c.mesh.position.y = c.baseY + Math.sin(time * c.bobF + c.bobP) * 2.5;
    }
  }

  return { update };
}
