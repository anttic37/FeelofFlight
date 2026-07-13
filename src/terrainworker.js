// Terrain tile bake worker: runs the exact same bakeTile the main thread uses,
// off-thread. RELATIVE imports only — import maps do NOT apply inside workers,
// so nothing under tilebake/heightcore/colorcore may touch 'three' (verified:
// all pure). Buffers are freshly allocated per job and posted back as
// transferables, so the main thread receives them with zero copy.
import { bakeTile, tileVertexCount } from './tilebake.js';

self.onmessage = (e) => {
  const { id, x0, z0, size, res, skirt } = e.data;
  const n = tileVertexCount(res) * 3;
  const positions = new Float32Array(n);
  const colors = new Float32Array(n);
  bakeTile(x0, z0, size, res, skirt, positions, colors);
  self.postMessage({ id, positions, colors }, [positions.buffer, colors.buffer]);
};
