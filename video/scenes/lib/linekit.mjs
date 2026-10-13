// Shared geometry for the "home line" language of the Numb treatment. Scene builders import this
// read-only so that adjacent scenes agree exactly: the memories scene's last frame equals the first
// frame of crowd_b1; the void scene slices the crowd_b1 snapshot by these rows; every scene measures
// pitch against the same home line.
//
// Coordinates are logical (1920x1080). The home line is the tonic: y = HOME_Y.

export const HOME_Y = 620;
export const X0 = 192;                 // home line spans X0..X1 (1536 px)
export const X1 = 1728;
export const COLS = 49;                // the "we" lattice: x = X0 + 32c, c = 0..48
export const COL_PITCH = 32;
export const CENTER_COL = 24;          // the self's column
export const ROW_GAP = 44;             // rows at y = HOME_Y + 44r (feet), r = -5..5 in crowd_b1

/** Figure proportions at scale 1 (feet at the origin): head r 4.5 over an 8x24 capsule, 3 px gap. */
export const FIG = { headR: 4.5, bodyW: 8, bodyH: 24, bodyR: 4, gap: 3 };
export const figureHeight = (s = 1) => (FIG.bodyH + FIG.gap + 2 * FIG.headR) * s;   // 36 px at s=1

export const colX = (c, pitch = COL_PITCH, x0 = X0) => x0 + pitch * c;
export const rowY = (r, gap = ROW_GAP, home = HOME_Y) => home + gap * r;

/** Vertical offset (px, negative = above home) for a MIDI note relative to the tonic, clamped. */
export function pitchOffset(midi, tonicMidi, pxPerSemi = 18, clampSemi = 8) {
  const d = Math.max(-clampSemi, Math.min(clampSemi, midi - tonicMidi));
  return -d * pxPerSemi;
}

/**
 * The sung MIDI note at time t as the median of the last `n` frames (removes one-frame blips and
 * octave ghosts). Returns -1 when the voice is silent for most of the window. Frame-exact sampling.
 */
export function voiceMidi(F, t, n = 5) {
  const i0 = Math.round(t * F.fps);
  const vals = [];
  let silent = 0;
  for (let k = 0; k < n; k++) {
    const v = F.col('voc_midi', Math.max(0, i0 - k) / F.fps);
    if (v < 0) silent++;
    else vals.push(v);
  }
  if (silent * 2 > n || !vals.length) return -1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

/** Stable per-figure individuality from (seed, column, row): height, sway phase, lightness. */
export function indiv(noise, seed, c, r) {
  return {
    dh: (noise.hash01(seed, c, r, 1) - 0.5) * 12,      // +-6 px
    dphase: (noise.hash01(seed, c, r, 2) - 0.5) * 0.7, // +-0.35 beat
    dl: (noise.hash01(seed, c, r, 3) - 0.5) * 0.16,    // +-8 % lightness
  };
}

const spriteCache = new Map();

/**
 * A figure sprite (cached): capsule body plus a filled or hollow head, anchored bottom-centre.
 * squash in [0, 1] flattens it for landings. Rendered at device resolution for crisp edges.
 * Returns {canvas, w, h} in logical px; draw with drawFigure.
 */
export function figureSprite(g, { body = '#E4DED2', head = null, headHollow = false, scale = 1, squash = 0, ring = 1.5 } = {}) {
  const key = `${g.scale}|${body}|${head}|${headHollow}|${scale}|${squash}|${ring}`;
  let spr = spriteCache.get(key);
  if (spr) return spr;
  const sq = Math.max(0, Math.min(1, squash));
  const bw = FIG.bodyW * (1 + 0.25 * sq), bh = FIG.bodyH * (1 - 0.3 * sq);
  const hr = FIG.headR;
  const w = Math.max(bw, 2 * hr + ring) + 2;
  const h = bh + FIG.gap + 2 * hr + ring + 2;
  const ds = g.scale * scale;
  const c = g.createCanvas(Math.max(1, Math.ceil(w * ds)), Math.max(1, Math.ceil(h * ds)));
  const x = c.getContext('2d');
  x.scale(ds, ds);
  x.fillStyle = body;
  const bx = (w - bw) / 2, by = h - 1 - bh;
  x.beginPath();
  x.roundRect(bx, by, bw, bh, Math.min(FIG.bodyR, bw / 2));
  x.fill();
  const hy = by - FIG.gap - hr;
  x.beginPath();
  x.arc(w / 2, hy, hr - (headHollow ? ring / 2 : 0), 0, Math.PI * 2);
  if (headHollow) {
    x.lineWidth = ring;
    x.strokeStyle = head || body;
    x.stroke();
  } else {
    x.fillStyle = head || body;
    x.fill();
  }
  x.getImageData(0, 0, 1, 1);   // rasterise now: an unflushed canvas costs ~2x per drawImage
  spr = { canvas: c, w: w * scale, h: h * scale, foot: 1 * scale };
  if (spriteCache.size > 4000) spriteCache.clear();
  spriteCache.set(key, spr);
  return spr;
}

/** Draw a figure sprite with its feet at (x, footY), optionally rotated about the feet. */
export function drawFigure(ctx, spr, x, footY, angle = 0) {
  if (!angle) {
    ctx.drawImage(spr.canvas, x - spr.w / 2, footY - spr.h + spr.foot, spr.w, spr.h);
    return;
  }
  ctx.save();
  ctx.translate(x, footY);
  ctx.rotate(angle);
  ctx.drawImage(spr.canvas, -spr.w / 2, -spr.h + spr.foot, spr.w, spr.h);
  ctx.restore();
}

/** `steps` colours from `from` to `to` (OKLab), for bucketed drain/fade sprites. */
const rampCache = new Map();
export function ramp(color, from, to, steps = 16) {
  const key = `${from}|${to}|${steps}`;
  let r = rampCache.get(key);
  if (!r) {
    r = Array.from({ length: steps }, (_, k) => color.mix(from, to, k / (steps - 1)));
    rampCache.set(key, r);
  }
  return r;
}

/** Index into a ramp for amount u in [0, 1]. */
export const rampIndex = (u, steps = 16) => Math.max(0, Math.min(steps - 1, Math.round(u * (steps - 1))));
