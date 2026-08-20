// Terrain tile bake worker: runs the exact same bakeTile the main thread uses,
// off-thread. RELATIVE imports only — import maps do NOT apply inside workers,
// so nothing under tilebake/heightcore/colorcore may touch 'three' (verified:
// all pure). Buffers are freshly allocated per job and posted back as
// transferables, so the main thread receives them with zero copy.
import { bakeTile, tileVertexCount, bakeAOGrid, sampleAOGrid, sampleAOGridB, applyAO } from './tilebake.js';
import { setTerrainSeed, heightAt } from './heightcore.js';
import { terrainColor } from './colorcore.js';

// Supersampled far-shell colour re-bake. The synchronous startup shell point-samples its
// paint at 62 m — every quilt edge and snowline stipples — and skips the relief probe to
// keep the cold start flat. Once the tile queue is idle, the main thread asks for the
// shell's colours again in row chunks, each vertex the MEAN of four full-paint samples on
// a rotated grid: a 62 m box filter, which is what a 1:500k map painter would do by hand.
// Chunked so a mid-flight tile job never waits behind more than one chunk (~1 s).
const OFF = [[-23, -8], [8, -23], [23, 8], [-8, 23]];
const _sc = [0, 0, 0];
function shellColors(j0, j1, segments) {
  const n1 = segments + 1, step = 15600 / segments;
  const colors = new Float32Array((j1 - j0) * n1 * 3);
  // the island AO lattice — re-baked per chunk because tile jobs between chunks
  // overwrite the shared module lattice with their own tile-sized bakes
  bakeAOGrid(-7800, -7800, 15600, 64);
  let o = 0;
  for (let j = j0; j < j1; j++) {
    const z = -7800 + j * step;
    for (let i = 0; i < n1; i++, o += 3) {
      const x = -7800 + i * step;
      const hC = heightAt(x, z);
      const PS = 12; // same fixed paint-normal stencil as bakeTile
      const gx = (heightAt(x + PS, z) - heightAt(x - PS, z)) / (2 * PS);
      const gz = (heightAt(x, z + PS) - heightAt(x, z - PS)) / (2 * PS);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      let r = 0, g = 0, b = 0;
      for (let s = 0; s < 4; s++) {
        const sx = x + OFF[s][0], sz = z + OFF[s][1];
        terrainColor(sx, sz, heightAt(sx, sz), ny, _sc);
        r += _sc[0]; g += _sc[1]; b += _sc[2];
      }
      _sc[0] = r / 4; _sc[1] = g / 4; _sc[2] = b / 4;
      if (hC > 0.5) applyAO(_sc, sampleAOGrid((x + 7800) / 15600, (z + 7800) / 15600, 64), 0.62,
        sampleAOGridB((x + 7800) / 15600, (z + 7800) / 15600, 64));
      colors[o] = _sc[0]; colors[o + 1] = _sc[1]; colors[o + 2] = _sc[2];
    }
  }
  return colors;
}

self.onmessage = (e) => {
  if (e.data.type === 'seed') { setTerrainSeed(e.data.seed); return; } // always the first message
  if (e.data.type === 'shellColors') {
    const { j0, j1, segments } = e.data;
    const colors = shellColors(j0, j1, segments);
    self.postMessage({ shellRows: true, j0, j1, segments, colors }, [colors.buffer]);
    return;
  }
  const { id, x0, z0, size, res, skirt, minSpan } = e.data;
  const n = tileVertexCount(res) * 3;
  const positions = new Float32Array(n);
  const colors = new Float32Array(n);
  const normals = new Float32Array(n);
  bakeTile(x0, z0, size, res, skirt, positions, colors, minSpan, normals);
  self.postMessage({ id, positions, colors, normals }, [positions.buffer, colors.buffer, normals.buffer]);
};
