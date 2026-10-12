"""analysis.json (everything, machine-readable) and digest.md (what an AI reads to 'listen')."""

from __future__ import annotations

import json
import time

import numpy as np

from . import __version__
from .io import dump_json, mmss
from .pipeline import Context

STEMS = ("vocals", "drums", "bass", "other")
STEM_LABEL = {"vocals": "voice", "drums": "drums", "bass": "bass", "other": "other"}


def build_analysis(ctx: Context) -> dict:
    dec = ctx.load("decode")
    stems = ctx.load("stems")
    loud = ctx.load("loudness")
    rhythm = ctx.load("rhythm")
    notes = ctx.load("notes")
    tonal = ctx.load("tonal")
    lyrics = ctx.load("lyrics")
    structure = ctx.load("structure")
    timings = {}
    for name in ("decode", "stems", "loudness", "rhythm", "notes", "tonal", "lyrics", "structure"):
        p = ctx.path("stages", f"{name}.done.json")
        if p.exists():
            timings[name] = json.loads(p.read_text())["elapsed_s"]
    return {
        "schema": "audiotool.analysis/1",
        "meta": {
            "title": dec["title"], "artist": dec["artist"], "album": dec["album"], "date": dec["date"],
            "duration_s": dec["duration_s"], "sr": dec["sr"], "source_sha256": dec["source_sha256"],
            "source_name": dec["source_name"], "local_audio": dec["local_audio"],
            "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "version": __version__,
            "models": {"separation": stems["model"], "beats": rhythm["source"], "notes": notes["model"],
                       "asr": lyrics["model"]},
            "separation_residual_db": stems["residual_db"],
            "timings_s": timings,
        },
        "frame_rate": loud["frame_rate"],
        "loudness": {k: loud[k] for k in ("integrated_lufs", "lra_lu", "peak_dbfs", "mix_db",
                                          "momentary_lufs_10hz", "momentary_t0", "activity_threshold_db")},
        "stems": {s: loud["stems"][s] for s in STEMS},
        "rhythm": {k: rhythm[k] for k in ("source", "tempo_bpm", "tempo_stability", "meter", "beats",
                                          "downbeats")},
        "tonal": {k: tonal[k] for k in ("key", "key_conf", "key_candidates", "keys", "chord_cols", "chords",
                                         "chord_usage_s")},
        "notes": {"cols": notes["cols"], **{s: notes[s] for s in ("vocals", "bass", "other")},
                  "summary": notes["summary"]},
        "lyrics": {k: lyrics[k] for k in ("model", "language", "lang_prob", "p_low", "n_words", "n_low",
                                          "word_cols", "lines")},
        "sections": structure["sections"],
    }


# ---------------------------------------------------------------- digest.md

SPARK = "0123456789"


def energy_strip(mix_db: list[float], fr: int, step_s: float, floor_pct: float = 5) -> str:
    db = np.asarray(mix_db, dtype=float)
    per = max(1, int(round(step_s * fr)))
    n = int(np.ceil(len(db) / per))
    vals = np.array([10 * np.log10(np.mean(10 ** (db[i * per:(i + 1) * per] / 10)) + 1e-12) for i in range(n)])
    lo, hi = np.percentile(vals, floor_pct), vals.max()
    q = np.clip((vals - lo) / max(hi - lo, 1e-6), 0, 1)
    return "".join(SPARK[int(round(v * 9))] for v in q)


def activity_strip(active: list[list[float]], duration: float, step_s: float) -> str:
    n = int(np.ceil(duration / step_s))
    out = []
    for i in range(n):
        a, b = i * step_s, min((i + 1) * step_s, duration)
        cov = sum(max(0.0, min(b, y) - max(a, x)) for x, y in active) / max(b - a, 1e-6)
        out.append("#" if cov >= 0.5 else ("+" if cov > 0.1 else "."))
    return "".join(out)


def stem_events(stems: dict, min_gap: float = 4.0) -> list[tuple[float, str]]:
    """Entries and exits, ignoring dropouts shorter than `min_gap` seconds."""
    events = []
    for s in STEMS:
        merged: list[list[float]] = []
        for a, b in stems[s]["active"]:
            if merged and a - merged[-1][1] < min_gap:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        for a, b in merged:
            events.append((a, f"{STEM_LABEL[s]} in"))
            events.append((b, f"{STEM_LABEL[s]} out"))
    return sorted(events)


def _ruler(duration: float, step_s: float, every_s: int = 30) -> str:
    n = int(np.ceil(duration / step_s))
    chars = [" "] * n
    for t in range(0, int(duration) + 1, every_s):
        label = mmss(t)
        i = int(t / step_s)
        for j, ch in enumerate(label):
            if i + j < n:
                chars[i + j] = ch
    return "".join(chars).rstrip()


def _lyric_text(line: dict, p_low: float) -> str:
    words = []
    for _, _, w, p in line["words"]:
        words.append(f"[{w}?]" if p < p_low else w)
    return " ".join(words)


def _pct(x: float) -> str:
    return f"{int(round(x * 100))}%"


def render_digest(a: dict, step_s: float = 2.0) -> str:
    m = a["meta"]
    dur = m["duration_s"]
    L = a["loudness"]
    R = a["rhythm"]
    T = a["tonal"]
    ly = a["lyrics"]
    secs = a["sections"]
    fr = a["frame_rate"]
    out: list[str] = []
    w = out.append

    w(f"# {m['title']} - {m['artist']} ({mmss(dur)})")
    w("")
    w("Audio digest for an AI listener, produced by audiotool. Everything here is measured from the "
      "audio; lyrics are machine-transcribed from the isolated vocal and may contain errors.")
    w("")
    w(f"- Tempo: {R['tempo_bpm']} BPM, meter {R['meter']}, tempo stability {R['tempo_stability']} "
      f"(1.0 = metronomic) [{R['source']}]")
    if len(T["keys"]) > 1:
        w("- Key changes: " + " -> ".join(f"{k} ({mmss(k0)}-{mmss(k1)})" for k0, k1, k, _ in T["keys"])
          + f". Whole-song estimate {T['key']} is a blend.")
    else:
        w(f"- Key estimate: {T['key']} (margin over runner-up {T['key_conf']}; candidates: "
          + ", ".join(f"{k} {r}" for k, r in T["key_candidates"]) + ")")
    w(f"- Most-used chords (seconds): " + ", ".join(f"{c} {s}" for c, s in T["chord_usage_s"]))
    w(f"- Loudness: integrated {L['integrated_lufs']} LUFS, loudness range {L['lra_lu']} LU, "
      f"peak {L['peak_dbfs']} dBFS")
    shares = ", ".join(f"{STEM_LABEL[s]} {_pct(a['stems'][s]['share'])}" for s in STEMS)
    w(f"- Energy share by stem: {shares}")
    w(f"- Lyrics: {ly['n_words']} words, language {ly['language']} (p={ly['lang_prob']}), "
      f"{ly['n_low']} low-confidence words shown as [word?] [{ly['model']}]")
    w("")

    w(f"## Timeline (1 character = {step_s:g} s)")
    w("")
    w("Energy row: 0 = quietest, 9 = loudest. Stem rows: # playing, + partly, . silent.")
    w("")
    w("```")
    pad = 7
    w(" " * pad + _ruler(dur, step_s))
    w("energy ".ljust(pad) + energy_strip(L["mix_db"], fr, step_s))
    for s in STEMS:
        w(STEM_LABEL[s].ljust(pad) + activity_strip(a["stems"][s]["active"], dur, step_s))
    sec_row = [" "] * int(np.ceil(dur / step_s))
    for s in secs:
        i = int(s["t0"] / step_s)
        for j, ch in enumerate("|" + s["label"]):
            if i + j < len(sec_row):
                sec_row[i + j] = ch
    w("section".ljust(pad) + "".join(sec_row))
    w("```")
    w("")

    w("## Sections")
    w("")
    w("Letters mark sections that sound alike (A1 and A2); a transposed repeat gets a new letter, so "
      "compare the Roman-numeral progressions. Stem % = share of the section where that stem is playing. "
      "dLUFS = loudness vs the whole song.")
    w("")
    w("| sec | time | tags | key | dLUFS | voice | drums | bass | other | voice range | chords | in key |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for s in secs:
        vr = s["notes"]["vocals"]
        vrange = f"{vr['lo']}-{vr['hi']}" if vr.get("n") else "-"
        chords = " ".join(s["chords"][:8]) + (" ..." if len(s["chords"]) > 8 else "")
        roman = " ".join(s.get("roman", [])[:8]) + (" ..." if len(s.get("roman", [])) > 8 else "")
        w(f"| {s['label']} | {mmss(s['t0'])}-{mmss(s['t1'])} | {s.get('hint') or ''} | {s.get('key') or '-'} | "
          f"{s['d_lufs'] if s['d_lufs'] is not None else '-'} | "
          + " | ".join(_pct(s["stems"][k]) for k in STEMS)
          + f" | {vrange} | {chords} | {roman} |")
    w("")

    w("## Arrangement events")
    w("")
    ev = stem_events(a["stems"])
    w("; ".join(f"{mmss(t)} {e}" for t, e in ev) or "none")
    w("")

    w("## Lyrics by section")
    w("")
    flagged_any = False
    lines_by_id = {ln["id"]: ln for ln in ly["lines"]}
    for s in secs:
        w(f"### {s['label']} {mmss(s['t0'])}-{mmss(s['t1'])}" + (f" ({s['hint']})" if s.get("hint") else ""))
        if not s["lines"]:
            w("(no vocals transcribed)")
        for lid in s["lines"]:
            ln = lines_by_id[lid]
            flags = f"  <{', '.join(ln['flags'])}>" if ln["flags"] else ""
            flagged_any |= bool(ln["flags"])
            w(f"- [{mmss(ln['t0'])}] {_lyric_text(ln, ly['p_low'])}{flags}")
        w("")
    if flagged_any:
        w("Line flags: outside_vocals = text where the vocal stem is quiet (possible hallucination); "
          "low_logprob / mostly_unsure = shaky transcription; repeat_run = 3+ identical lines in a row "
          "(a real hook or a decoding loop).")
        w("")

    w("## Melody and register")
    w("")
    ns = a["notes"]["summary"]
    for src, label in (("vocals", "voice"), ("bass", "bass"), ("other", "other")):
        s = ns.get(src, {})
        if s.get("n"):
            w(f"- {label}: {s['n']} notes, typical range {s['lo']}-{s['hi']}, median {s['median']}")
    vocal_secs = [s for s in secs if s["notes"]["vocals"].get("n")]
    if vocal_secs:
        w("- voice range per section: " + "; ".join(
            f"{s['label']} {s['notes']['vocals']['lo']}-{s['notes']['vocals']['hi']} "
            f"({s['notes']['vocals']['per_s']} notes/s)" for s in vocal_secs))
    w("")
    w(f"Models: separation {m['models']['separation']} (residual {m['separation_residual_db']} dB), "
      f"beats {m['models']['beats']}, notes {m['models']['notes']}, lyrics {m['models']['asr']}.")
    return "\n".join(out) + "\n"


def run(ctx: Context) -> None:
    a = build_analysis(ctx)
    dump_json(ctx.path("analysis.json"), a)
    text = render_digest(a)
    if len(text) / 3.5 > 6000:   # rough token estimate: coarsen the timeline first
        text = render_digest(a, step_s=4.0)
    ctx.path("digest.md").write_text(text, encoding="utf-8")
