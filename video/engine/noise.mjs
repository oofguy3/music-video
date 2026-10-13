// Deterministic hashing, PRNG and smooth noise. Never use Math.random in scenes: every value must be
// a pure function of (seed, inputs) so any frame renders identically in any order on any worker.

const M32 = 0xffffffff;

/** 32-bit integer hash of any number of integer-ish inputs (murmur3 finaliser style). */
export function hash32(...xs) {
  let h = 0x9e3779b9 | 0;
  for (const x of xs) {
    let k = Math.imul((x | 0) ^ ((x * 4294967296) | 0), 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform float in [0, 1) from the inputs. */
export function hash01(...xs) {
  return hash32(...xs) / 4294967296;
}

/** Uniform float in [a, b). */
export function hashRange(a, b, ...xs) {
  return a + (b - a) * hash01(...xs);
}

/** Small fast PRNG (sfc32) seeded from a hash; use for building static layouts, not per frame. */
export function rng(...seed) {
  let a = hash32(...seed, 1), b = hash32(...seed, 2), c = hash32(...seed, 3), d = hash32(...seed, 4);
  return function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 1D value noise in [-1, 1], smooth (quintic), period-free. */
export function noise1(seed, x) {
  const i = Math.floor(x), f = x - i;
  const a = hash01(seed, i) * 2 - 1, b = hash01(seed, i + 1) * 2 - 1;
  return lerp(a, b, fade(f));
}

/** 2D value noise in [-1, 1]. */
export function noise2(seed, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const v00 = hash01(seed, ix, iy), v10 = hash01(seed, ix + 1, iy);
  const v01 = hash01(seed, ix, iy + 1), v11 = hash01(seed, ix + 1, iy + 1);
  const u = fade(fx), v = fade(fy);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v) * 2 - 1;
}

/** 3D value noise in [-1, 1] (use z for time). */
export function noise3(seed, x, y, z) {
  const iz = Math.floor(z), fz = z - iz;
  return lerp(noise2(hash32(seed, iz), x, y), noise2(hash32(seed, iz + 1), x, y), fade(fz));
}

/** Fractal sum of 1D noise, roughly in [-1, 1]. */
export function fbm1(seed, x, octaves = 3) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * noise1(hash32(seed, o), x * f);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

/** Fractal sum of 2D noise, roughly in [-1, 1]. */
export function fbm2(seed, x, y, octaves = 3) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * noise2(hash32(seed, o), x * f, y * f);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

export const _internal = { M32 };
