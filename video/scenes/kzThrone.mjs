// B2 THE THRONE ROOM. Kaiser (the kit and the red ermine cape) lounges sideways on a gold-and-crimson
// throne at the top of a red carpet, legs crossed, chin on his hand, smirking at us, the ball at his
// feet, bouquets of blue roses piled around him. The framing cuts every few bars on a downbeat through
// a wide symmetric shot of the hall, a medium shot of him lounging, a close-up of his face and hand, a
// low angle from the floor past the ball and a slow dolly along the bouquets. On kicks the candle
// flames flare and the bouquets pulse; on snares gold dust bursts; the chains swing to the beat;
// petals drift down all the time. The hall itself is the shared builder in lib/kzroyal.mjs.

import { KAISER } from './lib/kaiser.mjs';
import { speedLines } from './lib/kaiser.mjs';
import {
  HALL, KAISER_H, royalPalette, rgba, camera, project, drawHall, drawSet, drawShafts, drawPetals, drawGoldDust,
  drawMotes, drawGlint, loungePose, faceSpots, drawPool, focusLight, warmRoyal, drawFlames, veil, blinkAt, drawEyelids, cornerTone,
} from './lib/kzroyal.mjs';
import { solve } from './lib/puppet.mjs';

export const meta = { type: 'kzThrone', budgetMs: 160 };

export const defaults = {
  shotBars: 4,                      // a new framing every this many bars, on a downbeat
  shots: ['wide', 'medium', 'close', 'low', 'dolly'],
  pulse: 0.06,                      // bouquet pulse on kicks (fraction)
  swing: 0.07,                      // chain swing (radians)
  petals: 26,                       // petals per depth layer
  dustLife: 1.1,                    // gold dust burst life (s)
  impact: 0.35,                     // manga impact lines on each cut (s)
};

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const land = (t, fps) => Math.floor(t * fps + 0.5) / fps;

// Shot boundaries: the entry start, then the first downbeat at least (shotBars - 0.5) bars after the
// previous cut, never leaving less than a bar for the last shot. Cached per entry and grid.
const planCache = new Map();
function shotPlan(F, S, P) {
  const bars = Math.max(1, P.shotBars || 4);
  const key = `${S.t0}|${S.t1}|${bars}|${F.ev.downbeats.length}`;
  let plan = planCache.get(key);
  if (!plan) {
    const bar = F.beatS * F.bpb;
    const cuts = [S.t0];
    for (const d0 of F.ev.downbeats) {
      const d = land(d0, F.fps);
      if (d <= S.t0 + 1e-6 || d > S.t1 - bar) continue;
      if (d - cuts[cuts.length - 1] >= (bars - 0.5) * bar - 1e-6) cuts.push(d);
    }
    plan = cuts;
    if (planCache.size > 16) planCache.delete(planCache.keys().next().value);
    planCache.set(key, plan);
  }
  return plan;
}

function currentShot(F, S, P, t) {
  const cuts = shotPlan(F, S, P);
  let i = 0;
  while (i + 1 < cuts.length && t >= cuts[i + 1] - 1e-6) i++;
  const a = cuts[i], b = i + 1 < cuts.length ? cuts[i + 1] : S.t1;
  const list = Array.isArray(P.shots) && P.shots.length ? P.shots : defaults.shots;
  return { kind: list[i % list.length], i, a, b, u: clamp((t - a) / Math.max(1e-3, b - a)), age: t - a };
}

// Kaiser's head position in metres (from the solved pose), for framing close-ups.
const headCache = new Map();
function headWorld(pose) {
  const key = Object.values(pose).map((v) => v.toFixed(3)).join(',');
  let h = headCache.get(key);
  if (!h) {
    const j = solve(KAISER, pose, { x: 0, y: 0, scale: 1, view: 'side' });
    const k = KAISER_H / j.U;
    h = [HALL.pelvis[0] + j.headC[0] * k, HALL.pelvis[1] - j.headC[1] * k, HALL.pelvis[2]];
    if (headCache.size > 64) headCache.delete(headCache.keys().next().value);
    headCache.set(key, h);
  }
  return h;
}

function shotCamera(kind, u, t, head) {
  const drift = Math.sin(t * 0.45) * 0.03;
  const [px, , pz] = HALL.pelvis;
  switch (kind) {
    case 'medium':                // him lounging, the throne around him
      return camera({ x: lerp(px + 0.5, px + 0.36, ease(u)), y: 1.98 + drift, z: lerp(pz - 2.75, pz - 2.4, ease(u)), f: 1150, px: 960, py: 495 });
    case 'close': {               // face and hand, the head large
      const dz = lerp(0.84, 0.7, ease(u));
      return camera({ x: head[0] + 0.03, y: head[1] - 0.1 + drift * 0.2, z: head[2] - dz, f: 1080, px: 990, py: 520 });
    }
    case 'low':                   // from the floor of the dais, past the ball
      return camera({ x: lerp(0.02, -0.14, ease(u)), y: 1.14, z: lerp(3.3, 3.38, ease(u)), f: 860, py: 1000, roll: -0.09 });
    case 'dolly':                 // along the bouquets on the top step
      return camera({ x: lerp(-3.4, 3.4, u), y: 1.52, z: 1.25, f: 1000, py: 600 });
    case 'wide':
    default:                      // the symmetric hall, slowly pushing in
      return camera({ x: 0, y: 1.72 + drift, z: lerp(-8.2, -6.6, ease(u)), f: 1120, py: 575 });
  }
}

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const C = royalPalette(S);
  warmRoyal(g, C);
  const shot = currentShot(F, S, P, t);
  const kick = clamp(F.c.kick || 0);
  const mt = F.c.mt || 0;
  const breathe = Math.sin(t * 1.7);
  const pose = loungePose(KAISER, { breathe, tilt: 0.05 * kick });
  const head = headWorld(loungePose(KAISER, {}));
  const cam = shotCamera(shot.kind, shot.u, t, head);

  ctx.save();
  if (cam.roll) { ctx.translate(960, 540); ctx.rotate(cam.roll); ctx.translate(-960, -540); }
  drawHall(g, cam, C, { moon: 1, soft: shot.kind !== 'wide' });
  drawPool(g, cam, HALL.throne.x - 0.2, HALL.dais.y + 0.01, HALL.throne.z - 0.9, 1.9, C.candle, 0.22 + 0.2 * kick);
  drawShafts(g, cam, C, { amt: 0.85 + 0.45 * kick, spot: 0.8 + 0.5 * kick, t });

  const swing = (P.swing ?? defaults.swing) * Math.cos(Math.PI * mt) + 0.03 * kick;
  // gold dust on snares: a burst of sparks behind him, like an aura flaring
  const life = P.dustLife ?? defaults.dustLife;
  const sn = F.between('snare', t - life, t + 1e-6).filter((e) => e[1] > 0.45).map((e) => [land(e[0], F.fps), e[2] ?? e[1]]);
  const blink = shot.kind === 'close' || shot.kind === 'medium' ? blinkAt(t, 3) : 0;
  const set = drawSet(g, cam, C, {
    t, kick: kick * kick, swing, bouquetPulse: kick * ((P.pulse ?? defaults.pulse) / 0.06),
    ballRot: 0.2 * Math.sin(t * 0.5), nearClip: shot.kind === 'low' || shot.kind === 'close' ? 1.0 : 0, deferFlames: true,
    onThrone: shot.kind === 'close' ? () => {
      veil(g, C, { t, kick });
      cornerTone(g, C.velvet, { alpha: 0.32 });
    } : null,
    kaiser: {
      design: KAISER, pose, wind: -0.35, cape: 0.62, halo: (shot.kind === 'wide' ? 0.3 : 0.1) + 0.12 * kick, haloColor: C.moon,
      rim: 0.9, rimColor: '#D6E6FF', rimDir: [-4, -3],
      before: (p, U) => drawGoldDust(g, C, {
        t, births: sn, life, seed: 3, n: 26, spread: 0.75 * U, r0: 0.16 * U, size: Math.max(0.7, Math.min(3, U / 600)),
        origin: () => [p.x + 0.02 * U, p.y - 0.45 * U],
      }),
      after: (j) => { if (blink > 0) drawEyelids(ctx, KAISER, j, blink); },
    },
  });
  const kp0 = project(cam, HALL.pelvis[0] + 0.05, HALL.pelvis[1] + 0.45, HALL.pelvis[2]);
  if (kp0 && shot.kind !== 'close') focusLight(g, kp0.x, kp0.y, shot.kind === 'wide' ? 520 : 680, 0.72);
  drawFlames(g, C, set.flames, { t, kick: kick * kick });

  const fp = set.kj ? faceSpots(KAISER, set.kj) : null;
  const kp = project(cam, HALL.pelvis[0], HALL.pelvis[1] + 0.5, HALL.pelvis[2]);
  // manga focus lines converge on him from below in the low angle
  if (shot.kind === 'low' && fp) {
    speedLines(ctx, { cx: fp.eyes[0][0], cy: fp.eyes[0][1], n: 70, inner: 520, outer: 1900, color: '#000008', alpha: 0.22, seed: 9, frame: F.frame, hold: 2, width: 0.008 });
  }
  // a glint in his eye as the close-up lands
  if (shot.kind === 'close' && fp) {
    const a = Math.exp(-shot.age / 0.28);
    if (a > 0.02) drawGlint(g, fp.eyes[1][0] - fp.r * 0.06, fp.eyes[1][1] - fp.r * 0.06, fp.r * 0.38 * (0.6 + 0.4 * a), { alpha: 0.9 * a, rot: 0.3 + shot.age });
  }
  drawMotes(g, C, { t, box: [0, 0, 1920, 1080], n: 36, alpha: 0.6 });
  drawPetals(ctx, C, { t, count: P.petals ?? defaults.petals, parallax: cam.x * 120 });

  // manga impact lines on the cut into each new framing
  const imp = P.impact ?? defaults.impact;
  if (shot.i > 0 && shot.age < imp) {
    const a = 1 - shot.age / imp;
    const c = fp ? { x: fp.eyes[0][0], y: fp.eyes[0][1] } : kp || { x: 960, y: 540 };
    const inner = fp ? Math.max(260, fp.r * 2.6) : 420;
    speedLines(ctx, { cx: c.x, cy: c.y, n: 110, inner, outer: 2000, color: '#FFFFFF', alpha: 0.55 * a * a, seed: 41 + shot.i, frame: F.frame, hold: 2, width: 0.01 });
  }
  ctx.restore();
}
