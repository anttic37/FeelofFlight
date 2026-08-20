import { heightAt } from './heightcore.js';
import { terrainColor, reliefProbe } from './colorcore.js';

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
const _p3 = [0, 0, 0];  // reused probe out for reliefProbe

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
const AO_DIRS = 6;   // radii are fixed at 45 m and 180 m inside terrainAO
// AO is sampled on a COARSE LATTICE and interpolated, not evaluated per vertex. It
// varies over tens of metres by construction — the whole point is the ridge on the far
// side of the valley — so a lattice every few vertices is visually identical and costs
// an order of magnitude less. This is the change that made it affordable.
const AO_STEP = 4;
const _aoGrid = new Float64Array(4225);   // up to a 65x65 lattice, reused, no allocation
const _aoGridB = new Float64Array(4225);  // the broad (180 m only) channel, same lattice
const AO_COS = new Float64Array(AO_DIRS);
const AO_SIN = new Float64Array(AO_DIRS);
for (let d = 0; d < AO_DIRS; d++) {
  const a = (d / AO_DIRS) * Math.PI * 2;
  AO_COS[d] = Math.cos(a); AO_SIN[d] = Math.sin(a);
}

// TWO CHANNELS FROM THE SAME TAPS. The combined max() channel is the shipped AO,
// bit-identical to what it always was. The 180 m radius ALONE is additionally kept as a
// BROAD channel: it knows only the big enclosure — which valley you are in, not which
// rut — and that is exactly the scale at which relief painters pool a cool haze in the
// valley floors. Same 12 height queries; the split is free.
const _aoOut = [1, 1];   // [combined, broad] — written by terrainAO, read by bakeAOGrid
export function terrainAO(x, z, h) {
  let sky = 0, skyB = 0;
  for (let d = 0; d < AO_DIRS; d++) {
    const cx = AO_COS[d], cz = AO_SIN[d];
    const t45 = (heightAt(x + cx * 45, z + cz * 45) - h) / 45;
    const t180 = (heightAt(x + cx * 180, z + cz * 180) - h) / 180;
    const maxT = t45 > t180 ? (t45 > 0 ? t45 : 0) : (t180 > 0 ? t180 : 0);
    // sin of the horizon angle: the fraction of that direction's sky that is blocked
    sky += maxT / Math.sqrt(1 + maxT * maxT);
    if (t180 > 0) skyB += t180 / Math.sqrt(1 + t180 * t180);
  }
  _aoOut[0] = 1 - sky / AO_DIRS;    // 1 = open sky, lower = enclosed
  _aoOut[1] = 1 - skyB / AO_DIRS;
  return _aoOut[0];
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
      _aoGridB[j * (gn + 1) + i] = _aoOut[1];
    }
  }
}
function bilerpGrid(grid, u, v, gn) {   // u, v in 0..1 across the baked square
  const fu = Math.min(Math.max(u, 0), 1) * gn;
  const fv = Math.min(Math.max(v, 0), 1) * gn;
  let i0 = fu | 0, j0 = fv | 0;
  if (i0 >= gn) i0 = gn - 1;
  if (j0 >= gn) j0 = gn - 1;
  const tu = fu - i0, tv = fv - j0, w = gn + 1;
  const a = grid[j0 * w + i0], b = grid[j0 * w + i0 + 1];
  const c = grid[(j0 + 1) * w + i0], d = grid[(j0 + 1) * w + i0 + 1];
  return (a + (b - a) * tu) + ((c + (d - c) * tu) - (a + (b - a) * tu)) * tv;
}
export function sampleAOGrid(u, v, gn) { return bilerpGrid(_aoGrid, u, v, gn); }
export function sampleAOGridB(u, v, gn) { return bilerpGrid(_aoGridB, u, v, gn); }

// Occlusion darkens AND warms. What a hollow loses is SKY light, which is blue; what
// reaches it instead is light bounced off the ground around it, which is warm. Scaling
// all three channels equally gives a grey wash that reads as dirt rather than as shade.
export function applyAO(col, ao, strength, aoB) {
  const k = 1 - strength * (1 - ao);
  col[0] *= k;
  col[1] *= k * 0.985;
  col[2] *= k * 0.955;
  // VALLEY HAZE, from the broad channel alone. Depth in a landscape painting is done
  // twice over: the fold you stand in goes warm-dark (the multiply above — hollows lose
  // blue skylight and keep warm ground bounce), while the VALLEY you are in sinks toward
  // a cool atmospheric grey — light that has crossed more air before reaching the eye.
  // 9% at full enclosure: felt as depth, never seen as fog.
  if (aoB !== undefined) {
    const t = (1 - aoB) * 0.09;
    col[0] += (HAZE_R - col[0]) * t;
    col[1] += (HAZE_G - col[1]) * t;
    col[2] += (HAZE_B - col[2]) * t;
  }
}
// linear-space cool grey-blue (0x8ea0ac through the same sRGB decode colorcore uses)
const s2l = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const HAZE_R = s2l(0x8e / 255), HAZE_G = s2l(0xa0 / 255), HAZE_B = s2l(0xac / 255);

// Relief-probe lattice, world-aligned at 20 m — see reliefProbe in colorcore for why.
// Up to a 97x97 lattice (LOD2's 1920 m tile), three fields, reused, no allocation.
const PROBE_STEP = 20;
const _prGx = new Float64Array(9409);
const _prGz = new Float64Array(9409);
const _prRel = new Float64Array(9409);

export function bakeTile(x0, z0, size, res, skirtDepth, posOut, colOut, minSpan, nrmOut) {
  const cell = size / res;
  // AO lattice for this tile, one entry per AO_STEP vertices (at least 2 cells)
  const _aoN = Math.max(2, Math.ceil(res / AO_STEP));
  bakeAOGrid(x0, z0, size, _aoN);
  const ms = minSpan || 0;
  // The probe lattice only pays when it is COARSER than the vertex grid (rings 0/1);
  // on ring 2 the 40 m vertices are already sparser than 20 m, so per-vertex is cheaper
  // and just as consistent (the field is Nyquist-limited well above that pitch).
  const useLattice = cell < PROBE_STEP;
  const prN = useLattice ? size / PROBE_STEP : 0;
  if (useLattice) {
    for (let j = 0; j <= prN; j++) {
      const z = z0 + j * PROBE_STEP;
      for (let i = 0; i <= prN; i++) {
        const x = x0 + i * PROBE_STEP;
        reliefProbe(x, z, heightAt(x, z), _p3);
        const o = j * (prN + 1) + i;
        _prGx[o] = _p3[0]; _prGz[o] = _p3[1]; _prRel[o] = _p3[2];
      }
    }
  }
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
      // FIXED 12 m STENCIL, NOT ONE CELL. The gradient spacing used to be the ring's own
      // cell (5 / 15 / 40 m), so the same hillside was painted and lit from three
      // different slope fields — the rock band bloomed as a tile crossed a ring
      // boundary, and 40 m normals on high-curvature snow caps are the polygon facets.
      // One fixed span makes paint and lighting a pure function of position: identical
      // across rings, and on LOD2's 40 m chords the 12 m normals act as a baked normal
      // map. LOD0 loses its 5 m slope detail to the splat/bump layer, which carries
      // near-field grain anyway — and now agrees with the bake instead of fighting it.
      const PS = 12;
      const gx = (heightAt(x + PS, z) - heightAt(x - PS, z)) / (2 * PS);
      const gz = (heightAt(x, z + PS) - heightAt(x, z - PS)) / (2 * PS);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz); // normalize(-gx, 1, -gz).y
      if (useLattice && h > 0.5) {
        // bilerp the three probe fields at this vertex (inline: the bake is allocation-free)
        const fu = (ix * cell) / PROBE_STEP, fv = (iz * cell) / PROBE_STEP;
        let i0 = fu | 0, j0 = fv | 0;
        if (i0 >= prN) i0 = prN - 1;
        if (j0 >= prN) j0 = prN - 1;
        const tu = fu - i0, tv = fv - j0, w = prN + 1, b0 = j0 * w + i0;
        const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
        const pgx = _prGx[b0] * w00 + _prGx[b0 + 1] * w10 + _prGx[b0 + w] * w01 + _prGx[b0 + w + 1] * w11;
        const pgz = _prGz[b0] * w00 + _prGz[b0 + 1] * w10 + _prGz[b0 + w] * w01 + _prGz[b0 + w + 1] * w11;
        const prl = _prRel[b0] * w00 + _prRel[b0 + 1] * w10 + _prRel[b0 + w] * w01 + _prRel[b0 + w + 1] * w11;
        terrainColor(x, z, h, ny, _col, false, pgx, pgz, prl);
      } else {
        terrainColor(x, z, h, ny, _col);
      }
      // Underwater ground is excluded: the sea floor is lit through the water by its own
      // depth palette, and occluding it as well doubles up and turns the shallows muddy.
      if (h > 0.5) applyAO(_col, sampleAOGrid(ix / res, iz / res, _aoN), AO_STRENGTH,
        sampleAOGridB(ix / res, iz / res, _aoN));
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
  const outFull = skirtDepth * 3;
  for (let k = 0; k < ring; k++, o += 3) {
    const g = ringGridIndex(res, k) * 3;
    // THE OUTWARD PUSH STOPS AT THE WATERLINE. It is there to turn the drop into an ~18
    // degree ramp so it shades like the hillside it continues instead of flat-shading dark,
    // and inland it is invisible because the neighbouring tile lies on top of it. At the
    // coast there IS no neighbouring tile — the skirt is pushed 15 to 48 m out over open
    // sea, where nothing covers it, and it reads as a flat low-poly apron of sand lying in
    // the water. That is the shape you can fly under.
    //
    // The DROP is kept, because the drop is what actually hides the crack; only the sideways
    // component goes. Straight down from a beach edge puts it well under the surface where
    // its shading no longer matters, which is exactly the case the ramp was compensating for.
    const eh = posOut[g + 1];
    const ramp = eh <= 0 ? 0 : eh >= 9 ? 1 : (eh / 9) * (eh / 9) * (3 - 2 * (eh / 9));
    const out = outFull * ramp;
    let ox = 0, oz = 0;
    if (k < res) oz = -out;         // z-min edge faces -z
    else if (k < 2 * res) ox = out; // x-max edge faces +x
    else if (k < 3 * res) oz = out; // z-max edge faces +z
    else ox = -out;                 // x-min edge faces -x
    const sx = posOut[g] + ox, sz = posOut[g + 2] + oz;
    // ...AND IT MAY NEVER FLOAT. Fading the push was not enough on its own — measured over
    // every coast-straddling tile, the fade halved the skirt vertices left hanging above the
    // seabed (80 to 39 on LOD0) where the artifact needs them at zero. A pushed vertex lands
    // wherever it lands; the only way it cannot hover is to be told the ground there. Clamped
    // below it, the whole skirt is buried by construction, at every ring, on any island.
    // Costs one heightAt per perimeter vertex against (res+1)^2 for the tile itself.
    const gh = heightAt(sx, sz);
    posOut[o] = sx;
    posOut[o + 1] = Math.min(posOut[g + 1] - skirtDepth, gh - 0.5);
    posOut[o + 2] = sz;
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
