// A1 "Kite Island at the violet hour": the opening minute. A painted violet sky that is always gently
// alive, a banded moon, three parallax cloud banks, far floating islands, and Kite Island with its little
// house. Kit flies a kite; the friends run in one per beat, hold hands on the downbeats, grow up, and
// one by one their strings snap and they walk away on the air. Then the island tips towards the Milk Sea.
//
// Music map: pad_lvl -> sky brightness and moon glow; voice onsets -> glowing motes from Kit's string;
// voc_lvl -> string glow; downbeats -> kite dips, hand-holding and an island bob accent; F.ev.dips ->
// the world holds its breath (half-speed local clock, glows dim).

import { KIT, JUNE, FRIENDS } from './lib/cast.mjs';
import { drawPuppet, solve, poses, cycles, armTo } from './lib/puppet.mjs';
import { lattice, fbm, paletteLUT, particles, hashU, drawField } from './lib/worldkit.mjs';
import { drawIsland, drawKite, drawString, kiteTail, kiteBridle, stringControl, stringPoint, withIsland, islandPoint, islandLocal, ISLAND } from './lib/island.mjs';

export const meta = { type: 'dusk', budgetMs: 130 };

export const DEFAULT = {
  skyTop: '#2B0F54', skyMid: '#7B3FA0', skyLow: '#E77FA3', horizon: '#FFC9A3', moon: '#FFF2E0',
  cloud: '#F6B6C9', cloudShade: '#6E3F8F', island: '#3B2350', islandTop: '#5B3A7A', grass: '#8A5FB0',
  house: '#F3D9E8', roof: '#9C3F6E', window: '#FFD27A', string: '#FFE9B0', mote: '#FFE7A8',
  star: '#FFF6E0', sea: '#EDE6FA',
};

// Times default to < 0, meaning "a fraction of the way through the entry" (so any song works).
export const defaults = {
  friendsIn: -1, growT0: -1, grow: -1, snap0: -1, snap1: -1, snap2: -1, snap3: -1, tip: -1,
  stars: 250, fireflies: 60, kiteSize: 60, moteLife: 6, motesPerNote: 4,
  moonX: 1420, moonY: 290, moonR: 260, islandY: 700, holdS: 1.5, zoom0: 0.84, lanterns: 0.22,
};

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, u) => a + (b - a) * u;
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const inOutCubic = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };

function palette(S) {
  const p = S.palette || {};
  const C = {};
  for (const k of Object.keys(DEFAULT)) C[k] = p[k] || DEFAULT[k];
  return C;
}

const mixCache = new Map();
function mix(g, a, b, u) {
  const k = `${a}|${b}|${Math.round(u * 100)}`;
  let v = mixCache.get(k);
  if (!v) { v = g.color.mix(a, b, Math.round(u * 100) / 100); if (mixCache.size > 2000) mixCache.clear(); mixCache.set(k, v); }
  return v;
}

// --- the held breath: a local clock that runs at half speed around each dip ----------------------

const RAMP = 0.4;
function holdWindows(F, S, holdS) {
  const out = [];
  for (const d of F.ev.dips || []) {
    const td = Array.isArray(d) ? d[0] : d;
    if (td < S.t0 - 3 || td > S.t1 + 3) continue;
    const b = td - 0.3, c = b + Math.max(0.2, holdS - RAMP);
    out.push({ a: b - RAMP, b, c, e: c + RAMP });
  }
  return out;
}
function hAt(w, t) {
  if (t <= w.a || t >= w.e) return 0;
  if (t < w.b) return sm((t - w.a) / RAMP);
  if (t <= w.c) return 1;
  return 1 - sm((t - w.c) / RAMP);
}
function HAt(w, t) {   // integral of hAt from -inf to t
  const P = (x) => x * x * x - (x * x * x * x) / 2;
  if (t <= w.a) return 0;
  if (t < w.b) return RAMP * P((t - w.a) / RAMP);
  if (t <= w.c) return RAMP * 0.5 + (t - w.b);
  if (t < w.e) { const x = (t - w.c) / RAMP; return RAMP * 0.5 + (w.c - w.b) + RAMP * (x - P(x)); }
  return RAMP + (w.c - w.b);
}
function makeClock(wins) {
  return (t) => { let s = 0; for (const w of wins) s += HAt(w, t); return t - 0.5 * s; };
}

// --- sky: a painterly noise field blended 60/40 with a vertical gradient ---------------------------

const skyBufs = new Map();
function skyField(g, { t, stops, w = 288, h = 180, y0, y1, scale = 2, warp = 1, seed = 7 }) {
  const bk = `${w}x${h}`;
  const WS = 4, gw = Math.ceil(w / WS) + 2, gh = Math.ceil(h / WS) + 2;
  let B = skyBufs.get(bk);
  if (!B) {
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    B = { c, x, img: x.createImageData(w, h), wx: new Float32Array(gw * gh), wy: new Float32Array(gw * gh) };
    skyBufs.set(bk, B);
  }
  const L = lattice(seed), L2 = lattice(seed + 101);
  const lut = paletteLUT(stops);
  const d = B.img.data, { wx, wy } = B;
  const sx = scale / w, ox = t * 0.011, oy = t * 0.003, ft = t * 0.022;
  for (let gy = 0; gy < gh; gy++) {
    const ny = gy * WS * sx + oy;
    for (let gx = 0; gx < gw; gx++) {
      const nx = gx * WS * sx + ox;
      wx[gy * gw + gx] = warp * 4 * (fbm(L2, nx + ft, ny - ft, 2) - 0.5);
      wy[gy * gw + gx] = warp * 4 * (fbm(L2, nx - ft + 5.2, ny + ft + 1.3, 2) - 0.5);
    }
  }
  for (let y = 0, o = 0; y < h; y++) {
    const ny = y * sx + oy;
    const gyf = y / WS, gy0 = Math.floor(gyf), fy = gyf - gy0, r0 = gy0 * gw, r1 = r0 + gw;
    const vert = clamp(y / (h - 1)) * (y1 - y0) + y0;     // 0 at the top .. 1 at the horizon
    for (let x = 0; x < w; x++, o += 4) {
      const gxf = x / WS, gx0 = Math.floor(gxf), fx = gxf - gx0;
      const a = r0 + gx0, b = r1 + gx0;
      const qx = (wx[a] * (1 - fx) + wx[a + 1] * fx) * (1 - fy) + (wx[b] * (1 - fx) + wx[b + 1] * fx) * fy;
      const qy = (wy[a] * (1 - fx) + wy[a + 1] * fx) * (1 - fy) + (wy[b] * (1 - fx) + wy[b + 1] * fx) * fy;
      const n = (fbm(L, x * sx + ox + qx, ny + qy, 4) - 0.5) * 1.9 + 0.5;
      const v = 0.6 * vert + 0.4 * n;
      const i = Math.max(0, Math.min(255, Math.round(v * 255))) * 3;
      d[o] = lut[i]; d[o + 1] = lut[i + 1]; d[o + 2] = lut[i + 2]; d[o + 3] = 255;
    }
  }
  B.x.putImageData(B.img, 0, 0);
  return B.c;
}

// --- cached sprites: moon, clouds, far islands ----------------------------------------------------

const spriteCache = new Map();
function cached(key, make) {
  let s = spriteCache.get(key);
  if (!s) {
    s = make();
    if (spriteCache.size > 80) spriteCache.delete(spriteCache.keys().next().value);
    spriteCache.set(key, s);
  }
  return s;
}

function moonSprite(g, C, R) {
  return cached(`moon|${C.moon}|${C.cloud}|${R}|${g.scale}`, () => {
    const q = g.scale, S = Math.ceil(2 * R * q) + 4;
    const c = g.createCanvas(S, S);
    const x = c.getContext('2d');
    x.scale(q, q);
    x.translate(R + 2 / q, R + 2 / q);
    const gr = x.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R);
    gr.addColorStop(0, mix(g, C.moon, '#FFFFFF', 0.5));
    gr.addColorStop(0.55, C.moon);
    gr.addColorStop(1, mix(g, C.moon, C.cloud, 0.7));
    x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fillStyle = gr; x.fill();
    x.save(); x.clip();
    for (let i = 0; i < 16; i++) {
      const a = hashU(61, i, 1) * TAU, rr = Math.sqrt(hashU(61, i, 2)) * R * 0.85;
      const r = R * (0.05 + 0.13 * hashU(61, i, 3));
      x.beginPath(); x.arc(Math.cos(a) * rr, Math.sin(a) * rr, r, 0, TAU);
      x.fillStyle = mix(g, C.moon, C.cloud, 0.5);
      x.globalAlpha = 0.18 + 0.2 * hashU(61, i, 4);
      x.fill();
    }
    x.restore();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

const CW = 640, CH = 400;
function cloudSprite(g, C, variant, tone) {
  return cached(`cloud|${variant}|${tone}|${C.cloud}|${C.cloudShade}|${C.skyLow}|${C.moon}|${C.horizon}|${C.skyTop}|${g.scale}`, () => {
    const q = g.scale;
    const make = () => { const c = g.createCanvas(Math.ceil(CW * q), Math.ceil(CH * q)); const x = c.getContext('2d'); x.scale(q, q); return [c, x]; };
    const [c, x] = make();
    const h = (k) => hashU(71, variant, k);
    // a cumulus heap: rows of puffs, big in the middle, painted bottom-up so lit tops overlap
    const puffs = [];
    const n = 7 + Math.floor(h(1) * 5);
    const peak = 0.35 + 0.3 * h(2);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < n - row * 2; i++) {
        const u = (i + 0.5) / (n - row * 2);
        const hump = Math.exp(-(((u - peak) / 0.32) ** 2));
        const r = (26 + 46 * hump) * (0.8 + 0.4 * h(10 + row * 20 + i)) * (1 - row * 0.12);
        const px = 320 + (u - 0.5) * (470 - row * 120) + (h(40 + row * 20 + i) - 0.5) * 24;
        const py = 312 - row * 34 - hump * (40 + 50 * row) - r * 0.35 + (h(60 + row * 20 + i) - 0.5) * 14;
        puffs.push([px, py, r]);
      }
    }
    puffs.sort((a, b) => b[1] + b[2] * 0.2 - (a[1] + a[2] * 0.2));
    let lit, shade, hi;
    if (tone === 'far') { lit = mix(g, C.cloud, C.horizon, 0.45); shade = mix(g, C.cloudShade, C.skyLow, 0.55); hi = mix(g, C.horizon, '#FFFFFF', 0.3); }
    else if (tone === 'mid') { lit = C.cloud; shade = mix(g, C.cloudShade, C.skyLow, 0.2); hi = mix(g, C.cloud, C.moon, 0.7); }
    else { lit = mix(g, C.cloud, C.cloudShade, 0.42); shade = mix(g, C.cloudShade, C.skyTop, 0.35); hi = mix(g, C.cloud, C.moon, 0.3); }
    let top = Infinity;
    for (const [, py, r] of puffs) top = Math.min(top, py - r);
    const vg = x.createLinearGradient(0, top, 0, 292);
    vg.addColorStop(0, hi);
    vg.addColorStop(0.35, lit);
    vg.addColorStop(1, shade);
    x.beginPath();
    for (const [px, py, r] of puffs) { x.moveTo(px + r, py); x.arc(px, py, r, 0, TAU); }
    x.fillStyle = vg;
    x.fill();
    // soft lumps: each puff's moonlit upper-right face, and a shadow tucked under it
    x.globalCompositeOperation = 'source-atop';
    for (const [px, py, r] of puffs) {
      const sg = x.createRadialGradient(px - r * 0.1, py + r * 0.75, 0, px - r * 0.1, py + r * 0.75, r * 0.9);
      sg.addColorStop(0, g.color.css(shade, 0.35));
      sg.addColorStop(1, g.color.css(shade, 0));
      x.fillStyle = sg;
      x.fillRect(px - r * 1.2, py - r * 0.2, r * 2.4, r * 2);
    }
    for (const [px, py, r] of puffs) {
      const hg = x.createRadialGradient(px + r * 0.3, py - r * 0.4, 0, px + r * 0.3, py - r * 0.4, r * 0.85);
      hg.addColorStop(0, g.color.css(hi, 0.55));
      hg.addColorStop(1, g.color.css(hi, 0));
      x.fillStyle = hg;
      x.fillRect(px - r, py - r * 1.4, r * 2.4, r * 2);
    }
    x.globalCompositeOperation = 'source-over';
    // dissolve the bottom into the sky
    x.globalCompositeOperation = 'destination-out';
    const fg = x.createLinearGradient(0, 288, 0, 342);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = fg;
    x.fillRect(0, 288, CW, CH - 288);
    // soften like wet paint
    const [c2, x2] = make();
    x2.setTransform(1, 0, 0, 1, 0, 0);
    x2.filter = `blur(${(tone === 'far' ? 3 : 2) * q}px)`;
    x2.drawImage(c, 0, 0);
    x2.filter = 'none';
    x2.getImageData(0, 0, 1, 1);
    return c2;
  });
}

const FAR = [
  { x: 205, y: 455, s: 0.62, f: 0.31, ph: 0.2, tree: 2, lit: 1 },
  { x: 470, y: 690, s: 0.36, f: 0.43, ph: 2.1, tree: 1, lit: 0 },
  { x: 1690, y: 640, s: 0.5, f: 0.27, ph: 4.0, tree: 1, lit: 1 },
  { x: 1840, y: 330, s: 0.3, f: 0.37, ph: 1.3, tree: 0, lit: 0 },
  { x: 1300, y: 845, s: 0.28, f: 0.5, ph: 5.2, tree: 1, lit: 0 },
];
function farIslandSprite(g, C, i) {
  return cached(`far|${i}|${C.island}|${C.skyMid}|${C.grass}|${C.cloud}|${g.scale}`, () => {
    const q = g.scale, W = 300, H = 260;
    const c = g.createCanvas(Math.ceil(W * q), Math.ceil(H * q));
    const x = c.getContext('2d');
    x.scale(q, q);
    x.translate(150, 70);
    const L = lattice(900 + i);
    const body = mix(g, C.island, C.skyMid, 0.42), top = mix(g, C.grass, C.skyMid, 0.35), rim = mix(g, C.cloud, C.skyMid, 0.2);
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const xx = -120 + k * 6;
      const a = Math.abs(xx) / 120;
      const y = 130 * Math.pow(1 - a * a, 1.6) * (0.8 + 0.4 * fbm(L, xx / 30, 1, 2)) + 4;
      pts.push([xx, y]);
    }
    x.beginPath();
    x.moveTo(-120, 0);
    for (const p of pts) x.lineTo(p[0], p[1]);
    x.ellipse(0, 0, 120, 12, 0, 0, Math.PI, true);
    x.closePath();
    x.fillStyle = body; x.fill();
    x.strokeStyle = rim; x.lineWidth = 3; x.globalAlpha = 0.35; x.stroke(); x.globalAlpha = 1;
    // dangling roots
    x.strokeStyle = body; x.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const xx = -80 + k * 32 + hashU(81, i * 10 + k, 1) * 10;
      const p = pts[Math.round((xx + 120) / 6)];
      x.beginPath(); x.moveTo(xx, p[1] - 3); x.quadraticCurveTo(xx + 6, p[1] + 20, xx - 2, p[1] + 25 + hashU(81, i * 10 + k, 2) * 40); x.stroke();
    }
    x.beginPath(); x.ellipse(0, 0, 120, 12, 0, 0, TAU); x.fillStyle = top; x.fill();
    // little lollipop trees
    for (let k = 0; k < FAR[i].tree; k++) {
      const tx = -60 + k * 95 + hashU(82, i, k) * 20, th = 28 + hashU(83, i, k) * 18;
      x.strokeStyle = body; x.lineWidth = 4; x.beginPath(); x.moveTo(tx, 2); x.lineTo(tx, -th); x.stroke();
      x.fillStyle = top; x.beginPath(); x.arc(tx, -th - 12, 18, 0, TAU); x.fill();
      x.fillStyle = rim; x.globalAlpha = 0.3; x.beginPath(); x.arc(tx + 5, -th - 17, 9, 0, TAU); x.fill(); x.globalAlpha = 1;
    }
    if (FAR[i].lit) {   // a tiny cottage (its window is lit live)
      x.fillStyle = mix(g, C.house, C.skyMid, 0.45);
      x.fillRect(22, -30, 36, 30);
      x.fillStyle = mix(g, C.roof, C.skyMid, 0.4);
      x.beginPath(); x.moveTo(16, -28); x.lineTo(40, -52); x.lineTo(64, -28); x.closePath(); x.fill();
    }
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// --- the cast on the island -----------------------------------------------------------------------

const CAST = [
  { key: 'f0', who: FRIENDS[0], slot: 0, arrive: 0, side: -1, snap: 0, lag: 0 },
  { key: 'f1', who: FRIENDS[1], slot: 1, arrive: 2, side: -1, snap: 2, lag: 0 },
  { key: 'kit', who: KIT, slot: 2, arrive: -1, side: 0, snap: -1, lag: 0 },
  { key: 'june', who: JUNE, slot: 3, arrive: 4, side: 1, snap: 3, lag: 0, wave: true },
  { key: 'f2', who: FRIENDS[2], slot: 4, arrive: 1, side: 1, snap: 2, lag: 1 },
  { key: 'f3', who: FRIENDS[3], slot: 5, arrive: 3, side: 1, snap: 1, lag: 0 },
];
const KITE_HOME = [[585, 335], [760, 195], [1085, 262], [1240, 140], [1390, 300], [1580, 200]];
const GROUND = [12, 8, 14, 10, 13, 9];
const RUN_SPEED = 250;
const TEEN_SLOTS = [-150, -66, 18, 102, 186, 262];

function dipShape(sd) { const u = sd / 0.15; return u <= 0 ? 0 : u * Math.exp(1 - u); }

/** Kite position (sky space) of slot i on its figure-eight at local-clock time tl. */
function orbit(i, tl, beatS, sinceDown, size) {
  const [bx, by] = KITE_HOME[i];
  const w = TAU / (8 * beatS), ph = i * 1.37;
  const a = w * tl + ph;
  return [bx + 78 * Math.sin(a), by + 34 * Math.sin(2 * a) + 28 * dipShape(sinceDown), 0.3 * Math.cos(a) - 0.12 * Math.sin(2 * a), size];
}

function timeline(c, ctx) {
  const { friendsIn, beatS, snaps } = ctx;
  const out = { tA: -Infinity, tS: -Infinity, ts: Infinity, tw: Infinity, tEnd: Infinity, tL: ctx.t0 + 0.3 };
  if (c.arrive >= 0) {
    out.tA = friendsIn + c.arrive * beatS;
    const edge = c.side * 262, dist = Math.abs(ISLAND.slots[c.slot] - edge);
    out.edge = edge;
    out.runDur = 0.35 + dist / RUN_SPEED;
    out.tS = out.tA + out.runDur;
    out.tL = out.tS;
  }
  if (c.snap >= 0) {
    out.ts = snaps[c.snap] + c.lag * beatS;
    out.tw = out.ts + (c.wave ? 1.25 : 0.5);
    out.tEnd = out.tw + 2.2;
    out.dir = ISLAND.slots[c.slot] < ISLAND.slots[2] ? -1 : 1;
  }
  return out;
}

// --- draw -------------------------------------------------------------------------------------------

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const C = palette(S);
  const dur = Math.max(1e-3, S.t1 - S.t0);
  const T = (v, f) => (typeof v === 'number' && v >= 0 ? v : S.t0 + f * dur);
  const beatS = F.beatS || 0.46;
  const friendsIn = T(P.friendsIn, 0.476);
  const snaps = [T(P.snap0, 0.757), T(P.snap1, 0.818), T(P.snap2, 0.878), T(P.snap3, 0.939)];
  const grow = P.grow >= 0 ? clamp(P.grow) : inOutCubic((S.u - 0.659) / 0.061);
  const tip = P.tip >= 0 ? clamp(P.tip) : clamp((S.u - 0.953) / 0.047) ** 3;
  const wins = holdWindows(F, S, P.holdS);
  const clock = makeClock(wins);
  const tl = clock(t);
  let hold = 0;
  for (const w of wins) hold = Math.max(hold, hAt(w, t));
  const glowK = 1 - 0.3 * hold;
  const pad = clamp(F.c.pad_lvl ?? 0.5);
  const voc = clamp(F.c.voc_lvl ?? 0);
  const sinceDownAt = (tt) => (tt === t ? F.c.since_down : F.col('since_down', tt)) || 0;
  const kiteSize = P.kiteSize;

  // camera: a slow float, and at the end a pan down with an 8 degree roll
  const pan = 720 * tip;
  const roll = (-8 * Math.PI / 180) * tip;
  const drift = 12 * Math.sin(tl * 0.09) + 6 * Math.sin(tl * 0.23);
  const par = (k) => [drift * k, -pan * k];
  // the opening: a slow push in from a wide establishing shot until the friends arrive
  const zoom = lerp(P.zoom0, 1, smoother((t - S.t0) / Math.max(1, friendsIn - S.t0 - 1)));
  const Z = (k, fn) => {
    const z = Math.pow(zoom, k);
    if (Math.abs(z - 1) < 1e-4) return fn();
    ctx.save(); ctx.translate(960, 660); ctx.scale(z, z); ctx.translate(-960, -660);
    const r = fn();
    ctx.restore();
    return r;
  };
  ctx.save();
  if (roll) { ctx.translate(960, 540); ctx.rotate(roll); ctx.translate(-960, -540); }

  // (1) sky
  const skyStops = [[0, C.skyTop], [0.3, mix(g, C.skyTop, C.skyMid, 0.55)], [0.5, C.skyMid], [0.72, C.skyLow], [0.9, C.horizon], [1, mix(g, C.horizon, '#FFFFFF', 0.3)]];
  const skyC = skyField(g, { t: tl, stops: skyStops, y0: 0, y1: 1.02, scale: 2.3, warp: 0.1 });
  const [sx0, sy0] = par(0.28);
  Z(0.2, () => drawField(g, skyC, { x: -260 + sx0, y: -230 + sy0, w: 2440, h: 1540 }));
  const breathe = (pad - 0.6) * 0.16 * glowK - 0.3 * 0.25 * hold;
  if (Math.abs(breathe) > 0.002) {
    ctx.save();
    ctx.globalCompositeOperation = breathe > 0 ? 'lighter' : 'source-over';
    ctx.fillStyle = breathe > 0 ? C.skyLow : '#000000';
    ctx.globalAlpha = Math.min(0.2, Math.abs(breathe) * (breathe > 0 ? 0.6 : 1));
    ctx.fillRect(-200, -200, 2320, 1480);
    ctx.restore();
  }

  // (2) stars, appearing one by one over the first half minute
  Z(0.25, () => {
    const [ox, oy] = par(0.32);
    const spr = g.sprites.glow(C.star);
    const tIn = Math.max(1, Math.min(30, dur * 0.5));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < P.stars; i++) {
      const born = S.t0 + hashU(91, i, 1) * tIn;
      const fade = sm((t - born) / 2.5);
      if (fade <= 0) continue;
      const x = -150 + hashU(91, i, 2) * 2220 + ox;
      const y = -150 + Math.pow(hashU(91, i, 3), 1.6) * 900 + oy;
      const r = 1 + hashU(91, i, 4) * 1.5;
      const tw = 0.55 + 0.45 * Math.sin(tl * (0.8 + 2.2 * hashU(91, i, 5)) + hashU(91, i, 6) * TAU);
      const a = fade * tw * (1 - 0.5 * clamp((y - 300) / 500));
      ctx.globalAlpha = a * 0.5;
      ctx.drawImage(spr, x - r * 4, y - r * 4, r * 8, r * 8);
      ctx.globalAlpha = a;
      ctx.fillStyle = C.star;
      ctx.fillRect(x - r * 0.5, y - r * 0.5, r, r);
    }
    ctx.restore();
  });

  // shooting stars on some vocal lines
  Z(0.25, () => drawShootingStars(g, ctx, C, t, F, S, par(0.3)));

  // (3) moon: a glow, then nine bands sliding on slow sines
  Z(0.3, () => {
    const [ox, oy] = par(0.4);
    const mx = P.moonX + ox, my = P.moonY + oy, R = P.moonR;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp((0.22 + 0.2 * pad) * glowK);
    ctx.drawImage(g.sprites.glow(C.moon), mx - 560, my - 560, 1120, 1120);
    ctx.globalAlpha = clamp(0.14 * glowK);
    ctx.drawImage(g.sprites.glow(C.cloud), mx - 900, my - 700, 1800, 1400);
    ctx.restore();
    const spr = moonSprite(g, C, R);
    const bands = 9, gap = 12, bh = (2 * R - (bands - 1) * gap) / bands;
    for (let j = 0; j < bands; j++) {
      const top = my - R + j * (bh + gap);
      const dx = (j % 2 ? 1 : -1) * 12 * Math.sin(tl * 0.33 + j * 0.8);
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx - R - 30, top, 2 * R + 60, bh);
      ctx.clip();
      ctx.drawImage(spr, mx - R - 2 + dx, my - R - 2, 2 * R + 4, 2 * R + 4);
      ctx.restore();
    }
  });

  Z(0.55, () => {
    // (4a) far cloud bank, sky lanterns drifting up from far away, (5) far islands, birds now and then
    drawCloudBank(g, ctx, C, tl, 'far', par(0.5));
    drawLanterns(g, ctx, C, tl, P, S, par(0.5), glowK);
    drawFarIslands(g, ctx, C, tl, par(0.55), glowK);
    drawBirds(g, ctx, C, t, F, S, par(0.5));
  });
  // (4b) mid cloud bank
  Z(0.75, () => drawCloudBank(g, ctx, C, tl, 'mid', par(0.68)));

  // the Milk Sea rising at the end
  const isl = {
    x: 960,
    y: P.islandY + 8 * Math.sin((TAU * tl) / (16 * beatS)) + 4 * dipShape(sinceDownAt(t)) - 260 * tip,
    rot: 0.36 * tip, scale: 1,
  };
  if (tip > 0.001) drawSea(g, ctx, C, tip, tl, par(0.4));

  Z(1, () => {
  // backlight behind the island
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.16 * glowK;
  ctx.drawImage(g.sprites.glow(C.horizon), isl.x - 520, isl.y - 360, 1040, 820);
  ctx.restore();

  // (6) the island (back half), (7) the kids, then the grass lip over their feet
  const islandPal = { ...C, rim: C.cloud, bounce: C.skyLow };
  const lit = windowLit(t, S);
  drawIsland(g, ctx, { x: isl.x, y: isl.y, rot: isl.rot, t: tl, palette: islandPal, part: 'back', glowK, glow: 0.9 + 0.2 * pad, lit });
  const kids = castState(g, t, tl, F, P, S, { friendsIn, snaps, grow, tip, beatS, isl, sinceDownAt, kiteSize, clock });
  withIsland(ctx, isl, () => {
    drawCat(g, ctx, C, tl, glowK * lit);
    for (const k of kids.draw) drawKid(g, ctx, k, t);
  });
  drawIsland(g, ctx, { x: isl.x, y: isl.y, rot: isl.rot, t: tl, palette: islandPal, part: 'front' });

  // (8) strings and kites; snaps
  const strAlpha = (0.5 + 0.5 * voc) * glowK;
  for (const k of kids.kites) drawKiteOf(g, ctx, C, k, t, strAlpha);

  // (9) motes from Kit's string, (10) fireflies
  drawMotes(g, ctx, C, t, F, P, S, { clock, beatS, isl0: P.islandY, kiteSize, glowK, tip, grow });
  drawFireflies(g, ctx, C, tl, P, isl, glowK);
  drawPetals(g, ctx, C, t, F, S, glowK, -260 * tip);
  });

  // (4c) near cloud bank, partly in front of the island
  Z(1.15, () => drawCloudBank(g, ctx, C, tl, 'near', par(0.92), 1 - sm(tip * 2.2)));
  Z(1.3, () => drawBokeh(g, ctx, C, tl, par(1.2), glowK));

  ctx.restore();
}

// --- layers ---------------------------------------------------------------------------------------

const BANKS = {
  far: { speed: 6, n: 9, y0: 850, y1: 935, s0: 0.36, s1: 0.6, alpha: 0.6, seed: 1 },
  mid: { speed: 12, n: 5, y0: 700, y1: 830, s0: 0.55, s1: 0.85, alpha: 0.9, seed: 2, high: 2 },
  near: { speed: 22, n: 3, y0: 1085, y1: 1130, s0: 0.95, s1: 1.25, alpha: 0.95, seed: 3 },
};
function drawCloudBank(g, ctx, C, tl, tone, [ox, oy], fade = 1) {
  const B = BANKS[tone];
  if (fade <= 0.003) return;
  const span = 1920 + 2 * 700;
  ctx.save();
  for (let i = 0; i < B.n + (B.high || 0); i++) {
    const high = i >= B.n;
    const s = lerp(B.s0, B.s1, hashU(101, B.seed * 50 + i, 1)) * (high ? 0.6 : 1);
    const x0 = ((i + 0.5) / (B.n + (B.high || 0))) * span + (hashU(101, B.seed * 50 + i, 2) - 0.5) * 200;
    const x = ((((x0 - B.speed * tl) % span) + span) % span) - 700 + ox;
    const y = (high ? 150 + hashU(101, B.seed * 50 + i, 3) * 160 : lerp(B.y0, B.y1, hashU(101, B.seed * 50 + i, 3))) + oy + 5 * Math.sin(tl * 0.2 + i);
    const spr = cloudSprite(g, C, (B.seed * 7 + i) % 9, tone);
    ctx.globalAlpha = B.alpha * (high ? 0.55 : 1) * fade;
    const w = CW * s, h = CH * s;
    ctx.drawImage(spr, x - w / 2, y - h * 0.79, w, h);
  }
  ctx.restore();
}

function drawFarIslands(g, ctx, C, tl, [ox, oy], glowK) {
  const spr = g.sprites.glow(C.window);
  for (let i = 0; i < FAR.length; i++) {
    const f = FAR[i];
    const x = f.x + ox * (0.6 + f.s), y = f.y + oy + 9 * f.s * Math.sin(tl * f.f + f.ph);
    const s = farIslandSprite(g, C, i);
    ctx.drawImage(s, x - 150 * f.s, y - 70 * f.s, 300 * f.s, 260 * f.s);
    if (f.lit) {
      const wx = x + 40 * f.s, wy = y - 16 * f.s;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.55 + 0.15 * Math.sin(tl * 2.3 + i)) * glowK;
      ctx.drawImage(spr, wx - 30 * f.s, wy - 30 * f.s, 60 * f.s, 60 * f.s);
      ctx.restore();
      ctx.fillStyle = C.window;
      ctx.fillRect(wx - 4 * f.s, wy - 5 * f.s, 8 * f.s, 9 * f.s);
    }
  }
}

function drawShootingStars(g, ctx, C, t, F, S, [ox, oy]) {
  const lines = F.ev.lines || [];
  for (let j = 0; j < lines.length; j++) {
    const t0 = lines[j][0] + 0.25;
    if (j % 3 !== 1 || t0 < S.t0 + 4 || t0 > S.t1) continue;
    const a = t - t0;
    if (a < 0 || a > 1.1) continue;
    const x0 = 420 + hashU(111, j, 1) * 1000 + ox, y0 = 50 + hashU(111, j, 2) * 170 + oy;
    const ang = Math.PI * (0.83 + 0.06 * hashU(111, j, 3));
    const d = 760 * a;
    const hx = x0 + Math.cos(ang) * d, hy = y0 + Math.sin(ang) * d;
    const env = sm(a / 0.12) * (1 - sm((a - 0.6) / 0.5));
    const len = 210 * (0.4 + 0.6 * sm(a / 0.3));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = env * 0.9;
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.drawImage(g.sprites.streak(C.star), -len, -7, len, 14);
    ctx.drawImage(g.sprites.glow(C.star), -12, -12, 24, 24);
    ctx.restore();
  }
}

function drawBirds(g, ctx, C, t, F, S, [ox, oy]) {
  const db = F.ev.downbeats || [];
  const col = mix(g, C.skyTop, C.island, 0.4);
  for (let k = 6; k < db.length; k += 12) {
    const t0 = db[k];
    if (t0 < S.t0 || t0 > S.t1) continue;
    const a = t - t0;
    if (a < 0 || a > 16) continue;
    const dirL = (k / 12) % 2 < 1;
    const x0 = dirL ? 2040 - 150 * a : -120 + 150 * a;
    const y0 = 420 - 60 * Math.sin(a * 0.18) + hashU(121, k, 1) * 60;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let b = 0; b < 6; b++) {
      const bx = x0 + ox + (dirL ? 1 : -1) * (b * 34 + hashU(121, k * 10 + b, 2) * 14);
      const by = y0 + oy + (b % 2 ? 1 : -1) * b * 9 + 4 * Math.sin(a * 1.3 + b);
      const fl = Math.sin(a * 9 + b * 1.7);
      const span = 9 + 2 * (b % 3), lift = 6 * fl;
      ctx.moveTo(bx - span, by - lift);
      ctx.quadraticCurveTo(bx - span * 0.4, by - 2 - lift * 0.3, bx, by + 1);
      ctx.quadraticCurveTo(bx + span * 0.4, by - 2 - lift * 0.3, bx + span, by - lift);
    }
    ctx.stroke();
  }
}

function drawSea(g, ctx, C, tip, tl, [ox, oy]) {
  const top = lerp(1150, 432, tip);
  if (top > 1260) return;
  const X0 = -280, X1 = 2200, B = 1420;
  ctx.save();
  // milky mist rising off the surface
  const mg = ctx.createLinearGradient(0, top - 140, 0, top + 4);
  mg.addColorStop(0, g.color.css(C.horizon, 0));
  mg.addColorStop(1, g.color.css(mix(g, C.sea, C.horizon, 0.45), 0.7));
  ctx.fillStyle = mg;
  ctx.fillRect(X0, top - 140, X1 - X0, 144);
  // the milk: warm sky reflected near the horizon, pale lilac towards us
  const sg = ctx.createLinearGradient(0, top, 0, B);
  sg.addColorStop(0, mix(g, C.sea, '#FFFFFF', 0.4));
  sg.addColorStop(0.05, mix(g, C.sea, C.horizon, 0.45));
  sg.addColorStop(0.16, mix(g, C.sea, C.skyLow, 0.28));
  sg.addColorStop(0.45, mix(g, C.sea, C.skyMid, 0.1));
  sg.addColorStop(1, mix(g, C.sea, C.skyMid, 0.42));
  ctx.fillStyle = sg;
  ctx.fillRect(X0, top, X1 - X0, B - top);
  // soft swells: long pale highlights with a lilac shadow under each
  const hi = g.sprites.glow('#FFFFFF'), lo = g.sprites.glow(C.skyMid);
  for (let i = 0; i < 22; i++) {
    const u = (i + 0.5) / 22, y = top + (B - top) * Math.pow(u, 1.9);
    const sc = 0.25 + 1.6 * u;
    for (let k = 0; k < 7; k++) {
      const h = (n) => hashU(201, i * 16 + k, n);
      const span = X1 - X0 + 400;
      const x = X0 - 200 + ((((h(1) * span + tl * (8 + 10 * u) * (h(2) < 0.5 ? 1 : -0.6)) % span) + span) % span);
      const w = (90 + 200 * h(3)) * sc, hh = (3 + 3 * h(4)) * sc;
      const yy = y + (h(5) - 0.5) * 18 * sc + 2 * sc * Math.sin(tl * 0.9 + h(6) * TAU);
      ctx.globalAlpha = 0.18 + 0.22 * u;
      ctx.drawImage(lo, x - w / 2, yy + hh * 0.6, w, hh * 2);
      ctx.globalAlpha = (0.5 + 0.2 * Math.sin(tl * 1.1 + h(7) * TAU)) * (1 - 0.45 * u);
      ctx.drawImage(hi, x - w / 2, yy - hh, w, hh * 2);
    }
  }
  // the moon's path on the milk
  ctx.globalCompositeOperation = 'lighter';
  const mx = 1420 + ox, mspr = g.sprites.glow(C.moon);
  for (let i = 0; i < 16; i++) {
    const u = (i + 0.5) / 16, y = top + (B - top) * u * u * 0.9;
    const w = (40 + 220 * u) * (0.55 + 0.45 * Math.sin(tl * 1.3 + i * 2.1));
    ctx.globalAlpha = 0.35 * (1 - u * 0.5);
    ctx.drawImage(mspr, mx - w / 2 + 16 * Math.sin(i * 1.7 + tl * 0.8), y - 4 - 6 * u, w, 8 + 12 * u);
  }
  // bright horizon seam
  ctx.globalAlpha = 0.7;
  ctx.drawImage(g.sprites.glow('#FFFFFF'), X0, top - 6, X1 - X0, 12);
  ctx.restore();
}

function drawFireflies(g, ctx, C, tl, P, isl, glowK) {
  const spr = g.sprites.glow(C.window), sprM = g.sprites.glow(C.mote);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < P.fireflies; i++) {
    const h = (k) => hashU(141, i, k);
    const bx = 960 + (h(1) - 0.5) * 1000, by = isl.y - 120 + h(2) * 420;
    const x = bx + 46 * Math.sin(tl * 0.21 * (1 + h(3)) + h(4) * TAU) + 20 * Math.sin(tl * 0.57 + h(5) * TAU);
    const y = by + 28 * Math.sin(tl * 0.29 * (1 + h(5)) + h(1) * TAU) + 12 * Math.sin(tl * 0.83 + h(3) * TAU);
    const b = Math.max(0, Math.sin(tl * (0.7 + 1.1 * h(3)) + h(2) * TAU));
    const a = (0.12 + 0.88 * b * b * b) * glowK;
    const r = 7 + 7 * h(6);
    ctx.globalAlpha = a * 0.75;
    ctx.drawImage(i % 3 ? spr : sprM, x - r, y - r, 2 * r, 2 * r);
    ctx.globalAlpha = a;
    ctx.drawImage(sprM, x - 2.5, y - 2.5, 5, 5);
  }
  ctx.restore();
}

function drawBokeh(g, ctx, C, tl, [ox, oy], glowK) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const h = (k) => hashU(151, i, k);
    const span = 2400;
    const x = ((((h(1) * span - tl * (5 + 6 * h(2))) % span) + span) % span) - 240 + ox;
    const y = 150 + h(3) * 800 + 30 * Math.sin(tl * 0.15 + i) + oy;
    const r = 40 + 70 * h(4);
    ctx.globalAlpha = (0.05 + 0.05 * h(5)) * glowK * (0.7 + 0.3 * Math.sin(tl * 0.4 + i));
    ctx.drawImage(g.sprites.bokeh(i % 2 ? C.mote : C.cloud, 0.2, 0.3), x - r, y - r, 2 * r, 2 * r);
  }
  ctx.restore();
}


// the house lights flicker on just after the fade-in
function windowLit(t, S) {
  const a = t - (S.t0 + 1.6);
  if (a < 0) return 0;
  if (a < 0.08) return 0.7 * a / 0.08;
  if (a < 0.2) return 0.25;
  return sm((a - 0.2) / 0.25);
}

// a little cat on the roof ridge, tail swishing, eyes catching the light (island-local coordinates)
function drawCat(g, ctx, C, tl, glow) {
  const x = ISLAND.house.x - 6, y = ISLAND.house.y - 250;
  const col = mix(g, C.island, '#120A1E', 0.45);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  // tail
  const sw = Math.sin(tl * 1.3) * 0.6 + Math.sin(tl * 0.47) * 0.3;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(6, -4);
  ctx.bezierCurveTo(18, -2, 20 + 6 * sw, -14, 14 + 12 * sw, -24);
  ctx.stroke();
  // body and head
  ctx.beginPath(); ctx.ellipse(0, -9, 8.5, 10, 0, 0, TAU); ctx.fill();
  const hx = -2 + 1.5 * Math.sin(tl * 0.21), hy = -23;
  ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, TAU); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx - 6, hy - 2); ctx.lineTo(hx - 5, hy - 11); ctx.lineTo(hx - 1, hy - 5);
  ctx.moveTo(hx + 6, hy - 2); ctx.lineTo(hx + 5, hy - 11); ctx.lineTo(hx + 1, hy - 5);
  ctx.fill();
  // eyes blink now and then
  const blink = Math.sin(tl * 0.37) > 0.97 ? 0.15 : 1;
  ctx.fillStyle = C.window;
  ctx.globalAlpha = 0.9 * Math.max(0.3, glow);
  ctx.beginPath(); ctx.ellipse(hx - 2.4, hy, 1.4, 1.4 * blink, 0, 0, TAU); ctx.ellipse(hx + 2.4, hy, 1.4, 1.4 * blink, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// paper sky lanterns rising slowly from far below the clouds
function drawLanterns(g, ctx, C, tl, P, S, [ox, oy], glowK) {
  const rate = P.lanterns;
  if (!(rate > 0)) return;
  const ps = particles({ seed: 211, t: tl, rate, life: 36,
    origin: (k, r) => [60 + r * 1800, 1000], vel: (k, r, r2) => [(r2 - 0.5) * 8, -15 - 10 * r2], swirl: 9, swirlHz: 0.06 });
  const spr = g.sprites.glow('#FFB866'), body = mix(g, C.window, '#FF9A5A', 0.35), top = mix(g, C.window, C.roof, 0.5);
  for (const p of ps) {
    const s = 4 + 4.5 * p.r2;
    const a = sm(p.age / 4) * (1 - sm((p.u - 0.7) / 0.3)) * (0.75 + 0.25 * Math.sin(p.age * 2.3 + p.r * 9));
    if (a <= 0.01) continue;
    const x = p.x + ox, y = p.y + oy;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * a * glowK;
    ctx.drawImage(spr, x - s * 5, y - s * 5, s * 10, s * 10);
    ctx.restore();
    ctx.globalAlpha = a;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.roundRect(x - s * 0.6, y - s, s * 1.2, s * 1.6, s * 0.35); ctx.fill();
    ctx.fillStyle = top;
    ctx.fillRect(x - s * 0.62, y - s * 1.05, s * 1.24, s * 0.3);
    ctx.globalAlpha = 1;
  }
}

// a soft gust of petals across the island at the start of every sung line
const petalCache = new WeakMap();
function drawPetals(g, ctx, C, t, F, S, glowK, shiftY) {
  const lines = F.ev.lines || [];
  let m = petalCache.get(lines);
  if (!m) { m = new Map(); petalCache.set(lines, m); }
  const key = `${S.t0}|${S.t1}`;
  let births = m.get(key);
  if (!births) {
    births = [];
    for (const l of lines) if (l[0] >= S.t0 + 3 && l[0] <= S.t1) for (let j = 0; j < 14; j++) births.push(l[0] + j * 0.11);
    births.sort((a, b) => a - b);
    m.set(key, births);
  }
  const ps = particles({ seed: 221, t, births, life: 8,
    origin: (k, r, r2) => [-80 - r * 160, 430 + r2 * 420], vel: (k, r, r2) => [260 + 120 * r, -30 + 50 * r2], drag: 0.08, swirl: 24, swirlHz: 0.45 });
  const cols = [C.cloud, C.mote, C.house, C.skyLow];
  const spr = g.sprites.glow(C.mote);
  for (const p of ps) {
    const a = sm(p.age / 0.4) * (1 - sm((p.u - 0.75) / 0.25)) * glowK;
    if (a <= 0.01) continue;
    const ang = p.age * (2 + 3 * p.r) + p.r2 * 6;
    const s = 3 + 3.5 * p.r;
    const y = p.y + shiftY;
    if (p.k % 4 === 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 * a;
      ctx.drawImage(spr, p.x - s * 3, y - s * 3, s * 6, s * 6); ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.85 * a;
    ctx.translate(p.x, y); ctx.rotate(ang); ctx.scale(1, 0.45 + 0.4 * Math.sin(p.age * 4 + p.r * 7));
    ctx.fillStyle = cols[p.k % 4];
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.6, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// --- the kids -----------------------------------------------------------------------------------------

function castState(g, t, tl, F, P, S, o) {
  const { friendsIn, snaps, grow, tip, beatS, isl, sinceDownAt, kiteSize } = o;
  const tctx = { friendsIn, beatS, snaps, t0: S.t0 };
  // hands join on every downbeat: they meet on the beat, hold for a beat, let go
  const dp = F.last('downbeats', t), dn = F.next('downbeats', t);
  let lineW = 0;
  if (dn !== null && dn !== undefined) lineW = Math.max(lineW, sm((t - (dn - 0.2)) / 0.2));
  if (dp !== null && dp !== undefined) { const a = t - dp; lineW = Math.max(lineW, a < beatS * 1.5 ? 1 : 1 - sm((a - beatS * 1.5) / 0.3)); }
  const kids = [];
  for (let i = 0; i < CAST.length; i++) {
    const c = CAST[i];
    const tm = timeline(c, tctx);
    if (t < tm.tA || t > tm.tEnd) { kids.push(null); continue; }
    const thr = 0.38 + 0.24 * hashU(161, i, 1);
    const teen = grow >= thr;
    const d = teen ? c.who.teen : c.who.child;
    const scale = lerp(170, 230, grow) / d.height;
    const U = d.height * scale;
    const slotX = lerp(ISLAND.slots[c.slot], TEEN_SLOTS[c.slot], grow);
    const ground = ISLAND.ground + GROUND[c.slot] - 10;
    const k = { i, c, tm, d, scale, U, ground, x: slotX, x0: slotX, arm: KITE_HOME[c.slot][0] < 960 + slotX - 60 ? 'L' : 'R', view: 'front', facing: 1, alpha: 1, mode: 'stand', pop: Math.max(0, 1 - Math.abs(grow - thr) / 0.06) * (grow > 0 && grow < 1 ? 1 : 0) };
    if (t < tm.tS) {                                   // running in
      const a = t - tm.tA;
      k.mode = 'run';
      k.view = 'side';
      k.facing = slotX > tm.edge ? 1 : -1;
      const runT = Math.max(0, a - 0.35);
      const dist = Math.abs(slotX - tm.edge);
      const p = clamp((runT * RUN_SPEED) / dist);
      k.x = lerp(tm.edge, slotX, clamp(runT * RUN_SPEED / dist));
      k.hop = a < 0.35 ? 46 * 4 * (a / 0.35) * (1 - a / 0.35) : 0;
      k.alpha = sm(a / 0.2);
      k.phase = (Math.abs(k.x - tm.edge) / (U * 0.95)) % 1;
    } else if (t >= tm.tw) {                           // walking away on the air
      const a = t - tm.tw;
      k.mode = 'walk';
      k.view = 'side';
      k.facing = tm.dir;
      const dist = 95 * a + 52 * a * a;
      k.x = slotX + tm.dir * dist;
      k.phase = (dist / (U * 0.7)) % 1;
      k.alpha = 1 - sm((a - 1.5) / 0.7);
      k.walkA = a;
    } else if (t >= tm.ts) {
      k.mode = c.wave ? 'wave' : 'lower';
      k.after = t - tm.ts;
    }
    kids.push(k);
  }
  // standing shoulders for hand-holding
  const standing = kids.map((k) => (k && (k.mode === 'stand') ? k : null));
  for (const k of kids) {
    if (!k || k.view !== 'front') continue;
    k.jStand = solve(k.d, poses.stand, { x: k.x, ground: k.ground, scale: k.scale, view: 'front' });
  }
  // kites
  const kites = [];
  for (const k of kids) {
    if (!k) continue;
    const slot = k.c.slot;
    const ts = k.tm.ts;
    const shiftY = -0.6 * 260 * tip;
    const posAt = (tt) => {
      if (tt <= ts) {
        const p = orbit(slot, o.clock(tt), beatS, sinceDownAt(tt), kiteSize);
        p[1] += shiftY;
        return p;
      }
      const p0 = orbit(slot, o.clock(ts), beatS, sinceDownAt(ts), kiteSize);
      const u = tt - ts;
      return [p0[0] - (150 * u + 75 * u * u), p0[1] + shiftY - (120 * u + 30 * u * u) + 14 * Math.sin(u * 5), p0[2] + u * (3.5 + 2.5 * u), kiteSize / (1 + 0.9 * u)];
    };
    k.posAt = posAt;
    kites.push(k);
  }
  // poses
  for (const k of kids) {
    if (!k) continue;
    const { d, i } = k;
    let pose;
    if (k.mode === 'run') pose = cycles.run(k.phase, 0.9);
    else if (k.mode === 'walk') pose = cycles.walk(k.phase, 0.85);
    else {
      pose = { ...poses.stand, bob: 0.006 * Math.sin(tl * 2.1 + i), head: -0.3 + 0.06 * Math.sin(tl * 0.7 + i) };
      const js = k.jStand;
      // the kite arm (on the kite's side) steers towards the kite
      const A = k.arm, sd = A === 'R' ? 1 : -1;
      const shA = js[`shoulder${A}`];
      const kp = k.posAt(t);
      const kl = islandLocal(isl, ...kiteBridle(kp[0], kp[1], kp[2], kp[3]));
      let dx = sd * (kl[0] - shA[0]), dy = kl[1] - shA[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      if (dx < 0.12) { dx = 0.12; const n = Math.hypot(dx, dy); dx /= n; dy /= n; }   // keep the hand on its own side
      const tug = k.c.key === 'kit' ? 0.05 * dipShape(F.c.since_down || 0) : 0;
      const reach = 0.255 * (0.93 + 0.07 * Math.sin(tl * 1.9 + i)) - tug;
      if (k.c.key === 'kit') { pose.rot = 0.035 * Math.sin((Math.PI * (F.c.mt || 0)) / 2); pose.head += 0.12 * tug / 0.05; }
      let aK = armTo(d, dx * reach, dy * reach);
      if (t < k.tm.tL + 0.4) { const u = sm((t - k.tm.tL) / 0.4); aK = { s: lerp(0.1, aK.s, u), e: lerp(0.2, aK.e, u) }; }
      const free = { s: 0.14 + 0.07 * Math.sin(tl * 1.1 + i), e: 0.28 };
      const arms = { R: A === 'R' ? { ...aK } : { ...free }, L: A === 'L' ? { ...aK } : { ...free } };
      // hand-holding with standing neighbours on the downbeats (strings stay tied to the wrists)
      if (k.mode === 'stand' && lineW > 0) {
        const right = nextStanding(standing, i, 1), left = nextStanding(standing, i, -1);
        if (right && right.jStand) {
          const m = meet(js.shoulderR, right.jStand.shoulderL, k.U);
          const a = armTo(d, (m[0] - js.shoulderR[0]) / k.U, (m[1] - js.shoulderR[1]) / k.U);
          arms.R = { s: lerp(arms.R.s, a.s, lineW), e: lerp(arms.R.e, a.e, lineW) };
        }
        if (left && left.jStand) {
          const m = meet(left.jStand.shoulderR, js.shoulderL, left.U);
          const a = armTo(d, (js.shoulderL[0] - m[0]) / k.U, (m[1] - js.shoulderL[1]) / k.U);
          arms.L = { s: lerp(arms.L.s, a.s, lineW), e: lerp(arms.L.e, a.e, lineW) };
        }
      }
      if (k.mode === 'lower') { const u = sm(k.after / 0.4); arms[A] = { s: lerp(arms[A].s, 0.1, u), e: lerp(arms[A].e, 0.2, u) }; pose.head = lerp(pose.head, 0.15, u); }
      if (k.mode === 'wave') {
        const u = sm(k.after / 0.3) * (1 - sm((k.after - 1.0) / 0.25));
        arms.L = { s: lerp(arms.L.s, 2.55, u), e: lerp(arms.L.e, 0.45 + 0.42 * Math.sin(k.after * 13), u) };
        if (A === 'R') arms.R = { s: lerp(arms.R.s, 0.1, sm(k.after / 0.4)), e: lerp(arms.R.e, 0.2, sm(k.after / 0.4)) };
        pose.head = lerp(pose.head, 0.05, u);
        pose.rot = 0.06 * u;
      }
      let sR = arms.R.s, eR = arms.R.e, sL = arms.L.s, eL = arms.L.e;
      if (k.c.key === 'kit' && tip > 0) {           // balance as the island tips
        sL = lerp(sL, 1.5, sm(tip * 2)); eL = lerp(eL, 0.3, sm(tip * 2));
        pose.lean = -0.12 * tip; pose.kL = 0.25 * tip; pose.kR = 0.25 * tip; pose.hL = 0.15 * tip; pose.hR = 0.15 * tip;
      }
      Object.assign(pose, { sR, eR, sL, eL });
    }
    if (k.hop) pose.bob = (pose.bob || 0) + k.hop / k.U;
    k.pose = pose;
  }
  // draw order by depth
  const draw = kids.filter(Boolean).sort((a, b) => a.ground - b.ground || a.x - b.x);
  // solve hand positions in screen space for the strings
  for (const k of draw) {
    const j = solve(k.d, k.pose, { x: k.x, ground: k.ground, scale: k.scale, view: k.view, facing: k.facing });
    k.hand = islandPoint(isl, ...j[`wrist${k.arm}`]);
    k.j = j;
  }
  const kiteList = kites.filter((k) => k.mode !== 'run');
  return { draw, kites: kiteList };
}

function nextStanding(list, i, dir) {
  const j = i + dir;
  return j >= 0 && j < list.length ? list[j] : null;
}
function meet(a, b, U) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.27 * U]; }

function drawKid(g, ctx, k, t) {
  if (k.alpha <= 0.01) return;
  // glowing footprints on the air for the ones walking away
  if (k.mode === 'walk') {
    const stride = k.U * 0.35, dist = 95 * k.walkA + 52 * k.walkA * k.walkA;
    const nMax = Math.floor(dist / stride);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spr = g.sprites.glow('#FFE9B0');
    for (let n = nMax; n >= Math.max(0, nMax - 6); n--) {
      const fx = k.x0 + k.tm.dir * n * stride;
      if (Math.abs(fx) < ISLAND.topRX - 10) continue;
      ctx.globalAlpha = 0.6 * (1 - (nMax - n) / 7) * k.alpha;
      ctx.drawImage(spr, fx - 24, k.ground - 7, 48, 14);
    }
    ctx.restore();
  }
  const cx = k.x, cy = k.ground - k.U * 0.5;
  if (k.pop > 0.01) {            // growing up: a soft burst of light behind, sparkles in front
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 * k.pop;
    const r = k.U * 0.75;
    ctx.drawImage(g.sprites.glow('#FFE7A8'), cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
  }
  drawPuppet(ctx, k.d, k.pose, { x: k.x, ground: k.ground, scale: k.scale, view: k.view, facing: k.facing, alpha: k.alpha, devScale: g.scale });
  if (k.pop > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spr = g.sprites.glow('#FFF6E0', 1);
    for (let s = 0; s < 9; s++) {
      const a = hashU(191, k.i * 16 + s, 1) * TAU, rr = k.U * (0.3 + 0.35 * hashU(191, k.i * 16 + s, 2)) * (1.3 - 0.5 * k.pop);
      const sr = 5 + 7 * hashU(191, k.i * 16 + s, 3);
      ctx.globalAlpha = k.pop;
      ctx.drawImage(spr, cx + Math.cos(a) * rr - sr, cy + Math.sin(a) * rr * 1.3 - sr, 2 * sr, 2 * sr);
    }
    ctx.restore();
  }
}

function drawKiteOf(g, ctx, C, k, t, strAlpha) {
  const color = k.d.fill;
  const ts = k.tm.ts;
  const launchU = outCubic((t - k.tm.tL) / 1.7);
  const [hx, hy] = k.hand;
  if (t < ts) {
    let [x, y, ang, size] = k.posAt(t);
    let tail;
    if (launchU < 1) {
      const lift = (tt) => {
        const u = outCubic((tt - k.tm.tL) / 1.7);
        const p = k.posAt(tt);
        return [lerp(hx, p[0], u), lerp(hy - 30, p[1], u), p[2] * u, p[3] * (0.6 + 0.4 * u)];
      };
      [x, y, ang, size] = lift(t);
      tail = kiteTail(lift, t);
    } else tail = kiteTail(k.posAt, t);
    const [bx, by] = kiteBridle(x, y, ang, size);
    drawString(g, ctx, hx, hy, bx, by, { color: C.string, alpha: strAlpha * k.alpha, sag: 0.05, bow: -18, glow: 1.1 });
    drawKite(g, ctx, { x, y, ang, size, color, tail, glow: 0.45 * strAlpha + 0.15, alpha: k.alpha });
    return;
  }
  // snapped: the kite tumbles away up-left and shrinks into the sky
  const u = t - ts;
  const [x, y, ang, size] = k.posAt(t);
  const fade = 1 - sm((u - 2.2) / 0.8);
  if (fade > 0) {
    // the kite-side piece of string trails below the kite
    const [bx, by] = kiteBridle(x, y, ang, size);
    const len = 160 * (1 - sm(u / 1.4));
    if (len > 2) drawString(g, ctx, bx, by, bx + len * 0.5, by + len, { color: C.string, alpha: 0.7 * (1 - sm(u / 1.4)), sag: 0, bow: 20 * Math.sin(u * 9), glow: 0.8 });
    drawKite(g, ctx, { x, y, ang, size, color, tail: kiteTail(k.posAt, t), glow: 0.3, alpha: fade });
  }
  // the hand-side piece whips and recoils in 0.3 s
  const p0 = k.posAt(ts);
  const [kbx, kby] = kiteBridle(p0[0], p0[1], p0[2], p0[3]);
  const vx = kbx - hx, vy = kby - hy;
  if (u < 0.3) {
    const f = 1 - outCubic(u / 0.3) * 0.92;
    const L = Math.hypot(vx, vy) || 1, nx = -vy / L, ny = vx / L;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = C.string;
    ctx.lineCap = 'round';
    for (const [w, a] of [[8, 0.12], [2.2, 0.9]]) {
      ctx.lineWidth = w; ctx.globalAlpha = a * strAlpha;
      ctx.beginPath();
      for (let s = 0; s <= 16; s++) {
        const q = s / 16;
        const wig = 40 * (1 - u / 0.3) * Math.sin(Math.PI * q * 3 + u * 40) * q;
        const px = hx + vx * f * q + nx * wig, py = hy + vy * f * q + ny * wig + 40 * q * q * (u / 0.3);
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  } else if (u < 1.2 && k.mode !== 'walk') {
    drawString(g, ctx, hx, hy, hx + 6, hy + 28, { color: C.string, alpha: 0.7 * (1 - sm((u - 0.3) / 0.9)), sag: 0, bow: 5, glow: 0.6 });
  }
  // the spark at the hand
  if (u < 0.7) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = 150 * Math.exp(-u / 0.12) + 24;
    ctx.globalAlpha = Math.exp(-u / 0.2);
    ctx.drawImage(g.sprites.glow('#FFF6E0', 1), hx - r, hy - r, 2 * r, 2 * r);
    const rr = 30 + 260 * outCubic(u / 0.6);
    ctx.globalAlpha = 0.35 * (1 - u / 0.7);
    ctx.drawImage(g.sprites.glow(C.string), hx - rr, hy - rr, 2 * rr, 2 * rr);
    const spr = g.sprites.glow(C.string);
    for (let s = 0; s < 18; s++) {
      const a = hashU(171, k.i * 20 + s, 1) * TAU, sp = 160 + 220 * hashU(171, k.i * 20 + s, 2);
      const px = hx + Math.cos(a) * sp * u, py = hy + Math.sin(a) * sp * u + 300 * u * u;
      ctx.globalAlpha = (1 - u / 0.7) * 0.9;
      ctx.drawImage(spr, px - 6, py - 6, 12, 12);
    }
    ctx.restore();
  }
}

// --- motes released from Kit's string by every sung note --------------------------------------------

const birthCache = new WeakMap();
function moteBirths(F, S, per) {
  const notes = F.ev.voc_notes || [];
  let m = birthCache.get(notes);
  if (!m) { m = new Map(); birthCache.set(notes, m); }
  const key = `${S.t0}|${S.t1}|${per}`;
  let b = m.get(key);
  if (!b) {
    const times = [], idx = [];
    for (let n = 0; n < notes.length; n++) {
      const t0 = notes[n][0];
      if (t0 < S.t0 || t0 > S.t1) continue;
      for (let j = 0; j < per; j++) { times.push(t0 + j * 0.05); idx.push(n * 16 + j); }
    }
    b = { times, idx };
    m.set(key, b);
  }
  return b;
}

function drawMotes(g, ctx, C, t, F, P, S, o) {
  const { clock, beatS, isl0, kiteSize, glowK, tip } = o;
  const per = Math.max(1, Math.round(P.motesPerNote));
  const B = moteBirths(F, S, per);
  const notes = F.ev.voc_notes;
  const life = P.moteLife;
  const kitSlot = 2;
  const kitHand = [lerp(ISLAND.slots[kitSlot], TEEN_SLOTS[kitSlot], o.grow) + 26, ISLAND.ground - lerp(128, 172, o.grow)];
  const shiftY = -260 * tip;
  const ps = particles({
    seed: 181, t, births: B.times, life,
    origin: (k, r, r2) => {
      const tb = B.times[k];
      const tlb = clock(tb);
      const bob = 8 * Math.sin((TAU * tlb) / (16 * beatS));
      const hand = [960 + kitHand[0], isl0 + bob + kitHand[1]];
      const kp = orbit(kitSlot, tlb, beatS, F.col('since_down', tb) || 0, kiteSize);
      const [bx, by] = kiteBridle(kp[0], kp[1], kp[2], kp[3]);
      const [cx, cy] = stringControl(hand[0], hand[1], bx, by, 0.05, -18);
      return stringPoint(hand[0], hand[1], cx, cy, bx, by, 0.25 + 0.7 * r);
    },
    vel: (k, r, r2) => [-14 + 22 * (r2 - 0.5), -18 - 26 * r2],
    grav: [0, -3], drag: 0.15, swirl: 16, swirlHz: 0.22,
  });
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of ps) {
    const k = p.k;
    const n = Math.floor(B.idx[k] / 16), j = B.idx[k] % 16;
    const note = notes[n];
    const vel = note[3] ?? 0.6, warm = clamp((note[2] - 53) / 12);
    const col = mix(g, C.mote, '#FFAE7A', Math.round(warm * 5) / 5 * 0.8);
    const main = j === 0;
    const r = main ? 6 + 8 * clamp((vel - 0.3) / 0.6) : 2 + 2.5 * p.r;
    const a = sm(p.age / 0.3) * (1 - sm((p.u - 0.6) / 0.4)) * (0.75 + 0.25 * Math.sin(p.age * 5 + p.r * 9)) * glowK;
    const y = p.y + shiftY;
    ctx.globalAlpha = a * (main ? 0.9 : 0.7);
    ctx.drawImage(g.sprites.glow(col), p.x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
    ctx.globalAlpha = a;
    ctx.drawImage(g.sprites.glow('#FFFFFF'), p.x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
  }
  ctx.restore();
}
