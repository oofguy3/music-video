// C1 THE GOLDEN MIRROR LAKE: the warm heart of the film (the young-love verse).
//
// A golden-hour sky with a huge low sun, painted clouds, hazy hills and a far shore is drawn into a
// layer and mirrored below the horizon into a still lake (rippled in thin slices, snares send a ripple
// down it). A dandelion meadow fills the foreground. Kit and June burst up out of the lake, wade ashore
// hand in hand and dance; at P.feelingsGone June dissolves into dandelion seeds that blow away up-right
// while Kit reaches after them. From P.settle little houses light up one per downbeat on the far shore
// with the friends sitting on benches, while Kit walks on alone and sits on a rock. Over the held ii
// the sun sinks and the sky deepens; at P.home the seeds swirl back into June's ghostly constellation
// among the clouds, and from P.crackT0 fine bright cracks spread across the sky from the sun.
//
// Pure: every moment comes from P, F.ev and F.c; caches are pure functions of their keys.

import { KIT, JUNE, FRIENDS } from './lib/cast.mjs';
import { drawPuppet, solve, cycles, poses, blend, armTo } from './lib/puppet.mjs';
import { field, drawField, particles, rays, lattice, fbm as lfbm, hashU } from './lib/worldkit.mjs';

const TAU = Math.PI * 2;

export const meta = { type: 'goldlake', budgetMs: 150 };

export const DEFAULT = {
  skyTop: '#6B3A8C', skyMid: '#FF7E6B', skyLow: '#FFB25C', sun: '#FFF0B3', sunGlow: '#FFC857',
  lake: '#5A2E6B', shore: '#3A2346', meadow: '#7A4A3A', stem: '#6B8F4E', seed: '#FFF7E0',
  firefly: '#FFE58A', houseWall: '#F7D6C1', roof: '#B04A5A', window: '#FFD27A', crack: '#FFFFFF',
};

// Times left null fall back to fractions of the entry, so the scene works for any song.
export const defaults = {
  feelingsGone: null, settle: null, heldIi: null, home: null, confess: null, crackT0: null,
  sunY: 470, sunR: 180, horizon: 560, danceDelay: 3,
  stems: 260, fireflies: 80, juneSeeds: 300, houses: 8, slices: 60, kickMin: 0.55, seedRate: 9,
};

// ---------------------------------------------------------------- small helpers
const cl = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sm = (x) => { x = cl(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, u) => a + (b - a) * u;
const outCubic = (x) => 1 - (1 - cl(x)) ** 3;
const outBack = (x) => { x = cl(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

const palCache = new WeakMap();
function palette(S, g) {
  const src = (S && S.palette) || {};
  let p = palCache.get(src);
  if (!p) {
    p = {};
    for (const k of Object.keys(DEFAULT)) p[k] = typeof src[k] === 'string' && src[k][0] === '#' ? src[k] : DEFAULT[k];
    const m = g.color.mix;
    // derived colours, computed once per palette
    p.cloudBody = m(p.skyTop, p.skyMid, 0.38);
    p.cloudLit = m(p.skyLow, p.sun, 0.45);
    p.hazeFar = m(p.skyMid, p.skyTop, 0.42);
    p.hazeNear = m(p.shore, p.skyTop, 0.45);
    p.land = m(p.shore, p.skyTop, 0.2);
    p.plum = m(p.skyTop, p.shore, 0.55);
    p.wallShade = m(p.houseWall, p.skyTop, 0.38);
    p.roofShade = m(p.roof, p.shore, 0.25);
    p.stemFront = m(p.stem, p.shore, 0.45);
    p.stemBack = m(p.stem, p.skyMid, 0.25);
    p.key = Object.keys(DEFAULT).map((k) => p[k]).join('');
    palCache.set(src, p);
  }
  return p;
}

/** Stamp an image rotated about (ax, ay) of its size at logical (x, y). Leaves a rotated transform. */
function stamp(ctx, ds, img, x, y, w, h, rot = 0, ax = 0.5, ay = 0.5) {
  const c = Math.cos(rot) * ds, s = Math.sin(rot) * ds;
  ctx.setTransform(c, s, -s, c, x * ds, y * ds);
  ctx.drawImage(img, -w * ax, -h * ay, w, h);
}

// ---------------------------------------------------------------- timing
function timing(F, P, S) {
  const t0 = S.t0, t1 = S.t1, D = Math.max(1e-3, t1 - t0);
  const at = (v, f) => (typeof v === 'number' && Number.isFinite(v) ? v : t0 + f * D);
  const T = {
    t0, t1, D,
    gone: at(P.feelingsGone, 0.25), settle: at(P.settle, 0.36), held: at(P.heldIi, 0.737),
    home: at(P.home, 0.895), confess: at(P.confess, 0.917), crack: at(P.crackT0, 0.947),
  };
  const db = (F.ev && F.ev.downbeats) || [];
  const beat = F.beatS || 0.5;
  const eps = 0.5 / (F.fps || 30);
  const dStart = t0 + (P.danceDelay ?? 3);
  T.dance = Math.min(T.gone - 0.5, db.find((d) => d >= dStart - eps) ?? dStart);
  T.wade = t0 + 0.8;
  T.shore = Math.min(t0 + 2.0, T.dance - 0.2);
  const n = Math.max(1, P.houses | 0);
  T.houses = [];
  for (const d of db) if (d >= T.settle - eps && T.houses.length < n) T.houses.push(d);
  while (T.houses.length < n) T.houses.push(T.settle + T.houses.length * F.bpb * beat);
  T.scatter = T.confess + 1.6;
  return T;
}

// ---------------------------------------------------------------- geometry
const GY = 948;          // the characters' ground on the near bank
const SC = 1.25;         // character scale on the bank
const SCW = 0.9;         // ... where they burst out of the lake
const YW0 = 735;         // water line where they burst out
const XE = 770;          // Kit's x at the burst (June walks beside him)
const GAP_WALK = 106, GAP_DANCE = 168;
const bankY = (x) => 880 + 13 * Math.sin(x * 0.0042 + 0.6) + 7 * Math.sin(x * 0.013 + 2.0);

/** The far shore's land top at x (the hills come down to the water at the sides, open water mid). */
function farLand(x, HZ) {
  const L = lattice(41);
  const d = Math.abs(x - 960);
  const env = sm((d - 170) / 520);
  return HZ - 2 - env * (10 + 34 * lfbm(L, x / 260, 0.3, 3));
}

const HOUSE_SITES = [
  { x: 130, s: 0.62 }, { x: 360, s: 1.0 }, { x: 590, s: 0.92 }, { x: 735, s: 0.55 },
  { x: 1215, s: 0.55 }, { x: 1400, s: 0.68 }, { x: 1595, s: 0.6 }, { x: 1790, s: 0.74 },
];

// ---------------------------------------------------------------- sprites
function seedSprite(g, col) {
  return cached(`seed|${col}`, () => {
    const c = g.createCanvas(48, 60), x = c.getContext('2d');
    x.scale(0.5, 0.5);
    const cx = 48, cy = 46, css = g.color.css;
    const gr = x.createRadialGradient(cx, cy - 12, 0, cx, cy - 12, 46);
    gr.addColorStop(0, css(col, 0.32)); gr.addColorStop(1, css(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 96, 120);
    x.lineCap = 'round';
    x.strokeStyle = css(col, 0.8); x.lineWidth = 1.7;
    x.beginPath();
    const tips = [];
    for (let i = 0; i < 15; i++) {
      const a = -Math.PI + ((i + 0.5) / 15) * Math.PI;
      const r = 36 + 5 * Math.sin(i * 2.3);
      const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r * 0.85;
      x.moveTo(cx, cy); x.quadraticCurveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.3, tx, ty);
      tips.push([tx, ty]);
    }
    x.stroke();
    x.fillStyle = css(col, 0.95);
    for (const [tx, ty] of tips) { x.beginPath(); x.arc(tx, ty, 2.6, 0, TAU); x.fill(); }
    x.strokeStyle = css(col, 0.9); x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy + 50); x.stroke();
    x.fillStyle = '#B58E5E';
    x.beginPath(); x.ellipse(cx, cy + 61, 4.5, 11, 0, 0, TAU); x.fill();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

const FULL = [1, 0.62, 0.32, 0.08];
function puffSprite(g, col, lit, k, px = 112) {
  return cached(`puff|${col}|${lit}|${k}|${px}`, () => {
    const S = 192, c = g.createCanvas(px, px), x = c.getContext('2d');
    x.scale(px / S, px / S);
    const cx = S / 2, cy = S / 2, css = g.color.css;
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    gr.addColorStop(0, css(col, 0.3 * (0.4 + 0.6 * FULL[k]))); gr.addColorStop(0.45, css(col, 0.08 * FULL[k])); gr.addColorStop(0.7, css(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
    x.lineCap = 'round';
    const tips = [];
    x.strokeStyle = css(col, 0.42); x.lineWidth = 1.3;
    x.beginPath();
    for (let i = 0; i < 120; i++) {
      if (hashU(77, i, 9) > FULL[k]) continue;
      const a = hashU(77, i, 1) * TAU, z = hashU(77, i, 2);
      const r = 74 * Math.sqrt(1 - z * z * 0.85);
      const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r;
      x.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8); x.lineTo(tx, ty);
      tips.push([tx, ty, z]);
    }
    x.stroke();
    for (const [tx, ty, z] of tips) {
      x.fillStyle = css(col, 0.55 + 0.4 * z);
      x.beginPath(); x.arc(tx, ty, 3.4, 0, TAU); x.fill();
    }
    // a warm backlit rim on the side facing the low sun (up)
    const rg = x.createLinearGradient(0, 0, 0, S);
    rg.addColorStop(0, css(lit, 0.55 * FULL[k])); rg.addColorStop(0.5, css(lit, 0));
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = rg; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = '#E8D7B4';
    x.beginPath(); x.arc(cx, cy, 9, 0, TAU); x.fill();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** A painted cloud bank: soft puffs with a flat base, plum tops and a gold-lit underside. Logical 760 x 220. */
function cloudSprite(g, pal, i) {
  const ds = g.scale;
  return cached(`cloud|${pal.key}|${i}|${ds}`, () => {
    const Wl = 760, Hl = 220;
    const c = g.createCanvas(Math.ceil(Wl * ds), Math.ceil(Hl * ds)), x = c.getContext('2d');
    x.scale(ds, ds);
    const css = g.color.css, mix = g.color.mix;
    const thin = i >= 4;
    const baseY = thin ? 150 : 168;
    x.save();
    x.beginPath(); x.rect(0, 0, Wl, baseY + (thin ? 12 : 4)); x.clip();
    x.filter = `blur(${(thin ? 4 : 2.2) * ds}px)`;
    const n = thin ? 18 : 34;
    for (let k = 0; k < n; k++) {
      const u = hashU(i, k, 7);
      const px = 70 + u * 620;
      const bump = Math.sin(Math.PI * u) ** 0.8;
      const r = thin ? 10 + 12 * hashU(i, k, 2) : (16 + 54 * bump * (0.45 + 0.55 * hashU(i, k, 2)));
      const py = baseY - r * (thin ? 0.4 : 0.55) - (thin ? 10 * hashU(i, k, 4) : 26 * bump * hashU(i, k, 4));
      const rx = thin ? r * (4 + 3 * hashU(i, k, 3)) : r * (1.05 + 0.35 * hashU(i, k, 3));
      // each puff: lit from below, shaded on top
      const gr = x.createLinearGradient(0, py - r, 0, py + r);
      gr.addColorStop(0, css(mix(pal.skyTop, pal.cloudBody, 0.55), 0.95));
      gr.addColorStop(0.55, css(pal.cloudBody, 0.95));
      gr.addColorStop(1, css(mix(pal.cloudBody, pal.cloudLit, 0.7), 0.95));
      x.fillStyle = gr;
      x.beginPath(); x.ellipse(px, py, rx, r, 0, 0, TAU); x.fill();
    }
    x.restore();
    // bright gold rim along the base
    x.globalCompositeOperation = 'source-atop';
    const lg = x.createLinearGradient(0, baseY - 30, 0, baseY + 6);
    lg.addColorStop(0, css(pal.cloudLit, 0));
    lg.addColorStop(0.65, css(pal.cloudLit, thin ? 0.32 : 0.45));
    lg.addColorStop(1, css(mix(pal.cloudLit, pal.sun, 0.5), thin ? 0.55 : 0.75));
    x.fillStyle = lg; x.fillRect(0, baseY - 30, Wl, 44);
    x.globalCompositeOperation = 'source-over';
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// ---------------------------------------------------------------- static layers
/** Far hills, far shore and tree line (everything static above the horizon). Device size. */
function hillsLayer(g, pal, HZ, dusk = false) {
  const ds = g.scale;
  return cached(`hills|${pal.key}|${HZ}|${g.devW}|${dusk}`, () => {
    const c = g.createCanvas(g.devW, g.devH), x = c.getContext('2d');
    x.scale(ds, ds);
    const css = g.color.css, mix = g.color.mix;
    const Lf = lattice(23), Ln = lattice(29);
    const ridgeAt = (L, xx, amp, freq, envW) => {
      const env = sm((Math.abs(xx - 960) - envW) / 640);
      return amp * (0.12 + 0.88 * env) * lfbm(L, (xx / 1920) * freq, 0.4, 4);
    };
    // far range: pale, hazy
    x.beginPath(); x.moveTo(0, HZ + 4);
    for (let xx = 0; xx <= 1920; xx += 8) x.lineTo(xx, HZ - 18 - ridgeAt(Lf, xx, 170, 3.2, 120));
    x.lineTo(1920, HZ + 4); x.closePath();
    let gr = x.createLinearGradient(0, HZ - 200, 0, HZ);
    gr.addColorStop(0, css(pal.hazeFar, 0.8)); gr.addColorStop(1, css(mix(pal.hazeFar, pal.skyLow, 0.5), 0.9));
    x.fillStyle = gr; x.fill();
    // lit rims facing the sun
    x.save(); x.globalCompositeOperation = 'screen'; x.lineWidth = 2.2; x.strokeStyle = css(pal.skyLow, 0.35);
    x.beginPath();
    for (let xx = 0; xx <= 1920; xx += 8) { const y = HZ - 18 - ridgeAt(Lf, xx, 170, 3.2, 120); if (xx === 0) x.moveTo(xx, y); else x.lineTo(xx, y); }
    x.stroke(); x.restore();
    // nearer range
    x.beginPath(); x.moveTo(0, HZ + 4);
    for (let xx = 0; xx <= 1920; xx += 6) x.lineTo(xx, HZ - 8 - ridgeAt(Ln, xx, 95, 5.0, 260));
    x.lineTo(1920, HZ + 4); x.closePath();
    gr = x.createLinearGradient(0, HZ - 110, 0, HZ);
    gr.addColorStop(0, css(pal.hazeNear, 0.92)); gr.addColorStop(1, css(mix(pal.hazeNear, pal.skyMid, 0.3), 0.95));
    x.fillStyle = gr; x.fill();
    // far shore land with rounded trees
    x.fillStyle = pal.land;
    x.beginPath(); x.moveTo(0, HZ + 4);
    for (let xx = 0; xx <= 1920; xx += 4) x.lineTo(xx, farLand(xx, HZ));
    x.lineTo(1920, HZ + 4); x.closePath(); x.fill();
    for (let i = 0; i < 70; i++) {
      const xx = hashU(5, i, 1) * 1920;
      if (Math.abs(xx - 960) < 260) continue;
      const near = HOUSE_SITES.some((h) => Math.abs(h.x - xx) < 55 * h.s + 10);
      if (near) continue;
      const base = farLand(xx, HZ) + 2;
      const r = 6 + hashU(5, i, 2) * 12 * sm((Math.abs(xx - 960) - 200) / 500);
      x.fillStyle = mix(pal.land, pal.shore, hashU(5, i, 3) * 0.6);
      x.beginPath(); x.ellipse(xx, base - r * 1.2, r, r * 1.5, 0, 0, TAU); x.fill();
      x.fillRect(xx - 1, base - r * 0.4, 2, r * 0.5);
    }
    // a thin bright waterline
    x.save(); x.globalCompositeOperation = 'screen';
    gr = x.createLinearGradient(0, HZ - 3, 0, HZ + 3);
    gr.addColorStop(0, css(pal.skyLow, 0)); gr.addColorStop(0.5, css(pal.sun, 0.55)); gr.addColorStop(1, css(pal.skyLow, 0));
    x.fillStyle = gr; x.fillRect(0, HZ - 3, 1920, 6);
    x.restore();
    if (dusk) {
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = css(pal.plum, 0.5);
      x.fillRect(0, 0, 1920, 1080);
      x.globalCompositeOperation = 'source-over';
    }
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** The near bank: painted meadow ground with grass, small flowers and a warm lit rim. Device size. */
function bankLayer(g, pal) {
  const ds = g.scale;
  return cached(`bank|${pal.key}|${g.devW}`, () => {
    const c = g.createCanvas(g.devW, g.devH), x = c.getContext('2d');
    x.scale(ds, ds);
    const css = g.color.css, mix = g.color.mix;
    const top = (xx) => bankY(xx);
    const path = () => {
      x.beginPath(); x.moveTo(-4, 1084);
      for (let xx = -4; xx <= 1924; xx += 6) x.lineTo(xx, top(xx));
      x.lineTo(1924, 1084); x.closePath();
    };
    path();
    let gr = x.createLinearGradient(0, 860, 0, 1080);
    gr.addColorStop(0, mix(pal.meadow, pal.skyLow, 0.3));
    gr.addColorStop(0.18, mix(pal.meadow, pal.stem, 0.25));
    gr.addColorStop(0.6, mix(pal.meadow, pal.shore, 0.35));
    gr.addColorStop(1, mix(pal.meadow, pal.shore, 0.75));
    x.fillStyle = gr; x.fill();
    x.save(); path(); x.clip();
    // painterly blotches
    for (let i = 0; i < 90; i++) {
      const xx = hashU(8, i, 1) * 1920, yy = 880 + hashU(8, i, 2) * 200;
      const r = 40 + hashU(8, i, 3) * 120;
      const col = [pal.stem, pal.shore, pal.skyLow, pal.meadow][i % 4];
      const rg = x.createRadialGradient(xx, yy, 0, xx, yy, r);
      rg.addColorStop(0, css(col, 0.16)); rg.addColorStop(1, css(col, 0));
      x.fillStyle = rg; x.fillRect(xx - r, yy - r, 2 * r, 2 * r);
    }
    // grass blades, batched by colour
    const cols = [mix(pal.stem, pal.meadow, 0.3), mix(pal.stem, pal.shore, 0.4), mix(pal.stem, pal.skyLow, 0.35), mix(pal.stem, pal.shore, 0.65)];
    x.lineCap = 'round';
    for (let k = 0; k < cols.length; k++) {
      x.strokeStyle = cols[k];
      x.lineWidth = 1.6;
      x.beginPath();
      for (let i = 0; i < 700; i++) {
        const id = k * 1000 + i;
        const xx = hashU(9, id, 1) * 1940 - 10;
        const yy = top(xx) + 4 + hashU(9, id, 2) ** 1.3 * (1084 - top(xx));
        const depth = (yy - 880) / 200;
        const len = 6 + depth * 26 * (0.5 + hashU(9, id, 3));
        const lean = (hashU(9, id, 4) - 0.5) * 0.9;
        x.moveTo(xx, yy);
        x.quadraticCurveTo(xx + lean * len * 0.3, yy - len * 0.6, xx + lean * len, yy - len);
      }
      x.stroke();
    }
    // tiny flowers
    for (let i = 0; i < 160; i++) {
      const xx = hashU(10, i, 1) * 1920;
      const yy = top(xx) + 8 + hashU(10, i, 2) * (1070 - top(xx));
      const r = 1.4 + ((yy - 880) / 200) * 2.6;
      x.fillStyle = css(['#FFD6E0', '#FFF7E0', '#FFD27A', '#E9B8FF'][i % 4], 0.85);
      x.beginPath(); x.arc(xx, yy, r, 0, TAU); x.fill();
    }
    x.restore();
    // lit rim along the water's edge
    x.save();
    x.globalCompositeOperation = 'screen';
    x.filter = `blur(${2.5 * ds}px)`;
    x.strokeStyle = css(pal.skyLow, 0.75); x.lineWidth = 5;
    x.beginPath();
    for (let xx = -4; xx <= 1924; xx += 6) { if (xx === -4) x.moveTo(xx, top(xx) + 1); else x.lineTo(xx, top(xx) + 1); }
    x.stroke();
    x.restore();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// ---------------------------------------------------------------- dandelions
function stemList(n, rockX) {
  return cached(`stems|${n}|${Math.round(rockX)}`, () => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const back = hashU(11, i, 0) < 0.62;
      let x = -30 + hashU(11, i, 1) * 1980;
      let yb, h, r;
      if (back) {
        yb = bankY(x) + 8 + hashU(11, i, 2) ** 1.4 * 46;
        h = 34 + hashU(11, i, 3) * 46 + (yb - 890) * 0.7;
        r = 5 + hashU(11, i, 4) * 3.5 + (yb - 890) * 0.06;
      } else {
        // the front row frames the shot: tall at the sides, low where the characters stand
        if (Math.abs(x - rockX) < 85) x += x < rockX ? -90 : 90;
        yb = 985 + hashU(11, i, 2) * 115;
        const mid = 1 - 0.55 * sm(1 - Math.abs(x - 720) / 600);
        h = (110 + hashU(11, i, 3) * 170) * mid;
        r = 12 + hashU(11, i, 4) * 11;
      }
      out.push({ i, back, x, yb, h, r, lean: (hashU(11, i, 5) - 0.5) * 0.24, w: back ? 1.3 : 2.2 + hashU(11, i, 6) * 1.2 });
    }
    out.sort((a, b) => a.yb - b.yb);
    const front = out.filter((s) => !s.back).sort((a, b) => a.x - b.x);
    return { all: out, front, backs: out.filter((s) => s.back), fronts: out.filter((s) => !s.back) };
  });
}

/** Stem sway angle: a 4-degree sway on beat_phase phase-shifted by x, plus wind and gusts. */
function stemAngle(s, bp, t, gust) {
  return s.lean + 0.07 * Math.sin(TAU * bp - s.x * 0.0055) + 0.045 * Math.sin(t * 0.7 + s.x * 0.0021 + s.i) + 0.22 * gust * (0.7 + 0.3 * Math.sin(t * 5 + s.i));
}
function stemHead(s, ang) {
  return [s.x + Math.sin(ang) * s.h, s.yb - Math.cos(ang) * s.h];
}

// ---------------------------------------------------------------- characters
/** Point the given arm's wrist at (tx, ty) px with two-bone IK, respecting lean, rotation and facing. */
function reach(d, pose, opts, side, tx, ty, bend = 1) {
  const j = solve(d, pose, opts);
  const sh = j[`shoulder${side}`];
  let vx = ((tx - sh[0]) / j.U) * j.facing, vy = (ty - sh[1]) / j.U;
  const r = -(pose.rot || 0), c = Math.cos(r), s = Math.sin(r);
  const bx = vx * c - vy * s, by = vx * s + vy * c;
  const a = armTo(d, bx, by, pose.lean || 0, bend);
  return { ...pose, [`s${side}`]: a.s, [`e${side}`]: a.e };
}

function jumpAir(a) {
  const u = a < 0.4 ? 0.3 + 0.26 * (a / 0.4) : 0.56 + 0.24 * cl((a - 0.4) / 0.4);
  return { ...cycles.jump(u), bob: 0 };
}

/**
 * Where Kit and June are and how they stand at time tt. Pure in (tt, F, T). Returns
 * {kit, june, joined, clip} where each figure is {d, pose, x, ground | y, scale, facing, water}.
 */
function coupleAt(tt, F, T) {
  const mt = (x) => F.col('mt', x);
  const cyc2 = (x) => mt(x) / 2;
  const t0 = T.t0;
  const Ush = KIT.teen.height * SC;
  const strideW = 0.48 * Ush;                            // px per walk cycle (amt 0.75)
  const adv = (x) => {
    if (x <= T.wade) return 0;
    const xa = Math.min(x, T.shore);
    let v = 0.3 * strideW * (cyc2(xa) - cyc2(T.wade));
    if (x > T.shore) v += strideW * (cyc2(Math.min(x, T.dance)) - cyc2(T.shore));
    return v;
  };
  const walkEndX = XE + adv(T.dance);
  const out = { kit: null, june: null, joined: false };
  const bp = (x) => F.col('beat_phase', x);
  const dancePose = (x, amt = 0.9) => cycles.dance(bp(x), 'sway', amt);
  const kitDanceX = walkEndX - 25;
  const juneDanceX = kitDanceX + GAP_DANCE;
  const sway = (x) => 10 * Math.sin(TAU * F.col('bar_phase', x));

  if (tt < T.dance) {
    // arrival: leap out of the lake, wade ashore, walk along the shore hand in hand
    const a = Math.max(0, tt - t0);
    let scale, ground, water = null, pose;
    if (tt < T.wade) {
      scale = SCW;
      const U = KIT.teen.height * scale;
      const h = a < 0.42 ? 0.32 - 1.37 * (1 - a / 0.42) ** 2 : 0.32 - 0.72 * ((a - 0.42) / 0.38) ** 2;
      ground = YW0 - h * U;
      water = YW0;
      pose = jumpAir(a);
    } else if (tt < T.shore) {
      const w = sm((tt - T.wade) / (T.shore - T.wade));
      scale = lerp(SCW, SC, w);
      const U = KIT.teen.height * scale;
      const yw = lerp(YW0, bankY(XE + adv(tt)) + 4, w);
      ground = yw + lerp(0.4, 0, w) * U;
      water = yw;
      const k = sm((tt - T.wade) / 0.3);
      pose = blend(jumpAir(0.8), cycles.walk(cyc2(tt), 0.75), k);
      pose.lean += 0.08 * (1 - w);
    } else {
      scale = SC;
      const k = sm((tt - T.shore) / 0.6);
      ground = lerp(bankY(XE + adv(T.shore)) + 4, GY, k);
      pose = cycles.walk(cyc2(tt), 0.75);
    }
    const xk = XE + adv(tt);
    const kit = { d: KIT.teen, pose, x: xk, ground, scale, facing: 1, water };
    const june = { d: JUNE.teen, pose: tt < T.wade ? { ...pose } : (tt < T.shore ? blend(jumpAir(0.8), cycles.walk(cyc2(tt) + 0.5, 0.75), sm((tt - T.wade) / 0.3)) : cycles.walk(cyc2(tt) + 0.5, 0.75)), x: xk + GAP_WALK * (scale / SC), ground, scale, facing: 1, water };
    if (tt < T.wade) june.pose = { ...june.pose, sL: pose.sL + 0.1 };
    // joined hands: Kit's near (R) hand forward, June's far (L) hand back
    const jk = solve(kit.d, kit.pose, kit), jj = solve(june.d, june.pose, june);
    const mx = (jk.shoulderR[0] + jj.shoulderL[0]) / 2;
    const my = (jk.shoulderR[1] + jj.shoulderL[1]) / 2 + (tt < T.wade ? -0.3 : 0.2) * KIT.teen.height * scale;
    kit.pose = reach(kit.d, kit.pose, kit, 'R', mx, my, 1);
    june.pose = reach(june.d, june.pose, june, 'L', mx, my, -1);
    out.kit = kit; out.june = june; out.joined = true;
    return out;
  }

  if (tt < T.gone) {
    // dance facing each other, near hands joined
    const k = sm((tt - T.dance) / 0.5);
    const walkP = cycles.walk(cyc2(tt), 0.75 * (1 - k));
    const kp = blend(walkP, dancePose(tt), k);
    const jp = blend(cycles.walk(cyc2(tt) + 0.5, 0.75 * (1 - k)), dancePose(tt + 0.02), k);
    const sx = sway(tt) * k;
    const kit = { d: KIT.teen, pose: kp, x: lerp(walkEndX, kitDanceX, k) + sx, ground: GY, scale: SC, facing: 1 };
    const june = { d: JUNE.teen, pose: jp, x: lerp(walkEndX + GAP_WALK, juneDanceX, k) + sx, ground: GY, scale: SC, facing: tt < T.dance + 0.12 ? 1 : -1 };
    const jk = solve(kit.d, kit.pose, kit), jj = solve(june.d, june.pose, june);
    const mx = (jk.shoulderR[0] + jj.shoulderR[0]) / 2, my = Math.max(jk.shoulderR[1], jj.shoulderR[1]) + 0.12 * Ush;
    kit.pose = reach(kit.d, kit.pose, kit, 'R', mx, my, 1);
    june.pose = reach(june.d, june.pose, june, 'R', mx, my, 1);
    out.kit = kit; out.june = june; out.joined = true;
    return out;
  }

  // June is frozen at the moment she dissolves (drawn by the dissolve)
  const gonePose = (() => {
    const s = coupleAt(T.gone - 1e-4, F, T);
    return s;
  });
  const kitGoneX = kitDanceX + sway(T.gone);
  if (tt < T.settle) {
    const g0 = gonePose();
    const k = sm((tt - T.gone) / 0.5);
    const lower = sm((tt - T.gone - 3) / 1.4);
    const reachP = { ...poses.stand, lean: 0.16, head: -0.45, hR: 0.32, kR: 0.08, hL: -0.18, kL: 0.2, sL: -0.2, eL: 0.3 };
    let pose = blend(g0.kit.pose, reachP, k);
    pose = blend(pose, { ...poses.slump, head: 0.2, lean: 0.12 }, lower * 0.7);
    const kit = { d: KIT.teen, pose, x: kitGoneX + 14 * sm((tt - T.gone) / 0.8), ground: GY, scale: SC, facing: 1 };
    // reach after the seeds: the arm follows the middle of the cloud as it blows up and away
    const jj = solve(g0.june.d, g0.june.pose, placeOf(g0.june));
    const a = Math.max(0, tt - T.gone - DIS_PRE - 0.5 * DIS_DUR);
    const tx = jj.headC[0] + 40 + 185 * a + 90 * a * a, ty = jj.headC[1] - 90 - 115 * a - 35 * a * a;
    const reachK = k * (1 - lower);
    kit.pose = blend(kit.pose, reach(kit.d, kit.pose, kit, 'R', tx, ty, 1), reachK);
    out.kit = kit; out.june = { ...g0.june, frozen: true };
    return out;
  }

  const kitStartX = kitGoneX + 14;
  const stride6 = 0.36 * Ush;
  const cyc4 = (x) => mt(x) / 4;
  const walkX = (x) => kitStartX - stride6 * (cyc4(Math.min(x, T.held)) - cyc4(T.settle));
  const rockX = walkX(T.held);
  if (tt < T.held) {
    const k = sm((tt - T.settle) / 0.5);
    const pose = blend({ ...poses.slump, head: 0.2, lean: 0.12 }, { ...cycles.walk(cyc4(tt), 0.55), head: 0.18, lean: 0.1 }, k);
    out.kit = { d: KIT.teen, pose, x: walkX(tt), ground: GY, scale: SC, facing: -1 };
    out.rockX = rockX;
    return out;
  }
  // sit on the rock, then stand and reach up to the constellation
  const standP = { ...poses.stand, head: -0.1 };
  const sitP = { ...poses.sit, head: -0.15 + 0.06 * Math.exp(-bp(tt) * 5), sL: 0.55, sR: 0.65, eL: 0.9, eR: 0.8 };
  const seatY = GY - 0.235 * Ush;
  const jStand = solve(KIT.teen, standP, { x: rockX, ground: tt < T.home ? GY : seatY + 4, scale: SC });
  const kSit = sm((tt - T.held) / 1.0) * (1 - sm((tt - T.home - 0.2) / 0.8));
  let pose = blend(standP, sitP, kSit);
  const y = lerp(jStand.pelvis[1], seatY, kSit);
  if (tt >= T.home) {
    const up = sm((tt - T.home - 0.2) / 0.8);
    pose = blend(pose, { ...poses.stand, head: -0.5, lean: -0.06 }, up * (1 - kSit));
  }
  const kit = { d: KIT.teen, pose, x: rockX, y, scale: SC, facing: 1 };
  if (tt >= T.confess - 0.3) {
    const k = sm((tt - T.confess + 0.3) / 0.7);
    const target = reach(KIT.teen, kit.pose, kit, 'R', 1360, 300, 1);
    kit.pose = blend(kit.pose, target, k);
  }
  out.kit = kit; out.rockX = rockX;
  return out;
}

function placeOf(st) {
  const o = { x: st.x, scale: st.scale, facing: st.facing, view: 'side' };
  if (st.y !== undefined) o.y = st.y; else o.ground = st.ground;
  return o;
}

// ---------------------------------------------------------------- silhouette sampling
const JUNE_SKIN = '#FFDCC2', JUNE_HAIR = '#6B2D3C';     // June's face and bob, as in cast.mjs
function sampleFigure(d, pose, opts, n, seed) {
  const j = solve(d, pose, opts);
  const U = j.U;
  const segs = [];
  const add = (a, b, w, col, wt) => segs.push({ a, b, w, col, wt: wt * Math.hypot(b[0] - a[0], b[1] - a[1]) * w });
  const front = opts.view === 'front';
  const tw = (front ? d.torsoW : d.torsoSide) * U;
  add(j.pelvis, j.neck, tw * (front ? 1.2 : 1.1), d.fill, 1.4);
  for (const lr of ['L', 'R']) {
    add(j[`shoulder${lr}`], j[`elbow${lr}`], d.armW * U, d.limbFill, 1);
    add(j[`elbow${lr}`], j[`wrist${lr}`], d.armW * U, d.limbFill, 1);
    add(j[`hip${lr}`], j[`knee${lr}`], d.legW * U, d.limbFill, 1);
    add(j[`knee${lr}`], j[`ankle${lr}`], d.legW * U, d.limbFill, 1);
  }
  const hr = d.headR * U;
  const headWt = Math.PI * hr * hr * 1.3;
  let tot = headWt;
  for (const s of segs) tot += s.wt;
  const pts = [];
  for (let i = 0; i < n; i++) {
    let pick = hashU(seed, i, 1) * tot;
    const v = hashU(seed, i, 2), w = hashU(seed, i, 3);
    if (pick < headWt) {
      const a = v * TAU, r = hr * 1.05 * Math.sqrt(w);
      const x = j.headC[0] + Math.cos(a) * r, y = j.headC[1] + Math.sin(a) * r;
      const hair = y < j.headC[1] - hr * 0.1 || (!front && Math.cos(a) * j.facing < -0.2);
      pts.push({ x, y, col: hair ? JUNE_HAIR : JUNE_SKIN, i });
      continue;
    }
    pick -= headWt;
    let s = segs[segs.length - 1];
    for (const q of segs) { if (pick < q.wt) { s = q; break; } pick -= q.wt; }
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy) || 1;
    const flare = s.col === d.fill && d.torsoShape === 'tri' ? 1.45 - 0.8 * v : 1;
    const off = (w - 0.5) * s.w * flare;
    pts.push({ x: s.a[0] + dx * v - (dy / L) * off, y: s.a[1] + dy * v + (dx / L) * off, col: s.col, i });
  }
  return { pts, j };
}

const warmCache = new Map();
/** June's colours lifted toward warm gold light, so the flecks glow instead of reading as dirt. */
function mixWarm(hex) {
  let v = warmCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1, 7), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const gold = [255, 214, 140];
    const out = ch.map((c, i) => Math.round(c + (gold[i] - c) * 0.72));
    v = `rgb(${out[0]},${out[1]},${out[2]})`;
    warmCache.set(hex, v);
  }
  return v;
}

// June's dissolve: seeds leave from the downwind (up-right) edge first.
const WX = 0.8, WY = -0.6;
function dissolveSeeds(F, T, P) {
  const g0 = coupleAt(T.gone - 1e-4, F, T);
  const st = g0.june;
  return cached(`dis|${T.gone}|${st.x.toFixed(2)}|${P.juneSeeds}`, () => {
    const { pts, j } = sampleFigure(st.d, st.pose, placeOf(st), Math.max(1, P.juneSeeds | 0), 913);
    let wmin = Infinity, wmax = -Infinity;
    for (const p of pts) { p.w = p.x * WX + p.y * WY; wmin = Math.min(wmin, p.w); wmax = Math.max(wmax, p.w); }
    // extremities and the downwind side go first; her heart goes last
    const cx = j.pelvis[0] * 0.4 + j.neck[0] * 0.6, cy = j.pelvis[1] * 0.4 + j.neck[1] * 0.6;
    let dmax = 1;
    for (const p of pts) dmax = Math.max(dmax, Math.hypot(p.x - cx, p.y - cy));
    for (const p of pts) {
      const wind = (wmax - p.w) / Math.max(1, wmax - wmin);
      const core = 1 - Math.hypot(p.x - cx, p.y - cy) / dmax;
      p.o = cl(0.5 * wind + 0.5 * core + (hashU(914, p.i, 1) - 0.5) * 0.12);
      p.vx = 110 + hashU(914, p.i, 2) * 150; p.vy = -50 - hashU(914, p.i, 3) * 130;
      p.ax = 120 + hashU(914, p.i, 4) * 120; p.ay = -40 - hashU(914, p.i, 5) * 60;
      p.sz = 13 + hashU(914, p.i, 6) * 8; p.ph = hashU(914, p.i, 7) * TAU;
      p.warm = mixWarm(p.col);
    }
    return { pts, wmin, wmax, st, j };
  });
}
const DIS_PRE = 0.2, DIS_DUR = 1.6;

// ---------------------------------------------------------------- crack network
/** Branching crack polylines around a sun of radius R, relative to its centre; d = distance from the rim. */
function crackNet(R) {
  return cached(`cracks|${R}`, () => {
    const branches = [];
    let ctr = 0;
    const rnd = () => hashU(4242, ctr++, 0);
    const grow = (x, y, ang, d, len, w, depth) => {
      const pts = [[x, y, d]];
      let L = 0;
      const base = ang;
      while (L < len) {
        const seg = 26 + rnd() * 46;
        ang = base + (ang - base) * 0.6 + (rnd() - 0.5) * 0.42;       // straight-ish with kinks
        x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
        L += seg; d += seg;
        pts.push([x, y, d]);
        if (depth < 2 && rnd() < 0.2) grow(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.5), d, len * (0.15 + rnd() * 0.25), w * 0.55, depth + 1);
      }
      branches.push({ pts, w, thick: depth === 0 });
    };
    const n = 14;
    const mains = [];
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI + 0.06 + ((i + 0.5) / n) * (Math.PI - 0.12) + (rnd() - 0.5) * 0.15;
      mains.push(ang);
      grow(Math.cos(ang) * R, Math.sin(ang) * R, ang, 0, 1100 + rnd() * 600, 2.4, 0);
    }
    // concentric links between neighbouring radials, like a shattered pane
    for (const rr of [150, 330, 560, 820]) {
      for (let i = 0; i + 1 < n; i++) {
        if (rnd() < 0.35) continue;
        const a0 = mains[i], a1 = mains[i + 1];
        const pts = [];
        const steps = 3;
        for (let k = 0; k <= steps; k++) {
          const a = a0 + (a1 - a0) * (k / steps);
          const r = R + rr * (1 + (rnd() - 0.5) * 0.12);
          pts.push([Math.cos(a) * r, Math.sin(a) * r, rr + 40 + k * 18]);
        }
        branches.push({ pts, w: 1.1, thick: false });
      }
    }
    return branches;
  });
}

/** Trace the revealed part (d <= Rr) of a branch into the current path; returns the tip or null. */
function traceBranch(ctx, b, cx, cy, Rr) {
  const p = b.pts;
  if (p[0][2] > Rr) return null;
  ctx.moveTo(cx + p[0][0], cy + p[0][1]);
  for (let k = 1; k < p.length; k++) {
    const [x1, y1, d1] = p[k];
    if (d1 <= Rr) { ctx.lineTo(cx + x1, cy + y1); continue; }
    const [x0, y0, d0] = p[k - 1];
    const f = (Rr - d0) / Math.max(1e-6, d1 - d0);
    const x = cx + x0 + (x1 - x0) * f, y = cy + y0 + (y1 - y0) * f;
    ctx.lineTo(x, y);
    return [x, y];
  }
  return null;
}

// ---------------------------------------------------------------- the world above the horizon
function drawAbove(g, t, F, P, S, T, pal, HZ) {
  const ctx = g.ctx, css = g.color.css, mix = g.color.mix, sp = g.sprites;
  const dusk = sm((t - T.held) / Math.max(0.1, T.home - T.held));
  // 1. sky gradient (dithered, cached) + painterly field
  const stops = cached(`skystops|${pal.key}|${HZ}`, () => [
    [0, pal.skyTop], [0.16, mix(pal.skyTop, pal.skyMid, 0.35)], [0.33, mix(pal.skyTop, pal.skyMid, 0.78)],
    [0.43, pal.skyMid], [HZ / 1080, mix(pal.skyLow, pal.sun, 0.25)], [1, pal.skyLow],
  ]);
  g.world.sky(g, stops);
  const fc = field(g, {
    key: 'goldlake-sky', seed: (S.seed % 997) + 3, t, w: 288, h: 84, scale: 2.4, speed: [0.01, 0.0025], warp: 1.0, flow: 0.015,
    octaves: 4, contrast: 1.15,
    stops: [[0, pal.skyTop], [0.4, mix(pal.skyTop, pal.skyMid, 0.6)], [0.62, pal.skyMid], [0.85, pal.skyLow], [1, pal.sun]],
  });
  drawField(g, fc, { alpha: 0.32, comp: 'soft-light', x: 0, y: 0, w: 1920, h: HZ });
  // the sky deepens toward plum over the held ii
  if (dusk > 0.002) {
    const gr = ctx.createLinearGradient(0, 0, 0, HZ);
    gr.addColorStop(0, css(pal.plum, 0.72 * dusk));
    gr.addColorStop(0.6, css(pal.skyTop, 0.42 * dusk));
    gr.addColorStop(1, css(pal.skyMid, 0.12 * dusk));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 1920, HZ + 2);
  }
  // 2. the sun: big glow, soft slow rays, disc
  const sx = 960, sy = P.sunY, R = P.sunR;
  const hitK = 1 + 0.15 * (F.c.hit || 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.6 * (1 - 0.35 * dusk);
  ctx.drawImage(sp.glow(pal.sunGlow), sx - R * 5 * hitK, sy - R * 5 * hitK, R * 10 * hitK, R * 10 * hitK);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(sp.glow(pal.sun), sx - R * 2.3 * hitK, sy - R * 2.3 * hitK, R * 4.6 * hitK, R * 4.6 * hitK);
  ctx.globalAlpha = 1;
  rays(ctx, { cx: sx, cy: sy, n: 18, rot: t * 0.012, spread: 0.055, length: 1500, color: css(pal.sun, 0.12 * hitK), fade: css(pal.sun, 0) });
  rays(ctx, { cx: sx, cy: sy, n: 11, rot: -t * 0.008 + 0.3, spread: 0.09, length: 1200, color: css(pal.sunGlow, 0.08), fade: css(pal.sunGlow, 0) });
  ctx.restore();
  const sunCol = mix(pal.sun, pal.sunGlow, 0.45 * dusk);
  const dg = ctx.createRadialGradient(sx, sy - R * 0.25, 0, sx, sy, R);
  dg.addColorStop(0, '#FFFFFF'); dg.addColorStop(0.55, sunCol); dg.addColorStop(1, mix(sunCol, pal.sunGlow, 0.5));
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
  // 3. painted clouds drifting, lit from below
  const CL = [
    { i: 0, y: 150, x0: 120, v: 6, s: 1.05 }, { i: 1, y: 255, x0: 1180, v: 8, s: 0.95 }, { i: 2, y: 80, x0: 1500, v: 4, s: 1.2 },
    { i: 3, y: 330, x0: 400, v: 10, s: 0.8 }, { i: 4, y: 410, x0: 900, v: 13, s: 0.9 }, { i: 5, y: 455, x0: 1650, v: 15, s: 0.7 },
    { i: 0, y: 360, x0: 1950, v: 9, s: 0.65 }, { i: 2, y: 215, x0: 700, v: 5, s: 0.75 },
  ];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const c of CL) {
    const spr = cloudSprite(g, pal, c.i);
    const w = 760 * c.s, h = 220 * c.s * 0.8;
    const span = 1920 + w;
    const x = ((((c.x0 + t * c.v) % span) + span) % span) - w;
    ctx.globalAlpha = 0.9 * (1 - 0.3 * dusk);
    ctx.drawImage(spr, x * g.scale, (c.y - h * 0.7) * g.scale, w * g.scale, h * g.scale);
  }
  ctx.restore();
  // 4. a little flock of birds, slowly crossing
  {
    const per = 34, ph = ((t - T.t0) / per) % 1;
    const bx = -200 + ph * 2400, by = 250 + 40 * Math.sin(ph * 5);
    ctx.save();
    ctx.strokeStyle = css(pal.shore, 0.75); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let b = 0; b < 7; b++) {
      const row = Math.ceil(b / 2), side = b % 2 ? 1 : -1;
      const x = bx - row * 34, y = by + side * row * 18 + 4 * Math.sin(t * 1.3 + b);
      const fl = Math.sin(t * 9 + b * 1.7), w = 11 - row;
      ctx.moveTo(x - w, y - fl * 6); ctx.quadraticCurveTo(x - w * 0.4, y - 2 - fl * 3, x, y);
      ctx.quadraticCurveTo(x + w * 0.4, y - 2 - fl * 3, x + w, y - fl * 6);
    }
    ctx.stroke(); ctx.restore();
  }
  // 5. cracks spreading across the sky from the sun in the last bar
  drawCracks(g, t, P, T, pal);
  // 6. hills, far shore, tree line (cached; a plum-tinted copy fades in at dusk)
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(hillsLayer(g, pal, HZ), 0, 0);
  if (dusk > 0.002) { ctx.globalAlpha = dusk; ctx.drawImage(hillsLayer(g, pal, HZ, true), 0, 0); }
  ctx.restore();
  // 7. the settling: houses, benches, friends
  drawHouses(g, t, F, P, T, pal, HZ);
  // 8. June's constellation among the clouds
  drawConstellation(g, t, F, P, T, pal);
}

function drawHouses(g, t, F, P, T, pal, HZ) {
  const ctx = g.ctx, css = g.color.css, sp = g.sprites;
  const n = Math.min(HOUSE_SITES.length, T.houses.length);
  for (let i = 0; i < n; i++) {
    const th = T.houses[i];
    if (t < th) continue;
    const site = HOUSE_SITES[i];
    const s = site.s;
    const k = outBack((t - th) / 0.45);
    const lit = sm((t - th - 0.3) / 0.5);
    const yb = farLand(site.x, HZ) + 2;
    const w = 66 * s, wh = 46 * s, rh = 38 * s;
    ctx.save();
    ctx.translate(site.x, yb);
    ctx.scale(k, k);
    // chimney smoke
    if (lit > 0) {
      for (let q = 0; q < 6; q++) {
        const age = (t * 0.32 + q / 6 + i * 0.13) % 1;
        const r = (3 + 10 * age) * s;
        ctx.fillStyle = css(g.color.mix(pal.houseWall, pal.skyMid, 0.5), 0.32 * (1 - age) * lit);
        ctx.beginPath(); ctx.arc(w * 0.22 + 22 * s * age + 4 * Math.sin(age * 6 + q), -wh - rh * 0.65 - 60 * s * age, r, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = pal.roofShade;
    ctx.fillRect(w * 0.16, -wh - rh * 0.85, 9 * s, rh * 0.5);
    // walls (in shadow: the sun is behind)
    ctx.fillStyle = pal.wallShade;
    ctx.fillRect(-w / 2, -wh, w, wh);
    ctx.fillStyle = css(pal.houseWall, 0.35);
    ctx.fillRect(-w / 2, -wh, w * 0.12, wh);
    // roof with a lit ridge
    ctx.fillStyle = pal.roof;
    ctx.beginPath(); ctx.moveTo(-w / 2 - 7 * s, -wh + 1); ctx.lineTo(0, -wh - rh); ctx.lineTo(w / 2 + 7 * s, -wh + 1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(pal.skyLow, 0.8); ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(-w / 2 - 7 * s, -wh + 1); ctx.lineTo(0, -wh - rh); ctx.lineTo(w / 2 + 7 * s, -wh + 1); ctx.stroke();
    // door and windows
    ctx.fillStyle = pal.roofShade;
    ctx.fillRect(-6 * s, -24 * s, 12 * s, 24 * s);
    const winCol = g.color.mix(pal.wallShade, pal.window, lit);
    ctx.fillStyle = winCol;
    const wins = [[-w * 0.33, -wh * 0.72], [w * 0.17, -wh * 0.72]];
    for (const [wx, wy] of wins) ctx.fillRect(wx, wy, 13 * s, 12 * s);
    ctx.fillStyle = css(pal.window, 0.9 * lit);
    ctx.beginPath(); ctx.arc(0, -wh - rh * 0.42, 5 * s, 0, TAU); ctx.fill();
    ctx.restore();
    if (lit > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const fl = 0.9 + 0.1 * Math.sin(t * 7 + i * 3);
      ctx.globalAlpha = 0.75 * lit * fl;
      const r = 46 * s;
      ctx.drawImage(sp.glow(pal.window), site.x - r, yb - wh * 0.6 - r, 2 * r, 2 * r);
      ctx.restore();
    }
    // a pop of sparkle as the house appears
    const pop = cl(1 - (t - th) / 0.6);
    if (pop > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = pop;
      const r = 90 * s * (1 + (1 - pop));
      ctx.drawImage(sp.glow(pal.sun, 1), site.x - r, yb - 40 * s - r, 2 * r, 2 * r);
      ctx.restore();
    }
  }
  // the friends sit in pairs on benches in front of the two nearest houses
  for (let p = 0; p < 2; p++) {
    const hi = p + 1;
    if (hi >= n || t < T.houses[hi]) continue;
    const site = HOUSE_SITES[hi];
    const age = t - T.houses[hi];
    const app = sm(age / 0.5);
    const sitK = sm((age - 0.15) / 0.5);
    const yb = farLand(site.x, HZ) + 4;
    const fs = 0.23 * site.s;
    const bx = site.x + (p === 0 ? 50 : -48) * site.s;
    const bench = { y: yb - 12 * fs * 4.2 };
    ctx.save();
    ctx.globalAlpha = app;
    // bench
    ctx.fillStyle = pal.roofShade;
    ctx.fillRect(bx - 22 * site.s, bench.y, 44 * site.s, 3.5 * site.s);
    ctx.fillRect(bx - 19 * site.s, bench.y, 3 * site.s, yb - bench.y);
    ctx.fillRect(bx + 16 * site.s, bench.y, 3 * site.s, yb - bench.y);
    for (let q = 0; q < 2; q++) {
      const d = FRIENDS[p * 2 + q].teen;
      const facing = q === 0 ? 1 : -1;
      const nod = 0.12 * Math.exp(-F.c.beat_phase * 5) + 0.06 * Math.sin(t * 1.3 + q * 2 + p);
      const pose = blend({ ...poses.stand }, { ...poses.sit, head: nod, rot: facing * 0.04 * Math.sin(t * 0.9 + p) }, sitK);
      const U = d.height * fs;
      const j0 = solve(d, poses.stand, { x: 0, ground: yb, scale: fs });
      const y = lerp(j0.pelvis[1], bench.y - 0.02 * U, sitK);
      drawPuppet(ctx, d, pose, { x: bx + (q === 0 ? -9 : 9) * site.s, y, scale: fs, facing, view: 'side', devScale: g.scale });
    }
    ctx.restore();
  }
}

// front view, arms opening, one reaching down toward Kit (static: it breathes as a whole)
const CON_POSE = { ...poses.stand, sL: 1.25, eL: 0.35, sR: 0.75, eR: 0.25, hL: 0.12, hR: 0.06, kL: 0.25, head: 0.1, rot: 0.18 };

/** June's silhouette as a soft blurred glow, cached once per colour and device scale. */
function ghostSprite(g, col, opts) {
  const ds = g.scale;
  return cached(`ghost|${col}|${ds}`, () => {
    const d = JUNE.teen;
    const j = solve(d, CON_POSE, opts);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of Object.values(j)) if (Array.isArray(v)) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
    const pad = 90;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const w = x1 - x0, h = y1 - y0;
    const tmp = g.createCanvas(Math.ceil(w * ds), Math.ceil(h * ds)), tx = tmp.getContext('2d');
    tx.scale(ds, ds);
    tx.translate(-x0, -y0);
    drawPuppet(tx, d, CON_POSE, { ...opts, outline: col, outlineW: 5, devScale: ds });
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = col; tx.fillRect(0, 0, tmp.width, tmp.height);
    const c = g.createCanvas(tmp.width, tmp.height), x = c.getContext('2d');
    x.globalAlpha = 0.62;
    x.filter = `blur(${6 * ds}px)`;
    x.drawImage(tmp, 0, 0);
    x.filter = 'none';
    x.globalAlpha = 0.38;
    x.drawImage(tmp, 0, 0);
    x.getImageData(0, 0, 1, 1);
    return { c, x0, y0, w, h };
  });
}
const CON = { x: 1400, y: 500, scale: 1.75 };

function drawConstellation(g, t, F, P, T, pal) {
  if (t < T.home) return;
  const end = T.scatter + 1.8;
  if (t > end) return;
  const ctx = g.ctx, css = g.color.css, sp = g.sprites, ds = g.scale;
  const d = JUNE.teen;
  const opts = { x: CON.x, ground: CON.y, scale: CON.scale, facing: 1, view: 'front' };
  const base = cached(`con|${P.juneSeeds}`, () => sampleFigure(d, CON_POSE, opts, Math.max(1, P.juneSeeds | 0), 513));
  // it breathes and sways as a whole about its middle
  const br = 0.035 * Math.sin(t * 0.7), bs = 1 + 0.015 * Math.sin(t * 1.1);
  const ox = CON.x, oy = CON.y - 0.5 * d.height * CON.scale;
  const cr = Math.cos(br) * bs, sr = Math.sin(br) * bs;
  const tf = (x, y) => [ox + (x - ox) * cr - (y - oy) * sr, oy + (x - ox) * sr + (y - oy) * cr];
  const j = {};
  for (const [k, v] of Object.entries(base.j)) if (Array.isArray(v)) j[k] = tf(v[0], v[1]);
  j.U = base.j.U;
  const pts = base.pts.map((p) => { const [x, y] = tf(p.x, p.y); return { x, y, i: p.i }; });
  const form = sm((t - T.home - 0.3) / 0.5) * (1 - sm((t - T.scatter) / 0.5));
  // a ghostly glow of her whole silhouette
  if (form > 0.01) {
    const gh = ghostSprite(g, pal.seed, opts);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.26 * form;
    ctx.translate(ox, oy); ctx.rotate(br); ctx.scale(bs, bs); ctx.translate(-ox, -oy);
    ctx.drawImage(gh.c, gh.x0, gh.y0, gh.w, gh.h);
    ctx.restore();
  }
  // faint constellation lines along the skeleton
  if (form > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = css(pal.seed, 0.22 * form); ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    const line = (...ks) => { ks.forEach((k, i) => (i ? ctx.lineTo(j[k][0], j[k][1]) : ctx.moveTo(j[k][0], j[k][1]))); };
    line('pelvis', 'neck');
    line('shoulderL', 'elbowL', 'wristL'); line('shoulderR', 'elbowR', 'wristR');
    line('hipL', 'kneeL', 'ankleL'); line('hipR', 'kneeR', 'ankleR');
    ctx.moveTo(j.headC[0] + d.headR * j.U, j.headC[1]); ctx.arc(j.headC[0], j.headC[1], d.headR * j.U, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.3 * form;
    const r = 300;
    ctx.drawImage(sp.glow(pal.seed), j.neck[0] - r, j.neck[1] - r, 2 * r, 2 * r);
    // a star at every joint
    const star = sp.glow(pal.seed, 1);
    for (const k of ['headC', 'neck', 'pelvis', 'elbowL', 'elbowR', 'wristL', 'wristR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'shoulderL', 'shoulderR']) {
      const tw = 0.75 + 0.25 * Math.sin(t * 3 + k.length);
      ctx.globalAlpha = 0.9 * form * tw;
      const rr = k === 'headC' ? 34 : 16;
      ctx.drawImage(star, j[k][0] - rr, j[k][1] - rr, 2 * rr, 2 * rr);
    }
    ctx.restore();
  }
  const spr = seedSprite(g, pal.seed);
  ctx.save();
  for (const p of pts) {
    const i = p.i;
    const delay = hashU(514, i, 1) * 0.25, dur = 0.55 + hashU(514, i, 2) * 0.3;
    const e = outCubic((t - T.home - delay) / dur);
    if (e <= 0) continue;
    const stx = 1980 + hashU(514, i, 3) * 420, sty = -160 + hashU(514, i, 4) * 520;
    const dir = hashU(514, i, 5) < 0.5 ? 1 : -1;
    const ang = (1 - e) * 2.4 * dir;
    const rx = (stx - p.x) * (1 - e), ry = (sty - p.y) * (1 - e);
    let x = p.x + rx * Math.cos(ang) - ry * Math.sin(ang);
    let y = p.y + rx * Math.sin(ang) + ry * Math.cos(ang);
    x += 2.5 * Math.sin(t * 2.1 + i); y += 2.5 * Math.cos(t * 1.7 + i * 1.3);
    let a = 0.7 * Math.min(1, e * 1.5);
    const sa = t - T.scatter - hashU(514, i, 6) * 0.4;
    if (sa > 0) {
      const vx = 80 + hashU(514, i, 7) * 260, vy = -140 + hashU(514, i, 8) * 160;
      x += vx * sa + 70 * sa * sa; y += vy * sa - 30 * sa * sa;
      a *= cl(1 - sa / 1.3);
    }
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    const sz = 12 + hashU(514, i, 9) * 7;
    stamp(ctx, ds, spr, x, y, sz, sz * 1.25, 0.3 * Math.sin(t * 1.5 + i), 0.5, 0.38);
  }
  ctx.restore();
}

function drawCracks(g, t, P, T, pal) {
  if (t < T.crack) return;
  const ctx = g.ctx, css = g.color.css, sp = g.sprites;
  const u = cl((t - T.crack) / Math.max(0.2, T.t1 - T.crack));
  const Rr = 1700 * (0.1 * u + 0.9 * u ** 2.3) + 24;     // faster and faster
  const cx = 960, cy = P.sunY;
  const net = crackNet(Math.round(P.sunR * 0.94));
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = css(pal.crack, 0.1 * u * u);          // light leaking through the sky
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.strokeStyle = css(g.color.mix(pal.crack, pal.sunGlow, 0.5), 0.16 + 0.16 * u);
  ctx.lineWidth = 6;
  ctx.beginPath();
  const tips = [];
  for (const b of net) { const tip = traceBranch(ctx, b, cx, cy, Rr); if (tip) tips.push([tip, b.thick]); }
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = css(pal.crack, 0.95);
  for (const thick of [true, false]) {
    ctx.lineWidth = thick ? 2.2 : 1.1;
    ctx.beginPath();
    for (const b of net) if (b.thick === thick) traceBranch(ctx, b, cx, cy, Rr);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'screen';                // sparks at the growing tips
  for (const [[x, y], thick] of tips) {
    const r = thick ? 18 : 9;
    ctx.drawImage(sp.glow(pal.crack, 1), x - r, y - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the lake
function drawReflection(g, L, t, F, P, HZ, bottom) {
  const ctx = g.ctx, ds = g.scale;
  const n = Math.max(8, P.slices | 0);
  const snare = F.c.snare || 0;
  const ls = F.last('snare', t + 0.5 / F.fps);
  const sAge = ls ? Math.max(0, t - ls[0]) : 99;
  const sStr = ls ? (ls[1] ?? 1) : 0;
  const front = HZ + sAge * 520;
  ctx.save();
  ctx.setTransform(ds, 0, 0, -ds, 0, 2 * HZ * ds);       // mirror about the horizon
  const sub = 2, m = n * sub, hh = (bottom - HZ) / m;
  for (let i = 0; i < m; i++) {
    const fi = i / sub;                                  // slice index (fractional: offsets interpolate)
    const d = (i + 0.5) / m;
    const yd = HZ + (i + 0.5) * hh;                      // destination row (on screen)
    const amp = (0.6 + 8 * d ** 1.4) * (1 + 1.6 * snare);
    let dx = amp * (0.6 * Math.sin(fi * 0.31 + t * 2.1 - d * 4) + 0.4 * Math.sin(fi * 0.13 - t * 1.3 + d * 3));
    const wv = Math.exp(-(((yd - front) / 60) ** 2)) * sStr * Math.exp(-sAge / 1.4);
    dx += wv * 9 * Math.sin(fi * 0.5 + t * 9);
    const ys = HZ - (i + 1) * hh;                        // source rows (mirror)
    const sy0 = Math.max(0, ys * ds), sh = Math.min(hh + 0.75, HZ - ys) * ds;
    ctx.drawImage(L.canvas, 0, sy0, g.devW, sh, dx - 12, ys, 1920 + 24, sh / ds);
  }
  ctx.restore();
}

function drawLake(g, t, F, P, T, pal, HZ, bottom) {
  const ctx = g.ctx, css = g.color.css, sp = g.sprites, mix = g.color.mix;
  const dusk = sm((t - T.held) / Math.max(0.1, T.home - T.held));
  // darken toward the lake colour, more toward the viewer (fresnel)
  const gr = ctx.createLinearGradient(0, HZ, 0, bottom);
  gr.addColorStop(0, css(pal.lake, 0.24));
  gr.addColorStop(0.5, css(pal.lake, 0.36));
  gr.addColorStop(1, css(pal.lake, 0.5));
  ctx.fillStyle = gr; ctx.fillRect(0, HZ, 1920, bottom - HZ);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // perspective ripple lines catching the light
  const L = lattice(61);
  ctx.lineWidth = 1.3;
  for (let k = 1; k < 18; k++) {
    const yk = HZ + ((k / 18) ** 1.7) * (bottom - HZ);
    const a = 0.07 + 0.05 * Math.sin(t * 0.8 + k);
    ctx.strokeStyle = css(mix(pal.skyLow, pal.sun, 0.4), a);
    ctx.beginPath();
    let first = true;
    for (let x = 0; x <= 1920; x += 24) {
      const v = lfbm(L, x / 300 + t * 0.12 + k * 3.1, k * 0.7 + t * 0.05, 2);
      if (v < 0.48) { first = true; continue; }
      const y = yk + 2.5 * Math.sin(x * 0.01 + t + k);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // the sun's glitter path
  const streak = sp.streak(pal.sun);
  const sy = Math.min(P.sunY, HZ);
  for (let i = 0; i < 240; i++) {
    const y = HZ + 3 + (hashU(71, i, 1) ** 1.35) * (bottom - HZ - 10);
    const dd = (y - HZ) / (bottom - HZ);
    const spread = 40 + dd * 330 + (sy < HZ ? (HZ - sy) * 0.2 : 0);
    const gx = (hashU(71, i, 2) + hashU(71, i, 3) + hashU(71, i, 4) - 1.5) / 1.5;
    const x = 960 + gx * spread + 6 * Math.sin(t * 1.3 + i);
    const tw = Math.max(0, Math.sin(t * (2 + hashU(71, i, 5) * 4) + hashU(71, i, 6) * TAU)) ** 5;
    const a = tw * (1 - Math.abs(gx) * 0.6) * (1 - 0.5 * dusk) * (0.6 + 0.4 * (F.c.hat || 0));
    if (a < 0.03) continue;
    const w = 10 + dd * 40;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(streak, x - w / 2, y - 1.6 - dd * 1.5, w, 3.2 + dd * 3);
  }
  ctx.globalAlpha = 1;
  // drifting mist over the water
  for (let k = 0; k < 4; k++) {
    const y = HZ + 12 + k * 26;
    const x = ((t * (6 + k * 3) + k * 500) % 2600) - 340;
    ctx.globalAlpha = 0.16;
    ctx.drawImage(sp.glow(mix(pal.skyMid, pal.skyLow, 0.6)), x - 600, y - 18, 1200, 36);
    ctx.drawImage(sp.glow(mix(pal.skyMid, pal.skyLow, 0.6)), x + 700, y - 14, 1000, 28);
  }
  ctx.globalAlpha = 1;
  // a warm haze band gluing the horizon
  const hz = ctx.createLinearGradient(0, HZ - 70, 0, HZ + 80);
  hz.addColorStop(0, css(pal.skyLow, 0)); hz.addColorStop(0.47, css(pal.skyLow, 0.32 * (1 - 0.5 * dusk))); hz.addColorStop(1, css(pal.skyLow, 0));
  ctx.fillStyle = hz; ctx.fillRect(0, HZ - 70, 1920, 150);
  ctx.restore();
}

/** Paper lanterns set afloat from each lit house, drifting out over the water toward us. */
function drawLanterns(g, t, F, T, pal, HZ) {
  const ctx = g.ctx, sp = g.sprites, css = g.color.css;
  const n = Math.min(HOUSE_SITES.length, T.houses.length);
  const glow = sp.glow(pal.window);
  ctx.save();
  for (let i = 0; i < n; i++) {
    for (let q = 0; q < 2; q++) {
      const tb = T.houses[i] + 0.9 + q * 3.1;
      const age = t - tb;
      if (age <= 0) continue;
      const site = HOUSE_SITES[i];
      const depth = 1 - Math.exp(-age / (10 + 4 * hashU(81, i, q)));
      const y = HZ + 8 + depth * (180 + 60 * hashU(82, i, q));
      const x = site.x + (960 - site.x) * 0.25 * depth + (q ? 30 : -20) * site.s + 14 * Math.sin(age * 0.5 + i + q);
      const k = 0.5 + depth * 1.25;                       // perspective: nearer is bigger
      const bob = 1.5 * k * Math.sin(TAU * (F.c.beat_phase || 0) + i);
      const a = cl(age / 0.6);
      const flick = 0.85 + 0.15 * Math.sin(t * 9 + i * 2 + q);
      // reflection streak on the water
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.45 * a * flick;
      ctx.drawImage(glow, x - 8 * k, y - 2, 16 * k, 46 * k);
      ctx.globalAlpha = 0.8 * a * flick;
      ctx.drawImage(glow, x - 26 * k, y - 34 * k + bob, 52 * k, 52 * k);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      ctx.fillStyle = css(pal.window, 0.95);
      ctx.beginPath(); ctx.roundRect(x - 6 * k, y - 15 * k + bob, 12 * k, 13 * k, 3 * k); ctx.fill();
      ctx.fillStyle = pal.roofShade;
      ctx.fillRect(x - 7 * k, y - 3 * k + bob, 14 * k, 2.5 * k);
    }
  }
  ctx.restore();
}

/** Expanding elliptical ripple rings on the water. */
function ring(ctx, css, col, x, y, r, a, w = 2.2) {
  if (a <= 0.005 || r <= 0) return;
  ctx.strokeStyle = css(col, a);
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.16, 0, 0, TAU); ctx.stroke();
}

function drawArrival(g, t, F, T, pal, st) {
  const ctx = g.ctx, css = g.color.css, sp = g.sprites;
  const a = t - T.t0;
  if (a > 3.2) return;
  const xs = XE + GAP_WALK * SCW / SC / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // the gold light still glowing under the water where they burst out
  const gl = Math.exp(-a / 0.55);
  if (gl > 0.01) {
    ctx.globalAlpha = 0.9 * gl;
    const r = 520 + 500 * a;
    ctx.drawImage(sp.glow(pal.sunGlow, 1), xs - r, YW0 - r * 0.6, 2 * r, 1.2 * r);
  }
  // a column of gold light and a crown of spray thrown up with them
  const col = a < 0.9 ? Math.sin(Math.PI * cl(a / 0.9)) * Math.exp(-a / 0.6) : 0;
  if (col > 0.01) {
    ctx.globalAlpha = 0.85 * col;
    ctx.drawImage(sp.glow(pal.sunGlow, 1), xs - 110, YW0 - 560, 220, 640);
    ctx.drawImage(sp.glow(pal.seed, 1), xs - 45, YW0 - 420, 90, 470);
  }
  const crown = a < 1.1 ? outCubic(a / 0.22) * (1 - cl((a - 0.22) / 0.88) ** 2) : 0;
  if (crown > 0.01) {
    ctx.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const ang = -Math.PI / 2 + (hashU(37, i, 1) - 0.5) * 2.1;
      const L = (140 + 260 * hashU(37, i, 2)) * crown * (1 - 0.45 * Math.abs(Math.sin(ang + Math.PI / 2)));
      const bx = xs + (hashU(37, i, 3) - 0.5) * 150;
      const tx = bx + Math.cos(ang) * L, ty = YW0 + Math.sin(ang) * L + 120 * a * a;
      ctx.strokeStyle = css(pal.seed, 0.6 * cl(1 - a / 1.1));
      ctx.lineWidth = 3 + 5 * hashU(37, i, 4) * (1 - a);
      ctx.beginPath(); ctx.moveTo(bx, YW0);
      ctx.quadraticCurveTo(bx + Math.cos(ang) * L * 0.5, YW0 + Math.sin(ang) * L * 0.7, tx, ty);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // splash rings: the burst, the landing, and the wake while wading
  for (let k = 0; k < 4; k++) {
    const age = a - k * 0.16;
    if (age < 0) continue;
    ring(ctx, css, pal.seed, xs, YW0, 30 + 420 * outCubic(age / 2.6), 0.75 * cl(1 - age / 2.6), 3 - k * 0.4);
  }
  for (let k = 0; k < 2; k++) {
    const age = a - 0.8 - k * 0.2;
    if (age < 0) continue;
    ring(ctx, css, pal.seed, xs, YW0, 20 + 240 * outCubic(age / 2), 0.6 * cl(1 - age / 2), 2.2);
  }
  if (st && st.kit.water !== null && st.kit.water !== undefined && t >= T.wade) {
    for (const fig of [st.kit, st.june]) {
      for (let k = 0; k < 3; k++) {
        const age = ((t - T.wade) / 0.5 + k / 3) % 1;
        ring(ctx, css, pal.seed, fig.x, fig.water, 14 + 70 * age * fig.scale, 0.5 * (1 - age), 1.8);
      }
    }
  }
  // droplets thrown up by the burst and the landing (closed-form ballistic)
  const bursts = [[0, 220, 1], [0.8, 80, 0.55]];
  for (const [tb, n, k] of bursts) {
    const age = a - tb;
    if (age < 0 || age > 1.6) continue;
    for (let i = 0; i < n; i++) {
      const vx = (hashU(31, i, tb * 10 + 1) - 0.5) * 520 * k;
      const vy = -(360 + hashU(31, i, tb * 10 + 2) * 900) * k;
      const x = xs + (hashU(31, i, tb * 10 + 3) - 0.5) * 90 + vx * age;
      const y = YW0 + vy * age + 0.5 * 1350 * age * age;
      if (y > YW0 + 6 && age > 0.1) continue;
      const r = (2.5 + hashU(31, i, tb * 10 + 4) * 6) * (1 - age * 0.4);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(sp.glow(pal.seed, 1), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
    }
  }
  ctx.restore();
}

/** Draw a figure that may be standing in water: clipped at the water line, with a soft reflection. */
function drawFigure(g, st, pal, { reflect = true } = {}) {
  const ctx = g.ctx;
  const opts = { ...placeOf(st), devScale: g.scale };
  if (st.water !== null && st.water !== undefined) {
    const yw = st.water;
    if (reflect) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, yw, 1920, 400); ctx.clip();
      ctx.translate(0, 2 * yw); ctx.scale(1, -1);
      drawPuppet(ctx, st.d, st.pose, { ...opts, alpha: 0.32 });
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, 1920, yw); ctx.clip();
    drawPuppet(ctx, st.d, st.pose, opts);
    ctx.restore();
    // a bright line where the water meets the body
    const j = solve(st.d, st.pose, opts);
    const xs = [j.pelvis[0], j.ankleL[0], j.ankleR[0]];
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = g.color.css(pal.seed, 0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse((Math.min(...xs) + Math.max(...xs)) / 2, yw, 22 * st.scale + (Math.max(...xs) - Math.min(...xs)) / 2, 4, 0, 0, TAU); ctx.stroke();
    ctx.restore();
    return;
  }
  drawPuppet(ctx, st.d, st.pose, opts);
}

function shadowAndHalo(g, st, pal) {
  const ctx = g.ctx, css = g.color.css, sp = g.sprites;
  const j = solve(st.d, st.pose, placeOf(st));
  const U = j.U;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.3;
  const r = 0.75 * U;
  ctx.drawImage(sp.glow(pal.sunGlow), j.neck[0] - r, j.neck[1] - r, 2 * r, 2 * r);
  ctx.restore();
  if (st.water === null || st.water === undefined) {
    const fy = Math.max(j.feetY, GY - 4);
    const gr = ctx.createRadialGradient(j.pelvis[0], fy + 8, 0, j.pelvis[0], fy + 8, 0.36 * U);
    gr.addColorStop(0, css(pal.shore, 0.5)); gr.addColorStop(1, css(pal.shore, 0));
    ctx.save(); ctx.translate(0, fy + 8); ctx.scale(1, 0.2); ctx.translate(0, -(fy + 8));
    ctx.fillStyle = gr; ctx.fillRect(j.pelvis[0] - 0.4 * U, fy + 8 - 0.4 * U, 0.8 * U, 0.8 * U);
    ctx.restore();
  }
}

function drawRock(g, x, pal) {
  const ctx = g.ctx, css = g.color.css;
  const U = KIT.teen.height * SC;
  const top = GY - 0.235 * U - 4;
  const w = 130, base = GY + 14;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - w * 0.62, base);
  ctx.bezierCurveTo(x - w * 0.66, top + 26, x - w * 0.38, top - 4, x - 4, top - 2);
  ctx.bezierCurveTo(x + w * 0.35, top - 3, x + w * 0.62, top + 18, x + w * 0.64, base);
  ctx.closePath();
  const gr = ctx.createLinearGradient(0, top, 0, base);
  gr.addColorStop(0, g.color.mix(pal.meadow, pal.skyLow, 0.35)); gr.addColorStop(0.3, g.color.mix(pal.shore, pal.meadow, 0.45)); gr.addColorStop(1, g.color.mix(pal.shore, '#000000', 0.25));
  ctx.fillStyle = gr; ctx.fill();
  ctx.strokeStyle = css(pal.skyLow, 0.55); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x - w * 0.5, top + 14); ctx.bezierCurveTo(x - w * 0.3, top - 2, x + w * 0.2, top - 4, x + w * 0.5, top + 10); ctx.stroke();
  ctx.fillStyle = css(pal.stem, 0.7);
  ctx.beginPath(); ctx.ellipse(x - w * 0.2, top + 5, 22, 5, -0.1, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawStems(g, t, F, pal, list, gust, bald) {
  const ctx = g.ctx, ds = g.scale;
  const bp = F.c.beat_phase || 0;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = list.back ? pal.stemBack : pal.stemFront;
  const heads = [];
  // stems batched by width
  const widths = new Map();
  for (const s of list.items) {
    const ang = stemAngle(s, bp, t, gust);
    const [hx, hy] = stemHead(s, ang);
    heads.push([s, hx, hy, ang]);
    const w = Math.round(s.w * 2) / 2;
    if (!widths.has(w)) widths.set(w, []);
    widths.get(w).push([s, hx, hy, ang]);
  }
  for (const [w, arr] of widths) {
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const [s, hx, hy, ang] of arr) {
      ctx.moveTo(s.x, s.yb);
      ctx.quadraticCurveTo(s.x + Math.sin(ang * 0.35) * s.h * 0.5, s.yb - s.h * 0.55, hx, hy);
    }
    ctx.stroke();
  }
  // a few leaves at the base of the front stems
  if (!list.back) {
    ctx.fillStyle = pal.stemFront;
    ctx.beginPath();
    for (const s of list.items) {
      for (const side of [-1, 1]) {
        const lx = s.x + side * 16, ly = s.yb - 4;
        ctx.moveTo(s.x, s.yb);
        ctx.quadraticCurveTo(lx, ly - 14, s.x + side * 30, ly - 22 - 6 * Math.sin(t + s.i));
        ctx.quadraticCurveTo(lx * 0.5 + s.x * 0.5, ly - 2, s.x, s.yb);
      }
    }
    ctx.fill();
  }
  // seed puffs (backlit)
  for (const [s, hx, hy] of heads) {
    const b = bald.get(s.i) || 0;
    const k = b > 0.7 ? 3 : b > 0.45 ? 2 : b > 0.2 ? 1 : 0;
    const spr = puffSprite(g, pal.seed, pal.skyLow, k, s.r * 2.6 * ds > 40 ? 112 : 48);
    const r = s.r * 1.3;
    ctx.drawImage(spr, hx - r, hy - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the frame
export function draw(g, t, F, P, S) {
  const ctx = g.ctx, css = g.color.css, sp = g.sprites, ds = g.scale;
  const pal = palette(S, g);
  const T = timing(F, P, S);
  const HZ = P.horizon;
  const bottom = 912;

  // ---- the world above the horizon, into a layer (mirrored below)
  const L = g.layer('goldlake-above');
  drawAbove({ ...g, ctx: L.ctx }, t, F, P, S, T, pal, HZ);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const hDev = Math.round(HZ * ds);
  ctx.drawImage(L.canvas, 0, 0, g.devW, hDev, 0, 0, g.devW, hDev);
  ctx.restore();
  drawReflection(g, L, t, F, P, HZ, bottom);
  drawLake(g, t, F, P, T, pal, HZ, bottom);

  const st = coupleAt(t, F, T);
  const inWater = st.kit.water !== null && st.kit.water !== undefined;

  drawLanterns(g, t, F, T, pal, HZ);

  // ---- arrival: splash, gold light, droplets; the couple in the water
  drawArrival(g, t, F, T, pal, st);
  if (inWater) {
    drawFigure(g, st.june, pal);
    drawFigure(g, st.kit, pal);
  }

  // ---- reeds at the water's edges
  {
    ctx.save();
    ctx.strokeStyle = pal.shore; ctx.lineCap = 'round';
    ctx.fillStyle = g.color.mix(pal.shore, pal.meadow, 0.3);
    for (let i = 0; i < 46; i++) {
      const left = i < 23;
      const x = left ? hashU(17, i, 1) * 210 - 10 : 1930 - hashU(17, i, 1) * 230;
      const yb = bankY(x) + 6;
      const h = 70 + hashU(17, i, 2) * 150;
      const ang = (left ? 0.05 : -0.05) + 0.05 * Math.sin(t * 0.9 + i) + 0.03 * Math.sin(TAU * (F.c.beat_phase || 0) - x * 0.005);
      const hx = x + Math.sin(ang) * h, hy = yb - Math.cos(ang) * h;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x, yb); ctx.quadraticCurveTo(x, yb - h * 0.5, hx, hy); ctx.stroke();
      if (hashU(17, i, 3) < 0.45) {
        ctx.save(); ctx.translate(hx - Math.sin(ang) * 18, hy + Math.cos(ang) * 18); ctx.rotate(ang);
        ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 14, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // ---- the near bank
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bankLayer(g, pal), 0, 0); ctx.restore();

  // the meadow's gust when June blows away
  const gust = Math.max(0, Math.min(1, (t - T.gone - 0.2) / 0.5)) * (1 - sm((t - T.gone - 2.0) / 1.8)) * (t > T.gone ? 1 : 0);

  // kicks: 1-3 neighbouring puffs release a burst of seeds
  const rockX = st.rockX ?? coupleAt(Math.max(T.held, T.settle) + 1e-3, F, T).rockX;
  const stemsAll = stemList(Math.max(0, P.stems | 0), rockX);
  const nFront = stemsAll.front.length;
  const SEED_LIFE = 3.2;
  const kicks = F.between('kick', t - Math.max(SEED_LIFE, 6), t + 0.5 / F.fps);
  const bursts = [];
  const bald = new Map();
  if (nFront > 0) {
    for (const e of kicks) {
      const tk = e[0], s = e[1] ?? 1, sr = e[2] ?? s;
      if (tk < T.t0 || s < P.kickMin) continue;
      const id = Math.round(tk * 1000);
      const nP = s > 0.9 ? 3 : s > 0.72 ? 2 : 1;
      const p0 = Math.floor(hashU(id, 0, 7) * nFront);
      for (let q = 0; q < nP; q++) {
        const stem = stemsAll.front[(p0 + q) % nFront];
        const age = Math.max(0, t - tk);
        bald.set(stem.i, Math.max(bald.get(stem.i) || 0, Math.exp(-age / 2.2)));
        if (age < SEED_LIFE) bursts.push({ stem, tk, id: id * 3 + q, n: 9 + Math.round(9 * cl(sr)), age });
      }
    }
  }

  // back stems, rock, characters, front stems
  drawStems(g, t, F, pal, { back: true, items: stemsAll.backs }, gust, bald);
  drawRock(g, rockX, pal);

  if (!inWater) {
    const figs = [];
    if (st.june && !st.june.frozen) figs.push(st.june);
    figs.push(st.kit);
    for (const f of figs) shadowAndHalo(g, f, pal);
    if (st.june && st.june.frozen) drawDissolvingJune(g, t, F, P, T, pal);
    for (const f of figs) drawFigure(g, f, pal);
  }

  drawStems(g, t, F, pal, { back: false, items: stemsAll.fronts }, gust, bald);

  // ---- seeds in the air
  const spr = seedSprite(g, pal.seed);
  ctx.save();
  // loose seeds drifting across the frame all the time
  const loose = particles({
    seed: 919, t, rate: P.seedRate, life: 14,
    origin: (k, r, r2) => [-260 + r * 1900, 480 + r2 * 620],
    vel: (k, r, r2) => [55 + r * 70 + 0, -14 - r2 * 22],
    swirl: 26, swirlHz: 0.35,
  });
  for (const p of loose) {
    const x = p.x + gust * 260 * (p.r + 0.5) * (t - T.gone);
    const a = Math.sin(Math.PI * p.u) * 0.85;
    if (a < 0.02 || x > 1980) continue;
    ctx.globalAlpha = a;
    const sz = 11 + p.r2 * 9;
    stamp(ctx, ds, spr, x, p.y, sz, sz * 1.25, 0.35 * Math.sin(p.age * 1.7 + p.k), 0.5, 0.38);
  }
  // kick bursts
  for (const b of bursts) {
    const ang0 = stemAngle(b.stem, F.col('beat_phase', b.tk), b.tk, 0);
    const [hx, hy] = stemHead(b.stem, ang0);
    const a = b.age;
    const dv = (1 - Math.exp(-1.7 * a)) / 1.7;
    for (let j = 0; j < b.n; j++) {
      const th = -Math.PI / 2 + (hashU(b.id, j, 1) - 0.5) * 2.8;
      const v = 70 + hashU(b.id, j, 2) * 170;
      const x = hx + Math.cos(th) * v * dv + 38 * a + 26 * a * a + 10 * Math.sin(a * 2.3 + j);
      const y = hy + Math.sin(th) * v * dv - 20 * a - 5 * a * a;
      const al = cl(a / 0.08) * cl((SEED_LIFE - a) / 1.0);
      if (al < 0.02) continue;
      ctx.globalAlpha = al;
      const sz = (10 + hashU(b.id, j, 3) * 8) * (0.6 + 0.4 * cl(a / 0.3));
      stamp(ctx, ds, spr, x, y, sz, sz * 1.25, 0.4 * Math.sin(a * 2 + j), 0.5, 0.38);
    }
  }
  ctx.setTransform(ds, 0, 0, ds, 0, 0);
  ctx.restore();

  // June's seeds blowing away
  if (t >= T.gone && t < T.gone + DIS_PRE + DIS_DUR + 4.5) drawJuneSeeds(g, t, F, P, T, pal);

  // ---- fireflies wandering, twinkling on hats
  {
    const nF = Math.max(0, P.fireflies | 0);
    const lh = F.last('hat', t + 0.5 / F.fps);
    const hid = lh ? Math.round(lh[0] * 1000) : 0;
    const hatImp = F.c.hat || 0;
    const glow = sp.glow(pal.firefly, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < nF; i++) {
      const h1 = hashU(51, i, 1), h2 = hashU(51, i, 2), h3 = hashU(51, i, 3);
      const x = h1 * 1960 - 20 + 90 * Math.sin(t * (0.17 + 0.2 * h2) + h3 * TAU) + 40 * Math.sin(t * 0.53 + i);
      const y = 610 + h2 * 450 + 34 * Math.sin(t * (0.23 + 0.15 * h3) + h1 * TAU);
      const tw = 0.35 + 0.35 * Math.sin(t * (1.5 + 2.5 * h3) + h2 * TAU);
      const flare = hatImp * (hashU(hid, i, 5) < 0.4 ? 1 : 0.15);
      const b = cl(tw + 0.9 * flare);
      if (b < 0.03) continue;
      const r = 7 + 16 * b * (0.6 + 0.6 * h1);
      ctx.globalAlpha = b;
      ctx.drawImage(glow, x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  // ---- out-of-focus motes in the warm air, and a soft light wash from the sun
  {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bk = sp.bokeh(pal.sunGlow, 0.2, 0.3);
    for (let i = 0; i < 16; i++) {
      const r = 26 + hashU(52, i, 1) * 60;
      const x = ((hashU(52, i, 2) * 2200 + t * (6 + 10 * hashU(52, i, 3))) % 2300) - 190;
      const y = 120 + hashU(52, i, 4) * 900 + 30 * Math.sin(t * 0.3 + i);
      ctx.globalAlpha = 0.06 + 0.07 * hashU(52, i, 5);
      ctx.drawImage(bk, x - r, y - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
    const wash = ctx.createRadialGradient(960, Math.min(P.sunY, HZ), 0, 960, Math.min(P.sunY, HZ), 1100);
    wash.addColorStop(0, css(pal.sunGlow, 0.12)); wash.addColorStop(1, css(pal.sunGlow, 0));
    ctx.fillStyle = wash; ctx.fillRect(0, 0, 1920, 1080);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- June dissolving
function drawDissolvingJune(g, t, F, P, T, pal) {
  const ctx = g.ctx, sp = g.sprites;
  const D = dissolveSeeds(F, T, P);
  const st = D.st;
  const prog = (t - T.gone - DIS_PRE) / DIS_DUR;
  if (prog >= 1.02) return;
  const pre = sm((t - T.gone) / DIS_PRE);
  // a glow gathers in her as the wind comes
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.95 * pre * (1 - 0.7 * cl(prog));
  const r = 260;
  ctx.drawImage(sp.glow(pal.sunGlow), D.j.neck[0] - r, D.j.neck[1] - r + 30, 2 * r, 2 * r);
  ctx.globalAlpha = 0.6 * pre * (1 - cl(prog));
  ctx.drawImage(sp.glow(pal.seed, 1), D.j.headC[0] - 110, D.j.headC[1] - 110, 220, 220);
  // a ring of light breathes out from her as the wind takes her
  const ra = t - T.gone;
  if (ra < 1.2) {
    ctx.globalAlpha = 0.5 * (1 - ra / 1.2);
    ctx.strokeStyle = g.color.css(pal.seed, 1);
    ctx.lineWidth = 3 * (1 - ra / 1.2) + 0.5;
    ctx.beginPath(); ctx.arc(D.j.neck[0], D.j.neck[1] + 20, 40 + 260 * outCubic(ra / 1.2), 0, TAU); ctx.stroke();
  }
  ctx.restore();
  // the body that remains: only where seeds have not yet let go
  ctx.save();
  if (prog > 0) {
    ctx.beginPath();
    for (const p of D.pts) {
      if (t >= T.gone + DIS_PRE + DIS_DUR * p.o) continue;
      ctx.moveTo(p.x + 13, p.y);
      ctx.arc(p.x, p.y, 13, 0, TAU);
    }
    ctx.clip();
  }
  drawPuppet(ctx, st.d, st.pose, { ...placeOf(st), devScale: g.scale });
  ctx.restore();
}

function drawJuneSeeds(g, t, F, P, T, pal) {
  const ctx = g.ctx, ds = g.scale, sp = g.sprites;
  const D = dissolveSeeds(F, T, P);
  const spr = seedSprite(g, pal.seed);
  const glow = sp.glow(pal.sunGlow), spark = sp.glow(pal.seed, 1);
  const live = [];
  for (const p of D.pts) {
    const td = T.gone + DIS_PRE + DIS_DUR * p.o;
    const a = t - td;
    if (a < -0.18) continue;
    if (a < 0) { live.push([p, a, p.x, p.y]); continue; }
    const x = p.x + p.vx * a + 0.5 * p.ax * a * a + 14 * Math.sin(a * 2.1 + p.ph);
    const y = p.y + p.vy * a + 0.5 * p.ay * a * a + 9 * Math.cos(a * 1.7 + p.ph);
    if (x > 2000 || y < -60) continue;
    live.push([p, a, x, y]);
  }
  ctx.save();
  // warm light around every seed as it lets go, and sparks along the dissolving edge
  ctx.globalCompositeOperation = 'screen';
  for (const [p, a, x, y] of live) {
    if (a < 0) {
      ctx.globalAlpha = 1 + a / 0.18;
      ctx.drawImage(spark, x - 13, y - 13, 26, 26);
      continue;
    }
    const k = cl(1 - a / 2.2);
    if (k <= 0.02) continue;
    ctx.globalAlpha = 0.55 * k;
    const r = 16 + 10 * k;
    ctx.drawImage(glow, x - r, y - r, 2 * r, 2 * r);
  }
  ctx.globalCompositeOperation = 'source-over';
  // a fleck of June's colour that blooms into a white seed
  for (const [p, a, x, y] of live) {
    if (a < 0) continue;
    const ck = cl(1 - a / 0.8);
    if (ck > 0.02) {
      ctx.setTransform(ds, 0, 0, ds, 0, 0);
      ctx.globalAlpha = ck;
      ctx.fillStyle = p.warm;
      ctx.beginPath(); ctx.arc(x, y, 1.8 + 2.2 * ck, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = cl(a / 0.2);
    const sz = (p.sz + 9) * (0.4 + 0.6 * cl(a / 0.45));
    stamp(ctx, ds, spr, x, y, sz, sz * 1.25, 0.25 + 0.35 * Math.sin(a * 2.4 + p.ph), 0.5, 0.38);
  }
  ctx.setTransform(ds, 0, 0, ds, 0, 0);
  ctx.restore();
}
