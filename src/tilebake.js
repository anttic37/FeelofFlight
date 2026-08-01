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

// ---------------------------------------------------------------------------
// AMBIENT OCCLUSION, baked into the vertex colour.
//
// Everything on this island was lit by its own surface normal and nothing else, which
// is why the hills read as smooth inflated shapes however good the silhouette got. Real
// ground darkens where it is ENCLOSED — valley floors, the inside of every fold, the
// base of a slope — and that enclosure is independent of which way the surface faces.
// It is the single largest thing separating "shaded geometry" from "landscape".
//
// HORIZON SAMPLING, not curvature. For six compass directions, walk outward and keep
// the steepest upward angle to the skyline; the sky each vertex can still see is one
// minus the mean of those. Curvature is cheaper and was the obvious alternative, but it
// only knows the local bowl a vertex sits in — it cannot tell that a valley floor is
// dark because the ridge 300 m away blocks half the sky, which is exactly the effect
// that makes terrain read as big.
//
// Two radii, spread so one pass covers the fold you are standing in and the ridge on
// the far side of the valley: 45 m catches gullies, 180 m catches the enclosing hills.
//
// Baked, so it costs nothing at runtime and works at every distance — unlike a
// screen-space AO, which would fade out exactly where the terrain is largest.
// How much of the sky's contribution a fully enclosed vertex loses. Full occlusion
// (1.0) is too strong: this is a vertex colour, so it multiplies the DIFFUSE as well as
// the ambient, and taking all of it turns valley floors black under direct sun.
const AO_STRENGTH = 0.62;
// 6 directions and 2 radii, not 8 and 3. The first version cost 83 ms of a 97 ms tile
// bake — 85% of the whole thing — which streams terrain in visibly and would have hung
// the synchronous startup ring for seconds. Sky visibility is a smooth function; it does
// not repay 24 height queries per vertex.
const AO_DIRS = 6;
const AO_R = [45, 180];
// AO is sampled on a COARSE LATTICE and interpolated, not evaluated per vertex. It
// varies over tens of metres by construction — the whole point is the ridge on the far
// side of the valley — so a lattice every few vertices is visually identical and costs
// an order of magnitude less. This is the change that made it affordable.
const AO_STEP = 4;
const _aoGrid = new Float64Array(4225);   // up to a 65x65 lattice, reused, no allocation
const AO_COS = new Float64Array(AO_DIRS);
const AO_SIN = new Float64Array(AO_DIRS);
for (let d = 0; d < AO_DIRS; d++) {
  const a = (d / AO_DIRS) * Math.PI * 2;
  AO_COS[d] = Math.cos(a); AO_SIN[d] = Math.sin(a);
}

export function terrainAO(x, z, h) {
  let sky = 0;
  for (let d = 0; d < AO_DIRS; d++) {
    const cx = AO_COS[d], cz = AO_SIN[d];
    let maxT = 0;
    for (let k = 0; k < AO_R.length; k++) {
      const r = AO_R[k];
      const t = (heightAt(x + cx * r, z + cz * r) - h) / r;
      if (t > maxT) maxT = t;
    }
    // sin of the horizon angle: the fraction of that direction's sky that is blocked
    sky += maxT / Math.sqrt(1 + maxT * maxT);
  }
  return 1 - sky / AO_DIRS;   // 1 = open sky, lower = enclosed
}

// Fill the reusable lattice for one square of world, and read it back with bilinear
// interpolation. gn is the number of lattice CELLS across, so (gn+1)^2 samples.
export function bakeAOGrid(x0, z0, size, gn) {
  const s = size / gn;
  for (let j = 0; j <= gn; j++) {
    const z = z0 + j * s;
    for (let i = 0; i <= gn; i++) {
      const x = x0 + i * s;
      _aoGrid[j * (gn + 1) + i] = terrainAO(x, z, heightAt(x, z));
    }
  }
}
export function sampleAOGrid(u, v, gn) {   // u, v in 0..1 across the baked square
  const fu = Math.min(Math.max(u, 0), 1) * gn;
  const fv = Math.min(Math.max(v, 0), 1) * gn;
  let i0 = fu | 0, j0 = fv | 0;
  if (i0 >= gn) i0 = gn - 1;
  if (j0 >= gn) j0 = gn - 1;
  const tu = fu - i0, tv = fv - j0, w = gn + 1;
  const a = _aoGrid[j0 * w + i0], b = _aoGrid[j0 * w + i0 + 1];
  const c = _aoGrid[(j0 + 1) * w + i0], d = _aoGrid[(j0 + 1) * w + i0 + 1];
  return (a + (b - a) * tu) + ((c + (d - c) * tu) - (a + (b - a) * tu)) * tv;
}

// Occlusion darkens AND warms. What a hollow loses is SKY light, which is blue; what
// reaches it instead is light bounced off the ground around it, which is warm. Scaling
// all three channels equally gives a grey wash that reads as dirt rather than as shade.
export function applyAO(col, ao, strength) {
  const k = 1 - strength * (1 - ao);
  col[0] *= k;
  col[1] *= k * 0.985;
  col[2] *= k * 0.955;
}

export function bakeTile(x0, z0, size, res, skirtDepth, posOut, colOut, minSpan, nrmOut) {
  const cell = size / res;
  // AO lattice for this tile, one entry per AO_STEP vertices (at least 2 cells)
  const _aoN = Math.max(2, Math.ceil(res / AO_STEP));
  bakeAOGrid(x0, z0, size, _aoN);
  const ms = minSpan || 0;
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
      let hy = h;
      if (ms > 0 && h > 2) {
        // CONSERVATIVE LOWER ENVELOPE for coarser rings: a vertex takes the
        // MIN of itself and 4 taps at half-spacing, so the coarse surface can
        // never rise above terrain the finer rings actually show — the root
        // cause of the serrated ring-overlap bands on steep slopes. Colors
        // and paint normals still come from the exact center sample.
        // SHORE-FADED (zero below 2 m, full by 12 m) and SLOPE-GATED: poke-
        // through only happens on steep ground, and on gentle shores the
        // min-taps just catch the swash trough / berm base and carve V-teeth
        // into the beach band (the half-faded 2-12 m zone was serrating every
        // coarse-LOD coastline). The tap differences give the slope for free.
        let mn = h;
        const h1 = heightAt(x + ms, z), h2 = heightAt(x - ms, z);
        const h3 = heightAt(x, z + ms), h4 = heightAt(x, z - ms);
        if (h1 < mn) mn = h1; if (h2 < mn) mn = h2;
        if (h3 < mn) mn = h3; if (h4 < mn) mn = h4;
        const grad = Math.hypot(h1 - h2, h3 - h4) / (2 * ms);
        // slope threshold rises near the shore: the berm/swash faces are
        // locally ~0.1-0.25 steep and re-armed the gate, carving the beach
        // band anyway — under ~10 m only true cliff faces (>0.3) qualify
        const hf = h >= 10 ? 1 : h <= 6 ? 0 : (h - 6) / 4;
        const thLo = 0.30 - 0.23 * hf * hf * (3 - 2 * hf);
        const sRaw = (grad - thLo) / 0.15;
        const sw = sRaw <= 0 ? 0 : sRaw >= 1 ? 1 : sRaw * sRaw * (3 - 2 * sRaw);
        const t = h >= 12 ? 1 : (h - 2) / 10;
        hy = h + (mn - h) * t * t * (3 - 2 * t) * sw;
      }
      posOut[o] = x; posOut[o + 1] = hy; posOut[o + 2] = z;
      const gx = (heightAt(x + cell, z) - heightAt(x - cell, z)) / (2 * cell);
      const gz = (heightAt(x, z + cell) - heightAt(x, z - cell)) / (2 * cell);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz); // normalize(-gx, 1, -gz).y
      terrainColor(x, z, h, ny, _col);
      // Underwater ground is excluded: the sea floor is lit through the water by its own
      // depth palette, and occluding it as well doubles up and turns the shallows muddy.
      if (h > 0.5) applyAO(_col, sampleAOGrid(ix / res, iz / res, _aoN), AO_STRENGTH);
      colOut[o] = _col[0]; colOut[o + 1] = _col[1]; colOut[o + 2] = _col[2];
      if (nrmOut) {
        // analytic vertex normal, free here (gx/gz/ny already computed). Only
        // the shadow-receive path reads it (flatShading lights by derivative
        // face normals), and analytic beats computeVertexNormals: no per-tile
        // edge seams, no main-thread pass at apply time.
        nrmOut[o] = -gx * ny; nrmOut[o + 1] = ny; nrmOut[o + 2] = -gz * ny;
      }
    }
  }
  // Skirt ring: perimeter duplicates dropped by skirtDepth and pushed outward
  // 3x that — a GENTLE RAMP (~18°) bridging this tile down to the (enveloped,
  // slightly lower) coarser ring behind it. Steep or vertical skirts flat-shade
  // dark and read as serrated teeth / dashed slivers along ring boundaries;
  // a near-terrain-slope ramp shades like the hillside it continues.
  const ring = 4 * res;
  const out = skirtDepth * 3;
  for (let k = 0; k < ring; k++, o += 3) {
    const g = ringGridIndex(res, k) * 3;
    let ox = 0, oz = 0;
    if (k < res) oz = -out;         // z-min edge faces -z
    else if (k < 2 * res) ox = out; // x-max edge faces +x
    else if (k < 3 * res) oz = out; // z-max edge faces +z
    else ox = -out;                 // x-min edge faces -x
    posOut[o] = posOut[g] + ox;
    posOut[o + 1] = posOut[g + 1] - skirtDepth;
    posOut[o + 2] = posOut[g + 2] + oz;
    colOut[o] = colOut[g]; colOut[o + 1] = colOut[g + 1]; colOut[o + 2] = colOut[g + 2];
    if (nrmOut) { nrmOut[o] = nrmOut[g]; nrmOut[o + 1] = nrmOut[g + 1]; nrmOut[o + 2] = nrmOut[g + 2]; }
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
