import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderFrames } from '../engine/pool.mjs';
import { fixtureMotion } from './fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const listMjs = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => path.join(dir, f)) : [];
const sceneFiles = () => [...listMjs(path.join(ROOT, 'scenes')), ...listMjs(path.join(ROOT, 'scenes', 'lib'))];
const engineFiles = () => fs.readdirSync(path.join(ROOT, 'engine')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(ROOT, 'engine', f));
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('only the title card draws text', () => {
  for (const f of sceneFiles()) {
    if (path.basename(f) === 'title.mjs') continue;
    assert.ok(!/\b(fillText|strokeText)\s*\(/.test(strip(read(f))), `${path.basename(f)} draws text`);
  }
});

test('scenes and render engine are pure (no Math.random, Date, performance)', () => {
  const allowed = new Set(['pool.mjs', 'worker.mjs']);   // timing/progress only, never pixels
  for (const f of [...sceneFiles(), ...engineFiles()]) {
    if (allowed.has(path.basename(f))) continue;
    const src = strip(read(f));
    assert.ok(!/Math\.random\s*\(/.test(src), `${path.basename(f)} uses Math.random`);
    assert.ok(!/\bDate\b/.test(src), `${path.basename(f)} uses Date`);
    assert.ok(!/\bperformance\.now\b/.test(src), `${path.basename(f)} uses performance.now`);
  }
});

test('no lyric lines in scenes or treatments', { skip: !fs.existsSync(path.join(ROOT, '../out/numb-roomie/stages/lyrics.json')) }, () => {
  // Any run of 4 consecutive transcribed words appearing verbatim would be quoting the lyrics.
  const lyr = JSON.parse(read(path.join(ROOT, '../out/numb-roomie/stages/lyrics.json')));
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ');
  const runs = new Set();
  for (const ln of lyr.lines || []) {
    const ws = (ln.words || []).map((w) => norm(w[2]).trim()).filter(Boolean);
    for (let i = 0; i + 4 <= ws.length; i++) runs.add(ws.slice(i, i + 4).join(' '));
  }
  const files = [...sceneFiles(), ...fs.readdirSync(path.join(ROOT, 'treatments')).map((f) => path.join(ROOT, 'treatments', f))];
  for (const f of files) {
    const text = norm(read(f));
    for (const r of runs) assert.ok(!text.includes(r), `${path.basename(f)} quotes the lyrics ("${r.split(' ')[0]} ...")`);
  }
});

test('worker pool delivers frames in order and identically for 1 or 3 workers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-'));
  const motion = path.join(dir, 'motion.json');
  fs.writeFileSync(motion, JSON.stringify(fixtureMotion()));
  const treatment = path.join(dir, 't.json');
  fs.writeFileSync(treatment, JSON.stringify({ timeline: [{ id: 'd', scene: 'debug', t0: 0, t1: '@end' }],
    transitions: [{ type: 'flash', t: '@cuts[0]', dur: 0.4 }], post: { bloom: 0.3, vignette: 0.3, grain: 0.05 } }));
  const frames = Array.from({ length: 12 }, (_, i) => i * 9);
  const run = async (workers) => {
    const order = [];
    const hashes = [];
    await renderFrames({ frames, workers, opts: { width: 192, height: 108, motion, treatment }, onFrame: (i, buf) => {
      order.push(i);
      hashes.push(crypto.createHash('sha256').update(buf).digest('hex'));
    } });
    return { order, hashes };
  };
  const a = await run(1), b = await run(3);
  assert.deepEqual(a.order, frames);
  assert.deepEqual(b.order, frames);
  assert.deepEqual(a.hashes, b.hashes);
  // the hard stop (3.5 s = frame 105) is black
  fs.rmSync(dir, { recursive: true, force: true });
});
