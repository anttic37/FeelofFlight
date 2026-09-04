// Far-shell COLORMAP bake. RELATIVE imports only and nothing may touch 'three' — import maps
// do not apply inside workers. Same rule the terrain and shore workers live by.
//
// WHY THIS EXISTS. The terrain is two systems drawn at once: streamed LOD tiles near the
// plane, and one coarse full-island shell under and beyond them so there is never a hole.
// Both were coloured PER VERTEX, and vertex colour interpolates linearly across a cell. The
// relief paint (drainage darkening, crest lift, snow drift) lives at ~30 m; the outer tile
// ring has 40 m cells and just carries it; the shell has 162 m cells and cannot — every
// drainage streak averages into one flat brown gradient per cell. Where the tiles end the
// colour detail fell off a cliff, 40 m to 162 m, and that cliff read as "two systems".
//
// The fix is the same one the water got for its shoreline: stop the colour being a property
// of GEOMETRY. Bake the island's full paint into a texture here and sample it per FRAGMENT on
// the shell, so it carries 30 m relief detail however few vertices it has. At 1024^2 over
// 15.6 km that is 15.2 m a texel — finer than the outer tile ring, so the seam closes.
//
// It runs in its own one-shot worker because a million terrainColor evaluations (each with a
// 4-tap relief probe and a 4-tap paint normal) is seconds of CPU; off-thread that is invisible.
// The shell keeps its synchronous startup vertex colours until this lands, then switches.
import { heightAt, setTerrainSeed } from './heightcore.js';
import { terrainColor } from './colorcore.js';
import { bakeAOGrid, sampleAOGrid, sampleAOGridB, applyAO } from './tilebake.js';

// linear 0..1 -> sRGB byte. The texture is flagged SRGBColorSpace on the main thread so
// three decodes it back to linear on sample; encoding this way spends the 8 bits
// perceptually, so dark valley floors do not band the way linear bytes would.
function toSRGB8(c) {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

const _c = [0, 0, 0];
self.onmessage = (e) => {
  if (e.data.type === 'seed') { setTerrainSeed(e.data.seed); return; }
  const { size, res } = e.data;
  const t0 = performance.now();
  const half = size * 0.5, cell = size / res;
  const out = new Uint8Array(res * res * 4);
  // ...and the HEIGHT at every texel, for free: it is already computed for the paint. The
  // ground shader marches this toward the sun to shadow hills with their own bulk
  // (see ffTerrainShadow in cloudshadow.js). Posted as float32; the main thread packs it to
  // half-float, which WebGL2 filters in core.
  const hgt = new Float32Array(res * res);
  // one island-wide AO lattice, exactly as the shell's own vertex bake uses
  bakeAOGrid(-half, -half, size, 64);
  const PS = 12; // same fixed paint-normal stencil as bakeTile / the old shell repaint
  // TEXEL ROWS RUN +Z -> -Z. PlaneGeometry's uv.v is 1 at its top edge, which rotateX(-90)
  // puts at world z = -half; DataTexture (flipY false) reads row 0 at v = 0, i.e. z = +half.
  // So row r sits at z = half - (r + 0.5) * cell, and column c at x = -half + (c + 0.5) * cell.
  // Texel CENTRES, so a linearly-filtered fetch lines up with the field instead of half a
  // texel off it.
  for (let r = 0; r < res; r++) {
    const z = half - (r + 0.5) * cell;
    let o = r * res * 4;
    for (let c = 0; c < res; c++, o += 4) {
      const x = -half + (c + 0.5) * cell;
      const h = heightAt(x, z);
      hgt[r * res + c] = h;
      const gx = (heightAt(x + PS, z) - heightAt(x - PS, z)) / (2 * PS);
      const gz = (heightAt(x, z + PS) - heightAt(x, z - PS)) / (2 * PS);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      // full paint: coarse=false, so terrainColor runs its own relief probe per texel
      terrainColor(x, z, h, ny, _c);
      if (h > 0.5) applyAO(_c, sampleAOGrid((x + half) / size, (z + half) / size, 64), 0.62,
        sampleAOGridB((x + half) / size, (z + half) / size, 64));
      out[o] = toSRGB8(_c[0]); out[o + 1] = toSRGB8(_c[1]); out[o + 2] = toSRGB8(_c[2]); out[o + 3] = 255;
    }
  }
  self.postMessage({ type: 'colormap', res, size, ms: Math.round(performance.now() - t0), data: out, heights: hgt },
    [out.buffer, hgt.buffer]);
};
