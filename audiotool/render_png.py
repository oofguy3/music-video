"""tracks.png: every track on one dark grid, in the style of the 'my audio tool' screenshot."""

from __future__ import annotations

import re
import textwrap
from pathlib import Path

import numpy as np

from .io import load_json, mmss
from .pipeline import Context

W, H = 2400, 1350          # pixels (16 x 9 in at 150 dpi)
X0, X1 = 560, 1880         # data area
BG = "#141414"
GRID = "#232323"
INK = "#f2f2f2"
MUTED = "#8a8a8a"
ORANGE = "#f08a5d"
ORANGE_FILL = "#b4553a"
LYRIC = "#9b968e"
PANEL = "#1b1b1b"
PANEL_EDGE = "#3a3a3a"
WIRE = "#c99a94"

# row: (label, y_top, y_bottom) in pixels
ROWS = {
    "loud": ("loud and quiet", 235, 340),
    "notes": ("notes", 405, 505),
    "beats": ("beats", 545, 590),
    "vocals": ("voice", 700, 765),
    "drums": ("drums", 805, 870),
    "bass": ("bass", 910, 975),
    "other": ("other", 1015, 1080),
    "lyrics": ("lyrics", 1125, 1155),
}
STEMS = ("vocals", "drums", "bass", "other")


def _tx(t: np.ndarray | float, dur: float):
    return X0 + (np.asarray(t, dtype=float) / dur) * (X1 - X0)


def _pool(values: np.ndarray, per: int, how=np.max) -> np.ndarray:
    n = int(np.ceil(len(values) / per))
    return np.array([how(values[i * per:(i + 1) * per]) for i in range(n)])


def panel_text(read_path: str | None) -> str | None:
    """The short summary shown in the panel: the text between <!-- panel --> markers, or the
    first paragraph of the song read."""
    if not read_path or not Path(read_path).exists():
        return None
    md = Path(read_path).read_text(encoding="utf-8")
    m = re.search(r"<!--\s*panel\s*-->(.*?)<!--\s*/panel\s*-->", md, re.S)
    if m:
        text = m.group(1)
    else:
        paras = [p for p in re.split(r"\n\s*\n", md) if p.strip() and not p.lstrip().startswith("#")]
        text = paras[0] if paras else ""
    text = re.sub(r"(?m)^\s*(?:[>#]+|[-*+]\s)\s*", "", text)            # quote/heading/list markers
    text = re.sub(r"(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1", r"\2", text)       # emphasis and code spans
    return " ".join(text.split()) or None


def fit_text(fig, ax, text: str, x: float, y: float, right: float, bottom: float,
             sizes=(12.5, 11.5, 10.5, 9.5)) -> None:
    """Wrap `text` into the box (x..right, y..bottom), shrinking the font until it fits; if even the
    smallest size overflows, cut whole lines and end with an ellipsis."""
    renderer = fig.canvas.get_renderer()
    for size in sizes:
        for width in range(40, 14, -1):
            lines = textwrap.wrap(text, width=width)
            t = ax.text(x, y, "\n".join(lines), color="#d9d9d9", fontsize=size, va="top", linespacing=1.45,
                        zorder=5, parse_math=False, family="DejaVu Sans")
            bb = t.get_window_extent(renderer)
            if bb.x1 <= right:   # widest wrap that fits horizontally at this size
                if bb.y0 >= H - bottom:   # display y grows upwards; data y grows downwards
                    return
                t.remove()
                break
            t.remove()
    # smallest size still too tall: keep the lines that fit
    lines = textwrap.wrap(text, width=width)
    line_h = sizes[-1] * 150 / 72 * 1.45
    keep = max(1, int((bottom - y) // line_h))
    if keep < len(lines):
        lines = lines[:keep]
        lines[-1] = lines[-1].rstrip(" .,;") + " …"
    ax.text(x, y, "\n".join(lines), color="#d9d9d9", fontsize=sizes[-1], va="top", linespacing=1.45, zorder=5,
            parse_math=False, family="DejaVu Sans")


def render(a: dict, out: Path, read_path: str | None = None) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from matplotlib.patches import Circle, FancyBboxPatch

    dur = float(a["meta"]["duration_s"])
    fr = a["frame_rate"]
    fig = plt.figure(figsize=(W / 150, H / 150), dpi=150, facecolor=BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.axis("off")
    sans = {"family": "DejaVu Sans"}
    mono = {"family": "DejaVu Sans Mono"}

    # background grid
    step = 48
    for x in range(0, W + 1, step):
        ax.plot([x, x], [0, H], color=GRID, lw=0.8, zorder=0)
    for y in range(0, H + 1, step):
        ax.plot([0, W], [y, y], color=GRID, lw=0.8, zorder=0)
    ax.plot([X0 - 30, X0 - 30], [0, H], color="#2c2c2c", lw=1.2, zorder=0)

    # header tags
    def tag(x, y, text):
        t = ax.text(x, y, text, color=INK, fontsize=17, va="center", ha="left", zorder=5, parse_math=False,
                    **mono)
        t.set_bbox(dict(boxstyle="round,pad=0.55,rounding_size=0.4", fc=PANEL, ec="#4a4a4a", lw=1.2))
        return t

    m = a["meta"]
    from .render_html import clean_title

    name = clean_title(m["title"], m["artist"])
    first = tag(X0 + 30, 105, (f"{name} · {m['artist']}" if m["artist"] else name)[:44])
    # figure pixels == data units here, so the drawn box's extent gives the next tag's x
    fig.canvas.draw()
    box = first.get_bbox_patch().get_window_extent(fig.canvas.get_renderer())
    tag(box.x1 + 40, 105, "my audio tool")
    ax.text(14, 160, "song", color=MUTED, fontsize=14, va="center", **mono)

    # section bands
    for s in a["sections"]:
        x = float(_tx(s["t0"], dur))
        if s["t0"] > 0.5:
            ax.plot([x, x], [205, ROWS["lyrics"][2] + 10], color="#2f2f2f", lw=1.0, zorder=1)
        ax.text(x + 6, 212, s["label"], color=MUTED, fontsize=10, va="center", parse_math=False, **mono)

    def label(key):
        name, y0, y1 = ROWS[key]
        ax.text(X0 - 50, (y0 + y1) / 2 + (8 if key == "loud" else 0), name, color=INK,
                fontsize=24 if key != "lyrics" else 22, ha="right", va="center", **sans)

    # loud and quiet
    _, y0, y1 = ROWS["loud"]
    db = np.asarray(a["loudness"]["mix_db"], dtype=float)
    per = max(1, fr // 5)
    pooled = _pool(db, per)
    lo, hi = np.percentile(pooled, 3), pooled.max()
    v = np.clip((pooled - lo) / max(hi - lo, 1e-6), 0, 1)
    xs = _tx((np.arange(len(v)) + 0.5) * per / fr, dur)
    ys = y1 - v * (y1 - y0)
    ax.fill_between(xs, ys, y1, color=ORANGE_FILL, alpha=0.75, lw=0, zorder=2)
    ax.plot(xs, ys, color=ORANGE, lw=1.6, zorder=3)
    label("loud")

    # notes (piano roll)
    _, y0, y1 = ROWS["notes"]
    segs, cols = [], []
    allnotes = [(src, n) for src in ("bass", "other", "vocals") for n in a["notes"][src]]
    if allnotes:
        pitches = np.array([n[2] for _, n in allnotes])
        plo, phi = np.percentile(pitches, 1) - 1, np.percentile(pitches, 99) + 1
        for src, (t0, t1, p, vel) in allnotes:
            if not plo <= p <= phi:
                continue
            y = y1 - (p - plo) / (phi - plo) * (y1 - y0)
            segs.append([(float(_tx(t0, dur)), y), (float(_tx(max(t1, t0 + 0.08), dur)), y)])
            alpha = 0.95 if src == "vocals" else 0.55
            cols.append((1, 1, 1, alpha * (0.55 + 0.45 * vel)))
        ax.add_collection(LineCollection(segs, colors=cols, linewidths=2.2, zorder=3, capstyle="butt"))
    label("notes")

    # beats
    _, y0, y1 = ROWS["beats"]
    beats = np.asarray(a["rhythm"]["beats"], dtype=float)
    downs = set(np.round(a["rhythm"]["downbeats"], 2))
    for b in beats:
        x = float(_tx(b, dur))
        top = y0 if round(b, 2) in downs else y0 + (y1 - y0) * 0.45
        ax.plot([x, x], [top, y1], color=INK, lw=1.0, zorder=3)
    label("beats")

    # stems
    for key in STEMS:
        _, y0, y1 = ROWS[key]
        sdb = np.asarray(a["stems"][key]["db"], dtype=float)
        floor = a["loudness"]["activity_threshold_db"] - 14
        top = max(np.percentile(sdb, 99.5), floor + 6)
        pooled = _pool(sdb, max(1, fr // 4))
        v = np.clip((pooled - floor) / (top - floor), 0, 1)
        xs = _tx((np.arange(len(v)) + 0.5) * max(1, fr // 4) / fr, dur)
        ax.plot(xs, y1 - v * (y1 - y0), color=INK, lw=1.3, zorder=3, solid_joinstyle="round")
        label(key)

    # lyrics blocks
    _, y0, y1 = ROWS["lyrics"]
    for ln in a["lyrics"]["lines"]:
        xa, xb = float(_tx(ln["t0"], dur)), float(_tx(ln["t1"], dur))
        if xb - xa < 3:
            xb = xa + 3
        ax.add_patch(FancyBboxPatch((xa + 1, y0), xb - xa - 2, y1 - y0,
                                    boxstyle="round,pad=0,rounding_size=3", fc=LYRIC, ec="none",
                                    alpha=0.45 if ln["flags"] else 0.9, zorder=3))
    label("lyrics")

    # time axis
    for t in range(0, int(dur) + 1, 30):
        x = float(_tx(t, dur))
        ax.plot([x, x], [1170, 1180], color=MUTED, lw=1)
        ax.text(x, 1188, mmss(t), color=MUTED, fontsize=12, ha="center", va="top", **mono)
    keys = a["tonal"].get("keys") or []
    key_text = " → ".join(k for _, _, k, _ in keys) if keys else a["tonal"]["key"]
    sub = (f"{a['rhythm']['tempo_bpm']} BPM · {a['rhythm']['meter']} · {key_text} · "
           f"{a['loudness']['integrated_lufs']} LUFS")
    ax.text(X0, 1265, sub, color=MUTED, fontsize=13, ha="left", **mono)

    # right panel + AI node
    px0, py0, px1, py1 = 1965, 355, W + 20, 1045
    ax.add_patch(FancyBboxPatch((px0, py0), px1 - px0, py1 - py0, boxstyle="round,pad=0,rounding_size=10",
                                fc=PANEL, ec=PANEL_EDGE, lw=1.4, zorder=4))
    ax.text(px0 + 36, py0 + 40, "what the song\nis about", color=INK, fontsize=22, va="top",
            linespacing=1.25, zorder=5, **sans)
    summary = panel_text(read_path)
    if summary:
        fit_text(fig, ax, summary, x=px0 + 36, y=py0 + 180, right=W - 28, bottom=py1 - 24)
    else:
        for i, frac in enumerate((1, 1, 1, 1, 1, 0.55)):
            yy = py0 + 190 + i * 44
            ax.plot([px0 + 36, px0 + 36 + (W - 28 - px0 - 36) * frac], [yy, yy], color="#4a4a4a", lw=7,
                    solid_capstyle="butt", zorder=5)

    cx, cy, r = 2290, 1210, 118
    ax.add_patch(Circle((cx, cy), r, fc=BG, ec=INK, lw=1.6, zorder=6))
    ax.text(cx, cy, "AI", color=INK, fontsize=30, ha="center", va="center", zorder=7,
            fontweight="bold", **sans)
    for key in ("loud", "notes", "beats", "vocals", "drums", "bass", "other", "lyrics"):
        _, y0, y1 = ROWS[key]
        ym = (y0 + y1) / 2
        ang = np.deg2rad(200 - 12 * list(ROWS).index(key))
        ex, ey = cx + r * np.cos(ang) * 0.98, cy - r * np.sin(ang) * 0.98
        ax.plot([X1 + 15, X1 + 75, ex], [ym, ym, ey], color=WIRE, lw=0.9, alpha=0.7, zorder=2)
    for i in range(5):
        ax.plot([px0 + 120 + i * 18, cx - 40 + i * 12], [py1, cy - r * 0.9], color=WIRE, lw=0.9,
                alpha=0.7, zorder=2)

    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=150, facecolor=BG)
    plt.close(fig)
    return out


def run(ctx: Context) -> None:
    a = load_json(ctx.path("analysis.json"))
    render(a, ctx.path("tracks.png"), ctx.cfg.read)
