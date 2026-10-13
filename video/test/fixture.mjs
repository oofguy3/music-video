// A tiny synthetic motion.json (4 s at 30 fps, 150 BPM) for engine tests.
import { landFrame } from '../engine/clock.mjs';

export const FIXTURE_COLUMNS = [
  'section', 'section_u', 'mt', 'beat', 'beat_phase', 'bar', 'bar_phase', 'rate', 'since_beat', 'since_down', 'density',
  'hit', 'kick', 'snare', 'hat', 'hit_rel', 'hat_rel',
  'voc_active', 'drums_active', 'bass_active', 'pad_active',
  'voc_lvl', 'voc_rel', 'drums_lvl', 'drums_rel', 'bass_lvl', 'bass_rel', 'pad_lvl', 'pad_rel',
  'voc_on', 'bass_on', 'pad_on', 'voc_midi', 'bass_midi', 'voc_pitch', 'word_on', 'line_pos', 'voc_held', 'pad_bright',
  'loud', 'energy', 'chord_root', 'chord_minor', 'chord_deg', 'chord_u', 'chord_on',
  'numb', 'numb_hit', 'numb_accum', 'key_tonic', 'key_lift', 'key_pivot', 'cut', 'stopped',
];

export function fixtureMotion() {
  const fps = 30, n = 120, beat = 0.4;
  const cols = Object.fromEntries(FIXTURE_COLUMNS.map((k) => [k, new Array(n).fill(0)]));
  const kicks = [];
  for (let t = 0; t < 4; t += beat) kicks.push([Math.round(t * 1e4) / 1e4, 0.9, 0.9]);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    cols.section[i] = t < 1.6 ? 0 : t < 2.4 ? 1 : 2;
    cols.mt[i] = t / beat;
    cols.beat_phase[i] = (t / beat) % 1;
    cols.pad_rel[i] = 0.5 + 0.5 * Math.sin(i / 7);
    cols.loud[i] = t < 1.6 ? 0.3 : 0.8;
    cols.drums_active[i] = t >= 1.6 ? 1 : 0;
    cols.voc_active[i] = 1;
    cols.stopped[i] = t >= 3.5 ? 1 : 0;
    for (const [kt, s] of kicks) {
      const L = landFrame(kt, fps);
      if (i >= L) cols.kick[i] = Math.max(cols.kick[i], s * Math.exp(-(i - L) / fps / 0.14));
    }
  }
  return {
    schema: 'audiotool.motion/1', fps, n_frames: n, sr: 44100, samples: 4 * 44100, duration_s: 4, bpb: 4, beat_s: beat,
    meta: { title: 'Fixture Song (Demo)', artist: 'TestOfficial' }, norm: {}, upstream_fallbacks: [], runs: {},
    columns: cols,
    events: {
      sections: [{ label: 'A1', t0: 0, t1: 1.6, hint: '' }, { label: 'B1', t0: 1.6, t1: 2.4, hint: '' }, { label: 'C1', t0: 2.4, t1: 4.0, hint: 'outro' }],
      beats: kicks.map((k) => k[0]), downbeats: [0, 0.8, 1.6, 2.4, 3.2],
      kick: kicks, hit: kicks, snare: [], hat: [],
      voc_notes: [], bass_notes: [], pad_notes: [], words: [], lines: [], chords: [],
      numb: [[1.6, 2.0, 0.9]], keys: [], key_changes: [{ t: 1.6, pivot: 1.2, from: 'C major', to: 'C# major', semis: 1, window_t: 2.0 }],
      entries: [], exits: [], active: {}, cuts: [2.4], end_stop: 3.5, end: 4.0, peaks: [], dips: [], loudest: 2.0, quietest: null,
    },
  };
}
