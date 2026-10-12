from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from synth import DURATION, SR, make_song  # noqa: E402


def pytest_addoption(parser):
    parser.addoption("--slow", action="store_true", help="run tests that download models / need heavy CPU")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--slow"):
        return
    skip = pytest.mark.skip(reason="needs --slow")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def song():
    return make_song()


@pytest.fixture(scope="session")
def song_mp3(tmp_path_factory, song) -> Path:
    """The synthetic song as an MP3 with tags and embedded cover art, like a real download."""
    from audiotool.io import write_wav

    d = tmp_path_factory.mktemp("song")
    wav = write_wav(d / "synth.wav", song[0], SR)
    mp3 = d / "synth.mp3"
    cover = d / "cover.png"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "color=c=red:s=16x16", "-frames:v", "1", str(cover)], check=True)
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(wav), "-i", str(cover),
         "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-b:a", "192k", "-c:v", "png",
         "-disposition:v", "attached_pic", "-id3v2_version", "3",
         "-metadata", "title=Test Tone (Demo Mix)", "-metadata", "artist=Synth Band", str(mp3)],
        check=True,
    )
    return mp3


@pytest.fixture
def analysis() -> dict:
    """A small but complete analysis.json-shaped dict for digest/render tests."""
    dur = 20.0
    fr = 20
    n = int(dur * fr)
    t = np.arange(n) / fr
    mix_db = np.where(t < 2, -60.0, -18.0 + 3 * np.sin(t))
    beats = list(np.round(np.arange(2.0, dur, 0.5), 3))
    downs = beats[::4]
    stems = {}
    for name, act in {"vocals": [[4.0, 9.0], [11.0, 18.0]], "drums": [[2.0, 19.5]],
                      "bass": [[6.0, 19.5]], "other": [[2.0, 19.5]]}.items():
        db = np.full(n, -70.0)
        for a, b in act:
            db[int(a * fr):int(b * fr)] = -22.0
        stems[name] = {"db": list(np.round(db, 1)), "active": act, "active_s": sum(b - a for a, b in act),
                       "mean_db_active": -22.0, "share": 0.25}
    lines = [
        {"id": 0, "t0": 4.2, "t1": 6.0, "text": "hello quiet world",
         "words": [[4.2, 4.8, "hello", 0.9], [4.8, 5.4, "quiet", 0.3], [5.4, 6.0, "world", 0.95]], "flags": []},
        {"id": 1, "t0": 12.0, "t1": 14.0, "text": "again and again",
         "words": [[12.0, 12.6, "again", 0.9], [12.6, 13.0, "and", 0.9], [13.0, 14.0, "again", 0.9]],
         "flags": ["outside_vocals"]},
    ]
    sections = [
        {"id": 0, "label": "A1", "hint": "intro", "key": "A minor", "t0": 0.0, "t1": 10.0, "lufs": -14.0,
         "d_lufs": -1.0, "stems": {"vocals": 0.5, "drums": 0.8, "bass": 0.4, "other": 0.8},
         "stem_db": {}, "notes": {"vocals": {"n": 3, "lo": "A4", "hi": "E5", "per_s": 0.3}, "bass": {"n": 0},
                                  "other": {"n": 0}},
         "chords": ["Am", "C", "G"], "roman": ["i", "III", "VII"], "lines": [0], "n_beats": 16, "bars": 4},
        {"id": 1, "label": "B1", "hint": "loudest", "key": "A minor", "t0": 10.0, "t1": 20.0, "lufs": -12.0,
         "d_lufs": 1.0, "stems": {"vocals": 0.7, "drums": 1.0, "bass": 1.0, "other": 1.0},
         "stem_db": {}, "notes": {"vocals": {"n": 0}, "bass": {"n": 2, "lo": "A2", "hi": "A2", "per_s": 0.2},
                                  "other": {"n": 0}},
         "chords": ["F", "G"], "roman": ["VI", "VII"], "lines": [1], "n_beats": 20, "bars": 5},
    ]
    return {
        "schema": "audiotool.analysis/1",
        "meta": {"title": "Test Tone (Demo Mix)", "artist": "Synth Band", "album": "", "date": "",
                 "duration_s": dur, "sr": 44100, "source_sha256": "0" * 64, "source_name": "synth.mp3",
                 "local_audio": "audio/song.mp3", "created": "2026-01-01T00:00:00", "version": "test",
                 "models": {"separation": "sep", "beats": "beats", "notes": "notes", "asr": "asr"},
                 "separation_residual_db": -30.0, "timings_s": {}},
        "frame_rate": fr,
        "loudness": {"integrated_lufs": -13.0, "lra_lu": 4.0, "peak_dbfs": -1.0, "mix_db": list(np.round(mix_db, 1)),
                     "momentary_lufs_10hz": [-13.0] * (int(dur * 10) - 3), "momentary_t0": 0.2,
                     "activity_threshold_db": -40.0},
        "stems": stems,
        "rhythm": {"source": "test", "tempo_bpm": 120.0, "tempo_stability": 1.0, "meter": "4/4",
                   "beats": beats, "downbeats": downs},
        "tonal": {"key": "A minor", "key_conf": 0.1, "key_candidates": [["A minor", 0.8], ["C major", 0.7]],
                  "keys": [[0.0, 20.0, "A minor", 0.2]], "chord_cols": ["t0", "t1", "label", "display"],
                  "chords": [[2.0, 6.0, "A:min", "Am"], [6.0, 10.0, "C:maj", "C"], [10.0, 20.0, "F:maj", "F"]],
                  "chord_usage_s": [["F", 10.0], ["Am", 4.0], ["C", 4.0]]},
        "notes": {"cols": ["t0", "t1", "midi", "vel"],
                  "vocals": [[4.2, 4.8, 69, 0.8], [4.8, 5.4, 72, 0.7], [5.4, 6.0, 76, 0.9]],
                  "bass": [[10.0, 11.0, 45, 0.6], [12.0, 13.0, 45, 0.6]], "other": [],
                  "summary": {"vocals": {"n": 3, "lo": "A4", "hi": "E5", "median": "C5"},
                              "bass": {"n": 2, "lo": "A2", "hi": "A2", "median": "A2"}, "other": {"n": 0}}},
        "lyrics": {"model": "asr", "language": "en", "lang_prob": 0.99, "p_low": 0.5, "n_words": 6, "n_low": 1,
                   "word_cols": ["t0", "t1", "word", "p"], "lines": lines},
        "sections": sections,
    }


@pytest.fixture(scope="session")
def synth_duration() -> float:
    return DURATION
