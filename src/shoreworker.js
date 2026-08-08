// Shore-depth field bake. RELATIVE imports only and nothing may touch 'three' — import maps
// do not apply inside workers. Same rule the terrain worker lives by.
//
// WHY THIS EXISTS. The water's entire shore treatment — the turquoise shallows, the foam
// band, the swash, the wave damping — was driven by a shoreDepth attribute baked per VERTEX
// on the water sheet, and that sheet is 240 segments over 16.4 km: 68 m a vertex, then blurred
// again by a five-tap at +/-38 m. The terrain draws its side of the same waterline at 5 m.
// Two fields 14x apart in resolution describing one line, so they do not agree: measured
// against the true height field along the coast, 637 of 1800 samples had the water shader and
// the terrain disagreeing about whether a point was land or sea, and at the true waterline the
// shader read a depth of 0.2 to 1.0 m rather than zero — tens of metres of horizontal offset on
// a shallow beach, varying as you walk around the island.
//
// The fix is to stop the shoreline being a property of GEOMETRY. Baked here into a field and
// sampled per FRAGMENT, the shallow tint, the foam and the swash follow the true coast at texel
// resolution however few triangles the sheet has.
//
// It runs in a worker because it cannot run anywhere else: heightAt is ~0.87 us a call, so
// 2048 squared is 3.7 seconds. Off-thread that is invisible — the sheet keeps using its vertex
// attribute until the field lands and then switches over.
import { heightAt, setTerrainSeed } from './heightcore.js';

// Depth is SQRT-ENCODED into 8 bits over 0..64 m. Linear would give 0.25 m a step, and every
// shore term that matters — the shallow ramp, the foam, the swash — lives in the first metre
// or two, which linear spends four steps on. Square-root spends its precision where the beach
// is: one step is under a millimetre at the waterline and only coarsens out in deep water,
// where nothing reads it.
const MAX_D = 64;

self.onmessage = (e) => {
  if (e.data.type === 'seed') { setTerrainSeed(e.data.seed); return; }
  const { size, res } = e.data;
  const out = new Uint8Array(res * res);
  const cell = size / res;
  const half = size * 0.5;
  for (let iz = 0; iz < res; iz++) {
    // texel CENTRES, so the field lines up with a linearly-filtered fetch rather than
    // sitting half a texel off it
    const z = -half + (iz + 0.5) * cell;
    let o = iz * res;
    for (let ix = 0; ix < res; ix++, o++) {
      const x = -half + (ix + 0.5) * cell;
      const d = -heightAt(x, z);
      out[o] = d <= 0 ? 0 : Math.round(255 * Math.sqrt(Math.min(d, MAX_D) / MAX_D));
    }
  }
  self.postMessage({ type: 'shore', res, size, data: out }, [out.buffer]);
};
