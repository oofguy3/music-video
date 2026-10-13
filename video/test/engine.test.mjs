import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { landFrame, parseRange } from '../engine/clock.mjs';
import { hexToRgb, mix, rotateHue, rgbToHex } from '../engine/color.mjs';
import { Features } from '../engine/features.mjs';
import { hash01, hash32, noise2 } from '../engine/noise.mjs';
import { compileParam, resolveDuration, resolveTime, Treatment } from '../engine/treatment.mjs';
import { autoTreatment } from '../treatments/auto.mjs';
import { fixtureMotion } from './fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('landing rule matches motion.py (nearest frame, halves up)', () => {
  assert.equal(landFrame(169.975, 30), 5099);
  assert.equal(landFrame(97.76, 30), 2933);
  assert.equal(landFrame(0.15, 30), 5);
  assert.equal(landFrame(0.05, 30), 2);
  assert.deepEqual(parseRange('10:20', 100), [10, 20]);
  assert.deepEqual(parseRange(null, 100), [0, 100]);
  assert.throws(() => parseRange('50:40', 100));
});

test('hashes and noise are deterministic and in range', () => {
  assert.equal(hash32(1, 2, 3), hash32(1, 2, 3));
  assert.notEqual(hash32(1, 2, 3), hash32(1, 2, 4));
  for (let i = 0; i < 1000; i++) {
    const v = hash01(i, 9);
    assert.ok(v >= 0 && v < 1);
    const n = noise2(5, i * 0.37, i * 0.11);
    assert.ok(n >= -1 && n <= 1);
  }
});

test('colour round trips and hue rotation', () => {
  for (const hex of ['#05060f', '#ffb25e', '#cfefff', '#ff6fa0', '#3a1446']) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex);
    const full = rotateHue(hex, 360);
    const [a, b] = [hexToRgb(hex), hexToRgb(full)];
    assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= 2), `${hex} rotated 360 -> ${full}`);
  }
  // low-chroma colours stay in gamut, so a rotation there and back is (nearly) exact
  const back = rotateHue(rotateHue('#3a1446', 30), -30);
  assert.ok(hexToRgb('#3a1446').every((v, i) => Math.abs(v - hexToRgb(back)[i]) <= 2), back);
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
});

test('features: interpolation, prefix integrals, event search, impulses', () => {
  const m = fixtureMotion();
  const F = new Features(m);
  const a = F.cols.pad_rel;
  assert.equal(F.col('pad_rel', 3 / m.fps), a[3]);
  assert.ok(Math.abs(F.col('pad_rel', 3.5 / m.fps) - (a[3] + a[4]) / 2) < 1e-12);
  let brute = 0;
  for (let i = 10; i < 40; i++) brute += a[i] / m.fps;
  assert.ok(Math.abs(F.integral('pad_rel', 10 / m.fps, 40 / m.fps) - brute) < 1e-9);
  assert.equal(F.last('downbeats', 1.0), 0.8);
  assert.equal(F.next('downbeats', 1.0), 1.6);
  assert.deepEqual(F.between('downbeats', 0.8, 2.4), [0.8, 1.6]);
  // impulse from events equals the motion.py column on landing frames
  for (const [t, s] of m.events.kick) {
    const L = landFrame(t, m.fps);
    assert.ok(Math.abs(F.impulse('kick', L / m.fps, 0.14) - s) < 1e-9);
    assert.ok(Math.abs(F.impulse('kick', (L - 1) / m.fps, 0.14) - (F.impulse('kick', (L - 1) / m.fps, 0.14))) < 1e-12);
  }
});

test('treatment: time references, durations, keyframes, coverage', () => {
  const F = new Features(fixtureMotion());
  assert.equal(resolveTime('@cuts[0]', F), 2.4);
  assert.equal(resolveTime('@downbeats[1]', F), 0.8);
  assert.ok(Math.abs(resolveTime('@downbeats[1]-1b', F) - 0.4) < 1e-9);      // beat = 0.4 s
  assert.ok(Math.abs(resolveTime('@downbeats[1]+1bar', F) - 2.4) < 1e-9);    // bar = 1.6 s
  assert.equal(resolveTime('@key_changes[0].t', F), 1.6);
  assert.equal(resolveTime('@key_changes[0].pivot', F), 1.2);
  assert.equal(resolveTime('@sections.B1.t0', F), 1.6);
  assert.equal(resolveTime('@numb[0].t1', F), 2.0);
  assert.equal(resolveTime('@end_stop', F), 3.5);
  assert.throws(() => resolveTime('@nope[0]', F));
  assert.throws(() => resolveTime('@cuts[9]', F));
  assert.ok(Math.abs(resolveDuration('2b', F) - 0.8) < 1e-9);
  const p = compileParam([[0, 0], ['@downbeats[1]', 1, 'linear'], [2.0, '#ffffff']], F);
  assert.equal(p(0.4), 0.5);
  assert.equal(compileParam(7, F)(1), 7);
  assert.ok(Math.abs(compileParam('@downbeats[1]', F)(0) - 0.8) < 1e-9);    // constant reference
  assert.equal(compileParam('line', F)(0), 'line');
  assert.equal(compileParam('#E6A930', F)(0), '#E6A930');
  const reg = { debug: { defaults: { a: 1 } } };
  const tr = new Treatment({ timeline: [
    { id: 'x', scene: 'debug', t0: 0, t1: '@sections.B1.t0' },
    { id: 'y', scene: 'debug', t0: '@sections.B1.t0', t1: '@end', in: { type: 'crossfade', dur: '1b' } },
  ] }, F, reg);
  assert.deepEqual(tr.coverageProblems(F.duration), []);
  const act = tr.activeAt(1.7);
  assert.equal(act.length, 2);
  assert.ok(act[1].weight > 0 && act[1].weight < 1);
  assert.equal(tr.params(tr.timeline[0], 0).a, 1);
});

test('auto treatment covers the song with known scenes', () => {
  const m = fixtureMotion();
  const spec = autoTreatment(m);
  const F = new Features(m);
  const names = ['memories', 'crowd', 'void', 'orbit', 'ember'];
  const reg = Object.fromEntries(names.map((n) => [n, { defaults: {} }]));
  const tr = new Treatment(spec, F, reg);
  assert.deepEqual(tr.coverageProblems(F.duration), []);
  assert.ok(tr.timeline.every((e) => names.includes(e.scene)));
});

test('the numb-roomie treatment resolves against the real analysis', { skip: !fs.existsSync(path.join(HERE, '../../out/numb-roomie/stages/motion.json')) }, async () => {
  const F = Features.load(path.join(HERE, '../../out/numb-roomie/stages/motion.json'));
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, '../treatments/numb-roomie.json'), 'utf8'));
  const { loadScenes } = await import('../scenes/index.mjs');
  const reg = await loadScenes();
  const proxy = new Proxy(reg, { get: (o, k) => (k in o ? o[k] : o.debug) });
  const tr = new Treatment(spec, F, proxy);
  assert.deepEqual(tr.coverageProblems(F.duration), []);
  assert.equal(Math.floor(tr.timeline.find((e) => e.id === 'orbit').t0 * 30 + 0.5), 2933);
});
