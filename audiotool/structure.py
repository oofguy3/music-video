"""Song sections: Laplacian structural segmentation (McFee & Ellis, 2014) on beat-synchronous
CQT + MFCC, boundaries snapped to downbeats, repeated material sharing a letter (A, B, C…),
plus per-section statistics drawn from every other track.
"""

from __future__ import annotations

import string

import numpy as np

from .io import intervals_overlap, load_mono
from .notes import midi_name
from .pipeline import Context
from .tonal import PITCHES, parse_key, uses_flats

NUMERALS = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]


def roman_numeral(label: str, key: str | None) -> str:
    """Chord relative to the key: 'G#:min' in B major -> 'vi'. Lower case = minor chord."""
    if not key or label == "N":
        return "?"
    tonic, _ = parse_key(key)
    root, quality = label.split(":")
    num = NUMERALS[(PITCHES.index(root) - tonic) % 12]
    if quality == "min":
        num = num.replace("I", "i").replace("V", "v")
    return num

SR = 22050
HOP = 512
STEMS = ("vocals", "drums", "bass", "other")


def beat_features(y: np.ndarray, sr: int, beat_times: np.ndarray):
    import librosa

    C = librosa.amplitude_to_db(np.abs(librosa.cqt(y=y, sr=sr, hop_length=HOP, bins_per_octave=36,
                                                   n_bins=7 * 36)), ref=np.max)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=13)
    n = min(C.shape[1], mfcc.shape[1])
    frames = np.unique(np.clip(librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP), 0, n))
    bounds = librosa.util.fix_frames(frames, x_min=0, x_max=n)
    Csync = librosa.util.sync(C[:, :n], bounds, aggregate=np.median)
    Msync = librosa.util.sync(mfcc[:, :n], bounds)
    times = librosa.frames_to_time(bounds, sr=sr, hop_length=HOP)
    return Csync, Msync, times


def laplacian_embedding(Csync: np.ndarray, Msync: np.ndarray) -> np.ndarray:
    import librosa
    import scipy.ndimage
    from scipy.sparse.csgraph import laplacian

    R = librosa.segment.recurrence_matrix(Csync, width=3, mode="affinity", sym=True)
    Rf = librosa.segment.timelag_filter(scipy.ndimage.median_filter)(R, size=(1, 7))
    path_distance = np.sum(np.diff(Msync, axis=1) ** 2, axis=0)
    sigma = np.median(path_distance) + 1e-9
    path_sim = np.exp(-path_distance / sigma)
    R_path = np.diag(path_sim, k=1) + np.diag(path_sim, k=-1)
    deg_path, deg_rec = R_path.sum(axis=1), Rf.sum(axis=1)
    mu = deg_path.dot(deg_path + deg_rec) / (np.sum((deg_path + deg_rec) ** 2) + 1e-9)
    A = mu * Rf + (1 - mu) * R_path
    L = laplacian(A, normed=True)
    _, evecs = np.linalg.eigh(L)
    return scipy.ndimage.median_filter(evecs, size=(9, 1))


def cluster(evecs: np.ndarray, k: int) -> np.ndarray:
    from sklearn.cluster import KMeans

    Cnorm = np.cumsum(evecs ** 2, axis=1) ** 0.5
    X = evecs[:, :k] / (Cnorm[:, k - 1:k] + 1e-9)
    return KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X)


def _runs(labels: np.ndarray) -> list[tuple[int, int, int]]:
    out, start = [], 0
    for i in range(1, len(labels) + 1):
        if i == len(labels) or labels[i] != labels[start]:
            out.append((start, i, int(labels[start])))
            start = i
    return out


def choose_segments(evecs: np.ndarray, times: np.ndarray, bar_s: float, k_range=(2, 10),
                    min_median_bars: float = 6.0) -> tuple[np.ndarray, int]:
    """Finest clustering whose segments are still section-sized.

    Silhouette scores reward the coarsest split (a key change alone can dominate the embedding), so
    k grows until the median segment would drop below `min_median_bars` bars.
    """
    n = evecs.shape[0]
    best_labels, best_k = np.zeros(n, dtype=int), 1
    for k in range(k_range[0], min(k_range[1], n - 1) + 1):
        labels = cluster(evecs, k)
        lens = [times[b] - times[a] for a, b, _ in _runs(labels)]
        if np.median(lens) < min_median_bars * bar_s:
            break
        best_labels, best_k = labels, k
    return best_labels, best_k


def snap_and_merge(runs, beat_times, downbeats, min_len_s):
    """Convert beat-index runs to time spans, snap inner boundaries to downbeats, merge short ones."""
    segs = [[float(beat_times[a]), float(beat_times[b]), lab] for a, b, lab in runs]
    if len(downbeats):
        for i in range(1, len(segs)):
            t = segs[i][0]
            d = downbeats[np.argmin(np.abs(downbeats - t))]
            if abs(d - t) < 1.5:
                segs[i][0] = float(d)
                segs[i - 1][1] = float(d)
    changed = True
    while changed and len(segs) > 1:
        changed = False
        for i, s in enumerate(segs):
            if s[1] - s[0] < min_len_s:
                if i == 0:
                    j = 1
                elif i == len(segs) - 1:
                    j = i - 1
                else:  # absorb into the shorter neighbour so long sections stay intact
                    j = i - 1 if (segs[i - 1][1] - segs[i - 1][0]) <= (segs[i + 1][1] - segs[i + 1][0]) else i + 1
                lo, hi = min(i, j), max(i, j)
                keep = segs[j][2]
                segs[lo] = [segs[lo][0], segs[hi][1], keep]
                del segs[hi]
                changed = True
                break
    # merge neighbours that ended up with the same cluster
    merged = [segs[0]]
    for s in segs[1:]:
        if s[2] == merged[-1][2]:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return merged


def letter_labels(segs) -> list[str]:
    mapping: dict[int, str] = {}
    for s in segs:
        if s[2] not in mapping:
            mapping[s[2]] = string.ascii_uppercase[len(mapping) % 26]
    counts: dict[str, int] = {}
    out = []
    for s in segs:
        L = mapping[s[2]]
        counts[L] = counts.get(L, 0) + 1
        out.append(f"{L}{counts[L]}")
    return out


def _energy_mean_db(values: np.ndarray) -> float:
    return float(10 * np.log10(np.mean(10 ** (values / 10)) + 1e-12))


def section_stats(t0, t1, loud, notes, tonal, lyrics, rhythm) -> dict:
    fr = loud["frame_rate"]
    mom = np.asarray(loud["momentary_lufs_10hz"])
    i0, i1 = int(max(0, (t0 - 0.2) * 10)), int(max(1, (t1 - 0.2) * 10))
    lufs = _energy_mean_db(mom[i0:i1]) if i1 > i0 and len(mom[i0:i1]) else None
    dur = max(t1 - t0, 1e-3)
    stems = {s: round(intervals_overlap(t0, t1, loud["stems"][s]["active"]) / dur, 2) for s in STEMS}
    stem_db = {}
    for s in STEMS:
        db = np.asarray(loud["stems"][s]["db"])[int(t0 * fr): int(t1 * fr)]
        stem_db[s] = round(_energy_mean_db(db), 1) if len(db) else None
    key, best = None, 0.0
    for k0, k1, k, _ in tonal.get("keys", []):
        ov = min(t1, k1) - max(t0, k0)
        if ov > best:
            key, best = k, ov
    flats = uses_flats(key)
    nstats = {}
    for src in ("vocals", "bass", "other"):
        sel = [n for n in notes[src] if t0 <= n[0] < t1]
        if sel:
            p = np.array([n[2] for n in sel])
            nstats[src] = {"n": len(sel), "lo": midi_name(np.percentile(p, 5), flats),
                           "hi": midi_name(np.percentile(p, 95), flats), "per_s": round(len(sel) / dur, 2)}
        else:
            nstats[src] = {"n": 0}
    chords, roman = [], []
    for c0, c1, label, c in tonal["chords"]:
        if c1 > t0 and c0 < t1 and c != "N" and (not chords or chords[-1] != c):
            chords.append(c)
            roman.append(roman_numeral(label, key))
    lines = [ln["id"] for ln in lyrics["lines"] if t0 <= (ln["t0"] + ln["t1"]) / 2 < t1]
    beats = np.asarray(rhythm["beats"])
    downs = np.asarray(rhythm["downbeats"])
    return {
        "lufs": round(lufs, 1) if lufs is not None else None,
        "stems": stems,
        "stem_db": stem_db,
        "notes": nstats,
        "key": key,
        "chords": chords[:16],
        "roman": roman[:16],
        "lines": lines,
        "n_beats": int(np.sum((beats >= t0) & (beats < t1))),
        "bars": int(np.sum((downs >= t0 - 0.05) & (downs < t1 - 0.05))),
    }


def add_hints(sections: list[dict], integrated: float) -> None:
    """Factual tags only (no verse/chorus guesses): position, voice/drum presence, loudness extremes,
    key changes. Interpreting roles is left to the reader."""
    if not sections:
        return
    louds = [(s["lufs"], i) for i, s in enumerate(sections) if s["lufs"] is not None]
    loudest = max(louds)[1] if louds else None
    for i, s in enumerate(sections):
        v, lufs = s["stems"]["vocals"], s["lufs"] if s["lufs"] is not None else -70.0
        hints = []
        if i == 0 and v < 0.3:
            hints.append("intro")
        elif i == len(sections) - 1 and (v < 0.3 or lufs < integrated - 3):
            hints.append("outro")
        elif v < 0.2:
            hints.append("instrumental")
        elif v < 0.6 and lufs < integrated - 3:
            hints.append("break")
        if i > 0 and s.get("key") and s.get("key") != sections[i - 1].get("key"):
            hints.append("key change")
        if i == loudest:
            hints.append("loudest")
        if s["stems"]["drums"] < 0.2 and v >= 0.3:
            hints.append("no drums")
        s["hint"] = ", ".join(hints)
        s["d_lufs"] = round(s["lufs"] - integrated, 1) if s["lufs"] is not None else None


def run(ctx: Context) -> None:
    rhythm = ctx.load("rhythm")
    loud = ctx.load("loudness")
    notes = ctx.load("notes")
    tonal = ctx.load("tonal")
    lyrics = ctx.load("lyrics")
    duration = ctx.load("decode")["duration_s"]

    y, _ = load_mono(ctx.path("audio", "mix.wav"), SR)
    beats = np.asarray(rhythm["beats"], dtype=float)
    downbeats = np.asarray(rhythm["downbeats"], dtype=float)
    if len(beats) < 16:
        beats = np.arange(0, duration, 0.5)
    Csync, Msync, times = beat_features(y, SR, beats)
    evecs = laplacian_embedding(Csync, Msync)
    bpb = int(str(rhythm.get("meter") or "4/4").split("/")[0])
    tempo = rhythm.get("tempo_bpm") or 120
    bar_s = bpb * 60.0 / tempo
    times = times.copy()
    times[-1] = duration
    labels, k = choose_segments(evecs, times, bar_s)
    min_len = 2 * bar_s * 0.9  # only sub-two-bar slivers get merged away
    segs = snap_and_merge(_runs(labels), times, downbeats, min_len)
    names = letter_labels(segs)

    sections = []
    for i, ((t0, t1, _), name) in enumerate(zip(segs, names)):
        sections.append({"id": i, "label": name, "t0": round(t0, 2), "t1": round(t1, 2),
                         **section_stats(t0, t1, loud, notes, tonal, lyrics, rhythm)})
    add_hints(sections, loud["integrated_lufs"])
    ctx.save("structure", {"k": k, "method": "laplacian segmentation (cqt+mfcc, beat-sync)",
                           "sections": sections})
