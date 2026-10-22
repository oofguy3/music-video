// C2 "In your head": a mind-game duel on an infinite dark chessboard under a void sky. Kaiser stands
// on one side, smirking; a rival (an original, anonymous dark silhouette with one glowing cyan eye that
// trails light) appears opposite and they circle each other while the board turns beneath them and a
// square lights up under one of them on every beat. A column of heavenly light falls on Kaiser. The
// rival's eye flares and draws glowing predictive lines across the board, which Kaiser simply walks
// through. Then Kaiser flash-steps around the rival on the beat, his blue afterimages (fx.echo)
// multiplying and crowding him, until the rival's silhouette cracks like glass in the drum break; the
// drums slam back, the afterimages pour into his head, the cracks run over his whole body and he
// shatters into falling shards behind Kaiser, who has already turned away. Everything goes dark but
// one spotlight; on the name Kaiser turns to look straight at the camera and the rose on his neck glows.
//
// Pure: every position is a closed-form function of t (trails and afterimages are the same functions
// at earlier t); moments come from P (snapped to their landing frames) and F.ev; module caches hold
// keyed geometry and sprites only (crack network, shard coverage, ghost sprites, palette mixes, beats).

import { KAISER, KZ, rivalDesign, drawRose, speedLines } from './lib/kaiser.mjs';
import { drawPuppet, solve, cycles, poses, blend, armTo } from './lib/puppet.mjs';
import { hashU } from './lib/worldkit.mjs';
import { echo } from './lib/fx.mjs';

export const meta = { type: 'kzRival', budgetMs: 160 };

export const defaults = {
  rivalT: -1,    // the rival appears (s; <0: 2 % into the entry)
  heavenT: -1,   // the column of heavenly light falls on Kaiser (<0: 17 %)
  visionT: -1,   // the rival's eye flares and draws its predictive lines (<0: 28 %)
  crowdT: -1,    // Kaiser's afterimages start to multiply (<0: a third of the way from vision to crack, on a beat)
  headT: -1,     // the rival's silhouette cracks like glass (<0: 64 %)
  deadT: -1,     // it shatters (<0: 75 %)
  lookT: -1,     // everything goes dark but one spotlight (<0: 91 %)
  nameT: -1,     // Kaiser looks into the camera, the rose glows (<0: 95 %)
  square: 1.8,   // chessboard square (m)
  orbit: 0.22,   // how fast they circle each other (rad/s)
  ring: 1.75,    // radius of the afterimage ring around the rival (m)
  copies: 12,    // most afterimages at once
  seed: 7,
};

const DEFAULT = {
  void: '#04061A', royal: '#1F4FD8', cyan: '#3DE0FF', rivalGlow: '#7FE3FF', gold: '#FFD45A',
  glass: '#DCEBFF', board: '#0B1450', boardHi: '#1F2F8E',
};

const TAU = Math.PI * 2;
const W = 1920, H = 1080;
const KZ_M = 1.86, RV_M = 1.82;                 // body heights (m)
const FOCAL = 1250;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (x) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const inQuad = (x) => clamp(x) ** 2;
const outExpo = (x) => { const c = clamp(x); return c >= 1 ? 1 : 1 - 2 ** (-10 * c); };
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const land = (x, fps) => Math.floor(x * fps + 0.5) / fps;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const mixv = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const after = (t, t0) => (t >= t0 ? t - t0 : -1);
const env = (t, a, b, fi, fo) => (t < a || t > b + fo ? 0 : t < a + fi ? smooth((t - a) / fi) : t <= b ? 1 : 1 - smooth((t - b) / fo));

// ---------------------------------------------------------------------------------------------
// The cast: Kaiser (the kit, never redesigned) and the rival (rivalDesign with dark fills).
// ---------------------------------------------------------------------------------------------

const RIVAL = rivalDesign('#0D1126', '#080A17', '#0C2A40');
const HIP = armTo(KAISER, 0.035, 0.16, 0, 1);
const TEMPLE = armTo(KAISER, 0.1, -0.15, 0.04, 1);
const CLUTCH = armTo(RIVAL, 0.07, -0.15, 0.22, 1);

const KP = {
  smug: { ...poses.stand, sR: HIP.s, eR: HIP.e, sL: -0.15, eL: 0.35, hL: -0.14, hR: 0.16, kL: 0.06, kR: 0.04, lean: -0.05, head: -0.18 },
  bask: { ...poses.stand, sL: -0.75, eL: 0.3, sR: -0.62, eR: 0.25, lean: -0.17, head: -0.62, hL: -0.08, hR: 0.1, kL: 0.06 },
  temple: { ...poses.stand, sR: TEMPLE.s, eR: TEMPLE.e, sL: -0.15, eL: 0.35, hL: -0.1, hR: 0.14, lean: 0.03, head: -0.06 },
  front: { ...poses.stand, sL: 0.1, eL: 0.12, sR: 0.1, eR: 0.12, hL: 0.04, hR: 0.04, head: 0.07 },
};
const COPY_POSES = [
  { hL: 1.0, kL: 0.9, hR: -0.7, kR: 0.5, lean: 0.45, sL: -0.9, sR: 0.9, eL: 0.4, eR: 0.6, head: -0.1 },          // lunge
  { hR: 1.5, kR: 0.15, hL: -0.2, kL: 0.25, sL: 1.2, eL: 0.3, sR: -0.9, eR: 0.4, lean: -0.25, head: 0.1 },         // volley follow-through
  KP.smug,
  { ...poses.stand, sR: 1.5, eR: 0.05, sL: -0.2, eL: 0.4, hL: -0.12, hR: 0.15, head: -0.12, lean: -0.05 },       // point
  cycles.run(0.12, 1),
  { hL: 0.75, kL: 1.3, hR: -0.35, kR: 0.9, lean: 0.35, sL: 0.5, eL: 1.0, sR: -0.6, eR: 0.5, head: -0.15, bob: -0.04 },  // low turn
  cycles.run(0.62, 1),
];
const RP = {
  ready: { hL: 0.38, kL: 0.6, hR: -0.12, kR: 0.4, lean: 0.3, sL: 0.25, eL: 0.5, sR: 0.15, eR: 0.6, head: -0.12 },
  vision: { hL: 0.42, kL: 0.66, hR: -0.1, kR: 0.44, lean: 0.36, sL: 0.2, eL: 0.45, sR: 0.1, eR: 0.55, head: 0.2 },
  crowded: { hL: 0.55, kL: 1.0, hR: 0.1, kR: 0.8, lean: 0.25, sL: 0.9, eL: 1.2, sR: 1.1, eR: 1.3, head: -0.05 },
  clutch: { hL: 0.3, kL: 0.5, hR: -0.05, kR: 0.3, lean: 0.22, sL: CLUTCH.s - 0.1, eL: CLUTCH.e + 0.1, sR: CLUTCH.s, eR: CLUTCH.e, head: 0.35 },
};
const poseOf = (list, m) => list[((m % list.length) + list.length) % list.length];

// ---------------------------------------------------------------------------------------------
// Palette, moments, beat grid
// ---------------------------------------------------------------------------------------------

const palCache = new Map();
function palOf(g, S) {
  const p = (S && S.palette) || {};
  const o0 = {};
  for (const k of Object.keys(DEFAULT)) o0[k] = typeof p[k] === 'string' && p[k][0] === '#' ? p[k] : DEFAULT[k];
  const key = Object.values(o0).join('|');
  let o = palCache.get(key);
  if (!o) {
    const m = g.color.mix;
    o = { ...o0 };
    o.fog = m(o.void, o.royal, 0.16);
    o.deep = m(o.board, o.void, 0.55);
    o.base = m(o.board, o.void, 0.25);
    o.square = m(o.boardHi, o.board, 0.15);
    o.horizon = m(o.royal, o.cyan, 0.3);
    o.line = m(o.royal, o.cyan, 0.5);
    o.goldHi = m(o.gold, '#FFFFFF', 0.6);
    o.after = m(o.royal, o.cyan, 0.32);
    o.afterHi = m(o.royal, '#FFFFFF', 0.5);
    o.rim = m(o.royal, '#FFFFFF', 0.5);
    o.cyanHi = m(o.cyan, '#FFFFFF', 0.55);
    o.skyTop = m(o.void, '#000000', 0.35);
    o.skyMid = m(o.void, o.royal, 0.1);
    o.skyLow = m(o.void, o.royal, 0.24);
    o.crimson = m(KZ.red, KZ.redDeep, 0.35);
    if (palCache.size > 16) palCache.clear();
    palCache.set(key, o);
  }
  return o;
}

const beatCache = new WeakMap();
/** The beat grid with double detections removed (landing-frame times). */
function beatList(F) {
  const src = (F.ev && F.ev.beats) || [];
  let b = beatCache.get(src);
  if (!b) {
    const fps = F.fps || 30, gap = 0.6 * (F.beatS || 0.4);
    b = [];
    for (const x of src) { const tl = land(x, fps); if (!b.length || tl - b[b.length - 1] >= gap) b.push(tl); }
    beatCache.set(src, b);
  }
  return b;
}
function lastIdx(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t + 1e-9) lo = m + 1; else hi = m; }
  return lo - 1;
}

function timeline(F, P, S) {
  const t0 = S.t0, t1 = S.t1, dur = Math.max(1, t1 - t0), fps = F.fps || 30, beatS = F.beatS || 0.4;
  const inside = (v) => typeof v === 'number' && Number.isFinite(v) && v >= t0 - 1e-6 && v <= t1 + 1e-6;
  const pick = (v, frac, lo) => Math.max(lo, land(inside(v) ? v : t0 + frac * dur, fps));
  const rivalT = pick(P.rivalT, 0.02, t0);
  const heavenT = pick(P.heavenT, 0.166, rivalT + 0.3);
  const visionT = pick(P.visionT, 0.277, heavenT + 0.4);
  const headT = pick(P.headT, 0.636, visionT + 1.5);
  const deadT = pick(P.deadT, 0.748, headT + 0.5);
  const lookT = pick(P.lookT, 0.907, deadT + 0.6);
  const nameT = pick(P.nameT, 0.945, lookT + 0.15);
  const beats = beatList(F);
  let crowdT;
  if (inside(P.crowdT) && P.crowdT > visionT + 0.4 && P.crowdT < headT - 0.6) crowdT = land(P.crowdT, fps);
  else {
    const guess = visionT + 0.33 * (headT - visionT);
    const i = lastIdx(beats, guess);
    const a = beats[i], b = beats[i + 1];
    crowdT = a === undefined ? guess : b === undefined || guess - a < b - guess ? a : b;
    crowdT = clamp(crowdT, visionT + 0.5, headT - 0.7);
  }
  // the drums slamming back after the crack: the first strong hit after it, else a third of the way on
  let slamT = land(headT + 0.3 * (deadT - headT), fps);
  for (const h of F.between('hit', headT + 0.12, deadT - 0.15)) if (h[1] >= 0.75) { slamT = land(h[0], fps); break; }
  return { t0, t1, dur, fps, beatS, rivalT, heavenT, visionT, crowdT, headT, slamT, deadT, lookT, nameT, beats,
    tw0: visionT + 0.25, tTemple: headT - 0.3 };
}

/** Integral of a window that ramps 0->1 over [a, a+ra], holds, and ramps back to 0 over [b, b+rb]. */
function rampInt(t, a, ra, b, rb) {
  if (t <= a) return 0;
  b = Math.max(b, a + ra);
  let s = (Math.min(t, a + ra) - a) ** 2 / (2 * ra);
  if (t <= a + ra) return s;
  s += Math.min(t, b) - (a + ra);
  if (t <= b) return s;
  const u = Math.min(t, b + rb) - b;
  return s + u - (u * u) / (2 * rb);
}

// ---------------------------------------------------------------------------------------------
// The world: where everyone stands at any time tt (pure functions, so the past is just tt < t)
// ---------------------------------------------------------------------------------------------

// afterimage spots around the rival, degrees: 0 right, 90 behind, 180 left (never right in front)
const RING_DEG = [205, 25, 150, 335, 128, 190, 52, 352, 165, 12, 140, 218, 40, 322, 176, 8];

function makeModel(F, P, T) {
  const Rc = 1.55, om = num(P.orbit, defaults.orbit), A0 = 0.4, ring = num(P.ring, defaults.ring);
  const A = (tt) => {
    if (tt <= T.visionT) return A0 + om * (tt - T.t0);
    const u = clamp((tt - T.visionT) / 0.7);
    return A0 + om * (T.visionT - T.t0) + om * 0.35 * (1 - (1 - u) * (1 - u));
  };
  const aT0 = A(T.t0);
  const yaw = (tt) => -aT0 - 0.85 * (A(tt) - aT0) + 0.16 * rampInt(tt, T.crowdT - 0.3, 0.6, T.slamT - 0.1, 0.5);
  const axes = (tt) => { const y = yaw(tt); return { r: [Math.cos(y), -Math.sin(y)], f: [Math.sin(y), Math.cos(y)] }; };
  const rivalCircle = (tt) => { const a = A(tt); return [Rc * Math.cos(a), Rc * Math.sin(a)]; };
  const kaiserCircle = (tt) => { const a = A(tt); return [-Rc * Math.cos(a), -Rc * Math.sin(a)]; };
  const RvEnd = rivalCircle(T.visionT + 5);
  // the walk through the vision lines
  const kw0 = kaiserCircle(T.tw0);
  const dirW = norm(sub(RvEnd, kw0));
  const vW = 0.95, tauA = 0.35;
  const walkD = (tt) => { const u = tt - T.tw0; if (u <= 0) return 0; return u < tauA ? (vW * u * u) / (2 * tauA) : vW * (u - tauA / 2); };
  const walkInv = (d) => (d <= 0 ? 0 : d < (vW * tauA) / 2 ? Math.sqrt((2 * tauA * d) / vW) : d / vW + tauA / 2);
  const walkEnd = add(kw0, mul(dirW, walkD(T.crowdT)));
  // flash steps: on the beats with a drum hit, then on the off-beats too as the afterimages multiply
  const hasHit = (x) => F.between('hit', x - 0.07, x + 0.07).length > 0 || F.between('kick', x - 0.07, x + 0.07).length > 0;
  const bs = T.beats.filter((b) => b >= T.crowdT - 0.02 && b <= T.tTemple - 0.2);
  const steps = [T.crowdT];
  bs.forEach((b, i) => {
    if (b > T.crowdT + 0.1 && hasHit(b)) steps.push(b);
    const nb = bs[i + 1];
    if (nb !== undefined && b - T.crowdT > 0.38 * (T.tTemple - T.crowdT)) {
      const m = land((b + nb) / 2, T.fps);
      if (hasHit(m)) steps.push(m);
    }
  });
  steps.sort((a, b) => a - b);
  const axC = axes(T.crowdT);
  const stepPos = (m) => {
    if (m < 0) return walkEnd;
    const a = (RING_DEG[m % RING_DEG.length] * Math.PI) / 180;
    const rr = ring * (1 + 0.1 * Math.sin(m * 2.3));
    return add(RvEnd, add(mul(axC.r, Math.cos(a) * rr), mul(axC.f, Math.sin(a) * rr * 0.8)));
  };
  const axH = axes(T.headT);
  const ta = (200 * Math.PI) / 180;
  const templePos = add(RvEnd, add(mul(axH.r, Math.cos(ta) * 0.95), mul(axH.f, Math.sin(ta) * 0.95)));
  const axS = axes(T.slamT);
  const dirA = norm(add(mul(axS.r, -1), mul(axS.f, -0.1)));
  const vA = 1.05, tau1 = Math.max(0.2, T.deadT + 0.55 - T.slamT);
  const awayD = (tt) => {
    const u = tt - T.slamT;
    if (u <= 0) return 0;
    if (u < tau1) return vA * u;
    const w = clamp((u - tau1) / 0.8);
    return vA * tau1 + vA * 0.4 * (1 - (1 - w) * (1 - w));
  };
  const awayPos = (tt) => add(templePos, mul(dirA, awayD(tt)));

  /** Kaiser at time tt: world position, mode, step, dash. */
  function kaiser(tt) {
    if (tt < T.tw0) return { pos: kaiserCircle(tt), mode: 'circle' };
    if (tt < T.crowdT) return { pos: add(kw0, mul(dirW, walkD(tt))), mode: 'walk', d: walkD(tt) };
    if (tt < T.tTemple) {
      const m = lastIdx(steps, tt);
      const u = (tt - steps[m]) / 0.075;
      const pos = u < 1 ? mixv(stepPos(m - 1), stepPos(m), outCubic(u)) : stepPos(m);
      return { pos, mode: 'step', m, dash: u < 1 ? u : 1 };
    }
    if (tt < T.slamT) {
      const u = (tt - T.tTemple) / 0.075;
      const last = stepPos(steps.length - 1);
      return { pos: u < 1 ? mixv(last, templePos, outCubic(u)) : templePos, mode: 'temple', dash: Math.min(1, u) };
    }
    return { pos: awayPos(tt), mode: tt < T.nameT ? 'away' : 'front', d: awayD(tt) };
  }

  return { A, yaw, axes, Rc, RvEnd, kw0, dirW, walkD, walkInv, walkEnd, steps, stepPos, templePos, dirA, awayD, awayPos,
    kaiser, rival: rivalCircle, kaiserCircle };
}

// ---------------------------------------------------------------------------------------------
// Camera: a pinhole (engine world.project) that orbits, cranes and dollies around the duel
// ---------------------------------------------------------------------------------------------

function camAt(g, tt, M, T) {
  const wHv = env(tt, T.heavenT - 0.1, T.visionT - 0.5, 0.5, 0.6);   // in on Kaiser under the light
  const w2 = smooth((tt - (T.visionT - 0.1)) / 0.8);                // crane up over the vision lines
  const w3 = smooth((tt - (T.crowdT - 0.4)) / 0.9);                 // down into the crowd around the rival
  const wh = smooth((tt - (T.headT - 0.35)) / 0.5);                 // close on the crack
  const w4 = smooth((tt - T.slamT) / 0.7);                          // wider as Kaiser walks away
  const w5 = smooth((tt - (T.deadT + 0.15)) / 1.3);                 // follow Kaiser
  const wl = smooth((tt - T.lookT) / 1.2);                          // ease in under the spotlight
  let c = [0, 0];
  if (wHv > 0) c = mixv(c, M.kaiserCircle(tt), 0.42 * wHv);
  c = mixv(c, mul(M.RvEnd, 0.2), w2);
  c = mixv(c, M.RvEnd, w3);
  c = mixv(c, mixv(M.RvEnd, M.templePos, 0.28), wh);
  if (w4 > 0) c = mixv(c, mixv(M.RvEnd, M.awayPos(tt), 0.4), w4);
  if (w5 > 0) c = mixv(c, M.awayPos(tt), w5);
  let d = lerp(4.6, 4.3, clamp((tt - T.t0) / Math.max(0.5, T.visionT - T.t0)));
  d = lerp(d, 3.7, wHv);
  d = lerp(d, 4.8, w2);
  d = lerp(d, lerp(4.6, 4.1, clamp((tt - T.crowdT) / Math.max(0.5, T.headT - T.crowdT))), w3);
  d = lerp(d, 3.05, wh);
  d = lerp(d, 3.4, w4);
  d = lerp(d, 4.4, w5);
  d = lerp(d, 3.8, wl);
  let h = 1.62, hz = 0.42;
  h = lerp(h, 2.7, w2); hz = lerp(hz, 0.25, w2);
  h = lerp(h, 1.9, w3); hz = lerp(hz, 0.36, w3);
  h = lerp(h, 1.55, wh); hz = lerp(hz, 0.33, wh);
  h = lerp(h, 1.62, w4); hz = lerp(hz, 0.37, w4);
  hz = lerp(hz, 0.4, w5);
  let f = FOCAL, yaw = M.yaw(tt);
  if (tt >= T.nameT) {                               // the cut to his face, pushing in
    const u = outCubic((tt - T.nameT) / Math.max(0.3, T.t1 - T.nameT));
    c = M.awayPos(tt);
    d = lerp(1.9, 1.38, u);
    hz = lerp(0.39, 0.37, u);
    h = 1.62;
  }
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  const base = g.world.camera({ horizon: hz, height: h, focal: f, x: 0, z: 0, near: 0.05 });
  return { base, cx: c[0] - d * sn, cz: c[1] - d * cs, sn, cs, h, f, hy: base.hy, yaw, target: c, dist: d };
}
const toCam = (cam, X, Z) => { const dx = X - cam.cx, dz = Z - cam.cz; return [dx * cam.cs - dz * cam.sn, dx * cam.sn + dz * cam.cs]; };
const camToWorld = (cam, xc, zc) => [cam.cx + xc * cam.cs + zc * cam.sn, cam.cz - xc * cam.sn + zc * cam.cs];
function proj(g, cam, X, Y, Z) { const [xc, zc] = toCam(cam, X, Z); return g.world.project(cam.base, xc, Y, zc); }
function placeOf(g, cam, pos, hm, d) {
  const p = proj(g, cam, pos[0], 0, pos[1]);
  if (!p) return null;
  return { x: p.x, ground: p.y, scale: (p.s * hm) / d.height, U: p.s * hm, z: p.d, s: p.s };
}

// ---------------------------------------------------------------------------------------------
// Offscreen figure helpers (bbox-limited, so they cost what the figure covers)
// ---------------------------------------------------------------------------------------------

const JOINTS = ['pelvis', 'neck', 'headC', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR',
  'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR'];
function bboxOf(j, d, extra = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of JOINTS) { const v = j[k]; if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; }
  const U = j.U, pad = Math.max(d.legW, d.armW, d.torsoW) * U * 0.6 + 6 + extra, hp = d.headR * U * 1.5 + 6 + extra;
  const [hx, hy] = j.headC;
  return { x0: Math.min(x0 - pad, hx - hp), y0: Math.min(y0 - pad, hy - hp), x1: Math.max(x1 + pad, hx + hp), y1: Math.max(y1 + pad, hy + hp) };
}
function devRect(g, bb) {
  const ds = g.scale;
  const x0 = Math.max(0, Math.floor(bb.x0 * ds)), y0 = Math.max(0, Math.floor(bb.y0 * ds));
  const x1 = Math.min(g.devW, Math.ceil(bb.x1 * ds)), y1 = Math.min(g.devH, Math.ceil(bb.y1 * ds));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}
function blit(g, ctx, src, bb, alpha = 1, op = 'source-over') {
  const r = devRect(g, bb);
  if (!r || alpha <= 0.002) return;
  const ds = g.scale;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha);
  ctx.globalCompositeOperation = op;
  ctx.drawImage(src, r[0], r[1], r[2], r[3], r[0] / ds, r[1] / ds, r[2] / ds, r[3] / ds);
  ctx.restore();
}
/** The figure's silhouette in one colour minus itself shifted by (ox, oy): a rim of light on the far side. */
function rimOf(g, name, src, bb, color, ox, oy) {
  const r = devRect(g, bb);
  if (!r) return null;
  const L = g.layer(name), x = L.ctx, ds = g.scale;
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(src, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(r[0], r[1], r[2], r[3]);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(src, r[0], r[1], r[2], r[3], r[0] + ox * ds, r[1] + oy * ds, r[2], r[3]);
  x.restore();
  return L.canvas;
}
/** The figure's silhouette in one colour. */
function silOf(g, name, src, bb, color) {
  const r = devRect(g, bb);
  if (!r) return null;
  const L = g.layer(name), x = L.ctx;
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(src, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(r[0], r[1], r[2], r[3]);
  x.restore();
  return L.canvas;
}
/** A mirror image on the glossy board below the feet, fading out in bands. */
function reflectionOf(g, src, bb, feetY, alpha, fade) {
  if (alpha <= 0.003) return;
  const ctx = g.ctx, ds = g.scale, bands = 4;
  ctx.save();
  ctx.translate(0, 2 * feetY);
  ctx.scale(1, -1);
  for (let b = 0; b < bands; b++) {
    const y0 = feetY - ((b + 1) * fade) / bands, y1 = feetY - (b * fade) / bands;
    const r = devRect(g, { x0: bb.x0, x1: bb.x1, y0: Math.max(bb.y0, y0), y1: Math.min(bb.y1, y1) });
    if (!r) continue;
    ctx.globalAlpha = alpha * (1 - (b + 0.4) / bands);
    ctx.drawImage(src, r[0], r[1], r[2], r[3], r[0] / ds, r[1] / ds, r[2] / ds, r[3] / ds);
  }
  ctx.restore();
}

/** A point in a puppet's head frame (r = head radius) to the screen. */
function headPoint(j, d, lx, ly) {
  const r = d.headR * j.U, a = j.headAng, fx = j.facing * lx * r, y = ly * r;
  return [j.headC[0] + fx * Math.cos(a) - y * Math.sin(a), j.headC[1] + fx * Math.sin(a) + y * Math.cos(a)];
}

const ghostCache = new Map();
/**
 * An afterimage of Kaiser in one pose: his figure tinted blue with a light rim, fading towards the
 * feet, rendered once at a reference size (keyed by pose, facing, device scale and colours).
 */
function ghostSprite(g, m, facing, pal) {
  const pi = ((m % COPY_POSES.length) + COPY_POSES.length) % COPY_POSES.length;
  const key = `${m < 0 ? 'walk' : pi}|${facing}|${g.scale}|${pal.after}|${pal.afterHi}`;
  let s = ghostCache.get(key);
  if (s) return s;
  const pose = m < 0 ? cycles.walk(0.3, 0.85) : COPY_POSES[pi];
  const refU = 640, scale = refU / KAISER.height, ds = g.scale;
  const j = solve(KAISER, pose, { x: 0, ground: 0, scale, facing, view: 'side' });
  const bb = bboxOf(j, KAISER, 8);
  const w = Math.max(1, Math.ceil((bb.x1 - bb.x0) * ds)), h = Math.max(1, Math.ceil((bb.y1 - bb.y0) * ds));
  const c = g.createCanvas(w, h), x = c.getContext('2d');
  const tmp = g.createCanvas(w, h), tx = tmp.getContext('2d');
  x.setTransform(ds, 0, 0, ds, -bb.x0 * ds, -bb.y0 * ds);
  drawPuppet(x, KAISER, pose, { x: 0, ground: 0, scale, facing, view: 'side', devScale: ds });
  x.setTransform(1, 0, 0, 1, 0, 0);
  // the rim: tinted silhouette minus itself shifted down and back
  tx.drawImage(c, 0, 0);
  tx.globalCompositeOperation = 'source-in';
  tx.fillStyle = pal.afterHi;
  tx.fillRect(0, 0, w, h);
  tx.globalCompositeOperation = 'destination-out';
  tx.drawImage(c, -3 * facing * ds, 3 * ds);
  // the body: blue, keeping a hint of his shapes
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = 0.8;
  x.fillStyle = pal.after;
  x.fillRect(0, 0, w, h);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'lighter';
  x.drawImage(tmp, 0, 0);
  // fading out towards the feet
  x.globalCompositeOperation = 'destination-out';
  const gr = x.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0.05)');
  gr.addColorStop(1, 'rgba(0,0,0,0.85)');
  x.fillStyle = gr;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-over';
  s = { c, x0: bb.x0 / refU, y0: bb.y0 / refU, w: (bb.x1 - bb.x0) / refU, h: (bb.y1 - bb.y0) / refU };
  if (ghostCache.size > 64) ghostCache.delete(ghostCache.keys().next().value);
  ghostCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// The glass: a spider-web crack network (radial lines, broken rings, splinters) and its shards
// ---------------------------------------------------------------------------------------------

const RADII = [0, 0.05, 0.11, 0.18, 0.26, 0.35, 0.45, 0.56, 0.68, 0.8, 0.93, 1.07, 1.22];
const crackCache = new Map();
/**
 * The crack network in units of the body height, around the impact point (0, 0) with +y running
 * down the body: half the radial cracks fan around the head, half run down the body (like cracks
 * along glass rods), and the rings cut across them.
 */
function crackNet(seed) {
  let C = crackCache.get(seed);
  if (C) return C;
  const M = RADII.length, nDown = 7, nHead = 7, N = nDown + nHead;
  const down = [], head = [];
  for (let i = 0; i < nDown; i++) down.push(Math.PI / 2 + (((i + 0.5) / nDown) - 0.5) * 1.0 + 0.06 * (hashU(seed, i, 1) - 0.5));
  for (let i = 0; i < nHead; i++) head.push(Math.PI / 2 + 0.62 + ((i + 0.5 + 0.4 * (hashU(seed, i, 2) - 0.5)) / nHead) * (TAU - 1.24));
  const ang = [...down, ...head].map((a) => ((a % TAU) + TAU) % TAU).sort((a, b) => a - b);
  const V = [];
  for (let i = 0; i < N; i++) {
    const row = [[0, 0]];
    const gap = Math.min(((ang[(i + 1) % N] - ang[i] + TAU) % TAU), ((ang[i] - ang[(i + N - 1) % N] + TAU) % TAU));
    for (let j = 1; j < M; j++) {
      const a = ang[i] + 0.35 * (hashU(seed, i, 10 + j) - 0.5) * gap;
      const r = RADII[j] * (1 + 0.2 * (hashU(seed, i, 40 + j) - 0.5));
      row.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    V.push(row);
  }
  const kink = (a, b, s, k = 0.24) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, o = k * (s - 0.5) * L;
    return [(a[0] + b[0]) / 2 - (dy / L) * o, (a[1] + b[1]) / 2 + (dx / L) * o];
  };
  const KR = V.map((row, i) => row.slice(0, -1).map((p, j) => kink(p, row[j + 1], hashU(seed, i, 100 + j))));
  const KC = V.map((row, i) => row.map((p, j) => (j === 0 ? p : kink(p, V[(i + 1) % N][j], hashU(seed, i, 200 + j), 0.35))));
  const radial = V.map((row, i) => {
    const pts = [row[0]];
    for (let j = 0; j < M - 1; j++) pts.push(KR[i][j], row[j + 1]);
    return pts.map((p) => [p[0], p[1], Math.hypot(p[0], p[1])]);
  });
  const rings = [];
  for (let j = 1; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      rings.push({ pts: [V[i][j], KC[i][j], V[i2][j]], r: RADII[j] * (0.95 + 0.1 * hashU(seed, i, 250 + j)), early: hashU(seed, i, 300 + j) < (j < 3 ? 0.7 : 0.62) });
    }
  }
  // short splinters off the radial lines
  const splinters = [];
  for (let i = 0; i < N; i++) {
    for (let j = 2; j < M - 1; j++) {
      if (hashU(seed, i, 600 + j) > 0.55) continue;
      const p = V[i][j], a = Math.atan2(p[1], p[0]) + (hashU(seed, i, 650 + j) < 0.5 ? -1 : 1) * (0.5 + 0.5 * hashU(seed, i, 700 + j));
      const len = RADII[j] * (0.12 + 0.18 * hashU(seed, i, 750 + j));
      splinters.push({ a: p, b: [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len], r: Math.hypot(p[0], p[1]) + len });
    }
  }
  // cells between two radials and two rings; big outer cells split along a diagonal
  const cells = [], diags = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < M - 1; j++) {
      const a = V[i][j], b = V[i2][j], c = V[i2][j + 1], dd = V[i][j + 1];
      const ab = KC[i][j], bc = KR[i2][j], cd = KC[i][j + 1], da = KR[i][j];
      const tint = hashU(seed, i, 800 + j);
      if (j === 0) { cells.push({ poly: [a, bc, c, cd, dd, da], r: RADII[1], tint }); continue; }
      if (j >= 4 && hashU(seed, i, 400 + j) < 0.6) {
        cells.push({ poly: [a, ab, b, bc, c], r: RADII[j + 1], tint });
        cells.push({ poly: [c, cd, dd, da, a], r: RADII[j + 1], tint: hashU(seed, i, 850 + j) });
        diags.push([a, c]);
      } else cells.push({ poly: [a, ab, b, bc, c, cd, dd, da], r: RADII[j + 1], tint });
    }
  }
  C = { radial, rings, splinters, cells, diags, N, M };
  crackCache.set(seed, C);
  return C;
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const [xi, yi] = poly[i], [xk, yk] = poly[k];
    if ((yi > py) !== (yk > py) && px < ((xk - xi) * (py - yi)) / (yk - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
  const u = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2);
  return Math.hypot(px - a[0] - u * dx, py - a[1] - u * dy);
}

/** Local crack coordinates (body heights, +y down the body) to the screen, mirrored by facing. */
function crackXf(O, U, facing, phi) {
  const c = Math.cos(phi), sn = Math.sin(phi);
  return (p) => { const x = p[0] * facing, y = p[1]; return [O[0] + U * (x * c - y * sn), O[1] + U * (x * sn + y * c)]; };
}
/** The impact point on the rival's head and the angle of his body axis (from it to his feet). */
function crackFrame(j) {
  const O = headPoint(j, RIVAL, 0.22, -0.12);
  const fx = (j.ankleL[0] + j.ankleR[0]) / 2 - O[0], fy = (j.ankleL[1] + j.ankleR[1]) / 2 - O[1];
  return { O, phi: Math.atan2(-fx, fy) };
}

/**
 * The glass on a figure already drawn into x (call with 'source-atop'): faceted panes catching the
 * light, then cyan-glowing white fracture lines out to radius cr (body heights), splinters, and the
 * light leaking from the impact point. cr > 1.3 draws every crack the shards will break along.
 */
function drawCracks(g, x, net, xf, O, U, cr, pulse, hot, pal) {
  const css = g.color.css;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  for (const c of net.cells) {
    if (c.r > cr + 0.02) continue;
    const a = (0.05 + 0.2 * c.tint * c.tint) * (0.7 + 0.6 * pulse) + 0.25 * hot;
    x.fillStyle = css(c.tint > 0.62 ? pal.glass : c.tint > 0.3 ? pal.cyan : pal.royal, Math.min(1, a));
    x.beginPath();
    c.poly.forEach((p, i) => { const s = xf(p); if (i) x.lineTo(s[0], s[1]); else x.moveTo(s[0], s[1]); });
    x.closePath();
    x.fill();
  }
  const radialPath = (rmax, inner) => {
    x.beginPath();
    for (const line of net.radial) {
      let started = false;
      for (let i = 0; i < line.length; i++) {
        const p = line[i];
        if (inner && p[2] > inner) break;
        if (p[2] <= rmax) {
          const s = xf(p);
          if (!started) { x.moveTo(s[0], s[1]); started = true; } else x.lineTo(s[0], s[1]);
        } else {
          if (started && i > 0) {
            const a = line[i - 1], u = (rmax - a[2]) / Math.max(1e-6, p[2] - a[2]);
            const s = xf([a[0] + (p[0] - a[0]) * u, a[1] + (p[1] - a[1]) * u]);
            x.lineTo(s[0], s[1]);
          }
          break;
        }
      }
    }
  };
  const full = cr > 1.3;
  const otherPath = () => {
    x.beginPath();
    for (const rg of net.rings) {
      if (!(rg.early || full) || rg.r > cr - 0.03) continue;
      const a = xf(rg.pts[0]), b = xf(rg.pts[1]), c = xf(rg.pts[2]);
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineTo(c[0], c[1]);
    }
    for (const sp of net.splinters) {
      if (sp.r > cr) continue;
      const a = xf(sp.a), b = xf(sp.b);
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]);
    }
    if (full) for (const [a0, c0] of net.diags) { const a = xf(a0), c = xf(c0); x.moveTo(a[0], a[1]); x.lineTo(c[0], c[1]); }
  };
  const glowW = Math.max(2, U * (0.011 + 0.006 * pulse)), coreW = Math.max(1, U * 0.0028);
  x.strokeStyle = css(pal.cyan, 0.4 + 0.3 * pulse + 0.3 * hot);
  radialPath(cr, 0); x.lineWidth = glowW; x.stroke();
  otherPath(); x.lineWidth = glowW * 0.7; x.stroke();
  x.strokeStyle = '#FFFFFF';
  radialPath(cr, 0); x.lineWidth = coreW; x.stroke();
  radialPath(cr, 0.3); x.lineWidth = coreW * 2.2; x.stroke();
  otherPath(); x.lineWidth = coreW * 0.8; x.stroke();
  const lr = U * (0.1 + 0.08 * pulse + 0.25 * hot);
  x.globalAlpha = 0.65 + 0.35 * pulse;
  x.drawImage(g.sprites.glow(pal.cyanHi, 1), O[0] - lr, O[1] - lr, 2 * lr, 2 * lr);
  x.globalAlpha = 1;
}

/** Crack cells that cover part of a skeleton (local crack coordinates), tested against its limbs as capsules. */
function coveredCells(net, sk, d) {
  const caps = [];
  const ow = (d.outlineW || 0) / d.height + 0.025;             // the glass aura around him breaks too
  const cap = (a, b, r) => caps.push([sk[a], sk[b], r]);
  for (const s of ['L', 'R']) {
    cap(`shoulder${s}`, `elbow${s}`, d.armW / 2 + ow); cap(`elbow${s}`, `wrist${s}`, d.armW / 2 + ow);
    cap(`hip${s}`, `knee${s}`, d.legW / 2 + ow); cap(`knee${s}`, `ankle${s}`, d.legW / 2 + ow); cap(`ankle${s}`, `toe${s}`, d.legW / 2 + ow);
  }
  cap('pelvis', 'neck', d.torsoSide / 2 + ow);
  caps.push([sk.headC, sk.headC, d.headR + ow]);
  const covered = (x, y) => caps.some(([a, b, r]) => segDist(x, y, a, b) < r);
  const out = [];
  net.cells.forEach((cell, idx) => {
    const poly = cell.poly;
    let cx = 0, cy = 0;
    for (const [x, y] of poly) { cx += x; cy += y; }
    cx /= poly.length; cy /= poly.length;
    const probes = [[cx, cy], ...poly, ...poly.map((p, k) => { const q = poly[(k + 1) % poly.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; })];
    let hit = probes.some(([x, y]) => covered(x, y));
    for (const [a, b] of caps) {
      if (hit) break;
      for (let s = 0; s <= 10 && !hit; s++) { const u = s / 10; if (pointInPoly(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, poly)) hit = true; }
    }
    if (hit) out.push({ idx, poly, cx, cy });
  });
  return out;
}

const kitCache = new Map();
/**
 * The shatter kit: the frozen rival rendered once at a reference size with every crack and a faint
 * glass aura, cut into one small sprite per shard (plus a white copy for glints), with each shard's
 * burst seeds. Keyed by the frozen pose, facing, device scale and colours, so it is pure.
 */
function shatterKit(g, pose, facing, pal, seed) {
  const refU = 720, ds = g.scale, scale = refU / RIVAL.height;
  const j = solve(RIVAL, pose, { x: 0, ground: 0, scale, facing, view: 'side' });
  const key = `${seed}|${facing}|${ds}|${pal.glass}|${pal.cyan}|${pal.royal}|${JOINTS.map((k) => j[k].map((v) => v.toFixed(1)).join(',')).join(';')}`;
  let kit = kitCache.get(key);
  if (kit) return kit;
  const net = crackNet(seed);
  const { O, phi } = crackFrame(j);
  const xf = crackXf(O, refU, facing, phi);
  const bb = bboxOf(j, RIVAL, 24);
  const fw = Math.max(1, Math.ceil((bb.x1 - bb.x0) * ds)), fh = Math.max(1, Math.ceil((bb.y1 - bb.y0) * ds));
  const full = g.createCanvas(fw, fh), fx = full.getContext('2d');
  fx.setTransform(ds, 0, 0, ds, -bb.x0 * ds, -bb.y0 * ds);
  drawPuppet(fx, RIVAL, pose, { x: 0, ground: 0, scale, facing, view: 'side', devScale: ds });
  fx.save();
  fx.globalCompositeOperation = 'destination-over';             // the glass aura, behind him
  drawPuppet(fx, RIVAL, pose, { x: 0, ground: 0, scale, facing, view: 'side', devScale: ds, outline: g.color.css(pal.cyan, 0.2), outlineW: 7 });
  fx.globalCompositeOperation = 'source-atop';
  drawCracks(g, fx, net, xf, O, refU, 2, 0, 0, pal);
  fx.restore();
  // the skeleton in local crack coordinates, to find the cells that hold part of him
  const c = Math.cos(-phi), sn = Math.sin(-phi);
  const inv = (p) => { const dx = (p[0] - O[0]) / refU, dy = (p[1] - O[1]) / refU; return [facing * (dx * c - dy * sn), dx * sn + dy * c]; };
  const sk = {};
  for (const k of JOINTS) sk[k] = inv(j[k]);
  const centre = [(j.pelvis[0] + j.neck[0]) / 2, (j.pelvis[1] + j.neck[1]) / 2];
  const feetY = (j.toeL[1] + j.toeR[1]) / 2;
  const list = [];
  for (const cell of coveredCells(net, sk, RIVAL)) {
    const pts = cell.poly.map(xf);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
    const w = Math.max(1, Math.ceil((x1 - x0) * ds)), h = Math.max(1, Math.ceil((y1 - y0) * ds));
    const cv = g.createCanvas(w, h), cx = cv.getContext('2d');
    cx.setTransform(ds, 0, 0, ds, -x0 * ds, -y0 * ds);
    cx.beginPath();
    pts.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y)));
    cx.closePath();
    cx.clip();
    cx.drawImage(full, bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    const wv = g.createCanvas(w, h), wx = wv.getContext('2d');
    wx.drawImage(cv, 0, 0);
    wx.globalCompositeOperation = 'source-in';
    wx.fillStyle = pal.glass;
    wx.fillRect(0, 0, w, h);
    const ccx = pts.reduce((a, p) => a + p[0], 0) / pts.length, ccy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const i = cell.idx;
    const r1 = hashU(seed, i, 501), r2 = hashU(seed, i, 502), r3 = hashU(seed, i, 503), r4 = hashU(seed, i, 504), r5 = hashU(seed, i, 505), r6 = hashU(seed, i, 506);
    const dir = norm([(ccx - centre[0]) * 1.8 + (r1 - 0.5) * refU * 0.5, (ccy - centre[1]) * 0.8 + (r2 - 0.5) * refU * 0.3]);
    list.push({ c: cv, white: wv, x0: (x0 - O[0]) / refU, y0: (y0 - O[1]) / refU, w: (x1 - x0) / refU, h: (y1 - y0) / refU,
      cx: (ccx - O[0]) / refU, cy: (ccy - O[1]) / refU, delay: 0.08 * Math.hypot(ccx - O[0], ccy - O[1]) / refU,
      dir, v: 0.55 + 1.1 * r3, spin: (r4 - 0.5) * 11, flip: 2.5 + 7 * r5, ph: r1 * TAU, life: 0.8 + 0.75 * r2,
      zv: r6 > 0.72 ? 0.6 + 1.6 * (r6 - 0.72) / 0.28 : 0, floor: (feetY - O[1]) / refU + 0.01 + 0.06 * r4 });
  }
  kit = { list, eye: [(headPoint(j, RIVAL, 0.45, -0.06)[0] - O[0]) / refU, (headPoint(j, RIVAL, 0.45, -0.06)[1] - O[1]) / refU] };
  if (kitCache.size > 4) kitCache.delete(kitCache.keys().next().value);
  kitCache.set(key, kit);
  return kit;
}

/** Crack radius (body heights) over time: a star in the silence, a jump on the slam, a step per hit. */
function crackRadius(tt, T, F) {
  if (tt < T.headT) return 0;
  let r = 0.36 * outExpo((tt - T.headT) / 0.4) + 0.06 * (tt - T.headT);
  if (tt >= T.slamT) r += 0.4 * outExpo((tt - T.slamT) / 0.16);
  for (const h of F.between('hit', T.slamT + 0.05, Math.min(tt, T.deadT) + 1e-6)) r += 0.05 * h[1] * outExpo((tt - land(h[0], T.fps)) / 0.1);
  if (tt > T.deadT - 0.12) r += 0.6 * smooth((tt - (T.deadT - 0.12)) / 0.12);
  return Math.min(1.35, r);
}

// ---------------------------------------------------------------------------------------------
// Poses over time
// ---------------------------------------------------------------------------------------------

function kaiserPose(tt, ks, T, F) {
  if (ks.mode === 'circle') {
    const dist = 2.0 * Math.abs(T.om) * (tt - T.t0);
    const w = cycles.walk(dist / 1.25, 0.42);
    let p = { ...w, sR: KP.smug.sR, eR: KP.smug.eR, sL: w.sL * 0.6 - 0.1, head: -0.16 + 0.06 * F.col('kick', tt), lean: -0.03 };
    const bk = env(tt, T.heavenT, T.visionT - 0.35, 0.22, 0.4);
    if (bk > 0) p = blend(p, KP.bask, bk);
    return p;
  }
  if (ks.mode === 'walk') {
    const u = clamp((tt - T.tw0) / 0.3);
    const w = cycles.walk(ks.d / 1.3 + 0.25, 0.85 * u);
    return blend(KP.smug, { ...w, head: -0.1, lean: 0.02 }, u);
  }
  if (ks.mode === 'step') return poseOf(COPY_POSES, ks.m);
  if (ks.mode === 'temple') {
    const u = smooth((tt - (T.headT - 0.18)) / 0.18);
    const p = blend(KP.smug, KP.temple, u);
    return { ...p, head: p.head - 0.08 * smooth((tt - T.headT) / 0.2) };
  }
  if (ks.mode === 'away') {
    const sp = clamp(1.2 - (tt - (T.deadT + 0.55)) / 0.8);
    const w = cycles.walk(ks.d / 1.3, 0.7 * sp);
    const p = blend(KP.smug, { ...w, sR: w.sR * 0.5, head: -0.12, lean: -0.02 }, sp);
    return { ...p, head: p.head - 0.12 * smooth((tt - T.lookT) / 0.3) };
  }
  return KP.front;
}

function rivalPose(tt, T, F) {
  if (tt < T.visionT) {
    const dist = 2.0 * Math.abs(T.om) * (tt - T.t0);
    const w = cycles.walk(dist / 1.25 + 0.5, 0.4);
    return blend(RP.ready, { ...w, sL: RP.ready.sL, sR: RP.ready.sR, eL: RP.ready.eL, eR: RP.ready.eR, lean: 0.24, head: -0.1 }, 0.55);
  }
  if (tt < T.crowdT) return blend(RP.ready, RP.vision, smooth((tt - T.visionT) / 0.25));
  if (tt < T.headT) {
    const p = blend(RP.vision, RP.crowded, smooth((tt - T.crowdT) / 0.5));
    const jolt = F.impulse('hit', 0.08, 1, tt);
    return { ...p, head: p.head - 0.15 * jolt, lean: p.lean + 0.05 * jolt };
  }
  const p = blend(RP.crowded, RP.clutch, smooth((Math.min(tt, T.deadT) - T.headT) / 0.14));
  const tr = F.impulse('hit', 0.07, 1, Math.min(tt, T.deadT)) * smooth((tt - T.slamT) / 0.05);
  const n = Math.sin(Math.min(tt, T.deadT) * 91) * tr;
  return { ...p, head: p.head + 0.06 * n, lean: p.lean - 0.04 * n };
}

// ---------------------------------------------------------------------------------------------
// The board and the void
// ---------------------------------------------------------------------------------------------

function clipLine(cam, P0, D, zMin, zMax, k) {
  const [x0, z0] = toCam(cam, P0[0], P0[1]);
  const dx = D[0] * cam.cs - D[1] * cam.sn, dz = D[0] * cam.sn + D[1] * cam.cs;
  let lo = -1e9, hi = 1e9;
  for (const [a, b] of [[z0 - zMin, dz], [zMax - z0, -dz], [k * z0 - x0, k * dz - dx], [k * z0 + x0, k * dz + dx]]) {
    if (Math.abs(b) < 1e-12) { if (a < 0) return null; continue; }
    const r = -a / b;
    if (b > 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
  }
  return lo < hi ? [lo, hi] : null;
}

const BANDS = [[0, 9, 0.95], [9, 15, 0.75], [15, 24, 0.5], [24, 60, 0.28]];   // depth bands (m) and their alpha

/**
 * The chessboard: solid squares in depth bands (solid fills are far cheaper than gradients here),
 * the beat-lit squares, perspective grid ribbons, then one fog band at the horizon over everything.
 */
function drawBoard(g, t, F, T, cam, pal, lit, dim) {
  const { ctx, color } = g;
  const css = color.css;
  const q = T.q, hy = cam.hy, f = cam.f, h = cam.h;
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, hy, W, H - hy);
  // the lattice of the visible ground
  const zVis = (h * f) / Math.max(40, H + 40 - hy);
  const zFar = 48, k = (W / 2 + 140) / f;
  const corners = [[-k * zVis, zVis], [k * zVis, zVis], [k * zFar, zFar], [-k * zFar, zFar]].map(([xc, zc]) => camToWorld(cam, xc, zc));
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const [X, Z] of corners) { i0 = Math.min(i0, Math.floor(X / q)); i1 = Math.max(i1, Math.floor(X / q)); j0 = Math.min(j0, Math.floor(Z / q)); j1 = Math.max(j1, Math.floor(Z / q)); }
  const ni = i1 - i0 + 2, nj = j1 - j0 + 2;
  const LX = new Float64Array(ni * nj), LY = new Float64Array(ni * nj), LZ = new Float64Array(ni * nj);
  for (let a = 0; a < ni; a++) {
    for (let b = 0; b < nj; b++) {
      const id = a * nj + b;
      const [xc, zc] = toCam(cam, (i0 + a) * q, (j0 + b) * q);
      LZ[id] = zc;
      if (zc > 0.05) { const s = f / zc; LX[id] = W / 2 + xc * s; LY[id] = hy + h * s; }
    }
  }
  const quad = (a, b) => {
    const p = [a * nj + b, (a + 1) * nj + b, (a + 1) * nj + b + 1, a * nj + b + 1];
    let zmin = Infinity, xmin = Infinity, xmax = -Infinity, ymin = Infinity, zs = 0;
    for (const id of p) { zmin = Math.min(zmin, LZ[id]); xmin = Math.min(xmin, LX[id]); xmax = Math.max(xmax, LX[id]); ymin = Math.min(ymin, LY[id]); zs += LZ[id]; }
    if (zmin < 0.35 || zmin > zFar || xmax < -20 || xmin > W + 20 || ymin > H + 20) return null;
    p.z = zs / 4;
    return p;
  };
  const path = (p) => { ctx.moveTo(LX[p[0]], LY[p[0]]); ctx.lineTo(LX[p[1]], LY[p[1]]); ctx.lineTo(LX[p[2]], LY[p[2]]); ctx.lineTo(LX[p[3]], LY[p[3]]); ctx.closePath(); };
  // the light squares, one solid fill per depth band
  const bandOf = (z) => { for (let b = 0; b < BANDS.length; b++) if (z < BANDS[b][1]) return b; return BANDS.length - 1; };
  const byBand = BANDS.map(() => []);
  for (let a = 0; a < ni - 1; a++) {
    for (let b = 0; b < nj - 1; b++) {
      if ((i0 + a + j0 + b) & 1) continue;
      const p = quad(a, b);
      if (p) byBand[bandOf(p.z)].push(p);
    }
  }
  byBand.forEach((list, b) => {
    if (!list.length) return;
    ctx.beginPath();
    for (const p of list) path(p);
    ctx.fillStyle = css(pal.square, BANDS[b][2] * 0.62 * (1 - 0.5 * dim));
    ctx.fill();
  });
  // squares lit on the beat (and by the vision, the shockwave)
  for (const L of lit) {
    if (L.a <= 0.01) continue;
    const a = Math.floor(L.pos[0] / q) - i0, b = Math.floor(L.pos[1] / q) - j0;
    if (a < 0 || b < 0 || a >= ni - 1 || b >= nj - 1) continue;
    const p = quad(a, b);
    if (!p) continue;
    ctx.beginPath();
    path(p);
    ctx.fillStyle = css(L.color, Math.min(1, 0.7 * L.a));
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = css(L.edge || L.color, Math.min(1, L.a));
    ctx.stroke();
    ctx.restore();
  }
  // glowing grid lines: perspective ribbons (wider near), brighter on the kick, dimmer in the breaks
  const kick = F.c.kick || 0;
  const drums = clamp((F.c.drums_lvl || 0) * 2.2);
  const lineA = (0.42 + 0.3 * kick) * (0.55 + 0.45 * drums) * (1 - 0.8 * dim);
  if (lineA > 0.01) {
    const zMin = zVis * 0.8;
    const ribbon = (P0, D, wm) => {
      const r = clipLine(cam, P0, D, zMin, zFar, k);
      if (!r) return;
      const N = [-D[1] * wm, D[0] * wm];
      const A = add(P0, mul(D, r[0])), B = add(P0, mul(D, r[1]));
      const pa = proj(g, cam, A[0] + N[0], 0, A[1] + N[1]), pb = proj(g, cam, B[0] + N[0], 0, B[1] + N[1]);
      const pc = proj(g, cam, B[0] - N[0], 0, B[1] - N[1]), pd = proj(g, cam, A[0] - N[0], 0, A[1] - N[1]);
      if (!pa || !pb || !pc || !pd) return;
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.lineTo(pc.x, pc.y); ctx.lineTo(pd.x, pd.y); ctx.closePath();
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (let i = i0; i <= i1 + 1; i++) ribbon([i * q, 0], [0, 1], 0.011);
    for (let j = j0; j <= j1 + 1; j++) ribbon([0, j * q], [1, 0], 0.011);
    ctx.fillStyle = css(pal.line, lineA);
    ctx.fill();
    ctx.restore();
  }
  // fog: one band at the horizon, and the board darkening towards the camera
  const fy = Math.min(H - hy, (h * f) / 13);
  const fog = ctx.createLinearGradient(0, hy, 0, hy + fy);
  fog.addColorStop(0, css(pal.fog, 1));
  fog.addColorStop(0.35, css(pal.fog, 0.6));
  fog.addColorStop(1, css(pal.fog, 0));
  ctx.fillStyle = fog;
  ctx.fillRect(0, hy, W, fy);
  const by = H - 300;
  const dk = ctx.createLinearGradient(0, by, 0, H);
  dk.addColorStop(0, css(pal.void, 0));
  dk.addColorStop(1, css(pal.void, 0.55));
  ctx.fillStyle = dk;
  ctx.fillRect(0, by, W, 300);
}

/** The void above the board: a dithered sky, stars that turn with the camera, the horizon glows. */
function drawSky(g, t, F, cam, pal, dim, kx, rx, rivalA) {
  const { ctx } = g;
  const css = g.color.css;
  const hy = cam.hy;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-40, -40, W + 80, hy + 44);
  ctx.clip();
  g.world.sky(g, [[0, pal.skyTop], [0.18, pal.void], [0.36, pal.skyMid], [0.46, pal.skyLow], [0.6, pal.void], [1, pal.void]], { dither: 1.4 });
  ctx.restore();
  if (dim >= 0.999) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const hat = F.c.hat || 0;
  ctx.fillStyle = css(pal.glass, 0.55 * (1 - dim));
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const az = hashU(77, i, 1) * TAU, el = hashU(77, i, 2);
    const x = (((((az + cam.yaw) % TAU) + TAU) % TAU) / TAU) * 2400 - 240;
    if (x < -10 || x > W + 10) continue;
    const y = hy - 30 - el * el * (hy - 40);
    if (y < -5) continue;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (1.3 + 2 * hashU(77, i, 3)) + i)) + 0.6 * hat * hashU(77, i, 4);
    const s = (0.8 + 1.6 * hashU(77, i, 5)) * tw;
    ctx.rect(x - s / 2, y - s / 2, s, s);
  }
  ctx.fill();
  // the duel's colours on the horizon: crimson and gold behind Kaiser, cyan behind the rival
  const a = 1 - dim;
  if (kx !== null) {
    ctx.globalAlpha = 0.5 * a;
    ctx.drawImage(g.sprites.glow(pal.crimson), kx - 760, hy - 300, 1520, 560);
    ctx.globalAlpha = 0.26 * a;
    ctx.drawImage(g.sprites.glow(pal.gold), kx - 320, hy - 110, 640, 200);
  }
  if (rx !== null && rivalA > 0) {
    ctx.globalAlpha = 0.5 * a * rivalA;
    ctx.drawImage(g.sprites.glow(pal.cyan), rx - 700, hy - 280, 1400, 520);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = css(pal.cyanHi, 0.3 * a);
  ctx.fillRect(0, hy - 1, W, 2);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The vision: predictive lines across the board, erased where Kaiser walks through them
// ---------------------------------------------------------------------------------------------

function visionLines(M, T) {
  const K0 = M.kaiserCircle(T.visionT), R = M.RvEnd;
  const D = norm(sub(K0, R)), Nn = [-D[1], D[0]];
  const pt = (along, lat) => add(R, add(mul(D, along), mul(Nn, lat)));
  const span = Math.hypot(K0[0] - R[0], K0[1] - R[1]);
  const lines = [];
  [-1.75, -0.85, 0.08, 0.9, 1.8].forEach((L, i) => {
    const P0 = pt(0.45, L * 0.06), P3 = pt(span + 0.45 + 0.6 * hashU(5, i, 1), L);
    const P1 = pt(span * 0.35, L * 0.2 + (hashU(5, i, 2) - 0.5) * 1.3), P2 = pt(span * 0.75, L * 0.8 + (hashU(5, i, 3) - 0.5) * 0.9);
    const pts = [];
    for (let n = 0; n <= 40; n++) {
      const u = n / 40, a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, c = 3 * u * u * (1 - u), d = u ** 3;
      pts.push([a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]]);
    }
    lines.push({ pts, start: T.visionT + 0.04 + 0.06 * i, grow: 0.42, kind: 'fan', s: i });
  });
  [0.38, 0.58, 0.78].forEach((fr, i) => {                  // arc walls between him and Kaiser
    const r = span * fr, half = 0.6 - 0.08 * i, a0 = Math.atan2(D[1], D[0]);
    const pts = [];
    for (let n = 0; n <= 36; n++) { const a = a0 - half + (2 * half * n) / 36; pts.push([R[0] + Math.cos(a) * r, R[1] + Math.sin(a) * r]); }
    lines.push({ pts, start: T.visionT + 0.2 + 0.08 * i, grow: 0.3, kind: 'arc', s: 5 + i });
  });
  return lines;
}

/** The vision at t: its lines, how faded they are, and the test for where Kaiser has walked through. */
function visionState(t, T, M) {
  if (t < T.visionT || t > T.crowdT + 0.6) return null;
  const fade = 1 - smooth((t - (T.crowdT - 0.1)) / 0.55);
  if (fade <= 0) return null;
  const walked = M.walkD(Math.min(t, T.crowdT));
  const cut = (p) => {
    const v = sub(p, M.kw0), s = v[0] * M.dirW[0] + v[1] * M.dirW[1];
    const e = Math.abs(v[0] * M.dirW[1] - v[1] * M.dirW[0]);
    if (s < -0.3 || s > walked + 0.05 || e > 0.55) return false;
    const tp = T.tw0 + M.walkInv(Math.max(0, s));
    return e < 0.18 + 0.37 * outCubic((t - tp) / 0.3);
  };
  return { lines: visionLines(M, T), fade, cut };
}

/** The squares the predictive lines point at light up once a line arrives. */
function visionLit(t, V, pal, lit) {
  if (!V) return;
  for (const L of V.lines) {
    if (L.kind !== 'fan' || (t - L.start) / L.grow < 0.95) continue;
    const p = L.pts[L.pts.length - 1];
    if (!V.cut(p)) lit.push({ pos: p, color: pal.cyan, edge: pal.cyanHi, a: 0.6 * V.fade * (0.8 + 0.2 * Math.sin(t * 8 + L.s * 5)) });
  }
}

function drawVision(g, t, F, T, M, cam, pal, V, eye) {
  if (!V) return [];
  const { ctx } = g;
  const css = g.color.css;
  const { lines, fade, cut } = V;
  const bursts = [];
  const beatGlow = 0.75 + 0.25 * (F.c.kick || 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lines) {
    const u = (t - L.start) / L.grow;
    if (u <= 0) continue;
    const n = L.pts.length - 1, head = n * outCubic(u);
    const lo = L.kind === 'arc' ? Math.floor(n / 2 - head / 2) : 0, hiI = L.kind === 'arc' ? Math.ceil(n / 2 + head / 2) : Math.floor(head);
    const runs = [];
    let cur = [];
    for (let i = lo; i <= Math.min(n, hiI); i++) {
      const p = L.pts[i];
      if (cut(p)) {
        if (cur.length > 1) runs.push(cur);
        cur = [];
        if (!bursts.length || bursts[bursts.length - 1].line !== L) bursts.push({ p, line: L });
        continue;
      }
      if (L.kind === 'arc' && Math.floor(i / 2) % 2 === 1) { if (cur.length > 1) runs.push(cur); cur = [p]; continue; }
      cur.push(p);
    }
    if (cur.length > 1) runs.push(cur);
    for (const [wm, a, col] of [[0.09, 0.22, pal.cyan], [0.022, 1, pal.cyanHi]]) {
      ctx.beginPath();
      for (const run of runs) {
        const left = [], right = [];
        for (let i = 0; i < run.length; i++) {
          const p = run[i], q2 = run[Math.min(run.length - 1, i + 1)], q0 = run[Math.max(0, i - 1)];
          const dd = norm(sub(q2, q0)), nn = [-dd[1] * wm, dd[0] * wm];
          const pl = proj(g, cam, p[0] + nn[0], 0.004, p[1] + nn[1]), pr = proj(g, cam, p[0] - nn[0], 0.004, p[1] - nn[1]);
          if (pl && pr) { left.push(pl); right.push(pr); }
        }
        if (left.length < 2) continue;
        ctx.moveTo(left[0].x, left[0].y);
        for (const p of left) ctx.lineTo(p.x, p.y);
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
        ctx.closePath();
      }
      ctx.fillStyle = css(col, a * fade * beatGlow);
      ctx.fill();
    }
    if (L.kind === 'fan') {                               // the travelling head, and a beam from the eye
      const p = L.pts[Math.min(n, Math.floor(head))];
      const pp = cut(p) ? null : proj(g, cam, p[0], 0.01, p[1]);
      if (pp) {
        const r = 0.16 * pp.s * (u < 1 ? 1.4 : 0.85 + 0.2 * Math.sin(t * 9 + L.s * 7));
        ctx.globalAlpha = fade;
        ctx.drawImage(g.sprites.glow(pal.cyan, 1), pp.x - r * 1.6, pp.y - r * 0.7, r * 3.2, r * 1.4);
        if (eye && u < 1.4) {
          ctx.globalAlpha = fade * 0.55 * (1 - clamp(u / 1.4));
          ctx.strokeStyle = css(pal.cyanHi, 1);
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(eye[0], eye[1]); ctx.lineTo(pp.x, pp.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
  return bursts;
}

// ---------------------------------------------------------------------------------------------
// Light effects
// ---------------------------------------------------------------------------------------------

function groundGlow(g, cam, pos, radius, color, alpha) {
  if (alpha <= 0.003) return;
  const c = proj(g, cam, pos[0], 0, pos[1]);
  if (!c) return;
  const n = proj(g, cam, pos[0], 0, pos[1] - radius), fz = proj(g, cam, pos[0], 0, pos[1] + radius);
  const rx = radius * c.s, ry = Math.max(4, n && fz ? Math.abs(n.y - fz.y) / 2 : rx * 0.3);
  const ctx = g.ctx;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha);
  ctx.drawImage(g.sprites.glow(color), c.x - rx, c.y - ry, 2 * rx, 2 * ry);
  ctx.restore();
}

/** A ring of light expanding on the board around pos. */
function groundRing(g, cam, pos, r, width, color, alpha) {
  if (alpha <= 0.003 || r <= 0.01) return;
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  for (const [rr, dir] of [[r + width, 1], [Math.max(0.001, r - width), -1]]) {
    for (let i = 0; i <= 64; i++) {
      const a = ((dir > 0 ? i : 64 - i) / 64) * TAU;
      const p = proj(g, cam, pos[0] + Math.cos(a) * rr, 0.003, pos[1] + Math.sin(a) * rr);
      if (!p) continue;
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = g.color.css(color, Math.min(1, alpha));
  ctx.fill('evenodd');
  ctx.restore();
}

function drawEye(g, eye, r, pal, flare, alpha, trail) {
  if (alpha <= 0.003) return;
  const { ctx } = g;
  const css = g.color.css;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (trail && trail.length > 2) {                       // one smooth tapered ribbon of light through where it was
    const n = trail.length;
    const ribbon = (wMax) => {
      const L = [], R = [];
      for (let k = 0; k < n; k++) {
        const a = trail[Math.max(0, k - 1)], b = trail[Math.min(n - 1, k + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const w = wMax * (1 - k / (n - 1)) ** 1.3;
        L.push([trail[k][0] - (dy / l) * w, trail[k][1] + (dx / l) * w]);
        R.push([trail[k][0] + (dy / l) * w, trail[k][1] - (dx / l) * w]);
      }
      ctx.beginPath();
      ctx.moveTo(L[0][0], L[0][1]);
      for (let k = 1; k < n; k++) ctx.lineTo(L[k][0], L[k][1]);
      for (let k = n - 1; k >= 0; k--) ctx.lineTo(R[k][0], R[k][1]);
      ctx.closePath();
    };
    ribbon(r * 0.42);
    ctx.fillStyle = css(pal.cyan, alpha * 0.45);
    ctx.fill();
    ribbon(r * 0.14);
    ctx.fillStyle = css(pal.cyanHi, alpha * 0.85);
    ctx.fill();
  }
  const gr = r * 2.4 * (1 + 2.2 * flare);
  ctx.globalAlpha = alpha;
  ctx.drawImage(g.sprites.glow(pal.cyan), eye[0] - gr, eye[1] - gr, 2 * gr, 2 * gr);
  const sw = r * (6 + 18 * flare), sh = r * (0.4 + 0.35 * flare);       // anamorphic streak
  ctx.globalAlpha = alpha * (0.75 + 0.25 * flare);
  ctx.drawImage(g.sprites.glow(pal.rivalGlow, 1), eye[0] - sw, eye[1] - sh, 2 * sw, 2 * sh);
  if (flare > 0.02) {                                   // a four-point star on the flare
    ctx.globalAlpha = alpha * Math.min(1, flare);
    const vw = r * 0.3, vh = r * 8 * flare;
    ctx.drawImage(g.sprites.glow('#FFFFFF', 1), eye[0] - vw, eye[1] - vh, 2 * vw, 2 * vh);
    ctx.drawImage(g.sprites.glow(pal.cyanHi, 1), eye[0] - gr * 0.7, eye[1] - gr * 0.7, gr * 1.4, gr * 1.4);
  }
  ctx.globalAlpha = alpha;
  const cr = r * 0.2 * (1 + 0.6 * flare);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(eye[0], eye[1], cr * 1.25, cr * 0.8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Small closed-form sparks: bursts at known times and places. */
function drawSparks(g, t, list) {
  if (!list.length) return;
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of list) {
    const age = t - b.t;
    if (age < 0 || age > b.life) continue;
    ctx.fillStyle = g.color.css(b.color, 1);
    for (let i = 0; i < b.n; i++) {
      const r1 = hashU(b.seed, i, 1), r2 = hashU(b.seed, i, 2), r3 = hashU(b.seed, i, 3);
      const life = b.life * (0.5 + 0.5 * r3);
      if (age > life) continue;
      const a = b.dir === undefined ? r1 * TAU : b.dir + (r1 - 0.5) * b.spread;
      const v = b.v * (0.3 + 0.9 * r2), drag = 3.2;
      const dd = (v * (1 - Math.exp(-drag * age))) / drag;
      const x = b.x + b.rx * (hashU(b.seed, i, 4) - 0.5) + Math.cos(a) * dd;
      const y = b.y + b.ry * (hashU(b.seed, i, 5) - 0.5) + Math.sin(a) * dd + 0.5 * b.grav * age * age;
      const s = b.size * (0.5 + r3) * (1 - (0.5 * age) / life);
      ctx.globalAlpha = (1 - age / life) * (0.35 + 0.65 * Math.sin(t * 38 + i * 7) ** 2);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// draw
// ---------------------------------------------------------------------------------------------

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const css = g.color.css;
  const pal = palOf(g, S);
  const T = timeline(F, P, S);
  T.q = Math.max(0.6, num(P.square, defaults.square));
  T.om = num(P.orbit, defaults.orbit);
  const seed = Math.round(num(P.seed, defaults.seed));
  const M = makeModel(F, P, T);
  const cam = camAt(g, t, M, T);
  const kick = F.c.kick || 0, snare = F.c.snare || 0;
  const closeUp = t >= T.nameT;
  const dark = t >= T.lookT ? smooth((t - T.lookT) / 0.12) : 0;

  // ------------------------------------------------ camera shake on the slam and the shatter
  let shx = 0, shy = 0;
  {
    const a = 9 * Math.exp(-Math.max(0, t - T.deadT) / 0.13) * (t >= T.deadT ? 1 : 0) + 5 * Math.exp(-Math.max(0, t - T.slamT) / 0.11) * (t >= T.slamT ? 1 : 0);
    if (a > 0.2) { shx = a * Math.sin(t * 173.1); shy = a * Math.cos(t * 131.7); }
  }

  // ------------------------------------------------ who is where
  const ks = M.kaiser(t);
  const kpl = placeOf(g, cam, ks.pos, KZ_M, KAISER);
  const rvIn = t >= T.rivalT;
  const shattered = t >= T.deadT;
  const rtt = Math.min(t, T.deadT);                      // the rival freezes as he breaks
  let rpos = M.rival(rtt);
  if (t >= T.slamT && t < T.deadT) {                    // trembling on the hits
    const tr = 0.012 * (0.4 + F.impulse('hit', 0.08, 1));
    rpos = add(rpos, [tr * Math.sin(t * 97), tr * Math.cos(t * 83)]);
  }
  const rpl = placeOf(g, cam, rpos, RV_M, RIVAL);
  let kFacing = 1;
  if (ks.mode === 'away') kFacing = -1;
  else if (rpl && kpl) kFacing = rpl.x >= kpl.x ? 1 : -1;
  let rFacing = -1;
  if (rpl && kpl && t >= T.crowdT) rFacing = kpl.x >= rpl.x ? 1 : -1;
  if (t >= T.headT) {                                   // he stops turning once he cracks
    const kh = placeOf(g, cam, M.templePos, KZ_M, KAISER);
    rFacing = kh && rpl && kh.x >= rpl.x ? 1 : -1;
  }

  // ------------------------------------------------ squares that light up
  const lit = [];
  const bi = lastIdx(T.beats, t);
  if (bi >= 0 && !closeUp) {
    const bt = T.beats[bi], age = t - bt;
    const gate = clamp(F.col('drums_lvl', bt + 0.02) * 2.2) * (1 - smooth((t - T.lookT) / 0.2));
    const a = Math.exp(-age / 0.28) * gate;
    if (a > 0.01) {
      const toRival = rvIn && t < T.deadT && bi % 2 === 1;
      const who = toRival ? M.rival(Math.min(bt, T.deadT)) : M.kaiser(bt).pos;
      lit.push({ pos: who, color: toRival ? pal.cyan : pal.gold, edge: toRival ? pal.cyanHi : pal.goldHi, a });
    }
  }
  if (t >= T.heavenT && t < T.heavenT + 1.2) {          // the heavens light the squares around him
    const kp = M.kaiser(T.heavenT).pos, a = Math.exp(-(t - T.heavenT) / 0.45);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (di || dj) lit.push({ pos: [kp[0] + di * T.q, kp[1] + dj * T.q], color: pal.gold, edge: pal.goldHi, a: 0.55 * a });
  }
  if (t >= T.crowdT && t < T.tTemple + 0.4) {           // every flash step lights its square
    const m = lastIdx(M.steps, t);
    for (let k = Math.max(0, m - 1); k <= m; k++) {
      const a = Math.exp(-(t - M.steps[k]) / 0.3);
      if (a > 0.02) lit.push({ pos: M.stepPos(k), color: pal.royal, edge: pal.afterHi, a });
    }
  }
  if (shattered && t < T.deadT + 1.2) {                 // the shockwave lights the squares it crosses
    const age = t - T.deadT, rr = 7.5 * outCubic(age / 0.9);
    for (let di = -5; di <= 5; di++) {
      for (let dj = -5; dj <= 5; dj++) {
        const c = [M.RvEnd[0] + di * T.q, M.RvEnd[1] + dj * T.q];
        const d = Math.hypot(di * T.q, dj * T.q);
        const a = Math.exp(-((d - rr) ** 2) / 0.9) * (1 - age / 1.2);
        if (a > 0.03) lit.push({ pos: c, color: (Math.abs(di) + Math.abs(dj)) % 2 ? pal.cyan : pal.glass, edge: pal.cyanHi, a: a * 0.8 });
      }
    }
  }

  // ------------------------------------------------ the figures, rendered offscreen first
  let kFig = null;
  if (kpl) {
    const view = closeUp ? 'front' : 'side';
    const L = g.layer('kzr-k');
    const j = drawPuppet(L.ctx, KAISER, kaiserPose(t, ks, T, F), { x: kpl.x, ground: kpl.ground, scale: kpl.scale, facing: closeUp ? 1 : kFacing, view, devScale: g.scale });
    kFig = { L, j, bb: bboxOf(j, KAISER), pl: kpl };
  }
  // the rival (the frozen, fully cracked figure once he shatters: the shards are cut from it)
  let rFig = null, crack = null;
  if (rvIn && rpl && shattered && t < T.deadT + 2.5) {   // only his skeleton: the shards are cut from the shatter kit
    const j = solve(RIVAL, rivalPose(rtt, T, F), { x: rpl.x, ground: rpl.ground, scale: rpl.scale, facing: rFacing, view: 'side' });
    rFig = { j, bb: bboxOf(j, RIVAL, 6), pl: rpl };
    crack = { O: crackFrame(j).O, U: rpl.U, R: 2 };
  } else if (rvIn && rpl && !shattered) {
    const L = g.layer('kzr-r');
    const j = drawPuppet(L.ctx, RIVAL, rivalPose(rtt, T, F), { x: rpl.x, ground: rpl.ground, scale: rpl.scale, facing: rFacing, view: 'side', devScale: g.scale });
    rFig = { L, j, bb: bboxOf(j, RIVAL, 6), pl: rpl };
    const U = rpl.U;
    const ap = (t - T.rivalT) / 0.26;
    if (ap < 1) {                                       // materialising outward from the eye
      const eye = headPoint(j, RIVAL, 0.45, -0.06);
      const R = U * (0.1 + 1.25 * outCubic(ap)), edge = U * 0.08;
      const x = L.ctx, ds = g.scale;
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);                 // (destination-in with a gradient breaks under a scaled transform)
      x.globalCompositeOperation = 'destination-in';
      const gr = x.createRadialGradient(eye[0] * ds, eye[1] * ds, Math.max(0, R - edge) * ds, eye[0] * ds, eye[1] * ds, (R + 0.5) * ds);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.fillRect(rFig.bb.x0 * ds, rFig.bb.y0 * ds, (rFig.bb.x1 - rFig.bb.x0) * ds, (rFig.bb.y1 - rFig.bb.y0) * ds);
      x.setTransform(ds, 0, 0, ds, 0, 0);
      x.globalCompositeOperation = 'source-atop';
      x.strokeStyle = css(pal.cyanHi, 0.95);
      x.lineWidth = U * 0.035;
      x.beginPath(); x.arc(eye[0], eye[1], Math.max(1, R - edge * 0.6), 0, TAU); x.stroke();
      x.restore();
    }
    const cr = crackRadius(t, T, F);
    if (cr > 0) {                                       // glass: faceted panes, white fracture lines
      const { O, phi } = crackFrame(j);
      crack = { O, U, R: cr };
      const pulse = F.impulse('hit', 0.1, 1, rtt) * smooth((t - T.slamT) / 0.05);
      const hot = smooth((t - (T.deadT - 0.15)) / 0.15);
      const x = L.ctx;
      x.save();
      x.globalCompositeOperation = 'source-atop';
      drawCracks(g, x, crackNet(seed), crackXf(O, U, rFacing, phi), O, U, cr, pulse, hot, pal);
      x.restore();
    }
  }
  // PROF('figs')

  // ------------------------------------------------ background and board
  ctx.save();
  if (shx || shy) ctx.translate(shx, shy);
  const rivalA = rvIn && !shattered ? clamp((t - T.rivalT) / 0.25) : shattered ? 1 - smooth((t - T.deadT) / 0.6) : 0;
  drawSky(g, t, F, cam, pal, dark, kFig ? (kFig.bb.x0 + kFig.bb.x1) / 2 : null, rFig ? (rFig.bb.x0 + rFig.bb.x1) / 2 : null, rivalA);
  // PROF('sky')
  const V = visionState(t, T, M);
  visionLit(t, V, pal, lit);
  drawBoard(g, t, F, T, cam, pal, lit, Math.max(dark, closeUp ? 1 : 0));
  // PROF('board')
  const eyeNow = rFig ? headPoint(rFig.j, RIVAL, 0.45, -0.06) : null;
  const bursts = drawVision(g, t, F, T, M, cam, pal, V, eyeNow);
  // PROF('vision')

  // light pools and contact shadows under the figures
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (kFig && !closeUp) groundGlow(g, cam, ks.pos, 1.6, pal.royal, 0.45 * (1 - dark));
  if (rFig && !shattered) groundGlow(g, cam, rpos, 1.6, pal.cyan, 0.32 * rivalA);
  ctx.restore();
  if (kFig && !closeUp) groundGlow(g, cam, ks.pos, 0.5, '#000010', 0.75);
  if (rFig && !shattered) groundGlow(g, cam, rpos, 0.48, '#000010', 0.75 * rivalA);
  {
    const ringAt = (t0, pos, col, dur, rMax, a0) => { const u = (t - t0) / dur; if (u >= 0 && u < 1) groundRing(g, cam, pos, rMax * outCubic(u), 0.04 + 0.1 * u, col, a0 * (1 - u)); };
    ringAt(T.rivalT, M.rival(T.rivalT), pal.cyan, 0.7, 3.2, 0.9);
    ringAt(T.heavenT + 0.12, M.kaiser(T.heavenT).pos, pal.gold, 0.8, 3.0, 0.9);
    ringAt(T.slamT, M.RvEnd, pal.cyanHi, 0.5, 2.6, 0.8);
    ringAt(T.deadT, M.RvEnd, pal.glass, 0.9, 7.5, 1.0);
    ringAt(T.deadT + 0.08, M.RvEnd, pal.cyan, 1.1, 5.5, 0.7);
  }
  // PROF('rings')
  if (kFig && !closeUp && dark <= 0) reflectionOf(g, kFig.L.canvas, kFig.bb, kFig.pl.ground, 0.22, kFig.pl.U * 0.42);
  if (rFig && !shattered && rvIn) reflectionOf(g, rFig.L.canvas, rFig.bb, rFig.pl.ground, 0.2 * rivalA, rFig.pl.U * 0.4);
  // PROF('refl')

  /** The column of heavenly light falling on Kaiser: its body behind him, the falling light in front. */
  function heavenColumn(part) {
    const age = t - T.heavenT;
    const I = (0.55 + 0.45 * Math.exp(-age / 0.35)) * (1 - smooth((t - (T.visionT - 0.35)) / 0.7));
    if (I <= 0.01) return;
    const U = kFig.pl.U, cx = (kFig.j.pelvis[0] + kFig.j.neck[0]) / 2, feet = kFig.pl.ground;
    const fall = outCubic(age / 0.14);
    const yb = lerp(-60, feet + U * 0.04, fall);
    const hw = U * 0.62;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (part === 'back') {
      const gr = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
      gr.addColorStop(0, css(pal.gold, 0));
      gr.addColorStop(0.2, css(pal.gold, 0.1 * I));
      gr.addColorStop(0.42, css(pal.gold, 0.3 * I));
      gr.addColorStop(0.5, css(pal.goldHi, 0.55 * I));
      gr.addColorStop(0.58, css(pal.gold, 0.3 * I));
      gr.addColorStop(0.8, css(pal.gold, 0.1 * I));
      gr.addColorStop(1, css(pal.gold, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(cx - hw, -20, 2 * hw, yb + 20);
      for (let i = 0; i < 6; i++) {                        // brighter rays drifting inside
        const x = cx + (hashU(92, i, 1) - 0.5) * 1.3 * hw + Math.sin(t * 0.9 + i * 2.1) * hw * 0.08, w = 3 + 9 * hashU(92, i, 2);
        ctx.fillStyle = css(pal.goldHi, (0.05 + 0.1 * Math.abs(Math.sin(t * 2.3 + i * 1.7))) * I);
        ctx.fillRect(x - w / 2, -20, w, yb + 20);
      }
      ctx.globalAlpha = 0.55 * I;                           // the heavens opening above him
      ctx.drawImage(g.sprites.glow(pal.gold, 1), cx - hw * 1.6, -hw * 0.9, hw * 3.2, hw * 1.5);
      ctx.globalAlpha = 1;
      const imp = age >= 0.12 ? Math.exp(-(age - 0.12) / 0.25) : 0;
      groundGlow(g, cam, ks.pos, 1.2 + 1.3 * imp, pal.gold, 0.45 * I + 0.6 * imp);
    } else {
      ctx.fillStyle = css(pal.goldHi, 0.9 * I);              // light falling through the column
      for (let i = 0; i < 30; i++) {
        const x = cx + (hashU(91, i, 1) - 0.5) * 1.5 * hw;
        const y = ((hashU(91, i, 2) * 1300 + age * (300 + 500 * hashU(91, i, 3))) % 1300) - 100;
        if (y > yb) continue;
        const sz = 1.5 + 2.5 * hashU(91, i, 4);
        ctx.fillRect(x - sz / 2, y, sz, sz * 6);
      }
      ctx.fillStyle = css(pal.goldHi, 0.7 * I);              // and gold motes rising around him
      for (let i = 0; i < 18; i++) {
        const a2 = (age * (0.35 + 0.4 * hashU(94, i, 1)) + hashU(94, i, 2)) % 1;
        const x = cx + (hashU(94, i, 3) - 0.5) * 1.3 * hw + Math.sin(age * 3 + i) * 8;
        const y = feet - a2 * U * 1.1;
        const sz = (1.5 + 2.5 * hashU(94, i, 4)) * (1 - a2);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
      if (fall < 1) {                                        // the bright leading edge
        ctx.globalAlpha = 1 - fall * 0.5;
        ctx.drawImage(g.sprites.glow(pal.goldHi, 1), cx - hw * 1.4, yb - hw * 0.5, hw * 2.8, hw);
      }
    }
    ctx.restore();
  }
  if (kFig && t >= T.heavenT && t < T.visionT + 0.6) heavenColumn('back');

  // ------------------------------------------------ the figures, back to front
  const items = [];
  if (kFig && dark <= 0) items.push({ z: kFig.pl.z, draw: () => drawKaiser() });   // in the dark he goes on top
  if (rFig) items.push({ z: rFig.pl.z, draw: () => (shattered ? drawShards() : drawRival()) });
  // afterimages: fx.echo over the flash steps (k steps back = where he stood k steps ago), oldest first
  if (t >= T.crowdT && t < T.slamT + 0.3) {
    const mNow = ks.mode === 'step' ? ks.m : M.steps.length;
    const collapse = t >= T.slamT ? (t - T.slamT) / 0.22 : 0;
    echo(mNow, Math.min(num(P.copies, defaults.copies), mNow + 1), 1, (mk, a, k) => {
      if (k === 0) return;                              // k = 0 is where Kaiser is now
      const m = Math.round(mk);
      const pos = M.stepPos(m);
      const pl = placeOf(g, cam, pos, KZ_M, KAISER);
      if (pl) items.push({ z: pl.z, draw: () => drawGhost(pl, a, m, collapse) });
    }, { decay: 0.9 });
  }
  items.sort((a, b) => b.z - a.z);

  function drawKaiser() {
    const { L, bb, pl } = kFig;
    const U = pl.U;
    if ((ks.mode === 'step' || ks.mode === 'temple') && ks.dash < 1) {   // a streak of light along the dash
      echo(t, 4, 1 / 90, (tk, a, k) => {
        if (k === 0) return;
        const q = placeOf(g, cam, M.kaiser(tk).pos, KZ_M, KAISER);
        if (!q) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 * a;
        ctx.drawImage(g.sprites.glow(pal.after), q.x - q.U * 0.25, q.ground - q.U * 0.95, q.U * 0.5, q.U * 0.95);
        ctx.restore();
      }, { decay: 0.7 });
    }
    if (!closeUp) {                                     // a soft backlight
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.2 + 0.14 * kick) * (1 - 0.6 * dark);
      const gx = (bb.x0 + bb.x1) / 2, gy = pl.ground - U * 0.55;
      ctx.drawImage(g.sprites.glow(pal.royal), gx - U * 0.55, gy - U * 0.65, U * 1.1, U * 1.3);
      ctx.restore();
    }
    const dashA = ks.dash !== undefined && ks.dash < 1 ? 0.35 + 0.65 * ks.dash : 1;
    blit(g, ctx, L.canvas, bb, dashA);
    // rim light: cool blue, gold under the heavens, warm white in the spotlight
    const heaven = env(t, T.heavenT, T.visionT - 0.35, 0.05, 0.5);
    let rimCol = pal.rim, rimA = 0.85;
    if (heaven > 0.01) { rimCol = g.color.mix(pal.rim, pal.goldHi, heaven); rimA = 0.85 + 0.15 * heaven; }
    if (dark > 0) rimCol = g.color.mix(rimCol, '#FFF4DE', dark);
    if (closeUp) rimA = 0.55;
    const off = Math.max(2, Math.min(9, U * 0.011));
    const rim = rimOf(g, 'kzr-krim', L.canvas, bb, rimCol, closeUp ? 0 : -0.5 * off * kFacing, 0.85 * off);
    if (rim) blit(g, ctx, rim, bb, rimA * dashA, 'lighter');
    // PROF('kaiser')
  }

  function drawGhost(pl, a, m, collapse) {
    const rp = rFig ? rFig.pl : pl;
    const facing = rp.x >= pl.x ? 1 : -1;
    const s = ghostSprite(g, m, facing, pal);
    let x = pl.x, gy = pl.ground, U = pl.U;
    if (collapse > 0) {                                  // they pour into the rival's head
      if (collapse >= 1) return;
      const u = inQuad(collapse);
      const head = rFig ? headPoint(rFig.j, RIVAL, 0, 0) : [rp.x, rp.ground - rp.U * 0.9];
      x = lerp(pl.x, head[0], u);
      gy = lerp(pl.ground, head[1] + pl.U * 0.5 * (1 - u), u);
      U = pl.U * (1 - 0.85 * u);
    }
    const leftAt = m + 1 < M.steps.length ? M.steps[m + 1] : T.tTemple;
    const born = clamp((t - leftAt) / 0.06);
    const flick = 0.82 + 0.12 * Math.sin(t * 31 + m * 2.1) + 0.25 * snare;
    const al = clamp(a * flick * (0.5 + 0.5 * born)) * 0.85 * (collapse > 0 ? 1 - 0.4 * collapse : 1);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = al;
    ctx.drawImage(s.c, x + s.x0 * U, gy + s.y0 * U, s.w * U, s.h * U);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 * al;
    ctx.drawImage(g.sprites.glow(pal.royal), x - U * 0.35, gy - U * 0.95, U * 0.7, U * 0.95);
    ctx.restore();
    // PROF('ghost')
  }

  function drawRival() {
    const { L, bb, pl, j } = rFig;
    const U = pl.U;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.24 + 0.12 * snare) * rivalA;
    const gx = (bb.x0 + bb.x1) / 2, gy = pl.ground - U * 0.55;
    ctx.drawImage(g.sprites.glow(pal.cyan), gx - U * 0.5, gy - U * 0.62, U * 1.0, U * 1.24);
    ctx.restore();
    blit(g, ctx, L.canvas, bb, 1);
    // PROF('rv-blit')
    const off = Math.max(2, Math.min(9, U * 0.012));
    const rim = rimOf(g, 'kzr-rrim', L.canvas, bb, pal.cyan, -rFacing * off * 0.8, off * 0.5);
    if (rim) blit(g, ctx, rim, bb, 0.95, 'lighter');
    const rim2 = rimOf(g, 'kzr-rrim', L.canvas, bb, pal.royal, rFacing * off, -off * 0.2);
    if (rim2) blit(g, ctx, rim2, bb, 0.7, 'lighter');
    // PROF('rv-rims')
    const hot = smooth((t - (T.deadT - 0.12)) / 0.12);  // white-hot just before he breaks
    if (hot > 0) {
      const w = silOf(g, 'kzr-rwhite', L.canvas, bb, pal.glass);
      if (w) blit(g, ctx, w, bb, 0.85 * hot);
    }
    // PROF('rv-hot')
    drawRivalEye(j, U);
    // PROF('rv-eye')
  }

  function rivalEyeAt(tt) {
    const pl = placeOf(g, cam, M.rival(Math.min(tt, T.deadT)), RV_M, RIVAL);
    if (!pl) return null;
    let f = -1;
    if (tt >= T.crowdT && tt < T.headT) {
      const kp = placeOf(g, cam, M.kaiser(tt).pos, KZ_M, KAISER);
      f = kp && kp.x >= pl.x ? 1 : -1;
    } else if (tt >= T.headT) f = rFacing;
    const j = solve(RIVAL, rivalPose(Math.min(tt, T.deadT), T, F), { x: pl.x, ground: pl.ground, scale: pl.scale, facing: f, view: 'side' });
    return headPoint(j, RIVAL, 0.45, -0.06);
  }

  function drawRivalEye(j, U) {
    const eye = headPoint(j, RIVAL, 0.45, -0.06);
    const r = RIVAL.headR * U;
    const fv = after(t, T.visionT), fa = after(t, T.rivalT);
    const flare = (fv >= 0 ? Math.exp(-fv / 0.22) : 0) + (fa >= 0 ? 0.9 * Math.exp(-fa / 0.18) : 0);
    const trail = [eye];
    const back = [-rFacing, -0.1];
    for (let k = 1; k <= 10; k++) {                     // where the eye was, streaming back off his head
      if (t - k * 0.034 < T.rivalT) break;
      const p = rivalEyeAt(t - k * 0.034) || eye;
      const wob = Math.sin(t * 5 - k * 0.55) * r * 0.035 * k;
      trail.push([p[0] + back[0] * r * 0.36 * k, p[1] + back[1] * r * 0.36 * k + wob]);
    }
    const cracked = t >= T.headT ? 0.65 + 0.35 * Math.sin(t * 50) ** 2 : 1;
    drawEye(g, eye, r, pal, flare, Math.max(rivalA, fa >= 0 ? 1 : 0) * cracked * (0.9 + 0.1 * snare), trail);
  }

  function drawShards() {
    const { j, pl } = rFig;
    const U = pl.U;
    const { O } = crackFrame(j);
    const kit = shatterKit(g, rivalPose(T.deadT, T, F), rFacing, pal, seed);
    const gAcc = 2.5;
    for (const sh of kit.list) {
      const tau = t - (T.deadT + sh.delay);
      let dx = 0, dy = 0, rot = 0, flip = 1, al = 1, glint, zs = 1;
      if (tau > 0) {
        const kd = 2.4, dd = (sh.v * (1 - Math.exp(-kd * tau))) / kd;
        zs = 1 + sh.zv * dd;                             // some fly at the camera
        dx = sh.dir[0] * dd * (1 + 0.6 * sh.zv);
        dy = sh.dir[1] * dd - 0.14 * (1 - Math.exp(-3 * tau)) + 0.5 * gAcc * Math.max(0, tau - 0.16) ** 2;
        const landed = sh.zv === 0 && sh.cy + dy > sh.floor;
        if (landed) dy = sh.floor - sh.cy;
        rot = (sh.spin * (1 - Math.exp(-1.6 * tau))) / 1.6;
        const ph = sh.ph + sh.flip * tau * (landed ? 0.25 : 1);
        flip = Math.cos(ph);
        if (Math.abs(flip) < 0.16) flip = 0.16 * (flip < 0 ? -1 : 1);
        glint = Math.max(0, 1 - Math.abs(Math.cos(ph)) * 3.2) + Math.exp(-tau / 0.05);
        al = (1 - smooth((tau - sh.life) / 0.45)) * (sh.zv ? 1 - smooth((zs - 1.6) / 0.8) : 1);
      } else glint = 0.9;
      if (al <= 0.01) continue;
      const cx0 = O[0] + sh.cx * U, cy0 = O[1] + sh.cy * U;
      ctx.save();
      ctx.translate(cx0 + dx * U, cy0 + dy * U);
      ctx.rotate(rot);
      ctx.scale(flip * zs, zs);
      ctx.translate(-cx0, -cy0);
      const x = O[0] + sh.x0 * U, y = O[1] + sh.y0 * U, w = sh.w * U, h = sh.h * U;
      ctx.globalAlpha = al;
      ctx.drawImage(sh.c, x, y, w, h);
      if (glint > 0.02) {
        ctx.globalAlpha = al * Math.min(1, glint);
        ctx.drawImage(sh.white, x, y, w, h);
      }
      ctx.restore();
    }
    // PROF('shards')
    const age = t - T.deadT;                            // the eye's light rides its shard up and dies
    if (age < 0.7) {
      const eye = [O[0] + kit.eye[0] * U, O[1] + kit.eye[1] * U];
      const e2 = [eye[0] + rFacing * age * U * 0.25, eye[1] - U * 0.35 * outCubic(age / 0.7)];
      drawEye(g, e2, RIVAL.headR * U, pal, 0.8 * Math.exp(-age / 0.1), (1 - age / 0.7) ** 1.5, null);
    }
  }

  for (const it of items) it.draw();
  // PROF('items')

  // ------------------------------------------------ light, particles, manga effects
  if (kFig && t >= T.heavenT && t < T.visionT + 0.6) heavenColumn('front');
  // PROF('heaven')

  if (dark > 0 && kFig) {                                // dark everywhere but one spotlight on Kaiser
    const U = kFig.pl.U, cx = (kFig.bb.x0 + kFig.bb.x1) / 2, cy = kFig.pl.ground - U * 0.5;
    const feet = kFig.pl.ground;
    const r0 = closeUp ? U * 0.42 : U * 0.36, r1 = closeUp ? U * 0.95 : U * 1.25;
    const rad = ctx.createRadialGradient(cx, closeUp ? kFig.j.neck[1] : cy, r0, cx, closeUp ? kFig.j.neck[1] : cy, r1);
    rad.addColorStop(0, css(pal.void, closeUp ? 0.25 * dark : 0));
    rad.addColorStop(0.5, css(pal.void, 0.75 * dark));
    rad.addColorStop(1, css(pal.void, 0.96 * dark));
    ctx.fillStyle = rad;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const topW = U * 0.14, botW = U * 0.6;
    const beam = ctx.createLinearGradient(cx - botW, 0, cx + botW, 0);
    beam.addColorStop(0, css('#FFF4DE', 0));
    beam.addColorStop(0.5, css('#FFF4DE', (closeUp ? 0.07 : 0.13) * dark));
    beam.addColorStop(1, css('#FFF4DE', 0));
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(cx - topW, -20); ctx.lineTo(cx + topW, -20); ctx.lineTo(cx + botW, feet + U * 0.05); ctx.lineTo(cx - botW, feet + U * 0.05);
    ctx.closePath();
    ctx.fill();
    if (!closeUp) groundGlow(g, cam, ks.pos, 1.0, '#FFF4DE', 0.6 * dark);
    ctx.restore();
    if (!closeUp) reflectionOf(g, kFig.L.canvas, kFig.bb, feet, 0.3 * dark, U * 0.42);
    drawKaiser();
    ctx.save();                                          // dust in the beam
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = css('#FFF4DE', 0.8 * dark);
    for (let i = 0; i < 44; i++) {
      const y = ((hashU(93, i, 2) * (feet + 40) + t * (14 + 22 * hashU(93, i, 3))) % (feet + 40)) - 20;
      const w = lerp(topW, botW, clamp(y / feet));
      const x = cx + (hashU(93, i, 1) - 0.5) * 1.7 * w + 6 * Math.sin(t * 1.3 + i);
      const s = 1 + 2.2 * hashU(93, i, 4);
      ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t * 2 + i));
      ctx.fillRect(x, y, s, s);
    }
    ctx.restore();
  }
  // PROF('dark')

  if (closeUp && kFig) {                                // the rose on his neck glows as he looks at us
    const j = kFig.j, r = KAISER.headR * j.U;
    const rose = headPoint(j, KAISER, 0.4, 1.42);
    const u = t - T.nameT;
    const glow = smooth(u / 0.2) * (0.85 + 0.15 * Math.sin(u * 9));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gr = r * (1.2 + 0.5 * glow);
    ctx.globalAlpha = 0.9 * glow;
    ctx.drawImage(g.sprites.glow(KZ.rose, 1), rose[0] - gr, rose[1] - gr, 2 * gr, 2 * gr);
    ctx.globalAlpha = 0.45 * glow;
    ctx.drawImage(g.sprites.glow(KZ.roseHi), rose[0] - gr * 2.2, rose[1] - gr * 2.2, gr * 4.4, gr * 4.4);
    ctx.restore();
    drawRose(ctx, rose[0], rose[1], 0.24 * r, { rot: 0.4, color: KZ.roseHi, deep: KZ.rose, hi: '#FFFFFF', alpha: 0.8 * glow });
    ctx.save();                                          // a few blue petals drift up out of the light
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      const age = u - hashU(95, i, 1) * 0.4;
      if (age < 0) continue;
      const px = rose[0] + (hashU(95, i, 2) - 0.5) * r * 1.4 + Math.sin(age * 2.5 + i) * r * 0.35 + age * r * (hashU(95, i, 3) - 0.3) * 2.4;
      const py = rose[1] - age * r * (1.0 + 1.6 * hashU(95, i, 4));
      const a = clamp(1 - age / 1.1) * glow;
      ctx.fillStyle = css(i % 2 ? KZ.roseHi : KZ.rose, 0.85 * a);
      ctx.beginPath();
      ctx.ellipse(px, py, r * 0.12, r * 0.065, age * 3 + i, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  // PROF('rose')

  {                                                      // sparks
    const list = [];
    bursts.forEach((b, i) => {
      const s = sub(b.p, M.kw0), d = s[0] * M.dirW[0] + s[1] * M.dirW[1];
      const pp = proj(g, cam, b.p[0], 0.02, b.p[1]);
      if (pp) list.push({ t: T.tw0 + M.walkInv(Math.max(0, d)), x: pp.x, y: pp.y, rx: 0, ry: 0, n: 16, v: pp.s * 1.4, life: 0.45, grav: pp.s * 1.5, size: 3, color: pal.cyanHi, seed: 300 + i, dir: -Math.PI / 2, spread: 2.6 });
    });
    if (rFig && crack) {
      const O = crack.O, U = rFig.pl.U;
      if (shattered) {
        list.push({ t: T.deadT, x: O[0], y: O[1] + U * 0.35, rx: U * 0.3, ry: U * 0.7, n: 170, v: U * 1.5, life: 1.5, grav: U * 0.8, size: 3.4, color: pal.glass, seed: 401 });
        list.push({ t: T.deadT, x: O[0], y: O[1] + U * 0.2, rx: U * 0.2, ry: U * 0.4, n: 80, v: U * 2.3, life: 0.9, grav: U * 0.5, size: 2.4, color: pal.cyan, seed: 402 });
      } else {
        list.push({ t: T.headT, x: O[0], y: O[1], rx: 0, ry: 0, n: 24, v: U * 0.7, life: 0.5, grav: U * 0.6, size: 2.4, color: pal.glass, seed: 404 });
        list.push({ t: T.slamT, x: O[0], y: O[1], rx: 0, ry: 0, n: 44, v: U * 1.2, life: 0.6, grav: U * 0.8, size: 2.6, color: pal.cyanHi, seed: 403 });
      }
    }
    drawSparks(g, t, list);
  }
  // PROF('sparks')

  {                                                      // manga impact lines on the big moments
    const burst = (t0, cx, cy, col, a0, tau, inner, n, seedL) => {
      if (t < t0) return;
      const a = a0 * Math.exp(-(t - t0) / tau);
      if (a < 0.03) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      speedLines(ctx, { cx, cy, n, inner, outer: 1500, color: col, alpha: a, seed: seedL, frame: F.frame, hold: 2, width: 0.0045 });
      ctx.restore();
    };
    if (rFig) {
      const hp = headPoint(rFig.j, RIVAL, 0.3, 0);
      burst(T.rivalT, hp[0], hp[1], pal.cyanHi, 0.5, 0.12, rFig.pl.U * 0.55, 70, 11);
      burst(T.visionT, hp[0], hp[1], pal.cyanHi, 0.55, 0.16, rFig.pl.U * 0.5, 90, 12);
      burst(T.slamT, hp[0], hp[1], pal.glass, 0.55, 0.12, rFig.pl.U * 0.6, 100, 13);
      burst(T.deadT, hp[0], hp[1] + rFig.pl.U * 0.3, '#FFFFFF', 0.85, 0.18, rFig.pl.U * 0.75, 130, 14);
    }
    if (kFig && t >= T.heavenT) burst(T.heavenT + 0.12, (kFig.bb.x0 + kFig.bb.x1) / 2, kFig.pl.ground - kFig.pl.U * 0.5, pal.goldHi, 0.4, 0.14, kFig.pl.U * 0.7, 70, 16);
    if (closeUp) {                                       // focus lines framing his face
      const hp = kFig ? kFig.j.headC : [W / 2, H / 2];
      speedLines(ctx, { cx: hp[0], cy: hp[1], n: 110, inner: 560, outer: 1500, color: pal.royal, alpha: 0.3 * smooth((t - T.nameT) / 0.1), seed: 15, frame: F.frame, hold: 3, width: 0.005 });
    }
  }
  // PROF('speed')

  {                                                      // flashes: heaven (gold), slam, shatter (white), the name (blue)
    let fl = 0, col = pal.glass;
    const fd = after(t, T.deadT), fs = after(t, T.slamT), fh = after(t, T.heavenT + 0.12), fn = after(t, T.nameT);
    if (fd >= 0) fl = 0.45 * Math.exp(-fd / 0.07);
    if (fs >= 0 && t < T.deadT) fl = Math.max(fl, 0.32 * Math.exp(-fs / 0.06));
    if (fh >= 0 && fh < 0.5) { const v = 0.32 * Math.exp(-fh / 0.08); if (v > fl) { fl = v; col = pal.goldHi; } }
    if (fn >= 0 && fn < 0.4) { const v = 0.18 * Math.exp(-fn / 0.06); if (v > fl) { fl = v; col = KZ.roseHi; } }
    if (fl > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = css(col, fl);
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.restore();
    }
  }
  // PROF('flash')

  {                                                      // drifting motes (depth) and soft foreground bokeh
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hat = F.c.hat || 0;
    for (let i = 0; i < 46; i++) {
      const par = 0.4 + 1.2 * hashU(97, i, 1);
      const x = ((((hashU(97, i, 2) * 2600 + cam.yaw * 900 * par) % 2600) + 2600) % 2600) - 340;
      const y = ((((hashU(97, i, 3) * 1300 - t * (12 + 30 * par)) % 1300) + 1300) % 1300) - 110;
      const a = (0.15 + 0.25 * hashU(97, i, 4) + 0.35 * hat * hashU(97, i, 5)) * (1 - 0.7 * dark);
      const s = 1.2 + 2.6 * par;
      ctx.fillStyle = css(i % 3 ? pal.rim : pal.cyan, a);
      ctx.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 5; i++) {
      const x = ((((hashU(98, i, 1) * 2800 + cam.yaw * 2200) % 2800) + 2800) % 2800) - 440;
      const y = 120 + hashU(98, i, 2) * 840 + 30 * Math.sin(t * 0.6 + i);
      const r = 60 + 90 * hashU(98, i, 3);
      ctx.globalAlpha = (0.06 + 0.05 * kick) * (1 - dark);
      ctx.drawImage(g.sprites.bokeh(i % 2 ? pal.royal : pal.cyan), x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }
  ctx.restore();
}
