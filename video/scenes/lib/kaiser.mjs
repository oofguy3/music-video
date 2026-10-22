// "The Emperor": the striker character and his motifs, shared by every scene of the Kaiser video.
// An original stylised design in the puppet style (simple shapes), evoking the character through his
// signature details: side-swept blond hair that is blue underneath, blue eyes, a smirk, a blue rose
// on the neck; on the pitch a black-and-red kit with gold trim and blue boots (KAISER), off it a
// burgundy suit with a black shirt and olive tie (KAISER_SUIT), and for the throne a red fur-trimmed
// cape (drawCape). No lettering or real badges are drawn. Motifs: the blue rose, the crown, chains, the ball, manga speed lines.
//
//   import { KAISER, KAISER_SUIT, KZ, drawCape, drawRose, drawCrown, drawChain, drawBall, speedLines } from './lib/kaiser.mjs';
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
  suit: '#7A1E2C', suitDeep: '#4E1019', olive: '#7A8A2A', boot: '#2F5BFF',
  cape: '#B3122B', capeDeep: '#6E0A1A', fur: '#F4F1EA', furSpot: '#1A1A22',
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

// The hair: a smooth crown swept to one side, long locks to the jaw, and a fringe of three big
// pointed locks falling across the forehead from a part on the left. Blond on top, blue underneath.
function hairShape(ctx, r, side) {
  const s = side ? -0.14 * r : 0;
  const X = (v) => s + v * r, Y = (v) => v * r;
  ctx.beginPath();
  ctx.moveTo(X(-1.05), Y(0.86));
  ctx.quadraticCurveTo(X(-1.27), Y(0.4), X(-1.18), Y(-0.22));
  ctx.quadraticCurveTo(X(-1.06), Y(-1.2), X(0.2), Y(-1.26));
  ctx.quadraticCurveTo(X(1.12), Y(-1.16), X(1.2), Y(-0.15));
  ctx.quadraticCurveTo(X(1.28), Y(0.36), X(1.08), Y(0.82));
  for (const [x, y] of [[0.86, 0.26], [0.79, 0.45], [0.6, 0.08], [0.4, 0.47], [0.2, 0.1], [-0.04, 0.43], [-0.28, 0.02],
    [-0.55, 0.27], [-0.78, 0.05], [-0.92, 0.52]]) ctx.lineTo(X(x), Y(y));
  ctx.closePath();
}

function tailShape(ctx, r, side) {                       // the small blue tail at the nape
  const s = side ? -0.6 * r : 0.78 * r;
  ctx.beginPath();
  ctx.moveTo(s, 0.35 * r);
  ctx.quadraticCurveTo(s + 0.5 * r, 0.6 * r, s + 0.42 * r, 1.15 * r);
  ctx.quadraticCurveTo(s + 0.28 * r, 0.75 * r, s - 0.05 * r, 0.62 * r);
  ctx.closePath();
}

/** Kaiser's head (a custom puppet head): pointed chin, swept blond hair with blue tips, blue eyes, a smirk. */
export function kaiserHead({ rose = true } = {}) {
  return (ctx, r, info) => {
    const side = info.joints && info.joints.view === 'side';
    if (info.pass === 'outline') {
      tailShape(ctx, r, side); ctx.fill();
      faceShape(ctx, r, side); ctx.fill();
      hairShape(ctx, r, side); ctx.fill();
      return;
    }
    ctx.fillStyle = KZ.tipDeep;
    tailShape(ctx, r, side);
    ctx.fill();
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
    const grd = ctx.createLinearGradient(0, -1.3 * r, 0, 0.88 * r);
    grd.addColorStop(0, KZ.blondHi);
    grd.addColorStop(0.55, KZ.blond);
    grd.addColorStop(0.8, KZ.tip);
    grd.addColorStop(1, KZ.tipDeep);
    ctx.fillStyle = grd;
    hairShape(ctx, r, side);
    ctx.fill();
    // a few darker strands for texture
    ctx.strokeStyle = 'rgba(184,150,60,0.45)'; ctx.lineWidth = 0.04 * r;   // strands sweeping from the part
    ctx.beginPath();
    ctx.moveTo(-0.62 * r, -0.98 * r); ctx.quadraticCurveTo(0.1 * r, -0.85 * r, 0.6 * r, 0.05 * r);
    ctx.moveTo(-0.5 * r, -0.7 * r); ctx.quadraticCurveTo(-0.1 * r, -0.4 * r, 0.2 * r, 0.08 * r);
    ctx.stroke();
    // the blue rose on the neck
    if (rose && big) drawRose(ctx, (side ? -0.1 : 0.4) * r, 1.42 * r, 0.24 * r, { rot: 0.4 });
  };
}

const ATHLETE = { headR: 0.1, neck: 0.03, torso: 0.3, shoulderX: 0.09, upperArm: 0.165, foreArm: 0.155, hand: 0.024, thigh: 0.245, shin: 0.235, foot: 0.06, torsoW: 0.15, torsoSide: 0.11, armW: 0.048, legW: 0.058 };

function kitDetail(ctx, j, d, tw) {
  const [px, py] = j.pelvis, [nx, ny] = j.neck;
  const ax = nx - px, ay = ny - py, L = Math.hypot(ax, ay) || 1;
  const ux = ax / L, uy = ay / L, qx = -uy, qy = ux;
  const P = (along, across) => [px + ux * L * along + qx * tw * across, py + uy * L * along + qy * tw * across];
  const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  const front = j.view !== 'side';
  const w0 = front ? 0.2 : 0.12, c = front ? 0 : 0.22;
  poly([P(0.92, c - w0 - 0.04), P(0.92, c + w0 + 0.04), P(0.0, c + w0 + 0.08), P(0.0, c - w0 - 0.08)]);   // red front panel
  ctx.fillStyle = KZ.red; ctx.fill();
  ctx.strokeStyle = KZ.gold; ctx.lineWidth = Math.max(1, tw * 0.035);
  ctx.beginPath();                                                                                     // gold trim
  ctx.moveTo(...P(0.92, c - w0 - 0.04)); ctx.lineTo(...P(0.0, c - w0 - 0.08));
  ctx.moveTo(...P(0.92, c + w0 + 0.04)); ctx.lineTo(...P(0.0, c + w0 + 0.08));
  ctx.stroke();
  poly([P(1.0, c - 0.16), P(1.0, c + 0.16), P(0.84, c)]);                                               // V collar
  ctx.fillStyle = KZ.red; ctx.fill(); ctx.stroke();
  if (front) {                                                                                         // a gold crest
    const [bx, by] = P(0.74, 0.3);
    ctx.fillStyle = KZ.gold;
    ctx.beginPath(); ctx.moveTo(bx - tw * 0.05, by - tw * 0.06); ctx.lineTo(bx + tw * 0.05, by - tw * 0.06);
    ctx.lineTo(bx + tw * 0.05, by + tw * 0.02); ctx.lineTo(bx, by + tw * 0.08); ctx.lineTo(bx - tw * 0.05, by + tw * 0.02); ctx.closePath(); ctx.fill();
  }
}

/** The Emperor on the pitch: black jersey with a red front panel and gold trim, red sleeves, black
 *  shorts and socks, blue boots. */
export const KAISER = design({
  ...ATHLETE, id: 'kaiser', height: 300, torsoShape: 'inv',
  fill: KZ.black, armFill: KZ.red, legFill: KZ.black, footFill: KZ.boot, headFill: KZ.skin, head: kaiserHead(),
  torsoDetail: kitDetail, outline: KZ.ink, outlineW: 3, farShade: 0.72,
});

/**
 * The suit (the emperor off the pitch): burgundy jacket and trousers, black shirt, olive tie, black
 * shoes. Drawn over the torso from the solved joints, so it follows every pose.
 */
function suitDetail(ctx, j, d, tw) {
  const [px, py] = j.pelvis, [nx, ny] = j.neck;
  const ax = nx - px, ay = ny - py, L = Math.hypot(ax, ay) || 1;
  const ux = ax / L, uy = ay / L;                        // up the spine
  const qx = -uy, qy = ux;                               // across the chest
  const P = (along, across) => [px + ux * L * along + qx * tw * across, py + uy * L * along + qy * tw * across];
  const front = j.view !== 'side';
  const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  if (front) {
    poly([P(1.0, -0.2), P(1.0, 0.2), P(0.42, 0.03), P(0.42, -0.03)], KZ.black);        // the shirt's V
    poly([P(0.95, -0.035), P(0.95, 0.035), P(0.5, 0.05), P(0.42, 0), P(0.5, -0.05)], KZ.olive);  // the tie
    poly([P(1.0, -0.2), P(0.42, -0.03), P(0.62, -0.3)], KZ.suitDeep);                   // lapels
    poly([P(1.0, 0.2), P(0.42, 0.03), P(0.62, 0.3)], KZ.suitDeep);
    ctx.fillStyle = KZ.gold;                                                           // a crest pin
    const [bx, by] = P(0.78, 0.3);
    ctx.beginPath(); ctx.arc(bx, by, tw * 0.05, 0, Math.PI * 2); ctx.fill();
  } else {
    poly([P(1.0, 0.25), P(1.0, 0.45), P(0.55, 0.42)], KZ.black);
    poly([P(0.95, 0.4), P(0.95, 0.47), P(0.5, 0.46), P(0.5, 0.41)], KZ.olive);
  }
}

/** The Emperor in his burgundy suit. */
export const KAISER_SUIT = design({
  ...ATHLETE, id: 'kaiser-suit', height: 300, torsoShape: 'inv',
  fill: KZ.suit, armFill: KZ.suit, legFill: KZ.suit, footFill: KZ.black, headFill: KZ.skin, head: kaiserHead(),
  torsoDetail: suitDetail, outline: KZ.ink, outlineW: 3, farShade: 0.72,
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

/**
 * The emperor's cape: deep red with a gold hem pattern and a white fur collar with black ermine
 * spots, hanging from the shoulders of solved joints j (puppet.solve). Draw it BEFORE the puppet so
 * it falls behind him. wind (-1..1) blows it sideways; t animates the hem's ripple; length is in body
 * heights; collarOnly draws just the fur collar (draw that AFTER the puppet so it sits over the shirt).
 */
export function drawCape(ctx, j, { t = 0, wind = 0.3, length = 0.62, color = KZ.cape, deep = KZ.capeDeep, fur = KZ.fur, spot = KZ.furSpot,
  gold = KZ.gold, collarOnly = false, alpha = 1 } = {}) {
  const U = j.U;
  const [lx, ly] = j.shoulderL, [rx, ry] = j.shoulderR;
  const cx = (lx + rx) / 2, cy = (ly + ry) / 2;
  const half = Math.max(Math.abs(rx - lx) / 2, U * 0.09) + U * 0.05;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (!collarOnly) {
    const bottom = cy + U * length, spread = U * (0.24 + 0.06 * Math.abs(wind));
    const sway = wind * U * 0.16;
    const N = 8;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy);
    ctx.quadraticCurveTo(cx - half - spread * 0.6 + sway * 0.4, cy + U * length * 0.5, cx - half - spread + sway, bottom);
    for (let i = 1; i <= N; i++) {                       // the rippling hem
      const u = i / N;
      const x = cx - half - spread + sway + (2 * (half + spread)) * u;
      const y = bottom + Math.sin(u * Math.PI * 3 + t * 2.2) * U * 0.018 + (u < 0.5 ? 0 : U * 0.01);
      ctx.lineTo(x, y);
    }
    ctx.quadraticCurveTo(cx + half + spread * 0.6 + sway * 0.4, cy + U * length * 0.5, cx + half, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - half - spread, 0, cx + half + spread, 0);
    g.addColorStop(0, deep); g.addColorStop(0.5, color); g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, U * 0.008); ctx.strokeStyle = KZ.ink; ctx.stroke();
    ctx.fillStyle = gold;                                // a band of gold crowns along the hem
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.5) / 9;
      const x = cx - half - spread + sway + (2 * (half + spread)) * u;
      ctx.beginPath(); ctx.arc(x, bottom - U * 0.04, U * 0.008, 0, TAU); ctx.fill();
    }
  }
  // the fur collar with ermine spots
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(cx, cy + U * 0.01, half + U * 0.03, U * 0.05, 0, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(1, U * 0.006); ctx.strokeStyle = KZ.ink; ctx.stroke();
  ctx.fillStyle = spot;
  for (let i = 0; i < 7; i++) {
    const u = (i + 0.5) / 7;
    ctx.beginPath(); ctx.ellipse(cx - half + 2 * half * u, cy + U * 0.012 + (i % 2 ? U * 0.012 : -U * 0.008), U * 0.005, U * 0.009, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
