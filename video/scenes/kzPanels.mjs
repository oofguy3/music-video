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
import { coverImage, COVER_FRAME, COVER_SHOT, traceHead } from './kzCity.mjs';

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
const FULL = { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 };

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
const FEATURE_TEMPLATE = { crown: 'T3A', garden: 'T4B', cascade: 'T4C', glowHair: 'T3C', crownHead: 'T3C', smoke: 'T3B', box: 'T3A' };
const AVOID = { crown: ['crownHand'], crownHead: ['crownHand'], garden: ['rose'], cascade: ['net', 'ballCam'], glowHair: ['eyes'], smoke: ['defenders'], box: [] };

/** A convex polygon shrunk by d along every edge (the gutters). */
function inset(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  const s = area > 0 ? 1 : -1;
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

function boundsOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function slotGeometry(norm) {
  const page = { x: MARGIN, y: MARGIN, w: W - 2 * MARGIN, h: H - 2 * MARGIN };
  const poly = inset(norm.map(([u, v]) => [page.x + u * page.w, page.y + v * page.h]), GUTTER / 2);
  const box = boundsOf(poly);
  return { poly, box, c: [box.cx, box.cy] };
}

// ---------------------------------------------------------------------------------------------
// The page plan: bars from the downbeats (long gaps split into bars of bpb beats), beats inside each
// bar, and the story beats placed on their pages. A pure function of the events and P, cached.

const STORY_KEYS = ['kingT', 'gardenT', 'scoreT', 'glowT', 'cameT', 'sawT', 'conqueredT', 'kingT2', 'smokedT', 'sliceT', 'eyeT', 'boxT'];

function planOf(F, P, S) {
  const fps = F.fps || 30;
  const key = `plan|${S.t0}|${S.t1}|${STORY_KEYS.map((k) => P[k]).join(',')}|${(F.ev.downbeats || []).length}|${(F.ev.beats || []).length}`;
  return cached(key, () => {
    const T = (k) => (typeof P[k] === 'number' && Number.isFinite(P[k]) && P[k] >= 0 ? land(P[k], fps) : null);
    const ev = { king: T('kingT'), garden: T('gardenT'), score: T('scoreT'), glow: T('glowT'), came: T('cameT'), saw: T('sawT'), conq: T('conqueredT'),
      king2: T('kingT2'), smoked: T('smokedT'), slice: T('sliceT'), eye: T('eyeT'), box: T('boxT') };
    const beatS = F.beatS || 0.4, bar = beatS * (F.bpb || 4);
    const t0 = land(S.t0, fps), t1 = land(S.t1, fps);
    const downs = (F.ev.downbeats || []).map((d) => land(d, fps)).filter((d) => d > t0 + 0.25 && d < t1 - 0.25);
    const anchors = [t0, ...downs];
    let bounds = [];
    anchors.forEach((a, i) => {
      const b = i + 1 < anchors.length ? anchors[i + 1] : t1;
      const n = Math.max(1, Math.round((b - a) / bar));
      for (let k = 0; k < n; k++) bounds.push(land(a + ((b - a) * k) / n, fps));
    });
    if (ev.came !== null) {                          // the three vertical panels open their own page
      let bi = -1, bd = 0.35;
      bounds.forEach((b, i) => { const d = Math.abs(b - ev.came); if (i > 0 && d < bd) { bd = d; bi = i; } });
      if (bi > 0) bounds[bi] = ev.came;
    }
    bounds = [...new Set(bounds)].sort((a, b) => a - b);
    const allBeats = (F.ev.beats || []).map((b) => land(b, fps));
    const pages = bounds.map((a, i) => {
      const b = i + 1 < bounds.length ? bounds[i + 1] : t1;
      const raw = [a, ...allBeats.filter((x) => x > a + 0.08 && x < b - 0.08)];
      const beats = [];
      raw.forEach((x, k) => {                         // half-time stretches are filled in
        const y = k + 1 < raw.length ? raw[k + 1] : b;
        const n = Math.max(1, Math.round((y - x) / beatS));
        for (let m = 0; m < n; m++) beats.push(land(x + ((y - x) * m) / n, fps));
      });
      return { index: i, t0: a, t1: b, beats: beats.slice(0, 6) };
    });
    const pageOf = (e) => pages.find((p) => e !== null && e >= p.t0 - 1e-6 && e < p.t1 - 1e-6) || null;
    const feature = (e, kind, extra = {}) => { const p = pageOf(e); if (p && !p.feature && !p.triptych) p.feature = { kind, t: e, ...extra }; };
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
    let prevShots = [];
    pages.forEach((p, i) => {
      p.bg = i % 2 ? 'royal' : 'paper';
      let tpl;
      const panels = [];
      const used = new Set([...(p.feature ? AVOID[p.feature.kind] || [] : []), ...(p.eye ? ['eyes'] : [])]);
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
        p.triptych.forEach(([kind, t], k) => panels.push({ slot: k, kind, t }));
      } else {
        tpl = p.feature ? FEATURE_TEMPLATE[p.feature.kind] || 'T3C' : GENERIC_TEMPLATES[(i + Math.floor(hashU(43, i, 1) * 3)) % GENERIC_TEMPLATES.length];
        const T0 = TEMPLATES[tpl];
        let times = p.beats.slice();
        if (p.feature) {
          let ft = p.feature.t;
          if (p.feature.kind === 'smoke') {             // the defenders are on the page before they vanish
            const before = times.filter((x) => x < ft - 0.1);
            ft = before.length ? before[0] : ft;
          }
          times = times.filter((x) => Math.abs(x - ft) > 0.15);
          panels.push({ slot: T0.big, kind: p.feature.kind, t: ft, poof: p.feature.poof });
        }
        let k = 0;
        for (let s = 0; s < T0.slots.length; s++) {
          if (p.feature && s === T0.big) continue;
          if (i === 0 && s === 1) { panels.push({ slot: s, kind: 'cover', t: p.t0 }); continue; }   // the cover arrives from the city
          let tt = times.shift();
          if (i === 0 && tt !== undefined && tt <= p.t0 + 1e-6) tt = times.shift();
          if (tt === undefined) break;
          panels.push({ slot: s, kind: pickShot(k++), t: tt });
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
// Cached screentones: a radial burst (dots grow towards the edges) and a linear ramp, plus a fine
// page-size burst for the page backgrounds.

function toneTile(g, kind, color, S = 640, cell = 14) {
  return cached(`tone|${kind}|${color}|${S}|${cell}|${g.scale}`, () => {
    const w = kind === 'page' ? W : S, h = kind === 'page' ? H : S;
    const c = g.createCanvas(Math.round(w * g.scale), Math.round(h * g.scale));
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    halftone({ ctx: x, W: w, H: h, scale: g.scale, createCanvas: g.createCanvas }, { cell, angle: 0.785, color, min: 0.04, w, h,
      amount: kind === 'ramp' ? (px) => (px / w) * 0.95
        : (px, py) => { const d = Math.hypot((px - w / 2) / (w / 2), (py - h / 2) / (h / 2)) / Math.SQRT2; return Math.min(0.95, d * d * 1.5); } });
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

function glowAt(ctx, g, col, x, y, r, alpha, core = 0) {
  if (alpha <= 0.005 || r <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(g.sprites.glow(col, core), x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
}

function sparkle(ctx, x, y, r, color, alpha = 1) {
  if (r <= 0.5 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha);
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

/** A shine on the crown: a white glint line and a sweeping highlight. */
function crownShine(ctx, g, x, baseY, w, a) {
  const h = w * 0.62;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(2, w * 0.025);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.42, baseY - w * 0.24); ctx.lineTo(x - w * 0.42, baseY - h * 0.85);
  ctx.moveTo(x - w * 0.36, baseY - w * 0.06); ctx.lineTo(x + w * 0.1, baseY - w * 0.06);
  ctx.stroke();
  ctx.restore();
  const k = ((a * 0.9) % 1.6) / 1.6;
  sparkle(ctx, x + lerp(-0.45, 0.45, k) * w, baseY - h * (0.3 + 0.4 * Math.sin(k * Math.PI)), w * 0.12 * Math.sin(k * Math.PI), '#FFFFFF');
}

// ---------------------------------------------------------------------------------------------
// The shots. Each draws inside a panel's bounding box `b` (already clipped to the panel), `a`
// seconds after the panel slammed in. X carries t, F, the palette, a per-panel seed and more.

const SHOTS = {
  dribble(ctx, b, a, X) {
    const { pal, t, g } = X;
    const f = X.flip ? -1 : 1;
    fillBox(ctx, b, pal.royal, '#0A1446');
    ctx.save();
    ctx.translate(b.x, b.y);
    streakLines(ctx, { angle: 0, n: 34, color: '#FFFFFF', alpha: 0.5, seed: X.seed, t: -t * f, speed: 2600, w: b.w, h: b.h });
    ctx.restore();
    const U = Math.min(b.h * 0.86, b.w * 1.3);
    const ground = b.y + b.h * 0.93;
    ctx.fillStyle = pal.pitch;
    ctx.fillRect(b.x - 4, ground - U * 0.02, b.w + 8, b.y + b.h - ground + U * 0.02 + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(b.x - 4, ground - U * 0.02, b.w + 8, Math.max(2, U * 0.006));
    ramp(g, ctx, b, '#000000', 0.22, f > 0 ? Math.PI : 0);
    const x = b.cx - f * b.w * 0.05;
    const ph = (t * 1.9 + X.seed * 0.13) % 1;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 6; i++) {                       // motion lines trailing him
      const yy = ground - U * (0.15 + 0.13 * i), len = U * (0.35 + 0.25 * hashU(X.seed, i, 3));
      ctx.globalAlpha = 0.85;
      ctx.fillRect(f > 0 ? x - U * 0.18 - len : x + U * 0.18, yy, len, Math.max(2, U * 0.008));
    }
    ctx.restore();
    drawPuppet(ctx, KAISER, cycles.run(ph), { x, ground, scale: U / KAISER.height, view: 'side', facing: f, devScale: g.scale });
    const bounce = Math.abs(Math.sin(ph * TAU)) * U * 0.05;
    drawBall(ctx, x + f * U * 0.2, ground - U * 0.04 - bounce, U * 0.04, { rot: t * 14 * f });
  },

  defenders(ctx, b, a, X) {
    const { pal, g } = X;
    fillBox(ctx, b, pal.red, '#5E0A16');
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 70, inner: Math.min(b.w, b.h) * 0.18, outer: Math.max(b.w, b.h), color: '#FFFFFF', alpha: 0.45, seed: X.seed, frame: X.frame, hold: 3, width: 0.012 });
    burst(g, ctx, b, '#000000', 0.3);
    const d = rivalDesign('#F2F4FA', '#1B2340');
    const n = b.w > b.h * 1.6 ? 3 : 2;
    const U = Math.min(b.h * 0.6, (b.w / n) * 0.8);
    // the gold-and-blue blur of him cutting through, which sends them flying
    const sx = b.x + b.w * (-0.2 + 1.4 * outCubic(a / 0.3));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.95 * (1 - smooth((a - 0.25) / 0.35));
    ctx.drawImage(g.sprites.streak(pal.gold), sx - b.w * 0.9, b.y + b.h * 0.62 - U * 0.1, b.w * 0.9, U * 0.2);
    ctx.drawImage(g.sprites.streak(pal.rose), sx - b.w * 0.75, b.y + b.h * 0.62 + U * 0.08, b.w * 0.75, U * 0.12);
    ctx.restore();
    for (let i = 0; i < n; i++) {
      const f = (i % 2 ? 1 : -1) * (X.flip ? -1 : 1);       // which way he is blown
      const k = outCubic((a - i * 0.05) / 0.28), dr = Math.max(0, a - 0.28);
      const pose = { ...blend(poses.stand, poses.fall, k), rot: -f * (0.3 + 0.95 * k + 0.55 * dr) };
      // placed by the pelvis, so they spin in the air instead of lying on a floor
      const x = b.cx + (i - (n - 1) / 2) * U * 0.8 + f * U * (0.1 * k + 0.1 * dr);
      const y = b.y + b.h * 0.56 - U * (0.1 * k + 0.06 * dr);
      const hit = Math.exp(-Math.max(0, a - i * 0.05) / 0.12);
      if (hit > 0.03) {                                    // a jagged white impact star behind him
        const cx = x, cy = y - U * 0.12;
        ctx.save();
        ctx.globalAlpha = hit;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        for (let m = 0; m < 22; m++) {
          const an = (m / 22) * TAU, rr = U * (m % 2 ? 0.28 : 0.55 + 0.2 * hashU(X.seed + i, m, 1));
          ctx.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const j = drawPuppet(ctx, d, pose, { x, y, scale: U / d.height, view: 'side', facing: f, devScale: g.scale });
      const s = 1 - smooth((a - 0.15) / 0.6);
      for (let m = 0; m < 3; m++) {
        const ang = (m / 3) * TAU + a * 5 + i;
        sparkle(ctx, j.headC[0] + Math.cos(ang) * U * 0.17, j.headC[1] + Math.sin(ang) * U * 0.13, U * 0.08 * s, '#FFF4C8', s);
      }
    }
  },

  ballCam(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0A1446', '#04061A');
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 110, inner: Math.min(b.w, b.h) * 0.12, outer: Math.max(b.w, b.h) * 0.9, color: '#FFFFFF', alpha: 0.65, seed: X.seed, frame: X.frame, hold: 2, width: 0.01 });
    burst(g, ctx, b, pal.royal, 0.6);
    const u = 1 - Math.exp(-a / 0.5);
    const R = Math.min(b.w, b.h) * (0.12 + 0.33 * u) * (1 + 0.06 * X.kick);
    glowAt(ctx, g, pal.rose, b.cx, b.cy, R * 2.2, 0.6);
    drawBall(ctx, b.cx, b.cy, R, { rot: a * 9 + X.seed });
  },

  eyes(ctx, b, a, X) { eyesShot(ctx, b, a, X, false); },
  cameEyes(ctx, b, a, X) { eyesShot(ctx, b, a, X, true); },

  smirk(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, pal.gold, '#C9861A');
    burst(g, ctx, b, '#7A3A00', 0.35);
    rays(ctx, b.cx, b.cy, 14, Math.max(b.w, b.h), a * 0.3 + X.seed, '#FFF1B8', 0.35);
    // the lower face: the smirk, the chin and the blue rose on his neck
    const r = Math.min(Math.max(b.w * 0.42, b.h * 0.5), b.h * 0.95) * (1 + 0.04 * smooth(a / 1.5));
    const pose = { ...poses.stand, head: -0.12 };
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx - r * 0.12, b.cy - r * 0.98);
    drawPuppet(ctx, KAISER, pose, { ...o, outlineW: 1.2, devScale: g.scale });
    const j = solve(KAISER, pose, o);
    const c = Math.cos(j.headAng), s = Math.sin(j.headAng);
    glowAt(ctx, g, pal.rose, j.headC[0] + 0.4 * r * c - 1.42 * r * s, j.headC[1] + 0.4 * r * s + 1.42 * r * c, 0.45 * r, 0.6 + 0.4 * X.kick);
    ramp(g, ctx, b, '#000000', 0.18, 0);
  },

  crownHand(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, pal.royal, '#0A1446');
    rays(ctx, b.cx, b.y + b.h * 0.3, 16, Math.max(b.w, b.h) * 1.2, a * 0.25 + X.seed, pal.gold, 0.25);
    burst(g, ctx, b, '#000000', 0.3);
    const r = Math.min(b.w * 0.2, b.h * 0.2);
    const pose = { ...poses.stand, sR: 2.75, eR: 0.25, sL: 0.25, eL: 0.4, head: -0.15 };
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx - r * 0.3, b.y + b.h * 0.66);
    const j = drawPuppet(ctx, KAISER, pose, { ...o, devScale: g.scale });
    const [hx, hy] = j.wristR;
    const s = slam(X.t + X.lead, X.t0, { attack: 0.06, peak: 1.3, hold: 1, decay: 0.15 });
    const bob = Math.sin(a * 4) * r * 0.08;
    glowAt(ctx, g, pal.gold, hx, hy - r * 0.7 + bob, r * 2.6, 0.85);
    const w = r * 1.9 * s;
    drawCrown(ctx, hx, hy - r * 0.35 + bob, w, { fill: pal.gold, deep: KZ.goldDeep, jewel: pal.rose });
    crownShine(ctx, g, hx, hy - r * 0.35 + bob, w, a);
    for (let i = 0; i < 5; i++) {
      const ph = (a * 1.4 + hashU(X.seed, i, 1)) % 1;
      sparkle(ctx, hx + (hashU(X.seed, i, 2) - 0.5) * r * 3.2, hy - r * (1 + 1.8 * ph), r * 0.25 * (1 - ph), '#FFF6D0', 1 - ph);
    }
  },

  rose(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#050A2A', '#14329A');
    burst(g, ctx, b, '#FFFFFF', 0.1);
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 60, inner: Math.min(b.w, b.h) * 0.35, outer: Math.max(b.w, b.h), color: '#BFD6FF', alpha: 0.3, seed: X.seed, frame: X.frame, hold: 4, width: 0.01 });
    const R = Math.min(b.w, b.h) * 0.38;
    glowAt(ctx, g, pal.rose, b.cx, b.cy, R * 2.4, 0.7 + 0.3 * X.kick);
    drawRose(ctx, b.cx, b.cy, R * (1 + 0.05 * X.kick), { open: smooth(a / 0.7), rot: X.t * 0.25 + X.seed, color: pal.rose, deep: KZ.roseDeep, hi: KZ.roseHi });
    petals(ctx, b, a, X, 10);
  },

  chains(ctx, b, a, X) {
    const { g, pal } = X;
    const snapT = 0.26;
    const broken = smooth((a - snapT) / 0.3);
    fillBox(ctx, b, '#1A1A2A', '#04040A');
    glowAt(ctx, g, pal.red, b.cx, b.cy, Math.max(b.w, b.h) * 0.7, 0.35 + (a > snapT ? 0.6 * Math.exp(-(a - snapT) / 0.15) : 0));
    burst(g, ctx, b, '#FFFFFF', 0.08);
    const L = Math.hypot(b.w, b.h);
    const link = Math.max(30, Math.min(b.w, b.h) * 0.13);
    for (const [k, ang] of [[0, 0.3], [1, -0.3]]) {
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(ang);
      drawChain(ctx, -L * 0.6, 0, L * 0.6, 0, { sag: link * (0.5 + k * 0.4), link, width: link * 0.24, broken, color: '#E4EAF4', deep: KZ.chainDeep });
      ctx.restore();
    }
    if (a > snapT) {                                   // sparks from the break
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 20; i++) {
        const age = a - snapT, ang = hashU(X.seed, i, 1) * TAU, sp = 300 + 600 * hashU(X.seed, i, 2);
        const px = b.cx + Math.cos(ang) * sp * age, py = b.cy + Math.sin(ang) * sp * age + 500 * age * age;
        const k = 1 - clamp01(age / 0.6);
        if (k <= 0) continue;
        ctx.globalAlpha = k;
        ctx.drawImage(g.sprites.glow(i % 3 ? pal.gold : '#FFFFFF', 1), px - 20 * k, py - 20 * k, 40 * k, 40 * k);
      }
      ctx.restore();
      const fl = Math.exp(-(a - snapT) / 0.08);
      speedLines(ctx, { cx: b.cx, cy: b.cy, n: 40, inner: link, outer: Math.max(b.w, b.h), color: '#FFFFFF', alpha: 0.8 * fl, seed: X.seed + 9, frame: X.frame, hold: 1, width: 0.015 });
    }
  },

  net(ctx, b, a, X) {
    const { g } = X;
    fillBox(ctx, b, '#0B1A4A', '#04061A');
    glowAt(ctx, g, '#DCEBFF', b.x + b.w * 1.05, b.y, b.w * 0.6, 0.5);
    const ix = b.cx + b.w * 0.08, iy = b.cy + b.h * 0.05;
    const hitA = 0.08;
    netGrid(ctx, b, ix, iy, a - hitA, Math.min(b.w, b.h) * 0.09, Math.max(18, b.w * 0.06));
    const bu = smooth(a / hitA);
    const bx = lerp(b.x - b.w * 0.1, ix, bu), by = lerp(b.y + b.h * 1.1, iy, bu);
    const R = Math.min(b.w, b.h) * 0.12 * (a < hitA ? 1.4 - 0.4 * bu : 1);
    drawBall(ctx, bx, by, R, { rot: a * 6 });
    if (a > hitA) speedLines(ctx, { cx: ix, cy: iy, n: 40, inner: R * 1.4, outer: R * 4, color: '#FFFFFF', alpha: 0.85 * Math.exp(-(a - hitA) / 0.2), seed: X.seed, frame: X.frame, hold: 2, width: 0.03 });
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
    glowAt(ctx, g, pal.gold, b.cx, b.cy - w * 0.05, w * 1.3, 0.85);
    const base = b.cy + w * 0.3;
    drawCrown(ctx, b.cx, base, w, { fill: pal.gold, deep: KZ.goldDeep, jewel: pal.rose, lineW: Math.max(3, w * 0.025) });
    crownShine(ctx, g, b.cx, base, w, a);
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
    const landA = 0.32;
    const u = outBack(a / landA);
    const cy = lerp(b.y - r, hy - r * 1.05, u);
    const w = r * 1.55;
    glowAt(ctx, g, pal.gold, b.cx, cy - w * 0.3, w * 1.3, 0.75);
    drawCrown(ctx, b.cx, cy, w, { fill: pal.gold, deep: KZ.goldDeep, jewel: pal.rose, lineW: Math.max(3, w * 0.03) });
    crownShine(ctx, g, b.cx, cy, w, a);
    if (a > landA) {
      const k = Math.exp(-(a - landA) / 0.15);
      speedLines(ctx, { cx: b.cx, cy: cy - w * 0.3, n: 50, inner: w * 0.7, outer: Math.max(b.w, b.h), color: '#FFFFFF', alpha: 0.8 * k, seed: X.seed + 3, frame: X.frame, hold: 2, width: 0.012 });
    }
  },

  garden(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#03061C', '#0E1F66');
    glowAt(ctx, g, '#7FB0FF', b.cx, b.cy, Math.max(b.w, b.h) * 0.6, 0.35);
    burst(g, ctx, b, '#FFFFFF', 0.08);
    const items = cached(`garden|${Math.round(b.x)}|${Math.round(b.y)}|${Math.round(b.w)}|${Math.round(b.h)}|${X.seed}`, () => {
      const out = [];
      for (let i = 0; i < 32; i++) {
        const x = b.x + b.w * hashU(X.seed, i, 1), y = b.y + b.h * (hashU(X.seed, i, 2) * 1.05 - 0.02);
        const r = Math.min(b.w, b.h) * (0.07 + 0.11 * hashU(X.seed, i, 3));
        out.push({ x, y, r, rot: hashU(X.seed, i, 4) * TAU, d: Math.hypot(x - b.cx, y - b.cy) / Math.hypot(b.w, b.h) });
      }
      return out.sort((p, q) => p.r - q.r);
    });
    for (const it of items) {
      const open = smooth((a - it.d * 0.5) / 0.35);
      if (open <= 0) continue;
      const rr = it.r * (0.5 + 0.5 * open) * (1 + 0.06 * X.kick);
      glowAt(ctx, g, pal.rose, it.x, it.y, rr * 1.6, 0.25);
      drawRose(ctx, it.x, it.y, rr, { open, rot: it.rot + X.t * 0.2, color: pal.rose, deep: KZ.roseDeep, hi: '#DCE8FF' });
    }
    petals(ctx, b, a, X, 14);
    for (let i = 0; i < 6; i++) {
      const ph = (a * 0.8 + hashU(X.seed, i, 9)) % 1;
      sparkle(ctx, b.x + b.w * hashU(X.seed, i, 10), b.y + b.h * hashU(X.seed, i, 11), Math.min(b.w, b.h) * 0.03 * Math.sin(ph * Math.PI), '#FFFFFF');
    }
  },

  cascade(ctx, b, a, X) {
    const { g } = X;
    fillBox(ctx, b, '#0B1A4A', '#04061A');
    glowAt(ctx, g, '#DCEBFF', b.cx, b.y - b.h * 0.2, b.w * 0.5, 0.5);
    const gx0 = b.x + b.w * 0.1, gx1 = b.x + b.w * 0.9, gy0 = b.y + b.h * 0.16, gy1 = b.y + b.h * 0.95;
    const gb = { x: gx0, y: gy0, w: gx1 - gx0, h: gy1 - gy0, cx: (gx0 + gx1) / 2, cy: (gy0 + gy1) / 2 };
    netGrid(ctx, gb, gb.cx, gy1, a * 0.6, gb.w * 0.03, Math.max(18, gb.w * 0.028), 0.55);
    // the balls pour in from above and pile up in the goal
    const R = Math.min(b.w, b.h) * 0.06;
    const n = 46, rate = 0.012, fall = 0.26;
    const per = Math.max(1, Math.floor((gb.w - 2 * R) / (2 * R)));
    for (let k = 0; k < n; k++) {
      const age = a - k * rate;
      if (age < 0) break;
      const col = k % per, row = Math.floor(k / per);
      const rx = gx0 + R * 1.2 + col * 2 * R + (row % 2) * R + (hashU(X.seed, k, 1) - 0.5) * R * 0.5;
      const ry = gy1 - R * 1.05 - row * 1.72 * R;
      const sx = b.cx + (hashU(X.seed, k, 2) - 0.5) * b.w * 0.35, sy = b.y - R * 2;
      const u = clamp01(age / fall);
      const x = lerp(sx, rx, u), y = u < 1 ? lerp(sy, ry, u * u) : ry - Math.abs(Math.sin((age - fall) * 16)) * R * 0.45 * Math.exp(-(age - fall) * 7);
      drawBall(ctx, x, y, R, { rot: age * 8 + k });
    }
    ctx.fillStyle = '#F7F9FF';                          // the white posts and crossbar in front
    ctx.strokeStyle = KZ.ink;
    ctx.lineWidth = 4;
    const pw = Math.max(12, b.w * 0.022);
    for (const [x, y, w, h] of [[gx0 - pw, gy0 - pw, pw, gb.h + pw], [gx1, gy0 - pw, pw, gb.h + pw], [gx0 - pw, gy0 - pw, gb.w + 2 * pw, pw]]) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    speedLines(ctx, { cx: b.cx, cy: b.y - b.h * 0.3, n: 46, inner: b.h * 0.45, outer: b.h * 1.7, color: '#FFFFFF', alpha: 0.28, seed: X.seed, frame: X.frame, hold: 2, width: 0.006 });
  },

  glowHair(ctx, b, a, X) {
    const { g } = X;
    fillBox(ctx, b, '#03051A', '#0A1446');
    rays(ctx, b.cx, b.y + b.h * 0.35, 20, Math.max(b.w, b.h) * 1.2, a * 0.2, '#7FB0FF', 0.2);
    const r = Math.min(b.h * 0.3, b.w * 0.34);
    const pose = { ...poses.stand, head: -0.05 };
    const o = headAt(KAISER, pose, 'front', 1, r, b.cx, b.y + b.h * 0.47);
    const glow = smooth(a / 0.2) * (0.88 + 0.12 * Math.sin(a * 7)) * (1 + 0.35 * X.kick);
    const j = solve(KAISER, pose, o);
    glowAt(ctx, g, '#3DE0FF', j.headC[0], j.headC[1] - r * 0.3, r * 2.6, 0.55 * glow);
    if (traceHead(ctx, j, 'hair')) {                    // a halo of light around the hair
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = '#7FE3FF';
      ctx.shadowBlur = r * 0.45 * g.scale;
      ctx.lineWidth = r * 0.14;
      ctx.strokeStyle = g.color.css('#AEEBFF', Math.min(1, 0.95 * glow));
      ctx.stroke();
      ctx.restore();
    }
    drawPuppet(ctx, KAISER, pose, { ...o, devScale: g.scale });
    if (traceHead(ctx, j, 'hair')) {                    // rim light inside the hair edge, a hot white line on it
      ctx.save();
      ctx.clip();
      traceHead(ctx, j, 'hair');
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = r * 0.26;
      ctx.strokeStyle = g.color.css('#3DE0FF', Math.min(1, 0.6 * glow));
      ctx.stroke();
      ctx.lineWidth = r * 0.08;
      ctx.strokeStyle = g.color.css('#FFFFFF', Math.min(1, 0.9 * glow));
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 10; i++) {
      const ph = (a * 0.9 + hashU(X.seed, i, 1)) % 1;
      const ang = Math.PI * (1.05 + 0.9 * hashU(X.seed, i, 2));
      const d = r * (1.3 + 0.8 * ph);
      sparkle(ctx, j.headC[0] + Math.cos(ang) * d, j.headC[1] + Math.sin(ang) * d, r * 0.13 * (1 - ph), '#DFF6FF', (1 - ph) * glow);
    }
  },

  stride(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#0A1446', pal.royal);
    glowAt(ctx, g, '#DCEBFF', b.cx, b.y, b.w * 0.9, 0.55);
    ctx.save();
    ctx.translate(b.x, b.y);
    streakLines(ctx, { angle: 0, n: 22, color: '#FFFFFF', alpha: 0.35, seed: X.seed, t: -X.t, speed: 1400, w: b.w, h: b.h });
    ctx.restore();
    const U = Math.min(b.h * 0.86, b.w * 1.35);
    const ground = b.y + b.h * 0.96;
    ctx.fillStyle = pal.pitch;
    ctx.fillRect(b.x - 4, ground, b.w + 8, b.h);
    ramp(g, ctx, b, '#000000', 0.25, -Math.PI / 2);
    const ph = (X.t * 0.95) % 1;
    drawPuppet(ctx, KAISER, { ...cycles.walk(ph, 1.2), lean: 0.03, head: -0.12 }, { x: b.cx, ground, scale: U / KAISER.height, view: 'side', facing: 1, devScale: g.scale });
  },

  conquer(ctx, b, a, X) {
    const { g, pal } = X;
    fillBox(ctx, b, '#2A0A12', '#5E0A16');
    rays(ctx, b.cx, b.y + b.h * 0.3, 16, b.h * 1.2, 0.1 + a * 0.15, pal.gold, 0.32, 0.06);
    burst(g, ctx, b, '#000000', 0.35);
    glowAt(ctx, g, pal.gold, b.cx, b.y + b.h * 0.32, b.w * 0.8, 0.45);
    const U = Math.min(b.h * 0.66, b.w * 1.15);
    const ground = b.y + b.h * 0.86;
    ctx.fillStyle = '#16040C';
    ctx.fillRect(b.x - 4, ground, b.w + 8, b.h);
    const pose = { ...poses.stand, sL: 0.3, sR: 0.3, eL: 1.9, eR: 1.9, head: -0.15, lean: -0.04 };
    drawPuppet(ctx, KAISER, pose, { x: b.cx, ground, scale: U / KAISER.height, view: 'front', facing: 1, devScale: g.scale });
    // the fallen, flat on the ground in front of him
    const d = rivalDesign('#F2F4FA', '#1B2340');
    for (const [k, f] of [[0, -1], [1, 1]]) {
      const pose2 = { ...poses.slump, rot: f * Math.PI / 2, sL: 1.6, sR: 0.4, hL: 0.4, kL: 0.8 };
      drawPuppet(ctx, d, pose2, { x: b.cx + f * Math.min(U * 0.24, b.w * 0.22) * (1 + 0.15 * k), ground: ground + U * (0.06 + 0.03 * k), scale: (U * 0.5) / d.height, view: 'side', facing: -f, devScale: g.scale });
    }
  },

  smoke(ctx, b, a, X) {
    const { g, pal } = X;
    const poofA = X.poof !== undefined && X.poof !== null ? X.t - X.poof + X.lead : -1;
    fillBox(ctx, b, pal.paper, '#C8CEDE');
    speedLines(ctx, { cx: b.cx, cy: b.cy, n: 60, inner: Math.min(b.w, b.h) * 0.3, outer: Math.max(b.w, b.h), color: pal.ink, alpha: 0.25, seed: X.seed, frame: X.frame, hold: 3, width: 0.008 });
    const d = rivalDesign('#F2F4FA', '#1B2340');
    const U = Math.min(b.h * 0.66, b.w * 0.3);
    const ground = b.y + b.h * 0.9;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = b.x + b.w * ((i + 0.5) / n);
      const vanish = poofA >= 0 ? smooth((poofA - i * 0.05) / 0.1) : 0;
      if (vanish < 1) {
        const pose = { ...poses.stand, sL: 0.5, sR: 0.5, eL: 0.6, eR: 0.6, head: 0.1 };
        drawPuppet(ctx, d, pose, { x, ground, scale: U / d.height, view: 'front', facing: 1, alpha: 1 - vanish, devScale: g.scale });
      }
      if (poofA >= 0) smokePuff(ctx, g, x, ground - U * 0.45, U * 0.5, poofA - i * 0.05, X.seed + i, pal);
    }
    ramp(g, ctx, b, pal.ink, 0.15, Math.PI / 2);
  },

  box(ctx, b, a, X) {
    const { g, pal } = X;
    const stripeW = b.w / 9;                             // the pitch from above
    for (let i = -1; i < 10; i++) {
      ctx.fillStyle = i % 2 ? pal.pitch : g.color.mix(pal.pitch, '#2E8A5A', 0.35);
      ctx.fillRect(b.x + i * stripeW, b.y - 4, stripeW + 1, b.h + 8);
    }
    const gl = b.y + b.h * 0.1;
    const aw = b.w * 0.72, ah = b.h * 0.5, sw = b.w * 0.34, sh = b.h * 0.17;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(3, b.w * 0.006);
    ctx.beginPath();
    ctx.moveTo(b.x - 10, gl); ctx.lineTo(b.x + b.w + 10, gl);
    ctx.rect(b.cx - aw / 2, gl, aw, ah);
    ctx.rect(b.cx - sw / 2, gl, sw, sh);
    ctx.moveTo(b.cx + ah * 0.42 * Math.cos(0.78), gl + ah * 0.7 + ah * 0.42 * Math.sin(0.78));
    ctx.arc(b.cx, gl + ah * 0.7, ah * 0.42, 0.78, Math.PI - 0.78);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(b.cx, gl + ah * 0.7, ctx.lineWidth * 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#F7F9FF';
    ctx.fillRect(b.cx - sw * 0.3, gl - b.h * 0.05, sw * 0.6, b.h * 0.05);
    ctx.strokeStyle = KZ.ink; ctx.lineWidth = 3;
    ctx.strokeRect(b.cx - sw * 0.3, gl - b.h * 0.05, sw * 0.6, b.h * 0.05);
    // his run: a glowing curve into the box, with him at its head
    const u = 0.15 + 0.85 * smooth(a / 1.0);
    const P0 = [b.x + b.w * 0.1, b.y + b.h * 1.05], P1 = [b.x + b.w * 0.2, gl + ah * 0.75], P2 = [b.cx + aw * 0.1, gl + ah * 0.42];
    const at = (k) => [lerp(lerp(P0[0], P1[0], k), lerp(P1[0], P2[0], k), k), lerp(lerp(P0[1], P1[1], k), lerp(P1[1], P2[1], k), k)];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [wd, al] of [[24, 0.25], [8, 0.9]]) {
      ctx.strokeStyle = g.color.css(wd > 10 ? pal.rose : '#BFE6FF', al);
      ctx.lineWidth = wd;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const [px, py] = at((k / 24) * u); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    }
    ctx.restore();
    const [kx, ky] = at(u);
    const d = rivalDesign('#F2F4FA', '#1B2340');
    const U = b.h * 0.22;
    for (let i = 0; i < 3; i++) topDown(ctx, g, d, poses.stand, b.cx + (i - 1) * aw * 0.28, gl + ah * (0.33 + 0.12 * (i % 2)), U * 0.9, 1);
    glowAt(ctx, g, pal.rose, kx, ky - U * 0.2, U * 0.9, 0.5);
    topDown(ctx, g, KAISER, cycles.run((X.t * 1.8) % 1), kx, ky, U, 1);
    drawBall(ctx, kx + U * 0.14, ky - U * 0.08, U * 0.07, { rot: X.t * 10 });
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
  const sh = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);  // letterbox shadows
  sh.addColorStop(0, 'rgba(4,6,26,0.75)');
  sh.addColorStop(0.3, 'rgba(4,6,26,0)');
  sh.addColorStop(0.75, 'rgba(4,6,26,0)');
  sh.addColorStop(1, 'rgba(4,6,26,0.8)');
  ctx.fillStyle = sh;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const ey = hy + 0.52 * r;
  for (const ex of [hx - 0.35 * r, hx + 0.41 * r]) glowAt(ctx, g, pal.rose, ex, ey, 0.3 * r, 0.5 + 0.4 * X.kick);
  const sweep = (a - 0.1) / 0.35;                         // a glint sweeping across his eyes
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
  const R = Math.max(b.w, b.h) * 0.45;
  const disp = (x, y) => {
    if (age < 0) return [x, y];
    const dx = x - ix, dy = y - iy, d = Math.hypot(dx, dy) || 1;
    const bulge = depth * Math.exp(-(d * d) / (R * R * 0.18)) * Math.exp(-age / 1.2);
    const wave = depth * 0.4 * Math.sin((d / cell) * 1.3 - age * 18) * Math.exp(-age / 0.5) * Math.exp(-d / R);
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

/** A comic puff of smoke: overlapping circles merged into one inked cloud with screentone. */
function smokePuff(ctx, g, x, y, R, age, seed, pal) {
  if (age < 0 || age > 1.3) return;
  const u = outCubic(age / 0.45), fade = 1 - smooth((age - 0.55) / 0.7);
  const circles = [];
  for (let i = 0; i < 10; i++) {
    const ang = hashU(seed, i, 1) * TAU, d = R * (0.15 + 0.6 * hashU(seed, i, 2)) * u;
    const rr = R * (0.26 + 0.24 * hashU(seed, i, 3)) * (0.35 + 0.75 * u);
    circles.push([x + Math.cos(ang) * d, y + Math.sin(ang) * d * 0.75 - age * R * 0.4, rr]);
  }
  const path = () => { ctx.beginPath(); for (const [cx, cy, rr] of circles) { ctx.moveTo(cx + rr, cy); ctx.arc(cx, cy, rr, 0, TAU); } };
  ctx.save();
  ctx.globalAlpha = fade;
  path();
  ctx.lineWidth = Math.max(3, R * 0.07);
  ctx.strokeStyle = pal.ink;
  ctx.stroke();
  ctx.fillStyle = '#F4F6FB';
  ctx.fill('nonzero');
  path();
  ctx.clip('nonzero');
  ramp(g, ctx, { x: x - R * 1.4, y: y - R * 1.4, w: R * 2.8, h: R * 2.8, cx: x, cy: y }, '#7A84A0', 0.5, Math.PI / 2.5);
  ctx.restore();
  glowAt(ctx, g, '#FFFFFF', x, y, R * 1.6, fade * Math.exp(-age / 0.1), 1);
}

// ---------------------------------------------------------------------------------------------
// The full-frame eye and the sword slash.

/** One blue eye filling the frame, with a predator glint. a = seconds since it slammed in. */
function drawEyeXL(g, ctx, a, X) {
  const { pal } = X;
  ctx.fillStyle = '#04061A';
  ctx.fillRect(-20, -20, W + 40, H + 40);
  const zoom = 1 + 0.32 * Math.exp(-a / 0.07) + 0.05 * smooth(a / 0.8);
  const r = 3300 * zoom;
  const ex = W * 0.5, ey = H * 0.52;                     // the eye (his right on screen) at the centre
  const pose = { ...poses.stand, head: 0 };
  const o = headAt(KAISER, pose, 'front', 1, r, ex + 0.38 * r, ey - 0.52 * r);
  drawPuppet(ctx, KAISER, pose, { ...o, outlineW: 0.5, devScale: g.scale });
  const ix = ex + 0.03 * r, iy = ey;                     // the iris: fine radial striations, a dark ring
  const ir = 0.105 * r;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(ex, ey, 0.2 * r, 0.12 * r, 0, 0, TAU); ctx.clip();
  ctx.strokeStyle = 'rgba(160,210,255,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 64; i++) {
    const an = (i / 64) * TAU + hashU(7, i, 1) * 0.05, r0 = ir * (0.55 + 0.1 * hashU(7, i, 2)), r1 = ir * (0.9 - 0.15 * hashU(7, i, 3));
    ctx.moveTo(ix + Math.cos(an) * r0, iy + Math.sin(an) * r0); ctx.lineTo(ix + Math.cos(an) * r1, iy + Math.sin(an) * r1);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(10,20,70,0.55)';
  ctx.lineWidth = ir * 0.08;
  ctx.beginPath(); ctx.arc(ix, iy, ir * 0.96, 0, TAU); ctx.stroke();
  const top = ctx.createLinearGradient(0, ey - 0.12 * r, 0, ey);   // the lid's shadow over the top
  top.addColorStop(0, 'rgba(8,13,42,0.55)');
  top.addColorStop(1, 'rgba(8,13,42,0)');
  ctx.fillStyle = top;
  ctx.fillRect(ex - 0.25 * r, ey - 0.13 * r, 0.5 * r, 0.12 * r);
  ctx.restore();
  // the predator glint: a sharp star flaring on the eye's highlight, a streak across the frame
  const gl = Math.exp(-Math.max(0, a - 0.12) / 0.3) * smooth((a - 0.04) / 0.08);
  const gx = ex - 0.01 * r, gy = ey - 0.045 * r;
  glowAt(ctx, g, '#FFFFFF', gx, gy, 0.12 * r * (0.5 + gl), 0.9 * gl, 1);
  sparkle(ctx, gx, gy, 0.22 * r * gl, '#FFFFFF', gl);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.85 * gl;
  const sp = g.sprites.streak('#BFE0FF');
  ctx.drawImage(sp, gx - W * 0.5, gy - 14, W * 0.5, 28);
  ctx.translate(2 * gx, 0); ctx.scale(-1, 1);
  ctx.drawImage(sp, gx - W * 0.5, gy - 14, W * 0.5, 28);
  ctx.restore();
  speedLines(ctx, { cx: ex, cy: ey, n: 120, inner: 0.27 * r, outer: 1500, color: '#FFFFFF', alpha: 0.5 * Math.exp(-a / 0.35) + 0.12, seed: 91, frame: X.frame, hold: 2, width: 0.006 });
  const lb = ctx.createLinearGradient(0, 0, 0, H);         // a cinematic darkening top and bottom
  lb.addColorStop(0, 'rgba(4,6,26,0.7)');
  lb.addColorStop(0.22, 'rgba(4,6,26,0)');
  lb.addColorStop(0.8, 'rgba(4,6,26,0)');
  lb.addColorStop(1, 'rgba(4,6,26,0.75)');
  ctx.fillStyle = lb;
  ctx.fillRect(0, 0, W, H);
}

const SLASH = { x0: -60, y0: 930, x1: W + 60, y1: 130 };

/** The sword slash: a line of white light cuts the old page, whose halves then slide apart. */
function drawSlice(g, oldPage, a, X) {
  const { ctx } = g;
  const { x0, y0, x1, y1 } = SLASH;
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  const nx = -dy / L, ny = dx / L;                         // the cut's normal (pointing down-right)
  const part = outCubic((a - 0.03) / 0.42) * 760;
  const along = outCubic((a - 0.03) / 0.42) * 120;
  for (const side of [-1, 1]) {
    ctx.save();
    const ox = side * nx * part + side * (dx / L) * along, oy = side * ny * part + side * (dy / L) * along;
    ctx.translate(ox, oy);
    ctx.beginPath();
    const far = 4000;
    ctx.moveTo(x0 - (dx / L) * far, y0 - (dy / L) * far);
    ctx.lineTo(x1 + (dx / L) * far, y1 + (dy / L) * far);
    ctx.lineTo(x1 + (dx / L) * far + side * nx * far, y1 + (dy / L) * far + side * ny * far);
    ctx.lineTo(x0 - (dx / L) * far + side * nx * far, y0 - (dy / L) * far + side * ny * far);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(ox * g.scale, oy * g.scale);
    ctx.drawImage(oldPage, 0, 0);
    ctx.restore();
    // the cut edge glows
    ctx.save();
    ctx.translate(ox, oy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = g.color.css('#DCEBFF', 0.8 * Math.exp(-a / 0.25));
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(x0 - dx, y0 - dy); ctx.lineTo(x1 + dx, y1 + dy); ctx.stroke();
    ctx.restore();
  }
  // the slash itself: drawn across in two frames, then burning out
  const draw = outCubic((a + X.lead) / 0.07), fade = Math.exp(-Math.max(0, a - 0.06) / 0.16);
  const hx = lerp(x0, x1, draw), hy = lerp(y0, y1, draw);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [wd, col, al] of [[90, X.pal.rose, 0.25], [34, '#DCEBFF', 0.6], [9, '#FFFFFF', 1]]) {
    ctx.strokeStyle = g.color.css(col, al * fade);
    ctx.lineWidth = wd * (0.5 + 0.5 * fade);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(hx, hy); ctx.stroke();
  }
  glowAt(ctx, g, '#FFFFFF', hx, hy, 220, fade, 1);
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

function drawPanel(g, ctx, q, t, X0, opts = {}) {
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
  if (q.kind === 'cover') drawCoverShot(g, ctx, box, opts.cover ?? 0, X);
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
  ctx.lineWidth = opts.border ?? BORDER;
  ctx.strokeStyle = X0.pal.ink;
  ctx.stroke();
  ctx.restore();
  if (!opts.noSlam && age < 0.25) {                    // impact lines bursting off the panel as it lands
    const k = 1 - age / 0.25;
    speedLines(ctx, { cx, cy, n: 26, inner: Math.max(box.w, box.h) * 0.56, outer: Math.max(box.w, box.h) * (0.62 + 0.35 * (1 - k)), color: X0.bg === 'paper' ? X0.pal.ink : '#FFFFFF', alpha: 0.7 * k, seed: q.seed + 5, frame: X0.frame, hold: 1, width: 0.012 });
  }
}

/**
 * The city's manga cover inside a panel. full = 1 shows it exactly as the city froze it (the inside
 * of its border on the same pixels); full = 0 crops it into the panel, his face in view.
 */
function drawCoverShot(g, ctx, box, full, X) {
  const img = coverImage(g, { rose: X.pal.rose });
  const fr = COVER_FRAME;
  const k = Math.max(box.w / fr.w, box.h / fr.h) * 1.12;
  const dw = fr.w * k, dh = fr.h * k;
  let dx = box.cx - (COVER_SHOT.hx - fr.x) * k, dy = box.cy - (COVER_SHOT.hy - fr.y) * k * 0.9;
  dx = Math.min(box.x, Math.max(box.x + box.w - dw, dx));
  dy = Math.min(box.y, Math.max(box.y + box.h - dh, dy));
  const s = img.width / W;
  ctx.drawImage(img, fr.x * s, fr.y * s, fr.w * s, fr.h * s, lerp(dx, fr.x, full), lerp(dy, fr.y, full), lerp(dw, fr.w, full), lerp(dh, fr.h, full));
}

function drawBackground(g, ctx, kind, pal, frame, seed) {
  if (kind === 'royal') {
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, pal.royal);
    gr.addColorStop(1, g.color.mix(pal.royal, '#0A1446', 0.55));
    ctx.fillStyle = gr;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.drawImage(toneTile(g, 'page', '#000000', 0, 22), 0, 0, W, H);
    ctx.restore();
    speedLines(ctx, { cx: W / 2, cy: H / 2, n: 70, inner: 380, outer: 1300, color: '#FFFFFF', alpha: 0.12, seed, frame, hold: 4, width: 0.006 });
  } else {
    ctx.fillStyle = pal.paper;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.drawImage(toneTile(g, 'page', pal.ink, 0, 22), 0, 0, W, H);
    ctx.restore();
    speedLines(ctx, { cx: W / 2, cy: H / 2, n: 70, inner: 380, outer: 1300, color: pal.ink, alpha: 0.08, seed, frame, hold: 4, width: 0.006 });
  }
}

function drawGhost(ctx, q, bg) {
  ctx.save();
  tracePoly(ctx, q.poly);
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = bg === 'paper' ? 'rgba(11,11,24,0.22)' : 'rgba(255,255,255,0.3)';
  ctx.stroke();
  ctx.restore();
}

function drawPage(g, ctx, page, t, X) {
  drawBackground(g, ctx, page.bg, X.pal, X.frame, page.index * 13 + 1);
  const Xp = { ...X, bg: page.bg };
  for (const q of page.panels) if (t - q.t + X.lead < 0) drawGhost(ctx, q, page.bg);
  let cover = null;
  for (const q of page.panels) {
    if (q.kind === 'cover') { cover = q; continue; }
    drawPanel(g, ctx, q, t, Xp);
  }
  if (cover) {
    // the hand-off: the city's frozen cover shrinks from the whole frame into its slot (on top)
    const u = outCubic((t - cover.t) / 0.42);
    const fr = COVER_FRAME;
    const full = [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]];
    const poly = cover.poly.map(([x, y], i) => [lerp(full[i][0], x, u), lerp(full[i][1], y, u)]);
    const box = boundsOf(poly);
    drawPanel(g, ctx, cover, t, Xp, { noSlam: true, poly, box, c: [box.cx, box.cy], cover: 1 - u, border: lerp(fr.line, BORDER, u) });
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
  const lead = 1 / fps;
  const X = { g, t, F, pal, frame: F.frame, fps, lead, kick: F.c.kick || 0, snare: F.c.snare || 0 };
  // a page being cut by the slash: the next page shows through as its halves slide apart
  const SLICE_DUR = 0.5;
  const cut = pages.find((p) => p.slice !== undefined && t >= p.slice - 1e-6 && t < p.slice + SLICE_DUR);
  if (cut) {
    const next = pages[cut.index + 1];
    if (next) drawPage(g, ctx, next, t, X);
    else drawBackground(g, ctx, 'royal', pal, X.frame, 7);
    const L = g.layer('kzPanelsCut');
    drawPage(g, L.ctx, cut, Math.min(t, cut.t1 - lead), X);
    drawSlice(g, L.canvas, t - cut.slice, X);
    return;
  }
  const page = pages[pi];
  if (page.eye !== undefined && t >= page.eye - 1e-6) {
    drawEyeXL(g, ctx, t - page.eye + lead, X);
    return;
  }
  drawPage(g, ctx, page, t, X);
}
