/**
 * Tournaments: a knockout bracket of one-on-one battles built from a battle
 * scene. Every match is a scene (extending the base) whose seed the Director
 * picks for a close fight; the winner of each match goes on to the next round.
 * Deterministic, so the whole bracket is known before anything is rendered.
 */
import { hashString } from '../engine/rng';
import { mergeSource, resolveScene } from '../engine/source';
import { candidates, scoreRun } from './score';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Entrant {
  label: string;
  color: string;
}

export interface Match {
  round: number;
  roundName: string;
  index: number;
  name: string;
  raw: Raw;
  a: Entrant;
  b: Entrant;
  winner: Entrant;
  seed: number;
  climax: number;
}

const COLORS = ['#ff4d6d', '#4dd4ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c', '#ffffff', '#ff7ad9', '#63e6be', '#ffa8a8', '#74c0fc', '#d8f5a2', '#e599f7', '#ffc078', '#a5d8ff', '#b2f2bb'];

export function entrantsFrom(list: string[]): Entrant[] {
  return list.map((label, i) => ({ label: label.trim(), color: COLORS[i % COLORS.length] })).filter((e) => e.label);
}

function roundName(round: number, rounds: number): string {
  const left = rounds - round;
  return left === 0 ? 'Final' : left === 1 ? 'Semifinal' : left === 2 ? 'Quarterfinal' : `Round ${round}`;
}

/**
 * Build the bracket. `base` must be a battle scene (endOn: lastStanding).
 * `seeds` candidates are tried per match; the closest, most dramatic fight wins.
 */
export function tournament(base: string, sources: Record<string, unknown>, entrants: Entrant[], prefix: string, seeds = 60, target = 25): Match[] {
  if (entrants.length < 2 || (entrants.length & (entrants.length - 1)) !== 0) throw new Error('A bracket needs 2, 4, 8 or 16 entrants.');
  const merged = mergeSource(base, sources);
  const resolved = resolveScene(base, sources);
  if (resolved.duration.endOn !== 'lastStanding') throw new Error(`"${base}" is not a battle (duration.endOn must be lastStanding).`);
  const ballIndex = (merged.entities as Raw[]).findIndex((e) => e.type === 'ball');
  const rounds = Math.log2(entrants.length);
  const matches: Match[] = [];
  let alive = entrants;
  for (let round = 1; round <= rounds; round++) {
    const next: Entrant[] = [];
    for (let i = 0; i < alive.length; i += 2) {
      const [a, b] = [alive[i], alive[i + 1]];
      const name = `${prefix}-r${round}-m${i / 2 + 1}`;
      const entities = (merged.entities as Raw[]).map((e, k) => (k === ballIndex ? { ...structuredClone(e), count: 2, labels: [a.label, b.label], colors: [a.color, b.color], spread: Math.min(e.spread ?? 200, 200) } : structuredClone(e)));
      const rn = roundName(round, rounds);
      const raw: Raw = { extends: base, title: `${rn}: ${a.label} vs ${b.label}`, entities, overlay: { title: `${a.label} vs ${b.label}`, subtitle: rn } };
      const scene = resolveScene(name, { ...sources, [name]: raw });
      // Each match searches its own seed range (from the fighters' names), so
      // matches differ and nobody wins just by being listed second.
      const first = 1 + (hashString(`${a.label}|${b.label}|${round}`) % 100000);
      const runs = candidates(seeds, 0, first).map((v) => scoreRun(scene, v, { template: 'comeback', target }));
      runs.sort((x, y) => y.score - x.score);
      // Prefer fights that finish near the target length (a bracket should pace evenly).
      const onTime = runs.filter((r) => r.winner && Math.abs(r.climax - target) < 0.35 * target);
      const best = onTime[0] ?? runs.find((r) => r.winner) ?? runs[0];
      raw.seed = best.seed;
      const winner = best.winner === b.label ? b : a;
      matches.push({ round, roundName: rn, index: i / 2 + 1, name, raw, a, b, winner, seed: best.seed, climax: best.climax });
      next.push(winner);
    }
    alive = next;
  }
  return matches;
}
