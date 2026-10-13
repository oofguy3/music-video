// Escape-time fractals for psychedelic scenes: Julia and Mandelbrot sets with smooth colouring,
// palette cycling, orbit traps and rotation, computed per pixel at low resolution and drawn upscaled.
// Pure: the same options always give the same pixels.
//
//   const c = julia(g, { key: 'bg', c: [-0.8, 0.156], zoom: 1, stops, cycle: t * 0.2 });
//   drawField(g, c);                                         // from worldkit.mjs
//
// Cost (one core): 480x270 at 64 iterations ~11 ms, 640x360 ~20 ms, 960x540 at 48 ~40 ms, plus ~11 ms
// for the upscale. Interior points (that never escape) cost the full iteration count, so keep the
// view mostly outside the set, or lower `iters`. The set's boundary is chaotic: at 480x270 it speckles
// when upscaled and shimmers in motion, so render hero shots at 960x540 (or 640x360 with a lower
// `density`), and keep 480x270 for backgrounds behind other layers.

import { paletteLUT } from './worldkit.mjs';

const bufs = new Map();
function buffer(g, key, w, h) {
  const k = `${key}|${w}x${h}`;
  let B = bufs.get(k);
  if (!B) {
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    B = { c, x, img: x.createImageData(w, h) };
    bufs.set(k, B);
  }
  return B;
}

const LOG2 = Math.log(2);

/**
 * Shared escape-time loop. mode 'julia' iterates z -> z^2 + c from the pixel; 'mandel' iterates from
 * 0 with c = the pixel. Options:
 *   center [re, im]   view centre                    zoom      magnification (1 = 3.2 units across)
 *   rot               view rotation (rad)             iters     max iterations
 *   stops             palette stops [[pos, '#hex']]   density   palette repeats per 10 iterations
 *   cycle             palette offset 0..1 (animate it) inside    colour of points that never escape
 *   trap              0..1 blends in an orbit trap (closest approach to the point trapAt): petals, eyes
 *   power             2 (classic) or 3 (a three-fold set)
 */
function render(g, mode, o) {
  const { key = mode, w = 480, h = 270, center = [0, 0], zoom = 1, rot = 0, iters = 64, stops, density = 1, cycle = 0,
    inside = '#000000', trap = 0, trapAt = [0, 0], power = 2, c = [-0.8, 0.156] } = o;
  const B = buffer(g, key, w, h);
  const d = B.img.data;
  const lut = paletteLUT(stops || [[0, '#000000'], [0.5, '#ff2bd6'], [1, '#00e5ff']]);
  const ins = [1, 3, 5].map((i) => parseInt(inside.slice(i, i + 2), 16));
  const span = 3.2 / zoom, sc = span / w;
  const cr0 = Math.cos(rot), sr0 = Math.sin(rot);
  const [cxr, cxi] = center, [kr, ki] = c, [tr, ti] = trapAt;
  const cyc = ((cycle % 1) + 1) % 1;
  for (let py = 0, o4 = 0; py < h; py++) {
    const vy = (py - h / 2) * sc;
    for (let px = 0; px < w; px++, o4 += 4) {
      const vx = (px - w / 2) * sc;
      const pr = cxr + vx * cr0 - vy * sr0, pi = cxi + vx * sr0 + vy * cr0;
      let zr, zi, ar, ai;
      if (mode === 'julia') { zr = pr; zi = pi; ar = kr; ai = ki; } else {
        zr = 0; zi = 0; ar = pr; ai = pi;
        if (power === 2) {                                 // skip the main cardioid and period-2 bulb
          const q = (pr - 0.25) * (pr - 0.25) + pi * pi;
          if (q * (q + (pr - 0.25)) <= 0.25 * pi * pi || (pr + 1) * (pr + 1) + pi * pi <= 0.0625) {
            d[o4] = ins[0]; d[o4 + 1] = ins[1]; d[o4 + 2] = ins[2]; d[o4 + 3] = 255;
            continue;
          }
        }
      }
      let n = 0, m2 = zr * zr + zi * zi, dmin = 1e9;
      while (n < iters && m2 < 256) {
        if (power === 3) {
          const r2 = zr * zr, i2 = zi * zi;
          const nr = zr * (r2 - 3 * i2) + ar;
          zi = zi * (3 * r2 - i2) + ai;
          zr = nr;
        } else {
          const nr = zr * zr - zi * zi + ar;
          zi = 2 * zr * zi + ai;
          zr = nr;
        }
        m2 = zr * zr + zi * zi;
        if (trap) { const dx = zr - tr, dy = zi - ti, dd = dx * dx + dy * dy; if (dd < dmin) dmin = dd; }
        n++;
      }
      if (n >= iters) {
        if (trap) {
          const v = Math.min(1, Math.sqrt(dmin) * 1.5);
          let i = Math.round(((v * density + cyc) % 1) * 255);
          d[o4] = lut[i * 3]; d[o4 + 1] = lut[i * 3 + 1]; d[o4 + 2] = lut[i * 3 + 2];
        } else { d[o4] = ins[0]; d[o4 + 1] = ins[1]; d[o4 + 2] = ins[2]; }
        d[o4 + 3] = 255;
        continue;
      }
      const mu = n + 1 - Math.log(Math.log(Math.sqrt(m2))) / LOG2 / (power === 3 ? Math.log2(3) : 1);
      let v = (mu / 10) * density + cyc;
      if (trap) v = v * (1 - trap) + trap * Math.min(1, Math.sqrt(dmin) * 1.5);
      v -= Math.floor(v);
      const i = Math.round(v * 255) & 255;
      d[o4] = lut[i * 3]; d[o4 + 1] = lut[i * 3 + 1]; d[o4 + 2] = lut[i * 3 + 2]; d[o4 + 3] = 255;
    }
  }
  B.x.putImageData(B.img, 0, 0);
  return B.c;
}

/** Julia set for the constant c = [re, im]; animate c along a path for morphing shapes. */
export const julia = (g, o = {}) => render(g, 'julia', o);

/** Mandelbrot set view; zoom towards a boundary point (e.g. [-0.743643887, 0.131825904]) for an endless dive. */
export const mandel = (g, o = {}) => render(g, 'mandel', o);

/** A point on a smooth closed loop through classic Julia constants (u in [0, 1) wraps): ever-changing shapes. */
export function juliaPath(u) {
  const a = 2 * Math.PI * u;
  // a cardioid-hugging loop: c = 0.7885 * e^{ia} stays near the Mandelbrot boundary, where Julia sets are richest
  return [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)];
}
