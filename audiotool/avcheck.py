"""Automated checks on a rendered music video (python -m audiotool.avcheck VIDEO ...).

- probe: codec/profile, size, exact frame rate and frame count, pixel format, colour tags, audio format
- sync: per section, the best lag between picture change (frame-difference energy of a small grey
  decode) and a motion feature (default `hit`); the picture should land on the hit (lag 0 or -1)
- events: each listed frame shows a picture spike within +-1 frame
- stop: the hard-stop frame is black while the frame before it is not
- av: the video's audio lines up with mix.wav (cross-correlation lag in samples at 48 kHz)
- plot: a timeline chart of picture level and change against the song's sections and events
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np


def probe(path: str | Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-print_format", "json", "-show_format",
                          "-show_streams", str(path)], check=True, capture_output=True, text=True).stdout
    info = json.loads(out)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), {})
    return {
        "video": {k: v.get(k) for k in ("codec_name", "profile", "width", "height", "r_frame_rate", "avg_frame_rate",
                                         "nb_read_frames", "pix_fmt", "color_space", "color_primaries",
                                         "color_transfer", "color_range", "start_time")},
        "audio": {k: a.get(k) for k in ("codec_name", "sample_rate", "channels", "duration", "start_time")},
        "duration": float(info["format"].get("duration", 0)),
        "size_mb": round(int(info["format"].get("size", 0)) / 1e6, 1),
    }


def decode_luma(path: str | Path, w: int = 192, h: int = 108) -> np.ndarray:
    """Every frame as a small greyscale image: (n, h, w) uint8 (TV-range luma)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"scale={w}:{h}:flags=area,format=gray",
                          "-f", "rawvideo", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w)


def frame_diff(Y: np.ndarray) -> np.ndarray:
    d = np.zeros(len(Y))
    d[1:] = np.abs(Y[1:].astype(np.int16) - Y[:-1].astype(np.int16)).mean(axis=(1, 2))
    return d


def _z(x: np.ndarray) -> np.ndarray:
    s = x.std()
    return (x - x.mean()) / s if s > 0 else x * 0


def sync(D: np.ndarray, motion: dict, column: str = "hit", lags=range(-4, 5)) -> list[dict]:
    """Per section: Pearson r between picture change D and the feature column, for each lag (frames;
    positive lag = picture after the feature). Reports the best lag."""
    col = np.asarray(motion["columns"][column], dtype=float)
    # the onset of a feature impulse is where it rises; compare with its positive derivative
    rise = np.maximum(0, np.diff(col, prepend=col[0]))
    fps = motion["fps"]
    out = []
    for s in motion["events"]["sections"]:
        a, b = int(math.ceil(s["t0"] * fps)) + 5, int(math.floor(s["t1"] * fps)) - 5
        if b - a < 60 or rise[a:b].std() == 0:
            continue
        best = None
        rows = {}
        for lag in lags:
            x = D[a + lag:b + lag] if a + lag >= 0 and b + lag <= len(D) else None
            if x is None or x.std() == 0:
                continue
            r = float(np.corrcoef(_z(x), _z(rise[a:b]))[0, 1])
            rows[lag] = round(r, 3)
            if best is None or r > best[1]:
                best = (lag, r)
        if best:
            out.append({"section": s["label"], "best_lag": best[0], "r": round(best[1], 3), "by_lag": rows})
    return out


def event_frames(D: np.ndarray, frames: list[int], win: int = 15, ratio: float = 3.0) -> list[dict]:
    """Each frame should show a picture spike within +-1 frame (D above `ratio` x local median)."""
    res = []
    for f in frames:
        if f <= 1 or f >= len(D) - 1:
            continue
        local = np.median(D[max(1, f - win):min(len(D), f + win)]) + 0.05
        peak_at = int(np.argmax(D[f - 1:f + 2])) + f - 1
        peak = float(D[peak_at])
        res.append({"frame": f, "peak_frame": peak_at, "spike": round(float(peak / local), 2), "ok": bool(peak / local >= ratio)})
    return res


def stop_check(Y: np.ndarray, stop_frame: int, black: int = 17) -> dict:
    after = int(Y[stop_frame:].max()) if stop_frame < len(Y) else -1
    before = int(Y[stop_frame - 1].max()) if stop_frame > 0 else -1
    return {"stop_frame": stop_frame, "max_luma_from_stop": after, "max_luma_before": before,
            "ok": after <= black and before > black}


def _audio(path: str | Path, sr: int = 48000) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def av_offset(video: str | Path, mix: str | Path, start_sample_44k: int = 0, sr: int = 48000,
              windows=(30.0, 90.0, 150.0), span: float = 10.0, max_lag: int = 4096) -> dict:
    """Lag (samples at 48 kHz) of the video's audio against mix.wav; 0 = perfectly aligned.
    `start_sample_44k`: where in mix.wav the video's audio starts (short cuts)."""
    va = _audio(video, sr)
    ma = _audio(mix, sr)
    off = int(round(start_sample_44k * sr / 44100))
    lags = []
    for w0 in windows:
        a = int(w0 * sr)
        n = int(span * sr)
        if a + n + max_lag > len(va) or off + a + n + max_lag > len(ma):
            continue
        x = va[a:a + n].astype(np.float64)
        y = ma[off + a - max_lag: off + a + n + max_lag].astype(np.float64)
        size = 1 << int(math.ceil(math.log2(len(x) + len(y))))
        c = np.fft.irfft(np.fft.rfft(y, size) * np.conj(np.fft.rfft(x, size)), size)[: 2 * max_lag + 1]
        lags.append(int(np.argmax(c)) - max_lag)
    return {"lags_48k": lags, "ok": bool(lags) and all(abs(lag) <= 48 for lag in lags)}


def plot_timeline(Y: np.ndarray, D: np.ndarray, motion: dict, path: str | Path) -> str:
    """One PNG of the film's shape: mean picture level, picture change against the drum hits, and the
    energy, voice and numb envelopes, with sections, cuts, the key change, numb windows and the stop."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fps = motion["fps"]
    ev = motion["events"]
    cols = motion["columns"]
    n = min(len(Y), len(cols["hit"]))
    x = np.arange(n) / fps
    fig, axes = plt.subplots(3, 1, figsize=(18, 8), sharex=True, dpi=100)
    luma = Y[:n].reshape(n, -1).mean(axis=1)
    axes[0].plot(x, luma, lw=0.8, color="#333")
    axes[0].set_ylabel("mean luma")
    axes[1].plot(x, D[:n], lw=0.6, color="#1f5fbf", label="picture change")
    hit = np.asarray(cols["hit"][:n], dtype=float)
    axes[1].plot(x, hit * max(1e-6, float(np.percentile(D[:n], 99))), lw=0.5, color="#d0632a", alpha=0.7,
                 label="hit (scaled)")
    axes[1].set_ylabel("change")
    axes[1].legend(loc="upper left", fontsize=8)
    for name, color in (("energy", "#333"), ("voc_lvl", "#2a9d5c"), ("numb", "#7e8083"), ("pad_lvl", "#b08a2e")):
        if name in cols:
            axes[2].plot(x, np.asarray(cols[name][:n], dtype=float), lw=0.8, color=color, label=name)
    axes[2].set_ylabel("features")
    axes[2].legend(loc="upper left", fontsize=8, ncol=4)
    for ax in axes:
        for s in ev.get("sections", []):
            ax.axvline(s["t0"], color="#999", lw=0.6, ls=":")
        for nb in ev.get("numb", []):
            ax.axvspan(nb[0], nb[1], color="#9aa0a6", alpha=0.18, lw=0)
        for c in ev.get("cuts", []):
            ax.axvline(c, color="#c0392b", lw=1.0)
        for kc in ev.get("key_changes", []):
            ax.axvline(kc["t"], color="#e6a930", lw=1.4)
        if ev.get("end_stop") is not None:
            ax.axvline(ev["end_stop"], color="#000", lw=1.2)
    for s in ev.get("sections", []):
        axes[0].text(s["t0"] + 0.4, axes[0].get_ylim()[1] * 0.92, s["label"], fontsize=9, color="#555")
    axes[2].set_xlabel("seconds (red: hard cuts, gold: key change, black: stop, grey bands: numb windows)")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return str(path)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    p.add_argument("--motion", required=True)
    p.add_argument("--mix", required=True)
    p.add_argument("--column", default="hit")
    p.add_argument("--events", default="", help="comma-separated frames that must show a picture spike")
    p.add_argument("--start-frame", type=int, default=0, help="first song frame in this video (short cut)")
    p.add_argument("--json", help="write the report here")
    p.add_argument("--plot", help="write a timeline chart (PNG) of picture level and change against the song")
    a = p.parse_args(argv)
    motion = json.loads(Path(a.motion).read_text())
    fps = motion["fps"]
    report = {"video": a.video, "probe": probe(a.video)}
    Y = decode_luma(a.video)
    D = frame_diff(Y)
    if a.start_frame:
        pad = np.zeros(a.start_frame)
        D = np.concatenate([pad, D])
        Y = np.concatenate([np.zeros((a.start_frame,) + Y.shape[1:], dtype=Y.dtype), Y])
    report["frames_decoded"] = int(len(Y) - a.start_frame)
    report["sync"] = sync(D, motion, a.column)
    if a.events:
        report["events"] = event_frames(D, [int(x) for x in a.events.split(",")])
    stop = motion["events"].get("end_stop")
    if stop is not None:
        report["stop"] = stop_check(Y, int(math.floor(stop * fps + 0.5)))
    if a.plot:
        report["plot"] = plot_timeline(Y, D, motion, a.plot)
    report["av"] = av_offset(a.video, a.mix, start_sample_44k=int(round(a.start_frame * motion["sr"] / fps)))
    text = json.dumps(report, indent=1)
    if a.json:
        Path(a.json).write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
