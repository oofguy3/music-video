// E1 "The last kite", and the twist. A quiet night after the storm: grown-up Kit alone on a small
// floating rock, a single glowing kite drifting down on its string. The voice's last notes make the kite
// pulse; when the voice ends Kit reaches up and catches the string. Then the camera pulls back and tilts
// up along the string, all the way to the little house on Kite Island (the same island, house and kite as
// the opening), where the child Kit in the glowing window is holding the other end.
//
// Everything stays still except the kite's tail, the stars and the slow breathing glow of the string.

import { KIT } from './lib/cast.mjs';
import { drawPuppet, solve, poses, armTo } from './lib/puppet.mjs';
import { hashU, lattice, fbm } from './lib/worldkit.mjs';
import { drawIsland, drawKite, drawString, kiteTail, kiteBridle, stringControl, stringPoint, islandPoint, ISLAND } from './lib/island.mjs';

export const meta = { type: 'lastkite', budgetMs: 80 };

export const DEFAULT = {
  skyTop: '#05061A', skyLow: '#1B1446', star: '#FFF6E0', rock: '#2A2140', kite: '#FFC83D',
  string: '#FFE9B0', island: '#3B2350', house: '#F3D9E8', roof: '#9C3F6E', window: '#FFD27A', glow: '#FFD27A',
};

// Times default to < 0: "a fraction of the way through the entry".
export const defaults = {
  catch: -1, pull: -1, tilt: -1,
  stars: 400, kitHeight: 160, kiteSize: 62,
  islandScale: 2.4, islandTop: -1600, rockY: 620,
};

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, u) => a + (b - a) * u;
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const inOutCubic = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };

function palette(S) {
  const p = S.palette || {};
  const C = {};
  for (const k of Object.keys(DEFAULT)) C[k] = p[k] || DEFAULT[k];
  return C;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) { v = make(); if (cache.size > 60) cache.delete(cache.keys().next().value); cache.set(key, v); }
  return v;
}
const mixc = (g, a, b, u) => cached(`mix|${a}|${b}|${u}`, () => g.color.mix(a, b, u));

// --- the night sky (cached per palette and device size) ------------------------------------------------

function skyLayer(g, C) {
  return cached(`sky|${C.skyTop}|${C.skyLow}|${g.devW}`, () => {
    const c = g.createCanvas(g.devW, g.devH);
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    const gr = x.createLinearGradient(0, 0, 0, 1080);
    gr.addColorStop(0, C.skyTop);
    gr.addColorStop(0.65, mixc(g, C.skyTop, C.skyLow, 0.7));
    gr.addColorStop(1, C.skyLow);
    x.fillStyle = gr;
    x.fillRect(0, 0, 1920, 1080);
    // a faint milky band and soft painted haze
    const L = lattice(303);
    for (let i = 0; i < 70; i++) {
      const u = i / 69;
      const bx = -100 + u * 2100, by = 980 - u * 900 + (fbm(L, u * 4, 0.3, 2) - 0.5) * 260;
      const r = 90 + 140 * fbm(L, u * 7, 3.1, 2);
      const rg = x.createRadialGradient(bx, by, 0, bx, by, r);
      rg.addColorStop(0, g.color.css(mixc(g, C.skyLow, '#8C7BD6', 0.35), 0.13));
      rg.addColorStop(1, g.color.css(C.skyLow, 0));
      x.fillStyle = rg;
      x.fillRect(bx - r, by - r, 2 * r, 2 * r);
    }
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// --- the little rock ------------------------------------------------------------------------------------

function rockPath(x, w) {
  const L = lattice(404);
  x.beginPath();
  x.moveTo(-w, 0);
  for (let i = 0; i <= 30; i++) {
    const u = i / 30, xx = -w + 2 * w * u;
    const a = Math.abs(xx - 8) / w;
    const y = 118 * Math.pow(Math.max(0, 1 - Math.pow(a, 1.5)), 1.6) + (fbm(L, xx / 22, 1.3, 2) - 0.5) * 22 * Math.sin(Math.PI * u);
    x.lineTo(xx, Math.max(4, y));
  }
  x.lineTo(w, 0);
  x.ellipse(0, 0, w, 14, 0, 0, Math.PI, true);
  x.closePath();
}

function drawRock(g, ctx, C, x0, y0, warm) {
  const w = 100;
  ctx.save();
  ctx.translate(x0, y0);
  rockPath(ctx, w);
  const gr = ctx.createLinearGradient(0, -10, 0, 120);
  gr.addColorStop(0, mixc(g, C.rock, C.skyLow, 0.2));
  gr.addColorStop(1, mixc(g, C.rock, '#000000', 0.45));
  ctx.fillStyle = gr;
  ctx.fill();
  // warm light from the kite on the right edge, cool sky on the left
  const rim = ctx.createLinearGradient(-w, 0, w, 0);
  rim.addColorStop(0, g.color.css('#8C7BD6', 0.35));
  rim.addColorStop(0.4, g.color.css('#8C7BD6', 0));
  rim.addColorStop(0.65, g.color.css(C.glow, 0));
  rim.addColorStop(1, g.color.css(C.glow, 0.5 * warm));
  ctx.strokeStyle = rim;
  ctx.lineWidth = 4;
  ctx.stroke();
  // roots
  ctx.strokeStyle = mixc(g, C.rock, '#000000', 0.3);
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const rx = -50 + i * 32;
    ctx.lineWidth = 3 - i * 0.4;
    ctx.beginPath(); ctx.moveTo(rx, 60 - Math.abs(rx) * 0.5); ctx.quadraticCurveTo(rx + 8, 100, rx - 4, 130 + 18 * hashU(5, i, 1)); ctx.stroke();
  }
  // the top: a little moss
  ctx.beginPath(); ctx.ellipse(0, 0, w, 14, 0, 0, TAU);
  ctx.fillStyle = mixc(g, C.rock, '#5B3A7A', 0.45);
  ctx.fill();
  ctx.strokeStyle = mixc(g, C.rock, '#000000', 0.3); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.strokeStyle = mixc(g, '#5B3A7A', C.glow, 0.25);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const tx = -86 + i * 21 + hashU(6, i, 1) * 8, ty = 9 - 6 * hashU(6, i, 2);
    ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + 1, ty - 6, tx + 3, ty - 10);
    ctx.moveTo(tx + 4, ty); ctx.quadraticCurveTo(tx + 5, ty - 5, tx + 8, ty - 8);
  }
  ctx.stroke();
  ctx.restore();
}

// --- draw ----------------------------------------------------------------------------------------------

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const C = palette(S);
  const dur = Math.max(1e-3, S.t1 - S.t0);
  const T = (v, f) => (typeof v === 'number' && v >= 0 ? v : S.t0 + f * dur);
  const tCatch = T(P.catch, 0.154);
  const pull = P.pull >= 0 ? P.pull : lerp(1, 0.32, inOutCubic(S.u / 0.78));
  const tilt = P.tilt >= 0 ? clamp(P.tilt) : inOutCubic((S.u - 0.14) / 0.6);
  const pad = clamp(F.c.pad_lvl ?? 0.6);

  // the last sung notes make the kite pulse
  let pulse = 0;
  for (const n of F.between('voc_notes', S.t0 - 0.05, t + 1e-6)) pulse = Math.max(pulse, (n[3] ?? 0.7) * Math.exp(-(t - n[0]) / 0.35));
  const breathe = 0.5 + 0.5 * Math.sin((t - S.t0) * 1.1);

  // sky and stars (screen space; the tilt drifts them down)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(skyLayer(g, C), 0, 0);
  ctx.restore();
  {
    const spr = g.sprites.glow(C.star);
    const shift = 300 * tilt;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = C.star;
    for (let i = 0; i < P.stars; i++) {
      const x = hashU(501, i, 1) * 1920;
      const y = -330 + hashU(501, i, 2) * 1430 + shift;
      if (y < -10 || y > 1090) continue;
      const big = hashU(501, i, 3);
      const r = 0.7 + big * big * 2.2;
      const tw = hashU(501, i, 4) < 0.45 ? 0.5 + 0.5 * Math.sin(t * (1.3 + 3 * hashU(501, i, 5)) + hashU(501, i, 6) * TAU) : 1;
      const a = (0.35 + 0.65 * hashU(501, i, 7)) * tw;
      if (r > 1.6) { ctx.globalAlpha = a * 0.55; ctx.drawImage(spr, x - r * 5, y - r * 5, r * 10, r * 10); }
      ctx.globalAlpha = a;
      ctx.fillRect(x - r * 0.5, y - r * 0.5, r, r);
    }
    ctx.restore();
  }

  // camera: pulls back (zoom = P.pull) and tilts up along the string
  const z = pull;
  const cx = 960, cy = lerp(560, -700, tilt);
  ctx.save();
  ctx.translate(960, 540);
  ctx.scale(z, z);
  ctx.translate(-cx, -cy);
  const px = 1 / z;   // one screen pixel in world units

  // the house in the sky (same island, house and palette as the opening, at night)
  const sI = P.islandScale;
  const isl = { x: 960 + 40 - sI * ISLAND.window.x, y: P.islandTop, scale: sI, rot: 0 };
  const kd = KIT.child;
  const kidScale = 0.43;
  const winX = ISLAND.window.x, winY = ISLAND.window.y, winR = ISLAND.window.r;
  // the child's hand rests on the sill holding the string
  const kidPose = { ...poses.stand, head: 0.25, lean: 0.06 };
  const groundIn = winY + winR + 28;
  const j0 = solve(kd, kidPose, { x: winX - 3, ground: groundIn, scale: kidScale, view: 'front' });
  const tgt = [winX + 12, winY + winR - 9];
  const aR = armTo(kd, (tgt[0] - j0.shoulderR[0]) / j0.U, (tgt[1] - j0.shoulderR[1]) / j0.U);
  const aL = armTo(kd, (j0.shoulderL[0] - (winX - 16)) / j0.U, (winY + winR - 6 - j0.shoulderL[1]) / j0.U);
  Object.assign(kidPose, { sR: aR.s, eR: aR.e, sL: aL.s, eL: aL.e });
  const jK = solve(kd, kidPose, { x: winX - 3, ground: groundIn, scale: kidScale, view: 'front' });
  const childHand = islandPoint(isl, ...jK.wristR);

  // a halo of night air around the house
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const wp = islandPoint(isl, winX, winY);
  ctx.globalAlpha = 0.18 + 0.06 * breathe;
  ctx.drawImage(g.sprites.glow(C.glow), wp[0] - 700, wp[1] - 600, 1400, 1300);
  ctx.restore();
  drawIsland(g, ctx, {
    x: isl.x, y: isl.y, scale: sI, t: S.t0 + (t - S.t0) * 0.15, palette: { ...C, islandTop: '#5B3A7A', grass: '#8A5FB0' },
    tint: { color: C.skyLow, amount: 0.38 }, glow: 1.4, sway: 0.3,
    windowContent: (c) => { drawPuppet(c, kd, kidPose, { x: winX - 3, ground: groundIn, scale: kidScale, view: 'front', devScale: g.scale * sI * z }); },
  });

  // the rock and the grown-up Kit
  const rockX = 960, rockY = P.rockY;
  const ad = KIT.adult, aScale = P.kitHeight / ad.height;
  const kX = rockX - 12;
  const pose = { ...poses.stand, head: lerp(-0.45, -0.2, sm((t - tCatch) / 1.5)), bob: 0.003 * Math.sin(t * 1.4) };
  const js = solve(ad, pose, { x: kX, ground: rockY, scale: aScale, view: 'front' });
  const grip = [js.shoulderR[0] + 0.07 * js.U, js.shoulderR[1] - 0.28 * js.U];
  const kiteHome = [grip[0] + 30, grip[1] + 14];
  // the kite drifts down from the top of the frame and arrives just as the voice ends
  const arrive = (tt) => outCubic((tt - S.t0) / Math.max(0.5, tCatch - S.t0 + 0.35));
  const kitePos = (tt) => {
    const u = arrive(tt);
    const x = lerp(kX + 140, kiteHome[0], u) + 26 * Math.sin(tt * 1.4) * (1 - u) + 6 * Math.sin(tt * 0.9);
    const y = lerp(rockY - 640, kiteHome[1], u) + 5 * Math.sin(tt * 1.2 + 1);
    const ang = 0.12 * Math.sin(tt * 1.1) + 0.25 * (1 - u) * Math.cos(tt * 1.4);
    return [x, y, ang, P.kiteSize];
  };
  const [kx, ky, kang] = kitePos(t);
  const bridle = kiteBridle(kx, ky, kang, P.kiteSize);
  // reaching up for the string
  const reachU = sm((t - (tCatch - 0.55)) / 0.55);
  if (reachU > 0) {
    const a = armTo(ad, (grip[0] - js.shoulderR[0]) / js.U, (grip[1] - js.shoulderR[1]) / js.U);
    pose.sR = lerp(pose.sR, a.s, reachU);
    pose.eR = lerp(pose.eR, a.e, reachU);
  }
  const caught = t >= tCatch;
  const kitGlow = 0.7 + 0.25 * breathe + 1.3 * pulse;

  // the glow of the kite lights the rock and Kit
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(0.2 + 0.25 * pulse);
  ctx.drawImage(g.sprites.glow(C.glow), kx - 260, ky - 220, 520, 520);
  ctx.restore();
  drawRock(g, ctx, C, rockX, rockY, 0.6 + 0.4 * pulse);
  const jA = drawPuppet(ctx, ad, pose, { x: kX, ground: rockY, scale: aScale, view: 'front', devScale: g.scale * z });
  const hand = jA.wristR;

  // the string: from the kite up through Kit's hand (once caught) to the child in the window
  const sAlpha = clamp(0.55 + 0.3 * pad * (0.6 + 0.4 * breathe) + 0.3 * pulse);
  const width = Math.max(2, 1.6 * px);
  const top = childHand;
  let from = bridle;
  if (caught) {
    drawString(g, ctx, bridle[0], bridle[1], hand[0], hand[1], { color: C.string, alpha: sAlpha, width, glow: 1.2, sag: 0, bow: 6 });
    from = hand;
  }
  const bow = 60 + 10 * Math.sin(t * 0.7);
  const ctrl = stringControl(from[0], from[1], top[0], top[1], 0, bow);
  drawString(g, ctx, from[0], from[1], top[0], top[1], { color: C.string, alpha: sAlpha, width, glow: 1.3 + 0.4 * breathe, ctrl });
  // slow glints travelling up the string, once it is caught
  if (caught) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spr = g.sprites.glow(C.string);
    for (let i = 0; i < 4; i++) {
      const u = (((t - tCatch) * 0.12 + i / 4) % 1);
      const [gx, gy] = stringPoint(from[0], from[1], ctrl[0], ctrl[1], top[0], top[1], u);
      const r = 14 * px * (0.8 + 0.4 * Math.sin(t * 2 + i));
      ctx.globalAlpha = 0.7 * sm((t - tCatch) / 0.8) * Math.sin(Math.PI * u);
      ctx.drawImage(spr, gx - r, gy - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }
  // the kite itself, its tail fluttering
  drawKite(g, ctx, { x: kx, y: ky, ang: kang, size: P.kiteSize, color: C.kite, glow: kitGlow, glowColor: C.glow, tail: kiteTail(kitePos, t, { droop: 9, flutter: 6 }) });
  // a pulse on each of the last notes: a ring of light from the kite
  if (pulse > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 * pulse;
    const r = 70 + 90 * (1 - pulse);
    ctx.drawImage(g.sprites.glow(C.glow, 1), kx - r, ky - r, 2 * r, 2 * r);
    ctx.restore();
  }
  ctx.restore();
}
