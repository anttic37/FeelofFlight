import * as THREE from 'three';
import { getTerrainSeed } from './heightcore.js';
import { terrainColor } from './colorcore.js';
import { injectGroundFX } from './groundfx.js';

// A strip of terrain tessellated ALONG the coast, laid over the LOD tiles.
//
// The tiles are a square lattice, so the waterline they draw is wherever that lattice happens
// to cross zero — a polygon of 5 m facets close in and 40 m facets further out, and the facets
// change shape as you fly because they belong to whichever ring is covering that ground. This
// strip's outer edge IS the contour: its vertices are on h = 0 by construction, so the line
// where land meets sea is a mesh edge and stops being an accident of tessellation.
//
// It is not a decorative sand band. Every vertex takes its height, colour and normal from the
// same functions the tiles use, so it is the same terrain drawn a second time with a better
// topology, and it disappears into the ground behind it.
export function createShoreRibbon(scene, onReady) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1,
    // wins every depth tie against the tiles it covers, including the shell at 3
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  injectGroundFX(mat);

  let mesh = null;
  if (new URLSearchParams(location.search).get('ribbon') === '0') return { mesh: null };

  try {
    const w = new Worker(new URL('./ribbonworker.js', import.meta.url), { type: 'module' });
    w.onerror = (e) => {
      console.error('[flighfeel] shore ribbon failed', e && (e.message || e.type));
      w.terminate();
    };
    w.onmessage = (e) => {
      const { pos, nrm, index, loops, verts } = e.data;
      // colour on this side: colorcore is already here for the tiles, and posting a third
      // buffer back to save one pass over 20k vertices is not worth the code
      const col = new Float32Array(pos.length);
      const c = [0, 0, 0];
      for (let i = 0, o = 0; i < verts; i++, o += 3) {
        terrainColor(pos[o], pos[o + 2], pos[o + 1], nrm[o + 1], c);
        col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      mesh = new THREE.Mesh(g, mat);
      mesh.name = 'shore ribbon';
      mesh.receiveShadow = true;
      // never culled: it is one mesh wrapping the whole island, so its bounding sphere is the
      // island and a frustum test on it can only ever say yes
      mesh.frustumCulled = false;
      scene.add(mesh);
      console.log(`[flighfeel] shore ribbon: ${loops} loop(s), ${verts} verts, ${index.length / 3} tris`);
      w.terminate();
      onReady && onReady(mesh);
    };
    w.postMessage({ type: 'seed', seed: getTerrainSeed() });
    w.postMessage({ size: 16400 });
  } catch (err) {
    console.error('[flighfeel] shore ribbon worker unavailable', err);
  }

  return { get mesh() { return mesh; }, material: mat };
}
