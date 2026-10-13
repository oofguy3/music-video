// Worker thread: renders its share of a frame list into shared-memory slots.
// Worker k takes list positions k, k+nw, k+2nw, ... The main thread consumes in list order and
// hands slots back, so at most `slots` frames per worker are in flight.
import { parentPort, workerData } from 'worker_threads';
import { createRenderer } from './frame.mjs';

const { k, nw, frames, sab, slots, frameBytes, opts } = workerData;

const free = [];
for (let s = 0; s < slots; s++) free.push(s);
let wake = null;
parentPort.on('message', (m) => {
  if (m && m.free !== undefined) {
    free.push(m.free);
    if (wake) { const w = wake; wake = null; w(); }
  }
});

try {
  const r = await createRenderer({ ...opts, clock: opts.timing ? () => performance.now() : null });
  for (let j = k; j < frames.length; j += nw) {
    const t0 = performance.now();
    const buf = r.renderFrame(frames[j]);
    const ms = performance.now() - t0;
    if (buf.length !== frameBytes) throw new Error(`frame ${frames[j]}: got ${buf.length} bytes, expected ${frameBytes}`);
    while (!free.length) await new Promise((res) => { wake = res; });
    const slot = free.shift();
    new Uint8Array(sab, (k * slots + slot) * frameBytes, frameBytes).set(buf);
    parentPort.postMessage({ j, slot, ms, sceneMs: r.sceneMs() });
  }
  parentPort.postMessage({ done: true });
} catch (e) {
  parentPort.postMessage({ error: String(e && e.stack ? e.stack : e) });
}
