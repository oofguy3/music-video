// A1 THE EMPEROR RISES (the intro, before the drums kick in).
//
//   S.t0 .. P.humEnd   Deep navy darkness with drifting fog and a few slow blue petals; hanging chains
//                      fade in and out at the edges. At the centre a single blue rose blooms: every
//                      humming note (F.ev.voc_notes onsets) opens it one step, sends a soft ring of blue
//                      light outwards and grows thorny vines further across the frame; the pad's notes
//                      (F.ev.pad_notes) twinkle as motes of light around it.
//   P.revealT          The short drum burst: a white flash; every hit rattles the chains, pulses the rose.
//   P.rapT             The camera pulls back from the rose: it is the tattoo on Kaiser's neck
//                      (KAISER_SUIT), an extreme close-up portrait, side-lit in blue, eyes closed.
//   P.visionT          His eyes open with a cold blue glint in each.
//   P.wideT ..         The pull-back goes on to a waist-up and a full-figure shot in a dark hall; behind
//   P.futureT          him a giant crown of gold light lines assembles (the band on P.futureT, the points
//   P.rulerT           on P.rulerT); on P.kingT it completes with a gold burst and rays while the chains
//   P.kingT            around the hall snap and he sweeps his arm out in command.
//   .. S.t1            Push in on him through white speed lines into the engine's flash.
//
// The bottom centre stays dark and calm while the engine's title card is up (the humming).
// Pure: every moment comes from P (times, snapped to landing frames) or F (events and columns); module
// caches are pure functions of their keys, and scratch boxes and layers are cleared before every use.

import { KAISER_SUIT, KZ, drawChain, drawRose, speedLines, streakLines } from './lib/kaiser.mjs';
import { drawPuppet, solve } from './lib/puppet.mjs';
import { halftone } from './lib/fx.mjs';
import { field, hashU, rays } from './lib/worldkit.mjs';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

export const meta = { type: 'kzRise', budgetMs: 150 };

/** Fallback colours (the treatment's palette overrides them). */
export const DEFAULT = {
  navy: '#05081F', royal: '#1F4FD8', rose: '#2E6BFF', roseGlow: '#7FB0FF', gold: '#FFD45A',
  chain: '#C9D2E0', fog: '#16205A',
};

export const defaults = {
  humEnd: null,        // end of the humming (s); null = a little before the rap
  revealT: null,       // the drum burst (s); null = the first drums entry in the entry
  rapT: null,          // the rap starts and the camera pulls back (s); null = the first lyric line
  visionT: null,       // his eyes open (s); null = shortly after the rap starts
  wideT: null,         // the pull-back to the full figure starts (s); null = the next lyric line after visionT
  futureT: null,       // crown: the band lights up (s)
  rulerT: null,        // crown: the points (s)
  kingT: null,         // crown complete, chains snap, push-in starts (s)
  roseX: 960, roseY: 468, roseR: 170,  // the blooming rose (px)
  portraitR: 250,      // head radius (px) of the close-up portrait
  pullDur: 1.6,        // seconds of the first pull-back (rose -> portrait)
  endZ: 3.0,           // camera zoom at the end of the push-in (1 = the full-figure shot)
  charX: 960, groundY: 930, charScale: 2,
  crownW: 640, crownY: 548,  // the light crown behind him (world px, base centre)
  vines: 8,
  petals: 0.9,         // petal births per second
  fog: 0.8,            // fog strength
  speedAlpha: 0.4,     // speed-line alpha at the end of the push-in
};

// ---------------------------------------------------------------- helpers

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const outCubic = (u) => 1 - (1 - clamp(u)) ** 3;
const inCubic = (u) => clamp(u) ** 3;
const outBack = (u) => { u = clamp(u); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; };
const linear = (u) => clamp(u);
const after = (t, t0) => (t >= t0 ? 1 : 0);
const decay = (t, t0, tau) => (t < t0 ? 0 : Math.exp(-(t - t0) / tau));
/** A segment that is already visible on the frame its moment lands on, then completes. */
const draw0 = (t, t0, dur, head = 0.14) => (t < t0 ? 0 : head + (1 - head) * outCubic((t - t0) / dur));

function palette(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(DEFAULT)) o[k] = typeof p[k] === 'string' && p[k][0] === '#' ? p[k] : DEFAULT[k];
  return o;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

/** A scratch canvas of at least w x h device px (cleared by the caller before every use). */
function box(g, name, w, h) {
  const bw = Math.max(64, Math.ceil(w / 64) * 64), bh = Math.max(64, Math.ceil(h / 64) * 64);
  return cached(`box|${name}|${bw}x${bh}`, () => { const c = g.createCanvas(bw, bh); return { c, x: c.getContext('2d'), w: bw, h: bh }; });
}

/** A soft round glow as a radial-gradient fill (far cheaper than upscaling a sprite over a big area). */
function glowFill(g, ctx, x, y, r, hex, alpha, { core = false, comp = 'lighter' } = {}) {
  if (alpha <= 0.003 || r <= 1) return;
  const css = g.color.css;
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, css(core ? '#FFFFFF' : hex, alpha));
  gr.addColorStop(0.3, css(hex, 0.36 * alpha));
  gr.addColorStop(1, css(hex, 0));
  ctx.save();
  ctx.globalCompositeOperation = comp;
  ctx.fillStyle = gr;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
}

// ---------------------------------------------------------------- timing

/** The entry's moments (s), each snapped to the frame it lands on. */
function timing(F, P, S) {
  const fps = F.fps || 30;
  const D = Math.max(1e-3, S.t1 - S.t0);
  const L = (x) => Math.floor(x * fps + 0.5) / fps;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const ev = F.ev || {};
  const lines = Array.isArray(ev.lines) ? ev.lines : [];
  const line0 = lines.find((l) => l[0] > S.t0 + 0.2 * D && l[0] < S.t1);
  const drums = (Array.isArray(ev.entries) ? ev.entries : []).find((e) => e[1] === 'drums' && e[0] > S.t0 && e[0] < S.t1);
  const rap = L(num(P.rapT) ? P.rapT : line0 ? line0[0] : S.t0 + 0.52 * D);
  const hum = L(num(P.humEnd) ? P.humEnd : rap - 0.1 * D);
  const reveal = L(num(P.revealT) ? P.revealT : drums && drums[0] < rap ? drums[0] : rap - 0.05 * D);
  const vision = L(num(P.visionT) ? P.visionT : rap + 0.09 * D);
  const next = lines.find((l) => l[0] > vision + 0.5 && l[0] < S.t1);
  const wide = L(num(P.wideT) ? P.wideT : next ? next[0] : vision + 0.09 * D);
  const future = L(num(P.futureT) ? P.futureT : S.t0 + 0.8 * D);
  const ruler = L(num(P.rulerT) ? P.rulerT : S.t0 + 0.87 * D);
  const king = L(num(P.kingT) ? P.kingT : S.t0 + 0.935 * D);
  return { t0: S.t0, t1: S.t1, fps, L, hum, reveal, rap, vision, wide, future, ruler, king };
}

/** The humming notes that open the rose: [{t (landing), v}], with an even fallback when none. */
function humNotes(F, T) {
  return cached(`hum|${T.t0}|${T.hum}|${F.duration}|${(F.ev.voc_notes || []).length}`, () => {
    const out = F.between('voc_notes', T.t0, T.hum).map((n) => ({ t: T.L(n[0]), v: clamp(typeof n[3] === 'number' ? n[3] : 0.6, 0.25, 1) }));
    if (!out.length) {
      const n = 12;
      for (let i = 0; i < n; i++) out.push({ t: T.L(T.t0 + ((i + 1) / (n + 1)) * (T.hum - T.t0)), v: 0.6 });
    }
    return out;
  });
}

/** Events of the named lists landed in [a, b]: [{t, s}] sorted by time. */
function events(F, T, names, a, b) {
  const out = [];
  for (const name of names) {
    const l = F.ev && F.ev[name];
    if (!Array.isArray(l) || !l.length) continue;
    for (const e of F.between(name, a - 0.05, b + 0.05)) {
      const t = T.L(e[0]);
      if (t >= a && t <= b) out.push({ t, s: clamp(typeof e[1] === 'number' ? e[1] : 0.6, 0.2, 1) });
    }
  }
  return out.sort((p, q) => p.t - q.t);
}

/** Bloom state at t: open (0..1), grow (0..1, the vines), flash (the latest note's light). */
function bloomAt(t, notes) {
  let k = 0;
  while (k < notes.length && notes[k].t <= t + 1e-9) k++;
  if (!k) return { open: 0, grow: 0, flash: 0, k: 0 };
  const last = notes[k - 1], a = t - last.t;
  return {
    open: Math.min(1, (k - 1 + outBack(a / 0.32)) / notes.length),
    grow: (k - 1 + outCubic(a / 0.55)) / notes.length,
    flash: Math.exp(-a / 0.4) * last.v,
    k,
  };
}

/** Damped swing (rad) excited by every drum hit before t: each hit kicks the pendulum one way or the other. */
function rattle(hits, t, seed, { amp = 0.05, tau = 0.75, w = 6.2, cap = 0.2 } = {}) {
  let s = 0;
  for (const h of hits) {
    const a = t - h.t;
    if (a < 0 || a > tau * 6) continue;
    const sign = hashU(seed, Math.round(h.t * 1000), 7) < 0.5 ? -1 : 1;
    s += sign * amp * h.s * Math.exp(-a / tau) * Math.sin(w * a + 0.25);
  }
  return cap * Math.tanh(s / cap);
}

// ---------------------------------------------------------------- the emperor and the camera

const D = KAISER_SUIT;

/**
 * His standing pose: arms relaxed in the close-up, settling into one hand on the hip as the camera pulls
 * back; breathing; on P.kingT the free arm sweeps out in command.
 */
function poseAt(t, T) {
  const p = { sL: 0.15, eL: 0.2, sR: 0.15, eR: 0.22, hL: 0.1, hR: 0.13, kL: 0.04, kR: 0.03, lean: -0.012, head: -0.07, rot: 0, bob: 0, squash: 0 };
  const settle = smoother((t - T.wide - 0.4) / 1.5);
  p.sR = lerp(p.sR, 0.52, settle); p.eR = lerp(p.eR, -1.22, settle);
  const br = Math.sin((TAU * (t - T.rap)) / 3.6) * smooth((t - T.rap) / 2);   // zero at the match cut
  p.lean += 0.006 * br; p.sL += 0.015 * br; p.sR += 0.01 * br; p.head += 0.012 * br;
  const k = t >= T.king ? outBack((t - T.king) / 0.45) : 0;
  p.sL = lerp(p.sL, 0.85, k); p.eL = lerp(p.eL, 0.32, k); p.head += -0.05 * k;
  return p;
}

function restJoints(P) {
  return cached(`rest|${P.charX}|${P.groundY}|${P.charScale}`, () =>
    solve(D, poseAt(-1e9, { rap: 0, wide: 1e9, king: Infinity }), { x: P.charX, ground: P.groundY, view: 'front', scale: P.charScale }));
}

/** A point given in head units (the head's own frame) -> world px. */
function headPoint(j, x, y) {
  const r = D.headR * j.U, a = j.headAng, c = Math.cos(a), s = Math.sin(a);
  const lx = x * r * j.facing, ly = y * r;
  return [j.headC[0] + c * lx - s * ly, j.headC[1] + s * lx + c * ly];
}

/** The rose kaiserHead draws on his neck (front view): world position, radius, rotation. */
function neckRose(j) {
  const [x, y] = headPoint(j, 0.4, 1.42);
  return { x, y, r: 0.24 * D.headR * j.U, rot: j.headAng + 0.4 * j.facing };
}

/**
 * The camera: world -> screen is A + (w - F) * z. Keys: the neck rose filling the bloom's rose (P.rapT),
 * the portrait (P.portraitR), a slow drift, the full figure (z = 1) by P.rulerT, the push-in to P.endZ.
 */
function cameraAt(t, T, P, JR) {
  const r = D.headR * JR.U;
  const nr = neckRose(JR);
  const face = headPoint(JR, 0, 0.42);
  const zP = P.portraitR / r;
  const keys = [
    { t: T.rap, z: P.roseR / nr.r, fx: nr.x, fy: nr.y, ax: P.roseX, ay: P.roseY },
    { t: T.rap + P.pullDur, z: zP, fx: face[0], fy: face[1], ax: 960, ay: 540, ease: outCubic },
    { t: T.wide, z: zP * 0.86, fx: face[0], fy: face[1] + 0.1 * r, ax: 960, ay: 540, ease: linear },
    { t: T.ruler + 0.35, z: 1, fx: P.charX, fy: P.groundY - 370, ax: 960, ay: 540, ease: smoother },
    { t: T.king, z: 0.965, fx: P.charX, fy: P.groundY - 372, ax: 960, ay: 540, ease: linear },
    { t: T.t1, z: P.endZ, fx: face[0], fy: face[1] + 0.25 * r, ax: 960, ay: 540, ease: inCubic },
  ];
  for (let i = 1; i < keys.length; i++) keys[i].t = Math.max(keys[i].t, keys[i - 1].t + 0.05);
  let c = keys[keys.length - 1];
  if (t <= keys[0].t) c = keys[0];
  else {
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t < b.t) {
        const u = b.ease((t - a.t) / (b.t - a.t));
        c = { z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), u)), fx: lerp(a.fx, b.fx, u), fy: lerp(a.fy, b.fy, u), ax: lerp(a.ax, b.ax, u), ay: lerp(a.ay, b.ay, u) };
        break;
      }
    }
  }
  const z0 = keys[0].z;
  return {
    ...c, z0,
    sx: (x) => c.ax + (x - c.fx) * c.z,
    sy: (y) => c.ay + (y - c.fy) * c.z,
    /** world -> screen with a parallax power on the zoom */
    at: (x, y, pow = 1) => { const z = Math.pow(c.z, pow); return [c.ax + (x - c.fx) * z, c.ay + (y - c.fy) * z]; },
    /** set ctx to this camera (with a parallax power on the zoom) */
    apply(ctx, ds, pow = 1) {
      const z = Math.pow(c.z, pow);
      ctx.setTransform(ds * z, 0, 0, ds * z, ds * (c.ax - c.fx * z), ds * (c.ay - c.fy * z));
    },
  };
}

// ---------------------------------------------------------------- sprites

function petalSprite(g, pal) {
  return cached(`petal|${pal.rose}|${g.scale}`, () => {
    const s = Math.max(8, Math.round(72 * g.scale));
    const c = g.createCanvas(s, s);
    const x = c.getContext('2d');
    x.scale(s / 72, s / 72);
    const gr = x.createLinearGradient(8, 36, 66, 36);
    gr.addColorStop(0, KZ.roseDeep); gr.addColorStop(0.55, pal.rose); gr.addColorStop(1, KZ.roseHi);
    x.fillStyle = gr;
    x.beginPath();
    x.moveTo(6, 36);
    x.bezierCurveTo(22, 8, 58, 6, 68, 30);
    x.quadraticCurveTo(62, 40, 68, 46);
    x.bezierCurveTo(56, 66, 22, 64, 6, 36);
    x.fill();
    x.strokeStyle = 'rgba(10,20,80,0.5)'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(9, 36); x.quadraticCurveTo(36, 33, 58, 36); x.stroke();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// ---------------------------------------------------------------- the rose (lit, in a scratch box)

/**
 * The library's rose (drawRose) layered for depth: an ink rim, the rose, an inner whorl of lighter
 * petals, then a highlight from the upper left and darker petal tips; drawn into a scratch box and
 * stamped at (x, y) in the current transform of ctx. r is the rose radius.
 */
function litRose(g, ctx, x, y, r, { rot = 0, open = 1, pal, glow = 0, bright = 0 } = {}) {
  if (r < 0.8) return;
  const ds = g.scale;
  const half = r * 1.3;
  const tf = ctx.getTransform();
  const devS = Math.min(1600, Math.ceil(2 * half * Math.max(ds, Math.hypot(tf.a, tf.b))) + 4);
  const zoom = devS / (2 * half);
  const B = box(g, 'rose', devS, devS);
  const bx = B.x;
  bx.setTransform(1, 0, 0, 1, 0, 0);
  bx.globalCompositeOperation = 'source-over';
  bx.globalAlpha = 1;
  bx.clearRect(0, 0, devS + 2, devS + 2);
  bx.setTransform(zoom, 0, 0, zoom, devS / 2, devS / 2);
  const o = clamp(open);
  const inner = g.color.mix(pal.rose, KZ.roseHi, 0.3);
  drawRose(bx, 0, 0, r * 1.07, { color: KZ.ink, deep: KZ.ink, hi: KZ.ink, rot, open: o });
  drawRose(bx, 0, 0, r, { color: pal.rose, deep: KZ.roseDeep, hi: KZ.roseHi, rot, open: o });
  const ri = r * (0.5 + 0.08 * o);
  drawRose(bx, 0, 0, ri * 1.1, { color: KZ.roseDeep, deep: KZ.roseDeep, hi: KZ.roseDeep, rot: rot + 0.55, open: o, alpha: 0.85 });
  drawRose(bx, 0, 0, ri, { color: inner, deep: pal.rose, hi: KZ.roseHi, rot: rot + 0.55, open: o });
  bx.globalCompositeOperation = 'source-atop';
  const hl = bx.createRadialGradient(-0.45 * r, -0.5 * r, 0, -0.45 * r, -0.5 * r, 1.25 * r);
  hl.addColorStop(0, g.color.css(KZ.roseHi, 0.5 + 0.3 * bright));
  hl.addColorStop(0.55, g.color.css(KZ.roseHi, 0.1));
  hl.addColorStop(1, g.color.css(KZ.roseHi, 0));
  bx.fillStyle = hl;
  bx.fillRect(-half, -half, 2 * half, 2 * half);
  const dk = bx.createRadialGradient(0, 0, 0.35 * r, 0, 0, 1.12 * r);
  dk.addColorStop(0, 'rgba(4,8,40,0)');
  dk.addColorStop(1, 'rgba(4,8,40,0.5)');
  bx.fillStyle = dk;
  bx.fillRect(-half, -half, 2 * half, 2 * half);
  if (glow > 0) {
    bx.globalCompositeOperation = 'lighter';
    const hg = bx.createRadialGradient(0, 0, 0, 0, 0, 0.62 * r);
    hg.addColorStop(0, g.color.css(pal.roseGlow, clamp(0.65 * glow)));
    hg.addColorStop(1, g.color.css(pal.roseGlow, 0));
    bx.fillStyle = hg;
    bx.fillRect(-half, -half, 2 * half, 2 * half);
  }
  ctx.drawImage(B.c, 0, 0, devS, devS, x - half, y - half, 2 * half, 2 * half);
}

// ---------------------------------------------------------------- vines

/** Thorny vines radiating from the rose (rose-relative px), none heading into the title area. */
function vineSet(seed, n) {
  return cached(`vines|${seed}|${n}`, () => {
    const base = [-166, -128, -86, -46, -8, 24, 156, 194];
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = (base[i % base.length] + (hashU(seed, i, 1) - 0.5) * 12) * D2R;
      const ph = hashU(seed, i, 2) * TAU;
      const wl = 330 + 240 * hashU(seed, i, 3);
      const amp = 0.4 + 0.3 * hashU(seed, i, 4);
      const bend = (hashU(seed, i, 5) - 0.5) * 0.0007;
      const step = 8;
      let x = Math.cos(b) * 60, y = Math.sin(b) * 60;
      const pts = [[x, y]], cum = [0];
      for (let k = 1; k < 420; k++) {
        const s = k * step;
        const th = b + amp * Math.sin((TAU * s) / wl + ph) * Math.min(1, s / 140) + bend * s;
        x += Math.cos(th) * step; y += Math.sin(th) * step;
        pts.push([x, y]); cum.push(s);
        if (x < -1040 || x > 1040 || y < -560 || y > 690) break;
      }
      const len = cum[cum.length - 1];
      const thorns = [], leaves = [];
      for (let s = 34 + 20 * hashU(seed, i, 9), m = 0; s < len; s += 24 + 22 * hashU(seed, i, 200 + m), m++) thorns.push({ s, side: m % 2 ? 1 : -1, k: 0.85 + 0.5 * hashU(seed, i, 300 + m) });
      for (let s = 120 + 60 * hashU(seed, i, 10), m = 0; s < len - 30; s += 140 + 120 * hashU(seed, i, 400 + m), m++) leaves.push({ s, side: hashU(seed, i, 500 + m) < 0.5 ? 1 : -1, size: 22 + 12 * hashU(seed, i, 600 + m) });
      const ts = len * (0.22 + 0.3 * hashU(seed, i, 11)), tside = hashU(seed, i, 12) < 0.5 ? 1 : -1;
      out.push({ pts, cum, len, delay: 0.14 * hashU(seed, i, 6), w0: 5.5 + 2.5 * hashU(seed, i, 7), thorns, leaves, ts, tside });
    }
    return out;
  });
}

/** Point and unit tangent of a vine at arc length s. */
function vineAt(v, s) {
  const { pts, cum } = v;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[Math.min(pts.length - 1, lo + 1)];
  const f = clamp((s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]));
  let tx = b[0] - a[0], ty = b[1] - a[1];
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl; ty /= tl;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, tx, ty];
}

function drawVines(ctx, g, vines, grow, t, pal, { flash = 0, alpha = 1 } = {}) {
  if (alpha <= 0.003 || grow <= 0) return;
  const css = g.color.css;
  const body = g.color.mix(pal.navy, KZ.roseDeep, 0.45);
  const rim = css(pal.royal, clamp(0.5 + 0.4 * flash));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const tips = [];
  for (const v of vines) {
    const Lg = v.len * clamp((grow - v.delay) / (1 - v.delay));
    if (Lg < 4) continue;
    const width = (s) => (1.2 + (v.w0 - 1.2) * Math.pow(Math.max(0, 1 - s / v.len), 0.7)) * Math.min(1, (Lg - s) / 46 + 0.06);
    let n = 0;
    while (n < v.pts.length - 1 && v.cum[n + 1] <= Lg) n++;
    const tip = vineAt(v, Lg);
    const Lft = [], Rgt = [];
    for (let i = 0; i <= n; i++) {
      const p = v.pts[i], q0 = v.pts[Math.max(0, i - 1)], q1 = v.pts[Math.min(v.pts.length - 1, i + 1)];
      let tx = q1[0] - q0[0], ty = q1[1] - q0[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const w = width(v.cum[i]);
      Lft.push([p[0] - ty * w, p[1] + tx * w]); Rgt.push([p[0] + ty * w, p[1] - tx * w]);
    }
    ctx.beginPath();
    Lft.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(tip[0], tip[1]);
    for (let i = Rgt.length - 1; i >= 0; i--) ctx.lineTo(Rgt[i][0], Rgt[i][1]);
    ctx.closePath();
    // thorns, hooked back towards the rose
    for (const th of v.thorns) {
      if (th.s > Lg - 14) break;
      const [px, py, tx, ty] = vineAt(v, th.s);
      const w = width(th.s);
      const nx = -ty * th.side, ny = tx * th.side;
      const sz = (5 + 1.3 * w) * th.k;
      const bx = px + nx * w * 0.7, by = py + ny * w * 0.7;
      ctx.moveTo(bx - tx * sz * 0.5, by - ty * sz * 0.5);
      ctx.lineTo(bx + nx * sz - tx * sz * 0.65, by + ny * sz - ty * sz * 0.65);
      ctx.lineTo(bx + tx * sz * 0.35, by + ty * sz * 0.35);
      ctx.closePath();
    }
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    Lft.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(tip[0], tip[1]);
    ctx.stroke();
    for (const lf of v.leaves) {
      if (lf.s > Lg - 24) break;
      const k = smooth((Lg - lf.s - 24) / 70);
      const [px, py, tx, ty] = vineAt(v, lf.s);
      const ang = Math.atan2(ty, tx) + lf.side * 0.8;
      const len = lf.size * k;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -len * 0.36, len, 0);
      ctx.quadraticCurveTo(len * 0.5, len * 0.36, 0, 0);
      ctx.fillStyle = body; ctx.fill();
      ctx.strokeStyle = rim; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(len * 0.08, 0); ctx.lineTo(len * 0.85, 0); ctx.stroke();
      ctx.restore();
    }
    if (Lg > v.ts + 8) {
      const k = clamp((Lg - v.ts - 8) / 110);
      const [px, py, tx, ty] = vineAt(v, v.ts);
      let a = Math.atan2(ty, tx) + v.tside * 0.9, x = px, y = py;
      ctx.beginPath(); ctx.moveTo(x, y);
      const steps = Math.round(34 * k);
      for (let i = 0; i < steps; i++) { a += v.tside * (0.04 + 0.006 * i); x += Math.cos(a) * 4.2; y += Math.sin(a) * 4.2; ctx.lineTo(x, y); }
      ctx.strokeStyle = body; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.strokeStyle = css(pal.royal, 0.4); ctx.lineWidth = 0.9; ctx.stroke();
    }
    if (Lg < v.len - 2) tips.push(tip);
  }
  if (flash > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    const spr = g.sprites.glow(pal.roseGlow);
    ctx.globalAlpha = alpha * clamp(flash);
    for (const [x, y] of tips) ctx.drawImage(spr, x - 26, y - 26, 52, 52);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- background and fog

/**
 * The night and its fog, painted once (sky gradient plus a domain-warped noise field) into a texture a
 * little larger than the frame; every frame draws it twice at whole-pixel offsets (no resampling): the
 * base drifting right, a mirrored copy drifting left and up, added in brighter when the rose flares.
 */
const FOG_PAD = [640, 260];   // logical px of texture beyond the frame (scroll room)
function fogTexture(g, P, pal) {
  const ds = g.scale;
  const W = g.devW + Math.ceil(FOG_PAD[0] * ds), H = g.devH + Math.ceil(FOG_PAD[1] * ds);
  return cached(`fogtex|${W}x${H}|${pal.navy}|${pal.fog}|${pal.royal}|${P.fog}`, () => {
    const c = g.createCanvas(W, H);
    const x = c.getContext('2d');
    const top = (FOG_PAD[1] * ds) / 2;
    const sg = x.createLinearGradient(0, top, 0, top + g.devH);
    sg.addColorStop(0, '#020411'); sg.addColorStop(0.5, pal.navy); sg.addColorStop(1, '#020410');
    x.fillStyle = sg;
    x.fillRect(0, 0, W, H);
    const fw = Math.max(32, Math.round(W / (8 * ds))), fh = Math.max(18, Math.round(H / (8 * ds)));
    const f = field(g, {
      key: 'kzRise-fogtex', seed: 23, t: 0, w: fw, h: fh, scale: (3.4 * W) / g.devW, warp: 1.6, octaves: 4,
      stops: [[0, '#000000'], [0.5, '#000000'], [0.8, pal.fog], [1, g.color.mix(pal.fog, pal.royal, 0.3)]], contrast: 1.05, offset: -0.05,
    });
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = clamp(0.42 * P.fog);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(f, 0, 0, W, H);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

function drawBackdrop(g, t, P, pal, lift, hidden = 0) {
  if (hidden >= 0.999) return;   // the opaque hall covers it all
  const ctx = g.ctx, ds = g.scale, dw = g.devW, dh = g.devH;
  const tex = fogTexture(g, P, pal);
  const mx = tex.width - dw, my = tex.height - dh;
  // a triangle wave keeps the scroll inside the texture; whole device pixels, so no resampling
  const wrap = (v, m) => { const q = ((v % (2 * m)) + 2 * m) % (2 * m); return Math.round(q > m ? 2 * m - q : q); };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tex, wrap(20 * ds * t, mx), Math.round(my / 2), dw, dh, 0, 0, dw, dh);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(0.3 + 0.5 * lift);
  ctx.drawImage(tex, wrap(mx * 0.85 - 14 * ds * t, mx), wrap(my * 0.15 + 7 * ds * t, my), dw, dh, 0, 0, dw, dh);
  ctx.restore();
}

/** The dark area under the engine's title card (bottom centre) while it is up. */
function calmZone(g, a) {
  if (a <= 0.003) return;
  const ctx = g.ctx;
  ctx.save();
  const gr = ctx.createLinearGradient(0, 790, 0, 1080);
  gr.addColorStop(0, 'rgba(2,3,12,0)');
  gr.addColorStop(0.55, `rgba(2,3,12,${(0.5 * a).toFixed(3)})`);
  gr.addColorStop(1, `rgba(2,3,12,${(0.7 * a).toFixed(3)})`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 790, 1920, 290);
  ctx.restore();
}
const inCalm = (x, y) => (1 - smooth((Math.abs(x - 960) - 430) / 140)) * smooth((y - 760) / 120);

// ---------------------------------------------------------------- chains

/** Hanging chains at the edges of the dark (screen px): anchor x, length, link, id. */
const EDGE_CHAINS = [[118, 620, 30, 0], [282, 400, 25, 1], [1804, 680, 30, 2], [1636, 450, 25, 3]];

function drawEdgeChains(g, t, pal, hits, alpha, lit, k = 1) {
  if (alpha <= 0.003) return;
  const ctx = g.ctx;
  for (const [x, len, link, i] of EDGE_CHAINS) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.42 + i * 1.9 + 0.6 * Math.sin(t * 0.17 + i));
    const a = alpha * clamp(0.08 + 0.45 * pulse * pulse + 0.85 * lit);
    if (a <= 0.004) continue;
    const swing = 0.018 * Math.sin(t * 1.25 + i * 2.1) + rattle(hits, t, 40 + i, { amp: 0.07, cap: 0.24 });
    const light = clamp(0.2 + 0.3 * pulse + 0.9 * lit);
    const col = g.color.mix(pal.navy, pal.chain, 0.3 + 0.62 * light);
    const deep = g.color.mix(pal.navy, KZ.chainDeep, 0.4 + 0.5 * light);
    ctx.save();
    ctx.translate(960 + (x - 960) * k, 540 + (-30 - 540) * k);
    ctx.scale(k, k);
    ctx.rotate(swing);
    drawChain(ctx, 0, 0, 0, len, { sag: 0, link, width: link * 0.2, color: col, deep, alpha: a });
    ctx.globalAlpha *= a;
    ctx.lineWidth = link * 0.26; ctx.strokeStyle = deep;
    ctx.beginPath(); ctx.ellipse(0, len + link * 0.55, link * 0.55, link * 0.62, 0, 0, TAU); ctx.stroke();
    ctx.lineWidth = link * 0.16; ctx.strokeStyle = col; ctx.stroke();
    const gy = ((t * 70 + i * 211) % (len + 300)) - 150;
    if (gy > 0 && gy < len) {
      ctx.globalCompositeOperation = 'lighter';
      const sp = g.sprites.glow(pal.roseGlow, 1);
      ctx.globalAlpha = a * 0.5;
      ctx.drawImage(sp, -20, gy - 20, 40, 40);
    }
    ctx.restore();
  }
}

/** The hall's chains (world px): swags between the pillars. */
const HALL_CHAINS = [
  { x0: 150, y0: 330, x1: 452, y1: 268, sag: 70, link: 30 },
  { x0: 1770, y0: 330, x1: 1468, y1: 268, sag: 70, link: 30 },
  { x0: 452, y0: 210, x1: 630, y1: 182, sag: 46, link: 22 },
  { x0: 1468, y0: 210, x1: 1290, y1: 182, sag: 46, link: 22 },
];

// ---------------------------------------------------------------- the hall

const HZN = 712;   // the floor's horizon (world y)
const PILLARS = [[120, 1250, 150], [340, 1000, 104], [492, 860, 74], [598, 782, 52]];
const HALL_POW = 0.82;   // parallax: the hall zooms less than he does

const HALL_BOX = [-160, -240, 2240, 1520];   // the world rect of the cached hall image (x, y, w, h)

/** The hall is static in the world: painted once per palette and device scale. */
function hallImage(g, P, pal) {
  const q = g.scale;
  return cached(`hall|${P.charX}|${pal.navy}|${pal.fog}|${pal.royal}|${pal.roseGlow}|${q}`, () => {
    const [x0, y0, w, h] = HALL_BOX;
    const c = g.createCanvas(Math.ceil(w * q), Math.ceil(h * q));
    const x = c.getContext('2d');
    x.setTransform(q, 0, 0, q, -x0 * q, -y0 * q);
    paintHall(x, g, P, pal);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

function drawHall(g, P, pal, cam, a, kingK) {
  if (a <= 0.003) return;
  const ctx = g.ctx;
  ctx.save();
  cam.apply(ctx, g.scale, HALL_POW);
  ctx.globalAlpha *= a;
  const [x0, y0, w, h] = HALL_BOX;
  ctx.drawImage(hallImage(g, P, pal), x0, y0, w, h);
  if (kingK > 0) glowFill(g, ctx, P.charX, 318, 400, pal.royal, 0.22 * kingK);   // the window answers the crown
  ctx.restore();
}

function paintHall(ctx, g, P, pal) {
  const css = g.color.css, mix = g.color.mix, kingK = 0;
  ctx.save();
  // back wall
  const wall = ctx.createLinearGradient(0, -300, 0, HZN);
  wall.addColorStop(0, 'rgba(2,3,12,1)');
  wall.addColorStop(0.75, css(mix(pal.navy, pal.fog, 0.18), 1));
  wall.addColorStop(1, css(mix(pal.navy, pal.fog, 0.5), 1));
  ctx.fillStyle = wall;
  ctx.fillRect(-1600, -1600, 5120, HZN + 1600);
  // a great round window behind him, barely there: a halo
  {
    const cx = P.charX, cy = 318, R = 300;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gw = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
    gw.addColorStop(0, css(pal.royal, 0.16 + 0.1 * kingK));
    gw.addColorStop(0.75, css(pal.royal, 0.05));
    gw.addColorStop(1, css(pal.royal, 0));
    ctx.fillStyle = gw;
    ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
    ctx.strokeStyle = css(pal.roseGlow, 0.06 + 0.05 * kingK);
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const an = ((i + 0.5) / 12) * TAU;
      const px = cx + Math.cos(an) * R * 0.81, py = cy + Math.sin(an) * R * 0.81;
      ctx.moveTo(px + R * 0.16, py);
      ctx.arc(px, py, R * 0.16, 0, TAU);
    }
    ctx.stroke();
    ctx.restore();
  }
  // polished floor with a few faint seams
  const fl = ctx.createLinearGradient(0, HZN, 0, 1150);
  fl.addColorStop(0, css(mix(pal.navy, pal.fog, 0.6), 1));
  fl.addColorStop(0.3, css(mix(pal.navy, pal.fog, 0.22), 1));
  fl.addColorStop(1, 'rgba(2,3,12,1)');
  ctx.fillStyle = fl;
  ctx.fillRect(-1600, HZN, 5120, 1400);
  ctx.strokeStyle = css(pal.royal, 0.06);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = -6; k <= 6; k++) { ctx.moveTo(960 + k * 40, HZN); ctx.lineTo(960 + k * 620, 1700); }
  for (let k = 1; k < 7; k++) { const y = HZN + 900 / (1 + 1.1 * k); ctx.moveTo(-1600, y); ctx.lineTo(3520, y); }
  ctx.stroke();
  // pillars: dark stone, the inner edge catching the cold light
  for (const [x, base, w] of PILLARS) {
    for (const side of [-1, 1]) {
      const cx = side < 0 ? x : 1920 - x;
      const x0 = cx - w / 2;
      const gp = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      const inner = side < 0;
      const dark = '#020309', body = mix('#03040F', pal.navy, 0.8), lit = mix(pal.navy, pal.royal, 0.3), edge = mix(pal.royal, pal.roseGlow, 0.3);
      if (inner) { gp.addColorStop(0, dark); gp.addColorStop(0.62, body); gp.addColorStop(0.9, lit); gp.addColorStop(0.975, edge); gp.addColorStop(1, lit); }
      else { gp.addColorStop(0, lit); gp.addColorStop(0.025, edge); gp.addColorStop(0.1, lit); gp.addColorStop(0.38, body); gp.addColorStop(1, dark); }
      ctx.fillStyle = gp;
      ctx.fillRect(x0, -1600, w, base + 1600);
      ctx.fillRect(x0 - w * 0.12, base - w * 0.42, w * 1.24, w * 0.42);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x0 - w * 0.12, base - w * 0.42, w * 1.24, w * 0.06);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = Math.max(1, w * 0.025);
      ctx.beginPath();
      for (const f of [0.28, 0.5, 0.72]) { ctx.moveTo(x0 + w * f, -1600); ctx.lineTo(x0 + w * f, base - w * 0.42); }
      ctx.stroke();
    }
  }
  // low fog over the floor
  ctx.globalCompositeOperation = 'lighter';
  const fg = ctx.createLinearGradient(0, HZN - 220, 0, HZN + 160);
  fg.addColorStop(0, css(pal.royal, 0)); fg.addColorStop(0.6, css(pal.royal, 0.13)); fg.addColorStop(1, css(pal.royal, 0));
  ctx.fillStyle = fg;
  ctx.fillRect(-1600, HZN - 220, 5120, 380);
  ctx.restore();
}

/** The cold spotlight from above and its pool on the floor (world px, character camera). */
function drawSpot(g, P, pal, cam, a, beat = 0) {
  if (a <= 0.003) return;
  const ctx = g.ctx, css = g.color.css;
  ctx.save();
  cam.apply(ctx, g.scale, 1);
  ctx.globalAlpha *= a;
  ctx.globalCompositeOperation = 'lighter';
  const x = P.charX, y = P.groundY;
  const gc = ctx.createLinearGradient(0, y - 1300, 0, y);
  gc.addColorStop(0, css(pal.roseGlow, 0));
  gc.addColorStop(0.6, css(pal.roseGlow, 0.04 * (1 + 0.6 * beat)));
  gc.addColorStop(1, css(pal.roseGlow, 0.08 * (1 + 0.6 * beat)));
  ctx.fillStyle = gc;
  ctx.beginPath();
  ctx.moveTo(x - 60, y - 1300); ctx.lineTo(x + 60, y - 1300); ctx.lineTo(x + 290, y); ctx.lineTo(x - 290, y);
  ctx.closePath(); ctx.fill();
  const pool = ctx.createRadialGradient(x, y, 0, x, y, 330);
  pool.addColorStop(0, css(pal.roseGlow, 0.32 * (1 + 0.4 * beat)));
  pool.addColorStop(0.5, css(pal.royal, 0.12));
  pool.addColorStop(1, css(pal.royal, 0));
  ctx.fillStyle = pool;
  ctx.translate(x, y); ctx.scale(1, 0.2); ctx.translate(-x, -y);
  ctx.fillRect(x - 330, y - 330, 660, 660);
  ctx.restore();
}

// ---------------------------------------------------------------- the crown of light

function crownGeo(w) {
  return cached(`crown|${w}`, () => {
    const h = w * 0.62, band = w * 0.2, V = -band - (h - band) * 0.35;
    const pk = (a) => [a * w, -h * (a === 0 ? 1.12 : 1)];
    const lines = {
      bandL: [[-w / 2, -band], [-w / 2, 0], [0, 0]],
      bandL2: [[-w / 2, -band], [0, -band]],
      bandR: [[w / 2, -band], [w / 2, 0], [0, 0]],
      bandR2: [[w / 2, -band], [0, -band]],
      ptsL: [[-w / 2, -band], pk(-0.5), [-0.375 * w, V], pk(-0.25), [-0.125 * w, V]],
      ptsR: [[w / 2, -band], pk(0.5), [0.375 * w, V], pk(0.25), [0.125 * w, V]],
      top: [[-0.125 * w, V], pk(0), [0.125 * w, V]],
    };
    const meta = {};
    const outline = [];
    for (const [k, pts] of Object.entries(lines)) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      meta[k] = { pts, cum, len: cum[cum.length - 1] };
      for (let i = 1; i < pts.length; i++) for (let s = 0; s < 1; s += 0.25) outline.push([lerp(pts[i - 1][0], pts[i][0], s), lerp(pts[i - 1][1], pts[i][1], s)]);
    }
    const pearls = [-0.5, -0.25, 0, 0.25, 0.5].map((a) => { const p = pk(a); return [p[0], p[1] - w * 0.036, w * 0.022]; });
    const jewels = [-0.3, 0, 0.3].map((a) => [a * w, -band / 2, w * 0.034]);
    return { h, band, V, lines: meta, pearls, jewels, outline };
  });
}

/** Path of the first `prog` (0..1) of a polyline; returns the tip. */
function partialPath(ctx, m, prog) {
  const Lg = m.len * clamp(prog);
  ctx.moveTo(m.pts[0][0], m.pts[0][1]);
  let tip = m.pts[0];
  for (let i = 1; i < m.pts.length; i++) {
    if (m.cum[i] <= Lg) { ctx.lineTo(m.pts[i][0], m.pts[i][1]); tip = m.pts[i]; continue; }
    const f = (Lg - m.cum[i - 1]) / (m.cum[i] - m.cum[i - 1]);
    tip = [lerp(m.pts[i - 1][0], m.pts[i][0], f), lerp(m.pts[i - 1][1], m.pts[i][1], f)];
    ctx.lineTo(tip[0], tip[1]);
    break;
  }
  return tip;
}

const CROWN_POW = 0.94;   // parallax: the crown is just behind him

function drawCrownLight(g, t, F, T, P, pal, cam) {
  if (t < T.future) return;
  const ctx = g.ctx, css = g.color.css;
  const geo = crownGeo(P.crownW);
  const pA = draw0(t, T.future, 0.6), pB = draw0(t, T.ruler, 0.6), pC = draw0(t, T.king, 0.25, 0.3);
  const boost = 1 + 1.3 * (decay(t, T.future, 0.3) + decay(t, T.ruler, 0.3)) + 1.6 * decay(t, T.king, 0.35);
  const bp = typeof F === 'object' && F && F.c ? F.c.beat_phase : 0.5;
  const shimmer = 0.9 + 0.07 * Math.sin(t * 7.3) + 0.18 * Math.exp(-4 * clamp(bp || 0));   // a pulse on every beat
  ctx.save();
  cam.apply(ctx, g.scale, CROWN_POW);
  ctx.translate(P.charX, P.crownY);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const segs = [['bandL', pA], ['bandL2', pA], ['bandR', pA], ['bandR2', pA], ['ptsL', pB], ['ptsR', pB], ['top', pC]];
  const passes = [[14, pal.gold, 0.2], [5, pal.gold, 0.6], [2, '#FFF6D8', 0.95]];
  const tips = [];
  for (const [w, col, al] of passes) {
    ctx.lineWidth = w;
    ctx.strokeStyle = css(col, clamp(al * boost * shimmer));
    ctx.beginPath();
    for (const [k, p] of segs) {
      if (p <= 0) continue;
      const tip = partialPath(ctx, geo.lines[k], p);
      if (w === 2 && p < 0.999) tips.push(tip);
    }
    ctx.stroke();
  }
  // jewels on the band (with the band), pearls on the points (on the crown's completion)
  const jk = clamp((t - T.future - 0.3) / 0.25);
  geo.jewels.forEach(([x, y, r], i) => {
    if (jk <= 0) return;
    const s = r * outBack(jk);
    ctx.fillStyle = css(i === 1 ? '#FF5A6E' : pal.roseGlow, 0.7 * jk);
    ctx.strokeStyle = css(pal.gold, 0.9 * jk);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.8, y); ctx.closePath();
    ctx.fill(); ctx.stroke();
  });
  const pk = clamp((t - T.king - 0.05) / 0.25);
  if (pk > 0) {
    ctx.fillStyle = css('#FFF6D8', 0.95 * pk);
    geo.pearls.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r * outBack(pk), 0, TAU); ctx.fill(); });
  }
  const sp = g.sprites.glow(pal.gold, 1);
  for (const [x, y] of tips) ctx.drawImage(sp, x - 34, y - 34, 68, 68);
  // on completion the crown fills with light for a moment
  if (pC > 0) {
    const fk = 0.12 * decay(t, T.king, 0.4) + 0.02;
    ctx.fillStyle = css(pal.gold, fk);
    ctx.beginPath();
    const L = geo.lines;
    ctx.moveTo(-P.crownW / 2, 0);
    for (const p of L.ptsL.pts) ctx.lineTo(p[0], p[1]);
    for (const p of L.top.pts) ctx.lineTo(p[0], p[1]);
    for (let i = L.ptsR.pts.length - 1; i >= 0; i--) ctx.lineTo(L.ptsR.pts[i][0], L.ptsR.pts[i][1]);
    ctx.lineTo(P.crownW / 2, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the emperor (lit in a layer)

/** Closed eyelids drawn over the head's open eyes (head units), keeping the fringe lock over the right eye. */
function eyeLids(ctx, j, close) {
  if (close <= 0.003) return;
  const r = D.headR * j.U;
  ctx.save();
  ctx.translate(j.headC[0], j.headC[1]);
  ctx.rotate(j.headAng);
  if (j.facing < 0) ctx.scale(-1, 1);
  ctx.scale(r, r);
  ctx.beginPath();
  ctx.rect(-1, 0.25, 2, 0.5);
  ctx.moveTo(0.6, 0.08); ctx.lineTo(0.4, 0.47); ctx.lineTo(0.2, 0.1); ctx.closePath();
  ctx.clip('evenodd');
  ctx.globalAlpha *= close;
  ctx.lineCap = 'round';
  for (const x of [-0.38, 0.38]) {
    const o = x > 0 ? 1 : -1;
    ctx.fillStyle = KZ.skin;
    ctx.beginPath(); ctx.ellipse(x, 0.52, 0.222, 0.142, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 0.01, 0.43, 0.262, 0.082, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = KZ.ink; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(x - o * 0.2, 0.535); ctx.quadraticCurveTo(x + o * 0.02, 0.615, x + o * 0.215, 0.525); ctx.stroke();
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(x + o * 0.19, 0.54); ctx.lineTo(x + o * 0.27, 0.5);
    ctx.moveTo(x + o * 0.12, 0.575); ctx.lineTo(x + o * 0.16, 0.62);
    ctx.moveTo(x + o * 0.03, 0.588); ctx.lineTo(x + o * 0.04, 0.635);
    ctx.stroke();
    ctx.strokeStyle = KZ.liner; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.moveTo(x + o * 0.06, 0.66); ctx.lineTo(x + o * 0.24, 0.61); ctx.stroke();
  }
  ctx.restore();
}

/** His bounding box on screen, in device px (clamped to the frame), with room for outlines and rims. */
function charBox(g, J, cam) {
  const ds = g.scale, U = J.U, r = D.headR * U, pad = 0.06 * U;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, p) => { x0 = Math.min(x0, x - p); x1 = Math.max(x1, x + p); y0 = Math.min(y0, y - p); y1 = Math.max(y1, y + p); };
  for (const k of ['pelvis', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR']) add(J[k][0], J[k][1], pad);
  add(J.headC[0], J.headC[1], 1.5 * r);
  const m = 16;
  const bx0 = Math.max(0, Math.floor(cam.sx(x0) * ds) - m), by0 = Math.max(0, Math.floor(cam.sy(y0) * ds) - m);
  const bx1 = Math.min(g.devW, Math.ceil(cam.sx(x1) * ds) + m), by1 = Math.min(g.devH, Math.ceil(cam.sy(y1) * ds) + m);
  const box = { x: bx0, y: by0, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0) };
  box.L = { x: box.x / ds, y: box.y / ds, w: box.w / ds, h: box.h / ds };   // the same in logical px
  return box;
}

/**
 * The character into a layer, lit like a night anime close-up: a light map (cool key light from the
 * upper left on the head and from the left on the body, blue-violet shadow, falling off towards the
 * feet) clipped to his silhouette and multiplied in; then the rose's glow on his neck and, once the
 * crown is complete, its gold from behind. Every pass is limited to his bounding box.
 */
function charLayer(g, P, pal, cam, J, { dark = 0, eyesClosed = 0, kingK = 0, roseGlow = 0 } = {}) {
  const ds = g.scale, css = g.color.css;
  const C = g.layer('kzRise-char');
  const box = charBox(g, J, cam);
  C.box = box;
  if (!box.w || !box.h) return C;
  const B = box.L;
  const cx = C.ctx;
  cam.apply(cx, ds, 1);
  const ow = 3 * Math.pow(cam.z, -0.65);
  drawPuppet(cx, D, J.pose, { x: P.charX, ground: P.groundY, view: 'front', scale: P.charScale, outlineW: ow, devScale: ds });
  eyeLids(cx, J, eyesClosed);

  // the light, in screen px: the lit side keeps his colours, the shadow side sinks into a deep
  // blue-violet. The head is lit from the upper left (the terminator curves round the far cheek), the
  // body from the left, darker towards the feet.
  cx.setTransform(ds, 0, 0, ds, 0, 0);
  cx.globalCompositeOperation = 'source-atop';
  const r = D.headR * J.U * cam.z, U = J.U * cam.z;
  const hx = cam.sx(J.headC[0]), hy = cam.sy(J.headC[1]);
  const bx = cam.sx(J.pelvis[0]), neckY = cam.sy(J.neck[1]) + 0.02 * U, feetY = cam.sy(J.feetY);
  const SH = '#130C5C', sa = 0.64;
  const yCut = clamp(neckY, B.y, B.y + B.h);
  if (yCut > B.y) {
    const lx = hx - 1.45 * r, ly = hy - 0.95 * r, R = 2.8 * r;
    const gh = cx.createRadialGradient(lx, ly, 0, lx, ly, R);
    gh.addColorStop(0, css(SH, 0)); gh.addColorStop(0.68, css(SH, 0)); gh.addColorStop(0.8, css(SH, sa)); gh.addColorStop(1, css(SH, sa));
    cx.fillStyle = gh;
    cx.fillRect(B.x, B.y, B.w, yCut - B.y);
  }
  if (B.y + B.h > yCut) {
    const gb = cx.createLinearGradient(bx - 0.3 * U, 0, bx + 0.08 * U, 0);
    gb.addColorStop(0, css(SH, 0)); gb.addColorStop(0.62, css(SH, 0)); gb.addColorStop(1, css(SH, sa));
    cx.fillStyle = gb;
    cx.fillRect(B.x, yCut, B.w, B.y + B.h - yCut);
    const gv = cx.createLinearGradient(0, neckY, 0, feetY);
    gv.addColorStop(0, css(SH, 0)); gv.addColorStop(0.5, css(SH, 0.22)); gv.addColorStop(1, css(SH, 0.5));
    cx.fillStyle = gv;
    cx.fillRect(B.x, yCut, B.w, B.y + B.h - yCut);
  }
  // the key light's sheen on his hair (an anime "angel ring" on the lit side)
  cx.save();
  cam.apply(cx, ds, 1);
  const rw = D.headR * J.U;
  cx.translate(J.headC[0], J.headC[1]);
  cx.rotate(J.headAng);
  if (J.facing < 0) cx.scale(-1, 1);
  cx.scale(rw, rw);
  cx.lineCap = 'round';
  cx.strokeStyle = css('#FFFFFF', 0.32);
  cx.lineWidth = 0.085;
  cx.beginPath(); cx.arc(0, -0.08, 0.98, Math.PI * 1.1, Math.PI * 1.38); cx.stroke();
  cx.lineWidth = 0.05;
  cx.beginPath(); cx.arc(0, -0.08, 0.98, Math.PI * 1.43, Math.PI * 1.52); cx.stroke();
  cx.restore();
  if (dark > 0) {
    cx.fillStyle = css('#020412', clamp(dark));
    cx.fillRect(B.x, B.y, B.w, B.h);
  }

  // the rose's glow on his neck and jaw; the crown's gold from behind
  if (roseGlow > 0) {
    const nr = neckRose(J);
    const rx = cam.sx(nr.x), ry = cam.sy(nr.y), rr = nr.r * cam.z * 4.5;
    const gg = cx.createRadialGradient(rx, ry, 0, rx, ry, rr);
    gg.addColorStop(0, css(pal.roseGlow, 0.42 * roseGlow));
    gg.addColorStop(1, css(pal.roseGlow, 0));
    cx.fillStyle = gg;
    cx.fillRect(rx - rr, ry - rr, 2 * rr, 2 * rr);
  }
  if (kingK > 0) {
    const span = Math.max(1.4 * r, 0.22 * U);
    const gk = cx.createLinearGradient(hx - span, 0, hx + span, 0);
    gk.addColorStop(0, css(pal.gold, 0.2 * kingK));
    gk.addColorStop(0.45, css(pal.gold, 0));
    gk.addColorStop(1, css(pal.gold, 0.06 * kingK));
    cx.fillStyle = gk;
    cx.fillRect(B.x, B.y, B.w, B.h);
  }
  cx.globalCompositeOperation = 'source-over';
  return C;
}

/**
 * A rim of light along the silhouette's edges that face the light (dx > 0: from the upper right, dx < 0:
 * from the upper left), in screen px. Only inside his box; the frame edges he is cut by get no rim.
 */
function rimLight(g, C, dx, color, alpha, { color2 = null, split = 0, up = 0.35 } = {}) {
  const box = C.box;
  if (alpha <= 0.003 || Math.abs(dx) < 0.3 || !box || !box.w || !box.h) return;
  const ds = g.scale;
  const dxd = dx * ds, dyd = Math.abs(dx) * up * ds;
  const R = g.layer('kzRise-rim');
  const rx = R.ctx;
  rx.setTransform(1, 0, 0, 1, 0, 0);
  rx.drawImage(C.canvas, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
  rx.globalCompositeOperation = 'source-in';
  if (color2) {
    const gr = rx.createLinearGradient((split - 60) * ds, 0, (split + 60) * ds, 0);
    gr.addColorStop(0, color2); gr.addColorStop(1, color);
    rx.fillStyle = gr;
  } else rx.fillStyle = color;
  rx.fillRect(box.x, box.y, box.w, box.h);
  rx.globalCompositeOperation = 'destination-out';
  rx.drawImage(C.canvas, box.x, box.y, box.w, box.h, box.x - dxd, box.y + dyd, box.w, box.h);
  rx.globalCompositeOperation = 'source-over';
  let x0 = box.x, x1 = box.x + box.w, y0 = box.y;
  const cut = Math.ceil(Math.abs(dxd)) + 1;
  if (dx > 0 && x1 >= g.devW) x1 -= cut;
  if (dx < 0 && x0 <= 0) x0 += cut;
  if (y0 <= 0) y0 += Math.ceil(dyd) + 1;
  const w = x1 - x0, h = box.y + box.h - y0;
  if (w <= 0 || h <= 0) return;
  const ctx = g.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(alpha);
  ctx.drawImage(R.canvas, x0, y0, w, h, x0, y0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------- particles

/** Slow drifting petals (far: sharp; near: soft bokeh), closed form. */
function drawPetals(g, t, P, pal, cam, { near = false, calm = 0 } = {}) {
  const ctx = g.ctx;
  const spr = petalSprite(g, pal);
  const rate = Math.max(0, P.petals) * (near ? 0.35 : 1);
  if (rate <= 0) return;
  const life = near ? 7 : 10;
  const seed = near ? 77 : 71;
  const bk = g.sprites.bokeh(pal.royal, 0.3, 0.2);
  ctx.save();
  const k0 = Math.max(0, Math.ceil((t - life) * rate)), k1 = Math.floor(t * rate);
  for (let k = k0; k <= k1; k++) {
    const age = t - k / rate;
    if (age < 0 || age > life) continue;
    const u = age / life;
    const r1 = hashU(seed, k, 1), r2 = hashU(seed, k, 2), r3 = hashU(seed, k, 3), r4 = hashU(seed, k, 4);
    let x = -80 + r1 * 2080 + (16 + 26 * r3) * age + 30 * Math.sin(age * 0.7 + r2 * TAU);
    let y = -60 + r2 * 900 + (10 + 18 * r4) * age + 16 * Math.sin(age * 0.9 + r1 * TAU);
    const zz = Math.pow(cam.z / cam.z0, near ? 0.35 : 0.12);   // the pull-back slides them in a little
    x = 960 + (x - 960) * zz; y = 540 + (y - 540) * zz;
    let a = Math.sin(Math.PI * u) * (near ? 0.5 : 0.85);
    if (calm > 0) a *= 1 - calm * inCalm(x, y);
    if (a <= 0.01) continue;
    if (near) {
      const size = 46 + 40 * r3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.2;
      ctx.drawImage(bk, x - size, y - size, size * 2, size * 2);
      continue;
    }
    const size = 11 + 13 * r3;
    const spin = age * (0.5 + 1.2 * r4) * (r1 < 0.5 ? -1 : 1) + r2 * TAU;
    const tumble = 0.25 + 0.75 * Math.abs(Math.cos(age * (0.8 + r3) + r1 * 5));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(spin); ctx.scale(1, tumble);
    ctx.drawImage(spr, -size, -size, size * 2, size * 2);
    ctx.restore();
  }
  ctx.restore();
}

/** Petals blown out from behind him on P.kingT (screen px). */
function petalBurst(g, t, t0, x0, y0, scale, pal) {
  const age = t - t0;
  if (age < 0 || age > 3.2) return;
  const ctx = g.ctx, spr = petalSprite(g, pal);
  ctx.save();
  for (let k = 0; k < 36; k++) {
    const r1 = hashU(91, k, 1), r2 = hashU(91, k, 2), r3 = hashU(91, k, 3), r4 = hashU(91, k, 4);
    const ang = -Math.PI / 2 + (r1 - 0.5) * 3.4;
    const sp = (520 + 760 * r2) * scale;
    const dv = (1 - Math.exp(-1.7 * age)) / 1.7;
    const ox = (r4 - 0.5) * 160 * scale, oy = (r3 - 0.5) * 120 * scale;
    const x = x0 + ox + Math.cos(ang) * sp * dv;
    const y = y0 + oy + Math.sin(ang) * sp * dv + 70 * scale * age * age;
    const a = (1 - smooth(age / 3.2)) * smooth(age / 0.08) * 0.95;
    const size = (12 + 14 * r3) * Math.sqrt(scale);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(age * (2 + 3 * r3) + r1 * TAU); ctx.scale(1, 0.3 + 0.7 * Math.abs(Math.cos(age * 3 + r2 * 6)));
    ctx.drawImage(spr, -size, -size, size * 2, size * 2);
    ctx.restore();
  }
  ctx.restore();
}

/** Sparks flying out from a set of origins (screen px), born at t0. */
function drawSparks(g, t, t0, origins, cx, cy, scale, pal, n = 70, seed = 93) {
  const age = t - t0;
  if (age < 0 || age > 1.9 || !origins.length) return;
  const ctx = g.ctx;
  const sp = g.sprites.glow(pal.gold, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < n; k++) {
    const r1 = hashU(seed, k, 1), r2 = hashU(seed, k, 2), r3 = hashU(seed, k, 3);
    const life = 0.8 + 1.0 * r3;
    if (age > life) continue;
    const [ox, oy] = origins[Math.floor(hashU(seed, k, 4) * origins.length) % origins.length];
    let dx = ox - cx, dy = oy - cy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const ang = Math.atan2(dy, dx) + (r1 - 0.5) * 1.2;
    const v = (260 + 700 * r2) * scale;
    const dv = (1 - Math.exp(-2.4 * age)) / 2.4;
    const x = ox + Math.cos(ang) * v * dv, y = oy + Math.sin(ang) * v * dv + 160 * scale * age * age;
    const s = (4 + 6 * r3) * Math.sqrt(scale);
    ctx.globalAlpha = 1 - age / life;
    ctx.drawImage(sp, x - s, y - s, 2 * s, 2 * s);
  }
  ctx.restore();
}

/** A four-pointed glint (screen px). */
function glint(ctx, g, x, y, size, rot, alpha, pal) {
  if (alpha <= 0.003 || size <= 0.5) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(alpha);
  const gs = g.sprites.glow(pal.roseGlow, 1);
  ctx.drawImage(gs, x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6);
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#F4F8FF';
  for (const [lx, ly] of [[size, size * 0.06], [size * 0.55, size * 0.05]]) {
    ctx.beginPath();
    ctx.moveTo(-lx, 0); ctx.lineTo(0, -ly); ctx.lineTo(lx, 0); ctx.lineTo(0, ly); ctx.closePath();
    ctx.fill();
    ctx.rotate(Math.PI / 2);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the frame

export function draw(g, t, F, P, S) {
  const ctx = g.ctx, css = g.color.css, ds = g.scale;
  const pal = palette(S);
  const T = timing(F, P, S);
  const notes = humNotes(F, T);
  const bl = bloomAt(t, notes);
  const drums = events(F, T, ['kick', 'snare'], Math.max(T.t0, t - 6), t);       // rattle the chains
  const hits = events(F, T, ['hit'], Math.max(T.t0, t - 3), t);                   // flashes and rings
  const hitK = hits.reduce((m, h) => Math.max(m, h.s * decay(t, h.t, 0.12)), 0);
  const kickK = drums.reduce((m, h) => Math.max(m, h.s * decay(t, h.t, 0.1)), 0);
  const JR = restJoints(P);
  const cam = cameraAt(t, T, P, JR);
  const pose = poseAt(t, T);
  const J = solve(D, pose, { x: P.charX, ground: P.groundY, view: 'front', scale: P.charScale });
  J.pose = pose;

  const rose1 = 1 - smooth((t - T.rap) / 0.7);               // the bloom's world (fades through the pull-back)
  const charA = smooth((t - T.rap) / 0.4);                    // the emperor appears from the dark
  const revealK = decay(t, T.reveal, 0.16) * after(t, T.reveal);
  const calm = 1 - smooth((t - T.hum) / 0.6);                 // the title card's calm (the humming)
  const hallA = smooth((2.7 - cam.z) / 1.3) * after(t, T.rap);
  const kingK = t >= T.king ? 0.55 + 0.45 * decay(t, T.king, 0.6) : 0;
  const voc = clamp(F.c.voc_lvl || 0);
  const portrait = charA * smooth((cam.z - 1.8) / 1.4);       // how much of a close-up this is

  // ---------------- background, fog, the hall
  drawBackdrop(g, t, P, pal, 0.5 * bl.flash + 0.8 * revealK + 0.4 * hitK + 0.25 * clamp(F.c.bass_on || 0), hallA);   // the bass breathes in the fog
  if (portrait > 0.01 && t < T.king) {
    // the cold key light's source, off to the upper left of his face
    const r = D.headR * J.U * cam.z;
    glowFill(g, ctx, cam.sx(J.headC[0]) - 2.4 * r, cam.sy(J.headC[1]) - 0.6 * r, 4.2 * r, pal.royal, 0.32 * portrait);
    // out-of-focus lights far behind him
    const bk = g.sprites.bokeh(pal.royal, 0.18, 0.3), bk2 = g.sprites.bokeh(pal.roseGlow, 0.18, 0.3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const r1 = hashU(83, i, 1), r2 = hashU(83, i, 2), r3 = hashU(83, i, 3);
      const x = ((((r1 * 2200 + 14 * t * (r3 - 0.5)) % 2200) + 2200) % 2200) - 140, y = 110 + r2 * 860 + 10 * Math.sin(t * 0.4 + i);
      const sz = 40 + 80 * r3;
      ctx.globalAlpha = portrait * (0.07 + 0.1 * hashU(83, i, 4)) * (0.8 + 0.2 * Math.sin(t * 1.3 + i * 2));
      ctx.drawImage(i % 3 ? bk : bk2, x - sz, y - sz, 2 * sz, 2 * sz);
    }
    ctx.restore();
  }
  drawHall(g, P, pal, cam, hallA, kingK);

  // ---------------- the rays and the crown of light (behind him)
  const crownC = cam.at(P.charX, P.crownY - crownGeo(P.crownW).h * 0.5, CROWN_POW);
  if (t >= T.king) {
    const ra = 0.05 + 0.14 * decay(t, T.king, 0.5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    rays(ctx, { cx: crownC[0], cy: crownC[1], n: 12, rot: 0.06 * (t - T.king) + 0.13, spread: 0.05, length: 1700, color: css(pal.gold, ra), fade: css(pal.gold, 0) });
    const gr = (380 + 700 * outCubic((t - T.king) / 0.5)) * Math.pow(cam.z, CROWN_POW);
    glowFill(g, ctx, crownC[0], crownC[1], Math.min(gr, 760), pal.gold, 0.1 + 0.5 * decay(t, T.king, 0.3));
    // a gold shockwave on the beat
    const sa = t - T.king;
    if (sa < 0.7) {
      const R = (120 + 1500 * outCubic(sa / 0.7)) * Math.pow(cam.z, CROWN_POW);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 26 * (1 - sa / 0.7) + 2;
      ctx.strokeStyle = css(pal.gold, 0.5 * (1 - sa / 0.7) ** 1.5);
      ctx.beginPath(); ctx.arc(crownC[0], crownC[1], R, 0, TAU); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = css('#FFF6D8', 0.8 * (1 - sa / 0.7) ** 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawCrownLight(g, t, F, T, P, pal, cam);

  // the hall's chains, snapping on P.kingT
  if (hallA > 0.01) {
    const broken = t >= T.king ? 0.08 + 0.92 * outCubic((t - T.king) / 0.6) : 0;
    ctx.save();
    cam.apply(ctx, ds, HALL_POW);
    const lit = 0.3 + 0.7 * kingK;
    const shiver = t >= T.king - 0.4 && t < T.king ? 3 * Math.sin(t * 95) * (t - T.king + 0.4) / 0.4 : 0;
    const gone = 1 - smooth((t - T.king - 0.25) / 0.75);   // the broken halves fall away into the dark
    for (const c of HALL_CHAINS) {
      drawChain(ctx, c.x0, c.y0 + shiver, c.x1, c.y1, {
        sag: c.sag, link: c.link, width: c.link * 0.22, broken,
        color: g.color.mix(pal.navy, pal.chain, 0.42 + 0.5 * lit), deep: g.color.mix(pal.navy, KZ.chainDeep, 0.6), alpha: hallA * gone,
      });
    }
    ctx.restore();
    if (t >= T.king && t < T.king + 1.5) {
      const origins = HALL_CHAINS.map((c) => cam.at((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2 + c.sag, HALL_POW));
      drawSparks(g, t, T.king, origins, crownC[0], crownC[1], 0.5, pal, 40, 97);
    }
  }

  // ---------------- the bloom: glow, rings, vines, the rose
  const nrJ = neckRose(J);
  const roseS = t < T.rap ? { x: P.roseX, y: P.roseY, k: 1 } : { x: cam.sx(nrJ.x), y: cam.sy(nrJ.y), k: cam.z / cam.z0 };
  const pulse = 1 + 0.07 * Math.max(hitK, 0.6 * kickK) + 0.035 * bl.flash;   // every drum hit throbs the rose
  const roseR = P.roseR * (0.6 + 0.4 * smooth(bl.open)) * pulse;
  if (rose1 > 0.003) {
    ctx.save();
    ctx.translate(roseS.x, roseS.y);
    ctx.scale(roseS.k, roseS.k);
    ctx.translate(-P.roseX, -P.roseY);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowFill(g, ctx, P.roseX, P.roseY, roseR * 3.4, pal.royal, clamp(rose1 * (0.12 + 0.18 * smooth(bl.open) + 0.35 * bl.flash + 0.5 * revealK + 0.3 * hitK)));
    // rings of light: one per humming note and per drum hit
    ctx.lineCap = 'round';
    ctx.globalAlpha = 1;
    const rings = notes.filter((n) => n.t <= t && t - n.t < 1.6).concat(hits.filter((h) => h.t >= T.reveal && t - h.t < 1.2).map((h) => ({ t: h.t, v: 0.55 * h.s })));
    if (t >= T.reveal && t - T.reveal < 1.6) rings.push({ t: T.reveal, v: 1 });
    for (const e of rings) {
      const life = e.t >= T.reveal ? 1.2 : 1.6;
      const u = (t - e.t) / life;
      const R = P.roseR * 0.85 + (e.t >= T.reveal ? 420 : 300) * outCubic(u);
      const a = rose1 * e.v * Math.pow(1 - u, 1.6);
      ctx.strokeStyle = css(pal.royal, 0.2 * a); ctx.lineWidth = 34 * (1 - 0.5 * u);
      ctx.beginPath(); ctx.arc(P.roseX, P.roseY, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = css(pal.roseGlow, 0.32 * a * (1 - u)); ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
    // motes of light: the pad's notes twinkle around the rose
    if (Array.isArray(F.ev && F.ev.pad_notes)) {
      const sp = g.sprites.glow(pal.roseGlow, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const n of F.between('pad_notes', Math.max(T.t0, t - 1.4), t + 0.5 / T.fps)) {
        const age = t - T.L(n[0]);
        if (age < 0 || age > 1.4) continue;
        const k = Math.round(n[0] * 1000) * 131 + (n[2] | 0);
        const ang = hashU(61, k, 1) * TAU, rad = 200 + 300 * hashU(61, k, 2);
        const x = P.roseX + Math.cos(ang) * rad, y = P.roseY + Math.sin(ang) * rad * 0.8 - 26 * age;
        let a = rose1 * clamp(typeof n[3] === 'number' ? n[3] : 0.5) * Math.pow(1 - age / 1.4, 1.5) * smooth(age / 0.05);
        if (calm > 0) a *= 1 - calm * inCalm(x, y);
        if (a <= 0.01) continue;
        const sz = 5 + 9 * hashU(61, k, 3);
        ctx.globalAlpha = clamp(a);
        ctx.drawImage(sp, x - sz, y - sz, 2 * sz, 2 * sz);
      }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(P.roseX, P.roseY);
    drawVines(ctx, g, vineSet(S.seed % 9973, Math.max(0, P.vines | 0)), bl.grow, t, pal, { flash: clamp(bl.flash + revealK + 0.6 * hitK), alpha: rose1 });
    ctx.restore();
    if (t < T.rap) {
      const rot = (JR.headAng + 0.4) - 0.8 * (1 - smooth(bl.open));
      litRose(g, ctx, P.roseX, P.roseY, roseR, { rot, open: bl.open, pal, glow: 0.35 * bl.flash + 0.9 * revealK + 0.4 * hitK, bright: bl.flash });
    }
    ctx.restore();
  }

  // ---------------- edge chains of the dark (they rattle on the drum burst)
  drawEdgeChains(g, t, pal, drums, 1 - smooth((t - T.rap) / 0.5), clamp(revealK * 1.2 + 0.5 * kickK), roseS.k);

  // far petals
  drawPetals(g, t, P, pal, cam, { calm });

  // ---------------- the emperor
  if (t >= T.rap) {
    if (t >= T.king) petalBurst(g, t, T.king, crownC[0], crownC[1] + 60, Math.pow(cam.z, CROWN_POW), pal);
    if (t >= T.king && t < T.king + 2) {
      const geo = crownGeo(P.crownW);
      const origins = geo.outline.map(([x, y]) => cam.at(P.charX + x, P.crownY + y, CROWN_POW));
      drawSparks(g, t, T.king, origins, crownC[0], crownC[1], Math.pow(cam.z, CROWN_POW), pal, 70, 93);
    }
    // the push-in's speed lines, behind him so he stays clean
    if (t >= T.king) {
      const u = clamp((t - T.king) / Math.max(0.1, T.t1 - T.king));
      const [wx, wy] = headPoint(J, 0, 0.5);
      speedLines(ctx, { cx: cam.sx(wx), cy: cam.sy(wy), n: Math.round(50 + 50 * u), inner: lerp(560, 300, u), outer: 1600, color: '#FFFFFF',
        alpha: P.speedAlpha * smooth(0.15 + 0.85 * u), seed: 11, frame: F.frame, hold: 2, width: 0.0045 });
    }
    const fps = T.fps;
    const eyesClosed = t >= T.vision ? 0 : t >= T.vision - 1.5 / fps ? 0.5 : 1;
    const C = charLayer(g, P, pal, cam, J, { dark: 0.85 * (1 - smooth((t - T.rap) / 1.1)), eyesClosed, kingK, roseGlow: 0.7 + 0.3 * voc });
    if (hallA > 0.01) {
      // reflection in the floor, shadow at his feet, the spotlight
      const fy = cam.sy(P.groundY) * ds, bb = C.box;
      if (bb.w && bb.h) {
        ctx.save();
        ctx.setTransform(1, 0, 0, -1, 0, 2 * fy);
        ctx.globalAlpha = 0.18 * hallA * charA;
        ctx.drawImage(C.canvas, bb.x, bb.y, bb.w, bb.h, bb.x, bb.y, bb.w, bb.h);
        ctx.restore();
      }
      ctx.save();
      const fade = ctx.createLinearGradient(0, cam.sy(P.groundY), 0, cam.sy(P.groundY + 240));
      fade.addColorStop(0, 'rgba(3,5,22,0)'); fade.addColorStop(1, `rgba(3,5,22,${(0.9 * hallA).toFixed(3)})`);
      ctx.fillStyle = fade;
      ctx.fillRect(0, cam.sy(P.groundY), 1920, 1080);
      cam.apply(ctx, ds, 1);
      const sh = ctx.createRadialGradient(P.charX, P.groundY, 0, P.charX, P.groundY, 120);
      sh.addColorStop(0, `rgba(0,0,0,${(0.55 * hallA).toFixed(3)})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.translate(P.charX, P.groundY); ctx.scale(1, 0.18); ctx.translate(-P.charX, -P.groundY);
      ctx.fillRect(P.charX - 120, P.groundY - 120, 240, 240);
      ctx.restore();
      drawSpot(g, P, pal, cam, hallA, Math.exp(-4 * clamp(F.c.beat_phase || 0)));   // the spot pulses on the beat
    }
    if (C.box.w && C.box.h) {
      const bb = C.box;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = charA;
      ctx.drawImage(C.canvas, bb.x, bb.y, bb.w, bb.h, bb.x, bb.y, bb.w, bb.h);
      ctx.restore();
    }
    const rS = D.headR * J.U * cam.z;
    const rimA = smooth((t - T.rap - 0.1) / 0.6) * charA;
    // a cold rim from the upper right; once the crown burns behind him its gold takes the upper left
    const gk = t >= T.king ? clamp(1.6 * kingK) : 0;
    rimLight(g, C, clamp(rS * 0.028, 1.5, 10), g.color.mix(pal.roseGlow, '#FFFFFF', 0.25), 0.95 * rimA * (1 + 0.3 * hitK),
      gk > 0 ? { color2: g.color.mix(pal.roseGlow, pal.gold, gk), split: cam.sx(J.headC[0]), up: 0.35 + 0.5 * gk } : {});
    // the rose on his neck, glowing
    const nrR = nrJ.r * cam.z * pulse;
    glowFill(g, ctx, roseS.x, roseS.y, Math.min(nrR * 3.6, 420), pal.royal, clamp((0.45 + 0.3 * voc + 0.4 * hitK) * (0.5 + 0.5 * charA)));
    litRose(g, ctx, roseS.x, roseS.y, nrR, { rot: nrJ.rot, open: 1, pal, glow: 0.25 + 0.4 * hitK + 0.25 * voc, bright: 0.3 });
    // his eyes open: a cold glint in each
    if (t >= T.vision) {
      const a = t - T.vision;
      const k = a < 0.05 ? 1 : 0.32 + 0.68 * Math.exp(-(a - 0.05) / 0.45);
      const tw = 0.85 + 0.15 * Math.sin(t * 5.1);
      const r = D.headR * J.U * cam.z;
      for (const ex of [-0.38, 0.38]) {
        const [wx, wy] = headPoint(J, ex + 0.02, 0.49);
        glint(ctx, g, cam.sx(wx), cam.sy(wy), r * 0.42 * k * tw, 0.12 * a + 0.3, clamp(k * 1.1), pal);
      }
      const fl = Math.exp(-a / 0.4);
      if (fl > 0.01) {
        const [wx, wy] = headPoint(J, 0, 0.5);
        const sx = cam.sx(wx), sy = cam.sy(wy);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.7 * fl;
        const w = 1500 * (0.6 + 0.4 * fl), h = 22;
        const st = g.sprites.streak(pal.roseGlow);
        ctx.drawImage(st, sx - w / 2, sy - h / 2, w / 2, h);
        ctx.translate(sx, sy); ctx.scale(-1, 1);
        ctx.drawImage(st, -w / 2, -h / 2, w / 2, h);
        ctx.restore();
      }
    }
  }

  // near petals (bokeh) in front
  drawPetals(g, t, P, pal, cam, { near: true, calm });

  // ---------------- the drum burst: white flash, streaks
  if (t >= T.reveal && t < T.rap + 0.5) {
    const sk = clamp(revealK * 1.5 + 0.8 * hitK) * (1 - smooth((t - T.rap) / 0.5));
    streakLines(ctx, { angle: -0.38, n: 22, color: '#FFFFFF', alpha: 0.2 * sk, seed: 5, t, speed: 2600 });
  }
  // a manga shock ring of halftone dots out of the rose on the burst
  const ha = t - T.reveal;
  if (ha >= 0 && ha < 0.6) {
    const R = 120 + 1300 * outCubic(ha / 0.6), wR = 70 + 110 * (ha / 0.6), fade = (1 - ha / 0.6) ** 1.3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.36 * fade;
    halftone(g, { cell: 22, angle: 0.3, color: pal.roseGlow, min: 0.08,
      amount: (x, y) => { const d = Math.abs(Math.hypot(x - roseS.x, y - roseS.y) - R); return d > wR ? 0 : (1 - d / wR) ** 1.4; } });
    ctx.restore();
  }
  if (revealK > 0.003 || hitK > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fa = 0.2 * revealK + 0.05 * hitK * after(t, T.reveal);
    ctx.fillStyle = css('#E8F0FF', clamp(fa));
    ctx.fillRect(0, 0, 1920, 1080);
    if (revealK > 0.01) glowFill(g, ctx, roseS.x, roseS.y, 900 * (1 + 0.5 * (1 - revealK)), '#FFFFFF', clamp(0.8 * revealK), { core: true });
    ctx.restore();
  }

  // ---------------- the push-in builds into the engine's flash: a few lines cross in front, light swells
  if (t >= T.king) {
    const u = clamp((t - T.king) / Math.max(0.1, T.t1 - T.king));
    const [wx, wy] = headPoint(J, 0, 0.5);
    const sx = cam.sx(wx), sy = cam.sy(wy);
    speedLines(ctx, { cx: sx, cy: sy, n: Math.round(10 + 22 * u), inner: lerp(900, 640, u), outer: 1700, color: '#FFFFFF',
      alpha: 0.6 * P.speedAlpha * smooth((u - 0.3) / 0.7), seed: 13, frame: F.frame, hold: 2, width: 0.003 });
    const wf = smooth((u - 0.7) / 0.3);
    if (wf > 0) glowFill(g, ctx, sx, sy, 600 + 300 * wf, '#DCEBFF', 0.18 * wf);
  }

  calmZone(g, calm);
}
