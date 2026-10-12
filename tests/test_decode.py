import soundfile as sf

from audiotool.decode import decode, probe, slugify


def test_probe_reads_tags_and_skips_cover(song_mp3, synth_duration):
    meta = probe(song_mp3)
    assert meta["title"] == "Test Tone (Demo Mix)"
    assert meta["artist"] == "Synth Band"
    assert abs(meta["duration_s"] - synth_duration) < 0.2


def test_decode_to_stereo_float_wav(song_mp3, tmp_path, synth_duration):
    wav = decode(song_mp3, tmp_path / "mix.wav")
    info = sf.info(str(wav))
    assert info.samplerate == 44100
    assert info.channels == 2
    assert info.subtype == "FLOAT"
    assert abs(info.frames / 44100 - synth_duration) < 0.2


def test_slugify():
    assert slugify("Numb - Roomie (Original Song)") == "numb-roomie"
    assert slugify("Café del Mar [Remastered]") == "cafe-del-mar"
    assert slugify("((()))", fallback="x") == "x"
    assert slugify("残響散歌") == "残響散歌"          # non-Latin titles keep their letters
