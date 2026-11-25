/**
 * Re-encode an existing MP4 with the "tiktok" preset's libx264 settings
 * (server/transcode.ts), e.g. an old export or one downloaded without the dev server.
 *
 *   npm run tiktok -- exports/ring-escape-seed12.mp4            → exports/ring-escape-seed12-tiktok.mp4
 *   npm run tiktok -- exports/a.mp4 --fps 30 --crf 16 --out b.mp4
 *
 * The frame rate must match the input's (this never resamples time); it only sets the keyframe interval.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hasFfmpeg, transcodeTikTok } from '../server/transcode';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input || !existsSync(input)) {
  console.error('usage: npm run tiktok -- <input.mp4> [--fps 30|60] [--crf 17] [--out file.mp4]');
  process.exit(1);
}
if (!hasFfmpeg()) {
  console.error('ffmpeg with libx264 is not on the PATH (macOS: brew install ffmpeg).');
  process.exit(1);
}

const probe = (entries: string, stream: string) =>
  spawnSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', entries, '-of', 'csv=p=0', input], { encoding: 'utf8' }).stdout?.trim() ?? '';
const rate = probe('stream=r_frame_rate', 'v:0');
const detected = rate ? Math.round(Number(rate.split('/')[0]) / Number(rate.split('/')[1] || 1)) : 60;
const fps = Number(flag('fps') ?? detected) === 30 ? 30 : 60;
if (fps !== detected) console.warn(`note: the input is ${detected} fps; --fps ${fps} only changes the keyframe interval.`);
const audioCodec = probe('stream=codec_name', 'a:0');
const out = flag('out') ?? input.replace(/\.mp4$/i, '') + '-tiktok.mp4';
const t0 = Date.now();
await transcodeTikTok(input, out, { fps, audio: audioCodec === 'aac' ? 'aac' : audioCodec ? 'opus' : 'none', crf: flag('crf') ? Number(flag('crf')) : undefined });
console.log(`${out}  (libx264 High, yuv420p, CRF ${flag('crf') ?? 17}, ${fps} fps, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
