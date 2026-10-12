import numpy as np

from audiotool.structure import add_hints, letter_labels, roman_numeral, snap_and_merge


def test_roman_numerals():
    assert roman_numeral("G#:min", "B major") == "vi"
    assert roman_numeral("A#:maj", "Bb major") == "I"
    assert roman_numeral("E:min", "B major") == "iv"
    assert roman_numeral("F#:maj", "Gb major") == "I"
    assert roman_numeral("N", "C major") == "?"


def test_letter_labels_mark_repeats():
    segs = [[0, 10, 3], [10, 20, 1], [20, 30, 3], [30, 40, 2]]
    assert letter_labels(segs) == ["A1", "B1", "A2", "C1"]


def test_snap_and_merge():
    times = np.arange(0, 41, 0.5)
    runs = [(0, 20, 0), (20, 22, 1), (22, 60, 2), (60, 80, 0)]   # beat-index runs; (20,22) is a 1 s sliver
    downbeats = np.arange(0, 41, 2.0)
    segs = snap_and_merge(runs, times, downbeats, min_len_s=3.0)
    assert len(segs) == 3
    for s in segs[1:]:
        assert s[0] in downbeats      # inner boundaries sit on bar lines
    assert segs[0][0] == 0 and segs[-1][1] == 40


def test_hints_are_factual():
    secs = [
        {"label": "A1", "lufs": -20, "key": "C major", "stems": {"vocals": 0.0, "drums": 0.0, "bass": 0, "other": 1}},
        {"label": "B1", "lufs": -10, "key": "C major", "stems": {"vocals": 0.9, "drums": 0.9, "bass": 1, "other": 1}},
        {"label": "C1", "lufs": -9, "key": "Db major", "stems": {"vocals": 0.9, "drums": 0.0, "bass": 1, "other": 1}},
        {"label": "D1", "lufs": -25, "key": "Db major", "stems": {"vocals": 0.1, "drums": 0.0, "bass": 0, "other": 1}},
    ]
    add_hints(secs, integrated=-12)
    assert secs[0]["hint"] == "intro"
    assert secs[1]["hint"] == ""
    assert secs[2]["hint"] == "key change, loudest, no drums"
    assert secs[3]["hint"] == "outro"
    assert secs[1]["d_lufs"] == 2
