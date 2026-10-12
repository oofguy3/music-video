"""Small I/O helpers shared by every stage."""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import soxr


def read_wav(path: Path | str) -> tuple[np.ndarray, int]:
    """Read audio as float32 with shape (samples, channels)."""
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return x, int(sr)


def write_wav(path: Path | str, x: np.ndarray, sr: int) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.asarray(x, dtype=np.float32), sr, subtype="FLOAT")
    return path


def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1) if x.ndim == 2 else x


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return np.asarray(x, dtype=np.float32)
    return soxr.resample(x, sr_in, sr_out, quality="HQ").astype(np.float32)


def load_mono(path: Path | str, sr: int | None = None) -> tuple[np.ndarray, int]:
    x, sr_in = read_wav(path)
    y = to_mono(x)
    if sr is not None and sr != sr_in:
        return resample(y, sr_in, sr), sr
    return y, sr_in


def sha256_file(path: Path | str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def _default(o: Any) -> Any:
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        v = float(o)
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, Path):
        return str(o)
    raise TypeError(f"not JSON serializable: {type(o).__name__}")


def _clean(o: Any) -> Any:
    """Replace NaN/inf floats (invalid JSON) with None, recursively."""
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else o
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    if isinstance(o, (np.floating, np.integer, np.bool_)):
        return _default(o)
    return o


def dumps(obj: Any, indent: int | None = None) -> str:
    return json.dumps(_clean(obj), default=_default, indent=indent,
                      separators=None if indent else (",", ":"), ensure_ascii=False)


def dump_json(path: Path | str, obj: Any, indent: int | None = None) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(obj, indent=indent), encoding="utf-8")
    return path


def load_json(path: Path | str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def rnd(values: Any, nd: int = 2) -> list:
    """Round an array-like to a plain list of floats (NaN -> None)."""
    arr = np.asarray(values, dtype=np.float64)
    out = np.round(arr, nd).tolist()
    return _clean(out)


def ffprobe_json(path: Path | str) -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        check=True, capture_output=True, text=True,
    )
    return json.loads(proc.stdout)


def mmss(t: float) -> str:
    t = max(0.0, float(t))
    m, s = divmod(int(round(t)), 60)
    return f"{m}:{s:02d}"


def intervals_overlap(t0: float, t1: float, intervals: list[list[float]]) -> float:
    """Seconds of [t0, t1] covered by a list of [a, b] intervals."""
    total = 0.0
    for a, b in intervals:
        lo, hi = max(t0, a), min(t1, b)
        if hi > lo:
            total += hi - lo
    return total
