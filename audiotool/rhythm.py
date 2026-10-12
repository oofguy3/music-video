"""Beats, downbeats, tempo and meter.

Primary: beat_this (Foscarin et al., 2024), a transformer beat + downbeat tracker.
Fallback: librosa's dynamic-programming beat tracker on the drum stem, with the bar phase chosen
as the beat position that carries the most low-frequency (kick/bass) onset energy.
"""

from __future__ import annotations

import numpy as np

from .io import load_mono, rnd
from .pipeline import Context, log

SR = 22050
HOP = 512


def _beat_this(mix_mono: np.ndarray, sr: int, checkpoint: str) -> tuple[np.ndarray, np.ndarray]:
    from beat_this.inference import Audio2Beats

    tracker = Audio2Beats(checkpoint_path=checkpoint, device="cpu", dbn=False)
    beats, downbeats = tracker(mix_mono, sr)
    return np.asarray(beats, dtype=np.float64), np.asarray(downbeats, dtype=np.float64)


def _low_onset(y: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=HOP, n_mels=64, fmax=8000)
    freqs = librosa.mel_frequencies(n_mels=64, fmax=8000)
    low = librosa.power_to_db(mel[freqs < 150])
    return np.maximum(0, np.diff(low, axis=1, prepend=low[:, :1])).mean(axis=0)


def librosa_beats(drums: np.ndarray, mix: np.ndarray, sr: int, beats_per_bar: int = 4
                  ) -> tuple[np.ndarray, np.ndarray]:
    import librosa

    src = drums if np.sqrt(np.mean(drums ** 2)) > 1e-3 else mix
    env = librosa.onset.onset_strength(y=src, sr=sr, hop_length=HOP)
    _, beat_frames = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=HOP)
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    if len(beats) < beats_per_bar:
        return beats, beats[:1]
    low = _low_onset(mix, sr)
    idx = np.clip(beat_frames, 0, len(low) - 1)
    scores = [low[idx[p::beats_per_bar]].mean() for p in range(beats_per_bar)]
    phase = int(np.argmax(scores))
    return beats, beats[phase::beats_per_bar]


def summarize(beats: np.ndarray, downbeats: np.ndarray) -> dict:
    out: dict = {"tempo_bpm": None, "tempo_stability": None, "meter": None}
    if len(beats) >= 2:
        ibi = np.diff(beats)
        med = float(np.median(ibi))
        # Beat times sit on the tracker's frame grid (20-23 ms), so single intervals are quantised;
        # the mean of the intervals near the median recovers the tempo between grid steps.
        inliers = ibi[np.abs(ibi - med) < 0.1 * med]
        out["tempo_bpm"] = round(60.0 / float(inliers.mean() if len(inliers) else med), 1)
        # fraction of inter-beat intervals within 5 % of the median: 1.0 = metronomic
        out["tempo_stability"] = round(float(np.mean(np.abs(ibi - med) < 0.05 * med)), 2)
    if len(downbeats) >= 3:
        counts = [int(np.sum((beats >= a - 1e-3) & (beats < b - 1e-3)))
                  for a, b in zip(downbeats[:-1], downbeats[1:])]
        vals, freq = np.unique(counts, return_counts=True)
        out["meter"] = f"{int(vals[np.argmax(freq)])}/4"
    return out


def run(ctx: Context) -> None:
    import torch

    torch.set_num_threads(ctx.cfg.threads)
    mix, _ = load_mono(ctx.path("audio", "mix.wav"), SR)
    drums, _ = load_mono(ctx.path("stems", "drums.wav"), SR)

    source = None
    if ctx.cfg.beats != "librosa":
        for ckpt in dict.fromkeys([ctx.cfg.beats, "small0"]):
            try:
                beats, downbeats = _beat_this(mix, SR, ckpt)
                source = f"beat_this:{ckpt}"
                break
            except Exception as e:  # noqa: BLE001
                log(f"rhythm: beat_this {ckpt} failed ({e!r})")
    if source is None:
        beats, downbeats = librosa_beats(drums, mix, SR)
        source = "librosa:beat_track+low-band-phase"

    ctx.save("rhythm", {
        "source": source,
        **summarize(beats, downbeats),
        "beats": rnd(beats, 3),
        "downbeats": rnd(downbeats, 3),
    })
