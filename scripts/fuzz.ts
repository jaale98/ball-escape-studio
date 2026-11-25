/**
 * Stress test (npm run fuzz): beyond `npm test`'s one run per scene, this
 *
 *  - runs every scene with several seeds and checks the state stays sane
 *    (finite positions and speeds, positive radii, hp never negative, territory
 *    cells conserved, the ball cap respected, the run ending on time);
 *  - stacks every modifier, and random 2–3 modifier combos ("Make it weird"),
 *    onto representative scenes and checks they resolve, run sanely and
 *    replay identically;
 *  - checks the frame plan (slow motion, countdown) covers every step, the
 *    sound mapper only makes finite voices, and the Director and Critic score
 *    every scene without throwing.
 *
 *   npm run fuzz [-- --seeds 6] [-- --quick]
 */
import { SoundMapper } from '../src/audio/sound';
import { critique } from '../src/director/critic';
import { weirdModifiers } from '../src/director/remix';
import { defaultTemplate, scoreRun } from '../src/director/score';
import { Rng } from '../src/engine/rng';
import { MODIFIERS } from '../src/engine/modifiers';
import type { Scene } from '../src/engine/scene';
import { mergeSource, resolveScene } from '../src/engine/source';
import { framePlan, stepTimes, timingFor } from '../src/engine/timing';
import { World } from '../src/engine/world';
import { loadSources, resolveWithSongs } from './scenes';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const seedsArg = args.indexOf('--seeds');
const SEEDS = seedsArg >= 0 ? Number(args[seedsArg + 1]) : quick ? 2 : 5;
const sources = loadSources();
const failures: string[] = [];
let checks = 0;

const fail = (where: string, what: string) => {
  failures.push(`${where}: ${what}`);
  console.log(`FAIL  ${where}: ${what}`);
};

/** Run a world to the end, checking invariants along the way. Returns the finished world. */
function runChecked(scene: Scene, where: string, sampleEvery = 240): World | null {
  let w: World;
  try {
    w = new World(scene);
  } catch (err) {
    fail(where, `world construction threw: ${(err as Error).message}`);
    return null;
  }
  const cells = w.territory ? w.territory.counts.reduce((a, b) => a + b, 0) : 0;
  const limit = Math.ceil((scene.duration.max + scene.duration.tail + 1) * 240);
  try {
    while (!w.done) {
      w.step();
      if (w.stepCount > limit) {
        fail(where, `ran past its time limit (${w.time.toFixed(1)}s)`);
        return null;
      }
      if (w.stepCount % sampleEvery) continue;
      checks++;
      let live = 0;
      for (const b of w.balls) {
        if (!b.alive) continue;
        if (!b.projectile) live++;
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
          fail(where, `ball ${b.id} non-finite at ${w.time.toFixed(2)}s`);
          return null;
        }
        if (!(b.r > 0)) {
          fail(where, `ball ${b.id} radius ${b.r} at ${w.time.toFixed(2)}s`);
          return null;
        }
        if (b.hp !== undefined && b.hp < -1e-9) {
          fail(where, `ball ${b.id} hp ${b.hp}`);
          return null;
        }
        if (Math.hypot(b.vx, b.vy) > 20000) {
          fail(where, `ball ${b.id} speed ${Math.hypot(b.vx, b.vy).toFixed(0)} px/s at ${w.time.toFixed(2)}s`);
          return null;
        }
      }
      if (live > scene.world.maxBalls) {
        fail(where, `${live} balls alive, cap is ${scene.world.maxBalls}`);
        return null;
      }
      if (w.territory && w.territory.counts.reduce((a, b) => a + b, 0) !== cells) {
        fail(where, 'territory cells not conserved');
        return null;
      }
      for (const p of w.pendulums) {
        if (!Number.isFinite(p.t1) || !Number.isFinite(p.t2)) {
          fail(where, `pendulum ${p.id} non-finite`);
          return null;
        }
      }
    }
  } catch (err) {
    fail(where, `step threw at ${w.time.toFixed(2)}s: ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
    return null;
  }
  if (w.scriptError) fail(where, `script error: ${w.scriptError}`);
  return w;
}

/** Timing plan, sound and Director checks on a finished run. */
function checkOutputs(scene: Scene, w: World, where: string): void {
  checks++;
  const plan = framePlan(timingFor(scene, w.climaxStep), w.stepCount);
  const total = plan.reduce((a, b) => a + b, 0);
  if (total !== w.stepCount) fail(where, `frame plan covers ${total} of ${w.stepCount} steps`);
  const times = stepTimes(plan);
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) {
      fail(where, 'frame times go backwards');
      break;
    }
  }
  const mapper = new SoundMapper(scene, w.rhythmK);
  let voices = 0;
  for (const e of w.events) {
    for (const v of mapper.map(e)) {
      voices++;
      if (![v.time, v.delay, v.gain, v.pan].every(Number.isFinite) || v.midi.some((m) => !Number.isFinite(m))) {
        fail(where, `non-finite voice from a ${e.type} event`);
        return;
      }
    }
  }
  for (const v of mapper.climax(w.climaxStep)) if (!Number.isFinite(v.time)) fail(where, 'non-finite climax sound');
  void voices;
}

const t0 = performance.now();

// 1. Every scene, several seeds.
console.log(`Scenes × ${SEEDS} seeds`);
for (const name of Object.keys(sources)) {
  let base: Scene;
  try {
    base = resolveWithSongs(name, sources);
  } catch (err) {
    fail(name, `does not resolve: ${(err as Error).message}`);
    continue;
  }
  for (let k = 0; k < SEEDS; k++) {
    const seed = k === 0 ? base.seed : 1000 + k * 7919;
    const scene = { ...base, seed };
    const w = runChecked(scene, `${name} seed ${seed}`);
    if (w && k === 0) {
      checkOutputs(scene, w, name);
      try {
        const r = scoreRun(base, { seed, speed: 1, spin: 1 }, { template: defaultTemplate(base), target: 30 });
        if (!Number.isFinite(r.score)) fail(name, 'Director score is not finite');
        critique(base, r);
      } catch (err) {
        fail(name, `Director/Critic threw: ${(err as Error).message}`);
      }
    }
  }
  process.stdout.write('.');
}
console.log();

// 2. Every modifier on representative scenes, then random combos.
const BASES = quick ? ['ring-escape', 'hexagon-escape', 'battle-royale'] : ['ring-escape', 'hexagon-escape', 'battle-royale', 'nested-rings', 'plinko', 'ring-breaker', 'weapon-legends', 'rock-paper-scissors'];
const shorten = (merged: Record<string, unknown>) => {
  const d = (merged.duration ??= {}) as Record<string, unknown>;
  d.max = Math.min(Number(d.max ?? 60), 20);
};
const runCombo = (base: string, mods: unknown[], where: string) => {
  let scene: Scene;
  try {
    const merged = mergeSource(base, sources);
    shorten(merged);
    merged.modifiers = [...((merged.modifiers as unknown[]) ?? []), ...mods];
    const name = `__fuzz`;
    scene = resolveScene(name, { ...sources, [name]: merged });
  } catch (err) {
    fail(where, `does not resolve: ${(err as Error).message}`);
    return;
  }
  const a = runChecked(scene, where, 480);
  if (!a) return;
  const b = new World(scene).runToEnd();
  if (a.hash() !== b.hash()) fail(where, 'replays differently');
  checkOutputs(scene, a, where);
};
console.log('Each modifier on each base scene');
for (const base of BASES) {
  if (!(base in sources)) continue;
  for (const mod of Object.keys(MODIFIERS)) runCombo(base, [mod], `${base} + ${mod}`);
  process.stdout.write('.');
}
console.log();
console.log('Random "Make it weird" combos');
const rng = new Rng(7, 'fuzz');
for (let i = 0; i < (quick ? 8 : 40); i++) {
  const base = BASES[rng.int(BASES.length)];
  if (!(base in sources)) continue;
  const mods = weirdModifiers(mergeSource(base, sources), 100 + i);
  runCombo(base, mods, `${base} + weird(${mods.map((m) => (typeof m === 'string' ? m : (m as { use: string }).use)).join(', ')})`);
  process.stdout.write('.');
}
console.log();

console.log(`\n${checks} checks in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) {
  console.error(`${failures.length} failure(s)`);
  process.exit(1);
}
console.log('No problems found.');
