// A3 Night city close-up (kzCity). Kaiser's face in a big three-quarter close-up (KAISER_SUIT, placed
// with puppet.solve), lit by the cold glow of a phone held near his cheek, the blue rose on his neck
// glowing, and behind him a night city melted into drifting bokeh and rain. Story beats come from P:
// a sniper line, a light-speed beat, chain and crown icons glowing over his hand, a tilt up into
// the night sky, the beat returning (bokeh pulse on kicks), the city lights turning red, and a final
// freeze into a black-and-white manga cover. coverImage() and the head-path helpers are shared with
// kzPanels, whose first frame starts from the same cover.

import { KAISER_SUIT, KZ, drawRose, drawCrown, drawChain, speedLines } from './lib/kaiser.mjs';
import { solve, drawPuppet, poses, armTo } from './lib/puppet.mjs';
import { halftone, slam } from './lib/fx.mjs';
import { hashU } from './lib/worldkit.mjs';

export const meta = { type: 'kzCity', budgetMs: 150 };

// Times are seconds; a negative time means "no such beat" (coverT < 0 freezes the last two frames,
// drumsT < 0 falls back to the drums_active column).
export const defaults = {
  shootT: -1, lightT: -1, chainT: -1, crownT: -1, skyT: -1, drumsT: -1, armageddonT: -1, coverT: -1,
  bokehCount: 46, rainCount: 160,
};

const TAU = Math.PI * 2;
const W = 1920, H = 1080;
const FALLBACK = { night: '#050A24', bokehBlue: '#2E6BFF', bokehCyan: '#3DE0FF', bokehGold: '#FFD45A', bokehRed: '#E2364B', glow: '#DCEBFF', rose: '#2E6BFF' };
const INK = KZ.ink;
const D = KAISER_SUIT;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const outCubic = (v) => 1 - (1 - clamp01(v)) ** 3;
const inOut = (v) => { v = clamp01(v); return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2; };
const lerp = (a, b, u) => a + (b - a) * u;
const land = (T, fps) => Math.floor(T * fps + 0.5) / fps;

function paletteOf(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(FALLBACK)) o[k] = typeof p[k] === 'string' && p[k][0] === '#' ? p[k] : FALLBACK[k];
  return o;
}

/** Story beats, snapped to their landing frames (null = not in this treatment). */
function eventsOf(P, S, fps) {
  const get = (k) => (typeof P[k] === 'number' && Number.isFinite(P[k]) && P[k] >= 0 ? land(P[k], fps) : null);
  const E = { shoot: get('shootT'), light: get('lightT'), chain: get('chainT'), crown: get('crownT'), sky: get('skyT'),
    drums: get('drumsT'), arm: get('armageddonT'), cover: get('coverT') };
  if (E.cover === null) E.cover = Math.max(S.t0, land(S.t1, fps) - 2 / fps);
  return E;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) {
    v = make();
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }
  return v;
}

const mixCache = new Map();
function mixQ(g, a, b, u) {
  const q = Math.round(clamp01(u) * 12);
  if (q === 0) return a;
  if (q === 12) return b;
  const k = `${a}|${b}|${q}`;
  let v = mixCache.get(k);
  if (!v) { v = g.color.mix(a, b, q / 12); if (mixCache.size > 512) mixCache.clear(); mixCache.set(k, v); }
  return v;
}

function devCopy(dst, src, op = 'source-over', alpha = 1, dx = 0, dy = 0) {
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.globalCompositeOperation = op;
  dst.globalAlpha = alpha;
  dst.drawImage(src, dx, dy);
  dst.restore();
}

// ---------------------------------------------------------------------------------------------
// Head paths: the hair and face outlines, captured from the character's own head function with a
// recording context (so effects can be clipped to his hair without redrawing the design).

const headPathCache = new Map();
function headPaths(view) {
  let hp = headPathCache.get(view);
  if (hp) return hp;
  const fills = [];
  let cur = [];
  const grad = () => ({ gradient: true, addColorStop() {} });
  const rec = {
    fillStyle: null, strokeStyle: null, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {}, transform() {},
    beginPath() { cur = []; }, moveTo(x, y) { cur.push(['M', x, y]); }, lineTo(x, y) { cur.push(['L', x, y]); },
    quadraticCurveTo(a, b, c, d) { cur.push(['Q', a, b, c, d]); }, bezierCurveTo(a, b, c, d, e, f) { cur.push(['C', a, b, c, d, e, f]); },
    arc(...a) { cur.push(['A', ...a]); }, ellipse(...a) { cur.push(['E', ...a]); }, rect(...a) { cur.push(['R', ...a]); }, closePath() { cur.push(['Z']); },
    fill() { fills.push({ style: this.fillStyle, path: cur.slice() }); }, stroke() {},
    createLinearGradient: grad, createRadialGradient: grad,
  };
  const R0 = 100;
  if (typeof D.head === 'function') D.head(rec, R0, { pass: 'fill', joints: { view } });
  const scaleCmds = (cmds) => cmds && cmds.map(([k, ...a]) => {
    if (k === 'A') return [k, a[0] / R0, a[1] / R0, a[2] / R0, a[3], a[4], a[5]];
    if (k === 'E') return [k, a[0] / R0, a[1] / R0, a[2] / R0, a[3] / R0, a[4], a[5], a[6], a[7]];
    return [k, ...a.map((v) => v / R0)];
  });
  const hair = fills.find((f) => f.style && f.style.gradient);
  const face = fills.find((f) => f.style === KZ.skin);
  hp = { hair: hair ? scaleCmds(hair.path) : null, face: face ? scaleCmds(face.path) : null };
  headPathCache.set(view, hp);
  return hp;
}

/**
 * Trace one of his head outlines ('hair' or 'face') as the current path, in screen space, for solved
 * joints j. Returns false when the design has no such shape. Shared with kzPanels.
 */
export function traceHead(ctx, j, which = 'hair') {
  const cmds = headPaths(j.view === 'side' ? 'side' : 'front')[which];
  if (!cmds) return false;
  const r = D.headR * j.U;
  ctx.save();
  ctx.translate(j.headC[0], j.headC[1]);
  ctx.rotate(j.headAng);
  if (j.facing < 0) ctx.scale(-1, 1);
  ctx.scale(r, r);
  ctx.beginPath();
  for (const [k, ...a] of cmds) {
    if (k === 'M') ctx.moveTo(a[0], a[1]);
    else if (k === 'L') ctx.lineTo(a[0], a[1]);
    else if (k === 'Q') ctx.quadraticCurveTo(a[0], a[1], a[2], a[3]);
    else if (k === 'C') ctx.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
    else if (k === 'A') ctx.arc(a[0], a[1], a[2], a[3], a[4], a[5]);
    else if (k === 'E') ctx.ellipse(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
    else if (k === 'R') ctx.rect(a[0], a[1], a[2], a[3]);
    else if (k === 'Z') ctx.closePath();
  }
  ctx.restore();   // the path survives restore, with the transform it was built under baked in
  return true;
}

// ---------------------------------------------------------------------------------------------
// The shots: where his head sits (centre hx, hy; head radius r) and which way he looks.

const SHOTS = {
  open: { view: 'side', hx: 1160, hy: 452, r: 282 },
  close: { view: 'side', hx: 1185, hy: 490, r: 322 },
  icons: { view: 'side', hx: 1275, hy: 470, r: 290 },
  front: { view: 'front', hx: 1060, hy: 470, r: 300 },
};
/** The cover pose: the frame freezes on exactly this shot (kzPanels starts from it too). */
export const COVER_SHOT = { view: 'front', hx: 990, hy: 478, r: 316, head: 0.07 };
/** The cover's bold border (logical px), for the hand-off into the panels. */
export const COVER_FRAME = { x: 36, y: 36, w: W - 72, h: H - 72, line: 16 };

function shotAt(t, E, S, beat) {
  // keys: [time, shot, blend seconds]; a change of view switches instantly (hidden by the sky tilt)
  const swap = E.sky !== null ? E.sky + 0.42 : E.drums !== null ? E.drums : E.arm;
  const keys = [[S.t0, SHOTS.open, 0]];
  if (E.light !== null) keys.push([E.light, SHOTS.close, beat * 0.9]);
  if (E.chain !== null) keys.push([E.chain, SHOTS.icons, 0.3]);
  if (swap !== null) keys.push([swap, SHOTS.front, 0]);
  if (E.arm !== null && E.arm < E.cover) keys.push([E.arm, COVER_SHOT, Math.max(0.2, E.cover - E.arm)]);
  else keys.push([E.cover - 0.6, COVER_SHOT, 0.6]);
  keys.sort((a, b) => a[0] - b[0]);
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1][0] <= t) i++;
  const [tk, to, dur] = keys[i];
  const from = i > 0 ? keys[i - 1][1] : to;
  let u = dur > 0 ? (t - tk) / dur : 1;
  u = to === COVER_SHOT ? inOut(u) : outCubic(u);
  const same = from.view === to.view;
  const s = { view: to.view, hx: same ? lerp(from.hx, to.hx, u) : to.hx, hy: same ? lerp(from.hy, to.hy, u) : to.hy, r: same ? lerp(from.r, to.r, u) : to.r };
  if (to === SHOTS.open) {                                // a slow push-in on the opening shot
    const end = E.light !== null ? E.light : E.cover;
    const p = smooth((t - S.t0) / Math.max(1, end - S.t0));
    s.r *= 1 + 0.05 * p;
    s.hy += 10 * p;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// The figure: pose, the arm holding the phone, lighting.

function figureState(t, F, shot, frozen) {
  const st = { ...shot };
  const front = st.view === 'front';
  st.facing = front ? 1 : -1;
  st.scale = st.r / (D.headR * D.height);
  const U = D.height * st.scale;
  st.U = U;
  const k = frozen ? 0 : 1;
  const wob = (f, ph) => Math.sin(t * f + ph) * k;
  const word = frozen ? 0 : (F.c.word_on || 0);
  st.head = front ? COVER_SHOT.head + 0.025 * wob(1.1, 0.4) : 0.2 + 0.04 * wob(1.3, 0) + 0.05 * word;
  st.hx += 5 * wob(0.55, 1.0);
  st.hy += 4 * wob(0.8, 2.0) - 4 * word;
  const pose = { ...poses.stand, head: st.head, sL: 0.12, sR: 0.12, eL: 0.2, eR: 0.2 };
  const j0 = solve(D, pose, { x: 0, y: 0, scale: st.scale, view: st.view, facing: st.facing });
  st.x = st.hx - j0.headC[0];
  st.y = st.hy - j0.headC[1];
  // the hand holding the phone near the cheek (screen left of the face, low); the elbow hangs down
  const r = st.r;
  const lr = front ? 'L' : 'R';
  const target = front ? [st.hx - 1.16 * r, st.hy + 1.42 * r] : [st.hx - 1.02 * r, st.hy + 1.4 * r];
  const jb = solve(D, pose, { x: st.x, y: st.y, scale: st.scale, view: st.view, facing: st.facing });
  const sh = jb[`shoulder${lr}`];
  let dx = ((target[0] - sh[0]) / U) * st.facing;
  const dy = (target[1] - sh[1]) / U;
  if (front && lr === 'L') dx = -dx;
  const a = armTo(D, dx, dy, 0, 1);
  pose[`s${lr}`] = a.s; pose[`e${lr}`] = a.e;
  st.pose = pose;
  st.lr = lr;
  const j = solve(D, pose, { x: st.x, y: st.y, scale: st.scale, view: st.view, facing: st.facing });
  st.j = j;
  st.hand = j[`wrist${lr}`];
  // the phone: a slab rising from the hand, tilted towards his face
  st.phoneRot = front ? 0.16 : -0.26;
  st.phoneW = 0.54 * r; st.phoneH = 1.0 * r;
  const ph = st.phoneH * 0.38;
  st.phone = [st.hand[0] + Math.sin(st.phoneRot) * ph, st.hand[1] - Math.cos(st.phoneRot) * ph];
  // the rose on the neck and the visible eye in screen space (the head's own frame: rotated, mirrored)
  const toScreen = (lx, ly) => {
    const c = Math.cos(j.headAng), s = Math.sin(j.headAng), x = st.facing * lx;
    return [j.headC[0] + x * c - ly * s, j.headC[1] + x * s + ly * c];
  };
  st.rose = toScreen((front ? 0.4 : -0.1) * r, 1.42 * r);
  st.eye = toScreen((front ? -0.38 : 0.42) * r + 0.03 * r, 0.52 * r);
  return st;
}

function applyCam(c, cam) {
  c.translate(cam.cx + cam.dx, cam.cy + cam.dy);
  if (cam.rot) c.rotate(cam.rot);
  c.scale(cam.s, cam.s);
  c.translate(-cam.cx, -cam.cy);
}

/** A small offscreen canvas at 1/k of the device size, cleared and pre-scaled to logical px. */
const smalls = new Map();
function smallLayer(g, name, k) {
  const w = Math.max(1, Math.round(g.devW / k)), h = Math.max(1, Math.round(g.devH / k));
  const key = `${name}|${w}x${h}`;
  let L = smalls.get(key);
  if (!L) { const c = g.createCanvas(w, h); L = { canvas: c, ctx: c.getContext('2d'), w, h }; smalls.set(key, L); }
  const x = L.ctx;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.clearRect(0, 0, w, h);
  x.setTransform(w / W, 0, 0, h / H, 0, 0);
  return L;
}

/**
 * The lit figure: drawn into a layer, then shaded with a quarter-resolution multiply map (a cool
 * night tint, a soft falloff away from the phone, the body sinking into the dark, a curved cel
 * shadow), lifted by the phone's cold light (overlay keeps the ink black), clipped back to the
 * silhouette, and rimmed by the city lights behind him (half resolution). Returns the layer.
 */
function drawFigure(g, st, cam, light) {
  const L = g.layer('kzCityFig');
  const c = L.ctx;
  c.save();
  applyCam(c, cam);
  drawPuppet(c, D, st.pose, { x: st.x, y: st.y, scale: st.scale, view: st.view, facing: st.facing, outlineW: 1.6, devScale: g.scale });
  c.restore();
  const M = g.layer('kzCityMask');
  devCopy(M.ctx, L.canvas, 'copy');
  const r = st.r, hx = st.hx, hy = st.hy;
  // the multiply map, at a quarter of the resolution (smooth, cheap)
  const Sm = smallLayer(g, 'shade', 4);
  const s = Sm.ctx;
  s.fillStyle = light.ambient;
  s.fillRect(0, 0, W, H);
  s.save();
  applyCam(s, cam);
  s.globalCompositeOperation = 'multiply';
  const big = [-W, -H, 3 * W, 3 * H];
  const gr = s.createLinearGradient(hx - 1.3 * r, hy + 0.7 * r, hx + 1.3 * r, hy - 0.7 * r);
  gr.addColorStop(0, '#FFFFFF');
  gr.addColorStop(1, light.far);
  s.fillStyle = gr;
  s.fillRect(...big);
  const gb = s.createLinearGradient(0, hy + 1.1 * r, 0, hy + 3.0 * r);
  gb.addColorStop(0, '#FFFFFF');
  gb.addColorStop(1, light.body);
  s.fillStyle = gb;
  s.fillRect(...big);
  const lx = st.view === 'front' ? hx - 0.62 * r : hx - 0.75 * r;
  s.beginPath();
  s.rect(...big);
  s.ellipse(lx, hy + 0.3 * r, 1.32 * r, 1.9 * r, st.view === 'front' ? -0.2 : -0.1, 0, TAU, true);
  s.fillStyle = light.cel;
  s.fill('evenodd');
  s.restore();
  // the figure's bounds on screen (device px): everything below the hair line
  const bx0 = Math.max(0, (hx - 2.2 * r - W / 2) * cam.s + W / 2 + cam.dx), by0 = Math.max(0, (hy - 1.6 * r - H / 2) * cam.s + H / 2 + cam.dy);
  const bx1 = Math.min(W, (hx + 1.8 * r - W / 2) * cam.s + W / 2 + cam.dx);
  const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, H - by0);
  c.save();
  c.setTransform(g.scale, 0, 0, g.scale, 0, 0);
  c.globalCompositeOperation = 'multiply';
  c.imageSmoothingEnabled = true;
  c.drawImage(Sm.canvas, (bx0 / W) * Sm.w, (by0 / H) * Sm.h, (bw / W) * Sm.w, (bh / H) * Sm.h, bx0, by0, bw, bh);
  c.restore();
  // the phone's cold light on the near side of his face (overlay keeps the ink lines black)
  c.save();
  applyCam(c, cam);
  const [px, py] = st.phone;
  c.globalCompositeOperation = 'overlay';
  const gw = c.createRadialGradient(px, py, 0.1 * r, px, py, 1.9 * r);
  gw.addColorStop(0, g.color.css(light.phone, 0.95 * light.phoneK));
  gw.addColorStop(0.45, g.color.css(light.phone, 0.5 * light.phoneK));
  gw.addColorStop(1, g.color.css(light.phone, 0));
  c.fillStyle = gw;
  c.fillRect(px - 1.9 * r, py - 1.9 * r, 3.8 * r, 3.8 * r);
  c.globalCompositeOperation = 'screen';
  const gs = c.createRadialGradient(px, py, 0.1 * r, px, py, 1.0 * r);
  gs.addColorStop(0, g.color.css(light.phone, 0.3 * light.phoneK));
  gs.addColorStop(1, g.color.css(light.phone, 0));
  c.fillStyle = gs;
  c.fillRect(px - 1.0 * r, py - 1.0 * r, 2.0 * r, 2.0 * r);
  // a soft sheen across the crown of his hair (clipped to the hair)
  if (light.sheenK > 0.01 && traceHead(c, st.j, 'hair')) {
    c.save();
    c.clip();
    const [hcx, hcy] = st.j.headC;
    const ox = st.view === 'front' ? -0.1 * r : -0.25 * r;
    const sg = c.createRadialGradient(hcx + ox, hcy - 0.2 * r, 0.62 * r, hcx + ox, hcy - 0.2 * r, 1.05 * r);
    sg.addColorStop(0, g.color.css(light.sheen, 0));
    sg.addColorStop(0.55, g.color.css(light.sheen, 0.5 * light.sheenK));
    sg.addColorStop(0.8, g.color.css(light.sheen, 0.12 * light.sheenK));
    sg.addColorStop(1, g.color.css(light.sheen, 0));
    c.fillStyle = sg;
    c.beginPath();
    c.moveTo(hcx + ox, hcy - 0.2 * r);
    c.arc(hcx + ox, hcy - 0.2 * r, 1.1 * r, Math.PI * 1.05, Math.PI * 1.62);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.restore();
  devCopy(c, M.canvas, 'destination-in');
  if (light.rimK > 0.01) {                              // rim: the silhouette minus a shifted copy
    const R = smallLayer(g, 'rim', 2);
    const rc = R.ctx;
    rc.setTransform(1, 0, 0, 1, 0, 0);
    rc.drawImage(M.canvas, 0, 0, R.w, R.h);
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = light.rim;
    rc.fillRect(0, 0, R.w, R.h);
    rc.globalCompositeOperation = 'destination-out';
    const sc = (cam.s * R.w) / W;
    rc.drawImage(M.canvas, -light.rimDx * sc, light.rimDy * sc, R.w, R.h);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = light.rimK;
    c.globalCompositeOperation = 'source-atop';
    c.imageSmoothingEnabled = true;
    c.drawImage(R.canvas, 0, 0, g.devW, g.devH);
    c.restore();
  }
  devCopy(g.ctx, L.canvas);
  return L;
}

/** The hand again, over the phone (the phone sits in his grip). */
function drawHandOver(g, st, L) {
  const { ctx } = g;
  const [wx, wy] = st.hand;
  const el = st.j[`elbow${st.lr}`];
  const ang = Math.atan2(el[1] - wy, el[0] - wx);
  const hr = D.hand * st.U + 3 * st.scale;
  const aw = D.armW * st.U * 0.5 + 3 * st.scale;
  const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(wx, wy, hr, 0, TAU);
  ctx.moveTo(wx + nx * aw, wy + ny * aw);
  ctx.lineTo(wx + Math.cos(ang) * 400 + nx * aw, wy + Math.sin(ang) * 400 + ny * aw);
  ctx.lineTo(wx + Math.cos(ang) * 400 - nx * aw, wy + Math.sin(ang) * 400 - ny * aw);
  ctx.lineTo(wx - nx * aw, wy - ny * aw);
  ctx.closePath();
  ctx.clip('nonzero');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(L.canvas, 0, 0);
  ctx.restore();
}

function drawPhone(ctx, st, g, pal, k, mono = false) {
  const [x, y] = st.phone;
  const w = st.phoneW, h = st.phoneH;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(st.phoneRot);
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.roundRect(-w / 2 - 10, -h / 2 - 10, w + 20, h + 20, w * 0.2); ctx.fill();
  const gr = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  if (mono) { gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(1, '#E4E6EE'); }
  else {
    gr.addColorStop(0, g.color.mix('#FFFFFF', pal.glow, 0.6));
    gr.addColorStop(0.55, g.color.mix(pal.glow, pal.bokehCyan, 0.25));
    gr.addColorStop(1, g.color.mix(pal.glow, pal.bokehBlue, 0.6));
  }
  ctx.globalAlpha = 0.5 + 0.5 * k;
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, w * 0.14); ctx.fill();
  // an abstract wallpaper: a soft blue rose (no text, no icons)
  ctx.globalAlpha = (0.5 + 0.5 * k) * (mono ? 0.35 : 0.5);
  drawRose(ctx, 0, -h * 0.1, w * 0.27, mono ? { color: '#9AA0B0', deep: '#5A6070', hi: '#FFFFFF', rot: 0.3 } : { color: pal.rose, deep: KZ.roseDeep, hi: '#FFFFFF', rot: 0.3 });
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The city behind him: a cached out-of-focus skyline, drifting bokeh, rain, and the sky above.

/** A device-size canvas holding a vertical gradient (the engine dithers the final frame). */
function gradientCanvas(g, w, h, stops) {
  const c = g.createCanvas(w, h);
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, h);
  for (const [p, hex] of stops) gr.addColorStop(p, hex);
  x.fillStyle = gr;
  x.fillRect(0, 0, w, h);
  return c;
}

/** The out-of-focus skyline (device size, cached per scale and palette). */
function skyline(g, pal) {
  return cached(`skyline|${g.scale}|${pal.night}|${pal.bokehBlue}|${pal.bokehGold}|${pal.bokehCyan}|${pal.bokehRed}`, () => {
    const dw = Math.round(W * g.scale), dh = Math.round(H * g.scale);
    const mid = g.color.mix(pal.night, pal.bokehBlue, 0.14), low = g.color.mix(pal.night, pal.bokehBlue, 0.28);
    const c = gradientCanvas(g, dw, dh, [[0, pal.night], [0.5, mid], [1, low]]);
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    const towers = [];
    for (let i = 0; i < 16; i++) {
      const w = 90 + 190 * hashU(5, i, 1), cx = -80 + (i + hashU(5, i, 2) * 0.8) * 130;
      towers.push([cx, 160 + 500 * hashU(5, i, 3), w]);
    }
    // towers and their lit windows are drawn sharp on a scratch canvas, then laid in blurred
    const sc = g.createCanvas(dw, dh);
    const sx = sc.getContext('2d');
    sx.scale(g.scale, g.scale);
    sx.fillStyle = g.color.mix(pal.night, '#000000', 0.3);
    sx.beginPath();
    for (const [cx, tp, w] of towers) sx.rect(cx - w / 2, tp, w, H - tp + 40);
    sx.fill();
    x.filter = `blur(${(16 * g.scale).toFixed(1)}px)`;
    x.drawImage(sc, 0, 0, W, H);
    sx.clearRect(0, 0, W, H);
    const wins = [[], [], []];
    towers.forEach(([cx, tp, w], i) => {
      for (let yy = tp + 24; yy < H; yy += 30) {
        for (let xx = cx - w / 2 + 14; xx < cx + w / 2 - 14; xx += 24) {
          const h = hashU(9, i * 977 + Math.round(xx), Math.round(yy));
          if (h < 0.3) wins[h < 0.1 ? 0 : h < 0.2 ? 1 : 2].push([xx, yy]);
        }
      }
    });
    [[pal.bokehGold, 0.5], [pal.glow, 0.3], [pal.bokehCyan, 0.26]].forEach(([col, al], k) => {
      sx.fillStyle = g.color.css(col, al);
      sx.beginPath();
      for (const [xx, yy] of wins[k]) sx.rect(xx, yy, 9, 13);
      sx.fill();
    });
    x.filter = `blur(${(5 * g.scale).toFixed(1)}px)`;
    x.drawImage(sc, 0, 0, W, H);
    x.filter = `blur(${(22 * g.scale).toFixed(1)}px)`;
    for (let i = 0; i < 7; i++) {                       // blurred neon blocks (no lettering)
      x.fillStyle = g.color.css([pal.bokehCyan, pal.bokehRed, pal.bokehBlue, pal.bokehGold][i % 4], 0.4);
      x.fillRect(120 + hashU(13, i, 1) * 1700, 420 + hashU(13, i, 2) * 500, 60 + 120 * hashU(13, i, 3), 26 + 50 * hashU(13, i, 4));
    }
    x.filter = 'none';
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

const MOON = { x: 1240, y: 760, r: 290 };

/** The night sky above the city for the tilt: stars and a huge moon (device size, cached). */
function nightSky(g, pal) {
  return cached(`moon|${g.scale}|${pal.night}|${pal.glow}|${pal.bokehBlue}`, () => {
    const dw = Math.round(W * g.scale), dh = Math.round(H * g.scale);
    const deep = g.color.mix(pal.night, '#000000', 0.5);
    const c = gradientCanvas(g, dw, dh, [[0, deep], [0.7, pal.night], [1, pal.night]]);
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    for (let i = 0; i < 460; i++) {
      const sx = hashU(17, i, 1) * W, sy = hashU(17, i, 2) * H, m = hashU(17, i, 3);
      x.fillStyle = `rgba(230,238,255,${(0.2 + 0.65 * m * m).toFixed(3)})`;
      x.beginPath(); x.arc(sx, sy, 0.6 + 1.7 * m * m * m, 0, TAU); x.fill();
    }
    const { x: mx, y: my, r: mr } = MOON;
    const halo = x.createRadialGradient(mx, my, mr * 0.95, mx, my, mr * 2.1);
    halo.addColorStop(0, g.color.css(pal.glow, 0.3));
    halo.addColorStop(0.45, g.color.css(pal.bokehBlue, 0.08));
    halo.addColorStop(1, g.color.css(pal.bokehBlue, 0));
    x.fillStyle = halo;
    x.fillRect(0, 0, W, H);
    const body = x.createRadialGradient(mx - mr * 0.3, my - mr * 0.35, mr * 0.1, mx, my, mr);
    body.addColorStop(0, '#FFFFFF');
    body.addColorStop(0.6, g.color.mix('#FFFFFF', pal.glow, 0.75));
    body.addColorStop(1, g.color.mix(pal.glow, pal.bokehBlue, 0.22));
    x.fillStyle = body;
    x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
    x.save();
    x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.clip();
    x.filter = `blur(${(3 * g.scale).toFixed(1)}px)`;
    for (let i = 0; i < 16; i++) {
      const a = hashU(19, i, 1) * TAU, d = Math.sqrt(hashU(19, i, 2)) * mr * 0.85, cr = mr * (0.04 + 0.14 * hashU(19, i, 3));
      x.fillStyle = g.color.css(g.color.mix(pal.glow, pal.bokehBlue, 0.55), 0.2 + 0.15 * hashU(19, i, 4));
      x.beginPath(); x.arc(mx + Math.cos(a) * d, my + Math.sin(a) * d, cr, 0, TAU); x.fill();
    }
    x.filter = 'none';
    const sh = x.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr);   // the terminator
    sh.addColorStop(0.5, g.color.css(pal.night, 0));
    sh.addColorStop(1, g.color.css(pal.night, 0.5));
    x.fillStyle = sh;
    x.fillRect(mx - mr, my - mr, 2 * mr, 2 * mr);
    x.restore();
    x.filter = `blur(${(14 * g.scale).toFixed(1)}px)`;   // thin cloud wisps across the moon
    x.fillStyle = g.color.css(pal.night, 0.6);
    x.beginPath(); x.ellipse(mx - 60, my + 110, 520, 16, -0.04, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(mx + 120, my + 190, 380, 11, -0.03, 0, TAU); x.fill();
    x.filter = 'none';
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

function bokehField(n, seed) {
  return cached(`bk|${n}|${seed}`, () => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = hashU(seed, i, 1);
      const band = u < 0.52 ? 0 : u < 0.83 ? 1 : 2;          // far, mid, near
      const z = band === 0 ? 0.1 + 0.3 * hashU(seed, i, 9) : band === 1 ? 0.45 + 0.25 * hashU(seed, i, 9) : 0.8 + 0.2 * hashU(seed, i, 9);
      const r = band === 0 ? 22 + 30 * hashU(seed, i, 2) : band === 1 ? 62 + 50 * hashU(seed, i, 2) : 140 + 90 * hashU(seed, i, 2);
      const y = 60 + 960 * (0.18 + 0.82 * hashU(seed, i, 4)) ** 0.85;
      const c = hashU(seed, i, 5);
      out.push({ i, z, band, r, x0: hashU(seed, i, 3), y, col: c < 0.4 ? 'bokehBlue' : c < 0.62 ? 'bokehCyan' : c < 0.9 ? 'bokehGold' : 'bokehRed',
        vx: (hashU(seed, i, 6) - 0.5) * 30 * (0.4 + z), ph: hashU(seed, i, 7) * TAU, f: 0.4 + 0.9 * hashU(seed, i, 8) });
    }
    out.sort((a, b) => a.z - b.z);
    return out;
  });
}

const BAND_ALPHA = [0.85, 0.5, 0.24];
const BAND_EDGE = [0.07, 0.12, 0.22];

function drawBokeh(g, t, pal, list, o) {
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of list) {
    const span = W + 2 * b.r + 200;
    const x = ((b.x0 * span + b.vx * t) % span + span) % span - b.r - 100;
    const y = b.y + o.camY * (0.5 + 0.3 * b.z) + 12 * Math.sin(t * 0.3 * b.f + b.ph);
    const tw = 0.8 + 0.2 * Math.sin(t * 1.7 * b.f + b.ph);
    let col = pal[b.col];
    if (o.red > 0) col = mixQ(g, col, b.col === 'bokehGold' ? '#FF7A3D' : pal.bokehRed, o.red);
    const r = b.r * (1 + o.kick * (0.2 + 0.18 * b.z)) * (1 + 0.3 * o.flare * (1 - b.z));
    let a = BAND_ALPHA[b.band] * tw * (1 + 0.7 * o.kick + 0.6 * o.flare) * o.level;
    if (o.warp > 0.001) {
      // light speed: each light stretches away from the vanishing point into a streak
      const dx = x - o.vx, dy = y - o.vy, dist = Math.hypot(dx, dy) || 1;
      const len = o.warp * (260 + 1.2 * dist) * (0.6 + 0.6 * b.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.globalAlpha = Math.min(1, a * 1.8);
      const th = Math.max(4, r * (1 - 0.8 * o.warp) * 0.7);
      ctx.drawImage(g.sprites.streak(col), -len, -th, len + r * (1 - o.warp) + 8, 2 * th);
      ctx.restore();
      a *= 1 - o.warp;
      if (a < 0.05) continue;
    }
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(g.sprites.bokeh(col, BAND_EDGE[b.band], 0.4), x - r, y - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

function drawRain(g, t, n, seed, o) {
  const { ctx } = g;
  const slant = 0.16;
  ctx.save();
  ctx.lineCap = 'round';
  const paths = [[], [], []];
  for (let i = 0; i < n; i++) {
    const z = hashU(seed, i, 1);
    const v = 1500 + 1300 * z;
    const len = (36 + 110 * z) * o.stretch;
    const span = H + 300;
    const y = ((hashU(seed, i, 2) * span + v * t) % span) - 150;
    const x = hashU(seed, i, 3) * (W + 300) - 150 + (y - 540) * slant;
    paths[z < 0.4 ? 0 : z < 0.8 ? 1 : 2].push([x, y, len]);
  }
  const alphas = [0.13, 0.22, 0.32];
  const widths = [1.1, 1.7, 2.6].map((w) => w * (o.width || 1));
  paths.forEach((p, k) => {
    ctx.strokeStyle = g.color.css(o.color, alphas[k] * o.alpha);
    ctx.lineWidth = widths[k];
    ctx.beginPath();
    for (const [x, y, len] of p) { ctx.moveTo(x, y); ctx.lineTo(x - slant * len, y - len); }
    ctx.stroke();
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Story moments.

const SNIPE = { x0: W + 120, y0: 120, x1: -120, y1: 590, rx: 330 };

/** A white sniper line cracking across the frame, with a reticle snapping shut where it lands. */
function drawSniper(g, a, pal) {
  if (a < 0 || a > 1.0) return;
  const { ctx } = g;
  const { x0, y0, x1, y1 } = SNIPE;
  const p = outCubic((a + 0.045) / 0.12);              // already part-way across on its landing frame
  const fade = a < 0.1 ? 1 : Math.exp(-(a - 0.1) / 0.2);
  const hx = lerp(x0, x1, p), hy = lerp(y0, y1, p);
  const tail = a < 0.1 ? 0 : clamp01((a - 0.1) / 0.6);
  const tx = lerp(x0, x1, tail * tail), ty = lerp(y0, y1, tail * tail);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [wd, al] of [[40, 0.12], [16, 0.35], [5, 1]]) {
    ctx.strokeStyle = g.color.css(al === 1 ? '#FFFFFF' : pal.glow, al * fade);
    ctx.lineWidth = wd * (0.4 + 0.6 * fade);
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  }
  ctx.globalAlpha = fade;
  ctx.drawImage(g.sprites.glow('#FFFFFF', 1), hx - 130, hy - 130, 260, 260);
  ctx.restore();
  // the hit: a reticle snapping shut and a ring of light where the line passes it
  const { rx } = SNIPE;
  const ry = lerp(y0, y1, (rx - x0) / (x1 - x0));
  const ra = a - 0.03;
  if (ra > 0 && ra < 0.85) {
    const k = outCubic(ra / 0.12), f = 1 - smooth((ra - 0.45) / 0.4);
    const R = lerp(190, 66, k);
    ctx.save();
    ctx.globalAlpha = f;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(rx, ry, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(rx, ry, R * 0.55, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(rx + ux * R * 0.3, ry + uy * R * 0.3); ctx.lineTo(rx + ux * R * 1.4, ry + uy * R * 1.4); }
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const ring = outCubic(ra / 0.3);
    ctx.globalAlpha = (1 - ring) * 0.9;
    ctx.lineWidth = 10 * (1 - ring) + 1;
    ctx.strokeStyle = pal.glow;
    ctx.beginPath(); ctx.arc(rx, ry, 40 + 260 * ring, 0, TAU); ctx.stroke();
    ctx.globalAlpha = Math.exp(-ra / 0.08);
    ctx.drawImage(g.sprites.glow('#FFFFFF', 1), rx - 200, ry - 200, 400, 400);
    ctx.restore();
  }
}

/** Glowing icons over his hand: a chain (which snaps when the crown arrives), then a gold crown. */
function drawIcons(g, t, E, st, pal, lead) {
  const { ctx } = g;
  const ix = st.phone[0] - 0.95 * st.r, iy = st.phone[1] - 0.95 * st.r;
  const sinceC = E.chain !== null ? t - E.chain : -1;
  const sinceK = E.crown !== null ? t - E.crown : -1;
  const end = E.sky !== null ? E.sky : (E.crown ?? E.chain ?? 0) + 1.4;
  const glow = (col, x, y, w, h, a) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(g.sprites.glow(col, 0), x - w / 2, y - h / 2, w, h);
    ctx.restore();
  };
  if (sinceC >= 0 && t < end) {
    const s = slam(t + lead, E.chain, { attack: 0.05, peak: 1.3, hold: 1, decay: 0.12 });
    const broken = sinceK >= 0 ? clamp01(sinceK / 0.35) : 0;
    const a = (sinceK >= 0 ? 1 - smooth((sinceK - 0.15) / 0.3) : 1) * (0.8 + 0.2 * Math.exp(-sinceC / 0.15));
    if (a > 0.01) {
      glow(pal.bokehCyan, ix, iy, 700 * s, 420 * s, 0.8 * a);
      ctx.save();
      ctx.translate(ix, iy);
      ctx.scale(s, s);
      ctx.rotate(-0.06);
      drawChain(ctx, -240, -36, 240, -36, { sag: 54, link: 48, width: 11, color: '#E8F6FF', deep: g.color.mix(pal.bokehCyan, pal.bokehBlue, 0.4), broken, alpha: a });
      ctx.globalCompositeOperation = 'lighter';
      drawChain(ctx, -240, -36, 240, -36, { sag: 54, link: 48, width: 4, color: pal.bokehCyan, deep: pal.bokehCyan, broken, alpha: 0.6 * a });
      ctx.restore();
      glow('#FFFFFF', ix, iy, 460, 460, Math.exp(-sinceC / 0.07));
    }
  }
  if (sinceK >= 0 && t < end + 0.2) {
    const s = slam(t + lead, E.crown, { attack: 0.05, peak: 1.35, hold: 1, decay: 0.14 });
    const a = 1 - smooth((t - end + 0.1) / 0.3);
    const bob = 6 * Math.sin(sinceK * 5);
    const cy = iy + bob;
    ctx.save();                                         // slow rays behind the crown
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * a;
    ctx.translate(ix, cy - 20);
    ctx.rotate(sinceK * 0.4);
    ctx.fillStyle = pal.bokehGold;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const an = (i / 12) * TAU;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(an - 0.06) * 330 * s, Math.sin(an - 0.06) * 330 * s);
      ctx.lineTo(Math.cos(an + 0.06) * 330 * s, Math.sin(an + 0.06) * 330 * s);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
    glow(pal.bokehGold, ix, cy - 20, 720 * s, 620 * s, 0.95 * a);
    ctx.save();
    ctx.globalAlpha = a;
    drawCrown(ctx, ix, cy + 70 * s, 290 * s, { fill: pal.bokehGold, deep: KZ.goldDeep, ink: INK, jewel: pal.rose, lineW: 5 });
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {                      // sparkles drifting out from the crown
      const life = 0.6, ph = hashU(29, i, 1) * life;
      const age = ((sinceK + ph) % life) / life;
      const ang = hashU(29, i, 2) * TAU, d = 140 + 110 * age;
      const sx = ix + Math.cos(ang) * d * s, sy = cy - 40 + Math.sin(ang) * d * 0.7 * s;
      const sz = (1 - age) * 30;
      ctx.globalAlpha = a * (1 - age);
      ctx.drawImage(g.sprites.glow('#FFF4C8', 1), sx - sz, sy - sz, 2 * sz, 2 * sz);
    }
    ctx.restore();
    glow('#FFF6D8', ix, cy, 560, 560, Math.exp(-sinceK / 0.08));
  }
}

// ---------------------------------------------------------------------------------------------
// The manga cover: the frozen close-up in black and white with screentone and a bold border.

/** fx.halftone restricted to a box (logical px): amount gets frame coordinates. */
function boxTone(g, ctx, x0, y0, w, h, { cell, angle, min, color = INK }, amount) {
  ctx.save();
  ctx.translate(x0, y0);
  halftone({ ctx, W: w, H: h, scale: g.scale, createCanvas: g.createCanvas }, { cell, angle, color, min, w, h, amount: (px, py) => amount(px + x0, py + y0) });
  ctx.restore();
}

/** The manga cover (device-size canvas, cached per scale and palette). Shared with kzPanels. */
export function coverImage(g, palette = {}) {
  const pal = { ...FALLBACK, ...palette };
  return cached(`cover|${g.scale}|${pal.rose}|${pal.glow}`, () => {
    const dw = Math.round(W * g.scale), dh = Math.round(H * g.scale);
    const st = figureState(0, { c: {} }, { ...COVER_SHOT }, true);
    const r = st.r, j = st.j;
    const fig = g.createCanvas(dw, dh);
    const fx = fig.getContext('2d');
    fx.scale(g.scale, g.scale);
    drawPuppet(fx, D, st.pose, { x: st.x, y: st.y, scale: st.scale, view: st.view, facing: st.facing, outlineW: 1.6, devScale: g.scale });
    const c = g.createCanvas(dw, dh);
    const x = c.getContext('2d');
    x.scale(g.scale, g.scale);
    x.fillStyle = '#F4F5FA';
    x.fillRect(0, 0, W, H);
    const fr = COVER_FRAME;
    x.save();
    x.beginPath(); x.rect(fr.x, fr.y, fr.w, fr.h); x.clip();
    x.fillStyle = '#FFFFFF';
    x.fillRect(fr.x, fr.y, fr.w, fr.h);
    // focus lines bursting from behind his head; halftone discs where the city lights were
    speedLines(x, { cx: st.hx, cy: st.hy + 0.2 * r, n: 170, inner: 1.7 * r, outer: 1500, color: INK, alpha: 0.95, seed: 31, frame: 0, hold: 1, width: 0.011 });
    const discs = [[250, 260, 150], [540, 520, 90], [220, 760, 120], [1660, 250, 165], [1720, 700, 125], [1470, 130, 70], [430, 120, 80], [1560, 930, 90]];
    for (const [cx, cy, rr] of discs) boxTone(g, x, cx - rr, cy - rr, 2 * rr, 2 * rr, { cell: 12, angle: 0.5, min: 0.06 }, (px, py) => {
      const d = Math.hypot(px - cx, py - cy) / rr;
      return d < 1 ? 0.62 * (1 - d * d) + 0.18 : 0;
    });
    // the figure in high-contrast black and white
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'grayscale(1) contrast(3.2) brightness(1.06)';
    x.drawImage(fig, 0, 0);
    x.restore();
    // screentone over the far side of the face and the body, and a lighter tone on the hair
    const tone = g.createCanvas(dw, dh);
    const tx = tone.getContext('2d');
    tx.scale(g.scale, g.scale);
    const [hcx, hcy] = j.headC;
    const ca = Math.cos(-j.headAng), sa = Math.sin(-j.headAng);
    boxTone(g, tx, hcx - 2.4 * r, hcy - 1.5 * r, 4.6 * r, H - (hcy - 1.5 * r), { cell: 10, angle: 0.785, min: 0.05 }, (px, py) => {
      const lx = (px - hcx) * ca - (py - hcy) * sa, ly = (px - hcx) * sa + (py - hcy) * ca;
      const side = clamp01((lx + 0.05 * r) / (1.15 * r));
      const low = clamp01((ly - 1.2 * r) / (1.5 * r));
      return Math.max(0.1 + 0.66 * side * side, 0.18 + 0.5 * low);
    });
    devCopy(tx, fig, 'destination-in');
    devCopy(x, tone, 'source-over', 0.6);
    if (traceHead(x, j, 'hair')) {
      x.save();
      x.clip();
      const ht = g.createCanvas(dw, dh);
      const hx2 = ht.getContext('2d');
      hx2.scale(g.scale, g.scale);
      boxTone(g, hx2, hcx - 1.4 * r, hcy - 1.4 * r, 2.8 * r, 2.4 * r, { cell: 9, angle: 0.785, min: 0.05 }, (px, py) => {
        const lx = (px - hcx) * ca - (py - hcy) * sa, ly = (px - hcx) * sa + (py - hcy) * ca;
        return 0.18 + 0.32 * clamp01((lx + 0.2 * r) / (1.2 * r)) + 0.22 * clamp01(-ly / (1.2 * r));
      });
      devCopy(x, ht, 'source-over', 0.7);
      // ink strands sweeping from the parting
      x.strokeStyle = INK;
      x.lineCap = 'round';
      x.translate(hcx, hcy);
      x.rotate(j.headAng);
      for (const [ax, ay, bx, by, cx2, cy2, w] of [[-0.7, -1.0, 0.0, -0.8, 0.55, 0.1, 0.035], [-0.55, -0.72, -0.15, -0.4, 0.2, 0.12, 0.03],
        [-0.4, -1.12, 0.5, -0.9, 0.95, -0.05, 0.03], [-0.85, -0.55, -0.75, -0.1, -0.55, 0.2, 0.028], [0.1, -1.18, 0.8, -0.95, 1.08, 0.1, 0.026]]) {
        x.lineWidth = w * r;
        x.beginPath(); x.moveTo(ax * r, ay * r); x.quadraticCurveTo(bx * r, by * r, cx2 * r, cy2 * r); x.stroke();
      }
      x.restore();
      traceHead(x, j, 'hair');
      x.lineWidth = 0.035 * r;
      x.strokeStyle = INK;
      x.lineJoin = 'round';
      x.stroke();
    }
    // the phone stays a slab of white; the rose is the one spot of colour
    drawPhone(x, st, g, pal, 1, true);
    x.save();
    x.translate(hcx, hcy);
    x.rotate(j.headAng);
    drawRose(x, 0.4 * r, 1.42 * r, 0.24 * r, { rot: 0.4, color: pal.rose, deep: KZ.roseDeep, hi: '#FFFFFF' });
    x.restore();
    x.restore();
    x.lineWidth = fr.line;
    x.strokeStyle = INK;
    x.lineJoin = 'miter';
    x.strokeRect(fr.x, fr.y, fr.w, fr.h);
    x.getImageData(0, 0, 1, 1);
    return c;
  });
}

// ---------------------------------------------------------------------------------------------

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const fps = F.fps || 30;
  const pal = paletteOf(S);
  const E = eventsOf(P, S, fps);
  const beat = F.beatS || 0.4;
  const since = (T) => (T === null ? -1e9 : t - T + 1e-6);
  const lead = 1 / fps;                                  // envelopes lead by a frame: a hit shows on its own frame

  // the heavy cached layers are built together on a worker's first frame of this scene
  const cover = coverImage(g, pal);
  const skyImg = nightSky(g, pal), cityImg = skyline(g, pal);
  if (since(E.cover) >= 0) {                            // the freeze: a manga cover
    devCopy(ctx, cover);
    return;
  }

  const drumsOn = E.drums !== null ? since(E.drums) >= 0 : (F.c.drums_active || 0) > 0.5;
  const kick = drumsOn ? F.c.kick || 0 : 0;
  const swell = drumsOn ? kick : 0.4 * (F.c.bass_on || 0);  // no drums yet: the city breathes with the bass
  const bump = F.impulse('lines', 0.22, 99);                 // a small push on every new line of the verse

  // the tilt up into the sky and back down, landing on the beat's return when there is one
  let tilt = 0;
  if (E.sky !== null && since(E.sky) >= 0) {
    const a = since(E.sky);
    const back = E.drums !== null && E.drums > E.sky && E.drums - E.sky < 3 ? E.drums - E.sky : 1.25;
    const up = Math.min(0.36, back * 0.3), down = Math.min(0.42, back * 0.36);
    tilt = a >= back ? 0 : a < up ? outCubic(a / up) : a < back - down ? 1 : 1 - inOut((a - (back - down)) / down);
  }
  const camY = tilt * H * 1.02;

  const armA = since(E.arm);
  const red = armA >= 0 ? smooth((armA + lead) / 0.16) : 0;
  const armFlare = armA >= 0 ? Math.exp(-armA / 0.4) : 0;

  const la = since(E.light);
  const warp = la >= 0 && la < beat * 1.3 ? smooth((la + lead) / 0.07) * (1 - smooth((la - beat * 0.95) / (beat * 0.3))) : 0;

  const da = since(E.drums);
  const drop = da >= 0 ? Math.exp(-da / 0.3) : 0;
  const sa = since(E.shoot);
  const snap = sa >= 0 ? Math.exp(-sa / 0.12) : 0;

  // camera: shake from armageddon (and kicks under it), punch-ins on the warp, the shot and the drop
  const fr = F.frame;
  const shakeAmp = (armA >= 0 ? 18 * armFlare + 4 + 10 * kick : 0) + 8 * snap;
  const cam = { cx: W / 2, cy: H / 2, s: 1 + 0.07 * warp + 0.03 * drop + 0.015 * snap + 0.012 * bump, dx: shakeAmp * (hashU(fr, 3, 1) * 2 - 1), dy: shakeAmp * (hashU(fr, 3, 2) * 2 - 1),
    rot: armA >= 0 ? 0.006 * (armFlare + 0.3 * kick) * (hashU(fr, 3, 3) * 2 - 1) : 0 };

  const shot = shotAt(t, E, S, beat);
  const st = figureState(t, F, shot, false);

  ctx.save();
  applyCam(ctx, cam);

  // sky (only while tilting), then the skyline
  const skyOff = camY * 0.66;
  if (camY > 1) ctx.drawImage(skyImg, -40, skyOff - H - 41, W + 80, H + 2);
  ctx.drawImage(cityImg, -40, -40 + skyOff, W + 80, H + 80);
  if (camY > 1) {                                       // soften the seam between sky and skyline
    const sg = ctx.createLinearGradient(0, skyOff - 160, 0, skyOff + 60);
    sg.addColorStop(0, g.color.css(pal.night, 0));
    sg.addColorStop(0.6, g.color.css(pal.night, 0.9));
    sg.addColorStop(1, g.color.css(pal.night, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(-60, skyOff - 160, W + 120, 220);
  }
  if (red > 0) {
    const rg = ctx.createLinearGradient(0, 0, 0, H);
    rg.addColorStop(0, g.color.css('#2A0610', 0.55 * red));
    rg.addColorStop(1, g.color.css(pal.bokehRed, 0.3 * red + 0.25 * armFlare));
    ctx.fillStyle = rg;
    ctx.fillRect(-60, -60, W + 120, H + 120);
  }

  // bokeh and rain behind him
  const level = 0.8 + 0.2 * smooth((t - S.t0) / 0.3);
  drawBokeh(g, t, pal, bokehField(Math.round(P.bokehCount ?? 46), 41), { camY, red, kick: swell, flare: armFlare, warp, vx: st.hx, vy: st.hy, level });
  if (warp > 0.01) speedLines(ctx, { cx: st.hx, cy: st.hy, n: 120, inner: 1.7 * st.r, outer: 1700, color: '#FFFFFF', alpha: 0.4 * warp, seed: 77, frame: fr, hold: 1, width: 0.006 });
  if (drop > 0.02) speedLines(ctx, { cx: st.hx, cy: st.hy, n: 90, inner: 1.9 * st.r, outer: 1700, color: pal.glow, alpha: 0.55 * drop, seed: 78, frame: fr, hold: 2, width: 0.008 });
  const rainCol = red > 0 ? mixQ(g, '#D6E6FF', '#FFB3BD', red) : '#D6E6FF';
  const rainN = Math.round(P.rainCount ?? 160);
  const moving = tilt > 0.02 && tilt < 0.98 ? 1 : 0;   // rain smears while the camera swings
  drawRain(g, t, Math.round(rainN * 0.6), 51, { alpha: 0.85, stretch: 1 + 2.5 * warp + 1.5 * moving, color: rainCol });

  if (armA >= 0) {                                      // red anamorphic flares across the city
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fl = 0.25 + 0.75 * armFlare + 0.4 * kick;
    const sp = g.sprites.streak('#FF6A5A');
    for (let i = 0; i < 4; i++) {
      const y = 250 + 175 * i + 30 * Math.sin(t * 0.7 + i);
      const x = 300 + 440 * i + 60 * Math.sin(t * 0.5 + 2 * i);
      ctx.globalAlpha = Math.min(1, fl * (0.32 + 0.14 * (i % 2)));
      ctx.drawImage(sp, x - 640, y - 16, 640, 32);       // a symmetric anamorphic streak
      ctx.save(); ctx.translate(2 * x, 0); ctx.scale(-1, 1); ctx.drawImage(sp, x - 640, y - 16, 640, 32); ctx.restore();
    }
    ctx.restore();
  }
  // the figure (shifted down by the tilt)
  const word = F.c.word_on || 0;
  const phoneLight = mixQ(g, pal.glow, pal.bokehCyan, 0.25);
  const phoneK = smooth((t - S.t0) / 0.2) * (0.93 + 0.07 * (1 - word));
  if (camY < H * 1.15) {
    ctx.save();
    ctx.translate(0, camY);
    const camF = { ...cam, dy: cam.dy + camY * cam.s };
    const light = {
      ambient: red > 0 ? mixQ(g, '#E4E6FF', '#F2DCE6', red) : '#E4E6FF',
      far: red > 0 ? mixQ(g, '#B0B2F0', '#C88AA8', red) : '#B0B2F0',
      body: red > 0 ? mixQ(g, '#4A50A8', '#5A2448', red) : '#4A50A8',
      cel: red > 0 ? mixQ(g, '#7E72D6', '#B0507A', red) : '#7E72D6',
      sheen: '#EAF2FF', sheenK: 1 - 0.6 * red,
      phone: phoneLight, phoneK,
      rim: red > 0 ? mixQ(g, pal.bokehCyan, '#FF4A5E', red) : pal.bokehCyan,
      rimK: 0.92, rimDx: 10 + 4 * red, rimDy: 6,
    };
    const L = drawFigure(g, st, camF, light);
    drawPhone(ctx, st, g, pal, phoneK);
    drawHandOver(g, st, L);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const [px, py] = st.phone;
    ctx.globalAlpha = 0.42 * phoneK;
    ctx.drawImage(g.sprites.glow(pal.glow, 0), px - 1.6 * st.r, py - 1.6 * st.r, 3.2 * st.r, 3.2 * st.r);
    // the rose on his neck glows softly, breathing with the voice, flaring when the beat returns
    const [rx, ry] = st.rose;
    const roseK = 0.38 + 0.3 * (F.c.voc_lvl || 0) + 0.5 * drop + 0.3 * kick;
    ctx.globalAlpha = Math.min(1, roseK);
    ctx.drawImage(g.sprites.glow(pal.rose, 0), rx - 0.7 * st.r, ry - 0.7 * st.r, 1.4 * st.r, 1.4 * st.r);
    ctx.globalAlpha = Math.min(1, 0.5 * roseK);
    ctx.drawImage(g.sprites.glow('#BFD6FF', 1), rx - 0.22 * st.r, ry - 0.22 * st.r, 0.44 * st.r, 0.44 * st.r);
    // the phone's reflection in his eye
    const [ex, ey] = st.eye;
    ctx.globalAlpha = 0.5 * phoneK;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(ex - 0.03 * st.r, ey - 0.015 * st.r, 0.025 * st.r, 0.045 * st.r);
    ctx.restore();
    if (camY < H * 0.5) drawIcons(g, t, E, st, pal, lead);
    ctx.restore();
  }

  // the near rain (wide, faint, out of focus) and the sniper line
  drawRain(g, t + 3.7, Math.round(rainN * 0.22), 53, { alpha: 0.45, stretch: 1.6 + 2.5 * warp, color: rainCol, width: 2.4 });
  drawSniper(g, sa, pal);
  ctx.restore();
}
