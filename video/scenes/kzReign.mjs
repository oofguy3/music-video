// D2 THE REIGN, the outro: the aftermath, calm but alive. The same throne hall (lib/kzroyal.mjs):
// Kaiser in his burgundy suit and the ermine-trimmed cape, crowned, lounges on the throne in a single
// cool spotlight while rose petals fall slowly and the candles flicker; kicks still pulse in the lights.
//   [t0, voiceOut)        a medium shot of him crowned on the throne
//   [voiceOut, voiceIn)   the vocal is out: the camera slowly circles the throne, the hall dim, only the
//                         beat in the candle flares
//   [voiceIn, voiceOut2)  a slow push-in towards his face; the rose on his neck glows on every vocal note
//   [voiceOut2, padOut)   a close-up of his eyes; one last glint
//   [padOut, end)         the hall again, pushing in as the candles go out one by one on the last beats;
//                         from bassOut only the crown and his eyes glow while the engine fades to black
// Times come from P (event references in the treatment); negative defaults are fractions of the entry.

import { KAISER_SUIT, KZ } from './lib/kaiser.mjs';
import { solve } from './lib/puppet.mjs';
import {
  HALL, KAISER_H, CANDELABRA, royalPalette, rgba, mixHex, camera, orbitCamera, drawHall, drawSet, drawFlames, drawShafts,
  drawSpotCone, focusLight, drawPetals, drawMotes, drawGlint, drawSmoke, loungePose, faceSpots, crownOn, warmRoyal, veil, roseOn,
} from './lib/kzroyal.mjs';

export const meta = { type: 'kzReign', budgetMs: 140 };

export const defaults = {
  voiceOut: -0.06, voiceIn: -0.29, voiceOut2: -0.62, padOut: -0.76, drumsOut: -0.765, bassOut: -0.885,
  orbit: 0.75,                      // radians travelled around the throne while the voice is out
  petals: 16,
  snuff: 0.28,                      // seconds a candle takes to die
};

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const easeIO = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
const land = (t, fps) => Math.floor(t * fps + 0.5) / fps;

function times(P, S, fps) {
  const at = (v) => land(typeof v === 'number' && v >= 0 ? v : S.t0 + -(v ?? -0.5) * (S.t1 - S.t0), fps);
  const T = { out: at(P.voiceOut), in: at(P.voiceIn), out2: at(P.voiceOut2), pad: at(P.padOut), drums: at(P.drumsOut), bass: at(P.bassOut) };
  T.in = Math.max(T.in, T.out); T.out2 = Math.max(T.out2, T.in); T.pad = Math.max(T.pad, T.out2);
  T.drums = Math.max(T.drums, T.pad - 1); T.bass = Math.max(T.bass, T.pad);
  return T;
}

// Kaiser's head in metres for a pose (cached), to aim the close framings.
const headCache = new Map();
function headWorld(pose) {
  const key = Object.values(pose).map((v) => v.toFixed(3)).join(',');
  let h = headCache.get(key);
  if (!h) {
    const j = solve(KAISER_SUIT, pose, { x: 0, y: 0, scale: 1, view: 'side' });
    const k = KAISER_H / j.U, r = KAISER_SUIT.headR * j.U;
    const eyeY = j.headC[1] + 0.52 * r * Math.cos(j.headAng), eyeX = j.headC[0] - 0.52 * r * Math.sin(j.headAng);
    h = {
      head: [HALL.pelvis[0] + j.headC[0] * k, HALL.pelvis[1] - j.headC[1] * k, HALL.pelvis[2]],
      eyes: [HALL.pelvis[0] + eyeX * k + 0.03 * r * k, HALL.pelvis[1] - eyeY * k, HALL.pelvis[2]],
    };
    if (headCache.size > 64) headCache.delete(headCache.keys().next().value);
    headCache.set(key, h);
  }
  return h;
}

// The order the candelabras go out: the ones in view of the last shot first (outer to inner), then the rest.
const SNUFF_ORDER = (() => {
  const idx = CANDELABRA.map((c, i) => i);
  const score = (i) => { const [X, , Z] = CANDELABRA[i]; return Z > -3 ? -100 + Math.abs(X) * -10 + Z * 0.1 : -Z; };
  return idx.sort((a, b) => score(a) - score(b));
})();

/** 0..1 how lit candelabra i is at t, and when it went out (for its smoke). */
function candleState(i, t, beats, T, snuff) {
  const rank = SNUFF_ORDER.indexOf(i);
  const k = Math.min(rank, beats.length - 1);
  if (k < 0 || !beats.length) return { lit: t < T.bass ? 1 : 0, out: T.bass };
  const tOut = Math.min(beats[k], T.bass);
  return { lit: 1 - clamp((t - tOut) / snuff), out: tOut };
}

function cameraFor(phase, t, T, S, P, h) {
  const [px, , pz] = HALL.pelvis;
  const drift = Math.sin(t * 0.37) * 0.02;
  switch (phase) {
    case 'open': {
      const u = (t - S.t0) / Math.max(0.1, T.out - S.t0);
      return camera({ x: px + 0.42, y: 2.0 + drift, z: lerp(pz - 3.0, pz - 2.8, ease(u)), f: 1120, py: 560 });
    }
    case 'orbit': {
      const u = (t - T.out) / Math.max(0.1, T.in - T.out);
      const th = -0.42 + (P.orbit ?? defaults.orbit) * ease(u);
      return orbitCamera(HALL.throne.x - 0.25, HALL.throne.z, 7.6, th, { y: 2.6, f: 960, py: 600 });
    }
    case 'push': {
      const u = easeIO((t - T.in) / Math.max(0.1, T.out2 - T.in));
      const [hx, hy, hz] = h.head;
      return camera({
        x: lerp(px + 0.35, hx + 0.12, u), y: lerp(2.05, hy - 0.08, u) + drift, z: lerp(pz - 4.2, hz - 0.95, u),
        f: 1100, px: lerp(960, 990, u), py: lerp(570, 520, u),
      });
    }
    case 'eyes': {
      const u = (t - T.out2) / Math.max(0.1, T.pad - T.out2);
      const [ex, ey, ez] = h.eyes;
      return camera({ x: ex, y: ey + 0.004, z: ez - lerp(0.215, 0.19, ease(u)), f: 1000, px: 960, py: 560 });
    }
    case 'last':
    default: {
      const u = easeIO((t - T.pad) / Math.max(0.1, T.bass - T.pad));
      const v = clamp((t - T.bass) / 3);
      const [hx, hy, hz] = h.head;
      return camera({
        x: lerp(0, hx + 0.1, u), y: lerp(1.8, hy - 0.25, u), z: lerp(-4.6, hz - 1.75 + 0.35 * v, u),
        f: lerp(900, 1050, u), px: 960, py: lerp(560, 500, u),
      });
    }
  }
}

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const C = royalPalette(S);
  warmRoyal(g, C);
  const T = times(P, S, F.fps);
  const phase = t < T.out ? 'open' : t < T.in ? 'orbit' : t < T.out2 ? 'push' : t < T.pad ? 'eyes' : 'last';
  const drumsOn = t < T.drums ? 1 : Math.exp(-(t - T.drums) / 0.4);
  const kick = clamp(F.c.kick || 0) * drumsOn;
  const breathe = Math.sin(t * 1.3);
  const pose = loungePose(KAISER_SUIT, { breathe, tilt: 0.03 * kick, handX: -0.03 });
  const h = headWorld(loungePose(KAISER_SUIT, { handX: -0.03 }));
  const cam = cameraFor(phase, t, T, S, P, h);

  // the light: the hall dims while the voice is out and again as the candles die; the spotlight holds
  // until the drums leave and is gone by bassOut
  const beats = F.between('beats', T.pad - 1e-3, T.bass + 0.05).map((b) => land(b, F.fps));
  const snuff = P.snuff ?? defaults.snuff;
  const states = CANDELABRA.map((c, i) => candleState(i, t, beats, T, snuff));
  const litFrac = states.reduce((a, s) => a + s.lit, 0) / states.length;
  const end = clamp((t - T.drums) / Math.max(0.1, T.bass - T.drums));       // 0 -> 1 as the music leaves
  const dimOrbit = phase === 'orbit' ? 0.45 : 0;
  const spot = (1 - ease(end)) * (0.85 + 0.35 * kick);
  const dark = phase === 'last' ? clamp(0.25 + 0.55 * (1 - litFrac) + 0.3 * end + 0.05 * clamp((t - T.bass) / 1.5), 0, 0.96) : 0;

  ctx.save();
  // the aftermath: a darker hall, the moon low in the windows, one cool spotlight from above on him
  if (phase === 'eyes') {                               // only his face and the throne behind it are in frame
    ctx.fillStyle = C.night;
    ctx.fillRect(-40, -40, 2000, 1160);
  } else drawHall(g, cam, C, { moon: 0.7 * (1 - 0.6 * end), dim: 0.25 + dimOrbit * 0.7, soft: phase !== 'orbit' && !(phase === 'last' && t < T.pad + 0.8) });
  drawShafts(g, cam, C, { amt: 0.35 * (1 - end), spot: 0.25 * spot, t });
  drawSpotCone(g, cam, C, HALL.pelvis[0] + 0.25, HALL.pelvis[2] - 0.15, { amt: spot, rTop: 0.3, rBot: 1.45 });

  const voc = vocalGlow(F, t);
  const veilAmt = phase === 'eyes' ? 1 : phase === 'push' ? ease((t - T.in) / Math.max(0.1, T.out2 - T.in) * 1.6 - 0.6) : 0;
  const set = drawSet(g, cam, C, {
    t, kick: kick * kick, swing: 0.04 * Math.cos(Math.PI * (F.c.mt || 0)) * drumsOn, bouquetPulse: kick * 0.7,
    nearClip: phase === 'eyes' || phase === 'push' ? 0.9 : 0, deferFlames: true, turn: phase === 'orbit' ? -cam.yaw : 0,
    onThrone: veilAmt > 0 ? () => veil(g, C, { t, kick, amt: veilAmt, cx: 960, cy: 470 }) : null,
    lit: (i) => states[i].lit,
    kaiser: {
      design: KAISER_SUIT, pose, wind: -0.3, cape: 0.62, crown: 1, cuff: KZ.black,
      halo: (0.2 + 0.14 * kick) * spot, haloColor: C.spot, rim: phase === 'eyes' ? 0 : 0.85 * (1 - end), rimColor: C.spot, rimDir: [-4, -3],
    },
  });
  const kj = set.kj;

  // keep the eye on him: darken away from his face
  const fp = kj ? faceSpots(KAISER_SUIT, kj) : null;
  if (fp && veilAmt < 0.6) {                            // (the veil already does this in the close framings)
    const r = phase === 'push' ? lerp(700, 1100, clamp((t - T.in) / (T.out2 - T.in))) : 620;
    focusLight(g, fp.eyes[0][0], fp.eyes[0][1] + fp.r * 0.6, r, (0.55 + 0.25 * dimOrbit) * (1 - veilAmt));
  }
  if (dark > 0) {                                        // the hall sinks into the dark
    ctx.fillStyle = rgba('#010108', dark);
    ctx.fillRect(-60, -60, 2040, 1200);
  }
  drawFlames(g, C, set.flames, { t, flare: () => kick * kick, flameGlow: 1 + 0.4 * dark });
  // smoke from the wicks that just went out
  for (const f of set.flames) {
    const st = states[f.i];
    if (st.lit < 1 && t - st.out < 2.4) drawSmoke(ctx, f.x, f.y, f.s, t - st.out, f.seed);
  }

  if (fp) {
    // the rose on his neck answers the vocal
    if (voc > 0.01 && phase !== 'orbit') {
      roseOn(ctx, KAISER_SUIT, kj, C, Math.min(1, voc * 1.6) * (1 - dark));
      roseGlow(g, C, fp, voc);
    }
    // after the music: only the crown and his eyes
    const after = clamp((t - T.bass + 0.35) / 0.6);
    const lastGlow = phase === 'last' ? Math.max(after, 0.35 * end) : 0;
    if (lastGlow > 0) {
      ctx.save();
      ctx.globalAlpha = lastGlow;
      const [cx, cy, cw] = crownOn(ctx, KAISER_SUIT, kj, C, { fill: mixHex(C.gold, '#FFFFFF', 0.45) });
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * lastGlow;
      const gs = g.sprites.glow(C.gold, 0);
      ctx.drawImage(gs, cx - cw * 1.6, cy - cw * 1.6, cw * 3.2, cw * 3.2);
      ctx.restore();
      eyeGlow(g, C, fp, lastGlow, t);
    }
    // one last glint
    if (phase === 'eyes') {
      const a = Math.exp(-(t - T.out2) / 0.32);
      const [ex, ey] = fp.eyes[1];
      drawGlint(g, ex - fp.r * 0.07, ey - fp.r * 0.05, fp.r * 0.42 * (0.55 + 0.45 * a), { alpha: 0.95 * a, rot: 0.3 + (t - T.out2) * 0.8 });
      drawGlint(g, fp.eyes[0][0] - fp.r * 0.05, fp.eyes[0][1] - fp.r * 0.05, fp.r * 0.18 * a, { alpha: 0.6 * a, rot: 0.7 });
    }
  }

  // petals fall slowly; dust in the spotlight
  const petalA = 1 - ease(end);                          // gone by bassOut: only the crown and the eyes remain
  drawMotes(g, C, { t, box: [560, 0, 1360, 1080], n: 26, alpha: 0.5 * spot, color: C.spot });
  drawPetals(ctx, C, { t: t * 0.75, count: P.petals ?? defaults.petals, parallax: cam.x * 120 - cam.yaw * 900, alpha: petalA * (phase === 'eyes' ? 0.7 : 1), speed: 0.6, wind: 0.3 });
  ctx.restore();
}

/** Vocal note envelope: each note in F.ev.voc_notes flares and holds while sung. */
function vocalGlow(F, t) {
  let v = 0;
  for (const n of F.between('voc_notes', t - 3, t + 1e-6)) {
    const [t0, t1, , vel] = n;
    const a = t - t0;
    if (a < 0) continue;
    const held = t <= t1 ? 0.55 : 0.55 * Math.exp(-(t - t1) / 0.3);
    v = Math.max(v, (vel ?? 0.6) * (Math.exp(-a / 0.22) + held));
  }
  return clamp(v);
}

function roseGlow(g, C, fp, v) {
  const { ctx } = g;
  const [x, y] = fp.rose, r = fp.r;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.25 + 0.75 * v);
  const gs = g.sprites.glow(C.rose, 1);
  const rr = r * (0.55 + 0.6 * v);
  ctx.drawImage(gs, x - rr, y - rr, 2 * rr, 2 * rr);
  ctx.globalAlpha = 0.5 * v;
  const gs2 = g.sprites.glow(C.roseHi, 0);
  ctx.drawImage(gs2, x - rr * 2.2, y - rr * 2.2, rr * 4.4, rr * 4.4);
  ctx.restore();
}

function eyeGlow(g, C, fp, a, t) {
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gs = g.sprites.glow(KZ.eye, 1);
  for (const [x, y] of fp.eyes) {
    const rr = fp.r * (0.32 + 0.04 * Math.sin(t * 2.1));
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(gs, x - rr, y - rr, 2 * rr, 2 * rr);
    ctx.globalAlpha = 0.35 * a;
    ctx.drawImage(gs, x - rr * 2.4, y - rr * 1.2, rr * 4.8, rr * 2.4);
  }
  ctx.restore();
}
