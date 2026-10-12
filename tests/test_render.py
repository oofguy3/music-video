import json
import re

from audiotool.render_html import clean_title, md_to_html, page
from audiotool.render_png import panel_text, render


def _data(html_text: str) -> dict:
    m = re.search(r'<script type="application/json" id="data">(.*?)</script>', html_text, re.S)
    return json.loads(m.group(1).replace("<\\/", "</"))


def test_png_renders(analysis, tmp_path):
    out = render(analysis, tmp_path / "tracks.png")
    assert out.stat().st_size > 20_000
    from PIL import Image
    assert Image.open(out).size == (2400, 1350)


def test_local_page_has_audio_and_full_lyrics(analysis):
    html_text = page(analysis, "local", "full", None)
    assert html_text.startswith("<!doctype html>")
    d = _data(html_text)
    assert d["audio_src"] == "audio/song.mp3"
    assert d["lyrics"]["lines"][0]["text"] == "hello quiet world"
    assert "<title>Test Tone, Track by Track</title>" in html_text


def test_artifact_page_has_no_audio_or_lyric_text(analysis):
    html_text = page(analysis, "artifact", "blocks", None)
    assert "<!doctype" not in html_text.lower() and "<body" not in html_text
    d = _data(html_text)
    assert d["audio_src"] is None
    assert all(set(ln) == {"t0", "t1", "flags"} for ln in d["lyrics"]["lines"])
    assert "hello quiet world" not in html_text
    assert not re.search(r"<script[^>]+src=", html_text)   # self-contained


def test_inline_json_cannot_close_the_script(analysis):
    analysis["meta"]["title"] = "</script><script>alert(1)</script>"
    html_text = page(analysis, "local", "full", None)
    assert html_text.count("</script>") == 2   # only the page's own two script tags


def test_markdown_is_escaped():
    out = md_to_html("# Title\n\nHello <b>x</b> **bold**\n\n- one\n- two\n\n## Part\n> quote")
    assert "Title" not in out                    # top heading dropped (card has its own)
    assert "&lt;b&gt;" in out and "<strong>bold</strong>" in out
    assert "<ul><li>one</li><li>two</li></ul>" in out
    assert "<h3>Part</h3>" in out and "<blockquote>quote</blockquote>" in out


def test_panel_text(tmp_path):
    p = tmp_path / "read.md"
    p.write_text("# Read\n\nIgnored first.\n\n<!-- panel -->\nShort **summary** here.\n<!-- /panel -->\n")
    assert panel_text(str(p)) == "Short summary here."
    p.write_text("# Read\n\nFirst paragraph wins.\n\nSecond.")
    assert panel_text(str(p)) == "First paragraph wins."
    assert panel_text(None) is None


def test_clean_title():
    assert clean_title("Numb - Roomie (Original Song)") == "Numb"
    assert clean_title("Plain") == "Plain"
