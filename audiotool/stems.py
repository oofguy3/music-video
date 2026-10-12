"""Source separation into vocals / drums / bass / other.

Primary: Demucs v4 HTDemucs loaded straight from HuggingFace (safetensors).
Fallback: torchaudio's HDemucs (MUSDB-HQ + extra) weights from download.pytorch.org.
"""

from __future__ import annotations

import numpy as np

from .io import read_wav, resample, write_wav
from .pipeline import Context, log

SOURCES = ("vocals", "drums", "bass", "other")


def _normalize(wav):
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    return (wav - mean) / std, mean, std


def _demucs(mix: np.ndarray, sr: int, name: str) -> tuple[dict[str, np.ndarray], int, str]:
    import torch
    from demucs.apply import apply_model
    from demucs.hf import get_hf_model

    # get_hf_model directly: demucs.pretrained.get_model silently falls back to a host
    # that may be blocked.
    model = get_hf_model(name)
    model.eval()
    msr = model.samplerate
    x = resample(mix, sr, msr) if sr != msr else mix
    wav = torch.from_numpy(np.ascontiguousarray(x.T))
    wav, mean, std = _normalize(wav)
    with torch.inference_mode():
        out = apply_model(model, wav[None], shifts=1, split=True, overlap=0.25,
                          progress=False, device="cpu", num_workers=0)[0]
    out = out * std + mean
    stems = {src: out[i].numpy().T for i, src in enumerate(model.sources)}
    return stems, msr, f"demucs:{name} (hf)"


def _torchaudio(mix: np.ndarray, sr: int) -> tuple[dict[str, np.ndarray], int, str]:
    import torch
    from torchaudio.pipelines import HDEMUCS_HIGH_MUSDB_PLUS as bundle
    from torchaudio.transforms import Fade

    model = bundle.get_model().eval()
    msr = bundle.sample_rate
    x = resample(mix, sr, msr) if sr != msr else mix
    wav = torch.from_numpy(np.ascontiguousarray(x.T))
    wav, mean, std = _normalize(wav)
    wav = wav[None]

    # Chunked overlap-add, as in torchaudio's hybrid-demucs tutorial; whole-song inference
    # needs far more memory.
    segment, overlap = 10.0, 0.1
    _, channels, length = wav.shape
    chunk_len = int(msr * segment * (1 + overlap))
    overlap_frames = int(overlap * msr)
    # no fade-out on a chunk that already reaches the end (nothing follows to add the weight back)
    fade = Fade(fade_in_len=0, fade_out_len=0 if chunk_len >= length else overlap_frames,
                fade_shape="linear")
    final = torch.zeros(1, len(model.sources), channels, length)
    start, end = 0, chunk_len
    with torch.inference_mode():
        while start < length - overlap_frames:
            chunk = wav[:, :, start:end]
            out = fade(model(chunk))
            final[:, :, :, start:start + out.shape[-1]] += out
            if start == 0:
                fade.fade_in_len = overlap_frames
                start += chunk_len - overlap_frames
            else:
                start += chunk_len
            end += chunk_len
            if end >= length:
                fade.fade_out_len = 0
    final = final[0] * std + mean
    stems = {src: final[i].numpy().T for i, src in enumerate(model.sources)}
    return stems, msr, "torchaudio:HDEMUCS_HIGH_MUSDB_PLUS"


def separate(mix: np.ndarray, sr: int, method: str = "htdemucs") -> tuple[dict[str, np.ndarray], str]:
    """Split a (samples, 2) mix into the four sources at `sr`; returns (stems, model id).
    The model id names the separator that actually ran, which may be the fallback."""
    attempts = []
    if method in ("htdemucs", "htdemucs_ft"):
        attempts.append(lambda: _demucs(mix, sr, method))
    attempts.append(lambda: _torchaudio(mix, sr))
    errors = []
    for attempt in attempts:
        try:
            stems, msr, model_id = attempt()
            break
        except Exception as e:  # noqa: BLE001 - any loader/network failure falls through
            errors.append(repr(e))
            log(f"stems: separator failed ({e!r}); trying fallback")
    else:
        raise RuntimeError("all separators failed: " + "; ".join(errors))
    if msr != sr:
        stems = {k: resample(v, msr, sr) for k, v in stems.items()}
    n = mix.shape[0]
    stems = {k: v[:n] for k, v in stems.items()}
    return stems, model_id


def run(ctx: Context) -> None:
    import torch

    torch.set_num_threads(ctx.cfg.threads)
    mix, sr = read_wav(ctx.path("audio", "mix.wav"))
    stems, model_id = separate(mix, sr, ctx.cfg.separator)
    missing = set(SOURCES) - set(stems)
    if missing:
        raise RuntimeError(f"separator did not return {sorted(missing)}")

    for name in SOURCES:
        write_wav(ctx.path("stems", f"{name}.wav"), stems[name], sr)

    total = sum(stems[s] for s in SOURCES)
    resid = mix - total
    rms = lambda a: float(np.sqrt(np.mean(np.square(a, dtype=np.float64))) + 1e-12)  # noqa: E731
    wanted = "torchaudio" if ctx.cfg.separator == "torchaudio" else f"demucs:{ctx.cfg.separator}"
    ctx.save("stems", {
        "model": model_id,
        "fallback": None if model_id.startswith(wanted) else f"{ctx.cfg.separator} unavailable, used {model_id}",
        "sources": list(SOURCES),
        "sr": sr,
        "residual_db": round(20 * np.log10(rms(resid) / rms(mix)), 2),
        "peak": {s: round(float(np.abs(stems[s]).max()), 3) for s in SOURCES},
    })
