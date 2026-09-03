// Terrain tile bake worker: runs the exact same bakeTile the main thread uses,
// off-thread. RELATIVE imports only — import maps do NOT apply inside workers,
// so nothing under tilebake/heightcore/colorcore may touch 'three' (verified:
// all pure). Buffers are freshly allocated per job and posted back as
// transferables, so the main thread receives them with zero copy.
import { bakeTile, tileVertexCount } from './tilebake.js';
import { setTerrainSeed } from './heightcore.js';

// The far shell's colours used to be re-baked here too, per vertex in row chunks between tile
// jobs. That is gone: the shell now samples a full-island colormap texture baked by its own
// one-shot worker (colormapworker.js), which resolves relief detail no per-vertex bake on a
// 162 m grid ever could. This worker only bakes tiles.

self.onmessage = (e) => {
  if (e.data.type === 'seed') { setTerrainSeed(e.data.seed); return; } // always the first message
  const { id, x0, z0, size, res, skirt, minSpan } = e.data;
  const n = tileVertexCount(res) * 3;
  const positions = new Float32Array(n);
  const colors = new Float32Array(n);
  const normals = new Float32Array(n);
  bakeTile(x0, z0, size, res, skirt, positions, colors, minSpan, normals);
  self.postMessage({ id, positions, colors, normals }, [positions.buffer, colors.buffer, normals.buffer]);
};
