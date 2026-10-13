// A1 verse: the film's visual language is set up here. An ink field holds one bone hairline (the
// home line, the tonic). An amber self dot sits at its pitch height above the line and leaves a
// scrolling trail. Notes held on home leave amber dashes, and long off-home holds drop plumb
// lines. The "we" lattice grows out of the self: a row of dots copying its pitch becomes a row of
// figures, then rows +-1 and +-2. The last frame lands the self in the empty column-24 slot, which
// is exactly the first frame of crowd_b1.
//
// Pure: every value comes from (t, F, P, S). The per-frame pitch history is rebuilt locally each
// frame from F columns; the only module caches are pure functions of their key.

import {
  HOME_Y, X0, X1, COLS, COL_PITCH, CENTER_COL, ROW_GAP, FIG,
  colX, rowY, voiceMidi, pitchOffset, figureSprite, figureHeight, drawFigure, indiv, ramp, rampIndex,
} from './lib/linekit.mjs';

export const meta = { type: 'memories', budgetMs: 4 };

export const defaults = {
  tonicMidi: 58,
  pxPerSemi: 18,
  homeY: HOME_Y,
  homeX0: X0,
  homeX1: X1,
  semiClamp: 8,
  trailSec: 6,
  trailSamples: 180,
  scrollPx: 256,          // px per second
  colPitch: COL_PITCH,
  rowGap: ROW_GAP,
  ripple: 0.035,          // s of delay per column away from the self
  homeTouchMin: 0.8,
  hoverMin: 1.5,
  restEase: 0.25,         // s for the dot to settle onto the line when the voice stops
  lineDraw: 1,
  weCols: 0,
  follow: 1,
  body: 0,
  rowP1: 0,
  rowM1: 0,
  rowPM2: 0,
  twitch: 0,
  dotDrop: 0,
  amberSat: 1,
  crowdBone: '#E4DED2',   // crowd_b1's figure bone, blended to over the last bar
  crowdSeedKey: 'crowd_b1',
  selfPxPerSemi: 3,       // crowd_b1's self grows with the voice; matched at the hand-off
  crowdSwayDeg: 5,        // crowd_b1's sway (its swayDeg); 0 if crowd_b1 starts upright
  crowdResidue: 0.7,      // crowd_b1's residue: numb_accum damps its sway
};

const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---- pad on/off segments (a pure function of the feature data, cached by its event object) ----
const padCache = new WeakMap();
function padOnsets(F) {
  let on = padCache.get(F.ev);
  if (!on) {
    on = [];
    const n = Math.ceil(F.duration * F.fps);
    let prev = 0;
    for (let i = 0; i <= n; i++) {
      const v = F.col('pad_active', i / F.fps) >= 0.5 ? 1 : 0;
      if (v && !prev) on.push(i / F.fps);
      prev = v;
    }
    padCache.set(F.ev, on);
  }
  return on;
}

// ---- seed of another timeline entry (same rule as the engine: hash of the id's char codes) ----
const seedCache = new Map();
function seedOf(noise, key) {
  let s = seedCache.get(key);
  if (s === undefined) {
    s = noise.hash32(...String(key).split('').map((ch) => ch.charCodeAt(0)));
    seedCache.set(key, s);
  }
  return s;
}

/**
 * Pitch history: for frames i0-k (k = 0..K) the self's offset from home (px, negative = above) and
 * a voiced weight v (1 while singing, easing to 0 over restEase after the voice stops).
 */
function pitchHistory(F, P, i0, K) {
  const fps = F.fps;
  const settleF = Math.max(1, Math.round(P.restEase * fps));
  const N = K + settleF + 1;
  const midi = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const i = i0 - k;
    midi[k] = i < 0 ? -1 : voiceMidi(F, i / fps);
  }
  const off = new Float64Array(K + 1);
  const v = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) {
    if (midi[k] >= 0) {
      off[k] = pitchOffset(midi[k], P.tonicMidi, P.pxPerSemi, P.semiClamp);
      v[k] = 1;
      continue;
    }
    for (let j = 1; j <= settleF && k + j < N; j++) {
      if (midi[k + j] >= 0) {
        const w = 1 - smooth(j / settleF);
        off[k] = pitchOffset(midi[k + j], P.tonicMidi, P.pxPerSemi, P.semiClamp) * w;
        v[k] = w;
        break;
      }
    }
  }
  return { off, v };
}

/** Sample the history at a fractional frame lag (linear between frames). */
function sampleHist(H, lag) {
  const K = H.off.length - 1;
  if (lag <= 0) return [H.off[0], H.v[0]];
  if (lag >= K) return [H.off[K], H.v[K]];
  const a = Math.floor(lag), f = lag - a;
  return [H.off[a] + (H.off[a + 1] - H.off[a]) * f, H.v[a] + (H.v[a + 1] - H.v[a]) * f];
}

/** A figure part-way between a dot (k=0, centred at dotY, radius r0) and a full figure (k=1). */
function morphFigure(ctx, x, footY, dotY, r0, k, fill, grow = 0) {
  const headTop = FIG.bodyH + grow + FIG.gap + FIG.headR;
  const hy = dotY + (footY - headTop - dotY) * k;
  const hr = r0 + (FIG.headR - r0) * k;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  if (k > 0.001) {
    // the body hangs from the head and grows down to the feet, so the head never floats free
    const bw = FIG.bodyW * Math.min(1, 0.35 + 0.65 * k);
    const top = hy + hr + FIG.gap;
    const bh = Math.max(0, footY - top) * k;
    if (bh > 0.25) {
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, top, bw, bh, Math.min(FIG.bodyR, bw / 2, bh / 2));
      ctx.fill();
    }
  }
}

/**
 * crowd_b1's row sway at t (its own rule, so the hand-off frame is the frame crowd_b1 would draw):
 * amplitude from the recent bass and drum levels, phase from the mt column.
 */
function crowdSway(F, P, t, bar) {
  const rad = (P.crowdSwayDeg * Math.PI) / 180;
  if (!(rad > 0)) return null;
  const bassS = F.integral('bass_rel', t - 0.25, t) / 0.25;
  const drumS = F.integral('drums_rel', t - bar, t) / bar;
  const motion = 1 - P.crowdResidue * F.c.numb_accum;
  const base = rad * (0.3 + 0.7 * bassS) * motion;
  return {
    mt: F.col('mt', t),
    amp: (r) => base * (0.35 + 0.65 * clamp01(1.6 * drumS - Math.abs(r) / 6)),
  };
}

/** Gap mask from a breath: 1 outside, 0 inside a centred gap of width w (soft 10 px edge). */
const gapMask = (x, cx, w) => (w <= 0.5 ? 1 : clamp01((Math.abs(x - cx) - w / 2) / 10 + 0.5));

export function draw(g, t, F, P, S) {
  const { ctx, W, H, color, noise, ease } = g;
  const pal = S.palette;
  const ink = pal.ink || '#0E0D0C';
  const bone = pal.bone || '#EDE7DA';
  const amberBase = pal.amber || '#F0A23B';
  const fps = F.fps;
  const i0 = Math.round(t * fps);
  const cx = colX(CENTER_COL, P.colPitch, P.homeX0);
  const home = P.homeY;
  const bar = F.beatS * F.bpb;

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);

  const drop = clamp01(P.dotDrop);            // the hand-off to crowd_b1 over the last bar
  const keep = 1 - drop;                       // trail, marks and plumbs clear for the match frame
  const hop = -3 * P.twitch;                   // drum pre-hit: everything hops 3 px

  // ---- breaths: a centred gap in the line (and in every row) ----
  let gapW = 0;
  for (const d of F.ev.dips || []) {
    const e = ease.ahr(t, d[0], d[0] + 0.3, 0.3, 0.7);   // 0.3 s attack to the peak, full 0.7 s release
    if (e > 0) gapW = Math.max(gapW, 60 * d[1] * e);
  }

  // ---- home line ----
  const padOn = F.c.pad_active >= 0.5;
  let drawK = 0;
  if (padOn) {
    const ons = padOnsets(F);
    let tOn = 0;
    for (const s of ons) if (s <= t + 1e-6) tOn = s;
    drawK = Math.min(clamp01(P.lineDraw), ease.outExpo((t - tOn) / bar));
  }
  const lineA = clamp01(0.35 + 0.4 * F.c.pad_lvl);
  const half = ((P.homeX1 - P.homeX0) / 2) * drawK;
  if (half > 0.5) {
    ctx.fillStyle = color.css(bone, lineA);
    const y = home + hop;   // the line hangs from y = home downwards (as in crowd_b1)
    const gl = cx - gapW / 2, gr = cx + gapW / 2;
    const L0 = cx - half, R1 = cx + half;
    if (gapW <= 0.5) ctx.fillRect(L0, y, R1 - L0, 2);
    else {
      if (gl > L0) ctx.fillRect(L0, y, gl - L0, 2);
      if (R1 > gr) ctx.fillRect(gr, y, R1 - gr, 2);
    }
  }

  // ---- pitch history (self and the we-copies) ----
  const nTrail = Math.max(2, Math.round(P.trailSamples));
  const trailFrames = Math.round(P.trailSec * fps);
  const maxLag = Math.max(trailFrames, Math.ceil(CENTER_COL * P.ripple * fps) + 2);
  const Hst = pitchHistory(F, P, i0, maxLag);
  const pxPerFrame = P.scrollPx / fps;

  // ---- home touches: amber dashes under tonic notes held >= homeTouchMin ----
  const amber = P.amberSat < 0.999 ? color.saturate(amberBase, P.amberSat) : amberBase;
  if (keep > 0.001) {
    // the breath gap is centred: the trail, dashes and plumbs are cut out of it as the line is
    const clipGap = gapW > 0.5;
    if (clipGap) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-W, -H, W + cx - gapW / 2, 3 * H);
      ctx.rect(cx + gapW / 2, -H, 2 * W, 3 * H);
      ctx.clip();
    }
    const notes = F.between('voc_notes', t - P.trailSec - 8, t + 1e-6);
    const tonPC = ((P.tonicMidi % 12) + 12) % 12;
    for (const n of notes) {
      const [a, b, m] = n;
      if (((Math.round(m) % 12) + 12) % 12 !== tonPC) continue;
      if (b - a < P.homeTouchMin) continue;
      const held = t - a;
      if (held < P.homeTouchMin) continue;
      const end = Math.min(b, t);
      const age = t - end;
      if (age > P.trailSec) continue;
      const xa = cx - P.scrollPx * (t - a), xb = cx - P.scrollPx * age;
      const appear = smooth((held - P.homeTouchMin) / 0.12);
      const fade = 1 - clamp01(age / P.trailSec);
      const al = appear * fade * keep;
      if (al <= 0.004) continue;
      const lo = Math.max(xa, P.homeX0 - 40), hi = xb;
      if (hi <= lo) continue;
      ctx.fillStyle = color.css(amber, 0.9 * al);
      ctx.fillRect(lo, home + hop - 0.5, hi - lo, 3);
    }

    // ---- hovers: dashed plumb lines under off-home notes held >= hoverMin ----
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    for (const n of notes) {
      const [a, b, m] = n;
      if (((Math.round(m) % 12) + 12) % 12 === tonPC) continue;
      if (b - a < P.hoverMin) continue;      // the note's length is known: drop from its onset
      const held = t - a;
      if (held < 0) continue;
      const age = Math.max(0, t - b);
      if (age > P.trailSec) continue;
      const off = pitchOffset(m, P.tonicMidi, P.pxPerSemi, P.semiClamp);
      if (Math.abs(off) < 1) continue;
      const x = cx - P.scrollPx * age;
      const grow = ease.outCubic(clamp01(held / 0.3));
      const al = (1 - clamp01(age / P.trailSec)) * keep;
      const y0 = home + off + hop, y1 = y0 + (home + hop - y0) * grow;
      ctx.strokeStyle = color.css(bone, 0.7 * al);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ---- trail: the dot's last trailSec, scrolling left, breaking at silences ----
    const BUCKETS = 12;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const step = trailFrames / (nTrail - 1);
    for (let bk = 0; bk < BUCKETS; bk++) {
      const s0 = Math.floor((bk * (nTrail - 1)) / BUCKETS), s1 = Math.floor(((bk + 1) * (nTrail - 1)) / BUCKETS);
      const al = (1 - (bk + 0.5) / BUCKETS) * keep;
      if (al <= 0.004) continue;
      ctx.strokeStyle = color.css(bone, 0.8 * al);
      ctx.beginPath();
      let pen = false, any = false;
      for (let s = s0; s <= s1; s++) {
        const lag = s * step;
        const [o, v] = sampleHist(Hst, lag);
        if (v <= 0.02) { pen = false; continue; }
        const x = cx - lag * pxPerFrame;
        const y = home + o + hop;
        if (!pen) { ctx.moveTo(x, y); pen = true; } else { ctx.lineTo(x, y); any = true; }
      }
      if (any) ctx.stroke();
    }
    if (clipGap) ctx.restore();
  }

  // ---- the we lattice ----
  const nCols = Math.round(P.weCols);
  const colStep = nCols >= 2 ? Math.max(1, Math.round((COLS - 1) / (nCols - 1))) : 0;
  const body = clamp01(P.body);
  const crowdSeed = seedOf(noise, P.crowdSeedKey);
  // colour and individuality arrive together over the hand-off, in the 16 steps of the ramp
  const hIdx = rampIndex(drop);
  const figCol = ramp(color, bone, P.crowdBone, 16)[hIdx];
  const idv = hIdx / 15;
  // crowd_b1's sway also arrives with the hand-off, so the cut is one ordinary frame of motion
  const sway = drop > 0 ? crowdSway(F, P, t, bar) : null;
  const devM = sway ? ctx.getTransform() : null;
  const swayAng = (r, c) => {
    if (!sway) return 0;
    const ph = c < 0 ? 0 : indivOf(noise, crowdSeed, c, r).dphase * drop;
    return drop * sway.amp(r) * Math.sin((Math.PI * (sway.mt + ph)) / 2);
  };

  const rowsIn = [
    [0, 1],
    [1, clamp01(P.rowP1)], [-1, clamp01(P.rowM1)],
    [2, clamp01(P.rowPM2)], [-2, clamp01(P.rowPM2)],
  ];

  // whole rows come from cached strips; individuality steps with the colour ramp (16 states)
  const useStrips = colStep === 1 && body >= 0.999 && gapW <= 0.5 && drop <= 0;
  if (useStrips) {
    // every figure is final: one cached strip per row (same sprites, same positions)
    for (const [r, p] of rowsIn) {
      if (p <= 0.001) continue;
      const ar = Math.abs(r), sg = Math.sign(r);
      const y = r === 0 ? home + hop : home + sg * P.rowGap * (ar - 1 + ease.clamp(p)) + hop;
      const st = rowStrip(g, r, figCol, idv, crowdSeed, P);
      const a = r === 0 ? 1 : Math.min(1, p * 1.6);
      if (a < 0.999) ctx.globalAlpha = a;
      ctx.drawImage(st.canvas, st.x0, y - st.foot, st.w, st.h);
      if (a < 0.999) ctx.globalAlpha = 1;
    }
  } else if (colStep > 0) {
    // row 0: copies of the self (dots that grow into figures)
    for (let c = 0; c < COLS; c += colStep) {
      if (c === CENTER_COL) continue;
      const x = colX(c, P.colPitch, P.homeX0);
      const gm = gapMask(x, cx, gapW);
      if (gm <= 0.004) continue;
      const lag = Math.abs(c - CENTER_COL) * P.ripple * fps;
      const [o, v] = sampleHist(Hst, lag);
      const fol = clamp01(P.follow);
      const dotY = home + o * fol + hop;
      const vv = Math.max(v, body);
      if (body >= 0.999) {
        drawLatticeFigure(g, x, rowY(0, P.rowGap, home) + hop, c, 0, figCol, idv, crowdSeed, gm, swayAng(0, c), devM);
        if (devM) ctx.setTransform(devM);
      } else {
        ctx.globalAlpha = gm;
        if (vv > 0.02) morphFigure(ctx, x, home + hop, dotY, 5, body, color.css(bone, vv));
        if (vv < 0.98) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = color.css(bone, 1 - vv);
          ctx.beginPath();
          ctx.arc(x, dotY, 4.25, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    // rows +-1, +-2 slide out from the row next to them
    for (const [r, p] of rowsIn) {
      if (r === 0 || p <= 0.001) continue;
      const ar = Math.abs(r), sg = Math.sign(r);
      const y = home + sg * P.rowGap * (ar - 1 + ease.clamp(p)) + hop;
      for (let c = 0; c < COLS; c += colStep) {
        const x = colX(c, P.colPitch, P.homeX0);
        const gm = gapMask(x, cx, gapW);
        if (gm <= 0.004) continue;
        drawLatticeFigure(g, x, y, c, r, figCol, idv, crowdSeed, gm * Math.min(1, p * 1.6), body >= 0.999 ? swayAng(r, c) : 0, devM);
      }
      if (devM) ctx.setTransform(devM);
    }
  }

  // ---- the self: it emerges with the first sung syllable (the voice's first entry) ----
  let vocIn = 0;
  for (const e of F.ev.entries || []) if (e[1] === 'voc') { vocIn = e[0]; break; }
  const emerge = smooth((t - vocIn) / 0.2);
  if (emerge <= 0.001) return;
  if (emerge < 0.999) ctx.globalAlpha = emerge;
  const [so, sv] = sampleHist(Hst, 0);
  const lvl = clamp01(F.c.voc_lvl);
  const dotR = 7 + 5 * lvl;
  const dotY = home + so + hop;
  const fill = Math.max(sv, drop);
  if (drop > 0.001) {
    // the hand-off: the dot lands in the column-24 slot as crowd_b1's amber self, which already
    // stretches with the voice (selfPxPerSemi per semitone above the tonic)
    const m = voiceMidi(F, t);
    const semis = m < 0 ? 0 : clamp01((m - P.tonicMidi) / P.semiClamp) * P.semiClamp;
    const grow = semis * P.selfPxPerSemi * drop;
    const sa = swayAng(0, -1);
    if (sa) {
      ctx.save();
      ctx.translate(cx, home + hop);
      ctx.rotate(sa);
      ctx.translate(-cx, -(home + hop));
    }
    if (drop >= 0.999) drawSelfFigure(ctx, cx, home + hop, grow, amber);
    else {
      const k = drop;
      morphFigure(ctx, cx, home + hop, dotY, dotR * fill + 6 * (1 - fill), k, color.css(amber, Math.max(fill, 0.0001)), grow);
      if (fill < 0.98) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = color.css(amber, 1 - fill);
        ctx.beginPath();
        ctx.arc(cx, dotY + (home + hop - FIG.bodyH - grow - FIG.gap - FIG.headR - dotY) * k, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (sa) ctx.restore();
  } else {
    if (fill > 0.02) {
      ctx.fillStyle = color.css(amber, fill);
      ctx.beginPath();
      ctx.arc(cx, dotY, 6 + (dotR - 6) * fill, 0, Math.PI * 2);
      ctx.fill();
    }
    if (fill < 0.98) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = color.css(amber, 1 - fill);
      ctx.beginPath();
      ctx.arc(cx, dotY, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Canvases record their drawing and rasterise lazily, and an unflushed canvas used as a drawImage
 * source is re-rendered on every use. Reading one pixel forces the raster once; pixels are unchanged.
 */
const flushed = new WeakSet();
function flush(canvas) {
  if (!flushed.has(canvas)) {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    flushed.add(canvas);
  }
  return canvas;
}

// Individuality table per (seed, column, row): pure function of its key.
const indivCache = new Map();
function indivOf(noise, seed, c, r) {
  const key = `${seed}|${c}|${r}`;
  let v = indivCache.get(key);
  if (!v) {
    v = indiv(noise, seed, c, r);
    if (indivCache.size > 20000) indivCache.clear();
    indivCache.set(key, v);
  }
  return v;
}

// crowd_b1's lightness buckets: +-8 % in 4 % steps around its bone (pure function of the key).
const LIGHT = 2;
const LSTEP = 0.08 / LIGHT;
const lightCache = new Map();
function lightHex(color, hex, lb) {
  const key = hex + '|' + lb;
  let v = lightCache.get(key);
  if (!v) {
    v = color.scale(hex, 1 + LSTEP * (lb - LIGHT));
    if (lightCache.size > 5000) lightCache.clear();
    lightCache.set(key, v);
  }
  return v;
}

// A whole lattice row pre-drawn with the per-figure routine (pure function of its key).
const stripCache = new Map();
function rowStrip(g, r, hex, idv, seed, P) {
  const key = `${g.scale}|${r}|${hex}|${idv}|${seed}|${P.colPitch}|${P.homeX0}`;
  let st = stripCache.get(key);
  if (st) return st;
  const x0 = P.homeX0 - P.colPitch / 2;
  const w = P.colPitch * COLS, h = 64, foot = 52;
  const cv = g.createCanvas(Math.ceil(w * g.scale), Math.ceil(h * g.scale));
  const sx = cv.getContext('2d');
  sx.scale(g.scale, g.scale);
  const gg = { ...g, ctx: sx };
  for (let c = 0; c < COLS; c++) {
    if (r === 0 && c === CENTER_COL) continue;
    drawLatticeFigure(gg, colX(c, P.colPitch, P.homeX0) - x0, foot, c, r, hex, idv, seed, 1);
  }
  flush(cv);
  st = { canvas: cv, x0, w, h, foot };
  if (stripCache.size > 400) stripCache.clear();
  stripCache.set(key, st);
  return st;
}

/**
 * One lattice figure in crowd_b1's exact form: the linekit sprite in a lightness bucket, scaled
 * uniformly about its feet by its height difference. Individuality is scaled by idv in 0..1.
 */
function drawLatticeFigure(g, x, footY, c, r, bodyHex, idv, seed, alpha, ang = 0, m = null) {
  const { ctx } = g;
  let hex = bodyHex;
  let k = 1;
  if (idv > 0) {
    const iv = indivOf(g.noise, seed, c, r);
    const lb = Math.max(0, Math.min(2 * LIGHT, Math.round((iv.dl * idv) / LSTEP) + LIGHT));
    hex = lightHex(g.color, bodyHex, lb);
    k = 1 + (iv.dh * idv) / figureHeight(1);
  }
  const spr = figureSprite(g, { body: hex });
  flush(spr.canvas);
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  if (ang && m) {
    // crowd_b1's form: sprite scaled by k and rotated about its feet, through the raw device
    // transform m (the caller restores it after the row)
    const s = m.a, cos = Math.cos(ang), sin = Math.sin(ang);
    ctx.setTransform(s * k * cos, s * k * sin, -s * k * sin, s * k * cos, m.e + s * x, m.f + s * footY);
    ctx.drawImage(spr.canvas, -spr.w / 2, -spr.h + spr.foot, spr.w, spr.h);
  } else if (k !== 1) ctx.drawImage(spr.canvas, x - (spr.w / 2) * k, footY - (spr.h - spr.foot) * k, spr.w * k, spr.h * k);
  else drawFigure(ctx, spr, x, footY);
  if (alpha < 0.999) ctx.globalAlpha = 1;
}

/**
 * The amber self as a figure in column 24, row 0, drawn directly so it can stretch with the voice
 * (crowd_b1's form: the body grows selfPxPerSemi px per semitone above the tonic).
 */
function drawSelfFigure(ctx, x, footY, grow, fill) {
  const bw = FIG.bodyW, bh = FIG.bodyH + grow, hr = FIG.headR;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, footY - bh, bw, bh, Math.min(FIG.bodyR, bw / 2));
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, footY - bh - FIG.gap - hr, hr, 0, Math.PI * 2);
  ctx.fill();
}
