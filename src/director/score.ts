/**
 * The Director: runs a scene headless with a given seed (and small speed /
 * spin variations) and scores how good a story the run tells.
 *
 * Pure and deterministic: works in the browser, in Web Workers, and in Node
 * (`npm run sim -- <scene> --director <template>`).
 */
import { PHYSICS_HZ, type Scene } from '../engine/scene';
import { type RingContainer, World } from '../engine/world';

export type Template = 'slow-burn' | 'last-second' | 'chaos' | 'comeback' | 'music-sync';

export const TEMPLATES: Record<Template, { label: string; description: string }> = {
  'slow-burn': { label: 'Slow burn', description: 'Climax near the target, with near-misses building toward it and no dead stretches.' },
  'last-second': { label: 'Last-second escape', description: 'Lands on the target almost exactly, after plenty of near-misses.' },
  chaos: { label: 'Chaos', description: 'As busy as possible: lots of hits, lots of balls.' },
  comeback: { label: 'Comeback', description: 'Races and battles: the lead changes hands and the winner was behind at halftime.' },
  'music-sync': { label: 'In time with the song', description: 'Bounces land on the MIDI song’s note timing.' },
};

export interface Variation {
  seed: number;
  /** world.speedScale */
  speed: number;
  /** world.spinScale */
  spin: number;
}

export interface RunScore extends Variation {
  /** 0–100. */
  score: number;
  /** Seconds; -1 when the run has no climax. */
  climax: number;
  length: number;
  endReason: string;
  winner: string;
  /** Each signal, 0–1. */
  signals: Record<string, number>;
  /** Short human-readable facts. */
  facts: string[];
}

export interface DirectorOptions {
  template: Template;
  /** Target climax time in seconds. */
  target: number;
}

/** The scene with this variation applied. */
export function applyVariation(scene: Scene, v: Variation): Scene {
  return { ...scene, seed: v.seed, world: { ...scene.world, speedScale: scene.world.speedScale * v.speed, spinScale: scene.world.spinScale * v.spin } };
}

const gauss = (x: number, sigma: number) => Math.exp(-0.5 * (x / sigma) ** 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Run one candidate and score it. */
export function scoreRun(base: Scene, v: Variation, opts: DirectorOptions): RunScore {
  const scene = applyVariation(base, v);
  const w = new World(scene);
  const startingBalls = w.balls.length;
  const T = opts.target;
  const endsOnClimax = scene.duration.endOn !== 'never';

  // Signals gathered while stepping.
  const nearMisses: number[] = []; // times
  const lastMiss = new Map<number, number>();
  let lastActivity = 0;
  let deadTime = 0;
  const bounceTimes: number[] = [];
  let lastEliminationAt = -1;
  let peakBalls = 0;
  let hits = 0;
  // Battles: hp leader samples.
  let leader = -1;
  let leadChanges = 0;
  const hpAtHalf = new Map<number, number>();
  let halfSampled = false;

  let cursor = 0;
  const sampleEvery = Math.round(PHYSICS_HZ / 4);
  while (!w.done) {
    w.step();
    const t = w.time;
    for (; cursor < w.events.length; cursor++) {
      const e = w.events[cursor];
      if (e.type === 'bounce' || e.type === 'hit' || e.type === 'escape' || e.type === 'eliminate') {
        const et = e.step / PHYSICS_HZ;
        deadTime = Math.max(deadTime, et - lastActivity);
        lastActivity = et;
      }
      if (e.type === 'hit') hits++;
      if (e.type === 'eliminate') lastEliminationAt = e.step / PHYSICS_HZ;
      if (e.type === 'bounce') {
        bounceTimes.push(e.step / PHYSICS_HZ);
        // Near miss: a ring bounce just beside a gap edge.
        const c = e.ring >= 0 ? w.containers[e.ring] : null;
        if (c && c.kind === 'ring' && c.gaps.length) {
          const ball = w.balls[e.ball];
          const theta = Math.atan2(e.y - c.y, e.x - c.x) - c.angle;
          const margin = Math.asin(Math.min(1, (ball?.r ?? 20) / c.radius)) + 0.1;
          if (missesGap(c, theta, margin)) {
            const at = e.step / PHYSICS_HZ;
            if (at - (lastMiss.get(e.ball) ?? -1) > 0.4) nearMisses.push(at);
            lastMiss.set(e.ball, at);
          }
        }
      }
    }
    if (w.stepCount % sampleEvery === 0) {
      peakBalls = Math.max(peakBalls, w.aliveCount);
      const fighters = w.balls.filter((b) => b.alive && b.hp !== undefined);
      if (fighters.length > 1) {
        const top = fighters.reduce((a, b) => ((b.hp ?? 0) > (a.hp ?? 0) ? b : a));
        if (leader >= 0 && top.id !== leader && (top.hp ?? 0) > (w.balls[leader].hp ?? 0)) leadChanges++;
        leader = top.id;
      }
      if (!halfSampled && t >= T / 2) {
        halfSampled = true;
        for (const b of w.balls) if (b.alive && b.hp !== undefined) hpAtHalf.set(b.id, b.hp);
      }
    }
  }

  // Climax: first escape, last elimination, or the moment the ending triggered.
  let climax = -1;
  if (w.endReason === 'escaped') climax = w.firstEscapeStep / PHYSICS_HZ;
  else if (w.endReason === 'lastStanding') climax = lastEliminationAt;
  else if (w.endReason === 'allEscaped' || w.endReason === 'filled') climax = w.time - scene.duration.tail;
  const failed = endsOnClimax && climax < 0;

  const timing = climax < 0 ? (endsOnClimax ? 0 : 0.5) : gauss(climax - T, 0.15 * T);
  const tightTiming = climax < 0 ? 0 : gauss(climax - T, 0.05 * T);
  const before = (from: number, to: number) => nearMisses.filter((x) => x >= from && x < to).length;
  const end = climax > 0 ? climax : w.time;
  const lateMisses = before(end * 0.6, end - 0.3);
  const earlyMisses = before(0, end * 0.4);
  const rising = clamp01((lateMisses - earlyMisses * 0.5 + 1) / 4);
  const misses = clamp01(nearMisses.filter((x) => x < end - 0.3).length / 6);
  const pacing = clamp01(1 - Math.max(0, deadTime - 3) / 5);
  const busy = clamp01((bounceTimes.length + hits) / Math.max(1, w.time) / 12);
  const crowd = clamp01(peakBalls / 60);
  const winnerBall = w.winner >= 0 && startingBalls > 1 ? w.balls[w.winner] : null;
  let comeback = 0;
  if (winnerBall && hpAtHalf.size > 1 && hpAtHalf.has(winnerBall.id)) {
    const ranked = [...hpAtHalf.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    comeback = clamp01(ranked.indexOf(winnerBall.id) / Math.max(1, ranked.length - 1));
  }
  const lead = clamp01(leadChanges / 5);
  const rhythm = rhythmScore(bounceTimes, scene.audio.noteTimes);

  const signals: Record<string, number> = { timing, pacing };
  let weights: Record<string, number>;
  switch (opts.template) {
    case 'slow-burn':
      Object.assign(signals, { rising, misses });
      weights = { timing: 3, rising: 2, misses: 1, pacing: 1 };
      break;
    case 'last-second':
      Object.assign(signals, { timing: tightTiming, misses });
      weights = { timing: 4, misses: 2, pacing: 1 };
      break;
    case 'chaos':
      Object.assign(signals, { busy, crowd });
      weights = { busy: 2, crowd: 1, timing: 1, pacing: 1 };
      break;
    case 'comeback':
      Object.assign(signals, { comeback, lead, misses });
      weights = { comeback: 3, lead: 2, timing: 1, misses: 1 };
      break;
    case 'music-sync':
      Object.assign(signals, { rhythm: rhythm.score });
      weights = { rhythm: 4, timing: 1, pacing: 1 };
      break;
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = Object.entries(weights).reduce((s, [k, wt]) => s + wt * (signals[k] ?? 0), 0) / total;
  if (failed) score *= 0.2;
  else if (climax > 0 && climax < 0.35 * T) score *= 0.5;

  const facts: string[] = [];
  if (climax >= 0) facts.push(`climax ${climax.toFixed(1)}s`);
  else facts.push(endsOnClimax ? 'no climax' : `${w.time.toFixed(0)}s run`);
  if (nearMisses.length) facts.push(`${nearMisses.length} near-misses`);
  if (deadTime > 3) facts.push(`${deadTime.toFixed(1)}s lull`);
  if (leadChanges) facts.push(`${leadChanges} lead changes`);
  if (winnerBall) facts.push(`${winnerBall.label ?? `ball ${winnerBall.id}`} wins`);
  if (opts.template === 'music-sync' && rhythm.checked) facts.push(`${Math.round(rhythm.score * 100)}% of ${rhythm.checked} notes on time`);

  return {
    ...v,
    score: Math.round(score * 1000) / 10,
    climax,
    length: w.time,
    endReason: w.endReason,
    winner: winnerBall ? (winnerBall.label ?? `ball ${winnerBall.id}`) : '',
    signals,
    facts,
  };
}

/** Theta lies outside every gap but within `margin` radians of a gap edge. */
function missesGap(c: RingContainer, theta: number, margin: number): boolean {
  for (const g of c.gaps) {
    const d = Math.abs(Math.atan2(Math.sin(theta - g.at), Math.cos(theta - g.at)));
    if (d >= g.width / 2 && d < g.width / 2 + margin) return true;
  }
  return false;
}

/**
 * Rhythm sync: how well the first bounces follow the song's note timing.
 * Each bounce plays the next note, so bounce i should land at a + k·note[i]
 * for some start a and tempo k (0.5–2× the song's tempo). Fits a and k by
 * least squares, then counts bounces within 70 ms of their note, out of the
 * first 32 notes.
 */
export function rhythmScore(bounces: number[], noteTimes?: number[]): { score: number; checked: number } {
  if (!noteTimes?.length || bounces.length < 4) return { score: 0, checked: 0 };
  const n = Math.min(32, bounces.length, noteTimes.length);
  const x = noteTimes.slice(0, n).map((t) => t - noteTimes[0]);
  const y = bounces.slice(0, n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const k = Math.max(0.5, Math.min(2, sxx > 0 ? sxy / sxx : 1));
  const a = my - k * mx;
  let onTime = 0;
  for (let i = 0; i < n; i++) if (Math.abs(y[i] - (a + k * x[i])) < 0.07) onTime++;
  // Judge against the first 32 notes (or the whole song if shorter): a run that
  // only bounces a few times must not score as "perfectly in time".
  const wanted = Math.min(32, noteTimes.length);
  return { score: onTime / wanted, checked: wanted };
}

/**
 * The candidates to try: `count` seeds, each with a small random speed/spin
 * variation (when `vary` > 0), from a deterministic generator.
 */
export function candidates(count: number, vary: number, firstSeed = 1): Variation[] {
  const out: Variation[] = [];
  let s = 0x9e3779b9;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    out.push({
      seed: firstSeed + i,
      speed: vary ? round(1 + (rand() * 2 - 1) * vary) : 1,
      spin: vary ? round(1 + (rand() * 2 - 1) * vary) : 1,
    });
  }
  return out;
}

/** Refinement round: small nudges around the best variations found so far. */
export function refinements(best: Variation[], perEach: number, vary: number): Variation[] {
  const out: Variation[] = [];
  best.forEach((b, j) => {
    for (let i = 0; i < perEach; i++) {
      const f = ((i + 1) / perEach) * (vary / 2);
      const sign = (i + j) % 2 ? 1 : -1;
      out.push({ seed: b.seed, speed: round(b.speed * (1 + sign * f)), spin: round(b.spin * (1 - sign * f * 0.5)) });
    }
  });
  return out;
}

const round = (x: number) => Math.round(x * 1000) / 1000;
