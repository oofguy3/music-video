// The crowd: "we" as a lattice of identical cut-paper figures. One module, two choruses.
//
//   variant "line"  (crowd_b1): the 49-column lattice on ink, built on the memories geometry from
//                   linekit. It sways as one body; the percussion recruits rows outward from home;
//                   each numb window is a bone rule wiping down the grid, behind which figures brake
//                   to a stop (pose time warps to a halt), drain to grey and lose their differences.
//                   The colour never fully returns (numb_accum residue).
//   variant "flood" (crowd_d1): inverted (ink on bone), 81x33 lattice at 0.7 scale filling the frame.
//                   A unison jump that lands on the beats; the couple (gold head, gold ring) is the
//                   only colour; in numb windows an ink rule sweeps down and the crowd hangs at the
//                   apex. A window that ends inside the entry ends in a slam landing; one that ends
//                   with the entry is still hanging at the cut.
//
// Pure: every value is a function of (t, F, P, S). Caches hold sprites and colour tables only.

import {
  HOME_Y, X0, X1, COLS, COL_PITCH, CENTER_COL, ROW_GAP, FIG,
  colX, rowY, voiceMidi, indiv, figureSprite, figureHeight, ramp, rampIndex,
} from './lib/linekit.mjs';

/** linekit's indiv() for a whole lattice, cached per (seed, cols, rows): pure function of its key. */
const indivCache = new Map();
function indivGrid(noise, seed, cols, rMin, rMax) {
  const key = `${seed}|${cols}|${rMin}|${rMax}`;
  let gr = indivCache.get(key);
  if (!gr) {
    gr = [];
    for (let r = rMin; r <= rMax; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(indiv(noise, seed, c, r));
      gr.push(row);
    }
    if (indivCache.size > 8) indivCache.clear();
    indivCache.set(key, gr);
  }
  return gr;
}

export const meta = { type: 'crowd', budgetMs: 9 };

export const defaults = {
  variant: 'line',
  count: 539,
  tonicMidi: 58,
  homeY: HOME_Y,
  colPitch: COL_PITCH,
  rowGap: ROW_GAP,
  rows: 5,
  swayDeg: 5,
  selfPxPerSemi: 3,
  semiClamp: 8,
  numbGain: 1,
  residue: 0.7,
  brake: 0.12,
  ruleY0: 380,
  ruleY1: 860,
  drainEdge: 0.2,
  rowIn3: 1,
  rowIn4: 1,
  rowIn5: 1,
  shudder: 0,
  shudderPx: 2,
  selfSat: 0.6,
  // flood
  cols: 81,
  rowMin: -18,
  rowMax: 14,
  figScale: 0.7,
  jump: 14,
  accent13: 1.25,
  accent24: 0.8,
  coupleCols: [39, 40],
  apexBlend: 0.2,
  dropDur: 0.18,
  slamPx: 8,
  ringKeep: 0.6,
  slam: 0,
  squash: 0.6,
};

const STEPS = 16;          // drain buckets
const LIGHT = 2;           // lightness buckets each side of 0 (+-8 % in 4 % steps)
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const inQuad = (x) => { x = clamp(x); return x * x; };

/** Mean of a column over the window [t - w, t] (O(1), from the prefix sums). */
const mean = (F, name, t, w) => F.integral(name, t - w, t) / w;

/** The numb windows that touch this entry, in time order. */
function windowsOf(F, S) {
  const out = [];
  for (const w of F.ev.numb || []) if (w[1] > S.t0 && w[0] < S.t1) out.push(w);
  return out;
}

/** An event time snapped to the frame it lands on (README timing rule: floor(t * fps + 0.5)). */
const land = (x, fps) => Math.floor(x * fps + 0.5) / fps;

/**
 * Window phase at t, hard-gated by landing frames: the active window (its t0 frame <= frame < its
 * t1 frame), else the last ended one. Windows are returned as [t0, t1] snapped to landing frames.
 */
function numbPhase(F, S, t) {
  let active = null, ended = null;
  const eps = 1e-6;
  for (const w of windowsOf(F, S)) {
    const a = land(w[0], F.fps), b = land(w[1], F.fps);
    if (t >= a - eps && t < b - eps) active = [a, b];
    else if (t >= b - eps) ended = [a, b];
  }
  return { active, ended };
}

// ---------------------------------------------------------------------------------------------
// sprite tables (pure functions of their key)

/**
 * Canvases record their drawing and rasterise lazily; a canvas used as a drawImage source while
 * still unflushed is re-rendered on every use. Reading one pixel back forces the raster once, which
 * roughly halves the cost of every later draw from it. Pixels are unchanged.
 */
const flushed = new WeakSet();
function flush(canvas) {
  if (!flushed.has(canvas)) {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    flushed.add(canvas);
  }
  return canvas;
}

const tables = new Map();
function table(key, build) {
  let tb = tables.get(key);
  if (!tb) {
    tb = build();
    if (tables.size > 64) tables.clear();
    tables.set(key, tb);
  }
  return tb;
}

/** line variant: [lightness bucket][drain bucket] -> figure sprite, built lazily. */
function lineSprites(g, bone, numb) {
  return table(`line|${g.scale}|${bone}|${numb}`, () => {
    const lights = [];
    for (let k = -LIGHT; k <= LIGHT; k++) lights.push(g.color.scale(bone, 1 + (0.08 / LIGHT) * k));
    return { lights, numb, cells: new Map() };
  });
}
function lineSprite(g, tb, lb, db) {
  const key = lb * 64 + db;
  let s = tb.cells.get(key);
  if (!s) {
    const col = ramp(g.color, tb.lights[lb], tb.numb, STEPS)[db];
    s = figureSprite(g, { body: col });
    flush(s.canvas);
    tb.cells.set(key, s);
  }
  return s;
}

/** Draw a sprite with its feet at (x, y) through a raw device transform (fast path, no save/restore). */
function blit(ctx, m, spr, x, y, k, cos, sin) {
  const s = m.a;
  ctx.setTransform(s * k * cos, s * k * sin, -s * k * sin, s * k * cos, m.e + s * x, m.f + s * y);
  ctx.drawImage(spr.canvas, -spr.w / 2, -spr.h + spr.foot, spr.w, spr.h);
}

/** A figure drawn directly (used only for the one or two "self" figures that stretch with the voice). */
function drawSelf(ctx, x, footY, angle, s, grow, body, head, hollow = false, ring = 1.5) {
  const bw = FIG.bodyW * s, bh = FIG.bodyH * s + grow, hr = FIG.headR * s;
  ctx.save();
  ctx.translate(x, footY);
  if (angle) ctx.rotate(angle);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-bw / 2, -bh, bw, bh, Math.min(FIG.bodyR * s, bw / 2));
  ctx.fill();
  const hy = -bh - FIG.gap * s - hr;
  ctx.beginPath();
  if (hollow) {
    ctx.arc(0, hy, hr - ring / 2, 0, Math.PI * 2);
    ctx.lineWidth = ring;
    ctx.strokeStyle = head;
    ctx.stroke();
  } else {
    ctx.arc(0, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = head;
    ctx.fill();
  }
  ctx.restore();
}

export function draw(g, t, F, P, S) {
  if (P.variant === 'flood') drawFlood(g, t, F, P, S);
  else drawLine(g, t, F, P, S);
}

// ---------------------------------------------------------------------------------------------
// variant "line" (crowd_b1)

function drawLine(g, t, F, P, S) {
  const { ctx, W, H, color, noise } = g;
  const pal = S.palette;
  const ink = pal.ink || '#0E0D0C', bone = pal.bone || '#E4DED2', ruleC = pal.rule || bone;
  const numbC = pal.numb || '#7E8083', amber = pal.amber || '#F0A23B';
  const homeY = P.homeY ?? HOME_Y, pitch = P.colPitch ?? COL_PITCH, gap = P.rowGap ?? ROW_GAP;
  const nRows = P.rows ?? 5;
  const bar = F.beatS * F.bpb;
  const gain = P.numbGain ?? 1;
  const accum = F.c.numb_accum;
  const residue = P.residue ?? 0.7;
  const base = clamp(residue * accum * gain);           // permanent drain
  const keep = 1 - residue * accum;                     // what individuality and motion return to
  const brake = P.brake ?? 0.12, edge = P.drainEdge ?? 0.2;
  const y0 = P.ruleY0 ?? 380, y1 = P.ruleY1 ?? 860;
  const swayRad = ((P.swayDeg ?? 5) * Math.PI) / 180;
  const midOff = figureHeight(1) / 2;

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);

  // home line: alpha follows the pad like the memories line; bass notes thump it 2 -> 6 px.
  // Drawn from y = home downwards so the void scene's row strips (rowY-40 .. rowY-1) exclude it.
  const thump = F.impulse('bass_notes', 0.18, -1);
  const lw = 2 + 4 * thump;
  ctx.fillStyle = color.css(ruleC, clamp(0.35 + 0.4 * F.c.pad_lvl));
  ctx.fillRect(X0, homeY, X1 - X0, lw);

  const { active, ended } = numbPhase(F, S, t);
  const win = active || ended;
  const recov = !active && ended ? smooth((t - ended[1]) / bar) : 1;
  const inReturn = !active && ended && recov < 1;

  // pose of a row at time tp (mt, sway amplitude); shared by every figure of the row
  const pose = (tt, r, motion) => {
    const bassS = mean(F, 'bass_rel', tt, 0.25);
    const drumS = mean(F, 'drums_rel', tt, bar);
    const join = clamp(1.6 * drumS - Math.abs(r) / 6);
    return { mt: F.col('mt', tt), amp: swayRad * (0.3 + 0.7 * bassS) * (0.35 + 0.65 * join) * motion };
  };

  // shudder: fill hits jolt the frozen grid sideways
  let jolt = 0;
  if ((P.shudder ?? 0) > 0) {
    const hits = F.between('hit', t - 0.15, t + 0.5 / F.fps);
    if (hits.length) {
      const h = hits[hits.length - 1];
      const age = Math.max(0, t - h[0]);
      const sgn = noise.hash01(S.seed, Math.round(h[0] * 1000), 7) < 0.5 ? -1 : 1;
      jolt = (P.shudderPx ?? 2) * P.shudder * sgn * (1 - age / 0.15);
    }
  }

  const m = ctx.getTransform();
  const tb = lineSprites(g, bone, numbC);
  const IV = indivGrid(noise, S.seed, COLS, -nRows, nRows);
  const selfMidi = voiceMidi(F, t);
  const tonic = P.tonicMidi ?? 58;
  let selfState = null;

  for (let r = -nRows; r <= nRows; r++) {
    const ar = Math.abs(r);
    const inP = ar <= 2 ? 1 : ar === 3 ? P.rowIn3 : ar === 4 ? P.rowIn4 : P.rowIn5;
    if (!(inP > 0.001)) continue;
    const slideX = (1 - inP) * (W + 64) * (r < 0 ? -1 : 1);
    const fy = rowY(r, gap, homeY);

    // numb state of this row: pass time of the rule over the figures' middle
    let drain = base, tau = t, frozen = false, rec = 1;
    if (win && inP >= 0.999) {
      const [a, b] = win;
      const tp = a + clamp((fy - midOff - y0) / (y1 - y0)) * (b - a);
      if (active && t >= tp) {
        drain = Math.max(base, clamp(gain * smooth((t - tp) / edge)));
        tau = tp + brake * (1 - Math.exp(-(t - tp) / brake));
        frozen = true;
      } else if (inReturn) {
        const dEnd = clamp(gain * smooth((b - tp) / edge));
        drain = Math.max(base, dEnd + (base - dEnd) * recov);
        tau = tp + brake * (1 - Math.exp(-(t - tp) / brake));
        frozen = true;
        rec = recov;
      }
    }
    const live = pose(t, r, keep);
    const held = frozen ? pose(tau, r, keep) : live;
    const I = (1 - drain) * keep;
    const db = rampIndex(drain, STEPS);
    const dx = slideX + (drain > 0.5 ? jolt : 0);

    for (let c = 0; c < COLS; c++) {
      const x = colX(c, pitch) + dx;
      if (x < -40 || x > W + 40) continue;
      if (r === 0 && c === CENTER_COL) {
        selfState = { x, fy, drain, held, live, rec, frozen };
        continue;
      }
      const iv = IV[r + nRows][c];
      const ph = iv.dphase * I;
      let ang = held.amp * Math.sin((Math.PI * (held.mt + ph)) / 2);
      if (frozen && rec < 1) {
        const la = live.amp * Math.sin((Math.PI * (live.mt + ph)) / 2);
        ang += (la - ang) * rec;
      }
      const k = 1 + (iv.dh * I) / figureHeight(1);
      const lb = Math.max(0, Math.min(2 * LIGHT, Math.round((iv.dl * I) / (0.08 / LIGHT)) + LIGHT));
      blit(ctx, m, lineSprite(g, tb, lb, db), x, fy, k, Math.cos(ang), Math.sin(ang));
    }
  }
  ctx.setTransform(m);

  // the self: amber, the only figure that grows with the voice
  if (selfState) {
    const { x, fy, drain, held, live, rec, frozen } = selfState;
    let ang = held.amp * Math.sin((Math.PI * held.mt) / 2);
    if (frozen && rec < 1) ang += (live.amp * Math.sin((Math.PI * live.mt) / 2) - ang) * rec;
    const semis = selfMidi < 0 ? 0 : clamp(selfMidi - tonic, 0, P.semiClamp ?? 8);
    const grow = semis * (P.selfPxPerSemi ?? 3) * (1 - drain);
    const warm = table(`warm|${amber}|${P.selfSat ?? 0.6}`, () => color.saturate(amber, P.selfSat ?? 0.6));
    const col = ramp(color, warm, numbC, STEPS)[rampIndex(drain, STEPS)];
    drawSelf(ctx, x, fy, ang, 1, grow, col, col);
  }

  // the rule (hard-gated to the active window)
  if (active) {
    const [a, b] = active;
    const ry = y0 + (y1 - y0) * clamp((t - a) / (b - a));
    ctx.fillStyle = color.css(ruleC, 0.92);
    ctx.fillRect(X0 - 16, ry - 1, X1 - X0 + 32, 2);
  }
}

// ---------------------------------------------------------------------------------------------
// variant "flood" (crowd_d1)

/**
 * Row strips for the flood lattice. At this density per-figure drawImage calls cost more than the
 * frame budget, so the lattice is drawn one row per call from cached strips built from the linekit
 * sprite. Height individuality lives in a block of B columns (baked, scaled by kq); each row reads
 * the block pattern at its own hashed column offset from one of V variants, so neighbouring rows
 * never line up. Strips are cached per (device scale, seed, colour, kq): a pure function of the key.
 * get(variant, squash, colour|null) -> canvas at device resolution, feet on row `foot`.
 */
const STRIP_B = 16, STRIP_V = 3;
function floodStrips(g, seed, ink, fs, pitch, nCols, squashAmt, kq) {
  return table(`strips|${g.scale}|${seed}|${ink}|${fs}|${pitch}|${nCols}|${squashAmt}|${kq}`, () => {
    const s = g.scale;
    const figH = figureHeight(fs);
    const colW = Math.round(pitch * s);
    const h = Math.ceil((figH * (1 + (6 * fs) / figH) + 4) * s);
    const foot = h - Math.ceil(2 * s);
    const masks = new Map(), tinted = new Map();
    const cols = Array.from({ length: STRIP_V }, (_, v) => Array.from({ length: STRIP_B }, (_, j) => {
      const iv = indiv(g.noise, seed, j, 100 + v);
      return { dh: iv.dh * fs * kq };
    }));
    const mask = (v, sq) => {
      const key = v * 2 + (sq ? 1 : 0);
      let c = masks.get(key);
      if (c) return c;
      const spr = figureSprite(g, { body: ink, scale: fs, squash: sq ? squashAmt : 0 });
      flush(spr.canvas);
      const blk = g.createCanvas(STRIP_B * colW, h);
      const bx = blk.getContext('2d');
      for (let j = 0; j < STRIP_B; j++) {
        const f = cols[v][j];
        const k = 1 + f.dh / figH;
        const w = spr.w * k * s, hh = spr.h * k * s;
        bx.drawImage(spr.canvas, (j + 0.5) * colW - w / 2, foot - hh + spr.foot * k * s, w, hh);
      }
      c = g.createCanvas((nCols + STRIP_B) * colW, h);
      const cx = c.getContext('2d');
      flush(blk);
      for (let i = 0; i * STRIP_B < nCols + STRIP_B; i++) cx.drawImage(blk, i * STRIP_B * colW, 0);
      flush(c);
      masks.set(key, c);
      return c;
    };
    const get = (v, sq, col) => {
      const base = mask(v, sq);
      if (!col) return base;
      const key = `${v}|${sq}|${col}`;
      let c = tinted.get(key);
      if (!c) {
        c = g.createCanvas(base.width, base.height);
        const cx = c.getContext('2d');
        cx.drawImage(base, 0, 0);
        cx.globalCompositeOperation = 'source-in';
        cx.fillStyle = col;
        cx.fillRect(0, 0, c.width, c.height);
        flush(c);
        if (tinted.size > 96) tinted.clear();
        tinted.set(key, c);
      }
      return c;
    };
    return { get, colW, h, foot, B: STRIP_B, V: STRIP_V };
  });
}

function drawFlood(g, t, F, P, S) {
  const { ctx, W, H, color, noise } = g;
  const pal = S.palette;
  const field = pal.field || '#EDE7DA', hot = pal.fieldHot || '#FFFFFF';
  const ink = pal.ink || '#0B0B0B', numbField = pal.numbField || '#9A9C9E';
  const numbFig = pal.numbFigure || '#6E7072', ruleC = pal.rule || ink, amber = pal.amber || '#F0A23B';
  const homeY = P.homeY ?? HOME_Y, pitch = P.colPitch ?? 24, gap = P.rowGap ?? 33;
  const nCols = P.cols ?? 81, rMin = P.rowMin ?? -18, rMax = P.rowMax ?? 14;
  const fs = P.figScale ?? 0.7;
  const [cSelf, cHer] = P.coupleCols || [39, 40];
  const x0 = W / 2 - (pitch * (cSelf + cHer)) / 2;    // the couple straddles the centre
  const bar = F.beatS * F.bpb, beat = F.beatS;
  const accum = F.c.numb_accum;
  const indivK = clamp(1 - accum);
  const gain = P.numbGain ?? 1;
  const y0 = P.ruleY0 ?? -10, y1 = P.ruleY1 ?? 1090;
  const edge = P.apexBlend ?? 0.2;
  const dropDur = P.dropDur ?? 0.18;
  const figH = figureHeight(fs);

  // ---- the unison jump (amplitude fixed per beat so every arc is smooth and lands on the beat)
  const ampAt = (tb) => clamp(1.6 * mean(F, 'drums_rel', tb, beat));
  const mt = F.c.mt;
  const bi = Math.floor(mt), u = mt - bi;
  const landPos = (((bi + 1) % F.bpb) + F.bpb) % F.bpb;
  const acc = landPos % 2 === 0 ? (P.accent13 ?? 1.25) : (P.accent24 ?? 0.8);
  const tBeat = t - u * beat;
  const sinceLand = u * beat;
  const a0 = clamp(0.1 / beat, 0, 0.5);                // on the ground for 0.1 s after a landing

  // ---- numb windows: active (rule sweeping), or ended (slam, then colour returns)
  const { active, ended } = numbPhase(F, S, t);
  const endsInside = (w) => w[1] < land(S.t1, F.fps) - 0.5 / F.fps;
  let slamT = null;
  if (!active && ended && endsInside(ended) && t - ended[1] < bar) slamT = ended[1];
  const recov = slamT !== null ? smooth((t - slamT) / bar) : 1;
  const reJump = slamT !== null ? smooth((t - slamT) / beat) : 1;
  const J = (P.jump ?? 14) * ampAt(tBeat) * acc * reJump;
  const hangJ = active ? (P.jump ?? 14) * (P.accent13 ?? 1.25) * Math.max(0.75, ampAt(active[0])) : 0;
  const fallP = active && endsInside(active) && t >= active[1] - dropDur ? inQuad((t - (active[1] - dropDur)) / dropDur) : 0;
  const squashAll = (sinceLand < 0.1 && F.c.kick > 0.3) || (slamT !== null && t - slamT < 0.12) || fallP >= 1;

  // ---- field: bone brightening to white with loudness, drained behind the rule
  const lq = Math.round(clamp(mean(F, 'loud', t, 0.5)) ** 2 * 64) / 64;
  const fieldC = color.mix(field, hot, lq);
  let ruleY = null;
  if (active) ruleY = y0 + (y1 - y0) * clamp((t - active[0]) / (active[1] - active[0]));
  if (slamT !== null) {
    ctx.fillStyle = color.mix(numbField, fieldC, Math.round(recov * 32) / 32);
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = fieldC;
    ctx.fillRect(0, 0, W, H);
    if (ruleY !== null) {
      const speed = (y1 - y0) / (active[1] - active[0]);
      const eL = Math.max(2, speed * edge);
      const top = ruleY - eL;
      if (top > 0) { ctx.fillStyle = numbField; ctx.fillRect(0, 0, W, top); }
      const gr = ctx.createLinearGradient(0, top, 0, ruleY);
      gr.addColorStop(0, numbField);
      gr.addColorStop(1, fieldC);
      ctx.fillStyle = gr;
      ctx.fillRect(0, Math.max(0, top), W, ruleY - Math.max(0, top));
    }
  }

  // ---- home line (ink), thumped by the slam
  // P.slam is keyed on the window's t1; mirror it from the landing frame so the thump is on the
  // frame the slam lands (a step key at an event time otherwise shows one frame late).
  const own = slamT !== null ? (1 - clamp((t - slamT) / 0.3)) ** 2 : 0;
  const lw = 2 + (P.slamPx ?? 8) * Math.max(P.slam ?? 0, own);
  ctx.fillStyle = ink;
  ctx.fillRect(0, homeY, W, lw);

  // ---- the crowd, one row strip per takeoff group (see floodStrips)
  const kq = Math.round(indivK * 4) / 4;
  const ST = floodStrips(g, S.seed, ink, fs, pitch, nCols, P.squash ?? 0.6, kq);
  const m = ctx.getTransform();
  const ds = m.a;
  const segs = (r) => (r === 0 ? [[0, cSelf], [cHer + 1, nCols]] : [[0, nCols]]);
  // takeoff phase jitter is per row (the whole row leaves the ground together, rows staggered by up
  // to 0.15 beat x indivK); every row still lands exactly on the beat.
  const ai = (rowU) => a0 + indivK * (0.02 + 0.13 * rowU);
  const arc = (a) => { const v = (u - a) / (1 - a); return v > 0 ? J * 4 * v * (1 - v) : 0; };
  let couple = null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let r = rMin; r <= rMax; r++) {
    const fy = rowY(r, gap, homeY);
    if (fy - figH - 30 > H || fy < -4) continue;
    let drain = 0, hang = 0;
    if (active) {
      const tp = active[0] + clamp((fy - figH / 2 - y0) / (y1 - y0)) * (active[1] - active[0]);
      if (t >= tp) {
        drain = clamp(gain * smooth((t - tp) / edge));
        hang = smooth((t - tp) / edge);
      }
    } else if (slamT !== null) {
      drain = clamp(gain * (1 - recov));
    }
    const db = rampIndex(drain, STEPS);
    const col = db ? ramp(color, ink, numbFig, STEPS)[db] : null;
    const rowSquash = squashAll && (slamT !== null || hang < 0.5);
    const rowU = noise.hash01(S.seed, r, 23);
    const off = Math.floor(noise.hash01(S.seed, r, 29) * ST.B);
    const v = ((r % ST.V) + ST.V) % ST.V;
    let lift = arc(ai(rowU));
    if (hang > 0) lift += (hangJ - lift) * hang;
    if (fallP > 0) lift *= 1 - fallP;
    const strip = ST.get(v, rowSquash && lift < 0.5, col);
    const dy = Math.round(m.f + (fy - lift) * ds) - ST.foot;
    for (const [c0, c1] of segs(r)) {
      const sx = (off + c0) * ST.colW, sw = (c1 - c0) * ST.colW;
      ctx.drawImage(strip, sx, 0, sw, ST.h, Math.round(m.e + (x0 - pitch / 2) * ds) + c0 * ST.colW, dy, sw, ST.h);
    }
    if (r === 0) couple = { self: { x: x0 + pitch * cSelf }, her: { x: x0 + pitch * cHer }, drain, lift, rowSquash };
  }
  ctx.setTransform(m);

  // ---- the couple: the only colour
  if (couple && couple.self) {
    const { drain, lift, rowSquash } = couple;
    const sq = rowSquash && lift < 0.5;
    const di = rampIndex(drain, STEPS);
    const bodyC = ramp(color, ink, numbFig, STEPS)[di];
    const goldC = ramp(color, amber, numbFig, STEPS)[di];
    const keep = clamp(P.ringKeep ?? 0.6);
    const ringC = ramp(color, amber, numbFig, STEPS)[rampIndex(drain * (1 - keep), STEPS)];
    const midi = voiceMidi(F, t);
    const semis = midi < 0 ? 0 : clamp(midi - (P.tonicMidi ?? 59), 0, P.semiClamp ?? 8);
    const grow = semis * (P.selfPxPerSemi ?? 2) * (1 - drain);
    const sqH = sq ? 1 - 0.3 * (P.squash ?? 0.6) : 1;
    // squash: flatten about the feet
    const drawOne = (x, hollow, head) => {
      ctx.save();
      ctx.translate(x, homeY - lift);
      ctx.scale(sq ? 1 + 0.25 * (P.squash ?? 0.6) : 1, sqH);
      drawSelf(ctx, 0, 0, 0, fs, hollow ? 0 : grow / sqH, bodyC, head, hollow, 1.5);
      ctx.restore();
    };
    drawOne(couple.self.x, false, goldC);
    drawOne(couple.her.x, true, ringC);
  }

  // ---- the rule (hard-gated)
  if (ruleY !== null) {
    ctx.fillStyle = ruleC;
    ctx.fillRect(0, ruleY - 1, W, 2);
  }
}
