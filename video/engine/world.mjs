// The shared world: a dark plain under a horizon, a simple pinhole camera, a dithered sky, and
// the one crowd layout every scene agrees on (so memory lights can fly into crowd slots).
// Logical frame is 1920x1080; ground is Y = 0, +Y up, the camera looks along +Z.

import { createCanvas } from './canvas.mjs';
import { hexToRgb } from './color.mjs';
import { hash01, rng } from './noise.mjs';

export const W = 1920;
export const H = 1080;

/** Camera: horizon as a fraction of frame height, eye height (m), focal length (logical px). */
export function camera({ horizon = 0.58, height = 1.6, focal = 1150, x = 0, z = 0, near = 0.4 } = {}) {
  return { horizon, height, focal, x, z, near, hy: horizon * H };
}

/** Project a world point to the screen: {x, y, s (px per metre), d (depth)} or null if behind. */
export function project(cam, X, Y, Z) {
  const d = Z - cam.z;
  if (d <= cam.near) return null;
  const s = cam.focal / d;
  return { x: W / 2 + (X - cam.x) * s, y: cam.hy + (cam.height - Y) * s, s, d };
}

/** Ground depth (Z) seen at screen row y (below the horizon); Infinity at or above it. */
export function groundZ(cam, y) {
  return y <= cam.hy ? Infinity : cam.z + (cam.focal * cam.height) / (y - cam.hy);
}

const skyCache = new Map();
const NOISE = (() => {   // triangular noise in [-1, 1], 64k entries
  const t = new Float32Array(1 << 16);
  for (let i = 0; i < t.length; i++) t[i] = hash01(i, 7) + hash01(i, 11) - 1;
  return t;
})();

/**
 * Draw a vertical gradient over the whole frame with dither baked in (no 8-bit banding in dark
 * gradients). stops: [[pos 0..1, '#hex'], ...]. Cached by stops and device size.
 */
export function sky(g, stops, { dither = 1.2 } = {}) {
  const dw = g.devW, dh = g.devH;
  const key = `${dw}x${dh}|${dither}|${stops.map((s) => s.join(':')).join(',')}`;
  let c = skyCache.get(key);
  if (!c) {
    c = createCanvas(dw, dh);
    const cx = c.getContext('2d');
    const img = cx.createImageData(dw, dh);
    const d = img.data;
    const cols = stops.map(([p, hex]) => [p, hexToRgb(hex)]);
    const row = new Float32Array(3);
    for (let y = 0; y < dh; y++) {
      const p = y / Math.max(1, dh - 1);
      let k = 0;
      while (k < cols.length - 2 && cols[k + 1][0] < p) k++;
      const [p0, c0] = cols[k], [p1, c1] = cols[Math.min(k + 1, cols.length - 1)];
      const f = p1 > p0 ? Math.max(0, Math.min(1, (p - p0) / (p1 - p0))) : 0;
      for (let ch = 0; ch < 3; ch++) row[ch] = c0[ch] + (c1[ch] - c0[ch]) * f;
      let o = y * dw * 4;
      const base = (y * 104729) & 0xffff;
      for (let x = 0; x < dw; x++, o += 4) {
        const n = NOISE[(base + x * 7919) & 0xffff] * dither;   // triangular, +-dither levels
        d[o] = row[0] + n; d[o + 1] = row[1] + n; d[o + 2] = row[2] + n; d[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    if (skyCache.size > 24) skyCache.delete(skyCache.keys().next().value);
    skyCache.set(key, c);
  }
  const ctx = g.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}

const crowdCache = new Map();

/**
 * The crowd everyone shares: `count` figures in rows on the ground, front (zNear) to back (zFar),
 * spread so each row fills the view. Deterministic for (count, seed, opts). Sorted back to front.
 * Each figure: {i, row, X, Z, h (height m), phase (0..1), lean (-1..1), slot (stable id)}.
 */
export function crowdLayout(count = 560, seed = 1, { rows = 14, zNear = 6, zFar = 40, cam = camera() } = {}) {
  const key = `${count}|${seed}|${rows}|${zNear}|${zFar}|${cam.focal}|${cam.horizon}`;
  let out = crowdCache.get(key);
  if (out) return out;
  const r = rng('crowd', seed);
  out = [];
  // more figures in far rows (they are smaller), proportional to row depth
  const zs = Array.from({ length: rows }, (_, k) => zNear * (zFar / zNear) ** (k / Math.max(1, rows - 1)));
  const weights = zs.map((z) => z);
  const wsum = weights.reduce((a, b) => a + b, 0);
  let id = 0;
  for (let k = 0; k < rows; k++) {
    const n = Math.max(3, Math.round((count * weights[k]) / wsum));
    const halfWidth = ((W / 2) / cam.focal) * zs[k] * 1.12;   // a little wider than the view
    for (let j = 0; j < n; j++) {
      const u = (j + 0.5 + (r() - 0.5) * 0.7) / n;
      out.push({
        i: id, slot: id, row: k,
        X: cam.x + (u * 2 - 1) * halfWidth,
        Z: zs[k] + (r() - 0.5) * (zs[Math.min(rows - 1, k + 1)] - zs[k]) * 0.6,
        h: 1.55 + r() * 0.35,
        phase: r(),
        lean: r() * 2 - 1,
      });
      id++;
    }
  }
  out.sort((a, b) => b.Z - a.Z);
  crowdCache.set(key, out);
  return out;
}
