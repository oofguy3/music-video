// Generators for lush procedural worlds: painterly noise fields, parallax ridges, closed-form particle
// streams, starfields, light rays and organic blobs. Everything is a pure function of its inputs (time
// comes in as an argument), so frames render identically in any order.
//
// Fields are computed per pixel at low resolution (e.g. 320x180) through a fast lattice value noise
// and a colour palette, then drawn upscaled (bilinear), which reads as soft, painted colour.

const TAU = Math.PI * 2;
const N = 256;

const lattices = new Map();
/** A 256x256 lattice of hashed values in [0, 1] for fast value noise (cached per seed). */
export function lattice(seed = 0) {
  let L = lattices.get(seed);
  if (!L) {
    L = new Float32Array(N * N);
    let h = (seed * 2654435761) >>> 0 || 1;
    for (let i = 0; i < N * N; i++) {
      h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;   // xorshift32
      L[i] = (h & 0xffffff) / 0x1000000;
    }
    lattices.set(seed, L);
  }
  return L;
}

/** Value noise in [0, 1] from a lattice, smooth (quintic), wrapping every 256 units. */
export function vnoise(L, x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const ix = fx & 255, iy = fy & 255, jx = (ix + 1) & 255, jy = (iy + 1) & 255;
  let u = x - fx, v = y - fy;
  u = u * u * u * (u * (u * 6 - 15) + 10);
  v = v * v * v * (v * (v * 6 - 15) + 10);
  const a = L[iy * N + ix], b = L[iy * N + jx], c = L[jy * N + ix], d = L[jy * N + jx];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in [0, 1]. */
export function fbm(L, x, y, octaves = 4, gain = 0.5, lac = 2.03) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * vnoise(L, x * f + o * 17.3, y * f + o * 31.7);
    norm += amp; amp *= gain; f *= lac;
  }
  return s / norm;
}

const lutCache = new Map();
/** A 256-entry RGB lookup table from colour stops [[pos 0..1, '#hex'], ...] (cached). */
export function paletteLUT(stops) {
  const key = stops.map((s) => s.join(':')).join(',');
  let lut = lutCache.get(key);
  if (!lut) {
    lut = new Uint8Array(256 * 3);
    const cols = stops.map(([p, hex]) => [p, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]);
    for (let i = 0; i < 256; i++) {
      const p = i / 255;
      let k = 0;
      while (k < cols.length - 2 && cols[k + 1][0] < p) k++;
      const [p0, c0] = cols[k], [p1, c1] = cols[Math.min(k + 1, cols.length - 1)];
      const f = p1 > p0 ? Math.max(0, Math.min(1, (p - p0) / (p1 - p0))) : 0;
      for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * f);
    }
    if (lutCache.size > 64) lutCache.delete(lutCache.keys().next().value);
    lutCache.set(key, lut);
  }
  return lut;
}

const fieldBufs = new Map();
/**
 * A domain-warped noise field mapped through a palette, at w x h pixels. Returns the canvas; draw
 * it with drawField. Options:
 *   stops     colour stops [[pos, '#hex'], ...]          t        time (s)
 *   scale     feature size: noise units across the width   speed    [vx, vy] drift (units/s)
 *   warp      domain-warp strength (0 = plain fbm)         flow     warp evolution speed
 *   octaves   detail                                       contrast, offset: value -> (v-0.5)*contrast+0.5+offset
 *   bands     posterise into N flat bands (0 = smooth)     ridged   fold the value (veins, lightning)
 *   cycle     slide the palette by this much (0..1, wraps) for colour cycling
 *   key       which reusable buffer to draw into (use different keys for fields drawn in one frame)
 */
export function field(g, { key = 'f', seed = 1, t = 0, w = 320, h = 180, stops, scale = 3, speed = [0.04, 0.015], warp = 1.2, flow = 0.05,
  octaves = 4, contrast = 1, offset = 0, bands = 0, ridged = false, cycle = 0 } = {}) {
  const bk = `${key}|${w}x${h}`;
  const WS = 4;                                           // warp grid step (px): the warp is smooth
  const gw = Math.ceil(w / WS) + 2, gh = Math.ceil(h / WS) + 2;
  let B = fieldBufs.get(bk);
  if (!B) {
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    B = { c, x, img: x.createImageData(w, h), wx: new Float32Array(gw * gh), wy: new Float32Array(gw * gh) };
    fieldBufs.set(bk, B);
  }
  const L = lattice(seed), L2 = lattice(seed + 101);
  const lut = paletteLUT(stops || [[0, '#000000'], [1, '#ffffff']]);
  const d = B.img.data;
  const sx = scale / w, ox = t * speed[0], oy = t * speed[1], ft = t * flow;
  const cyc = Math.round((((cycle % 1) + 1) % 1) * 255);
  const { wx, wy } = B;
  if (warp > 0) {
    for (let gy = 0; gy < gh; gy++) {
      const ny = gy * WS * sx + oy;
      for (let gx = 0; gx < gw; gx++) {
        const nx = gx * WS * sx + ox;
        wx[gy * gw + gx] = warp * 4 * (fbm(L2, nx + ft, ny - ft, 2) - 0.5);
        wy[gy * gw + gx] = warp * 4 * (fbm(L2, nx - ft + 5.2, ny + ft + 1.3, 2) - 0.5);
      }
    }
  }
  for (let y = 0, o = 0; y < h; y++) {
    const ny = y * sx + oy;
    const gyf = y / WS, gy0 = Math.floor(gyf), fy = gyf - gy0, r0 = gy0 * gw, r1 = r0 + gw;
    for (let x = 0; x < w; x++, o += 4) {
      const nx = x * sx + ox;
      let v;
      if (warp > 0) {
        const gxf = x / WS, gx0 = Math.floor(gxf), fx = gxf - gx0;
        const a = r0 + gx0, b = r1 + gx0;
        const qx = (wx[a] * (1 - fx) + wx[a + 1] * fx) * (1 - fy) + (wx[b] * (1 - fx) + wx[b + 1] * fx) * fy;
        const qy = (wy[a] * (1 - fx) + wy[a + 1] * fx) * (1 - fy) + (wy[b] * (1 - fx) + wy[b + 1] * fx) * fy;
        v = fbm(L, nx + qx, ny + qy, octaves);
      } else v = fbm(L, nx, ny, octaves);
      if (ridged) v = 1 - Math.abs(2 * v - 1);
      v = (v - 0.5) * contrast + 0.5 + offset;
      if (bands > 0) v = (Math.floor(Math.max(0, Math.min(0.9999, v)) * bands) + 0.5) / bands;
      let i = Math.max(0, Math.min(255, Math.round(v * 255)));
      if (cyc) i = (i + cyc) & 255;
      d[o] = lut[i * 3]; d[o + 1] = lut[i * 3 + 1]; d[o + 2] = lut[i * 3 + 2]; d[o + 3] = 255;
    }
  }
  B.x.putImageData(B.img, 0, 0);
  return B.c;
}

/** Draw a field canvas over the whole logical frame (or a rect), smoothed. */
export function drawField(g, c, { alpha = 1, comp = 'source-over', x = 0, y = 0, w = g.W, h = g.H, quality = 'medium' } = {}) {
  const ctx = g.ctx;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = comp;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality;   // 'medium' is as smooth as 'high' when upscaling, at half the cost (~11 ms)
  ctx.drawImage(c, x, y, w, h);
  ctx.restore();
}

/**
 * A mountain or dune silhouette: a filled band from baseline y up to a noisy ridge, scrolled by
 * t * speed (px/s) for parallax. Returns nothing; fills with `fill` (colour, gradient or pattern).
 */
export function ridge(ctx, { seed = 1, y = 700, amp = 160, freq = 2.5, octaves = 4, t = 0, speed = 20, fill = '#000', step = 12, w = 1920, bottom = 1080, sharp = 0 }) {
  const L = lattice(seed);
  const off = t * speed;
  ctx.beginPath();
  ctx.moveTo(-2, bottom);
  for (let x = -step; x <= w + step; x += step) {
    let v = fbm(L, ((x + off) / w) * freq, 0.37, octaves);
    if (sharp) v = v * (1 - sharp) + sharp * (1 - Math.abs(2 * v - 1));
    ctx.lineTo(x, y - amp * v);
  }
  ctx.lineTo(w + 2, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const hashU = (s, i, k) => {
  let h = (Math.imul(s | 0, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca77) ^ Math.imul(k | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
export { hashU };

/**
 * Closed-form particle stream: particle k is born at k / rate (or at births[k]) and lives `life`
 * seconds. Position = origin + v*age + 0.5*grav*age^2 (+ swirl). Returns the live particles at t as
 * {x, y, age, u (0..1 of life), k, r (a stable random in [0,1)), r2}. origin and vel are functions
 * (k, r, r2) => [x, y]. drag (1/s) eases velocity. swirl adds a sinusoidal wander of that amplitude.
 */
export function particles({ seed = 1, t, rate = 30, births = null, life = 2, origin, vel, grav = [0, 0], drag = 0, swirl = 0, swirlHz = 0.7, max = 4000 }) {
  const out = [];
  let k0, k1;
  if (births) {
    // births sorted ascending: binary-search the window [t - life, t]
    let lo = 0, hi = births.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (births[m] < t - life) lo = m + 1; else hi = m; }
    k0 = lo;
    lo = k0; hi = births.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (births[m] <= t) lo = m + 1; else hi = m; }
    k1 = lo - 1;
  } else {
    k0 = Math.max(0, Math.ceil((t - life) * rate));
    k1 = Math.floor(t * rate);
  }
  if (k1 - k0 + 1 > max) k0 = k1 - max + 1;
  for (let k = k0; k <= k1; k++) {
    const tb = births ? births[k] : k / rate;
    const age = t - tb;
    if (age < 0 || age > life) continue;
    const r = hashU(seed, k, 1), r2 = hashU(seed, k, 2);
    const [x0, y0] = origin(k, r, r2);
    const [vx, vy] = vel(k, r, r2);
    const dv = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age;
    let x = x0 + vx * dv + 0.5 * grav[0] * age * age;
    let y = y0 + vy * dv + 0.5 * grav[1] * age * age;
    if (swirl) {
      x += swirl * Math.sin(TAU * swirlHz * age + r * TAU);
      y += swirl * Math.cos(TAU * swirlHz * 0.8 * age + r2 * TAU);
    }
    out.push({ x, y, age, u: age / life, k, r, r2 });
  }
  return out;
}

/**
 * Hyperspace or snow starfield: n points in a 3D box flying towards the camera at `speed` (depth
 * units/s). Returns screen points {x, y, z (0..1, 0 = near), px (previous screen x for streaks), py}.
 */
export function starfield({ seed = 3, n = 600, t, speed = 0.4, cx = 960, cy = 540, spread = 1400, focal = 1, streak = 0.04 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (hashU(seed, i, 1) * 2 - 1) * spread, y = (hashU(seed, i, 2) * 2 - 1) * spread * 0.6;
    const z0 = hashU(seed, i, 3);
    const z = 1 - ((((z0 - t * speed) % 1) + 1) % 1);       // 1 far .. 0 near, wraps
    const zz = 0.04 + z * 0.96;
    const zp = Math.min(1, zz + streak * speed);
    out.push({ x: cx + (x * focal) / zz, y: cy + (y * focal) / zz, z, px: cx + (x * focal) / zp, py: cy + (y * focal) / zp, i });
  }
  return out;
}

/** Light rays from (cx, cy): n wedges of a soft linear falloff, rotated by rot (radians). */
export function rays(ctx, { cx = 960, cy = 540, n = 12, rot = 0, spread = 0.12, length = 1600, color = 'rgba(255,255,255,0.25)', fade = 'rgba(255,255,255,0)' }) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, length);
  g.addColorStop(0, color);
  g.addColorStop(1, fade);
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - spread / 2) * length, cy + Math.sin(a - spread / 2) * length);
    ctx.lineTo(cx + Math.cos(a + spread / 2) * length, cy + Math.sin(a + spread / 2) * length);
    ctx.closePath();
  }
  ctx.fill();
}

/** An organic closed blob: radius r wobbling by amp with `lobes` noise lobes, animated by t. */
export function blobPath(ctx, cx, cy, r, { seed = 1, t = 0, amp = 0.18, lobes = 3, steps = 48 } = {}) {
  const L = lattice(seed);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const n = fbm(L, Math.cos(a) * lobes * 0.5 + 10 + t * 0.3, Math.sin(a) * lobes * 0.5 + t * 0.2, 2);
    const rr = r * (1 + amp * (2 * n - 1));
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Wavy horizontal bands (sea, aurora, sound waves): `lines` polylines y = y0 + i*gap + amp*noise. */
export function waves(ctx, { seed = 5, t = 0, y0 = 600, lines = 10, gap = 24, amp = 30, freq = 3, speed = 0.3, step = 16, w = 1920, stroke = '#fff', width = 2, alpha = 1 }) {
  const L = lattice(seed);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  for (let i = 0; i < lines; i++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const v = fbm(L, (x / w) * freq + t * speed, i * 0.37 + t * speed * 0.3, 3);
      const y = y0 + i * gap + amp * (2 * v - 1);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
