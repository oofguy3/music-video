// Renders one frame = pure function of (frame index, features, treatment).
// Order: black -> scene(s) (crossfades via a blend layer) -> transitions -> title -> post
//        -> hard-stop black -> RGBA readback (+ dither).
// Scenes draw in logical 1920x1080 coordinates; the context is pre-scaled to the device size.

import fs from 'fs';
import { createCanvas, ensureFonts } from './canvas.mjs';
import * as color from './color.mjs';
import * as ease from './ease.mjs';
import { Features } from './features.mjs';
import * as noise from './noise.mjs';
import { Post, finishRGBA } from './post.mjs';
import { Sprites } from './sprites.mjs';
import { Treatment } from './treatment.mjs';
import * as world from './world.mjs';
import { loadScenes } from '../scenes/index.mjs';

export const LOGICAL_W = 1920;
export const LOGICAL_H = 1080;

const strSeed = (s) => noise.hash32(...String(s).split('').map((ch) => ch.charCodeAt(0)));

export async function createRenderer({ width = 1920, height = 1080, motion, treatment, sceneOverride = null, dither = true, post = true, allowMissing = true, clock = null }) {
  ensureFonts();
  const feats = motion instanceof Features ? motion : typeof motion === 'string' ? Features.load(motion) : new Features(motion);
  const loaded = await loadScenes();
  // Scenes still being built fall back to the debug scene, so partial builds always render.
  const registry = allowMissing && loaded.debug
    ? new Proxy(loaded, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && !['transitions', 'title', 'then'].includes(k) ? o.debug : undefined) })
    : loaded;
  let spec = typeof treatment === 'string' ? JSON.parse(fs.readFileSync(treatment, 'utf8')) : treatment;
  if (sceneOverride) {
    spec = { ...spec, title: null, timeline: spec.timeline.map((e) => ({ ...e, scene: sceneOverride, params: {}, post: {} })) };
  }
  const tr = new Treatment(spec, feats, registry);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const scale = width / LOGICAL_W;
  const sprites = new Sprites();
  const postFx = new Post(width, height);
  const layers = new Map();

  function layer(name) {
    let L = layers.get(name);
    if (!L) {
      const c = createCanvas(width, height);
      L = { canvas: c, ctx: c.getContext('2d') };
      layers.set(name, L);
    }
    const lc = L.ctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
    lc.filter = 'none';
    lc.clearRect(0, 0, width, height);
    lc.setTransform(scale, 0, 0, scale, 0, 0);
    return L;
  }

  const base = { W: LOGICAL_W, H: LOGICAL_H, scale, devW: width, devH: height, sprites, noise, color, ease, world, createCanvas, layer };
  const snapCache = new Map();

  /** The raw (pre-post) image of timeline entry `id` at time t, for afterimages; cached per frame. */
  function snapshot(id, t) {
    const frame = Math.round(t * feats.fps);
    const key = `${id}@${frame}`;
    let c = snapCache.get(key);
    if (c) return c;
    const entry = tr.timeline.find((e) => e.id === id);
    if (!entry) throw new Error(`snapshot: no timeline entry "${id}"`);
    c = createCanvas(width, height);
    const sc = c.getContext('2d');
    sc.fillStyle = '#000';
    sc.fillRect(0, 0, width, height);
    sc.setTransform(scale, 0, 0, scale, 0, 0);
    const tt = frame / feats.fps;
    drawEntry(sc, entry, tt, feats.at(tt), 1);
    sc.getImageData(0, 0, 1, 1);   // rasterise now: an unflushed canvas costs ~2x per drawImage
    if (snapCache.size >= 4) snapCache.delete(snapCache.keys().next().value);
    snapCache.set(key, c);
    return c;
  }

  function sceneState(entry, t, F, weight) {
    const lift = feats.liftDeg(t, tr.global.degPerSemi);
    return {
      id: entry.id, scene: entry.scene, t0: entry.t0, t1: entry.t1,
      u: Math.max(0, Math.min(1, (t - entry.t0) / (entry.t1 - entry.t0))),
      frame: F.frame, fps: feats.fps, lift,
      palette: color.rotatePalette(entry.palette, lift),
      seed: strSeed(entry.seedKey), weight,
    };
  }

  function drawEntry(targetCtx, entry, t, F, weight) {
    const mod = registry[entry.scene];
    const P = tr.params(entry, t);
    const S = sceneState(entry, t, F, weight);
    const g = { ...base, ctx: targetCtx, snapshot };
    targetCtx.save();
    mod.draw(g, t, F, P, S);
    targetCtx.restore();
  }

  /** Milliseconds spent drawing the scene layer of the last frame (only measured when a clock is given). */
  let lastSceneMs = 0;

  function renderFrame(i) {
    const tStart = clock ? clock() : 0;
    const t = i / feats.fps;
    const F = feats.at(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const active = tr.activeAt(t);
    if (active.length === 1 && active[0].weight >= 0.999) {
      drawEntry(ctx, active[0].entry, t, F, 1);
    } else {
      for (const { entry, weight } of active) {
        const L = layer('__blend');
        drawEntry(L.ctx, entry, t, F, weight);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = weight;
        ctx.drawImage(L.canvas, 0, 0);
        ctx.restore();
      }
    }
    const primary = active.length ? active[active.length - 1].entry : null;

    const trMod = registry.transitions;
    if (trMod) {
      for (const T of tr.transitionsAt(t)) {
        const Tp = Object.fromEntries(Object.entries(T.params).map(([k, f]) => [k, f(t)]));
        const g = { ...base, ctx, snapshot };
        ctx.save();
        trMod.draw(g, t, F, { ...T, p: Tp }, primary ? sceneState(primary, t, F, 1) : null);
        ctx.restore();
      }
    }

    const title = tr.title;
    if (title && registry.title && t >= title.t0 - 0.01 && t < title.t1 + (title.fadeOut ?? 1)) {
      const g = { ...base, ctx, snapshot };
      ctx.save();
      registry.title.draw(g, t, F, title, primary ? sceneState(primary, t, F, 1) : null);
      ctx.restore();
    }

    if (clock) {
      ctx.getImageData(0, 0, 1, 1);   // force Skia to rasterise the scene now so the timing is real
      lastSceneMs = clock() - tStart;
    }
    const postP = tr.postParams(primary, t);
    if (post) postFx.apply(canvas, postP, F);

    if (F.c.stopped >= 0.5) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
    const buf = canvas.data();
    if (F.c.stopped < 0.5) {
      finishRGBA(buf, i, { dither: dither ? 1 : 0, grain: post ? (postP.grain ?? 0) : 0,
        vignette: post ? (postP.vignette ?? 0) : 0, width, height });
    }
    return buf;
  }

  return { renderFrame, canvas, feats, treatment: tr, registry, width, height, sceneMs: () => lastSceneMs };
}
