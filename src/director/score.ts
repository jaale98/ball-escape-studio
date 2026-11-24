/**
 * The Director: runs a scene headless with a given seed (and small speed /
 * spin variations) and scores how good a story the run tells.
 *
 * Pure and deterministic: works in the browser, in Web Workers, and in Node
 * (`npm run sim -- <scene> --director <template>`).
 */
import { PHYSICS_HZ, type Scene } from '../engine/scene';
import { type RingContainer, World } from '../engine/world';

export type Template = 'slow-burn' | 'last-second' | 'chaos' | 'comeback' | 'music-sync' | 'perfect-loop' | 'underdog' | 'photo-finish' | 'destruction';

export const TEMPLATES: Record<Template, { label: string; description: string }> = {
  'slow-burn': { label: 'Slow burn', description: 'Climax near the target, with near-misses building toward it and no dead stretches.' },
  'last-second': { label: 'Last-second escape', description: 'Lands on the target almost exactly, after plenty of near-misses.' },
  chaos: { label: 'Chaos', description: 'As busy as possible: lots of hits, lots of balls.' },
  comeback: { label: 'Comeback', description: 'Races and battles: the lead changes hands and the winner was behind at halftime.' },
  'music-sync': { label: 'In time with the song', description: 'Bounces land on the MIDI song’s note timing.' },
  underdog: { label: 'Underdog', description: 'Team formats: the side that was behind at halfway takes over in the end, with the lead swapping along the way.' },
  'photo-finish': { label: 'Photo finish', description: 'Races: the winner crosses the line a hair ahead of second place.' },
  destruction: { label: 'Destruction', description: 'Breakable formats: lots of breaks, with the last one landing near the target.' },
  'perfect-loop': {
    label: 'Perfect loop',
    description: 'Finds a stretch whose last frame matches its first, so the video loops seamlessly on replay (target = loop length). Best with one ball and no gravity.',
  },
};

/** Pick a sensible story for a scene. */
export function defaultTemplate(scene: Scene): Template {
  if (scene.audio.rhythmLock || (scene.audio.noteTimes && scene.audio.melody.startsWith('midi:'))) return 'music-sync';
  if (scene.duration.endOn === 'lastStanding') return 'comeback';
  if (scene.duration.endOn === 'oneTeam' || scene.teams.length > 1) return 'underdog';
  if (scene.duration.endOn === 'finish') return 'photo-finish';
  if (scene.duration.endOn === 'cleared') return 'destruction';
  if (scene.duration.endOn === 'never') return 'chaos';
  return 'slow-burn';
}

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
  /** Raw measurements (for the Critic). */
  stats: {
    deadTime: number;
    nearMisses: number;
    bounceRate: number;
    leadChanges: number;
    peakBalls: number;
    capped: boolean;
    scriptError: string;
    teamLeadChanges: number;
    /** Average ball speed when the video ends (px/s): is a pile settled? */
    endSpeed: number;
    /** Pendulum scenes: how far apart the bobs ended (px). */
    pendulumSpread: number;
  };
  /** Perfect loops: the seamless stretch found. */
  loop?: { from: number; to: number; error: number };
  /** Moments worth marking on a timeline. */
  markers: { t: number; kind: 'escape' | 'eliminate' | 'near' | 'climax' | 'strike' }[];
}

export interface DirectorOptions {
  template: Template;
  /** Target climax time in seconds. */
  target: number;
}

/** The scene with this variation applied. */
export function applyVariation(scene: Scene, v: Variation & { loop?: RunScore['loop'] }): Scene {
  const out: Scene = { ...scene, seed: v.seed, world: { ...scene.world, speedScale: scene.world.speedScale * v.speed, spinScale: scene.world.spinScale * v.spin } };
  if (v.loop) {
    // Export exactly the seamless stretch; no timer (it would jump on replay).
    out.duration = { ...scene.duration, max: v.loop.to, trimStart: v.loop.from, endOn: 'never', tail: 0 };
    out.overlay = { ...scene.overlay, timer: false };
  }
  return out;
}

/** Loop search: compare the state every few steps against a warmed-up anchor. */
const LOOP_ANCHOR = 2;
const LOOP_MIN = 6;
function snapshot(w: World): number[] {
  const s: number[] = [];
  for (const b of w.balls) if (b.alive) s.push(b.id, b.x, b.y, b.vx, b.vy, b.r);
  for (const c of w.containers) if (c.kind === 'poly' || c.gaps.length) s.push(-1, Math.cos(c.angle) * c.radius, Math.sin(c.angle) * c.radius);
  return s;
}
/** Visual distance between two snapshots, in px (velocity counts as px per 1/4 s). */
function snapDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; ) {
    if (a[i] !== b[i]) return Infinity; // different balls alive
    if (a[i] === -1) {
      d = Math.max(d, Math.hypot(a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
      i += 3;
    } else {
      d = Math.max(d, Math.hypot(a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]) + Math.hypot(a[i + 3] - b[i + 3], a[i + 4] - b[i + 4]) / 4 + Math.abs(a[i + 5] - b[i + 5]));
      i += 6;
    }
  }
  return d;
}

const gauss = (x: number, sigma: number) => Math.exp(-0.5 * (x / sigma) ** 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Run one candidate and score it. */
export function scoreRun(base: Scene, v: Variation, opts: DirectorOptions): RunScore {
  const scene = applyVariation(base, v);
  const w = new World(scene);
  const startingBalls = w.balls.length;
  const T = opts.target;
  // A scene whose script can end it (world.end()) has a climax too.
  const endsOnClimax = scene.duration.endOn !== 'never' || /world\.end\(|"do":"end"/.test(JSON.stringify(scene.rules) + JSON.stringify(scene.timeline));

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
  // Teams: the leading team over time, and the standings at halfway.
  let teamLeader = -1;
  let teamLeadChanges = 0;
  let teamsAtHalf: number[] | null = null;
  const finishTimes: number[] = [];
  const breakTimes: number[] = [];
  const teamCounts = (): number[] => {
    if (w.territory) return [...w.territory.counts];
    const c = scene.teams.map(() => 0);
    for (const b of w.balls) if (b.alive && !b.projectile && b.team !== undefined) c[w.teamOf(b.team)]++;
    return c;
  };

  const markers: RunScore['markers'] = [];
  let cursor = 0;
  const sampleEvery = Math.round(PHYSICS_HZ / 4);
  const looping = opts.template === 'perfect-loop';
  let anchor: number[] | null = null;
  let bestLoop = { to: -1, error: Infinity };
  while (!w.done) {
    w.step();
    const t = w.time;
    if (looping) {
      if (w.stepCount === Math.round(LOOP_ANCHOR * PHYSICS_HZ)) anchor = snapshot(w);
      else if (anchor && t >= LOOP_ANCHOR + LOOP_MIN && w.stepCount % 2 === 0) {
        const err = snapDistance(anchor, snapshot(w));
        // Prefer loops near the target length: small penalty for distance from it.
        const cost = err + Math.abs(t - LOOP_ANCHOR - T) * 0.3;
        if (cost < bestLoop.error + Math.abs(bestLoop.to - LOOP_ANCHOR - T) * 0.3 || bestLoop.to < 0) bestLoop = { to: t, error: err };
      }
    }
    for (; cursor < w.events.length; cursor++) {
      const e = w.events[cursor];
      if (e.type === 'bounce' || e.type === 'hit' || e.type === 'escape' || e.type === 'eliminate') {
        const et = e.step / PHYSICS_HZ;
        deadTime = Math.max(deadTime, et - lastActivity);
        lastActivity = et;
      }
      if (e.type === 'hit') hits++;
      if (e.type === 'eliminate') {
        lastEliminationAt = e.step / PHYSICS_HZ;
        if (markers.length < 400) markers.push({ t: lastEliminationAt, kind: 'eliminate' });
      }
      if (e.type === 'escape' && markers.length < 400 && w.balls.length <= 40) markers.push({ t: e.step / PHYSICS_HZ, kind: 'escape' });
      if (e.type === 'finish') finishTimes.push(e.step / PHYSICS_HZ);
      if (e.type === 'break') breakTimes.push(e.step / PHYSICS_HZ);
      if (e.type === 'swallow' && startingBalls > 1) lastEliminationAt = e.step / PHYSICS_HZ;
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
      if (scene.teams.length > 1) {
        const c = teamCounts();
        const top = c.indexOf(Math.max(...c));
        if (teamLeader >= 0 && top !== teamLeader && c[top] > c[teamLeader]) teamLeadChanges++;
        teamLeader = top;
        if (!teamsAtHalf && t >= T / 2) teamsAtHalf = c;
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
  else if (w.endReason === 'lastStanding') climax = lastEliminationAt >= 0 ? lastEliminationAt : w.climaxStep / PHYSICS_HZ;
  else if (w.endReason === 'allEscaped' || w.endReason === 'filled' || w.endReason === 'script') climax = w.time - scene.duration.tail;
  else if (w.climaxStep >= 0) climax = w.climaxStep / PHYSICS_HZ;
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
  const lead = clamp01((leadChanges + teamLeadChanges) / 5);
  // Team formats: the eventual winner was behind at halfway.
  let underdog = 0;
  const winTeam = w.winnerTeam ? w.teamOf(w.winnerTeam) : -1;
  if (winTeam >= 0 && teamsAtHalf) {
    const ranked = teamsAtHalf.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    underdog = clamp01(ranked.indexOf(winTeam) / Math.max(1, ranked.length - 1));
  }
  const margin = finishTimes.length >= 2 ? finishTimes[1] - finishTimes[0] : Infinity;
  const photo = Number.isFinite(margin) ? gauss(margin, 0.35) : 0;
  const lastBreak = breakTimes.length ? breakTimes[breakTimes.length - 1] : -1;
  const smash = clamp01(breakTimes.length / 40);
  const lateBreak = lastBreak > 0 ? gauss(lastBreak - T, 0.15 * T) : 0;
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
    case 'underdog':
      Object.assign(signals, { underdog, lead });
      weights = { underdog: 3, lead: 2, timing: 2, pacing: 1 };
      break;
    case 'photo-finish':
      Object.assign(signals, { photo, comeback });
      weights = { photo: 3, timing: 2, comeback: 1, pacing: 1 };
      break;
    case 'destruction':
      Object.assign(signals, { smash, lateBreak });
      weights = { smash: 2, lateBreak: 2, timing: 2, pacing: 1 };
      break;
    case 'music-sync':
      Object.assign(signals, { rhythm: rhythm.score });
      weights = { rhythm: 4, timing: 1, pacing: 1 };
      break;
    case 'perfect-loop': {
      const seamless = bestLoop.to > 0 ? Math.exp(-bestLoop.error / 12) : 0;
      const length = bestLoop.to > 0 ? gauss(bestLoop.to - LOOP_ANCHOR - T, 0.3 * T) : 0;
      Object.assign(signals, { seamless, length });
      delete signals.timing;
      weights = { seamless: 4, length: 1, pacing: 1 };
      break;
    }
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = Object.entries(weights).reduce((s, [k, wt]) => s + wt * (signals[k] ?? 0), 0) / total;
  if (opts.template !== 'perfect-loop') {
    if (failed) score *= 0.2;
    else if (climax > 0 && climax < 0.35 * T) score *= 0.5;
  }

  const facts: string[] = [];
  if (climax >= 0) facts.push(`climax ${climax.toFixed(1)}s`);
  else facts.push(endsOnClimax ? 'no climax' : `${w.time.toFixed(0)}s run`);
  if (nearMisses.length) facts.push(`${nearMisses.length} near-misses`);
  if (deadTime > 3) facts.push(`${deadTime.toFixed(1)}s lull`);
  if (leadChanges) facts.push(`${leadChanges} lead changes`);
  if (winnerBall) facts.push(`${winnerBall.label ?? `ball ${winnerBall.id}`} wins`);
  if (w.winnerTeam) facts.push(`${w.winnerTeam} wins`);
  if (teamLeadChanges) facts.push(`${teamLeadChanges} takeovers`);
  if (w.breaks) facts.push(`${w.breaks} breaks`);
  if (w.captures) facts.push(`${w.captures} cells painted`);
  if (w.conversions) facts.push(`${w.conversions} converted`);
  if (w.merges) facts.push(`${w.merges} merges`);
  if (w.swallowed) facts.push(`${w.swallowed} swallowed`);
  if (w.corners) facts.push(`${w.corners} corner hits`);
  if (Number.isFinite(margin)) facts.push(`won by ${margin.toFixed(2)}s`);
  if (opts.template === 'music-sync' && rhythm.checked) facts.push(`${Math.round(rhythm.score * 100)}% of ${rhythm.checked} notes on time`);
  const loop = looping && bestLoop.to > 0 ? { from: LOOP_ANCHOR, to: Math.round(bestLoop.to * 1000) / 1000, error: bestLoop.error } : undefined;
  if (looping) {
    facts.length = 0;
    facts.push(loop ? `${(loop.to - loop.from).toFixed(1)}s loop, seam ${loop.error.toFixed(1)}px` : 'no loop found');
  }

  return {
    ...v,
    score: Math.round(score * 1000) / 10,
    climax,
    length: w.time,
    endReason: w.endReason,
    winner: winnerBall ? (winnerBall.label ?? `ball ${winnerBall.id}`) : w.winnerTeam,
    signals,
    facts,
    stats: {
      deadTime,
      nearMisses: nearMisses.length,
      bounceRate: bounceTimes.length / Math.max(1, w.time),
      leadChanges,
      peakBalls,
      capped: peakBalls >= scene.world.maxBalls,
      scriptError: w.scriptError,
      teamLeadChanges,
      endSpeed: (() => {
        const live = w.balls.filter((b) => b.alive && !b.projectile);
        return live.length ? live.reduce((a, b) => a + Math.hypot(b.vx, b.vy), 0) / live.length : 0;
      })(),
      pendulumSpread: (() => {
        if (w.pendulums.length < 2) return 0;
        const bobs = w.pendulums.map((p) => w.pendulumBob(p));
        let d = 0;
        for (const a of bobs) for (const b of bobs) d = Math.max(d, Math.hypot(a[0] - b[0], a[1] - b[1]));
        return d;
      })(),
    },
    loop,
    markers: [
      ...nearMisses.filter((x) => climax < 0 || x < climax).slice(0, 80).map((x) => ({ t: x, kind: 'near' as const })),
      ...markers,
      ...(climax >= 0 ? [{ t: climax, kind: 'climax' as const }] : []),
    ],
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
