// A2 break: the void. Drums and bass stop together at the first hard cut. crowd_b1's last frame is
// held perfectly still, then the frozen, numbed crowd is cut into row blocks that drop through the
// home line and out of frame, while the line itself (the pad holding the tonic) stays. The voice is
// a bone dot (the numb wipes drained the self): on home for the restarted opening question, a
// hollow ring once the voice leaves, filled again and riding its pitch when it returns.
//
// From the pivot a gold line fades in one semitone above home. Each drum-fill hit steps it wider;
// over the last beat the whole drawing slides down one semitone while the old bone line fades, so
// the gold line lands on y = home. The 5th and last step lands on the key change itself, the first
// frame of the orbit entry, which draws it at full width: this scene ends at 4 of 5 steps.
//
// Pure: every value comes from (t, F, P, S). The only caches are the ink-keyed copy of the fixed
// snapshot (a pure function of that canvas) and css strings.

import { HOME_Y, X0, X1, COLS, COL_PITCH, ROW_GAP, colX, rowY, voiceMidi, pitchOffset } from './lib/linekit.mjs';

export const meta = { type: 'void', budgetMs: 4 };

export const defaults = {
  tonicMidi: 58,
  pxPerSemi: 18,
  semiClamp: 8,
  homeY: HOME_Y,
  snapEntry: 'crowd_b1',
  holdFrames: 2,
  rows: 5,                // crowd_b1's rows: r = -5..5 (all eleven are present in its last frame)
  blockCols: 7,           // 7 blocks of 7 figures per row strip
  stripH: 40,             // strip spans rowY - 40 .. rowY - 1 (excludes the home line)
  rowDelay: 0.06,         // s per row away from home
  jitter: 0.04,           // s of hashed release jitter per block
  fallG: 2600,            // px/s^2
  fallAlpha: 0.6,         // alpha when a piece leaves the frame
  lineLen: 1536,
  lineA0: 0.25,
  lineAPad: 0.5,
  dotR: 5,
  ringW: 1.5,
  restEase: 0.25,         // s for the dot to settle onto home when the voice pauses
  goldLen0: 240,
  goldLen1: X1 - X0,
  goldA: 0.85,
  stepTau: 0.12,          // outExpo of each fill-hit step
  goldIn: 0,
  shift: 0,
  boneOut: 1,
};

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const outExpo = (x) => { x = clamp(x); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); };
/** README timing rule: an event at time x lands on frame floor(x * fps + 0.5). */
const landF = (x, fps) => Math.floor(x * fps + 0.5);

/**
 * The snapshot with its background ink keyed to black. Pieces are drawn with 'lighten' (per-channel
 * max) over this scene's darker ink: no box of the old ink travels with them, and pieces that pass
 * over each other while falling never add up brighter than a figure. A pure function of the
 * snapshot canvas (the engine renders it from a fixed entry and frame).
 */
const keyed = new WeakMap();
function keyedSnapshot(g, snap) {
  let k = keyed.get(snap);
  if (k) return k;
  const w = snap.width, h = snap.height;
  const id = snap.getContext('2d').getImageData(0, 0, w, h);
  const d = id.data;
  const r0 = d[0], g0 = d[1], b0 = d[2];   // raw (pre-post) frame: the corner is pure ink
  for (let i = 0; i < d.length; i += 4) {
    // background ink -> 0; everything else (figures and their antialiased edges) is kept as drawn
    if (Math.abs(d[i] - r0) <= 3 && Math.abs(d[i + 1] - g0) <= 3 && Math.abs(d[i + 2] - b0) <= 3) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
    }
    d[i + 3] = 255;
  }
  k = g.createCanvas(w, h);
  const kc = k.getContext('2d');
  kc.putImageData(id, 0, 0);
  kc.getImageData(0, 0, 1, 1);
  keyed.set(snap, k);
  return k;
}

/** First [t, stem] event of `stem` inside [a, b). */
function firstEvent(list, stem, a, b) {
  for (const e of list || []) if (e[1] === stem && e[0] >= a && e[0] < b) return e[0];
  return null;
}

/** A crisp horizontal hairline: one device pixel (at least one logical pixel) at a device row. */
function hline(ctx, s, x0, x1, y, style) {
  const lh = Math.max(1, 1 / s);
  const yy = Math.round(y * s) / s;
  const a = Math.round(x0 * s) / s, b = Math.round(x1 * s) / s;
  if (b <= a) return yy + lh / 2;
  ctx.fillStyle = style;
  ctx.fillRect(a, yy, b - a, lh);
  return yy + lh / 2;
}

export function draw(g, t, F, P, S) {
  const { ctx, W, H, color, noise } = g;
  const pal = S.palette;
  const ink = pal.ink || '#070707', bone = pal.bone || '#CFC9BE', gold = pal.gold || '#E6A930';
  const fps = F.fps;
  const s = g.scale;
  const frame = Math.round(t * fps);
  const f0 = Math.round(S.t0 * fps);
  const home = P.homeY ?? HOME_Y;
  const cx = colX(Math.floor(COLS / 2), COL_PITCH, X0);   // 960, the self's column

  // ---- hold: crowd_b1's last frame, untouched ----
  const snapshot = () => g.snapshot(P.snapEntry || 'crowd_b1', S.t0 - 1 / S.fps);
  const hold = Math.max(0, Math.round(P.holdFrames ?? 2));
  if (frame - f0 < hold) {
    const snap = snapshot();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
    return;
  }

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);

  // ---- the fall: row strips cut into blocks, released row by row outward from home ----
  const tRel0 = (f0 + hold) / fps;
  if (t - tRel0 < 2) {
    const K = keyedSnapshot(g, snapshot());
    const nRows = P.rows ?? 5;
    const bc = P.blockCols ?? 7;
    const nBlocks = Math.ceil(COLS / bc);
    const sh = P.stripH ?? 40;
    const G = P.fallG ?? 2600;
    const aEnd = P.fallAlpha ?? 0.6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighten';
    for (let r = -nRows; r <= nRows; r++) {
      const top = rowY(r, ROW_GAP, home) - sh;
      const exitDist = H - top;
      const tExit = Math.sqrt((2 * exitDist) / G);
      for (let b = 0; b < nBlocks; b++) {
        const tr = tRel0 + (P.rowDelay ?? 0.06) * Math.abs(r) + (P.jitter ?? 0.04) * noise.hash01(S.seed, r + 16, b, 5);
        const dt = Math.max(0, t - tr);
        const dy = 0.5 * G * dt * dt;
        if (dy >= exitDist) continue;
        const c0 = b * bc, c1 = Math.min(COLS, c0 + bc);
        const x0 = colX(c0, COL_PITCH, X0) - COL_PITCH / 2;
        const w = (c1 - c0) * COL_PITCH;
        const yd = Math.round((top + dy) * s) / s;   // whole device pixels: an exact copy, no resampling
        ctx.globalAlpha = 1 - (1 - aEnd) * clamp(dt / tExit);
        ctx.drawImage(K, x0 * s, top * s, w * s, sh * s, x0, yd, w, sh);
      }
    }
    ctx.restore();
  }

  // ---- the shift: the whole drawing slides down one semitone over the last beat ----
  const shift = P.shift ?? 0;
  const pxSemi = P.pxPerSemi ?? 18;

  // ---- home: the bone hairline (the pad), shortening towards the pivot, fading over the shift ----
  const boneA = clamp((P.lineA0 ?? 0.25) + (P.lineAPad ?? 0.5) * F.c.pad_lvl) * clamp(P.boneOut ?? 1);
  const len = P.lineLen ?? 1536;
  let lineMid = Math.round((home + shift) * s) / s + Math.max(1, 1 / s) / 2;
  if (boneA > 0.003) lineMid = hline(ctx, s, cx - len / 2, cx + len / 2, home + shift, color.css(bone, boneA));

  // ---- the new home: gold, one semitone above, stepped wider by each fill hit ----
  const goldIn = clamp(P.goldIn ?? 0);
  if (goldIn > 0.003) {
    const kc = (F.ev.key_changes || [])[0];
    let k = 0;
    if (kc) {
      const hits = F.between('hit', kc.pivot, kc.t + 0.5 / fps);
      const n = hits.length;
      const keyF = landF(kc.t, fps);
      for (let i = 0; i < n; i++) {
        // the last hit is the key change's own hit: its step lands with the key change frame
        const L = i === n - 1 ? Math.max(landF(hits[i][0], fps), keyF) : landF(hits[i][0], fps);
        if (frame < L) continue;
        // the step shows on the hit frame and settles over stepTau
        k += outExpo((frame - L + 1) / fps / (P.stepTau ?? 0.12)) / n;
      }
    }
    const gl = (P.goldLen0 ?? 240) + ((P.goldLen1 ?? X1 - X0) - (P.goldLen0 ?? 240)) * k;
    const gy = home - pxSemi + shift;
    // it brightens and thickens to 2 px as it slides onto home (meeting the orbit's home line)
    const thick = clamp(shift / pxSemi);
    const ga = ((P.goldA ?? 0.85) + (1 - (P.goldA ?? 0.85)) * thick) * goldIn;
    hline(ctx, s, cx - gl / 2, cx + gl / 2, gy, color.css(gold, ga));
    if (thick > 0.003) hline(ctx, s, cx - gl / 2, cx + gl / 2, gy + Math.max(1, 1 / s), color.css(gold, ga * thick));
  }

  // ---- the voice: a bone dot on home, a ring while the voice is out, pitch again on its return ----
  const exitT = firstEvent(F.ev.exits, 'voc', S.t0, S.t1);
  const entryT = firstEvent(F.ev.entries, 'voc', S.t0, S.t1);
  const exitF = exitT === null ? Infinity : landF(exitT, fps);
  const entryF = entryT === null ? Infinity : landF(entryT, fps);
  const hollow = frame >= exitF && frame < entryF;
  let off = 0;
  if (frame >= entryF) {
    const tonic = P.tonicMidi ?? 58, clampS = P.semiClamp ?? 8;
    const m = voiceMidi(F, t);
    if (m >= 0) off = pitchOffset(m, tonic, pxSemi, clampS);
    else {
      // settle onto home over restEase after the voice pauses
      const settleF = Math.max(1, Math.round((P.restEase ?? 0.25) * fps));
      for (let j = 1; j <= settleF && frame - j >= entryF; j++) {
        const mj = voiceMidi(F, (frame - j) / fps);
        if (mj >= 0) {
          off = pitchOffset(mj, tonic, pxSemi, clampS) * (1 - smooth(j / settleF));
          break;
        }
      }
    }
  }
  const dy = lineMid + off;
  const r = P.dotR ?? 5;
  ctx.beginPath();
  if (hollow) {
    const rw = P.ringW ?? 1.5;
    ctx.arc(cx, dy, r - rw / 2, 0, Math.PI * 2);
    ctx.lineWidth = rw;
    ctx.strokeStyle = bone;
    ctx.stroke();
  } else {
    ctx.arc(cx, dy, r, 0, Math.PI * 2);
    ctx.fillStyle = bone;
    ctx.fill();
  }
}
