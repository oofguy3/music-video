// B1 THE FIELD: Kaiser cuts through the defence under the floodlights of a night stadium.
//
// The world is one consistent 3D night stadium (lib/kzstadium.mjs). Kaiser (KAISER, the kit) sprints
// along the pitch towards the goal at -Z with the ball at his feet, his running cycle locked to the
// beat (one cycle per beat: a stride on every eighth note). Rival defenders rush in one or two per bar
// and on a beat he skips past each with a sharp sidestep (an echo trail of blue after-images, a burst of
// speed lines); the defender tumbles away and falls. The framing cuts every P.cutBars bars on a downbeat,
// cycling P.shots ('track' a low three-quarter dolly in front of him, 'side' a side-on run, 'wide' high
// over the stadium); the part before the first downbeat after the beat drops is a descending wide shot.
// At P.kaiserT he stops dead, foot on the ball, and spreads his arms while the crowd goes wild and the
// camera cranes down from high to a low hero angle; at P.emperorT a gold crown flashes above his head
// with light rays until the end. Floodlights flare on kicks, phone flashes sparkle on hats, white streak
// lines rush past on snares.
//
// Pure: every moment comes from P (times), F (events and columns) and S; nothing is kept between frames.

import { KAISER, KZ, rivalDesign, drawBall, drawCrown, speedLines, streakLines } from './lib/kaiser.mjs';
import { drawPuppet, cycles, blend, poses } from './lib/puppet.mjs';
import { rays } from './lib/worldkit.mjs';
import { echo } from './lib/fx.mjs';
import * as ST from './lib/kzstadium.mjs';

const TAU = Math.PI * 2;

export const meta = { type: 'kzField', budgetMs: 170 };

/** Fallback colours (the treatment's palette overrides them). */
export const DEFAULT = {
  sky: '#060B2A', pitch: '#0E5A3A', pitchDeep: '#073322', line: '#E8F2FF', flood: '#EAF4FF', crowd: '#151A3A',
  rival: '#F2F4FA', rivalShorts: '#1B2340', gold: '#FFD45A', echo: '#2E6BFF',
};

export const defaults = {
  kaiserT: null,          // he stops dead and spreads his arms (null: 75 % through the entry)
  emperorT: null,         // the crown flashes above his head (null: 90 % through the entry)
  beatInT: null,          // the beat drops in (null: the first drums entry inside the entry, else its start)
  cutBars: 4,             // the framing cuts every this many bars, on a downbeat
  shots: ['track', 'side', 'wide'],   // the framings, cycled per block (the block before the first cut is the last one)
  sprint: 6.2,            // m/s once the beat is in
  jog: 3.2,               // m/s before
  startZ: 30,             // where the run starts (he attacks the goal at -Z)
  dodgeBeats: [1, 3],     // beats of a bar (0 = downbeat) a defender may arrive on; bars alternate one and two
  echoN: 6,               // after-images in a sidestep trail
  trackDist: 6.6,         // camera distance in the tracking shot (m)
  heroHeight: 470,        // Kaiser's height on screen in the final hero framing (px)
};

// ------------------------------------------------------------------------------------- helpers

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const outCubic = (u) => 1 - (1 - clamp(u)) ** 3;
const outExpo = (u) => { u = clamp(u); return u >= 1 ? 1 : 1 - 2 ** (-10 * u); };
const frac = (x) => x - Math.floor(x);
const mod = (a, n) => ((a % n) + n) % n;
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

/** Time of beat number m (F.ev.beats is indexed by beat count), extrapolated past the ends. */
function beatTime(F, m) {
  const b = (F.ev && F.ev.beats) || [];
  const i = Math.round(m);
  if (b.length && i >= 0 && i < b.length) return b[i];
  const bs = F.beatS || 0.4;
  if (!b.length) return m * bs;
  return i < 0 ? b[0] + i * bs : b[b.length - 1] + (i - b.length + 1) * bs;
}

// ------------------------------------------------------------------------------------- the story

/** Every moment of the entry, from P, F and S. */
function story(F, P, S) {
  const t0 = S.t0, t1 = S.t1, span = t1 - t0;
  const kaiserT = land(P.kaiserT ?? t0 + 0.75 * span, F);
  const emperorT = land(P.emperorT ?? t0 + 0.9 * span, F);
  let beatIn = P.beatInT;
  if (beatIn === null || beatIn === undefined) {
    const e = ((F.ev && F.ev.entries) || []).find((x) => x[1] === 'drums' && x[0] >= t0 - 0.05 && x[0] < kaiserT);
    beatIn = e ? e[0] : t0;
  }
  beatIn = land(beatIn, F);
  const bpb = F.bpb || 4;
  // the first downbeat at or after the beat drops: the framing blocks count from it
  const downs = (F.ev && F.ev.downbeats) || [];
  let di = downs.findIndex((d) => d >= beatIn - 0.05);
  if (di < 0) di = downs.length;
  const firstDown = di < downs.length ? land(downs[di], F) : beatIn;
  const mt0 = Math.round(F.col('mt', firstDown));
  const cutBars = Math.max(1, Math.round(P.cutBars || 4));
  const blockStart = (b) => {
    const k = di + b * cutBars;
    if (k >= 0 && k < downs.length) return land(downs[k], F);
    return firstDown + b * cutBars * bpb * (F.beatS || 0.4);
  };
  const shots = Array.isArray(P.shots) && P.shots.length ? P.shots : defaults.shots;
  // the sidesteps: one or two per bar on the given beats, from the first full bar to just before the stop
  const dodges = [];
  const beatsOf = Array.isArray(P.dodgeBeats) && P.dodgeBeats.length ? P.dodgeBeats : defaults.dodgeBeats;
  for (let bar = 0; bar < 64; bar++) {
    const base = mt0 + bar * bpb;
    if (beatTime(F, base) > kaiserT) break;
    const two = bar % 2 === 1;
    const list = two ? beatsOf : [beatsOf[beatsOf.length - 1]];
    for (const bb of list) {
      const tD = land(beatTime(F, base + bb), F);
      if (tD < beatIn + 0.5 || tD > kaiserT - 0.55) continue;
      const blk = Math.floor((base + bb - mt0) / (cutBars * bpb));
      if (tD - blockStart(blk) < 0.3) continue;      // never on the cut itself
      const k = dodges.length;
      const sigma = (k % 2 ? 1 : -1) * (hash(k, 11) < 0.15 ? -1 : 1);
      dodges.push({ k, tD, sigma, shot: shots[mod(blk, shots.length)] });
    }
  }
  return { t0, t1, kaiserT, emperorT, beatIn, firstDown, mt0, cutBars, bpb, blockStart, shots, dodges };
}

/** The framing at t: {shot, b (block), ts (block start), te (block end)}. */
function shotAt(t, st) {
  if (t >= st.kaiserT) return { shot: 'finale', b: 99, ts: st.kaiserT, te: st.t1 };
  if (t < st.firstDown) return { shot: 'wide', b: -1, ts: st.t0, te: Math.min(st.firstDown, st.kaiserT), intro: true };
  let b = 0;
  while (st.blockStart(b + 1) <= t && b < 64) b++;
  return { shot: st.shots[mod(b, st.shots.length)], b, ts: st.blockStart(b), te: Math.min(st.blockStart(b + 1), st.kaiserT) };
}

// ------------------------------------------------------------------------------------- Kaiser

/** Distance run since t0 (closed form: jog, ramp to sprint, sprint, a sharp stop at kaiserT). */
function runDist(t, st, P) {
  const jog = P.jog, spr = P.sprint, ramp = 0.35, stop = 0.2;
  const seg = (a, b, va, vb, x) => {             // integral of a linear speed va->vb on [a, b] up to x
    if (x <= a) return 0;
    const u = Math.min(x, b) - a, L = b - a;
    return va * u + ((vb - va) * u * u) / (2 * L);
  };
  let d = jog * (Math.min(t, st.beatIn) - st.t0);
  if (t > st.beatIn) d += seg(st.beatIn, st.beatIn + ramp, jog, spr, t);
  if (t > st.beatIn + ramp) d += spr * (Math.min(t, st.kaiserT) - (st.beatIn + ramp));
  if (t > st.kaiserT) d += seg(st.kaiserT, st.kaiserT + stop, spr, 0, t);
  return d;
}

/** The lateral sidestep of dodge d at time t (m), and the camera's slower follow of it. */
function stepOf(d, t, lag = false) {
  const tau = t - d.tD;
  if (tau < -0.1) return 0;
  const a = lag ? smooth((tau + 0.02) / 0.42) : smooth((tau + 0.08) / 0.16);
  const relax = tau < 0.5 ? 1 : Math.exp(-(tau - 0.5) / 1.1);
  const amp = d.shot === 'side' ? 0.7 : 1.5;
  return -d.sigma * amp * a * relax;
}

/** Kaiser at time t: world position, speed, the dodge in progress. */
function kaiserAt(t, st, P) {
  let x = 0, xc = 0, hopU = -1, dodge = null;
  for (const d of st.dodges) {
    if (t < d.tD - 0.2 || t > d.tD + 6) continue;
    x += stepOf(d, t);
    xc += stepOf(d, t, true);
    const tau = t - d.tD;
    if (tau > -0.12 && tau < 0.5) { dodge = d; hopU = (tau + 0.12) / 0.4; }
  }
  const z = P.startZ - runDist(t, st, P);
  return { x, z, camX: xc, dodge, hopU };
}

/** Kaiser's pose at t (view 'side' running, or the final stop). */
function kaiserPose(t, F, st, K, view) {
  const mt = F.col('mt', t);
  if (t >= st.kaiserT) {
    const u = smooth((t - st.kaiserT) / 0.22);
    const stopPose = { hL: 0.08, hR: 0.2, kL: 0.04, kR: 0.5, sL: 1.95, sR: 1.95, eL: 0.12, eR: 0.12, head: -0.35, lean: -0.08 };
    const wild = smooth((t - st.kaiserT - 0.5) / 0.6);
    const pose = { ...stopPose, sL: lerp(1.95, 2.25, wild), sR: lerp(1.95, 2.25, wild), head: lerp(-0.35, -0.5, wild) };
    if (view === 'side') return blend(cycles.run(mt, 0.8), { ...poses.stand, sL: 1.6, sR: 1.6 }, u);
    return blend({ ...poses.stand, kR: 0.3 }, pose, u);
  }
  const amt = t < st.beatIn ? 0.75 : 1;
  let pose = cycles.run(mt, amt);
  if (K.dodge && K.hopU >= 0 && K.hopU <= 1) {
    const arc = Math.sin(Math.PI * K.hopU);
    const hop = K.dodge.shot === 'side' ? 0.16 : 0.06;
    pose = { ...pose, bob: pose.bob + hop * arc, kL: pose.kL + 0.6 * arc, kR: pose.kR + 0.6 * arc, lean: pose.lean + 0.12 * arc,
      sL: pose.sL - 0.6 * arc, sR: pose.sR + 0.9 * arc };
  }
  return pose;
}

/** The ball at Kaiser's feet: world [x, y, z] and spin. */
function ballAt(t, F, st, K, P) {
  const mt = F.col('mt', t);
  if (t >= st.kaiserT) {
    const u = smooth((t - st.kaiserT) / 0.25);
    return { x: K.x - lerp(0, 0.2, u), y: 0.11, z: K.z + lerp(-0.9, 0.3, u), rot: -(runDist(st.kaiserT, st, P) / 0.11), stopped: u };
  }
  const touch = frac(mt + 0.15);                  // tapped ahead on every beat, then he catches up
  const ahead = 0.55 + 0.45 * Math.sqrt(touch) - 0.2 * touch;
  const lead = K.dodge ? 0.35 * Math.sin(Math.PI * clamp(K.hopU)) * -K.dodge.sigma : 0;
  const y = 0.11 + 0.08 * Math.abs(Math.sin(Math.PI * touch)) * (1 - touch);
  return { x: K.x + lead, y, z: K.z - ahead, rot: -(runDist(t, st, P) / 0.11) };
}

// ------------------------------------------------------------------------------------- defenders

/** Defender of dodge d at time t: world position, pose, facing hint, alpha (null when not on). */
function defenderAt(d, t, st, P, F) {
  const tau = t - d.tD;
  if (tau < -1.25 || tau > 7) return null;
  const side = d.shot === 'side';
  const o0 = side ? [d.sigma * 2.4, -11] : [d.sigma * 8.5, -1.2];
  const o1 = side ? [d.sigma * 0.55, -1.25] : [d.sigma * 1.45, -0.45];
  const relAt = (x) => {
    const u = outCubic((x + 1.2) / 1.2);
    return [lerp(o0[0], o1[0], u), lerp(o0[1], o1[1], u)];
  };
  const Kd = kaiserAt(Math.min(t, d.tD), st, P);
  if (tau <= 0) {
    const r = relAt(tau);
    const K = kaiserAt(t, st, P);
    const lunge = smooth((tau + 0.22) / 0.22);
    const mt = F.col('mt', t);
    let pose = cycles.run(mt + 0.37 * d.k, 1);
    if (side) pose = blend(pose, { sL: 1.8, sR: 0.6, eL: 0.4, eR: 0.3, hL: 1.5, kL: 0.1, hR: 0.6, kR: 1.4, lean: -0.6, rot: -0.9, head: 0.3 }, lunge);
    else pose = blend(pose, { ...pose, lean: 0.55, sL: 1.6, sR: 1.2, eL: 0.2, eR: 0.3, hL: 0.9, kL: 0.3, hR: -0.4, kR: 0.6 }, lunge);
    const dx = r[0] - relAt(tau - 0.05)[0], dz = r[1] - relAt(tau - 0.05)[1];
    return { x: K.x + r[0], z: K.z + r[1], pose, vx: dx, vz: dz + (K.z - kaiserAt(t - 0.05, st, P).z), lying: 0 };
  }
  // after the miss: momentum carries him on, he spins, crashes and slides to a stop
  const r1 = relAt(0), r0 = relAt(-0.05);
  const Kp = kaiserAt(d.tD - 0.05, st, P);
  const vx = (r1[0] - r0[0]) / 0.05, vz = (r1[1] - r0[1]) / 0.05 + (Kd.z - Kp.z) / 0.05;
  const tauS = 0.42, travel = tauS * (1 - Math.exp(-tau / tauS));
  const x = Kd.x + r1[0] + vx * travel * 0.55, z = Kd.z + r1[1] + vz * travel * 0.55;
  const spinU = clamp(tau / 0.55);
  const dir = d.sigma;
  let pose;
  if (spinU < 1) {
    pose = { ...poses.fall, rot: dir * (Math.PI * 2.5 * outCubic(spinU)), bob: 0.28 * Math.sin(Math.PI * spinU), sL: 2.6, sR: 2.0, hL: 0.9, kL: 1.2 };
  } else {
    pose = { ...poses.fall, rot: dir * Math.PI * 0.5, bob: 0, squash: 0.05 };
  }
  return { x, z, pose, vx, vz, lying: spinU };
}

// ------------------------------------------------------------------------------------- cameras

/** The camera for a framing at t, given Kaiser now. */
function cameraFor(sh, t, st, K, P, F) {
  const kx = K.camX, kz = K.z;
  const mt = F.col('mt', t);
  if (sh.shot === 'track') {
    const sd = sh.b % 2 ? -1 : 1;                 // which side of him the dolly runs on, per block
    const D = P.trackDist;
    const sway = 0.05 * Math.sin(TAU * mt * 0.5);
    const eye = [kx + sd * D * 0.52, 0.72 + 0.04 * Math.sin(TAU * mt), kz - D * 0.86];
    return ST.lookAt(eye, [kx - sd * 0.1, 1.15, kz + 0.1], { focal: 1450, cy: 560, roll: -sd * 0.035 + sway * 0.2 });
  }
  if (sh.shot === 'side') {
    const D = 7.2;
    const eye = [kx + D, 0.9, kz - 0.4];
    return ST.lookAt(eye, [kx, 1.35, kz - 1.5], { focal: 1380, cy: 610, roll: 0.03 * Math.sin(TAU * mt * 0.25) });
  }
  if (sh.shot === 'wide') {
    const u = clamp((t - sh.ts) / Math.max(0.5, sh.te - sh.ts));
    if (sh.intro) {
      const e = outCubic(u);
      const eye = [kx + lerp(40, 26, e), lerp(95, 44, e), kz + lerp(78, 50, e)];
      return ST.lookAt(eye, [kx * 0.5, 0, kz - 14], { focal: 1150, roll: lerp(0.06, 0.02, e) });
    }
    const ang = 0.7 + 0.35 * u;
    const eye = [kx + Math.sin(ang) * 52, 40, kz + Math.cos(ang) * 52];
    return ST.lookAt(eye, [kx * 0.5, 0, kz - 8], { focal: 1150 });
  }
  // finale: he has turned back to the pitch; a high wide shot from over the pitch cranes down to a
  // low hero angle in front of him by emperorT (the goal and the roaring end stand behind him)
  const u = smoother((t - st.kaiserT - 0.1) / Math.max(0.4, st.emperorT - st.kaiserT - 0.15));
  const push = clamp((t - st.emperorT) / Math.max(0.5, st.t1 - st.emperorT));
  const az = lerp(0.55, 0.17, u), el = lerp(0.52, -0.07, u), dist = lerp(27, 5.1 - 0.45 * push, u);
  const tgtY = lerp(0.6, 1.3, u);
  const eye = [kx + Math.sin(az) * dist * Math.cos(el), tgtY + Math.sin(el) * dist, kz + Math.cos(az) * dist * Math.cos(el)];
  const focal = lerp(1150, (P.heroHeight / 1.85) * 5.1, u);
  return ST.lookAt(eye, [kx, tgtY, kz - lerp(4, 0, u)], { focal, cy: lerp(560, 610, u), roll: lerp(0.05, -0.025, u) });
}

// ------------------------------------------------------------------------------------- drawing pieces

/** Puppet facing from the screen direction of a world velocity. */
function facingOf(cam, x, z, vx, vz, fallback = 1) {
  const a = ST.project(cam, x, 0, z), b = ST.project(cam, x + vx * 0.2, 0, z + vz * 0.2);
  if (!a || !b || Math.abs(b.x - a.x) < 0.5) return fallback;
  return b.x > a.x ? 1 : -1;
}

/** The crowd's sparkle bursts from the hi-hats (and big ones on every hit when wild). */
function flashesAt(F, t, wild) {
  const out = [];
  for (const h of F.between('hat', t - 0.35, t + 1e-6)) out.push({ t0: land(h[0], F), n: Math.round(8 + 22 * (h[2] ?? h[1] ?? 0.5)), seed: Math.round(h[0] * 1000), s: 1 });
  if (wild > 0) {
    for (const h of F.between('hit', t - 0.35, t + 1e-6)) out.push({ t0: land(h[0], F), n: Math.round(60 * wild), seed: Math.round(h[0] * 1000) + 7, s: 1 });
    // a continuous storm of camera flashes: a fresh burst on every frame (closed form, seeded by frame)
    const fps = F.fps || 30, f0 = Math.round(t * fps);
    for (let k = 0; k < 9; k++) out.push({ t0: (f0 - k) / fps, n: Math.round(34 * wild), seed: (f0 - k) * 7 + 3, s: 0.9 });
  }
  return out;
}

// ------------------------------------------------------------------------------------- draw

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const pal = palette(S);
  const st = story(F, P, S);
  const sh = shotAt(t, st);
  const K = kaiserAt(t, st, P);
  const cam = cameraFor(sh, t, st, K, P, F);
  const c = F.c;

  // ---- the stadium, reacting to the music
  const kick = clamp(((c.kick ?? 0) - 0.4) / 0.55);
  const flare = Math.pow(kick, 1.4);
  const wild = smooth((t - st.kaiserT) / 0.5);
  const beatOn = t >= st.beatIn ? 1 : 0.3;
  const energy = clamp(0.3 + 0.25 * (c.drums_rel ?? 0) * beatOn + 0.7 * wild);
  const kpos = ST.figureAt(cam, K.x, K.z);
  const close = kpos && kpos.s > 25;
  ST.drawStadium(g, cam, {
    t, mt: c.mt, palette: pal, energy, jump: 0.45 * beatOn + 0.7 * wild, flare: clamp(flare + 0.5 * wild * (c.hit ?? 0)),
    light: [{ x: 0, z: 0, r: 48, a: 0.06 }, { x: K.x, z: K.z - 1, r: 13, a: 0.1 + 0.05 * flare }],
    sparkle: { steady: 110 + Math.round(250 * wild), flashes: flashesAt(F, t, wild), life: 0.3 },
    boardPulse: clamp(0.25 * (c.snare ?? 0) + 0.3 * wild * (c.hit ?? 0)),
    soft: close ? 0.5 : 0,
  });

  // ---- the figures, far to near
  const items = [];
  const kview = sh.shot === 'finale' ? 'front' : 'side';
  const ball = ballAt(t, F, st, K, P);
  for (const d of st.dodges) {
    const df = defenderAt(d, t, st, P, F);
    if (!df) continue;
    const f = ST.figureAt(cam, df.x, df.z, { height: 1.82, designH: 290 });
    if (!f || f.d > 160) continue;
    items.push({ kind: 'rival', d: f.d, f, df, dd: d });
  }
  if (sh.intro) {                                   // the back line, far ahead, before the beat drops
    for (let i = 0; i < 4; i++) {
      const df = { x: (i - 1.5) * 9 + 3 * Math.sin(i * 2.1), z: K.z - 24 - 5 * (i % 2) + 2.5 * (t - st.t0), vx: 0, vz: 1, pose: cycles.run(c.mt * 0.8 + i * 0.3, 0.6), lying: 0 };
      const f = ST.figureAt(cam, df.x, df.z, { height: 1.82, designH: 290 });
      if (f) items.push({ kind: 'rival', d: f.d, f, df });
    }
  }
  if (kpos) items.push({ kind: 'kaiser', d: kpos.d, f: kpos });
  const bp = ST.project(cam, ball.x, ball.y, ball.z);
  if (bp) items.push({ kind: 'ball', d: bp.d, p: bp });
  items.sort((a, b) => b.d - a.d);

  // shadows first (on the ground under everything)
  for (const it of items) {
    if (it.kind === 'rival') ST.drawShadow(g, cam, it.df.x, it.df.z, { a: 0.45, lift: it.df.pose.bob * 1.8 });
    else if (it.kind === 'kaiser') ST.drawShadow(g, cam, K.x, K.z, { a: 0.55 });
    else ST.drawShadow(g, cam, ball.x, ball.z, { r: 0.16, a: 0.5, len: 0.4, lift: ball.y - 0.11 });
  }

  // the crown's light rays sit behind him
  if (kpos && t >= st.emperorT) crownRays(g, t, st, kpos, pal);

  const kpose = kaiserPose(t, F, st, K, kview);
  const kfacing = kview === 'front' ? 1 : facingOf(cam, K.x, K.z, 0, -1, -1);
  if (kpos) drawEcho(g, t, F, st, P, cam, K, kview, kfacing, pal);
  const rivalD = rivalDesign(pal.rival, pal.rivalShorts);
  // all figures into one lit layer (cel shade + rim light from the floodlights)
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const it of items) {
    const p = it.f || it.p;
    const Hh = it.kind === 'ball' ? 0.3 * p.s : 1.9 * p.s;
    bx0 = Math.min(bx0, p.x - Hh * 0.8); bx1 = Math.max(bx1, p.x + Hh * 0.8);
    by0 = Math.min(by0, p.y - Hh * 1.15); by1 = Math.max(by1, p.y + Hh * 0.2);
  }
  if (items.length && bx1 > 0 && bx0 < 1920 && by1 > 0 && by0 < 1080) {
    const light = kpos ? ST.lightDir(cam, kpos.x, kpos.y - 300) : [-0.5, -0.8];
    ST.litFigures(g, (lc) => {
      for (const it of items) {
        if (it.kind === 'rival') {
          const { df, f } = it;
          const facing = facingOf(cam, df.x, df.z, df.vx, df.vz, 1);
          drawPuppet(lc, rivalD, df.pose, { x: f.x, ground: f.y, scale: f.scale, facing, view: 'side', devScale: g.scale });
        } else if (it.kind === 'ball') {
          if (!(ball.stopped > 0.5 && kview === 'front')) drawBall(lc, it.p.x, it.p.y, Math.max(1.5, 0.11 * it.p.s), { rot: ball.rot });
        } else {
          const j = drawPuppet(lc, KAISER, kpose, { x: kpos.x, ground: kpos.y, scale: kpos.scale, facing: kfacing, view: kview, devScale: g.scale });
          if (ball.stopped > 0.5 && kview === 'front') {      // his sole on the ball
            const r = Math.max(2, 0.11 * kpos.s);
            drawBall(lc, j.toeR[0] + r * 0.1, Math.min(kpos.y - r, j.toeR[1] + r * 0.75), r, { rot: ball.rot });
            drawPuppet(lc, KAISER, kpose, { x: kpos.x, ground: kpos.y, scale: kpos.scale, facing: kfacing, view: kview, devScale: g.scale });
          }
        }
      }
    }, [bx0, by0, bx1, by1], light, { rimW: 3.2, shadeW: 9 });
  }

  // ---- manga effects and the crown
  fxLayer(g, t, F, st, P, cam, K, kpos, sh, pal);
  ST.drawFlares(g, cam, { palette: pal, flare: flare * 0.8 + 0.3 * wild * (c.hit ?? 0) });
}

/** The gold light rays and glow behind the crown (drawn behind him). */
function crownRays(g, t, st, kpos, pal) {
  const { ctx } = g;
  const u = t - st.emperorT;
  const H = 1.85 * kpos.s;
  const cx = kpos.x, cy = kpos.y - H * 1.2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = g.sprites.glow(pal.gold, 0);
  const r = H * (0.9 + 1.4 * Math.exp(-u / 0.25));
  ctx.globalAlpha = 0.35 + 0.5 * Math.exp(-u / 0.3);
  ctx.drawImage(glow, cx - r, cy - r, 2 * r, 2 * r);
  ctx.globalAlpha = 1;
  rays(ctx, { cx, cy, n: 16, rot: 0.3 + t * 0.18, spread: 0.03, length: H * (1.9 + 1.5 * Math.exp(-u / 0.35)),
    color: g.color.css(pal.gold, 0.15 + 0.35 * Math.exp(-u / 0.3)), fade: g.color.css(pal.gold, 0) });
  ctx.restore();
}

/** Kaiser's sidestep after-images: blue silhouettes at earlier times, screened over the scene. */
function drawEcho(g, t, F, st, P, cam, K, kview, kfacing, pal) {
  const d = K.dodge;
  if (!d || kview !== 'side') return;
  const tau = t - d.tD;
  const env = smooth((tau + 0.04) / 0.05) * (1 - smooth((tau - 0.18) / 0.3));
  if (env <= 0.02) return;
  const L = g.layer('kzEcho');
  // fx.echo walks the trail oldest first; alpha decays per step (k = 0 is now, drawn in full colour later)
  echo(t, Math.max(2, Math.round(P.echoN)), 0.034, (tk, alpha, k) => {
    if (k === 0) return;
    const Kk = kaiserAt(tk, st, P);
    const fk = ST.figureAt(cam, Kk.x, Kk.z);
    if (!fk) return;
    const col = ST.mixHex('#000000', pal.echo, alpha * env);   // screened: darker = more transparent
    drawPuppet(L.ctx, ST.silhouette(KAISER, col), kaiserPose(tk, F, st, Kk, kview), { x: fk.x, ground: fk.y, scale: fk.scale, facing: kfacing, view: kview, devScale: g.scale });
  }, { decay: 0.8 });
  const { ctx } = g;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(L.canvas, 0, 0);
  ctx.restore();
}

/** Speed lines on sidesteps, streaks on snares, the crown at the end. */
function fxLayer(g, t, F, st, P, cam, K, kpos, sh, pal) {
  const { ctx } = g;
  const c = F.c;
  if (!kpos) return;
  const H = 1.85 * kpos.s;
  const cx = kpos.x, cy = kpos.y - H * 0.55;
  // speed-line burst on each sidestep
  const d = K.dodge;
  if (d) {
    const tau = t - d.tD;
    const a = tau < 0 ? 0 : Math.exp(-tau / 0.16);
    if (a > 0.03) speedLines(ctx, { cx, cy, n: 70, inner: H * 0.85, outer: 1500, color: '#FFFFFF', alpha: 0.42 * a, seed: 31 + d.k, frame: F.frame, hold: 2, width: 0.0045 });
  }
  // white streaks rushing past on snares, along the screen direction the world streams past him
  const sn = clamp((c.snare ?? 0) * 1.1) * (t >= st.beatIn && t < st.kaiserT ? 1 : 0);
  if (sn > 0.05 && sh.shot !== 'finale') {
    const a0 = ST.project(cam, K.x, 1, K.z), a1 = ST.project(cam, K.x, 1, K.z + 3);
    let ang = 0;
    if (a0 && a1) ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);
    if (sh.shot === 'wide') ang = 0.4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    streakLines(ctx, { angle: ang, n: 34, color: '#FFFFFF', alpha: 0.32 * sn, seed: 5 + Math.floor(c.mt), t, speed: 3600 });
    ctx.restore();
  }
  // the crown at emperorT (its rays are drawn behind him), until the end
  if (t >= st.emperorT) {
    const u = t - st.emperorT;
    const pop = u < 0.1 ? lerp(0.55, 1.3, outExpo(u / 0.1)) : 1 + 0.3 * Math.exp(-(u - 0.1) / 0.16);
    const w = H * 0.22 * pop;
    const y = kpos.y - H * 1.08 - 4 * Math.sin(t * 2.4);
    drawCrown(ctx, cx, y, w, { fill: pal.gold, lineW: Math.max(1.5, w * 0.045) });
    const glint = Math.exp(-u / 0.12);
    if (glint > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const star = ST.starSprite(g, pal.gold);
      const r = w * (0.8 + 1.6 * glint);
      ctx.globalAlpha = glint;
      ctx.drawImage(star, cx - r, y - w * 0.4 - r, 2 * r, 2 * r);
      ctx.restore();
    }
  }
}
