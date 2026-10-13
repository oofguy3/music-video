// Whole-frame post-processing, run after the scenes in device pixels:
//   bloom      quarter-res blurred copy screened back (soft glow around lights)
//   frost      the "numb" look: colour drains, a cold tint, a slight blur; amount = numb x gain
//   vignette   darker corners
//   grain      fine film grain: applied in finishRGBA (midtone-weighted, keeps pure black black)
// Parameters (all optional, 0 disables): bloom, bloomRadius, frost, frostTint, vignette, grain.

import { createCanvas } from './canvas.mjs';
import { css } from './color.mjs';
import { hash32 } from './noise.mjs';

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

  apply(canvas, P, F) {
    const ctx = canvas.getContext('2d');
    const { w, h } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';

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
