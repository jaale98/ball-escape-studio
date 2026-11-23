import { Rng } from '../engine/rng';
import { PHYSICS_HZ, type Scene, WIDTH } from '../engine/scene';
import type { SimEvent } from '../engine/world';

/** Public-domain melodies as MIDI note numbers. Each bounce plays the next note. */
export const MELODIES: Record<string, number[]> = {
  'ode-to-joy': [
    64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
    64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
    62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 55,
    64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
  ],
  'fur-elise': [
    76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72, 64,
    76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 72, 71, 69,
  ],
};

const PENTATONIC = [0, 2, 4, 7, 9];

export interface Voice {
  /** Seconds from the start of the run. */
  time: number;
  kind: 'note' | 'escape';
  midi: number;
  gain: number;
  pan: number;
}

/**
 * Turns simulation events into sounds. Stateful (melody position, voice
 * limiting), so feed it events in order; a fresh mapper over the same events
 * always yields the same voices.
 */
export class SoundMapper {
  private noteIndex = 0;
  private walk = 0;
  private recent: number[] = [];
  private readonly rng: Rng;

  constructor(private readonly scene: Scene) {
    this.rng = new Rng(scene.seed, 'melody');
  }

  map(e: SimEvent): Voice | null {
    const time = e.step / PHYSICS_HZ;
    const pan = Math.max(-1, Math.min(1, (e.x - WIDTH / 2) / (WIDTH / 2))) * 0.5;
    if (e.type === 'bounce') {
      // At most 4 notes in any 60 ms window keeps big crowds from turning to noise.
      this.recent = this.recent.filter((t) => t > time - 0.06);
      if (this.recent.length >= 4) return null;
      this.recent.push(time);
      const gain = Math.max(0.35, Math.min(1, 0.35 + e.speed / 2500));
      return { time, kind: 'note', midi: this.nextNote(), gain, pan };
    }
    if (e.type === 'escape' && this.scene.audio.escapeSound) {
      return { time, kind: 'escape', midi: 72, gain: 1, pan };
    }
    return null;
  }

  private nextNote(): number {
    const melody = MELODIES[this.scene.audio.melody];
    if (melody) return melody[this.noteIndex++ % melody.length];
    this.walk = Math.max(-5, Math.min(12, this.walk + this.rng.int(5) - 2));
    const octave = Math.floor(this.walk / 5);
    const degree = ((this.walk % 5) + 5) % 5;
    return 60 + 12 * octave + PENTATONIC[degree];
  }
}

/** Master bus: volume into a gentle compressor. Returns the node voices connect to. */
export function createMaster(ctx: BaseAudioContext, volume: number): AudioNode {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(comp).connect(ctx.destination);
  return gain;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rng = new Rng(1, 'noise');
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function tone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  type: OscillatorType,
  peak: number,
  decay: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + decay + 0.02);
}

/** Schedule one voice at `when` (seconds on the context's clock). Works for live and offline contexts. */
export function playVoice(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number, instrument: Scene['audio']['instrument']): void {
  const panner = ctx.createStereoPanner();
  panner.pan.value = v.pan;
  panner.connect(dest);

  if (v.kind === 'escape') {
    // Low thump + rising noise whoosh + a bright chord.
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(150, when);
    thump.frequency.exponentialRampToValueAtTime(42, when + 0.35);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.9, when);
    tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    thump.connect(tg).connect(panner);
    thump.start(when);
    thump.stop(when + 0.55);

    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, when);
    bp.frequency.exponentialRampToValueAtTime(5000, when + 0.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, when);
    ng.gain.exponentialRampToValueAtTime(0.5, when + 0.08);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.65);
    src.connect(bp).connect(ng).connect(panner);
    src.start(when);
    src.stop(when + 0.7);

    for (const m of [72, 76, 79, 84]) tone(ctx, panner, when, hz(m), 'sine', 0.12, 1.4);
    return;
  }

  const f = hz(v.midi);
  const peak = 0.26 * v.gain;
  if (instrument === 'bell') {
    tone(ctx, panner, when, f, 'sine', peak, 1.6);
    tone(ctx, panner, when, f * 2.76, 'sine', peak * 0.35, 0.9);
    tone(ctx, panner, when, f * 5.4, 'sine', peak * 0.15, 0.45);
  } else if (instrument === 'marimba') {
    tone(ctx, panner, when, f, 'sine', peak * 1.2, 0.45);
    tone(ctx, panner, when, f * 4, 'sine', peak * 0.3, 0.08);
  } else {
    // Pluck: bright triangle through a closing low-pass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, when);
    lp.frequency.exponentialRampToValueAtTime(700, when + 0.35);
    lp.connect(panner);
    tone(ctx, lp, when, f, 'triangle', peak * 1.1, 0.6);
    tone(ctx, lp, when, f * 2, 'sine', peak * 0.3, 0.3);
  }
}
