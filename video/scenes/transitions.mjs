// Transitions drawn over the scenes, from treatment.transitions entries:
//   { type, t, dur, pre?, params? }   (times resolved; params evaluated at t into T.p)
// Baseline types (the post/transitions builder may extend):
//   flash            additive white (or T.p.color) peaking on the landing frame, decaying over dur
//   fade_from_black  black overlay 1 -> 0 over [t, t + dur]
//   fade_to_black    black overlay 0 -> 1 over [t, t + dur]
//   cut              a marker only (scenes switch on their own boundaries)

export const meta = { type: 'transitions', budgetMs: 3 };
export const defaults = {};

export function draw(g, t, F, T) {
  const { ctx, W, H, ease, color } = g;
  const fps = F.fps;
  const L = Math.floor(T.t * fps + 0.5) / fps;   // landing time
  const u = T.dur > 0 ? (t - L) / T.dur : 1;
  switch (T.type) {
    case 'flash': {
      if (t < L) return;
      const peak = T.p.peak ?? 0.35;
      const a = peak * Math.exp(-(t - L) / Math.max(1e-3, (T.p.tau ?? T.dur / 3)));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = color.css(T.p.color || '#ffffff', a);
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    case 'fade_from_black': {
      const a = 1 - ease.smooth(u);
      if (a <= 0) return;
      ctx.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    case 'fade_to_black': {
      const a = ease.smooth(u);
      if (a <= 0) return;
      ctx.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    default:
      return;
  }
}
