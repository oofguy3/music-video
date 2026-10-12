import numpy as np

from audiotool.tonal import (PITCHES, chord_fit, chord_templates, estimate_chords, estimate_key, key_name,
                             key_timeline, signature_distance, spell_chord, uses_flats)

MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]


def triad_chroma(root: int, minor: bool = False) -> np.ndarray:
    c = np.full(12, 0.05)
    for iv in (0, 3 if minor else 4, 7):
        c[(root + iv) % 12] = 1.0
    return c


def progression(tonic: int, beats_per_chord: int = 8, reps: int = 4) -> np.ndarray:
    """I vi IV V in the given major key, as beat-synchronous chroma (12 x B)."""
    cols = []
    for _ in range(reps):
        for deg, minor in ((0, False), (9, True), (5, False), (7, False)):
            cols += [triad_chroma(tonic + deg, minor)] * beats_per_chord
    return np.array(cols).T


def test_key_name_spelling():
    assert key_name(10, "major") == "Bb major"
    assert key_name(11, "major") == "B major"
    assert key_name(7, "minor") == "G minor"
    assert key_name(8, "minor") == "G# minor"
    assert uses_flats("Bb major") and not uses_flats("B major")


def test_spell_chord():
    assert spell_chord("A#:maj", flats=True) == "Bb"
    assert spell_chord("A#:maj", flats=False) == "A#"
    assert spell_chord("G:min", flats=True) == "Gm"
    assert spell_chord("N", flats=True) == "N"


def test_signature_distance():
    idx = lambda name: 2 * PITCHES.index(name.split()[0]) + (name.endswith("minor"))  # noqa: E731
    assert signature_distance(idx("C major"), idx("A minor")) == 0
    assert signature_distance(idx("A# major"), idx("C minor")) == 1   # Bb major vs Eb major signature
    assert signature_distance(idx("A# major"), idx("B major")) == 5   # 2 flats vs 5 sharps


def test_estimate_key_major_scale():
    chroma = progression(0)
    times = np.arange(chroma.shape[1] + 1) * 0.5
    chords = estimate_chords(chroma, np.ones(chroma.shape[1]), times)
    key, conf, top = estimate_key(chroma, None, chords)
    assert key == "C major"


def test_estimate_chords_follows_progression():
    chroma = progression(0, reps=1)
    times = np.arange(chroma.shape[1] + 1) * 0.5
    runs = estimate_chords(chroma, np.ones(chroma.shape[1]), times)
    assert [r[2] for r in runs] == ["C:maj", "A:min", "F:maj", "G:maj"]
    assert runs[0][0] == 0.0 and runs[-1][1] == times[-1]


def test_chord_templates_shape():
    T, labels = chord_templates()
    assert T.shape == (24, 12) and len(labels) == 24
    assert np.allclose(np.linalg.norm(T, axis=1), 1)


def test_key_timeline_finds_semitone_modulation():
    chroma = np.hstack([progression(10), progression(11)])   # Bb major, then B major
    times = np.arange(chroma.shape[1] + 1) * 0.46
    energy = np.ones(chroma.shape[1])
    chords = estimate_chords(chroma, energy, times)
    keys = key_timeline(chroma, energy, times, chords)
    assert [k[2] for k in keys] == ["Bb major", "B major"]
    assert abs(keys[1][0] - times[128]) < 8 * 0.46


def test_chord_fit_prefers_tonic():
    chords = [[0, 4, "C:maj"], [4, 6, "A:min"], [6, 8, "G:maj"]]
    fit = chord_fit(chords, 0, 8)
    assert fit[0] > fit[2 * 9 + 1]   # C major beats A minor when C is the chord heard most
