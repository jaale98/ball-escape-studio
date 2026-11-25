import { Rng } from '../engine/rng';
import { PHYSICS_HZ, type Scene, songLoopLength, WIDTH } from '../engine/scene';
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
  /** Seconds from the start of the run (including any delay). */
  time: number;
  /** Seconds after the event that caused it (backing notes fall between bounces). */
  delay: number;
  kind: 'note' | 'escape' | 'hit' | 'pop' | 'break' | 'zap' | 'gulp' | 'merge' | 'tick' | 'chime' | 'bell' | 'shoot' | 'drop' | 'swell' | 'gong' | 'buzzer';
  /** Notes to play together (one for a melody, several for a chord). */
  midi: number[];
  gain: number;
  pan: number;
}

/** The melody a scene plays, as a list of note groups. Null = improvised pentatonic. */
export function melodyFor(audio: Scene['audio']): number[][] | null {
  let groups: number[][] | null = null;
  if (audio.notes?.length) groups = audio.notes.map((n) => (Array.isArray(n) ? n : [n]));
  else if (MELODIES[audio.melody]) groups = MELODIES[audio.melody].map((n) => [n]);
  if (!groups) return null;
  return groups
    .filter((g) => g.length)
    .map((g) => (audio.chords ? g : [Math.max(...g)]).map((n) => n + audio.transpose));
}

/**
 * Turns simulation events into sounds. Stateful (melody position, voice
 * limiting), so feed it events in order; a fresh mapper over the same events
 * always yields the same voices.
 */
export class SoundMapper {
  private noteIndex = 0;
  private walk = 0;
  private lastBounceNote = -Infinity;
  /** Recent sound times per limiter key (event time, so it's deterministic). */
  private recent = new Map<string, number[]>();
  private readonly rng: Rng;
  private readonly melody: number[][] | null;
  /** Backing notes folded into one pass of the song: [song time, note], sorted. */
  private readonly backing: [number, number][] = [];
  private readonly loop: number = 1;

  /** `rhythmK`: the world's rhythm-lock tempo (0 = off); backing only plays when locked. */
  constructor(
    private readonly scene: Scene,
    private readonly rhythmK = 0,
  ) {
    this.rng = new Rng(scene.seed, 'melody');
    this.melody = melodyFor(scene.audio);
    const nt = scene.audio.noteTimes;
    if (rhythmK > 0 && nt && nt.length > 1 && scene.audio.backingNotes?.length) {
      this.loop = songLoopLength(nt);
      const t0 = nt[0];
      this.backing = scene.audio.backingNotes.map(([t, n]) => [t0 + ((((t - t0) % this.loop) + this.loop) % this.loop), n] as [number, number]).sort((a, b) => a[0] - b[0]);
    }
  }

  /** The sounds an event makes (none, one, or a bounce note plus the backing notes until the next bounce). */
  map(e: SimEvent): Voice[] {
    const time = e.step / PHYSICS_HZ;
    const pan = Math.max(-1, Math.min(1, (e.x - WIDTH / 2) / (WIDTH / 2))) * 0.5;
    const { audio } = this.scene;
    const one = (v: Omit<Voice, 'time' | 'delay'>): Voice[] => [{ time, delay: 0, ...v }];
    const spacedOut = e.type === 'bounce' && time - this.lastBounceNote < audio.bounceSpacing;
    if (e.type === 'bounce' && audio.pitchBy !== 'melody') {
      if (spacedOut) return [];
      if (!this.allow('note', time, 0.06, 4)) return [];
      this.lastBounceNote = time;
      return one({ kind: 'note', midi: [this.pitchFor(e)], gain: Math.max(0.35, Math.min(1, 0.35 + e.speed / 2500)), pan });
    }
    if (e.type === 'bounce') {
      // Under rhythm lock bounce i is note i, so the melody must advance on
      // every bounce even when a note is too crowded to sound.
      const locked = this.rhythmK > 0;
      const index = this.noteIndex;
      // At most 4 notes in any 60 ms window keeps big crowds from turning to noise.
      const crowded = spacedOut || !this.allow('note', time, 0.06, 4);
      if (crowded && !locked) return [];
      const note = this.nextNote();
      const out: Voice[] = [];
      if (!crowded) {
        this.lastBounceNote = time;
        out.push({ time, delay: 0, kind: 'note', midi: note, gain: Math.max(0.35, Math.min(1, 0.35 + e.speed / 2500)), pan });
      }
      if (locked && this.backing.length) out.push(...this.backingAfter(index, time));
      return out;
    }
    // Every other sound is rate-limited too: a format like multiply can make
    // hundreds of escapes a second, and each one is several oscillators.
    if (e.type === 'escape' && audio.escapeSound) return this.allow('escape', time, 0.25, 2) ? one({ kind: 'escape', midi: [72], gain: 1, pan }) : [];
    if (e.type === 'eliminate') return this.allow('pop', time, 0.1, 3) ? one({ kind: 'pop', midi: [], gain: 1, pan }) : [];
    if (e.type === 'strike' && audio.hitSound) return this.allow('hit', time, 0.05, 3) ? one({ kind: 'hit', midi: [], gain: 1, pan }) : [];
    if (e.type === 'clash' && audio.hitSound) return this.allow('clash', time, 0.1, 3) ? one({ kind: 'note', midi: [96, 103], gain: 0.5, pan }) : [];
    if (e.type === 'wake') return this.allow('note', time, 0.06, 4) ? one({ kind: 'note', midi: this.nextNote(), gain: 0.6, pan }) : [];
    if (e.type === 'hit' && audio.hitSound) return this.allow('hit', time, 0.05, 3) ? one({ kind: 'hit', midi: [], gain: Math.max(0.3, Math.min(1, e.speed / 1500)), pan }) : [];
    if (e.type === 'swing') {
      // Pendulums: each one has its own note on a pentatonic ladder.
      if (!this.allow('note', time, 0.05, 6)) return [];
      const k = e.n ?? 0;
      return one({ kind: 'note', midi: [48 + 12 * Math.floor(k / 5) + PENTATONIC[k % 5] + audio.transpose], gain: 0.5, pan });
    }
    // The clock: a tick per second of the final stretch, rising as zero nears; a buzzer at zero.
    if (e.type === 'clock') return this.scene.clock?.ticks ? one({ kind: 'tick', midi: [e.n! <= 3 ? 93 : 88], gain: e.n! <= 3 ? 1.6 : 1.1, pan: 0 }) : [];
    if (e.type === 'timeUp') return this.scene.clock?.ticks ? one({ kind: 'buzzer', midi: [], gain: 1, pan: 0 }) : [];
    if (e.type === 'finish') return this.allow('finish', time, 0.4, 1) ? one({ kind: 'bell', midi: [72, 76, 79], gain: 1, pan }) : [];
    if (e.type === 'corner') return this.allow('corner', time, 0.5, 1) ? one({ kind: 'bell', midi: [84, 88, 91, 96], gain: 1, pan }) : [];
    if (!audio.eventSounds) return [];
    switch (e.type) {
      case 'break':
        return this.allow('break', time, 0.07, 3) ? one({ kind: 'break', midi: [86 + this.rng.int(10), 93 + this.rng.int(8), 100 + this.rng.int(6)], gain: 0.9, pan }) : [];
      case 'teleport':
        return this.allow('zap', time, 0.1, 2) ? one({ kind: 'zap', midi: [], gain: 0.8, pan }) : [];
      case 'swallow':
        return this.allow('gulp', time, 0.1, 3) ? one({ kind: 'gulp', midi: [], gain: 0.9, pan }) : [];
      case 'merge': {
        if (!this.allow('merge', time, 0.08, 3)) return [];
        const n = 60 + 2 * (e.n ?? 0) + audio.transpose;
        return one({ kind: 'merge', midi: [n, n + 4, n + 7], gain: 0.8, pan });
      }
      case 'capture':
        return this.allow('tick', time, 0.05, 4) ? one({ kind: 'tick', midi: [72 + 7 * (e.n ?? 0)], gain: 0.35, pan }) : [];
      case 'convert':
        return this.allow('chime', time, 0.08, 3) ? one({ kind: 'chime', midi: [76 + 2 * (e.n ?? 0), 83 + 2 * (e.n ?? 0)], gain: 0.6, pan }) : [];
      case 'shoot':
        return this.allow('shoot', time, 0.1, 3) ? one({ kind: 'shoot', midi: [], gain: 0.6, pan }) : [];
      default:
        return [];
    }
    return [];
  }

  /** The climax impact (audio.climax), at the climax step. */
  climax(step: number): Voice[] {
    const kind = this.scene.audio.climax;
    if (kind === 'none' || step < 0) return [];
    return [{ time: step / PHYSICS_HZ, delay: 0, kind, midi: [], gain: 1, pan: 0 }];
  }

  /** pitchBy size / height / speed: a pentatonic note from the ball's state. */
  private pitchFor(e: SimEvent): number {
    const { pitchBy, transpose } = this.scene.audio;
    let t: number; // 0 = low, 1 = high
    if (pitchBy === 'size') t = 1 - Math.min(1, Math.max(0, Math.log2((e.n ?? 20) / 8) / 4));
    else if (pitchBy === 'height') t = 1 - Math.min(1, Math.max(0, (e.y - 400) / 1100));
    else t = Math.min(1, Math.max(0, (e.speed - 150) / 2200));
    const steps = Math.round(t * 15); // three octaves of pentatonic
    return 48 + 12 * Math.floor(steps / 5) + PENTATONIC[steps % 5] + transpose;
  }

  /** Backing notes between melody note `i` and the next one, timed by the rhythm-lock tempo. */
  private backingAfter(i: number, time: number): Voice[] {
    const nt = this.scene.audio.noteTimes!;
    const n = nt.length;
    const a = nt[i % n];
    const b = i % n === n - 1 ? nt[0] + this.loop : nt[(i % n) + 1];
    const gain = this.scene.audio.backingVolume * 0.6;
    const out: Voice[] = [];
    for (const [t, note] of this.backing) {
      if (t < a) continue;
      if (t >= b) break;
      const delay = (t - a) * this.rhythmK;
      out.push({ time: time + delay, delay, kind: 'note', midi: [note + this.scene.audio.transpose], gain, pan: 0 });
    }
    return out;
  }

  /** True (and counted) if fewer than `max` sounds of this kind played in the last `window` seconds. */
  private allow(key: string, time: number, window: number, max: number): boolean {
    const list = (this.recent.get(key) ?? []).filter((t) => t > time - window);
    this.recent.set(key, list);
    if (list.length >= max) return false;
    list.push(time);
    return true;
  }

  private nextNote(): number[] {
    if (this.melody) return this.melody[this.noteIndex++ % this.melody.length];
    this.walk = Math.max(-5, Math.min(12, this.walk + this.rng.int(5) - 2));
    const octave = Math.floor(this.walk / 5);
    const degree = ((this.walk % 5) + 5) % 5;
    return [60 + 12 * octave + PENTATONIC[degree] + this.scene.audio.transpose];
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

  if (v.kind === 'hit') {
    // A short, dry knock.
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1800;
    hp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * v.gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp).connect(g).connect(panner);
    src.start(when);
    src.stop(when + 0.06);
    tone(ctx, panner, when, 220, 'sine', 0.25 * v.gain, 0.08);
    return;
  }

  if (v.kind === 'pop') {
    // Elimination: a falling pop with a noise burst.
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(700, when);
    osc.frequency.exponentialRampToValueAtTime(90, when + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.6, when);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    osc.connect(og).connect(panner);
    osc.start(when);
    osc.stop(when + 0.32);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
    src.connect(ng).connect(panner);
    src.start(when);
    src.stop(when + 0.22);
    return;
  }

  if (v.kind === 'break') {
    // Glass shatter: a bright noise crack and a few high pings.
    noiseHit(ctx, panner, when, 'highpass', 2800, 0.7, 0.55 * v.gain, 0.22);
    noiseHit(ctx, panner, when + 0.01, 'bandpass', 6500, 3, 0.3 * v.gain, 0.4);
    v.midi.forEach((m, i) => tone(ctx, panner, when + i * 0.012, hz(m), 'sine', 0.09 * v.gain, 0.5 + i * 0.15));
    return;
  }
  if (v.kind === 'zap') {
    sweep(ctx, panner, when, 260, 2600, 0.14, 'sawtooth', 0.12 * v.gain, 'lowpass');
    sweep(ctx, panner, when + 0.12, 2400, 500, 0.16, 'sine', 0.18 * v.gain);
    return;
  }
  if (v.kind === 'gulp') {
    sweep(ctx, panner, when, 420, 55, 0.38, 'sine', 0.55 * v.gain);
    noiseHit(ctx, panner, when, 'lowpass', 500, 0.8, 0.25 * v.gain, 0.3);
    return;
  }
  if (v.kind === 'merge') {
    v.midi.forEach((m, i) => sweep(ctx, panner, when + i * 0.045, hz(m) * 0.6, hz(m), 0.08, 'sine', 0.2 * v.gain, undefined, 0.35));
    return;
  }
  if (v.kind === 'tick') {
    tone(ctx, panner, when, hz(v.midi[0] ?? 84), 'square', 0.1 * v.gain, 0.04);
    return;
  }
  if (v.kind === 'chime') {
    v.midi.forEach((m, i) => tone(ctx, panner, when + i * 0.07, hz(m), 'triangle', 0.16 * v.gain, 0.5));
    return;
  }
  if (v.kind === 'bell') {
    v.midi.forEach((m, i) => {
      tone(ctx, panner, when + i * 0.03, hz(m), 'sine', 0.14 * v.gain, 2.2);
      tone(ctx, panner, when + i * 0.03, hz(m) * 2.76, 'sine', 0.05 * v.gain, 1.1);
    });
    return;
  }
  if (v.kind === 'shoot') {
    noiseHit(ctx, panner, when, 'bandpass', 1400, 2.5, 0.7 * v.gain, 0.12);
    sweep(ctx, panner, when, 900, 300, 0.1, 'triangle', 0.08 * v.gain);
    return;
  }
  if (v.kind === 'drop') {
    // Bass drop: a falling sub and a noise hit.
    sweep(ctx, panner, when, 140, 38, 1.4, 'sine', 0.9 * v.gain, undefined, 1.6);
    sweep(ctx, panner, when, 280, 76, 0.8, 'triangle', 0.25 * v.gain);
    noiseHit(ctx, panner, when, 'lowpass', 1800, 0.7, 0.45 * v.gain, 0.6);
    return;
  }
  if (v.kind === 'swell') {
    // Cymbal swell: bright noise that rings out.
    noiseHit(ctx, panner, when, 'highpass', 5000, 0.5, 0.35 * v.gain, 2.4);
    noiseHit(ctx, panner, when, 'bandpass', 9000, 1.5, 0.2 * v.gain, 1.6);
    return;
  }
  if (v.kind === 'buzzer') {
    // Game-show buzzer: two detuned low saws through a lowpass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(panner);
    for (const f of [110, 116.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.16 * v.gain, when + 0.01);
      g.gain.setValueAtTime(0.16 * v.gain, when + 0.75);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.95);
      osc.connect(g).connect(lp);
      osc.start(when);
      osc.stop(when + 1);
    }
    return;
  }
  if (v.kind === 'gong') {
    for (const [k, a, d] of [
      [1, 0.4, 4],
      [1.48, 0.22, 3],
      [2.09, 0.16, 2.4],
      [2.93, 0.1, 1.8],
      [4.2, 0.06, 1.2],
    ] as const)
      tone(ctx, panner, when, 82 * k, 'sine', a * v.gain, d);
    noiseHit(ctx, panner, when, 'lowpass', 900, 0.8, 0.3 * v.gain, 0.25);
    return;
  }

  const each = 1 / Math.sqrt(v.midi.length || 1);
  for (const m of v.midi) {
    const f = hz(m);
    const peak = 0.26 * v.gain * each;
    if (instrument === 'glass') {
      tone(ctx, panner, when, f, 'sine', peak * 0.4, 2.2);
      tone(ctx, panner, when, f * 2.32, 'sine', peak * 0.16, 1.3);
      tone(ctx, panner, when, f * 4.25, 'sine', peak * 0.09, 0.6);
      tone(ctx, panner, when, f * 6.8, 'sine', peak * 0.03, 0.3);
    } else if (instrument === 'chip') {
      tone(ctx, panner, when, f, 'square', peak * 1.3, 0.22);
      tone(ctx, panner, when + 0.05, f * 2, 'square', peak * 0.5, 0.12);
    } else if (instrument === 'piano') {
      tone(ctx, panner, when, f, 'triangle', peak * 0.66, 1.4);
      tone(ctx, panner, when, f * 2, 'sine', peak * 0.24, 0.9);
      tone(ctx, panner, when, f * 3, 'sine', peak * 0.11, 0.5);
      tone(ctx, panner, when, f * 4.02, 'sine', peak * 0.05, 0.25);
    } else if (instrument === 'kalimba') {
      tone(ctx, panner, when, f, 'sine', peak * 0.75, 0.9);
      tone(ctx, panner, when, f * 5.43, 'sine', peak * 0.16, 0.09);
      tone(ctx, panner, when, f * 3, 'sine', peak * 0.08, 0.2);
    } else if (instrument === 'pop') {
      sweep(ctx, panner, when, f * 1.9, f, 0.05, 'sine', peak * 2.1, undefined, 0.2);
    } else if (instrument === 'synth') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6;
      lp.frequency.setValueAtTime(5200, when);
      lp.frequency.exponentialRampToValueAtTime(500, when + 0.4);
      lp.connect(panner);
      tone(ctx, lp, when, f * 0.995, 'sawtooth', peak * 0.9, 0.45);
      tone(ctx, lp, when, f * 1.005, 'sawtooth', peak * 0.9, 0.45);
      tone(ctx, lp, when, f / 2, 'square', peak * 0.4, 0.3);
    } else if (instrument === 'meow') {
      meow(ctx, panner, when, f, peak * 1.6);
    } else if (instrument === 'bell') {
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
}

/** A tone whose pitch glides from f0 to f1 over `glide` seconds, then decays (by `decay`, default glide). */
function sweep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  f0: number,
  f1: number,
  glide: number,
  type: OscillatorType,
  peak: number,
  filter?: BiquadFilterType,
  decay = glide,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + glide);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(glide, decay) + 0.02);
  let out: AudioNode = g;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = 3000;
    g.connect(f);
    out = f;
  }
  osc.connect(g);
  out.connect(dest);
  osc.start(when);
  osc.stop(when + Math.max(glide, decay) + 0.05);
}

/** A filtered burst of noise. */
function noiseHit(ctx: BaseAudioContext, dest: AudioNode, when: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  src.connect(f).connect(g).connect(dest);
  src.start(when);
  src.stop(when + decay + 0.05);
}

/**
 * A meow, in tune: a buzzy source through two vowel formants that open
 * ("mee") then close ("-ow"), with the pitch rising then falling.
 */
function meow(ctx: BaseAudioContext, dest: AudioNode, when: number, f: number, peak: number): void {
  const dur = 0.42;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f * 0.92, when);
  osc.frequency.linearRampToValueAtTime(f * 1.12, when + 0.11);
  osc.frequency.linearRampToValueAtTime(f * 0.82, when + dur);
  const vib = ctx.createOscillator();
  vib.frequency.value = 6;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = f * 0.012;
  vib.connect(vibAmt).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak * 0.9, when + 0.03);
  g.gain.setValueAtTime(peak * 0.9, when + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  for (const [lo, hi, end, q] of [
    [700, 1700, 650, 6],
    [1900, 2700, 1100, 9],
  ] as const) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(lo, when);
    bp.frequency.linearRampToValueAtTime(hi, when + 0.12);
    bp.frequency.linearRampToValueAtTime(end, when + dur);
    osc.connect(bp).connect(g);
  }
  g.connect(dest);
  osc.start(when);
  vib.start(when);
  osc.stop(when + dur + 0.05);
  vib.stop(when + dur + 0.05);
}
