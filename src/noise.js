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

// 1D noise for turbulence channels — each channel is a distinct stripe of the 2D field.
export function fbm1(t, channel) {
  return fbm(t, channel * 19.73 + 5.1, 3);
}
