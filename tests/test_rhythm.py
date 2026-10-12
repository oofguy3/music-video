import numpy as np
import pytest

from audiotool.io import resample, to_mono
from audiotool.rhythm import librosa_beats, summarize
from synth import BPM, SR


def test_librosa_fallback_tempo_and_downbeats(song):
    x, truth = song
    y = resample(to_mono(x), SR, 22050)
    beats, downs = librosa_beats(y, y, 22050)
    s = summarize(beats, downs)
    assert abs(s["tempo_bpm"] - BPM) / BPM < 0.02
    assert s["meter"] == "4/4"
    # every detected downbeat lands on an accented (bar-start) beat
    for d in downs[1:-1]:
        assert np.min(np.abs(truth["downbeats"] - d)) < 0.07


def test_summarize_handles_tiny_input():
    assert summarize(np.array([1.0]), np.array([]))["tempo_bpm"] is None


@pytest.mark.slow
def test_beat_this_on_synth(song):
    from audiotool.rhythm import _beat_this

    x, truth = song
    beats, downs = _beat_this(to_mono(x), SR, "small0")
    assert abs(60 / np.median(np.diff(beats)) - BPM) < 3
