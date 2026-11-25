/**
 * Export presets and options (shared by the studio and the queue).
 *
 * "studio" is the original export: WebCodecs H.264 at 14 Mbps, written as is.
 *
 * "tiktok" is made to survive TikTok's re-encode. The browser renders every
 * frame natively at 1080x1920 (no scaling anywhere) and encodes a near-lossless
 * intermediate; the dev server then re-encodes it with ffmpeg/libx264 (see
 * server/transcode.ts for the exact settings: High profile, yuv420p, CRF 17,
 * preset slow, +faststart, AAC 256 kbps). Without ffmpeg (or outside the dev
 * server) the browser encodes the final file itself at 12 Mbps.
 */
import type { VideoFps } from '../engine/timing';

export type ExportPreset = 'studio' | 'tiktok';

export interface ExportOptions {
  preset: ExportPreset;
  /** 60 (default) or 30. Physics stays at 240 Hz; only the steps per frame change. */
  fps: VideoFps;
  /** Draw with the tiktok-safe style (render/look.ts). */
  safe: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = { preset: 'studio', fps: 60, safe: false };

export interface PresetSpec {
  /** Bitrate of the file the browser writes when nothing re-encodes it. */
  bitrate: number;
  audioBitrate: number;
  /** Re-encode on the dev server with ffmpeg (libx264) when it has ffmpeg. */
  transcode: boolean;
}

export const PRESETS: Record<ExportPreset, PresetSpec> = {
  studio: { bitrate: 14_000_000, audioBitrate: 192_000, transcode: false },
  tiktok: { bitrate: 12_000_000, audioBitrate: 256_000, transcode: true },
};

/**
 * The browser's intermediate for a libx264 re-encode: ~0.8 Mbit per frame
 * (48 Mbps at 60 fps), high enough that the second encode is what decides the
 * quality. H.264 High level 5.1 allows far more, and every hardware encoder we
 * target handles it.
 */
export const intermediateBitrate = (fps: number) => Math.round(800_000 * fps);

/** File-name suffix that tells the variants apart: "-tiktok60", "-tiktok30-safe". */
export function exportSuffix(o: ExportOptions): string {
  if (o.preset === 'studio' && o.fps === 60 && !o.safe) return '';
  return `-${o.preset === 'tiktok' ? 'tiktok' : 'studio'}${o.fps}${o.safe ? '-safe' : ''}`;
}

/** Short label for the queue: "TikTok · 60 fps · safe". */
export function exportLabel(o: ExportOptions): string {
  return [o.preset === 'tiktok' ? 'TikTok' : 'Studio', `${o.fps} fps`, o.safe ? 'safe style' : ''].filter(Boolean).join(' · ');
}

/** The four A/B variants of one run: normal and tiktok-safe style, at 30 and 60 fps, all with the tiktok preset. */
export const AB_VARIANTS: ExportOptions[] = [
  { preset: 'tiktok', fps: 60, safe: false },
  { preset: 'tiktok', fps: 60, safe: true },
  { preset: 'tiktok', fps: 30, safe: false },
  { preset: 'tiktok', fps: 30, safe: true },
];
