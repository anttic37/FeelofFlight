import * as THREE from 'three';

// Procedural ground material detail, four materials packed into one RGBA
// texture: R grass, G dry scrub, B scree, A rock.
//
// WHY PACKED. Splat texturing normally means one texture per material and a
// control map to blend them, which is four samples per pixel before any
// anti-tiling. We do not need four COLOURS — the colour already comes from the
// vertex bands in colorcore and the slope tints in groundfx. What is missing is
// TEXTURE: the per-pixel light-and-dark that makes ground read as a surface
// instead of paint. That is a scalar per material, so all four fit in the
// channels of a single texture and blend with one dot product.
//
// WHY GENERATED. This project has no asset pipeline — the island, the plane and
// the sky are all computed at startup, and a terrain that downloads texture
// files would be the only thing that doesn't. Generating them costs a few
// milliseconds once and keeps the whole game a single self-contained page.

// Tileable value noise. The lattice hash wraps at a period, so the pattern is
// seamless when the texture repeats — the ordinary hash in noise.js is not
// periodic and would put a visible join at every tile edge.
function hashP(ix, iz, P) {
  ix = ((ix % P) + P) % P;
  iz = ((iz % P) + P) % P;
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoiseP(x, z, P) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hashP(ix, iz, P), b = hashP(ix + 1, iz, P);
  const c = hashP(ix, iz + 1, P), d = hashP(ix + 1, iz + 1, P);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
// The period doubles with the frequency, which is what keeps every octave
// tileable over the same texture.
function fbmP(x, z, oct, P) {
  let sum = 0, amp = 0.5, freq = 1, per = P, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoiseP(x * freq, z * freq, per) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2; per *= 2;
  }
  return sum / norm;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// contrast about the midpoint — the materials differ as much in how HARD their
// pattern is as in its scale (turf is soft, gravel is all edges)
const contrast = (v, k) => clamp01((v - 0.5) * k + 0.5);

let _tex = null;

export function getDetailTexture(renderer) {
  if (_tex) return _tex;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i / N) * 8, v = (j / N) * 8; // 8 lattice cells across the tile
      // KEEP THE FEATURES BIG. The first version ran up to 80 lattice cells and
      // three more octaves on top; at a 14 m repeat that put the dominant detail
      // near 0.2 m, which is under a pixel from any altitude you actually fly at,
      // so it aliased down into uniform grey static. Ground cover reads at 1-4 m
      // — clumps of scrub, patches of bare soil — and that is what these are
      // sized for.
      // R — TURF. Soft, low contrast: grass is shading variation, never blades.
      const g = fbmP(u * 1.2, v * 1.2, 3, 10) * 0.75 + fbmP(u * 2.6, v * 2.6, 2, 21) * 0.25;
      // G — DRY SCRUB. Bushes with bare ground between them, so the same kind of
      // field pushed through a harder curve to open the gaps.
      const d = contrast(fbmP(u * 1.7 + 11.7, v * 1.7 + 5.2, 3, 14), 1.7);
      // B — SCREE. Loose stone: tighter and harder-edged than scrub, but still
      // stones you could see, not sand.
      const s = contrast(fbmP(u * 3.1 + 21.1, v * 3.1 + 9.4, 3, 25), 2.0);
      // A — ROCK. Bedding planes: stretched hard along one axis so it reads as
      // strata and jointing rather than as more gravel.
      const r = contrast(fbmP(u * 0.8 + 3.3, v * 5.2 + 17.6, 3, 7) * 0.7
        + fbmP(u * 2.4 + 31.9, v * 2.4 + 2.8, 2, 19) * 0.3, 1.6);
      const o = (j * N + i) * 4;
      data[o] = g * 255;
      data[o + 1] = d * 255;
      data[o + 2] = s * 255;
      data[o + 3] = r * 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  // grazing angles are the normal case here — we look ACROSS the ground far more
  // than down at it, and without anisotropy the far field turns to mush
  if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  _tex = t;
  return t;
}
