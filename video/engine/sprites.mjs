// Pre-rendered light sprites, cached per renderer (one per worker thread). Draw them with
// ctx.drawImage(sprite, x - r, y - r, 2r, 2r) in logical coordinates; additive looks come from
// ctx.globalCompositeOperation = 'lighter' or 'screen'.

import { createCanvas } from './canvas.mjs';
import { hexToRgb } from './color.mjs';

const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

export class Sprites {
  constructor() {
    this.cache = new Map();
  }

  _get(key, size, paint) {
    let c = this.cache.get(key);
    if (!c) {
      c = createCanvas(size, size);
      paint(c.getContext('2d'), size);
      this.cache.set(key, c);
    }
    return c;
  }

  /** Soft round glow (near-gaussian falloff), white core optional. 256 px source, scale freely. */
  glow(hex = '#ffffff', core = 0) {
    return this._get(`glow|${hex}|${core}`, 256, (ctx, s) => {
      const r = s / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, core ? 'rgba(255,255,255,1)' : rgba(hex, 1));
      g.addColorStop(core ? 0.06 : 0.0001, rgba(hex, 1));
      g.addColorStop(0.18, rgba(hex, 0.72));
      g.addColorStop(0.38, rgba(hex, 0.3));
      g.addColorStop(0.62, rgba(hex, 0.08));
      g.addColorStop(1, rgba(hex, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }

  /** Bokeh disc: flat body, soft edge, slightly brighter rim (out-of-focus light). */
  bokeh(hex = '#ffffff', edge = 0.12, rim = 0.25) {
    return this._get(`bokeh|${hex}|${edge}|${rim}`, 256, (ctx, s) => {
      const r = s / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, rgba(hex, 0.55));
      g.addColorStop(Math.max(0.01, 1 - edge - 0.08), rgba(hex, 0.6));
      g.addColorStop(Math.max(0.02, 1 - edge), rgba(hex, 0.6 + rim * 0.4));
      g.addColorStop(1, rgba(hex, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }

  /** Horizontal streak (motion-blurred light), 512x64; stretch/rotate as needed. */
  streak(hex = '#ffffff') {
    return this._get(`streak|${hex}`, 512, (ctx, s) => {
      const h = 64;
      ctx.canvas.height = h;
      const gx = ctx.createLinearGradient(0, 0, s, 0);
      gx.addColorStop(0, rgba(hex, 0));
      gx.addColorStop(0.75, rgba(hex, 0.7));
      gx.addColorStop(0.97, rgba(hex, 1));
      gx.addColorStop(1, rgba(hex, 0));
      ctx.fillStyle = gx;
      ctx.fillRect(0, 0, s, h);
      ctx.globalCompositeOperation = 'destination-in';
      const gy = ctx.createLinearGradient(0, 0, 0, h);
      gy.addColorStop(0, 'rgba(0,0,0,0)');
      gy.addColorStop(0.5, 'rgba(0,0,0,1)');
      gy.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gy;
      ctx.fillRect(0, 0, s, h);
    });
  }

  /** Draw a sprite centred at (x, y) with radius r (logical px). */
  static draw(ctx, sprite, x, y, r, alpha = 1) {
    if (r <= 0 || alpha <= 0) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, alpha);
    ctx.drawImage(sprite, x - r, y - r, 2 * r, 2 * r);
    ctx.globalAlpha = prev;
  }
}
