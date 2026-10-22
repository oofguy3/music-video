// The night stadium shared by the Kaiser scenes (kzField, kzImpact, and any aerial view): a real 3D
// bowl seen through a pinhole camera, drawn back to front in Canvas2D.
//
//   import { camera, lookAt, drawStadium, drawGoal, drawFlares, project, figureAt } from './lib/kzstadium.mjs';
//   const cam = lookAt([0, 1.2, -20], [0, 1.0, 0], { focal: 1300 });
//   drawStadium(g, cam, { t, mt: F.c.mt, palette: S.palette, energy: 0.4, jump: 0.5, flare: F.c.kick });
//   const f = figureAt(cam, x, z);          // where to stand a puppet: {x, y (feet), s (px per metre), scale}
//   drawFlares(g, cam, { flare });          // anamorphic lamp streaks, after the characters
//
// World: metres, Y up, the pitch centred on the origin with its length along Z (goals at Z = +-52.5)
// and its width along X. Four tiered stands (N +Z, S -Z, E +X, W -X) with roofs, a corner floodlight
// tower behind each corner gap, LED boards around the pitch, two goals with nets.
//
// Camera: {eye, yaw (0 looks along +Z, + turns towards +X), pitch (+ looks down), roll, focal (px),
// cx, cy (the principal point: move cy to shift the horizon without tilting verticals)}.
//
// Everything is a pure function of its arguments. Caches (crowd textures, sprites) are keyed by
// palette colours and size only.

import { hashU } from './worldkit.mjs';
import { KZ } from './kaiser.mjs';
import { design } from './puppet.mjs';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };

// ------------------------------------------------------------------------------------- dimensions

export const DIM = {
  halfL: 52.5, halfW: 34,            // the pitch (105 x 68)
  runL: 61.5, runW: 43,              // grass out to the stand fronts
  goalW: 7.32, goalH: 2.44, goalD: 2.3,
  boardX: 38.6, boardZ: 56.6, boardH: 0.95,
  rows: 32, rowD: 0.84, rise: 0.62, wall: 2.7, stripH: 1.3,  // rows must divide by 8 (crowd blocks)
  roofH: 26.5, roofIn: 12,             // roof canopy height and how far its front edge reaches over the rows
  towerH: 50, headW: 15, headH: 8,
};

/** The four stands: front-left-bottom corner o (seen from the pitch), u along the front, n away from the pitch. */
export const STANDS = [
  { id: 'N', o: [-40, 0, DIM.runL], u: [1, 0, 0], n: [0, 0, 1], len: 80 },
  { id: 'S', o: [40, 0, -DIM.runL], u: [-1, 0, 0], n: [0, 0, -1], len: 80 },
  { id: 'E', o: [DIM.runW, 0, 55], u: [0, 0, -1], n: [1, 0, 0], len: 110 },
  { id: 'W', o: [-DIM.runW, 0, -55], u: [0, 0, 1], n: [-1, 0, 0], len: 110 },
];

/** The corner floodlight towers: base (x, z) and the lamp head centre. */
export const TOWERS = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], i) => ({
  i, sx, sz, base: [sx * 58, 0, sz * 73], head: [sx * 56, DIM.towerH, sz * 71],
}));

const SEC_M = 12;                    // crowd sections along a row (metres): variant, offset and bounce per section
const TILE_M = 24;                   // crowd texture tile length (metres)
const LEVEL_H = [56, 28, 14];        // crowd texture heights (px) for the three detail levels

// ------------------------------------------------------------------------------------- palette

/** Fallback colours; a scene's palette overrides any of them. */
export const STADIUM_PALETTE = {
  sky: '#060B2A', skyTop: '#02040F', haze: '#1B2B66', pitch: '#0E5A3A', pitchDeep: '#073322',
  line: '#E8F2FF', flood: '#EAF4FF', crowd: '#151A3A', stand: '#0A0E26', wall: '#080B1F', roof: '#05071A',
  gold: KZ.gold, royal: KZ.royal, red: KZ.red, redDeep: KZ.redDeep, white: '#F2F4FA',
};

const palCache = new Map();
/** The stadium palette: the fallbacks overridden by the hex colours of `p`. Cached per palette object values. */
export function stadiumPalette(p = {}) {
  const key = Object.keys(STADIUM_PALETTE).map((k) => p[k] || '').join('|');
  let out = palCache.get(key);
  if (!out) {
    out = { ...STADIUM_PALETTE };
    for (const k of Object.keys(STADIUM_PALETTE)) if (typeof p[k] === 'string' && p[k].startsWith('#')) out[k] = p[k];
    if (palCache.size > 64) palCache.delete(palCache.keys().next().value);
    palCache.set(key, out);
  }
  return out;
}

const rgbOf = (hex) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (hex, a) => { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${Math.round(clamp(a) * 1000) / 1000})`; };
/** Linear RGB mix of two hex colours (cheap; for static shading). */
export function mixHex(a, b, u) {
  const A = rgbOf(a), B = rgbOf(b);
  const c = (i) => Math.max(0, Math.min(255, Math.round(A[i] + (B[i] - A[i]) * u))).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

// ------------------------------------------------------------------------------------- camera

/**
 * A camera. Give either eye + target, or eye + yaw/pitch. focal in logical px; cx, cy the principal
 * point (default the frame centre); roll in radians (+ = clockwise).
 */
export function camera({ eye = [0, 1.6, -20], target = null, yaw = 0, pitch = 0, roll = 0, focal = 1200, cx = 960, cy = 540, near = 0.25 } = {}) {
  if (target) {
    const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
    yaw = Math.atan2(dx, dz);
    pitch = Math.atan2(-dy, Math.hypot(dx, dz));
  }
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    eye: [eye[0], eye[1], eye[2]], yaw, pitch, roll, focal, cx, cy, near,
    f: [syw * cp, -sp, cyw * cp],        // forward
    r: [cyw, 0, -syw],                   // right
    u: [syw * sp, cp, cyw * sp],         // up
    cr: Math.cos(roll), sr: Math.sin(roll),
  };
}

/** Sugar: a camera at eye looking at target. */
export const lookAt = (eye, target, opts = {}) => camera({ ...opts, eye, target });

/** World point -> camera space [x right, y up, z depth]. */
export function toCam(cam, X, Y, Z) {
  const dx = X - cam.eye[0], dy = Y - cam.eye[1], dz = Z - cam.eye[2];
  return [dx * cam.r[0] + dz * cam.r[2], dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2], dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2]];
}
/** World direction -> camera space (rotation only). */
export function dirCam(cam, X, Y, Z) {
  return [X * cam.r[0] + Z * cam.r[2], X * cam.u[0] + Y * cam.u[1] + Z * cam.u[2], X * cam.f[0] + Y * cam.f[1] + Z * cam.f[2]];
}
/** Camera-space point -> screen [x, y] (no near test). */
export function screenOf(cam, xc, yc, zc) {
  const k = cam.focal / zc;
  const x = xc * k, y = -yc * k;
  return [cam.cx + x * cam.cr - y * cam.sr, cam.cy + x * cam.sr + y * cam.cr];
}

/** Project a world point: {x, y, s (px per metre), d (depth)} or null when behind the near plane. */
export function project(cam, X, Y, Z) {
  const c = toCam(cam, X, Y, Z);
  if (c[2] <= cam.near) return null;
  const [x, y] = screenOf(cam, c[0], c[1], c[2]);
  return { x, y, s: cam.focal / c[2], d: c[2] };
}

/** Clip a camera-space polygon to the near plane and project it: [[x, y], ...] (may be empty). */
export function projectCamPoly(cam, cs) {
  const near = cam.near + 1e-3, out = [];
  const n = cs.length;
  for (let i = 0; i < n; i++) {
    const a = cs[i], b = cs[(i + 1) % n];
    const ina = a[2] >= near, inb = b[2] >= near;
    if (ina) out.push(screenOf(cam, a[0], a[1], a[2]));
    if (ina !== inb) {
      const u = (near - a[2]) / (b[2] - a[2]);
      out.push(screenOf(cam, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, near));
    }
  }
  return out;
}

/** Project a world polygon [[X, Y, Z], ...] with near-plane clipping. */
export const projectPoly = (cam, pts) => projectCamPoly(cam, pts.map((p) => toCam(cam, p[0], p[1], p[2])));

/** Screen y of the horizon at the principal point (before roll). */
export const horizonY = (cam) => cam.cy - cam.focal * Math.tan(cam.pitch);

/** Where a ray through screen (sx, sy) meets the ground (Y = 0): [X, Z] or null (above the horizon). */
export function groundAt(cam, sx, sy) {
  const x0 = sx - cam.cx, y0 = sy - cam.cy;
  const x = x0 * cam.cr + y0 * cam.sr, y = -x0 * cam.sr + y0 * cam.cr;   // undo roll
  const d = [cam.r[0] * x - cam.u[0] * y + cam.f[0] * cam.focal, -cam.u[1] * y + cam.f[1] * cam.focal, cam.r[2] * x - cam.u[2] * y + cam.f[2] * cam.focal];
  if (d[1] >= -1e-9) return null;
  const k = -cam.eye[1] / d[1];
  return [cam.eye[0] + d[0] * k, cam.eye[2] + d[2] * k];
}

/**
 * Where to stand a figure with its feet at (X, Z) on the ground: screen x, y (feet), s (px per
 * metre), d (depth) and scale for drawPuppet (height metres tall from a design `designH` px tall).
 */
export function figureAt(cam, X, Z, { height = 1.85, designH = 300, Y = 0 } = {}) {
  const p = project(cam, X, Y, Z);
  if (!p) return null;
  return { ...p, scale: (height * p.s) / designH };
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
/** Fill a projected polygon (no-op when fewer than 3 points). */
export function fillPoly(ctx, pts, style) {
  if (!pts || pts.length < 3) return false;
  polyPath(ctx, pts);
  ctx.fillStyle = style;
  ctx.fill();
  return true;
}

const offscreen = (pts, m = 0) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < -m || y1 < -m || x0 > 1920 + m || y0 > 1080 + m;
};

// ------------------------------------------------------------------------------------- caches

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) {
    v = make();
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

/** A small four-point star with a soft glow (phone flashes, lamp sparkles), cached per colour. */
export function starSprite(g, hex = '#FFFFFF') {
  return cached(`star|${hex}`, () => {
    const s = 64, c = g.createCanvas(s, s), x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, rgba(hex, 0.9));
    gr.addColorStop(0.35, rgba(hex, 0.25));
    gr.addColorStop(1, rgba(hex, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, s, s);
    x.fillStyle = rgba(hex, 0.85);
    x.beginPath();
    x.moveTo(32, 0); x.lineTo(34, 30); x.lineTo(64, 32); x.lineTo(34, 34); x.lineTo(32, 64); x.lineTo(30, 34); x.lineTo(0, 32); x.lineTo(30, 30);
    x.closePath();
    x.fill();
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/**
 * The crowd texture: two copies of a tileable strip of people (waist up, seen from the front) for
 * row strips. variant 0 calm, 1 cheering (arms up), 2 wild (arms up, scarves). level 0..2 = height
 * 56/28/14 px. Returns {canvas, H, ppm (px per metre), tw (tile width px)}.
 */
export function crowdTexture(g, pal, variant, level) {
  const accents = [pal.red, pal.white, pal.royal, pal.gold];
  return cached(`crowd|${variant}|${level}|${pal.crowd}|${accents.join(',')}`, () => {
    const H = LEVEL_H[level], ppm = H / DIM.stripH, tw = Math.round(TILE_M * ppm);
    const c = g.createCanvas(tw * 2, H), x = c.getContext('2d');
    const n = Math.round(TILE_M / 0.6);
    const base = pal.crowd;
    const dark = mixHex(base, '#000000', 0.5), lite = mixHex(base, '#2E3B72', 0.3);
    const rim = rgba('#C4D6FF', level === 2 ? 0.16 : 0.28);
    const people = [];
    for (let i = 0; i < n; i++) {
      const h = (k) => hashU(variant * 7919 + 17, i, k);
      const armsP = [0.08, 0.5, 0.82][variant], oneP = [0.1, 0.22, 0.12][variant];
      const r = h(3);
      const arms = r < armsP ? 2 : r < armsP + oneP ? 1 : 0;
      const shirtR = h(4);
      let shirt = mixHex(dark, lite, h(5) * h(5));
      if (shirtR < 0.09) shirt = mixHex(pal.red, '#05060F', 0.7);
      else if (shirtR < 0.13) shirt = mixHex(pal.white, base, 0.8);
      else if (shirtR < 0.17) shirt = mixHex(pal.royal, '#05060F', 0.68);
      people.push({
        cx: ((i + 0.5 + (h(1) - 0.5) * 0.5) / n) * tw, sh: (0.5 + 0.1 * h(2)) * ppm, arms, side: h(6) < 0.5 ? -1 : 1,
        shirt, head: mixHex('#14121F', '#2C2840', h(7)), wide: 0.4 + 0.08 * h(8), scarf: variant === 2 && h(9) < 0.08,
        scarfCol: mixHex([pal.red, pal.gold, pal.white, pal.royal][Math.floor(h(10) * 4)], '#05060F', 0.55), armLift: 0.45 + 0.2 * h(11), lean: (h(12) - 0.5) * 0.1,
      });
    }
    for (let rep = -1; rep <= 2; rep++) {
      for (const p of people) {
        const cx = p.cx + rep * tw;
        if (cx < -2 * ppm || cx > 2 * tw + 2 * ppm) continue;
        const yS = H - p.sh, w = p.wide * ppm, hr = 0.115 * ppm;
        const hx = cx + p.lean * ppm;
        // arms behind the head
        if (p.arms) {
          x.strokeStyle = p.shirt; x.lineCap = 'round'; x.lineWidth = Math.max(1, 0.085 * ppm);
          for (const sd of p.arms === 2 ? [-1, 1] : [p.side]) {
            const ex = cx + sd * (w * 0.62), ey = yS - p.armLift * ppm * 0.55;
            const fx = cx + sd * (w * 0.55 + 0.04 * ppm), fy = yS - p.armLift * ppm;
            x.beginPath(); x.moveTo(cx + sd * w * 0.38, yS + 0.05 * ppm); x.lineTo(ex, ey); x.lineTo(fx, fy); x.stroke();
            x.fillStyle = p.head; x.beginPath(); x.arc(fx, fy, 0.05 * ppm, 0, TAU); x.fill();
          }
        }
        if (p.scarf) {
          x.fillStyle = p.scarfCol;
          x.fillRect(cx - 0.5 * ppm, yS - p.armLift * ppm - 0.06 * ppm, 1.0 * ppm, 0.12 * ppm);
          x.fillStyle = mixHex(p.scarfCol, '#000000', 0.45);
          x.fillRect(cx, yS - p.armLift * ppm - 0.06 * ppm, 0.5 * ppm, 0.12 * ppm);
        }
        // torso
        x.fillStyle = p.shirt;
        x.beginPath();
        x.moveTo(cx - w / 2, H + 1);
        x.lineTo(cx - w / 2, yS + 0.08 * ppm);
        x.quadraticCurveTo(cx - w / 2, yS, cx - w * 0.3, yS);
        x.lineTo(cx + w * 0.3, yS);
        x.quadraticCurveTo(cx + w / 2, yS, cx + w / 2, yS + 0.08 * ppm);
        x.lineTo(cx + w / 2, H + 1);
        x.closePath();
        x.fill();
        // head
        x.fillStyle = p.head;
        x.beginPath(); x.arc(hx, yS - 0.16 * ppm, hr, 0, TAU); x.fill();
        // floodlight rim on the head and shoulders
        if (level < 2) {
          x.strokeStyle = rim; x.lineWidth = Math.max(0.8, 0.03 * ppm);
          x.beginPath(); x.arc(hx, yS - 0.16 * ppm, hr * 0.92, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
          x.beginPath(); x.moveTo(cx - w * 0.3, yS + 0.01 * ppm); x.lineTo(cx + w * 0.3, yS + 0.01 * ppm); x.stroke();
        }
      }
    }
    x.getImageData(0, 0, 1, 1);
    return { canvas: c, H, ppm, tw };
  });
}

// ------------------------------------------------------------------------------------- stands

/** World position of a seat: stand index, row (0 = front), along (0..1), lift (m above the seat line). */
export function seatPoint(si, row, along, lift = 0) {
  const st = STANDS[si];
  const d = (row + 0.5) * DIM.rowD, h = DIM.wall + row * DIM.rise + lift, s = along * st.len;
  return [st.o[0] + st.u[0] * s + st.n[0] * d, h, st.o[2] + st.u[2] * s + st.n[2] * d];
}

const standDepth = () => DIM.rows * DIM.rowD;
const standTop = () => DIM.wall + DIM.rows * DIM.rise;

/** A point in a stand's frame (s along, d away from the pitch, h up) in world coordinates. */
function standPt(st, s, d, h) {
  return [st.o[0] + st.u[0] * s + st.n[0] * d, h, st.o[2] + st.u[2] * s + st.n[2] * d];
}

/** The beat bounce of a crowd section: 0..1 hop (in metres x jump). */
function hop(mt, delay) {
  const ph = mt - delay;
  const f = ph - Math.floor(ph);
  return f < 0.45 ? Math.sin((f / 0.45) * Math.PI) : 0;
}

const BLOCK_STEP = 0.5;              // row spacing inside a pre-stacked block, in strip heights

/** K rows of the crowd texture pre-stacked (back row on top), for distant sections. */
function crowdBlock(g, pal, variant, level, K) {
  if (K === 1) return crowdTexture(g, pal, variant, level);
  return cached(`block|${variant}|${level}|${K}|${pal.crowd}|${pal.red}|${pal.royal}`, () => {
    const T = crowdTexture(g, pal, variant, level);
    const H = Math.round(T.H * (1 + (K - 1) * BLOCK_STEP));
    const c = g.createCanvas(T.canvas.width, H), x = c.getContext('2d');
    for (let i = K - 1; i >= 0; i--) {
      const off = Math.floor(hashU(K * 31 + variant, i, 1) * T.tw);
      const y = H - T.H - i * T.H * BLOCK_STEP;
      x.drawImage(T.canvas, -off, y);
      x.drawImage(T.canvas, -off + T.canvas.width, y);
    }
    x.getImageData(0, 0, 1, 1);
    return { canvas: c, H, ppm: T.ppm, tw: T.tw, K };
  });
}

/**
 * The crowd of one stand, section by section (SEC_M metres along the rows), back rows first. Each
 * section picks its detail from its size on screen: single rows as perspective-subdivided affine
 * strips when near, pre-stacked blocks of 2/4/8 rows when far. o: {energy, jump, mt, wave}.
 */
function drawCrowd(g, cam, pal, st, si, o) {
  const ctx = g.ctx, sc = g.scale;
  const O = toCam(cam, st.o[0], st.o[1], st.o[2]);
  const U = dirCam(cam, st.u[0], st.u[1], st.u[2]);
  const N = dirCam(cam, st.n[0], st.n[1], st.n[2]);
  const Yv = dirCam(cam, 0, 1, 0);
  const near = cam.near + 0.05;
  const nSec = Math.ceil(st.len / SEC_M);
  const energy = clamp(o.energy ?? 0.3), jumpM = (o.jump ?? 0) * 0.32, mt = o.mt ?? 0;
  const Hm = DIM.stripH, R = DIM.rows;
  // camera-space point of the stand frame (s along, d back, h up)
  const pc = (s, d, h) => [O[0] + U[0] * s + N[0] * d + Yv[0] * h, O[1] + U[1] * s + N[1] * d + Yv[1] * h, O[2] + U[2] * s + N[2] * d + Yv[2] * h];
  ctx.save();
  for (let k = 0; k < nSec; k++) {
    const s0 = k * SEC_M, s1 = Math.min(st.len, s0 + SEC_M), sm = (s0 + s1) / 2;
    // cull the whole section against the screen
    const corners = [pc(s0, 0, DIM.wall), pc(s1, 0, DIM.wall), pc(s0, R * DIM.rowD, DIM.wall + R * DIM.rise + Hm), pc(s1, R * DIM.rowD, DIM.wall + R * DIM.rise + Hm)];
    if (corners.every((c) => c[2] < near)) continue;
    const vis = corners.filter((c) => c[2] >= near).map((c) => screenOf(cam, c[0], c[1], c[2]));
    if (vis.length === 4 && offscreen(vis, 30)) continue;
    // detail: on-screen height of one row strip at the section's middle
    const mid = pc(sm, (R / 2) * DIM.rowD, DIM.wall + (R / 2) * DIM.rise);
    let K = 1;
    if (mid[2] > near) {
      const a = screenOf(cam, mid[0], mid[1], mid[2]), b = screenOf(cam, mid[0] + Yv[0] * Hm, mid[1] + Yv[1] * Hm, mid[2] + Yv[2] * Hm);
      const hpx = Math.hypot(b[0] - a[0], b[1] - a[1]) * sc;
      K = hpx >= 15 ? 1 : hpx >= 7 ? 2 : hpx >= 3.2 ? 4 : 8;
    }
    const hk = (r, q) => hashU(si * 131 + 7, r * 64 + k, q);
    for (let r = R - K; r >= 0; r -= K) {
      const vr = hk(r, 1);
      const variant = vr < energy * energy * 0.9 ? 2 : vr < energy * 1.1 + 0.08 ? 1 : 0;
      const delay = 0.08 * hk(r, 2) + (o.wave ? o.wave * (s0 / st.len + si * 0.25) : 0);
      const lift = jumpM > 0 ? jumpM * hop(mt, delay) * (0.6 + 0.4 * hk(r, 3)) : 0;
      const off = hk(r, 4) * TILE_M;
      const d = (r + 0.5) * DIM.rowD, h0 = DIM.wall + r * DIM.rise - 0.08 + lift;
      const dTop = (r + K - 0.5) * DIM.rowD, hTop = DIM.wall + (r + K - 1) * DIM.rise - 0.08 + lift + Hm;
      let sa = s0, sb = s1;
      const b0 = pc(0, d, h0);
      let za = b0[2] + U[2] * sa, zb = b0[2] + U[2] * sb;
      if (za < near && zb < near) continue;
      if (za < near) { sa += ((near - za) / (zb - za)) * (sb - sa); za = near; }
      else if (zb < near) { sb = sa + ((near - za) / (zb - za)) * (sb - sa); zb = near; }
      const nSub = K > 1 ? 1 : Math.min(6, Math.max(1, Math.ceil(Math.abs(Math.log(zb / za)) / 0.22)));
      for (let q = 0; q < nSub; q++) {
        const qa = sa + (sb - sa) * (q / nSub), qb = sa + (sb - sa) * ((q + 1) / nSub), qm = (qa + qb) / 2;
        const A3 = pc(qa, d, h0), B3 = pc(qb, d, h0);
        if (A3[2] < near || B3[2] < near) continue;
        const A = screenOf(cam, A3[0], A3[1], A3[2]), B = screenOf(cam, B3[0], B3[1], B3[2]);
        const M3 = pc(qm, d, h0), T3 = pc(qm, dTop, hTop);
        if (T3[2] < near) continue;
        const M = screenOf(cam, M3[0], M3[1], M3[2]), Tp = screenOf(cam, T3[0], T3[1], T3[2]);
        const ux = Tp[0] - M[0], uy = Tp[1] - M[1];
        const hpx = (Math.hypot(ux, uy) * sc) / (1 + (K - 1) * BLOCK_STEP);
        if (hpx < 1.2) continue;
        const x0 = Math.min(A[0], B[0], A[0] + ux, B[0] + ux), x1 = Math.max(A[0], B[0], A[0] + ux, B[0] + ux);
        const y0 = Math.min(A[1], B[1], A[1] + uy, B[1] + uy), y1 = Math.max(A[1], B[1], A[1] + uy, B[1] + uy);
        if (x1 < 0 || x0 > 1920 || y1 < 0 || y0 > 1080) continue;
        const level = hpx > LEVEL_H[1] * 1.2 ? 0 : hpx > LEVEL_H[2] * 1.2 ? 1 : 2;
        const T = crowdBlock(g, pal, variant, level, K);
        const sx = ((((qa + off) % TILE_M) + TILE_M) % TILE_M) * T.ppm, sw = Math.max(1, (qb - qa) * T.ppm + 0.5);
        ctx.setTransform(sc * (B[0] - A[0]), sc * (B[1] - A[1]), -sc * ux, -sc * uy, sc * (A[0] + ux), sc * (A[1] + uy));
        ctx.drawImage(T.canvas, sx, 0, Math.min(sw, T.canvas.width - sx), T.H, 0, 0, 1, 1);
      }
    }
  }
  ctx.restore();
}

/** Is the camera on the pitch side of a stand's front (true) or behind/over it? */
function cameraInFront(cam, st) {
  const dx = cam.eye[0] - st.o[0], dz = cam.eye[2] - st.o[2];
  return dx * st.n[0] + dz * st.n[2] < 0;
}

function drawStand(g, cam, pal, st, si, o) {
  const ctx = g.ctx;
  const D = standDepth(), top = standTop(), L = st.len;
  const front = cameraInFront(cam, st);
  const camAboveRoof = cam.eye[1] > DIM.roofH + 0.5;
  const P = (s, d, h) => standPt(st, s, d, h);
  const poly = (pts) => projectPoly(cam, pts);
  const roofPts = [P(-2, DIM.roofIn, DIM.roofH - 1.2), P(L + 2, DIM.roofIn, DIM.roofH - 1.2), P(L + 2, D + 1.5, DIM.roofH), P(-2, D + 1.5, DIM.roofH)];
  const fascia = [P(-2, DIM.roofIn, DIM.roofH - 1.2), P(L + 2, DIM.roofIn, DIM.roofH - 1.2), P(L + 2, DIM.roofIn, DIM.roofH - 3.0), P(-2, DIM.roofIn, DIM.roofH - 3.0)];
  // back wall up to the roof
  fillPoly(ctx, poly([P(0, D, top - 0.5), P(L, D, top - 0.5), P(L, D, DIM.roofH), P(0, D, DIM.roofH)]), pal.wall);
  if (!camAboveRoof && front) fillPoly(ctx, poly(roofPts), pal.roof);
  // the seating slope, then the crowd on it
  const slope = poly([P(0, 0, DIM.wall), P(L, 0, DIM.wall), P(L, D, top), P(0, D, top)]);
  if (slope.length >= 3 && !offscreen(slope, 40)) {
    fillPoly(ctx, slope, front ? pal.stand : pal.wall);
    if (front) {
      // aisles
      ctx.strokeStyle = rgba(mixHex(pal.stand, pal.flood, 0.25), 0.5);
      ctx.lineWidth = 1.2;
      for (let s = 9; s < L - 4; s += 18) {
        const a = project(cam, ...P(s, 0.2, DIM.wall)), b = project(cam, ...P(s, D, top));
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      drawCrowd(g, cam, pal, st, si, o);
      // roof shadow over the upper rows and the floodlight wash on the lower ones
      const tm = project(cam, ...P(L / 2, D, top)), bm = project(cam, ...P(L / 2, 0, DIM.wall));
      if (tm && bm && Math.hypot(tm.x - bm.x, tm.y - bm.y) > 2) {
        const gr = ctx.createLinearGradient(tm.x, tm.y, bm.x, bm.y);
        gr.addColorStop(0, rgba('#02030C', 0.62));
        gr.addColorStop(0.45, rgba('#02030C', 0.2));
        gr.addColorStop(1, rgba('#02030C', 0));
        fillPoly(ctx, slope, gr);
      }
      const dist = Math.hypot(...toCam(cam, ...P(L / 2, D / 2, top / 2)));
      const haze = clamp(0.08 + dist / 480) * (o.haze ?? 1);
      fillPoly(ctx, slope, rgba(pal.haze, haze * 0.4));
      const fl = (o.flare ?? 0) * 0.06 + 0.012;
      ctx.globalCompositeOperation = 'lighter';
      fillPoly(ctx, slope, rgba(pal.flood, fl));
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // stand end caps
  for (const s of [0, L]) {
    fillPoly(ctx, poly([P(s, 0, 0), P(s, 0, DIM.wall), P(s, D, top), P(s, D, DIM.roofH), P(s, D + 1.5, DIM.roofH), P(s, D + 1.5, 0)]), pal.wall);
  }
  // front wall
  const fw = poly([P(0, 0, 0), P(L, 0, 0), P(L, 0, DIM.wall), P(0, 0, DIM.wall)]);
  fillPoly(ctx, fw, mixHex(pal.wall, pal.haze, 0.25));
  if (camAboveRoof || !front) fillPoly(ctx, poly(roofPts), mixHex(pal.roof, pal.haze, camAboveRoof ? 0.35 : 0));
  // the roof's lit fascia and its row of lamps
  const fp = poly(fascia);
  if (fp.length >= 3 && !offscreen(fp, 40)) {
    fillPoly(ctx, fp, mixHex(pal.roof, pal.haze, 0.5));
    const l0 = project(cam, ...P(-2, DIM.roofIn - 0.05, DIM.roofH - 2.6)), l1 = project(cam, ...P(L + 2, DIM.roofIn - 0.05, DIM.roofH - 2.6));
    if (l0 && l1) {
      ctx.strokeStyle = rgba(pal.flood, 0.55 + 0.3 * (o.flare ?? 0));
      ctx.lineWidth = Math.max(1, Math.min(4, 0.35 * Math.min(l0.s, l1.s)));
      ctx.beginPath(); ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y); ctx.stroke();
    }
  }
}

// ------------------------------------------------------------------------------------- towers

/** Lamp-head frame of a tower: centre, normal (facing the pitch), horizontal and vertical axes. */
export function towerHead(tw) {
  const [hx, hy, hz] = tw.head;
  const aim = [tw.sx * -4, 0, tw.sz * -8];
  let nx = aim[0] - hx, ny = aim[1] - hy, nz = aim[2] - hz;
  const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
  let ax = nz, az = -nx; const al = Math.hypot(ax, az); ax /= al; az /= al;   // horizontal axis = up x n
  const bx = ny * az - 0, by = nz * ax - nx * az, bz = 0 - ny * ax;             // n x a
  return { c: tw.head, n: [nx, ny, nz], a: [ax, 0, az], b: [bx, by, bz] };
}

function drawTower(g, cam, pal, tw, o) {
  const ctx = g.ctx;
  const H = towerHead(tw);
  const [hx, hy, hz] = H.c;
  // mast: a tapered billboard from the base to the head
  const top = project(cam, hx, hy - DIM.headH * 0.45, hz), bot = project(cam, tw.base[0], 0, tw.base[2]);
  const vx = cam.eye[0] - hx, vz = cam.eye[2] - hz, vl = Math.hypot(vx, vz) || 1;
  const px = -vz / vl, pz = vx / vl;   // perpendicular to the view, horizontal
  const mast = projectPoly(cam, [
    [tw.base[0] - px * 1.6, 0, tw.base[2] - pz * 1.6], [tw.base[0] + px * 1.6, 0, tw.base[2] + pz * 1.6],
    [hx + px * 0.7, hy - DIM.headH * 0.45, hz + pz * 0.7], [hx - px * 0.7, hy - DIM.headH * 0.45, hz - pz * 0.7]]);
  if (mast.length >= 3 && !offscreen(mast, 60)) {
    fillPoly(ctx, mast, mixHex(pal.wall, pal.haze, 0.35));
    if (top && bot) {   // lattice
      ctx.strokeStyle = rgba(mixHex(pal.haze, pal.flood, 0.3), 0.45);
      ctx.lineWidth = Math.max(0.6, Math.min(2.5, 0.12 * top.s));
      ctx.beginPath();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const u0 = i / n, u1 = (i + 1) / n;
        const w0 = lerp(1.5, 0.65, u0), w1 = lerp(1.5, 0.65, u1);
        const p0 = project(cam, lerp(tw.base[0], hx, u0) - px * w0, lerp(0, hy - DIM.headH * 0.45, u0), lerp(tw.base[2], hz, u0) - pz * w0);
        const p1 = project(cam, lerp(tw.base[0], hx, u1) + px * w1, lerp(0, hy - DIM.headH * 0.45, u1), lerp(tw.base[2], hz, u1) + pz * w1);
        const q0 = project(cam, lerp(tw.base[0], hx, u0) + px * w0, lerp(0, hy - DIM.headH * 0.45, u0), lerp(tw.base[2], hz, u0) + pz * w0);
        const q1 = project(cam, lerp(tw.base[0], hx, u1) - px * w1, lerp(0, hy - DIM.headH * 0.45, u1), lerp(tw.base[2], hz, u1) - pz * w1);
        if (p0 && p1) { ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
        if (q0 && q1) { ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); }
      }
      ctx.stroke();
    }
  }
  // the lamp head
  const W2 = DIM.headW / 2, H2 = DIM.headH / 2;
  const corner = (a, b) => [hx + H.a[0] * a + H.b[0] * b, hy + H.a[1] * a + H.b[1] * b, hz + H.a[2] * a + H.b[2] * b];
  const head = projectPoly(cam, [corner(-W2, -H2), corner(W2, -H2), corner(W2, H2), corner(-W2, H2)]);
  if (head.length < 3 || offscreen(head, 200)) return;
  const facing = (cam.eye[0] - hx) * H.n[0] + (cam.eye[1] - hy) * H.n[1] + (cam.eye[2] - hz) * H.n[2] > 0;
  fillPoly(ctx, head, facing ? mixHex(pal.wall, pal.haze, 0.6) : mixHex(pal.wall, pal.haze, 0.2));
  if (!facing) return;
  const lampCol = mixHex(pal.flood, '#FFFFFF', 0.5);
  ctx.fillStyle = lampCol;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 7; i++) {
      const p = project(cam, ...corner((i - 3) / 3 * W2 * 0.86, (j - 1.5) / 1.5 * H2 * 0.74));
      if (!p) continue;
      const r = Math.max(0.8, 0.62 * p.s);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    }
  }
}

/** Additive glows around the lamp heads (drawn after the pitch so they sit over everything far). */
function drawLampGlows(g, cam, pal, o) {
  const ctx = g.ctx;
  const flare = o.flare ?? 0;
  const glow = g.sprites.glow(pal.flood, 1), star = starSprite(g, pal.flood);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const tw of TOWERS) {
    const H = towerHead(tw);
    const facing = (cam.eye[0] - H.c[0]) * H.n[0] + (cam.eye[1] - H.c[1]) * H.n[1] + (cam.eye[2] - H.c[2]) * H.n[2];
    if (facing <= 0) continue;
    const p = project(cam, ...H.c);
    if (!p) continue;
    const k = clamp(facing / Math.hypot(cam.eye[0] - H.c[0], cam.eye[1] - H.c[1], cam.eye[2] - H.c[2]));
    const base = DIM.headW * p.s;
    const r = Math.max(26, base * (1.7 + 0.9 * flare));
    if (p.x < -r || p.x > 1920 + r || p.y < -r || p.y > 1080 + r) continue;
    ctx.globalAlpha = clamp((0.55 + 0.45 * flare) * (0.4 + 0.6 * k));
    ctx.drawImage(glow, p.x - r, p.y - r, 2 * r, 2 * r);
    const r2 = Math.max(14, base * 0.55 * (1 + 0.5 * flare));
    ctx.globalAlpha = clamp(0.8 * (0.5 + 0.5 * k));
    ctx.drawImage(glow, p.x - r2, p.y - r2, 2 * r2, 2 * r2);
    const r3 = Math.max(20, base * (0.9 + 1.6 * flare));
    ctx.globalAlpha = clamp(0.35 + 0.65 * flare) * k;
    ctx.drawImage(star, p.x - r3, p.y - r3, 2 * r3, 2 * r3);
  }
  ctx.restore();
}

/** A soft beam: apex at the top centre, widening and fading downwards, gaussian across (cached). */
function beamSprite(g, hex) {
  return cached(`beam|${hex}`, () => {
    const w = 128, h = 256, c = g.createCanvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h), d = img.data;
    const [R, G, B] = rgbOf(hex);
    for (let j = 0; j < h; j++) {
      const v = j / (h - 1);
      const half = 0.06 + 0.94 * v;                        // half-width as a fraction of w/2
      const along = Math.pow(1 - v, 1.35) * Math.min(1, v * 14 + 0.25);
      for (let i = 0; i < w; i++) {
        const u = (i - w / 2 + 0.5) / (w / 2) / half;
        const a = along * Math.exp(-u * u * 2.6);
        const o = (j * w + i) * 4;
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = Math.round(255 * clamp(a));
      }
    }
    x.putImageData(img, 0, 0);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

/** Light cones from the lamp heads down to the pitch, additive soft beams. */
function drawCones(g, cam, pal, o) {
  const ctx = g.ctx, sc = g.scale;
  const a0 = (o.cones ?? 1) * (0.13 + 0.17 * (o.flare ?? 0));
  if (a0 <= 0.004) return;
  const beam = beamSprite(g, pal.flood);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const tw of TOWERS) {
    const H = towerHead(tw);
    const hc = toCam(cam, ...tw.head);
    if (hc[2] <= cam.near) continue;
    const hp = screenOf(cam, hc[0], hc[1], hc[2]);
    // the beam's axis and its far end on the pitch; its width across, perpendicular to the view
    const aim = [tw.sx * -6, 0, tw.sz * -12];
    const ac = toCam(cam, ...aim);
    if (ac[2] <= cam.near + 1) continue;
    const ap = screenOf(cam, ac[0], ac[1], ac[2]);
    const len = Math.hypot(ap[0] - hp[0], ap[1] - hp[1]);
    if (len < 8) continue;
    const across = 26 * cam.focal / ac[2];
    const dx = (ap[0] - hp[0]) / len, dy = (ap[1] - hp[1]) / len;
    const BL = [ap[0] - dy * across, ap[1] + dx * across], BR = [ap[0] + dy * across, ap[1] - dx * across];
    const a = (BR[0] - BL[0]) / 128, b = (BR[1] - BL[1]) / 128;
    const e = hp[0] - 64 * a, f = hp[1] - 64 * b;
    const c = (BL[0] - e) / 256, d = (BL[1] - f) / 256;
    const facing = (cam.eye[0] - H.c[0]) * H.n[0] + (cam.eye[1] - H.c[1]) * H.n[1] + (cam.eye[2] - H.c[2]) * H.n[2] > 0;
    // fade beams that would wash over the whole frame (the camera is near or inside them)
    const nearFade = smooth((ac[2] - 22) / 45) * smooth((hc[2] - 30) / 40);
    if (nearFade <= 0.01) continue;
    ctx.globalAlpha = clamp(a0 * (facing ? 1 : 0.6) * nearFade);
    ctx.setTransform(sc * a, sc * b, sc * c, sc * d, sc * e, sc * f);
    ctx.drawImage(beam, 0, 0);
  }
  ctx.restore();
}

/**
 * Anamorphic lens streaks and star bursts on the visible lamp heads (and optional extra lights),
 * for flares on kicks. Draw it after the characters. o: {palette, flare 0..1, alpha}.
 */
export function drawFlares(g, cam, o = {}) {
  const pal = stadiumPalette(o.palette);
  const flare = clamp(o.flare ?? 0) * (o.alpha ?? 1);
  if (flare <= 0.01) return;
  const ctx = g.ctx, streak = g.sprites.streak(pal.flood);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const tw of TOWERS) {
    const H = towerHead(tw);
    const facing = (cam.eye[0] - H.c[0]) * H.n[0] + (cam.eye[1] - H.c[1]) * H.n[1] + (cam.eye[2] - H.c[2]) * H.n[2];
    if (facing <= 0) continue;
    const p = project(cam, ...H.c);
    if (!p || p.x < -400 || p.x > 2320 || p.y < -200 || p.y > 1280) continue;
    const len = 420 + 900 * flare, th = 10 + 22 * flare;
    ctx.globalAlpha = clamp(0.55 * flare);
    ctx.drawImage(streak, 0, 0, 512, 64, p.x - len, p.y - th / 2, len, th);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(-1, 1);
    ctx.drawImage(streak, 0, 0, 512, 64, -len, -th / 2, len, th);
    ctx.restore();
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------- pitch

/** The pitch markings as world segments [x0, z0, x1, z1] and arcs [cx, cz, r, a0, a1]. */
const MARKS = (() => {
  const L = DIM.halfL, Wd = DIM.halfW;
  const seg = [[-Wd, -L, Wd, -L], [Wd, -L, Wd, L], [Wd, L, -Wd, L], [-Wd, L, -Wd, -L], [-Wd, 0, Wd, 0]];
  for (const e of [-1, 1]) {
    const gl = e * L, pb = e * (L - 16.5), gb = e * (L - 5.5);
    seg.push([-20.16, gl, -20.16, pb], [-20.16, pb, 20.16, pb], [20.16, pb, 20.16, gl]);
    seg.push([-9.16, gl, -9.16, gb], [-9.16, gb, 9.16, gb], [9.16, gb, 9.16, gl]);
  }
  const arcs = [[0, 0, 9.15, 0, TAU]];
  const a = Math.acos(5.5 / 9.15);
  arcs.push([0, -(L - 11), 9.15, Math.PI / 2 - a, Math.PI / 2 + a]);       // penalty arcs (outside the box)
  arcs.push([0, L - 11, 9.15, -Math.PI / 2 - a, -Math.PI / 2 + a]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const base = sx > 0 ? (sz > 0 ? Math.PI : Math.PI / 2) : (sz > 0 ? -Math.PI / 2 : 0);   // the quarter facing into the pitch
    arcs.push([sx * Wd, sz * L, 1, base, base + Math.PI / 2]);
  }
  const spots = [[0, 0], [0, -(L - 11)], [0, L - 11]];
  return { seg, arcs, spots };
})();

/** Fill a thin ground ribbon from (x0, z0) to (x1, z1) of width w, clipped. */
function ribbon(ctx, cam, x0, z0, x1, z1, w) {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
  const pts = projectPoly(cam, [[x0 + nx, 0.01, z0 + nz], [x1 + nx, 0.01, z1 + nz], [x1 - nx, 0.01, z1 - nz], [x0 - nx, 0.01, z0 - nz]]);
  if (pts.length < 3) return;
  polyPath(ctx, pts);
  ctx.fill();
}

function drawPitch(g, cam, pal, o) {
  const ctx = g.ctx;
  const L = DIM.halfL, Wd = DIM.halfW;
  // run-off grass out to the stands
  fillPoly(ctx, projectPoly(cam, [[-DIM.runW, 0, -DIM.runL], [DIM.runW, 0, -DIM.runL], [DIM.runW, 0, DIM.runL], [-DIM.runW, 0, DIM.runL]]), pal.pitchDeep);
  // mowing stripes
  const nb = 18, bw = (2 * L) / nb;
  const lite = mixHex(pal.pitch, pal.line, 0.07);
  for (let i = 0; i < nb; i++) {
    const z0 = -L + i * bw, z1 = z0 + bw;
    fillPoly(ctx, projectPoly(cam, [[-Wd - 3, 0, z0], [Wd + 3, 0, z0], [Wd + 3, 0, z1], [-Wd - 3, 0, z1]]), i % 2 ? pal.pitch : lite);
  }
  const pitchPoly = projectPoly(cam, [[-Wd - 3, 0, -L - 3], [Wd + 3, 0, -L - 3], [Wd + 3, 0, L + 3], [-Wd - 3, 0, L + 3]]);
  const all = projectPoly(cam, [[-DIM.runW, 0, -DIM.runL], [DIM.runW, 0, -DIM.runL], [DIM.runW, 0, DIM.runL], [-DIM.runW, 0, DIM.runL]]);
  // floodlit pools: radial light in perspective (a circle on the ground squashed by the view)
  const pools = o.light || [{ x: 0, z: 0, r: 46, a: 0.07 }];
  for (const pl of pools) {
    const c = project(cam, pl.x, 0, pl.z);
    if (!c || all.length < 3) continue;
    const e = project(cam, pl.x + pl.r * cam.r[0], 0, pl.z + pl.r * cam.r[2]);
    const fwd = [cam.f[0], cam.f[2]], fl = Math.hypot(fwd[0], fwd[1]) || 1;
    const q = project(cam, pl.x + (pl.r * fwd[0]) / fl, 0, pl.z + (pl.r * fwd[1]) / fl);
    const rx = e ? Math.hypot(e.x - c.x, e.y - c.y) : pl.r * c.s;
    const ry = q ? Math.max(4, Math.abs(q.y - c.y)) : rx * 0.3;
    if (rx < 2) continue;
    ctx.save();
    polyPath(ctx, all);
    ctx.translate(c.x, c.y);
    ctx.scale(1, clamp(ry / rx, 0.05, 1));
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, rgba(pl.color || pal.flood, pl.a));
    gr.addColorStop(0.5, rgba(pl.color || pal.flood, pl.a * 0.45));
    gr.addColorStop(1, rgba(pl.color || pal.flood, 0));
    ctx.fillStyle = gr;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fill();
    ctx.restore();
  }
  // the markings
  ctx.fillStyle = rgba(pal.line, 0.86);
  const w = 0.14;
  for (const [x0, z0, x1, z1] of MARKS.seg) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 6));
    for (let i = 0; i < n; i++) ribbon(ctx, cam, lerp(x0, x1, i / n), lerp(z0, z1, i / n), lerp(x0, x1, (i + 1) / n), lerp(z0, z1, (i + 1) / n), w);
  }
  for (const [cx, cz, r, a0, a1] of MARKS.arcs) {
    const n = Math.max(4, Math.ceil(((a1 - a0) * r) / 1.6));
    for (let i = 0; i < n; i++) {
      const p = a0 + ((a1 - a0) * i) / n, q = a0 + ((a1 - a0) * (i + 1)) / n;
      ribbon(ctx, cam, cx + Math.cos(p) * r, cz + Math.sin(p) * r, cx + Math.cos(q) * r, cz + Math.sin(q) * r, w);
    }
  }
  for (const [x, z] of MARKS.spots) {
    const p = project(cam, x, 0, z);
    if (p) { ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(0.8, 0.2 * p.s), Math.max(0.4, 0.2 * p.s * Math.abs(Math.sin(cam.pitch + 0.05))), 0, 0, TAU); ctx.fill(); }
  }
  // distance haze over the grass (towards the horizon), rotated with the camera roll
  if (all.length >= 3) {
    const hy = horizonY(cam) - cam.cy;
    const x0 = cam.cx - hy * cam.sr, y0 = cam.cy + hy * cam.cr;
    const L2 = 220 + cam.focal * 0.06;
    const gr = ctx.createLinearGradient(x0, y0, x0 - cam.sr * L2, y0 + cam.cr * L2);
    gr.addColorStop(0, rgba(mixHex(pal.haze, pal.pitch, 0.3), 0.5 * (o.haze ?? 1)));
    gr.addColorStop(1, rgba(pal.haze, 0));
    fillPoly(ctx, all, gr);
  }
}

/** LED advertising boards around the pitch: continuous glowing ribbons of moving colour (no lettering). */
function drawBoards(g, cam, pal, o) {
  const ctx = g.ctx;
  const t = o.t ?? 0, pulse = clamp(o.boardPulse ?? 0), dim = clamp(o.boardDim ?? 0);
  const cols = [pal.royal, pal.red, pal.gold, pal.royal, mixHex(pal.royal, pal.flood, 0.4), pal.red];
  const runs = [
    [[-DIM.boardX, -51], [-DIM.boardX, 51]], [[DIM.boardX, 51], [DIM.boardX, -51]],
    [[-31, DIM.boardZ], [31, DIM.boardZ]], [[31, -DIM.boardZ], [-31, -DIM.boardZ]],
  ];
  runs.forEach(([A, B], ri) => {
    const n = Math.max(2, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 6));
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n;
      const x0 = lerp(A[0], B[0], u0), z0 = lerp(A[1], B[1], u0), x1 = lerp(A[0], B[0], u1), z1 = lerp(A[1], B[1], u1);
      const pts = projectPoly(cam, [[x0, 0, z0], [x1, 0, z1], [x1, DIM.boardH, z1], [x0, DIM.boardH, z0]]);
      if (pts.length < 3 || offscreen(pts, 10)) continue;
      // a colour that flows along the ribbon, brightening on the pulse
      const ph = i * 0.18 - t * 0.35 + ri * 0.7;
      const k = ((Math.floor(ph) % cols.length) + cols.length) % cols.length;
      const fr = ph - Math.floor(ph);
      const col = mixHex(cols[k], cols[(k + 1) % cols.length], smooth((fr - 0.7) / 0.3));
      fillPoly(ctx, pts, mixHex(col, '#03050F', 0.62 - 0.25 * pulse + 0.3 * dim));
      const band = projectPoly(cam, [[x0, DIM.boardH * 0.3, z0], [x1, DIM.boardH * 0.3, z1], [x1, DIM.boardH * 0.7, z1], [x0, DIM.boardH * 0.7, z0]]);
      fillPoly(ctx, band, rgba(mixHex(col, '#FFFFFF', 0.15 + 0.3 * pulse), (0.38 + 0.35 * pulse) * (1 - 0.6 * dim)));
    }
  });
}

// ------------------------------------------------------------------------------------- goal

/** Goal frame at end e (+1 / -1): posts at x = +-3.66, crossbar 2.44 m, net back to depth goalD. */
export function goalFrame(e) {
  const gl = e * DIM.halfL, w = DIM.goalW / 2;
  return { line: gl, w, h: DIM.goalH, back: gl + e * DIM.goalD };
}

/** A net surface point: panel 'back' (u across -1..1, v 0 bottom..1 top), 'top', 'left', 'right'. */
function netPoint(e, panel, u, v, bulge) {
  const gl = e * DIM.halfL, w = DIM.goalW / 2, h = DIM.goalH, D = DIM.goalD;
  let x, y, z;
  if (panel === 'back') { x = u * w; y = v * (h - 0.3); z = gl + e * (D - 0.9 * v * 0.55); }
  else if (panel === 'top') { x = u * w; y = h - 0.3 * v; z = gl + e * (D * 0.5 * v + 0.0); }
  else { const sx = panel === 'left' ? -1 : 1; x = sx * w; y = v * h * (1 - 0.12 * u); z = gl + e * D * u * (1 - 0.25 * v); }
  if (bulge && bulge.amt) {
    const d2 = (x - bulge.x) ** 2 + (y - bulge.y) ** 2;
    const k = bulge.amt * Math.exp(-d2 / (bulge.r * bulge.r));
    z += e * k;
  }
  return [x, y, z];
}

/**
 * A goal with its net. o: {palette, bulge: {x, y, amt (m), r}, hole: {x, y, r} (torn open), alpha}.
 * Drawn from any side (the net behind the posts or in front of them).
 */
export function drawGoal(g, cam, e, o = {}) {
  const ctx = g.ctx, pal = stadiumPalette(o.palette);
  const fr = goalFrame(e);
  const camBehind = (cam.eye[2] - fr.line) * e > 0;
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  const hole = o.hole;
  const inHole = (p) => hole && hole.r > 0 && (p[0] - hole.x) ** 2 + (p[1] - hole.y) ** 2 < hole.r * hole.r && (p[2] - fr.line) * e > DIM.goalD * 0.3;
  const near0 = project(cam, 0, 1.2, fr.line);
  const tiny = near0 && near0.s * DIM.goalW < 90;
  const net = () => {
    const near = near0;
    const lw = near ? Math.max(0.6, Math.min(2.2, 0.03 * near.s)) : 1;
    if (tiny) {
      fillPoly(ctx, projectPoly(cam, [netPoint(e, 'back', -1, 0), netPoint(e, 'back', 1, 0), netPoint(e, 'back', 1, 1), netPoint(e, 'back', -1, 1)]), rgba(pal.line, 0.22));
      return;
    }
    ctx.strokeStyle = rgba(pal.line, 0.5);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    const line = (panel, fixedU, n) => {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        const side = panel === 'left' || panel === 'right';
        const q = netPoint(e, panel, fixedU.u ?? (side ? s : s * 2 - 1), fixedU.v ?? s, o.bulge);
        if (inHole(q)) { pen = false; continue; }
        const sp = project(cam, q[0], q[1], q[2]);
        if (!sp) { pen = false; continue; }
        if (pen) ctx.lineTo(sp.x, sp.y); else { ctx.moveTo(sp.x, sp.y); pen = true; }
      }
      ctx.stroke();
    };
    const step = 0.24;
    const nu = Math.round(DIM.goalW / step), nv = Math.round(DIM.goalH / step);
    for (let i = 0; i <= nu; i++) { const u = (i / nu) * 2 - 1; line('back', { u }, 10); line('top', { u }, 4); }
    for (let j = 0; j <= nv; j++) { const v = j / nv; line('back', { v }, 18); }
    for (let j = 0; j <= 5; j++) { const v = j / 5; line('top', { v }, 18); }
    for (const side of ['left', 'right']) {
      for (let j = 0; j <= nv; j++) line(side, { v: j / nv }, 6);
      for (let i = 0; i <= 8; i++) line(side, { u: i / 8 }, 10);
    }
  };
  const posts = () => {
    const pw = 0.12;
    const white = mixHex(pal.white, pal.flood, 0.5);
    const box = (x0, y0, x1, y1) => {
      const pts = projectPoly(cam, [[x0, y0, fr.line], [x1, y0, fr.line], [x1, y1, fr.line], [x0, y1, fr.line]]);
      fillPoly(ctx, pts, white);
    };
    box(-fr.w - pw, 0, -fr.w, fr.h + pw);
    box(fr.w, 0, fr.w + pw, fr.h + pw);
    box(-fr.w - pw, fr.h, fr.w + pw, fr.h + pw);
  };
  if (camBehind) { posts(); net(); } else { net(); posts(); }
  ctx.restore();
}

// ------------------------------------------------------------------------------------- sky

function drawSky(g, cam, pal, o) {
  const ctx = g.ctx;
  const hy = horizonY(cam);
  ctx.save();
  ctx.translate(cam.cx, cam.cy); ctx.rotate(cam.roll); ctx.translate(-cam.cx, -cam.cy);
  const low = mixHex(pal.sky, pal.haze, 0.42);
  if (hy > -600) {
    const gr = ctx.createLinearGradient(0, hy - 1100, 0, hy);
    gr.addColorStop(0, pal.skyTop);
    gr.addColorStop(0.6, pal.sky);
    gr.addColorStop(1, low);
    ctx.fillStyle = gr;
    ctx.fillRect(-600, Math.min(-600, hy - 1200), 3120, Math.max(0, hy - Math.min(-600, hy - 1200)) + 1);
  }
  // the dark land outside the stadium, below the horizon
  if (hy < 1700) {
    const gr = ctx.createLinearGradient(0, hy, 0, hy + 500);
    gr.addColorStop(0, low);
    gr.addColorStop(1, mixHex(pal.skyTop, '#000000', 0.3));
    ctx.fillStyle = gr;
    ctx.fillRect(-600, Math.max(-600, hy), 3120, 1800 - Math.max(-600, hy));
  }
  ctx.restore();
  // stars: fixed directions on the upper sky
  const n = o.stars ?? 90;
  ctx.fillStyle = rgba('#DCE6FF', 0.7);
  for (let i = 0; i < n; i++) {
    const az = hashU(77, i, 1) * TAU, el = 0.25 + Math.pow(hashU(77, i, 2), 0.7) * 1.2;
    const d = dirCam(cam, Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    if (d[2] <= 0.05) continue;
    const [x, y] = screenOf(cam, d[0], d[1], d[2]);
    if (x < 0 || x > 1920 || y < 0 || y > 1080) continue;
    const tw = 0.5 + 0.5 * Math.sin((o.t ?? 0) * (1.3 + hashU(77, i, 3) * 2) + i);
    const s = 0.8 + 1.2 * hashU(77, i, 4) * tw;
    ctx.globalAlpha = 0.15 + 0.4 * tw * hashU(77, i, 5);
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
  // the light dome above the bowl
  const c = project(cam, 0, 24, 0);
  if (c) {
    const r = Math.max(700, 110 * c.s);
    const glow = g.sprites.glow(pal.haze, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28 * (o.dome ?? 1);
    ctx.drawImage(glow, c.x - r * 1.6, c.y - r, r * 3.2, r * 2);
    ctx.restore();
  }
}

// ------------------------------------------------------------------------------------- sparkles

/**
 * Phone lights and camera flashes in the stands. o: {t, steady (count of twinkling phone lights),
 * flashes: [{t0, n, seed, s}] (bursts, e.g. one per hi-hat), life (s)}.
 */
export function drawSparkles(g, cam, o = {}) {
  const pal = stadiumPalette(o.palette);
  const ctx = g.ctx, t = o.t ?? 0;
  const star = starSprite(g, pal.flood), glow = g.sprites.glow('#FFFFFF', 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const put = (si, row, al, a, size) => {
    const w = seatPoint(si, row, al, 1.0);
    const p = project(cam, w[0], w[1], w[2]);
    if (!p || p.x < -20 || p.x > 1940 || p.y < -20 || p.y > 1100) return;
    const r = Math.min(30, Math.max(2.2, size * p.s));
    ctx.globalAlpha = clamp(a);
    ctx.drawImage(r > 5 ? star : glow, p.x - r, p.y - r, 2 * r, 2 * r);
  };
  const steady = o.steady ?? 120;
  for (let i = 0; i < steady; i++) {
    const si = Math.floor(hashU(901, i, 1) * 4), row = Math.floor(hashU(901, i, 2) * DIM.rows), al = hashU(901, i, 3);
    const tw = Math.sin(t * (0.7 + hashU(901, i, 4) * 1.6) + i * 1.7);
    if (tw < 0.2) continue;
    put(si, row, al, 0.35 * tw, 0.35);
  }
  const life = o.life ?? 0.28;
  for (const fl of o.flashes || []) {
    const age = t - fl.t0;
    if (age < 0 || age > life) continue;
    const a = Math.exp(-age / (life * 0.35)) * (fl.s ?? 1);
    for (let i = 0; i < fl.n; i++) {
      const sd = fl.seed * 977 + i;
      const si = Math.floor(hashU(sd, 3, 1) * 4), row = Math.floor(hashU(sd, 3, 2) * DIM.rows), al = hashU(sd, 3, 3);
      put(si, row, al, a * (0.6 + 0.4 * hashU(sd, 3, 4)), 0.6 + 0.6 * hashU(sd, 3, 5));
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------- the whole stadium

const softBufs = new Map();
/** A reusable low-resolution canvas (fully redrawn each frame, so no state leaks between frames). */
function softBuffer(g, k) {
  const w = Math.max(2, Math.round(g.devW * k)), h = Math.max(2, Math.round(g.devH * k));
  const key = `${w}x${h}`;
  let b = softBufs.get(key);
  if (!b) {
    const c = g.createCanvas(w, h);
    b = { canvas: c, ctx: c.getContext('2d'), w, h };
    if (softBufs.size > 4) softBufs.delete(softBufs.keys().next().value);
    softBufs.set(key, b);
  }
  return b;
}

/**
 * Draw the stadium seen by `cam`: sky, towers, stands with the crowd, pitch, boards, goals, light
 * cones and lamp glows. Options (all optional):
 *   t            seconds (shimmer, twinkle)            mt       beat clock (F.c.mt) for the crowd's hops
 *   palette      colours (see STADIUM_PALETTE)         energy   crowd 0 calm .. 1 wild (arms up, scarves)
 *   jump         crowd hop height 0..1 on each beat    wave     0 = everyone together, >0 = a travelling wave
 *   flare        floodlight flare 0..1 (kicks)         cones    light-cone strength (default 1)
 *   light        pools of light on the pitch [{x, z, r, a, color}]
 *   goals        true | false | [e...] which goals to draw here (default both); goal: per-goal options
 *   sparkle      {steady, flashes, life} for drawSparkles, or false
 *   boardPulse   0..1 LED board brightness pulse       boardDim 0..1 darker boards (close-ups)
 *   haze         atmosphere strength (default 1)
 *   soft         0..1: draw the sky, towers and stands at this fraction of the resolution (a cheap
 *                depth of field behind close-ups; 0 = sharp). The pitch, lights and sparkles stay sharp.
 *   part         'all' (default) | 'back' (sky, towers, stands we look into) | 'front' (the rest)
 */
export function drawStadium(g, cam, o = {}) {
  const pal = stadiumPalette(o.palette);
  const part = o.part || 'all';
  const soft = o.soft ?? 0;
  if (part === 'all' && soft > 0 && soft < 1) {
    const B = softBuffer(g, soft);
    const k = g.scale * (B.w / g.devW);
    B.ctx.setTransform(1, 0, 0, 1, 0, 0);
    B.ctx.globalAlpha = 1;
    B.ctx.globalCompositeOperation = 'source-over';
    B.ctx.clearRect(0, 0, B.w, B.h);
    B.ctx.setTransform(k, 0, 0, k, 0, 0);
    drawStadium({ ...g, ctx: B.ctx, scale: k, devW: B.w, devH: B.h }, cam, { ...o, part: 'back', soft: 0 });
    const ctx = g.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(B.canvas, 0, 0, g.devW, g.devH);
    ctx.restore();
    drawStadium(g, cam, { ...o, part: 'front', soft: 0 });
    return;
  }
  const ctx = g.ctx;
  ctx.save();
  ctx.lineJoin = 'round';
  const order = STANDS.map((st, si) => ({ st, si, d: toCam(cam, ...standPt(st, st.len / 2, standDepth() / 2, standTop() / 2))[2], front: cameraInFront(cam, st) }));
  order.sort((a, b) => b.d - a.d);
  if (part !== 'front') {
    drawSky(g, cam, pal, o);
    // towers (outside the bowl) far to near
    const tw = [...TOWERS].sort((a, b) => toCam(cam, ...b.head)[2] - toCam(cam, ...a.head)[2]);
    for (const t of tw) drawTower(g, cam, pal, t, o);
    // stands we look into, far first
    for (const s of order) if (s.front) drawStand(g, cam, pal, s.st, s.si, o);
  }
  if (part !== 'back') {
    drawPitch(g, cam, pal, o);
    drawBoards(g, cam, pal, o);
    if (o.sparkle !== false) drawSparkles(g, cam, { ...(o.sparkle || {}), t: o.t, palette: o.palette });
    const goals = o.goals === undefined || o.goals === true ? [-1, 1] : Array.isArray(o.goals) ? o.goals : [];
    for (const e of goals) drawGoal(g, cam, e, { ...(o.goal || {}), palette: o.palette });
    // stands we are behind or above come after the pitch
    for (const s of order) if (!s.front) drawStand(g, cam, pal, s.st, s.si, o);
    drawCones(g, cam, pal, o);
    drawLampGlows(g, cam, pal, o);
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------- figures

/**
 * Ground shadows for a figure standing at (X, Z): a contact shadow plus faint shadows cast away
 * from each floodlight tower. o: {r (contact radius m), a (alpha), lift (m above ground: fades)}.
 */
export function drawShadow(g, cam, X, Z, o = {}) {
  const ctx = g.ctx;
  const lift = o.lift ?? 0;
  const fade = 1 / (1 + lift * 1.2);
  const a = (o.a ?? 0.5) * fade;
  if (a <= 0.01) return;
  const ring = (cx, cz, rx, rz, ang, alpha) => {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const q = (i / 14) * TAU;
      const lx = Math.cos(q) * rx, lz = Math.sin(q) * rz;
      pts.push([cx + lx * Math.cos(ang) - lz * Math.sin(ang), 0.02, cz + lx * Math.sin(ang) + lz * Math.cos(ang)]);
    }
    fillPoly(ctx, projectPoly(cam, pts), `rgba(2,4,12,${alpha.toFixed(3)})`);
  };
  const L = o.len ?? 1.6;
  for (const t of TOWERS) {
    const dx = X - t.base[0], dz = Z - t.base[2], dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    ring(X + ux * L * 0.55, Z + uz * L * 0.55, L * 0.55, 0.22, Math.atan2(uz, ux), a * 0.22);
  }
  const r = o.r ?? 0.45;
  ring(X, Z, r * (1 + lift * 0.4), r * 0.6 * (1 + lift * 0.4), 0, a * 0.8);
}

/**
 * Cel shading and a rim light for figures. draw(ctx) paints the figures (logical coordinates) into a
 * scratch layer; the edges facing the light get a bright rim, the opposite edges a soft shade, then
 * the layer is composited onto g.ctx. bbox = [x0, y0, x1, y1] (logical) limits the work; light =
 * [dx, dy] the screen direction towards the light. o: {rim, rimW (px), shade, shadeA, shadeW, rimA}.
 */
export function litFigures(g, draw, bbox, light, o = {}) {
  const L = g.layer('kzFig');
  draw(L.ctx);
  const sc = g.scale;
  const pad = 24;
  const x0 = Math.max(0, Math.floor((bbox[0] - pad) * sc)), y0 = Math.max(0, Math.floor((bbox[1] - pad) * sc));
  const x1 = Math.min(g.devW, Math.ceil((bbox[2] + pad) * sc)), y1 = Math.min(g.devH, Math.ceil((bbox[3] + pad) * sc));
  const w = x1 - x0, h = y1 - y0;
  const ctx = g.ctx;
  if (w <= 0 || h <= 0) return;
  const ll = Math.hypot(light[0], light[1]) || 1;
  const lx = light[0] / ll, ly = light[1] / ll;
  const R = g.layer('kzRim');
  const rc = R.ctx;
  const crescent = (col, a, dpx) => {
    rc.save();
    rc.setTransform(1, 0, 0, 1, 0, 0);
    rc.globalCompositeOperation = 'copy';
    rc.globalAlpha = 1;
    rc.drawImage(L.canvas, x0, y0, w, h, x0, y0, w, h);
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = col;
    rc.fillRect(x0, y0, w, h);
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(L.canvas, x0, y0, w, h, x0 + dpx[0], y0 + dpx[1], w, h);
    rc.restore();
    const lc = L.ctx;
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-atop';
    lc.globalAlpha = a;
    lc.drawImage(R.canvas, x0, y0, w, h, x0, y0, w, h);
    lc.restore();
  };
  const sw = (o.shadeW ?? 10) * sc, rw = (o.rimW ?? 3.5) * sc;
  if ((o.shadeA ?? 0.32) > 0) crescent(o.shade || '#070A22', o.shadeA ?? 0.32, [lx * sw, ly * sw]);
  if ((o.rimA ?? 0.95) > 0) crescent(o.rim || '#E4EEFF', o.rimA ?? 0.95, [-lx * rw, -ly * rw]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(L.canvas, x0, y0, w, h, x0, y0, w, h);
  ctx.restore();
}

/** The screen direction towards the brightest lamp head in view (for rim lights), default up-left. */
export function lightDir(cam, x, y) {
  let best = null, bd = -Infinity;
  for (const tw of TOWERS) {
    const H = towerHead(tw);
    const facing = (cam.eye[0] - H.c[0]) * H.n[0] + (cam.eye[1] - H.c[1]) * H.n[1] + (cam.eye[2] - H.c[2]) * H.n[2];
    const c = toCam(cam, ...H.c);
    if (c[2] <= cam.near) continue;
    const p = screenOf(cam, c[0], c[1], c[2]);
    const score = (facing > 0 ? 1 : 0.4) / (1 + Math.hypot(p[0] - x, p[1] - y) / 1500);
    if (score > bd) { bd = score; best = p; }
  }
  if (!best) return [-0.5, -0.85];
  return [best[0] - x, Math.min(-200, best[1] - y)];
}

const silhouettes = new Map();
/** A flat-colour silhouette of a puppet design (the same head shape), for after-images and impact frames;
 *  grow (px at scale 1) thickens it with an outline of the same colour (a halo). */
export function silhouette(d, color, grow = 0) {
  const k = `${d.id}|${color}|${grow}`;
  let gd = silhouettes.get(k);
  if (!gd) {
    const head = d.head;
    gd = design({ ...d, id: `sil-${k}`, fill: color, limbFill: color, armFill: color, legFill: color, footFill: color, headFill: color,
      torsoDetail: null, outline: grow > 0 ? color : null, outlineW: grow, head: typeof head === 'function' ? (ctx, r, info) => head(ctx, r, { ...info, pass: 'outline' }) : head });
    if (silhouettes.size > 96) silhouettes.delete(silhouettes.keys().next().value);
    silhouettes.set(k, gd);
  }
  return gd;
}
