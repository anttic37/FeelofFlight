// Terrain tile bake worker: runs the exact same bakeTile the main thread uses,
// off-thread. RELATIVE imports only — import maps do NOT apply inside workers,
// so nothing under tilebake/heightcore/colorcore may touch 'three' (verified:
// all pure). Buffers are freshly allocated per job and posted back as
// transferables, so the main thread receives them with zero copy.
import { bakeTile, tileVertexCount } from './tilebake.js';
import { setTerrainSeed } from './heightcore.js';

self.onmessage = (e) => {
  if (e.data.type === 'seed') { setTerrainSeed(e.data.seed); return; } // always the first message
  const { id, x0, z0, size, res, skirt, minSpan } = e.data;
  const n = tileVertexCount(res) * 3;
  const positions = new Float32Array(n);
  const colors = new Float32Array(n);
  bakeTile(x0, z0, size, res, skirt, positions, colors, minSpan);
  self.postMessage({ id, positions, colors }, [positions.buffer, colors.buffer]);
};
