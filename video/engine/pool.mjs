// Render a list of frames with N worker threads and deliver them IN ORDER to onFrame(i, rgba).
// onFrame may be async (backpressure); the RGBA view is only valid until onFrame resolves.
import { Worker } from 'worker_threads';

export async function renderFrames({ frames, workers = 3, opts, onFrame, log = () => {}, slots = 3 }) {
  const nw = Math.max(1, Math.min(workers, frames.length));
  const frameBytes = opts.width * opts.height * 4;
  const sab = new SharedArrayBuffer(frameBytes * slots * nw);
  const ready = new Map();
  const ms = new Float64Array(frames.length);
  let wakeMain = null;
  let failure = null;
  const pool = [];
  for (let k = 0; k < nw; k++) {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: { k, nw, frames, sab, slots, frameBytes, opts },
    });
    w.on('message', (m) => {
      if (m.error) failure = new Error(`worker ${k}: ${m.error}`);
      else if (m.j !== undefined) { ready.set(m.j, { k, slot: m.slot }); ms[m.j] = m.ms; }
      if (wakeMain) { const f = wakeMain; wakeMain = null; f(); }
    });
    w.on('error', (e) => { failure = e; if (wakeMain) { const f = wakeMain; wakeMain = null; f(); } });
    w.on('exit', (code) => {
      if (code !== 0 && !failure) failure = new Error(`worker ${k} exited with code ${code}`);
      if (wakeMain) { const f = wakeMain; wakeMain = null; f(); }
    });
    pool.push(w);
  }
  const t0 = performance.now();
  let lastLog = t0;
  try {
    for (let j = 0; j < frames.length; j++) {
      while (!ready.has(j)) {
        if (failure) throw failure;
        await new Promise((res) => { wakeMain = res; });
      }
      const { k, slot } = ready.get(j);
      ready.delete(j);
      const view = Buffer.from(sab, (k * slots + slot) * frameBytes, frameBytes);
      await onFrame(frames[j], view, j);
      pool[k].postMessage({ free: slot });
      const now = performance.now();
      if (now - lastLog > 5000 || j === frames.length - 1) {
        lastLog = now;
        const done = j + 1;
        const fps = done / ((now - t0) / 1000);
        const eta = (frames.length - done) / Math.max(fps, 1e-6);
        log(`frames ${done}/${frames.length}  ${fps.toFixed(1)} fps  eta ${eta.toFixed(0)}s`);
      }
    }
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  return { ms, seconds: (performance.now() - t0) / 1000 };
}
