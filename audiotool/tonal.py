"""Key and chords from beat-synchronous chroma of the harmonic stems (bass + other)."""

from __future__ import annotations

import numpy as np

from .io import load_mono
from .pipeline import Context

SR = 22050
HOP = 512
PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
# keys conventionally written with flats (tonic pitch classes)
FLAT_MAJOR = {5, 10, 3, 8, 1}       # F Bb Eb Ab Db
FLAT_MINOR = {2, 7, 0, 5, 10}       # d g c f bb

# Krumhansl & Kessler (1982) key profiles
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def beat_chroma(y: np.ndarray, sr: int, beat_times: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(chroma 12 x B, per-beat energy, segment boundary times of length B+1)."""
    import librosa

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP, bins_per_octave=36)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    n = chroma.shape[1]
    frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP)
    frames = np.unique(np.clip(frames, 0, n))
    bounds = librosa.util.fix_frames(frames, x_min=0, x_max=n)
    sync = librosa.util.sync(chroma, bounds, aggregate=np.median)
    energy = librosa.util.sync(rms[None, :n], bounds, aggregate=np.mean)[0]
    times = librosa.frames_to_time(bounds, sr=sr, hop_length=HOP)
    return sync, energy, times


def key_name(tonic: int, mode: str) -> str:
    flats = tonic in (FLAT_MAJOR if mode == "major" else FLAT_MINOR)
    return f"{(FLATS if flats else PITCHES)[tonic]} {mode}"


def parse_key(name: str) -> tuple[int, str]:
    root, mode = name.split()
    pcs = PITCHES if root in PITCHES else FLATS
    return pcs.index(root), mode


def uses_flats(key: str | None) -> bool:
    if not key:
        return False
    tonic, mode = parse_key(key)
    return tonic in (FLAT_MAJOR if mode == "major" else FLAT_MINOR)


def spell_chord(label: str, flats: bool) -> str:
    """'A#:maj' -> 'Bb' (in a flat key) or 'A#'; 'G:min' -> 'Gm'; 'N' -> 'N'."""
    if label == "N":
        return "N"
    root, quality = label.split(":")
    name = (FLATS if flats else PITCHES)[PITCHES.index(root)]
    return name + ("m" if quality == "min" else "")


def key_scores(chroma: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
    """Correlation of the weighted mean chroma with the 24 rotated profiles: index 2*tonic + (minor)."""
    w = np.ones(chroma.shape[1]) if weights is None else weights
    profile = (chroma * w).sum(axis=1) / (w.sum() + 1e-9)
    out = np.zeros(24)
    for tonic in range(12):
        out[2 * tonic] = np.corrcoef(profile, np.roll(KK_MAJOR, tonic))[0, 1]
        out[2 * tonic + 1] = np.corrcoef(profile, np.roll(KK_MINOR, tonic))[0, 1]
    return np.nan_to_num(out)


def _idx_name(i: int) -> str:
    return key_name(i // 2, "minor" if i % 2 else "major")


def estimate_key(chroma: np.ndarray, weights: np.ndarray | None = None,
                 chords: list[list] | None = None) -> tuple[str, float, list]:
    """Krumhansl-Schmuckler key. When the top two are relative major/minor and nearly tied, the one
    whose tonic triad is heard longer in `chords` wins; the margin is then reported as negative
    (the chosen key scored slightly lower) and the chosen key is listed first."""
    sc = key_scores(chroma, weights)
    order = [int(i) for i in np.argsort(-sc)]
    best, second = order[0], order[1]
    margin = float(sc[best] - sc[second])
    if chords and margin < 0.06 and best % 2 != second % 2:
        maj, mnr = (best, second) if best % 2 == 0 else (second, best)
        if (maj // 2 - 3) % 12 == mnr // 2:  # relative pair
            def tonic_time(i: int) -> float:
                lab = f"{PITCHES[i // 2]}:{'min' if i % 2 else 'maj'}"
                return sum(c[1] - c[0] for c in chords if c[2] == lab)
            if tonic_time(second) > 1.5 * tonic_time(best):
                order[0], order[1] = second, best
                best, margin = second, -margin
    return _idx_name(best), round(margin, 3), [[_idx_name(i), round(float(sc[i]), 3)] for i in order[:3]]


def chord_fit(chords: list[list], t0: float, t1: float) -> np.ndarray:
    """For each of the 24 keys, the share of chord time in [t0, t1) that is diatonic to it, with the
    tonic triad counted double (relative major/minor share chords; the tonic tells them apart)."""
    fit = np.zeros(24)
    total = 0.0
    for c0, c1, label, *_ in chords:
        d = min(c1, t1) - max(c0, t0)
        if d <= 0 or label == "N":
            continue
        total += d
        root, q = label.split(":")
        r = PITCHES.index(root)
        for tonic in range(12):
            iv = (r - tonic) % 12
            major_ok = (q == "maj" and iv in (0, 5, 7)) or (q == "min" and iv in (2, 4, 9))
            minor_ok = (q == "min" and iv in (0, 5, 7)) or (q == "maj" and iv in (3, 7, 8, 10))
            fit[2 * tonic] += d * (2.0 if (q == "maj" and iv == 0) else 1.0 if major_ok else 0.0)
            fit[2 * tonic + 1] += d * (2.0 if (q == "min" and iv == 0) else 1.0 if minor_ok else 0.0)
    return fit / total if total > 0 else fit


def key_timeline(chroma: np.ndarray, energy: np.ndarray, times: np.ndarray, chords: list[list],
                 win: int = 32, hop: int = 4, stay: float = 0.99, min_beats: int = 48) -> list[list]:
    """Local key over time: per-window score = pitch-profile correlation + diatonic chord fit,
    smoothed with Viterbi and merged into [t0, t1, key, margin] runs of at least `min_beats`."""
    import librosa

    n = chroma.shape[1]
    starts = list(range(0, max(1, n - win + 1), hop))
    S = np.array([key_scores(chroma[:, s:s + win], energy[s:s + win])
                  + chord_fit(chords, times[s], times[min(s + win, n)]) for s in starts]).T  # 24 x W
    prob = np.exp(12 * (S - S.max(axis=0, keepdims=True)))
    prob /= prob.sum(axis=0, keepdims=True)
    path = librosa.sequence.viterbi_discriminative(prob, librosa.sequence.transition_loop(24, stay))
    centres = np.array(starts) + win / 2
    beat_key = np.array([path[int(np.argmin(np.abs(centres - b)))] for b in range(n)])
    runs: list[list] = []
    start = 0
    for b in range(1, n + 1):
        if b == n or beat_key[b] != beat_key[start]:
            runs.append([start, b, int(beat_key[start])])
            start = b
    merged: list[list] = []
    for r in runs:
        if merged and (r[1] - r[0] < min_beats or r[2] == merged[-1][2]):
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    if len(merged) > 1 and merged[0][1] - merged[0][0] < min_beats:
        merged[1][0] = 0
        merged.pop(0)
    def best(a: int, b: int) -> tuple[int, float]:
        t0, t1 = float(times[a]), float(times[min(b, n)])
        sc = key_scores(chroma[:, a:b], energy[a:b]) + chord_fit(chords, t0, t1)
        order = np.argsort(-sc)
        return int(order[0]), float(sc[order[0]] - sc[order[1]])

    # Neighbouring keys one accidental apart (Bb major / C minor) are harmonic colour, not a modulation:
    # merge them, re-judge the merged span, and repeat until only real key changes remain.
    spans = [[a, b, best(a, b)[0]] for a, b, _ in merged]
    changed = True
    while changed and len(spans) > 1:
        changed = False
        for i in range(len(spans) - 1):
            if signature_distance(spans[i][2], spans[i + 1][2]) <= 1:
                a, b = spans[i][0], spans[i + 1][1]
                spans[i:i + 2] = [[a, b, best(a, b)[0]]]
                changed = True
                break
    out = []
    for a, b, k in spans:
        out.append([round(float(times[a]), 2), round(float(times[min(b, n)]), 2), _idx_name(k),
                    round(best(a, b)[1], 3)])
    return out


def signature_distance(k1: int, k2: int) -> int:
    """Steps around the circle of fifths between two keys' signatures (key index = 2*tonic + minor)."""
    def pos(k: int) -> int:
        major_tonic = (k // 2 + (3 if k % 2 else 0)) % 12
        p = (major_tonic * 7) % 12
        return p - 12 if p > 6 else p
    d = abs(pos(k1) - pos(k2))
    return min(d, 12 - d)


def _tonic_triad(key: str) -> str:
    tonic, mode = parse_key(key)
    return f"{PITCHES[tonic]}:{'min' if mode == 'minor' else 'maj'}"


def _diatonic(label: str, key: str) -> bool:
    """Is the triad `label` diatonic to `key` (natural minor, plus the major V in minor keys)?"""
    if label == "N":
        return False
    tonic, mode = parse_key(key)
    root, q = label.split(":")
    iv = (PITCHES.index(root) - tonic) % 12
    if mode == "major":
        return (q == "maj" and iv in (0, 5, 7)) or (q == "min" and iv in (2, 4, 9))
    return (q == "min" and iv in (0, 5, 7)) or (q == "maj" and iv in (3, 7, 8, 10))


def refine_key_changes(keys: list[list], chords: list[list], downbeats: np.ndarray,
                       look_bars: int = 4) -> tuple[list[list], list[dict]]:
    """Windowed key estimates place a modulation late (they need a window of the new key). Move each
    boundary back to the first chord on the new tonic within `look_bars` bars, provided the old tonic
    does not return after it, and snap it to that chord's downbeat. Also report the pivot: the chords
    just before the change that already belong to the new key but not to the old one."""
    keys = [list(k) for k in keys]
    db = np.asarray(downbeats, dtype=float)
    bar = float(np.median(np.diff(db))) if len(db) > 1 else 2.0
    changes = []
    for i in range(len(keys) - 1):
        old, new, tb = keys[i][2], keys[i + 1][2], keys[i][1]
        old_tonic, new_tonic = _tonic_triad(old), _tonic_triad(new)
        lo, hi = tb - look_bars * bar, tb + 2 * bar
        t_change = tb
        for c0, c1, label, *_ in chords:
            if not (lo <= c0 <= hi) or label != new_tonic:
                continue
            if any(lab == old_tonic and c0 < d0 <= max(tb, c0) for d0, _, lab, *_ in chords):
                continue  # the old key comes back after this chord: not the modulation yet
            t_change = c0
            break
        if len(db):
            k = int(np.argmin(np.abs(db - t_change)))
            if abs(db[k] - t_change) <= 0.6 * bar / 4 + 0.03:   # within about half a beat
                t_change = float(db[k])
        pivot = None
        for c0, c1, label, *_ in reversed([c for c in chords if c[0] < t_change]):
            if _diatonic(label, new) and not _diatonic(label, old):
                pivot = c0
            else:
                break
        keys[i][1] = keys[i + 1][0] = round(t_change, 2)
        a, b = parse_key(old)[0], parse_key(new)[0]
        semis = (b - a) % 12
        changes.append({"t": round(t_change, 2), "pivot": round(pivot, 2) if pivot is not None else None,
                        "from": old, "to": new, "semis": semis - 12 if semis > 6 else semis,
                        "window_t": round(tb, 2)})
    return keys, changes


def subdivide(grid: np.ndarray, max_step: float = 0.6) -> np.ndarray:
    """Split long beat intervals (half-time tracking, slow songs) so the chord decoder's per-step
    switching cost stays about the same per second."""
    out = [grid[0]] if len(grid) else []
    for a, b in zip(grid[:-1], grid[1:]):
        k = max(1, int(np.ceil((b - a) / max_step)))
        out.extend(a + (b - a) * np.arange(1, k + 1) / k)
    return np.asarray(out)


def chord_templates() -> tuple[np.ndarray, list[str]]:
    labels, rows = [], []
    for root in range(12):
        for quality, ivs in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            t = np.zeros(12)
            t[[(root + i) % 12 for i in ivs]] = 1.0
            rows.append(t / np.linalg.norm(t))
            labels.append(f"{PITCHES[root]}:{quality}")
    return np.array(rows), labels


def estimate_chords(chroma: np.ndarray, energy: np.ndarray, times: np.ndarray,
                    beta: float = 12.0, stay: float = 0.85) -> list[list]:
    """Per-beat triad matching smoothed with Viterbi; returns merged [t0, t1, label] runs."""
    import librosa

    T, labels = chord_templates()
    norm = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)
    sim = T @ norm                                      # 24 x B cosine similarity
    quiet = energy < 0.05 * (np.percentile(energy, 95) + 1e-9)
    weak = sim.max(axis=0) < 0.55
    no_chord = np.where(quiet, 1.0, np.where(weak, 0.55, 0.0))   # "N" only in silence or when nothing fits
    scores = np.vstack([sim, no_chord[None, :]])
    prob = np.exp(beta * (scores - scores.max(axis=0, keepdims=True)))
    prob /= prob.sum(axis=0, keepdims=True)
    trans = librosa.sequence.transition_loop(len(labels) + 1, stay)
    path = librosa.sequence.viterbi_discriminative(prob, trans)
    names = labels + ["N"]
    runs: list[list] = []
    for i, s in enumerate(path):
        t0, t1 = float(times[i]), float(times[i + 1])
        if runs and runs[-1][2] == names[s]:
            runs[-1][1] = round(t1, 2)
        else:
            runs.append([round(t0, 2), round(t1, 2), names[s]])
    return runs


def run(ctx: Context) -> None:
    rhythm = ctx.load("rhythm")
    bass, _ = load_mono(ctx.path("stems", "bass.wav"), SR)
    other, _ = load_mono(ctx.path("stems", "other.wav"), SR)
    y = bass + other
    beats = np.asarray(rhythm["beats"], dtype=float)
    if len(beats) < 4:  # no usable beat grid: fall back to half-second frames
        beats = np.arange(0, len(y) / SR, 0.5)
    beats = subdivide(beats)
    chroma, energy, times = beat_chroma(y, SR, beats)
    chords = estimate_chords(chroma, energy, times)
    key, conf, top = estimate_key(chroma, energy, chords)
    keys = key_timeline(chroma, energy, times, chords)
    keys, key_changes = refine_key_changes(keys, chords, np.asarray(rhythm["downbeats"], dtype=float))

    def local_key(t: float) -> str:
        for k0, k1, k, _ in keys:
            if k0 <= t < k1:
                return k
        return keys[-1][2] if keys else key

    for c in chords:  # display spelling follows the key in force at that moment
        c.append(spell_chord(c[2], uses_flats(local_key(c[0]))))

    # chord vocabulary by time spent
    usage: dict[str, float] = {}
    for t0, t1, _, c in chords:
        if c != "N":
            usage[c] = usage.get(c, 0.0) + (t1 - t0)
    common = sorted(usage.items(), key=lambda kv: -kv[1])[:8]
    ctx.save("tonal", {
        "key": key,
        "key_conf": conf,
        "key_candidates": top,
        "keys": keys,
        "key_changes": key_changes,
        "chords": chords,
        "chord_cols": ["t0", "t1", "label", "display"],
        "chord_usage_s": [[c, round(s, 1)] for c, s in common],
        "method": "chroma_cqt(bass+other) beat-sync; Krumhansl-Kessler key (global + windowed Viterbi timeline); triad templates + Viterbi",
    })
