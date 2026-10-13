// Access to audiotool's motion.json: per-frame feature columns plus event lists.
//
//   const feats = Features.load(path)
//   const F = feats.at(t)          // per-frame view handed to scenes
//   F.c.hit, F.c.voc_lvl ...       // every column sampled at t (linear between frames)
//   F.col('pad_rel', t - 0.5)      // a column at another time (trails, look-back)
//   F.integral('pad_rel', a, b)    // integral over [a, b] in column-seconds (prefix sums, O(1))
//   F.last('hit', t) / F.next('downbeats', t) / F.between('voc_notes', a, b)
//   F.impulse('kick', t, 0.2)      // decaying impulse from events, same rule as motion.py
//
// Nothing here keeps per-frame state, so any frame can be computed in any order.

import fs from 'fs';
import { landFrame } from './clock.mjs';

const keyOf = (e, key) => (Array.isArray(e) ? e[typeof key === 'number' ? key : 0] : typeof e === 'number' ? e : e[key]);

export class Features {
  constructor(motion) {
    this.m = motion;
    this.fps = motion.fps;
    this.n = motion.n_frames;
    this.duration = motion.duration_s;
    this.bpb = motion.bpb;
    this.beatS = motion.beat_s;
    this.ev = motion.events;
    this.cols = {};
    this.prefix = {};
    for (const [k, v] of Object.entries(motion.columns)) {
      const a = Float64Array.from(v);
      this.cols[k] = a;
    }
    this.names = Object.keys(this.cols);
    this._times = new Map();
  }

  static load(path) {
    return new Features(JSON.parse(fs.readFileSync(path, 'utf8')));
  }

  has(name) {
    return name in this.cols;
  }

  /** Column value at time t (seconds): linear interpolation between frames, clamped at the ends. */
  col(name, t) {
    const a = this.cols[name];
    if (!a) throw new Error(`unknown feature column "${name}"`);
    const x = t * this.fps;
    if (x <= 0) return a[0];
    if (x >= this.n - 1) return a[this.n - 1];
    const i = Math.floor(x), f = x - i;
    return f === 0 ? a[i] : a[i] + (a[i + 1] - a[i]) * f;
  }

  /** Column value at an integer frame (clamped). */
  atFrame(name, i) {
    const a = this.cols[name];
    if (!a) throw new Error(`unknown feature column "${name}"`);
    return a[Math.max(0, Math.min(this.n - 1, i))];
  }

  _prefix(name) {
    let p = this.prefix[name];
    if (!p) {
      const a = this.cols[name];
      if (!a) throw new Error(`unknown feature column "${name}"`);
      p = new Float64Array(a.length + 1);
      for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i] / this.fps;
      this.prefix[name] = p;
    }
    return p;
  }

  /** Integral of a column over [t0, t1] in value-seconds, from prefix sums (frame resolution). */
  integral(name, t0, t1) {
    const p = this._prefix(name);
    const P = (t) => {
      const x = Math.max(0, Math.min(this.n, t * this.fps));
      const i = Math.floor(x), f = x - i;
      return i >= this.n ? p[this.n] : p[i] + (p[i + 1] - p[i]) * f;
    };
    return P(t1) - P(t0);
  }

  list(name) {
    const l = this.ev[name];
    if (l === undefined) throw new Error(`unknown event list "${name}"`);
    return Array.isArray(l) ? l : [];
  }

  _timesOf(name, key) {
    const id = `${name}|${key}`;
    let ts = this._times.get(id);
    if (!ts) {
      ts = Float64Array.from(this.list(name).map((e) => keyOf(e, key)));
      this._times.set(id, ts);
    }
    return ts;
  }

  /** Index of the last event with time <= t (-1 if none). Events must be sorted by that key. */
  lastIndex(name, t, key = 0) {
    const ts = this._timesOf(name, key);
    let lo = 0, hi = ts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
  }

  last(name, t, key = 0) {
    const i = this.lastIndex(name, t, key);
    return i >= 0 ? this.list(name)[i] : null;
  }

  next(name, t, key = 0) {
    const i = this.lastIndex(name, t, key) + 1;
    const l = this.list(name);
    return i < l.length ? l[i] : null;
  }

  between(name, a, b, key = 0) {
    const l = this.list(name);
    const i0 = this.lastIndex(name, a - 1e-9, key) + 1;
    const i1 = this.lastIndex(name, b - 1e-9, key) + 1;
    return l.slice(i0, i1);
  }

  /** Max of decaying impulses from events (strength at index `sIdx`, or 1), landing-frame rule. */
  impulse(name, t, tau, sIdx = 1) {
    const l = this.list(name);
    let v = 0;
    let i = this.lastIndex(name, t + 0.5 / this.fps);
    const frame = t * this.fps;
    for (; i >= 0; i--) {
      const e = l[i];
      const L = landFrame(keyOf(e, 0), this.fps);
      if (L > frame + 1e-9) continue;
      const dt = (frame - L) / this.fps;
      if (dt > tau * 7) break;
      const s = Array.isArray(e) && typeof e[sIdx] === 'number' ? e[sIdx] : 1;
      v = Math.max(v, s * Math.exp(-dt / tau));
    }
    return v;
  }

  sectionAt(t) {
    const secs = this.ev.sections || [];
    for (const s of secs) if (t >= s.t0 && t < s.t1) return s;
    return secs[secs.length - 1] || null;
  }

  /** Total hue lift (degrees) from key changes: semis x degPerSemi, landing half then settling over a beat. */
  liftDeg(t, degPerSemi = 30) {
    let d = 0;
    const frame = Math.round(t * this.fps);
    const beatFrames = Math.max(1, Math.round(this.beatS * this.fps));
    for (const kc of this.ev.key_changes || []) {
      const L = landFrame(kc.t, this.fps);
      if (frame < L) continue;
      const x = Math.min(1, (frame - L) / beatFrames);
      d += (kc.semis || 0) * degPerSemi * (0.5 + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * x)));
    }
    return d;
  }

  /** The per-frame view handed to scenes. */
  at(t) {
    const c = {};
    for (const k of this.names) c[k] = this.col(k, t);
    const self = this;
    return {
      t,
      frame: Math.round(t * this.fps),
      fps: this.fps,
      beatS: this.beatS,
      bpb: this.bpb,
      duration: this.duration,
      c,
      ev: this.ev,
      col: (name, t2) => self.col(name, t2),
      integral: (name, a, b) => self.integral(name, a, b),
      last: (name, t2 = t, key) => self.last(name, t2, key),
      next: (name, t2 = t, key) => self.next(name, t2, key),
      between: (name, a, b, key) => self.between(name, a, b, key),
      impulse: (name, tau, sIdx, t2 = t) => self.impulse(name, t2, tau, sIdx),
      section: (t2 = t) => self.sectionAt(t2),
      liftDeg: (t2 = t) => self.liftDeg(t2),
    };
  }
}
