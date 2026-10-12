"""Command line: `audiotool analyze SONG` runs everything; `audiotool <stage> SONG` runs one stage
(and whatever it depends on, from cache when possible)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .io import sha256_file
from .pipeline import STAGES, Config, Context, log, run, warn_if_tracked


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="audiotool",
        description="Turn a song into tracks an AI can read: loudness, notes, beats, stems, lyrics, sections.",
    )
    p.add_argument("command", choices=["analyze", *STAGES],
                   help="'analyze' runs every stage; a stage name runs that stage and its dependencies")
    p.add_argument("song", type=Path, help="audio file (mp3, wav, flac, m4a, ...)")
    p.add_argument("--out", type=Path, default=Path("out"), help="output root (default: out/)")
    p.add_argument("--slug", help="output folder name (default: from the title tag)")
    p.add_argument("--force", nargs="*", default=None, metavar="STAGE",
                   help="re-run these stages even if cached (no names = the requested stage; 'all' = all)")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--separator", choices=["htdemucs", "htdemucs_ft", "torchaudio"], default="htdemucs")
    p.add_argument("--whisper", default="turbo", help="turbo | large-v3 | medium | small | <HF repo id>")
    p.add_argument("--language", help="force the lyrics language (e.g. en); default: auto-detect")
    p.add_argument("--no-vad", action="store_true", help="disable voice-activity filtering for lyrics")
    p.add_argument("--beats", choices=["final0", "small0", "librosa"], default="final0")
    p.add_argument("--fast", action="store_true", help="small Whisper + small beat model (about 2x faster)")
    p.add_argument("--read", type=Path, help="song-read markdown to show in the PNG/HTML 'what the song is about' panel")
    p.add_argument("--artifact-lyrics", choices=["full", "lines", "blocks", "none"], default="blocks",
                   help="how much lyric text artifact.html carries (index.html always has full lyrics)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    song = args.song.expanduser().resolve()
    if not song.exists():
        log(f"no such file: {song}")
        return 2

    cfg = Config(threads=args.threads, separator=args.separator, whisper=args.whisper,
                 language=args.language, vad=not args.no_vad, beats=args.beats,
                 read=str(args.read.resolve()) if args.read else None,
                 artifact_lyrics=args.artifact_lyrics)
    if args.fast:
        cfg.apply_fast()

    if args.slug:
        slug = args.slug
    else:
        from .decode import probe, slugify
        slug = slugify(probe(song)["title"], fallback=slugify(song.stem))
    out = (args.out / slug).resolve()
    out.mkdir(parents=True, exist_ok=True)
    warn_if_tracked(out)

    targets = list(STAGES) if args.command == "analyze" else [args.command]
    force: set[str] = set()
    if args.force is not None:
        force = set(args.force) if args.force else set(targets)

    ctx = Context(song=song, out=out, cfg=cfg, song_sha=sha256_file(song))
    log(f"{song.name} -> {out}")
    manifest = run(ctx, targets, force)
    log(f"finished in {manifest['last_run_s']:.1f}s")
    for name in ("digest.md", "tracks.png", "index.html", "artifact.html"):
        if ctx.path(name).exists():
            log(f"  {ctx.path(name)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
