// A treatment maps the song's timeline to scenes, transitions, automation and palettes.
// Times may be numbers (seconds) or references into motion.json events:
//
//   "@cuts[0]"             first hard cut              "@numb[2].t0"     start of the 3rd numb window
//   "@key_changes[0].t"    the key change              "@key_changes[0].pivot"
//   "@sections.C1.t0"      start of section C1         "@end_stop"       the hard stop
//   "@downbeats[51]"       a downbeat by index         "@loudest"
//
// followed by any number of offsets: "+2b" (beats), "-1bar", "+0.5s", "-3f" (frames).
// A parameter is a constant or keyframes [[time, value, ease?], ...]; the ease of a segment is the
// one written on the key it moves towards. Values may be numbers, hex colours or number arrays.

import fs from 'fs';
import { mix } from './color.mjs';
import { EASES } from './ease.mjs';

const REF = /^@([a-z_]+)(?:\[(-?\d+)\]|\.([A-Za-z0-9]+))?(?:\.([a-z0-9_]+))?((?:[+-](?:\d+\.?\d*|\.\d+)(?:bar|b|s|f))*)$/;
const OFF = /([+-](?:\d+\.?\d*|\.\d+))(bar|b|s|f)/g;
const FIELD = { t: 0, t0: 0, t1: 1, s: 1 };

export function resolveTime(x, feats) {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') throw new Error(`bad time ${JSON.stringify(x)}`);
  if (!x.startsWith('@')) {
    const v = Number(x);
    if (!Number.isFinite(v)) throw new Error(`bad time "${x}"`);
    return v;
  }
  const m = REF.exec(x);
  if (!m) throw new Error(`bad time reference "${x}"`);
  const [, name, idx, label, field, offs] = m;
  const ev = feats.ev[name];
  if (ev === undefined || ev === null) throw new Error(`time reference "${x}": no event "${name}"`);
  let item;
  if (typeof ev === 'number') {
    item = ev;
  } else if (label !== undefined) {
    item = ev.find((e) => e.label === label);
    if (!item) throw new Error(`time reference "${x}": no ${name} labelled ${label}`);
  } else if (idx !== undefined) {
    const i = Number(idx) < 0 ? ev.length + Number(idx) : Number(idx);
    item = ev[i];
    if (item === undefined) throw new Error(`time reference "${x}": index ${idx} out of range (${ev.length})`);
  } else {
    item = ev;
  }
  let v;
  if (typeof item === 'number') v = item;
  else if (Array.isArray(item)) {
    const f = field === undefined ? 0 : field in FIELD ? FIELD[field] : Number(field);
    v = item[f];
  } else {
    v = item[field === undefined ? ('t' in item ? 't' : 't0') : field];
  }
  if (typeof v !== 'number') throw new Error(`time reference "${x}" did not resolve to a number`);
  for (const [, n, unit] of (offs || '').matchAll(OFF)) {
    const k = Number(n);
    v += unit === 's' ? k : unit === 'b' ? k * feats.beatS : unit === 'bar' ? k * feats.beatS * feats.bpb : k / feats.fps;
  }
  return v;
}

/** A duration: seconds, or a string like "1b", "2bar", "0.5s", "10f". */
export function resolveDuration(x, feats) {
  if (typeof x === 'number') return x;
  const m = /^(\d+\.?\d*|\.\d+)(bar|b|s|f)$/.exec(String(x));
  if (!m) throw new Error(`bad duration "${x}"`);
  const k = Number(m[1]);
  return m[2] === 's' ? k : m[2] === 'b' ? k * feats.beatS : m[2] === 'bar' ? k * feats.beatS * feats.bpb : k / feats.fps;
}

function lerpValue(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('#') && b.startsWith('#')) return mix(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v + (b[i] - v) * t);
  return t < 1 ? a : b;
}

/** Compile a parameter (constant or keyframes) into a function of t. */
export function compileParam(spec, feats) {
  const isKeys = Array.isArray(spec) && spec.length > 0 && Array.isArray(spec[0]) && spec[0].length >= 2 &&
    (typeof spec[0][0] === 'number' || (typeof spec[0][0] === 'string' && (spec[0][0].startsWith('@') || /^-?\d/.test(spec[0][0]))));
  if (!isKeys) return () => spec;
  const keys = spec.map(([time, value, ease]) => {
    const e = EASES[ease || 'smooth'];
    if (!e) throw new Error(`unknown ease "${ease}"`);
    return { t: resolveTime(time, feats), value, ease: e };
  }).sort((p, q) => p.t - q.t);
  return (t) => {
    if (t <= keys[0].t) return keys[0].value;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.value;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[i + 1];
    return lerpValue(a.value, b.value, b.ease((t - a.t) / Math.max(b.t - a.t, 1e-9)));
  };
}

export class Treatment {
  constructor(spec, feats, registry = null) {
    this.spec = spec;
    this.feats = feats;
    this.palettes = spec.palettes || {};
    this.global = { degPerSemi: 30, ...(spec.global || {}) };
    this.postFns = Object.fromEntries(Object.entries(spec.post || {}).map(([k, v]) => [k, compileParam(v, feats)]));
    this.title = spec.title || null;
    this.timeline = (spec.timeline || []).map((e, idx) => this._compileEntry(e, idx, registry));
    this.timeline.sort((a, b) => a.t0 - b.t0);
    this.transitions = (spec.transitions || []).map((tr) => ({
      ...tr,
      t: resolveTime(tr.t, feats),
      dur: tr.dur === undefined ? 0.5 : resolveDuration(tr.dur, feats),
      pre: tr.pre === undefined ? 0 : resolveDuration(tr.pre, feats),
      params: Object.fromEntries(Object.entries(tr.params || {}).map(([k, v]) => [k, compileParam(v, feats)])),
    }));
  }

  static load(path, feats, registry) {
    return new Treatment(JSON.parse(fs.readFileSync(path, 'utf8')), feats, registry);
  }

  _compileEntry(e, idx, registry) {
    if (!e.id || !e.scene) throw new Error(`timeline entry ${idx} needs "id" and "scene"`);
    const t0 = resolveTime(e.t0, this.feats);
    const t1 = resolveTime(e.t1, this.feats);
    if (!(t1 > t0)) throw new Error(`timeline entry "${e.id}" has t1 <= t0 (${t0}, ${t1})`);
    const sceneMod = registry ? registry[e.scene] : null;
    if (registry && !sceneMod) throw new Error(`timeline entry "${e.id}": unknown scene "${e.scene}"`);
    const defaults = (sceneMod && sceneMod.defaults) || {};
    const params = {};
    for (const [k, v] of Object.entries({ ...defaults, ...(e.params || {}) })) params[k] = compileParam(v, this.feats);
    const post = {};
    for (const [k, v] of Object.entries(e.post || {})) post[k] = compileParam(v, this.feats);
    const pal = typeof e.palette === 'string' ? this.palettes[e.palette] : e.palette;
    if (e.palette && !pal) throw new Error(`timeline entry "${e.id}": unknown palette "${e.palette}"`);
    const fadeIn = e.in && e.in.type === 'crossfade' ? resolveDuration(e.in.dur ?? 0.5, this.feats) : 0;
    return { ...e, t0, t1, params, post, palette: pal || {}, fadeIn, seedKey: e.seed ?? e.id };
  }

  /** Scene entries active at t with blend weights (crossfades overlap the previous entry). */
  activeAt(t) {
    const out = [];
    const tl = this.timeline;
    for (let i = 0; i < tl.length; i++) {
      const e = tl[i];
      const next = tl[i + 1];
      const tailEnd = next && next.fadeIn ? Math.max(e.t1, next.t0 + next.fadeIn) : e.t1;
      if (t < e.t0 || t >= tailEnd) continue;
      let w = 1;
      if (e.fadeIn && t < e.t0 + e.fadeIn) w = (t - e.t0) / e.fadeIn;
      out.push({ entry: e, weight: Math.max(0, Math.min(1, w)) });
    }
    return out;
  }

  params(entry, t) {
    const P = {};
    for (const [k, f] of Object.entries(entry.params)) P[k] = f(t);
    return P;
  }

  /** Post-processing parameters at t: global defaults, overridden by the entry's own. */
  postParams(entry, t) {
    const P = {};
    for (const [k, f] of Object.entries(this.postFns)) P[k] = f(t);
    for (const [k, f] of Object.entries(entry ? entry.post : {})) P[k] = f(t);
    return P;
  }

  transitionsAt(t) {
    return this.transitions.filter((tr) => t >= tr.t - (tr.pre || 0) && t < tr.t + tr.dur);
  }

  /** Check the timeline covers [0, end] with no gaps. Returns a list of problems (empty = fine). */
  coverageProblems(end) {
    const probs = [];
    const tl = this.timeline;
    if (!tl.length) return ['empty timeline'];
    if (tl[0].t0 > 1e-6) probs.push(`gap at start: first scene starts at ${tl[0].t0}`);
    for (let i = 1; i < tl.length; i++) {
      if (tl[i].t0 > tl[i - 1].t1 + 1e-6) probs.push(`gap ${tl[i - 1].t1}..${tl[i].t0} between "${tl[i - 1].id}" and "${tl[i].id}"`);
    }
    if (tl[tl.length - 1].t1 < end - 1e-6) probs.push(`gap at end: last scene ends at ${tl[tl.length - 1].t1} < ${end}`);
    return probs;
  }
}
