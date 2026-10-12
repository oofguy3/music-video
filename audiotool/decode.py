"""Decode the song once to 44.1 kHz stereo float WAV and read its tags."""

from __future__ import annotations

import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

from .io import ffprobe_json, rnd
from .pipeline import Context

SR = 44100


def probe(song: Path) -> dict:
    info = ffprobe_json(song)
    fmt = info.get("format", {})
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    if audio is None:
        raise ValueError(f"{song} has no audio stream")
    return {
        "title": tags.get("title") or song.stem,
        "artist": tags.get("artist") or tags.get("album_artist") or "",
        "album": tags.get("album") or "",
        "date": tags.get("date") or "",
        "duration_s": float(fmt.get("duration") or audio.get("duration") or 0.0),
        "source_sr": int(audio.get("sample_rate") or 0),
        "source_channels": int(audio.get("channels") or 0),
        "codec": audio.get("codec_name"),
        "bit_rate": int(fmt.get("bit_rate") or 0),
    }


def slugify(title: str, fallback: str = "song") -> str:
    """'Numb - Roomie (Original Song)' -> 'numb-roomie'."""
    t = re.sub(r"[\(\[].*?[\)\]]", " ", title)
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return t or fallback


def decode(song: Path, dst: Path, sr: int = SR) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    # -map 0:a:0 skips embedded cover art, which ffmpeg exposes as a video stream.
    subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(song),
         "-map", "0:a:0", "-vn", "-ac", "2", "-ar", str(sr), "-c:a", "pcm_f32le", str(dst)],
        check=True,
    )
    return dst


def run(ctx: Context) -> None:
    meta = probe(ctx.song)
    mix = decode(ctx.song, ctx.path("audio", "mix.wav"))
    # The local player plays the original file from next to index.html.
    local_audio = ctx.path("audio", "song" + ctx.song.suffix.lower())
    if not local_audio.exists() or local_audio.stat().st_size != ctx.song.stat().st_size:
        shutil.copyfile(ctx.song, local_audio)

    import soundfile as sf

    n = sf.info(str(mix)).frames
    meta.update({
        "sr": SR,
        "samples": n,
        "duration_s": rnd(n / SR, 3),
        "source_sha256": ctx.song_sha,
        "source_name": ctx.song.name,
        "local_audio": str(local_audio.relative_to(ctx.out)),
    })
    ctx.save("decode", meta)
