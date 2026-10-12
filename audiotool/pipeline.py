"""Stage graph with on-disk caching.

Every stage writes `stages/<name>.json` (plus any extra files) under the song's output folder and a
`stages/<name>.done.json` marker. A stage is skipped when its marker's key matches the current key,
which hashes the song, the stage's parameters and the run ids of the stages it depends on, so
re-running an upstream stage invalidates everything downstream of it.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import platform
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import __version__
from .io import dump_json, load_json


@dataclass
class Config:
    threads: int = 4
    separator: str = "htdemucs"        # htdemucs | htdemucs_ft | torchaudio
    whisper: str = "turbo"             # turbo | small | medium | large-v3
    language: str | None = None        # None = auto-detect
    vad: bool = True                   # Silero VAD inside faster-whisper
    beats: str = "final0"              # final0 | small0 | librosa
    read: str | None = None            # song-read markdown to show in the PNG/HTML panel
    artifact_lyrics: str = "blocks"    # full | lines | blocks | none  (artifact.html only)

    def apply_fast(self) -> None:
        self.whisper = "small"
        self.beats = "small0"


@dataclass
class Context:
    song: Path
    out: Path
    cfg: Config
    song_sha: str
    _cache: dict[str, Any] = field(default_factory=dict, repr=False)

    def path(self, *parts: str) -> Path:
        return self.out.joinpath(*parts)

    def stage_json(self, name: str) -> Path:
        return self.path("stages", f"{name}.json")

    def load(self, name: str) -> dict:
        if name not in self._cache:
            self._cache[name] = load_json(self.stage_json(name))
        return self._cache[name]

    def save(self, name: str, data: dict) -> Path:
        self._cache[name] = data
        return dump_json(self.stage_json(name), data)


def log(msg: str) -> None:
    print(f"[audiotool] {msg}", file=sys.stderr, flush=True)


@dataclass(frozen=True)
class Stage:
    name: str
    module: str
    deps: tuple[str, ...]
    params: Callable[[Config], dict]
    outputs: Callable[[Context], list[Path]]

    def run(self, ctx: Context) -> None:
        importlib.import_module(f"audiotool.{self.module}").run(ctx)


def _own(name: str) -> Callable[[Context], list[Path]]:
    return lambda ctx: [ctx.stage_json(name)]


def _read_param(cfg: Config) -> dict:
    """Panel text is part of the PNG/HTML cache key, so editing the read re-renders."""
    if not cfg.read:
        return {"read": None}
    p = Path(cfg.read)
    digest = hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.exists() else "missing"
    return {"read": str(p), "read_sha": digest}


STAGES: dict[str, Stage] = {s.name: s for s in [
    Stage("decode", "decode", (), lambda c: {},
          lambda ctx: [ctx.stage_json("decode"), ctx.path("audio", "mix.wav")]),
    Stage("stems", "stems", ("decode",), lambda c: {"separator": c.separator},
          lambda ctx: [ctx.stage_json("stems")] + [ctx.path("stems", f"{s}.wav") for s in
                                                   ("vocals", "drums", "bass", "other")]),
    Stage("loudness", "loudness", ("decode", "stems"), lambda c: {}, _own("loudness")),
    Stage("rhythm", "rhythm", ("decode", "stems"), lambda c: {"beats": c.beats}, _own("rhythm")),
    Stage("notes", "notes", ("stems", "loudness", "rhythm"), lambda c: {}, _own("notes")),
    Stage("tonal", "tonal", ("stems", "rhythm"), lambda c: {}, _own("tonal")),
    Stage("lyrics", "lyrics", ("stems", "loudness"),
          lambda c: {"whisper": c.whisper, "language": c.language, "vad": c.vad}, _own("lyrics")),
    Stage("structure", "structure", ("decode", "loudness", "rhythm", "notes", "tonal", "lyrics"),
          lambda c: {}, _own("structure")),
    Stage("digest", "digest", ("decode", "stems", "loudness", "rhythm", "notes", "tonal", "lyrics",
                               "structure"),
          lambda c: {}, lambda ctx: [ctx.path("analysis.json"), ctx.path("digest.md")]),
    Stage("png", "render_png", ("digest",), _read_param, lambda ctx: [ctx.path("tracks.png")]),
    Stage("html", "render_html", ("digest",),
          lambda c: {**_read_param(c), "artifact_lyrics": c.artifact_lyrics},
          lambda ctx: [ctx.path("index.html"), ctx.path("artifact.html")]),
]}

_CODE_EXTRA = {"render_html": ["templates/player.html"]}


def code_hash(stage: Stage) -> str:
    """Hash of the stage's own source (plus templates), so editing a stage re-runs it and its dependents."""
    pkg = Path(__file__).parent
    h = hashlib.sha256()
    for rel in [f"{stage.module}.py", *_CODE_EXTRA.get(stage.module, [])]:
        p = pkg / rel
        if p.exists():
            h.update(p.read_bytes())
    return h.hexdigest()[:16]


def closure(targets: list[str]) -> list[str]:
    """Targets plus all their dependencies, in execution order."""
    order: list[str] = []

    def visit(name: str) -> None:
        if name not in STAGES:
            raise KeyError(f"unknown stage {name!r}; choose from {', '.join(STAGES)}")
        for dep in STAGES[name].deps:
            visit(dep)
        if name not in order:
            order.append(name)

    for t in targets:
        visit(t)
    return order


def _key(ctx: Context, stage: Stage, dep_runs: dict[str, str]) -> str:
    payload = {
        "song": ctx.song_sha,
        "stage": stage.name,
        "code": code_hash(stage),
        "params": stage.params(ctx.cfg),
        "deps": {d: dep_runs[d] for d in stage.deps},
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _done_path(ctx: Context, name: str) -> Path:
    return ctx.path("stages", f"{name}.done.json")


def run(ctx: Context, targets: list[str], force: set[str] | None = None) -> dict:
    """Run `targets` and their dependencies; returns the manifest."""
    force = force or set()
    order = closure(targets)
    if "all" in force:
        force = set(order)
    ctx.out.mkdir(parents=True, exist_ok=True)
    manifest_path = ctx.path("manifest.json")
    manifest = load_json(manifest_path) if manifest_path.exists() else {"stages": {}}
    dep_runs: dict[str, str] = {}
    t_all = time.perf_counter()

    for name in order:
        stage = STAGES[name]
        key = _key(ctx, stage, dep_runs)
        done_path = _done_path(ctx, name)
        done = load_json(done_path) if done_path.exists() else None
        fresh = (done is not None and done.get("key") == key
                 and all(p.exists() for p in stage.outputs(ctx)))
        if fresh and name not in force:
            log(f"{name:<9} cached")
            dep_runs[name] = done["run"]
            manifest["stages"].setdefault(name, {})["cached"] = True
            continue

        log(f"{name:<9} running…")
        t0 = time.perf_counter()
        stage.run(ctx)
        elapsed = round(time.perf_counter() - t0, 2)
        run_id = uuid.uuid4().hex
        dump_json(done_path, {"key": key, "run": run_id, "elapsed_s": elapsed,
                              "finished": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=1)
        dep_runs[name] = run_id
        manifest["stages"][name] = {"elapsed_s": elapsed, "cached": False}
        log(f"{name:<9} done in {elapsed:.1f}s")

    manifest.update({
        "song": str(ctx.song),
        "song_sha256": ctx.song_sha,
        "audiotool": __version__,
        "config": asdict(ctx.cfg),
        "python": platform.python_version(),
        "last_run_s": round(time.perf_counter() - t_all, 2),
    })
    dump_json(manifest_path, manifest, indent=1)
    return manifest


def warn_if_tracked(out: Path) -> None:
    """Outputs hold separated stems and transcribed lyrics; they should never be committed."""
    try:
        inside = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=out.parent,
                                capture_output=True, text=True)
        if inside.returncode != 0:
            return
        ignored = subprocess.run(["git", "check-ignore", "-q", str(out)], cwd=out.parent)
        if ignored.returncode != 0:
            log(f"WARNING: {out} is inside a git repo but not gitignored; "
                "stems and lyrics of copyrighted songs should not be committed.")
    except (FileNotFoundError, OSError):
        pass
