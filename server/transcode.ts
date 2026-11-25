/**
 * The "tiktok" preset's final encode: ffmpeg + libx264 (used by the dev
 * server's export endpoint and by `npm run tiktok`).
 *
 * Settings, and why:
 *   -c:v libx264 -profile:v high -level 4.2   what TikTok's pipeline expects; 1080x1920@60 fits level 4.2
 *   -pix_fmt yuv420p                          the only chroma format every phone decodes in hardware
 *   -crf 17 -maxrate 20M -bufsize 40M         visually lossless; the cap stops spark-heavy moments from
 *                                             spiking far past what TikTok's ingest keeps anyway
 *   -preset slow                              better compression per bit (slower to encode, not to play)
 *   -g 2×fps -bf 2                            a keyframe every 2 s, B-frames on
 *   -tune animation                           flat colors and hard edges: stronger deblocking, more
 *                                             reference frames (exactly this kind of graphics)
 *   bt709 tags, tv range                      so TikTok and phones don't guess the colors
 *   -c:a aac 256k 48 kHz stereo (or copied)   AAC is what TikTok wants; a browser AAC track is copied as is
 *   -movflags +faststart                      moov atom up front: uploads and previews start immediately
 *
 * No scaling: the input is already 1080x1920 and the filter chain only sets
 * square pixels, so ffmpeg never resamples a frame.
 */
import { spawn, spawnSync } from 'node:child_process';

let found: boolean | null = null;

/** True when `ffmpeg` with libx264 is on the PATH (checked once). */
export function hasFfmpeg(): boolean {
  if (found !== null) return found;
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    found = r.status === 0 && /libx264/.test(r.stdout);
  } catch {
    found = false;
  }
  return found;
}

export interface TranscodeOptions {
  fps: 30 | 60;
  /** Codec of the input's audio track ('aac' is copied, anything else re-encoded). Omit to always re-encode. */
  audio?: 'aac' | 'opus' | 'none';
  crf?: number;
}

export function tiktokArgs(input: string, output: string, o: TranscodeOptions): string[] {
  const fps = o.fps;
  const audio = o.audio === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2'];
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', input,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    // Square pixels, and BT.709 tags on the frames themselves (Chrome tags its frames sRGB; frame tags win over -color_* alone).
    '-vf', 'setsar=1,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    '-r', String(fps),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-pix_fmt', 'yuv420p',
    '-preset', 'slow',
    '-tune', 'animation',
    '-crf', String(o.crf ?? 17),
    '-maxrate', '20M',
    '-bufsize', '40M',
    '-g', String(fps * 2),
    '-keyint_min', String(fps),
    '-bf', '2',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    ...audio,
    '-movflags', '+faststart',
    output,
  ];
}

/** Re-encode `input` into a TikTok-ready `output`. Rejects with ffmpeg's error text. */
export function transcodeTikTok(input: string, output: string, o: TranscodeOptions): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', tiktokArgs(input, output, o), { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(err.trim() || `ffmpeg exited with ${code}`))));
  });
}
