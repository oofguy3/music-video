# video: motion-graphics renderer

This renders the music video from `audiotool`'s analysis. Every frame is drawn in code (Skia, through
`@napi-rs/canvas`) and piped straight into ffmpeg/x264, with the song muxed in sample-exact from the
analysis timeline. The output contains the song, so it is only ever written into the gitignored `out/`
folder.

```sh
cd video && npm ci                                   # one native dependency
uv run audiotool motion path/to/song.mp3             # (repo root) per-frame features -> out/<slug>/stages/motion.json
node render.mjs preview                              # 960x540 quick look with audio (~1 min)
node render.mjs full                                 # 1920x1080 final (x264 slow, CRF 18)
node render.mjs cut                                  # short cut (final chorus + outro) from the full render
node render.mjs review --round r1                    # contact sheets, event strips, filmstrip, metrics
node render.mjs stills --frames 2933,3985 --size 1920x1080
node render.mjs preview --scenes debug               # sync harness: every scene replaced by the debug scene
npm test                                             # engine + guards (node --test)
```

Checks on a rendered file (from the repo root): `uv run python -m audiotool.avcheck VIDEO --motion
out/<slug>/stages/motion.json --mix out/<slug>/audio/mix.wav --events 2711,2933`.

## How a frame is made (`engine/frame.mjs`)

1. Clear to black.
2. Draw the active timeline entry. During a crossfade, draw both entries, each in its own layer.
3. Draw transitions (`scenes/transitions.mjs`).
4. Draw the title card (`scenes/title.mjs`).
5. Run post-processing (`engine/post.mjs`): bloom, numb frost, vignette, grain.
6. Black out every frame from the hard stop onwards.
7. Read the RGBA pixels back and add ±1-level dither.

Worker threads render frames out of order into shared memory. The main thread feeds them to ffmpeg in
order.

## Scene contract

A scene is a module in `scenes/` that is registered in `scenes/index.mjs`:

```js
export const meta = { type: 'crowd', budgetMs: 30 };   // p95 ms per 1080p frame, one thread
export const defaults = { count: 560, numbGain: 0.8 };  // parameters; the treatment overrides them
export function draw(g, t, F, P, S) { /* ... */ }
```

The `draw` function must be **pure**. The same `(t, F, P, S)` must always give the same pixels,
whichever worker renders the frame and in whatever order. In practice:

- Use no `Math.random`, `Date` or `performance`. For randomness use `g.noise.hash01(seed, i, ...)`,
  `noise2` and `fbm`, seeded from `S.seed`.
- Keep no state from one frame to the next. Past values come from `F.col(name, t - dt)`, accumulated
  values from `F.integral(name, a, b)`, and history from the event lists (`F.between('voc_notes', a, t)`).
- Module-level caches are allowed only when they are pure functions of their key, such as sprites,
  gradients or layouts.
- Don't hard-code song times. Every moment comes from `F` (events and columns) or from `P`
  (treatment parameters, which may reference events, e.g. `"@numb[2].t0"`).
- Draw no text. Only `scenes/title.mjs` may call `fillText`.

### `g`: drawing context and helpers

| field | what |
|---|---|
| `g.ctx` | Canvas2D context, pre-scaled to **logical 1920×1080** (draw in those coordinates at any output size). `save`/`restore` are applied around `draw`. |
| `g.W`, `g.H` | 1920, 1080 (logical) |
| `g.scale`, `g.devW`, `g.devH` | device scale and size (0.5 / 960×540 for previews) |
| `g.sprites` | `glow(hex, core)`, `bokeh(hex, edge, rim)`, `streak(hex)`: cached 256 px light sprites; draw with `ctx.drawImage(s, x-r, y-r, 2r, 2r)` |
| `g.world` | `camera({horizon, height, focal, x, z})`, `project(cam, X, Y, Z)`, `groundZ(cam, y)`, `sky(g, [[pos, hex], ...])` (dithered, cached), `crowdLayout(count, seed, {rows, zNear, zFar, cam})` (shared, deterministic, back-to-front) |
| `g.noise` | `hash32`, `hash01`, `hashRange`, `rng`, `noise1/2/3`, `fbm1/2` |
| `g.color` | `css(hex, alpha)` (cached), `mix(a, b, t)` (OKLab), `rotateHue(hex, deg)`, `saturate(hex, k)`, `scale(hex, k)` |
| `g.ease` | `clamp`, `lerp`, `remap`, `smooth`, `outExpo`, `ahr(t, t0, t1, a, r)`, `decay(t, t0, tau)`, ... |
| `g.layer(name)` | a cleared offscreen layer `{canvas, ctx}` at device size, pre-scaled to logical. Composite it back with `ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(L.canvas, 0, 0); ctx.restore()` |
| `g.snapshot(entryId, t)` | the raw image of another timeline entry at time `t` (for afterimages) |
| `g.createCanvas(w, h)` | for your own cached offscreen buffers |

### `F`: features at time `t` (from `motion.json`)

`F.c.<column>` is every per-frame column at `t`. The main ones:

| group | columns |
|---|---|
| grid | `mt` (continuous beat count; downbeats at multiples of 4), `beat_phase`, `bar`, `bar_phase`, `since_beat`, `since_down`, `rate`, `section`, `section_u` |
| drums | `hit`, `kick`, `snare`, `hat` (impulses: peak on the hit frame, then decay), `hit_rel`, `hat_rel` (strength relative to the section), `drums_lvl`, `drums_rel`, `density` |
| voice | `voc_lvl`, `voc_rel`, `voc_on` (note-onset impulse), `voc_midi` (−1 when silent), `voc_pitch` (0..1, held), `voc_held`, `word_on` (word-onset impulse, timing only), `line_pos` |
| bass, pad | `bass_lvl/rel/on/midi`, `pad_lvl/rel/on`, `pad_bright` (0..1 brightness) |
| mix | `loud` (0..1 momentary loudness), `energy` |
| harmony | `chord_root`, `chord_minor`, `chord_deg`, `chord_u`, `chord_on`, `numb` (borrowed minor-iv envelope, 0..1), `numb_hit`, `numb_accum`, `key_tonic`, `key_pivot`, `key_lift` |
| arrangement | `voc/drums/bass/pad_active`, `cut` (impulse at hard cuts), `stopped` |

`*_lvl` values are normalised over the whole song. `*_rel` values are normalised within each section, so
quiet parts still move.

The accessors:

- `F.col(name, t2)` gives a column at any time (linear between frames).
- `F.integral(name, a, b)` gives value-seconds over [a, b] in O(1).
- `F.last/next(list, t2)`, `F.between(list, a, b)` and `F.impulse(list, tau, strengthIdx)` search events.
- `F.section()`, `F.liftDeg()`, `F.beatS`, `F.bpb`, `F.fps`, `F.frame`, `F.duration`.

The event lists are in `F.ev`. All times are seconds, and no lyric text is ever present:

| list | entries |
|---|---|
| `sections` | `{label, t0, t1, hint, key}` |
| `beats`, `downbeats` | numbers |
| `hit`, `kick`, `snare`, `hat` | `[t, s, s_rel]` |
| `voc_notes`, `bass_notes`, `pad_notes` | `[t0, t1, midi, vel]` |
| `words` | `[t0, t1, p]` |
| `lines` | `[t0, t1, nWords]` |
| `chords` | `[t0, t1, root, qual, deg, roman, conf]` |
| `numb` | `[t0, t1, conf]` |
| `key_changes` | `{t, pivot, from, to, semis}` |
| `cuts`, `dips` | `cuts` are times; `dips` are `[t, depth]` |
| `entries`, `exits` | `[t, stem]` |

The single values are `end_stop`, `loudest` and `end`.

### `P` and `S`

- `P` holds the parameters at `t`: the scene's `defaults`, overridden by the treatment entry's `params`.
  Keyframed values are already interpolated.
- `S` is `{id, scene, t0, t1, u (0..1 through the entry), frame, fps, palette, lift, seed, weight}`.
  `palette` is the entry's named colours with the key-change hue lift already applied.

## Treatments

A treatment is a JSON file in `treatments/`. It has these parts:

- **`timeline`**: entries `{id, scene, t0, t1, palette, params, post, brief}`.
- **`transitions`**: `flash`, `fade_from_black`, `fade_to_black` or `cut`, each with `t`, `dur` and
  `params`.
- **`palettes`**.
- **`post`**: the defaults `bloom`, `bloomRadius`, `vignette`, `grain`, `frost` and `frostTint`.
- **`title`**.
- **`shortCut`**.

Times are seconds or references such as `"@cuts[0]"`, `"@key_changes[0].t"`, `"@downbeats[32]-1b"` or
`"@sections.C1.t0"`. A reference can carry offsets in `s`, `b` (beats), `bar` or `f` (frames).

A parameter is either a constant or keyframes, written as `[[time, value, ease], ...]`.

`treatments/auto.mjs` builds a default treatment for any song from its section roles.

## Timing rule

Frame `i` shows time `i / fps`. An event at time `t` lands on frame `floor(t * fps + 0.5)`.
`audiotool/motion.py` uses the same rule, so an impulse peaks exactly on the frame where its sound
starts.
