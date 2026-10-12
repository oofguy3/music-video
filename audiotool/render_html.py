"""index.html (local player, full lyrics, plays audio/song.* next to it) and artifact.html
(shareable page body: no audio inside, lyric text limited by --artifact-lyrics)."""

from __future__ import annotations

import html
import re
from importlib import resources
from pathlib import Path

import numpy as np

from .io import dumps, load_json
from .pipeline import Context

STEMS = ("vocals", "drums", "bass", "other")
SRC_INDEX = {"vocals": 0, "bass": 1, "other": 2}


def clean_title(title: str, artist: str = "") -> str:
    """'Numb - Roomie (Original Song)' -> 'Numb'; 'Roomie - Numb' (artist first) -> 'Numb'.
    Only trailing bracketed tags are removed, and ' - ' is split only when one side names the artist."""
    t = title.strip()
    while True:
        stripped = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]\s*$", "", t)
        if stripped == t or not stripped:
            break
        t = stripped
    if " - " in t:
        left, right = (part.strip() for part in t.split(" - ", 1))
        names = {n for n in (artist.lower(), artist.lower().removesuffix("official").strip()) if n}
        if left.lower() in names:
            return right or title
        if right.lower() in names:
            return left or title
    return t or title


# ---------------------------------------------------------------- tiny, escaping markdown

def _inline(text: str) -> str:
    s = html.escape(text, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?!\w)", r"<em>\1</em>", s)
    s = re.sub(r"(?<![_\w])_([^_\n]+)_(?!\w)", r"<em>\1</em>", s)
    return s


def split_read(md: str) -> tuple[str | None, str]:
    """(panel summary, rest of the read) from a song-read document."""
    m = re.search(r"<!--\s*panel\s*-->(.*?)<!--\s*/panel\s*-->", md, re.S)
    if not m:
        return None, md
    return " ".join(m.group(1).split()), md[:m.start()] + md[m.end():]


def md_to_html(md: str, drop_title: bool = True) -> str:
    """Headings, paragraphs, bullet lists and quotes; everything else is escaped text."""
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S)
    out: list[str] = []
    para: list[str] = []
    items: list[str] = []
    quote: list[str] = []

    def flush() -> None:
        if para:
            out.append("<p>" + _inline(" ".join(para)) + "</p>")
            para.clear()
        if items:
            out.append("<ul>" + "".join(f"<li>{_inline(i)}</li>" for i in items) + "</ul>")
            items.clear()
        if quote:
            out.append("<blockquote>" + _inline(" ".join(quote)) + "</blockquote>")
            quote.clear()

    for raw in md.splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush()
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush()
            if len(m.group(1)) == 1 and drop_title:
                continue  # the card already has its own heading
            out.append(f"<h3>{_inline(m.group(2))}</h3>")
            continue
        m = re.match(r"^\s*[-*]\s+(.*)$", line)
        if m:
            if para or quote:
                flush()
            items.append(m.group(1))
            continue
        m = re.match(r"^>\s?(.*)$", line)
        if m:
            if para or items:
                flush()
            quote.append(m.group(1))
            continue
        if items and raw.startswith("  "):
            items[-1] += " " + line.strip()
            continue
        if items or quote:
            flush()
        para.append(line.strip())
    flush()
    return "\n".join(out)


# ---------------------------------------------------------------- view model

def _lyrics(a: dict, mode: str) -> dict:
    lines = []
    for ln in a["lyrics"]["lines"]:
        item = {"t0": ln["t0"], "t1": ln["t1"], "flags": ln["flags"]}
        if mode in ("full", "lines"):
            item["text"] = ln["text"]
        if mode == "full":
            item["words"] = ln["words"]
        lines.append(item)
    if mode == "none":
        lines = []
    return {"mode": mode, "p_low": a["lyrics"]["p_low"], "lines": lines}


def view_model(a: dict, mode: str, lyrics_mode: str, read_md: str | None) -> dict:
    m = a["meta"]
    mix_db = np.asarray(a["loudness"]["mix_db"], dtype=float)
    thr = a["loudness"]["activity_threshold_db"]
    stems = {}
    for s in STEMS:
        db = np.asarray(a["stems"][s]["db"], dtype=float)
        floor = thr - 14
        stems[s] = {"db": a["stems"][s]["db"], "active": a["stems"][s]["active"],
                    "norm": [round(floor, 1), round(max(float(np.percentile(db, 99.5)), floor + 6), 1)]}
    notes = []
    for src, idx in SRC_INDEX.items():
        for t0, t1, p, v in a["notes"][src]:
            notes.append([t0, t1, p, v, idx])
    notes.sort(key=lambda n: n[0])
    pitches = np.array([n[2] for n in notes]) if notes else np.array([48, 72])
    sections = [{k: s.get(k) for k in ("label", "hint", "key", "t0", "t1", "d_lufs", "stems", "chords", "roman")}
                for s in a["sections"]]
    keys = a["tonal"].get("keys") or []
    key_text = " → ".join(k for _, _, k, _ in keys) if keys else a["tonal"]["key"]
    models = m["models"]
    foot = (f"Measured by audiotool: stems {models['separation']}, beats {models['beats']}, "
            f"notes {models['notes']}, lyrics {models['asr']}. Lyrics are machine-transcribed. ")
    if lyrics_mode == "blocks":
        foot += "This page leaves the lyric text out; the lyrics lane shows when each line is sung. "
    elif lyrics_mode == "none":
        foot += "This page leaves the lyrics out. "
    if mode == "artifact":
        foot += "The song itself is not part of this page."
    return {
        "mode": mode,
        "meta": {"title": clean_title(m["title"], m["artist"]), "artist": m["artist"], "duration_s": m["duration_s"]},
        "audio_src": m.get("local_audio") if mode == "local" else None,
        "stats": {"tempo": a["rhythm"]["tempo_bpm"], "meter": a["rhythm"]["meter"],
                  "key": key_text, "lufs": a["loudness"]["integrated_lufs"]},
        "frame_rate": a["frame_rate"],
        "mix_db": a["loudness"]["mix_db"],
        "loud_norm": [round(float(np.percentile(mix_db, 3)), 1), round(float(mix_db.max()), 1)],
        "stems": stems,
        "notes": notes,
        "note_range": [float(np.percentile(pitches, 1)) - 1, float(np.percentile(pitches, 99)) + 1],
        "beats": a["rhythm"]["beats"],
        "downbeats": a["rhythm"]["downbeats"],
        "chords": a["tonal"]["chords"],
        "sections": sections,
        "lyrics": _lyrics(a, lyrics_mode),
        **_read(read_md),
        "footnote": foot.strip(),
    }


def _read(read_md: str | None) -> dict:
    if not read_md:
        return {"read_lead": None, "read_html": None}
    lead, rest = split_read(read_md)
    body = md_to_html(rest).strip()
    return {"read_lead": lead, "read_html": body or None}


def _template() -> tuple[str, str]:
    text = resources.files("audiotool").joinpath("templates/player.html").read_text(encoding="utf-8")
    head, body = text.split("<!-- BODY -->", 1)
    return head, body


def page(a: dict, mode: str, lyrics_mode: str, read_md: str | None) -> str:
    vm = view_model(a, mode, lyrics_mode, read_md)
    # "<" only ever appears inside JSON strings, where \u003c is a valid escape; this keeps
    # "</script" and "<!--" out of the inline script whatever the lyrics or titles contain.
    data = dumps(vm).replace("<", "\\u003c")
    title = f"{vm['meta']['title']}, Track by Track"
    head, body = _template()
    head = head.replace("__TITLE__", html.escape(title))
    body = body.replace("__DATA__", data)
    if mode == "artifact":
        # The artifact host supplies the document skeleton.
        return head.strip() + "\n" + body.strip() + "\n"
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
            + head.strip() + "\n</head>\n<body>\n" + body.strip() + "\n</body>\n</html>\n")


def render(a: dict, out_dir: Path, read_path: str | None, artifact_lyrics: str) -> tuple[Path, Path]:
    read_md = Path(read_path).read_text(encoding="utf-8") if read_path and Path(read_path).exists() else None
    local = out_dir / "index.html"
    local.write_text(page(a, "local", "full", read_md), encoding="utf-8")
    art = out_dir / "artifact.html"
    art.write_text(page(a, "artifact", artifact_lyrics, read_md), encoding="utf-8")
    return local, art


def run(ctx: Context) -> None:
    a = load_json(ctx.path("analysis.json"))
    render(a, ctx.out, ctx.cfg.read, ctx.cfg.artifact_lyrics)
