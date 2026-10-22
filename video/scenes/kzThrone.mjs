// B2 The throne room: placeholder until the scene is built (see its brief in treatments/kaiser-emperor.json).
export const meta = { type: 'kzThrone', budgetMs: 10 };
export const defaults = {};

export function draw(g, t, F, P, S) {
  const { ctx } = g;
  const pal = S.palette || {};
  const cols = Object.values(pal).filter((v) => typeof v === 'string' && v.startsWith('#'));
  const grd = ctx.createLinearGradient(0, 0, 0, g.H);
  grd.addColorStop(0, cols[0] || '#05081F');
  grd.addColorStop(1, cols[1] || '#1F4FD8');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, g.W, g.H);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const r = 30 + 70 * F.c.hit + 40 * F.c.voc_on;
  ctx.beginPath();
  ctx.arc(g.W / 2, g.H / 2, r, 0, Math.PI * 2);
  ctx.fill();
}
