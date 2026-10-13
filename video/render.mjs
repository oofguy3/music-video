#!/usr/bin/env node
// Music-video renderer CLI.
//
//   node render.mjs full                      1920x1080 final (x264 slow, crf 18) with audio
//   node render.mjs preview                   960x540 quick look (veryfast) with audio
//   node render.mjs stills --frames 100,2933  PNG stills (default 960x540; --size 1920x1080)
//   node render.mjs sheet --entry milksea     contact sheet of a timeline entry (or --range a:b)
//   node render.mjs strip --around 2933       consecutive frames around an event (--radius 4)
//   node render.mjs review                    the whole review pack (sheets, strips, filmstrip, metrics)
//   node render.mjs hashes --frames 1,2,3     SHA-256 of rendered RGBA (determinism checks)
//   node render.mjs cut                       short cut (final chorus + outro) from the full render
//   node render.mjs web --src FILE [--cap 29]  delivery copy that fits a size cap (two-pass, light denoise)
//   node render.mjs bench [--entry id]        ms/frame per timeline entry at 1080p
//   node render.mjs purity --entry id         same frames forward/1 worker vs reverse/2 workers
//
// Common options: --motion PATH --treatment PATH --out DIR --workers N --range a:b
//                 --scenes debug (override every scene) --size WxH --no-dither --no-post

import crypto from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, ImageData } from './engine/canvas.mjs';
import { parseRange, stamp } from './engine/clock.mjs';
import { Features } from './engine/features.mjs';
import { cutArgs, encodeArgs, ffprobe, run, spawnEncoder, webArgs, X264 } from './engine/ffmpeg.mjs';
import { createRenderer } from './engine/frame.mjs';
import { renderFrames } from './engine/pool.mjs';
import { resolveTime, Treatment } from './engine/treatment.mjs';
import { loadScenes } from './scenes/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const log = (...a) => console.error('[video]', ...a);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) out[k] = true;
      else { out[k] = v; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'help';
const slug = args.slug || 'numb-roomie';
const songDir = path.resolve(REPO, 'out', slug);
const motionPath = path.resolve(args.motion || path.join(songDir, 'stages', 'motion.json'));
const treatmentPath = path.resolve(args.treatment || path.join(HERE, 'treatments', `${slug}.json`));
const outDir = path.resolve(args.out || path.join(songDir, 'video'));
const workers = Number(args.workers || 3);
const sceneOverride = typeof args.scenes === 'string' ? args.scenes : null;

function size(def) {
  const s = typeof args.size === 'string' ? args.size : def;
  const [w, h] = s.split('x').map(Number);
  if (!(w > 0 && h > 0) || w % 2 || h % 2) throw new Error(`bad --size ${s}`);
  return [w, h];
}

function guardIgnored(dir) {
  // Rendered video contains the song: never let it land somewhere git would pick it up.
  fs.mkdirSync(dir, { recursive: true });
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
  if (inside.status !== 0) return;
  const r = spawnSync('git', ['check-ignore', '-q', dir], { cwd: dir });
  if (r.status !== 0) throw new Error(`refusing to write video to ${dir}: it is not gitignored`);
}

function opts(w, h, extra = {}) {
  return { width: w, height: h, motion: motionPath, treatment: treatmentPath, sceneOverride,
    dither: !args['no-dither'], post: !args['no-post'], ...extra };
}

function framesFrom(n) {
  if (typeof args.frames === 'string') return args.frames.split(',').map((x) => Number(x.trim()));
  if (typeof args.times === 'string') return args.times.split(',').map((x) => Math.floor(Number(x) * feats().fps + 0.5));
  const [a, b] = parseRange(typeof args.range === 'string' ? args.range : null, n);
  return Array.from({ length: b - a }, (_, i) => a + i);
}

let _feats = null;
const feats = () => (_feats ||= Features.load(motionPath));

async function treatment() {
  const reg = await loadScenes();
  const proxy = new Proxy(reg, { get: (o, k) => (k in o ? o[k] : o.debug) });
  return Treatment.load(treatmentPath, feats(), proxy);
}

function rgbaToCanvas(buf, w, h) {
  const c = createCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length).slice(), w, h), 0, 0);
  return c;
}

async function encode(kind) {
  const [w, h] = kind === 'full' ? size('1920x1080') : size('960x540');
  const F = feats();
  const frames = framesFrom(F.n);
  const range = [frames[0], frames[frames.length - 1] + 1];
  const dir = kind === 'full' ? outDir : path.join(outDir, 'preview');
  guardIgnored(dir);
  const name = args.name || (kind === 'full' ? `${slug}.mp4` : `${slug}-preview${sceneOverride ? '-' + sceneOverride : ''}.mp4`);
  const out = path.join(dir, name);
  const x = X264[kind];
  const mix = path.join(songDir, 'audio', 'mix.wav');
  const full = range[0] === 0 && range[1] === F.n;
  const enc = spawnEncoder(encodeArgs({ w, h, fps: F.fps, out, audio: args['no-audio'] ? null : mix, sr: F.m.sr,
    range: full ? null : range, preset: args.preset || x.preset, crf: Number(args.crf || x.crf) }));
  log(`${kind}: ${frames.length} frames ${w}x${h} -> ${out} (${workers} workers)`);
  const { ms, seconds } = await renderFrames({ frames, workers, opts: opts(w, h), log, onFrame: (i, buf) => enc.write(buf) });
  await enc.end();
  await writeMetrics(frames, ms, path.join(dir, `${path.parse(name).name}.metrics.json`), seconds);
  log(`wrote ${out} in ${seconds.toFixed(1)}s`);
  return out;
}

async function writeMetrics(frames, ms, file, seconds, sceneMs = null) {
  const tr = await treatment();
  const per = {};
  const perScene = {};
  frames.forEach((i, j) => {
    const t = i / feats().fps;
    const act = tr.activeAt(t);
    const id = act.length ? act[act.length - 1].entry.id : 'none';
    (per[id] ||= []).push(ms[j]);
    if (sceneMs) (perScene[id] ||= []).push(sceneMs[j]);
  });
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const out = { seconds, frames: frames.length, width: null, entries: {} };
  for (const [id, a] of Object.entries(per)) {
    out.entries[id] = { n: a.length, p50: +pct(a, 0.5).toFixed(1), p95: +pct(a, 0.95).toFixed(1), max: +Math.max(...a).toFixed(1) };
    if (perScene[id]) {
      const sm = perScene[id];
      out.entries[id].scene_p50 = +pct(sm, 0.5).toFixed(1);
      out.entries[id].scene_p95 = +pct(sm, 0.95).toFixed(1);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  return out;
}

async function renderTo(frames, w, h, onImage, nWorkers = workers) {
  return renderFrames({ frames, workers: nWorkers, opts: opts(w, h), log: () => {}, onFrame: (i, buf, j) => onImage(i, rgbaToCanvas(buf, w, h), j) });
}

async function stills() {
  const [w, h] = size('960x540');
  const frames = typeof args.entry === 'string' && !args.frames ? await entryFrames(args.entry, Number(args.count || 8)) : framesFrom(feats().n);
  const dir = path.join(outDir, 'stills', args.label || 'misc');
  guardIgnored(dir);
  await renderTo(frames, w, h, (i, c) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.png`), c.toBuffer('image/png')));
  log(`${frames.length} stills -> ${dir}`);
}

function label(ctx, text, x, y, size = 14) {
  ctx.font = `${size}px "DejaVu Sans Mono", monospace`;
  ctx.fillStyle = '#d8d8d8';
  ctx.fillText(text, x, y);
}

async function sheetOf(frames, file, { cols = 4, cw = 480, ch = 270, title = '' } = {}) {
  const rows = Math.ceil(frames.length / cols);
  const pad = 26;
  const sheet = createCanvas(cols * cw, rows * (ch + pad) + (title ? 30 : 0));
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#1b1b1b';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  if (title) label(sx, title, 8, 21, 16);
  const top = title ? 30 : 0;
  const tr = await treatment();
  await renderTo(frames, cw, ch, (i, c, j) => {
    const x = (j % cols) * cw, y = top + Math.floor(j / cols) * (ch + pad);
    sx.drawImage(c, x, y + pad);
    const t = i / feats().fps;
    const act = tr.activeAt(t);
    const sec = feats().sectionAt(t);
    label(sx, `f${i} ${stamp(t)} ${sec ? sec.label : ''} ${act.length ? act[act.length - 1].entry.id : ''}`, x + 6, y + 18, 13);
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sheet.toBuffer('image/png'));
  return file;
}

async function sheet() {
  const F = feats();
  let frames;
  let name = args.name;
  if (typeof args.entry === 'string') {
    const tr = await treatment();
    const e = tr.timeline.find((x) => x.id === args.entry);
    if (!e) throw new Error(`no timeline entry "${args.entry}"`);
    const n = Number(args.count || 16);
    const a = Math.round(e.t0 * F.fps), b = Math.min(F.n - 1, Math.round(e.t1 * F.fps) - 1);
    frames = Array.from({ length: n }, (_, k) => Math.round(a + ((b - a) * k) / Math.max(1, n - 1)));
    name ||= `sheet-${e.id}.png`;
  } else {
    frames = framesFrom(F.n);
    const step = Number(args.step || 1);
    frames = frames.filter((_, k) => k % step === 0);
    name ||= `sheet-${frames[0]}-${frames[frames.length - 1]}.png`;
  }
  const dir = path.join(outDir, 'sheets');
  guardIgnored(dir);
  const f = await sheetOf(frames, path.join(dir, name), { cols: Number(args.cols || 4), title: args.title || name });
  log(`sheet -> ${f}`);
}

async function strip() {
  const c = Number(args.around), r = Number(args.radius || 4);
  const frames = [];
  for (let i = c - r; i <= c + r; i++) if (i >= 0 && i < feats().n) frames.push(i);
  const dir = path.join(outDir, 'strips');
  guardIgnored(dir);
  const f = await sheetOf(frames, path.join(dir, args.name || `strip-${c}.png`), { cols: Number(args.cols || 3), cw: 400, ch: 225, title: args.title || `around frame ${c}` });
  log(`strip -> ${f}`);
}

async function review() {
  const F = feats();
  const tr = await treatment();
  const round = args.round || 'r1';
  const dir = path.join(outDir, 'review', round);
  guardIgnored(dir);
  const made = [];
  for (const e of tr.timeline) {
    const n = 16;
    const a = Math.round(e.t0 * F.fps), b = Math.min(F.n - 1, Math.round(e.t1 * F.fps) - 1);
    const frames = Array.from({ length: n }, (_, k) => Math.round(a + ((b - a) * k) / (n - 1)));
    made.push(await sheetOf(frames, path.join(dir, `sheet-${e.id}.png`), { title: `${e.id} (${e.scene}) ${stamp(e.t0)}-${stamp(e.t1)}` }));
  }
  const fps = F.fps;
  const land = (t) => Math.floor(t * fps + 0.5);
  const events = [];
  for (const [k, c] of (F.ev.cuts || []).entries()) events.push([`cut${k}`, land(c)]);
  for (const [k, kc] of (F.ev.key_changes || []).entries()) events.push([`key${k}`, land(kc.t)]);
  for (const [k, nb] of (F.ev.numb || []).entries()) events.push([`numb${k}`, land(nb[0])]);
  for (const e of tr.timeline) events.push([`start-${e.id}`, land(e.t0)]);
  if (F.ev.end_stop) events.push(['stop', land(F.ev.end_stop)]);
  const kicks = (F.ev.hit || []).filter((h) => h[1] > 0.8);
  for (const k of [0.3, 0.6, 0.9]) { const h = kicks[Math.floor(k * kicks.length)]; if (h) events.push([`hit${Math.round(k * 100)}`, land(h[0])]); }
  const seen = new Set();
  for (const [name, f] of events) {
    if (seen.has(f)) continue;
    seen.add(f);
    const frames = [];
    for (let i = f - 4; i <= f + 4; i++) if (i >= 0 && i < F.n) frames.push(i);
    made.push(await sheetOf(frames, path.join(dir, `strip-${name}-f${f}.png`), { cols: 3, cw: 400, ch: 225, title: `${name}: frames ${f - 4}..${f + 4} (event on f${f}, centre)` }));
  }
  const bar = F.beatS * F.bpb;
  const film = [];
  for (let t = 0; t < F.duration; t += 2 * bar) film.push(Math.min(F.n - 1, Math.round(t * fps)));
  made.push(await sheetOf(film, path.join(dir, 'filmstrip.png'), { cols: 8, cw: 240, ch: 135, title: 'story filmstrip: one frame every 2 bars' }));
  // timing at 1080p on a sample of frames per entry
  const sample = [];
  for (const e of tr.timeline) {
    const a = Math.round(e.t0 * fps), b = Math.min(feats().n - 1, Math.round(e.t1 * fps) - 1);
    for (let k = 0; k < 6; k++) sample.push(Math.round(a + ((b - a) * k) / 5));
  }
  const { ms, sceneMs, seconds } = await renderFrames({ frames: sample, workers: 1, opts: opts(1920, 1080, { timing: true }), onFrame: () => {} });
  const metrics = await writeMetrics(sample, ms, path.join(dir, 'metrics.json'), seconds, sceneMs);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ files: made.map((m) => path.relative(dir, m)), metrics }, null, 1));
  log(`review pack -> ${dir} (${made.length} images)`);
}

async function hashes() {
  const [w, h] = size('960x540');
  let frames = framesFrom(feats().n);
  if (args.order === 'rev') frames = [...frames].reverse();
  const out = {};
  await renderFrames({ frames, workers, opts: opts(w, h), onFrame: (i, buf) => { out[i] = crypto.createHash('sha256').update(buf).digest('hex'); } });
  const sorted = Object.fromEntries(Object.keys(out).map(Number).sort((a, b) => a - b).map((k) => [k, out[k]]));
  console.log(JSON.stringify(sorted));
}

async function cut() {
  const F = feats();
  const src = path.resolve(args.src || path.join(outDir, `${slug}.mp4`));
  const tr = await treatment();
  const sc = tr.spec.shortCut || {};
  const startFrame = Number(args.start ?? Math.floor(resolveTime(sc.start ?? 132.34, F) * F.fps + 0.5));
  const endFrame = Number(args.end ?? F.n);
  const out = path.join(outDir, args.name || `${slug}-short.mp4`);
  guardIgnored(outDir);
  run(cutArgs({ src, audio: path.join(songDir, 'audio', 'mix.wav'), sr: F.m.sr, fps: F.fps, startFrame, endFrame, fadeIn: Number(sc.fadeIn ?? 0.5), out }));
  log(`short cut frames ${startFrame}..${endFrame} -> ${out}`);
}

/** A delivery copy that fits a size cap (default 29 MiB): node render.mjs web --src FILE [--cap 29] [--name OUT]. */
async function web() {
  const src = path.resolve(args.src || path.join(outDir, `${slug}.mp4`));
  const info = ffprobe(src);
  const durationS = Number(info.format.duration);
  const out = path.join(path.dirname(src), args.name || `${path.parse(src).name}-web.mp4`);
  guardIgnored(path.dirname(out));
  const passlog = path.join(outDir, 'work', `x264-${path.parse(out).name}`);
  fs.mkdirSync(path.dirname(passlog), { recursive: true });
  const w = webArgs({ src, out, durationS, capMiB: Number(args.cap || 29), denoise: !args['no-denoise'], preset: args.preset || 'slow', passlog });
  log(`web: ${path.basename(src)} -> ${path.basename(out)} at ${w.videoK} kb/s video (${durationS.toFixed(2)} s)`);
  run(w.pass1);
  run(w.pass2);
  for (const f of fs.readdirSync(path.dirname(passlog))) if (f.startsWith(path.basename(passlog))) fs.rmSync(path.join(path.dirname(passlog), f));
  log(`wrote ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MiB)`);
}

async function bench() {
  const tr = await treatment();
  const fps = feats().fps;
  // Each entry: 4 warm-up frames (JIT, sprite caches; excluded) then `count` evenly spaced frames.
  const n = Number(args.count || 24);
  const sample = [], keep = [];
  for (const e of tr.timeline.filter((x) => typeof args.entry !== 'string' || x.id === args.entry)) {
    const a = Math.round(e.t0 * fps), b = Math.min(feats().n - 1, Math.round(e.t1 * fps) - 1);
    for (let k = 0; k < 4; k++) { sample.push(a + k); keep.push(false); }
    for (let k = 0; k < n; k++) { sample.push(Math.round(a + ((b - a) * k) / Math.max(1, n - 1))); keep.push(true); }
  }
  const [w, h] = size('1920x1080');
  const { ms, sceneMs, seconds } = await renderFrames({ frames: sample, workers: 1, opts: opts(w, h, { timing: true }), onFrame: () => {} });
  const pick = (arr) => Float64Array.from(arr.filter((_, j) => keep[j]));
  const m = await writeMetrics(sample.filter((_, j) => keep[j]), pick(ms), path.join(outDir, 'work', `bench${typeof args.entry === 'string' ? '-' + args.entry : ''}.json`), seconds, pick(sceneMs));
  console.log(JSON.stringify(m, null, 1));
}

function entryFrames(id, n) {
  return treatment().then((tr) => {
    const e = tr.timeline.find((x) => x.id === id);
    if (!e) throw new Error(`no timeline entry "${id}"`);
    const fps = feats().fps;
    const a = Math.round(e.t0 * fps), b = Math.min(feats().n - 1, Math.round(e.t1 * fps) - 1);
    return Array.from({ length: n }, (_, k) => Math.round(a + ((b - a) * k) / Math.max(1, n - 1)));
  });
}

/** Purity: the same frames rendered forward with 1 worker and in reverse with 2 must be identical. */
async function purity() {
  const [w, h] = size('480x270');
  const frames = typeof args.entry === 'string' ? await entryFrames(args.entry, Number(args.count || 10)) : framesFrom(feats().n);
  const hashOf = async (list, nw) => {
    const out = {};
    await renderFrames({ frames: list, workers: nw, opts: opts(w, h), onFrame: (i, buf) => { out[i] = crypto.createHash('sha256').update(buf).digest('hex'); } });
    return out;
  };
  const a = await hashOf(frames, 1);
  const b = await hashOf([...frames].reverse(), Math.min(2, frames.length));
  const bad = frames.filter((i) => a[i] !== b[i]);
  console.log(JSON.stringify({ frames: frames.length, identical: bad.length === 0, mismatched: bad }));
  if (bad.length) process.exitCode = 1;
}

async function probe() {
  console.log(JSON.stringify(ffprobe(path.resolve(args._[1]), { countFrames: !!args.count }), null, 1));
}

const COMMANDS = { full: () => encode('full'), preview: () => encode('preview'), stills, sheet, strip, review, hashes, cut, web, bench, purity, probe };

if (!COMMANDS[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd === 'help' ? 0 : 2);
}
COMMANDS[cmd]().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
