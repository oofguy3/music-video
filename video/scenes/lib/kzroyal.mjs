// "The Emperor": the throne hall shared by kzThrone (B2) and kzReign (D2 outro).
//
// A grand dark hall built as a small 2.5D world in metres (X right, Y up, Z away from the camera)
// and seen through a pinhole camera with a lens shift (no pitch, so verticals stay vertical; a low
// camera with the image centre pushed down reads as a low angle) and an optional yaw (orbits):
//   the back wall (navy damask, gold mouldings, two tall arched moonlit windows, a rose window and a
//   niche behind the throne), the side walls, a polished floor with a red carpet up five steps to a
//   dais, colonnades, golden candelabras, chains hanging from the ceiling, bouquets of blue roses in
//   white paper with gold ribbons, the gold-and-crimson throne, the ball, and Kaiser lounging on it.
//
// Static art (walls, throne, bouquets) is drawn once into cached sprites per device scale and
// resolution bucket; everything that moves (lights, flames, chains, petals, dust, the puppet) is drawn
// per frame from closed-form functions of time. Pure: no state between frames.
//
//   const C = royalPalette(S);
//   const cam = camera({ x, y, z, f, py, yaw });
//   drawHall(g, cam, C, { light, moon, ... });   // walls, floor, steps (far to near)
//   drawSet(g, cam, C, { t, F, ... });           // billboards sorted by depth: throne, Kaiser, bouquets...

import { KZ, drawCape, drawRose, drawCrown, drawChain, drawBall } from './kaiser.mjs';
import { design, drawPuppet, solve, poses, armTo } from './puppet.mjs';
import { hashU } from './worldkit.mjs';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;

// --- palette ----------------------------------------------------------------------------------------

export const ROYAL = {
  wall: '#0A1238', damask: '#1A2A6E', gold: '#FFD45A', goldDeep: '#B8860B', velvet: '#B3122B', velvetDeep: '#5E0A16',
  rose: '#2E6BFF', roseDeep: '#14329A', roseHi: '#8FB6FF', candle: '#FFC870', chain: '#C9D2E0', chainDeep: '#6B7488',
  spot: '#DCEBFF', moon: '#9CC2FF', ink: '#0B0B18', paper: '#F4F6FB', paperShade: '#B9C3DA', floor: '#070B22', night: '#03051A',
};

const palCache = new WeakMap();
/** The entry palette with fallbacks for every colour the hall uses (cached per palette object). */
export function royalPalette(S) {
  const p = (S && S.palette) || {};
  let C = palCache.get(p);
  if (!C) {
    C = { ...ROYAL };
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && v.startsWith('#')) C[k] = v;
    if (!p.goldDeep && p.gold) C.goldDeep = shade(C.gold, 0.62);
    if (!p.velvetDeep && p.velvet) C.velvetDeep = shade(C.velvet, 0.52);
    if (!p.roseDeep && p.rose) C.roseDeep = shade(C.rose, 0.55);
    C.key = Object.values(C).join('');
    palCache.set(p, C);
  }
  return C;
}

/** Scale a hex colour's brightness. */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
/** rgba() string of a hex colour. */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
/** Linear mix of two hex colours in sRGB (cheap; for lighting tints). */
export function mixHex(a, b, u) {
  const A = parseInt(a.slice(1, 7), 16), B = parseInt(b.slice(1, 7), 16);
  const f = (s) => { const x = (A >> s) & 255, y = (B >> s) & 255; return Math.round(x + (y - x) * clamp(u)).toString(16).padStart(2, '0'); };
  return `#${f(16)}${f(8)}${f(0)}`;
}

// --- the world --------------------------------------------------------------------------------------

/** The hall's layout in metres. */
export const HALL = {
  backZ: 11, halfW: 10, height: 14, frontZ: -34,
  carpetW: 1.15,
  steps: { n: 5, rise: 0.22, tread: 0.45, z0: 0, halfW: 3.7 },
  dais: { y: 1.1, z0: 2.25, z1: 7.4, halfW: 3.7 },
  throne: { x: 0, z: 4.95 },
  seatY: 1.1 + 0.47,
  pelvis: [-0.5, 1.1 + 0.47 + 0.055, 4.62],
  ball: [0.3, 1.1 + 0.11, 3.92],
  pillarX: 7.2, pillarZ: [-26, -19, -12, -5, 2, 9.4],
  windows: [-5.6, 5.6],                                   // tall arched windows on the back wall
};
export const KAISER_H = 1.86;                            // body height in metres

/**
 * A camera: position (x, y, z), focal length f (px), image centre (px, py) — moving py down is a
 * lens shift (a low camera looking "up" without converging verticals) — yaw (radians, + turns right)
 * and roll (radians, applied to the whole picture by the scene).
 */
export function camera({ x = 0, y = 1.7, z = -8, f = 1200, px = 960, py = 540, yaw = 0, roll = 0 } = {}) {
  return { x, y, z, f, px, py, yaw, roll, cs: Math.cos(yaw), sn: Math.sin(yaw) };
}

/** Project a world point: {x, y, s (px per metre), d (depth)} or null behind the camera. */
export function project(c, X, Y, Z) {
  const dx = X - c.x, dz = Z - c.z;
  const xr = c.cs * dx - c.sn * dz, zr = c.sn * dx + c.cs * dz;
  if (zr < 0.06) return null;
  const s = c.f / zr;
  return { x: c.px + xr * s, y: c.py - (Y - c.y) * s, s, d: zr };
}

/** Depth of a world point along the view axis. */
export const depthOf = (c, X, Z) => c.sn * (X - c.x) + c.cs * (Z - c.z);

/** An orbit camera around target (tx, ty, tz) at radius R and angle th (0 = straight on, + = from the right). */
export function orbitCamera(tx, tz, R, th, opts = {}) {
  return camera({ ...opts, x: tx + R * Math.sin(th), z: tz - R * Math.cos(th), yaw: -th });
}

// polygon of projected points; clips nothing (callers keep geometry in front of the camera)
function polyPath(ctx, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y));
  ctx.closePath();
}

/** Clip a world-space polygon (array of [X, Y, Z]) against the near plane and project it. */
export function projectPoly(c, P, near = 0.12) {
  const out = [];
  const dep = (p) => depthOf(c, p[0], p[2]);
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = dep(a), db = dep(b);
    if (da >= near) out.push(project(c, a[0], a[1], a[2]));
    if ((da >= near) !== (db >= near)) {
      const u = (near - da) / (db - da);
      out.push(project(c, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u));
    }
  }
  return out.filter(Boolean);
}

// --- caches -----------------------------------------------------------------------------------------

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) {
    v = make();
    if (cache.size > 90) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

/** Rasterise a freshly drawn cache canvas now (drawing it once into a throwaway 1x1 canvas), so the
 *  first frame that uses it does not pay for replaying its drawing. */
function settle(g, canvas) {
  const tiny = g.createCanvas(1, 1);
  tiny.getContext('2d').drawImage(canvas, 0, 0, 1, 1);
  return canvas;
}

/**
 * A sprite of art drawn in metres: `bounds` = [x0, y0, x1, y1] in metres (canvas y down), drawn by
 * paint(ctx) at `res` device px per metre. Returns {canvas, bounds, res}.
 */
function sprite(g, key, res, bounds, paint) {
  return cached(`${key}|${res}`, () => {
    const [x0, y0, x1, y1] = bounds;
    const w = Math.max(1, Math.ceil((x1 - x0) * res)), h = Math.max(1, Math.ceil((y1 - y0) * res));
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    x.scale(res, res);
    x.translate(-x0, -y0);
    x.lineJoin = 'round';
    x.lineCap = 'round';
    paint(x);
    return { canvas: settle(g, c), bounds, res };
  });
}

/** Draw a sprite with its local origin at screen (sx, sy), scale s (logical px per metre). */
function blit(ctx, spr, sx, sy, s, { flip = false, alpha = 1, squash = 1 } = {}) {
  if (!spr || s <= 0 || alpha <= 0) return;
  const [x0, y0, x1, y1] = spr.bounds;
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.translate(sx, sy);
  ctx.scale(flip ? -s * squash : s * squash, s);
  ctx.drawImage(spr.canvas, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// --- ornament helpers (in metres) -------------------------------------------------------------------

function goldGrad(x, C, y0, y1) {
  const gr = x.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, mixHex(C.gold, '#FFFFFF', 0.35));
  gr.addColorStop(0.35, C.gold);
  gr.addColorStop(0.75, C.goldDeep);
  gr.addColorStop(1, shade(C.goldDeep, 0.7));
  return gr;
}
function goldGradX(x, C, x0, x1) {
  const gr = x.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, shade(C.goldDeep, 0.75));
  gr.addColorStop(0.3, C.gold);
  gr.addColorStop(0.45, mixHex(C.gold, '#FFFFFF', 0.45));
  gr.addColorStop(0.62, C.gold);
  gr.addColorStop(1, shade(C.goldDeep, 0.7));
  return gr;
}

/** A C-scroll (volute): a spiral of n turns ending at (x, y). */
function scroll(x, cx, cy, r, turns = 1.4, dir = 1, a0 = 0) {
  x.beginPath();
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = a0 + dir * u * turns * TAU, rr = r * (1 - 0.82 * u);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.stroke();
}

/** drawRose in metre units (the lib's rose skips radii under 0.3, so draw it in centimetres). */
function roseM(x, cx, cy, r, opts) {
  x.save();
  x.translate(cx, cy);
  x.scale(0.01, 0.01);
  drawRose(x, 0, 0, r * 100, opts);
  x.restore();
}

/** One damask motif (a symmetric medallion with leaves) centred at (0, 0), height h. */
function damaskMotif(x, h, col, edge) {
  const w = h * 0.62;
  x.fillStyle = col;
  x.beginPath();                                          // central medallion: an ogee lozenge
  x.moveTo(0, -h * 0.5);
  x.bezierCurveTo(w * 0.32, -h * 0.34, w * 0.5, -h * 0.12, w * 0.18, h * 0.02);
  x.bezierCurveTo(w * 0.42, h * 0.16, w * 0.3, h * 0.38, 0, h * 0.5);
  x.bezierCurveTo(-w * 0.3, h * 0.38, -w * 0.42, h * 0.16, -w * 0.18, h * 0.02);
  x.bezierCurveTo(-w * 0.5, -h * 0.12, -w * 0.32, -h * 0.34, 0, -h * 0.5);
  x.fill();
  x.fillStyle = edge;                                      // inner fleur
  x.beginPath();
  x.moveTo(0, -h * 0.3);
  x.bezierCurveTo(w * 0.14, -h * 0.16, w * 0.12, h * 0.02, 0, h * 0.2);
  x.bezierCurveTo(-w * 0.12, h * 0.02, -w * 0.14, -h * 0.16, 0, -h * 0.3);
  x.fill();
  x.fillStyle = col;                                       // side leaves
  for (const s of [-1, 1]) {
    x.beginPath();
    x.moveTo(s * w * 0.2, -h * 0.05);
    x.bezierCurveTo(s * w * 0.55, -h * 0.3, s * w * 0.75, -h * 0.05, s * w * 0.5, h * 0.12);
    x.bezierCurveTo(s * w * 0.6, h * 0.0, s * w * 0.45, -h * 0.08, s * w * 0.2, -h * 0.05);
    x.fill();
    x.beginPath(); x.arc(s * w * 0.5, -h * 0.38, h * 0.045, 0, TAU); x.fill();
    x.beginPath(); x.arc(s * w * 0.5, h * 0.38, h * 0.045, 0, TAU); x.fill();
  }
}

// --- the walls (cached textures) --------------------------------------------------------------------

const WALL_RES = 120;                                    // logical px per metre of the wall textures

function damaskTile(g, C, res) {
  return cached(`damask|${C.key}|${res}`, () => {
    const tw = 1.1, th = 1.5;                             // metres per tile (half-drop repeat)
    const w = Math.max(4, Math.round(tw * res)), h = Math.max(4, Math.round(th * res));
    const c = g.createCanvas(w, h);
    const x = c.getContext('2d');
    x.scale(w / tw, h / th);
    x.fillStyle = C.wall; x.fillRect(0, 0, tw, th);
    const col = mixHex(C.wall, C.damask, 0.78), edge = mixHex(C.damask, C.gold, 0.16);
    for (const [cx, cy] of [[tw / 2, th / 2], [0, 0], [tw, 0], [0, th], [tw, th]]) {
      x.save(); x.translate(cx, cy); damaskMotif(x, th * 0.42, col, edge); x.restore();
    }
    x.strokeStyle = rgba(C.gold, 0.06); x.lineWidth = 0.012;          // a faint gold lattice
    x.beginPath(); x.moveTo(0, th / 2); x.lineTo(tw / 2, 0); x.lineTo(tw, th / 2); x.lineTo(tw / 2, th); x.closePath(); x.stroke();
    return settle(g, c);
  });
}

function fillDamask(g, x, C, res, X0, Y0, X1, Y1) {
  const tile = damaskTile(g, C, res);
  const pat = x.createPattern(tile, 'repeat');
  if (pat.setTransform) pat.setTransform({ a: 1.1 / tile.width, b: 0, c: 0, d: 1.5 / tile.height, e: 0, f: 0 });
  x.fillStyle = pat;
  x.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
}

function archPath(x, cx, y0, y1, w) {                    // a round-headed arch: base y0 (floor side), springing below y1
  const r = w / 2;
  x.beginPath();
  x.moveTo(cx - r, y0);
  x.lineTo(cx - r, y1 + r);
  x.arc(cx, y1 + r, r, Math.PI, 0);
  x.lineTo(cx + r, y0);
  x.closePath();
}

/** Window glass: moonlit panes with mullions, drawn in a round-headed arch (canvas coords, metres). */
function windowArt(x, C, cx, yTop, yBot, w) {
  archPath(x, cx, yBot, yTop, w);
  const gl = x.createLinearGradient(0, yTop, 0, yBot);
  gl.addColorStop(0, mixHex(C.moon, '#FFFFFF', 0.55));
  gl.addColorStop(0.45, C.moon);
  gl.addColorStop(1, mixHex(C.moon, C.wall, 0.45));
  x.fillStyle = gl; x.fill();
  x.save(); x.clip();
  const mg = x.createRadialGradient(cx + w * 0.18, yTop + w * 0.55, 0, cx + w * 0.18, yTop + w * 0.55, w * 0.9);
  mg.addColorStop(0, 'rgba(255,255,255,0.85)'); mg.addColorStop(0.25, 'rgba(255,255,255,0.35)'); mg.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = mg; x.fillRect(cx - w, yTop, 2 * w, yBot - yTop);
  x.strokeStyle = mixHex(C.wall, C.ink, 0.4); x.lineWidth = 0.07;   // mullions and transoms
  x.beginPath();
  for (const u of [-1 / 6, 1 / 6]) { x.moveTo(cx + u * w * 1.5, yTop + w * 0.2); x.lineTo(cx + u * w * 1.5, yBot); }
  for (let y = yTop + w * 0.62; y < yBot; y += (yBot - yTop) / 6.2) { x.moveTo(cx - w / 2, y); x.lineTo(cx + w / 2, y); }
  x.stroke();
  x.lineWidth = 0.03; x.beginPath();                      // tracery in the head
  x.arc(cx, yTop + w / 2, w * 0.22, 0, TAU);
  for (let k = 0; k < 6; k++) { const a = Math.PI + (k / 5) * Math.PI; x.moveTo(cx, yTop + w / 2); x.lineTo(cx + Math.cos(a) * w / 2, yTop + w / 2 + Math.sin(a) * w / 2); }
  x.stroke();
  x.restore();
  archPath(x, cx, yBot, yTop, w);
  x.strokeStyle = C.gold; x.lineWidth = 0.09; x.stroke();
  x.strokeStyle = C.goldDeep; x.lineWidth = 0.035;
  archPath(x, cx, yBot + 0.08, yTop - 0.12, w + 0.24); x.stroke();
}

/** The rose window: a round blue window with radial tracery. */
function roseWindowArt(x, C, cx, cy, R) {
  x.beginPath(); x.arc(cx, cy, R * 1.12, 0, TAU);
  x.fillStyle = C.goldDeep; x.fill();
  x.beginPath(); x.arc(cx, cy, R, 0, TAU);
  const gr = x.createRadialGradient(cx, cy, 0, cx, cy, R);
  gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.25, mixHex(C.moon, '#FFFFFF', 0.4)); gr.addColorStop(0.7, C.rose); gr.addColorStop(1, C.roseDeep);
  x.fillStyle = gr; x.fill();
  x.save(); x.clip();
  x.strokeStyle = mixHex(C.wall, C.ink, 0.3); x.lineWidth = R * 0.05;
  x.beginPath();
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; x.moveTo(cx + Math.cos(a) * R * 0.28, cy + Math.sin(a) * R * 0.28); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
  x.stroke();
  x.beginPath(); x.arc(cx, cy, R * 0.28, 0, TAU); x.stroke();
  x.beginPath(); x.arc(cx, cy, R * 0.66, 0, TAU); x.stroke();
  for (let k = 0; k < 12; k++) {                         // petal lobes
    const a = ((k + 0.5) / 12) * TAU;
    x.beginPath(); x.arc(cx + Math.cos(a) * R * 0.83, cy + Math.sin(a) * R * 0.83, R * 0.12, 0, TAU); x.stroke();
  }
  x.restore();
  x.strokeStyle = C.gold; x.lineWidth = R * 0.06;
  x.beginPath(); x.arc(cx, cy, R * 1.06, 0, TAU); x.stroke();
}

/** The back wall texture: X in [-halfW, halfW], Y in [0, height] (canvas y = -Y). */
function backWall(g, C) {
  const res = WALL_RES * g.scale;
  const W = HALL.halfW, Ht = HALL.height;
  return sprite(g, `backwall|${C.key}`, res, [-W, -Ht, W, 0], (x) => {
    fillDamask(g, x, C, res, -W, -Ht, W, 0);
    const shadeTop = x.createLinearGradient(0, -Ht, 0, 0);
    shadeTop.addColorStop(0, 'rgba(2,3,14,0.82)'); shadeTop.addColorStop(0.45, 'rgba(2,3,14,0.25)'); shadeTop.addColorStop(1, 'rgba(2,3,14,0.35)');
    x.fillStyle = shadeTop; x.fillRect(-W, -Ht, 2 * W, Ht);
    // wainscot
    x.fillStyle = mixHex(C.wall, C.ink, 0.35); x.fillRect(-W, -1.5, 2 * W, 1.5);
    x.strokeStyle = rgba(C.gold, 0.55); x.lineWidth = 0.05;
    x.beginPath(); x.moveTo(-W, -1.5); x.lineTo(W, -1.5); x.stroke();
    x.strokeStyle = rgba(C.gold, 0.25); x.lineWidth = 0.025;
    for (let px = -W + 0.3; px < W - 0.3; px += 1.4) x.strokeRect(px, -1.3, 1.1, 1.0);
    // cornice
    x.fillStyle = mixHex(C.wall, C.ink, 0.5); x.fillRect(-W, -Ht, 2 * W, 1.2);
    x.fillStyle = rgba(C.gold, 0.5); x.fillRect(-W, -Ht + 1.2, 2 * W, 0.08);
    // pilasters between the bays
    for (const px of [-8.2, -3.1, 3.1, 8.2]) {
      x.fillStyle = mixHex(C.wall, C.damask, 0.35); x.fillRect(px - 0.38, -Ht + 1.2, 0.76, Ht - 2.7);
      x.fillStyle = goldGradX(x, C, px - 0.38, px + 0.38);
      x.fillRect(px - 0.38, -Ht + 1.2, 0.07, Ht - 2.7); x.fillRect(px + 0.31, -Ht + 1.2, 0.07, Ht - 2.7);
      x.fillRect(px - 0.48, -1.75, 0.96, 0.25); x.fillRect(px - 0.48, -Ht + 1.25, 0.96, 0.3);
      x.strokeStyle = rgba(C.gold, 0.35); x.lineWidth = 0.02;
      for (let k = -1; k <= 1; k++) { x.beginPath(); x.moveTo(px + k * 0.14, -Ht + 1.7); x.lineTo(px + k * 0.14, -2.0); x.stroke(); }
    }
    // the niche behind the throne
    archPath(x, 0, 0, -6.6, 5.0);
    const ng = x.createLinearGradient(0, -6.6, 0, 0);
    ng.addColorStop(0, mixHex(C.wall, C.ink, 0.55)); ng.addColorStop(1, mixHex(C.wall, C.damask, 0.3));
    x.fillStyle = ng; x.fill();
    x.save(); x.clip();
    for (let k = -6; k <= 6; k++) {                       // a radiating gold sunburst in the niche head
      const a = -Math.PI / 2 + k * 0.16;
      x.strokeStyle = rgba(C.gold, k % 2 ? 0.1 : 0.2); x.lineWidth = 0.06;
      x.beginPath(); x.moveTo(0, -4.1); x.lineTo(Math.cos(a) * 4, -4.1 + Math.sin(a) * 4); x.stroke();
    }
    x.restore();
    archPath(x, 0, 0, -6.6, 5.0);
    x.strokeStyle = C.gold; x.lineWidth = 0.14; x.stroke();
    archPath(x, 0, 0, -6.85, 5.5);
    x.strokeStyle = C.goldDeep; x.lineWidth = 0.06; x.stroke();
    // the windows and the rose window
    for (const wx of HALL.windows) windowArt(x, C, wx, -9.4, -2.2, 2.3);
    roseWindowArt(x, C, 0, -8.95, 1.25);
    // a gold crown relief above the niche
    x.save(); x.translate(0, -10.65); x.scale(0.01, 0.01);
    drawCrown(x, 0, 0, 110, { fill: C.gold, deep: C.goldDeep, ink: mixHex(C.wall, C.ink, 0.6), jewel: C.rose, lineW: 4 });
    x.restore();
  });
}

/** The back wall softened (out of focus), for the closer framings. */
function backWallSoft(g, C) {
  const src = backWall(g, C);
  return cached(`backwallsoft|${C.key}|${src.res}`, () => {
    const c = g.createCanvas(src.canvas.width, src.canvas.height);
    const x = c.getContext('2d');
    x.filter = `blur(${Math.max(1, Math.round(3.5 * g.scale))}px)`;
    x.drawImage(src.canvas, 0, 0);
    x.filter = 'none';
    return { canvas: settle(g, c), bounds: src.bounds, res: src.res };
  });
}

/** The side wall texture: along Z (u) in [frontZ, backZ], Y in [0, height]. */
function sideWall(g, C) {
  const res = WALL_RES * 0.5 * g.scale;
  const Z0 = HALL.frontZ, Z1 = HALL.backZ, Ht = HALL.height;
  return sprite(g, `sidewall|${C.key}`, res, [Z0, -Ht, Z1, 0], (x) => {
    fillDamask(g, x, C, res, Z0, -Ht, Z1, 0);
    const sh = x.createLinearGradient(0, -Ht, 0, 0);
    sh.addColorStop(0, 'rgba(2,3,14,0.85)'); sh.addColorStop(0.5, 'rgba(2,3,14,0.35)'); sh.addColorStop(1, 'rgba(2,3,14,0.45)');
    x.fillStyle = sh; x.fillRect(Z0, -Ht, Z1 - Z0, Ht);
    x.fillStyle = mixHex(C.wall, C.ink, 0.35); x.fillRect(Z0, -1.5, Z1 - Z0, 1.5);
    x.fillStyle = rgba(C.gold, 0.5); x.fillRect(Z0, -1.55, Z1 - Z0, 0.06);
    for (let z = -22.5; z < 8; z += 7) windowArt(x, C, z, -9.6, -2.6, 2.1);
  });
}

/**
 * Draw a vertical wall plane through the camera in `n` vertical strips (exact perspective along the
 * plane, so it holds up under yaw). wall(u) gives the world [X, Z] of texture coordinate u (metres).
 */
function drawWallStrips(ctx, cam, spr, u0, u1, at, n, alpha = 1) {
  const [bx0, by0, bx1, by1] = spr.bounds;
  const sw = spr.canvas.width / (bx1 - bx0);
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const [X, Z] = at(u);
    const top = project(cam, X, -by0, Z), bot = project(cam, X, -by1, Z);
    const cur = top && bot ? { u, x: top.x, yt: top.y, yb: bot.y } : null;
    if (prev && cur) {
      const xl = Math.min(prev.x, cur.x), xr = Math.max(prev.x, cur.x);
      if (xr > -2 && xl < 1922 && xr - xl > 0.01) {
        const yt = Math.min(prev.yt, cur.yt), yb = Math.max(prev.yb, cur.yb);
        const sx = (Math.min(prev.u, cur.u) - bx0) * sw, sW = Math.max(0.5, Math.abs(cur.u - prev.u) * sw);
        const flip = (cur.x - prev.x) * (cur.u - prev.u) < 0;   // texture runs right-to-left on screen
        if (flip) {
          ctx.save();
          ctx.translate(xl + xr, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(spr.canvas, sx, 0, sW, spr.canvas.height, xl - 0.35, yt, xr - xl + 0.7, yb - yt);
          ctx.restore();
        } else ctx.drawImage(spr.canvas, sx, 0, sW, spr.canvas.height, xl - 0.35, yt, xr - xl + 0.7, yb - yt);
      }
    }
    prev = cur;
  }
  ctx.restore();
}

// --- floor, carpet, steps -------------------------------------------------------------------------

function quad(c, a, b, cc, d) { return projectPoly(c, [a, b, cc, d]); }

/**
 * The hall's architecture, far to near: night fill, back wall, side walls, floor with tile joints and
 * window reflections, the carpet, steps and dais. opts: dim (0..1 darkens it), moon (0..1 window glow).
 */
export function drawHall(g, cam, C, { dim = 0, moon = 1, reflect = 1, soft = false } = {}) {
  const ctx = g.ctx;
  const H = HALL;
  ctx.fillStyle = C.night;
  ctx.fillRect(-40, -40, 2000, 1160);
  // back wall: a plane at Z = backZ (strips when the camera is turned)
  const bw = soft ? backWallSoft(g, C) : backWall(g, C);
  if (Math.abs(cam.yaw) < 1e-4) {
    const tl = project(cam, -H.halfW, H.height, H.backZ), br = project(cam, H.halfW, 0, H.backZ);
    if (tl && br) ctx.drawImage(bw.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  } else drawWallStrips(ctx, cam, bw, -H.halfW, H.halfW, (u) => [u, H.backZ], 24);
  // side walls
  const sw = sideWall(g, C);
  for (const side of [-1, 1]) {
    const wx = side * H.halfW;
    if ((cam.x - wx) * side > -0.2) continue;             // the camera is beyond this wall
    drawWallStrips(ctx, cam, sw, H.frontZ, H.backZ, (u) => [wx, u], 28, 0.9);
  }
  // atmosphere: the upper hall sinks into darkness, a cool haze hangs at eye level
  {
    const hz = project(cam, 0, 0, H.backZ), top = project(cam, 0, H.height, H.backZ);
    const yH = hz ? hz.y : cam.py, yT = top ? top.y : 0;
    const hg = ctx.createLinearGradient(0, yT, 0, yH);
    hg.addColorStop(0, rgba('#01020A', 0.55));
    hg.addColorStop(0.55, rgba(C.wall, 0.1));
    hg.addColorStop(1, rgba(mixHex(C.wall, C.moon, 0.25), 0.28));
    ctx.fillStyle = hg;
    ctx.fillRect(-40, Math.min(yT, -40), 2000, Math.max(0, yH - Math.min(yT, -40)));
  }
  // floor
  const fl = quad(cam, [-H.halfW, 0, H.frontZ], [H.halfW, 0, H.frontZ], [H.halfW, 0, H.backZ], [-H.halfW, 0, H.backZ]);
  if (fl.length > 2) {
    polyPath(ctx, fl);
    const hz = project(cam, 0, 0, H.backZ);
    const y0 = hz ? hz.y : cam.py;
    const gr = ctx.createLinearGradient(0, y0, 0, 1080);
    gr.addColorStop(0, mixHex(C.floor, C.damask, 0.35));
    gr.addColorStop(0.35, C.floor);
    gr.addColorStop(1, mixHex(C.floor, '#000000', 0.4));
    ctx.fillStyle = gr;
    ctx.fill();
    // tile joints: lines along Z and across
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = rgba(C.damask, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let X = -H.halfW; X <= H.halfW + 1e-6; X += 1.6) {
      const p = projectPoly(cam, [[X, 0, H.frontZ], [X, 0, H.backZ], [X, 0, H.backZ]]);
      if (p.length >= 2) { ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); }
    }
    for (let Z = H.backZ; Z > H.frontZ; Z -= 1.6) {
      const a = project(cam, -H.halfW, 0, Z), b = project(cam, H.halfW, 0, Z);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    }
    ctx.stroke();
    // moonlight reflections of the windows on the polished floor
    if (reflect > 0 && moon > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (const wx of H.windows) {
        const a = project(cam, wx - 1.0, 0, H.backZ - 0.3), b = project(cam, wx + 1.0, 0, H.backZ - 0.3);
        const c2 = project(cam, wx + 1.4, 0, H.backZ - 9), d2 = project(cam, wx - 1.4, 0, H.backZ - 9);
        if (!a || !b || !c2 || !d2) continue;
        const lg = ctx.createLinearGradient(0, a.y, 0, d2.y);
        lg.addColorStop(0, rgba(C.moon, 0.22 * moon * reflect * (1 - dim)));
        lg.addColorStop(1, rgba(C.moon, 0));
        ctx.fillStyle = lg;
        polyPath(ctx, [a, b, c2, d2]);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  // carpet to the steps
  const cw = H.carpetW;
  const cp = quad(cam, [-cw, 0.005, H.frontZ], [cw, 0.005, H.frontZ], [cw, 0.005, H.steps.z0], [-cw, 0.005, H.steps.z0]);
  if (cp.length > 2) {
    polyPath(ctx, cp);
    const far = project(cam, 0, 0, H.steps.z0);
    const cg = ctx.createLinearGradient(0, far ? far.y : cam.py, 0, 1080);
    cg.addColorStop(0, mixHex(C.velvet, C.velvetDeep, 0.4));
    cg.addColorStop(0.45, mixHex(C.velvet, C.velvetDeep, 0.7));
    cg.addColorStop(1, mixHex(C.velvetDeep, '#000000', 0.5));
    ctx.fillStyle = cg;
    ctx.fill();
    for (const s of [-1, 1]) {                            // gold borders
      const b = quad(cam, [s * cw, 0.006, H.frontZ], [s * (cw - 0.12), 0.006, H.frontZ], [s * (cw - 0.12), 0.006, H.steps.z0], [s * cw, 0.006, H.steps.z0]);
      if (b.length > 2) { polyPath(ctx, b); ctx.fillStyle = C.goldDeep; ctx.fill(); }
    }
  }
  drawSteps(g, cam, C);
  if (dim > 0) {
    ctx.fillStyle = rgba('#000006', 0.7 * dim);
    ctx.fillRect(-40, -40, 2000, 1160);
  }
}

function drawSteps(g, cam, C) {
  const ctx = g.ctx;
  const { n, rise, tread, z0, halfW } = HALL.steps;
  const D = HALL.dais, cw = HALL.carpetW;
  const top = mixHex(C.wall, C.damask, 0.55), riser = mixHex(C.wall, C.ink, 0.25);
  // dais top first (it is behind the steps' fronts)
  const dt = quad(cam, [-D.halfW, D.y, D.z0], [D.halfW, D.y, D.z0], [D.halfW, D.y, D.z1], [-D.halfW, D.y, D.z1]);
  if (dt.length > 2) {
    polyPath(ctx, dt);
    ctx.fillStyle = top; ctx.fill();
    const cp = quad(cam, [-cw, D.y + 0.004, D.z0 - 0.01], [cw, D.y + 0.004, D.z0 - 0.01], [cw, D.y + 0.004, HALL.throne.z - 0.2], [-cw, D.y + 0.004, HALL.throne.z - 0.2]);
    if (cp.length > 2) { polyPath(ctx, cp); ctx.fillStyle = mixHex(C.velvet, C.velvetDeep, 0.6); ctx.fill(); }
  }
  // dais sides (visible when the camera is off to the side)
  for (const s of [-1, 1]) {
    if ((cam.x - s * D.halfW) * s <= 0) continue;
    const sp = quad(cam, [s * D.halfW, 0, z0], [s * D.halfW, 0, D.z1], [s * D.halfW, D.y, D.z1], [s * D.halfW, D.y, z0 + n * tread]);
    if (sp.length > 2) { polyPath(ctx, sp); ctx.fillStyle = mixHex(riser, '#000000', 0.3); ctx.fill(); }
  }
  // steps from the top (back) down to the front, so nearer steps cover farther ones
  for (let k = n - 1; k >= 0; k--) {
    const zF = z0 + k * tread, yT = (k + 1) * rise, yB = k * rise, zB = z0 + (k + 1) * tread;
    // tread (top face) if the camera is above it
    if (cam.y > yT) {
      const tp = quad(cam, [-halfW, yT, zF], [halfW, yT, zF], [halfW, yT, zB], [-halfW, yT, zB]);
      if (tp.length > 2) { polyPath(ctx, tp); ctx.fillStyle = top; ctx.fill(); }
      const ct = quad(cam, [-cw, yT + 0.004, zF], [cw, yT + 0.004, zF], [cw, yT + 0.004, zB], [-cw, yT + 0.004, zB]);
      if (ct.length > 2) { polyPath(ctx, ct); ctx.fillStyle = mixHex(C.velvet, C.velvetDeep, 0.3); ctx.fill(); }
    }
    // riser (front face)
    const rp = quad(cam, [-halfW, yB, zF], [halfW, yB, zF], [halfW, yT, zF], [-halfW, yT, zF]);
    if (rp.length > 2) {
      polyPath(ctx, rp); ctx.fillStyle = riser; ctx.fill();
      const cr = quad(cam, [-cw, yB, zF - 0.004], [cw, yB, zF - 0.004], [cw, yT, zF - 0.004], [-cw, yT, zF - 0.004]);
      if (cr.length > 2) { polyPath(ctx, cr); ctx.fillStyle = C.velvetDeep; ctx.fill(); }
      const a = project(cam, -halfW, yT, zF), b = project(cam, halfW, yT, zF);
      if (a && b) {                                       // a gold nosing on each step
        ctx.strokeStyle = rgba(C.gold, 0.75); ctx.lineWidth = Math.max(1, 0.03 * a.s);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
  }
}

// --- the throne (cached sprite, metres, origin at the base centre, y down) ------------------------

const THRONE_B = [-1.42, -3.95, 1.42, 0.02];

function throneArt(x, C) {
  const ink = C.ink, lw = 0.02;
  const goldV = goldGrad(x, C, -3.8, 0);
  x.lineWidth = lw; x.strokeStyle = ink;
  // the back: an ogee-topped panel in a heavy gold frame
  const back = (inset) => {
    const w = 0.95 - inset, yb = -0.4, ys = -2.55 + inset * 0.55, ya = -3.3 + inset * 1.2;
    x.beginPath();
    x.moveTo(-w, yb);
    x.lineTo(-w, ys);
    x.bezierCurveTo(-w, ys - 0.38, -w * 0.25, ys - 0.2, 0, ya);
    x.bezierCurveTo(w * 0.25, ys - 0.2, w, ys - 0.38, w, ys);
    x.lineTo(w, yb);
    x.closePath();
  };
  back(0); x.fillStyle = goldV; x.fill(); x.stroke();
  back(0.14);
  const vg = x.createLinearGradient(-0.8, 0, 0.8, 0);       // burgundy, darker than his crimson cape
  vg.addColorStop(0, shade(C.velvetDeep, 0.55)); vg.addColorStop(0.5, mixHex(C.velvet, C.velvetDeep, 0.72)); vg.addColorStop(1, shade(C.velvetDeep, 0.55));
  x.fillStyle = vg; x.fill();
  x.save(); x.clip();
  const vshade = x.createLinearGradient(0, -3.2, 0, -0.4);
  vshade.addColorStop(0, 'rgba(10,0,8,0.5)'); vshade.addColorStop(0.45, 'rgba(10,0,8,0.05)'); vshade.addColorStop(1, 'rgba(10,0,8,0.45)');
  x.fillStyle = vshade; x.fillRect(-1.1, -3.4, 2.2, 3.1);
  x.strokeStyle = rgba(C.velvetDeep, 0.9); x.lineWidth = 0.018;  // diamond tufting
  x.beginPath();
  for (let k = -9; k <= 9; k++) {
    x.moveTo(k * 0.26 - 2, -0.4); x.lineTo(k * 0.26 + 2, -4.4);
    x.moveTo(k * 0.26 + 2, -0.4); x.lineTo(k * 0.26 - 2, -4.4);
  }
  x.stroke();
  for (let i = -7; i <= 7; i++) for (let j = 0; j < 14; j++) {   // buttons at the crossings
    const bx = i * 0.13, by = -0.4 - j * 0.26 - (i % 2 ? 0.13 : 0);
    if ((i + j) % 2 === 0 && Math.abs(bx) < 0.78 && by < -0.5) {
      x.fillStyle = C.goldDeep; x.beginPath(); x.arc(bx, by, 0.022, 0, TAU); x.fill();
      x.fillStyle = mixHex(C.gold, '#FFFFFF', 0.3); x.beginPath(); x.arc(bx - 0.006, by - 0.006, 0.01, 0, TAU); x.fill();
    }
  }
  x.restore();
  back(0.14); x.strokeStyle = ink; x.lineWidth = lw; x.stroke();
  back(0.065); x.strokeStyle = rgba(C.goldDeep, 0.9); x.lineWidth = 0.022; x.stroke();
  x.strokeStyle = rgba('#FFF6D0', 0.6); x.lineWidth = 0.01;   // shine
  back(0.03); x.stroke();
  x.fillStyle = mixHex(C.gold, '#FFFFFF', 0.4);              // beads along the frame
  for (let k = 0; k < 15; k++) {
    const y = -0.58 - k * 0.135;
    for (const s of [-1, 1]) { x.beginPath(); x.arc(s * 0.88, y, 0.02, 0, TAU); x.fill(); }
  }
  // the crest: scrolls, roses and a crown at the apex
  x.strokeStyle = C.gold; x.lineWidth = 0.06;
  const scrolls = () => {
    for (const s of [-1, 1]) {
      scroll(x, s * 0.36, -3.2, 0.22, 1.3, s, s > 0 ? Math.PI : 0);
      scroll(x, s * 0.82, -2.8, 0.17, 1.2, -s, s > 0 ? 0 : Math.PI);
    }
  };
  scrolls();
  x.strokeStyle = ink; x.lineWidth = 0.014; scrolls();
  x.save(); x.scale(0.01, 0.01);
  drawCrown(x, 0, -330, 64, { fill: C.gold, deep: C.goldDeep, ink, jewel: C.rose, lineW: 2 });
  x.restore();
  for (const [rx, ry, rr] of [[-0.54, -3.0, 0.105], [0.54, -3.0, 0.105], [-0.26, -3.3, 0.075], [0.26, -3.3, 0.075]]) {
    roseM(x, rx, ry, rr, { color: C.rose, deep: C.roseDeep, hi: C.roseHi, rot: rx });
  }
  // side posts with orb finials
  for (const s of [-1, 1]) {
    const px = s * 1.06;
    x.fillStyle = goldGradX(x, C, px - 0.09, px + 0.09);
    x.beginPath(); x.rect(px - 0.08, -2.62, 0.16, 2.25); x.fill(); x.stroke();
    for (const yy of [-2.62, -1.8, -1.05]) { x.beginPath(); x.rect(px - 0.11, yy - 0.045, 0.22, 0.09); x.fill(); x.stroke(); }
    x.beginPath(); x.arc(px, -2.79, 0.13, 0, TAU);
    const og = x.createRadialGradient(px - 0.04, -2.84, 0.01, px, -2.79, 0.14);
    og.addColorStop(0, '#FFF6D0'); og.addColorStop(0.4, C.gold); og.addColorStop(1, C.goldDeep);
    x.fillStyle = og; x.fill(); x.stroke();
    x.beginPath(); x.moveTo(px, -2.92); x.lineTo(px, -3.06); x.strokeStyle = C.gold; x.lineWidth = 0.035; x.stroke();
    x.strokeStyle = ink; x.lineWidth = lw;
    x.fillStyle = C.rose; x.beginPath(); x.arc(px, -3.1, 0.04, 0, TAU); x.fill(); x.stroke();
  }
  // seat: cushion and the front skirt with a scalloped gold valance
  x.beginPath(); x.roundRect(-0.9, -0.6, 1.8, 0.17, 0.07);
  const cg = x.createLinearGradient(0, -0.6, 0, -0.43);
  cg.addColorStop(0, mixHex(C.velvet, '#FFFFFF', 0.14)); cg.addColorStop(1, C.velvet);
  x.fillStyle = cg; x.fill(); x.stroke();
  x.beginPath(); x.rect(-0.9, -0.46, 1.8, 0.36);
  const sg = x.createLinearGradient(0, -0.46, 0, -0.1);
  sg.addColorStop(0, C.velvet); sg.addColorStop(1, C.velvetDeep);
  x.fillStyle = sg; x.fill(); x.stroke();
  x.fillStyle = goldV; x.beginPath(); x.rect(-0.92, -0.48, 1.84, 0.055); x.fill(); x.stroke();
  x.beginPath();
  x.moveTo(-0.9, -0.425);
  for (let k = 0; k < 10; k++) { const a = -0.9 + (k / 10) * 1.8, b = a + 1.8 / 10; x.lineTo(a, -0.425); x.quadraticCurveTo((a + b) / 2, -0.26, b, -0.425); }
  x.lineTo(0.9, -0.425); x.closePath();
  x.fillStyle = C.gold; x.fill(); x.lineWidth = 0.01; x.stroke(); x.lineWidth = lw;
  x.fillStyle = C.goldDeep;
  for (let k = 0; k <= 10; k++) { const a = -0.9 + (k / 10) * 1.8; x.beginPath(); x.ellipse(a, -0.37, 0.02, 0.055, 0, 0, TAU); x.fill(); }
  // armrests: a gold scroll column under a padded arm (top at the lounging elbow's height)
  for (const s of [-1, 1]) {
    const ax = s * 1.0;
    x.fillStyle = goldGradX(x, C, ax - 0.18, ax + 0.18);
    x.beginPath();
    x.moveTo(ax - 0.15, -0.1); x.lineTo(ax - 0.12, -0.62); x.lineTo(ax + 0.12, -0.62); x.lineTo(ax + 0.15, -0.1); x.closePath();
    x.fill(); x.stroke();
    x.beginPath(); x.roundRect(ax - 0.22, -0.76, 0.44, 0.16, 0.07);
    x.fillStyle = cg; x.fill(); x.stroke();
    x.strokeStyle = C.gold; x.lineWidth = 0.045;
    scroll(x, ax + s * 0.02, -0.46, 0.1, 1.3, s, Math.PI * 0.5);
    x.strokeStyle = ink; x.lineWidth = lw;
    x.beginPath(); x.arc(ax + s * 0.16, -0.68, 0.075, 0, TAU);   // the arm's scroll end
    x.fillStyle = C.gold; x.fill(); x.stroke();
    x.fillStyle = C.rose; x.beginPath(); x.arc(ax + s * 0.16, -0.68, 0.03, 0, TAU); x.fill();
  }
  // the plinth with claw feet
  x.beginPath(); x.rect(-1.26, -0.12, 2.52, 0.12);
  x.fillStyle = goldV; x.fill(); x.stroke();
  x.strokeStyle = rgba(C.goldDeep, 0.9); x.lineWidth = 0.012;
  x.beginPath(); x.moveTo(-1.22, -0.06); x.lineTo(1.22, -0.06); x.stroke();
  x.strokeStyle = ink; x.lineWidth = lw;
  for (const s of [-1, 1]) {
    x.beginPath(); x.ellipse(s * 1.14, -0.02, 0.14, 0.07, 0, Math.PI, 0); x.closePath();
    x.fillStyle = C.gold; x.fill(); x.stroke();
  }
}

/** Pick a mip level (device px per metre) for an on-screen need: the smallest level >= need / 1.25. */
function level(need, levels) {
  for (const l of levels) if (l * 1.25 >= need) return l;
  return levels[levels.length - 1];
}
const THRONE_LEVELS = [128, 256, 512];
const BQ_LEVELS = [128, 512];
const levelsFor = (g, base) => base.map((l) => Math.round(l * Math.min(1, g.scale * 1.5)));

/** The throne as a cached sprite at a mip level for its on-screen scale. */
export function throneSprite(g, C, sPx) {
  const res = level(sPx * g.scale, levelsFor(g, THRONE_LEVELS));
  return sprite(g, `throne|${C.key}`, res, THRONE_B, (x) => throneArt(x, C));
}

/** Draw the throne at world anchor (base centre), with a fake turn (squash + side face) for orbits. */
export function drawThrone(g, cam, C, { turn = 0, alpha = 1 } = {}) {
  const T = HALL.throne;
  const p = project(cam, T.x, HALL.dais.y, T.z);
  if (!p) return null;
  const ctx = g.ctx;
  const spr = throneSprite(g, C, p.s);
  const sq = Math.cos(turn);
  if (Math.abs(turn) > 0.02) {                            // the side of the back, seen when orbiting
    const side = turn > 0 ? 1 : -1;
    const ex = p.x + side * 0.95 * p.s * sq, depthPx = Math.sin(Math.abs(turn)) * 0.42 * p.s;
    ctx.fillStyle = shade(C.goldDeep, 0.5);
    ctx.beginPath();
    ctx.moveTo(ex, p.y - 0.4 * p.s); ctx.lineTo(ex + side * depthPx, p.y - 0.45 * p.s);
    ctx.lineTo(ex + side * depthPx, p.y - 2.6 * p.s); ctx.lineTo(ex, p.y - 2.55 * p.s); ctx.closePath(); ctx.fill();
  }
  blit(ctx, spr, p.x, p.y, p.s, { alpha, squash: sq });
  return p;
}

// --- bouquets ---------------------------------------------------------------------------------------

const BQ_B = [-0.46, -0.9, 0.46, 0.06];

function bouquetArt(x, C, v) {
  const ink = C.ink;
  x.lineWidth = 0.008; x.strokeStyle = ink;
  // leaves behind the flowers
  x.fillStyle = '#1E5A3A';
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k - 2.5) * 0.45 + (hashU(v, k, 7) - 0.5) * 0.2;
    const lx = Math.cos(a) * 0.3, ly = -0.44 + Math.sin(a) * 0.22;
    x.beginPath(); x.ellipse(lx, ly, 0.09, 0.035, a, 0, TAU); x.fill(); x.stroke();
  }
  // paper cone: back sheet, roses, front sheets
  x.beginPath();
  x.moveTo(-0.36, -0.5); x.quadraticCurveTo(-0.3, -0.62, -0.18, -0.56); x.lineTo(0.05, -0.62); x.quadraticCurveTo(0.26, -0.66, 0.38, -0.5);
  x.lineTo(0.05, 0.02); x.lineTo(-0.03, 0.02); x.closePath();
  x.fillStyle = C.paperShade; x.fill(); x.stroke();
  // roses in a dome
  const n = 9 + Math.floor(hashU(v, 1, 1) * 4);
  const roses = [];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n, a = Math.PI * (1.05 + 0.9 * u) + (hashU(v, k, 2) - 0.5) * 0.25;
    const rr = 0.12 + 0.13 * hashU(v, k, 3);
    roses.push([Math.cos(a) * rr * 1.25, -0.42 + Math.sin(a) * rr * 0.9 - 0.04, 0.075 + 0.025 * hashU(v, k, 4), hashU(v, k, 5)]);
  }
  roses.push([0, -0.53, 0.09, 0.5], [-0.1, -0.47, 0.08, 0.2], [0.11, -0.46, 0.08, 0.8]);
  roses.sort((a, b) => a[1] - b[1]);
  for (const [rx, ry, r, h] of roses) {
    const col = h < 0.25 ? mixHex(C.rose, C.roseHi, 0.45) : h > 0.8 ? mixHex(C.rose, C.roseDeep, 0.35) : C.rose;
    x.fillStyle = shade(C.roseDeep, 0.75);
    x.beginPath(); x.arc(rx, ry + r * 0.12, r * 0.98, 0, TAU); x.fill();
    roseM(x, rx, ry, r, { color: col, deep: C.roseDeep, hi: C.roseHi, rot: h * TAU, open: 0.8 + 0.2 * h });
  }
  // baby's breath
  x.fillStyle = '#F4F7FF';
  for (let k = 0; k < 16; k++) {
    const a = Math.PI * (1.0 + hashU(v, k, 9)), rr = 0.2 + 0.12 * hashU(v, k, 10);
    x.beginPath(); x.arc(Math.cos(a) * rr * 1.2, -0.42 + Math.sin(a) * rr * 0.85, 0.012, 0, TAU); x.fill();
  }
  // front paper sheets
  const pg = x.createLinearGradient(-0.3, 0, 0.3, 0);
  pg.addColorStop(0, C.paperShade); pg.addColorStop(0.45, C.paper); pg.addColorStop(1, mixHex(C.paper, C.paperShade, 0.5));
  x.beginPath();
  x.moveTo(-0.38, -0.36); x.quadraticCurveTo(-0.2, -0.3, -0.06, -0.38); x.lineTo(0.03, 0.03); x.closePath();
  x.fillStyle = pg; x.fill(); x.stroke();
  x.beginPath();
  x.moveTo(0.38, -0.38); x.quadraticCurveTo(0.18, -0.28, 0.0, -0.33); x.lineTo(-0.02, 0.03); x.lineTo(0.05, 0.03); x.closePath();
  x.fillStyle = pg; x.fill(); x.stroke();
  x.strokeStyle = rgba(C.paperShade, 0.9); x.lineWidth = 0.006;
  x.beginPath(); x.moveTo(-0.2, -0.32); x.lineTo(0.0, -0.02); x.moveTo(0.2, -0.32); x.lineTo(0.01, -0.02); x.stroke();
  // the gold ribbon: band, bow and tails
  x.strokeStyle = ink; x.lineWidth = 0.008;
  x.fillStyle = C.gold;
  x.beginPath(); x.moveTo(-0.075, -0.15); x.lineTo(0.08, -0.16); x.lineTo(0.065, -0.11); x.lineTo(-0.06, -0.1); x.closePath(); x.fill(); x.stroke();
  for (const s of [-1, 1]) {
    x.beginPath(); x.moveTo(0, -0.13);
    x.bezierCurveTo(s * 0.06, -0.24, s * 0.17, -0.2, s * 0.13, -0.12);
    x.bezierCurveTo(s * 0.1, -0.08, s * 0.04, -0.1, 0, -0.13);
    x.fill(); x.stroke();
    x.beginPath(); x.moveTo(0, -0.12);
    x.bezierCurveTo(s * 0.04, -0.05, s * 0.02, 0.0, s * 0.08, 0.04);
    x.lineTo(s * 0.06, 0.05); x.bezierCurveTo(s * 0.0, 0.0, s * 0.02, -0.06, -s * 0.01, -0.11);
    x.closePath(); x.fill(); x.stroke();
  }
  x.beginPath(); x.arc(0, -0.13, 0.026, 0, TAU); x.fillStyle = C.goldDeep; x.fill(); x.stroke();
}

/** A bouquet sprite (variant v) at a resolution bucket. Origin at the cone's tip (bottom centre). */
export function bouquetSprite(g, C, v, sPx) {
  const res = level(sPx * g.scale, levelsFor(g, BQ_LEVELS));
  return sprite(g, `bq|${C.key}|${v}`, res, BQ_B, (x) => bouquetArt(x, C, v));
}

/**
 * Build every static sprite of the hall up front (walls, the throne and the bouquets at all their
 * levels), so a cut to a new framing never pays for a cache build mid-sequence. Cheap once warm.
 */
export function warmRoyal(g, C) {
  const k = `warm|${C.key}|${g.scale}`;
  if (cache.has(k)) return;
  backWall(g, C);
  backWallSoft(g, C);
  sideWall(g, C);
  for (const l of levelsFor(g, THRONE_LEVELS)) throneSprite(g, C, (l * 0.999) / g.scale);
  for (let v = 0; v < 4; v++) for (const l of levelsFor(g, BQ_LEVELS)) bouquetSprite(g, C, v, (l * 0.999) / g.scale);
  cornerTone(g, C.velvet, { alpha: 0 });
  chainStrip(g, C);
  cache.set(k, true);
}

/**
 * The bouquets around the throne: [X, Y, Z, variant, lean (rad), scale]. Standing ones lean on the
 * steps and the throne; a few lie on the dais.
 */
export const BOUQUETS = [
  // piled against the left armrest and behind it
  [-1.42, 1.1, 4.05, 0, -0.3, 1.25], [-1.85, 1.1, 4.5, 1, -0.55, 1.4], [-1.3, 1.1, 5.3, 2, 0.12, 1.2], [-2.35, 1.1, 5.4, 3, -0.2, 1.35],
  [-2.0, 1.1, 3.55, 2, -1.2, 1.15],
  // and the right
  [1.45, 1.1, 4.05, 3, 0.32, 1.25], [1.9, 1.1, 4.5, 0, 0.55, 1.4], [1.3, 1.1, 5.3, 1, -0.1, 1.2], [2.4, 1.1, 5.4, 2, 0.25, 1.35],
  [2.05, 1.1, 3.5, 1, 1.2, 1.15],
  // along the top step and down the sides of the steps
  [-2.9, 1.1, 2.6, 3, -0.4, 1.15], [2.95, 1.1, 2.55, 0, 0.42, 1.15], [-1.55, 1.1, 2.45, 0, -0.15, 1.0], [1.55, 1.1, 2.45, 2, 0.18, 1.0],
  [-3.25, 0.66, 1.35, 1, -0.3, 1.1], [3.3, 0.44, 0.95, 3, 0.35, 1.1],
  // at the foot of the steps
  [-2.3, 0, -0.45, 2, -0.25, 1.2], [2.35, 0, -0.5, 1, 0.3, 1.2], [-3.1, 0, -0.9, 0, -0.9, 1.1], [3.15, 0, -0.95, 3, 0.95, 1.1],
];

// --- candelabras ------------------------------------------------------------------------------------

/** Floor and dais candelabras: [X, Y (base), Z, arms]. */
export const CANDELABRA = [
  [-2.5, 0, -15, 3], [2.5, 0, -15, 3], [-2.5, 0, -9.5, 3], [2.5, 0, -9.5, 3], [-2.5, 0, -4.3, 3], [2.5, 0, -4.3, 3],
  [-4.4, 0, 0.6, 5], [4.4, 0, 0.6, 5], [-3.1, 1.1, 6.1, 5], [3.1, 1.1, 6.1, 5], [-1.95, 1.1, 3.55, 1], [1.95, 1.1, 3.5, 1],
];

/** Candle flame positions of a candelabra in metres relative to its base (x, y up). */
export function candleTips(arms, h = 1.85) {
  if (arms === 1) return [[0, 1.0]];
  const out = [[0, h + 0.18]];
  const side = (arms - 1) / 2;
  for (let k = 1; k <= side; k++) for (const s of [-1, 1]) out.push([s * 0.22 * k, h + 0.12 - 0.06 * k]);
  return out;
}

function drawCandelabraAt(ctx, C, p, arms, lit) {
  const s = p.s, x0 = p.x, y0 = p.y;
  const ink = C.ink;
  const h = arms === 1 ? 0.82 : 1.85;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const lw = Math.max(0.6, 0.018 * s);
  const gx = (a, b) => { const gr = ctx.createLinearGradient(x0 + a * s, 0, x0 + b * s, 0); gr.addColorStop(0, shade(C.goldDeep, 0.6)); gr.addColorStop(0.4, C.gold); gr.addColorStop(0.55, mixHex(C.gold, '#FFFFFF', 0.4)); gr.addColorStop(1, shade(C.goldDeep, 0.65)); return gr; };
  ctx.strokeStyle = ink; ctx.lineWidth = lw;
  // tripod foot and stem
  ctx.fillStyle = gx(-0.22, 0.22);
  ctx.beginPath(); ctx.moveTo(x0 - 0.24 * s, y0); ctx.quadraticCurveTo(x0, y0 - 0.32 * s, x0 + 0.24 * s, y0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = gx(-0.05, 0.05);
  ctx.beginPath(); ctx.rect(x0 - 0.035 * s, y0 - h * s, 0.07 * s, (h - 0.16) * s); ctx.fill(); ctx.stroke();
  for (const k of [0.32, 0.6, 0.86]) {                    // knops
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.ellipse(x0, y0 - h * k * s, 0.075 * s, 0.045 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
  }
  // arms
  const tips = candleTips(arms, h);
  ctx.strokeStyle = C.gold; ctx.lineWidth = Math.max(0.8, 0.035 * s);
  ctx.beginPath();
  for (const [tx, ty] of tips) {
    if (tx === 0) continue;
    ctx.moveTo(x0, y0 - (h - 0.1) * s);
    ctx.quadraticCurveTo(x0 + tx * s, y0 - (h - 0.16) * s, x0 + tx * s, y0 - (ty - 0.2) * s);
  }
  ctx.stroke();
  // drip pans and candles
  for (const [tx, ty] of tips) {
    const cx = x0 + tx * s, top = y0 - (ty - 0.04) * s, bot = y0 - (ty - 0.2) * s;
    ctx.fillStyle = C.gold; ctx.strokeStyle = ink; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.ellipse(cx, bot, 0.07 * s, 0.022 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
    const cg = ctx.createLinearGradient(cx - 0.03 * s, 0, cx + 0.03 * s, 0);
    cg.addColorStop(0, '#CFC6B4'); cg.addColorStop(0.5, '#FFF8EA'); cg.addColorStop(1, '#B7AE9C');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.rect(cx - 0.028 * s, top, 0.056 * s, bot - top); ctx.fill(); ctx.stroke();
    if (lit > 0) {                                        // warm light on the candle top
      ctx.fillStyle = rgba(C.candle, 0.6 * lit);
      ctx.beginPath(); ctx.rect(cx - 0.028 * s, top, 0.056 * s, 0.03 * s); ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * A candle flame at screen (x, y) with height hPx: flicker from noise of (t, seed), flare (0..1)
 * enlarges and brightens it. Drawn additively with a glow. lit (0..1) dims it out; smoke rises after.
 */
export function drawFlame(g, x, y, hPx, C, { t = 0, seed = 0, flare = 0, lit = 1, glow = 1 } = {}) {
  if (lit <= 0.002 || hPx < 0.4) return;
  const ctx = g.ctx;
  const fl = 0.86 + 0.14 * Math.sin(t * 17 + seed * 3.1) * Math.sin(t * 7.3 + seed) + 0.06 * Math.sin(t * 31 + seed * 5);
  const h = hPx * fl * (1 + 0.6 * flare) * (0.35 + 0.65 * lit);
  const w = h * 0.36;
  const sway = Math.sin(t * 5.1 + seed * 2.3) * w * 0.25;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gs = g.sprites.glow(C.candle, 0);
  const gr = h * (2.8 + 2.6 * flare) * glow;
  ctx.globalAlpha = Math.min(1, (0.3 + 0.5 * flare) * lit);
  ctx.drawImage(gs, x - gr, y - h * 0.45 - gr, 2 * gr, 2 * gr);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.min(1, lit);
  const body = (k, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.08 * k);
    ctx.bezierCurveTo(x - w * k, y - h * 0.15 * k, x - w * 0.35 * k + sway, y - h * 0.65 * k, x + sway * 1.4, y - h * (0.15 + 0.85 * k));
    ctx.bezierCurveTo(x + w * 0.35 * k + sway, y - h * 0.65 * k, x + w * k, y - h * 0.15 * k, x, y + h * 0.08 * k);
    ctx.fill();
  };
  body(1, mixHex(C.candle, '#FF6A1A', 0.45));
  body(0.72, C.candle);
  ctx.fillStyle = 'rgba(255,253,240,0.98)';
  ctx.beginPath(); ctx.ellipse(x + sway * 0.4, y - h * 0.2, w * 0.36, h * 0.2, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Thin smoke rising from a snuffed wick at (x, y), age seconds since it went out. */
export function drawSmoke(ctx, x, y, s, age, seed) {
  if (age < 0 || age > 2.4) return;
  const a = 0.35 * (1 - age / 2.4);
  ctx.save();
  ctx.strokeStyle = `rgba(200,210,235,${a.toFixed(3)})`;
  ctx.lineWidth = Math.max(0.6, 0.012 * s);
  ctx.beginPath();
  const len = (0.15 + 0.5 * age) * s;
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    const px = x + Math.sin(u * 7 + age * 3 + seed) * 0.05 * s * u * (1 + age);
    const py = y - u * len;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

// --- pillars ----------------------------------------------------------------------------------------

function drawPillarAt(ctx, cam, C, X, Z, light) {
  const top = project(cam, X, HALL.height - 1.2, Z), bot = project(cam, X, 0, Z);
  if (!top || !bot) return;
  const s = bot.s, r = 0.5 * s;
  if (bot.x + r * 1.4 < -10 || bot.x - r * 1.4 > 1930) return;
  const x0 = bot.x;
  const gr = ctx.createLinearGradient(x0 - r, 0, x0 + r, 0);
  const base = mixHex(C.wall, C.damask, 0.55);
  gr.addColorStop(0, shade(base, 0.45)); gr.addColorStop(0.35, mixHex(base, C.moon, 0.18 * light)); gr.addColorStop(0.6, base); gr.addColorStop(1, shade(base, 0.35));
  ctx.fillStyle = gr;
  ctx.fillRect(x0 - r, top.y, 2 * r, bot.y - top.y);
  ctx.strokeStyle = rgba(C.gold, 0.35); ctx.lineWidth = Math.max(0.5, 0.025 * s);
  ctx.beginPath();
  for (const k of [-0.55, -0.2, 0.2, 0.55]) { ctx.moveTo(x0 + k * r, top.y + 0.6 * s); ctx.lineTo(x0 + k * r, bot.y - 1.0 * s); }
  ctx.stroke();
  const gg = ctx.createLinearGradient(x0 - r * 1.3, 0, x0 + r * 1.3, 0);
  gg.addColorStop(0, shade(C.goldDeep, 0.5)); gg.addColorStop(0.4, C.gold); gg.addColorStop(0.55, mixHex(C.gold, '#FFFFFF', 0.3)); gg.addColorStop(1, shade(C.goldDeep, 0.5));
  ctx.fillStyle = gg;
  ctx.fillRect(x0 - r * 1.3, bot.y - 0.75 * s, r * 2.6, 0.75 * s);          // base
  ctx.fillRect(x0 - r * 1.18, bot.y - 0.95 * s, r * 2.36, 0.2 * s);
  ctx.fillRect(x0 - r * 1.35, top.y, r * 2.7, 0.55 * s);                    // capital
  ctx.fillRect(x0 - r * 1.15, top.y + 0.55 * s, r * 2.3, 0.18 * s);
  ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(0.5, 0.02 * s);
  ctx.strokeRect(x0 - r * 1.3, bot.y - 0.75 * s, r * 2.6, 0.75 * s);
  ctx.strokeRect(x0 - r * 1.35, top.y, r * 2.7, 0.55 * s);
}

// --- chains -----------------------------------------------------------------------------------------

/** Chains hanging from the ceiling: [X, Z, length (m)]. */
export const CHAINS = [
  [-4.6, 3.2, 7.2], [4.6, 3.4, 7.5], [-2.9, -2.4, 6.4], [3.0, -2.2, 6.0], [-5.6, -8.5, 7.8], [5.5, -8.8, 7.2],
  [-1.6, 7.8, 5.6], [1.7, 7.6, 5.4], [-3.6, -14, 6.8], [3.7, -14.5, 7.0],
  [-1.75, 4.05, 10.9], [1.75, 4.05, 10.7],                // two long chains framing the throne
];

// A long straight chain drawn once (drawChain, 96 links) into a strip bitmap; hanging chains and swags
// are blitted from it (one drawImage per straight run) instead of stroking every link every frame.
const STRIP_LINK = 26, STRIP_N = 96;
function chainStrip(g, C) {
  return cached(`chainstrip|${C.chain}|${C.chainDeep}|${g.scale}`, () => {
    const k = Math.max(0.5, g.scale);
    const len = STRIP_N * STRIP_LINK * 0.78;
    const c = g.createCanvas(Math.ceil(40 * k), Math.ceil(len * k));
    const x = c.getContext('2d');
    x.scale(k, k);
    drawChain(x, 20, 0, 20, len, { sag: 0, link: STRIP_LINK, width: 4.5, color: C.chain, deep: C.chainDeep });
    return { canvas: settle(g, c), len, k };
  });
}

/** A straight run of chain from (x0, y0) to (x1, y1) with links of `link` px (from the strip). */
function chainRun(ctx, strip, x0, y0, x1, y1, link, alpha = 1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 1 || link < 0.5) return;
  const sc = link / STRIP_LINK;                          // strip px -> screen px
  const need = L / sc;                                   // strip length needed (logical strip px)
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.translate(x0, y0);
  ctx.rotate(Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2);
  ctx.scale(sc, sc);
  let done = 0;
  while (done < need - 0.01) {
    const piece = Math.min(strip.len, need - done);
    ctx.drawImage(strip.canvas, 0, 0, strip.canvas.width, piece * strip.k, -20, done, 40, piece);
    done += piece;
  }
  ctx.restore();
}

/** Draw one hanging chain swinging by angle `swing` (radians, in the picture plane) with a gold ring at its end. */
function drawHangingChain(ctx, cam, C, X, Z, len, swing, k, strip) {
  const topY = HALL.height;
  const a = project(cam, X, topY, Z);
  const endX = X + Math.sin(swing) * len, endY = topY - Math.cos(swing) * len;
  const b = project(cam, endX, endY, Z);
  if (!a || !b) return;
  const s = b.s;
  if (Math.max(a.x, b.x) < -50 || Math.min(a.x, b.x) > 1970) return;
  chainRun(ctx, strip, a.x, a.y, b.x, b.y, Math.max(4, 0.16 * s));
  ctx.save();
  ctx.lineWidth = Math.max(1.2, 0.05 * s);
  ctx.strokeStyle = C.goldDeep;
  ctx.beginPath(); ctx.arc(b.x, b.y + 0.12 * s, 0.12 * s, 0, TAU); ctx.stroke();
  ctx.strokeStyle = C.gold; ctx.lineWidth = Math.max(0.8, 0.03 * s);
  ctx.beginPath(); ctx.arc(b.x, b.y + 0.12 * s, 0.12 * s, 0, TAU); ctx.stroke();
  ctx.restore();
}

/** Swag chains draped between the pillar tops along each colonnade (a sagging curve in five runs). */
function drawSwags(ctx, cam, C, swing, strip) {
  for (const sx of [-1, 1]) {
    const X = sx * (HALL.pillarX - 0.1);
    for (let i = 0; i + 1 < HALL.pillarZ.length; i++) {
      const z0 = HALL.pillarZ[i] + 0.3, z1 = HALL.pillarZ[i + 1] - 0.3;
      const a = project(cam, X, 10.2, z0), b = project(cam, X, 10.2, z1);
      if (!a || !b) continue;
      if (Math.max(a.x, b.x) < -40 || Math.min(a.x, b.x) > 1960) continue;
      const sag = 1.6 + 0.25 * Math.sin(swing * 3 + i);
      let prev = null;
      for (let k = 0; k <= 5; k++) {
        const u = k / 5;
        const p = project(cam, X, 10.2 - sag * 4 * u * (1 - u), z0 + (z1 - z0) * u);
        if (prev && p) chainRun(ctx, strip, prev.x, prev.y, p.x, p.y, Math.max(3, 0.18 * (prev.s + p.s) / 2), 0.85);
        prev = p;
      }
    }
  }
}

// --- Kaiser lounging --------------------------------------------------------------------------------

const designCache = new Map();
/** The design with no head: the head is drawn separately (turned to the camera, over the collar). */
function headless(d) {
  let h = designCache.get(d.id);
  if (!h) { h = design({ ...d, id: `${d.id}-royal-nohead`, head: 'none' }); designCache.set(d.id, h); }
  return h;
}

/**
 * The lounging pose (side view, facing right): seated with the torso reclined, the near leg crossed
 * over the far one, the near hand under the chin (armTo solves the arm to the chin, the elbow back on
 * the armrest). breathe (-1..1) moves the chest a little; tilt adds to the head tilt.
 */
export function loungePose(d, { breathe = 0, tilt = 0, lean = -0.2, cross = 1, handX = -0.004 } = {}) {
  const p = {
    ...poses.sit,
    lean: lean + 0.012 * breathe, head: 0.32 + tilt,
    hL: lerp(1.45, 1.36, cross), kL: lerp(1.45, 1.06, cross), hR: lerp(1.45, 1.95, cross), kR: lerp(1.45, 2.36, cross),
    sL: 0.55, eL: 0.75,
  };
  const j0 = solve(d, p, { x: 0, y: 0, scale: 1, view: 'side' });
  const U = j0.U, r = d.headR * U, ha = j0.headAng;
  const chin = [j0.headC[0] - 1.12 * r * Math.sin(ha), j0.headC[1] + 1.12 * r * Math.cos(ha)];
  const sh = j0.shoulderR;
  const a = armTo(d, (chin[0] - sh[0]) / U + handX, (chin[1] - sh[1]) / U + 0.034, p.lean, -1);
  return { ...p, sR: a.s, eR: a.e };
}

/** Head-local point (front view) to screen, for joints j of a design d. */
export function headPoint(d, j, lx, ly) {
  const r = d.headR * j.U, a = j.headAng, f = j.facing < 0 ? -1 : 1;
  const x = lx * r * f, y = ly * r;
  return [j.headC[0] + x * Math.cos(a) - y * Math.sin(a), j.headC[1] + x * Math.sin(a) + y * Math.cos(a)];
}

function drawHeadFront(ctx, d, j, ow, info) {
  const r = d.headR * j.U;
  for (const pass of ['outline', 'fill']) {
    ctx.save();
    ctx.translate(j.headC[0], j.headC[1]);
    ctx.rotate(j.headAng);
    if (j.facing < 0) ctx.scale(-1, 1);
    ctx.fillStyle = ctx.strokeStyle = pass === 'outline' ? d.outline : d.headFill;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    d.head(ctx, pass === 'outline' ? r + ow : r, { ...info, pass, design: d, joints: { ...j, view: 'front' } });
    ctx.restore();
  }
}

// The near arm redrawn over the collar and the chin: the sleeve, a cuff, and a loose fist (skin)
// under the chin with the knuckles towards the face.
function drawArmOver(ctx, d, j, lr, ow, cuff) {
  const U = j.U, aw = d.armW * U;
  const [sx, sy] = j[`shoulder${lr}`], [ex, ey] = j[`elbow${lr}`], [wx, wy] = j[`wrist${lr}`];
  const fa = Math.atan2(wy - ey, wx - ex);               // forearm direction (towards the wrist)
  const hx = wx + Math.cos(fa) * aw * 0.35, hy = wy + Math.sin(fa) * aw * 0.35;
  const hr = d.hand * U * 1.35;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of ['outline', 'fill']) {
    const o = pass === 'outline' ? ow : 0;
    ctx.strokeStyle = ctx.fillStyle = pass === 'outline' ? d.outline : (d.armFill || d.limbFill || d.fill);
    ctx.lineWidth = aw + 2 * o;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
    // the fist: a rounded box along the forearm, skin coloured
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(fa);
    ctx.fillStyle = pass === 'outline' ? d.outline : KZ.skin;
    ctx.beginPath();
    ctx.roundRect(-hr * 0.7 - o, -hr * 0.82 - o, hr * 1.75 + 2 * o, hr * 1.64 + 2 * o, hr * 0.62 + o);
    ctx.fill();
    if (pass === 'fill') {
      ctx.strokeStyle = d.outline;                        // curled fingers and the thumb
      ctx.lineWidth = Math.max(0.8, ow * 0.45);
      ctx.beginPath();
      for (const k of [-0.42, 0, 0.42]) { ctx.moveTo(hr * 0.5, k * hr); ctx.lineTo(hr * 0.95, k * hr * 0.9); }
      ctx.moveTo(-hr * 0.2, -hr * 0.78); ctx.quadraticCurveTo(hr * 0.35, -hr * 0.95, hr * 0.55, -hr * 0.55);
      ctx.stroke();
      ctx.fillStyle = cuff || KZ.gold;                    // the cuff
      ctx.fillRect(-hr * 1.0, -aw * 0.55, hr * 0.32, aw * 1.1);
    }
    ctx.restore();
  }
  ctx.restore();
  return [hx, hy];
}

/**
 * Kaiser lounging, in layers: the cape (behind), the body, the fur collar, the head turned to the
 * camera, and the near arm with the hand at the chin on top. (x, y) = pelvis on screen, U = px per
 * body height. Returns the joints (plus head-local helpers for eyes, rose and crown).
 */
export function drawLounger(ctx, d, pose, { x, y, U, t = 0, wind = -0.35, capeLength = 0.6, capeRot = 0.3, crown = 0, C = ROYAL, outlinePx = null, cuff = null } = {}) {
  const scale = U / d.height;
  const j = solve(d, pose, { x, y, scale, view: 'side' });
  const ow = outlinePx ?? Math.max(1, Math.min(7, d.outlineW * scale));
  // the cape falls behind him and drapes over the seat towards his back (a turn about the shoulders)
  const cx = (j.shoulderL[0] + j.shoulderR[0]) / 2, cy = (j.shoulderL[1] + j.shoulderR[1]) / 2;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(capeRot); ctx.translate(-cx, -cy);
  drawCape(ctx, j, { t, wind, length: capeLength });
  ctx.restore();
  drawPuppet(ctx, headless(d), pose, { x, y, scale, view: 'side', outlineW: ow / scale });
  drawCape(ctx, j, { t, wind, length: capeLength, collarOnly: true });
  drawHeadFront(ctx, d, j, ow, { t });
  j.hand = drawArmOver(ctx, d, j, 'R', ow, cuff);
  j.ow = ow;
  if (crown > 0) crownOn(ctx, d, j, C, { alpha: crown });
  return j;
}

/** The crown on his head (drawCrown), placed and tilted from the joints; returns its centre. */
export function crownOn(ctx, d, j, C = ROYAL, { alpha = 1, fill = null } = {}) {
  const [cx, cy] = headPoint(d, j, -0.16, -0.9);
  const w = d.headR * j.U * 1.7, a = j.headAng - 0.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  drawCrown(ctx, 0, 0, w, { fill: fill || C.gold, deep: C.goldDeep, ink: KZ.ink, jewel: C.rose, alpha, lineW: Math.max(1, (j.ow || 3) * 0.8) });
  ctx.restore();
  return [cx + Math.sin(a) * w * 0.3, cy - Math.cos(a) * w * 0.3, w];
}

/** Blink amount (0 open .. 1 shut) at t: a quick blink every few seconds, timed by hash (pure). */
export function blinkAt(t, seed = 1) {
  const period = 3.4;
  const k = Math.floor(t / period);
  const tb = k * period + 0.4 + 2.4 * hashU(seed, k, 1);   // this period's blink time
  const a = Math.abs(t - tb);
  return a < 0.05 ? 1 : a < 0.1 ? 0.5 : 0;
}

/** Eyelids over the front face (head-local, so they follow the head): amt 0.5 half shut, 1 shut. */
export function drawEyelids(ctx, d, j, amt) {
  if (amt <= 0) return;
  const r = d.headR * j.U;
  ctx.save();
  ctx.translate(j.headC[0], j.headC[1]);
  ctx.rotate(j.headAng);
  if (j.facing < 0) ctx.scale(-1, 1);
  for (const x of [-0.38 * r, 0.38 * r]) {
    ctx.fillStyle = KZ.skin;
    ctx.beginPath();
    if (amt >= 1) ctx.ellipse(x + 0.01 * r, 0.52 * r, 0.25 * r, 0.16 * r, 0, 0, TAU);
    else ctx.ellipse(x + 0.01 * r, 0.47 * r, 0.25 * r, 0.11 * r, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = KZ.ink; ctx.lineWidth = Math.max(1, 0.055 * r); ctx.lineCap = 'round';
    ctx.beginPath();
    const y = amt >= 1 ? 0.56 * r : 0.49 * r;
    ctx.moveTo(x - 0.22 * r, y - 0.03 * r);
    ctx.quadraticCurveTo(x, y + (amt >= 1 ? 0.07 : 0.02) * r, x + 0.24 * r, y - 0.05 * r);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Manga screentone in the frame corners (dots on a diagonal grid growing towards the corners), drawn
 * once into a cached bitmap per colour and device scale, then laid over the frame.
 */
export function cornerTone(g, color, { alpha = 1, cell = 20, angle = 0.6 } = {}) {
  const spr = cached(`tone|${color}|${cell}|${angle}|${g.scale}`, () => {
    const c = g.createCanvas(g.devW, g.devH);
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    x.fillStyle = color;
    const amount = (px, py) => Math.max(0, (px - 1250) / 700) * Math.max(0, (py - 260) / 900) * 1.6
      + Math.max(0, (380 - px) / 500) * Math.max(0, (420 - py) / 420) * 1.4;
    const cs = Math.cos(angle), sn = Math.sin(angle), R = 1150;
    for (let v = -R; v <= R; v += cell) {
      for (let u = -R; u <= R; u += cell) {
        const px = 960 + u * cs - v * sn, py = 540 + u * sn + v * cs;
        if (px < -cell || py < -cell || px > 1920 + cell || py > 1080 + cell) continue;
        const a = amount(px, py);
        if (a <= 0.06) continue;
        x.beginPath();
        x.arc(px, py, Math.min(1, a) * cell * 0.5, 0, TAU);
        x.fill();
      }
    }
    return settle(g, c);
  });
  if (alpha <= 0) return;
  const ctx = g.ctx, k = g.scale;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, alpha);
  for (const [x0, y0, x1, y1] of [[1230, 240, 1920, 1080], [0, 0, 400, 440]]) {   // only the toned corners
    const sx = Math.floor(x0 * k), sy = Math.floor(y0 * k), sw = Math.ceil((x1 - x0) * k), sh = Math.ceil((y1 - y0) * k);
    ctx.drawImage(spr, sx, sy, sw, sh, sx, sy, sw, sh);
  }
  ctx.restore();
}

/** The blue rose on his neck redrawn over everything (lit from within): amt 0..1 brightens it. */
export function roseOn(ctx, d, j, C, amt = 1) {
  if (amt <= 0) return;
  const r = d.headR * j.U;
  ctx.save();
  ctx.translate(j.headC[0], j.headC[1]);
  ctx.rotate(j.headAng);
  if (j.facing < 0) ctx.scale(-1, 1);
  ctx.globalAlpha *= Math.min(1, amt);
  drawRose(ctx, 0.4 * r, 1.42 * r, 0.24 * r, { rot: 0.4, color: mixHex(C.rose, C.roseHi, 0.55), deep: C.rose, hi: '#FFFFFF' });
  ctx.restore();
}

/** Screen positions of his eyes (front face) and the rose on his neck, from the joints. */
export function faceSpots(d, j) {
  return {
    eyes: [headPoint(d, j, -0.35, 0.52), headPoint(d, j, 0.41, 0.52)],
    rose: headPoint(d, j, 0.4, 1.42),
    crown: headPoint(d, j, -0.05, -1.55),
    r: d.headR * j.U,
  };
}

// --- particles --------------------------------------------------------------------------------------

/**
 * Rose petals drifting down, closed form in screen space with three depth layers (parallax px from
 * the camera's lateral position). count per layer; t seconds.
 */
export function drawPetals(ctx, C, { t, seed = 7, count = 26, parallax = 0, alpha = 1, speed = 1, wind = 0.5 } = {}) {
  if (alpha <= 0) return;
  ctx.save();
  for (let layer = 0; layer < 3; layer++) {
    const sz = [7, 12, 22][layer], sp = [55, 85, 140][layer] * speed, par = [0.25, 0.6, 1.4][layer];
    const n = Math.round(count * [1.2, 1, 0.45][layer]);
    for (let i = 0; i < n; i++) {
      const r1 = hashU(seed + layer * 31, i, 1), r2 = hashU(seed + layer * 31, i, 2), r3 = hashU(seed + layer * 31, i, 3);
      const period = (1300 + 300 * r2) / sp;
      const ph = ((t / period + r1) % 1 + 1) % 1;
      let px = r2 * 2300 - 190 + Math.sin(t * (0.6 + r3) + i) * 45 + wind * ph * 160 - parallax * par;
      px = ((px + 190) % 2300 + 2300) % 2300 - 190;
      const py = -60 + ph * 1200;
      const rot = t * (1.2 + 2 * r3) + r1 * TAU;
      const flip = Math.abs(Math.cos(t * (1.5 + r2 * 2) + i));
      const col = r3 < 0.72 ? (r1 < 0.5 ? C.rose : C.roseHi) : C.velvet;
      ctx.globalAlpha = alpha * (0.55 + 0.45 * layer / 2);
      ctx.fillStyle = col;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.scale(1, 0.35 + 0.65 * flip);
      ctx.beginPath();
      ctx.moveTo(0, -sz * 0.5);
      ctx.bezierCurveTo(sz * 0.55, -sz * 0.45, sz * 0.5, sz * 0.35, 0, sz * 0.5);
      ctx.bezierCurveTo(-sz * 0.5, sz * 0.35, -sz * 0.55, -sz * 0.45, 0, -sz * 0.5);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * Gold dust bursts: for each event time in `births` (e.g. snares) a spray of sparks from (x, y)
 * that falls and fades over `life` seconds. Additive glow sprites.
 */
export function drawGoldDust(g, C, { t, births, origin, seed = 3, n = 26, life = 1.1, spread = 420, strength = 1, r0 = 0, size = 1 }) {
  const ctx = g.ctx;
  const spr = g.sprites.glow(C.gold, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let b = 0; b < births.length; b++) {
    const [tb, sv] = births[b];
    const age = t - tb;
    if (age < 0 || age > life) continue;
    const [ox, oy] = origin(b, tb);
    const u = age / life;
    for (let i = 0; i < n; i++) {
      const r1 = hashU(seed, Math.round(tb * 1000) + i * 7, 1), r2 = hashU(seed, Math.round(tb * 1000) + i * 7, 2);
      const a = r1 * TAU, v = spread * (0.35 + 0.65 * r2) * (0.6 + 0.6 * sv);
      const dv = (1 - Math.exp(-3.2 * age)) / 3.2;
      const px = ox + Math.cos(a) * (r0 + v * dv);
      const py = oy + Math.sin(a) * (r0 + v * dv) * 0.75 + 260 * age * age;
      const tw = 0.6 + 0.4 * Math.sin(age * 30 + i);
      const rr = (3 + 5 * r2) * (1 - u * 0.6) * strength * size;
      ctx.globalAlpha = Math.min(1, (1 - u) * (1 - u) * tw * strength);
      ctx.drawImage(spr, px - rr * 2.4, py - rr * 2.4, rr * 4.8, rr * 4.8);
    }
  }
  ctx.restore();
}

/** Dust motes floating in a light shaft (screen-space box), closed form. */
export function drawMotes(g, C, { t, box, n = 40, seed = 11, alpha = 1, color = null }) {
  if (alpha <= 0) return;
  const ctx = g.ctx;
  const spr = g.sprites.glow(color || C.moon, 0);
  const [x0, y0, x1, y1] = box;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const r1 = hashU(seed, i, 1), r2 = hashU(seed, i, 2), r3 = hashU(seed, i, 3);
    const px = x0 + (x1 - x0) * (((r1 + 0.012 * t * (r3 - 0.5) + 0.03 * Math.sin(t * 0.3 + i)) % 1 + 1) % 1);
    const py = y0 + (y1 - y0) * (((r2 - 0.02 * t * (0.3 + r3)) % 1 + 1) % 1);
    const tw = 0.5 + 0.5 * Math.sin(t * (1 + 2 * r3) + i * 1.7);
    const rr = 2 + 4 * r3;
    ctx.globalAlpha = alpha * tw * 0.7;
    ctx.drawImage(spr, px - rr * 2, py - rr * 2, rr * 4, rr * 4);
  }
  ctx.restore();
}

/** A four-point star glint (anime sparkle) at (x, y), radius r. */
export function drawGlint(g, x, y, r, { color = '#FFFFFF', alpha = 1, rot = 0 } = {}) {
  if (alpha <= 0 || r <= 0.5) return;
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  const gs = g.sprites.glow(color, 1);
  ctx.drawImage(gs, x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU, rr = k % 2 ? r * 0.12 : r * (k % 4 ? 0.55 : 1);
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- light ------------------------------------------------------------------------------------------

/**
 * Moonlight shafts from the two tall windows and the rose window down into the hall, additive.
 * amt (0..1) scales them; spot (0..1) the rose-window beam onto the throne.
 */
export function drawShafts(g, cam, C, { amt = 1, spot = 1, t = 0 } = {}) {
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const B = HALL.backZ - 0.05;
  const breathe = 0.85 + 0.15 * Math.sin(t * 0.7);
  if (amt > 0) {
    for (const wx of HALL.windows) {
      const dir = wx < 0 ? 1 : -1;
      // the beam leaves the window (Y 2.2..9.4) and lands on the floor nearer the camera
      const P = [[wx - 1.1, 9.0, B], [wx + 1.1, 9.0, B], [wx + 1.4 + dir * 1.5, 0, B - 9.5], [wx - 1.4 + dir * 1.5, 0, B - 9.5]];
      const pp = projectPoly(cam, P);
      if (pp.length < 3) continue;
      const a = project(cam, wx, 9, B), b = project(cam, wx + dir * 1.5, 0, B - 9.5);
      if (!a || !b) continue;
      const gr = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gr.addColorStop(0, rgba(C.moon, 0.2 * amt * breathe));
      gr.addColorStop(0.6, rgba(C.moon, 0.08 * amt * breathe));
      gr.addColorStop(1, rgba(C.moon, 0));
      ctx.fillStyle = gr;
      polyPath(ctx, pp);
      ctx.fill();
    }
  }
  if (spot > 0) {                                        // the rose window itself glows with the spot
    const rw = project(cam, 0, 8.95, B);
    if (rw) {
      const rr = 1.9 * rw.s * (0.9 + 0.25 * Math.min(1.5, spot));
      ctx.globalAlpha = Math.min(1, 0.35 * spot);
      ctx.drawImage(g.sprites.glow(C.moon, 0), rw.x - rr, rw.y - rr, 2 * rr, 2 * rr);
      ctx.globalAlpha = 1;
    }
  }
  if (spot > 0) {
    const T = HALL.throne;
    const P = [[-1.0, 8.95, B], [1.0, 8.95, B], [1.9, HALL.dais.y, T.z - 1.6], [-2.3, HALL.dais.y, T.z - 1.6]];
    const pp = projectPoly(cam, P);
    const a = project(cam, 0, 8.95, B), b = project(cam, 0, HALL.dais.y, T.z - 1.6);
    if (pp.length > 2 && a && b) {
      const gr = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gr.addColorStop(0, rgba(C.spot, 0.3 * spot));
      gr.addColorStop(0.7, rgba(C.spot, 0.12 * spot));
      gr.addColorStop(1, rgba(C.spot, 0.03 * spot));
      ctx.fillStyle = gr;
      polyPath(ctx, pp);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * A spotlight cone from high above straight down onto (X, Z) on the dais: a soft volumetric trapezoid
 * (narrow at the top, rTop..rBot metres) and a pool where it lands. Additive, amt 0..1.
 */
export function drawSpotCone(g, cam, C, X, Z, { amt = 1, rTop = 0.35, rBot = 1.5, top = 12, color = null } = {}) {
  if (amt <= 0) return;
  const ctx = g.ctx;
  const col = color || C.spot;
  const Y0 = HALL.dais.y;
  const a = project(cam, X - rTop, top, Z), b = project(cam, X + rTop, top, Z);
  const c = project(cam, X + rBot, Y0, Z), d = project(cam, X - rBot, Y0, Z);
  if (!a || !b || !c || !d) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gr = ctx.createLinearGradient(0, a.y, 0, c.y);
  gr.addColorStop(0, rgba(col, 0.02 * amt));
  gr.addColorStop(0.35, rgba(col, 0.12 * amt));
  gr.addColorStop(1, rgba(col, 0.2 * amt));
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  ctx.fill();
  // a brighter core down the middle
  const a2 = project(cam, X - rTop * 0.4, top, Z), b2 = project(cam, X + rTop * 0.4, top, Z);
  const c2 = project(cam, X + rBot * 0.45, Y0, Z), d2 = project(cam, X - rBot * 0.45, Y0, Z);
  if (a2 && b2 && c2 && d2) {
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(d2.x, d2.y); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  drawPool(g, cam, X, Y0 + 0.01, Z, rBot * 1.1, col, 0.8 * amt);
}

/** A pool of light on a horizontal surface (Y) around (X, Z) of radius R metres, additive. */
export function drawPool(g, cam, X, Y, Z, R, color, amt = 1) {
  if (amt <= 0) return;
  const c = project(cam, X, Y, Z), l = project(cam, X - R, Y, Z), r = project(cam, X + R, Y, Z);
  const f = project(cam, X, Y, Z - R), b = project(cam, X, Y, Z + R);
  if (!c || !l || !r || !b) return;
  const rx = Math.max(1, (r.x - l.x) / 2), ry = Math.max(1, ((f ? f.y : c.y + (c.y - b.y)) - b.y) / 2);
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(c.x, (f ? (f.y + b.y) / 2 : c.y));
  ctx.scale(1, ry / rx);
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, rgba(color, 0.42 * amt));
  gr.addColorStop(0.45, rgba(color, 0.16 * amt));
  gr.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx);
  ctx.restore();
}

/** Darken the frame away from (x, y): a soft focus vignette that keeps the eye on the subject. */
export function focusLight(g, x, y, r, amt = 0.5, color = '#01020C') {
  if (amt <= 0) return;
  const ctx = g.ctx;
  const gr = ctx.createRadialGradient(x, y, r * 0.25, x, y, r * 1.6);
  gr.addColorStop(0, rgba(color, 0));
  gr.addColorStop(0.55, rgba(color, 0.35 * amt));
  gr.addColorStop(1, rgba(color, 0.85 * amt));
  ctx.fillStyle = gr;
  ctx.fillRect(-60, -60, 2040, 1200);
}

/**
 * Kaiser with a rim light: the figure is drawn into a layer, a silhouette of it in the rim colour is
 * laid down first, offset towards the light (K.rimDir, logical px), and the figure goes on top, so a
 * thin crescent of light outlines the side facing the moon. Works in the device-pixel bounding box.
 */
function drawRimmed(g, ctx, K, lo) {
  const L = g.layer('kzroyal-figure');
  const m = ctx.getTransform();
  L.ctx.setTransform(m);
  const j = drawLounger(L.ctx, K.design, K.pose, lo);
  // the figure's box in device pixels (joints and cape reach, through the current transform)
  const U = lo.U;
  const xs = [j.headC[0] - 0.75 * U, j.headC[0] + 0.45 * U, j.toeL[0] + 0.1 * U, j.toeR[0] + 0.1 * U, j.pelvis[0] - 0.75 * U];
  const ys = [j.headC[1] - 0.3 * U, j.feetY + 0.1 * U, j.pelvis[1] + 0.55 * U];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const X of [Math.min(...xs), Math.max(...xs)]) for (const Y of [Math.min(...ys), Math.max(...ys)]) {
    const dx = m.a * X + m.c * Y + m.e, dy = m.b * X + m.d * Y + m.f;
    x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
  }
  const pad = 12 * g.scale;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(g.devW, Math.ceil(x1 + pad)); y1 = Math.min(g.devH, Math.ceil(y1 + pad));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return j;
  // the rim is the figure's own shadow, cast in the light colour towards the light
  const [ox, oy] = (K.rimDir || [-4, -3]).map((v) => v * g.scale * Math.max(0.6, Math.min(2.2, U / 700)));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = rgba(K.rimColor || '#CFE2FF', Math.min(1, K.rim));
  ctx.shadowOffsetX = ox;
  ctx.shadowOffsetY = oy;
  ctx.shadowBlur = 0;
  ctx.drawImage(L.canvas, x0, y0, w, h, x0, y0, w, h);
  ctx.restore();
  return j;
}

/**
 * The close-up veil: the hall and throne behind him sink into a dark velvet haze with out-of-focus
 * candle lights (bokeh) drifting across, brighter on kicks. (cx, cy) centres the haze on his face.
 */
export function veil(g, C, { t = 0, kick = 0, cx = 1000, cy = 450, amt = 1, seed = 77, n = 18 } = {}) {
  if (amt <= 0) return;
  const { ctx } = g;
  const gr = ctx.createRadialGradient(cx, cy, 120, cx, cy + 80, 1250);
  gr.addColorStop(0, rgba(C.velvetDeep, 0.55 * amt));
  gr.addColorStop(0.6, rgba('#12051A', 0.78 * amt));
  gr.addColorStop(1, rgba('#03030E', 0.92 * amt));
  ctx.fillStyle = gr;
  ctx.fillRect(-60, -60, 2040, 1200);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const r1 = hashU(seed, i, 1), r2 = hashU(seed, i, 2), r3 = hashU(seed, i, 3);
    const x = ((r1 * 2200 + t * (14 + 22 * r3)) % 2200) - 140;
    const y = 80 + r2 * 920 + Math.sin(t * 0.4 + i) * 30;
    const rr = 30 + 70 * r3;
    const col = r2 < 0.65 ? C.candle : C.rose;
    ctx.globalAlpha = amt * (0.16 + 0.12 * kick) * (0.6 + 0.4 * Math.sin(t * 1.3 + i * 2.1));
    ctx.drawImage(g.sprites.bokeh(col, 0.14, 0.3), x - rr, y - rr, 2 * rr, 2 * rr);
  }
  ctx.restore();
}

// --- the set: every billboard, sorted by depth ------------------------------------------------------

/**
 * Draw everything that stands in the hall, far to near: pillars, chains, candelabras (+ flames),
 * bouquets, the throne, Kaiser, the ball. opts:
 *   t, kick (0..1 flare and pulse), swing (chain angle, rad), lit(i) (0..1 per candelabra index),
 *   kaiser: {design, pose, crown, wind, cape} or null, onKaiser(j, p) callback (glows, etc.),
 *   ballRot, bouquetPulse (0..1 => +6% scale), turn (fake throne turn for orbits), skip (Set of kinds).
 */
export function drawSet(g, cam, C, o = {}) {
  const ctx = g.ctx;
  const t = o.t || 0;
  const items = [];
  const skip = o.skip || new Set();
  const dep = (X, Z) => depthOf(cam, X, Z);
  if (!skip.has('pillars')) {
    for (const sx of [-1, 1]) for (const Z of HALL.pillarZ) items.push({ d: dep(sx * HALL.pillarX, Z), k: 'pillar', X: sx * HALL.pillarX, Z });
  }
  if (!skip.has('chains')) CHAINS.forEach((c, i) => items.push({ d: dep(c[0], c[1]), k: 'chain', c, i }));
  CANDELABRA.forEach((c, i) => items.push({ d: dep(c[0], c[2]), k: 'cand', c, i }));
  BOUQUETS.forEach((b, i) => items.push({ d: dep(b[0], b[2]) - 0.01, k: 'bq', b, i }));
  items.push({ d: dep(HALL.throne.x, HALL.throne.z), k: 'throne' });
  if (o.kaiser) items.push({ d: dep(HALL.pelvis[0], HALL.pelvis[2]), k: 'kaiser' });
  if (!skip.has('ball')) items.push({ d: dep(HALL.ball[0], HALL.ball[2]), k: 'ball' });
  items.sort((a, b) => b.d - a.d);
  const flames = [];
  let kj = null;
  for (const it of items) {
    if (it.d < 0.15) continue;
    if (it.k === 'pillar') {
      drawPillarAt(ctx, cam, C, it.X, it.Z, o.moon ?? 1);
    } else if (it.k === 'chain') {
      const [X, Z, len] = it.c;
      const k = Math.min(1, 6.5 / len);                   // long chains swing through smaller angles
      const sw = k * ((o.swing || 0) * (0.7 + 0.6 * hashU(5, it.i, 1)) * (it.i % 2 ? 1 : -1) + 0.03 * Math.sin(t * 0.9 + it.i));
      drawHangingChain(ctx, cam, C, X, Z, len, sw, it.i, chainStrip(g, C));
    } else if (it.k === 'cand') {
      const [X, Y, Z, arms] = it.c;
      const p = project(cam, X, Y, Z);
      if (!p || p.x < -0.6 * p.s || p.x > 1920 + 0.6 * p.s) continue;
      const lit = o.lit ? o.lit(it.i) : 1;
      drawCandelabraAt(ctx, C, p, arms, lit);
      const h = arms === 1 ? 0.82 : 1.85;
      for (const [tx, ty] of candleTips(arms, h)) {
        flames.push({ x: p.x + tx * p.s, y: p.y - ty * p.s + 0.04 * p.s, s: p.s, seed: it.i * 7 + tx * 13, lit, i: it.i, by: Y === 0 ? p.y : null });
      }
    } else if (it.k === 'bq') {
      const [X, Y, Z, v, lean, sc] = it.b;
      if (o.nearClip && it.d < o.nearClip) continue;
      const p = project(cam, X, Y, Z);
      if (!p || p.x < -0.8 * p.s || p.x > 1920 + 0.8 * p.s) continue;
      const pulse = 1 + 0.06 * (o.bouquetPulse || 0) * (0.7 + 0.3 * hashU(9, it.i, 1));
      const spr = bouquetSprite(g, C, v, p.s * sc * pulse);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(lean);
      const s = p.s * sc * pulse;
      const [x0, y0, x1, y1] = spr.bounds;
      ctx.drawImage(spr.canvas, x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s);
      ctx.restore();
    } else if (it.k === 'throne') {
      drawThrone(g, cam, C, { turn: o.turn || 0 });
      if (o.onThrone) o.onThrone();
    } else if (it.k === 'kaiser') {
      const K = o.kaiser;
      const p = project(cam, HALL.pelvis[0], HALL.pelvis[1], HALL.pelvis[2]);
      if (!p) continue;
      const U = KAISER_H * p.s;
      if (K.halo > 0) {                                   // backlight: a soft halo on the throne behind him
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, K.halo);
        const gs = g.sprites.glow(K.haloColor || C.spot, 0), hr = 0.95 * U;
        ctx.drawImage(gs, p.x - hr * 0.95, p.y - 0.42 * U - hr, 2 * hr, 2 * hr);
        ctx.restore();
      }
      if (K.before) K.before(p, U);
      const lo = { x: p.x, y: p.y, U, t, wind: K.wind ?? -0.35, capeLength: K.cape ?? 0.6, capeRot: K.capeRot ?? 0.3, crown: K.crown || 0, C, outlinePx: K.outlinePx, cuff: K.cuff };
      kj = K.rim > 0 && g.layer ? drawRimmed(g, ctx, K, lo) : drawLounger(ctx, K.design, K.pose, lo);
      if (K.after) K.after(kj, p, U);
    } else if (it.k === 'ball') {
      const [X, Y, Z] = HALL.ball;
      const p = project(cam, X, Y, Z);
      if (!p) continue;
      const r = 0.11 * p.s;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.95, r * 1.05, r * 0.22, 0, 0, TAU); ctx.fill();
      ctx.restore();
      drawBall(ctx, p.x, p.y, r, { rot: o.ballRot || 0 });
    }
  }
  if (!skip.has('chains')) drawSwags(ctx, cam, C, o.swing || 0, chainStrip(g, C));
  // flames last (over their candelabras); a scene that darkens the frame draws them afterwards
  if (!o.deferFlames) drawFlames(g, C, flames, o);
  return { kj, flames };
}

/** The candle flames collected by drawSet (o: t, kick or flare(i), flameGlow). */
export function drawFlames(g, C, flames, o = {}) {
  const t = o.t || 0;
  // reflections in the polished floor under the floor-standing candelabras
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const streak = g.sprites.glow(C.candle, 0);
  for (const f of flames) {
    if (f.by === null || f.by === undefined || f.lit <= 0.01) continue;
    const d = f.by - f.y;                                 // flame height above the floor on screen
    if (d < 4) continue;
    const w = 0.09 * f.s, len = d * 0.7;
    const fl = o.flare ? o.flare(f.i) : (o.kick || 0);
    ctx.globalAlpha = Math.min(1, (0.16 + 0.18 * fl) * f.lit);
    ctx.drawImage(streak, f.x - w, f.by + d * 0.15, 2 * w, len);
  }
  ctx.restore();
  for (const f of flames) {
    drawFlame(g, f.x, f.y, 0.11 * f.s, C, { t, seed: f.seed, flare: o.flare ? o.flare(f.i) : (o.kick || 0), lit: f.lit, glow: o.flameGlow ?? 1 });
  }
}

