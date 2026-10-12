import numpy as np

from audiotool.io import write_wav
from audiotool.notes import gate, load_model, midi_name, monophonic, summary, transcribe, write_midi
from synth import MELODY, SR, hz


def test_midi_name():
    assert midi_name(69) == "A4"
    assert midi_name(70) == "A#4"
    assert midi_name(70, flats=True) == "Bb4"
    assert midi_name(60) == "C4"


def test_basic_pitch_finds_the_melody(tmp_path):
    # a clean sine melody, as a separated vocal stem would be
    beat, n = 0.5, 16
    t = np.arange(int(SR * beat * n)) / SR
    y = np.zeros_like(t)
    for i in range(n):
        s, e = int(i * beat * SR), int((i * beat + 0.45) * SR)
        y[s:e] = 0.4 * np.sin(2 * np.pi * hz(MELODY[i % 4]) * (t[s:e] - i * beat))
    wav = write_wav(tmp_path / "vocals.wav", np.stack([y, y], 1), SR)
    notes = transcribe(wav, "vocals", load_model(), tempo=120)
    found = {round(n[2]) for n in notes if n[1] - n[0] > 0.2}
    assert set(MELODY) <= found
    first = min((n for n in notes if round(n[2]) == MELODY[0]), key=lambda n: n[0])
    assert first[0] < 0.1


def test_gate_keeps_only_notes_inside_activity():
    notes = [[1.0, 1.5, 60, 0.5], [5.0, 5.5, 62, 0.5], [9.8, 10.4, 64, 0.5]]
    kept = gate(notes, [[0.5, 2.0], [10.0, 12.0]], pad=0.0)
    assert [n[2] for n in kept] == [60, 64]


def test_write_midi_and_summary(tmp_path):
    import pretty_midi

    notes = {"vocals": [[0.0, 0.5, 69, 0.8], [0.5, 1.0, 72, 0.6]], "bass": [[0.0, 1.0, 45, 0.7]]}
    path = write_midi(tmp_path / "all.mid", notes, 120.0)
    pm = pretty_midi.PrettyMIDI(str(path))
    assert sorted(i.name for i in pm.instruments) == ["bass", "vocals"]
    assert summary(notes["vocals"])["n"] == 2
    assert summary([]) == {"n": 0}


def test_monophonic_drops_octave_ghosts():
    sung = [0.0, 1.0, 62, 0.8]
    ghost = [0.1, 0.9, 74, 0.3]           # quieter, an octave up, inside the sung note
    nxt = [1.0, 2.0, 64, 0.7]
    assert monophonic([sung, ghost, nxt]) == [sung, nxt]
