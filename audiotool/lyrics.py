"""Lyrics: faster-whisper on the isolated vocal stem, with word timestamps and confidence flags."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from .io import intervals_overlap, load_mono
from .pipeline import Context, log

ASR_SR = 16000
REPOS = {
    "turbo": ["dropbox-dash/faster-whisper-large-v3-turbo", "deepdml/faster-whisper-large-v3-turbo-ct2",
              "Systran/faster-whisper-small"],
    "large-v3": ["Systran/faster-whisper-large-v3"],
    "medium": ["Systran/faster-whisper-medium"],
    "small": ["Systran/faster-whisper-small"],
}
FILES = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]
P_LOW = 0.5            # words below this probability are marked [word?]
LINE_GAP = 0.7         # a pause this long between words starts a new line
MAX_LINE_WORDS = 12


def ensure_model(name: str) -> tuple[str, str]:
    """Download (or reuse) a CTranslate2 Whisper model; returns (local dir, repo id)."""
    from huggingface_hub import snapshot_download

    errors = []
    for repo in REPOS.get(name, [name]):
        try:
            return snapshot_download(repo, allow_patterns=FILES), repo
        except Exception as e:  # noqa: BLE001
            errors.append(f"{repo}: {e!r}")
            log(f"lyrics: could not fetch {repo} ({e!r})")
    raise RuntimeError("no Whisper model available: " + "; ".join(errors))


def prep_vocals(path: Path, active: list[list[float]], pad: float = 0.5,
                mute_db: float = -40.0) -> np.ndarray:
    """16 kHz mono, peak -1 dBFS, with bleed outside vocal activity pushed down by `mute_db`."""
    y, sr = load_mono(path, ASR_SR)
    gain = np.full(len(y), 10 ** (mute_db / 20), dtype=np.float32)
    for a, b in active:
        gain[max(0, int((a - pad) * sr)): int((b + pad) * sr)] = 1.0
    y = y * gain
    # normalise on the sung parts only, so muted bleed is never boosted back up
    sung = np.abs(y[gain == 1.0])
    peak = sung.max() if sung.size else 0.0
    if peak > 0:
        y = y * (10 ** (-1 / 20) / peak)
    return y.astype(np.float32)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9' ]+", "", text.lower()).strip()


def split_lines(words: list[dict]) -> list[list[dict]]:
    """Group words into sung lines: break on long pauses, sentence ends, or overlong runs."""
    lines: list[list[dict]] = []
    for w in words:
        if not lines:
            lines.append([w])
            continue
        prev = lines[-1][-1]
        brk = (w["start"] - prev["end"] > LINE_GAP
               or len(lines[-1]) >= MAX_LINE_WORDS
               or (prev["word"].rstrip().endswith((".", "!", "?")) and len(lines[-1]) >= 3)
               or (w["seg"] != prev["seg"] and w["start"] - prev["end"] > 0.3))
        if brk:
            lines.append([w])
        else:
            lines[-1].append(w)
    return lines


def flag_lines(lines: list[dict], active: list[list[float]]) -> None:
    for ln in lines:
        flags = ln.setdefault("flags", [])
        dur = max(ln["t1"] - ln["t0"], 1e-3)
        if intervals_overlap(ln["t0"], ln["t1"], active) / dur < 0.5:
            flags.append("outside_vocals")   # classic Whisper hallucination signature
        if ln["seg_logprob"] < -1.0:
            flags.append("low_logprob")
        if ln["seg_compression"] > 2.4:
            flags.append("repetitive_decode")
        if ln["seg_no_speech"] > 0.6:
            flags.append("no_speech?")
        low = [w for w in ln["words"] if w[3] < P_LOW]
        if len(low) >= max(2, len(ln["words"]) // 2):
            flags.append("mostly_unsure")
    # three or more identical lines in a row can be a real hook, or a decoding loop
    i = 0
    while i < len(lines):
        j = i
        while j + 1 < len(lines) and _norm(lines[j + 1]["text"]) == _norm(lines[i]["text"]):
            j += 1
        if j - i >= 2:
            for k in range(i, j + 1):
                lines[k]["flags"].append("repeat_run")
        i = j + 1


def transcribe(audio: np.ndarray, model_dir: str, cfg) -> tuple[list[dict], dict]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=cfg.threads)
    kwargs = dict(
        language=cfg.language, beam_size=5, word_timestamps=True,
        condition_on_previous_text=False, temperature=(0.0, 0.2, 0.4, 0.6),
        compression_ratio_threshold=2.4, log_prob_threshold=-1.0, no_speech_threshold=0.6,
        hallucination_silence_threshold=2.0,
    )
    if cfg.vad:
        kwargs.update(vad_filter=True, vad_parameters={"threshold": 0.35, "min_silence_duration_ms": 700,
                                                       "speech_pad_ms": 300})
    segments, info = model.transcribe(audio, **kwargs)
    words = []
    for si, seg in enumerate(segments):
        for w in seg.words or []:
            if not w.word.strip():
                continue
            words.append({"start": float(w.start), "end": float(w.end), "word": w.word,
                          "p": float(w.probability), "seg": si, "seg_logprob": float(seg.avg_logprob),
                          "seg_compression": float(seg.compression_ratio),
                          "seg_no_speech": float(seg.no_speech_prob)})
    meta = {"language": info.language, "lang_prob": round(float(info.language_probability), 3)}
    return words, meta


def build_lines(words: list[dict]) -> list[dict]:
    out = []
    for group in split_lines(words):
        out.append({
            "t0": round(group[0]["start"], 2),
            "t1": round(group[-1]["end"], 2),
            "text": "".join(w["word"] for w in group).strip(),
            "words": [[round(w["start"], 2), round(w["end"], 2), w["word"].strip(), round(w["p"], 2)]
                      for w in group],
            "seg_logprob": min(w["seg_logprob"] for w in group),
            "seg_compression": max(w["seg_compression"] for w in group),
            "seg_no_speech": max(w["seg_no_speech"] for w in group),
        })
    return out


def run(ctx: Context) -> None:
    active = ctx.load("loudness")["stems"]["vocals"]["active"]
    if not active:  # instrumental: nothing to transcribe, and Whisper would hallucinate on bleed
        ctx.save("lyrics", {"model": None, "vad": ctx.cfg.vad, "language": None, "lang_prob": None,
                            "p_low": P_LOW, "n_words": 0, "n_low": 0, "word_cols": ["t0", "t1", "word", "p"],
                            "lines": [], "note": "no vocal activity detected"})
        return
    audio = prep_vocals(ctx.path("stems", "vocals.wav"), active)
    model_dir, repo = ensure_model(ctx.cfg.whisper)
    words, meta = transcribe(audio, model_dir, ctx.cfg)
    lines = build_lines(words)
    flag_lines(lines, active)
    for i, ln in enumerate(lines):
        ln["id"] = i
        for k in ("seg_logprob", "seg_compression", "seg_no_speech"):
            ln[k] = round(ln[k], 2)
    n_words = sum(len(ln["words"]) for ln in lines)
    n_low = sum(1 for ln in lines for w in ln["words"] if w[3] < P_LOW)
    ctx.save("lyrics", {
        "model": repo,
        "vad": ctx.cfg.vad,
        **meta,
        "p_low": P_LOW,
        "n_words": n_words,
        "n_low": n_low,
        "word_cols": ["t0", "t1", "word", "p"],
        "lines": lines,
    })
