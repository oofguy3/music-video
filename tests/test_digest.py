from audiotool.digest import activity_strip, energy_strip, render_digest, stem_events


def test_digest_contents(analysis):
    text = render_digest(analysis)
    assert text.startswith("# Test Tone (Demo Mix) - Synth Band (0:20)")
    assert "| A1 | 0:00-0:10 | intro | A minor |" in text
    assert "hello [quiet?] world" in text            # low-confidence word marked
    assert "<outside_vocals>" in text                # line flags shown
    assert "i III VII" in text                       # roman numerals
    assert len(text) / 3.5 < 6000


def test_strips():
    s = energy_strip([-60.0] * 40 + [-10.0] * 40, fr=20, step_s=1.0)
    assert s == "0099"
    assert activity_strip([[0, 1.0], [2.7, 3.0]], 4.0, 1.0) == "#.+."


def test_stem_events_ignore_short_dropouts(analysis):
    stems = analysis["stems"]
    stems["vocals"]["active"] = [[4.0, 9.0], [10.0, 18.0]]   # 1 s dropout: not an exit
    ev = [e for e in stem_events(stems) if e[1].startswith("voice")]
    assert ev == [(4.0, "voice in"), (18.0, "voice out")]
