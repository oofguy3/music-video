"""Notes: polyphonic transcription (Spotify basic-pitch, ONNX) of the vocal, bass and other stems.

Separation leaves faint bleed in every stem, which basic-pitch happily transcribes, so notes are
kept only where their own stem is audibly playing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .io import intervals_overlap
from .pipeline import Context

# (min Hz, max Hz, onset threshold, frame threshold, min note ms)
SETTINGS = {
    "vocals": (80.0, 1100.0, 0.5, 0.3, 110.0),
    "bass": (30.0, 400.0, 0.5, 0.3, 110.0),
    "other": (55.0, 4200.0, 0.55, 0.3, 90.0),
}
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


def midi_name(m: float, flats: bool = False) -> str:
    m = int(round(m))
    return f"{(FLAT_NAMES if flats else NOTE_NAMES)[m % 12]}{m // 12 - 1}"


def load_model():
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model

    return Model(ICASSP_2022_MODEL_PATH)


def transcribe(wav: Path, source: str, model, tempo: float = 120.0) -> list[list[float]]:
    """[[t0, t1, midi, velocity 0-1], ...] sorted by onset."""
    from basic_pitch.inference import predict

    fmin, fmax, onset, frame, min_ms = SETTINGS[source]
    _, _, events = predict(
        str(wav), model, onset_threshold=onset, frame_threshold=frame,
        minimum_note_length=min_ms, minimum_frequency=fmin, maximum_frequency=fmax,
        melodia_trick=True, midi_tempo=tempo,
    )
    notes = [[float(s), float(e), int(p), float(a)] for s, e, p, a, *_ in events]
    notes.sort(key=lambda n: (n[0], n[2]))
    return notes


def gate(notes: list[list[float]], active: list[list[float]], pad: float = 0.25,
         min_cover: float = 0.5) -> list[list[float]]:
    padded = [[a - pad, b + pad] for a, b in active]
    kept = []
    for n in notes:
        dur = max(n[1] - n[0], 1e-3)
        if intervals_overlap(n[0], n[1], padded) / dur >= min_cover:
            kept.append(n)
    return kept


def monophonic(notes: list[list[float]], min_overlap: float = 0.5) -> list[list[float]]:
    """A single voice sings one note at a time. basic-pitch often adds a quieter ghost an octave
    above (or below) the sung note; drop any note that mostly overlaps a louder one."""
    keep = []
    for i, n in enumerate(notes):
        dur = max(n[1] - n[0], 1e-3)
        ghost = False
        for j, m in enumerate(notes):
            if j == i or m[3] < n[3] or (m[3] == n[3] and j > i):
                continue
            if m[0] > n[1]:
                break
            if min(n[1], m[1]) - max(n[0], m[0]) >= min_overlap * dur:
                ghost = True
                break
        if not ghost:
            keep.append(n)
    return keep


def write_midi(path: Path, notes_by_source: dict[str, list[list[float]]], tempo: float) -> Path:
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo or 120.0)
    programs = {"vocals": 53, "bass": 33, "other": 0}  # voice oohs, finger bass, piano
    for source, notes in notes_by_source.items():
        inst = pretty_midi.Instrument(program=programs.get(source, 0), name=source)
        for t0, t1, m, v in notes:
            inst.notes.append(pretty_midi.Note(velocity=int(np.clip(v * 127, 1, 127)), pitch=int(m),
                                               start=float(t0), end=float(t1)))
        pm.instruments.append(inst)
    path.parent.mkdir(parents=True, exist_ok=True)
    pm.write(str(path))
    return path


def summary(notes: list[list[float]]) -> dict:
    if not notes:
        return {"n": 0}
    pitches = np.array([n[2] for n in notes])
    return {
        "n": len(notes),
        "lo": midi_name(np.percentile(pitches, 5)),
        "hi": midi_name(np.percentile(pitches, 95)),
        "median": midi_name(np.median(pitches)),
    }


def run(ctx: Context) -> None:
    rhythm = ctx.load("rhythm")
    loud = ctx.load("loudness")
    tempo = rhythm.get("tempo_bpm") or 120.0
    model = load_model()
    out: dict[str, list] = {}
    raw_counts = {}
    for source in SETTINGS:
        notes = transcribe(ctx.path("stems", f"{source}.wav"), source, model, tempo)
        raw_counts[source] = len(notes)
        notes = gate(notes, loud["stems"][source]["active"])
        if source == "vocals":
            notes = monophonic(notes)
        out[source] = [[round(a, 3), round(b, 3), m, round(v, 2)] for a, b, m, v in notes]
        write_midi(ctx.path("midi", f"{source}.mid"), {source: out[source]}, tempo)
    write_midi(ctx.path("midi", "all.mid"), out, tempo)

    ctx.save("notes", {
        "model": "basic-pitch icassp_2022 (onnx)",
        "cols": ["t0", "t1", "midi", "vel"],
        **out,
        "raw_counts": raw_counts,
        "summary": {s: summary(out[s]) for s in out},
    })
