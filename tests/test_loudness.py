import numpy as np
import pyloudnorm as pyln

from audiotool.loudness import FRAME_RATE, activity, lufs, rms_db_envelope, stem_threshold
from synth import INTRO_S, QUIET, SR


def test_envelope_grid_and_levels(song):
    x, _ = song
    db = rms_db_envelope(x, SR)
    assert len(db) == int(np.ceil(len(x) / SR * FRAME_RATE))
    t = np.arange(len(db)) / FRAME_RATE
    loud = db[(t > 10) & (t < 18)].mean()
    quiet = db[(t > QUIET[0] + 0.5) & (t < QUIET[1] - 0.5)].mean()
    assert 9 < loud - quiet < 15          # the quiet section is 12 dB down
    assert db[t < INTRO_S - 0.2].max() == -80.0   # digital silence hits the floor


def test_activity_finds_music_after_intro(song):
    x, _ = song
    db = rms_db_envelope(x, SR)
    act = activity(db, FRAME_RATE, stem_threshold(db))
    assert act, "expected at least one active interval"
    assert abs(act[0][0] - INTRO_S) < 0.3


def test_activity_merges_short_gaps_and_drops_blips():
    fr = 20
    db = np.full(200, -80.0)
    db[20:60] = -10      # 1.0-3.0 s
    db[64:100] = -10     # gap of 0.2 s -> merged
    db[150:152] = -10    # 0.1 s blip -> dropped
    assert activity(db, fr, -40, smooth=0.05) == [[1.0, 5.0]]


def test_integrated_matches_pyloudnorm(song):
    x, _ = song
    out = lufs(x, SR)
    assert abs(out["integrated_lufs"] - pyln.Meter(SR).integrated_loudness(x)) < 1e-6
    assert len(out["momentary_lufs_10hz"]) > 0
