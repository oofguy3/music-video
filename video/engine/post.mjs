// Whole-frame post-processing, run after the scenes in device pixels:
//   zoom       punch-in about the centre (fraction, 0.04 = 4 %)
//   shake      camera jitter in logical px (overscanned, so no edges show)
//   glitch     0..1 horizontal slice displacement, shapes held for 2 frames
//   rgbSplit   chromatic split in logical px: red one way, blue the other (rgbSplitAngle, degrees)
//   invert     strobe: the frame flips to its negative while the amount is >= 0.5
//   flash      0..1 a colour (flashColor) screened over the frame
//   frost      the "numb" look: colour drains, a cold tint, a slight blur; amount = numb x gain
//   bloom      quarter-res blurred copy screened back (soft glow around lights)
//   vignette   darker corners
//   grain      fine film grain: applied in finishRGBA (midtone-weighted, keeps pure black black)
// Parameters (all optional, 0 disables): the above plus bloomRadius and frostTint. Each of zoom,
// shake, glitch, rgbSplit, invert and flash may name a feature column in <name>By (for example
// "zoomBy": "kick") that multiplies it frame by frame.

import { createCanvas } from './canvas.mjs';
import { css } from './color.mjs';
import { hash01, hash32 } from './noise.mjs';

const VJ = ['zoom', 'shake', 'glitch', 'rgbSplit', 'invert', 'flash'];

/** A VJ effect's amount at this frame: the parameter times its driving column, if any. */
export function vjAmount(P, k, F) {
  const v = P[k];
  if (typeof v !== 'number' || !v) return 0;
  const by = P[`${k}By`];
  if (!by) return v;
  const c = F && F.c ? F.c[by] : undefined;
  return typeof c === 'number' ? v * c : 0;
}
export const VJ_EFFECTS = VJ;

export class Post {
  constructor(devW, devH) {
    this.w = devW;
    this.h = devH;
    this.q = createCanvas(Math.max(1, Math.round(devW / 4)), Math.max(1, Math.round(devH / 4)));
    this.half = createCanvas(Math.max(1, Math.round(devW / 2)), Math.max(1, Math.round(devH / 2)));
    const gs = 256;
    this.grainTex = createCanvas(gs, gs);
    const gctx = this.grainTex.getContext('2d');
    const img = gctx.createImageData(gs, gs);
    for (let i = 0; i < gs * gs; i++) {
      const v = 128 + (((hash32(i, 3) & 255) + (hash32(i, 5) & 255)) / 2 - 127.5) * 0.35;
      img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
      img.data[4 * i + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
    this.vignetteCache = null;
  }

  /** A full-size scratch canvas holding a copy of `src` (or empty when src is null). */
  _copy(i, src) {
    this.scratch ||= [];
    let c = this.scratch[i];
    if (!c) c = this.scratch[i] = createCanvas(this.w, this.h);
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.filter = 'none';
    x.globalCompositeOperation = 'copy';
    if (src) x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-over';
    return c;
  }

  _vj(canvas, ctx, P, F) {
    const { w, h } = this;
    const frame = F && Number.isFinite(F.frame) ? F.frame : 0;
    const k = w / 1920;
    const zoom = Math.max(0, vjAmount(P, 'zoom', F));
    const shake = Math.abs(vjAmount(P, 'shake', F)) * k;
    if (zoom > 1e-4 || shake > 0.05) {
      const dx = shake * (hash01(frame, 11) * 2 - 1), dy = shake * (hash01(frame, 12) * 2 - 1);
      const s = 1 + zoom + 2 * Math.max(Math.abs(dx) / w, Math.abs(dy) / h);
      const src = this._copy(0, canvas);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(src, (w - w * s) / 2 + dx, (h - h * s) / 2 + dy, w * s, h * s);
      ctx.globalCompositeOperation = 'source-over';
    }
    const gl = Math.min(1, vjAmount(P, 'glitch', F));
    if (gl > 0.01) {
      const src = this._copy(0, canvas);
      const seed = Math.floor(frame / 2);
      const n = Math.round(3 + 18 * gl);
      for (let i = 0; i < n; i++) {
        const y = Math.floor(hash01(seed, i, 1) * h);
        const sh = Math.min(h - y, Math.max(2, Math.floor((0.01 + 0.07 * hash01(seed, i, 2)) * h * (0.5 + gl))));
        const dx = Math.round((hash01(seed, i, 3) * 2 - 1) * gl * 0.12 * w);
        if (!dx || sh <= 0) continue;
        ctx.drawImage(src, 0, y, w, sh, dx, y, w, sh);
        if (dx > 0) ctx.drawImage(src, w - dx, y, dx, sh, 0, y, dx, sh);
        else ctx.drawImage(src, 0, y, -dx, sh, w + dx, y, -dx, sh);
      }
    }
    const rs = Math.abs(vjAmount(P, 'rgbSplit', F)) * k;
    if (rs > 0.3) {
      const ang = ((P.rgbSplitAngle ?? 0) * Math.PI) / 180;
      const ox = rs * Math.cos(ang), oy = rs * Math.sin(ang);
      const red = this._copy(0, canvas), blue = this._copy(1, canvas);
      for (const [c, col] of [[red, '#ff0000'], [blue, '#0000ff']]) {
        const x = c.getContext('2d');
        x.globalCompositeOperation = 'multiply';
        x.fillStyle = col;
        x.fillRect(0, 0, w, h);
        x.globalCompositeOperation = 'source-over';
      }
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(red, -ox, -oy);
      ctx.drawImage(blue, ox, oy);
      ctx.globalCompositeOperation = 'source-over';
    }
    // A partial invert is a flat grey (x(1-a) + a(1-x) = 0.5 at a = 0.5), so invert is a strobe:
    // the whole frame flips while the amount is at least 0.5.
    if (vjAmount(P, 'invert', F) >= 0.5) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    const fl = Math.min(1, vjAmount(P, 'flash', F));
    if (fl > 0.004) {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = css(P.flashColor || '#ffffff', fl);
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  apply(canvas, P, F) {
    const ctx = canvas.getContext('2d');
    const { w, h } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    this._vj(canvas, ctx, P, F);

    const frostAmt = Math.max(0, Math.min(1, (F ? F.c.numb : 0) * (P.frost ?? 0)));
    if (frostAmt > 0.002) {
      const hc = this.half.getContext('2d');
      hc.globalCompositeOperation = 'copy';
      hc.filter = `blur(${Math.max(0.5, 1.5 * (w / 1920) * 2 * frostAmt).toFixed(2)}px)`;
      hc.drawImage(canvas, 0, 0, this.half.width, this.half.height);
      hc.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.55 * frostAmt;
      ctx.drawImage(this.half, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(128,128,128,${(0.9 * frostAmt).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = css(P.frostTint || '#bfd4dc', 0.45 * frostAmt);
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }

    const bloom = P.bloom ?? 0;
    if (bloom > 0) {
      const qc = this.q.getContext('2d');
      const r = (P.bloomRadius ?? 24) * (w / 1920) / 4;
      qc.globalCompositeOperation = 'copy';
      qc.filter = `blur(${r.toFixed(2)}px)`;
      qc.drawImage(canvas, 0, 0, this.q.width, this.q.height);
      qc.filter = 'none';
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, bloom);
      ctx.drawImage(this.q, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }
}

/**
 * Final pass over the RGBA buffer, in one integer loop:
 *   vignette  per-pixel darkening towards the corners (cached factor table per size/strength)
 *   dither    +-1 level triangular noise so dark gradients survive 8-bit 4:2:0 encoding
 *   grain     film grain weighted to the midtones (0 at black and white)
 * Pure black pixels stay black. Deterministic per frame.
 */
const NOISE_N = 1 << 16;
const NOISE = (() => {
  const t = new Float32Array(NOISE_N);
  for (let i = 0; i < NOISE_N; i++) t[i] = (hash32(i, 41) & 1023) / 1023 + (hash32(i, 43) & 1023) / 1023 - 1;
  return t;
})();
const LEVELS = 64, STEP = 0.25;                       // noise amplitudes 0 .. 15.75 levels
const NT = new Int8Array(LEVELS * NOISE_N);
const ntReady = new Uint8Array(LEVELS);
function noiseLevel(level) {
  if (!ntReady[level]) {
    const amp = level * STEP, base = level * NOISE_N;
    for (let k = 0; k < NOISE_N; k++) NT[base + k] = Math.round(NOISE[k] * amp);
    ntReady[level] = 1;
  }
}
const ampCache = new Map();
function ampLevels(dither, grain) {
  const key = `${dither}|${grain.toFixed(3)}`;
  let a = ampCache.get(key);
  if (!a) {
    a = new Uint8Array(256);
    for (let y = 0; y < 256; y++) {
      const mid = (4 * y * (255 - y)) / (255 * 255);
      const lvl = Math.min(LEVELS - 1, Math.round((dither + grain * 255 * 0.35 * mid) / STEP));
      noiseLevel(lvl);
      a[y] = lvl;
    }
    ampCache.set(key, a);
  }
  return a;
}
const vigCache = new Map();
function vignetteTable(w, h, strength) {
  const q = Math.round(strength * 100) / 100;
  const key = `${w}x${h}|${q}`;
  let v = vigCache.get(key);
  if (!v) {
    v = new Uint32Array(w * h);
    const cx = w / 2, cy = h * 0.52, r0 = Math.min(w, h) * 0.35, r1 = Math.hypot(w, h) * 0.62;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const u = Math.max(0, Math.min(1, (d - r0) / (r1 - r0)));
        v[y * w + x] = Math.round((1 - q * u * u * (3 - 2 * u)) * 65536);
      }
    }
    if (vigCache.size > 4) vigCache.delete(vigCache.keys().next().value);
    vigCache.set(key, v);
  }
  return v;
}

export function finishRGBA(buf, frame, { dither = 1, grain = 0, vignette = 0, width = 0, height = 0 } = {}) {
  if (!dither && !grain && !vignette) return;
  const px = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length);
  const al = ampLevels(dither, grain);
  const vt = vignette > 0 && width * height * 4 === buf.length ? vignetteTable(width, height, vignette) : null;
  let k = hash32(frame, 17) & 0xffff;
  for (let i = 0, p = 0; i < px.length; i += 4, p++, k = (k + 7) & 0xffff) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    if ((r | g | b) === 0) continue;
    if (vt !== null) {
      const f = vt[p];
      r = (r * f) >>> 16; g = (g * f) >>> 16; b = (b * f) >>> 16;
    }
    const d = NT[(al[(r * 54 + g * 183 + b * 19) >> 8] << 16) + k];
    px[i] = r + d; px[i + 1] = g + d; px[i + 2] = b + d;
  }
}

/** Dither only (kept for tools). */
export const ditherRGBA = (buf, frame) => finishRGBA(buf, frame, { dither: 1 });
