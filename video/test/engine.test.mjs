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
  assert.ok(Math.abs(resolveTime('1.5+3f', F) - (1.5 + 3 / F.fps)) < 1e-9);
  assert.ok(Math.abs(resolveTime('2-1b', F) - 1.6) < 1e-9);
  assert.throws(() => resolveTime('2+x', F));
  assert.throws(() => resolveTime('@nope[0]', F));
  assert.throws(() => resolveTime('@cuts[9]', F));
  assert.ok(Math.abs(resolveDuration('2b', F) - 0.8) < 1e-9);
  const p = compileParam([[0, 0], ['@downbeats[1]', 1, 'linear'], [2.0, '#ffffff']], F);
  assert.equal(p(0.4), 0.5);
  assert.equal(compileParam(7, F)(1), 7);
  const strobe = compileParam([[1.5, 0], [1.5, 1, 'step'], ['1.5+2f', 0, 'step']], F);
  assert.equal(strobe(1.5 - 1 / F.fps), 0);
  assert.equal(strobe(1.5), 1);
  assert.equal(strobe(1.5 + 1 / F.fps), 1);
  assert.equal(strobe(1.5 + 2 / F.fps), 0);
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
  const names = ['dusk', 'milksea', 'deep', 'goldlake', 'storm', 'lastkite'];
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
  assert.equal(Math.floor(tr.timeline.find((e) => e.id === 'goldlake').t0 * 30 + 0.5), 2933);
});

test('VJ post effects: driven amounts, deterministic, no-ops at zero', async () => {
  const { Post, vjAmount } = await import('../engine/post.mjs');
  const { createCanvas } = await import('../engine/canvas.mjs');
  const F = { frame: 7, c: { kick: 0.5 } };
  assert.equal(vjAmount({ zoom: 0.04 }, 'zoom', F), 0.04);
  assert.equal(vjAmount({ zoom: 0.04, zoomBy: 'kick' }, 'zoom', F), 0.02);
  assert.equal(vjAmount({ zoom: 0.04, zoomBy: 'nope' }, 'zoom', F), 0);
  const card = () => {
    const c = createCanvas(64, 36), x = c.getContext('2d');
    x.fillStyle = '#204'; x.fillRect(0, 0, 64, 36);
    x.fillStyle = '#fd3'; x.fillRect(20, 8, 16, 20);
    return c;
  };
  const px = (c) => Buffer.from(c.getContext('2d').getImageData(0, 0, 64, 36).data);
  const post = new Post(64, 36);
  const base = px(card());
  const none = card(); post.apply(none, {}, F);
  assert.ok(px(none).equals(base));
  for (const P of [{ zoom: 0.1 }, { shake: 40 }, { glitch: 1 }, { rgbSplit: 60 }, { invert: 1 }, { flash: 0.5 }]) {
    const a = card(), b = card();
    post.apply(a, P, F);
    post.apply(b, P, F);
    assert.ok(!px(a).equals(base), JSON.stringify(P));
    assert.ok(px(a).equals(px(b)), `deterministic ${JSON.stringify(P)}`);
  }
  const weak = card(); post.apply(weak, { invert: 1, invertBy: 'kick' }, { frame: 7, c: { kick: 0.4 } });
  assert.ok(px(weak).equals(base));
  const gated = card(); post.apply(gated, { zoom: 0.1, vjGateBy: 'numb' }, { frame: 7, c: { numb: 1 } });
  assert.ok(px(gated).equals(base));
  const p1 = card(), p2 = card();
  post.apply(p1, { paper: 0.4 }, F);
  post.apply(p2, { paper: 0.4 }, F);
  assert.ok(!px(p1).equals(base) && px(p1).equals(px(p2)));
});

test('scene libraries draw deterministically (puppet, worldkit, fx)', async () => {
  const { createCanvas } = await import('../engine/canvas.mjs');
  const P = await import('../scenes/lib/puppet.mjs');
  const WK = await import('../scenes/lib/worldkit.mjs');
  const FX = await import('../scenes/lib/fx.mjs');
  const draw = () => {
    const c = createCanvas(192, 108), ctx = c.getContext('2d');
    ctx.scale(0.1, 0.1);
    const g = { ctx, W: 1920, H: 1080, scale: 0.1, createCanvas };
    WK.drawField(g, WK.field(g, { key: 'test', t: 1.5, w: 64, h: 36, stops: [[0, '#102'], [1, '#f6a']], bands: 4 }));
    const kid = P.design({ ...P.KID, height: 400, fill: '#ffd23f', outline: '#102', outlineW: 6, head: 'tv' });
    P.drawPuppet(ctx, kid, P.cycles.dance(0.3, 'pump'), { x: 960, ground: 900, view: 'front' });
    const s = P.puppetSprite(g, kid, P.cycles.walk(0.25), { key: 'w1', scale: 0.5 });
    ctx.drawImage(s.canvas, 400 - s.ax, 900 - s.ay, s.w, s.h);
    for (const p of WK.particles({ seed: 2, t: 3, rate: 20, life: 2, origin: () => [960, 540], vel: (k, r) => [200 * (r - 0.5), -150] })) ctx.fillRect(p.x, p.y, 8, 8);
    FX.rings(ctx, { n: 4, gap: 120, phase: 0.3 });
    return Buffer.from(ctx.getImageData(0, 0, 192, 108).data);
  };
  const a = draw(), b = draw();
  assert.ok(a.equals(b));
  const j = P.solve(P.design({ height: 300 }), P.poses.stand, { x: 100, ground: 500 });
  assert.ok(Math.abs(j.feetY - 500) < 1e-6);
  const ik = P.armTo(P.design({}), 0.2, 0.1);
  assert.ok(Number.isFinite(ik.s) && Number.isFinite(ik.e));
  assert.equal(FX.slam(1, 2), 0);
  assert.ok(FX.slam(2.03, 2) > 0 && FX.slam(5, 2) > 0.99 && FX.slam(5, 2) < 1.01);
});

test('the kaiser-emperor treatment resolves against its analysis', { skip: !fs.existsSync(path.join(HERE, '../../out/kaiser-emperor/stages/motion.json')) }, async () => {
  const F = Features.load(path.join(HERE, '../../out/kaiser-emperor/stages/motion.json'));
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, '../treatments/kaiser-emperor.json'), 'utf8'));
  const { loadScenes } = await import('../scenes/index.mjs');
  const reg = await loadScenes();
  const tr = new Treatment(spec, F, reg);
  assert.deepEqual(tr.coverageProblems(F.duration), []);
  const impact = tr.timeline.find((e) => e.id === 'impact');
  assert.equal(tr.postParams(impact, 1271 / F.fps).invert, 1);   // the strike lands on its frame
  assert.equal(tr.postParams(impact, 1270 / F.fps).invert, 0);
});
