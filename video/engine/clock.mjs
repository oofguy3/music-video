// Frame <-> time conventions shared with audiotool/motion.py.
// Frame i shows time i / fps. An event at time t (as written in motion.json, 4 decimals) lands on
// frame floor(t * fps + 0.5) -- the nearest frame, halves rounding up (Python uses the same rule).

export const landFrame = (t, fps) => Math.floor(t * fps + 0.5);
export const timeOf = (i, fps) => i / fps;

/** Parse "a:b" frame ranges (end exclusive); open ends allowed ("100:", ":200"). */
export function parseRange(spec, n) {
  if (!spec) return [0, n];
  const [a, b] = spec.split(':');
  const lo = a === '' || a === undefined ? 0 : Number(a);
  const hi = b === '' || b === undefined ? n : Number(b);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > n || lo >= hi) {
    throw new Error(`bad frame range "${spec}" for ${n} frames`);
  }
  return [lo, hi];
}

/** mm:ss.ff label for logs and review sheets. */
export function stamp(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
