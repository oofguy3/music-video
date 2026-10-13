// D1 THE KALEIDOSCOPE STORM: the one big trip of the film (the final chorus).
//
// The previous world's sky shatters into a kaleidoscope of every world in the film: a melting colour
// field in the film's palette with its motifs (kites with ribbon tails, dandelion seeds, the banded
// moon, the spiral sun, waves of milk, gold rays) flowing out of the centre, mirrored into 8 wedges
// (12 after the loudest moment) that jump on every downbeat. In front of it a huge crowd of
// silhouettes jumps in unison on every beat, with Kit in colour at the front, arms up; stage beams
// sweep and flick on every hit, and a kite streaks across the frame on every snare. On the numb chords
// the kaleidoscope melts and drains to milk while time brakes (a freeze clock drives every phase) and
// the crowd hangs frozen at the top of the jump; when the window ends everything slams back on the beat.
//
// Pure: every phase comes from t, F (columns and events) and P; caches are pure functions of their key.

import { KIT, crowdDesign } from './lib/cast.mjs';
import { kaleido, melt, echo } from './lib/fx.mjs';
import { blend, cycles, drawPuppet, puppetSprite } from './lib/puppet.mjs';
import { drawField, field, hashU, particles, rays } from './lib/worldkit.mjs';

const TAU = Math.PI * 2;

export const meta = { type: 'storm', budgetMs: 200 };

/** Fallback colours (the treatment's palette overrides them). */
export const DEFAULT = {
  plum: '#2A0E3F', rose: '#E0478B', gold: '#FFC857', milk: '#EDE6FA', teal: '#5EC8D8',
  violet: '#7B3FA0', peach: '#FFB38A', crowd: '#1E1633', beam: '#FFF1C9',
};

export const defaults = {
  loudest: null,          // time (s) of the loudest moment; null = F.ev.loudest
  shatterFrom: 'goldlake',// timeline entry whose last frame shatters at the start ('' = a painted gold sky)
  shatterX: 960,          // where the cracks start (the previous scene's sun)
  shatterY: 560,
  shatterDur: 0.45,       // seconds the shards fly
  openDur: 1.1,           // seconds the kaleidoscope takes to open
  wedges: 8,
  wedgesLoud: 12,
  jumpDeg: 15,            // kaleidoscope jump per downbeat (degrees)
  jumpEase: 0.15,         // seconds
  spin: 0.07,             // slow kaleidoscope rotation (rad/s)
  zoom: 1.4,              // kaleidoscope magnification of the source
  kcy: 430,               // kaleidoscope centre height
  cycleBar: 0.02,         // colour-field palette offset per bar
  warp: 1.6,
  freeze: 0.95,           // how hard the numb windows brake time
  meltPx: 220,
  drain: 0.55,            // milk drain in a numb window
  drainFinal: 0.86,       // milk drain in the last numb window (frozen until the cut)
  crowdCount: 440,
  jumpLead: 0.16,         // beat-phase lead so the push-off lands on the beat
  jumpKeys: 12,
  beams: 6,
  kiteDur: 0.85,          // seconds a snare kite takes to cross the frame
  srcRes: 0.6,
  phraseBars: 4,          // bars per kaleidoscope world and per camera framing
  push: 0.08,             // camera push-in per phrase            // resolution of the kaleidoscope source layer (fraction of device size)
};

// ---------------------------------------------------------------- helpers

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const outExpo = (u) => { u = clamp(u); return u >= 1 ? 1 : 1 - 2 ** (-10 * u); };
const outCubic = (u) => 1 - (1 - clamp(u)) ** 3;
const frac = (x) => x - Math.floor(x);
/** An event's landing time: the frame its sound starts on (the engine's timing rule). */
const land = (x, F) => Math.floor(x * (F.fps || 30) + 0.5) / (F.fps || 30);

function palette(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(DEFAULT)) o[k] = p[k] || DEFAULT[k];
  return o;
}

/** Numb windows overlapping the entry, as [t0, t1]. */
function numbWindows(F, S) {
  const l = (F.ev && Array.isArray(F.ev.numb)) ? F.ev.numb : [];
  const out = [];
  for (const e of l) if (land(e[1], F) > S.t0 && e[0] < S.t1) out.push([Math.max(S.t0, land(e[0], F)), land(e[1], F)]);
  return out;
}

/**
 * Freeze clocks. tauC(t): cumulative clock that brakes inside the numb windows (continuous flows use
 * it). win: the window containing t (or null), with the local clock tl (beat-locked phases brake inside
 * the window and snap back to real time when it ends).
 */
function clocks(F, S, P, t) {
  const W = numbWindows(F, S);
  const k = P.freeze;
  const tauC = (x) => {
    let v = x;
    for (const [a, b] of W) if (x > a) v -= k * F.integral('numb', a, Math.min(x, b));
    return v;
  };
  let win = null;
  for (const [a, b] of W) if (t >= a && t < b) win = { a, b, final: b >= S.t1 - 0.1 };
  const tl = win ? t - k * F.integral('numb', win.a, t) : t;
  const nb = win ? clamp(F.c.numb) : 0;
  const inWin = (x) => W.some(([a, b]) => x >= a && x < b - 0.05);
  const lastEnd = W.filter(([, b]) => b <= t).reduce((m, [, b]) => Math.max(m, b), -Infinity);
  return { W, tauC, tC: tauC(t), win, tl, nb, inWin, lastEnd };
}

// ---------------------------------------------------------------- cached sprites and layers

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) { v = make(); if (cache.size > 400) cache.delete(cache.keys().next().value); cache.set(key, v); }
  return v;
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A soft light cone (beam) pointing along +x: narrow at x = 0, wide and faded at the far end. */
function coneSprite(g, hex) {
  return cached(`cone|${hex}`, () => {
    const w = 512, h = 96;
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    const img = x.createImageData(w, h);
    const [r, gg, b] = hexRgb(hex);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const u = i / (w - 1);
        const half = 0.06 + 0.94 * u;
        const d = Math.abs(j - (h - 1) / 2) / ((h - 1) / 2) / half;
        const core = Math.exp(-d * d * 3.2);
        const a = core * Math.pow(1 - u, 1.15) * Math.min(1, u * 14) * (0.75 + 0.25 * Math.exp(-d * d * 18));
        const o = (j * w + i) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = Math.round(255 * clamp(a));
      }
    }
    x.putImageData(img, 0, 0);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** A dandelion seed (pappus): fine filaments radiating from a bright core, with a soft halo. */
function seedSprite(g, hex) {
  return cached(`seed|${hex}|${g.scale}`, () => {
    const s = Math.max(16, Math.round(96 * Math.max(0.5, g.scale)));
    const c = g.createCanvas(s, s);
    const x = c.getContext('2d');
    const m = s / 2;
    const halo = x.createRadialGradient(m, m, 0, m, m, m);
    halo.addColorStop(0, 'rgba(255,255,255,0.55)');
    halo.addColorStop(0.25, 'rgba(255,255,255,0.18)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = halo;
    x.fillRect(0, 0, s, s);
    x.strokeStyle = hex;
    x.fillStyle = hex;
    x.lineCap = 'round';
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.2 * Math.sin(i * 2.3);
      const L = m * (0.62 + 0.18 * Math.sin(i * 1.7));
      x.globalAlpha = 0.85;
      x.lineWidth = Math.max(0.6, s / 120);
      x.beginPath();
      x.moveTo(m, m);
      x.lineTo(m + Math.cos(a) * L, m + Math.sin(a) * L);
      x.stroke();
      x.beginPath();
      x.arc(m + Math.cos(a) * L, m + Math.sin(a) * L, Math.max(0.8, s / 70), 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    x.beginPath();
    x.arc(m, m, s / 22, 0, TAU);
    x.fill();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** The reusable kaleidoscope source canvas (whole logical frame at srcRes x device size). */
function sourceCanvas(g, q) {
  const w = Math.max(64, Math.round(g.devW * q)), h = Math.max(36, Math.round(g.devH * q));
  return cached(`src|${w}x${h}`, () => {
    const c = g.createCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d'), k: w / g.W };
  });
}

/** Painted fallback for the shatter when no previous entry is available: a golden sky with a sun. */
function goldSky(g, pal) {
  return cached(`goldsky|${g.devW}|${pal.gold}|${pal.peach}|${pal.rose}`, () => {
    const c = g.createCanvas(g.devW, g.devH);
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    const gr = x.createLinearGradient(0, 0, 0, g.H);
    gr.addColorStop(0, pal.violet); gr.addColorStop(0.35, pal.rose); gr.addColorStop(0.55, pal.peach); gr.addColorStop(1, pal.plum);
    x.fillStyle = gr; x.fillRect(0, 0, g.W, g.H);
    const sg = x.createRadialGradient(960, 560, 0, 960, 560, 520);
    sg.addColorStop(0, '#FFF6D6'); sg.addColorStop(0.3, pal.gold); sg.addColorStop(1, 'rgba(255,200,87,0)');
    x.fillStyle = sg; x.fillRect(0, 0, g.W, g.H);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** Glass shards: a jittered grid split into triangles, each with a flight direction (cached). */
function shardLayout(seed, ox, oy) {
  return cached(`shards|${seed}|${ox}|${oy}`, () => {
    const cols = 12, rows = 7, W = 1920, H = 1080;
    const P = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const ex = i === 0 || i === cols, ey = j === 0 || j === rows;
        const jx = ex ? 0 : (hashU(seed, i * 31 + j, 1) - 0.5) * 0.8;
        const jy = ey ? 0 : (hashU(seed, i * 31 + j, 2) - 0.5) * 0.8;
        P.push([((i + jx) / cols) * W, ((j + jy) / rows) * H]);
      }
    }
    const at = (i, j) => P[j * (cols + 1) + i];
    const out = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        const tris = hashU(seed, i, j + 50) < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const pts of tris) {
          const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
          const dx = cx - ox, dy = cy - oy, dist = Math.hypot(dx, dy) || 1;
          const n = out.length;
          out.push({
            pts, cx, cy, dist,
            ux: dx / dist, uy: dy / dist,
            speed: 700 + 2300 * (dist / 1100) + 600 * hashU(seed, n, 3),
            spin: (hashU(seed, n, 4) - 0.5) * 9,
            grow: 0.8 + 2.4 * hashU(seed, n, 5),
            delay: (dist / 1100) * 0.09,
          });
        }
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------- motifs

/** A diamond kite pointing along `ang` (direction of travel), two-tone, with spars and a bow. */
function drawKite(ctx, x, y, size, ang, colA, colB, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2);          // local -y is the nose
  const s = size;
  const top = [0, -s], right = [0.62 * s, -0.22 * s], bot = [0, 1.1 * s], left = [-0.62 * s, -0.22 * s];
  ctx.fillStyle = colA;
  ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...right); ctx.lineTo(...bot); ctx.closePath(); ctx.fill();
  ctx.fillStyle = colB;
  ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...left); ctx.lineTo(...bot); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = ink;
  ctx.globalAlpha *= 0.55;
  ctx.lineWidth = Math.max(0.8, s * 0.045);
  ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...bot); ctx.moveTo(...left); ctx.lineTo(...right); ctx.stroke();
  ctx.restore();
}

/** A ribbon tail through pts (head first), tapering, with little bows. */
function drawTail(ctx, pts, width, colA, colB, bows = true) {
  const n = pts.length;
  ctx.lineCap = 'round';
  for (let i = 1; i < n; i++) {
    const u = i / (n - 1);
    ctx.strokeStyle = i % 4 < 2 ? colA : colB;
    ctx.lineWidth = Math.max(0.6, width * (1 - 0.75 * u));
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
    ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  if (!bows) return;
  ctx.fillStyle = colB;
  for (let i = 5; i < n - 1; i += 6) {
    const [x, y] = pts[i];
    const w = width * 1.1 * (1 - 0.6 * i / n);
    ctx.beginPath();
    ctx.moveTo(x - w, y - w * 0.6); ctx.lineTo(x + w, y + w * 0.6); ctx.lineTo(x + w, y - w * 0.6); ctx.lineTo(x - w, y + w * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

/** The banded moon: a pale disc in soft stripes, a crescent shadow and a halo. */
function drawMoon(g, ctx, x, y, R, pal, tC, alpha) {
  const glow = g.sprites.glow(pal.milk);
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(glow, x - R * 2.6, y - R * 2.6, R * 5.2, R * 5.2);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.clip();
  ctx.fillStyle = pal.milk; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
  const bands = [pal.violet, pal.teal, pal.rose, pal.peach, pal.teal, pal.violet];
  const bw = (2 * R) / 7.5;
  const off = frac(tC * 0.15) * bw * 2;
  for (let i = -1; i < 8; i++) {
    ctx.fillStyle = bands[(i + 6) % bands.length];
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillRect(x - R, y - R + i * bw * 1.1 + off * 0.5, 2 * R, bw * 0.45);
  }
  // a soft violet terminator, not a grey shadow
  const sh = ctx.createRadialGradient(x + R * 0.9, y - R * 0.2, R * 0.2, x + R * 0.9, y - R * 0.2, R * 1.3);
  sh.addColorStop(0, g.color.css(pal.violet, 0.55));
  sh.addColorStop(1, g.color.css(pal.violet, 0));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = sh;
  ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
  ctx.restore();
}

/** The spiral sun: a gold disc with turning spiral arms and a big glow. */
function drawSun(g, ctx, x, y, R, pal, tC, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha * 0.7;
  const gl = g.sprites.glow(pal.gold);
  ctx.drawImage(gl, x - R * 3.2, y - R * 3.2, R * 6.4, R * 6.4);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, '#FFF8DC'); gr.addColorStop(0.55, pal.gold); gr.addColorStop(1, pal.peach);
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = pal.rose;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.8, R * 0.09);
  ctx.globalAlpha = alpha * 0.75;
  const rot = tC * 1.3;
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const u = i / 18;
      const a = rot + arm * (TAU / 4) + u * 3.4;
      const r = R * (0.08 + 0.85 * u);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // short flame rays around the rim
  ctx.strokeStyle = pal.gold;
  ctx.globalAlpha = alpha * 0.8;
  ctx.lineWidth = Math.max(0.8, R * 0.07);
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = -rot * 0.5 + (i / 14) * TAU;
    ctx.moveTo(x + Math.cos(a) * R * 1.12, y + Math.sin(a) * R * 1.12);
    ctx.lineTo(x + Math.cos(a) * R * 1.42, y + Math.sin(a) * R * 1.42);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- phrases and worlds

/**
 * The kaleidoscope cycles through the film's worlds, one per phrase, so the trip is "every world in
 * the film": the gold lake it breaks out of, the violet dusk, the milk sea, the deep gold light.
 * After the loudest moment it holds the whole palette at once. Six stops each (first = last, so the
 * colour cycle wraps seamlessly).
 */
const WORLDS = {
  gold: (p) => [p.plum, p.rose, p.peach, p.gold, p.peach, p.plum],
  dusk: (p) => [p.plum, p.violet, p.rose, p.peach, p.violet, p.plum],
  milk: (p) => [p.violet, p.teal, p.milk, p.peach, p.teal, p.violet],
  deep: (p) => [p.plum, p.violet, p.teal, p.gold, p.violet, p.plum],
  all: (p) => [p.plum, p.violet, p.rose, p.gold, p.peach, p.plum],
};
const WORLD_ORDER = ['gold', 'dusk', 'milk', 'deep'];

/** Bar and phrase position from the downbeats (falls back to the beat grid). */
function phraseInfo(F, S, P, t) {
  const db = (F.ev && F.ev.downbeats) || [];
  const barS = 4 * (F.beatS || 0.5);
  let lo = 0, hi = db.length;
  while (lo < hi) { const md = (lo + hi) >> 1; if (db[md] < S.t0 - 0.02) lo = md + 1; else hi = md; }
  const first = lo;
  lo = first; hi = db.length;
  while (lo < hi) { const md = (lo + hi) >> 1; if (land(db[md], F) <= t + 1e-6) lo = md + 1; else hi = md; }
  const bar = Math.max(0, lo - 1 - first);
  const pb = Math.max(1, Math.round(P.phraseBars));
  const phrase = Math.floor(bar / pb);
  const i0 = first + phrase * pb;
  const start = i0 < db.length ? land(db[i0], F) : S.t0 + phrase * pb * barS;
  const end = i0 + pb < db.length ? land(db[i0 + pb], F) : start + pb * barS;
  return { bar, phrase, start, len: Math.max(0.1, end - start) };
}

function worldStops(g, t, F, S, P, pal, PH, loudT) {
  const pos = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const at = (name) => WORLDS[name](pal);
  let a, b, u;
  if (t >= loudT) {
    const ph = phraseInfo(F, S, P, loudT - 1e-3);
    a = at(WORLD_ORDER[ph.phrase % WORLD_ORDER.length]); b = at('all'); u = smooth((t - loudT) / 0.35);
  } else {
    a = at(WORLD_ORDER[(PH.phrase + WORLD_ORDER.length - 1) % WORLD_ORDER.length]);
    b = at(WORLD_ORDER[PH.phrase % WORLD_ORDER.length]);
    u = PH.phrase === 0 ? 1 : smooth((t - PH.start) / (0.75 * (F.beatS || 0.5)));
  }
  return pos.map((p, i) => [p, u >= 1 ? b[i] : u <= 0 ? a[i] : g.color.mix(a[i], b[i], u)]);
}

/** Camera zoom about a point low in the frame: even phrases push in from wide, odd ones start close. */
function framing(t, F, S, P, K, PH) {
  const u = clamp((K.tC - K.tauC(PH.start)) / PH.len);
  const e = smooth(u);
  const z = PH.phrase % 2 === 0 ? 1 + P.push * e : 1 + P.push * (1.6 - 0.8 * e);
  return { z, px: 960, py: 1010 };
}

function camApply(ctx, cam) {
  if (Math.abs(cam.z - 1) < 1e-4) return;
  ctx.translate(cam.px, cam.py);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.px, -cam.py);
}

// ---------------------------------------------------------------- the kaleidoscope source

const SX = 70, SY = 70;                    // source centre (top-left, so a whole wedge fits on the canvas)

function drawSource(g, src, t, F, P, S, pal, K, wedge, srcR, stops) {
  const sctx = src.ctx;
  const { tC } = K;
  const m = tC - S.t0;                     // the flow clock (brakes in the numb windows)
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalAlpha = 1;
  sctx.globalCompositeOperation = 'source-over';
  sctx.clearRect(0, 0, src.canvas.width, src.canvas.height);
  sctx.setTransform(src.k, 0, 0, src.k, 0, 0);
  const gS = { ...g, ctx: sctx };

  // the bounding box of the sampled wedge
  const bw = srcR + 40, bh = Math.min(srcR, srcR * Math.sin(Math.min(Math.PI / 2, wedge))) + 60;
  const bars = m / (4 * (F.beatS || 0.5));
  const fc = field(gS, {
    key: 'storm', seed: (S.seed % 997) + 5, t: m, w: 176, h: Math.round(176 * bh / bw), stops,
    scale: 2.4, speed: [-0.05, 0.03], warp: P.warp, flow: 0.09, octaves: 3, contrast: 1.7, offset: -0.05,
    cycle: P.cycleBar * bars,
  });
  drawField(gS, fc, { x: SX - 40, y: SY - 40, w: bw, h: bh, quality: 'low' });

  const pos = (r, a) => [SX + r * Math.cos(a * wedge), SY + r * Math.sin(a * wedge)];
  const grow = (age, base = 26, k = 0.82) => base * Math.exp(age * k);

  // gold rays from the centre
  sctx.save();
  sctx.globalCompositeOperation = 'lighter';
  rays(sctx, { cx: SX, cy: SY, n: 28, rot: m * 0.11, spread: 0.07, length: srcR * 1.05, color: g.color.css(pal.gold, 0.22), fade: g.color.css(pal.gold, 0) });
  sctx.restore();

  // waves of milk: wobbling rings born on every beat, flowing outwards
  const beats = (F.ev && F.ev.beats) || [];
  const recentBeats = [];
  {
    let i = beats.length - 1;
    // binary search the last beat <= t
    let lo = 0, hi = beats.length;
    while (lo < hi) { const md = (lo + hi) >> 1; if (land(beats[md], F) <= t + 1e-6) lo = md + 1; else hi = md; }
    i = lo - 1;
    for (; i >= 0 && recentBeats.length < 14; i--) {
      const b = land(beats[i], F);
      if (b < S.t0 - 6) break;
      recentBeats.push([i, b, tC - K.tauC(b)]);
    }
  }
  sctx.save();
  sctx.lineCap = 'round';
  for (const [i, , age] of recentBeats) {
    const r = grow(age, 22, 0.8);
    if (r > srcR + 60) continue;
    const a = clamp(r / 90) * clamp((srcR + 60 - r) / 160);
    sctx.globalAlpha = 0.3 * a;
    sctx.strokeStyle = pal.milk;
    sctx.lineWidth = Math.max(1, r * 0.08);
    sctx.beginPath();
    for (let s = 0; s <= 24; s++) {
      const u = -0.1 + 1.2 * (s / 24);
      const rr = r * (1 + 0.07 * Math.sin(u * TAU * 1.5 + i * 1.7 + m * 1.2));
      const [x, y] = pos(rr, u);
      if (s === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
    }
    sctx.stroke();
  }
  sctx.restore();

  // banded moons and spiral suns, alternating, drifting outwards
  const period = 1.9;
  const n1 = Math.floor(m / period);
  for (let n = n1 - 3; n <= n1; n++) {
    const born = n * period;
    const age = m - born;
    if (age < 0) continue;
    const r = grow(age, 40, 0.62);
    if (r > srcR + 200) continue;
    const a = 0.2 + 0.6 * hashU(S.seed, n, 11);
    const [x, y] = pos(r, a);
    const R = 12 + r * 0.17;
    const al = clamp(r / 120);
    if (((n % 2) + 2) % 2 === 0) drawMoon(gS, sctx, x, y, R, pal, m + n, al);
    else drawSun(gS, sctx, x, y, R * 0.85, pal, m + n * 0.7, al);
  }

  // kites with ribbon tails, one born on every beat
  const kcols = [pal.rose, pal.teal, pal.gold, pal.peach, pal.milk, pal.violet];
  for (const [i, , age] of recentBeats) {
    const r = grow(age, 30, 0.78);
    if (r > srcR + 120) continue;
    const a = 0.08 + 0.84 * hashU(S.seed, i, 21);
    const wob = 0.05 * Math.sin(m * 3.1 + i);
    const [x, y] = pos(r, a + wob);
    const size = 6 + r * 0.075;
    const dirA = (a + wob) * wedge + 0.35 * Math.sin(m * 2.3 + i * 1.3);
    const cA = kcols[i % kcols.length], cB = kcols[(i + 2) % kcols.length];
    const al = clamp(r / 80);
    sctx.save();
    sctx.globalAlpha = al;
    const tail = [];
    for (let k = 0; k <= 12; k++) {
      const rr = r - size * 1.1 - k * size * 0.42;
      if (rr < 4) break;
      tail.push(pos(rr, a + wob + 0.025 * Math.sin(k * 0.9 - m * 7 + i)));
    }
    if (tail.length > 1) drawTail(sctx, tail, size * 0.2, cA, cB, false);
    drawKite(sctx, x, y, size, dirA, cA, cB, pal.plum);
    sctx.restore();
  }

  // dandelion seeds streaming out of the centre
  const seedSpr = seedSprite(g, pal.milk);
  const ps = particles({ seed: S.seed + 7, t: m, rate: 34, life: 4.6, origin: () => [0, 0], vel: () => [0, 0] });
  sctx.save();
  for (const p of ps) {
    const r = grow(p.age, 14 + 20 * p.r2, 0.7 + 0.35 * p.r2);
    if (r > srcR + 30) continue;
    const a = -0.05 + 1.1 * p.r + 0.04 * Math.sin(p.age * 2 + p.k);
    const [x, y] = pos(r, a);
    const sz = 3 + r * 0.03;
    sctx.globalAlpha = clamp(r / 60) * 0.9;
    sctx.drawImage(seedSpr, x - sz, y - sz, 2 * sz, 2 * sz);
  }
  sctx.restore();

  // the heart: a soft bright core where everything is born
  sctx.save();
  sctx.globalCompositeOperation = 'lighter';
  const core = g.sprites.glow(pal.beam);
  const cr = 60 + 40 * F.c.kick * (1 - K.nb);
  sctx.globalAlpha = 0.3;
  sctx.drawImage(core, SX - cr, SY - cr, 2 * cr, 2 * cr);
  sctx.restore();
}

// ---------------------------------------------------------------- crowd

const BUCKETS = [   // depth buckets: sprite scale, tint toward the haze
  { maxK: 0.3, sc: 0.24, haze: 0.62 },
  { maxK: 0.55, sc: 0.45, haze: 0.42 },
  { maxK: 0.95, sc: 0.8, haze: 0.2 },
  { maxK: 99, sc: 1.35, haze: 0.0 },
];

/** Front view: the rig's crouch splays the knees wide; pull the legs in so the jump reads cleanly. */
function narrowLegs(p) {
  return { ...p, hL: p.hL * 0.4, hR: p.hR * 0.4, kL: p.kL * 0.3, kR: p.kR * 0.3, lean: 0, rot: 0 };
}

function jumpPose(u, height, freezeA) {
  const p = cycles.jump(u, height);
  if (freezeA <= 0) return narrowLegs(p);
  return narrowLegs(blend(p, cycles.jump(0.56, height), freezeA));
}

/** A crowd sprite with a warm rim of sky light baked in along its top edge (one stamp per figure). */
function rimSprite(g, body, rim, pose, key, sc) {
  return cached(`rim|${body.id}|${rim.id}|${key}|${sc}|${g.scale}`, () => {
    const b = puppetSprite(g, body, pose, { key, scale: sc, view: 'front' });
    const r = puppetSprite(g, rim, pose, { key, scale: sc, view: 'front' });
    const c = g.createCanvas(b.canvas.width, b.canvas.height);
    const x = c.getContext('2d');
    const off = Math.max(1, Math.round(2.5 * sc * g.scale));
    x.globalAlpha = 0.85;
    x.drawImage(r.canvas, 0, -off);
    x.globalAlpha = 1;
    x.drawImage(b.canvas, 0, 0);
    x.getImageData(0, 0, 1, 1);
    return { canvas: c, w: b.w, h: b.h, ax: b.ax, ay: b.ay };
  });
}

const NEAR_Z = 15;                       // figures nearer than this are stamped every frame
const BAND = [420, 812];                 // logical rows holding the far crowd (and its haze)
const crowdCache = new Map();

function crowdSetup(g, P, S, pal) {
  const seed = (S.seed % 1000) + 3;
  return cached(`crowdsetup|${seed}|${P.crowdCount}|${pal.crowd}|${pal.violet}|${pal.peach}|${pal.rose}`, () => {
    const { world } = g;
    const cam = world.camera({ horizon: 0.57, height: 1.6, focal: 1150 });
    const lay = world.crowdLayout(P.crowdCount, seed, { rows: 13, zNear: 5.2, zFar: 36, cam });
    const figs = [];
    for (const f of lay) {
      const p = world.project(cam, f.X, 0, f.Z);
      if (!p) continue;
      const k = (f.h * p.s) / 262;
      if (p.x < -k * 120 || p.x > 1920 + k * 120) continue;
      const bi = BUCKETS.findIndex((b) => k < b.maxK);
      figs.push({ x: p.x, y: p.y, k, bi, near: f.Z < NEAR_Z, H: f.lean < 0 ? 0.3 : 0.4, off: Math.min(2, Math.floor(f.phase * 3)) - 1 });
    }
    return {
      seed, cam, figs,
      designs: BUCKETS.map((b) => crowdDesign(g.color.mix(pal.crowd, pal.violet, b.haze), 'adult')),
      rim: crowdDesign(g.color.mix(pal.peach, pal.rose, 0.35), 'adult'),
    };
  });
}

/** Stamp one crowd figure for the global jump key q (each figure keeps a fixed -1/0/+1 key offset). */
function stampFigure(g, ctx, C, f, keys, q, qa) {
  const B = BUCKETS[f.bi];
  const fq = (q + f.off + keys) % keys;
  const key = qa >= 1 ? `apex${f.H}` : `j${f.H}|${keys}|${fq}|${qa}`;
  const pose = qa >= 1 ? narrowLegs(cycles.jump(0.56, f.H)) : jumpPose((fq + 0.5) / keys, f.H, qa);
  const sc = f.k / B.sc;
  const spr = f.bi >= 2
    ? rimSprite(g, C.designs[f.bi], C.rim, pose, key, B.sc)
    : puppetSprite(g, C.designs[f.bi], pose, { key, scale: B.sc, view: 'front' });
  ctx.drawImage(spr.canvas, f.x - spr.ax * sc, f.y - spr.ay * sc, spr.w * sc, spr.h * sc);
}

/**
 * The far crowd (hundreds of small figures) for one global jump key, cached as a band layer, with the
 * atmospheric haze that separates it from the near rows. A handful of these cover the whole scene.
 */
function farCrowd(g, P, S, pal, C, keys, q, qa) {
  const ck = `${g.devW}x${g.devH}|${pal.crowd}|${pal.violet}|${pal.peach}|${pal.rose}|${C.seed}|${P.crowdCount}|${keys}|${q}|${qa}`;
  let c = crowdCache.get(ck);
  if (c) return c;
  const bh = BAND[1] - BAND[0];
  c = g.createCanvas(g.devW, Math.max(1, Math.round(bh * g.scale)));
  const ctx = c.getContext('2d');
  ctx.scale(g.scale, g.scale);
  ctx.translate(0, -BAND[0]);
  for (const f of C.figs) if (!f.near) stampFigure(g, ctx, C, f, keys, q, qa);
  const hazeY0 = C.cam.hy - 70;
  const gr = ctx.createLinearGradient(0, hazeY0, 0, hazeY0 + 240);
  gr.addColorStop(0, g.color.css(pal.rose, 0));
  gr.addColorStop(0.35, g.color.css(pal.violet, 0.32));
  gr.addColorStop(1, g.color.css(pal.violet, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(0, hazeY0, 1920, 240);
  ctx.getImageData(0, 0, 1, 1);
  if (crowdCache.size >= 24) crowdCache.delete(crowdCache.keys().next().value);
  crowdCache.set(ck, c);
  return c;
}

function drawCrowd(g, t, F, P, S, pal, K, rise) {
  const { ctx } = g;
  const keys = Math.max(4, Math.round(P.jumpKeys));
  // beat phase on the local freeze clock (brakes in a numb window, real again after it)
  const mt = K.win ? F.col('mt', K.tl) : F.c.mt;
  const freezeA = K.win ? smooth((t - K.win.a) / 0.3) : 0;
  const qa = Math.round(freezeA * 4) / 4;
  const q = qa >= 1 ? 0 : Math.min(keys - 1, Math.floor(frac(mt + P.jumpLead) * keys));
  const C = crowdSetup(g, P, S, pal);
  const band = farCrowd(g, P, S, pal, C, keys, q, qa);
  ctx.save();
  ctx.translate(0, rise);
  ctx.drawImage(band, 0, BAND[0], g.W, BAND[1] - BAND[0]);
  for (const f of C.figs) if (f.near) stampFigure(g, ctx, C, f, keys, q, qa);
  ctx.restore();
  return { mt, freezeA };
}

function drawKit(g, t, F, P, pal, K, rise, mt, freezeA) {
  const { ctx } = g;
  const u = frac(mt + P.jumpLead);
  let pose = jumpPose(u, 0.32, freezeA);
  pose = narrowLegs({ ...pose, sL: 2.5 + 0.1 * Math.sin(TAU * u), sR: 2.5 + 0.1 * Math.sin(TAU * u + 1), eL: -0.12, eR: -0.12, head: -0.3 });
  const x = 960, ground = 1068 + rise;
  // a warm halo behind Kit so the colour figure reads against the crowd
  const kick = F.c.kick * (1 - K.nb);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = g.sprites.glow(pal.gold);
  const hr = 300 + 60 * kick;
  ctx.globalAlpha = 0.32 + 0.2 * kick;
  ctx.drawImage(gl, x - hr, ground - 330 - hr, 2 * hr, 2 * hr);
  ctx.restore();
  drawPuppet(ctx, KIT.adult, pose, { x, ground, scale: 1.55, view: 'front', devScale: g.scale });
}

// ---------------------------------------------------------------- beams and snare kites

/** A quarter-resolution buffer for big soft light (beams, haloes): cheap to fill, composited additively. */
function lightBuffer(g) {
  const w = Math.max(32, Math.round(g.devW / 4)), h = Math.max(18, Math.round(g.devH / 4));
  const B = cached(`light|${w}x${h}`, () => { const c = g.createCanvas(w, h); return { canvas: c, ctx: c.getContext('2d'), k: w / g.W }; });
  const x = B.ctx;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, w, h);
  x.setTransform(B.k, 0, 0, B.k, 0, 0);
  x.globalCompositeOperation = 'lighter';
  return B;
}

/** Stage beams from behind the crowd: they sweep slowly and flick to new angles on every hit. */
function drawBeams(g, lctx, t, F, P, S, pal, K) {
  const { ctx } = g;
  const hits = (F.ev && F.ev.hit) || [];
  let lo = 0, hi = hits.length;
  while (lo < hi) { const md = (lo + hi) >> 1; if (land(hits[md][0], F) <= t + 1e-6) lo = md + 1; else hi = md; }
  const n = lo - 1;
  const tHit = n >= 0 ? land(hits[n][0], F) : S.t0 - 10;
  const flick = outExpo((t - tHit) / 0.09);
  const flash = Math.exp(-Math.max(0, t - tHit) / 0.22) * (n >= 0 ? clamp(hits[n][1]) : 0);
  const cone = coneSprite(g, pal.beam);
  const nb = Math.max(0, Math.round(P.beams));
  const dim = 1 - 0.9 * K.nb;
  if (dim <= 0.02) return;
  const lamps = [];
  for (let i = 0; i < nb; i++) {
    const ang = (k) => -Math.PI / 2 + (i - (nb - 1) / 2) * 0.2 + (hashU(S.seed, k, i + 40) - 0.5) * 1.3;
    const a = lerp(ang(n - 1), ang(n), flick) + 0.16 * Math.sin(K.tC * 0.7 + i * 1.9);
    const ox = 960 + (i - (nb - 1) / 2) * 330, oy = 655;
    const len = 1550, w = 300;
    lctx.save();
    lctx.translate(ox, oy);
    lctx.rotate(a);
    lctx.globalAlpha = clamp((0.42 + 0.55 * flash) * dim);
    lctx.drawImage(cone, 0, -w / 2, len, w);
    lctx.globalAlpha = clamp(0.5 * flash * dim);
    lctx.drawImage(cone, 0, -w / 4, len * 0.8, w / 2);          // a hot core on the hit
    lctx.restore();
    lamps.push([ox, oy]);
  }
  // the lamps themselves, crisp
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = g.sprites.glow(pal.beam, 1);
  const lr = 22 + 30 * flash;
  ctx.globalAlpha = clamp((0.6 + 0.4 * flash) * dim);
  for (const [ox, oy] of lamps) ctx.drawImage(lg, ox - lr, oy - lr, 2 * lr, 2 * lr);
  ctx.restore();
}

function drawSnareKites(g, t, F, P, S, pal, K) {
  const { ctx } = g;
  const sn = (F.ev && F.ev.snare) || [];
  const dur = P.kiteDur;
  let lo = 0, hi = sn.length;
  while (lo < hi) { const md = (lo + hi) >> 1; if (land(sn[md][0], F) <= t + 1e-6) lo = md + 1; else hi = md; }
  const kcols = [[pal.rose, pal.gold], [pal.teal, pal.milk], [pal.gold, pal.rose], [pal.peach, pal.violet], [pal.milk, pal.teal]];
  const glow = g.sprites.glow(pal.beam);
  for (let i = lo - 1; i >= 0; i--) {
    const ts = land(sn[i][0], F), s = sn[i][1];
    if (ts < S.t0) break;
    if (t - ts > dur * 4 + 4) break;
    if (K.inWin(ts)) continue;                    // no new kites while time is braked
    const age = K.tC - K.tauC(ts);
    const u0 = age / dur;
    if (u0 > 1.35) continue;
    const h = (k) => hashU(S.seed, i, k + 60);
    const ltr = h(1) < 0.5;
    const x0 = ltr ? -220 : 2140, x1 = ltr ? 2140 : -220;
    const y0 = 560 + 360 * h(2), y1 = -160 + 360 * h(3);
    const bulge = (h(4) - 0.5) * 360;
    const path = (u) => {
      const e = u;                                // a fast, even streak
      const x = lerp(x0, x1, e), y = lerp(y0, y1, e);
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      const b = bulge * Math.sin(Math.PI * clamp(e));
      return [x - (dy / L) * b, y + (dx / L) * b];
    };
    const size = 34 + 30 * clamp(s) + 16 * h(5);
    const [cA, cB] = kcols[i % kcols.length];
    // ribbon tail: where the kite was, swinging behind it
    const pts = [];
    const lag = 0.45 / 24;
    for (let k = 0; k < 26; k++) {
      const uu = u0 - (k * lag * 0.95) / dur * 0.7;
      const [px, py] = path(uu);
      const sw = Math.sin(k * 0.55 - K.tC * 14 + i) * (4 + k * 2.2);
      pts.push([px + sw * 0.6, py + sw]);
    }
    const [x, y] = path(u0);
    const [xa, ya] = path(u0 - 0.02);
    const dir = Math.atan2(y - ya, x - xa);
    // a light streak behind the kite
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    const st = g.sprites.streak(cA);
    ctx.translate(x, y);
    ctx.rotate(dir);
    ctx.drawImage(st, -size * 9, -size * 0.5, size * 9, size);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glow, -size * 2, -size * 2, size * 4, size * 4);
    ctx.restore();
    ctx.save();
    drawTail(ctx, pts, size * 0.16, cA, cB);
    drawKite(ctx, x, y, size, dir, cA, cB, '#1E1633');
    ctx.restore();
  }
}

/** Foreground dandelion seeds drifting across the whole frame (they hang still when time brakes). */
function drawDrift(g, t, F, P, S, pal, K) {
  const { ctx } = g;
  const spr = seedSprite(g, pal.milk);
  const bok = g.sprites.bokeh(pal.peach, 0.2, 0.3);
  const ps = particles({
    seed: S.seed + 99, t: K.tC, rate: 16, life: 7,
    origin: (k, r) => [-120 + 1500 * r - 400, 1150],
    vel: (k, r, r2) => [230 + 260 * r2, -(170 + 140 * r2)],
    swirl: 40, swirlHz: 0.35,
  });
  ctx.save();
  for (const p of ps) {
    const near = p.r2 > 0.88;
    const sz = near ? 30 + 40 * (p.r2 - 0.88) / 0.12 : 6 + 13 * p.r2;
    const a = clamp(p.u * 6) * clamp((1 - p.u) * 4);
    ctx.globalAlpha = a * (near ? 0.35 : 0.85);
    const x = p.x + (p.k % 3) * 520, y = p.y;
    if (x < -60 || x > 1980 || y < -60) continue;
    if (near) ctx.drawImage(bok, x - sz, y - sz, 2 * sz, 2 * sz);
    else ctx.drawImage(spr, x - sz, y - sz, 2 * sz, 2 * sz);
  }
  ctx.restore();
}

/** The film's numbness: a pale milk surface rising from the bottom of the frame, glassy and still. */
function drawMilkTide(g, t, pal, K) {
  // (pal.violet / pal.rose tint the milk; the surface is nearly still because time has braked)
  const { ctx } = g;
  const h = smooth((t - K.win.a) / 0.9) * (K.win.final ? 330 : 240) * clamp(K.nb * 1.05);
  if (h < 1) return;
  const y0 = 1080 - h;
  const ph = K.tC * 0.6;                         // the surface barely moves: time has braked
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-10, 1090);
  for (let x = -10; x <= 1930; x += 24) {
    const y = y0 + 9 * Math.sin(x * 0.006 + ph) + 5 * Math.sin(x * 0.017 - ph * 1.3);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(1930, 1090);
  ctx.closePath();
  const gr = ctx.createLinearGradient(0, y0 - 12, 0, 1080);
  gr.addColorStop(0, g.color.css('#FFFFFF', 0.95));
  gr.addColorStop(0.06, g.color.css(pal.milk, 0.92));
  gr.addColorStop(1, g.color.css(g.color.mix(pal.milk, pal.violet, 0.25), 0.97));
  ctx.fillStyle = gr;
  ctx.fill();
  // the sky's colour caught just under the surface, and slow sheen lines in the milk
  ctx.save();
  ctx.clip();
  const rf = ctx.createLinearGradient(0, y0, 0, y0 + 120);
  rf.addColorStop(0, g.color.css(pal.rose, 0.16));
  rf.addColorStop(1, g.color.css(pal.rose, 0));
  ctx.fillStyle = rf;
  ctx.fillRect(0, y0 - 20, 1920, 140);
  ctx.strokeStyle = g.color.css(pal.violet, 0.1);
  ctx.lineWidth = 2;
  for (let i = 1; i <= 6; i++) {
    const yy = y0 + i * i * 9 + 8;
    if (yy > 1080) break;
    ctx.beginPath();
    for (let x = -10; x <= 1930; x += 40) {
      const y = yy + (4 + i) * Math.sin(x * (0.004 + i * 0.0013) + ph * (0.5 + 0.2 * i) + i * 1.7);
      if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // soft glints on the surface
  ctx.globalCompositeOperation = 'lighter';
  const gl = g.sprites.glow('#FFFFFF');
  for (let i = 0; i < 9; i++) {
    const x = 110 + i * 215 + 40 * Math.sin(i * 2.1);
    const y = y0 + 9 * Math.sin(x * 0.006 + ph) + 5 * Math.sin(x * 0.017 - ph * 1.3);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(gl, x - 90, y - 10, 180, 20);
  }
  ctx.restore();
}

/** The loudest moment: a bloom, soft shock rings and a radial burst of seeds and little kites. */
function drawBurst(g, age, S, pal, cx, cy) {
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = g.sprites.glow(pal.beam, 1);
  const r = 300 + 1500 * outCubic(age / 1.2);
  ctx.globalAlpha = 0.8 * Math.exp(-age / 0.45);
  ctx.drawImage(gl, cx - r, cy - r, 2 * r, 2 * r);
  for (let k = 0; k < 3; k++) {
    const u = age / 1.3 - k * 0.09;
    if (u <= 0 || u >= 1) continue;
    const rr = 60 + 1900 * outCubic(u);
    ctx.globalAlpha = 0.35 * (1 - u);
    ctx.strokeStyle = k === 1 ? pal.gold : pal.beam;
    ctx.lineWidth = 70 * (1 - u) + 6;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.6 * (1 - u);
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();
  // seeds and kites thrown out of the heart
  const seed = seedSprite(g, pal.milk);
  const kc = [pal.rose, pal.teal, pal.gold, pal.peach];
  ctx.save();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU + hashU(S.seed, i, 81) * 0.3;
    const sp = 500 + 1300 * hashU(S.seed, i, 82);
    const d = sp * (1 - Math.exp(-age * 1.6)) / 1.6 + 30;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d + 60 * age * age;
    const al = clamp(1 - age / 2.3) * clamp(age * 12);
    if (al <= 0.01 || x < -80 || x > 2000 || y < -80 || y > 1160) continue;
    ctx.globalAlpha = al;
    if (i % 6 === 0) {
      drawKite(ctx, x, y, 16 + 14 * hashU(S.seed, i, 83), a, kc[(i / 6) % 4 | 0], pal.milk, pal.plum);
    } else {
      const sz = 8 + 16 * hashU(S.seed, i, 84);
      ctx.drawImage(seed, x - sz, y - sz, 2 * sz, 2 * sz);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the shatter

function drawShatter(g, t, F, P, S, pal, snap) {
  const { ctx } = g;
  const tp = t - S.t0;
  const dur = P.shatterDur;
  if (tp > dur + 0.15) return;
  const shards = shardLayout((S.seed % 1000) + 1, P.shatterX, P.shatterY);
  const one = (tk, alphaK, k) => {
    for (const sh of shards) {
      const age = Math.max(0, tk - sh.delay);
      const fade = clamp(1 - (age - dur * 0.45) / (dur * 0.6));
      const a = alphaK * fade;
      if (a <= 0.01) continue;
      const d = 4 + sh.speed * age * (0.7 + age * 2.6);
      const sc = 1 + sh.grow * age * age * 1.6;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(sh.cx + sh.ux * d, sh.cy + sh.uy * d);
      ctx.rotate(sh.spin * age * age * 2);
      ctx.scale(sc, sc);
      ctx.translate(-sh.cx, -sh.cy);
      ctx.beginPath();
      ctx.moveTo(sh.pts[0][0], sh.pts[0][1]); ctx.lineTo(sh.pts[1][0], sh.pts[1][1]); ctx.lineTo(sh.pts[2][0], sh.pts[2][1]);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.drawImage(snap, 0, 0, g.W, g.H);
      if (k > 0) { ctx.fillStyle = g.color.css(pal.gold, 0.35); ctx.fillRect(sh.cx - 600, sh.cy - 600, 1200, 1200); }
      ctx.restore();
      if (k === 0) {
        ctx.strokeStyle = g.color.css('#FFFFFF', clamp(1 - age / 0.25) * 0.9 + 0.1);
        ctx.lineWidth = 2.2 / sc;
        ctx.stroke();
      }
      ctx.restore();
    }
  };
  echo(tp, 3, 0.03, (tk, alpha, k) => { if (tk >= 0) one(tk, alpha * (k ? 0.55 : 1), k); }, { decay: 0.55 });
  // the cracks blaze at the moment of breaking
  const blaze = Math.exp(-tp / 0.12);
  if (blaze > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = g.sprites.glow(pal.beam, 1);
    const r = 260 + 1400 * outCubic(tp / 0.4);
    ctx.globalAlpha = 0.35 * blaze;
    ctx.drawImage(gl, P.shatterX - r, P.shatterY - r, 2 * r, 2 * r);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- draw

export function draw(g, t, F, P, S) {
  const { ctx, W, H } = g;
  const pal = palette(S);
  const D = { ...defaults, ...Object.fromEntries(Object.entries(P || {}).filter(([, v]) => v !== undefined && v !== null)) };
  P = D;
  const tp = t - S.t0;
  const fps = F.fps || 30;

  // the previous world's last frame, for the shatter (taken first: it may use shared layers)
  let snap = null;
  if (tp < P.shatterDur + 0.2) {
    if (P.shatterFrom) {
      try { snap = g.snapshot(P.shatterFrom, S.t0 - 1 / fps); } catch (e) { snap = null; }
    }
    if (!snap) snap = goldSky(g, pal);
  }

  const K = clocks(F, S, P, t);
  const PH = phraseInfo(F, S, P, t);
  const loudT = typeof P.loudest === 'number' ? P.loudest : (typeof F.ev.loudest === 'number' ? land(F.ev.loudest, F) : Infinity);
  const loud = t >= loudT;
  const segs = Math.max(4, Math.round(loud ? P.wedgesLoud : P.wedges));
  const wedge = TAU / (Math.round(segs / 2) * 2);

  // ---- kaleidoscope geometry
  const open = outExpo(tp / P.openDur);
  const loudPunch = loud ? Math.exp(-(t - loudT) / 0.35) : 0;
  const slam = K.lastEnd > S.t0 && t >= K.lastEnd ? Math.exp(-(t - K.lastEnd) / 0.18) : 0;
  const zoom = P.zoom * (1 + 3.2 * (1 - open) + 0.35 * loudPunch + 0.18 * slam);
  const downs = (F.ev && F.ev.downbeats) || [];
  let rot = P.spin * (K.tC - S.t0) + (1 - open) * 1.6;
  const jr = (P.jumpDeg * Math.PI) / 180;
  for (const d0 of downs) {
    const d = land(d0, F);
    if (d < S.t0 - 1e-6) continue;
    if (d > t + 1e-6) break;
    if (K.inWin(d)) continue;
    rot += jr * outCubic((t - d) / P.jumpEase);
  }
  const radius = 1250;
  const srcR = radius / Math.max(1, zoom);

  // ---- source layer
  const src = sourceCanvas(g, clamp(P.srcRes, 0.2, 1));
  drawSource(g, src, t, F, P, S, pal, K, wedge, srcR, worldStops(g, t, F, S, P, pal, PH, loudT));

  // ---- kaleidoscope (melting through a layer while numb)
  const cx = 960, cy = P.kcy;
  const kOpts = { segments: segs, rot, cx, cy, radius, sx: SX, sy: SY, zoom };
  ctx.fillStyle = pal.plum;
  ctx.fillRect(0, 0, W, H);
  if (K.nb > 0.002) {
    const L = g.layer('storm-kal');
    L.ctx.fillStyle = pal.plum;
    L.ctx.fillRect(0, 0, W, H);
    kaleido({ ...g, ctx: L.ctx }, src.canvas, kOpts);
    melt(g, L.canvas, { amount: P.meltPx * K.nb, t, seed: 2.3, colW: 12, freq: 2.6, speed: 0.25 });
  } else {
    kaleido(g, src.canvas, kOpts);
  }

  // depth: the kaleidoscope darkens toward the edges so the heart and the light read
  const vg = ctx.createRadialGradient(cx, cy, 220, cx, cy, 1150);
  vg.addColorStop(0, g.color.css(pal.plum, 0));
  vg.addColorStop(1, g.color.css(pal.plum, 0.45 * (1 - K.nb)));
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // camera framing: a slow push-in through each phrase, re-framed on the phrase downbeat
  const cam = framing(t, F, S, P, K, PH);

  // soft light (quarter resolution, additive): the heart pulsing on the kicks, the beams, the horizon
  const LB = lightBuffer(g);
  const lx = LB.ctx;
  const kick = F.c.kick * (1 - K.nb);
  const hg = g.sprites.glow(pal.gold);
  const hr = 200 + 170 * kick + 400 * loudPunch;
  lx.globalAlpha = 0.12 + 0.3 * kick + 0.6 * loudPunch;
  lx.drawImage(hg, cx - hr, cy - hr, 2 * hr, 2 * hr);
  lx.save();
  camApply(lx, cam);
  drawBeams(g, lx, t, F, P, S, pal, K);
  lx.restore();
  lx.globalAlpha = 0.55;
  lx.drawImage(g.sprites.glow(pal.rose), -300, 470, 2520, 360);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(LB.canvas, 0, 0, W, H);
  ctx.restore();

  // the floor the crowd stands on (dark, catching a little of the sky's light)
  ctx.save();
  camApply(ctx, cam);
  const fy = 570;
  const fl = ctx.createLinearGradient(0, fy, 0, H);
  fl.addColorStop(0, g.color.css(g.color.mix(pal.violet, pal.plum, 0.4), 0));
  fl.addColorStop(0.1, g.color.css(g.color.mix(pal.violet, pal.plum, 0.45), 0.55));
  fl.addColorStop(0.25, g.color.css(g.color.mix(pal.violet, pal.plum, 0.5), 0.88));
  fl.addColorStop(1, g.color.css(g.color.mix(pal.crowd, pal.plum, 0.5), 1));
  ctx.fillStyle = fl;
  ctx.fillRect(-200, fy + Math.max(0, 420 * (1 - outCubic((tp - 0.05) / 0.55))), W + 400, H);

  // ---- the crowd rises into frame as the sky breaks, then jumps on every beat
  const rise = 420 * (1 - outCubic((tp - 0.05) / 0.55));
  const { mt, freezeA } = drawCrowd(g, t, F, P, S, pal, K, rise);
  drawKit(g, t, F, P, pal, K, rise, mt, freezeA);
  ctx.restore();

  // ---- numb: the pale milk rises around the frozen crowd
  if (K.win) drawMilkTide(g, t, pal, K);

  // ---- kites on the snares, seeds drifting in front
  drawSnareKites(g, t, F, P, S, pal, K);
  drawDrift(g, t, F, P, S, pal, K);

  // ---- loudest: a white-gold bloom bursting out of the heart, throwing seeds and kites outwards
  if (loud && t - loudT < 2.5) drawBurst(g, t - loudT, S, pal, cx, cy);

  // ---- numb: the colour drains toward milk (fully in the last window), time stands still
  if (K.nb > 0.002) {
    const d = K.nb * (K.win && K.win.final ? P.drainFinal : P.drain);
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = g.color.css('#808080', clamp(d * 1.1));
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g.color.css(pal.milk, clamp(d * (K.win && K.win.final ? 0.95 : 0.75)));
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- slam back after a numb window: a quick gold-white punch on the beat
  if (slam > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g.color.css(pal.beam, 0.35 * slam);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- the shatter of the previous sky (on top of everything for its first moments)
  if (snap) drawShatter(g, t, F, P, S, pal, snap);
}
