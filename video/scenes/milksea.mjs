// B1 The Milk Sea. Kite Island splashes down on a pale milk sea under a turning spiral sun; Kit, June
// and the friends step off and march across the water on the beat while a faceless crowd surfaces
// behind them. Kicks ripple at their feet, hats glint on the crests, snares shimmer along them. On
// every numb window the milk rises up the figures, the colour drains and time brakes to a near stop.
//
// Everything is pure: the world runs on a freeze clock tau(t) = t - freeze * integral(numb), every
// particle is closed-form and every sprite / layout cache is a pure function of its key.

import { KIT, JUNE, FRIENDS, crowdDesign, INK } from './lib/cast.mjs';
import { drawPuppet, puppetSprite, cycles, poses, blend } from './lib/puppet.mjs';
import { lattice, fbm, vnoise, hashU, field, drawField } from './lib/worldkit.mjs';
import { drawIsland as paintIsland, ISLAND } from './lib/island.mjs';

export const meta = { type: 'milksea', budgetMs: 150 };

export const defaults = {
  swell: -1,          // time (s) of the build: crowd recruiting speeds up (<0: 60% through the entry)
  crowdMax: 220,      // crowd size at the end of the recruiting
  crowdStart: 12,     // crowd members who surface right after the landing
  horizon: 430,       // horizon row (logical px)
  sunX: 960, sunY: 300, sunR: 150,
  freeze: 0.92,       // how hard numb brakes time (tau = t - freeze * integral(numb))
  drain: 0.85,        // colour drain toward milk at numb = 1
  keep: 0.25,         // drain kept after a window, times numb_accum
  rise: 0.85,         // metres the milk rises at numb = 1 (waist-high on a 1.7 m figure)
  waveBase: 12,       // wave height near the camera (px) ...
  waveBass: 30,       // ... plus this times bass_lvl
  landing: 1.5,       // seconds of splash-down at the start
};

export const DEFAULT = {
  skyTop: '#5EC8D8', skyLow: '#FFD3B6', sun: '#FFF1C9', sunRing: '#FFB38A', sea: '#EDE6FA', seaDeep: '#B9A9E3',
  crest: '#FFFFFF', milk: '#F4F1FF', crowd: '#8C7FB8', sparkle: '#FFFFFF', island: '#3B2350', house: '#F3D9E8',
  roof: '#9C3F6E', window: '#FFD27A',
};

const TAU = Math.PI * 2;
const FOC = 1150;            // focal length (logical px)
const CAMH = 3;              // eye height above the sea (m)
const BODY = 1.7;            // figure height (m)
const TEEN_PX = 230;         // cast teen design height at scale 1
const NSTRIP = 44;
const ZFAR = 170, ZNEAR = 5.6;
const ZS = Array.from({ length: NSTRIP }, (_, k) => ZFAR * (ZNEAR / ZFAR) ** (k / (NSTRIP - 1)));
const STEP = 24;
const NPTS = Math.ceil(1920 / STEP) + 3;
const crestBuf = Array.from({ length: NSTRIP }, () => new Float32Array(NPTS));   // scratch, rewritten every frame
const foamBuf = Array.from({ length: NSTRIP }, () => new Float32Array(NPTS));    // scratch: foam strength per segment
const LW = lattice(911), LW2 = lattice(912);

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (x) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const fract = (x) => x - Math.floor(x);

function palOf(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(DEFAULT)) o[k] = p[k] || DEFAULT[k];
  return o;
}

const mixCache = new Map();
function mixc(g, a, b, t) {
  const k = `${a}${b}${Math.round(t * 1000)}`;
  let v = mixCache.get(k);
  if (!v) {
    v = g.color.mix(a, b, Math.round(t * 1000) / 1000);
    if (mixCache.size > 4000) mixCache.clear();
    mixCache.set(k, v);
  }
  return v;
}

/** Wave height (m) of the milk at world (X, Z), clock tt: long swells travelling right plus chop. */
function waveY(X, Z, tt, amp) {
  const a = fbm(LW, (X - 1.4 * tt) * 0.16, Z * 0.22 + tt * 0.05, 3);
  const b = vnoise(LW2, (X - 2.1 * tt) * 0.55 + 31, Z * 0.7 - tt * 0.25);
  return amp * ((a - 0.5) * 2.2 + (b - 0.5) * 0.8);
}

// ---------------------------------------------------------------------------------------------
// Cached art: island, clouds
// ---------------------------------------------------------------------------------------------

const artCache = new Map();
function cached(key, make) {
  let v = artCache.get(key);
  if (!v) {
    v = make();
    if (artCache.size > 40) artCache.delete(artCache.keys().next().value);
    artCache.set(key, v);
  }
  return v;
}

/** A soft painted cloud sprite (lit top, shaded belly), blurred once. */
function cloudSprite(g, pal, seed) {
  return cached(`cloud|${seed}|${g.scale}|${pal.skyTop}|${pal.skyLow}`, () => {
    const W = 560, Hh = 240, ds = g.scale;
    const a = g.createCanvas(Math.ceil(W * ds), Math.ceil(Hh * ds));
    const x = a.getContext('2d');
    x.scale(ds, ds);
    const lit = g.color.mix(pal.skyLow, '#FFFFFF', 0.72);
    const belly = g.color.mix(pal.skyLow, pal.skyTop, 0.38);
    const lobes = [];
    const n = 9 + Math.floor(hashU(seed, 0, 1) * 5);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const hump = Math.sin(Math.PI * u);
      const r = 26 + 52 * hump * (0.6 + 0.4 * hashU(seed, i, 2));
      lobes.push([70 + u * 420 + (hashU(seed, i, 3) - 0.5) * 30, 175 - r * 0.75 - 18 * hump * hashU(seed, i, 4), r]);
    }
    // shaded body
    x.fillStyle = belly;
    for (const [cx, cy, r] of lobes) { x.beginPath(); x.arc(cx, cy + 10, r, 0, TAU); x.fill(); }
    x.fillRect(60, 150, 440, 32);
    // lit tops
    for (const [cx, cy, r] of lobes) {
      const gr = x.createRadialGradient(cx - r * 0.2, cy - r * 0.45, r * 0.1, cx, cy, r);
      gr.addColorStop(0, '#FFFFFF');
      gr.addColorStop(0.55, lit);
      gr.addColorStop(1, g.color.css(lit, 0));
      x.fillStyle = gr;
      x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    }
    const b = g.createCanvas(a.width, a.height);
    const y = b.getContext('2d');
    y.filter = `blur(${(4 * ds).toFixed(2)}px)`;
    y.drawImage(a, 0, 0);
    y.filter = 'none';
    y.getImageData(0, 0, 1, 1);
    return { canvas: b, w: W, h: Hh };
  });
}

// ---------------------------------------------------------------------------------------------
// Crowd layout (pure function of its key)
// ---------------------------------------------------------------------------------------------

const layoutCache = new Map();
function crowdLayout(n, seed) {
  const key = `${n}|${seed}`;
  let L = layoutCache.get(key);
  if (L) return L;
  const rows = 10, z0 = 22, z1 = 78;
  const zs = Array.from({ length: rows }, (_, r) => z0 * (z1 / z0) ** (r / (rows - 1)));
  const wsum = zs.reduce((a, b) => a + b, 0);
  const items = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    const m = Math.max(2, Math.round((n * zs[r]) / wsum));
    const half = (960 / FOC) * zs[r] * 1.06;
    const gap = (zs[Math.min(rows - 1, r + 1)] - zs[r]) || zs[r] * 0.1;
    for (let j = 0; j < m && id < n; j++) {
      const u = (j + 0.5 + (hashU(seed, id, 1) - 0.5) * 0.8) / m;
      items.push({
        id, row: r,
        X: (u * 2 - 1) * half,
        Z: zs[r] + (hashU(seed, id, 2) - 0.5) * gap * 0.7,
        hv: 0.9 + 0.2 * hashU(seed, id, 3),
        rank: r * 0.12 + hashU(seed, id, 4),
        sway: hashU(seed, id, 5),
      });
      id++;
    }
  }
  [...items].sort((a, b) => a.rank - b.rank).forEach((it, i) => { it.order = i; });
  items.sort((a, b) => b.Z - a.Z);
  L = items;
  layoutCache.set(key, L);
  return L;
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

const ISL_TOP = 1.45;         // island top centre above the waterline (m); the front lip is ~0.95 m up
const ISL_W_M = 9.0;
const CAST = () => [KIT, JUNE, ...FRIENDS].map((c, i) => ({
  d: c.teen,
  slot: [[-2.3, 9.0], [-0.55, 10.6], [1.2, 12.3], [2.85, 14.0], [4.5, 15.8], [6.1, 17.5]][i],
  start: (ISLAND.slots[i] / (2 * ISLAND.topRX)) * ISL_W_M,   // the island's own standing slots
}));
let castList = null;

/** Inverse of smoothstep on [0, 1]. */
function invSmooth(y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < y) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const pal = palOf(S);
  const t0 = S.t0, t1 = S.t1, dur = Math.max(1e-3, t1 - t0);
  const beatS = F.beatS || 0.46;
  const freeze = P.freeze ?? defaults.freeze;
  const hy = P.horizon ?? defaults.horizon;
  const numb = clamp(F.c.numb || 0);
  const tauAt = (x) => x - freeze * F.integral('numb', t0, Math.max(t0, x));
  const tau = tauAt(t);
  const tt = tau - t0;                                   // frozen seconds into the scene
  const lostBeats = (x) => (freeze * F.integral('numb', t0, Math.max(t0, x))) / beatS;
  // walk/beat clock: mt minus the beats numb took away, re-locked to the grid after each window
  let corr = 0;
  for (const w of F.ev.numb || []) {
    const we = w[1] + 0.6;
    if (we <= t0 || we >= t) continue;
    const Lw = lostBeats(we);
    corr += smooth((t - we) / (2 * beatS)) * (Lw - 2 * Math.round(Lw / 2));
  }
  const mb = (F.c.mt || 0) - lostBeats(t) + corr;      // braked beat count
  const mt0 = F.col('mt', t0);
  const walkP = mb / 2 + 0.25;                           // a foot plants on every beat
  // the milk climbs over ~0.8 s and the colour drains over ~0.35 s (running means of the numb envelope)
  const riseEnv = t - t0 > 0.8 ? clamp(F.integral('numb', t - 0.8, t) / 0.8 * 1.04) : numb;
  const drainEnv = t - t0 > 0.35 ? clamp(F.integral('numb', t - 0.35, t) / 0.35 * 1.03) : numb;
  const rise = (P.rise ?? defaults.rise) * smooth(riseEnv);
  const amp = ((P.waveBase ?? 12) + (P.waveBass ?? 30) * (F.c.bass_lvl || 0)) / (FOC / ZNEAR) * (1 - 0.65 * riseEnv);
  const sp = (x) => 960 + x;                             // helper for readability

  // the build from P.swell to the cut, and a slow push-in over the chorus (braked with time)
  const swellT0 = P.swell > t0 && P.swell < t1 ? P.swell : t0 + 0.6 * dur;
  const build = smooth((t - swellT0) / Math.max(1, t1 - swellT0));
  const push = 1 + 0.085 * smooth(tt / (dur * 0.8));
  ctx.save();
  ctx.translate(900, 600);
  ctx.scale(push, push);
  ctx.translate(-900, -600);

  // ---------------- sky ----------------
  const skyMid = mixc(g, pal.skyTop, pal.skyLow, 0.45);
  g.world.sky(g, [[0, pal.skyTop], [(hy / 1080) * 0.55, skyMid], [hy / 1080, pal.skyLow], [1, pal.sea]]);
  const fc = field(g, { key: 'milksky', seed: 41, t: tt, w: 256, h: 64, scale: 2.6, warp: 1.1, flow: 0.04, speed: [0.03, 0.006], octaves: 4, contrast: 1.1,
    stops: [[0, pal.skyTop], [0.5, skyMid], [1, '#FFFFFF']] });
  drawField(g, fc, { alpha: 0.22, x: 0, y: 0, w: 1920, h: hy + 8 });
  // horizon glow
  {
    const gh = ctx.createLinearGradient(0, hy - 150, 0, hy + 6);
    gh.addColorStop(0, g.color.css(pal.skyLow, 0));
    gh.addColorStop(0.75, g.color.css(mixc(g, pal.skyLow, '#FFFFFF', 0.4), 0.55));
    gh.addColorStop(1, g.color.css('#FFFFFF', 0.7));
    ctx.fillStyle = gh;
    ctx.fillRect(0, hy - 150, 1920, 156);
  }

  // ---------------- spiral sun ----------------
  const sunX = P.sunX ?? 960, sunY = P.sunY ?? 300;
  const lastDown = F.last('downbeats', t + 0.5 / F.fps);
  const downPulse = lastDown === null ? 0 : Math.exp(-Math.max(0, t - Math.floor(lastDown * F.fps + 0.5) / F.fps) / 0.22) * (1 - 0.8 * numb);
  const R = (P.sunR ?? 150) * (1 + 0.06 * downPulse);
  const spin = (TAU * mb) / 32;                          // one turn per 8 bars, braked
  ctx.save();
  ctx.drawImage(g.sprites.glow(pal.sunRing), sunX - R * 4.2, sunY - R * 4.2, R * 8.4, R * 8.4);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(g.sprites.glow(pal.sun), sunX - R * 2.6, sunY - R * 2.6, R * 5.2, R * 5.2);
  ctx.globalAlpha = 1;
  // the spiral of light: 12 curved wedges
  {
    const gr = ctx.createRadialGradient(sunX, sunY, R * 0.6, sunX, sunY, R * 2.6);
    gr.addColorStop(0, g.color.css(pal.sun, 0.55));
    gr.addColorStop(0.5, g.color.css(pal.sun, 0.22));
    gr.addColorStop(1, g.color.css(pal.sun, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a0 = spin + (i / 12) * TAU;
      const pts = 14;
      for (let k = 0; k <= pts; k++) {
        const u = k / pts, r = R * (0.5 + 2.1 * u), a = a0 + 1.5 * u;
        const px = sunX + Math.cos(a) * r, py = sunY + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      for (let k = pts; k >= 0; k--) {
        const u = k / pts, r = R * (0.5 + 2.1 * u), a = a0 + 1.5 * u + 0.16 * (1 - 0.6 * u);
        ctx.lineTo(sunX + Math.cos(a) * r, sunY + Math.sin(a) * r);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
  // six concentric rings drifting outward
  for (let i = 0; i < 6; i++) {
    const f = fract(i / 6 + tt * 0.045);
    const rr = R * (1.1 + 1.25 * f);
    const al = Math.sin(Math.PI * f) * (0.5 + 0.3 * build);
    ctx.strokeStyle = g.color.css(pal.sunRing, al);
    ctx.lineWidth = 5.5 - 3 * f;
    ctx.beginPath(); ctx.arc(sunX, sunY, rr, 0, TAU); ctx.stroke();
  }
  // disc with a turning spiral on it
  {
    const gd = ctx.createRadialGradient(sunX - R * 0.2, sunY - R * 0.25, R * 0.05, sunX, sunY, R);
    gd.addColorStop(0, '#FFFFFF');
    gd.addColorStop(0.6, pal.sun);
    gd.addColorStop(1, mixc(g, pal.sun, pal.sunRing, 0.35));
    ctx.fillStyle = gd;
    ctx.beginPath(); ctx.arc(sunX, sunY, R, 0, TAU); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(sunX, sunY, R - 2, 0, TAU); ctx.clip();
    ctx.strokeStyle = g.color.css(pal.sunRing, 0.38);
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const u = k / 24, r = R * 0.08 + R * 0.95 * u, a = -spin * 1.5 + (i / 6) * TAU + 2.4 * u;
        const px = sunX + Math.cos(a) * r, py = sunY + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // ---------------- clouds ----------------
  for (let i = 0; i < 7; i++) {
    const cs = cloudSprite(g, pal, 300 + i);
    const depth = hashU(31, i, 1);
    const sc = 0.45 + 0.75 * (1 - depth) * (0.7 + 0.3 * hashU(31, i, 4));
    const v = 5 + 14 * (1 - depth);
    const span = 1920 + cs.w * sc + 200;
    const x = ((hashU(31, i, 2) * span + v * tt) % span) - cs.w * sc - 100;
    const y = 40 + depth * (hy - 210) + 14 * Math.sin(tt * 0.07 + i);
    ctx.globalAlpha = 0.55 + 0.35 * (1 - depth);
    ctx.drawImage(cs.canvas, x, y, cs.w * sc, cs.h * sc);
  }
  ctx.globalAlpha = 1;

  // ---------------- birds ----------------
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = g.color.css(mixc(g, pal.skyTop, INK, 0.62), 0.7);
  for (let i = 0; i < 7; i++) {
    const sc = 0.6 + 0.8 * hashU(41, i, 1);
    const span = 2300;
    const x = ((hashU(41, i, 2) * span + (18 + 14 * sc) * tt) % span) - 190;
    const y = 90 + hashU(41, i, 3) * 230 + 16 * Math.sin(tt * 0.5 + i * 2);
    const flap = Math.sin(tt * (6.5 + hashU(41, i, 4) * 2) + i * 1.7);
    const w = 15 * sc, lift = flap * 7 * sc;
    ctx.lineWidth = 2.2 * sc;
    ctx.beginPath();
    ctx.moveTo(x - w, y - lift);
    ctx.quadraticCurveTo(x - w * 0.45, y - 4 * sc - lift * 0.3, x, y);
    ctx.quadraticCurveTo(x + w * 0.45, y - 4 * sc - lift * 0.3, x + w, y - lift);
    ctx.stroke();
  }
  ctx.restore();

  // ---------------- the sea: strips interleaved with the island and the crowd ----------------
  const stripCol = [];
  const crestPx = [];
  for (let k = 0; k < NSTRIP; k++) {
    const u = k / (NSTRIP - 1);
    let c = mixc(g, pal.sea, pal.seaDeep, Math.round(smooth(u) ** 0.85 * 60) / 60);
    if (k < 12) c = mixc(g, c, pal.skyLow, Math.round((1 - k / 12) * 0.4 * 30) / 30);
    stripCol.push(c);
  }
  // base fill under the farthest strip
  ctx.fillStyle = stripCol[0];
  ctx.fillRect(0, hy - 1, 1920, 1081 - hy);

  // crest polylines
  for (let k = 0; k < NSTRIP; k++) {
    const Z = ZS[k], s = FOC / Z, buf = crestBuf[k];
    for (let i = 0; i < NPTS; i++) {
      const x = -STEP + i * STEP;
      const X = (x - 960) / s;
      buf[i] = hy + (CAMH - rise - waveY(X, Z, tt, amp)) * s;
      foamBuf[k][i] = vnoise(LW2, (X - 1.4 * tt) * 0.42 + 77, Z * 0.9 + 5);
    }
    crestPx.push(amp * s);
  }
  const bottomOf = (k) => (k >= NSTRIP - 1 ? 1090 : hy + (CAMH - rise) * (FOC / ZS[k + 1]) + crestPx[k + 1] * 1.8 + 6);
  const sunCol = mixc(g, pal.sun, '#FFFFFF', 0.3);
  const snareLast = F.last('snare', t + 0.5 / F.fps);
  const snAge = snareLast ? t - Math.floor(snareLast[0] * F.fps + 0.5) / F.fps : 99;
  const snareAmt = snAge >= 0 && snAge < 0.3 ? (1 - snAge / 0.3) * (0.5 + 0.5 * (snareLast[2] ?? 1)) * (1 - numb) : 0;
  const glint = g.sprites.glow(pal.sparkle, 1);
  const drawStrip = (k) => {
    const buf = crestBuf[k], u = k / (NSTRIP - 1);
    const top = hy + (CAMH - rise) * (FOC / ZS[k]) - crestPx[k] * 1.6;
    const bot = bottomOf(k);
    ctx.beginPath();
    ctx.moveTo(-STEP, buf[0]);
    for (let i = 1; i < NPTS; i++) ctx.lineTo(-STEP + i * STEP, buf[i]);
    ctx.lineTo(1920 + STEP * 2, bot);
    ctx.lineTo(-STEP, bot);
    ctx.closePath();
    const c = stripCol[k];
    const gr = ctx.createLinearGradient(0, top, 0, Math.max(top + 4, bot));
    gr.addColorStop(0, mixc(g, c, pal.crest, Math.round((0.15 + 0.45 * (1 - numb)) * 40) / 40));
    gr.addColorStop(0.3, c);
    gr.addColorStop(1, mixc(g, c, pal.seaDeep, 0.45 + 0.35 * u));
    ctx.fillStyle = gr;
    ctx.fill();
    // the sun's light path on this strip
    const halfW = 50 + 300 * u ** 1.3;
    const i0 = Math.max(0, Math.floor((sunX - halfW + STEP) / STEP)), i1 = Math.min(NPTS - 1, Math.ceil((sunX + halfW + STEP) / STEP));
    if (i1 > i0) {
      const gs = ctx.createLinearGradient(sunX - halfW, 0, sunX + halfW, 0);
      const al = 0.42 * (1 - 0.5 * u);
      gs.addColorStop(0, g.color.css(sunCol, 0));
      gs.addColorStop(0.5, g.color.css(sunCol, al));
      gs.addColorStop(1, g.color.css(sunCol, 0));
      ctx.fillStyle = gs;
      ctx.beginPath();
      ctx.moveTo(-STEP + i0 * STEP, buf[i0]);
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(-STEP + i * STEP, buf[i]);
      const yb = Math.min(bot, buf[i1] + (bot - top) * 0.45);
      ctx.lineTo(-STEP + i1 * STEP, yb);
      ctx.lineTo(-STEP + i0 * STEP, yb);
      ctx.closePath();
      ctx.fill();
    }
    // crest highlights: broken foam that travels with the swell and flattens out when numb
    const fb = foamBuf[k];
    const calm = 1 - 0.8 * riseEnv;
    ctx.lineCap = 'round';
    for (let b = 1; b <= 2; b++) {
      const lo = b === 1 ? 0.42 : 0.6, hi = b === 1 ? 0.6 : 2;
      ctx.strokeStyle = g.color.css(pal.crest, ((b === 1 ? 0.3 : 0.75) * (0.45 + 0.55 * u) + 0.35 * snareAmt) * calm);
      ctx.lineWidth = (b === 1 ? 0.8 : 1) * (0.8 + 4 * u ** 1.2);
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < NPTS - 1; i++) {
        const f = (fb[i] + fb[i + 1]) * 0.5;
        if (f >= lo && f < hi) {
          if (!open) ctx.moveTo(-STEP + i * STEP, buf[i]);
          ctx.lineTo(-STEP + (i + 1) * STEP, buf[i + 1]);
          open = true;
        } else open = false;
      }
      ctx.stroke();
    }
    // sun glitter on this strip
    if (k > 3) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const n = 2 + Math.floor(u * (5 + 4 * build));
      for (let j = 0; j < n; j++) {
        const x = sunX + (hashU(91, k, j) * 2 - 1) * halfW * (0.25 + 0.75 * hashU(92, k, j));
        const tw = Math.sin(tt * (2.5 + 4 * hashU(93, k, j)) + hashU(94, k, j) * TAU);
        if (tw < 0.25) continue;
        const ii = clamp(Math.round((x + STEP) / STEP), 0, NPTS - 1);
        const r = (2 + 8 * u) * (tw - 0.25);
        ctx.globalAlpha = 0.95 * (tw - 0.25);
        ctx.drawImage(glint, x - r, buf[ii] + 1 - r, 2 * r, 2 * r);
      }
      ctx.restore();
    }
  };

  // island placement (world): lands at Z0, bobs, then drifts right and away
  const landing = P.landing ?? 1.5;
  const tl = t - t0;
  const Zi0 = 19.6;
  const driftU = smooth((tt - 5.5) / Math.max(4, dur - 5.5));
  const Xi = 0.0 + 9.5 * driftU ** 1.1;
  const Zi = Zi0 + 26 * driftU ** 1.25;
  const drop = tl < 0 ? 0 : -0.62 * Math.exp(-tl / 0.55) * Math.sin(tl * 5.6);
  const bob = 0.07 * Math.sin(tt * TAU / (16 * beatS)) + 0.03 * Math.sin(tt * 1.3);
  const Yi = drop + bob + rise;
  const ISL_W = ISL_W_M;
  // splash crown: milk jets thrown up round the island rim (back half behind the island)
  const crownEnv = tl >= 0 && tl < 1.1 ? Math.sin(Math.PI * clamp(tl / 1.1)) ** 0.6 : 0;
  const drawCrown = (front) => {
    if (crownEnv <= 0) return;
    const N = 46;
    const shade = mixc(g, pal.milk, pal.seaDeep, 0.45);
    for (let j = 0; j < N; j++) {
      const a = (j / N) * TAU + hashU(55, j, 1) * 0.1;
      const isFront = Math.sin(a) < 0;
      if (isFront !== front) continue;
      const X = Math.cos(a) * 5.0, Z = Zi0 + Math.sin(a) * 2.8;
      const ss = FOC / Z;
      const hgt = (0.9 + 1.7 * hashU(55, j, 2)) * crownEnv * (0.7 + 0.3 * Math.abs(Math.cos(a)));
      const lean = Math.cos(a) * 0.45 * hgt;
      const bx = 960 + X * ss, by = hy + CAMH * ss;
      const tx = bx + lean * ss, ty = by - hgt * ss;
      const w = (0.34 + 0.26 * hashU(55, j, 3)) * ss;
      const gr = ctx.createLinearGradient(0, ty, 0, by);
      gr.addColorStop(0, pal.milk);
      gr.addColorStop(1, shade);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(bx - w, by + 2);
      ctx.quadraticCurveTo(bx - w * 0.2, by - hgt * ss * 0.5, tx, ty);
      ctx.quadraticCurveTo(bx + w * 0.2, by - hgt * ss * 0.5, bx + w, by + 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx, ty, w * 0.55, 0, TAU);
      ctx.fill();
      ctx.fillStyle = g.color.css('#FFFFFF', 0.9);
      ctx.beginPath();
      ctx.arc(tx - w * 0.15, ty - w * 0.15, w * 0.2, 0, TAU);
      ctx.fill();
    }
  };
  const drawIsland = () => {
    drawCrown(false);
    const s = FOC / Zi, k = (s * ISL_W) / (2 * ISLAND.topRX);
    const ix = 960 + Xi * s, iy = hy + (CAMH - Yi) * s;
    paintIsland(g, ctx, { x: ix, y: iy - ISL_TOP * s, scale: k, t: tt, palette: pal, glow: 1 + 0.35 * (F.c.voc_lvl || 0), sway: 1 - 0.85 * numb });
    // foam lapping along the waterline
    const wl = hy + (CAMH - rise) * s;
    ctx.strokeStyle = g.color.css(pal.crest, 0.75);
    ctx.lineWidth = Math.max(1.5, 4 * k);
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const u = i / 28;
      const px = ix + (-0.97 + 1.94 * u) * ISLAND.topRX * k;
      const py = Math.max(iy, wl) + (Math.sin(u * 19 + tt * 2.3) * 3 - 2) * k;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // crowd
  const crowdMax = Math.max(0, Math.round(P.crowdMax ?? defaults.crowdMax));
  const crowdStart = Math.min(crowdMax, Math.round(P.crowdStart ?? defaults.crowdStart));
  const layout = crowdLayout(crowdMax, (S.seed || 0) + 7);
  const swellT = P.swell > t0 && P.swell < t1 ? P.swell : t0 + 0.6 * dur;
  const swellTau = tauAt(swellT) - t0;
  const endTau = Math.max(swellTau + 1, 0.78 * dur);
  const appearAt = (o) => {
    if (o < crowdStart) return 2.0 + o * 0.22;
    const f = (o - crowdStart) / Math.max(1, crowdMax - crowdStart);
    const a = 0.4;
    return f < a ? 4.5 + (f / a) * Math.max(0, swellTau - 4.5) : swellTau + ((f - a) / (1 - a)) * (endTau - swellTau);
  };
  const crowdD = crowdDesign(pal.crowd, 'teen');
  const phaseQ = Math.floor(fract(walkP) * 12);
  const crowdPose = cycles.walk(phaseQ / 12);
  const items = [];
  for (const it of layout) {
    const ta = appearAt(it.order);
    const e = (tt - ta) / 0.9;
    if (e <= 0) continue;
    items.push([it, clamp(e)]);
  }
  const drawCrowd = (it, e) => {
    const s = FOC / it.Z;
    const X = it.X + 0.25 * Math.sin(tt * 0.2 + it.sway * TAU);
    const x = 960 + X * s;
    if (x < -80 || x > 2000) return;
    const sink = -1.9 * (1 - outCubic(e));
    const scale = (BODY * s * it.hv) / TEEN_PX;
    const q = Math.round(Math.log(scale) / Math.log(1.12));
    const sq = 1.12 ** q;
    const spr = puppetSprite(g, crowdD, crowdPose, { key: `ms${phaseQ}`, scale: sq, facing: -1, view: 'side' });
    const kk = scale / sq;
    const gy = hy + (CAMH - sink) * s;
    const haze = clamp((it.Z - 22) / 60);
    ctx.globalAlpha = (1 - 0.55 * haze) * clamp(e * 3);
    ctx.drawImage(spr.canvas, x - spr.ax * kk, gy - spr.ay * kk, spr.w * kk, spr.h * kk);
    ctx.globalAlpha = 1;
    // surfacing splash ring
    if (e < 1) {
      const rr = (0.3 + 1.2 * e) * s;
      ctx.strokeStyle = g.color.css(pal.crest, 0.8 * (1 - e));
      ctx.lineWidth = Math.max(1, 2.5 * s / 60);
      ctx.beginPath();
      ctx.ellipse(x, hy + (CAMH - rise) * s, rr, rr * CAMH / it.Z, 0, 0, TAU);
      ctx.stroke();
    }
  };
  // merge: items with Z > ZS[k] are drawn before strip k
  let ci = 0;
  let islandDone = false;
  for (let k = 0; k < NSTRIP; k++) {
    const Zk = ZS[k];
    while (true) {
      const nextCrowd = ci < items.length ? items[ci][0].Z : -1;
      const islZ = islandDone ? -1 : Zi;
      if (nextCrowd <= Zk && islZ <= Zk) break;
      if (islZ > nextCrowd) { drawIsland(); islandDone = true; } else { drawCrowd(items[ci][0], items[ci][1]); ci++; }
    }
    drawStrip(k);
  }
  if (!islandDone) drawIsland();

  // horizon line sparkle and mist
  {
    const gm = ctx.createLinearGradient(0, hy - 6, 0, hy + 40);
    gm.addColorStop(0, g.color.css('#FFFFFF', 0.5));
    gm.addColorStop(1, g.color.css(pal.sea, 0));
    ctx.fillStyle = gm;
    ctx.fillRect(0, hy - 6, 1920, 46);
  }

  // ---------------- landing splash: crown of droplets + ring wave ----------------
  if (tl >= 0 && tl < landing + 1.6) {
    const s = FOC / Zi0, cx = 960, cy = hy + CAMH * s;
    // expanding ring waves
    for (let r = 0; r < 3; r++) {
      const a = tl - r * 0.22;
      if (a <= 0) continue;
      const rad = (4.8 + 9 * outCubic(a / 2.4)) * s;
      ctx.strokeStyle = g.color.css(pal.crest, 0.9 * (1 - clamp(a / 2.4)) ** 1.5);
      ctx.lineWidth = 6 - r * 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 6, rad, rad * CAMH / Zi0 * 1.25, 0, 0, TAU);
      ctx.stroke();
    }
    // foam skirt
    const foam = clamp(1 - tl / 1.4);
    if (foam > 0) {
      ctx.globalAlpha = 0.85 * foam;
      ctx.drawImage(g.sprites.glow(pal.milk), cx - 340 * (1 + tl), cy - 60, 680 * (1 + tl), 120);
      ctx.globalAlpha = 1;
    }
    drawCrown(true);
    // flying droplets (closed form, gravity)
    const shade = mixc(g, pal.milk, pal.seaDeep, 0.55);
    for (let i = 0; i < 120; i++) {
      const tb = 0.05 + hashU(51, i, 1) * 0.25;
      const age = tl - tb;
      const life = 0.8 + 0.8 * hashU(51, i, 2);
      if (age < 0 || age > life) continue;
      const ang = hashU(51, i, 3) * TAU;
      const rim = 4.8 + 0.5 * hashU(51, i, 4);
      const X0 = Math.cos(ang) * rim, Z0 = Zi0 + Math.sin(ang) * rim * 0.55;
      const vout = 1.5 + 3 * hashU(51, i, 5), vup = 4 + 5.5 * hashU(51, i, 6);
      const X = X0 + Math.cos(ang) * vout * age;
      const Z = Z0 + Math.sin(ang) * vout * age * 0.5;
      const Y = 0.6 + vup * age - 4.9 * age * age;
      if (Y < -0.1) continue;
      const ss = FOC / Z;
      const x = 960 + X * ss, y = hy + (CAMH - Y) * ss;
      const r = (0.06 + 0.1 * hashU(51, i, 7)) * ss;
      ctx.globalAlpha = Math.min(1, 3 * (1 - age / life));
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.arc(x, y + r * 0.15, r, 0, TAU); ctx.fill();
      ctx.fillStyle = pal.milk;
      ctx.beginPath(); ctx.arc(x - r * 0.1, y - r * 0.05, r * 0.85, 0, TAU); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- the walkers ----------------
  if (!castList) castList = CAST();
  const walkers = castList.map((c, i) => {
    const depart = mt0 + 2 + 1.5 * i, travel = 9;
    const q = clamp((mb - depart) / travel);
    const qe = smooth(q);
    const Z0 = Zi0 - 0.35, X0 = c.start;
    const [X1, Z1] = c.slot;
    let X = X0 + (X1 - X0) * qe, Z = Z0 + (Z1 - Z0) * qe;
    X += 0.18 * Math.sin(tt * 0.31 + i * 1.9) * qe;
    // stepping off the island: drop 1 m with a little hop, then a splash
    const drop0 = 0.55, dropLen = 0.7;
    const off = Z0 - Z;
    const hopU = clamp((off - drop0) / dropLen);
    const onIsland = hopU <= 0;
    const topY = 1.0 + (q <= 0 ? Yi - rise : drop + bob);
    const Y = topY * (1 - hopU) + 0.35 * Math.sin(Math.PI * hopU) + (hopU >= 1 ? 0 : 0);
    let landAge = -1;
    if (Z0 - Z1 > drop0 + dropLen) {
      const qL = invSmooth((drop0 + dropLen) / (Z0 - Z1));
      landAge = (mb - (depart + qL * travel)) * beatS;
    }
    return { ...c, i, X, Z, Y: hopU >= 1 ? 0 : Y, onSea: hopU >= 1, onIsland, amt: clamp((mb - depart) * 2), landAge };
  });

  // kicks -> ripple rings at a walker's feet (frozen by the brake, none spawned while numb)
  const rings = [];
  for (const kk of F.between('kick', t - 3, t + 0.5 / F.fps)) {
    const tk = Math.floor(kk[0] * F.fps + 0.5) / F.fps;
    if (tk > t + 1e-6 || tk < t0) continue;
    const spawn = 1 - clamp(F.col('numb', tk) * 1.6);
    if (spawn <= 0) continue;
    const age = tau - tauAt(tk);
    if (age < 0 || age > 0.8) continue;
    const pick = [0, 0, 1, 1, 2, 3, 4, 5][Math.floor(hashU(61, Math.round(tk * 1000), 1) * 8)];
    rings.push({ w: pick, u: age / 0.8, s: spawn * (0.55 + 0.45 * (kk[2] ?? 1)) });
  }

  const ringAt = (x, y, Z, u, str, half) => {
    const s = FOC / Z;
    const rad = (0.25 + 1.5 * outCubic(u)) * s;
    const ry = rad * (CAMH / Z) * 1.1;
    ctx.strokeStyle = g.color.css(pal.crest, 0.95 * str * (1 - u) ** 1.4);
    ctx.lineWidth = Math.max(1.2, (3.2 * s) / 115) * (1 - 0.5 * u);
    ctx.beginPath();
    if (half === 'back') ctx.ellipse(x, y, rad, ry, 0, Math.PI, TAU);
    else ctx.ellipse(x, y, rad, ry, 0, 0, Math.PI);
    ctx.stroke();
    if (u > 0.15) {
      const u2 = (u - 0.15) / 0.85, rad2 = (0.2 + 1.0 * outCubic(u2)) * s;
      ctx.lineWidth *= 0.6;
      ctx.beginPath();
      if (half === 'back') ctx.ellipse(x, y, rad2, rad2 * (CAMH / Z) * 1.1, 0, Math.PI, TAU);
      else ctx.ellipse(x, y, rad2, rad2 * (CAMH / Z) * 1.1, 0, 0, Math.PI);
      ctx.stroke();
    }
  };

  const drop1 = g.sprites.glow('#FFFFFF', 1);
  const order = [...walkers].sort((a, b) => b.Z - a.Z);
  for (const w of order) {
    const s = FOC / w.Z;
    const x = 960 + w.X * s;
    const feetY = hy + (CAMH - w.Y) * s;
    const surfY = hy + (CAMH - rise) * s;
    const myRings = w.onSea ? rings.filter((r) => r.w === w.i) : [];
    // rings while the walker is still on the island go round the island instead
    if (!w.onSea) for (const r of rings.filter((r2) => r2.w === w.i)) {
      const si = FOC / Zi;
      const cx = 960 + Xi * si, cy = hy + (CAMH - rise) * si;
      ctx.strokeStyle = g.color.css(pal.crest, 0.8 * r.s * (1 - r.u) ** 1.4);
      ctx.lineWidth = 2.5;
      const rad = (4.9 + 1.6 * outCubic(r.u)) * si;
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, rad, rad * (CAMH / Zi) * 1.2, 0, 0, Math.PI); ctx.stroke();
    }
    for (const r of myRings) ringAt(x, surfY, w.Z, r.u, r.s, 'back');
    const scale = (BODY * s) / TEEN_PX;
    const walk = cycles.walk(walkP, w.amt);
    const pose = w.amt < 1 ? blend({ ...poses.stand, kL: 0.2 * Math.exp(-fract(mb) * 6), kR: 0.2 * Math.exp(-fract(mb) * 6), bob: -0.012 * Math.exp(-fract(mb) * 6) }, walk, w.amt) : walk;
    if (!w.onSea && !w.onIsland) pose.hL = (pose.hL || 0) + 0.3, pose.kL = (pose.kL || 0) + 0.5;
    drawPuppet(ctx, w.d, pose, { x, ground: feetY, facing: -1, view: 'side', scale, devScale: g.scale });
    // the milk in front of the walker: redraw the nearer strips over its lower body
    if (!w.onIsland) {
      const Hpx = BODY * s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - Hpx * 0.6, feetY - Hpx * 1.25, Hpx * 1.2, Hpx * 1.25 + 80);
      ctx.clip();
      for (let k = 0; k < NSTRIP; k++) {
        if (ZS[k] >= w.Z - 0.12) continue;
        const top = hy + (CAMH - rise) * (FOC / ZS[k]) - crestPx[k] * 2;
        if (top > feetY + 60) break;
        drawStrip(k);
      }
      ctx.restore();
    }
    // a soft painted reflection of the coat in the milk
    if (!w.onIsland) {
      const Hpx = BODY * s;
      const above = clamp((surfY - (feetY - Hpx)) / Hpx);   // how much of the body is above the milk
      ctx.save();
      ctx.globalAlpha = 0.28 * above;
      ctx.drawImage(g.sprites.glow(w.d.fill), x - Hpx * 0.16, surfY - Hpx * 0.06, Hpx * 0.32, Hpx * 0.7 * above);
      ctx.globalAlpha = 0.22 * above;
      ctx.drawImage(g.sprites.glow(w.d.limbFill), x - Hpx * 0.12, surfY - Hpx * 0.04, Hpx * 0.24, Hpx * 0.35);
      ctx.restore();
    }
    for (const r of myRings) ringAt(x, surfY, w.Z, r.u, r.s, 'front');
    // footstep splash on every planted foot (braked with the walk clock)
    if (w.onSea && w.amt > 0.5) {
      const stepF = fract(2 * walkP - 0.5);            // 0 at each plant
      const age = stepF * 2 * beatS;
      const n = Math.floor(2 * walkP - 0.5);
      for (let d = 0; d < 6; d++) {
        const life = 0.42;
        if (age > life) break;
        const hx = hashU(71 + w.i, n, d), hv = hashU(72 + w.i, n, d);
        const vx = (-0.6 - 1.4 * hx) * s, vy = (1.4 + 1.6 * hv) * s;
        const px = x - 0.18 * s + vx * age * 0.6, py = surfY - vy * age + 4.9 * s * age * age;
        const r = (0.025 + 0.025 * hv) * s * 2.2;
        ctx.globalAlpha = 0.9 * (1 - age / life);
        ctx.drawImage(drop1, px - r, py - r, 2 * r, 2 * r);
      }
      ctx.globalAlpha = 1;
    }
    // splash where they jump into the milk
    if (w.landAge >= 0 && w.landAge < 1.0) {
      const a = w.landAge;
      ringAt(x, surfY, w.Z, a, 1, 'back');
      ringAt(x, surfY, w.Z, a, 1, 'front');
      for (let d = 0; d < 14; d++) {
        const life = 0.6;
        if (a > life) break;
        const ang = hashU(81 + w.i, d, 1) * Math.PI;
        const v = (1.2 + 2.2 * hashU(81 + w.i, d, 2)) * s;
        const px = x + Math.cos(ang) * v * 0.45 * a, py = surfY - Math.sin(ang) * v * a + 4.9 * s * a * a;
        const r = (0.03 + 0.03 * hashU(81 + w.i, d, 3)) * s * 2.2;
        ctx.globalAlpha = 0.95 * (1 - a / life);
        ctx.drawImage(drop1, px - r, py - r, 2 * r, 2 * r);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- small living things ----------------
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // floating motes rising off the milk (closed form on the braked clock)
  const moteS = g.sprites.glow(mixc(g, pal.sun, pal.sparkle, 0.5));
  const rate = 14, life = 9;
  const k0 = Math.max(0, Math.ceil((tt + 60 - life) * rate)), k1 = Math.floor((tt + 60) * rate);
  for (let k = k0; k <= k1; k++) {
    const age = tt + 60 - k / rate;
    const u = age / life;
    const r1 = hashU(97, k, 1), r2 = hashU(97, k, 2), r3 = hashU(97, k, 3);
    const x = r1 * 1920 + 30 * Math.sin(age * 0.8 + r2 * TAU) + 12 * age;
    const y = hy + 40 + r2 * 600 - (20 + 35 * r3) * age;
    const r = 3 + 6 * r3;
    ctx.globalAlpha = (0.6 + 0.4 * build) * Math.sin(Math.PI * u);
    ctx.drawImage(moteS, x - r * 2, y - r * 2, r * 4, r * 4);
  }
  ctx.restore();

  // hats -> star glints popping on the crests
  {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const h of F.between('hat', t - 3, t + 0.5 / F.fps)) {
      const th = Math.floor(h[0] * F.fps + 0.5) / F.fps;
      if (th > t + 1e-6 || th < t0) continue;
      const spawn = 1 - clamp(F.col('numb', th) * 1.6);
      if (spawn <= 0) continue;
      const age = tau - tauAt(th);
      if (age < 0 || age > 0.25) continue;
      const id = Math.round(th * 1000);
      const n = 3 + Math.floor(hashU(101, id, 0) * 4);
      for (let j = 0; j < n; j++) {
        const k = 14 + Math.floor(hashU(102, id, j) * (NSTRIP - 15));
        const x = 60 + hashU(103, id, j) * 1800;
        const ii = clamp(Math.round((x + STEP) / STEP), 0, NPTS - 1);
        const y = crestBuf[k][ii] - 1;
        const u = k / (NSTRIP - 1);
        const grow = age < 0.07 ? outCubic(age / 0.07) : 1;
        const fade = age < 0.07 ? 1 : 1 - (age - 0.07) / 0.18;
        const sz = (14 + 26 * u) * grow * (0.6 + 0.4 * (h[2] ?? 1));
        ctx.globalAlpha = fade * spawn;
        ctx.drawImage(glint, x - sz * 0.5, y - sz * 0.5, sz, sz);
        ctx.fillStyle = pal.sparkle;
        ctx.beginPath();
        ctx.moveTo(x - sz, y); ctx.lineTo(x - sz * 0.08, y - sz * 0.08); ctx.lineTo(x, y - sz);
        ctx.lineTo(x + sz * 0.08, y - sz * 0.08); ctx.lineTo(x + sz, y); ctx.lineTo(x + sz * 0.08, y + sz * 0.08);
        ctx.lineTo(x, y + sz); ctx.lineTo(x - sz * 0.08, y + sz * 0.08); ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // snares -> a quick shimmer sweeping along the crests
  if (snareAmt > 0.01) {
    const cx = -200 + (snAge / 0.3) * 2400;
    const gs = ctx.createLinearGradient(cx - 260, 0, cx + 260, 0);
    gs.addColorStop(0, g.color.css('#FFFFFF', 0));
    gs.addColorStop(0.5, g.color.css('#FFFFFF', 0.9 * snareAmt));
    gs.addColorStop(1, g.color.css('#FFFFFF', 0));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = gs;
    for (let k = 12; k < NSTRIP; k++) {
      const buf = crestBuf[k];
      ctx.lineWidth = 2 + 3 * (k / NSTRIP);
      ctx.beginPath();
      ctx.moveTo(-STEP, buf[0]);
      for (let i = 1; i < NPTS; i++) ctx.lineTo(-STEP + i * STEP, buf[i]);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();   // end of the push-in

  // ---------------- numb: milk mist, colour drain ----------------
  const accum = clamp(F.c.numb_accum || 0);
  const drain = clamp((P.drain ?? defaults.drain) * drainEnv + (1 - drainEnv) * (P.keep ?? defaults.keep) * accum);
  if (riseEnv > 0.002) {
    const gm = ctx.createLinearGradient(0, hy - 60, 0, 1080);
    gm.addColorStop(0, g.color.css(pal.milk, 0));
    gm.addColorStop(0.5, g.color.css(pal.milk, 0.22 * riseEnv));
    gm.addColorStop(1, g.color.css(pal.milk, 0.45 * riseEnv));
    ctx.fillStyle = gm;
    ctx.fillRect(0, hy - 60, 1920, 1140 - hy);
  }
  if (drain > 0.002) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = drain;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.5 * drain;
    ctx.fillStyle = pal.milk;
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.restore();
  }
}
