import numpy as np

from audiotool.io import write_wav
from audiotool.lyrics import build_lines, flag_lines, prep_vocals, split_lines


def w(start, end, word, p=0.9, seg=0, logprob=-0.2):
    return {"start": start, "end": end, "word": " " + word, "p": p, "seg": seg, "seg_logprob": logprob,
            "seg_compression": 1.2, "seg_no_speech": 0.01}


def test_split_lines_on_pauses_and_sentence_ends():
    words = [w(0, .3, "I"), w(.3, .6, "was"), w(.6, 1.0, "numb."), w(1.1, 1.3, "Then"), w(1.3, 1.6, "it"),
             w(3.0, 3.3, "came"), w(3.3, 3.6, "back")]
    lines = split_lines(words)
    assert [len(x) for x in lines] == [3, 2, 2]


def test_build_and_flag_lines():
    words = [w(1, 1.5, "hello", .9), w(1.5, 2, "there", .2), w(10, 10.5, "ghost", .9, seg=1, logprob=-1.4)]
    lines = build_lines(words)
    assert lines[0]["text"] == "hello there"
    flag_lines(lines, active=[[0.5, 3.0]])
    assert lines[0]["flags"] == []
    assert "outside_vocals" in lines[1]["flags"] and "low_logprob" in lines[1]["flags"]


def test_repeat_run_flag():
    words = []
    for i in range(3):
        words += [w(i * 3, i * 3 + .5, "go", seg=i), w(i * 3 + .5, i * 3 + 1, "on.", seg=i)]
    lines = build_lines(words)
    flag_lines(lines, active=[[0, 10]])
    assert all("repeat_run" in ln["flags"] for ln in lines)


def test_prep_vocals_mutes_outside_activity(tmp_path):
    sr = 44100
    y = 0.5 * np.sin(2 * np.pi * 220 * np.arange(4 * sr) / sr)
    wav = write_wav(tmp_path / "v.wav", np.stack([y, y], 1), sr)
    out = prep_vocals(wav, active=[[1.0, 2.0]], pad=0.0)
    assert len(out) == 4 * 16000
    inside = np.abs(out[16000:32000]).max()
    outside = np.abs(out[48000:]).max()
    assert abs(inside - 10 ** (-1 / 20)) < 1e-3
    assert 20 * np.log10(outside / inside) < -35
