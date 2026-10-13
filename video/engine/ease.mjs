// Easing curves and small envelope helpers. All pure.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, v)));

export const linear = (t) => clamp(t);
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const inQuad = (t) => { t = clamp(t); return t * t; };
export const outQuad = (t) => { t = clamp(t); return 1 - (1 - t) * (1 - t); };
export const inOutQuad = (t) => { t = clamp(t); return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; };
export const inCubic = (t) => clamp(t) ** 3;
export const outCubic = (t) => 1 - (1 - clamp(t)) ** 3;
export const inOutCubic = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
export const outExpo = (t) => { t = clamp(t); return t >= 1 ? 1 : 1 - 2 ** (-10 * t); };
export const inExpo = (t) => { t = clamp(t); return t <= 0 ? 0 : 2 ** (10 * t - 10); };
export const outBack = (t) => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
export const step = (t) => (t >= 1 ? 1 : 0);
export const hold = () => 0;

export const EASES = { linear, smooth, smoother, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, outExpo, inExpo, outBack, step, hold };

/** Exponential decay from `t0` with time constant tau; 0 before t0. */
export const decay = (t, t0, tau) => (t < t0 ? 0 : Math.exp(-(t - t0) / tau));

/** Attack-hold-release window: rises over `a` from t0, holds to t1, releases over `r`. */
export function ahr(t, t0, t1, a, r, ease = smooth) {
  if (t < t0 || t > t1 + r) return 0;
  if (t < t0 + a) return ease((t - t0) / a);
  if (t <= t1) return 1;
  return 1 - ease((t - t1) / r);
}

/** Triangle pulse peaking at `tc` with half-width `w`. */
export const pulse = (t, tc, w) => Math.max(0, 1 - Math.abs(t - tc) / w);
