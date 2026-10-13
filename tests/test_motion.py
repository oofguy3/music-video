import json
import math

import numpy as np
import pytest

from audiotool.loudness import FRAME_RATE, activity, lufs, rms_db_envelope, stem_threshold
from audiotool.motion import (beat_grid, borrowed_iv_conf, build, find_cuts, find_dips, find_end_stop,
                              impulses, land, level_5ms, snap_chords)
from audiotool.tonal import refine_key_changes
from synth import BPM, DURATION, INTRO_S, MELODY, QUIET, SR, make_parts

FPS = 30.0


def test_landing_rule_matches_js_rounding():
    assert land(169.975, FPS) == 5099          # 5099.25 -> 5099
    assert land(97.76, FPS) == 2933            # 2932.8  -> 2933
    assert land(0.05, FPS) == 2                # exact half rounds up (Python round() would give 2 too, but 0.15 -> 5)
    assert land(0.15, FPS) == 5                # 4.5 -> 5 (half up, not half to even)
    assert land(-0.01, FPS) == 0


def test_impulse_peaks_on_landing_frame_and_combines_by_max():
    col = impulses(100, FPS, [(1.0, 0.8), (1.02, 0.5)], tau=0.1)
    L = land(1.0, FPS)
    assert col[L - 1] == 0 and col[L] == pytest.approx(0.8)
    assert col[L + 1] == pytest.approx(0.8 * math.exp(-1 / FPS / 0.1))
    assert col.max() == pytest.approx(0.8)     # max, not sum


def test_beat_grid_fills_holes_and_snaps_to_onsets():
    downs = np.arange(4.0, 30.0, 2.0)
    beats = np.arange(4.0, 30.0, 0.5)
    tracked = np.delete(beats, [9, 10, 30])               # two-beat hole + one missing beat
    jitter = tracked + np.where(np.arange(len(tracked)) % 2, 0.02, -0.02)
    onsets = beats + 0.004
    grid, first = beat_grid(jitter, downs, 4, DURATION, onsets=onsets)
    real = grid[(grid >= 4.0) & (grid < 29.9)]
    assert len(real) == len(beats[beats < 29.9])
    assert np.max(np.abs(real - (beats[beats < 29.9] + 0.004))) < 0.01
    assert grid[first] == pytest.approx(4.004)
    assert grid[0] <= 0 and grid[-1] >= DURATION


def test_snap_chords_moves_a_late_change_onto_the_downbeat():
    chords = [[4.0, 8.5, "C:maj", "C"], [8.5, 12.0, "F:min", "Fm"]]
    downs = np.arange(4.0, 30.0, 2.0)
    supports_new = [[8.0, 12.0, 68, 0.5], [8.0, 12.0, 65, 0.5]]   # Ab + F from the downbeat
    out = snap_chords(chords, downs, 0.5, supports_new)
    assert out[1][0] == 8.0 and out[0][1] == 8.0
    supports_old = [[8.0, 8.5, 64, 0.5], [8.0, 8.5, 67, 0.5]]     # E + G: still C major
    out = snap_chords(chords, downs, 0.5, supports_old)
    assert out[1][0] == 8.5


def test_borrowed_iv_confidence_from_the_third():
    minor_third = [[0, 2, 68, 0.5]]    # Ab: Fm in C major
    major_third = [[0, 2, 69, 0.5]]    # A: really F major
    assert borrowed_iv_conf("F:min", "C major", minor_third, 0, 2) == pytest.approx(1.0)
    assert borrowed_iv_conf("F:min", "C major", major_third, 0, 2) == pytest.approx(0.0)
    assert borrowed_iv_conf("D:min", "C major", minor_third, 0, 2) is None     # ii, not iv
    assert borrowed_iv_conf("F:min", "C minor", minor_third, 0, 2) is None     # iv is diatonic in minor


def test_key_change_moves_to_the_first_new_tonic_chord():
    keys = [[0.0, 99.13, "Bb major", 0.1], [99.13, 170.0, "B major", 0.2]]
    chords = [[88.52, 95.9, "A#:maj"], [95.9, 97.76, "F#:maj"], [97.76, 101.42, "B:maj"],
              [101.42, 103.3, "G#:min"]]
    downs = np.array([88.52, 90.36, 92.22, 94.06, 95.9, 97.76, 99.6, 101.42, 103.3])
    new_keys, changes = refine_key_changes(keys, chords, downs)
    assert new_keys[0][1] == new_keys[1][0] == pytest.approx(97.76, abs=0.01)
    assert changes[0]["pivot"] == pytest.approx(95.9) and changes[0]["semis"] == 1
    assert changes[0]["window_t"] == pytest.approx(99.13)


def test_end_stop_is_sample_accurate():
    sr = 44100
    t = np.arange(int(3.0 * sr)) / sr
    x = 0.3 * np.sin(2 * np.pi * 220 * t)
    x[int(2.4321 * sr):] = 0
    stop = find_end_stop(x, sr)
    assert abs(stop - 2.4321) < 0.002
    assert find_end_stop(0.3 * np.sin(2 * np.pi * 220 * t) * np.linspace(1, 0, len(t)), sr) is None


def test_cut_needs_two_stems_stopping_together():
    sr = 44100
    t = np.arange(int(4.0 * sr)) / sr
    a = 0.3 * np.sin(2 * np.pi * 110 * t) * (t < 2.0)
    b = 0.3 * np.sin(2 * np.pi * 330 * t) * (t < 2.05)
    c = 0.3 * np.sin(2 * np.pi * 550 * t) * (t < 3.0)
    levels = {k: level_5ms(v, sr) for k, v in {"a": a, "b": b, "c": c}.items()}
    cuts = find_cuts({"a": [[0, 2.0]], "b": [[0, 2.05]], "c": [[0, 3.0]]}, levels, np.array([0.0, 1.98, 3.96]))
    assert cuts == [1.98]


def test_dips_find_a_breath():
    fps = 30
    t = np.arange(0, 30, 1 / fps)
    lufs = np.full(len(t), -12.0)
    lufs[(t > 10) & (t < 10.8)] = -30
    dips = find_dips(t, lufs, fps, 1, 29)
    assert len(dips) == 1 and abs(dips[0][0] - 10.4) < 0.3


@pytest.fixture(scope="module")
def built():
    parts, truth = make_parts()
    sr = SR
    n = len(parts["drums"])
    mix = sum(parts.values())
    mix_db = rms_db_envelope(mix, sr)
    thr = stem_threshold(mix_db)
    stems = {}
    for k, v in parts.items():
        db = rms_db_envelope(v, sr)[: len(mix_db)]
        stems[k] = {"db": list(np.round(db, 1)), "active": activity(db, FRAME_RATE, thr)}
    lu = lufs(np.stack([mix, mix], 1), sr)
    loud = {"activity_threshold_db": thr, "stems": stems, "momentary_lufs_10hz": list(lu["momentary_lufs_10hz"]),
            "momentary_t0": 0.2}
    beats = list(np.delete(truth["beats"], [5, 6]))       # a two-beat hole
    notes = {"vocals": [[a, b, m, 0.8] for a, b, m in truth["notes"]],
             "bass": [[INTRO_S, DURATION, 45, 0.6]],
             "other": [[8.0, 12.0, 68, 0.5], [8.0, 12.0, 65, 0.5]]}
    chords = [[4.0, 8.5, "C:maj", "C"], [8.5, 12.0, "F:min", "Fm"], [12.0, DURATION, "C:maj", "C"]]
    inputs = {
        "decode": {"sr": sr, "samples": n, "title": "Test Tone", "artist": "Synth Band"},
        "loudness": loud,
        "rhythm": {"beats": beats, "downbeats": list(truth["downbeats"]), "meter": "4/4"},
        "notes": notes,
        "tonal": {"keys": [[0.0, DURATION, "C major", 0.5]], "key_changes": [], "chords": chords},
        "lyrics": {"lines": [{"t0": 4.0, "t1": 6.0, "text": "secretword lyric",
                              "words": [[4.0, 4.4, "secretword", 0.9], [4.5, 5.9, "lyric", 0.4]]}]},
        "structure": {"sections": [{"label": "A1", "t0": 0.0, "t1": QUIET[0], "hint": ""},
                                   {"label": "B1", "t0": QUIET[0], "t1": QUIET[1], "hint": ""},
                                   {"label": "C1", "t0": QUIET[1], "t1": DURATION, "hint": ""}]},
        "audio": {"sr": sr, "mix": mix, **parts},
    }
    return build(inputs, FPS), truth


def test_build_columns_and_header(built):
    m, _ = built
    assert m["schema"] == "audiotool.motion/1"
    assert m["n_frames"] == math.ceil(DURATION * FPS)
    assert all(len(v) == m["n_frames"] for v in m["columns"].values())
    assert m["bpb"] == 4 and abs(60 / m["beat_s"] - BPM) < 1


def test_build_kicks_land_on_downbeats(built):
    m, truth = built
    kicks = [e[0] for e in m["events"]["kick"] if e[1] > 0.5]
    for d in truth["downbeats"]:
        assert min(abs(k - d) for k in kicks) < 1.5 / FPS
    col = m["columns"]["kick"]
    for t, s, _ in m["events"]["kick"]:
        assert col[land(t, FPS)] >= s - 1e-3


def test_build_refills_beat_hole(built):
    m, truth = built
    beats = np.asarray(m["events"]["beats"])
    for b in truth["beats"][4:8]:
        assert np.min(np.abs(beats - b)) < 0.01


def test_build_per_section_normalisation_keeps_quiet_part_readable(built):
    m, _ = built
    c = m["columns"]
    t = np.arange(m["n_frames"]) / FPS
    loud = (t > 10) & (t < 18)
    quiet = (t > QUIET[0] + 1) & (t < QUIET[1] - 1)
    rel = np.asarray(c["voc_rel"])
    lvl = np.asarray(c["voc_lvl"])
    assert np.percentile(rel[quiet], 90) >= 0.6
    assert np.percentile(lvl[loud], 90) - np.percentile(lvl[quiet], 90) >= 0.25


def test_build_numb_window_snaps_to_downbeat(built):
    m, _ = built
    numb = m["events"]["numb"]
    # the melody's A (major third of F) sounds in that bar too, so the evidence is strong but not total
    assert len(numb) == 1 and numb[0][0] == pytest.approx(8.0, abs=0.02) and numb[0][2] > 0.75
    col = np.asarray(m["columns"]["numb"])
    assert col[land(7.5, FPS)] == 0 and col[land(10.0, FPS)] == pytest.approx(numb[0][2])


def test_build_keeps_no_lyric_text(built):
    m, _ = built
    text = json.dumps(m)
    assert "secretword" not in text and "lyric" not in text.replace("lyrics", "")
    assert m["events"]["words"][0][0] == pytest.approx(4.0)


def test_voice_pitch_follows_melody(built):
    m, truth = built
    c = m["columns"]
    for a, b, midi in truth["notes"][:8]:
        i = land((a + b) / 2, FPS)
        assert c["voc_midi"][i] == midi
    assert max(c["voc_pitch"]) == pytest.approx(1.0) and min(c["voc_pitch"]) == pytest.approx(0.0)
    assert set(MELODY) >= {int(x) for x in c["voc_midi"] if x >= 0}
