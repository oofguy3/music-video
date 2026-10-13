// Title card: the only module allowed to draw text. Spec comes from treatment.title:
// { text, t0, t1, fadeIn, fadeOut, x, y, size, color, tracking, font, alpha }

export const meta = { type: 'title', budgetMs: 2 };
export const defaults = {};

export function draw(g, t, F, T) {
  const { ctx, ease, color } = g;
  if (!T || !T.text) return;
  const fi = T.fadeIn ?? 0.5, fo = T.fadeOut ?? 0.9;
  let a = 1;
  if (t < T.t0 + fi) a = ease.smooth((t - T.t0) / fi);
  else if (t > T.t1) a = 1 - ease.smooth((t - T.t1) / fo);
  a *= T.alpha ?? 0.7;
  if (a <= 0.001) return;
  const size = T.size ?? 30;
  ctx.font = `${size}px "${T.font || 'Inter Light'}", "Inter", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color.css(T.color || '#f4e9dc', a);
  const tracking = (T.tracking ?? 0.3) * size;
  const chars = [...T.text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + tracking * Math.max(0, chars.length - 1);
  let x = T.x ?? 96;
  if (T.align === 'center') x -= total / 2;
  else if (T.align === 'right') x -= total;
  const y = T.y ?? 1000;
  chars.forEach((ch, k) => {
    ctx.fillText(ch, x, y);
    x += widths[k] + tracking;
  });
}
