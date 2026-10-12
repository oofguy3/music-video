from dataclasses import dataclass

import pytest

from audiotool import pipeline
from audiotool.pipeline import Config, Context, Stage, closure


def test_closure_orders_dependencies():
    order = closure(["structure"])
    assert order.index("decode") < order.index("stems") < order.index("lyrics") < order.index("structure")
    assert "png" not in order
    with pytest.raises(KeyError):
        closure(["nope"])


@dataclass(frozen=True)
class FakeStage(Stage):
    def run(self, ctx):
        ctx.calls.append(self.name)
        ctx.save(self.name, {"param": self.params(ctx.cfg)})


class FakeCtx(Context):
    calls: list


def _stages():
    own = lambda n: (lambda ctx: [ctx.stage_json(n)])  # noqa: E731
    return {
        "a": FakeStage("a", "decode", (), lambda c: {}, own("a")),
        "b": FakeStage("b", "decode", ("a",), lambda c: {"w": c.whisper}, own("b")),
        "c": FakeStage("c", "decode", ("b",), lambda c: {}, own("c")),
    }


def test_run_caches_and_invalidates_downstream(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "STAGES", _stages())
    ctx = FakeCtx(song=tmp_path / "s.mp3", out=tmp_path / "out", cfg=Config(), song_sha="x")
    ctx.calls = []
    pipeline.run(ctx, ["c"])
    assert ctx.calls == ["a", "b", "c"]

    ctx.calls = []
    pipeline.run(ctx, ["c"])
    assert ctx.calls == []                     # all cached

    ctx.calls = []
    pipeline.run(ctx, ["c"], force={"b"})
    assert ctx.calls == ["b", "c"]             # forcing b re-runs its dependents too

    ctx.calls = []
    ctx.cfg.whisper = "small"
    pipeline.run(ctx, ["c"])
    assert ctx.calls == ["b", "c"]             # a param change invalidates b and below

    ctx.calls = []
    (ctx.stage_json("c")).unlink()
    pipeline.run(ctx, ["c"])
    assert ctx.calls == ["c"]                  # a missing output re-runs only that stage
