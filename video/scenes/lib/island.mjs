// Kite Island: the shared drawings of "Kite Season". The opening (dusk), the splash-down (milksea)
// and the twist at the end (lastkite) all draw exactly the same island, house and kite from here.
//
//   import { drawIsland, drawKite, drawString } from './lib/island.mjs';
//   const isl = drawIsland(g, ctx, { x: 960, y: 700, scale: 1, rot: 0, t, palette: S.palette });
//   // isl.toScreen(lx, ly) maps island-local points; isl.window = [x, y, r] in screen px
//   drawKite(g, ctx, { x, y, size: 60, ang, color: '#FFC83D', tail: kiteTail(posAt, t) });
//   drawString(g, ctx, hx, hy, kx, ky, { color: '#FFE9B0', glow: 1 });
//
// Island-local coordinates: origin at the centre of the grassy top, +y down, 1 unit = 1 px at scale 1.
// The top is an ellipse 540 x 60; the rock hangs ~300 below it; the house stands on the back-left.
// Everything here is pure: the static island is a cached sprite (per palette and device resolution),
// the living parts (window light, smoke, roots, ladder, grass) are closed-form functions of t.

import { INK } from './cast.mjs';
import { lattice, fbm, hashU } from './worldkit.mjs';

const TAU = Math.PI * 2;

/** Fallback colours (the dusk palette). Any palette key overrides these. */
export const ISLAND_DEFAULT = {
  island: '#3B2350', islandTop: '#5B3A7A', grass: '#8A5FB0', house: '#F3D9E8', roof: '#9C3F6E',
  window: '#FFD27A', string: '#FFE9B0', rim: '#F6B6C9', bounce: '#E77FA3', smoke: '#EBDDF2',
};

const TOP_RX = 270, TOP_RY = 30, DEPTH = 300;
const HX = -172, HY = -20;                     // house: centre of the wall base
const WIN = { x: HX - 30, y: HY - 70, r: 30 };  // the round window
const DOOR = { x0: HX + 22, x1: HX + 58, y0: HY - 66, y1: HY };

/** Island geometry (local px at scale 1). slots: where the kids stand along the front of the top. */
export const ISLAND = {
  topRX: TOP_RX, topRY: TOP_RY, depth: DEPTH, ground: 10,
  house: { x: HX, y: HY, w: 160, h: 125 },
  window: { ...WIN },
  door: { ...DOOR },
  chimney: { x: HX + 59, y: HY - 276 },
  slots: [-70, -6, 58, 122, 186, 248],
  bounds: { x0: -320, y0: -330, x1: 320, y1: 370 },
};

const frontY = (x) => TOP_RY * Math.sqrt(Math.max(0, 1 - (x / TOP_RX) ** 2));

let CONTOUR = null;
/** Bottom contour of the rock, left to right: [[x, y], ...] (local). */
function contour() {
  if (CONTOUR) return CONTOUR;
  const L = lattice(4242);
  const pts = [];
  const N = 120, tipX = 14;
  const spikes = [[-150, 34, 26], [-62, 46, 30], [58, 40, 24], [128, 30, 22], [196, 22, 18]];
  for (let i = 0; i <= N; i++) {
    const x = -TOP_RX + (2 * TOP_RX * i) / N;
    const a = Math.min(1, Math.abs(x - tipX) / (x > tipX ? TOP_RX - tipX : TOP_RX + tipX));
    let y = DEPTH * Math.pow(Math.max(0, 1 - Math.pow(a, 1.45)), 1.75);
    y += (fbm(L, x / 34, 2.3, 3) - 0.5) * 2 * 20 * Math.pow(Math.sin(Math.PI * Math.min(1, a * 1.05 + 0.02)), 0.6);
    for (const [sx, d, w] of spikes) y += d * Math.max(0, 1 - Math.abs(x - sx) / w) ** 1.6;
    y = Math.max(y, frontY(x) + 6 * Math.sin(Math.PI * (1 - a)) + 2);
    pts.push([x, y]);
  }
  pts[0][1] = 0; pts[N][1] = 0;
  CONTOUR = pts;
  return pts;
}

/** Local y of the rock's underside at local x. */
export function undersideY(x) {
  const pts = contour();
  const f = ((x + TOP_RX) / (2 * TOP_RX)) * (pts.length - 1);
  const i = Math.max(0, Math.min(pts.length - 2, Math.floor(f)));
  const u = Math.max(0, Math.min(1, f - i));
  return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u;
}

// --- palette ------------------------------------------------------------------------------------

const palCache = new Map();
/** Resolve a palette (plus an optional night/haze tint {color, amount}) into every colour drawn. */
export function islandColors(g, palette = {}, tint = null) {
  const base = {};
  for (const k of Object.keys(ISLAND_DEFAULT)) base[k] = palette[k] || ISLAND_DEFAULT[k];
  const key = JSON.stringify([base, tint ? [tint.color, Math.round(tint.amount * 100)] : 0]);
  let C = palCache.get(key);
  if (C) return C;
  const mix = g.color.mix;
  const b = { ...base };
  if (tint && tint.amount > 0) {
    for (const k of Object.keys(b)) if (k !== 'window' && k !== 'string') b[k] = mix(b[k], tint.color, tint.amount);
  }
  C = {
    ...b, key,
    dark: mix(b.island, '#0B0614', 0.5),
    soil: mix(b.island, '#1A0C1E', 0.35),
    grassDark: mix(b.grass, b.island, 0.5),
    grassLight: mix(b.grass, b.rim, 0.35),
    grassTip: mix(b.grass, b.rim, 0.6),
    roofDark: mix(b.roof, b.island, 0.45),
    roofLight: mix(b.roof, b.rim, 0.35),
    houseShade: mix(b.house, b.island, 0.32),
    houseLight: mix(b.house, '#FFFFFF', 0.35),
    windowHot: mix(b.window, '#FFFFFF', 0.55),
    windowDeep: mix(b.window, '#E0703A', 0.45),
    root: mix(b.island, '#0B0614', 0.25),
    rope: mix(b.house, b.island, 0.55),
    ink: tint && tint.amount > 0 ? mix(INK, tint.color, tint.amount * 0.5) : INK,
  };
  if (palCache.size > 40) palCache.delete(palCache.keys().next().value);
  palCache.set(key, C);
  return C;
}

// --- the static island sprite -------------------------------------------------------------------

function bodyPath(x) {
  const pts = contour();
  x.beginPath();
  x.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) x.lineTo(p[0], p[1]);
  for (let i = 0; i <= 48; i++) { const xx = TOP_RX - (2 * TOP_RX * i) / 48; x.lineTo(xx, -frontY(xx)); }
  x.closePath();
}

function paintBody(x, C) {
  const L = lattice(77);
  bodyPath(x);
  const gr = x.createLinearGradient(0, -10, 0, DEPTH + 30);
  gr.addColorStop(0, C.islandTop);
  gr.addColorStop(0.32, C.island);
  gr.addColorStop(1, C.dark);
  x.fillStyle = gr;
  x.fill();
  x.save();
  bodyPath(x);
  x.clip();
  // painted strata: soft wavy bands, lighter and darker
  for (let k = 0; k < 9; k++) {
    const y0 = 34 + k * 30;
    x.beginPath();
    for (let xx = -TOP_RX; xx <= TOP_RX; xx += 10) {
      const y = y0 + 9 * Math.sin(xx / 47 + k * 1.7) + 14 * (fbm(L, xx / 90, k * 3.1, 2) - 0.5) + 0.0006 * xx * xx * (k % 3 - 1);
      if (xx === -TOP_RX) x.moveTo(xx, y); else x.lineTo(xx, y);
    }
    x.strokeStyle = k % 2 ? C.islandTop : C.dark;
    x.globalAlpha = k % 2 ? 0.28 : 0.32;
    x.lineWidth = 6 + (k % 3) * 5;
    x.stroke();
  }
  x.globalAlpha = 1;
  // soil band under the grass lip
  x.beginPath();
  for (let xx = -TOP_RX; xx <= TOP_RX; xx += 8) { const y = frontY(xx) + 10; if (xx === -TOP_RX) x.moveTo(xx, y); else x.lineTo(xx, y); }
  x.strokeStyle = C.soil;
  x.lineWidth = 26;
  x.globalAlpha = 0.85;
  x.stroke();
  x.globalAlpha = 1;
  // pebbles and speckles
  for (let i = 0; i < 160; i++) {
    const px = -TOP_RX + hashU(11, i, 1) * 2 * TOP_RX;
    const py = frontY(px) + 18 + hashU(11, i, 2) * (undersideY(px) - frontY(px) - 10);
    const r = 1.2 + hashU(11, i, 3) * (i % 7 === 0 ? 7 : 2.6);
    x.fillStyle = hashU(11, i, 4) < 0.55 ? C.islandTop : C.dark;
    x.globalAlpha = 0.35 + 0.4 * hashU(11, i, 5);
    x.beginPath(); x.ellipse(px, py, r * 1.3, r, 0, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
  // cracks
  x.strokeStyle = C.dark;
  x.lineWidth = 2;
  x.globalAlpha = 0.55;
  for (let i = 0; i < 7; i++) {
    let px = -200 + i * 66 + hashU(12, i, 1) * 30, py = frontY(px) + 30 + hashU(12, i, 2) * 60;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 4; s++) { px += (hashU(12, i, 10 + s) - 0.5) * 22; py += 14 + hashU(12, i, 20 + s) * 18; x.lineTo(px, py); }
    x.stroke();
  }
  x.globalAlpha = 1;
  // moonlit rim on the right, warm bounce light from below-left
  const rim = x.createLinearGradient(-TOP_RX, 0, TOP_RX, 0);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.55, 'rgba(0,0,0,0)');
  rim.addColorStop(1, C.rim);
  bodyPath(x);
  x.strokeStyle = rim;
  x.lineWidth = 16;
  x.globalAlpha = 0.5;
  x.stroke();
  x.globalAlpha = 1;
  const bnc = x.createRadialGradient(-70, DEPTH * 0.95, 10, -70, DEPTH * 0.95, 260);
  bnc.addColorStop(0, C.bounce);
  bnc.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = bnc;
  x.globalAlpha = 0.32;
  x.fillRect(-TOP_RX, 0, 2 * TOP_RX, DEPTH + 60);
  x.globalAlpha = 1;
  x.restore();
  // a thin ink edge for the storybook look
  bodyPath(x);
  x.strokeStyle = C.ink;
  x.globalAlpha = 0.6;
  x.lineWidth = 2.5;
  x.stroke();
  x.globalAlpha = 1;
}

function paintTop(x, C) {
  // grass lip drooping over the rock edge
  x.fillStyle = C.grassDark;
  for (let xx = -TOP_RX + 6; xx <= TOP_RX - 6; xx += 15) {
    const r = 8 + 5 * hashU(21, Math.round(xx), 1);
    x.beginPath(); x.arc(xx, frontY(xx) + 3 + r * 0.35, r, 0, TAU); x.fill();
  }
  // the grassy top, moonlit from the back right
  x.beginPath();
  x.ellipse(0, 0, TOP_RX, TOP_RY, 0, 0, TAU);
  const gr = x.createRadialGradient(90, -26, 10, 40, -10, 330);
  gr.addColorStop(0, C.grassLight);
  gr.addColorStop(0.55, C.grass);
  gr.addColorStop(1, C.grassDark);
  x.fillStyle = gr;
  x.fill();
  x.strokeStyle = C.ink;
  x.globalAlpha = 0.45;
  x.lineWidth = 2;
  x.stroke();
  x.globalAlpha = 1;
  // a mound under the house and a little path from the door
  x.beginPath(); x.ellipse(HX, HY + 4, 118, 20, 0, 0, TAU);
  x.fillStyle = C.grassLight; x.globalAlpha = 0.5; x.fill(); x.globalAlpha = 1;
  x.fillStyle = C.house;
  for (let i = 0; i < 5; i++) {
    const px = DOOR.x0 + 18 + i * 9, py = HY + 6 + i * 5;
    x.globalAlpha = 0.35;
    x.beginPath(); x.ellipse(px, py, 7 - i * 0.6, 3, 0, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
  // painted grass strokes and tiny flowers
  for (let i = 0; i < 70; i++) {
    const a = hashU(23, i, 1) * TAU, rr = Math.sqrt(hashU(23, i, 2)) * 0.92;
    const px = Math.cos(a) * rr * TOP_RX, py = Math.sin(a) * rr * TOP_RY;
    x.strokeStyle = hashU(23, i, 3) < 0.5 ? C.grassLight : C.grassDark;
    x.globalAlpha = 0.5;
    x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + 2, py - 5); x.stroke();
  }
  const flowerCols = [C.window, C.rim, C.houseLight, C.bounce];
  for (let i = 0; i < 46; i++) {
    const a = hashU(24, i, 1) * TAU, rr = 0.25 + Math.sqrt(hashU(24, i, 2)) * 0.68;
    const px = Math.cos(a) * rr * TOP_RX, py = Math.sin(a) * rr * TOP_RY;
    if (px > HX - 95 && px < HX + 95 && py < 4) continue;   // not under the house
    x.globalAlpha = 0.9;
    x.fillStyle = flowerCols[i % 4];
    x.beginPath(); x.arc(px, py, 1.8 + hashU(24, i, 3) * 1.6, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
}

function paintHouse(x, C) {
  const wl = HX - 80, wr = HX + 80, wt = HY - 125;
  // soft contact shadow
  x.beginPath(); x.ellipse(HX + 8, HY + 2, 100, 10, 0, 0, TAU);
  x.fillStyle = C.dark; x.globalAlpha = 0.35; x.fill(); x.globalAlpha = 1;
  // a spare kite leaning on the wall
  x.save();
  x.translate(wl - 6, HY - 36); x.rotate(-0.32);
  kitePath(x, 0.62);
  x.fillStyle = C.rim; x.fill();
  x.strokeStyle = C.ink; x.lineWidth = 2; x.stroke();
  x.restore();
  // crooked chimney (behind the roof)
  x.save();
  x.translate(HX + 46, HY - 175); x.rotate(0.13);
  x.beginPath(); x.rect(-13, -92, 26, 100);
  x.fillStyle = C.roofDark; x.fill();
  x.strokeStyle = C.ink; x.lineWidth = 3; x.stroke();
  x.beginPath(); x.rect(-17, -100, 34, 12);
  x.fillStyle = C.roof; x.fill(); x.stroke();
  x.fillStyle = C.roofLight; x.globalAlpha = 0.5;
  x.fillRect(4, -86, 7, 90);
  x.globalAlpha = 1;
  x.restore();
  // walls
  x.beginPath();
  x.moveTo(wl, HY); x.lineTo(wl + 5, wt); x.lineTo(wr - 3, wt - 3); x.lineTo(wr, HY); x.closePath();
  const wg = x.createLinearGradient(wl, 0, wr, 0);
  wg.addColorStop(0, C.houseShade);
  wg.addColorStop(0.45, C.house);
  wg.addColorStop(1, C.houseLight);
  x.fillStyle = wg;
  x.fill();
  x.save();
  x.clip();
  x.strokeStyle = C.houseShade;
  x.globalAlpha = 0.35;
  x.lineWidth = 1.5;
  for (let y = HY - 12; y > wt; y -= 15) { x.beginPath(); x.moveTo(wl, y + 1); x.lineTo(wr, y - 1); x.stroke(); }
  x.globalAlpha = 1;
  // warm wash below the window
  const wash = x.createRadialGradient(WIN.x, WIN.y + 10, 5, WIN.x, WIN.y + 10, 90);
  wash.addColorStop(0, C.window); wash.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = wash; x.globalAlpha = 0.25; x.fillRect(wl, wt, 160, 125); x.globalAlpha = 1;
  x.restore();
  x.beginPath();
  x.moveTo(wl, HY); x.lineTo(wl + 5, wt); x.lineTo(wr - 3, wt - 3); x.lineTo(wr, HY); x.closePath();
  x.strokeStyle = C.ink; x.lineWidth = 3; x.stroke();
  // roof: pointed, slightly bulging sides, scalloped shingles
  const roof = () => {
    x.beginPath();
    x.moveTo(HX - 102, HY - 116);
    x.quadraticCurveTo(HX - 62, HY - 186, HX - 6, HY - 252);
    x.quadraticCurveTo(HX + 52, HY - 184, HX + 100, HY - 121);
    x.quadraticCurveTo(HX, HY - 108, HX - 102, HY - 116);
    x.closePath();
  };
  roof();
  const rg = x.createLinearGradient(HX - 100, 0, HX + 100, 0);
  rg.addColorStop(0, C.roofDark);
  rg.addColorStop(0.5, C.roof);
  rg.addColorStop(1, C.roofLight);
  x.fillStyle = rg;
  x.fill();
  x.save();
  roof();
  x.clip();
  x.strokeStyle = C.roofDark;
  x.lineWidth = 2;
  x.globalAlpha = 0.7;
  for (let row = 0; row < 8; row++) {
    const y = HY - 124 - row * 16;
    for (let xx = HX - 110 + (row % 2) * 9; xx < HX + 110; xx += 18) { x.beginPath(); x.arc(xx, y, 9, 0, Math.PI); x.stroke(); }
  }
  x.globalAlpha = 1;
  x.restore();
  roof();
  x.strokeStyle = C.ink; x.lineWidth = 3; x.stroke();
  // eave shadow on the wall
  x.fillStyle = C.dark; x.globalAlpha = 0.25;
  x.fillRect(wl + 5, wt + 2, 152, 8);
  x.globalAlpha = 1;
  // door: arched, planked, a warm knob
  x.beginPath();
  x.moveTo(DOOR.x0, DOOR.y1);
  x.lineTo(DOOR.x0, DOOR.y0 + 18);
  x.arc((DOOR.x0 + DOOR.x1) / 2, DOOR.y0 + 18, (DOOR.x1 - DOOR.x0) / 2, Math.PI, 0);
  x.lineTo(DOOR.x1, DOOR.y1);
  x.closePath();
  x.fillStyle = C.roofDark; x.fill();
  x.strokeStyle = C.ink; x.lineWidth = 3; x.stroke();
  x.strokeStyle = C.dark; x.lineWidth = 1.5; x.globalAlpha = 0.6;
  for (let xx = DOOR.x0 + 9; xx < DOOR.x1; xx += 9) { x.beginPath(); x.moveTo(xx, DOOR.y0 + 6); x.lineTo(xx, DOOR.y1); x.stroke(); }
  x.globalAlpha = 1;
  x.fillStyle = C.window; x.beginPath(); x.arc(DOOR.x1 - 7, DOOR.y0 + 38, 2.8, 0, TAU); x.fill();
  // window sill and flower box
  x.fillStyle = C.roofDark;
  x.beginPath(); x.roundRect(WIN.x - 34, WIN.y + WIN.r + 4, 68, 9, 3); x.fill();
  x.strokeStyle = C.ink; x.lineWidth = 2; x.stroke();
  const fl = [C.bounce, C.window, C.rim, C.houseLight, C.bounce, C.window];
  for (let i = 0; i < 6; i++) { x.fillStyle = fl[i]; x.beginPath(); x.arc(WIN.x - 26 + i * 10.5, WIN.y + WIN.r + 2 - (i % 2) * 3, 4, 0, TAU); x.fill(); }
  // lantern bracket by the door
  x.strokeStyle = C.ink; x.lineWidth = 2;
  x.beginPath(); x.moveTo(HX + 76, HY - 92); x.lineTo(HX + 86, HY - 92); x.lineTo(HX + 86, HY - 84); x.stroke();
}

const sprCache = new Map();
function islandSprite(g, C, res) {
  const key = `${C.key}|${res}`;
  let s = sprCache.get(key);
  if (s) return s;
  const B = ISLAND.bounds, w = B.x1 - B.x0, h = B.y1 - B.y0;
  const c = g.createCanvas(Math.ceil(w * res), Math.ceil(h * res));
  const x = c.getContext('2d');
  x.scale(res, res);
  x.translate(-B.x0, -B.y0);
  x.lineJoin = 'round';
  x.lineCap = 'round';
  paintBody(x, C);
  paintTop(x, C);
  paintHouse(x, C);
  x.getImageData(0, 0, 1, 1);
  s = c;
  if (sprCache.size > 12) sprCache.delete(sprCache.keys().next().value);
  sprCache.set(key, s);
  return s;
}

// --- living parts -------------------------------------------------------------------------------

const ROOTS = Array.from({ length: 9 }, (_, i) => {
  const x = -210 + i * 50 + (hashU(31, i, 1) - 0.5) * 26;
  return { x, len: 60 + hashU(31, i, 2) * 120 * (1 - Math.abs(x) / 320), w: 4 + hashU(31, i, 3) * 4, ph: hashU(31, i, 4) * TAU, f: 0.5 + hashU(31, i, 5) * 0.5, bulb: i % 3 === 1 };
});

function drawRoots(ctx, g, C, t, sway, glowK) {
  ctx.fillStyle = C.root;
  ctx.beginPath();
  const tips = [];
  for (const r of ROOTS) {
    const y0 = undersideY(r.x) - 6;
    const sw = sway * (10 + r.len * 0.12) * Math.sin(t * r.f + r.ph);
    const pts = [];
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const px = r.x + sw * u * u + 6 * Math.sin(u * 5 + r.ph) * u;
      const py = y0 + r.len * u;
      pts.push([px, py, r.w * (1 - u * 0.92)]);
    }
    for (let k = 0; k <= n; k++) { const [px, py, w] = pts[k]; if (k === 0) ctx.moveTo(px - w, py); else ctx.lineTo(px - w, py); }
    for (let k = n; k >= 0; k--) { const [px, py, w] = pts[k]; ctx.lineTo(px + w, py); }
    ctx.closePath();
    if (r.bulb) tips.push([pts[n][0], pts[n][1], r.ph]);
  }
  ctx.fill();
  // glowing bulbs at a few root tips
  const spr = g.sprites.glow(C.window);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [px, py, ph] of tips) {
    const tw = 0.6 + 0.4 * Math.sin(t * 1.7 + ph * 3);
    ctx.globalAlpha = 0.55 * tw * glowK;
    ctx.drawImage(spr, px - 16, py - 12, 32, 32);
  }
  ctx.restore();
  ctx.fillStyle = C.windowHot;
  for (const [px, py] of tips) { ctx.beginPath(); ctx.arc(px, py + 4, 2.6, 0, TAU); ctx.fill(); }
}

function drawLadder(ctx, C, t, sway) {
  const ax = 140, ay = frontY(140) + 14, len = 210, wdt = 30;
  const ang = sway * (0.07 * Math.sin(t * 0.83 + 1.1) + 0.025 * Math.sin(t * 2.1));
  const pt = (side, u) => {
    const bend = ang * (u + 0.6 * u * u);
    const lx = ax + side * wdt * (1 - 0.15 * u), ly = ay;
    return [lx + Math.sin(bend) * len * u, ly + Math.cos(bend) * len * u];
  };
  ctx.strokeStyle = C.rope;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const side of [0, 1]) {
    for (let k = 0; k <= 10; k++) { const [px, py] = pt(side, k / 10); if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
  }
  for (let k = 1; k <= 9; k++) { const a = pt(0, k / 10), b = pt(1, k / 10); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1] + 2); }
  ctx.stroke();
}

function drawPebbles(ctx, C, t, sway) {
  for (let i = 0; i < 5; i++) {
    const px = -150 + i * 78 + hashU(41, i, 1) * 30;
    const py = undersideY(px) + 40 + hashU(41, i, 2) * 60 + 7 * Math.sin(t * (0.5 + hashU(41, i, 3) * 0.4) + i) * sway;
    const r = 6 + hashU(41, i, 4) * 9;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(0.3 * Math.sin(t * 0.3 + i));
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.3); ctx.lineTo(r * 0.9, -r * 0.45); ctx.lineTo(r * 0.3, r * 0.9); ctx.closePath();
    ctx.fillStyle = C.island; ctx.fill();
    ctx.fillStyle = C.islandTop; ctx.beginPath(); ctx.moveTo(-r, -r * 0.3); ctx.lineTo(r * 0.9, -r * 0.45); ctx.lineTo(0, -r * 0.62); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawTufts(ctx, C, t, sway, front) {
  ctx.lineCap = 'round';
  for (const col of [C.grassDark, C.grassTip]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = col === C.grassDark ? 3 : 2;
    ctx.beginPath();
    for (let i = 0; i < 34; i++) {
      const isFront = i < 20;
      if (isFront !== front) continue;
      let px, py;
      if (isFront) { px = -255 + (i / 19) * 510 + (hashU(51, i, 1) - 0.5) * 16; py = frontY(px) - 1; }
      else { const a = Math.PI + hashU(51, i, 1) * Math.PI; px = Math.cos(a) * TOP_RX * 0.9; py = Math.sin(a) * TOP_RY * 0.8; if (px > HX - 95 && px < HX + 95) px += 200; }
      const h = 9 + hashU(51, i, 2) * 9;
      const s = sway * (3 + 2 * Math.sin(t * 1.3 + i * 0.7));
      for (let b = -1; b <= 1; b++) {
        const lean = b * 4 + s;
        const hh = col === C.grassDark ? h : h * 0.7;
        ctx.moveTo(px + b * 3, py);
        ctx.quadraticCurveTo(px + b * 3 + lean * 0.3, py - hh * 0.6, px + b * 3 + lean, py - hh);
      }
    }
    ctx.stroke();
  }
}

function drawWindowAndLights(ctx, g, C, t, glow, windowContent, glowK, lit = 1) {
  const { x: wx, y: wy, r } = WIN;
  const flick = 1 + 0.05 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.03 * Math.sin(t * 13.7);
  const gk = glow * flick * glowK * lit;
  // the glowing pane
  ctx.save();
  ctx.beginPath(); ctx.arc(wx, wy, r, 0, TAU);
  const pg = ctx.createRadialGradient(wx - 6, wy - 8, 2, wx, wy, r);
  pg.addColorStop(0, C.windowHot);
  pg.addColorStop(0.55, C.window);
  pg.addColorStop(1, C.windowDeep);
  ctx.fillStyle = C.dark;
  ctx.fill();
  if (lit > 0.002) { ctx.globalAlpha *= Math.min(1, lit); ctx.fillStyle = pg; ctx.fill(); ctx.globalAlpha /= Math.min(1, lit); }
  if (windowContent) { ctx.clip(); windowContent(ctx, wx, wy, r); }
  ctx.restore();
  // frame ring with a thin cross mullion shadow
  ctx.beginPath(); ctx.arc(wx, wy, r, 0, TAU);
  ctx.strokeStyle = C.roofDark; ctx.lineWidth = 8; ctx.stroke();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(wx, wy, r + 4, 0, TAU); ctx.stroke();
  // light spilling out
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.38 * gk);
  ctx.drawImage(g.sprites.glow(C.window), wx - 130, wy - 120, 260, 260);
  // lantern by the door
  const lx = HX + 86, ly = HY - 76;
  const lf = 0.8 + 0.2 * Math.sin(t * 5.1 + 2) * Math.sin(t * 2.3);
  ctx.globalAlpha = Math.min(1, 0.6 * lf * glow * glowK * lit);
  ctx.drawImage(g.sprites.glow(C.window), lx - 34, ly - 34, 68, 68);
  ctx.restore();
  ctx.fillStyle = lit > 0.5 ? C.windowHot : C.roofDark;
  ctx.beginPath(); ctx.roundRect(lx - 4.5, ly - 6, 9, 12, 2); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
}

function drawSmoke(ctx, g, C, t, glowK) {
  const cx = HX + 59, cy = HY - 276;
  const spr = g.sprites.glow(C.smoke);
  ctx.save();
  for (let k = 0; k < 10; k++) {
    const age = (((t * 0.16 + k / 10) % 1) + 1) % 1;
    const curl = Math.sin(age * 5 + t * 0.4) * 14 * age;
    const px = cx + 8 - 55 * age * age - age * 20 + curl;
    const py = cy - 150 * age;
    const r = 8 + 34 * age;
    ctx.globalAlpha = 0.42 * Math.min(1, age * 6) * (1 - age) * glowK;
    ctx.drawImage(spr, px - r, py - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

/** Map island-local (lx, ly) to screen for an island placement {x, y, scale, rot}. */
export function islandPoint(o, lx, ly) {
  const s = o.scale ?? 1, c = Math.cos(o.rot || 0), n = Math.sin(o.rot || 0);
  return [o.x + s * (lx * c - ly * n), o.y + s * (lx * n + ly * c)];
}

/** Map a screen point into island-local coordinates (inverse of islandPoint). */
export function islandLocal(o, sx, sy) {
  const s = o.scale ?? 1, c = Math.cos(o.rot || 0), n = Math.sin(o.rot || 0);
  const dx = (sx - o.x) / s, dy = (sy - o.y) / s;
  return [dx * c + dy * n, -dx * n + dy * c];
}

/** Run fn(ctx) inside the island's local transform (for characters standing on it). */
export function withIsland(ctx, o, fn) {
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.rot) ctx.rotate(o.rot);
  const s = o.scale ?? 1;
  if (s !== 1) ctx.scale(s, s);
  const r = fn(ctx);
  ctx.restore();
  return r;
}

/**
 * Draw Kite Island. The signature is stable (milksea and lastkite call it too).
 *   g, ctx            the scene's helpers and the context to draw into (logical coordinates)
 *   x, y              screen position of the centre of the grassy top (the top is at y)
 *   scale, rot        size (1 = 540 px wide top) and tilt in radians about (x, y)
 *   t                 time (s) for the living parts (smoke, roots, ladder, grass, window flicker)
 *   palette           colours (missing keys fall back to ISLAND_DEFAULT)
 *   part              'all' | 'back' (everything behind characters) | 'front' (grass tufts at the lip)
 *   glow              window and lantern light (1 = normal)       sway   root/ladder/grass motion (1)
 *   tint              {color, amount} haze or night tint for everything but the lights
 *   alpha             overall opacity       windowContent  (ctx, wx, wy, r) => void, drawn clipped
 *                                                            inside the window (local coordinates)
 *   glowK             extra multiplier on all glows (e.g. a scene-wide dimming)
 *   lit               0..1 the window and lantern switched off .. on (default 1)
 * Returns {x, y, scale, rot, toScreen(lx, ly), window: [sx, sy, r], top: sy of the top centre}.
 */
export function drawIsland(g, ctx, { x = 960, y = 700, scale = 1, rot = 0, t = 0, palette = {}, part = 'all', glow = 1, sway = 1, tint = null, alpha = 1, windowContent = null, glowK = 1, lit = 1 } = {}) {
  const C = islandColors(g, palette, tint);
  const o = { x, y, scale, rot };
  const res = Math.max(0.25, Math.min(2, Math.round(scale * g.scale * 4) / 4));
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= Math.max(0, alpha);
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  if (part !== 'front') {
    drawPebbles(ctx, C, t, sway);
    drawRoots(ctx, g, C, t, sway, glowK);
    const B = ISLAND.bounds;
    ctx.drawImage(islandSprite(g, C, res), B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
    drawLadder(ctx, C, t, sway);
    drawTufts(ctx, C, t, sway, false);
    drawWindowAndLights(ctx, g, C, t, glow, windowContent, glowK, lit);
    drawSmoke(ctx, g, C, t, glowK);
  }
  if (part !== 'back') drawTufts(ctx, C, t, sway, true);
  ctx.restore();
  const wp = islandPoint(o, WIN.x, WIN.y);
  return { ...o, toScreen: (lx, ly) => islandPoint(o, lx, ly), toLocal: (sx, sy) => islandLocal(o, sx, sy), window: [wp[0], wp[1], WIN.r * scale], top: y };
}

// --- the diamond kite ---------------------------------------------------------------------------

/** Kite geometry at size 60 (px tall): points relative to the kite centre. */
export const KITE = { top: -24, side: 19, sideY: -6, bottom: 36, bridle: 2 };

/** Diamond kite outline at scale s (1 = 60 px tall), centred on the cross. */
export function kitePath(ctx, s = 1) {
  ctx.beginPath();
  ctx.moveTo(0, KITE.top * s);
  ctx.lineTo(KITE.side * s, KITE.sideY * s);
  ctx.lineTo(0, KITE.bottom * s);
  ctx.lineTo(-KITE.side * s, KITE.sideY * s);
  ctx.closePath();
}

/** Screen point where the tail attaches (the kite's bottom tip). */
export function kiteTailAnchor(x, y, ang = 0, size = 60) {
  const s = size / 60;
  return [x - Math.sin(ang) * KITE.bottom * s, y + Math.cos(ang) * KITE.bottom * s];
}

/** Screen point where the string attaches (the bridle, just below the cross). */
export function kiteBridle(x, y, ang = 0, size = 60) {
  const s = size / 60;
  return [x - Math.sin(ang) * KITE.bridle * s, y + Math.cos(ang) * KITE.bridle * s];
}

/**
 * Tail points as an echo of the kite's own path: posAt(time) -> [x, y, ang, size]. The tail hangs
 * from the kite's bottom along its positions at t - k*dt, drooping a little and fluttering.
 */
export function kiteTail(posAt, t, { n = 6, dt = 0.12, droop = 7, flutter = 4 } = {}) {
  const pts = [];
  const [x0, y0, a0, s0] = posAt(t);
  pts.push(kiteTailAnchor(x0, y0, a0, s0));
  for (let k = 1; k <= n; k++) {
    const [x, y, a, s] = posAt(t - k * dt);
    const [bx, by] = kiteTailAnchor(x, y, a, s);
    const sc = s / 60;
    pts.push([bx + flutter * sc * Math.sin(t * 9 + k * 1.3), by + k * droop * sc]);
  }
  return pts;
}

const mixCache = new Map();
function kmix(g, a, b, u) {
  const k = `${a}|${b}|${u}`;
  let v = mixCache.get(k);
  if (!v) { v = g.color.mix(a, b, u); if (mixCache.size > 400) mixCache.clear(); mixCache.set(k, v); }
  return v;
}

function drawTail(g, ctx, pts, color, light, s, alpha) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = light;
  ctx.lineWidth = 2.2 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
  // bows
  for (let i = 1; i < pts.length; i++) {
    const [cx, cy] = pts[i];
    let dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy, ny = dx;
    const w = 8 * s * (1 - i * 0.06), d = 4 * s;
    ctx.beginPath();
    for (const sd of [1, -1]) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sd * nx * w + dx * d, cy + sd * ny * w + dy * d);
      ctx.lineTo(cx + sd * nx * w - dx * d, cy + sd * ny * w - dy * d);
      ctx.closePath();
    }
    ctx.fillStyle = i % 2 ? color : light;
    ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2 * s; ctx.globalAlpha *= 0.7; ctx.stroke(); ctx.globalAlpha /= 0.7;
  }
  ctx.restore();
}

/**
 * Draw the diamond kite: coloured panels, a lighter cross, ink outline, a soft glow behind it and a
 * ribbon tail of bows (tail: points from kiteTail()). size = height in px (60 by default).
 */
export function drawKite(g, ctx, { x, y, size = 60, ang = 0, color = '#FFC83D', cross = null, glow = 0.5, glowColor = null, alpha = 1, tail = null }) {
  if (alpha <= 0.002) return;
  const s = size / 60;
  const light = cross || kmix(g, color, '#FFFFFF', 0.6);
  if (tail) drawTail(g, ctx, tail, color, light, s, alpha);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= Math.min(1, glow * 0.55);
    const r = 80 * s;
    ctx.drawImage(g.sprites.glow(glowColor || color), x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }
  ctx.translate(x, y);
  ctx.rotate(ang);
  const lit = kmix(g, color, '#FFFFFF', 0.22), shade = kmix(g, color, INK, 0.28);
  const cy = KITE.sideY * s;
  const tri = (ax, ay, bx, by, fill) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(0, cy); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  tri(0, KITE.top * s, -KITE.side * s, cy, lit);
  tri(0, KITE.top * s, KITE.side * s, cy, color);
  tri(-KITE.side * s, cy, 0, KITE.bottom * s, color);
  tri(KITE.side * s, cy, 0, KITE.bottom * s, shade);
  ctx.strokeStyle = light;
  ctx.lineWidth = 2.2 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, KITE.top * s + 3 * s); ctx.lineTo(0, KITE.bottom * s - 3 * s);
  ctx.moveTo(-KITE.side * s + 3 * s, cy); ctx.lineTo(KITE.side * s - 3 * s, cy);
  ctx.stroke();
  kitePath(ctx, s);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6 * s;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/** Control point of a kite string from (x0, y0) to (x1, y1): it sags by `sag` of its length and bows sideways by `bow` px. */
export function stringControl(x0, y0, x1, y1, sag = 0.1, bow = 0) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  return [(x0 + x1) / 2 + bow, (y0 + y1) / 2 + sag * L];
}

/** Point at u (0 = hand, 1 = kite) on the quadratic string. */
export function stringPoint(x0, y0, cx, cy, x1, y1, u) {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return [a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1];
}

/**
 * A glowing kite string: a quadratic curve from (x0, y0) to (x1, y1) with a soft additive halo.
 * Options: sag, bow (see stringControl), color, alpha, width (core px), glow (halo strength), ctrl (override [cx, cy]).
 */
export function drawString(g, ctx, x0, y0, x1, y1, { sag = 0.1, bow = 0, color = ISLAND_DEFAULT.string, alpha = 1, width = 2, glow = 1, ctrl = null } = {}) {
  if (alpha <= 0.002) return;
  const [cx, cy] = ctrl || stringControl(x0, y0, x1, y1, sag, bow);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = color;
  if (glow > 0) {
    ctx.globalAlpha = Math.min(1, 0.06 * glow * alpha); ctx.lineWidth = width * 6; ctx.stroke();
    ctx.globalAlpha = Math.min(1, 0.16 * glow * alpha); ctx.lineWidth = width * 2.6; ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.min(1, 0.95 * alpha);
  ctx.strokeStyle = kmix(g, color, '#FFFFFF', 0.35);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}
