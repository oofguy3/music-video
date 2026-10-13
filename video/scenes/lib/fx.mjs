// VJ helpers for scenes: kaleidoscopes, echoes (trails without state), recursive tunnels, mirrors,
// halftone dots, bold stripes and rings, and slam envelopes for shapes that pop on hits. All pure.

const TAU = Math.PI * 2;

/**
 * Kaleidoscope: wedges of a device-size source canvas (e.g. g.layer(...).canvas) mirrored around
 * (cx, cy). The source region around logical (sx, sy) fills each wedge; zoom > 1 magnifies it (the
 * default 1.4 keeps a full-frame source covering every wedge out to the corners).
 */
export function kaleido(g, src, { segments = 8, rot = 0, cx = 960, cy = 540, radius = 1300, sx = 960, sy = 540, zoom = 1.4, srcRot = 0 } = {}) {
  const ctx = g.ctx;
  const n = Math.max(2, Math.round(segments / 2) * 2);
  const wedge = TAU / n;
  for (let j = 0; j < n; j++) {
    ctx.save();
    ctx.translate(cx, cy);
    // a flipped wedge spans [-wedge, 0] in its own frame, so rotate it one wedge further first
    ctx.rotate(rot + (j % 2 ? j + 1 : j) * wedge);
    if (j % 2) ctx.scale(1, -1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, -0.002, wedge + 0.002);
    ctx.closePath();
    ctx.clip();
    ctx.rotate(srcRot);
    ctx.scale(zoom, zoom);
    ctx.drawImage(src, -sx, -sy, g.W, g.H);
    ctx.restore();
  }
}

/** Echo trail without state: calls fn(tk, alpha, k) for k = n..0 at tk = t - k*dt, oldest first. */
export function echo(t, n, dt, fn, { decay = 0.6 } = {}) {
  for (let k = n; k >= 0; k--) fn(t - k * dt, Math.pow(decay, k), k);
}

/**
 * Recursive tunnel: draws drawFn(k, s) `depth` times, each copy scaled by scale^k and rotated by
 * k*rot about (cx, cy), deepest first, so the frame seems to fall into itself.
 */
export function tunnel(ctx, drawFn, { depth = 6, scale = 0.7, rot = 0.1, cx = 960, cy = 540, phase = 0 } = {}) {
  for (let k = depth; k >= 0; k--) {
    const kk = k + phase;                     // phase in [0, 1) slides every copy one step deeper
    const s = Math.pow(scale, kk);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(kk * rot);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    drawFn(k, s, kk);
    ctx.restore();
  }
}

/** Mirror a device-size source canvas onto g.ctx: 'x' left half reflected right, 'y' top half reflected
 *  down, 'xy' the top-left quadrant reflected into all four. */
export function mirror(g, src, axis = 'x') {
  const ctx = g.ctx, W = g.W, H = g.H, dw = src.width, dh = src.height;
  const quads = axis === 'x' ? [[1, 1], [-1, 1]] : axis === 'y' ? [[1, 1], [1, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  const sw = axis === 'y' ? dw : dw / 2, sh = axis === 'x' ? dh : dh / 2;
  const lw = axis === 'y' ? W : W / 2, lh = axis === 'x' ? H : H / 2;
  for (const [fx, fy] of quads) {
    ctx.save();
    ctx.translate(fx < 0 ? W : 0, fy < 0 ? H : 0);
    ctx.scale(fx, fy);
    ctx.drawImage(src, 0, 0, sw, sh, 0, 0, lw, lh);
    ctx.restore();
  }
}

const dotCache = new Map();
function dotSprite(g, color) {
  const k = `${color}|${g.scale}`;
  let c = dotCache.get(k);
  if (!c) {
    const s = Math.max(4, Math.round(64 * g.scale));
    c = g.createCanvas(s, s);
    const x = c.getContext('2d');
    x.fillStyle = color;
    x.beginPath();
    x.arc(s / 2, s / 2, s / 2 - 0.5, 0, TAU);
    x.fill();
    x.getImageData(0, 0, 1, 1);
    dotCache.set(k, c);
  }
  return c;
}

/**
 * Halftone: a rotated grid of dots whose radius is amount(x, y) (0..1) x cell/2. A cached dot sprite
 * is stamped, so cell 24 (about 3600 dots) costs ~20 ms at 1080p.
 */
export function halftone(g, { cell = 24, angle = 0.4, color = '#000', amount, w = g.W, h = g.H, min = 0.04 }) {
  const ctx = g.ctx, spr = dotSprite(g, color);
  const c = Math.cos(angle), s = Math.sin(angle);
  const R = Math.hypot(w, h) / 2 + cell, cx = w / 2, cy = h / 2;
  for (let v = -R; v <= R; v += cell) {
    for (let u = -R; u <= R; u += cell) {
      const x = cx + u * c - v * s, y = cy + u * s + v * c;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const a = amount(x, y);
      if (a <= min) continue;
      const r = (Math.min(1, a) * cell) / 2 * 1.15;
      ctx.drawImage(spr, x - r, y - r, 2 * r, 2 * r);
    }
  }
}

/** Bold parallel stripes across the frame: angle (rad), width, gap, colours cycled, offset (px) scrolls. */
export function stripes(ctx, { angle = 0.5, width = 60, gap = 60, colors = ['#fff'], offset = 0, w = 1920, h = 1080 }) {
  const period = width + gap;
  const R = Math.hypot(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  const o = ((offset % period) + period) % period;
  let idx = Math.floor(offset / period);
  for (let x = -R - period + o; x < R; x += period, idx++) {
    ctx.fillStyle = colors[((idx % colors.length) + colors.length) % colors.length];
    ctx.fillRect(x, -R, width, 2 * R);
  }
  ctx.restore();
}

/** Concentric rings expanding from (cx, cy): phase in beats slides them outwards one gap per beat. */
export function rings(ctx, { cx = 960, cy = 540, n = 12, gap = 90, phase = 0, width = 10, colors = ['#fff'], alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const p = ((phase % 1) + 1) % 1;
  for (let i = n; i >= 0; i--) {
    const r = (i + p) * gap;
    if (r <= 0) continue;
    ctx.strokeStyle = colors[(i + Math.floor(phase)) % colors.length];
    ctx.lineWidth = width * (0.6 + 0.4 * (i / n));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Slam envelope for a shape that pops on an event at t0: 0 before, then a fast attack with overshoot
 * to `peak`, settling to `hold` (or decaying to 0 if hold = 0) with time constant `decay` seconds.
 */
export function slam(t, t0, { attack = 0.05, peak = 1.25, hold = 1, decay = 0.25 } = {}) {
  if (t0 === null || t0 === undefined || t < t0) return 0;
  const a = t - t0;
  if (a < attack) { const u = a / attack; return peak * (1 - (1 - u) * (1 - u)); }
  return hold + (peak - hold) * Math.exp(-(a - attack) / decay);
}

/** Pick an item that changes every `every` beats (e.g. a palette flip per bar): items[floor(mt/every)]. */
export function onGrid(mt, items, every = 4, offset = 0) {
  const i = Math.floor((mt + offset) / every);
  return items[((i % items.length) + items.length) % items.length];
}

/**
 * Melt: redraw a device-size source canvas in vertical columns, each stretched downwards by
 * amount x a smooth wave along x (drips), with the top edge anchored. amount in logical px.
 * Columns of `colW` logical px: 96 columns at 1080p cost ~3 ms.
 */
export function melt(g, src, { amount = 80, t = 0, seed = 1, colW = 20, freq = 3, speed = 0.4 } = {}) {
  const ctx = g.ctx, W = g.W, H = g.H, s = src.width / W;
  for (let x = 0; x < W; x += colW) {
    const u = x / W;
    const wave = 0.5 + 0.5 * Math.sin(TAU * (u * freq + t * speed) + seed)
      * Math.cos(TAU * (u * freq * 0.37 - t * speed * 0.6) + seed * 2.1);
    const dy = amount * wave * wave;
    ctx.drawImage(src, x * s, 0, colW * s, src.height, x, 0, colW, H + dy);
  }
}
