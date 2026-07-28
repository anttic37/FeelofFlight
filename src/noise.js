// Deterministic 2D value noise + fbm. Cheap, good enough for terrain and turbulence.

function hash(ix, iz) {
  let s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz; // [0,1]
}

// Fractal sum, returns roughly [-1, 1]
export function fbm(x, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (noise2(x * freq, z * freq) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// Gradient (Perlin-style) noise. value noise interpolates between per-cell
// SCALARS, which leaves visible axis-aligned structure in its contours — fine
// for mottle and for every field that already uses it, but fatal for ridges,
// because a ridge line traces the noise's zero contour and therefore inherits
// every kink and box corner in it. Gradient noise stores a random DIRECTION per
// lattice point instead, so its contours come out as smooth curves. The quintic
// fade is C2 where the classic cubic is only C1: a slope-of-slope break along a
// cell edge is invisible in a height field but shows up as a crease once you
// take a ridge along it. Deliberately separate from noise2 so that every
// existing terrain field stays bit-for-bit identical.
// Directions come from a table indexed by an INTEGER hash, not from
// sin/cos of a hashed angle. heightAt is the hottest function in the project
// and every ridge octave calls this four times, so a transcendental per lattice
// corner is the single most expensive thing in the terrain — the table costs
// 256 doubles once and turns each corner into a multiply and an add.
const GN = 256;
const GRADX = new Float64Array(GN), GRADZ = new Float64Array(GN);
for (let i = 0; i < GN; i++) {
  const a = (i + 0.5) * (6.283185307179586 / GN);
  GRADX[i] = Math.cos(a); GRADZ[i] = Math.sin(a);
}
function grad2(ix, iz, x, z) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) & (GN - 1);
  return GRADX[h] * x + GRADZ[h] * z;
}
export function pnoise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const n00 = grad2(ix, iz, fx, fz);
  const n10 = grad2(ix + 1, iz, fx - 1, fz);
  const n01 = grad2(ix, iz + 1, fx, fz - 1);
  const n11 = grad2(ix + 1, iz + 1, fx - 1, fz - 1);
  const a = n00 + (n10 - n00) * ux;
  const b = n01 + (n11 - n01) * ux;
  return (a + (b - a) * uz) * 1.4; // roughly [-1, 1]
}

// 1D noise for turbulence channels — each channel is a distinct stripe of the 2D field.
export function fbm1(t, channel) {
  return fbm(t, channel * 19.73 + 5.1, 3);
}
