// A2 Under the Milk. A hard cut from the frozen pale sea to deep water: Kit, drained of colour, sinks
// slowly in a float, trailing bubbles, under a bright rippling milk ceiling with god rays and marine
// snow. On the key-change pivot a gold point opens far below and grows, warming the water; on each hit
// of the drum fill it bursts (a ring of rays, a jump in size) and tugs Kit toward it, until the gold
// fills most of the frame for the engine's flash.
//
// Pure: everything is a closed-form function of t, F and P; caches are keyed sprites and designs.

import { KIT, kidHead } from './lib/cast.mjs';
import { design, drawPuppet, cycles, solve } from './lib/puppet.mjs';
import { hashU, waves } from './lib/worldkit.mjs';

export const meta = { type: 'deep', budgetMs: 90 };

export const defaults = {
  pivot: -1,          // time (s) the gold light opens (<0: 0.78 through the entry)
  voiceBack: -1,      // time (s) the voice returns: Kit's glow pulses back warm (<0: just after pivot)
  growEnd: -1,        // time (s) the light reaches full size (<0: 0.6 s before the entry ends)
  fillEnd: -1,        // end of the drum-fill window (<0: the first key change, else the entry end)
  lightR: 260,        // gold light radius when grown (px)
  hitGrow: 0.18,      // size jump per fill hit
  hitPull: 30,        // px Kit is pulled toward the light per hit
  snow: 300,
  drain: 0.6,         // how far Kit's colours are drained toward the cold tint
  warm: 0.35,         // how far the water warms toward gold
};

export const DEFAULT = {
  top: '#1E5FBF', mid: '#0C2E78', bottom: '#040B2E', caustic: '#9FE7FF', ray: '#BFEFFF', gold: '#FFC857',
  goldCore: '#FFF1C9', bubble: '#BDEBFF', snow: '#9FB8E8',
};

const TAU = Math.PI * 2;
const COLD = '#9FB8E8';
const MILK_LILAC = '#E6DEF8';
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (x) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const outBack = (x) => { const c = clamp(x), c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (c - 1) ** 3 + c1 * (c - 1) ** 2; };

function palOf(S) {
  const p = (S && S.palette) || {};
  const o = {};
  for (const k of Object.keys(DEFAULT)) o[k] = p[k] || DEFAULT[k];
  return o;
}

const designCache = new Map();
/** Kit's teen design with every colour drained toward the cold tint (cached per amount). */
function drainedKit(g, k) {
  const key = Math.round(k * 100);
  let d = designCache.get(key);
  if (!d) {
    const m = (c) => g.color.mix(c, COLD, key / 100);
    d = design({
      ...KIT.teen,
      id: `kit-teen-drained-${key}`,
      fill: m('#FFC83D'), limbFill: m('#2E3A7A'), headFill: m('#FFDCC2'),
      head: kidHead({ skin: m('#FFDCC2'), hair: m('#3A2A1E'), cheek: m('#FF8FA3'), style: 'cap' }),
    });
    designCache.set(key, d);
  }
  return d;
}

const boxCache = new Map();
/** A square offscreen box at device resolution, keyed by size and device scale (contents are scratch). */
function kitBox(g, size) {
  const k = `${size}|${g.scale}`;
  let b = boxCache.get(k);
  if (!b) {
    const c = g.createCanvas(Math.ceil(size * g.scale), Math.ceil(size * g.scale));
    b = { c, x: c.getContext('2d') };
    boxCache.set(k, b);
  }
  return b;
}

let lightBuf = null;
/** A small offscreen buffer for soft light shapes (rays): redrawn fully every frame, drawn upscaled. */
function softLight(g) {
  if (!lightBuf) {
    const c = g.createCanvas(480, 270), b = g.createCanvas(480, 270);
    lightBuf = { c, x: c.getContext('2d'), b, bx: b.getContext('2d') };
  }
  const { x } = lightBuf;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.clearRect(0, 0, 480, 270);
  x.setTransform(0.25, 0, 0, 0.25, 0, 0);
  return lightBuf;
}
function drawSoft(g, buf, alpha = 1) {
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  buf.bx.globalCompositeOperation = 'copy';
  buf.bx.filter = 'blur(1.6px)';
  buf.bx.drawImage(buf.c, 0, 0);
  buf.bx.filter = 'none';
  ctx.drawImage(buf.b, 0, 0, 1920, 1080);
  ctx.restore();
}

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const pal = palOf(S);
  const t0 = S.t0, t1 = S.t1, dur = Math.max(1e-3, t1 - t0);
  const tl = t - t0;
  const fps = F.fps || 30;
  const keyT = F.ev.key_changes && F.ev.key_changes.length ? F.ev.key_changes[0].t : t1;
  const pivot = P.pivot > t0 && P.pivot < t1 ? P.pivot : t0 + 0.78 * dur;
  const voiceBack = P.voiceBack > t0 && P.voiceBack < t1 ? P.voiceBack : pivot + 0.2;
  const growEnd = P.growEnd > pivot ? P.growEnd : Math.max(pivot + 0.3, t1 - 0.6);
  const fillEnd = P.fillEnd > pivot ? P.fillEnd : keyT > pivot ? keyT : t1;
  const land = (x) => Math.floor(x * fps + 0.5) / fps;   // landing-frame rule for events

  // ---------------- the drum fill: hits after the pivot ----------------
  const hits = F.between('hit', pivot, fillEnd + 0.5 / fps).map((h) => land(h[0])).filter((h) => h <= t + 1e-6);
  let jumps = 0, pull = 0, burst = 0, burstAge = 99;
  for (const th of hits) {
    const a = t - th;
    jumps += outBack(a / 0.1);
    pull += outCubic(a / 0.25);
    if (a < burstAge) burstAge = a;
  }
  if (burstAge < 0.35) burst = Math.exp(-burstAge / 0.1);

  // ---------------- water ----------------
  g.world.sky(g, [[0, g.color.mix(pal.top, MILK_LILAC, 0.25)], [0.12, pal.top], [0.5, pal.mid], [1, pal.bottom]], { dither: 1.6 });
  const grow = outCubic((t - pivot) / Math.max(0.1, growEnd - pivot));
  const open = t >= pivot ? 1 : 0;
  const warmth = (P.warm ?? defaults.warm) * grow * open;
  if (warmth > 0.002) {
    // one source-over wash of teal-gold, strongest near the light
    const tg = g.color.mix(pal.gold, pal.caustic, 0.3);
    const gw = ctx.createLinearGradient(0, 0, 0, 1080);
    gw.addColorStop(0, g.color.css(tg, warmth * 0.55));
    gw.addColorStop(1, g.color.css(pal.gold, Math.min(1, warmth * 1.5)));
    ctx.fillStyle = gw;
    ctx.fillRect(0, 0, 1920, 1080);
  }

  // ---------------- god rays from the ceiling (soft, low-res) ----------------
  const LB = softLight(g);
  {
  const ctx = LB.x;
  for (let i = 0; i < 7; i++) {
    const sway = 0.06 * Math.sin(t * 0.35 + i * 1.3) + 0.03 * Math.sin(t * 0.8 + i);
    const bx = 960 + (i - 3) * 190 + 40 * Math.sin(t * 0.2 + i);
    const ang = (i - 3) * 0.11 + sway;
    const len = 900 + 120 * hashU(3, i, 1);
    const w0 = 50 + 40 * hashU(3, i, 2), w1 = w0 * 3.2;
    const ex = bx + Math.sin(ang) * len, ey = 60 + Math.cos(ang) * len;
    const gr = ctx.createLinearGradient(bx, 60, ex, ey);
    const al = (0.2 + 0.1 * Math.sin(t * 0.9 + i * 2.1)) * (1 - 0.4 * grow);
    gr.addColorStop(0, g.color.css(pal.ray, al));
    gr.addColorStop(0.6, g.color.css(pal.ray, al * 0.35));
    gr.addColorStop(1, g.color.css(pal.ray, 0));
    ctx.fillStyle = gr;
    const px = Math.cos(ang), py = -Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(bx - px * w0, 60 - py * w0);
    ctx.lineTo(bx + px * w0, 60 + py * w0);
    ctx.lineTo(ex + px * w1, ey + py * w1);
    ctx.lineTo(ex - px * w1, ey - py * w1);
    ctx.closePath();
    ctx.fill();
  }
  }
  drawSoft(g, LB, 1.5);

  // ---------------- the milk ceiling ----------------
  {
    const edge = (x) => 96 + 10 * Math.sin(x * 0.006 + t * 1.1) + 6 * Math.sin(x * 0.017 - t * 1.7);
    const gc = ctx.createLinearGradient(0, 0, 0, 120);
    gc.addColorStop(0, '#FFFFFF');
    gc.addColorStop(0.5, MILK_LILAC);
    gc.addColorStop(1, g.color.mix(MILK_LILAC, pal.top, 0.35));
    ctx.fillStyle = gc;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= 1920; x += 32) ctx.lineTo(x, edge(x));
    ctx.lineTo(1920, 0);
    ctx.closePath();
    ctx.fill();
    // glow just under the surface
    const gu = ctx.createLinearGradient(0, 90, 0, 260);
    gu.addColorStop(0, g.color.css(pal.caustic, 0.35));
    gu.addColorStop(1, g.color.css(pal.caustic, 0));
    ctx.fillStyle = gu;
    ctx.fillRect(0, 90, 1920, 170);
    // caustic net: two crossing families of wavy lines
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 1920, 175);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    waves(ctx, { seed: 21, t, y0: 6, lines: 16, gap: 9, amp: 22, freq: 7, speed: 0.12, step: 20, stroke: pal.caustic, width: 1.4, alpha: 0.38 });
    waves(ctx, { seed: 22, t: t + 9, y0: 18, lines: 14, gap: 11, amp: 26, freq: 5, speed: -0.1, step: 20, stroke: pal.caustic, width: 1.1, alpha: 0.3 });
    ctx.restore();
  }

  // ---------------- depth haze and far specks ----------------
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const speck = g.sprites.glow(pal.caustic);
  for (let i = 0; i < 40; i++) {
    const x = hashU(9, i, 1) * 1920 + 30 * Math.sin(t * 0.2 + i);
    const y = 300 + hashU(9, i, 2) * 700 - 6 * t;
    const r = 2 + 4 * hashU(9, i, 3);
    const tw = 0.5 + 0.5 * Math.sin(t * (0.8 + hashU(9, i, 4)) + i);
    ctx.globalAlpha = 0.25 * tw;
    ctx.drawImage(speck, x - r * 3, y - r * 3, r * 6, r * 6);
  }
  ctx.restore();

  // ---------------- milk jellyfish drifting in the blue ----------------
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  for (let j = 0; j < 5; j++) {
    const sz = 22 + 40 * hashU(13, j, 1);
    const x = 140 + hashU(13, j, 2) * 1640 + 50 * Math.sin(t * 0.18 + j * 2.3);
    const y = 380 + hashU(13, j, 3) * 560 - (6 + 10 * hashU(13, j, 4)) * tl;
    if (Math.abs(x - 960) < 160 && y < 700) continue;    // keep Kit's space clear
    const ph = t * (1.2 + 0.5 * hashU(13, j, 5)) + j * 1.7;
    const pump = 0.5 + 0.5 * Math.sin(ph);
    const w = sz * (1 + 0.12 * pump), h = sz * (0.75 - 0.15 * pump);
    const al = 0.22 + 0.08 * Math.sin(ph * 0.5);
    const gj = ctx.createRadialGradient(x, y - h * 0.2, 1, x, y, w);
    gj.addColorStop(0, g.color.css('#FFFFFF', al * 1.4));
    gj.addColorStop(0.6, g.color.css(pal.caustic, al));
    gj.addColorStop(1, g.color.css(pal.caustic, 0));
    ctx.fillStyle = gj;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, Math.PI, TAU);
    ctx.quadraticCurveTo(x, y + h * 0.35, x - w, y);
    ctx.fill();
    ctx.strokeStyle = g.color.css(pal.caustic, al * 0.9);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      const bx = x - w * 0.6 + (k / 4) * w * 1.2;
      ctx.beginPath();
      ctx.moveTo(bx, y + 2);
      for (let q = 1; q <= 6; q++) {
        const yy = y + q * sz * 0.28;
        ctx.lineTo(bx + 6 * Math.sin(ph - q * 0.7 + k), yy);
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  // ---------------- the gold light (behind Kit) ----------------
  const lx = 960, ly = 980;
  const R0 = P.lightR ?? defaults.lightR;
  const hitGrow = P.hitGrow ?? defaults.hitGrow;
  const R = R0 * grow * (1 + hitGrow) ** jumps * open;
  if (R > 0.5) {
    const GB = softLight(g);
    {
    const ctx = GB.x;
    // rising rays
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (i - 1) * 0.32 + 0.06 * Math.sin(t * 0.5 + i * 2);
      const len = 500 + R * 1.6;
      const w = 30 + R * 0.25;
      const ex = lx + Math.cos(ang) * len, ey = ly + Math.sin(ang) * len;
      const gr = ctx.createLinearGradient(lx, ly, ex, ey);
      gr.addColorStop(0, g.color.css(pal.gold, 0.5 * grow));
      gr.addColorStop(1, g.color.css(pal.gold, 0));
      ctx.fillStyle = gr;
      const px = -Math.sin(ang), py = Math.cos(ang);
      ctx.beginPath();
      ctx.moveTo(lx + px * w * 0.3, ly + py * w * 0.3);
      ctx.lineTo(ex + px * w * 1.8, ey + py * w * 1.8);
      ctx.lineTo(ex - px * w * 1.8, ey - py * w * 1.8);
      ctx.lineTo(lx - px * w * 0.3, ly - py * w * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    }
    drawSoft(g, GB, 1.3);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    // the burst ring of 12 short rays on each fill hit
    if (burst > 0.01) {
      const rr0 = R * 0.45, rr1 = R * (1.1 + 0.9 * (1 - burst));
      const gr = ctx.createRadialGradient(lx, ly, rr0, lx, ly, rr1);
      gr.addColorStop(0, g.color.css(pal.goldCore, burst));
      gr.addColorStop(1, g.color.css(pal.gold, 0));
      ctx.fillStyle = gr;
      const rot = hits.length * 0.37;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = rot + (i / 12) * TAU, sp = 0.07;
        ctx.moveTo(lx + Math.cos(a - sp) * rr0, ly + Math.sin(a - sp) * rr0);
        ctx.lineTo(lx + Math.cos(a) * rr1, ly + Math.sin(a) * rr1);
        ctx.lineTo(lx + Math.cos(a + sp) * rr0, ly + Math.sin(a + sp) * rr0);
        ctx.closePath();
      }
      ctx.fill();
    }
    const pulse = 1 + 0.04 * Math.sin(t * 5) + 0.12 * burst;
    ctx.drawImage(g.sprites.glow(pal.gold), lx - R * 2.2 * pulse, ly - R * 2.2 * pulse, R * 4.4 * pulse, R * 4.4 * pulse);
    ctx.drawImage(g.sprites.glow(pal.goldCore, 1), lx - R * 1.1 * pulse, ly - R * 1.1 * pulse, R * 2.2 * pulse, R * 2.2 * pulse);
    ctx.restore();
    ctx.fillStyle = g.color.css(pal.goldCore, 0.9);
    ctx.beginPath();
    ctx.arc(lx, ly, R * 0.22 * pulse, 0, TAU);
    ctx.fill();
  }

  // ---------------- Kit sinking ----------------
  const pullPx = (P.hitPull ?? defaults.hitPull) * pull;
  const kitAt = (tt) => {
    const u = clamp((tt - t0) / dur);
    const y = 250 + 270 * (u * 0.6 + 0.4 * smooth(u));
    const x = 940 + 40 * Math.sin((tt - t0) * 0.45) + 14 * Math.sin((tt - t0) * 1.1);
    return [x, y];
  };
  let [kx, ky] = kitAt(t);
  // the pull toward the light
  {
    const dx = lx - kx, dy = ly - ky, L = Math.hypot(dx, dy) || 1;
    kx += (dx / L) * pullPx; ky += (dy / L) * pullPx;
  }
  const kitScale = 1.05;
  const pose = cycles.float(tl, 3);
  pose.rot = 0.35 * Math.sin(tl * 0.42 + 0.6) + 0.06 * Math.sin(tl * 1.3);
  pose.head = (pose.head || 0) + 0.15;
  const vocBack = clamp((t - voiceBack) / 0.3);
  const vocLvl = clamp(F.c.voc_lvl || 0);
  const warmK = clamp(Math.max(vocBack, grow * open));
  const kit = drainedKit(g, (P.drain ?? defaults.drain) * (1 - 0.45 * warmK));

  // Kit's glow: faint and cold while the voice is out, a warm pulse when it returns
  {
    const backPulse = t >= voiceBack ? Math.exp(-(t - voiceBack) / 0.6) : 0;
    const level = 0.22 + 0.25 * vocLvl + 0.7 * backPulse + 0.3 * warmK;
    const col = g.color.mix(COLD, pal.gold, Math.round(warmK * 20) / 20);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp(level);
    const rg = 260 * (1 + 0.3 * backPulse);
    ctx.drawImage(g.sprites.glow(col), kx - rg, ky - 60 - rg, rg * 2, rg * 2);
    ctx.restore();
  }
  // Kit, lit from below as the light grows
  // drawn into a small offscreen box (fully cleared every frame) so it can be lit atop
  const BOX = 640;
  const KB = kitBox(g, BOX);
  const bx0 = kx - BOX / 2, by0 = ky - BOX / 2;
  KB.x.setTransform(g.scale, 0, 0, g.scale, 0, 0);
  KB.x.globalCompositeOperation = 'source-over';
  KB.x.clearRect(0, 0, BOX, BOX);
  KB.x.translate(-bx0, -by0);
  drawPuppet(KB.x, kit, pose, { x: kx, y: ky, facing: 1, view: 'side', scale: kitScale, devScale: g.scale });
  if (open && grow > 0.01) {
    KB.x.globalCompositeOperation = 'source-atop';
    const gk = KB.x.createLinearGradient(0, ky - 160, 0, ky + 160);
    gk.addColorStop(0, g.color.css(pal.gold, 0));
    gk.addColorStop(1, g.color.css(pal.gold, 0.55 * grow + 0.25 * burst));
    KB.x.fillStyle = gk;
    KB.x.fillRect(bx0, by0, BOX, BOX);
    KB.x.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(KB.c, bx0, by0, BOX, BOX);

  // ---------------- bubbles: the plunge burst and a stream from Kit ----------------
  ctx.save();
  ctx.lineWidth = 1.6;
  const bubble = (x, y, r, a) => {
    if (y < 100 || a <= 0.01) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = pal.bubble;
    ctx.fillStyle = g.color.css(pal.bubble, 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, Math.max(0.8, r * 0.22), 0, TAU);
    ctx.fill();
  };
  // plunge: a cloud of bubbles from the cut
  for (let i = 0; i < 70; i++) {
    const tb = -0.45 + hashU(41, i, 1) * 0.6;
    const age = tl - tb;
    if (age < 0 || age > 3.2) continue;
    const r = 3 + 10 * hashU(41, i, 2) ** 2;
    const [bx0, by0] = kitAt(t0);
    const x = bx0 + (hashU(41, i, 3) - 0.5) * 260 + 14 * Math.sin(age * 4 + i) + (hashU(41, i, 5) - 0.5) * 120 * age;
    const y = by0 - 80 + (hashU(41, i, 4) - 0.5) * 220 - (90 + 30 * r) * age;
    bubble(x, y, r, 0.85 * (1 - age / 3.2));
  }
  // stream: closed form, births at a steady rate, released from Kit's head at birth time
  const rate = 6, life = 4;
  const k0 = Math.max(0, Math.ceil((tl - life) * rate)), k1 = Math.floor(tl * rate);
  for (let k = k0; k <= k1; k++) {
    const tb = t0 + k / rate;
    const age = t - tb;
    if (age < 0 || age > life) continue;
    const r = 3 + 9 * hashU(43, k, 1) ** 1.5;
    const [bx, by] = kitAt(tb);
    const x = bx + 34 + (hashU(43, k, 2) - 0.5) * 30 + 10 * Math.sin(age * 3.2 + k);
    const y = by - 175 - (70 + 12 * r) * age;
    bubble(x, y, r, 0.8 * Math.min(1, age * 4) * (1 - age / life));
  }
  ctx.restore();

  // ---------------- the milk plume where Kit broke through ----------------
  if (tl < 3) {
    ctx.save();
    const [px0, py0] = kitAt(t0);
    const puff = g.sprites.glow(MILK_LILAC);
    for (let i = 0; i < 8; i++) {
      const u = i / 7;
      const age = tl + 0.3;
      const x = px0 + (hashU(47, i, 1) - 0.5) * 80 * (1 + age) + 20 * Math.sin(age * 1.5 + i);
      const y = 90 + (py0 - 90) * u + 30 * age * (1 - u);
      const r = (50 + 70 * hashU(47, i, 2)) * (1 + 0.6 * age);
      ctx.globalAlpha = 0.5 * (1 - tl / 3) ** 1.5 * (1 - 0.5 * u);
      ctx.drawImage(puff, x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  // ---------------- marine snow ----------------
  {
    const n = Math.round(P.snow ?? defaults.snow);
    ctx.fillStyle = pal.snow;
    for (let b = 0; b < 4; b++) {                        // four brightness bands, one path each
      ctx.globalAlpha = 0.18 + 0.17 * b;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const z = hashU(51, i, 1);
        const lv = (0.25 + 0.5 * (1 - z)) * (0.6 + 0.4 * Math.sin(t * 2 + i));
        if (Math.min(3, Math.floor(lv / 0.19)) !== b) continue;
        const sp = 6 + 14 * (1 - z);
        const x = ((hashU(51, i, 2) * 2000 + 8 * t + 12 * Math.sin(t * 0.3 + i)) % 2000) - 40;
        const y = ((hashU(51, i, 3) * 1100 + sp * t) % 1100) - 10;
        const r = 0.7 + 1.8 * (1 - z);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- foreground bokeh motes ----------------
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const bk = g.sprites.bokeh(pal.caustic, 0.2, 0.3);
  for (let i = 0; i < 9; i++) {
    const x = hashU(61, i, 1) * 1920 + 40 * Math.sin(t * 0.25 + i);
    const y = ((hashU(61, i, 2) * 1300 - 20 * t) % 1300 + 1300) % 1300 - 110;
    const r = 30 + 60 * hashU(61, i, 3);
    ctx.globalAlpha = 0.07 + 0.05 * Math.sin(t * 0.7 + i);
    ctx.drawImage(bk, x - r, y - r, 2 * r, 2 * r);
  }
  ctx.restore();

  // ---------------- depth vignette ----------------
  {
    const gv = ctx.createRadialGradient(960, 520, 300, 960, 560, 1150);
    gv.addColorStop(0, g.color.css(pal.bottom, 0));
    gv.addColorStop(1, g.color.css(pal.bottom, 0.55 * (1 - 0.6 * grow)));
    ctx.fillStyle = gv;
    ctx.fillRect(0, 0, 1920, 1080);
  }
  // the light floods the frame at the very end
  if (R > 0.5) {
    const flood = clamp(jumps / Math.max(1, hits.length || 1)) * clamp(hits.length / 5);
    if (flood > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.9 * flood;
      ctx.drawImage(g.sprites.glow(pal.goldCore), lx - R * 3.4, ly - R * 3.4, R * 6.8, R * 6.8);
      ctx.restore();
    }
  }
}
