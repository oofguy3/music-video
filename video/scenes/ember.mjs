// E1 outro: the ember. The hard cut out of the bone crowd is honoured with pure ink frames; then
// one bone hairline (home, the pad) and her hollow gold ring, the one thing carried out of the
// crowd. The voice is a bone dot already on the tonic, swelling on each last syllable onset. It
// slides into the ring by the voice exit, and the ring fills from inside: the self regains colour
// only by becoming one disc with what it still wants, resting on home. The whole drawing scales
// about the ring by a slow pull-back. The engine blacks the frame on the pad's hard stop.
//
// Nothing fades or drifts on its own: every motion is a P keyframe or a feature.
// Pure: every value comes from (t, F, P, S); no caches beyond css strings.

import { HOME_Y, X0, X1 } from './lib/linekit.mjs';

export const meta = { type: 'ember', budgetMs: 1 };

export const defaults = {
  tonicMidi: 59,
  homeY: HOME_Y,
  blackFrames: 2,
  lineLen: X1 - X0,
  lineA0: 0.3,
  lineAPad: 0.5,
  pull: 1,
  merge: 0,
  fill: 0,
  ringR: 22,
  ringW: 2,             // + pad_rel (breathing)
  breathWin: 0.25,      // s window of the pad_rel mean that drives the breathing
  dotR: 5,
  dotGap: 60,           // px left of the ring centre
  swell: 4,             // px of dot radius per (voc_lvl x note-onset impulse)
};

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export function draw(g, t, F, P, S) {
  const { ctx, W, H, color } = g;
  const pal = S.palette;
  const ink = pal.ink || '#050505', bone = pal.bone || '#CFC9BE', gold = pal.amber || '#F0A23B';
  const s = g.scale;
  const fps = F.fps;

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);

  // the cut: pure ink for the first blackFrames frames
  if (Math.round(t * fps) - Math.round(S.t0 * fps) < Math.round(P.blackFrames ?? 2)) return;

  const k = P.pull ?? 1;                       // the pull-back: everything scales about the ring
  const cx = W / 2;
  const home = P.homeY ?? HOME_Y;

  // ---- home: one bone hairline, one device pixel on a device row ----
  const lh = Math.max(1, 1 / s);
  const ly = Math.round(home * s) / s;
  const cy = ly + lh / 2;                      // the line's centre: ring, disc and dot sit on it
  const half = ((P.lineLen ?? 1536) * k) / 2;
  const la = clamp((P.lineA0 ?? 0.3) + (P.lineAPad ?? 0.5) * F.c.pad_lvl);
  const a = Math.round((cx - half) * s) / s, b = Math.round((cx + half) * s) / s;
  if (b > a) {
    ctx.fillStyle = color.css(bone, la);
    ctx.fillRect(a, ly, b - a, lh);
  }

  // ---- her ring, filling from inside ----
  const R = (P.ringR ?? 22) * k;
  const fill = clamp(P.fill ?? 0);
  const discR = R * Math.sqrt(fill);
  if (discR > 0.05) {
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.fill();
  }
  const bw = P.breathWin ?? 0.25;
  const padRel = clamp(F.integral('pad_rel', t - bw, t) / bw);
  ctx.lineWidth = (P.ringW ?? 2) + padRel;
  ctx.strokeStyle = gold;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // ---- the voice: a drained bone dot on the tonic, sliding into the ring ----
  const merge = clamp(P.merge ?? 0);
  const dr = ((P.dotR ?? 5) + (P.swell ?? 4) * clamp(F.c.voc_lvl) * clamp(F.c.voc_on)) * k;
  if (discR < dr) {
    // as the disc grows to the dot's size the dot takes its colour: one disc, not two
    const c = discR > 0.05 ? color.mix(bone, gold, Math.round((discR / dr) * 16) / 16) : bone;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(cx - (P.dotGap ?? 60) * k * (1 - merge), cy, dr, 0, Math.PI * 2);
    ctx.fill();
  }
}
