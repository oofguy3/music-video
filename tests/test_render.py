import json
import re

from audiotool.render_html import clean_title, md_to_html, page
from audiotool.render_png import panel_text, render


def _data(html_text: str) -> dict:
    m = re.search(r'<script type="application/json" id="data">(.*?)</script>', html_text, re.S)
    return json.loads(m.group(1))


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
    p.write_text("<!-- panel -->\nIt moves from C# minor to *F#* via `ii`.\n<!-- /panel -->")
    assert panel_text(str(p)) == "It moves from C# minor to F# via ii."
    assert panel_text(None) is None


def test_clean_title():
    assert clean_title("Numb - Roomie (Original Song)", "RoomieOfficial") == "Numb"
    assert clean_title("Roomie - Numb", "Roomie") == "Numb"
    assert clean_title("Plain") == "Plain"
    assert clean_title("(Untitled) Track") == "(Untitled) Track"     # only trailing tags go
    assert clean_title("Song - Part Two") == "Song - Part Two"       # no artist on either side


def test_html_comment_text_keeps_json_valid(analysis):
    analysis["meta"]["title"] = "a <!-- b --> c"
    analysis["lyrics"]["lines"][0]["text"] = "</script> <!--"
    d = _data(page(analysis, "local", "full", None))
    assert d["meta"]["title"] == "a <!-- b --> c"
    assert d["lyrics"]["lines"][0]["text"] == "</script> <!--"


def test_png_survives_dollar_signs_and_long_read(analysis, tmp_path):
    analysis["meta"]["title"] = "$money$ and $more$"
    read = tmp_path / "read.md"
    read.write_text("<!-- panel -->\n" + "A long panel sentence about C# minor and the $5 bill. " * 12
                    + "\n<!-- /panel -->\n")
    assert render(analysis, tmp_path / "t.png", str(read)).exists()


def test_read_splits_into_lead_and_body(analysis):
    md = "# T\n\n<!-- panel -->\nShort answer.\n<!-- /panel -->\n\n## More\nDetail <i>x</i>.\n"
    d = _data(page(analysis, "artifact", "blocks", md))
    assert d["read_lead"] == "Short answer."
    assert "Short answer" not in d["read_html"] and "&lt;i&gt;" in d["read_html"]
