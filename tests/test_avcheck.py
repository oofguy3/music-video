import subprocess

import numpy as np

from audiotool.avcheck import av_offset, event_frames, frame_diff, plot_timeline, probe, stop_check, sync
from audiotool.io import write_wav


def test_frame_diff_and_events():
    Y = np.zeros((60, 4, 4), dtype=np.uint8)
    Y[30:] = 200          # a cut on frame 30
    D = frame_diff(Y)
    assert D[30] == 200 and D[29] == 0
    ev = event_frames(D, [30])
    assert ev[0]["ok"] and ev[0]["peak_frame"] == 30


def test_stop_check():
    Y = np.full((10, 4, 4), 120, dtype=np.uint8)
    Y[7:] = 16
    assert stop_check(Y, 7)["ok"]
    assert not stop_check(Y, 6)["ok"]


def test_sync_finds_zero_lag():
    n = 600
    col = np.zeros(n)
    for f in range(20, n, 15):
        col[f:f + 6] = np.exp(-np.arange(min(6, n - f)) / 2.0)
    rise = np.maximum(0, np.diff(col, prepend=0))
    motion = {"fps": 30, "columns": {"hit": list(col)},
              "events": {"sections": [{"label": "A", "t0": 0, "t1": n / 30}]}}
    res = sync(rise * 10 + 0.01 * np.random.default_rng(0).standard_normal(n), motion)
    assert res[0]["best_lag"] == 0 and res[0]["r"] > 0.9
    late = np.roll(rise, 2)
    assert sync(late * 10, motion)[0]["best_lag"] == 2


def test_plot_timeline_writes_a_png(tmp_path):
    n = 120
    Y = np.zeros((n, 4, 4), dtype=np.uint8)
    Y[60:] = 150
    cols = {k: [0.0] * n for k in ("hit", "energy", "voc_lvl", "numb", "pad_lvl")}
    motion = {"fps": 30, "columns": cols, "events": {
        "sections": [{"label": "A", "t0": 0, "t1": 2}, {"label": "B", "t0": 2, "t1": 4}],
        "numb": [[1.0, 1.5, 1.0]], "cuts": [2.0], "key_changes": [{"t": 3.0}], "end_stop": 3.9}}
    out = plot_timeline(Y, frame_diff(Y), motion, tmp_path / "t.png")
    assert (tmp_path / "t.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" and out.endswith("t.png")


def test_probe_and_av_offset_on_a_tiny_render(tmp_path):
    sr = 44100
    t = np.arange(int(35.0 * sr)) / sr
    rng = np.random.default_rng(1)
    noise = rng.standard_normal(len(t)) * 0.1 * (1 + np.sin(2 * np.pi * 0.7 * t))
    wav = write_wav(tmp_path / "mix.wav", np.stack([noise, noise], 1), sr)
    mp4 = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x36:r=30:d=35", "-i", str(wav),
                    "-af", "aresample=48000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
                    "-shortest", str(mp4)], check=True)
    info = probe(mp4)
    assert info["video"]["r_frame_rate"] == "30/1" and int(info["video"]["nb_read_frames"]) >= 1049
    res = av_offset(mp4, wav, windows=(5.0, 15.0), span=8.0)
    assert res["ok"], res
