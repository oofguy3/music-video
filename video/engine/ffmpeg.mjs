// ffmpeg / ffprobe helpers. Audio always comes from the analysis timeline (mix.wav), cut by sample
// index (sr / fps samples per frame), so video frame i and audio sample i*sr/fps line up exactly.
import { spawn, spawnSync } from 'child_process';

export const X264 = {
  full: { preset: 'slow', crf: 18 },
  preview: { preset: 'veryfast', crf: 23 },
};

export function encodeArgs({ w, h, fps, out, audio = null, sr = 44100, range = null, preset = 'slow', crf = 18, gainDb = -2 }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0'];
  if (audio) args.push('-i', audio);
  args.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p');
  args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-tune', 'film', '-profile:v', 'high',
    '-x264-params', 'aq-mode=3:aq-strength=0.8:keyint=120:min-keyint=15',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
  if (audio) {
    const filters = [];
    if (range) {
      const a = Math.round((range[0] * sr) / fps), b = Math.round((range[1] * sr) / fps);
      filters.push(`atrim=start_sample=${a}:end_sample=${b}`, 'asetpts=PTS-STARTPTS');
    }
    filters.push(`volume=${gainDb}dB`, 'aresample=48000:resampler=soxr:precision=28');
    args.push('-af', filters.join(','), '-c:a', 'aac', '-b:a', '256k', '-map', '0:v', '-map', '1:a');
  }
  args.push('-movflags', '+faststart', out);
  return args;
}

export function spawnEncoder(args) {
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const write = (buf) => new Promise((resolve, reject) => {
    if (ff.stdin.write(Buffer.from(buf), (err) => (err ? reject(err) : null))) resolve();
    else ff.stdin.once('drain', resolve);
  });
  const end = async () => { ff.stdin.end(); await done; };
  return { ff, write, end, done };
}

/** Short cut: frame-exact trim of the full render (re-encoded) with audio re-cut from mix.wav. */
export function cutArgs({ src, audio, sr = 44100, fps, startFrame, endFrame, fadeIn = 0.5, out, crf = 17, preset = 'slow', gainDb = -2 }) {
  const a = Math.round((startFrame * sr) / fps), b = Math.round((endFrame * sr) / fps);
  const vf = `[0:v]trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${fadeIn},` +
    'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p[v]';
  const af = `[1:a]atrim=start_sample=${a}:end_sample=${b},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeIn},` +
    `volume=${gainDb}dB,aresample=48000:resampler=soxr:precision=28[a]`;
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-i', audio,
    '-filter_complex', `${vf};${af}`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-tune', 'film', '-profile:v', 'high',
    '-x264-params', 'aq-mode=3:aq-strength=0.8:keyint=120:min-keyint=15',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out];
}

/**
 * A delivery copy of a finished render sized to fit a cap: two-pass x264 at the bitrate that fills
 * `capMiB`, with a light temporal/spatial denoise (grain costs bits that a small file cannot afford).
 * Returns the argument lists for pass 1 and pass 2. Frames, timing and colour tags are unchanged.
 */
export function webArgs({ src, out, durationS, capMiB = 29, audioK = 160, preset = 'slow', denoise = true, passlog }) {
  const totalK = (capMiB * 1024 * 1024 * 8 * 0.96) / 1000 / durationS;
  const videoK = Math.max(300, Math.floor(totalK - audioK));
  const vf = [denoise ? 'hqdn3d=1.2:1.0:4:4' : null, 'format=yuv420p'].filter(Boolean).join(',');
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf,
    '-c:v', 'libx264', '-preset', preset, '-b:v', `${videoK}k`, '-maxrate', `${Math.round(videoK * 2.2)}k`, '-bufsize', `${videoK * 4}k`,
    '-tune', 'film', '-profile:v', 'high', '-x264-params', 'aq-mode=3:aq-strength=0.9:keyint=120:min-keyint=15',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-passlogfile', passlog];
  return {
    videoK,
    pass1: [...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null'],
    pass2: [...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${audioK}k`, '-movflags', '+faststart', out],
  };
}

export function run(args) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

export function ffprobe(path, { countFrames = false } = {}) {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams'];
  if (countFrames) args.push('-count_frames');
  args.push(path);
  const r = spawnSync('ffprobe', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
