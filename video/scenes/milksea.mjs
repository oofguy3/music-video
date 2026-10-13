// B1 The Milk Sea. Kite Island splashes down on a pale milk sea under a turning spiral sun. Kit steps
// off alone; June and the four friends rise out of the milk around the island, one per beat, and the
// six march across the water on the beat while a faceless crowd surfaces behind them. Kicks ripple at
// their feet, hats glint on the crests, snares shimmer along them. On every numb window the milk rises
// up the figures, the colour drains and time brakes to a near stop.
//
// The chorus is cut like a music video: hard cuts on phrase downbeats (every P.phraseBars bars) between
// four framings, in the order P.shots: WIDE (the island and the whole sea), TRACKING (low and close on
// Kit and June, the camera walking with them), TOP-DOWN (straight down on the milk: every beat throws
// ripple rings from every pair of feet, which interfere across the sea) and SILHOUETTE (a low angle
// into the giant spiral sun, the marchers crossing it in silhouette). Numb windows always land on a
// framing where the rising milk reads (WIDE or TRACKING): a numb onset inside another framing cuts to
// P.numbShot on its bar's downbeat. Each onset fires a pale shock ring across the milk and a sky blink.
//
// Everything is pure: the world runs on a freeze clock tau(t) = t - freeze * integral(numb), every
// particle is closed-form, the shot plan is a pure function of the event lists, and every sprite /
// layout / plan cache is a pure function of its key. Scratch buffers are rewritten every frame.

import { KIT, JUNE, FRIENDS, crowdDesign, INK } from './lib/cast.mjs';
import { drawPuppet, puppetSprite, cycles, poses, blend } from './lib/puppet.mjs';
import { lattice, fbm, vnoise, hashU, field, drawField } from './lib/worldkit.mjs';
import { drawIsland as paintIsland, ISLAND, islandColors } from './lib/island.mjs';

export const meta = { type: 'milksea', budgetMs: 185 };

export const defaults = {
  swell: -1,          // time (s) of the build: crowd recruiting speeds up (<0: 60% through the entry)
  crowdMax: 220,      // crowd size at the end of the recruiting
  crowdStart: 12,     // crowd members who surface right after the landing
  horizon: 430,       // horizon row of the wide shot (logical px)
  sunX: 960, sunY: 300, sunR: 150,
  freeze: 0.92,       // how hard numb brakes time (tau = t - freeze * integral(numb))
  drain: 0.85,        // colour drain toward milk at numb = 1
  keep: 0.25,         // drain kept after a window, times numb_accum
  rise: 0.85,         // metres the milk rises at numb = 1 (waist-high on a 1.7 m figure)
  waveBase: 12,       // wave height near the camera (px) ...
  waveBass: 30,       // ... plus this times bass_lvl
  landing: 1.5,       // seconds of splash-down at the start
  phraseBars: 4,      // a hard cut every this many bars, on the downbeat
  shots: 'wide,tracking,topdown,silhouette,tracking,topdown,wide',   // framing per phrase (cycled)
  numbShot: 'wide',   // framing forced over a numb window that would land on topdown / silhouette
  riseBeat: 2,        // beat (after the landing) the first friend rises out of the milk; then one per beat
  walkSpeed: 1.4,     // m/s the marchers cover in the moving framings
  beatBob: 1,         // extra dip of the walkers on every beat
};

export const DEFAULT = {
  skyTop: '#5EC8D8', skyLow: '#FFD3B6', sun: '#FFF1C9', sunRing: '#FFB38A', sea: '#EDE6FA', seaDeep: '#B9A9E3',
  crest: '#FFFFFF', milk: '#F4F1FF', crowd: '#8C7FB8', sparkle: '#FFFFFF', island: '#3B2350', house: '#F3D9E8',
  roof: '#9C3F6E', window: '#FFD27A',
};

const TAU = Math.PI * 2;
const FOC = 1150;            // focal length (logical px)
const CAMH = 3;              // eye height of the wide shot above the sea (m)
const BODY = 1.7;            // figure height (m)
const TEEN_PX = 230;         // cast teen design height at scale 1
const NSTRIP = 44;
const ZFAR = 170, ZNEAR = 5.6;
const STEP = 24;
const NPTS = Math.ceil(1920 / STEP) + 3;
const MAXS = 48;
const crestBuf = Array.from({ length: MAXS }, () => new Float32Array(NPTS));   // scratch, rewritten every frame
const foamBuf = Array.from({ length: MAXS }, () => new Float32Array(NPTS));    // scratch: foam strength per segment
const bandBuf = new Float32Array(MAXS);                                         // scratch: kick band per strip
const LW = lattice(911), LW2 = lattice(912), LW3 = lattice(913);

const SHOT_NAMES = new Set(['wide', 'tracking', 'topdown', 'silhouette']);
const MILKY = new Set(['wide', 'tracking']);
// hair and skin of the cast (KIT, JUNE, FRIENDS[0..3] in cast.mjs), for the figures seen from above
const HAIR = ['#3A2A1E', '#6B2D3C', '#22313F', '#C9A26B', '#5A3A22', '#1B1B2A'];
const SKIN = ['#FFDCC2', '#FFDCC2', '#FFDCC2', '#FFDCC2', '#D9A27E', '#B87A55'];
// where June and the friends break the surface around the island (world X, Z of the wide shot)
const RISE_AT = [null, [1.2, 12.6], [4.0, 13.4], [6.3, 14.6], [8.0, 16.6], [9.6, 19.0]];

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

const zsCache = new Map();
/** Depths of n sea strips from zFar to zNear (geometric), cached per key. */
function stripZs(n, zFar, zNear) {
  const k = `${n}|${zFar}|${zNear}`;
  let z = zsCache.get(k);
  if (!z) {
    z = Array.from({ length: n }, (_, i) => zFar * (zNear / zFar) ** (i / (n - 1)));
    zsCache.set(k, z);
  }
  return z;
}

// ---------------------------------------------------------------------------------------------
// Cached art: clouds, silhouette designs
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
    x.fillStyle = belly;
    for (const [cx, cy, r] of lobes) { x.beginPath(); x.arc(cx, cy + 10, r, 0, TAU); x.fill(); }
    x.fillRect(60, 150, 440, 32);
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

const silCache = new Map();
/** The same design drawn as a silhouette: the custom head is drawn as its outline shape (hair included). */
function silDesign(d) {
  let s = silCache.get(d.id);
  if (!s) {
    const head = typeof d.head === 'function' ? (ctx, r, info) => d.head(ctx, r, { ...info, pass: 'outline' }) : d.head;
    s = { ...d, head, face: 'none', farShade: 0.9, id: `${d.id}-sil` };
    silCache.set(d.id, s);
  }
  return s;
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
// Shot plan: hard cuts on phrase downbeats, numb windows forced onto a milk framing
// ---------------------------------------------------------------------------------------------

const planCache = new Map();
function shotPlan(F, P, S) {
  const fps = F.fps || 30;
  const seq = String(P.shots ?? defaults.shots).split(',').map((s) => s.trim().toLowerCase()).filter((s) => SHOT_NAMES.has(s));
  if (!seq.length) seq.push('wide');
  const pb = Math.max(1, Math.round(P.phraseBars ?? defaults.phraseBars));
  const ns0 = String(P.numbShot ?? defaults.numbShot).toLowerCase();
  const ns = MILKY.has(ns0) ? ns0 : 'wide';
  const key = `${S.t0}|${S.t1}|${pb}|${seq.join(',')}|${ns}|${F.duration}`;
  let plan = planCache.get(key);
  if (plan) return plan;
  const fr = (x) => Math.floor(x * fps + 0.5);
  const f0 = fr(S.t0), f1 = Math.max(f0 + 1, fr(S.t1));
  const downs = [...new Set((F.ev.downbeats || []).map(fr))].filter((f) => f >= f0 && f < f1).sort((a, b) => a - b);
  const cuts = [f0];
  for (let k = pb; k < downs.length; k += pb) if (downs[k] > cuts[cuts.length - 1]) cuts.push(downs[k]);
  let segs = cuts.map((a, i) => ({ a, b: i + 1 < cuts.length ? cuts[i + 1] : f1, name: seq[i % seq.length] }));
  const split = (f) => {
    const out = [];
    for (const s of segs) {
      if (f > s.a && f < s.b) out.push({ ...s, b: f }, { ...s, a: f });
      else out.push(s);
    }
    segs = out;
  };
  const barF = (F.bpb || 4) * (F.beatS || 0.5) * fps;
  for (const w of F.ev.numb || []) {
    const wa = fr(w[0]), wb = fr(w[1]);
    if (wb <= f0 || wa >= f1) continue;
    let a = wa;
    const prev = downs.filter((f) => f <= wa).pop();
    if (prev !== undefined && wa - prev <= barF + 1) a = prev;
    let b = downs.find((f) => f >= wb);
    if (b === undefined) b = f1;
    a = Math.max(a, f0); b = Math.min(b, f1);
    if (b <= a) continue;
    split(a); split(b);
    for (const s of segs) if (s.a >= a && s.b <= b && !MILKY.has(s.name)) s.name = ns;
  }
  const merged = [];
  for (const s of segs) {
    const p = merged[merged.length - 1];
    if (p && p.name === s.name && p.b === s.a) p.b = s.b;
    else merged.push({ ...s });
  }
  plan = merged.map((s) => ({ ...s, ta: s.a / fps, tb: s.b / fps }));
  if (planCache.size > 32) planCache.delete(planCache.keys().next().value);
  planCache.set(key, plan);
  return plan;
}

function shotAt(plan, t, fps) {
  const f = Math.round(t * fps);
  let i = 0;
  while (i < plan.length - 1 && f >= plan[i + 1].a) i++;
  const s = plan[i];
  return { ...s, idx: i, u: clamp((t - s.ta) / Math.max(1e-3, s.tb - s.ta)) };
}

// ---------------------------------------------------------------------------------------------
// Shared world state at t (everything every framing needs)
// ---------------------------------------------------------------------------------------------

const ISL_TOP = 1.45;         // island top centre above the waterline (m); the front lip is ~0.95 m up
const ISL_W_M = 9.0;
const CAST = () => [KIT, JUNE, ...FRIENDS].map((c, i) => ({
  d: c.teen,
  slot: [[-2.3, 9.0], [-0.55, 10.6], [1.2, 12.3], [2.85, 14.0], [4.5, 15.8], [6.1, 17.5]][i],
  start: (ISLAND.slots[i] / (2 * ISLAND.topRX)) * ISL_W_M,   // the island's own standing slots
  hair: HAIR[i], skin: SKIN[i],
}));
let castList = null;

/** Inverse of smoothstep on [0, 1]. */
function invSmooth(y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < y) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function state(g, t, F, P, S) {
  const pal = palOf(S);
  const fps = F.fps || 30;
  const t0 = S.t0, t1 = S.t1, dur = Math.max(1e-3, t1 - t0);
  const beatS = F.beatS || 0.46;
  const freeze = P.freeze ?? defaults.freeze;
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
  const swellT0 = P.swell > t0 && P.swell < t1 ? P.swell : t0 + 0.6 * dur;
  const build = smooth((t - swellT0) / Math.max(1, t1 - swellT0));
  const snap = (x) => Math.floor(x * fps + 0.5) / fps;
  const damp = 1 - 0.8 * numb;
  const pulse = (list, k) => {
    const l = F.last(list, t + 0.5 / fps);
    if (l === null || l === undefined) return 0;
    const a = t - snap(Array.isArray(l) ? l[0] : l);
    return a < 0 ? 0 : Math.exp(-a / k);
  };
  const downPulse = pulse('downbeats', 0.22) * damp;
  const beatPulse = pulse('beats', 0.15) * damp;

  // beat accents: every beat, as strong as the kick that lands on it (none spawned while numb)
  const accents = [];
  for (const b of F.between('beats', t - 3, t + 0.5 / fps)) {
    const tb = snap(b);
    if (tb > t + 1e-6 || tb < t0 - 1e-6) continue;
    const spawn = 1 - clamp(F.col('numb', tb) * 1.6);
    if (spawn <= 0) continue;
    let str = 0.45;
    for (const k of F.between('kick', tb - 0.07, tb + 0.1)) str = Math.max(str, k[2] ?? k[1] ?? 0.6);
    accents.push({ tb, age: tau - tauAt(tb), real: t - tb, s: Math.min(1, str) * spawn, id: Math.round(tb * 1000) });
  }

  // kicks -> ripple rings at a walker's feet (frozen by the brake, none spawned while numb)
  const rings = [];
  for (const kk of F.between('kick', t - 3, t + 0.5 / fps)) {
    const tk = snap(kk[0]);
    if (tk > t + 1e-6 || tk < t0) continue;
    const spawn = 1 - clamp(F.col('numb', tk) * 1.6);
    if (spawn <= 0) continue;
    const age = tau - tauAt(tk);
    if (age < 0 || age > 0.8) continue;
    const pick = [0, 0, 1, 1, 2, 3, 4, 5][Math.floor(hashU(61, Math.round(tk * 1000), 1) * 8)];
    rings.push({ w: pick, u: age / 0.8, age, s: spawn * (0.55 + 0.45 * (kk[2] ?? 1)) });
  }

  // snares and hats
  const snareLast = F.last('snare', t + 0.5 / fps);
  const snAge = snareLast ? t - snap(snareLast[0]) : 99;
  const snareAmt = snAge >= 0 && snAge < 0.3 ? (1 - snAge / 0.3) * (0.5 + 0.5 * (snareLast[2] ?? 1)) * (1 - numb) : 0;
  const hats = [];
  for (const h of F.between('hat', t - 1, t + 0.5 / fps)) {
    const th = snap(h[0]);
    if (th > t + 1e-6 || th < t0) continue;
    const spawn = 1 - clamp(F.col('numb', th) * 1.6);
    if (spawn <= 0) continue;
    const age = tau - tauAt(th);
    if (age < 0 || age > 0.25) continue;
    hats.push({ age, id: Math.round(th * 1000), s: h[2] ?? 1, spawn });
  }

  // numb onsets (real time, frame-snapped): shock ring and sky blink
  let onset = -1;
  for (const w of F.ev.numb || []) {
    const ta = snap(w[0]);
    if (ta < t0 - 1e-6 || ta >= t1) continue;
    const a = t - ta;
    if (a >= -1e-6 && a < 1.6) onset = Math.max(0, a);
  }

  // the island (world of the wide shot): lands at Zi0, bobs, then drifts right and away
  const tl = t - t0;
  const Zi0 = 19.6;
  const driftU = smooth((tt - 5.5) / Math.max(4, dur - 5.5));
  const Xi = 9.5 * driftU ** 1.1;
  const Zi = Zi0 + 26 * driftU ** 1.25;
  const drop = tl < 0 ? 0 : -0.62 * Math.exp(-tl / 0.55) * Math.sin(tl * 5.6);
  const bob = 0.07 * Math.sin(tt * TAU / (16 * beatS)) + 0.03 * Math.sin(tt * 1.3);
  const Yi = drop + bob + rise;

  // crowd
  const crowdMax = Math.max(0, Math.round(P.crowdMax ?? defaults.crowdMax));
  const crowdStart = Math.min(crowdMax, Math.round(P.crowdStart ?? defaults.crowdStart));
  const layout = crowdLayout(crowdMax, (S.seed || 0) + 7);
  const swellTau = tauAt(swellT0) - t0;
  const endTau = Math.max(swellTau + 1, 0.78 * dur);
  const appearAt = (o) => {
    if (o < crowdStart) return 2.0 + o * 0.22;
    const f = (o - crowdStart) / Math.max(1, crowdMax - crowdStart);
    const a = 0.4;
    return f < a ? 4.5 + (f / a) * Math.max(0, swellTau - 4.5) : swellTau + ((f - a) / (1 - a)) * (endTau - swellTau);
  };
  const crowd = [];
  for (const it of layout) {
    const e = (tt - appearAt(it.order)) / 0.9;
    if (e > 0) crowd.push([it, clamp(e)]);
  }
  const phaseQ = Math.floor(fract(walkP) * 12);

  // the six: Kit steps off the island, June and the friends rise out of the milk one per beat
  if (!castList) castList = CAST();
  const riseB = P.riseBeat ?? defaults.riseBeat;
  const walkers = castList.map((c, i) => {
    if (i === 0) {
      const depart = mt0 + 2, travel = 9;
      const q = clamp((mb - depart) / travel);
      const qe = smooth(q);
      const Z0 = Zi0 - 0.35, X0 = c.start;
      const [X1, Z1] = c.slot;
      let X = X0 + (X1 - X0) * qe, Z = Z0 + (Z1 - Z0) * qe;
      X += 0.18 * Math.sin(tt * 0.31 + i * 1.9) * qe;
      const drop0 = 0.55, dropLen = 0.7;
      const hopU = clamp((Z0 - Z - drop0) / dropLen);
      const onIsland = hopU <= 0;
      const topY = 1.0 + (q <= 0 ? Yi - rise : drop + bob);
      const Y = topY * (1 - hopU) + 0.35 * Math.sin(Math.PI * hopU);
      let landAge = -1;
      if (Z0 - Z1 > drop0 + dropLen) {
        const qL = invSmooth((drop0 + dropLen) / (Z0 - Z1));
        landAge = (mb - (depart + qL * travel)) * beatS;
      }
      return { ...c, i, X, Z, Y: hopU >= 1 ? 0 : Y, onSea: hopU >= 1, onIsland, amt: clamp((mb - depart) * 2), landAge, vis: 1, sink: 0 };
    }
    const rb = mt0 + riseB + (i - 1);
    const eb = mb - rb;
    if (eb <= 0) return { ...c, i, hidden: true, vis: 0 };
    const e = clamp(eb / 1.5);
    const sink = -1.95 * (1 - outCubic(e));
    const [Xr, Zr] = RISE_AT[i];
    const [X1, Z1] = c.slot;
    const qe = smooth((eb - 1.5) / 7);
    const X = Xr + (X1 - Xr) * qe + 0.18 * Math.sin(tt * 0.31 + i * 1.9) * qe;
    const Z = Zr + (Z1 - Zr) * qe;
    return { ...c, i, X, Z, Y: sink, sink, onSea: true, onIsland: false, amt: clamp((eb - 1.1) * 0.8), landAge: -1, riseAge: eb * beatS, vis: clamp(e * 4) };
  });

  return {
    pal, fps, t, t0, t1, dur, beatS, freeze, numb, tauAt, tau, tt, mb, mt0, walkP, riseEnv, drainEnv, rise, amp, build,
    downPulse, beatPulse, accents, rings, snareAmt, snAge, hats, onset, tl, Zi0, Xi, Zi, Yi, drop, bob,
    crowd, crowdD: crowdDesign(pal.crowd, 'teen'), crowdPose: cycles.walk(phaseQ / 12), phaseQ, walkers,
    v: P.walkSpeed ?? defaults.walkSpeed, beatBob: P.beatBob ?? defaults.beatBob,
    landing: P.landing ?? defaults.landing,
    spin: (TAU * mb) / 32,                               // one turn per 8 bars, braked
    voc: F.c.voc_lvl || 0,
    accum: clamp(F.c.numb_accum || 0),
  };
}

/** The walk pose with the beat in it: a dip of the knees and a nod on every beat. */
function poseFor(W, w) {
  const walk = cycles.walk(W.walkP, w.amt);
  const k0 = Math.exp(-fract(W.mb) * 6);
  const pose = w.amt < 1 ? blend({ ...poses.stand, kL: 0.2 * k0, kR: 0.2 * k0, bob: -0.012 * k0 }, walk, w.amt) : walk;
  const bp = W.beatPulse * W.beatBob;
  pose.bob = (pose.bob || 0) + 0.014 * w.amt * Math.abs(Math.sin(Math.PI * W.mb)) - 0.03 * bp;
  pose.kL = (pose.kL || 0) + 0.28 * bp;
  pose.kR = (pose.kR || 0) + 0.28 * bp;
  pose.hL = (pose.hL || 0) + 0.12 * bp;
  pose.hR = (pose.hR || 0) + 0.12 * bp;
  pose.head = (pose.head || 0) + 0.25 * bp;
  pose.sL = (pose.sL || 0) + 0.15 * bp;
  pose.sR = (pose.sR || 0) + 0.15 * bp;
  return pose;
}

// ---------------------------------------------------------------------------------------------
// Sky, spiral sun, clouds, birds
// ---------------------------------------------------------------------------------------------

function drawSky(g, W, hy, { warm = 0, field: withField = true, skyHy = hy, cachedSky = false } = {}) {
  const { ctx } = g;
  const pal = W.pal;
  const top = warm ? mixc(g, pal.skyTop, pal.skyLow, 0.3 * warm) : pal.skyTop;
  const low = warm ? mixc(g, pal.skyLow, pal.sunRing, 0.3 * warm) : pal.skyLow;
  const skyMid = mixc(g, top, low, 0.45);
  const hp = clamp(Math.round(skyHy) / 1080, 0.05, 0.98);   // the cached gradient keys on a fixed horizon
  if (cachedSky) g.world.sky(g, [[0, top], [hp * 0.55, skyMid], [hp, low], [1, pal.sea]]);
  else {                                          // a plain gradient: no full-frame build on a cut
    const gs = ctx.createLinearGradient(0, 0, 0, 1080);
    gs.addColorStop(0, top); gs.addColorStop(hp * 0.55, skyMid); gs.addColorStop(hp, low); gs.addColorStop(1, pal.sea);
    ctx.fillStyle = gs;
    ctx.fillRect(0, 0, 1920, 1080);
  }
  if (withField) {
    const fc = field(g, { key: 'milksky', seed: 41, t: W.tt, w: 256, h: 64, scale: 2.6, warp: 1.1, flow: 0.04, speed: [0.03, 0.006], octaves: 4, contrast: 1.1,
      stops: [[0, top], [0.5, skyMid], [1, '#FFFFFF']] });
    drawField(g, fc, { alpha: 0.22, x: 0, y: 0, w: 1920, h: hy + 8 });
  }
  const gh = ctx.createLinearGradient(0, hy - 150, 0, hy + 6);
  gh.addColorStop(0, g.color.css(low, 0));
  gh.addColorStop(0.75, g.color.css(mixc(g, low, '#FFFFFF', 0.4), 0.55));
  gh.addColorStop(1, g.color.css('#FFFFFF', 0.7));
  ctx.fillStyle = gh;
  ctx.fillRect(0, hy - 150, 1920, 156);
}

/** The spiral sun: glow, rays, 12 curved wedges of light, drifting rings and a disc with a turning spiral. */
function drawSun(g, W, sunX, sunY, R0, { rays = 1, alpha = 1, glow = 1 } = {}) {
  const { ctx } = g;
  const pal = W.pal;
  const bp = W.beatPulse, dp = W.downPulse;
  const R = R0 * (1 + 0.05 * dp + 0.035 * bp);
  const spin = W.spin;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(g.sprites.glow(pal.sunRing), sunX - R * 4.2 * glow, sunY - R * 4.2 * glow, R * 8.4 * glow, R * 8.4 * glow);
  ctx.globalAlpha = alpha * (0.85 + 0.15 * bp);
  ctx.drawImage(g.sprites.glow(pal.sun), sunX - R * 2.6, sunY - R * 2.6, R * 5.2, R * 5.2);
  ctx.globalAlpha = alpha;
  // long rays turning slowly against the spiral, flaring on every beat
  if (rays > 0) {
    const L = R * (5 + 1.2 * bp);
    const gr = ctx.createRadialGradient(sunX, sunY, R * 0.9, sunX, sunY, L);
    gr.addColorStop(0, g.color.css(pal.sun, (0.16 + 0.3 * bp + 0.1 * dp) * rays));
    gr.addColorStop(0.45, g.color.css(pal.sun, (0.05 + 0.12 * bp) * rays));
    gr.addColorStop(1, g.color.css(pal.sun, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = -spin * 0.5 + (i / n) * TAU;
      const w = (i % 2 ? 0.045 : 0.075) * (1 + 0.5 * bp);
      ctx.moveTo(sunX + Math.cos(a - w * 0.3) * R * 0.9, sunY + Math.sin(a - w * 0.3) * R * 0.9);
      ctx.lineTo(sunX + Math.cos(a - w) * L, sunY + Math.sin(a - w) * L);
      ctx.lineTo(sunX + Math.cos(a + w) * L, sunY + Math.sin(a + w) * L);
      ctx.lineTo(sunX + Math.cos(a + w * 0.3) * R * 0.9, sunY + Math.sin(a + w * 0.3) * R * 0.9);
      ctx.closePath();
    }
    ctx.fill();
  }
  // the spiral of light: 12 curved wedges
  {
    const gr = ctx.createRadialGradient(sunX, sunY, R * 0.6, sunX, sunY, R * 2.6);
    gr.addColorStop(0, g.color.css(pal.sun, Math.min(1, 0.55 + 0.35 * bp)));
    gr.addColorStop(0.5, g.color.css(pal.sun, 0.22 + 0.2 * bp));
    gr.addColorStop(1, g.color.css(pal.sun, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    const reach = 2.1 + 0.25 * bp;
    for (let i = 0; i < 12; i++) {
      const a0 = spin + (i / 12) * TAU;
      const pts = 14;
      for (let k = 0; k <= pts; k++) {
        const u = k / pts, r = R * (0.5 + reach * u), a = a0 + 1.5 * u;
        const px = sunX + Math.cos(a) * r, py = sunY + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      for (let k = pts; k >= 0; k--) {
        const u = k / pts, r = R * (0.5 + reach * u), a = a0 + 1.5 * u + 0.16 * (1 - 0.6 * u);
        ctx.lineTo(sunX + Math.cos(a) * r, sunY + Math.sin(a) * r);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
  // six concentric rings drifting outward
  for (let i = 0; i < 6; i++) {
    const f = fract(i / 6 + W.tt * 0.045);
    const rr = R * (1.1 + 1.25 * f);
    const al = Math.sin(Math.PI * f) * (0.5 + 0.3 * W.build + 0.35 * bp);
    ctx.strokeStyle = g.color.css(pal.sunRing, Math.min(1, al));
    ctx.lineWidth = (5.5 - 3 * f) * (R0 / 150) ** 0.5 * (1 + 0.4 * bp);
    ctx.beginPath(); ctx.arc(sunX, sunY, rr, 0, TAU); ctx.stroke();
  }
  // a beat ring bursting off the disc
  if (bp > 0.02) {
    ctx.strokeStyle = g.color.css('#FFFFFF', 0.55 * bp);
    ctx.lineWidth = 3 * (R0 / 150) ** 0.5;
    ctx.beginPath(); ctx.arc(sunX, sunY, R * (1.02 + 0.5 * (1 - bp)), 0, TAU); ctx.stroke();
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
    ctx.strokeStyle = g.color.css(pal.sunRing, 0.38 + 0.2 * bp);
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = 7 * (R0 / 150) ** 0.7;
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
}

function drawClouds(g, W, hy, { alpha = 1, speed = 1 } = {}) {
  const { ctx } = g;
  for (let i = 0; i < 7; i++) {
    const cs = cloudSprite(g, W.pal, 300 + i);
    const depth = hashU(31, i, 1);
    const sc = 0.45 + 0.75 * (1 - depth) * (0.7 + 0.3 * hashU(31, i, 4));
    const v = (5 + 14 * (1 - depth)) * speed;
    const span = 1920 + cs.w * sc + 200;
    const x = ((((hashU(31, i, 2) * span + v * W.tt) % span) + span) % span) - cs.w * sc - 100;
    const y = 40 + depth * Math.max(60, hy - 210) + 14 * Math.sin(W.tt * 0.07 + i);
    ctx.globalAlpha = (0.55 + 0.35 * (1 - depth)) * alpha;
    ctx.drawImage(cs.canvas, x, y, cs.w * sc, cs.h * sc);
  }
  ctx.globalAlpha = 1;
}

function drawBirds(g, W, { col = null, k = 1 } = {}) {
  const { ctx } = g;
  const tt = W.tt;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = col || g.color.css(mixc(g, W.pal.skyTop, INK, 0.62), 0.7);
  for (let i = 0; i < 7; i++) {
    const sc = (0.6 + 0.8 * hashU(41, i, 1)) * k;
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
}

// ---------------------------------------------------------------------------------------------
// The sea in perspective: strips with crest highlights, a sun path and the kick band
// ---------------------------------------------------------------------------------------------

/**
 * cam: {hy, h (eye height, m), foc, wx (world X at the screen centre), zs (strip depths far..near)}.
 * o: sunX, sunPath (strength of the light path), pathW, backlit (0..1 contre-jour darkening), ampK.
 */
function buildSea(g, W, cam, o = {}) {
  const { ctx } = g;
  const pal = W.pal;
  const { hy, h, foc, wx, zs } = cam;
  const n = zs.length;
  const rise = W.rise, tt = W.tt, numb = W.numb;
  const amp = W.amp * (o.ampK ?? 1);
  const sunX = o.sunX ?? 960;
  const sunPath = o.sunPath ?? 1, pathW = o.pathW ?? 1;
  const backlit = o.backlit ?? 0;
  const backCol = mixc(g, pal.seaDeep, INK, 0.42);
  const stripCol = [];
  const crestPx = [];
  const haze = Math.round(n * 0.27);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    let c = mixc(g, pal.sea, pal.seaDeep, Math.round(smooth(u) ** 0.85 * 60) / 60);
    if (k < haze) c = mixc(g, c, pal.skyLow, Math.round((1 - k / haze) * 0.4 * 30) / 30);
    if (backlit > 0) c = mixc(g, c, backCol, Math.round(backlit * (0.25 + 0.75 * u) * 20) / 20);
    stripCol.push(c);
  }
  ctx.fillStyle = stripCol[0];
  ctx.fillRect(0, hy - 1, 1920, 1081 - hy);
  for (let k = 0; k < n; k++) {
    const Z = zs[k], s = foc / Z, buf = crestBuf[k], fb = foamBuf[k];
    for (let i = 0; i < NPTS; i++) {
      const X = (-STEP + i * STEP - 960) / s + wx;
      buf[i] = hy + (h - rise - waveY(X, Z, tt, amp)) * s;
      fb[i] = vnoise(LW2, (X - 1.4 * tt) * 0.42 + 77, Z * 0.9 + 5);
    }
    crestPx.push(amp * s);
  }
  // the kick band: on every beat a band of brightened crests runs out from the camera to the horizon
  bandBuf.fill(0, 0, n);
  for (const a of W.accents) {
    if (a.age < 0 || a.age > 0.62) continue;
    const p = a.age / 0.62;
    const uc = 1.12 - 1.35 * p;
    const str = a.s * (1 - 0.55 * p) * (1 - numb);
    for (let k = 0; k < n; k++) {
      const d = (k / (n - 1) - uc) / 0.075;
      if (d > -3 && d < 3) bandBuf[k] += str * Math.exp(-d * d);
    }
  }
  const bottomOf = (k) => (k >= n - 1 ? 1090 : hy + (h - rise) * (foc / zs[k + 1]) + crestPx[k + 1] * 1.8 + 6);
  const sunCol = mixc(g, pal.sun, '#FFFFFF', 0.3);
  const glint = g.sprites.glow(pal.sparkle, 1);
  const calm = 1 - 0.8 * W.riseEnv;
  const snareAmt = W.snareAmt;
  const drawStrip = (k) => {
    const buf = crestBuf[k], u = k / (n - 1);
    const top = hy + (h - rise) * (foc / zs[k]) - crestPx[k] * 1.6;
    const bot = bottomOf(k);
    ctx.beginPath();
    ctx.moveTo(-STEP, buf[0]);
    for (let i = 1; i < NPTS; i++) ctx.lineTo(-STEP + i * STEP, buf[i]);
    ctx.lineTo(1920 + STEP * 2, bot);
    ctx.lineTo(-STEP, bot);
    ctx.closePath();
    const c = stripCol[k];
    const gr = ctx.createLinearGradient(0, top, 0, Math.max(top + 4, bot));
    gr.addColorStop(0, mixc(g, c, pal.crest, Math.round((0.15 + 0.45 * (1 - numb) * (1 - 0.6 * backlit)) * 40) / 40));
    gr.addColorStop(0.3, c);
    gr.addColorStop(1, mixc(g, c, pal.seaDeep, (0.45 + 0.35 * u) * (1 - backlit)));
    ctx.fillStyle = gr;
    ctx.fill();
    // the sun's light path on this strip
    const halfW = (50 + 300 * u ** 1.3) * pathW;
    const i0 = Math.max(0, Math.floor((sunX - halfW + STEP) / STEP)), i1 = Math.min(NPTS - 1, Math.ceil((sunX + halfW + STEP) / STEP));
    if (i1 > i0 && sunPath > 0) {
      const gs = ctx.createLinearGradient(sunX - halfW, 0, sunX + halfW, 0);
      const al = Math.min(1, 0.42 * (1 - 0.5 * u) * sunPath);
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
    const bd = bandBuf[k];
    ctx.lineCap = 'round';
    for (let b = 1; b <= 2; b++) {
      const lo = b === 1 ? 0.42 : 0.6, hi = b === 1 ? 0.6 : 2;
      ctx.strokeStyle = g.color.css(pal.crest, Math.min(1, ((b === 1 ? 0.3 : 0.75) * (0.45 + 0.55 * u) + 0.35 * snareAmt + 0.6 * bd) * calm));
      ctx.lineWidth = (b === 1 ? 0.8 : 1) * (0.8 + 4 * u ** 1.2) * (1 + 0.7 * bd);
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
    // the kick band lights the whole crest line
    if (bd > 0.04) {
      ctx.strokeStyle = g.color.css(pal.crest, Math.min(0.85, 0.75 * bd) * calm);
      ctx.lineWidth = (1 + 3.2 * u ** 1.1) * (0.6 + 0.6 * bd);
      ctx.beginPath();
      ctx.moveTo(-STEP, buf[0]);
      for (let i = 1; i < NPTS; i++) ctx.lineTo(-STEP + i * STEP, buf[i]);
      ctx.stroke();
    }
    // sun glitter on this strip
    if (k > 3 && sunPath > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const cnt = 2 + Math.floor(u * (5 + 4 * W.build) * pathW);
      for (let j = 0; j < cnt; j++) {
        const x = sunX + (hashU(91, k, j) * 2 - 1) * halfW * (0.25 + 0.75 * hashU(92, k, j));
        const tw = Math.sin(tt * (2.5 + 4 * hashU(93, k, j)) + hashU(94, k, j) * TAU);
        if (tw < 0.25) continue;
        const ii = clamp(Math.round((x + STEP) / STEP), 0, NPTS - 1);
        const r = (2 + 8 * u) * (tw - 0.25) * (1 + 0.6 * W.beatPulse);
        ctx.globalAlpha = Math.min(1, 0.95 * (tw - 0.25) * sunPath);
        ctx.drawImage(glint, x - r, buf[ii] + 1 - r, 2 * r, 2 * r);
      }
      ctx.restore();
    }
  };
  return {
    cam, n, zs, drawStrip, crestPx, bottomOf,
    px: (X, Z) => 960 + (X - wx) * (foc / Z),
    py: (Y, Z) => hy + (h - Y) * (foc / Z),
    surfY: (Z) => hy + (h - rise) * (foc / Z),
  };
}

/** Draw the strips far to near, with each object drawn just before the first strip nearer than it. */
function layerSea(sea, objs) {
  objs.sort((a, b) => b.Z - a.Z);
  let oi = 0;
  for (let k = 0; k < sea.n; k++) {
    while (oi < objs.length && objs[oi].Z > sea.zs[k]) objs[oi++].draw();
    sea.drawStrip(k);
  }
  while (oi < objs.length) objs[oi++].draw();
}

/** A ripple ring on the milk (perspective ellipse, back or front half) with an inner echo. */
function ringAt(g, W, sea, x, y, Z, u, str, half, size = 1) {
  const { ctx } = g;
  const cam = sea.cam;
  const s = cam.foc / Z;
  const eye = Math.max(0.25, cam.h - W.rise);
  const rad = (0.25 + 1.5 * outCubic(u)) * s * size;
  const ry = rad * (eye / Z) * 1.1;
  ctx.strokeStyle = g.color.css(W.pal.crest, Math.min(1, 0.95 * str * (1 - u) ** 1.4));
  ctx.lineWidth = Math.max(1.2, (3.2 * s) / 115) * (1 - 0.5 * u);
  ctx.beginPath();
  if (half === 'back') ctx.ellipse(x, y, rad, ry, 0, Math.PI, TAU);
  else ctx.ellipse(x, y, rad, ry, 0, 0, Math.PI);
  ctx.stroke();
  if (u > 0.15) {
    const u2 = (u - 0.15) / 0.85, rad2 = (0.2 + 1.0 * outCubic(u2)) * s * size;
    ctx.lineWidth *= 0.6;
    ctx.beginPath();
    if (half === 'back') ctx.ellipse(x, y, rad2, rad2 * (eye / Z) * 1.1, 0, Math.PI, TAU);
    else ctx.ellipse(x, y, rad2, rad2 * (eye / Z) * 1.1, 0, 0, Math.PI);
    ctx.stroke();
  }
}

/** Milk droplets thrown up from (x, y) at depth scale s: n drops, age a seconds, closed form. */
function splashDrops(g, x, y, s, a, seed, n, { life = 0.6, up = 1, spread = 0.45 } = {}) {
  const { ctx } = g;
  if (a < 0 || a > life) return;
  const drop1 = g.sprites.glow('#FFFFFF', 1);
  for (let d = 0; d < n; d++) {
    const ang = hashU(seed, d, 1) * Math.PI;
    const v = (1.2 + 2.2 * hashU(seed, d, 2)) * s * up;
    const px = x + Math.cos(ang) * v * spread * a * (0.6 + 0.8 * hashU(seed, d, 4)), py = y - Math.sin(ang) * v * a + 4.9 * s * a * a;
    const r = (0.03 + 0.03 * hashU(seed, d, 3)) * s * 2.2;
    ctx.globalAlpha = 0.95 * (1 - a / life);
    ctx.drawImage(drop1, px - r, py - r, 2 * r, 2 * r);
  }
  ctx.globalAlpha = 1;
}

/**
 * One of the six in a perspective framing: back rings, the puppet (clipped at the surface while it is
 * under), the milk in front redrawn over its legs, a reflection, front rings, footfall splashes and the
 * splash where it jumps in or rises out. o: drift (m/s the rings slide right), sil {fill, rim}, island.
 */
function drawWalkerP(g, W, sea, w, o = {}) {
  const { ctx } = g;
  const cam = sea.cam;
  const s = cam.foc / w.Z;
  const x = sea.px(w.X, w.Z);
  const feetY = sea.py(w.Y, w.Z);
  const surfY = sea.surfY(w.Z);
  const drift = o.drift || 0;
  const myRings = w.onSea ? W.rings.filter((r) => r.w === w.i) : [];
  const rsz = o.ringSize ?? 1;
  if (!w.onSea && o.island) for (const r of W.rings.filter((r2) => r2.w === w.i)) o.island(r);
  for (const r of myRings) ringAt(g, W, sea, x + drift * r.age * s, surfY, w.Z, r.u, r.s, 'back', rsz);
  const scale = (BODY * s) / TEEN_PX;
  const pose = poseFor(W, w);
  if (!w.onSea && !w.onIsland) pose.hL = (pose.hL || 0) + 0.3, pose.kL = (pose.kL || 0) + 0.5;
  const Hpx = BODY * s;
  ctx.save();
  if (w.Y < -0.02) { ctx.beginPath(); ctx.rect(x - Hpx, surfY - Hpx * 3, Hpx * 2, Hpx * 3 + 2); ctx.clip(); }
  if (w.vis < 1) ctx.globalAlpha = w.vis;
  if (o.sil) {
    drawPuppet(ctx, silDesign(w.d), pose, { x, ground: feetY, facing: -1, view: 'side', scale, devScale: g.scale,
      fill: o.sil.fill, limbFill: o.sil.fill, headFill: o.sil.fill, outline: o.sil.rim, outlineW: o.sil.rimW ?? 2.4 });
  } else {
    drawPuppet(ctx, w.d, pose, { x, ground: feetY, facing: -1, view: 'side', scale, devScale: g.scale });
  }
  ctx.restore();
  // the milk in front of the walker: redraw the nearer strips over its lower body
  if (!w.onIsland) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - Hpx * 0.6, feetY - Hpx * 1.25 - Math.max(0, surfY - feetY), Hpx * 1.2, Hpx * 1.25 + 80 + Math.max(0, surfY - feetY));
    ctx.clip();
    const lowY = Math.max(feetY, surfY);
    for (let k = 0; k < sea.n; k++) {
      if (sea.zs[k] >= w.Z - 0.12) continue;
      const top = sea.surfY(sea.zs[k]) - sea.crestPx[k] * 2;
      if (top > lowY + 60) break;
      sea.drawStrip(k);
    }
    ctx.restore();
  }
  // a soft painted reflection of the coat in the milk
  if (!w.onIsland && w.vis > 0) {
    const above = clamp((surfY - (feetY - Hpx)) / Hpx);
    ctx.save();
    if (o.sil) {
      ctx.globalAlpha = 0.35 * above * w.vis;
      ctx.drawImage(g.sprites.glow(o.sil.fill), x - Hpx * 0.16, surfY - Hpx * 0.06, Hpx * 0.32, Hpx * 0.8 * above);
    } else {
      ctx.globalAlpha = 0.28 * above * w.vis;
      ctx.drawImage(g.sprites.glow(w.d.fill), x - Hpx * 0.16, surfY - Hpx * 0.06, Hpx * 0.32, Hpx * 0.7 * above);
      ctx.globalAlpha = 0.22 * above * w.vis;
      ctx.drawImage(g.sprites.glow(w.d.limbFill), x - Hpx * 0.12, surfY - Hpx * 0.04, Hpx * 0.24, Hpx * 0.35);
    }
    ctx.restore();
  }
  for (const r of myRings) ringAt(g, W, sea, x + drift * r.age * s, surfY, w.Z, r.u, r.s, 'front', rsz);
  // footstep splash on every planted foot (braked with the walk clock)
  if (w.onSea && w.amt > 0.5 && w.Y > -0.3) {
    const stepF = fract(2 * W.walkP - 0.5);            // 0 at each plant
    const age = stepF * 2 * W.beatS;
    const nstep = Math.floor(2 * W.walkP - 0.5);
    const life = 0.42;
    if (age <= life) {
      const drop1 = g.sprites.glow('#FFFFFF', 1);
      const nd = o.bigSplash ? 10 : 6;
      for (let d = 0; d < nd; d++) {
        const hx = hashU(71 + w.i, nstep, d), hv = hashU(72 + w.i, nstep, d);
        const vx = (-0.6 - 1.4 * hx) * s, vy = (1.4 + 1.6 * hv) * s * (o.bigSplash ? 1.25 : 1);
        const px = x - 0.18 * s + vx * age * 0.6 + drift * age * s, py = surfY - vy * age + 4.9 * s * age * age;
        const r = (0.025 + 0.025 * hv) * s * 2.2;
        ctx.globalAlpha = 0.9 * (1 - age / life);
        ctx.drawImage(drop1, px - r, py - r, 2 * r, 2 * r);
      }
      if (o.bigSplash) {            // a milk lip kicked up at the plant
        ctx.globalAlpha = 0.6 * (1 - age / life);
        ctx.strokeStyle = W.pal.crest;
        ctx.lineWidth = Math.max(1.5, 0.03 * s);
        ctx.beginPath();
        ctx.ellipse(x - 0.12 * s, surfY, (0.12 + 0.5 * age) * s, (0.03 + 0.1 * age) * s, 0, Math.PI, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  // splash where they jump into the milk
  if (w.landAge >= 0 && w.landAge < 1.0) {
    ringAt(g, W, sea, x, surfY, w.Z, w.landAge, 1, 'back');
    ringAt(g, W, sea, x, surfY, w.Z, w.landAge, 1, 'front');
    splashDrops(g, x, surfY, s, w.landAge, 81 + w.i, 14);
  }
  // rising out of the milk: a ring, a milk mound sliding off and a crown of droplets
  if (w.riseAge !== undefined && w.riseAge >= 0 && w.riseAge < 1.3) {
    const a = w.riseAge;
    ringAt(g, W, sea, x, surfY, w.Z, clamp(a / 1.3), 1, 'back', 1.4);
    ringAt(g, W, sea, x, surfY, w.Z, clamp(a / 1.3), 1, 'front', 1.4);
    if (a < 0.7) {
      const k = 1 - a / 0.7;
      ctx.save();
      ctx.globalAlpha = 0.9 * k;
      ctx.fillStyle = W.pal.milk;
      ctx.beginPath();
      ctx.ellipse(x, surfY, 0.42 * s * (1 + a), 0.22 * s * k + 2, 0, Math.PI, TAU);
      ctx.fill();
      ctx.restore();
    }
    splashDrops(g, x, surfY, s, a * 0.85, 141 + w.i, 22, { life: 0.75, up: 1.15, spread: 0.6 });
  }
}

/** A crowd figure in a perspective framing (a stamped sprite), surfacing with a ring, dipping on the beat. */
function drawCrowdP(g, W, sea, X, Z, hv, e, o = {}) {
  const { ctx } = g;
  const s = sea.cam.foc / Z;
  const x = sea.px(X, Z);
  if (x < -80 || x > 2000) return;
  const sink = -1.9 * (1 - outCubic(e));
  const scale = (BODY * s * hv) / TEEN_PX;
  const qs = o.qstep ?? 1.12;
  const q = Math.round(Math.log(scale) / Math.log(qs));
  const sq = qs ** q;
  const spr = puppetSprite(g, W.crowdD, W.crowdPose, { key: `ms${W.phaseQ}`, scale: sq, facing: -1, view: 'side', fill: o.fill, outline: o.outline, outlineW: o.outlineW });
  const kk = scale / sq;
  const gy = sea.py(sink, Z) + 0.035 * BODY * s * W.beatPulse * W.beatBob;
  const surfY = sea.surfY(Z);
  ctx.globalAlpha = (o.alpha ?? 1) * clamp(e * 3);
  const top = gy - spr.ay * kk;
  const hgt = spr.h * kk;
  // cut the sprite at the milk surface (the strips nearer hide the rest)
  const vis = clamp((surfY + 2 - top) / hgt);
  if (vis > 0.01) ctx.drawImage(spr.canvas, 0, 0, spr.canvas.width, spr.canvas.height * vis, x - spr.ax * kk, top, spr.w * kk, hgt * vis);
  ctx.globalAlpha = 1;
  if (e < 1) {
    const rr = (0.3 + 1.2 * e) * s;
    ctx.strokeStyle = g.color.css(W.pal.crest, 0.8 * (1 - e));
    ctx.lineWidth = Math.max(1, 2.5 * s / 60);
    ctx.beginPath();
    ctx.ellipse(x, surfY, rr, rr * Math.max(0.25, sea.cam.h - W.rise) / Z, 0, 0, TAU);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------
// Small living things in perspective framings: motes, hat glints, snare shimmer
// ---------------------------------------------------------------------------------------------

function drawMotes(g, W, hy) {
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const moteS = g.sprites.glow(mixc(g, W.pal.sun, W.pal.sparkle, 0.5));
  const rate = 14, life = 9, tt = W.tt;
  const k0 = Math.max(0, Math.ceil((tt + 60 - life) * rate)), k1 = Math.floor((tt + 60) * rate);
  for (let k = k0; k <= k1; k++) {
    const age = tt + 60 - k / rate;
    const u = age / life;
    const r1 = hashU(97, k, 1), r2 = hashU(97, k, 2), r3 = hashU(97, k, 3);
    const x = r1 * 1920 + 30 * Math.sin(age * 0.8 + r2 * TAU) + 12 * age;
    const y = hy + 40 + r2 * 600 - (20 + 35 * r3) * age;
    const r = (3 + 6 * r3) * (1 + 0.35 * W.beatPulse);
    ctx.globalAlpha = (0.6 + 0.4 * W.build) * Math.sin(Math.PI * u);
    ctx.drawImage(moteS, x - r * 2, y - r * 2, r * 4, r * 4);
  }
  ctx.restore();
}

function starGlint(ctx, glint, fill, x, y, sz) {
  ctx.drawImage(glint, x - sz * 0.5, y - sz * 0.5, sz, sz);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x - sz, y); ctx.lineTo(x - sz * 0.08, y - sz * 0.08); ctx.lineTo(x, y - sz);
  ctx.lineTo(x + sz * 0.08, y - sz * 0.08); ctx.lineTo(x + sz, y); ctx.lineTo(x + sz * 0.08, y + sz * 0.08);
  ctx.lineTo(x, y + sz); ctx.lineTo(x - sz * 0.08, y + sz * 0.08); ctx.closePath();
  ctx.fill();
}

function drawHatsP(g, W, sea) {
  const { ctx } = g;
  const glint = g.sprites.glow(W.pal.sparkle, 1);
  const n0 = Math.round(sea.n * 0.32);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const h of W.hats) {
    const n = 3 + Math.floor(hashU(101, h.id, 0) * 4);
    for (let j = 0; j < n; j++) {
      const k = n0 + Math.floor(hashU(102, h.id, j) * (sea.n - n0 - 1));
      const x = 60 + hashU(103, h.id, j) * 1800;
      const ii = clamp(Math.round((x + STEP) / STEP), 0, NPTS - 1);
      const y = crestBuf[k][ii] - 1;
      const u = k / (sea.n - 1);
      const grow = h.age < 0.07 ? outCubic(h.age / 0.07) : 1;
      const fade = h.age < 0.07 ? 1 : 1 - (h.age - 0.07) / 0.18;
      const sz = (14 + 26 * u) * grow * (0.6 + 0.4 * h.s);
      ctx.globalAlpha = fade * h.spawn;
      starGlint(ctx, glint, W.pal.sparkle, x, y, sz);
    }
  }
  ctx.restore();
}

function drawSnareP(g, W, sea) {
  if (W.snareAmt <= 0.01) return;
  const { ctx } = g;
  const cx = -200 + (W.snAge / 0.3) * 2400;
  const gs = ctx.createLinearGradient(cx - 260, 0, cx + 260, 0);
  gs.addColorStop(0, g.color.css('#FFFFFF', 0));
  gs.addColorStop(0.5, g.color.css('#FFFFFF', 0.9 * W.snareAmt));
  gs.addColorStop(1, g.color.css('#FFFFFF', 0));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = gs;
  for (let k = Math.round(sea.n * 0.27); k < sea.n; k++) {
    const buf = crestBuf[k];
    ctx.lineWidth = 2 + 3 * (k / sea.n);
    ctx.beginPath();
    ctx.moveTo(-STEP, buf[0]);
    for (let i = 1; i < NPTS; i++) ctx.lineTo(-STEP + i * STEP, buf[i]);
    ctx.stroke();
  }
  ctx.restore();
}

/** Numb onset: a pale shock ring sweeping out across the milk from (Xc, Zc) (perspective). */
function shockP(g, W, sea, Xc, Zc) {
  if (W.onset < 0 || W.onset > 1.5) return;
  const { ctx } = g;
  const a = W.onset / 1.5;
  const fade = (1 - a) ** 1.2;
  const cam = sea.cam;
  for (const [Rk, al, wk] of [[1, 1, 1], [0.72, 0.45, 0.6]]) {
    const R = (0.6 + 40 * a ** 1.4) * Rk;          // an accelerating sweep: readable near, racing to the horizon
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 120; i++) {
      const ang = (i / 120) * TAU;
      const Z = Zc + Math.sin(ang) * R, X = Xc + Math.cos(ang) * R;
      if (Z < 1.2) { pen = false; continue; }
      const x = sea.px(X, Z), y = cam.hy + (cam.h - W.rise) * (cam.foc / Z);
      if (!pen) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      pen = true;
    }
    ctx.strokeStyle = g.color.css(W.pal.milk, 0.3 * fade * al);
    ctx.lineWidth = 26 * wk;
    ctx.stroke();
    ctx.strokeStyle = g.color.css('#FFFFFF', 0.9 * fade * al);
    ctx.lineWidth = 5 * wk;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------
// WIDE: the island and the whole sea (the original composition)
// ---------------------------------------------------------------------------------------------

function drawWide(g, W) {
  const { ctx } = g;
  const pal = W.pal;
  const hy = W.hy;
  const tt = W.tt, tl = W.tl;
  const push = 1 + 0.085 * smooth(tt / (W.dur * 0.8));
  ctx.save();
  ctx.translate(900, 600);
  ctx.scale(push, push);
  ctx.translate(-900, -600);

  drawSky(g, W, hy, { cachedSky: true });
  const sunX = W.sunX, sunY = W.sunY;
  drawSun(g, W, sunX, sunY, W.sunR);
  drawClouds(g, W, hy);
  drawBirds(g, W);

  const cam = { hy, h: CAMH, foc: FOC, wx: 0, zs: stripZs(NSTRIP, ZFAR, ZNEAR) };
  const sea = buildSea(g, W, cam, { sunX });

  // the island and its splash crown
  const { Zi0, Xi, Zi, Yi } = W;
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
  const drawIsl = () => {
    drawCrown(false);
    const s = FOC / Zi, k = (s * ISL_W_M) / (2 * ISLAND.topRX);
    const ix = 960 + Xi * s, iy = hy + (CAMH - Yi) * s;
    paintIsland(g, ctx, { x: ix, y: iy - ISL_TOP * s, scale: k, t: tt, palette: pal, glow: 1 + 0.35 * W.voc + 0.25 * W.beatPulse, sway: 1 - 0.85 * W.numb });
    const wl = hy + (CAMH - W.rise) * s;
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
  };
  const objs = [{ Z: Zi, draw: drawIsl }];
  for (const [it, e] of W.crowd) {
    objs.push({ Z: it.Z, draw: () => drawCrowdP(g, W, sea, it.X + 0.25 * Math.sin(tt * 0.2 + it.sway * TAU), it.Z, it.hv, e, { alpha: 1 - 0.55 * clamp((it.Z - 22) / 60) }) });
  }
  layerSea(sea, objs);

  // horizon line sparkle and mist
  {
    const gm = ctx.createLinearGradient(0, hy - 6, 0, hy + 40);
    gm.addColorStop(0, g.color.css('#FFFFFF', 0.5));
    gm.addColorStop(1, g.color.css(pal.sea, 0));
    ctx.fillStyle = gm;
    ctx.fillRect(0, hy - 6, 1920, 46);
  }

  // landing splash: crown of droplets + ring wave
  const landing = W.landing;
  if (tl >= 0 && tl < landing + 1.6) {
    const s = FOC / Zi0, cx = 960, cy = hy + CAMH * s;
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
    const foam = clamp(1 - tl / 1.4);
    if (foam > 0) {
      ctx.globalAlpha = 0.85 * foam;
      ctx.drawImage(g.sprites.glow(pal.milk), cx - 340 * (1 + tl), cy - 60, 680 * (1 + tl), 120);
      ctx.globalAlpha = 1;
    }
    drawCrown(true);
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

  // the numb onset shock ring runs out from Kit across the whole sea
  const kit = W.walkers[0];
  shockP(g, W, sea, kit.X, Math.max(6, kit.Z));

  // the walkers
  const islandRing = (r) => {
    const si = FOC / Zi;
    const cx = 960 + Xi * si, cy = hy + (CAMH - W.rise) * si;
    ctx.strokeStyle = g.color.css(pal.crest, 0.8 * r.s * (1 - r.u) ** 1.4);
    ctx.lineWidth = 2.5;
    const rad = (4.9 + 1.6 * outCubic(r.u)) * si;
    ctx.beginPath(); ctx.ellipse(cx, cy + 4, rad, rad * (CAMH / Zi) * 1.2, 0, 0, Math.PI); ctx.stroke();
  };
  const order = W.walkers.filter((w) => !w.hidden).sort((a, b) => b.Z - a.Z);
  for (const w of order) drawWalkerP(g, W, sea, w, { island: islandRing });

  drawMotes(g, W, hy);
  drawHatsP(g, W, sea);
  drawSnareP(g, W, sea);
  ctx.restore();   // end of the push-in
  return { hy: (hy - 600) * push + 600 };
}

// ---------------------------------------------------------------------------------------------
// TRACKING: low and close on Kit and June, the camera walking with them
// ---------------------------------------------------------------------------------------------

const TRACK_POS = [[-0.25, 5.0], [1.55, 6.15], [3.3, 8.4], [4.8, 10.0], [6.3, 11.7], [7.8, 13.4]];

function drawTracking(g, W, shot) {
  const { ctx } = g;
  const su = shot.u;
  const v = W.v;
  // the operator walks with them: a step bob on the horizon, a slow dolly so they gain on the frame
  const hy = 575 + 5 * Math.abs(Math.sin(Math.PI * W.mb)) - 6 * W.beatPulse;
  const camH = 1.15;
  const wx = -v * W.tt;                          // the camera's world X: walking left with them
  const dolly = 0.55 - 1.1 * smooth(su);         // metres the pair sit right of their mark
  const cam = { hy, h: camH, foc: FOC, wx, zs: stripZs(46, 140, 2.2) };
  const sunX = 1250 - 90 * su, sunY = 300;

  drawSky(g, W, hy, { skyHy: 575 });
  drawSun(g, W, sunX, sunY, 175);
  drawClouds(g, W, hy, { speed: 2.2 });
  drawBirds(g, W);
  const sea = buildSea(g, W, cam, { sunX, ampK: 0.75 });

  const objs = [];
  // the island, far behind, sliding away right as they walk on
  {
    const Zt = 34 + 0.8 * (W.Zi - W.Zi0);
    const Xw = 5.5 - v * (W.tauAt(shot.ta) - W.t0);   // fixed in the world: it slides right as the camera walks on
    objs.push({ Z: Zt, draw: () => {
      const s = FOC / Zt, k = (s * ISL_W_M) / (2 * ISLAND.topRX);
      const ix = sea.px(Xw, Zt), iy = sea.py(W.Yi, Zt);
      if (ix < -400 || ix > 2320) return;
      paintIsland(g, ctx, { x: ix, y: iy - ISL_TOP * s, scale: k, t: W.tt, palette: W.pal, glow: 1 + 0.35 * W.voc + 0.25 * W.beatPulse, sway: 1 - 0.85 * W.numb });
    } });
  }
  // the crowd marching behind (the wide layout pulled toward the camera), moving with the camera
  for (const [it, e] of W.crowd) {
    const Z = 0.6 * it.Z + 2;
    if (Z > 140) continue;
    const X = wx + 0.6 * it.X + 0.25 * Math.sin(W.tt * 0.2 + it.sway * TAU);
    objs.push({ Z, draw: () => drawCrowdP(g, W, sea, X, Z, it.hv, e, { alpha: 1 - 0.5 * clamp((Z - 14) / 40), qstep: 1.2 }) });
  }
  layerSea(sea, objs);
  {
    const gm = ctx.createLinearGradient(0, hy - 6, 0, hy + 30);
    gm.addColorStop(0, g.color.css('#FFFFFF', 0.45));
    gm.addColorStop(1, g.color.css(W.pal.sea, 0));
    ctx.fillStyle = gm;
    ctx.fillRect(0, hy - 6, 1920, 36);
  }
  const ws = W.walkers.map((w) => {
    if (w.hidden) return null;
    const [Xr, Zr] = TRACK_POS[w.i];
    return { ...w, X: wx + Xr + dolly + 0.1 * Math.sin(W.tt * 0.4 + w.i), Z: Zr, Y: Math.min(0, w.sink), onSea: true, onIsland: false, landAge: -1 };
  }).filter(Boolean).sort((a, b) => b.Z - a.Z);
  shockP(g, W, sea, ws.length ? ws[ws.length - 1].X : wx, 5);
  for (const w of ws) drawWalkerP(g, W, sea, w, { drift: v, bigSplash: w.Z < 7, ringSize: w.Z < 7 ? 1.25 : 1 });
  drawMotes(g, W, hy);
  drawHatsP(g, W, sea);
  drawSnareP(g, W, sea);
  return { hy };
}

// ---------------------------------------------------------------------------------------------
// SILHOUETTE: low into the giant spiral sun, the marchers crossing it in silhouette
// ---------------------------------------------------------------------------------------------

function drawSilhouette(g, W, shot) {
  const { ctx } = g;
  const pal = W.pal;
  const v = W.v;
  const hy = 712;
  const camH = 0.6;
  const cam = { hy, h: camH, foc: FOC, wx: 0, zs: stripZs(40, 150, 2.6) };
  const sunX = 960, sunY = 575, R = 330;
  drawSky(g, W, hy, { warm: 1 });
  drawSun(g, W, sunX, sunY, R, { rays: 1.4, glow: 0.8 });
  drawClouds(g, W, hy - 140, { alpha: 0.7, speed: 1 });
  drawBirds(g, W, { col: g.color.css(mixc(g, pal.sunRing, INK, 0.7), 0.75), k: 1.2 });
  const sea = buildSea(g, W, cam, { sunX, sunPath: 2.2, pathW: 1.7, backlit: 0.55 });

  const dark = mixc(g, INK, pal.sunRing, 0.12);
  const hazeCol = mixc(g, pal.skyLow, pal.sunRing, 0.35);
  const rim = mixc(g, pal.sun, pal.sunRing, 0.35);
  const tauA = W.tauAt(shot.ta) - W.t0, tauB = W.tauAt(shot.tb) - W.t0;
  const elapsed = W.tt - tauA;
  const objs = [];
  // the crowd behind, marching left across the sun, wrapping round
  for (const [it, e] of W.crowd) {
    if (it.id % 3 === 1) continue;                // a thinner crowd so the sun reads through it
    const Z = 0.5 * it.Z + 4;
    const half = (960 / FOC) * Z * 1.25;
    const span = 2 * half;
    const X0 = 0.5 * it.X - v * 0.85 * elapsed;
    const X = ((((X0 + half) % span) + span) % span) - half;
    const hz = Math.round(clamp((Z - 14) / 32) * 2) / 2;
    const fill = mixc(g, dark, hazeCol, 0.62 * hz);
    objs.push({ Z, draw: () => drawCrowdP(g, W, sea, X, Z, it.hv, e, hz === 0 ? { fill, outline: rim, outlineW: 1.6, qstep: 1.2 } : { fill, qstep: 1.2 }) });
  }
  layerSea(sea, objs);
  {
    const gm = ctx.createLinearGradient(0, hy - 8, 0, hy + 26);
    gm.addColorStop(0, g.color.css('#FFFFFF', 0.55));
    gm.addColorStop(1, g.color.css(pal.sun, 0));
    ctx.fillStyle = gm;
    ctx.fillRect(0, hy - 8, 1920, 34);
  }
  // the six cross the sun disc in a line, Kit leading
  const Dtau = Math.max(1, tauB - tauA);
  const lead = v * (0.3 * Dtau - elapsed);
  const ws = W.walkers.map((w) => {
    if (w.hidden) return null;
    const Z = 5.6 + 0.55 * w.i;
    return { ...w, X: lead + 1.45 * w.i, Z, Y: Math.min(0, w.sink), onSea: true, onIsland: false, landAge: -1 };
  }).filter(Boolean).sort((a, b) => b.Z - a.Z);
  shockP(g, W, sea, 0, 8);
  for (const w of ws) drawWalkerP(g, W, sea, w, { sil: { fill: dark, rim, rimW: 2.6 } });
  // a warm flare on the lens, breathing with the beat
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.22 + 0.25 * W.beatPulse;
  ctx.drawImage(g.sprites.glow(pal.sunRing), sunX - 900, hy - 300, 1800, 600);
  ctx.restore();
  drawMotes(g, W, hy - 200);
  drawHatsP(g, W, sea);
  drawSnareP(g, W, sea);
  return { hy };
}

// ---------------------------------------------------------------------------------------------
// TOP-DOWN: straight down on the milk; every beat throws ripple rings from every pair of feet
// ---------------------------------------------------------------------------------------------

const GW = 320, GH = 180, CELL = 6;
const ripAcc = new Float32Array(GW * GH);     // scratch, rewritten every frame
let ripCanvas = null, ripCtx = null, ripImg = null;

function figureTop(ctx, x, y, ang, m, o) {
  // local frame: +x forward (the walking direction), +y to the right of the walker
  const { coat, limb, hair, skin, ph, bp, k, alpha, outline } = o;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  const M = m * k * (1 + 0.07 * bp);
  const sw = Math.sin(ph);
  // feet stepping
  ctx.fillStyle = limb;
  for (const side of [-1, 1]) {
    const fx = side * sw * 0.24 * M;
    ctx.beginPath(); ctx.ellipse(fx + 0.04 * M, side * 0.1 * M, 0.12 * M, 0.06 * M, 0, 0, TAU); ctx.fill();
  }
  // arms swinging against the feet
  ctx.fillStyle = o.arm || coat;
  for (const side of [-1, 1]) {
    const ax = -side * sw * 0.15 * M;
    ctx.beginPath(); ctx.ellipse(ax, side * 0.27 * M, 0.11 * M, 0.06 * M, 0, 0, TAU); ctx.fill();
  }
  // shoulders
  ctx.fillStyle = coat;
  ctx.beginPath(); ctx.ellipse(0, 0, 0.15 * M, 0.26 * M, 0, 0, TAU); ctx.fill();
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = Math.max(1, 0.025 * M); ctx.stroke(); }
  // head: a sliver of face at the front, hair on top
  if (skin) { ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0.05 * M, 0, 0.11 * M, 0, TAU); ctx.fill(); }
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(-0.015 * M, 0, 0.12 * M, 0, TAU); ctx.fill();
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = Math.max(1, 0.02 * M); ctx.stroke(); }
  ctx.restore();
}

function drawTopdown(g, W, shot) {
  const { ctx } = g;
  const pal = W.pal;
  const su = shot.u;
  const v = W.v;
  const m = 74 + 14 * smooth(su);                 // px per metre: a slow descent
  const th = -0.3 + 0.24 * su;                    // a slow turn of the view
  const Xc = 2.6 - 1.2 * su, Zc = 13.0 + 0.8 * su;
  const cs = Math.cos(th), sn = Math.sin(th);
  const map = (X, Z) => {
    const dx = (X - Xc) * m, dy = -(Z - Zc) * m;
    return [960 + dx * cs - dy * sn, 540 + dx * sn + dy * cs];
  };
  const fwdAng = Math.PI + th;                     // screen angle of world -X (the marching direction)
  const shadowDir = [-sn, cs];                     // world -Z on screen (the low sun is far ahead in +Z)
  const tt = W.tt;
  const scroll = (1.4 + v) * tt;                   // swells travel right and the walkers move left over them

  // the milk: a soft gradient with a slow painted texture
  {
    const gr = ctx.createRadialGradient(960, 420, 120, 960, 540, 1250);
    gr.addColorStop(0, mixc(g, pal.sea, '#FFFFFF', 0.25));
    gr.addColorStop(0.5, mixc(g, pal.sea, pal.seaDeep, 0.3));
    gr.addColorStop(1, mixc(g, pal.seaDeep, INK, 0.12));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 1920, 1080);
    const fc = field(g, { key: 'milktop', seed: 77, t: tt, w: 240, h: 136, scale: 3.2, warp: 1.3, flow: 0.05, speed: [-(v + 1.4) * m / 1920 * 3.2 * 0.6, 0.004], octaves: 4, contrast: 1.25,
      stops: [[0, mixc(g, pal.seaDeep, INK, 0.15)], [0.45, pal.seaDeep], [0.8, pal.sea], [1, pal.milk]] });
    drawField(g, fc, { alpha: 0.38 });
  }
  // swells seen from above: soft crest lines drifting right, lit by the kick band
  {
    const spacing = 2.4;
    const j0 = Math.floor((Xc - 26 - scroll) / spacing), j1 = Math.ceil((Xc + 26 - scroll) / spacing);
    ctx.lineCap = 'round';
    for (let j = j0; j <= j1; j++) {
      const Xb = j * spacing + scroll;
      const mid = map(Xb, Zc);
      let band = 0;
      for (const a of W.accents) {
        if (a.age < 0 || a.age > 0.6) continue;
        const bx = -260 + (a.age / 0.6) * 2440;
        const d = (mid[0] - bx) / 180;
        band += a.s * Math.exp(-d * d) * (1 - 0.5 * a.age / 0.6);
      }
      band *= 1 - W.numb;
      ctx.beginPath();
      for (let q = 0; q <= 30; q++) {
        const Z = Zc - 16 + (32 * q) / 30;
        const X = Xb + 0.6 * (fbm(LW3, j * 1.7, Z * 0.12 + tt * 0.05, 2) - 0.5) * 2 + 0.25 * Math.sin(Z * 0.4 + j);
        const [x, y] = map(X, Z);
        if (q === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = g.color.css(pal.crest, Math.min(0.9, 0.22 + 0.6 * band) * (1 - 0.6 * W.riseEnv));
      ctx.lineWidth = (2.2 + 4 * band) * m / 56;
      ctx.stroke();
      ctx.strokeStyle = g.color.css(pal.seaDeep, 0.14);
      ctx.lineWidth = 6 * m / 56;
      ctx.save(); ctx.translate(-4 * cs, -4 * sn); ctx.stroke(); ctx.restore();
    }
  }

  // who is on the milk (from above)
  const figs = [];
  const isl = { X: W.Xi, Z: W.Zi };
  const slots = W.walkers.map((w) => w.slot);
  for (const [it, e] of W.crowd) {
    // the crowd as a marching lattice round the six (the wide layout folded in toward them)
    const X = 0.3 * it.X + 1.9 + 0.2 * Math.sin(tt * 0.2 + it.sway * TAU);
    const Z = 7.5 + (it.Z - 22) * 0.5;
    if (((X - isl.X) / 5.6) ** 2 + ((Z - isl.Z) / 4.0) ** 2 < 1) continue;
    if (slots.some(([sx, sz]) => (X - sx) ** 2 + (Z - sz) ** 2 < 1.6)) continue;
    const [x, y] = map(X, Z);
    if (x < -60 || x > 1980 || y < -60 || y > 1140) continue;
    figs.push({ X, Z, x, y, e, id: it.id, main: false });
  }
  const mains = [];
  for (const w of W.walkers) {
    if (w.hidden) continue;
    const [X, Z] = w.slot;
    const Xw = X + 0.18 * Math.sin(tt * 0.31 + w.i * 1.9), Zw = Z;
    const [x, y] = map(Xw, Zw);
    mains.push({ X: Xw, Z: Zw, x, y, e: w.vis, w, main: true });
  }

  // ripple sources: on every beat, rings from every pair of feet (the six always, a third of the crowd)
  const C = 1.9, LAM = 0.75, LIFE = 2.1;
  const srcs = [];
  for (let ai = 0; ai < W.accents.length; ai++) {
    const a = W.accents[ai];
    if (a.age < 0 || a.age > LIFE) continue;
    const fade = (1 - a.age / LIFE) ** 1.3;
    const r0 = C * a.age + 0.15;
    for (const f of mains) {
      const [x, y] = map(f.X + v * a.age, f.Z);
      srcs.push([x, y, r0 * m, a.s * fade * 1.35 * f.e, 1]);
    }
    for (const f of figs) {
      if (hashU(17, f.id, a.id) > 0.34) continue;
      const [x, y] = map(f.X + v * a.age, f.Z);
      srcs.push([x, y, r0 * m, a.s * fade * 0.8 * clamp(f.e * 2), 0]);
    }
  }
  // the interference field: sum of the wave packets, lit where the crests add, shaded where they cancel
  {
    ripAcc.fill(0);
    const lc = (LAM * m) / CELL, wp = 2.6 * lc;
    for (const [sx, sy, r0, A] of srcs) {
      const cx = sx / CELL, cy = sy / CELL, R0 = r0 / CELL, Ri = Math.max(0, R0 - wp);
      const amp = A / Math.sqrt(1 + 0.25 * r0 / m);
      const ya = Math.max(0, Math.floor(cy - R0)), yb = Math.min(GH - 1, Math.ceil(cy + R0));
      for (let gy = ya; gy <= yb; gy++) {
        const dy = gy + 0.5 - cy, dy2 = dy * dy;
        if (dy2 > R0 * R0) continue;
        const xo = Math.sqrt(R0 * R0 - dy2), xi = dy2 < Ri * Ri ? Math.sqrt(Ri * Ri - dy2) : 0;
        for (const [p, q] of [[cx - xo, cx - xi], [cx + xi, cx + xo]]) {
          const xa = Math.max(0, Math.floor(p)), xb = Math.min(GW - 1, Math.ceil(q));
          const row = gy * GW;
          for (let gx = xa; gx <= xb; gx++) {
            const dx = gx + 0.5 - cx;
            const d = Math.sqrt(dx * dx + dy2);
            const back = R0 - d;
            if (back < 0 || back > wp) continue;
            const qq = back / wp;
            ripAcc[row + gx] += amp * Math.cos((TAU * back) / lc) * (1 - qq) * (1 - qq) * Math.min(1, back * 1.2 + 0.3);
          }
        }
      }
    }
    if (!ripCanvas) {
      ripCanvas = g.createCanvas(GW, GH);
      ripCtx = ripCanvas.getContext('2d');
      ripImg = ripCtx.createImageData(GW, GH);
    }
    const d = ripImg.data;
    const lt = [255, 255, 255];
    const dk = g.color.mix(pal.seaDeep, INK, 0.12);
    const dr = parseInt(dk.slice(1, 3), 16), dg = parseInt(dk.slice(3, 5), 16), db = parseInt(dk.slice(5, 7), 16);
    for (let i = 0, o = 0; i < GW * GH; i++, o += 4) {
      const val = ripAcc[i];
      if (val > 0) { d[o] = lt[0]; d[o + 1] = lt[1]; d[o + 2] = lt[2]; d[o + 3] = Math.min(235, val * 320); }
      else { d[o] = dr; d[o + 1] = dg; d[o + 2] = db; d[o + 3] = Math.min(175, -val * 230); }
    }
    ripCtx.putImageData(ripImg, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(ripCanvas, 0, 0, GW * CELL, GH * CELL);
    ctx.restore();
  }
  // crisp leading crests on top of the field, each with a shaded trough just inside it
  ctx.save();
  const trough = mixc(g, pal.seaDeep, INK, 0.3);
  for (const [sx, sy, r0, A, main] of srcs) {
    if (sx < -r0 || sx > 1920 + r0 || sy < -r0 || sy > 1080 + r0) continue;
    if (r0 > 8) {
      ctx.strokeStyle = g.color.css(trough, Math.min(0.5, 0.4 * A));
      ctx.lineWidth = main ? 4 : 3;
      ctx.beginPath(); ctx.arc(sx, sy, r0 - (main ? 4.5 : 3.5), 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = g.color.css('#FFFFFF', Math.min(0.95, 0.8 * A));
    ctx.lineWidth = main ? 3.2 : 2;
    ctx.beginPath(); ctx.arc(sx, sy, r0, 0, TAU); ctx.stroke();
    if (r0 > LAM * m) {
      ctx.strokeStyle = g.color.css('#FFFFFF', Math.min(0.6, 0.4 * A));
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(sx, sy, r0 - LAM * m, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();

  // the island from above
  {
    const [ix, iy] = map(W.Xi, W.Zi);
    const C2 = islandColors(g, pal);
    const k = m * (1 + 0.03 * Math.sin(W.tt * 0.8));
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(th);
    // shadow and foam
    ctx.fillStyle = g.color.css(pal.seaDeep, 0.35);
    ctx.beginPath(); ctx.ellipse(0, 1.2 * k, 5.0 * k, 3.6 * k, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = g.color.css(pal.crest, 0.8);
    ctx.lineWidth = 0.12 * k;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU;
      const r = 1 + 0.03 * Math.sin(a * 7 + W.tt * 2.3);
      const px = Math.cos(a) * 4.95 * k * r, py = Math.sin(a) * 3.45 * k * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = C2.island;
    ctx.beginPath(); ctx.ellipse(0, 0, 4.75 * k, 3.25 * k, 0, 0, TAU); ctx.fill();
    const gg = ctx.createRadialGradient(-0.8 * k, -0.6 * k, 0.3 * k, 0, 0, 4.6 * k);
    gg.addColorStop(0, C2.grassLight);
    gg.addColorStop(0.7, C2.grass);
    gg.addColorStop(1, C2.grassDark);
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.ellipse(0, 0, 4.5 * k, 3.0 * k, 0, 0, TAU); ctx.fill();
    // tufts
    ctx.fillStyle = C2.grassTip;
    for (let i = 0; i < 26; i++) {
      const a = hashU(201, i, 1) * TAU, r = Math.sqrt(hashU(201, i, 2)) * 0.88;
      const px = Math.cos(a) * 4.4 * k * r, py = Math.sin(a) * 2.9 * k * r;
      ctx.beginPath(); ctx.arc(px, py, (0.1 + 0.08 * hashU(201, i, 3)) * k, 0, TAU); ctx.fill();
    }
    // the house: its shadow, then the roof seen from above with its ridge and the chimney
    const hx = -2.9 * k, hz = -0.6 * k, rw = 2.9 * k, rd = 2.2 * k;
    ctx.fillStyle = g.color.css(INK, 0.25);
    ctx.fillRect(hx - rw / 2 + 0.2 * k, hz - rd / 2 + 0.5 * k, rw, rd + 0.8 * k);
    ctx.fillStyle = C2.roofDark;
    ctx.fillRect(hx - rw / 2, hz - rd / 2, rw, rd / 2);
    ctx.fillStyle = C2.roofLight;
    ctx.fillRect(hx - rw / 2, hz, rw, rd / 2);
    ctx.strokeStyle = C2.ink;
    ctx.lineWidth = Math.max(1, 0.06 * k);
    ctx.strokeRect(hx - rw / 2, hz - rd / 2, rw, rd);
    ctx.beginPath(); ctx.moveTo(hx - rw / 2, hz); ctx.lineTo(hx + rw / 2, hz); ctx.stroke();
    ctx.fillStyle = C2.roofDark;
    ctx.fillRect(hx + 0.55 * k, hz - 0.85 * k, 0.45 * k, 0.45 * k);
    ctx.strokeRect(hx + 0.55 * k, hz - 0.85 * k, 0.45 * k, 0.45 * k);
    // the lit window glows up through the roof edge
    ctx.globalAlpha = 0.5 + 0.3 * W.voc;
    ctx.drawImage(g.sprites.glow(pal.window), hx - 1.4 * k, hz + 0.6 * k, 1.6 * k, 1.6 * k);
    ctx.globalAlpha = 1;
    // smoke puffs rising toward the camera
    for (let i = 0; i < 6; i++) {
      const u = fract(W.tt * 0.18 + i / 6);
      const px = hx + 0.78 * k + u * 1.6 * k, py = hz - 0.62 * k - u * 0.9 * k;
      ctx.globalAlpha = 0.35 * Math.sin(Math.PI * u);
      ctx.fillStyle = C2.smoke;
      ctx.beginPath(); ctx.arc(px, py, (0.2 + 0.55 * u) * k, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // shadows, then the figures
  const ph = TAU * W.walkP;
  const bp = W.beatPulse * W.beatBob;
  const shade = g.color.css(mixc(g, pal.seaDeep, INK, 0.25), 0.26);
  ctx.fillStyle = shade;
  const sang = Math.atan2(shadowDir[1], shadowDir[0]);
  for (const f of figs.concat(mains)) {
    const k = f.main ? 1.55 : 1;
    const L = (0.75 + 0.1 * bp) * m * k;
    ctx.globalAlpha = clamp(f.e * 2);
    ctx.beginPath();
    ctx.ellipse(f.x + shadowDir[0] * L * 0.8, f.y + shadowDir[1] * L * 0.8, L, 0.2 * m * k, sang, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // a wake: two short lines trailing behind each of the six
  ctx.strokeStyle = g.color.css(pal.crest, 0.55 * (1 - W.numb));
  ctx.lineWidth = 1.6;
  for (const f of mains) {
    const bx = -Math.cos(fwdAng), by = -Math.sin(fwdAng);
    const lx = -by, ly = bx;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(f.x + bx * 0.25 * m + lx * side * 0.25 * m, f.y + by * 0.25 * m + ly * side * 0.25 * m);
      ctx.lineTo(f.x + bx * 1.6 * m + lx * side * 0.75 * m, f.y + by * 1.6 * m + ly * side * 0.75 * m);
    }
    ctx.stroke();
  }
  const crowdHead = mixc(g, pal.crowd, '#FFFFFF', 0.12);
  const crowdLimb = mixc(g, pal.crowd, INK, 0.3);
  const sink = 1 - 0.45 * W.riseEnv;
  for (const f of figs) {
    // surfacing: a milk ring around the figure as it comes up
    const e = f.e;
    if (e < 1) {
      ctx.strokeStyle = g.color.css(pal.crest, 0.8 * (1 - e));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, (0.3 + 1.2 * e) * m, 0, TAU); ctx.stroke();
    }
    figureTop(ctx, f.x, f.y, fwdAng, m, { coat: pal.crowd, arm: mixc(g, pal.crowd, INK, 0.18), limb: crowdLimb, hair: crowdHead, skin: null, ph: ph + hashU(19, f.id, 1) * 0.6, bp, k: 1, alpha: clamp(e * 2.5) * sink, outline: null });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const f of mains) {
    ctx.globalAlpha = (0.45 + 0.3 * bp) * f.e;
    const r = 0.9 * m;
    ctx.drawImage(g.sprites.glow(mixc(g, f.w.d.fill, '#FFFFFF', 0.4)), f.x - r, f.y - r, 2 * r, 2 * r);
  }
  ctx.restore();
  for (const f of mains) {
    const d = f.w.d;
    figureTop(ctx, f.x, f.y, fwdAng, m, { coat: d.fill, arm: mixc(g, d.fill, INK, 0.18), limb: d.limbFill, hair: f.w.hair, skin: f.w.skin, ph, bp, k: 1.55, alpha: f.e * sink, outline: g.color.css(INK, 0.7) });
  }

  // the spiral sun mirrored in the milk, pulsing on every beat
  ctx.save();
  const [rx, ry] = [1700 - 40 * su, 150 + 20 * su];
  drawSun(g, W, rx, ry, 85, { rays: 0.7, alpha: 0.5, glow: 0.3 });
  ctx.restore();

  // hats: star glints on the milk
  {
    const glint = g.sprites.glow(pal.sparkle, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const h of W.hats) {
      const n = 4 + Math.floor(hashU(101, h.id, 0) * 5);
      for (let j = 0; j < n; j++) {
        const x = 40 + hashU(103, h.id, j) * 1840, y = 40 + hashU(104, h.id, j) * 1000;
        const grow = h.age < 0.07 ? outCubic(h.age / 0.07) : 1;
        const fade = h.age < 0.07 ? 1 : 1 - (h.age - 0.07) / 0.18;
        const sz = (18 + 22 * hashU(105, h.id, j)) * grow * (0.6 + 0.4 * h.s);
        ctx.globalAlpha = fade * h.spawn;
        starGlint(ctx, glint, pal.sparkle, x, y, sz);
      }
    }
    ctx.restore();
  }
  // snare: a quick shimmer sweeping over the milk
  if (W.snareAmt > 0.01) {
    const cx = -200 + (W.snAge / 0.3) * 2400;
    const gs = ctx.createLinearGradient(cx - 220, 0, cx + 220, 0);
    gs.addColorStop(0, g.color.css('#FFFFFF', 0));
    gs.addColorStop(0.5, g.color.css('#FFFFFF', 0.16 * W.snareAmt));
    gs.addColorStop(1, g.color.css('#FFFFFF', 0));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = gs;
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.restore();
  }
  // the numb onset shock ring (a circle seen from above)
  if (W.onset >= 0 && W.onset < 1.5) {
    const a = W.onset / 1.5, fade = (1 - a) ** 1.2;
    const k0 = mains.length ? mains[0] : { x: 960, y: 540 };
    for (const [Rk, al, wk] of [[1, 1, 1], [0.72, 0.45, 0.6]]) {
      const R = (0.6 + 28 * a ** 1.4) * m * Rk;
      ctx.strokeStyle = g.color.css(pal.milk, 0.3 * fade * al);
      ctx.lineWidth = 30 * wk;
      ctx.beginPath(); ctx.arc(k0.x, k0.y, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = g.color.css('#FFFFFF', 0.9 * fade * al);
      ctx.lineWidth = 6 * wk;
      ctx.stroke();
    }
  }
  return { hy: 0 };
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const W = state(g, t, F, P, S);
  W.hy = P.horizon ?? defaults.horizon;
  W.sunX = P.sunX ?? defaults.sunX;
  W.sunY = P.sunY ?? defaults.sunY;
  W.sunR = P.sunR ?? defaults.sunR;
  const shot = shotAt(shotPlan(F, P, S), t, W.fps);

  let res;
  if (shot.name === 'tracking') res = drawTracking(g, W, shot);
  else if (shot.name === 'topdown') res = drawTopdown(g, W, shot);
  else if (shot.name === 'silhouette') res = drawSilhouette(g, W, shot);
  else res = drawWide(g, W, shot);
  const hy = res.hy;
  const pal = W.pal;

  // numb onset: the sky blinks milk-white
  if (W.onset >= 0 && W.onset < 0.3) {
    const al = 0.3 * (1 - W.onset / 0.3);
    if (hy > 4) {
      const gb = ctx.createLinearGradient(0, 0, 0, hy + 40);
      gb.addColorStop(0, g.color.css(pal.milk, al));
      gb.addColorStop(Math.max(0.01, hy / (hy + 40)), g.color.css(pal.milk, al));
      gb.addColorStop(1, g.color.css(pal.milk, 0));
      ctx.fillStyle = gb;
      ctx.fillRect(0, 0, 1920, hy + 40);
    } else {
      ctx.fillStyle = g.color.css(pal.milk, al);
      ctx.fillRect(0, 0, 1920, 1080);
    }
  }

  // numb: milk mist, colour drain
  const drain = clamp((P.drain ?? defaults.drain) * W.drainEnv + (1 - W.drainEnv) * (P.keep ?? defaults.keep) * W.accum);
  if (W.riseEnv > 0.002) {
    const top = Math.max(0, hy - 60);
    const gm = ctx.createLinearGradient(0, top, 0, 1080);
    gm.addColorStop(0, g.color.css(pal.milk, 0));
    gm.addColorStop(0.5, g.color.css(pal.milk, 0.22 * W.riseEnv));
    gm.addColorStop(1, g.color.css(pal.milk, 0.45 * W.riseEnv));
    ctx.fillStyle = gm;
    ctx.fillRect(0, top, 1920, 1080 - top);
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
