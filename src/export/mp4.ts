import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { createMaster, playVoice, SoundMapper } from '../audio/sound';
import { FPS, HEIGHT, type Scene, STEPS_PER_FRAME, WIDTH } from '../engine/scene';
import { World } from '../engine/world';
import { ensureImages } from '../images';
import { Renderer } from '../render/renderer';

const SAMPLE_RATE = 48000;
const VIDEO_BITRATE = 14_000_000;
// H.264 High profile; 1080x1920 at 60 fps needs level 4.2 or higher.
const VIDEO_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.4D402A', 'avc1.42E034'];

export interface ExportResult {
  blob: Blob;
  frames: number;
  seconds: number;
  /** True when the rendering pass ended in exactly the same state as the headless pre-pass. */
  deterministic: boolean;
  codec: string;
  ms: number;
}

export type ExportProgress = (stage: 'simulate' | 'audio' | 'video' | 'finish', fraction: number) => void;

export function canExport(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
}

async function pickVideoCodec(): Promise<string> {
  for (const codec of VIDEO_CODECS) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width: WIDTH, height: HEIGHT, bitrate: VIDEO_BITRATE, framerate: FPS });
    if (supported) return codec;
  }
  throw new Error('This browser cannot encode 1080x1920 H.264. Try a recent Chrome or Edge.');
}

// Yield to the event loop via MessageChannel: unlike setTimeout, it is not
// throttled to ~1/s when the tab is in the background, so exports keep full
// speed while you work in another tab.
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
/**
 * Audio: AAC-LC when the browser can encode it, otherwise Opus (both play in
 * MP4 on every major platform; AAC is what TikTok/Reels expect).
 */
async function pickAudio(): Promise<{ muxCodec: 'aac' | 'opus'; config: AudioEncoderConfig }> {
  const aac = { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192_000, aac: { format: 'aac' } } as AudioEncoderConfig;
  if ((await AudioEncoder.isConfigSupported(aac).catch(() => ({ supported: false }))).supported) return { muxCodec: 'aac', config: aac };
  const opus: AudioEncoderConfig = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 };
  if ((await AudioEncoder.isConfigSupported(opus).catch(() => ({ supported: false }))).supported) return { muxCodec: 'opus', config: opus };
  throw new Error('This browser cannot encode audio for MP4. Try a recent Chrome or Edge.');
}

/**
 * The AAC AudioSpecificConfig for AAC-LC at our sample rate and channel count.
 * We write it ourselves rather than trusting the encoder's `description`: some
 * browsers return a whole MPEG-4 ES descriptor there, which the muxer then
 * wraps again, leaving a file whose audio no player can decode (silent video).
 */
function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const freq = rates.indexOf(sampleRate);
  if (freq < 0) throw new Error(`unsupported AAC sample rate ${sampleRate}`);
  const objectType = 2; // AAC-LC
  return new Uint8Array([(objectType << 3) | (freq >> 1), ((freq & 1) << 7) | (channels << 3)]);
}

export const tick = () =>
  new Promise<void>((r) => {
    waiting.push(r);
    channel.port2.postMessage(0);
  });

/**
 * Frame-by-frame export: simulate headless to learn the length and the event
 * log, render the soundtrack offline, then re-simulate while drawing and
 * encoding every frame. Nothing depends on real time, so no frames drop.
 */
export async function exportMp4(scene: Scene, onProgress: ExportProgress = () => {}): Promise<ExportResult> {
  const t0 = performance.now();

  // 1. Headless pre-pass (and make sure every picture the scene uses is loaded).
  onProgress('simulate', 0);
  await ensureImages(scene);
  const pre = new World(scene).runToEnd();
  const frames = Math.ceil(pre.stepCount / STEPS_PER_FRAME);
  // trimStart: simulate and draw from 0 (trails warm up), encode from here on.
  const startFrame = Math.min(frames - 1, Math.round(scene.duration.trimStart * FPS));
  const seconds = (frames - startFrame) / FPS;
  const fullSeconds = frames / FPS;

  // 2. Soundtrack, rendered faster than real time.
  onProgress('audio', 0);
  const actx = new OfflineAudioContext(2, Math.ceil(fullSeconds * SAMPLE_RATE) + SAMPLE_RATE, SAMPLE_RATE);
  const master = createMaster(actx, scene.audio.volume);
  const mapper = new SoundMapper(scene, pre.rhythmK);
  for (const e of pre.events) {
    for (const v of mapper.map(e)) playVoice(actx, master, v, v.time, scene.audio.instrument);
  }
  const audio = await actx.startRendering();

  // 3. Muxer + encoders.
  const codec = await pickVideoCodec();
  const audioPick = await pickAudio();
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS },
    audio: { codec: audioPick.muxCodec, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encodeError: unknown = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  venc.configure({ codec, width: WIDTH, height: HEIGHT, bitrate: VIDEO_BITRATE, framerate: FPS, latencyMode: 'quality' });

  // 4. Video: re-simulate deterministically and encode every frame.
  const canvas = document.createElement('canvas');
  const world = new World(scene);
  const renderer = new Renderer(canvas, scene);
  const frameUs = 1e6 / FPS;
  for (let i = 0; i < frames; i++) {
    if (encodeError) throw encodeError;
    if (i > 0) for (let s = 0; s < STEPS_PER_FRAME; s++) world.step();
    renderer.render(world, i === 0 ? 0 : 1 / FPS);
    if (i < startFrame) {
      if (i % 30 === 0) await tick();
      continue;
    }
    const k = i - startFrame;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(k * frameUs), duration: Math.round(frameUs) });
    venc.encode(frame, { keyFrame: k % (FPS * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await tick();
    if (i % 15 === 0) {
      onProgress('video', i / frames);
      await tick();
    }
  }
  // Finish any steps the frame grid skipped so the end state matches the pre-pass exactly.
  while (!world.done) world.step();
  await venc.flush();
  venc.close();

  // 5. Audio encode (AAC) in 1024-sample chunks.
  onProgress('finish', 0);
  const asc = aacConfig(SAMPLE_RATE, 2);
  const aenc = new AudioEncoder({
    output: (chunk, meta) => {
      if (audioPick.muxCodec === 'aac') {
        // Always hand the muxer a correct, bare AudioSpecificConfig (see aacConfig).
        meta = { ...meta, decoderConfig: { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, description: asc } };
      }
      muxer.addAudioChunk(chunk, meta);
    },
    error: (e) => (encodeError = e),
  });
  aenc.configure(audioPick.config);
  const offset = Math.round((startFrame / FPS) * SAMPLE_RATE);
  const total = Math.min(audio.length - offset, Math.ceil(seconds * SAMPLE_RATE));
  const left = audio.getChannelData(0).subarray(offset);
  const right = audio.getChannelData(1).subarray(offset);
  for (let start = 0; start < total; start += 1024) {
    const n = Math.min(1024, total - start);
    const data = new Float32Array(n * 2);
    data.set(left.subarray(start, start + n), 0);
    data.set(right.subarray(start, start + n), n);
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((start * 1e6) / SAMPLE_RATE),
      data,
    });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  aenc.close();
  if (encodeError) throw encodeError;

  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  onProgress('finish', 1);
  return { blob, frames, seconds, deterministic: world.hash() === pre.hash(), codec, ms: performance.now() - t0 };
}
