// "The Emperor": the striker character and his motifs, shared by every scene of the Kaiser video.
// An original stylised design in the puppet style (simple shapes), evoking the character through his
// signature details: blond hair fading to blue tips, blue eyes, a smirk, a blue rose on the neck,
// a red-and-black kit. Motifs: the blue rose, the crown, chains, the ball, manga speed lines.
//
//   import { KAISER, KZ, drawRose, drawCrown, drawChain, drawBall, speedLines } from './lib/kaiser.mjs';
//   drawPuppet(ctx, KAISER, cycles.run(p), { x, ground, view: 'side', devScale: g.scale });

import { design } from './puppet.mjs';

const TAU = Math.PI * 2;

/** The colour script. */
export const KZ = {
  blond: '#F4E6A6', blondHi: '#FFF7D6', tip: '#3D8BFF', tipDeep: '#1D46C8',
  skin: '#FFE3D2', cheek: '#FF9FA8', eye: '#2F8BFF', eyeDeep: '#173E9E', liner: '#E2364B',
  ink: '#0B0B18', red: '#D11F35', redDeep: '#8A0E20', black: '#15151F',
  rose: '#2E6BFF', roseDeep: '#14329A', roseHi: '#8FB6FF',
  gold: '#FFD45A', goldDeep: '#B8860B', chain: '#C9D2E0', chainDeep: '#6B7488',
  royal: '#1F4FD8', navy: '#080D2A', cyan: '#3DE0FF', white: '#F7F9FF',
};

function faceShape(ctx, r, side) {
  const cx = side ? 0.28 * r : 0;                        // in profile the chin points forward
  ctx.beginPath();
  ctx.moveTo(-r, 0.05 * r);
  ctx.arc(0, 0.05 * r, r, Math.PI, 2 * Math.PI);
  ctx.lineTo(0.94 * r, 0.42 * r);
  ctx.quadraticCurveTo(0.62 * r + cx, 0.98 * r, cx, 1.1 * r);
  ctx.quadraticCurveTo(-0.55 * r + cx * 0.4, 0.98 * r, -0.94 * r, 0.42 * r);
  ctx.closePath();
}

// The spiky mane: the outline runs up the left side, over the top and down the right in sharp
// anime spikes, then back across the forehead as a jagged fringe.
const HAIR = [
  [-1.16, 0.96], [-1.0, 0.46], [-1.26, 0.3], [-1.06, -0.1], [-1.28, -0.44], [-0.92, -0.72], [-0.9, -1.06],
  [-0.5, -1.0], [-0.26, -1.3], [0.04, -1.08], [0.42, -1.3], [0.62, -0.98], [1.04, -1.02], [0.98, -0.7],
  [1.3, -0.48], [1.1, -0.15], [1.3, 0.1], [1.06, 0.38], [1.18, 0.92],
  [0.88, 0.3], [0.82, 0.5], [0.6, 0.08], [0.36, 0.48], [0.16, 0.0], [-0.12, 0.44], [-0.32, 0.02],
  [-0.6, 0.4], [-0.8, 0.06], [-0.94, 0.62],
];
function hairShape(ctx, r, side) {
  const s = side ? -0.14 * r : 0;
  ctx.beginPath();
  for (let i = 0; i < HAIR.length; i++) {
    const x = s + HAIR[i][0] * r, y = HAIR[i][1] * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Kaiser's head (a custom puppet head): pointed chin, swept blond hair with blue tips, blue eyes, a smirk. */
export function kaiserHead({ rose = true } = {}) {
  return (ctx, r, info) => {
    const side = info.joints && info.joints.view === 'side';
    if (info.pass === 'outline') {
      faceShape(ctx, r, side); ctx.fill();
      hairShape(ctx, r, side); ctx.fill();
      return;
    }
    ctx.fillStyle = KZ.skin;
    faceShape(ctx, r, side);
    ctx.fill();
    // eyes, liner, smirk (detailed at portrait size, dots when small)
    const big = r >= 13;
    const ex = side ? [0.42 * r] : [-0.38 * r, 0.38 * r];
    for (const x of ex) {
      if (big) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.ellipse(x, 0.52 * r, 0.2 * r, 0.12 * r, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = KZ.eye;
        ctx.beginPath(); ctx.arc(x + 0.03 * r, 0.52 * r, 0.105 * r, 0, TAU); ctx.fill();
        ctx.fillStyle = KZ.eyeDeep;
        ctx.beginPath(); ctx.arc(x + 0.03 * r, 0.53 * r, 0.05 * r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(x + 0.0 * r, 0.48 * r, 0.03 * r, 0, TAU); ctx.fill();
        ctx.strokeStyle = KZ.ink; ctx.lineWidth = 0.055 * r; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - 0.22 * r, 0.48 * r); ctx.quadraticCurveTo(x, 0.35 * r, x + 0.24 * r, 0.44 * r); ctx.stroke();
        ctx.strokeStyle = KZ.liner; ctx.lineWidth = 0.035 * r;   // the red under-eye flick
        const o = x > 0 || side ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(x + o * 0.06 * r, 0.66 * r); ctx.lineTo(x + o * 0.24 * r, 0.61 * r); ctx.stroke();
      } else {
        ctx.fillStyle = KZ.eyeDeep;
        ctx.beginPath(); ctx.arc(x, 0.52 * r, 0.11 * r, 0, TAU); ctx.fill();
      }
    }
    if (big) {
      ctx.strokeStyle = KZ.ink; ctx.lineWidth = 0.045 * r; ctx.lineCap = 'round';
      const mx = side ? 0.3 * r : 0;
      ctx.beginPath(); ctx.moveTo(mx - 0.14 * r, 0.82 * r); ctx.quadraticCurveTo(mx + 0.04 * r, 0.86 * r, mx + 0.2 * r, 0.74 * r); ctx.stroke();
    }
    // hair: blond crown fading to blue tips
    const grd = ctx.createLinearGradient(0, -1.4 * r, 0, 0.75 * r);
    grd.addColorStop(0, KZ.blondHi);
    grd.addColorStop(0.42, KZ.blond);
    grd.addColorStop(0.72, KZ.tip);
    grd.addColorStop(1, KZ.tipDeep);
    ctx.fillStyle = grd;
    hairShape(ctx, r, side);
    ctx.fill();
    // a few darker strands for texture
    ctx.strokeStyle = 'rgba(29,70,200,0.35)'; ctx.lineWidth = 0.04 * r;
    ctx.beginPath();
    ctx.moveTo(-0.5 * r, -0.95 * r); ctx.quadraticCurveTo(-0.3 * r, -0.3 * r, -0.45 * r, 0.2 * r);
    ctx.moveTo(0.3 * r, -1.0 * r); ctx.quadraticCurveTo(0.5 * r, -0.4 * r, 0.42 * r, 0.25 * r);
    ctx.stroke();
    // the blue rose on the neck
    if (rose && big) drawRose(ctx, (side ? -0.1 : 0.4) * r, 1.42 * r, 0.24 * r, { rot: 0.4 });
  };
}

const ATHLETE = { headR: 0.1, neck: 0.03, torso: 0.3, shoulderX: 0.09, upperArm: 0.165, foreArm: 0.155, hand: 0.024, thigh: 0.245, shin: 0.235, foot: 0.06, torsoW: 0.15, torsoSide: 0.11, armW: 0.048, legW: 0.058 };

/** The Emperor: red-and-black kit (red shirt, black sleeves edge, black shorts), broad shoulders. */
export const KAISER = design({
  ...ATHLETE, id: 'kaiser', height: 300, torsoShape: 'inv',
  fill: KZ.red, armFill: KZ.red, legFill: KZ.black, headFill: KZ.skin, head: kaiserHead(),
  outline: KZ.ink, outlineW: 3, farShade: 0.72,
});

const rivals = new Map();
/** A rival or crowd figure in flat colours (no face), e.g. the defenders he humiliates. */
export function rivalDesign(shirt = '#F2F4FA', shorts = '#1B2340', outline = KZ.ink) {
  const k = `${shirt}|${shorts}|${outline}`;
  let d = rivals.get(k);
  if (!d) {
    d = design({ ...ATHLETE, id: `rival-${k}`, height: 290, fill: shirt, armFill: shirt, legFill: shorts, headFill: '#2A2A3A', head: 'round', face: 'none', outline, outlineW: outline ? 3 : 0 });
    rivals.set(k, d);
  }
  return d;
}

/**
 * A stylised rose seen from above-front: three rings of rounded petals around a dark spiral heart.
 * open (0..1) blooms it from a closed bud; rot turns it.
 */
export function drawRose(ctx, x, y, r, { color = KZ.rose, deep = KZ.roseDeep, hi = KZ.roseHi, rot = 0, open = 1, alpha = 1 } = {}) {
  if (r <= 0.3 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  const o = Math.max(0, Math.min(1, open));
  const rings = [[6, 1.0, deep], [5, 0.74, color], [4, 0.5, color]];
  rings.forEach(([n, rr, col], k) => {
    const spread = rr * (0.45 + 0.55 * o);
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + k * 0.5;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * spread * 0.55, Math.sin(a) * r * spread * 0.55, r * spread * 0.55, r * spread * 0.4, a, 0, TAU);
      ctx.fill();
    }
  });
  ctx.fillStyle = deep;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
  ctx.strokeStyle = hi; ctx.lineWidth = Math.max(0.6, r * 0.07); ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {                       // the spiral heart
    const a = (i / 24) * TAU * 1.6, rr = r * 0.04 + r * 0.22 * (i / 24);
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.stroke();
  ctx.restore();
}

/** A crown: a band with five points tipped by pearls and set with jewels. (x, y) = centre of the band's base. */
export function drawCrown(ctx, x, y, w, { fill = KZ.gold, deep = KZ.goldDeep, ink = KZ.ink, jewel = KZ.rose, alpha = 1, lineW = null } = {}) {
  if (w <= 0 || alpha <= 0) return;
  const h = w * 0.62, band = w * 0.2;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(-w / 2, -band);
  const peaks = [-0.5, -0.25, 0, 0.25, 0.5];
  ctx.lineTo(-w * 0.5, -h);
  for (let i = 0; i < 4; i++) {
    const a = peaks[i], b = peaks[i + 1];
    ctx.lineTo(w * (a + b) / 2, -band - (h - band) * 0.35);
    ctx.lineTo(w * b, -h * (i === 1 ? 1.12 : 1));
  }
  ctx.lineTo(w / 2, -band);
  ctx.lineTo(w / 2, 0);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lineW ?? Math.max(1, w * 0.035);
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = deep;
  ctx.fillRect(-w / 2, -band, w, band * 0.28);
  ctx.strokeRect(-w / 2, -band, w, band);
  for (const a of peaks) {                              // pearls on the points
    ctx.beginPath();
    ctx.arc(w * a, -h * (a === -0.25 ? 1.12 : 1) - w * 0.035, w * 0.05, 0, TAU);
    ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.stroke();
  }
  for (const a of [-0.3, 0, 0.3]) {                     // jewels on the band
    ctx.beginPath();
    ctx.arc(w * a, -band / 2, w * 0.055, 0, TAU);
    ctx.fillStyle = a === 0 ? KZ.red : jewel; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/**
 * A chain hanging between two points: links along a sagging curve, alternating face-on rings and
 * edge-on bars. broken (0..1) opens a gap at the middle; the two halves drop away.
 */
export function drawChain(ctx, x0, y0, x1, y1, { sag = 60, link = 26, width = 6, color = KZ.chain, deep = KZ.chainDeep, broken = 0, alpha = 1 } = {}) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(L / (link * 0.78)));
  const pt = (u) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + sag * 4 * u * (1 - u)];
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    if (broken > 0 && Math.abs(u - 0.5) < 0.04 + 0.1 * broken) continue;
    let [x, y] = pt(u);
    if (broken > 0) {                                   // the halves swing down and away
      const side = u < 0.5 ? -1 : 1, d = Math.abs(u - 0.5) < 0.5 ? (0.5 - Math.abs(u - 0.5)) : 0;
      x += side * broken * 40 * d; y += broken * broken * 260 * d;
    }
    const [xa, ya] = pt(Math.max(0, u - 0.01)), [xb, yb] = pt(Math.min(1, u + 0.01));
    const ang = Math.atan2(yb - ya, xb - xa);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (i % 2 === 0) {
      ctx.strokeStyle = deep; ctx.lineWidth = width + 2;
      ctx.beginPath(); ctx.ellipse(0, 0, link * 0.5, link * 0.28, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.ellipse(0, 0, link * 0.5, link * 0.28, 0, 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = deep; ctx.lineWidth = width + 3;
      ctx.beginPath(); ctx.moveTo(-link * 0.5, 0); ctx.lineTo(link * 0.5, 0); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(-link * 0.5, 0); ctx.lineTo(link * 0.5, 0); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** A football: white with black pentagon patches; rot spins it. */
export function drawBall(ctx, x, y, r, { rot = 0, white = '#F7F9FF', patch = KZ.black, ink = KZ.ink, alpha = 1 } = {}) {
  if (r <= 0.3) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = white; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.rotate(rot);
  ctx.fillStyle = patch;
  const pent = (cx, cy, rr, a0) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = a0 + (i / 5) * TAU; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  };
  pent(0, 0, r * 0.32, -Math.PI / 2);
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * TAU + Math.PI / 5; pent(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98, r * 0.3, a); }
  ctx.strokeStyle = 'rgba(20,20,30,0.5)'; ctx.lineWidth = Math.max(0.6, r * 0.04);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * TAU;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32); ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7); ctx.stroke();
  }
  ctx.restore();
  const shade = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  shade.addColorStop(0, 'rgba(255,255,255,0.35)');
  shade.addColorStop(1, 'rgba(0,0,30,0.35)');
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.06); ctx.strokeStyle = ink; ctx.stroke();
  ctx.restore();
}

const hU = (a, b, c) => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

/**
 * Manga speed lines radiating from (cx, cy): n thin wedges between radii inner and outer. The pattern
 * re-rolls every `hold` frames (pass F.frame as frame), like hand-drawn impact lines.
 */
export function speedLines(ctx, { cx = 960, cy = 540, n = 90, inner = 260, outer = 1400, color = '#FFFFFF', alpha = 0.8, seed = 1, frame = 0, hold = 2, width = 0.012 } = {}) {
  if (alpha <= 0) return;
  const k = Math.floor(frame / hold);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = hU(seed, k, i) * TAU;
    const wa = width * (0.3 + 1.4 * hU(seed, k, i + 999));
    const r0 = inner * (0.85 + 0.5 * hU(seed, k, i + 1999));
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a - wa) * outer, cy + Math.sin(a - wa) * outer);
    ctx.lineTo(cx + Math.cos(a + wa) * outer, cy + Math.sin(a + wa) * outer);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/** Parallel speed lines (motion streaks) across the frame at an angle, scrolling with t. */
export function streakLines(ctx, { angle = 0, n = 40, color = '#FFFFFF', alpha = 0.6, seed = 3, t = 0, speed = 2400, w = 1920, h = 1080 } = {}) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const R = Math.hypot(w, h) / 2 + 200;
  for (let i = 0; i < n; i++) {
    const y = (hU(seed, i, 1) * 2 - 1) * R;
    const len = 200 + 900 * hU(seed, i, 2);
    const th = 1 + 4 * hU(seed, i, 3);
    const period = 2 * R + len;
    const x = ((hU(seed, i, 4) * period + t * speed * (0.6 + 0.8 * hU(seed, i, 5))) % period) - R - len;
    ctx.fillRect(x, y, len, th);
  }
  ctx.restore();
}
