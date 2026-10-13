// Sync-harness scene: no art, just unmistakable reactions to every feature and event, so the
// automated checks (frame-difference vs hits, event frames, hard stop) can be validated before
// any real scene exists. Run with: node render.mjs preview --scenes debug

export const meta = { type: 'debug', budgetMs: 10 };
export const defaults = {};

export function draw(g, t, F, P, S) {
  const { ctx, W, H, color } = g;
  const c = F.c;
  const sec = Math.max(0, c.section);
  const hue = (sec * 67) % 360;
  ctx.fillStyle = `hsl(${hue}, 35%, ${8 + 6 * c.loud}%)`;
  ctx.fillRect(0, 0, W, H);

  // drum meters: kick | snare | hat
  const bars = [[c.kick, '#ff5a3c'], [c.snare, '#ffd23c'], [c.hat, '#3cd2ff']];
  bars.forEach(([v, col], k) => {
    ctx.fillStyle = col;
    const h = v * H * 0.5;
    ctx.fillRect(160 + k * 120, H * 0.9 - h, 80, h);
  });
  // voice / bass / pad levels as circles
  const lv = [[c.voc_lvl, '#ffffff', 960], [c.bass_lvl, '#c08cff', 1260], [c.pad_lvl, '#7cffb0', 1560]];
  for (const [v, col, x] of lv) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, H * 0.45, 20 + 110 * v, 0, Math.PI * 2);
    ctx.fill();
  }
  // beat phase sweep + downbeat bar
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(c.beat_phase * W, H - 24, 12, 24);
  const down = F.impulse('downbeats', 0.12, -1);
  ctx.fillStyle = color.css('#ffffff', down);
  ctx.fillRect(0, 0, W, 40);
  // numb (blue), key lift (gold ring), cut (red)
  if (c.numb > 0) { ctx.fillStyle = color.css('#2a6cff', 0.5 * c.numb); ctx.fillRect(0, 0, W, H); }
  if (c.key_pivot > 0 || c.key_lift > 0) {
    ctx.strokeStyle = color.css('#ffc46b', 0.4 + 0.6 * Math.min(1, c.key_pivot + c.key_lift));
    ctx.lineWidth = 6 + 30 * c.key_pivot;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 300 + 100 * c.key_lift, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (c.cut > 0) { ctx.fillStyle = color.css('#ff2020', 0.8 * c.cut); ctx.fillRect(0, 0, W, H); }
  // the hit flash last, full frame, so frame differences track drum hits
  if (c.hit > 0) { ctx.fillStyle = color.css('#ffffff', 0.65 * c.hit); ctx.fillRect(0, 0, W, H); }
}
