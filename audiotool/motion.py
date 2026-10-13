"""Per-video-frame features and events for the music-video renderer ("motion" stage).

Everything a scene needs to move with the song, sampled on the video frame grid, plus the event
lists behind it. Shared conventions with the JavaScript renderer (video/engine/clock.mjs):

- frame i shows time t_i = i / fps;
- an event at time t (as written here, 4 decimals) lands on frame floor(t * fps + 0.5);
- an impulse is 0 before its landing frame, its full strength on it, then decays exponentially;
  overlapping impulses combine by max.

No lyric text is ever written here: words are reduced to their timing and confidence.
"""

from __future__ import annotations

import math

import numpy as np

from .io import load_mono
from .pipeline import Context

SCHEMA = "audiotool.motion/1"
STEMS = ("vocals", "drums", "bass", "other")
PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NUMERALS = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]

# per stem: centred RMS window (s), follower release tau (s), note-onset impulse tau (s)
LEVELS = {"vocals": (0.05, 0.12, 0.20), "drums": (0.03, 0.06, None),
          "bass": (0.08, 0.15, 0.25), "other": (0.08, 0.25, 0.30)}
# drum bands (Hz) and impulse taus (s)
DRUM_BANDS = {"kick": [(30, 150)], "snare": [(150, 400), (1500, 5000)], "hat": [(6000, 16000)],
              "hit": [(30, 16000)]}
DRUM_TAU = {"hit": 0.12, "kick": 0.14, "snare": 0.10, "hat": 0.05}


# ----------------------------------------------------------------------------- time grid

def land(t: float, fps: float) -> int:
    """The frame an event at time t lands on (JS: Math.floor(t * fps + 0.5))."""
    return int(math.floor(round(float(t), 4) * fps + 0.5))


def impulses(n: int, fps: float, events, tau: float) -> np.ndarray:
    """events: iterable of (t, strength). Peak on the landing frame, exponential decay after."""
    col = np.zeros(n)
    span = int(math.ceil(tau * 7 * fps)) + 1
    decay = np.exp(-np.arange(span) / fps / tau)
    for t, s in events:
        L = land(t, fps)
        if L >= n or L + span <= 0:
            continue
        a = max(L, 0)
        seg = s * decay[a - L: min(span, n - L)]
        col[a:a + len(seg)] = np.maximum(col[a:a + len(seg)], seg)
    return col


def one_pole(x: np.ndarray, fps: float, attack: float, release: float) -> np.ndarray:
    """Asymmetric smoother (seconds); attack=0 means instant."""
    out = np.empty_like(x, dtype=float)
    a_up = 0.0 if attack <= 0 else math.exp(-1.0 / (fps * attack))
    a_dn = math.exp(-1.0 / (fps * release)) if release > 0 else 0.0
    prev = float(x[0]) if len(x) else 0.0
    for i, v in enumerate(x):
        a = a_up if v > prev else a_dn
        prev = a * prev + (1 - a) * v
        out[i] = prev
    return out


def peak_follow_db(db: np.ndarray, fps: float, release: float) -> np.ndarray:
    """Instant attack, exponential release, on linear amplitude; returns dB."""
    lin = 10 ** (db / 20)
    out = np.empty_like(lin)
    a = math.exp(-1.0 / (fps * release))
    prev = 0.0
    for i, v in enumerate(lin):
        prev = max(v, prev * a)
        out[i] = prev
    return 20 * np.log10(out + 1e-9)


def frame_rms_db(x: np.ndarray, sr: int, times: np.ndarray, win: float) -> np.ndarray:
    """RMS level (dBFS) in a centred window of `win` seconds around each time."""
    p = np.square(x.astype(np.float64))
    c = np.concatenate([[0.0], np.cumsum(p)])
    centre = np.round(times * sr).astype(np.int64)
    half = max(1, int(win * sr / 2))
    lo = np.clip(centre - half, 0, len(x))
    hi = np.clip(centre + half, 0, len(x))
    ms = (c[hi] - c[lo]) / np.maximum(hi - lo, 1)
    return 10 * np.log10(ms + 1e-12)


# ----------------------------------------------------------------------------- beat grid

def beat_grid(beats, downbeats, bpb: int, duration: float, onsets=None,
              snap_tracked: float = 0.06, snap_onset: float = 0.035) -> tuple[np.ndarray, int]:
    """Rebuild beats bar by bar: bpb equal beats between consecutive downbeats (extended past both
    ends of the song), replaced by a tracked beat within `snap_tracked` s, then moved to a drum
    onset within `snap_onset` s. Returns (grid times, index of the first real downbeat)."""
    D = np.asarray(downbeats, dtype=float)
    B = np.asarray(beats, dtype=float)
    if len(D) < 2:
        if len(B) >= 2:
            return B, 0
        return np.arange(0.0, duration + 0.5, 0.5), 0
    bar = float(np.median(np.diff(D)))
    first = D[0]
    while D[0] > 0:
        D = np.insert(D, 0, D[0] - bar)
    while D[-1] < duration:
        D = np.append(D, D[-1] + bar)
    grid = [D[k] + j * (D[k + 1] - D[k]) / bpb for k in range(len(D) - 1) for j in range(bpb)]
    grid.append(D[-1])
    grid = np.asarray(grid)
    first_idx = int(np.argmin(np.abs(grid - first)))
    if len(B):
        for i, g in enumerate(grid):
            k = int(np.argmin(np.abs(B - g)))
            if abs(B[k] - g) <= snap_tracked:
                grid[i] = B[k]
    if onsets is not None and len(onsets):
        O = np.asarray(onsets, dtype=float)
        for i, g in enumerate(grid):
            k = int(np.searchsorted(O, g))
            best = None
            for j in (k - 1, k):
                if 0 <= j < len(O) and abs(O[j] - g) <= snap_onset and (best is None or abs(O[j] - g) < abs(best - g)):
                    best = O[j]
            if best is not None:
                grid[i] = best
    for i in range(1, len(grid)):          # strictly increasing
        if grid[i] <= grid[i - 1]:
            grid[i] = grid[i - 1] + 1e-3
    return grid, first_idx


# ----------------------------------------------------------------------------- drum onsets

def band_onsets(y: np.ndarray, sr: int, sections: list[tuple[float, float]],
                level_gate_db: float | None = None, hop: int = 256, n_fft: int = 1024) -> dict:
    """Spectral-flux onsets per drum band. Thresholds adapt per section so a quiet shaker is still
    found; events below the bleed gate are dropped. Returns {band: [[t, s, s_rel], ...]}."""
    import librosa

    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop, center=True))
    L = np.log1p(100.0 * S)
    flux = np.maximum(0.0, np.diff(L, axis=1, prepend=L[:, :1]))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    times = np.arange(S.shape[1]) * hop / sr
    lvl = frame_rms_db(y, sr, times, 0.05)
    out: dict[str, list] = {}
    for band, ranges in DRUM_BANDS.items():
        mask = np.zeros(len(freqs), dtype=bool)
        for lo, hi in ranges:
            mask |= (freqs >= lo) & (freqs < hi)
        env = flux[mask].mean(axis=0)
        wait = 6 if band == "hat" else 9
        peaks_all: list[tuple[float, float, int]] = []
        for s0, s1 in sections:
            i0, i1 = np.searchsorted(times, [s0, s1])
            seg = env[i0:i1]
            if len(seg) < 8:
                continue
            ref = np.percentile(seg, 99) + 1e-9
            pk = librosa.util.peak_pick(seg / ref, pre_max=3, post_max=3, pre_avg=17, post_avg=17,
                                        delta=0.15, wait=wait)
            for k in pk:
                j = i0 + int(k)
                if level_gate_db is not None and lvl[j] < level_gate_db:
                    continue
                d = 0.0
                if 0 < j < len(env) - 1:
                    den = env[j - 1] - 2 * env[j] + env[j + 1]
                    if den < 0:
                        d = float(np.clip(0.5 * (env[j - 1] - env[j + 1]) / den, -0.5, 0.5))
                peaks_all.append(((j + d) * hop / sr, float(env[j]), j))
        if not peaks_all:
            out[band] = []
            continue
        vals = np.array([p[1] for p in peaks_all])
        ref_all = np.percentile(vals, 95) + 1e-9
        events = []
        for s0, s1 in sections:
            sel = [p for p in peaks_all if s0 <= p[0] < s1]
            if not sel:
                continue
            ref_sec = np.percentile([p[1] for p in sel], 95) + 1e-9
            for t, v, _ in sel:
                events.append([round(t, 4), round(float(min(1.0, math.sqrt(v / ref_all))), 3),
                               round(float(min(1.0, math.sqrt(v / ref_sec))), 3)])
        out[band] = sorted(events)
    return out


# ----------------------------------------------------------------------------- harmony

def chord_tones(label: str) -> set[int]:
    root, q = label.split(":")
    r = PITCH_NAMES.index(root)
    return {r, (r + (3 if q == "min" else 4)) % 12, (r + 7) % 12}


def pc_time(notes, t0: float, t1: float) -> np.ndarray:
    """Seconds each pitch class sounds within [t0, t1), over the given notes [t0, t1, midi, ...]."""
    acc = np.zeros(12)
    for a, b, m, *_ in notes:
        ov = min(b, t1) - max(a, t0)
        if ov > 0:
            acc[int(round(m)) % 12] += ov
    return acc


def snap_chords(chords: list[list], downbeats: np.ndarray, beat: float, notes) -> list[list]:
    """Move chord boundaries onto downbeats: always when within 80 ms, and up to a beat (+30 ms)
    when the notes sounding in between fit the new chord at least as well as the old one (the chord
    decoder tends to switch a beat late)."""
    out = [list(c) for c in chords]
    D = np.asarray(downbeats, dtype=float)
    if not len(D):
        return out
    for i in range(1, len(out)):
        c0 = out[i][0]
        d = float(D[int(np.argmin(np.abs(D - c0)))])
        new = None
        if abs(d - c0) <= 0.08:
            new = d
        elif abs(d - c0) <= beat + 0.03 and out[i][2] != "N" and out[i - 1][2] != "N":
            a, b = min(d, c0), max(d, c0)
            pcs = pc_time(notes, a, b)
            fit_new = sum(pcs[p] for p in chord_tones(out[i][2]))
            fit_old = sum(pcs[p] for p in chord_tones(out[i - 1][2]))
            if (d < c0 and fit_new >= fit_old and fit_new > 0) or (d > c0 and fit_old > fit_new):
                new = d
        if new is not None and new - out[i - 1][0] > 0.2 and out[i][1] - new > 0.2:
            out[i - 1][1] = out[i][0] = round(new, 4)
    return out


def borrowed_iv_conf(label: str, key: str | None, notes, t0: float, t1: float) -> float | None:
    """For a minor iv chord in a major key: minor-third time / (minor + major third time) in the
    notes. None when the chord is not a minor iv in a major key, or nothing decides it."""
    if not key or label == "N":
        return None
    from .tonal import parse_key

    tonic, mode = parse_key(key)
    root, q = label.split(":")
    r = PITCH_NAMES.index(root)
    if mode != "major" or q != "min" or (r - tonic) % 12 != 5:
        return None
    pcs = pc_time(notes, t0, t1)
    m3, M3 = pcs[(r + 3) % 12], pcs[(r + 4) % 12]
    if m3 + M3 <= 0:
        return None
    return float(m3 / (m3 + M3))


def roman(label: str, key: str | None) -> str:
    if not key or label == "N":
        return "?"
    from .tonal import parse_key

    tonic, _ = parse_key(key)
    root, q = label.split(":")
    num = NUMERALS[(PITCH_NAMES.index(root) - tonic) % 12]
    return num.replace("I", "i").replace("V", "v") if q == "min" else num


# ----------------------------------------------------------------------------- arrangement

def level_5ms(x: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    hop = int(0.005 * sr)
    n = len(x) // hop
    p = np.square(x[: n * hop].astype(np.float64)).reshape(n, hop).mean(axis=1)
    return np.arange(n) * hop / sr, 10 * np.log10(p + 1e-12)


def refine_intervals(intervals, t5: np.ndarray, db5: np.ndarray, thr: float, search: float = 0.12):
    """Sharpen 20 fps activity edges to 5 ms using the stem's own level crossing."""
    out = []
    for a, b in intervals:
        ia0, ia1 = np.searchsorted(t5, [a - search, a + search])
        up = np.nonzero(db5[ia0:ia1] >= thr)[0]
        a2 = float(t5[ia0 + up[0]]) if len(up) else a
        ib0, ib1 = np.searchsorted(t5, [b - search, b + search])
        dn = np.nonzero(db5[ib0:ib1] >= thr)[0]
        b2 = float(t5[ib0 + dn[-1]] + 0.005) if len(dn) else b
        if b2 > a2:
            out.append([round(a2, 3), round(b2, 3)])
    return out


def find_cuts(stems_intervals: dict, levels5: dict, downbeats: np.ndarray, within: float = 0.25,
              min_drop: float = 15.0, snap: float = 0.08) -> list[float]:
    """Moments where two or more stems stop together (each dropping >= min_drop dB)."""
    exits = []
    for name, ivs in stems_intervals.items():
        t5, db5 = levels5[name]
        for _, b in ivs:
            i = int(np.searchsorted(t5, b))
            before = db5[max(0, i - 20):i]
            after = db5[i + 2:i + 22]
            if len(before) and len(after) and before.max() - after.max() >= min_drop:
                exits.append((b, name))
    exits.sort()
    cuts: list[float] = []
    i = 0
    while i < len(exits):
        group = [exits[i]]
        j = i + 1
        while j < len(exits) and exits[j][0] - exits[i][0] <= within:
            group.append(exits[j])
            j += 1
        if len({g[1] for g in group}) >= 2:
            t = min(g[0] for g in group)
            if len(downbeats):
                d = float(downbeats[int(np.argmin(np.abs(downbeats - t)))])
                if abs(d - t) <= snap:
                    t = d
            cuts.append(round(t, 4))
        i = j
    return cuts


def find_end_stop(x: np.ndarray, sr: int, drop: float = 30.0, span: int = 4,
                  audible: float = -60.0) -> float | None:
    """The last abrupt stop: a fall of >= `drop` dB within `span` x 5 ms that never comes back,
    refined to the last sample above -20 dB of the level just before it."""
    t5, db5 = level_5ms(x, sr)
    if len(db5) < span + 2:
        return None
    suffix = np.maximum.accumulate(db5[::-1])[::-1]
    cand = np.nonzero((db5[:-span] >= audible) & (db5[:-span] - suffix[span:] >= drop))[0]
    if not len(cand):
        return None
    i = int(cand[-1])
    a = int(max(0, (t5[i] - 0.05) * sr))
    b = int(min(len(x), (t5[i] + (span + 1) * 0.005) * sr))
    seg = np.abs(x[a:b])
    ref = np.abs(x[a:int(t5[i] * sr)]).max() if int(t5[i] * sr) > a else seg.max()
    above = np.nonzero(seg >= 0.1 * ref)[0]
    stop = (a + above[-1] + 1) / sr if len(above) else t5[i + span]
    return round(float(stop), 4)


def find_dips(t: np.ndarray, lufs: np.ndarray, fps: float, lo: float, hi: float, depth: float = 6.0,
              around: float = 4.0, gap: float = 2.0) -> list[list[float]]:
    """Breaths: local minima of 0.25 s-smoothed loudness at least `depth` LU below the median of the
    surrounding +-`around` s, inside [lo, hi]. Returns [[t, depth], ...] deepest first."""
    from scipy.ndimage import gaussian_filter1d, median_filter

    sm = gaussian_filter1d(lufs, 0.25 * fps)
    med = median_filter(sm, size=int(2 * around * fps) | 1, mode="nearest")
    out: list[list[float]] = []
    for i in range(1, len(sm) - 1):
        if not (lo <= t[i] <= hi) or sm[i] > sm[i - 1] or sm[i] > sm[i + 1]:
            continue
        d = float(med[i] - sm[i])
        if d < depth:
            continue
        if out and t[i] - out[-1][0] < gap:
            if d > out[-1][1]:
                out[-1] = [round(float(t[i]), 4), round(d, 2)]
            continue
        out.append([round(float(t[i]), 4), round(d, 2)])
    return sorted(out, key=lambda r: -r[1])


# ----------------------------------------------------------------------------- build

def _interp_held(times, values, t):
    """Step-hold lookup: value of the last point at or before each t (first value before start)."""
    idx = np.searchsorted(times, t, side="right") - 1
    return np.asarray(values)[np.clip(idx, 0, len(values) - 1)]


def build(inputs: dict, fps: float = 30.0) -> dict:
    """Assemble motion.json from loaded inputs:
    decode, loudness, rhythm, notes, tonal, lyrics, structure (stage dicts) and
    audio: {"sr": int, "mix": mono array, "vocals"|"drums"|"bass"|"other": mono arrays}."""
    dec, loud, rhy, notes, tonal, lyr, struct = (inputs[k] for k in
                                                  ("decode", "loudness", "rhythm", "notes", "tonal", "lyrics", "structure"))
    audio = inputs["audio"]
    sr = int(audio["sr"])
    samples = int(dec["samples"])
    n = int(math.ceil(samples * fps / dec["sr"]))
    t = np.arange(n) / fps
    duration = samples / dec["sr"]
    cols: dict[str, np.ndarray] = {}
    ev: dict = {}

    sections = struct["sections"]
    sec_spans = [(float(s["t0"]), float(s["t1"])) for s in sections] or [(0.0, duration)]
    sec_idx = np.full(n, -1)
    sec_u = np.full(n, -1.0)
    for k, (a, b) in enumerate(sec_spans):
        m = (t >= a) & (t < b)
        sec_idx[m] = k
        sec_u[m] = (t[m] - a) / max(b - a, 1e-6)
    cols["section"], cols["section_u"] = sec_idx, sec_u

    # --- drums: onsets per band, then the beat grid refined onto them
    thr_act = float(loud.get("activity_threshold_db", -40.0))
    drum_ref = float(np.percentile(loud["stems"]["drums"]["db"], 98)) if loud["stems"]["drums"]["db"] else -20
    gate = max(-55.0, drum_ref - 40.0)
    drums = band_onsets(audio["drums"], sr, sec_spans, level_gate_db=gate)
    for band in DRUM_BANDS:
        ev[band] = drums[band]
        cols[band] = impulses(n, fps, [(e[0], e[1]) for e in drums[band]], DRUM_TAU[band])
        if band in ("hit", "hat"):
            cols[f"{band}_rel"] = impulses(n, fps, [(e[0], e[2]) for e in drums[band]], DRUM_TAU[band])

    bpb = int(str(rhy.get("meter") or "4/4").split("/")[0])
    grid, first_idx = beat_grid(rhy["beats"], rhy["downbeats"], bpb, duration,
                                onsets=[e[0] for e in drums["hit"]])
    # The beat count is interpolated between beats' LANDING frames, so beat_phase is exactly 0 on the
    # frame where each beat lands (jumps and pulses hit on the frame, not 0.4 frame later).
    grid_land = np.floor(np.round(grid, 4) * fps + 0.5) / fps
    for i in range(1, len(grid_land)):
        if grid_land[i] <= grid_land[i - 1]:
            grid_land[i] = grid_land[i - 1] + 1.0 / fps
    mt = np.interp(t, grid_land, np.arange(len(grid))) - first_idx
    # extrapolate linearly outside the grid
    beat_s = float(np.median(np.diff(grid))) if len(grid) > 1 else 0.5
    mt = np.where(t < grid_land[0], (t - grid_land[0]) / beat_s - first_idx, mt)
    mt = np.where(t > grid_land[-1], (t - grid_land[-1]) / beat_s + (len(grid) - 1 - first_idx), mt)
    cols["mt"] = mt
    cols["beat"] = np.floor(mt)
    cols["beat_phase"] = mt - np.floor(mt)
    cols["bar"] = np.floor(mt / bpb)
    cols["bar_phase"] = mt / bpb - np.floor(mt / bpb)
    cols["rate"] = np.gradient(mt) * fps
    real = [(g, i - first_idx) for i, g in enumerate(grid) if 0 <= g <= duration]
    beats_ev = [round(float(g), 4) for g, _ in real]
    downs_ev = [round(float(g), 4) for g, k in real if k % bpb == 0]
    ev["beats"], ev["downbeats"] = beats_ev, downs_ev
    bt = np.asarray(beats_ev) if beats_ev else np.array([0.0])
    dt_ = np.asarray(downs_ev) if downs_ev else np.array([0.0])
    cols["since_beat"] = np.clip(t - _interp_held(bt, bt, t), 0, None)
    cols["since_down"] = np.clip(t - _interp_held(dt_, dt_, t), 0, None)
    hit_t = np.asarray([e[0] for e in drums["hit"]])
    bar_s = beat_s * bpb
    if len(hit_t):
        lo = np.searchsorted(hit_t, t - bar_s)
        hi = np.searchsorted(hit_t, t + bar_s)
        cols["density"] = (hi - lo) / (2 * bpb)
    else:
        cols["density"] = np.zeros(n)

    # --- activity (5 ms edges), levels, notes
    levels5 = {}
    active = {}
    for name in STEMS:
        t5, db5 = level_5ms(audio[name], sr)
        levels5[name] = (t5, db5)
        active[name] = refine_intervals(loud["stems"][name]["active"], t5, db5, thr_act)
    short = {"vocals": "voc", "drums": "drums", "bass": "bass", "other": "pad"}
    for name in STEMS:
        a = np.zeros(n)
        for x0, x1 in active[name]:
            a[(t >= x0) & (t < x1)] = 1
        cols[f"{short[name]}_active"] = a

    norm = {}
    for name in STEMS:
        win, rel_tau, _ = LEVELS[name]
        db = peak_follow_db(frame_rms_db(audio[name], sr, t, win), fps, rel_tau)
        act = cols[f"{short[name]}_active"] > 0
        ref = float(np.percentile(db[act], 98)) if act.sum() > fps else float(np.percentile(db, 98))
        lvl = np.clip((db - (ref - 40)) / 40, 0, 1)
        rel = np.zeros(n)
        for k, (a0, a1) in enumerate(sec_spans):
            m = (t >= a0) & (t < a1)
            if not m.any():
                continue
            ref_sec = float(np.percentile(db[m], 95))
            if ref_sec >= ref - 30:
                rel[m] = np.clip((db[m] - (ref_sec - 30)) / 30, 0, 1)
        p = short[name]
        cols[f"{p}_lvl"], cols[f"{p}_rel"] = lvl, rel
        norm[p] = {"ref_db": round(ref, 2)}

    voc_notes = sorted(notes.get("vocals", []))
    bass_notes = sorted(notes.get("bass", []))
    pad_notes = sorted(notes.get("other", []))
    ev["voc_notes"] = [[round(a, 4), round(b, 4), int(m), round(v, 3)] for a, b, m, v in voc_notes]
    ev["bass_notes"] = [[round(a, 4), round(b, 4), int(m), round(v, 3)] for a, b, m, v in bass_notes]
    ev["pad_notes"] = [[round(a, 4), round(b, 4), int(m), round(v, 3)] for a, b, m, v in pad_notes]
    cols["voc_on"] = impulses(n, fps, [(a, v) for a, b, m, v in voc_notes], LEVELS["vocals"][2])
    cols["bass_on"] = impulses(n, fps, [(a, v) for a, b, m, v in bass_notes], LEVELS["bass"][2])
    cols["pad_on"] = impulses(n, fps, [(a, v) for a, b, m, v in pad_notes], LEVELS["other"][2])

    def held_midi(note_list, hold_gap):
        """MIDI of the note sounding at each frame (the latest-started one still on); a note is held
        through gaps shorter than `hold_gap`; -1 when nothing sounds."""
        out = np.full(n, -1.0)
        if not note_list:
            return out
        starts = np.array([x[0] for x in note_list])
        ends = np.array([x[1] for x in note_list])
        mids = np.array([x[2] for x in note_list], dtype=float)
        for i, ti in enumerate(t):
            k = int(np.searchsorted(starts, ti, side="right")) - 1
            if k < 0:
                continue
            best = next((j for j in range(k, max(-1, k - 8), -1) if ends[j] > ti), None)
            if best is None and ti < ends[k] + hold_gap:
                best = k
            if best is not None:
                out[i] = mids[best]
        return out

    cols["voc_midi"] = held_midi(voc_notes, 0.15)
    cols["bass_midi"] = held_midi(bass_notes, 0.15)
    if voc_notes:
        mids = np.array([x[2] for x in voc_notes])
        p5, p95 = np.percentile(mids, 5), np.percentile(mids, 95)
        held = np.full(n, float(np.clip((voc_notes[0][2] - p5) / max(p95 - p5, 1), 0, 1)))
        last = held[0]
        for i in range(n):
            if cols["voc_midi"][i] >= 0:
                last = float(np.clip((cols["voc_midi"][i] - p5) / max(p95 - p5, 1), 0, 1))
            held[i] = last
        cols["voc_pitch"] = held
        norm["voc_pitch"] = {"p5": float(p5), "p95": float(p95)}
    else:
        cols["voc_pitch"] = np.zeros(n)

    # words: timing + confidence only (never text)
    words = []
    lines_ev = []
    for ln in lyr.get("lines", []):
        lines_ev.append([round(ln["t0"], 4), round(ln["t1"], 4), len(ln.get("words", []))])
        for w in ln.get("words", []):
            words.append([float(w[0]), float(w[1]), float(w[3])])
    onsets_v = np.asarray([x[0] for x in voc_notes]) if voc_notes else np.array([])
    snapped = []
    for w0, w1, p in words:
        if len(onsets_v):
            k = int(np.argmin(np.abs(onsets_v - w0)))
            if abs(onsets_v[k] - w0) <= 0.12:
                w0 = float(onsets_v[k])
        snapped.append([round(w0, 4), round(w1, 4), round(p, 3)])
    ev["words"], ev["lines"] = snapped, lines_ev
    cols["word_on"] = impulses(n, fps, [(w0, 0.5 + 0.5 * p) for w0, _, p in snapped], 0.15)
    line_pos = np.full(n, -1.0)
    for a, b, _ in lines_ev:
        m = (t >= a) & (t < b)
        line_pos[m] = (t[m] - a) / max(b - a, 1e-6)
    cols["line_pos"] = line_pos
    held_flag = np.zeros(n)
    for a, b, *_ in list(voc_notes) + [[w0, w1] for w0, w1, _ in snapped]:
        if b - a >= 0.6:
            held_flag[(t >= a) & (t < b)] = 1
    cols["voc_held"] = one_pole(held_flag, fps, 0.08, 0.15)

    # pad brightness: spectral centroid of the "other" stem, zero-phase smoothed
    import librosa
    from scipy.ndimage import gaussian_filter1d

    other22 = librosa.resample(audio["other"], orig_sr=sr, target_sr=22050) if sr != 22050 else audio["other"]
    cen = librosa.feature.spectral_centroid(y=other22, sr=22050, hop_length=512)[0]
    ct = np.arange(len(cen)) * 512 / 22050
    lc = np.log2(np.interp(t, ct, cen) + 1.0)
    pad_on_mask = cols["pad_active"] > 0
    ref_pool = lc[pad_on_mask] if pad_on_mask.sum() > fps else lc
    b5, b95 = np.percentile(ref_pool, 5), np.percentile(ref_pool, 95)
    cols["pad_bright"] = np.clip(gaussian_filter1d((lc - b5) / max(b95 - b5, 1e-6), 0.12 * fps), 0, 1)

    # mix loudness and energy
    mom = np.asarray(loud["momentary_lufs_10hz"], dtype=float)
    mt0 = float(loud.get("momentary_t0", 0.2))
    lufs = np.interp(t, mt0 + np.arange(len(mom)) / 10.0, mom) if len(mom) else np.full(n, -70.0)
    cols["loud"] = np.clip((lufs + 24.0) / 18.5, 0, 1)
    raw_energy = 0.5 * cols["loud"] + 0.2 * cols["drums_lvl"] + 0.15 * cols["bass_lvl"] + 0.15 * cols["voc_lvl"]
    cols["energy"] = one_pole(raw_energy, fps, 0.0, 1.0)

    # --- harmony
    keys = tonal.get("keys") or [[0.0, duration, tonal.get("key"), 0]]
    key_changes = tonal.get("key_changes") or []

    def key_at(x: float) -> str | None:
        for k0, k1, k, *_ in keys:
            if k0 <= x < k1:
                return k
        return keys[-1][2] if keys else None

    from .tonal import parse_key

    harmonic_notes = sorted(pad_notes + voc_notes + bass_notes)
    chords = snap_chords(tonal.get("chords", []), np.asarray(downs_ev), beat_s, harmonic_notes)
    chord_ev, numb_ev = [], []
    c_root, c_minor, c_deg, c_u = np.full(n, -1.0), np.zeros(n), np.full(n, -1.0), np.full(n, -1.0)
    for c in chords:
        c0, c1, label = float(c[0]), float(c[1]), c[2]
        key = key_at(c0 + 1e-3)
        m = (t >= c0) & (t < c1)
        conf = borrowed_iv_conf(label, key, sorted(pad_notes + voc_notes), c0, c1)
        if label != "N":
            r = PITCH_NAMES.index(label.split(":")[0])
            c_root[m] = r
            c_minor[m] = 1.0 if label.endswith(":min") else 0.0
            if key:
                c_deg[m] = (r - parse_key(key)[0]) % 12
            c_u[m] = (t[m] - c0) / max(c1 - c0, 1e-6)
        chord_ev.append([round(c0, 4), round(c1, 4),
                         -1 if label == "N" else PITCH_NAMES.index(label.split(":")[0]),
                         "N" if label == "N" else label.split(":")[1],
                         -1 if (label == "N" or not key) else int((PITCH_NAMES.index(label.split(":")[0]) - parse_key(key)[0]) % 12),
                         roman(label, key), None if conf is None else round(conf, 3)])
        if conf is not None and conf >= 0.6:
            numb_ev.append([round(c0, 4), round(c1, 4), round(conf, 3)])
    cols["chord_root"], cols["chord_minor"], cols["chord_deg"], cols["chord_u"] = c_root, c_minor, c_deg, c_u
    cols["chord_on"] = impulses(n, fps, [(c[0], 1.0) for c in chord_ev if c[3] != "N"], 0.3)
    ev["chords"], ev["numb"] = chord_ev, numb_ev

    numb = np.zeros(n)
    for a, b, conf in numb_ev:
        L0, L1 = land(a, fps), land(b, fps)
        rise = max(1, int(round(0.25 * beat_s * fps)))
        rel_n = max(1, int(round(1.5 * beat_s * fps)))
        env = np.zeros(n)
        for i in range(max(L0, 0), min(n, L1 + rel_n)):
            if i < L0 + rise:
                x = (i - L0) / rise
                v = conf * (0.6 + 0.4 * (0.5 - 0.5 * math.cos(math.pi * x)))
            elif i < L1:
                v = conf
            else:
                x = (i - L1) / rel_n
                v = conf * (0.5 + 0.5 * math.cos(math.pi * x))
            env[i] = v
        numb = np.maximum(numb, env)
    cols["numb"] = numb
    cols["numb_hit"] = impulses(n, fps, [(a, c) for a, _, c in numb_ev], 0.4)
    tot = numb.sum()
    cols["numb_accum"] = np.cumsum(numb) / tot if tot > 0 else np.zeros(n)

    tonic = np.full(n, -1.0)
    for k0, k1, k, *_ in keys:
        if k:
            tonic[(t >= k0) & (t < k1)] = parse_key(k)[0]
    cols["key_tonic"] = tonic
    lift = np.zeros(n)
    pivot = np.zeros(n)
    beat_frames = max(1, int(round(beat_s * fps)))
    for kc in key_changes:
        L = land(kc["t"], fps)
        for i in range(max(L, 0), n):
            x = min(1.0, (i - L) / beat_frames)
            lift[i] += 0.5 + 0.5 * (0.5 - 0.5 * math.cos(math.pi * x))
        if kc.get("pivot") is not None:
            P = land(kc["pivot"], fps)
            for i in range(max(P, 0), min(L, n)):
                x = (i - P) / max(L - P, 1)
                pivot[i] = x * x * (3 - 2 * x)
    cols["key_lift"], cols["key_pivot"] = lift, pivot
    ev["keys"] = [[round(k0, 4), round(k1, 4), k] for k0, k1, k, *_ in keys]
    ev["key_changes"] = key_changes

    # --- arrangement: entries/exits, cuts, the end
    entries, exits = [], []
    for name in STEMS:
        merged: list[list[float]] = []
        for a, b in active[name]:
            if merged and a - merged[-1][1] < 4.0:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        for a, b in merged:
            entries.append([round(a, 4), short[name]])
            exits.append([round(b, 4), short[name]])
    ev["entries"], ev["exits"] = sorted(entries), sorted(exits)
    ev["active"] = {short[k]: v for k, v in active.items()}
    cuts = find_cuts({k: active[k] for k in STEMS}, levels5, np.asarray(downs_ev))
    ev["cuts"] = cuts
    cols["cut"] = impulses(n, fps, [(c, 1.0) for c in cuts], 0.25)
    end_stop = find_end_stop(audio["mix"], sr)
    ev["end_stop"] = end_stop
    ev["end"] = round(duration, 4)
    stopped = np.zeros(n)
    if end_stop is not None:
        stopped[land(end_stop, fps):] = 1
    cols["stopped"] = stopped

    # loudness landmarks (1 s smoothing), within the music
    music0 = min((iv[0][0] for iv in active.values() if iv), default=0.0)
    music1 = end_stop or max((iv[-1][1] for iv in active.values() if iv), default=duration)
    sm = gaussian_filter1d(lufs, fps * 0.5)
    inside = (t >= music0 + 1) & (t <= music1 - 1)
    if inside.any():
        idx = np.nonzero(inside)[0]
        ev["loudest"] = round(float(t[idx[np.argmax(sm[idx])]]), 4)
    ev["dips"] = find_dips(t, lufs, fps, music0 + 1, music1 - 1)
    ev["quietest"] = ev["dips"][0][0] if ev["dips"] else None
    peaks = []
    thr_peak = np.percentile(sm[inside], 90) if inside.any() else 0
    for i in range(1, n - 1):
        if inside[i] and sm[i] >= thr_peak and sm[i] >= sm[i - 1] and sm[i] > sm[i + 1]:
            if not peaks or t[i] - peaks[-1][0] >= 4.0:
                peaks.append([round(float(t[i]), 4), round(float(lufs[i]), 2)])
            elif lufs[i] > peaks[-1][1]:
                peaks[-1] = [round(float(t[i]), 4), round(float(lufs[i]), 2)]
    ev["peaks"] = peaks
    ev["sections"] = [{"label": s["label"], "t0": s["t0"], "t1": s["t1"], "hint": s.get("hint", ""),
                       "key": s.get("key")} for s in sections]

    fallbacks = [x for x in inputs.get("fallbacks", []) if x]
    header = {
        "schema": SCHEMA, "fps": fps, "n_frames": n, "sr": int(dec["sr"]), "samples": samples,
        "duration_s": round(duration, 4), "bpb": bpb, "beat_s": round(beat_s, 4),
        "meta": {"title": dec.get("title", ""), "artist": dec.get("artist", "")},
        "norm": norm, "upstream_fallbacks": fallbacks, "runs": inputs.get("runs", {}),
    }
    out_cols = {}
    for k, v in cols.items():
        arr = np.asarray(v, dtype=float)
        assert len(arr) == n, k
        out_cols[k] = [round(float(x), 4) for x in arr]
    return {**header, "columns": out_cols, "events": ev}


def run(ctx: Context) -> None:
    import json

    fps = float(ctx.cfg.fps)
    names = ("decode", "loudness", "rhythm", "notes", "tonal", "lyrics", "structure")
    inputs: dict = {k: ctx.load(k) for k in names}
    mix, sr = load_mono(ctx.path("audio", "mix.wav"))
    audio = {"sr": sr, "mix": mix}
    for name in STEMS:
        audio[name], _ = load_mono(ctx.path("stems", f"{name}.wav"))
    inputs["audio"] = audio
    inputs["fallbacks"] = [ctx.load(s).get("fallback") for s in ("stems", "rhythm")]
    runs = {}
    for k in names + ("stems",):
        p = ctx.path("stages", f"{k}.done.json")
        if p.exists():
            runs[k] = json.loads(p.read_text()).get("run")
    inputs["runs"] = runs
    ctx.save("motion", build(inputs, fps))
