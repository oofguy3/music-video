// C1-D1 Manga panels (kzPanels). The screen is a comic page: on every bar (downbeat) the page re-lays
// out into 2-4 slanted panels with bold ink borders on paper-white or royal blue, and the panels slam in
// one per beat (fx.slam scale overshoot) with speed lines and halftone inside. Each panel is a little
// animated shot drawn with the rig and kaiser.mjs. Story beats from P choose the page layout and its
// featured panel (the crown, the rose garden, the cascade of balls, the glowing hair, the three
// vertical panels, the crown again, the smoke, the sword slash that splits the page, the full-frame
// eye, the penalty box). The first page opens on the city scene's manga cover, which shrinks into
// its slot, so the hand-off from kzCity is one move.

import { KAISER, KZ, rivalDesign, drawRose, drawCrown, drawChain, drawBall, speedLines, streakLines } from './lib/kaiser.mjs';
import { solve, drawPuppet, poses, cycles, blend } from './lib/puppet.mjs';
import { halftone, slam } from './lib/fx.mjs';
import { hashU } from './lib/worldkit.mjs';
import { coverImage, COVER_FRAME, traceHead } from './kzCity.mjs';

export const meta = { type: 'kzPanels', budgetMs: 170 };

// Story beats in seconds; a negative time means "no such beat" (the page then stays generic).
export const defaults = {
  kingT: -1, gardenT: -1, scoreT: -1, glowT: -1, cameT: -1, sawT: -1, conqueredT: -1, kingT2: -1,
  smokedT: -1, sliceT: -1, eyeT: -1, boxT: -1,
};

const TAU = Math.PI * 2;
const W = 1920, H = 1080;
const FALLBACK = { paper: '#F2F4FA', ink: '#0B0B18', royal: '#1F4FD8', red: '#D11F35', gold: '#FFD45A', rose: '#2E6BFF', pitch: '#0E5A3A' };
const MARGIN = 34, GUTTER = 26, BORDER = 11;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const outCubic = (v) => 1 - (1 - clamp01(v)) ** 3;
const outBack = (v) => { v = clamp01(v); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (v - 1) ** 3 + c1 * (v - 1) ** 2; };
const lerp = (a, b, u) => a + (b - a) * u;
const land = (T, fps) => Math.floor(T * fps + 0.5) / fps;

function paletteOf(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(FALLBACK)) o[k] = typeof p[k] === 'string' && p[k][0] === '#' ? p[k] : FALLBACK[k];
  return o;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Page layouts: slanted panels in normalised page coordinates (clockwise quads). `big` is the slot a
// featured story panel takes.

const TEMPLATES = {
  T2A: { big: 0, slots: [[[0, 0], [0.6, 0], [0.48, 1], [0, 1]], [[0.6, 0], [1, 0], [1, 1], [0.48, 1]]] },
  T2B: { big: 0, slots: [[[0, 0], [1, 0], [1, 0.56], [0, 0.66]], [[0, 0.66], [1, 0.56], [1, 1], [0, 1]]] },
  T3A: { big: 0, slots: [[[0, 0], [0.56, 0], [0.5, 1], [0, 1]], [[0.56, 0], [1, 0], [1, 0.44], [0.534, 0.52]], [[0.534, 0.52], [1, 0.44], [1, 1], [0.5, 1]]] },
  T3B: { big: 0, slots: [[[0, 0], [1, 0], [1, 0.5], [0, 0.58]], [[0, 0.58], [0.55, 0.54], [0.5, 1], [0, 1]], [[0.55, 0.54], [1, 0.5], [1, 1], [0.5, 1]]] },
  T3C: { big: 2, slots: [[[0, 0], [0.44, 0], [0.41, 0.48], [0, 0.54]], [[0, 0.54], [0.41, 0.48], [0.38, 1], [0, 1]], [[0.44, 0], [1, 0], [1, 1], [0.38, 1]]] },
  T3V: { big: 1, slots: [[[0, 0], [0.37, 0], [0.31, 1], [0, 1]], [[0.37, 0], [0.71, 0], [0.65, 1], [0.31, 1]], [[0.71, 0], [1, 0], [1, 1], [0.65, 1]]] },
  T4A: { big: 0, slots: [[[0, 0], [0.52, 0], [0.49, 0.47], [0, 0.53]], [[0.52, 0], [1, 0], [1, 0.42], [0.49, 0.47]], [[0, 0.53], [0.49, 0.47], [0.46, 1], [0, 1]], [[0.49, 0.47], [1, 0.42], [1, 1], [0.46, 1]]] },
  T4B: { big: 0, slots: [[[0, 0], [0.6, 0], [0.55, 1], [0, 1]], [[0.6, 0], [1, 0], [1, 0.32], [0.585, 0.35]], [[0.585, 0.35], [1, 0.32], [1, 0.66], [0.57, 0.68]], [[0.57, 0.68], [1, 0.66], [1, 1], [0.55, 1]]] },
  T4C: { big: 3, slots: [[[0, 0], [0.34, 0], [0.32, 0.4], [0, 0.42]], [[0.34, 0], [0.67, 0], [0.66, 0.38], [0.32, 0.4]], [[0.67, 0], [1, 0], [1, 0.36], [0.66, 0.38]], [[0, 0.42], [1, 0.36], [1, 1], [0, 1]]] },
};
const GENERIC_TEMPLATES = ['T3A', 'T4A', 'T3B', 'T4C', 'T3C', 'T4B', 'T2A', 'T4A', 'T3B', 'T2B'];
const GENERIC_SHOTS = ['dribble', 'defenders', 'ballCam', 'eyes', 'smirk', 'crownHand', 'rose', 'chains', 'net'];

/** A convex polygon shrunk by d along every edge (the gutters). */
function inset(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  const s = area > 0 ? 1 : -1;                         // y-down screen: area > 0 is clockwise
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / L) * s, ny = ((x1 - x0) / L) * s;   // inward normal
    lines.push([x0 + nx * d, y0 + ny * d, x1 - x0, y1 - y0]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay, adx, ady] = lines[(i + n - 1) % n], [bx, by, bdx, bdy] = lines[i];
    const den = adx * bdy - ady * bdx;
    if (Math.abs(den) < 1e-9) { out.push([bx, by]); continue; }
    const u = ((bx - ax) * bdy - (by - ay) * bdx) / den;
    out.push([ax + adx * u, ay + ady * u]);
  }
  return out;
}

function slotGeometry(norm, page = { x: MARGIN, y: MARGIN, w: W - 2 * MARGIN, h: H - 2 * MARGIN }) {
  const poly = inset(norm.map(([u, v]) => [page.x + u * page.w, page.y + v * page.h]), GUTTER / 2);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); cx += x; cy += y; }
  return { poly, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }, c: [cx / poly.length, cy / poly.length] };
}

// ---------------------------------------------------------------------------------------------
// The page plan: bars from the downbeats (long gaps split into bars of bpb beats), beats inside each
// bar, and the story beats placed on their pages. A pure function of the events and P, cached.

function planOf(F, P, S) {
  const fps = F.fps || 30;
  const keys = ['kingT', 'gardenT', 'scoreT', 'glowT', 'cameT', 'sawT', 'conqueredT', 'kingT2', 'smokedT', 'sliceT', 'eyeT', 'boxT'];
  const key = `plan|${S.t0}|${S.t1}|${keys.map((k) => P[k]).join(',')}|${(F.ev.downbeats || []).length}|${(F.ev.beats || []).length}`;
  return cached(key, () => {
    const T = (k) => (typeof P[k] === 'number' && Number.isFinite(P[k]) && P[k] >= 0 ? land(P[k], fps) : null);
    const ev = { king: T('kingT'), garden: T('gardenT'), score: T('scoreT'), glow: T('glowT'), came: T('cameT'), saw: T('sawT'), conq: T('conqueredT'),
      king2: T('kingT2'), smoked: T('smokedT'), slice: T('sliceT'), eye: T('eyeT'), box: T('boxT') };
    const beatS = F.beatS || 0.4, bpb = F.bpb || 4, bar = beatS * bpb;
    const t0 = land(S.t0, fps), t1 = land(S.t1, fps);
    const downs = (F.ev.downbeats || []).map((d) => land(d, fps)).filter((d) => d > t0 + 0.25 && d < t1 - 0.25);
    const anchors = [t0, ...downs];
    let bounds = [];
    anchors.forEach((a, i) => {
      const b = i + 1 < anchors.length ? anchors[i + 1] : t1;
      const n = Math.max(1, Math.round((b - a) / bar));
      for (let k = 0; k < n; k++) bounds.push(land(a + ((b - a) * k) / n, fps));
    });
    // the three vertical panels open their own page: the nearest bar line snaps onto the first of them
    if (ev.came !== null) {
      let bi = -1, bd = 0.35;
      bounds.forEach((b, i) => { const d = Math.abs(b - ev.came); if (i > 0 && d < bd) { bd = d; bi = i; } });
      if (bi > 0) bounds[bi] = ev.came;
    }
    bounds = [...new Set(bounds)].sort((a, b) => a - b);
    const allBeats = (F.ev.beats || []).map((b) => land(b, fps));
    const pages = bounds.map((a, i) => {
      const b = i + 1 < bounds.length ? bounds[i + 1] : t1;
      // beats inside the bar, with half-time stretches filled in
      const raw = [a, ...allBeats.filter((x) => x > a + 0.08 && x < b - 0.08)];
      const beats = [];
      raw.forEach((x, k) => {
        const y = k + 1 < raw.length ? raw[k + 1] : b;
        const n = Math.max(1, Math.round((y - x) / beatS));
        for (let m = 0; m < n; m++) beats.push(land(x + ((y - x) * m) / n, fps));
      });
      return { index: i, t0: a, t1: b, beats: beats.slice(0, 6) };
    });
    const pageOf = (e) => pages.find((p) => e !== null && e >= p.t0 - 1e-6 && e < p.t1 - 1e-6) || null;
    const feature = (e, kind, extra = {}) => { const p = pageOf(e); if (p && !p.feature) p.feature = { kind, t: e, ...extra }; };
    if (ev.came !== null) {
      const p = pageOf(ev.came);
      if (p) p.triptych = [['cameEyes', ev.came], ['stride', ev.saw ?? ev.came + beatS], ['conquer', ev.conq ?? ev.came + 2 * beatS]];
    }
    feature(ev.king, 'crown');
    feature(ev.garden, 'garden');
    feature(ev.score, 'cascade');
    feature(ev.glow, 'glowHair');
    feature(ev.king2, 'crownHead');
    feature(ev.smoked, 'smoke', { poof: ev.smoked });
    feature(ev.box, 'box');
    if (ev.slice !== null) { const p = pageOf(ev.slice); if (p) p.slice = ev.slice; }
    if (ev.eye !== null) { const p = pageOf(ev.eye); if (p) p.eye = ev.eye; }
    // lay out every page
    let prevShots = [];
    pages.forEach((p, i) => {
      p.bg = i === 0 ? 'paper' : i % 2 ? 'royal' : 'paper';
      let tpl, panels = [];
      const used = new Set();
      const pickShot = (k) => {
        for (let n = 0; n < GENERIC_SHOTS.length; n++) {
          const s = GENERIC_SHOTS[(Math.floor(hashU(41, i, k) * 9) + n * 4) % GENERIC_SHOTS.length];
          if (!used.has(s) && !prevShots.includes(s)) { used.add(s); return s; }
        }
        for (const s of GENERIC_SHOTS) if (!used.has(s)) { used.add(s); return s; }
        return 'dribble';
      };
      if (p.triptych) {
        tpl = 'T3V';
        panels = p.triptych.map(([kind, t], k) => ({ slot: k, kind, t }));
      } else {
        const name = p.feature ? (p.feature.kind === 'glowHair' ? 'T3C' : p.feature.kind === 'cascade' ? 'T4C' : p.feature.kind === 'garden' ? 'T4B' : p.feature.kind === 'box' ? 'T3A' : p.feature.kind === 'smoke' ? 'T3B' : i === 0 ? 'T3A' : 'T3C')
          : GENERIC_TEMPLATES[(i + Math.floor(hashU(43, i, 1) * 3)) % GENERIC_TEMPLATES.length];
        tpl = name;
        const T0 = TEMPLATES[name];
        let times = p.beats.slice();
        if (p.feature) {
          let ft = p.feature.t;
          if (p.feature.kind === 'smoke') {                 // the defenders are on the page before they vanish
            const before = times.filter((x) => x < ft - 0.1);
            ft = before.length ? before[0] : ft;
            p.feature.slamT = ft;
          }
          times = times.filter((x) => Math.abs(x - ft) > 0.15);
          panels.push({ slot: T0.big, kind: p.feature.kind, t: ft, poof: p.feature.poof });
        }
        let k = 0;
        for (let sIdx = 0; sIdx < T0.slots.length; sIdx++) {
          if (p.feature && sIdx === T0.big) continue;
          if (i === 0 && sIdx === 1) { panels.push({ slot: sIdx, kind: 'cover', t: p.t0 }); continue; }
          let tt = times.shift();
          if (tt === undefined) break;
          if (i === 0 && tt <= p.t0 + 1e-6) tt = times.shift();      // page one: the cover owns the downbeat
          if (tt === undefined) break;
          panels.push({ slot: sIdx, kind: pickShot(k++), t: tt });
        }
      }
      p.template = tpl;
      p.panels = panels.map((q) => ({ ...q, ...slotGeometry(TEMPLATES[tpl].slots[q.slot]), seed: i * 7 + q.slot })).sort((a, b) => a.t - b.t);
      prevShots = p.panels.map((q) => q.kind);
    });
    return { pages, ev };
  });
}

// ---------------------------------------------------------------------------------------------
// Cached screentones: a radial burst (dots grow towards the edges) and a linear ramp.

function toneTile(g, kind, color) {
  return cached(`tone|${kind}|${color}|${g.scale}`, () => {
    const S = 640;
    const c = g.createCanvas(Math.round(S * g.scale), Math.round(S * g.scale));
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    halftone({ ctx: x, W: S, H: S, scale: g.scale, createCanvas: g.createCanvas }, { cell: 14, angle: 0.785, color, min: 0.04, w: S, h: S,
      amount: kind === 'burst'
        ? (px, py) => { const d = Math.hypot(px - S / 2, py - S / 2) / (S / 2); return d * d * 0.95; }
        : (px) => (px / S) * 0.95 });
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

function burst(g, ctx, box, color, alpha, k = 1.25) {
  if (alpha <= 0) return;
  const R = Math.max(box.w, box.h) * k;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(toneTile(g, 'burst', color), box.cx - R / 2, box.cy - R / 2, R, R);
  ctx.restore();
}

function ramp(g, ctx, box, color, alpha, angle = 0) {
  if (alpha <= 0) return;
  const R = Math.hypot(box.w, box.h);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(box.cx, box.cy);
  ctx.rotate(angle);
  ctx.drawImage(toneTile(g, 'ramp', color), -R / 2, -R / 2, R, R);
  ctx.restore();
}

function fillBox(ctx, box, a, b, vertical = true) {
  const gr = vertical ? ctx.createLinearGradient(0, box.y, 0, box.y + box.h) : ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  ctx.fillStyle = gr;
  ctx.fillRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
}

function sparkle(ctx, x, y, r, color, alpha = 1) {
  if (r <= 0.5 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r * 0.32, y); ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r * 0.32, y); ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.moveTo(x - r * 0.8, y); ctx.quadraticCurveTo(x, y, x, y - r * 0.26); ctx.quadraticCurveTo(x, y, x + r * 0.8, y);
  ctx.quadraticCurveTo(x, y, x, y + r * 0.26); ctx.quadraticCurveTo(x, y, x - r * 0.8, y);
  ctx.fill();
  ctx.restore();
}

function rays(ctx, cx, cy, n, R, rot, color, alpha, spread = 0.07) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - spread) * R, cy + Math.sin(a - spread) * R);
    ctx.lineTo(cx + Math.cos(a + spread) * R, cy + Math.sin(a + spread) * R);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/** Puppet placement with the head centre on (hx, hy) and head radius r. */
function headAt(d, pose, view, facing, r, hx, hy) {
  const scale = r / (d.headR * d.height);
  const j0 = solve(d, pose, { x: 0, y: 0, scale, view, facing });
  return { x: hx - j0.headC[0], y: hy - j0.headC[1], scale, view, facing };
}

// ---------------------------------------------------------------------------------------------
// The shots. Each draws inside a panel's bounding box `b` (already clipped to the panel), `a`
// seconds after the panel slammed in. X carries t, F, the palette, a per-panel seed and more.

const SHOTS = {
  dribble(ctx, b, a, X) {
    const { pal, t, g } = X;
    const f = X.flip ? -1 : 1;
    fillBox(ctx, b, X.pal.royal, '#0A1446');
    ctx.save();
    ctx.translate(b.x, b.y);
    streakLines(ctx, { angle: 0, n: 34, color: '#FFFFFF', alpha: 0.55, seed: X.seed, t: t * f * -1, speed: 2600, w: b.w, h: b.h });
    ctx.restore();
    const U = Math.min(b.h * 0.86, b.w * 1.4);
    const ground = b.y + b.h * 0.93;
    ctx.fillStyle = pal.pitch;
    ctx.fillRect(b.x - 4, ground - U * 0.02, b.w + 8, b.y + b.h - ground + U * 0.02 + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(b.x - 4, ground - U * 0.02, b.w + 8, Math.max(2, U * 0.006));
    ramp(g, ctx, b, '#000000', 0.22, f > 0 ? Math.PI : 0);
    const x = b.cx - f * b.w * 0.06;
    const ph = (t * 1.9 + X.seed * 0.13) % 1;
    const scale = U / KAISER.height;
    // motion lines trailing him
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 6; i++) {
      const yy = ground - U * (0.15 + 0.13 * i), len = U * (0.35 + 0.25 * hashU(X.seed, i, 3));
      ctx.fillRect(f > 0 ? x - U * 0.18 - len : x + U * 0.18, yy, len, Math.max(2, U * 0.008));
    }
    ctx.restore();
    drawPuppet(ctx, KAISER, cycles.run(ph), { x, ground, scale, view: 'side', facing: f, devScale: g.scale });
    const bounce = Math.abs(Math.sin(ph * TAU)) * U * 0.05;
    drawBall(ctx, x + f * U * 0.2, ground - U * 0.04 - bounce, U * 0.04, { rot: t * 14 * f });
  },

  defenders(ctx, b, a, X) {
    const { pal, g } = X;
    fillBox(ctx, b, pal.red, '#5E0A16');
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 70, inner: Math.min(b.w, b.h) * 0.18, outer: Math.max(b.w, b.h), color: '#FFFFFF', alpha: 0.45, seed: X.seed, frame: X.frame, hold: 3, width: 0.012 });
    burst(g, ctx, b, '#000000', 0.3);
    const d = rivalDesign('#F2F4FA', '#1B2340');
    const U = Math.min(b.h * 0.62, b.w * 0.75);
    const n = b.w > b.h * 1.2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const u = outCubic((a - i * 0.07) / 0.55);
      const f = (i + X.seed) % 2 ? 1 : -1;
      const pose = { ...blend(poses.stand, poses.fall, u), rot: -f * (0.15 + 1.25 * u) };
      const x = b.x + b.w * ((i + 0.5) / n) + f * u * U * 0.12;
      const ground = b.y + b.h * 0.86 + u * U * 0.08;
      const j = drawPuppet(ctx, d, pose, { x, ground, scale: U / d.height, view: 'side', facing: f, devScale: g.scale });
      const k = 1 - smooth((a - 0.25) / 0.5);
      for (let s = 0; s < 3; s++) {
        const ang = (s / 3) * TAU + a * 4 + i;
        sparkle(ctx, j.headC[0] + Math.cos(ang) * U * 0.14, j.headC[1] + Math.sin(ang) * U * 0.1, U * 0.06 * k, '#FFF4C8', k);
      }
    }
    // the blur of him cutting through
    const sx = b.x + b.w * (-0.2 + 1.4 * outCubic(a / 0.35));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85 * (1 - smooth((a - 0.3) / 0.3));
    ctx.drawImage(g.sprites.streak(pal.gold), sx - b.w * 0.8, b.cy - U * 0.08, b.w * 0.8, U * 0.16);
    ctx.drawImage(g.sprites.streak(pal.rose), sx - b.w * 0.7, b.cy + U * 0.04, b.w * 0.7, U * 0.1);
    ctx.restore();
  },

  ballCam(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0A1446', '#04061A');
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 110, inner: Math.min(b.w, b.h) * 0.12, outer: Math.max(b.w, b.h) * 0.9, color: '#FFFFFF', alpha: 0.65, seed: X.seed, frame: X.frame, hold: 2, width: 0.01 });
    burst(g, ctx, b, pal.royal, 0.6);
    const u = 1 - Math.exp(-a / 0.5);
    const R = Math.min(b.w, b.h) * (0.12 + 0.33 * u) * (1 + 0.06 * X.kick);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    ctx.drawImage(g.sprites.glow(pal.rose, 0), b.cx - R * 2.2, b.cy - R * 2.2, R * 4.4, R * 4.4);
    ctx.restore();
    drawBall(ctx, b.cx, b.cy, R, { rot: a * 9 + X.seed });
  },

  eyes(ctx, b, a, X) { eyesShot(ctx, b, a, X, false); },
  cameEyes(ctx, b, a, X) { eyesShot(ctx, b, a, X, true); },

  smirk(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, pal.gold, '#C9861A');
    burst(g, ctx, b, '#7A3A00', 0.35);
    rays(ctx, b.cx, b.cy, 14, Math.max(b.w, b.h), a * 0.3 + X.seed, '#FFF1B8', 0.35);
    const r = Math.max(b.w * 0.5, b.h * 0.62) * (1 + 0.04 * smooth(a / 1.5));
    const pose = { ...poses.stand, head: -0.08 };
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx - r * 0.1, b.cy - r * 0.72);
    drawPuppet(ctx, KAISER, pose, { ...o, outlineW: 1.2, devScale: g.scale });
    ramp(g, ctx, b, '#000000', 0.18, 0);
  },

  crownHand(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, pal.royal, '#0A1446');
    rays(ctx, b.cx, b.y + b.h * 0.3, 16, Math.max(b.w, b.h) * 1.2, a * 0.25 + X.seed, pal.gold, 0.25);
    burst(g, ctx, b, '#000000', 0.3);
    const r = Math.min(b.w * 0.2, b.h * 0.17);
    const pose = { ...poses.stand, sR: 2.75, eR: 0.25, sL: 0.25, eL: 0.4, head: -0.15 };
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx - r * 0.3, b.y + b.h * 0.62);
    const j = drawPuppet(ctx, KAISER, pose, { ...o, devScale: g.scale });
    const [hx, hy] = j.wristR;
    const s = slam(X.t + X.lead, X.t0, { attack: 0.06, peak: 1.3, hold: 1, decay: 0.15 });
    const bob = Math.sin(a * 4) * r * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(g.sprites.glow(pal.gold, 0), hx - r * 2.6, hy - r * 3.2 + bob, r * 5.2, r * 5.2);
    ctx.restore();
    drawCrown(ctx, hx, hy - r * 0.35 + bob, r * 1.9 * s, { fill: pal.gold, deep: KZ.goldDeep, jewel: pal.rose });
    for (let i = 0; i < 5; i++) {
      const ph = (a * 1.4 + hashU(X.seed, i, 1)) % 1;
      sparkle(ctx, hx + (hashU(X.seed, i, 2) - 0.5) * r * 3.2, hy - r * (1 + 1.8 * ph), r * 0.25 * (1 - ph), '#FFF6D0', 1 - ph);
    }
  },

  rose(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0A1446', pal.royal);
    burst(g, ctx, b, '#FFFFFF', 0.12);
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 60, inner: Math.min(b.w, b.h) * 0.35, outer: Math.max(b.w, b.h), color: '#BFD6FF', alpha: 0.3, seed: X.seed, frame: X.frame, hold: 4, width: 0.01 });
    const R = Math.min(b.w, b.h) * 0.38;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 + 0.3 * X.kick;
    ctx.drawImage(g.sprites.glow(pal.rose, 0), b.cx - R * 2.4, b.cy - R * 2.4, R * 4.8, R * 4.8);
    ctx.restore();
    drawRose(ctx, b.cx, b.cy, R * (1 + 0.05 * X.kick), { open: smooth(a / 0.7), rot: X.t * 0.25 + X.seed, color: pal.rose, deep: KZ.roseDeep, hi: KZ.roseHi });
    petals(ctx, b, a, X, 10);
  },

  chains(ctx, b, a, X) {
    const { g, pal } = X;
    const snapT = 0.28;
    const broken = smooth((a - snapT) / 0.3);
    fillBox(ctx, b, '#14141F', '#04040A');
    if (a > snapT) {
      const fl = Math.exp(-(a - snapT) / 0.12);
      ctx.fillStyle = g.color.css(pal.red, 0.55 * fl);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    burst(g, ctx, b, '#FFFFFF', 0.08);
    const L = Math.hypot(b.w, b.h);
    const link = Math.max(26, Math.min(b.w, b.h) * 0.11);
    for (const [k, ang] of [[0, 0.32], [1, -0.32]]) {
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(ang);
      drawChain(ctx, -L * 0.6, 0, L * 0.6, 0, { sag: link * (0.6 + k * 0.4), link, width: link * 0.22, broken, color: KZ.chain, deep: KZ.chainDeep });
      ctx.restore();
    }
    if (a > snapT) {                                   // sparks from the break
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        const age = a - snapT, ang = hashU(X.seed, i, 1) * TAU, sp = 300 + 500 * hashU(X.seed, i, 2);
        const px = b.cx + Math.cos(ang) * sp * age, py = b.cy + Math.sin(ang) * sp * age + 500 * age * age;
        const k = 1 - clamp01(age / 0.6);
        if (k <= 0) continue;
        ctx.globalAlpha = k;
        ctx.drawImage(g.sprites.glow(i % 3 ? pal.gold : '#FFFFFF', 1), px - 18 * k, py - 18 * k, 36 * k, 36 * k);
      }
      ctx.restore();
    }
  },

  net(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0B1A4A', '#04061A');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(g.sprites.glow('#DCEBFF', 0), b.x + b.w * 0.6, b.y - b.h * 0.5, b.w, b.w);
    ctx.restore();
    const ix = b.cx + b.w * 0.08, iy = b.cy + b.h * 0.05;
    const hitA = 0.08;
    netGrid(ctx, b, ix, iy, a - hitA, Math.min(b.w, b.h) * 0.09, b.w * 0.07);
    const bu = smooth(a / hitA);
    const bx = lerp(b.x - b.w * 0.1, ix, bu), by = lerp(b.y + b.h * 1.1, iy, bu);
    const R = Math.min(b.w, b.h) * 0.11 * (a < hitA ? 1.4 - 0.4 * bu : 1);
    drawBall(ctx, bx, by, R, { rot: a * 6 });
    if (a > hitA) speedLines(ctx, { cx: ix, cy: iy, n: 40, inner: R * 1.4, outer: R * 4, color: '#FFFFFF', alpha: 0.8 * Math.exp(-(a - hitA) / 0.2), seed: X.seed, frame: X.frame, hold: 2, width: 0.03 });
    ramp(g, ctx, b, '#000000', 0.25, Math.PI / 2);
  },

  crown(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, pal.royal, '#0A1446');
    rays(ctx, b.cx, b.cy, 18, Math.max(b.w, b.h), a * 0.35, pal.gold, 0.35);
    burst(g, ctx, b, '#000000', 0.35);
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 80, inner: Math.min(b.w, b.h) * 0.42, outer: Math.max(b.w, b.h), color: '#FFF1B8', alpha: 0.5, seed: X.seed, frame: X.frame, hold: 2, width: 0.008 });
    const s = slam(X.t + X.lead, X.t0, { attack: 0.06, peak: 1.4, hold: 1, decay: 0.16 });
    const w = Math.min(b.w * 0.62, b.h * 0.9) * s * (1 + 0.04 * X.kick);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(g.sprites.glow(pal.gold, 0), b.cx - w * 1.3, b.cy - w * 1.2, w * 2.6, w * 2.4);
    ctx.restore();
    drawCrown(ctx, b.cx, b.cy + w * 0.3, w, { fill: pal.gold, deep: KZ.goldDeep, jewel: pal.rose, lineW: Math.max(3, w * 0.025) });
    for (let i = 0; i < 8; i++) {
      const ph = (a * 1.2 + hashU(X.seed, i, 1)) % 1;
      const ang = hashU(X.seed, i, 2) * TAU, d = w * (0.55 + 0.4 * ph);
      sparkle(ctx, b.cx + Math.cos(ang) * d, b.cy + Math.sin(ang) * d * 0.7, w * 0.07 * (1 - ph), '#FFFFFF', 1 - ph);
    }
  },

  crownHead(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0A1446', pal.royal);
    rays(ctx, b.cx, b.y + b.h * 0.35, 18, Math.max(b.w, b.h) * 1.1, a * 0.3, pal.gold, 0.28);
    burst(g, ctx, b, '#000000', 0.35);
    const r = Math.min(b.h * 0.28, b.w * 0.3);
    const pose = { ...poses.stand, head: -0.06 };
    const hy = b.y + b.h * 0.62;
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx, hy);
    drawPuppet(ctx, KAISER, pose, { ...o, devScale: g.scale });
    const land0 = 0.32;
    const u = outBack(a / land0);
    const cy = lerp(b.y - r, hy - r * 1.05, u);
    const w = r * 1.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(g.sprites.glow(pal.gold, 0), b.cx - w * 1.3, cy - w * 1.2, w * 2.6, w * 2.2);
    ctx.restore();
    drawCrown(ctx, b.cx, cy, w, { fill: pal.gold, deep: KZ.goldDeep, jewel: pal.rose, lineW: Math.max(3, w * 0.03) });
    if (a > land0) {
      const k = Math.exp(-(a - land0) / 0.15);
      speedLines(ctx, { cx: b.cx, cy: cy - w * 0.3, n: 50, inner: w * 0.7, outer: Math.max(b.w, b.h), color: '#FFFFFF', alpha: 0.8 * k, seed: X.seed + 3, frame: X.frame, hold: 2, width: 0.012 });
    }
  },

  garden(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#081040', pal.royal);
    burst(g, ctx, b, '#FFFFFF', 0.1);
    const n = 30;
    const items = cached(`garden|${Math.round(b.w)}|${Math.round(b.h)}|${X.seed}`, () => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const x = b.x + b.w * hashU(X.seed, i, 1), y = b.y + b.h * (hashU(X.seed, i, 2) * 1.05 - 0.02);
        const r = Math.min(b.w, b.h) * (0.07 + 0.11 * hashU(X.seed, i, 3));
        out.push({ x, y, r, rot: hashU(X.seed, i, 4) * TAU, d: Math.hypot(x - b.cx, y - b.cy) / Math.hypot(b.w, b.h), u });
      }
      return out.sort((p, q) => p.r - q.r);
    });
    for (const it of items) {
      const open = smooth((a - it.d * 0.5) / 0.35);
      if (open <= 0) continue;
      const pulse = 1 + 0.06 * X.kick;
      drawRose(ctx, it.x, it.y, it.r * (0.5 + 0.5 * open) * pulse, { open, rot: it.rot + X.t * 0.2, color: pal.rose, deep: KZ.roseDeep, hi: KZ.roseHi });
    }
    petals(ctx, b, a, X, 14);
  },

  cascade(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0B1A4A', '#04061A');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(g.sprites.glow('#DCEBFF', 0), b.cx - b.w * 0.5, b.y - b.h * 0.9, b.w, b.w);
    ctx.restore();
    // the goal: a net behind a white frame, the balls piling up inside it
    const gx0 = b.x + b.w * 0.12, gx1 = b.x + b.w * 0.88, gy0 = b.y + b.h * 0.18, gy1 = b.y + b.h * 0.94;
    netGrid(ctx, { x: gx0, y: gy0, w: gx1 - gx0, h: gy1 - gy0, cx: (gx0 + gx1) / 2, cy: (gy0 + gy1) / 2 }, (gx0 + gx1) / 2, gy1, a, (gx1 - gx0) * 0.05, (gx1 - gx0) * 0.03, 0.6);
    const R = Math.min(b.w, b.h) * 0.055;
    const n = 34, rate = 0.045;
    const per = Math.max(1, Math.floor((gx1 - gx0 - 2 * R) / (2 * R)));
    for (let k = 0; k < n; k++) {
      const born = k * rate;
      const age = a - born;
      if (age < 0) break;
      const col = k % per, row = Math.floor(k / per);
      const rx = gx0 + R * 1.2 + col * 2 * R + (row % 2) * R + (hashU(X.seed, k, 1) - 0.5) * R * 0.4;
      const ry = gy1 - R * 1.05 - row * 1.7 * R;
      const sx = rx + (hashU(X.seed, k, 2) - 0.5) * b.w * 0.5;
      const sy = b.y - R * 2;
      const fall = 0.32;
      const u = clamp01(age / fall);
      const x = lerp(sx, rx, u), y = u < 1 ? lerp(sy, ry, u * u) : ry - Math.abs(Math.sin((age - fall) * 18)) * R * 0.5 * Math.exp(-(age - fall) * 8);
      drawBall(ctx, x, y, R, { rot: age * 8 + k });
    }
    // the white posts and crossbar in front
    ctx.fillStyle = '#F7F9FF';
    ctx.strokeStyle = KZ.ink;
    ctx.lineWidth = 4;
    const pw = Math.max(10, b.w * 0.022);
    for (const [x, y, w, h] of [[gx0 - pw, gy0 - pw, pw, gy1 - gy0 + pw], [gx1, gy0 - pw, pw, gy1 - gy0 + pw], [gx0 - pw, gy0 - pw, gx1 - gx0 + 2 * pw, pw]]) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    speedLines(ctx, { cx: b.cx, cy: b.y - b.h * 0.2, n: 50, inner: b.h * 0.3, outer: b.h * 1.6, color: '#FFFFFF', alpha: 0.3, seed: X.seed, frame: X.frame, hold: 2, width: 0.01 });
  },

  glowHair(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#04061A', '#0A1446');
    rays(ctx, b.cx, b.y + b.h * 0.35, 20, Math.max(b.w, b.h) * 1.2, a * 0.2, '#7FB0FF', 0.18);
    const r = Math.min(b.h * 0.3, b.w * 0.34);
    const pose = { ...poses.stand, head: -0.05 };
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx, b.y + b.h * 0.47);
    const glow = smooth(a / 0.25) * (0.85 + 0.15 * Math.sin(a * 7)) * (1 + 0.3 * X.kick);
    const j = solve(KAISER, pose, o);
    // a halo of light behind the hair
    if (traceHead(ctx, j, 'hair')) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = g.color.css('#7FE3FF', 1);
      ctx.shadowBlur = r * 0.5 * g.scale;
      ctx.lineWidth = r * 0.12;
      ctx.strokeStyle = g.color.css('#9FE8FF', 0.9 * glow);
      ctx.stroke();
      ctx.restore();
    }
    drawPuppet(ctx, KAISER, pose, { ...o, devScale: g.scale });
    // rim light inside the hair edge, and on top of it a hot white line
    if (traceHead(ctx, j, 'hair')) {
      ctx.save();
      ctx.clip();
      traceHead(ctx, j, 'hair');
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = r * 0.22;
      ctx.strokeStyle = g.color.css('#3DE0FF', 0.55 * glow);
      ctx.stroke();
      ctx.lineWidth = r * 0.07;
      ctx.strokeStyle = g.color.css('#FFFFFF', 0.85 * glow);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 9; i++) {
      const ph = (a * 0.9 + hashU(X.seed, i, 1)) % 1;
      const ang = Math.PI * (1.05 + 0.9 * hashU(X.seed, i, 2));
      const d = r * (1.3 + 0.8 * ph);
      sparkle(ctx, j.headC[0] + Math.cos(ang) * d, j.headC[1] + Math.sin(ang) * d, r * 0.12 * (1 - ph), '#DFF6FF', (1 - ph) * glow);
    }
  },

  stride(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0A1446', pal.royal);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(g.sprites.glow('#DCEBFF', 0), b.cx - b.w, b.y - b.w * 0.9, b.w * 2, b.w * 1.4);
    ctx.restore();
    ctx.save();
    ctx.translate(b.x, b.y);
    streakLines(ctx, { angle: 0, n: 22, color: '#FFFFFF', alpha: 0.35, seed: X.seed, t: -X.t, speed: 1400, w: b.w, h: b.h });
    ctx.restore();
    const U = Math.min(b.h * 0.8, b.w * 1.25);
    const ground = b.y + b.h * 0.95;
    ctx.fillStyle = pal.pitch;
    ctx.fillRect(b.x - 4, ground, b.w + 8, b.h);
    const ph = (X.t * 0.95) % 1;
    drawPuppet(ctx, KAISER, { ...cycles.walk(ph, 1.15), lean: 0.02, head: -0.12 }, { x: b.cx, ground, scale: U / KAISER.height, view: 'side', facing: 1, devScale: g.scale });
    ramp(g, ctx, b, '#000000', 0.25, -Math.PI / 2);
  },

  conquer(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#2A0A12', '#5E0A16');
    rays(ctx, b.cx, b.y + b.h * 0.3, 16, b.h * 1.2, 0.1 + a * 0.15, pal.gold, 0.3, 0.06);
    burst(g, ctx, b, '#000000', 0.35);
    const U = Math.min(b.h * 0.7, b.w * 1.1);
    const ground = b.y + b.h * 0.9;
    ctx.fillStyle = '#1A0610';
    ctx.fillRect(b.x - 4, ground, b.w + 8, b.h);
    const d = rivalDesign('#F2F4FA', '#1B2340');
    for (const [k, f] of [[0, -1], [1, 1]]) {           // the fallen, flat on the ground at his feet
      const pose = { ...poses.slump, rot: f * Math.PI / 2, sL: 1.6, sR: 0.4, hL: 0.4, kL: 0.8 };
      drawPuppet(ctx, d, pose, { x: b.cx + f * U * (0.2 + 0.05 * k), ground: ground + U * 0.01, scale: (U * 0.8) / d.height, view: 'side', facing: f, devScale: g.scale });
    }
    const pose = { ...poses.stand, sL: 0.3, sR: 0.3, eL: 1.9, eR: 1.9, head: -0.15, lean: -0.04 };
    drawPuppet(ctx, KAISER, pose, { x: b.cx, ground, scale: U / KAISER.height, view: 'front', facing: 1, devScale: g.scale });
  },

  smoke(ctx, b, a, X) {
    const { g, pal } = X;
    const poofA = X.poof !== undefined && X.poof !== null ? X.t - X.poof + X.lead : -1;
    fillBox(ctx, b, pal.paper, '#C8CEDE');
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 60, inner: Math.min(b.w, b.h) * 0.3, outer: Math.max(b.w, b.h), color: KZ.ink, alpha: 0.25, seed: X.seed, frame: X.frame, hold: 3, width: 0.008 });
    const d = rivalDesign('#F2F4FA', '#1B2340');
    const U = Math.min(b.h * 0.62, b.w * 0.4);
    const ground = b.y + b.h * 0.86;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = b.x + b.w * ((i + 0.5) / n);
      const vanish = poofA >= 0 ? smooth((poofA - i * 0.04) / 0.12) : 0;
      if (vanish < 1) {
        const pose = { ...poses.stand, sL: 0.5, sR: 0.5, eL: 0.6, eR: 0.6, head: 0.1 };
        drawPuppet(ctx, d, pose, { x, ground, scale: U / d.height, view: 'front', facing: 1, alpha: 1 - vanish, devScale: g.scale });
      }
      if (poofA >= 0) smokePuff(ctx, g, x, ground - U * 0.45, U * 0.42, poofA - i * 0.04, X.seed + i, pal);
    }
    ramp(g, ctx, b, KZ.ink, 0.2, Math.PI / 2);
  },

  box(ctx, b, a, X) {
    const { g, pal } = X;
    // the pitch from above: mown stripes, the penalty area, the six-yard box, the spot and the arc
    const stripeW = b.w / 9;
    for (let i = -1; i < 10; i++) {
      ctx.fillStyle = i % 2 ? pal.pitch : g.color.mix(pal.pitch, '#2E8A5A', 0.35);
      ctx.fillRect(b.x + i * stripeW, b.y - 4, stripeW + 1, b.h + 8);
    }
    const gl = b.y + b.h * 0.1;                          // the goal line near the top
    const aw = b.w * 0.72, ah = b.h * 0.5, sw = b.w * 0.34, sh = b.h * 0.17;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(3, b.w * 0.006);
    ctx.beginPath();
    ctx.moveTo(b.x - 10, gl); ctx.lineTo(b.x + b.w + 10, gl);
    ctx.rect(b.cx - aw / 2, gl, aw, ah);
    ctx.rect(b.cx - sw / 2, gl, sw, sh);
    ctx.moveTo(b.cx + ah * 0.42, gl + ah);
    ctx.arc(b.cx, gl + ah * 0.7, ah * 0.42, 0.78, Math.PI - 0.78);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(b.cx, gl + ah * 0.7, ctx.lineWidth * 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#F7F9FF';                          // the goal
    ctx.fillRect(b.cx - sw * 0.3, gl - b.h * 0.05, sw * 0.6, b.h * 0.05);
    ctx.strokeStyle = KZ.ink; ctx.lineWidth = 3;
    ctx.strokeRect(b.cx - sw * 0.3, gl - b.h * 0.05, sw * 0.6, b.h * 0.05);
    // his run: a glowing curved path into the box, the head of it where he is now
    const u = smooth(a / 1.1);
    const P0 = [b.x + b.w * 0.12, b.y + b.h * 1.02], P1 = [b.x + b.w * 0.2, gl + ah * 0.7], P2 = [b.cx + aw * 0.12, gl + ah * 0.42];
    const at = (k) => [lerp(lerp(P0[0], P1[0], k), lerp(P1[0], P2[0], k), k), lerp(lerp(P0[1], P1[1], k), lerp(P1[1], P2[1], k), k)];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [wd, al] of [[22, 0.25], [8, 0.9]]) {
      ctx.strokeStyle = g.color.css(wd > 10 ? pal.rose : '#BFE6FF', al);
      ctx.lineWidth = wd;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const [px, py] = at((k / 24) * u); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    }
    ctx.restore();
    const [kx, ky] = at(u);
    // defenders from above (small, flattened), then him
    const d = rivalDesign('#F2F4FA', '#1B2340');
    const U = b.h * 0.2;
    for (let i = 0; i < 3; i++) {
      const dx = b.cx + (i - 1) * aw * 0.28, dy = gl + ah * (0.35 + 0.12 * (i % 2));
      topDown(ctx, g, d, poses.stand, dx, dy, U * 0.9, 1);
    }
    topDown(ctx, g, KAISER, cycles.run((X.t * 1.8) % 1), kx, ky, U, 1);
    drawBall(ctx, kx + U * 0.12, ky - U * 0.1, U * 0.06, { rot: X.t * 10 });
    ramp(g, ctx, b, '#000000', 0.2, Math.PI / 2);
  },
};

/** A figure seen from high above: the front-view puppet squashed onto the ground, with a shadow. */
function topDown(ctx, g, d, pose, x, y, U, facing) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + U * 0.05, y + U * 0.03, U * 0.17, U * 0.08, 0, 0, TAU); ctx.fill();
  ctx.translate(x, y);
  ctx.scale(1, 0.62);
  drawPuppet(ctx, d, pose, { x: 0, ground: 0, scale: U / d.height, view: 'front', facing, devScale: g.scale });
  ctx.restore();
}

function eyesShot(ctx, b, a, X, tall) {
  const { g, pal } = X;
  fillBox(ctx, b, '#04061A', '#0A1446');
  const r = (tall ? Math.max(b.w * 0.62, b.h * 0.36) : Math.max(b.w * 0.6, b.h * 1.25)) * (1 + 0.05 * smooth(a / 1.6));
  const pose = { ...poses.stand, head: 0 };
  const hx = b.cx + (X.flip ? 0.06 : -0.06) * r, hy = b.cy - 0.52 * r + (tall ? 0.18 * r : 0);
  const o = headAt(KAISER, pose, 'front', 1, r, hx, hy);
  drawPuppet(ctx, KAISER, pose, { ...o, outlineW: 1.1, devScale: g.scale });
  // letterbox shadows and a glint sweeping across the eyes
  const sh = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  sh.addColorStop(0, 'rgba(4,6,26,0.75)');
  sh.addColorStop(0.3, 'rgba(4,6,26,0)');
  sh.addColorStop(0.75, 'rgba(4,6,26,0)');
  sh.addColorStop(1, 'rgba(4,6,26,0.8)');
  ctx.fillStyle = sh;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const ey = hy + 0.52 * r;
  for (const ex of [hx - 0.35 * r, hx + 0.41 * r]) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.4 * X.kick;
    ctx.drawImage(g.sprites.glow(pal.rose, 0), ex - 0.3 * r, ey - 0.3 * r, 0.6 * r, 0.6 * r);
    ctx.restore();
  }
  const sweep = (a - 0.1) / 0.35;
  if (sweep > 0 && sweep < 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.sin(sweep * Math.PI) * 0.7;
    ctx.translate(lerp(b.x - b.w * 0.2, b.x + b.w * 1.2, sweep), ey);
    ctx.rotate(0.5);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-r * 0.04, -r, r * 0.08, 2 * r);
    ctx.restore();
  }
  sparkle(ctx, hx - 0.38 * r, ey - 0.06 * r, 0.16 * r * Math.exp(-Math.max(0, a - 0.05) / 0.25), '#FFFFFF');
}

function petals(ctx, b, a, X, n) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const life = 2.2, ph = hashU(X.seed, i, 7) * life;
    const age = ((X.t + ph) % life) / life;
    const x = b.x + b.w * hashU(X.seed, i, 8) + Math.sin(age * 6 + i) * b.w * 0.05;
    const y = b.y - 20 + (b.h + 40) * age;
    const s = Math.min(b.w, b.h) * 0.025;
    ctx.fillStyle = i % 2 ? KZ.rose : KZ.roseHi;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.55, age * 7 + i, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** A goal net as a diamond mesh, bulging around (ix, iy) with a ripple travelling out from it. */
function netGrid(ctx, b, ix, iy, age, depth, cell, alpha = 0.75) {
  const nx = Math.ceil(b.w / cell) + 2, ny = Math.ceil(b.h / cell) + 2;
  const disp = (x, y) => {
    if (age < 0) return [x, y];
    const dx = x - ix, dy = y - iy, d = Math.hypot(dx, dy) || 1;
    const R = Math.max(b.w, b.h) * 0.45;
    const bulge = depth * Math.exp(-(d * d) / (R * R * 0.18)) * Math.exp(-age / 1.2);
    const wave = depth * 0.4 * Math.sin(d / cell * 1.3 - age * 18) * Math.exp(-age / 0.5) * Math.exp(-d / R);
    const k = (bulge + wave) / d;
    return [x + dx * k * 0.6, y + dy * k * 0.6];
  };
  ctx.save();
  ctx.strokeStyle = `rgba(230,238,255,${alpha})`;
  ctx.lineWidth = Math.max(1.2, cell * 0.06);
  ctx.beginPath();
  for (let i = -1; i < nx; i++) {
    for (let k = 0; k <= ny; k++) {
      const [x, y] = disp(b.x + (i + k * 0.5) * cell - ny * cell * 0.25, b.y + k * cell);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    for (let k = 0; k <= ny; k++) {
      const [x, y] = disp(b.x + (i - k * 0.5) * cell + ny * cell * 0.25, b.y + k * cell);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function smokePuff(ctx, g, x, y, R, age, seed, pal) {
  if (age < 0 || age > 1.2) return;
  const u = outCubic(age / 0.5), fade = 1 - smooth((age - 0.5) / 0.7);
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const ang = hashU(seed, i, 1) * TAU, d = R * (0.2 + 0.55 * hashU(seed, i, 2)) * u;
    const rr = R * (0.28 + 0.25 * hashU(seed, i, 3)) * (0.4 + 0.8 * u);
    const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d * 0.8 - age * R * 0.3;
    ctx.globalAlpha = fade;
    ctx.fillStyle = i % 3 ? '#E9ECF5' : '#C9CFDF';
    ctx.strokeStyle = KZ.ink;
    ctx.lineWidth = Math.max(2, R * 0.03);
    ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.globalAlpha = fade * Math.exp(-age / 0.1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(g.sprites.glow('#FFFFFF', 1), x - R * 1.5, y - R * 1.5, R * 3, R * 3);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Panels and pages.

function tracePoly(ctx, poly) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** The slam: the panel lands big and settles with a little squash (fx.slam drives the overshoot). */
function slamScale(age) {
  return 1 + 0.35 * (1 - slam(age, 0, { attack: 0.1, peak: 1.15, hold: 1, decay: 0.08 }));
}

function drawPanel(g, q, t, X0, opts = {}) {
  const { ctx } = g;
  const age = t - q.t + X0.lead;
  if (age < 0) return;
  const s = opts.noSlam ? 1 : slamScale(age);
  const poly = opts.poly || q.poly, box = opts.box || q.box;
  const [cx, cy] = opts.c || q.c;
  const X = { ...X0, seed: q.seed, flip: q.seed % 2 === 1, t0: q.t, poof: q.poof };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.save();
  tracePoly(ctx, poly);
  ctx.clip();
  if (q.kind === 'cover') drawCoverShot(g, ctx, box, opts.cover ?? 1, X);
  else (SHOTS[q.kind] || SHOTS.dribble)(ctx, box, age, X);
  if (!opts.noSlam) {
    const fl = Math.exp(-age / 0.07);
    if (fl > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${(0.85 * fl).toFixed(3)})`;
      ctx.fillRect(box.x - 10, box.y - 10, box.w + 20, box.h + 20);
    }
  }
  ctx.restore();
  tracePoly(ctx, poly);
  ctx.lineJoin = 'miter';
  ctx.lineWidth = BORDER;
  ctx.strokeStyle = X0.pal.ink;
  ctx.stroke();
  ctx.restore();
  // impact lines bursting off the panel as it lands
  if (!opts.noSlam && age < 0.25) {
    const k = 1 - age / 0.25;
    speedLines(ctx, { cx, cy, n: 26, inner: Math.max(box.w, box.h) * 0.56, outer: Math.max(box.w, box.h) * (0.62 + 0.35 * (1 - k)), color: X0.bg === 'paper' ? X0.pal.ink : '#FFFFFF', alpha: 0.7 * k, seed: q.seed + 5, frame: X0.frame, hold: 1, width: 0.012 });
  }
}

/** The city's manga cover, cropped into a panel; u = 1 shows it exactly as the city froze it. */
function drawCoverShot(g, ctx, box, u, X) {
  const img = coverImage(g, { rose: X.pal.rose });
  const fr = COVER_FRAME;
  // source: the inside of the cover's border; destination: from the full cover to a crop of the slot
  const sx = fr.x, sy = fr.y, sw = fr.w, sh = fr.h;
  const k = Math.max(box.w / sw, box.h / sh) * 1.12;
  const fx = 990, fy = 470;                              // keep his face in view
  const dw = sw * k, dh = sh * k;
  let dx = box.cx - (fx - sx) * k, dy = box.cy - (fy - sy) * k * 0.92;
  dx = Math.min(box.x, Math.max(box.x + box.w - dw, dx));
  dy = Math.min(box.y, Math.max(box.y + box.h - dh, dy));
  const X0 = lerp(dx, sx, u), Y0 = lerp(dy, sy, u), W0 = lerp(dw, sw, u), H0 = lerp(dh, sh, u);
  const s = img.width / W;
  ctx.drawImage(img, sx * s, sy * s, sw * s, sh * s, X0, Y0, W0, H0);
}

function drawBackground(g, ctx, kind, pal, t, frame, seed) {
  if (kind === 'royal') {
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, pal.royal);
    gr.addColorStop(1, g.color.mix(pal.royal, '#0A1446', 0.55));
    ctx.fillStyle = gr;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    burst(g, ctx, { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 }, '#000000', 0.25, 1.2);
    speedLines(ctx, { cx: W / 2, cy: H / 2, n: 70, inner: 380, outer: 1300, color: '#FFFFFF', alpha: 0.12, seed, frame, hold: 4, width: 0.006 });
  } else {
    ctx.fillStyle = pal.paper;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    burst(g, ctx, { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 }, pal.ink, 0.12, 1.2);
    speedLines(ctx, { cx: W / 2, cy: H / 2, n: 70, inner: 380, outer: 1300, color: pal.ink, alpha: 0.08, seed, frame, hold: 4, width: 0.006 });
  }
}

function drawGhost(ctx, q, bg, pal) {
  ctx.save();
  tracePoly(ctx, q.poly);
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = bg === 'paper' ? 'rgba(11,11,24,0.22)' : 'rgba(255,255,255,0.3)';
  ctx.stroke();
  ctx.restore();
}

function drawPage(g, page, t, X, opts = {}) {
  const { ctx } = g;
  const pal = X.pal;
  drawBackground(g, ctx, page.bg, pal, t, X.frame, page.index * 13 + 1);
  const Xp = { ...X, bg: page.bg, page };
  for (const q of page.panels) if (t - q.t + X.lead < 0) drawGhost(ctx, q, page.bg, pal);
  for (const q of page.panels) {
    if (q.kind === 'cover' && page.index === 0) {
      // the hand-off: the city's frozen cover shrinks from the full frame into its slot
      const u = outCubic((t - q.t) / 0.42);
      const fr = COVER_FRAME;
      const full = [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]];
      const poly = q.poly.map(([x, y], i) => [lerp(full[i][0], x, u), lerp(full[i][1], y, u)]);
      const box = { x: lerp(fr.x, q.box.x, u), y: lerp(fr.y, q.box.y, u), w: lerp(fr.w, q.box.w, u), h: lerp(fr.h, q.box.h, u) };
      box.cx = box.x + box.w / 2; box.cy = box.y + box.h / 2;
      continue;
    }
    drawPanel(g, q, t, Xp);
  }
  // the cover is drawn last so it stays on top while it shrinks
  const cv = page.panels.find((q) => q.kind === 'cover');
  if (cv && page.index === 0) {
    const u = outCubic((t - cv.t) / 0.42);
    const fr = COVER_FRAME;
    const full = [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]];
    const poly = cv.poly.map(([x, y], i) => [lerp(full[i][0], x, u), lerp(full[i][1], y, u)]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    drawPanel(g, cv, t, Xp, { noSlam: true, poly, box, c: [box.cx, box.cy], cover: 1 - u });
  }
}

// ---------------------------------------------------------------------------------------------

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const fps = F.fps || 30;
  const pal = paletteOf(S);
  const plan = planOf(F, P, S);
  coverImage(g, { rose: pal.rose });                    // built on a worker's first frame of this scene
  const pages = plan.pages;
  let pi = 0;
  while (pi + 1 < pages.length && pages[pi + 1].t0 <= t + 1e-6) pi++;
  const page = pages[pi];
  const X = { g, t, F, pal, frame: F.frame, fps, lead: 1 / fps, kick: F.c.kick || 0, snare: F.c.snare || 0 };
  drawPage(g, page, t, X);
}
