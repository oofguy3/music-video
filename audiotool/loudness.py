"""Loud and quiet: RMS envelopes (mix + stems), LUFS, and when each stem is active."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import median_filter

from .io import read_wav, rnd
from .pipeline import Context

FRAME_RATE = 20          # envelope frames per second (shared grid for every track)
FLOOR_DB = -80.0
STEMS = ("vocals", "drums", "bass", "other")


def rms_db_envelope(x: np.ndarray, sr: int, fr: int = FRAME_RATE, win: float = 0.1,
                    floor: float = FLOOR_DB) -> np.ndarray:
    """dBFS RMS on a grid t = i / fr, using a centred window of `win` seconds."""
    power = np.square(x, dtype=np.float64)
    if power.ndim == 2:
        power = power.mean(axis=1)
    csum = np.concatenate([[0.0], np.cumsum(power)])
    n = len(power)
    n_frames = int(np.ceil(n / sr * fr))
    centres = (np.arange(n_frames) / fr * sr).astype(np.int64)
    half = int(win * sr / 2)
    lo = np.clip(centres - half, 0, n)
    hi = np.clip(centres + half, 0, n)
    ms = (csum[hi] - csum[lo]) / np.maximum(hi - lo, 1)
    return np.maximum(10 * np.log10(ms + 1e-12), floor)


def lufs(x: np.ndarray, sr: int) -> dict:
    """Integrated loudness, loudness range and 10 Hz momentary loudness (ITU-R BS.1770)."""
    import pyloudnorm as pyln

    meter = pyln.Meter(sr)  # 400 ms blocks, 75 % overlap -> one block every 100 ms
    integrated = float(meter.integrated_loudness(x))
    momentary = np.asarray(meter.blockwise_loudness, dtype=np.float64)
    momentary = np.maximum(np.nan_to_num(momentary, nan=-70.0, neginf=-70.0), -70.0)
    try:
        lra = float(pyln.Meter(sr).loudness_range(x))
    except (ValueError, IndexError):
        lra = float("nan")
    # block j spans [0.1 j, 0.1 j + 0.4]; report it at its centre
    return {"integrated_lufs": integrated, "lra_lu": lra,
            "momentary_lufs_10hz": momentary, "momentary_t0": 0.2}


def activity(db: np.ndarray, fr: int, threshold: float, min_dur: float = 0.5,
             close_gap: float = 0.4, smooth: float = 0.3) -> list[list[float]]:
    """Intervals [t0, t1] where the (median-smoothed) envelope is above `threshold`."""
    k = max(1, int(round(smooth * fr)) | 1)
    sm = median_filter(db, size=k, mode="nearest")
    on = sm > threshold
    runs = []
    i, n = 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            runs.append([i / fr, j / fr])
            i = j
        else:
            i += 1
    merged: list[list[float]] = []
    for a, b in runs:
        if merged and a - merged[-1][1] <= close_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [[round(a, 2), round(b, 2)] for a, b in merged if b - a >= min_dur]


def stem_threshold(mix_db: np.ndarray, rel_db: float = -24.0, abs_db: float = -50.0) -> float:
    """A stem counts as playing when it is within `rel_db` of the mix's loud level."""
    return float(max(abs_db, np.percentile(mix_db, 95) + rel_db))


def run(ctx: Context) -> None:
    mix, sr = read_wav(ctx.path("audio", "mix.wav"))
    mix_db = rms_db_envelope(mix, sr)
    lu = lufs(mix, sr)
    peak = float(20 * np.log10(np.abs(mix).max() + 1e-12))
    thr = stem_threshold(mix_db)

    stems: dict[str, dict] = {}
    energy: dict[str, float] = {}
    for name in STEMS:
        x, _ = read_wav(ctx.path("stems", f"{name}.wav"))
        db = rms_db_envelope(x, sr)[: len(mix_db)]
        act = activity(db, FRAME_RATE, thr)
        energy[name] = float(np.sum(10 ** (db / 10)))
        mask = db > thr
        stems[name] = {
            "db": rnd(db, 1),
            "active": act,
            "active_s": round(sum(b - a for a, b in act), 1),
            "mean_db_active": round(float(10 * np.log10(np.mean(10 ** (db[mask] / 10)))), 1)
            if mask.any() else None,
        }
    total = sum(energy.values()) or 1.0
    for name in STEMS:
        stems[name]["share"] = round(energy[name] / total, 3)

    ctx.save("loudness", {
        "frame_rate": FRAME_RATE,
        "floor_db": FLOOR_DB,
        "mix_db": rnd(mix_db, 1),
        "integrated_lufs": round(lu["integrated_lufs"], 2),
        "lra_lu": round(lu["lra_lu"], 2) if np.isfinite(lu["lra_lu"]) else None,
        "peak_dbfs": round(peak, 2),
        "momentary_lufs_10hz": rnd(lu["momentary_lufs_10hz"], 1),
        "momentary_t0": lu["momentary_t0"],
        "activity_threshold_db": round(thr, 1),
        "stems": stems,
    })
