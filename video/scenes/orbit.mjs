// C1 in the new key: young love as a filled disc (the self) and a hollow ring (her) orbiting the
// home line, one turn per 2 bars, level on the line on every downbeat. A bone tether joins them
// until the feelings-gone line, where it snaps at the midpoint and each half retracts into its
// body; the orbit then widens. Friends arrive as touching pairs of bone dots that drop onto the
// line one per downbeat and never move again. Over the last 2 bars the pair brakes with continuous
// speed and stops level on the line, side by side on home, through the held tonic.
//
// Pure: every value comes from (t, F, P, S). Past orbit angles are rebuilt from the mt column (and
// the brake curve, a function of the downbeat grid); nothing is carried between frames.

import { HOME_Y, X0, X1, voiceMidi } from './lib/linekit.mjs';

export const meta = { type: 'orbit', budgetMs: 3 };

export const defaults = {
  homeY: HOME_Y,
  cx: 960,
  tonicMidi: 59,
  tetherSnap: null,     // s (landing frame of the feelings-gone line)
  friendsT0: null,      // s (landing frame of the first friends downbeat)
  brakeT0: null,        // s (landing frame of the brake's first downbeat)
  apart: 0,
  ringAlpha: 1,
  tether: 1,
  brake: 0,
  friends: 0,
  baseR: 26,
  spreadR: 400,
  turnBeats: 8,         // one turn per 2 bars
  brakeBars: 2,
  stopBeats: 4,         // the brake adds 4 beats of angle (half a turn) and holds
  trailDeg: 90,
  trailSegs: 24,
  trailW: 1.5,
  trailA: 0.75,
  retract: 0.4,         // s, outExpo
  friendR: 6,
  friendY0: 300,
  friendX: 480,
  friendStep: 64,
  lineIn: 1,            // beats: amber -> bone at the start of the entry
};

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const outExpo = (x) => { x = clamp(x); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); };
const TAU = Math.PI * 2;

/** Landing time of an event (README timing rule: frame floor(t * fps + 0.5)). */
const land = (x, fps) => Math.floor(x * fps + 0.5) / fps;
const landFrame = (x, fps) => Math.floor(x * fps + 0.5);

/** Index of the downbeat that lands on the same frame as time x (pure; cached per event object). */
const dbCache = new WeakMap();
function downbeatAt(F, x) {
  let m = dbCache.get(F.ev);
  if (!m) { m = new Map(); dbCache.set(F.ev, m); }
  const fr = landFrame(x, F.fps);
  let i = m.get(fr);
  if (i === undefined) {
    const db = F.ev.downbeats || [];
    i = -1;
    let best = Infinity;
    for (let k = 0; k < db.length; k++) {
      const d = Math.abs(landFrame(db[k], F.fps) - fr);
      if (d < best) { best = d; i = k; }
    }
    if (best > 1) i = -1;
    m.set(fr, i);
  }
  return i;
}

/**
 * The orbit's warped beat count at any time tau: the mt column until the brake starts, then
 * mt(brakeT0) + stop*(2u - u^2) with u linear across the brake bars (holds once u = 1). The brake
 * span runs from the brakeT0 downbeat to the downbeat brakeBars later (landing frames). uNow, when
 * given, is the treatment's own P.brake at the current time.
 */
function warp(F, P) {
  const t0 = P.brakeT0;
  if (t0 === null || t0 === undefined) return { at: (tau) => F.col('mt', tau), t0: Infinity, t1: Infinity };
  const fps = F.fps;
  const ib = downbeatAt(F, t0);
  const db = F.ev.downbeats || [];
  const bars = Math.round(P.brakeBars);
  const t1 = ib >= 0 && ib + bars < db.length
    ? land(db[ib + bars], fps)
    : t0 + bars * F.bpb * F.beatS;
  const mt0 = F.col('mt', t0);
  const stop = P.stopBeats;
  const at = (tau, uGiven) => {
    if (tau < t0) return F.col('mt', tau);
    const u = uGiven !== undefined ? clamp(uGiven) : clamp((tau - t0) / (t1 - t0));
    return mt0 + stop * (2 * u - u * u);
  };
  return { at, t0, t1 };
}

export function draw(g, t, F, P, S) {
  const { ctx, W, H, color } = g;
  const pal = S.palette;
  const ink = pal.ink || '#0F0D0B';
  const bone = pal.bone || '#EDE7DA';
  const amber = pal.amber || '#F0A23B';
  const fps = F.fps;
  const home = P.homeY;
  const cx = P.cx;
  const beat = F.beatS;

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);

  // ---- home line: full width from the first frame, amber (lifted to gold) -> bone over a beat ----
  const lk = Math.round(smooth((t - S.t0) / (P.lineIn * beat)) * 48) / 48;
  const lineHex = lk >= 1 ? bone : lk <= 0 ? amber : color.mix(amber, bone, lk);
  const lw = 1.5 + 1.5 * clamp(F.c.bass_lvl);
  ctx.fillStyle = lineHex;
  ctx.fillRect(X0, home, X1 - X0, lw);   // hangs from y = home downwards, as in every scene

  // ---- friends: one touching pair per downbeat from friendsT0, dropping onto the line ----
  const nFriends = Math.max(0, Math.round(P.friends));
  if (nFriends > 0 && P.friendsT0 !== null && P.friendsT0 !== undefined) {
    const i0 = downbeatAt(F, P.friendsT0);
    const db = F.ev.downbeats || [];
    const fr = P.friendR;
    const yLand = home - fr;
    ctx.fillStyle = bone;
    for (let k = 0; k < nFriends; k++) {
      const ts = i0 >= 0 && i0 + k < db.length ? land(db[i0 + k], fps) : P.friendsT0 + k * F.bpb * beat;
      if (t < ts - 1e-6) continue;
      const side = k % 2 === 0 ? -1 : 1;
      const x = cx + side * (P.friendX + P.friendStep * Math.floor(k / 2));
      const y = P.friendY0 + (yLand - P.friendY0) * outExpo((t - ts) / beat);
      ctx.beginPath();
      ctx.arc(x - fr, y, fr, 0, TAU);
      ctx.arc(x + fr, y, fr, 0, TAU);
      ctx.fill();
    }
  }

  // ---- the orbit ----
  const Wp = warp(F, P);
  const uNow = t >= Wp.t0 ? P.brake : undefined;
  const mtw = Wp.at(t, uNow);
  const turn = P.turnBeats;
  const R = P.baseR + P.spreadR * P.apart;
  const ang = (m) => (TAU * m) / turn;                  // maths angle (counter-clockwise on screen)
  const th = ang(mtw);
  const sx = cx + R * Math.cos(th), sy = home - R * Math.sin(th);
  const hx = cx - R * Math.cos(th), hy = home + R * Math.sin(th);
  const ringA = clamp(P.ringAlpha);
  const ringR = 22;
  const ringW = 1 + 2.5 * clamp(F.c.pad_lvl);
  const selfR = 20 + 4 * clamp(F.c.voc_lvl) + 3 * F.c.kick * clamp(F.c.drums_rel);

  // trails: the last trailDeg of each path, sampled back in time over the wall-clock span that
  // covers trailDeg at full speed. Angles come from the warped beat count at those earlier times,
  // so while braking the trail shrinks with the real angular speed and vanishes once stopped.
  const nSeg = Math.max(1, Math.round(P.trailSegs));
  const span = (P.trailDeg / 360) * turn * beat;
  if (R > 1 && P.trailA > 0) {
    const phis = new Float64Array(nSeg + 1);
    for (let k = 0; k <= nSeg; k++) {
      const tau = Math.max(S.t0, t - (span * k) / nSeg);
      phis[k] = -ang(k === 0 ? mtw : Wp.at(tau));   // canvas angle of the self
    }
    ctx.lineWidth = P.trailW;
    ctx.lineCap = 'butt';
    // each trail leaves its body at the rim (the ring is hollow: no trail inside it)
    const rimAng = (r) => (r >= 2 * R ? Math.PI : 2 * Math.asin(r / (2 * R)));
    for (const [off, a0, rim] of [[0, P.trailA, rimAng(selfR)], [Math.PI, P.trailA * ringA, rimAng(ringR + ringW / 2)]]) {
      if (a0 <= 0.004) continue;
      const head = phis[0] + off + rim;
      for (let k = 0; k < nSeg; k++) {
        const pNew = Math.max(head, phis[k] + off), pOld = phis[k + 1] + off;
        if (pOld - pNew < 1e-4) continue;             // no movement over this slice
        const a = a0 * (1 - (k + 0.5) / nSeg);
        ctx.strokeStyle = color.css(amber, Math.round(a * 64) / 64);
        ctx.beginPath();
        ctx.arc(cx, home, R, pNew, pOld, false);
        ctx.stroke();
      }
    }
  }

  // tether: 1 px bone between the centres (ending at her rim); at tetherSnap it parts at the
  // midpoint and each half retracts into its own body (outExpo over P.retract seconds)
  const dx = hx - sx, dy = hy - sy;
  const dist = Math.hypot(dx, dy);
  if (dist > selfR + ringR + 1) {
    const ux = dx / dist, uy = dy / dist;
    const herEnd = dist - ringR;                       // along the line from the self
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = color.css(bone, 0.8);
    if (P.tether >= 0.5) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + ux * herEnd, sy + uy * herEnd);
      ctx.stroke();
    } else if (P.tetherSnap !== null && P.tetherSnap !== undefined && t >= P.tetherSnap - 1e-6) {
      const k = outExpo((t - P.tetherSnap) / P.retract);
      if (k < 0.999) {
        const mid = dist / 2;
        const gap = 6;                                 // the break itself, from the snap frame
        const selfLen = (mid - gap) * (1 - k);
        const herLen = (herEnd - mid - gap) * (1 - k);
        ctx.beginPath();
        if (selfLen > selfR * 0.5) {
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + ux * selfLen, sy + uy * selfLen);
        }
        if (herLen > 0.5) {
          ctx.moveTo(sx + ux * herEnd, sy + uy * herEnd);
          ctx.lineTo(sx + ux * (herEnd - herLen), sy + uy * (herEnd - herLen));
        }
        ctx.stroke();
      }
    }
  }

  // her: a hollow ring
  if (ringA > 0.004) {
    ctx.lineWidth = ringW;
    ctx.strokeStyle = color.css(amber, Math.round(ringA * 128) / 128);
    ctx.beginPath();
    ctx.arc(hx, hy, ringR, 0, TAU);
    ctx.stroke();
  }

  // the self: a filled disc; a 1 px bone outline while the voice holds the tonic
  ctx.fillStyle = amber;
  ctx.beginPath();
  ctx.arc(sx, sy, selfR, 0, TAU);
  ctx.fill();
  const vm = voiceMidi(F, t);
  if (vm >= 0 && Math.round(vm) === P.tonicMidi) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = bone;
    ctx.beginPath();
    ctx.arc(sx, sy, selfR + 0.5, 0, TAU);
    ctx.stroke();
  }
}
