import { heightAt } from './heightcore.js';
import { terrainColor } from './colorcore.js';

// The ONE tile-bake function both threads run: the terrain worker for streamed
// tiles and the main thread for the synchronous startup ring / teleport guard.
// Pure (heightcore + colorcore only, no THREE) so it loads in a module worker,
// and allocation-free — the caller owns and preallocates the output buffers,
// which lets the worker hand them over as transferables.
//
// VERTEX LAYOUT (deterministic — buildTileIndex(res) is precomputed against it):
//   grid: (res+1)^2 vertices, row-major iz-then-ix —
//     v(ix, iz) = iz*(res+1) + ix, at world x = x0 + ix*cell, z = z0 + iz*cell,
//     cell = size/res, y = heightAt(x, z). Positions are WORLD coordinates;
//     tile meshes stay at the origin (bar the per-ring y bias).
//   skirt: 4*res perimeter duplicates appended after the grid, walked as one
//     closed ring (see ringGridIndex): z-min edge +x, x-max edge +z, z-max
//     edge -x, x-min edge -z. Skirt vertex k copies ring vertex k's x/z and
//     color with y dropped by skirtDepth — hides sub-pixel LOD cracks.
// Total vertices: tileVertexCount(res). posOut/colOut are Float32Array(3*that).

export function tileVertexCount(res) {
  return (res + 1) * (res + 1) + 4 * res;
}

// ring position k (0 .. 4*res-1) -> grid vertex index, walking the perimeter
function ringGridIndex(res, k) {
  const n1 = res + 1;
  if (k < res) return k;                            // z-min edge, +x
  if (k < 2 * res) return (k - res) * n1 + res;     // x-max edge, +z
  if (k < 3 * res) return res * n1 + (3 * res - k); // z-max edge, -x
  return (4 * res - k) * n1;                        // x-min edge, -z
}

const _col = [0, 0, 0]; // reused rgb out for terrainColor

export function bakeTile(x0, z0, size, res, skirtDepth, posOut, colOut) {
  const cell = size / res;
  // Grid: heights + colors. terrainColor's normalY (steep-face rock, scree)
  // comes from an ANALYTIC central difference of heightAt with spacing = one
  // cell, so the paint is seam-consistent across tiles, LODs and threads —
  // no mesh normals involved (flat shading derives face normals in-shader).
  let o = 0;
  for (let iz = 0; iz <= res; iz++) {
    const z = z0 + iz * cell;
    for (let ix = 0; ix <= res; ix++, o += 3) {
      const x = x0 + ix * cell;
      const h = heightAt(x, z);
      posOut[o] = x; posOut[o + 1] = h; posOut[o + 2] = z;
      const gx = (heightAt(x + cell, z) - heightAt(x - cell, z)) / (2 * cell);
      const gz = (heightAt(x, z + cell) - heightAt(x, z - cell)) / (2 * cell);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz); // normalize(-gx, 1, -gz).y
      terrainColor(x, z, h, ny, _col);
      colOut[o] = _col[0]; colOut[o + 1] = _col[1]; colOut[o + 2] = _col[2];
    }
  }
  // Skirt ring: perimeter duplicates dropped by skirtDepth, colors copied so
  // the wall continues the rim's paint (no color seam at the fold).
  const ring = 4 * res;
  for (let k = 0; k < ring; k++, o += 3) {
    const g = ringGridIndex(res, k) * 3;
    posOut[o] = posOut[g]; posOut[o + 1] = posOut[g + 1] - skirtDepth; posOut[o + 2] = posOut[g + 2];
    colOut[o] = colOut[g]; colOut[o + 1] = colOut[g + 1]; colOut[o + 2] = colOut[g + 2];
  }
}

// Index buffer for the layout above — identical for every tile of a given res,
// so the main thread builds it once per res and shares the array across tiles.
// Grid quads split (a,c,b)/(b,c,d), both facing +Y; skirt quads face outward.
export function buildTileIndex(res) {
  const n1 = res + 1, N = n1 * n1, ring = 4 * res;
  const count = res * res * 6 + ring * 6;
  const idx = N + ring > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  let o = 0;
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const a = iz * n1 + ix, b = a + 1, c = a + n1, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  for (let k = 0; k < ring; k++) {
    const k1 = (k + 1) % ring;
    const g0 = ringGridIndex(res, k), g1 = ringGridIndex(res, k1);
    idx[o++] = g0; idx[o++] = g1; idx[o++] = N + k;
    idx[o++] = g1; idx[o++] = N + k1; idx[o++] = N + k;
  }
  return idx;
}
