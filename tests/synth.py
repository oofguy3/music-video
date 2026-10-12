"""A synthetic 'song' with known answers, so fast tests need no downloads or copyrighted audio."""

from __future__ import annotations

import numpy as np

SR = 44100
BPM = 120.0
INTRO_S = 4.0          # silence before the music starts
QUIET = (20.0, 26.0)   # section played 12 dB quieter
DURATION = 32.0
MELODY = [69, 72, 76, 72]   # A4 C5 E5 C5, one note per beat, repeating
BASS_MIDI = 45              # A2


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def make_song(sr: int = SR, duration: float = DURATION) -> tuple[np.ndarray, dict]:
    n = int(sr * duration)
    t = np.arange(n) / sr
    mix = np.zeros(n, dtype=np.float64)
    beat = 60.0 / BPM
    beats = np.arange(INTRO_S, duration - 0.5, beat)
    click_len = int(0.03 * sr)
    env = np.exp(-np.linspace(0, 8, click_len))
    for i, b in enumerate(beats):
        s = int(b * sr)
        accent = i % 4 == 0
        f = 60.0 if accent else 1500.0   # kick-like low thump on beat 1, tick elsewhere
        amp = 0.9 if accent else 0.35
        seg = amp * env * np.sin(2 * np.pi * f * np.arange(click_len) / sr)
        mix[s:s + click_len] += seg[: max(0, min(click_len, n - s))]
    notes = []
    for i, b in enumerate(beats):
        m = MELODY[i % len(MELODY)]
        s, e = int(b * sr), int((b + beat * 0.9) * sr)
        tt = t[s:e] - b
        fade = np.minimum(1, np.minimum(tt / 0.01, (beat * 0.9 - tt) / 0.02))
        mix[s:e] += 0.25 * fade * np.sin(2 * np.pi * hz(m) * tt)
        notes.append((b, b + beat * 0.9, m))
    music = t >= INTRO_S
    mix += 0.2 * music * np.sin(2 * np.pi * hz(BASS_MIDI) * t)
    gain = np.ones(n)
    gain[(t >= QUIET[0]) & (t < QUIET[1])] = 10 ** (-12 / 20)
    mix *= gain
    stereo = np.stack([mix, mix], axis=1).astype(np.float32) * 0.8
    truth = {"beats": beats, "downbeats": beats[::4], "notes": notes, "tempo": BPM}
    return stereo, truth
