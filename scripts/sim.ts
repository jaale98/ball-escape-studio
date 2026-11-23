/**
 * Headless simulation runner.
 *
 *   npm run sim -- scenes/ring-escape.json              summary of one run
 *   npm run sim -- ring-escape --seed 42                override the seed
 *   npm run sim -- ring-escape --seeds 1-200 [--target 25]
 *       try many seeds; with --target, sort by how close the ending lands to that many seconds
 *   npm run sim -- ring-escape --events                 also print every bounce / escape / hit
 *   npm run sim -- ring-escape --resolved               print the scene after extends, modifiers, prefabs
 */
import { resolveScene } from '../src/engine/source';
import { World } from '../src/engine/world';
import { loadSources, sceneName } from './scenes';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d/.test(a));
if (!file) {
  console.error('Usage: npm run sim -- <scene> [--seed N] [--seeds A-B] [--target SECONDS] [--events] [--resolved]');
  process.exit(1);
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

let base;
try {
  base = resolveScene(sceneName(file), loadSources());
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
if (args.includes('--resolved')) {
  console.log(JSON.stringify(base, null, 2));
  process.exit(0);
}
const fmt = (s: number) => (s < 0 ? '-' : `${s.toFixed(2)}s`);

function run(seed: number) {
  const t0 = performance.now();
  const w = new World({ ...base!, seed }).runToEnd();
  const climax = w.endReason === 'lastStanding' || w.endReason === 'filled' || w.endReason === 'allEscaped' ? w.time - base!.duration.tail : w.firstEscapeStep < 0 ? -1 : w.firstEscapeStep / 240;
  const winner = w.winner >= 0 ? (w.balls[w.winner].label ?? `ball ${w.winner}`) : '';
  return { seed, end: w.endReason, length: w.time, climax, bounces: w.bounces, escapes: w.uniqueEscapes, balls: w.aliveCount, winner, hash: w.hash(), ms: performance.now() - t0, world: w };
}

const seeds = flag('seeds');
if (seeds) {
  const [a, b] = seeds.split('-').map(Number);
  const target = flag('target') !== undefined ? Number(flag('target')) : undefined;
  const rows = [];
  for (let s = a; s <= b; s++) rows.push(run(s));
  if (target !== undefined) rows.sort((x, y) => Math.abs(x.climax - target) - Math.abs(y.climax - target));
  console.log('seed   end          length   climax   bounces  escapes  alive  winner');
  for (const r of rows.slice(0, 40)) {
    console.log(
      `${String(r.seed).padEnd(6)} ${r.end.padEnd(12)} ${fmt(r.length).padStart(7)}  ${fmt(r.climax).padStart(7)}  ${String(r.bounces).padStart(7)}  ${String(r.escapes).padStart(7)}  ${String(r.balls).padStart(5)}  ${r.winner}`,
    );
  }
  const total = rows.reduce((n, r) => n + r.ms, 0);
  console.log(`\n${rows.length} runs in ${total.toFixed(0)} ms (${(total / rows.length).toFixed(1)} ms per run). climax = first escape, last elimination, or fill.`);
} else {
  const r = run(flag('seed') !== undefined ? Number(flag('seed')) : base.seed);
  if (args.includes('--events')) {
    for (const e of r.world.events) {
      if (e.type === 'spawn' || e.type === 'gravity') continue;
      console.log(`${(e.step / 240).toFixed(3)}s ${e.type.padEnd(9)} ball ${e.ball}${e.ring >= 0 ? ` container ${e.ring}` : ''}${e.solid >= 0 ? ` solid ${e.solid}` : ''}${e.zone >= 0 ? ` zone ${e.zone}` : ''} speed ${e.speed.toFixed(0)}`);
    }
  }
  console.log(`scene        ${base.title}`);
  console.log(`seed         ${r.seed}`);
  console.log(`ended        ${r.end} at ${fmt(r.length)}`);
  console.log(`climax       ${fmt(r.climax)}`);
  if (r.winner) console.log(`winner       ${r.winner}`);
  console.log(`bounces      ${r.bounces}`);
  console.log(`escapes      ${r.escapes}`);
  console.log(`balls alive  ${r.balls} of ${r.world.balls.length}`);
  if (r.world.zones.length) console.log(`zones        ${r.world.zones.map((z) => z.count).join(' ')}`);
  console.log(`state hash   ${r.hash}`);
  console.log(`sim time     ${r.ms.toFixed(1)} ms`);
}
