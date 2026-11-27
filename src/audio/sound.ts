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
  kind: 'note' | 'escape' | 'hit' | 'pop' | 'break' | 'zap' | 'gulp' | 'merge' | 'tick' | 'chime' | 'bell' | 'shoot' | 'drop' | 'swell' | 'gong' | 'buzzer' | 'stutter' | 'burst' | 'drone' | 'beat' | 'scare';
  /** Notes to play together (one for a melody, several for a chord). */
  midi: number[];
  gain: number;
  pan: number;
  /** stutter / burst / drone: which sound (audio.escapeStyle, audio.burst, audio.drone). */
  variant?: string;
  /** drone: segment length in seconds. */
  dur?: number;
}

/** Drone segments: this long, starting this often (they overlap and crossfade). */
const DRONE_SEG = 3.2;
const DRONE_EVERY = 2.4;

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
  /** Escape streak (each escape within 0.4 s of the last) and how many burst sounds it has had. */
  private streak = 0;
  private lastEscape = -Infinity;
  private burstsInStreak = 0;
  /** Run time the next drone segment (or heartbeat) starts. */
  private nextDrone = 0;
  /** px from the nearest stalker to its prey, from the latest pulse (-1 = none). */
  private near = -1;
  private lastScare = -Infinity;

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
    const one = (v: Omit<Voice, 'time' | 'delay'>): Voice[] => [{ time, delay: 0, ...v }];
    if (e.type === 'pulse') this.near = e.n ?? -1;
    const out = this.droneFor(time);
    const voices = this.mapOne(e, time, pan, one);
    return out.length ? [...out, ...voices] : voices;
  }

  /** Drone segments due by `time` (any event keeps the bed going). */
  private droneFor(time: number): Voice[] {
    const { audio, clock } = this.scene;
    if (audio.drone === 'none' || audio.droneVolume <= 0) return [];
    // A seek (or a long silence) skips ahead instead of piling segments up.
    if (time > this.nextDrone + DRONE_SEG - DRONE_EVERY) this.nextDrone = time;
    const out: Voice[] = [];
    if (audio.drone === 'heartbeat') {
      // Lub-dub, faster as the clock runs down, and racing when something is close.
      while (this.nextDrone <= time + 0.25) {
        const start = this.nextDrone;
        const clockT = Math.min(1, Math.max(0, clock ? start / clock.seconds : start / 40));
        const nearT = this.near < 0 ? 0 : Math.min(1, Math.max(0, 1 - this.near / 520));
        const tension = Math.max(clockT * 0.75, nearT);
        out.push({ time: start, delay: Math.max(0, start - time), kind: 'beat', midi: [], gain: audio.droneVolume * (0.55 + 0.75 * tension), pan: 0 });
        this.nextDrone += 60 / (58 + 112 * tension * tension);
      }
      return out;
    }
    while (this.nextDrone <= time + 0.25) {
      const start = this.nextDrone;
      // It swells as the clock runs down (or over the first 40 s without one).
      const tension = Math.min(1, Math.max(0, clock ? start / clock.seconds : start / 40));
      out.push({ time: start, delay: Math.max(0, start - time), kind: 'drone', variant: audio.drone, dur: DRONE_SEG, midi: [], gain: audio.droneVolume * (0.55 + 0.45 * tension), pan: 0 });
      this.nextDrone += DRONE_EVERY;
    }
    return out;
  }

  private mapOne(e: SimEvent, time: number, pan: number, one: (v: Omit<Voice, 'time' | 'delay'>) => Voice[]): Voice[] {
    const { audio } = this.scene;
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
    if (e.type === 'escape') return this.escapeVoices(e, time, pan);
    if (e.type === 'caught') {
      if (time - this.lastScare < 0.5) return [];
      this.lastScare = time;
      return one({ kind: 'scare', midi: [], gain: 1, pan });
    }
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

  /**
   * An escape: the classic whoosh (spaced out), or a clip that restarts on
   * every escape (a streak stutters). A streak of burstAt+ escapes also gets
   * the burst sound, again every 40 more escapes in the same streak.
   */
  private escapeVoices(e: SimEvent, time: number, pan: number): Voice[] {
    const { audio } = this.scene;
    this.streak = time - this.lastEscape < 0.4 ? this.streak + 1 : 1;
    if (this.streak === 1) this.burstsInStreak = 0;
    this.lastEscape = time;
    const out: Voice[] = [];
    if (audio.escapeSound) {
      if (audio.escapeStyle === 'classic') {
        if (this.allow('escape', time, 0.25, 2)) out.push({ time, delay: 0, kind: 'escape', midi: [72], gain: 1, pan });
      } else if (this.allow('stutter', time, 0.012, 1)) {
        // The same clip each time; it steps down a semitone every 80 rings (deeper = lower), wrapping each octave.
        const midi = 57 + audio.transpose - (Math.floor(Math.max(0, e.ring) / 80) % 12);
        out.push({ time, delay: 0, kind: 'stutter', variant: audio.escapeStyle, midi: [midi], gain: 0.9, pan: pan * 0.5 });
      }
    }
    if (audio.burst !== 'none') {
      const due = this.burstsInStreak === 0 ? this.streak >= audio.burstAt : this.streak >= audio.burstAt + 40 * this.burstsInStreak;
      if (due) {
        const k = this.burstsInStreak++;
        out.push({ time, delay: 0, kind: 'burst', variant: audio.burst, midi: [-2 * k], gain: Math.min(1.6, 0.8 + 0.2 * k), pan: 0 });
      }
    }
    return out;
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

/** Per master: its compressor, and the reverb send once one is needed. */
const masters = new WeakMap<AudioNode, { ctx: BaseAudioContext; comp: AudioNode; wet?: GainNode }>();

/** Master bus: volume into a gentle compressor, with a reverb send (audio.reverb). Returns the node voices connect to. */
export function createMaster(ctx: BaseAudioContext, volume: number, reverb = 0): AudioNode {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(comp).connect(ctx.destination);
  masters.set(gain, { ctx, comp });
  setReverb(gain, reverb);
  return gain;
}

const reverbWet = (amount: number) => Math.max(0, Math.min(1, amount)) * 0.85;

/** Change the reverb of a master made by createMaster (scene switches in the studio). The hall is only built once a scene wants it. */
export function setReverb(master: AudioNode, amount: number): void {
  const m = masters.get(master);
  if (!m) return;
  if (!m.wet) {
    if (amount <= 0) return;
    const conv = m.ctx.createConvolver();
    conv.buffer = hallImpulse(m.ctx);
    m.wet = m.ctx.createGain();
    master.connect(conv).connect(m.wet).connect(m.comp);
  }
  m.wet.gain.value = reverbWet(amount);
}

/** A big, dark hall: 3.6 s of decaying stereo noise (seeded, so every render is the same). */
function hallImpulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.round(ctx.sampleRate * 3.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const rng = new Rng(7, 'hall');
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // Darker as it decays: a one-pole low-pass whose cutoff falls over time.
      const k = 0.55 - 0.4 * Math.min(1, t / 3);
      lp += k * (rng.next() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t * 1.6) * (t < 0.02 ? t / 0.02 : 1) * 0.6;
    }
  }
  return buf;
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
  if (v.kind === 'stutter') return stutter(ctx, dest, v, when);
  const panner = ctx.createStereoPanner();
  panner.pan.value = v.pan;
  panner.connect(dest);

  if (v.kind === 'burst') return burstSound(ctx, panner, v, when);
  if (v.kind === 'drone') return drone(ctx, panner, v, when);
  if (v.kind === 'beat') return heartbeat(ctx, panner, v, when);
  if (v.kind === 'scare') return scare(ctx, panner, v, when);

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

// ---- weird sounds: stutter clips, bursts and drones ---------------------------------

/** The clip that is sounding (per context), so the next escape can cut it off. */
const chokes = new WeakMap<BaseAudioContext, { gain: GainNode; src: AudioBufferSourceNode }>();
/** Rendered stutter clips per context and variant. */
const clips = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
/** Every clip is rendered at this note; playbackRate moves it. */
const CLIP_NOTE = 57;

/** A band-pass filter (RBJ cookbook, 0 dB peak) over a buffer, in place. */
function bandpass(x: Float32Array, fs: number, f: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * f) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Render one stutter clip as a sample (deterministic: plain math and a seeded
 * noise stream), so restarting it is a single buffer source, however many
 * escapes there are.
 */
function renderClip(fs: number, variant: string): Float32Array {
  const f = hz(CLIP_NOTE);
  const env = (t: number, attack: number, hold: number, release: number) =>
    t < attack ? t / attack : t < attack + hold ? 1 : Math.exp(-((t - attack - hold) / release) * 4.6);
  let len: number;
  let out: Float32Array;
  if (variant === 'voice') {
    // A sung "ah": a buzzy source through three vowel formants, the pitch sagging as it goes.
    len = 0.29;
    const n = Math.ceil(len * fs);
    const src = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      ph += (f * (1.04 - (0.1 * t) / len)) / fs;
      src[i] = 2 * (ph - Math.floor(ph)) - 1;
    }
    const a = bandpass(src, fs, 800, 7);
    const b = bandpass(src, fs, 1150, 9);
    const c = bandpass(src, fs, 2900, 12);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (a[i] + 0.6 * b[i] + 0.25 * c[i]) * env(i / fs, 0.006, 0.12, 0.16);
  } else if (variant === 'reverse') {
    // Backmasked: the sung "ah" played backwards, so it swells out of nothing and stops dead.
    const fwd = renderClip(fs, 'voice');
    len = fwd.length / fs;
    out = fwd.slice().reverse();
    // A 4 ms fade at the very end, where the reversed attack would click.
    const n = out.length;
    const fade = Math.round(0.004 * fs);
    for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  } else if (variant === 'musicbox') {
    // A music-box tine: inharmonic partials, a fast warble (a worn comb), a long ring.
    len = 0.55;
    const n = Math.ceil(len * fs);
    out = new Float32Array(n);
    const partials: [number, number, number][] = [
      [1, 1, 3.2],
      [2.01, 0.35, 5],
      [5.43, 0.22, 9],
      [8.93, 0.08, 14],
    ];
    const ph = partials.map(() => 0);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const wob = 1 + 0.009 * Math.sin(2 * Math.PI * 6.3 * t) - 0.004 * t;
      let v = 0;
      partials.forEach(([ratio, amp, decay], k) => {
        ph[k] += (f * 2 * ratio * wob) / fs;
        v += amp * Math.sin(2 * Math.PI * ph[k]) * Math.exp(-t * decay);
      });
      out[i] = v * Math.min(1, t / 0.002);
    }
  } else if (variant === 'glitch') {
    // A bit-crushed blip whose pitch hops in a fixed pattern.
    len = 0.18;
    const n = Math.ceil(len * fs);
    const steps = [1, 1.5, 0.75, 2, 1.25, 0.5, 1.5];
    out = new Float32Array(n);
    let ph = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      ph += (f * 4 * steps[Math.min(steps.length - 1, Math.floor(t / 0.026))]) / fs;
      // Crush: hold every 6th sample.
      const sq = ph - Math.floor(ph) < 0.5 ? 1 : -1;
      lp += 0.35 * (sq - lp);
      out[i] = (i % 6 === 0 ? lp : out[i - 1] ?? lp) * env(t, 0.002, 0.11, 0.05);
    }
  } else if (variant === 'static') {
    // A burst of radio static, chopped by a fast gate, over a low tone.
    len = 0.2;
    const n = Math.ceil(len * fs);
    const rng = new Rng(3, 'static');
    const noiseBuf = new Float32Array(n);
    for (let i = 0; i < n; i++) noiseBuf[i] = rng.next() * 2 - 1;
    const hiss = bandpass(noiseBuf, fs, 1700, 0.8);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const gate = Math.floor(t * 38 * 2) % 2 === 0 ? 1 : 0.15;
      const tri = 1 - 4 * Math.abs(((t * f) / 2) % 1 - 0.5);
      out[i] = (hiss[i] * 1.6 * gate + 0.35 * tri) * env(t, 0.002, 0.1, 0.08);
    }
  } else {
    // tape: a tape motor spinning up (wow), pitch climbing to the note.
    len = 0.26;
    const n = Math.ceil(len * fs);
    out = new Float32Array(n);
    let p1 = 0;
    let p2 = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const k = t < 0.13 ? 0.3 * Math.pow(1 / 0.3, t / 0.13) : 1;
      p1 += (f * k) / fs;
      p2 += (f * 0.5 * k) / fs;
      const v = 0.6 * (2 * (p1 - Math.floor(p1)) - 1) + Math.sin(2 * Math.PI * p2);
      lp += Math.min(1, 0.08 + t * 3) * (v - lp);
      out[i] = lp * env(t, 0.004, 0.14, 0.1);
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.5 / peak;
  return out;
}

function clipBuffer(ctx: BaseAudioContext, variant: string): AudioBuffer {
  let map = clips.get(ctx);
  if (!map) clips.set(ctx, (map = new Map()));
  let buf = map.get(variant);
  if (!buf) {
    const data = renderClip(ctx.sampleRate, variant);
    buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.getChannelData(0).set(data);
    map.set(variant, buf);
  }
  return buf;
}

/**
 * One short clip that restarts on every escape (audio.escapeStyle). Each new
 * one cuts off the last, so a run of escapes stutters like a skipping sample.
 */
function stutter(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number): void {
  const prev = chokes.get(ctx);
  if (prev) {
    // Cut the sounding clip: a 3 ms fade, so it clicks a little but doesn't pop.
    const g = prev.gain.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(when);
    else g.cancelScheduledValues(when);
    g.setTargetAtTime(0, when, 0.001);
    try {
      prev.src.stop(when + 0.008);
    } catch {
      // already stopped
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = clipBuffer(ctx, v.variant ?? 'voice');
  src.playbackRate.value = 2 ** (((v.midi[0] ?? CLIP_NOTE) - CLIP_NOTE) / 12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(v.gain * 1.2, when);
  src.connect(gain).connect(dest);
  src.start(when);
  chokes.set(ctx, { gain, src });
}

/** Loudness of a Shepard partial by pitch: a bell over log-frequency, so partials fade in at the top and out at the bottom. */
const shepardWeight = (f: number) => Math.exp(-((Math.log2(f / 220) / 1.5) ** 2));

/** A streak of escapes (audio.burst). midi[0] lowers it (semitones) as a long streak goes on. */
function burstSound(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number): void {
  const shift = 2 ** ((v.midi[0] ?? 0) / 12);
  const gain = v.gain;
  if (v.variant === 'rewind') return rewindSound(ctx, dest, v, when);
  if (v.variant === 'drop') {
    sweep(ctx, dest, when, 140 * shift, 38, 1.4, 'sine', 0.8 * gain, undefined, 1.6);
    sweep(ctx, dest, when, 280 * shift, 76, 0.8, 'triangle', 0.22 * gain);
    noiseHit(ctx, dest, when, 'lowpass', 1800, 0.7, 0.4 * gain, 0.6);
    return;
  }
  if (v.variant === 'choir') {
    // A diminished cluster on "oo", swelling in, vibrato widening: wrong, and getting closer.
    const dur = 1.9;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(0.32 * gain, when + 0.35);
    out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    out.connect(dest);
    for (const [ff, q] of [
      [330, 6],
      [900, 8],
      [2400, 10],
    ] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff;
      bp.Q.value = q;
      bp.connect(out);
      for (const m of [45, 48, 51, 54, 57]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = hz(m) * shift;
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.5 + (m % 5) * 0.4;
        const va = ctx.createGain();
        va.gain.setValueAtTime(0, when);
        va.gain.linearRampToValueAtTime(hz(m) * 0.03, when + dur);
        vib.connect(va).connect(osc.frequency);
        osc.connect(bp);
        osc.start(when);
        vib.start(when);
        osc.stop(when + dur + 0.05);
        vib.stop(when + dur + 0.05);
      }
    }
    sweep(ctx, dest, when, 90 * shift, 40, 1.2, 'sine', 0.5 * gain, undefined, 1.4);
    return;
  }
  // dive: octave-spaced tones all falling an octave at once (it sounds like it never stops falling), a sub, and wind.
  const dur = 1.7;
  for (let k = 0; k < 7; k++) {
    const f0 = 55 * 2 ** k * shift;
    const f1 = f0 / 2;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    const a0 = 0.16 * gain * shepardWeight(f0);
    const a1 = 0.16 * gain * shepardWeight(f1);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, a0), when + 0.06);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, (a0 + a1) / 2), when + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(dest);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }
  sweep(ctx, dest, when, 75 * shift, 28, 1.3, 'sine', 0.7 * gain, undefined, 1.5);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 4;
  lp.frequency.setValueAtTime(5000, when);
  lp.frequency.exponentialRampToValueAtTime(220, when + dur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.25 * gain, when);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(lp).connect(ng).connect(dest);
  src.start(when);
  src.stop(when + dur + 0.05);
}

/** One heartbeat (drone 'heartbeat'): a low lub and a softer dub, felt more than heard. */
function heartbeat(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number): void {
  const g = Math.min(1.4, v.gain);
  for (const [dt, f0, peak] of [
    [0, 62, 1],
    [0.17, 54, 0.7],
  ] as const) {
    const t = when + dt;
    sweep(ctx, dest, t, f0 * 1.6, f0, 0.07, 'sine', 0.95 * g * peak, undefined, 0.22);
    noiseHit(ctx, dest, t, 'lowpass', 160, 0.8, 0.35 * g * peak, 0.09);
  }
}

/** Caught by a stalker: a burst of static, a slammed sub, and a dissonant shriek that drops away. */
function scare(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number): void {
  const g = v.gain;
  noiseHit(ctx, dest, when, 'bandpass', 2200, 0.6, 1.1 * g, 0.55);
  noiseHit(ctx, dest, when, 'highpass', 6000, 0.7, 0.5 * g, 0.3);
  sweep(ctx, dest, when, 120, 30, 0.9, 'sine', 1.2 * g, undefined, 1.2);
  for (const [f, type] of [
    [1480, 'sawtooth'],
    [1567, 'square'],
    [2093, 'sawtooth'],
  ] as const) {
    sweep(ctx, dest, when, f, f / 3, 0.8, type, 0.06 * g, 'lowpass', 0.9);
  }
}

/** Burst 'rewind': a tape sucked backwards. Noise and a whine rush up from nothing and stop dead. */
function rewindSound(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number): void {
  const shift = 2 ** ((v.midi[0] ?? 0) / 12);
  const dur = 0.9;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(300 * shift, when);
  bp.frequency.exponentialRampToValueAtTime(6000 * shift, when + dur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, when);
  ng.gain.exponentialRampToValueAtTime(0.6 * v.gain, when + dur);
  ng.gain.setValueAtTime(0.0001, when + dur + 0.004);
  src.connect(bp).connect(ng).connect(dest);
  src.start(when);
  src.stop(when + dur + 0.02);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(90 * shift, when);
  osc.frequency.exponentialRampToValueAtTime(1400 * shift, when + dur);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, when);
  og.gain.exponentialRampToValueAtTime(0.14 * v.gain, when + dur);
  og.gain.setValueAtTime(0.0001, when + dur + 0.004);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  osc.connect(lp).connect(og).connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.02);
  // The tape snaps: a thud right after.
  sweep(ctx, dest, when + dur, 110 * shift, 40, 0.3, 'sine', 0.7 * v.gain, undefined, 0.5);
}

/**
 * One segment of the drone bed (audio.drone). Segments overlap and crossfade;
 * a Shepard drone takes its pitches from the run time, so consecutive
 * segments carry on the same endless fall.
 */
function drone(ctx: BaseAudioContext, dest: AudioNode, v: Voice, when: number): void {
  const dur = v.dur ?? DRONE_SEG;
  const fade = DRONE_SEG - DRONE_EVERY;
  const out = ctx.createGain();
  const peak = 0.2 * v.gain;
  out.gain.setValueAtTime(0, when);
  out.gain.linearRampToValueAtTime(peak, when + fade);
  out.gain.setValueAtTime(peak, when + dur - fade);
  out.gain.linearRampToValueAtTime(0, when + dur);
  out.connect(dest);
  const stopAt = when + dur + 0.05;
  if (v.variant === 'shepard') {
    // Eight octaves of tones sliding down 0.08 octave a second; the bell over pitch hides the wrap.
    const rate = 0.08;
    const phase = (((-rate * v.time) % 1) + 1) % 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + 2600 * v.gain;
    lp.connect(out);
    for (let k = 0; k < 8; k++) {
      const f0 = 27.5 * 2 ** (k + phase);
      const f1 = f0 * 2 ** (-rate * dur);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, when);
      osc.frequency.exponentialRampToValueAtTime(f1, when + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0001, shepardWeight(f0) * 0.5), when);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, shepardWeight(f1) * 0.5), when + dur);
      osc.connect(g).connect(lp);
      osc.start(when);
      osc.stop(stopAt);
    }
    return;
  }
  if (v.variant === 'hum') {
    // Mains hum (60 Hz and its harmonics, wavering), with tape hiss that rises with the tension.
    for (const [f, a] of [
      [60, 0.5],
      [120, 0.3],
      [180, 0.18],
      [300, 0.08],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const wob = ctx.createOscillator();
      wob.frequency.value = 0.3 + f / 1000;
      const wa = ctx.createGain();
      wa.gain.value = f * 0.004;
      wob.connect(wa).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = a;
      osc.connect(g).connect(out);
      for (const n of [osc, wob]) {
        n.start(when);
        n.stop(stopAt);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    src.loopStart = (v.time * 0.37) % 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.value = 0.08 + 0.12 * v.gain;
    src.connect(hp).connect(g).connect(out);
    src.start(when, src.loopStart);
    src.stop(stopAt);
    return;
  }
  // choir: a low cluster on a dark vowel, the vowel slowly drifting.
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 5;
  const shift = Math.sin(v.time * 0.21);
  bp.frequency.setValueAtTime(420 + 120 * shift, when);
  bp.frequency.linearRampToValueAtTime(420 + 120 * Math.sin((v.time + dur) * 0.21), when + dur);
  bp.connect(out);
  for (const m of [36, 43, 46, 49]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(m) * (1 + (m % 3) * 0.002);
    const g = ctx.createGain();
    g.gain.value = 0.7;
    osc.connect(g).connect(bp);
    osc.start(when);
    osc.stop(stopAt);
  }
}
