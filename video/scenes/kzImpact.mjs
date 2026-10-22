// A2 THE FIRST KAISER IMPACT: the volley that freezes time and blows the net into rose petals.
//
// Same night stadium as the field (lib/kzstadium.mjs). FREEZE (entry start to P.strikeT): the drums
// drop out and time almost stops: the stadium drains to a blue monochrome (palette freeze), still speed
// lines hang in the air, dust motes float; Kaiser (KAISER) rises into the air with the ball floating up
// in front of him and coils into a scissor volley; on P.powerT and P.nameT blue energy rings converge on
// the ball. STRIKE (P.strikeT, four frames): stark black-and-white impact frames (the engine inverts
// three of them): a shockwave ring, dense radial lines, cracks in the air. COMET (to P.goalT): the ball
// flies at the goal as a blue-white comet, the camera chasing it, ripples rolling across the pitch.
// GOAL (P.goalT): it tears through the net, which bursts into hundreds of blue rose petals, colour
// snaps back and the crowd erupts. WALK (from the first downbeat after the goal): Kaiser lands and walks
// towards the camera through the falling petals, the crowd hopping on every beat; on P.futureT,
// P.rulerT and P.kingT the petals swirl around him and flash gold; on P.kingT a crown appears above him.
//
// Pure: every moment comes from P (times), F (events and columns) and S; particles are closed-form.

import { KAISER, KZ, drawBall, drawCrown, drawRose, speedLines } from './lib/kaiser.mjs';
import { drawPuppet, poses, blend, solve } from './lib/puppet.mjs';
import { rays } from './lib/worldkit.mjs';
import * as ST from './lib/kzstadium.mjs';

const TAU = Math.PI * 2;

export const meta = { type: 'kzImpact', budgetMs: 200 };

/** Fallback colours (the treatment's palette overrides them). */
export const DEFAULT = {
  sky: '#060B2A', pitch: '#0E5A3A', freeze: '#1B3A9E', comet: '#3DE0FF', cometCore: '#FFFFFF',
  rose: '#2E6BFF', roseDeep: '#14329A', gold: '#FFD45A', ink: '#05060F',
};

export const defaults = {
  powerT: null,         // first energy rings (null: 7 % through the entry)
  nameT: null,          // second energy rings (null: 16 %)
  strikeT: null,        // the volley: impact frames (null: 22 %)
  goalT: null,          // the net explodes, colour returns (null: 43 %)
  futureT: null,        // petals swirl and flash gold (null: 54 %)
  rulerT: null,         // again (null: 69 %)
  kingT: null,          // again, and the crown appears (null: 85 %)
  walkT: null,          // the cut to him walking away (null: the first downbeat 0.25 s after goalT)
  strikeX: -1.2, strikeZ: -36.0,      // where the volley is struck (m)
  aimX: 2.3, aimY: 1.8,               // where the ball enters the goal (m)
  drain: 0.3,           // seconds for the stadium to drain to monochrome
  petals: 1,            // petal density (1 = the net's mesh points, a few hundred)
  rain: 340,            // petals falling through the walk
};

// ------------------------------------------------------------------------------------- helpers

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const outCubic = (u) => 1 - (1 - clamp(u)) ** 3;
const inCubic = (u) => clamp(u) ** 3;
const outExpo = (u) => { u = clamp(u); return u >= 1 ? 1 : 1 - 2 ** (-10 * u); };
const land = (x, F) => Math.floor(x * (F.fps || 30) + 0.5) / (F.fps || 30);
const hash = (a, b, c = 0) => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

function palette(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(DEFAULT)) o[k] = typeof p[k] === 'string' && p[k].startsWith('#') ? p[k] : DEFAULT[k];
  return o;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) { v = make(); if (cache.size > 200) cache.delete(cache.keys().next().value); cache.set(key, v); }
  return v;
}

// ------------------------------------------------------------------------------------- the story

function story(F, P, S) {
  const t0 = S.t0, t1 = S.t1, span = t1 - t0, fps = F.fps || 30;
  const at = (v, f) => land(v === null || v === undefined ? t0 + f * span : v, F);
  const st = {
    t0, t1, fps,
    powerT: at(P.powerT, 0.07), nameT: at(P.nameT, 0.164), strikeT: at(P.strikeT, 0.22), goalT: at(P.goalT, 0.43),
    futureT: at(P.futureT, 0.54), rulerT: at(P.rulerT, 0.69), kingT: at(P.kingT, 0.85),
  };
  st.impactEnd = st.strikeT + 4 / fps;
  let walkT = P.walkT;
  if (walkT === null || walkT === undefined) {
    const d = ((F.ev && F.ev.downbeats) || []).find((x) => x >= st.goalT + 0.25);
    walkT = d !== undefined && d < t1 - 1 ? d : st.goalT + 0.4;
  }
  st.walkT = land(walkT, F);
  st.swirls = [st.futureT, st.rulerT, st.kingT].filter((x) => x >= st.walkT - 0.5 && x < t1);
  st.S = [P.strikeX, 0, P.strikeZ];
  return st;
}

function phaseAt(t, st) {
  if (t < st.strikeT) return 'freeze';
  if (t < st.impactEnd) return 'impact';
  if (t < st.goalT) return 'comet';
  if (t < st.walkT) return 'goal';
  return 'walk';
}

// ------------------------------------------------------------------------------------- Kaiser and the ball

const STRIKE_POSE = { sL: 2.5, sR: 1.1, eL: 0.15, eR: 0.45, hL: -0.55, kL: 0.7, hR: 2.15, kR: 0.05, lean: -0.6, rot: -0.72, head: 0.35 };
const COIL_POSE = { sL: 2.15, sR: 1.45, eL: 0.25, eR: 0.5, hL: 1.25, kL: 0.45, hR: -1.25, kR: 1.65, lean: -0.5, rot: -0.32, head: 0.25 };
const RISE_POSE = { sL: 1.7, sR: 1.35, eL: 0.4, eR: 0.35, hL: 1.0, kL: 1.4, hR: 0.35, kR: 0.95, lean: -0.1, head: -0.1 };

/** The leap: Kaiser's pose and height (m of the feet above the ground) in the freeze. */
function leapAt(t, st) {
  const u = clamp((t - st.t0) / Math.max(0.2, st.strikeT - st.t0));
  const h = 1.15 * Math.sin((Math.PI / 2) * clamp(u * 1.35)) + 0.12 * u;
  let pose;
  if (u < 0.1) pose = blend({ ...poses.crouch, squash: 0.2 }, RISE_POSE, smooth(u / 0.1));
  else pose = blend(RISE_POSE, COIL_POSE, smoother((u - 0.1) / 0.75));
  return { u, h, pose };
}

/** Where the ball meets his foot at the strike (screen), from the solved strike pose. */
function strikeFoot(cam, st, kscale) {
  const f = ST.figureAt(cam, st.S[0], st.S[2]);
  if (!f) return null;
  const lp = leapAt(st.strikeT, st);
  const j = solve(KAISER, STRIKE_POSE, { x: f.x, ground: f.y - lp.h * f.s, scale: kscale ?? f.scale, facing: -1, view: 'side' });
  return { x: j.toeR[0], y: j.toeR[1], j };
}

/** The ball's flight after the strike: world position at progress p (0 at the foot, 1 at the goal line). */
function cometPos(p, st, P) {
  const S = [st.S[0] - 0.35, 1.55, st.S[2] - 0.75];
  const E = [P.aimX, P.aimY, -ST.DIM.halfL];
  const e = p;                                   // steady in slow motion
  return [lerp(S[0], E[0], e), lerp(S[1], E[1], e) + 0.55 * Math.sin(Math.PI * e), lerp(S[2], E[2], e)];
}
function cometAt(t, st, P) {
  const p = (t - st.impactEnd) / Math.max(0.3, st.goalT - st.impactEnd);
  if (t < st.goalT) return { p, pos: cometPos(clamp(p), st, P) };
  // through the net and gone
  const u = clamp((t - st.goalT) / 0.18);
  const E = cometPos(1, st, P);
  return { p: 1 + u, pos: [E[0] + 0.3 * u, E[1] - 0.2 * u, E[2] - 2.6 * u], gone: u >= 1 };
}

/** Kaiser in the walk: landing, then walking towards the camera (+Z). */
function walkerAt(t, st, F) {
  const tl = t - st.walkT;
  const landU = clamp(tl / 0.2);
  const y = 0.55 * (1 - landU * landU);
  const walking = clamp((tl - 0.45) / 0.3);
  const dist = Math.max(0, tl - 0.45) * 1.25 - 0.15 * (1 - walking) * 0;
  const x = st.S[0] + 0.4, z = st.S[2] + 0.5 + dist;
  const mt = F.col('mt', t);
  const a = TAU * mt * 0.5, s = Math.sin(a), c = Math.cos(a);
  const L = Math.max(0, s) * walking, R = Math.max(0, -s) * walking;
  const walkPose = { hL: 0.05 + 0.05 * L, hR: 0.05 + 0.05 * R, kL: 0.05 + 0.42 * L, kR: 0.05 + 0.42 * R, sL: 0.16 + 0.07 * R, sR: 0.16 + 0.07 * L,
    eL: 0.18 + 0.15 * R, eR: 0.18 + 0.15 * L, head: -0.14, rot: 0.025 * s * walking, bob: 0.012 * Math.abs(c) * walking, squash: 0.02 * (1 - Math.abs(c)) * walking };
  let pose = walkPose;
  const air = { ...poses.stand, sL: 1.15, sR: 1.6, eL: 0.45, eR: 0.15, hL: 0.24, hR: 0.1, kL: 0.65, kR: 0.3, head: 0.15, rot: 0.07, squash: -0.1 };
  const touch = { ...poses.stand, sL: 0.9, sR: 0.9, eL: 0.2, eR: 0.2, hL: 0.14, hR: 0.14, kL: 0.12, kR: 0.12, head: 0.1, squash: 0.38 };
  if (landU < 1) pose = blend(air, touch, smooth(landU));
  else if (tl < 0.75) pose = blend(touch, walkPose, smooth((tl - 0.24) / 0.45));
  return { x, z, y, pose };
}

// ------------------------------------------------------------------------------------- cameras

function cameraAt(ph, t, st, P, F) {
  const [Sx, , Sz] = st.S;
  if (ph === 'freeze' || ph === 'impact') {
    const u = clamp((t - st.t0) / Math.max(0.2, st.strikeT - st.t0));
    const a = -0.32 + 0.22 * smooth(u);
    const R = 5.5 - 0.45 * u;
    const eye = [Sx + Math.cos(a) * R, 0.35, Sz - 0.9 + Math.sin(a) * R];
    return ST.lookAt(eye, [Sx, 2.15, Sz - 1.0], { focal: 1080, cy: 560, roll: 0.04 });
  }
  if (ph === 'comet' || ph === 'goal') {
    const goalEye = [P.aimX * 0.35, 1.25, -ST.DIM.halfL + 8.2], goalLook = [P.aimX * 0.55, 1.45, -ST.DIM.halfL - 1.0];
    if (ph === 'goal') {
      const u = smooth((t - st.goalT) / Math.max(0.2, st.walkT - st.goalT));
      return ST.lookAt([goalEye[0] - 0.2 * u, goalEye[1] + 0.15 * u, goalEye[2] + 0.9 * u], goalLook, { focal: 980 });
    }
    const c = cometAt(t, st, P);
    const b = c.pos;
    const chaseEye = [b[0] + 3.4, b[1] + 0.55, b[2] + 2.6], chaseLook = [b[0] - 0.6, b[1] + 0.1, b[2] - 4.2];
    const w = smoother((c.p - 0.5) / 0.45);
    const eye = [lerp(chaseEye[0], goalEye[0], w), lerp(chaseEye[1], goalEye[1], w), lerp(chaseEye[2], goalEye[2], w)];
    const look = [lerp(chaseLook[0], goalLook[0], w), lerp(chaseLook[1], goalLook[1], w), lerp(chaseLook[2], goalLook[2], w)];
    return ST.lookAt(eye, look, { focal: lerp(1050, 980, w), roll: -0.04 * (1 - w) });
  }
  // walk: low, in front of him, the goal behind him; a slow dolly back
  const K = walkerAt(t, st, F);
  const u = smooth((t - st.walkT) / Math.max(0.5, st.t1 - st.walkT));
  const dist = lerp(7.2, 4.7, u);
  return ST.lookAt([K.x + 0.75, 0.62, K.z + dist], [K.x + 0.15, 1.18, K.z - 3], { focal: 1240, cy: 590 });
}

// ------------------------------------------------------------------------------------- petals

/** Sprites: small roses (drawRose) and single petals, blue and gold, cached per colour. */
function roseSprite(g, pal, gold, open) {
  return cached(`rose|${gold ? pal.gold : pal.rose}|${open}`, () => {
    const s = 64, c = g.createCanvas(s, s), x = c.getContext('2d');
    if (gold) drawRose(x, 32, 32, 27, { color: pal.gold, deep: KZ.goldDeep, hi: '#FFF6D0', open });
    else drawRose(x, 32, 32, 27, { color: pal.rose, deep: pal.roseDeep, hi: KZ.roseHi, open });
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}
function petalSprite(g, col, deep) {
  return cached(`petal|${col}|${deep}`, () => {
    const w = 64, h = 40, c = g.createCanvas(w, h), x = c.getContext('2d');
    const gr = x.createLinearGradient(4, 20, 60, 20);
    gr.addColorStop(0, deep);
    gr.addColorStop(0.6, col);
    gr.addColorStop(1, ST.mixHex(col, '#FFFFFF', 0.35));
    x.fillStyle = gr;
    x.beginPath();
    x.moveTo(4, 20);
    x.quadraticCurveTo(18, 2, 46, 5);
    x.quadraticCurveTo(62, 12, 58, 22);
    x.quadraticCurveTo(48, 37, 24, 34);
    x.quadraticCurveTo(10, 30, 4, 20);
    x.closePath();
    x.fill();
    x.strokeStyle = ST.mixHex(deep, '#000000', 0.3);
    x.lineWidth = 1.5;
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.35)';
    x.beginPath(); x.moveTo(12, 19); x.quadraticCurveTo(30, 12, 50, 14); x.stroke();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** The net mesh points that burst into petals (fixed list), with their distance from the impact point. */
function netSeeds(P) {
  return cached(`netseeds|${P.aimX}|${P.aimY}|${P.petals}`, () => {
    const out = [];
    const e = -1, gl = e * ST.DIM.halfL, w = ST.DIM.goalW / 2, h = ST.DIM.goalH, D = ST.DIM.goalD;
    const dens = Math.max(0.2, P.petals || 1);
    const nu = Math.round(26 * dens), nv = Math.round(10 * dens);
    const add = (x, y, z, k) => out.push({ x, y, z, k, d: Math.hypot(x - P.aimX, y - P.aimY, (z - gl) * 0.6) });
    let k = 0;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = (i / nu) * 2 - 1, v = j / nv;
      add(u * w, v * (h - 0.3), gl + e * (D - 0.5 * v), k++);
    }
    for (let i = 0; i <= nu; i++) for (let j = 1; j <= 4; j++) add(((i / nu) * 2 - 1) * w, h - 0.07 * j, gl + e * (D * 0.5 * j / 4), k++);
    for (const sx of [-1, 1]) for (let i = 1; i <= 5; i++) for (let j = 0; j <= nv; j++) add(sx * w, (j / nv) * h * 0.95, gl + e * D * (i / 5) * 0.9, k++);
    return out;
  });
}

/**
 * Every petal at time t in world space: {x, y, z, rot, flip, size, kind (0 petal, 1 rose), gold (0..1), a}.
 * The burst from the net at goalT, the rain through the walk, and a swirl around Kaiser per swirl event.
 */
function petalsAt(t, st, P, K) {
  const out = [];
  if (t < st.goalT) return out;
  const goldAt = (ti) => st.swirls.reduce((m, te) => (ti >= te ? Math.max(m, Math.exp(-(ti - te) / 0.45)) : m), 0);
  const gold = goldAt(t);
  // the burst: born where the tear front passes each mesh point
  const seeds = netSeeds(P);
  const vt = 0.85, k = 1.7;                    // terminal fall speed (m/s), drag (1/s)
  for (const sd of seeds) {
    const tb = st.goalT + sd.d / 16;
    const age = t - tb;
    if (age < 0) continue;
    const h1 = hash(sd.k, 1), h2 = hash(sd.k, 2), h3 = hash(sd.k, 3), h4 = hash(sd.k, 4);
    let rx = sd.x - P.aimX, ry = sd.y - P.aimY;
    const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
    const sp = 3 + 7 * h1;
    const vx = rx * sp * 0.9 + (h2 - 0.5) * 4, vy = ry * sp * 0.5 + 2.5 + 4.5 * h3, vz = 5 + 17 * h4 * h4;   // out of the goal, towards the pitch
    const dk = (1 - Math.exp(-k * age)) / k;
    // linear drag with gravity: falls at the terminal speed vt once the burst has spent itself
    const x = sd.x + vx * dk + 0.35 * Math.sin(age * (1.6 + h1) + h2 * TAU);
    let y = sd.y + (vy + vt) * dk - vt * age;
    const z = sd.z + vz * dk + 0.35 * Math.cos(age * (1.3 + h3) + h4 * TAU);
    const onGround = y <= 0.02;
    if (onGround) y = 0.02;
    out.push({ x, y, z, rot: onGround ? (h1 - 0.5) * 0.7 : h1 * TAU + age * (2 + 4 * h2), flip: onGround ? 0.3 : Math.cos(age * (3 + 3 * h3) + h4 * 9), flat: onGround,
      size: 0.15 + 0.12 * h2, kind: h3 < 0.28 ? 1 : 0, gold: h4 < gold ? 1 : 0, a: smooth(age / 0.05) });
  }
  // the rain through the walk (closed-form loop, fading at the top and bottom)
  if (t >= st.walkT - 0.3 && K) {
    const n = Math.round(P.rain || 0);
    const Hh = 9;
    for (let i = 0; i < n; i++) {
      const h1 = hash(i, 11), h2 = hash(i, 12), h3 = hash(i, 13), h4 = hash(i, 14);
      const x0 = st.S[0] + (h1 * 2 - 1) * 11, z0 = st.S[2] - 18 + h2 * 33;
      const fall = 0.9 + 0.5 * h3;
      const yy = Hh - ((t * fall + h4 * Hh) % Hh);
      const a = smooth(yy / 0.8) * smooth((Hh - yy) / 1.5) * smooth((t - st.walkT + 0.3) / 0.6);
      if (a <= 0.01) continue;
      const ph = t * (0.8 + h2) + h1 * TAU;
      out.push({ x: x0 + 0.6 * Math.sin(ph), y: yy, z: z0 + 0.5 * Math.cos(ph * 0.8), rot: ph * 1.7, flip: Math.cos(ph * 2.3),
        size: 0.13 + 0.1 * h3, kind: h4 < 0.2 ? 1 : 0, gold: hash(i, 15) < gold ? 1 : 0, a });
    }
  }
  // petals lying on the grass around his path (they have rained down by the time he walks)
  if (t >= st.walkT - 0.3) {
    const fade = smooth((t - st.walkT + 0.3) / 0.4);
    for (let i = 0; i < 150; i++) {
      const h1 = hash(i, 71), h2 = hash(i, 72), h3 = hash(i, 73);
      out.push({ x: st.S[0] + (h1 * 2 - 1) * 7.5, y: 0.015, z: st.S[2] - 3 + h2 * 16, rot: (h3 - 0.5) * 0.7, flip: 0.28 + 0.12 * h2, flat: true,
        size: 0.14 + 0.08 * h3, kind: h1 < 0.15 ? 1 : 0, gold: hash(i, 74) < gold ? 1 : 0, a: fade });
    }
  }
  // the swirl around him on each event
  if (K) {
    st.swirls.forEach((te, e) => {
      const age = t - te;
      if (age < 0 || age > 2.2) return;
      const env = smooth(age / 0.12) * (1 - smooth((age - 1.2) / 0.9));
      for (let i = 0; i < 70; i++) {
        const h1 = hash(i, 21 + e), h2 = hash(i, 31 + e), h3 = hash(i, 41 + e);
        const ang = h1 * TAU + age * (3.4 + 1.2 * h2) + e;
        const r = 0.9 + 1.5 * h2 + 0.4 * age;
        const y = 0.15 + 2.6 * h3 + 0.7 * age;
        out.push({ x: K.x + Math.cos(ang) * r, y, z: K.z + Math.sin(ang) * r, rot: ang * 2, flip: Math.cos(ang * 1.5),
          size: 0.15 + 0.1 * h3, kind: h2 < 0.3 ? 1 : 0, gold: hash(i, 51 + e) < Math.max(gold, 0.35) ? 1 : 0, a: env });
      }
    });
  }
  return out;
}

/** Draw petals (already projected and filtered), far to near. */
function drawPetals(g, list, pal) {
  const { ctx } = g, sc = g.scale;
  const blue = petalSprite(g, pal.rose, pal.roseDeep), goldP = petalSprite(g, pal.gold, KZ.goldDeep);
  const roseB = roseSprite(g, pal, false, 0.85), roseG = roseSprite(g, pal, true, 0.85);
  ctx.save();
  for (const q of list) {
    const px = Math.min(190, Math.max(2.5, q.size * q.p.s));
    if (q.p.x < -px || q.p.x > 1920 + px || q.p.y < -px || q.p.y > 1080 + px) continue;
    const spr = q.kind ? (q.gold ? roseG : roseB) : (q.gold ? goldP : blue);
    const c = Math.cos(q.rot), s = Math.sin(q.rot);
    const fx = q.flat ? Math.abs(q.flip) : q.kind ? 1 : Math.max(0.18, Math.abs(q.flip));
    const w = px * (q.kind ? 1 : 1.3), h = (q.kind ? px : px * 0.8) * fx;
    ctx.globalAlpha = clamp(q.a);
    ctx.setTransform(sc * c, sc * s, -sc * s, sc * c, sc * q.p.x, sc * q.p.y);
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------- effects

/** Blue monochrome over what has been drawn so far (the stadium), amount 0..1. */
function monochrome(g, amt, col) {
  if (amt <= 0.003) return;
  const { ctx } = g;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = `rgba(128,128,128,${(0.97 * amt).toFixed(3)})`;
  ctx.fillRect(0, 0, g.devW, g.devH);
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = g.color.css(col, 0.9 * amt);
  ctx.fillRect(0, 0, g.devW, g.devH);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g.color.css(ST.mixHex('#FFFFFF', col, 0.25), amt);
  ctx.fillRect(0, 0, g.devW, g.devH);
  ctx.restore();
}

/** Converging energy rings around (x, y) for an event at te. */
function energyRings(g, t, te, x, y, pal) {
  const age = t - te;
  if (age < 0 || age > 0.7) return 0;
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const u = (age - 0.07 * k) / 0.42;
    if (u < 0 || u > 1) continue;
    const r = (820 + 220 * k) * (1 - inCubic(u)) + 6;
    const a = smooth(u / 0.12);
    ctx.strokeStyle = g.color.css(pal.comet, 0.18 * a);
    ctx.lineWidth = 26 + 30 * u;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = g.color.css(ST.mixHex(pal.comet, '#FFFFFF', 0.5), 0.85 * a);
    ctx.lineWidth = 3 + 6 * u;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
  // the flash when they arrive
  const fl = age > 0.42 ? Math.exp(-(age - 0.42) / 0.09) : 0;
  if (fl > 0.02) {
    const glow = g.sprites.glow(pal.comet, 1), rr = 60 + 260 * fl;
    ctx.globalAlpha = fl;
    ctx.drawImage(glow, x - rr, y - rr, 2 * rr, 2 * rr);
  }
  ctx.restore();
  return fl;
}

/** Floating dust motes in the frozen air (closed-form, barely moving). */
function dustMotes(g, cam, t, st, slow, pal) {
  const { ctx } = g;
  const glow = g.sprites.glow(ST.mixHex(pal.comet, '#FFFFFF', 0.6), 1);
  const tt = st.t0 + (t - st.t0) * slow;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 150; i++) {
    const h1 = hash(i, 61), h2 = hash(i, 62), h3 = hash(i, 63), h4 = hash(i, 64);
    const x = st.S[0] + (h1 * 2 - 1) * 7 + 0.15 * Math.sin(tt * 0.7 + i);
    const y = 0.2 + h2 * 5.5 + 0.1 * Math.sin(tt * 0.5 + i * 1.3);
    const z = st.S[2] - 1 + (h3 * 2 - 1) * 7;
    const p = ST.project(cam, x, y, z);
    if (!p || p.d < 0.8) continue;
    const r = Math.min(26, Math.max(1.2, (0.015 + 0.03 * h4) * p.s));
    if (p.x < -r || p.x > 1920 + r || p.y < -r || p.y > 1080 + r) continue;
    ctx.globalAlpha = 0.25 + 0.45 * h4;
    ctx.drawImage(glow, p.x - r * 2, p.y - r * 2, r * 4, r * 4);
  }
  ctx.restore();
}

/** Ground ripples rolling out from the strike point. */
function ripples(g, cam, t, st, pal) {
  const age = t - st.strikeT;
  if (age < 0 || age > 2.4) return;
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const a = age - 0.16 * k;
    if (a <= 0) continue;
    const r = 11 * a;
    const alpha = Math.exp(-a / 0.8) * 0.6;
    if (alpha < 0.02) continue;
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const q = (i / 64) * TAU;
      pts.push([st.S[0] + Math.cos(q) * r, 0.03, st.S[2] + Math.sin(q) * r]);
    }
    const sp = ST.projectPoly(cam, pts);
    if (sp.length < 3) continue;
    ctx.strokeStyle = g.color.css(pal.comet, alpha);
    ctx.lineWidth = 3 + 5 * Math.exp(-a);
    ctx.beginPath();
    ctx.moveTo(sp[0][0], sp[0][1]);
    for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

/** The comet: a glowing tapered trail back along the flight, a blue-white core and shed sparks. */
function drawComet(g, cam, t, st, P, pal) {
  const { ctx } = g;
  const c = cometAt(t, st, P);
  if (c.gone) return null;
  const head = ST.project(cam, ...c.pos);
  // the tail: a screen-space teardrop streaming back along the projected flight direction
  const span = Math.max(0.3, st.goalT - st.impactEnd);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (head) {
    const pb = cometPos(clamp(c.p - 0.09, 0, 1), st, P);
    const qb = ST.project(cam, ...pb);
    let dx = -1, dy = 0;
    if (qb) { const l = Math.hypot(qb.x - head.x, qb.y - head.y); if (l > 1) { dx = (qb.x - head.x) / l; dy = (qb.y - head.y) / l; } }
    const r = Math.max(3, 0.11 * head.s);
    const grow = smooth((t - st.impactEnd) / 0.25);
    const L = (380 + 9 * r) * grow;
    const nx = -dy, ny = dx;
    for (const [wk, col, al, lk] of [[2.8, pal.comet, 0.42, 1], [1.6, pal.comet, 0.7, 0.8], [0.62, pal.cometCore, 1, 0.6]]) {
      const w = r * wk, len = L * lk;
      if (len < 2) continue;
      const tx = head.x + dx * len, ty = head.y + dy * len;
      const gr = ctx.createLinearGradient(head.x, head.y, tx, ty);
      gr.addColorStop(0, g.color.css(col, al));
      gr.addColorStop(0.35, g.color.css(col, al * 0.55));
      gr.addColorStop(1, g.color.css(col, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      const a0 = Math.atan2(ny, nx);
      ctx.arc(head.x, head.y, w, a0, a0 + Math.PI, true);      // the rounded front
      ctx.quadraticCurveTo(head.x - nx * w * 0.5 + dx * len * 0.45, head.y - ny * w * 0.5 + dy * len * 0.45, tx, ty);
      ctx.quadraticCurveTo(head.x + nx * w * 0.5 + dx * len * 0.45, head.y + ny * w * 0.5 + dy * len * 0.45, head.x + nx * w, head.y + ny * w);
      ctx.closePath();
      ctx.fill();
    }
  }
  // sparks shed along the flight (born at 90 per second, each lives 0.55 s)
  const glow = g.sprites.glow(pal.comet, 1);
  const rate = 90, life = 0.55;
  for (let k = Math.ceil((t - life) * rate); k <= Math.floor(t * rate); k++) {
    const tb = k / rate, age = t - tb;
    if (tb < st.impactEnd || tb > st.goalT || age < 0) continue;
    const w0 = cometPos(clamp((tb - st.impactEnd) / span), st, P);
    const h1 = hash(k, 5), h2 = hash(k, 6), h3 = hash(k, 7);
    const w = [w0[0] + (h1 - 0.5) * 2.4 * age, w0[1] + (h2 - 0.5) * 2.4 * age - 0.8 * age * age, w0[2] + (h3 - 0.5) * 2 * age];
    const q = ST.project(cam, ...w);
    if (!q) continue;
    const u = age / life;
    const r = Math.max(1.5, 0.05 * q.s) * (1 - u);
    ctx.globalAlpha = 0.9 * (1 - u);
    ctx.drawImage(glow, q.x - r * 2, q.y - r * 2, r * 4, r * 4);
  }
  // the head
  if (head) {
    const r = Math.max(3, 0.11 * head.s);
    ctx.globalAlpha = 1;
    const big = g.sprites.glow(pal.comet, 1);
    ctx.drawImage(big, head.x - r * 6, head.y - r * 6, r * 12, r * 12);
    ctx.restore();
    drawBall(ctx, head.x, head.y, r, { rot: t * 30 });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const core = g.sprites.glow(pal.cometCore, 1);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(core, head.x - r * 2.2, head.y - r * 2.2, r * 4.4, r * 4.4);
  }
  ctx.restore();
  return head;
}

/** The impact frames: a stark black-and-white graphic around the ball (the engine inverts some). */
function impactFrames(g, t, st, cam, pal, kscale) {
  const { ctx } = g;
  const k = Math.round((t - st.strikeT) * st.fps);
  const foot = strikeFoot(cam, st, kscale);
  const bx = foot ? foot.x : 960, by = foot ? foot.y : 540;
  const ink = pal.ink;
  // neutral whites and greys, so the inverted frames read as black and white
  const gr = ctx.createRadialGradient(bx, by, 0, bx, by, 1500);
  gr.addColorStop(0, '#FFFFFF');
  gr.addColorStop(0.4, '#F1F3F8');
  gr.addColorStop(1, '#C9CEDA');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 1920, 1080);
  // bold radial lines, re-rolled every frame
  speedLines(ctx, { cx: bx, cy: by, n: 120, inner: 90 + 50 * k, outer: 2400, color: ink, alpha: 1, seed: 70 + k, frame: k, hold: 1, width: 0.016 });
  // Kaiser zoomed in around the ball: a white halo, then solid ink
  const f = ST.figureAt(cam, st.S[0], st.S[2]);
  if (f) {
    const lp = leapAt(st.strikeT, st);
    const z = 1.45 + 0.05 * k;
    ctx.save();
    ctx.translate(bx, by); ctx.scale(z, z); ctx.translate(-bx, -by);
    const o = { x: f.x, ground: f.y - lp.h * f.s, scale: kscale ?? f.scale, facing: -1, view: 'side', devScale: g.scale };
    drawPuppet(ctx, ST.silhouette(KAISER, '#FFFFFF', 7), STRIKE_POSE, o);
    drawPuppet(ctx, ST.silhouette(KAISER, ink, 1.5), STRIKE_POSE, o);
    ctx.restore();
  }
  // the shockwave
  const r = 170 + 310 * k;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 58 - 6 * k;
  ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 30 - 4 * k;
  ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.stroke();
  // cracks in the air
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let a = (i / 9) * TAU + hash(i, 81) * 0.5;
    let x = bx, y = by;
    const len = 300 + 480 * hash(i, 82);
    for (let s2 = 0; s2 < 7; s2++) {
      a += (hash(i, 83 + s2) - 0.5) * 0.7;
      const seg = len / 7;
      const nx = x + Math.cos(a) * seg, ny = y + Math.sin(a) * seg;
      ctx.lineWidth = Math.max(2, 11 - 1.4 * s2);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      if (hash(i, 90 + s2) < 0.35) {
        const ba = a + (hash(i, 95 + s2) < 0.5 ? -1 : 1) * (0.5 + 0.4 * hash(i, 99 + s2));
        ctx.lineWidth = Math.max(1.5, 6 - s2 * 0.7);
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + Math.cos(ba) * seg * 0.6, ny + Math.sin(ba) * seg * 0.6); ctx.stroke();
      }
      x = nx; y = ny;
    }
  }
  // the ball at the heart of it
  const br = Math.max(6, 0.11 * (f ? f.s : 100) * 1.5);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(bx, by, br + 10, 0, TAU); ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
}

/** The crown floating just above his hair (from kingT); j = his solved joints. Its rays are drawn behind him. */
function crownOn(g, t, st, j, pal) {
  const u = t - st.kingT;
  if (u < 0 || !j) return;
  const { ctx } = g;
  const r = KAISER.headR * j.U;
  const pop = u < 0.1 ? lerp(0.6, 1.25, outExpo(u / 0.1)) : 1 + 0.25 * Math.exp(-(u - 0.1) / 0.16);
  const w = r * 2.5 * pop;
  const x = j.headC[0], y = j.headC[1] - r * 1.65 - r * 0.12 * Math.sin(t * 2.4);
  drawCrown(ctx, x, y, w, { fill: pal.gold, lineW: Math.max(1.5, w * 0.045) });
  const glint = Math.exp(-u / 0.12);
  if (glint > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const star = ST.starSprite(g, pal.gold);
    const rr = w * (0.8 + 1.6 * glint);
    ctx.globalAlpha = glint;
    ctx.drawImage(star, x - rr, y - w * 0.4 - rr, 2 * rr, 2 * rr);
    ctx.restore();
  }
}
function crownRays(g, t, st, kp, pal, H) {
  const u = t - st.kingT;
  if (u < 0) return;
  const { ctx } = g;
  const cx = kp.x, cy = kp.y - H * 1.12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = g.sprites.glow(pal.gold, 0);
  const r = H * (0.8 + 1.2 * Math.exp(-u / 0.25));
  ctx.globalAlpha = 0.3 + 0.45 * Math.exp(-u / 0.3);
  ctx.drawImage(glow, cx - r, cy - r, 2 * r, 2 * r);
  ctx.globalAlpha = 1;
  rays(ctx, { cx, cy, n: 14, rot: 0.3 + t * 0.18, spread: 0.028, length: H * (1.5 + 1.3 * Math.exp(-u / 0.35)),
    color: g.color.css(pal.gold, 0.1 + 0.3 * Math.exp(-u / 0.3)), fade: g.color.css(pal.gold, 0) });
  ctx.restore();
}

// ------------------------------------------------------------------------------------- draw

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const pal = palette(S);
  const st = story(F, P, S);
  const ph = phaseAt(t, st);
  const cam = cameraAt(ph, t, st, P, F);
  const c = F.c;

  // the impact frames replace everything
  if (ph === 'impact') {
    const f = ST.figureAt(cam, st.S[0], st.S[2]);
    impactFrames(g, t, st, cam, pal, f ? f.scale : 1);
    return;
  }

  const frozen = t < st.goalT;
  const mono = frozen ? smooth((t - st.t0) / Math.max(0.05, P.drain)) : 0;
  const after = t >= st.goalT;
  const erupt = after ? Math.exp(-(t - st.goalT) / 1.6) : 0;
  const kick = clamp(((c.kick ?? 0) - 0.4) / 0.55);
  const flare = after ? Math.pow(kick, 1.4) : 0.15;
  const mtFrozen = F.col('mt', st.t0) + (t - st.t0) * 0.05;     // the crowd barely moves while time is frozen
  const flashes = [];
  if (after) {
    for (const h of F.between('hat', t - 0.35, t + 1e-6)) flashes.push({ t0: land(h[0], F), n: 14 + Math.round(20 * (h[2] ?? 0.5)), seed: Math.round(h[0] * 1000), s: 1 });
    for (const h of F.between('hit', t - 0.35, t + 1e-6)) flashes.push({ t0: land(h[0], F), n: Math.round(30 + 60 * erupt), seed: Math.round(h[0] * 1000) + 3, s: 1 });
    flashes.push({ t0: st.goalT, n: 400, seed: 999, s: 1 });
  }
  const comet = ph === 'comet' ? cometAt(t, st, P) : null;
  const light = [{ x: 0, z: -30, r: 40, a: 0.06 }];
  if (comet) light.push({ x: comet.pos[0], z: comet.pos[2], r: 7, a: 0.35, color: pal.comet });
  const holeR = after ? 7 * outCubic((t - st.goalT) / 0.4) : 0;
  const bulge = ph === 'comet' ? { x: P.aimX, y: P.aimY, amt: 0.9 * smooth((comet.p - 0.92) / 0.08), r: 1.2 } : after ? { x: P.aimX, y: P.aimY, amt: 0.9 * Math.exp(-(t - st.goalT) / 0.1), r: 1.4 } : null;
  ST.drawStadium(g, cam, {
    t: frozen ? st.t0 + (t - st.t0) * 0.05 : t, mt: frozen ? mtFrozen : c.mt, palette: pal,
    energy: after ? 1 : 0.55, jump: after ? 0.6 + 0.6 * erupt : 0.15, wave: 0, flare: after ? clamp(flare + 0.6 * erupt) : 0.15,
    light, sparkle: { steady: after ? 260 : 90, flashes, life: 0.35 },
    boardPulse: after ? clamp(0.15 * (c.snare ?? 0) + 0.2 * erupt) : 0,
    goals: [1], soft: ph === 'walk' || ph === 'freeze' ? 0.5 : 0, boardDim: 0.45,
  });
  // the near goal with its net (torn open and gone into petals after the goal)
  ST.drawGoal(g, cam, -1, { palette: pal, bulge, hole: holeR > 0 ? { x: P.aimX, y: P.aimY, r: holeR } : null });
  if (mono > 0) monochrome(g, mono, pal.freeze);

  if (ph === 'freeze') return drawFreeze(g, t, F, st, P, cam, pal);
  if (ph === 'comet') {
    ripples(g, cam, t, st, pal);
    // the strike's shockwave ring, still expanding in the air
    const age = t - st.strikeT;
    const sp = ST.project(cam, st.S[0] - 0.35, 1.55, st.S[2] - 0.75);
    if (sp && age < 0.9) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = g.color.css(pal.comet, 0.55 * Math.exp(-age / 0.3));
      ctx.lineWidth = 18 * Math.exp(-age / 0.4) + 2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 300 + 2200 * age, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // Kaiser falling away behind the camera's shoulder
    const f = ST.figureAt(cam, st.S[0], st.S[2]);
    if (f && f.d > 2.2) {
      const a = smooth((f.d - 2.2) / 1.2);
      ctx.save();
      ctx.globalAlpha = a;
      drawPuppet(ctx, KAISER, blend(STRIKE_POSE, { ...STRIKE_POSE, rot: -1.2, hR: 1.6 }, smooth(age / 0.8)), { x: f.x, ground: f.y - (leapAt(st.strikeT, st).h - 0.6 * age) * f.s, scale: f.scale, facing: -1, view: 'side', devScale: g.scale });
      ctx.restore();
    }
    const head = drawComet(g, cam, t, st, P, pal);
    if (head) speedLines(ctx, { cx: head.x, cy: head.y, n: 70, inner: 220, outer: 1500, color: '#FFFFFF', alpha: 0.22, seed: 41, frame: F.frame, hold: 2, width: 0.004 });
    return;
  }
  // goal and walk: petals everywhere
  const K = ph === 'walk' ? walkerAt(t, st, F) : null;
  const petals = petalsAt(t, st, P, K);
  for (const q of petals) q.p = ST.project(cam, q.x, q.y, q.z);
  const vis = petals.filter((q) => q.p && q.p.d > 0.4).sort((a, b) => b.p.d - a.p.d);
  if (ph === 'goal') {
    drawPetals(g, vis, pal);
    // the burst of light where the ball tore through
    const age = t - st.goalT;
    const bp = ST.project(cam, P.aimX, P.aimY, -ST.DIM.halfL - 0.5);
    if (bp) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = g.sprites.glow(pal.comet, 1), r = 120 + 900 * Math.exp(-age / 0.15);
      ctx.globalAlpha = Math.exp(-age / 0.25);
      ctx.drawImage(glow, bp.x - r, bp.y - r, 2 * r, 2 * r);
      ctx.restore();
      if (age < 0.3) speedLines(ctx, { cx: bp.x, cy: bp.y, n: 64, inner: 240, outer: 1600, color: '#FFFFFF', alpha: 0.38 * (1 - age / 0.3), seed: 51, frame: F.frame, hold: 2, width: 0.0045 });
    }
    drawComet(g, cam, t, st, P, pal);
    ST.drawFlares(g, cam, { palette: pal, flare: clamp(flare + erupt) });
    return;
  }
  // walk
  const kp = ST.figureAt(cam, K.x, K.z);
  if (!kp) return;
  const H = 1.85 * kp.s;
  const behind = vis.filter((q) => q.p.d >= kp.d), front = vis.filter((q) => q.p.d < kp.d);
  drawPetals(g, behind, pal);
  ST.drawShadow(g, cam, K.x, K.z, { a: 0.55, lift: K.y });
  crownRays(g, t, st, kp, pal, H);
  const gold = st.swirls.reduce((m, te) => (t >= te ? Math.max(m, Math.exp(-(t - te) / 0.45)) : m), 0);
  if (gold > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = g.sprites.glow(pal.gold, 0), r = H * 1.6;
    ctx.globalAlpha = 0.55 * gold;
    ctx.drawImage(glow, kp.x - r, kp.y - H * 0.55 - r, 2 * r, 2 * r);
    ctx.restore();
  }
  const ldir = ST.lightDir(cam, kp.x, kp.y - H);
  let kj = null;
  ST.litFigures(g, (lc) => {
    kj = drawPuppet(lc, KAISER, K.pose, { x: kp.x, ground: kp.y - K.y * kp.s, scale: kp.scale, facing: 1, view: 'front', devScale: g.scale });
  }, [kp.x - H * 0.7, kp.y - H * 1.2 - K.y * kp.s, kp.x + H * 0.7, kp.y + 10], ldir, { rimW: 3.4, shadeW: 10, rim: ST.mixHex('#E4EEFF', pal.gold, 0.4 * gold) });
  crownOn(g, t, st, kj, pal);
  drawPetals(g, front, pal);
  ST.drawFlares(g, cam, { palette: pal, flare: flare * 0.7 });
}

/** The frozen moment before the strike: aura, rim-lit Kaiser coiling, the ball rising, rings and motes. */
function drawFreeze(g, t, F, st, P, cam, pal) {
  const { ctx } = g;
  const f = ST.figureAt(cam, st.S[0], st.S[2]);
  if (!f) return;
  const lp = leapAt(t, st);
  const H = 1.85 * f.s;
  const ground = f.y - lp.h * f.s;
  // the ball rises from the turf in front of him to the point of the strike
  const foot = strikeFoot(cam, st, f.scale);
  const b0 = ST.project(cam, st.S[0], 0.11, st.S[2] - 0.9);
  const bu = smoother(clamp((t - st.t0) / Math.max(0.2, st.strikeT - st.t0) * 1.05));
  const bx = lerp(b0 ? b0.x : f.x, foot ? foot.x : f.x, bu), by = lerp(b0 ? b0.y : f.y, foot ? foot.y : f.y - H, bu) - Math.sin(Math.PI * bu) * H * 0.18;
  const br = Math.max(3, 0.11 * f.s);
  // still speed lines hanging in the air, and dust motes
  speedLines(ctx, { cx: bx, cy: by, n: 80, inner: H * 0.9, outer: 1800, color: '#DCE8FF', alpha: 0.2, seed: 13, frame: 0, hold: 1, width: 0.004 });
  dustMotes(g, cam, t, st, 0.08, pal);
  // the aura behind him
  const power = smooth((t - st.powerT) / 0.3) * 0.5 + smooth((t - st.nameT) / 0.3) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const aura = g.sprites.glow(pal.comet, 0);
  const ar = H * (0.75 + 0.25 * power);
  ctx.globalAlpha = 0.28 + 0.3 * power;
  ctx.drawImage(aura, f.x - ar, ground - H * 0.55 - ar, 2 * ar, 2 * ar);
  ctx.restore();
  ST.drawShadow(g, cam, st.S[0], st.S[2], { a: 0.5, lift: lp.h });
  // Kaiser, rim-lit in the freeze colour's light
  ST.litFigures(g, (lc) => {
    drawPuppet(lc, KAISER, lp.pose, { x: f.x, ground, scale: f.scale, facing: -1, view: 'side', devScale: g.scale });
  }, [f.x - H, ground - H * 1.3, f.x + H, ground + 20], [0.6, -0.8], { rim: ST.mixHex(pal.comet, '#FFFFFF', 0.35), rimW: 4.5, shadeA: 0.4 });
  // the ball, glowing brighter after each set of rings
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = g.sprites.glow(pal.comet, 1);
  const gr = br * (2.5 + 4 * power);
  ctx.globalAlpha = 0.45 + 0.5 * power;
  ctx.drawImage(glow, bx - gr, by - gr, 2 * gr, 2 * gr);
  ctx.restore();
  drawBall(ctx, bx, by, br, { rot: (t - st.t0) * 0.6 });
  energyRings(g, t, st.powerT, bx, by, pal);
  energyRings(g, t, st.nameT, bx, by, pal);
}
