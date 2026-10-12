"""Heavy tests: download models and run them on CPU. Run with `pytest --slow`."""

import numpy as np
import pytest

from synth import SR


@pytest.mark.slow
def test_htdemucs_stems_sum_to_mix(song):
    from audiotool.stems import separate

    x, _ = song
    mix = x[: 8 * SR]
    stems, model = separate(mix, SR, "htdemucs")
    assert set(stems) == {"vocals", "drums", "bass", "other"}
    resid = mix - sum(stems.values())
    assert 20 * np.log10(np.sqrt(np.mean(resid ** 2)) / np.sqrt(np.mean(mix ** 2))) < -20


@pytest.mark.slow
def test_whisper_hears_nothing_in_silence():
    from audiotool.lyrics import ensure_model, transcribe
    from audiotool.pipeline import Config

    model_dir, _ = ensure_model("small")
    words, meta = transcribe(np.zeros(16000 * 5, dtype=np.float32), model_dir, Config(language="en"))
    assert words == []
