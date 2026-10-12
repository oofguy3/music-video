# music-video

`audiotool` turns a song into tracks an AI can read. Claude can't hear audio, so this is how it listens.

```
song ─┬─ loud and quiet   RMS + LUFS envelopes                 (pyloudnorm)
      ├─ notes            polyphonic transcription per stem    (Spotify basic-pitch, ONNX)
      ├─ beats            beats, downbeats, tempo, meter        (beat_this)
      ├─ voice / drums /  source separation                     (Demucs v4 HTDemucs)
      │  bass / other
      ├─ key + chords     beat-synced chroma, key timeline, Roman numerals
      ├─ lyrics           word-timed transcription of the vocal (faster-whisper large-v3-turbo)
      └─ sections         Laplacian structural segmentation, snapped to bar lines
                    │
                    ▼
      digest.md  ── a ~2k-token text "listening" of the song for an LLM
      tracks.png ── every track on one dark grid
      index.html ── a player: scrub through all the tracks with a playhead
```

## Setup

Needs [uv](https://docs.astral.sh/uv/) and ffmpeg. Runs on CPU (no GPU needed).

```sh
uv sync            # Python 3.12, CPU-only torch
```

The first run downloads about 1.8 GB of models from Hugging Face and the beat_this host.

## Use

```sh
uv run audiotool analyze path/to/song.mp3
```

A 3-minute song takes about 2.5–3 minutes on 4 CPU cores. Separation and lyrics take most of that time. Results go to `out/<slug>/`:

| file | what |
|---|---|
| `digest.md` | compact text for an AI listener: timeline strips, section table (key, Roman-numeral chords, stem activity), arrangement events, timed lyrics with `[unsure?]` words |
| `analysis.json` | everything, machine-readable (`audiotool.analysis/1`) |
| `tracks.png` | the multi-track picture |
| `index.html` | local player: open it next to `audio/`, press space, drag across the lanes to seek |
| `artifact.html` | shareable variant: no audio inside (viewers load their own copy) and lyric text left out by default |
| `stems/*.wav`, `midi/*.mid` | separated stems and transcribed notes |

To run a single stage, use `audiotool <stage> SONG`. It also runs any stage it depends on, and reuses cached results when it can. The stages are `decode`, `stems`, `loudness`, `rhythm`, `notes`, `tonal`, `lyrics`, `structure`, `digest`, `png` and `html`.

A stage re-runs when any of these change: the song, the stage's options, the stage's own code, or a stage it depends on. `--force STAGE` re-runs it anyway.

Useful flags:

- `--fast`: small Whisper model and small beat model.
- `--separator htdemucs_ft`: better vocals, about 4× slower.
- `--language en`: skip language detection.
- `--read song-read.md`: put a written interpretation in the "what the song is about" panel.
- `--artifact-lyrics full|lines|blocks|none`: how much lyric text `artifact.html` carries.

## Tests

```sh
uv run pytest            # fast: synthetic audio, no downloads
uv run pytest --slow     # also runs Demucs and Whisper
```

## Copyright

Separated stems and transcribed lyrics of a commercial song are derivative copies. `out/` and all audio formats are gitignored, and the CLI warns if its output folder isn't.
