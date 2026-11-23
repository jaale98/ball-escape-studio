/**
 * Headless simulation runner.
 *
 *   npm run sim -- scenes/ring-escape.json              summary of one run
 *   npm run sim -- scenes/ring-escape.json --seed 42    override the seed
 *   npm run sim -- scenes/ring-escape.json --seeds 1-200 [--target 25]
 *       try many seeds; with --target, sort by closeness of the ending to that many seconds
 *   npm run sim -- scenes/ring-escape.json --events     also print every bounce/escape
 */
import { readFileSync } from 'node:fs';
import { parseScene } from '../src/engine/scene';
import { World } from '../src/engine/world';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: npm run sim -- <scene.json> [--seed N] [--seeds A-B] [--target SECONDS] [--events]');
  process.exit(1);
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const base = parseScene(JSON.parse(readFileSync(file, 'utf8')));
const fmt = (s: number) => (s < 0 ? '-' : `${s.toFixed(2)}s`);

function run(seed: number) {
  const t0 = performance.now();
  const w = new World({ ...base, seed }).runToEnd();
  return {
    seed,
    end: w.endReason,
    length: w.time,
    firstEscape: w.firstEscapeStep < 0 ? -1 : w.firstEscapeStep / 240,
    bounces: w.bounces,
    escapes: w.escapes,
    balls: w.balls.length,
    hash: w.hash(),
    ms: performance.now() - t0,
    world: w,
  };
}

const seeds = flag('seeds');
if (seeds) {
  const [a, b] = seeds.split('-').map(Number);
  const target = flag('target') !== undefined ? Number(flag('target')) : undefined;
  const rows = [];
  for (let s = a; s <= b; s++) rows.push(run(s));
  if (target !== undefined) rows.sort((x, y) => Math.abs(x.firstEscape - target) - Math.abs(y.firstEscape - target));
  console.log('seed   end         length   1st escape  bounces  escapes');
  for (const r of rows.slice(0, 40)) {
    console.log(
      `${String(r.seed).padEnd(6)} ${r.end.padEnd(11)} ${fmt(r.length).padStart(7)}  ${fmt(r.firstEscape).padStart(9)}  ${String(r.bounces).padStart(7)}  ${String(r.escapes).padStart(7)}`,
    );
  }
  const total = rows.reduce((n, r) => n + r.ms, 0);
  console.log(`\n${rows.length} runs in ${total.toFixed(0)} ms (${(total / rows.length).toFixed(1)} ms per run)`);
} else {
  const r = run(flag('seed') !== undefined ? Number(flag('seed')) : base.seed);
  if (args.includes('--events')) {
    for (const e of r.world.events) {
      if (e.type === 'bounce' || e.type === 'escape') {
        console.log(`${(e.step / 240).toFixed(3)}s ${e.type.padEnd(7)} ball ${e.ball} ring ${e.ring} speed ${e.speed.toFixed(0)}`);
      }
    }
  }
  console.log(`scene        ${base.title}`);
  console.log(`seed         ${r.seed}`);
  console.log(`ended        ${r.end} at ${fmt(r.length)}`);
  console.log(`first escape ${fmt(r.firstEscape)}`);
  console.log(`bounces      ${r.bounces}`);
  console.log(`escapes      ${r.escapes}`);
  console.log(`balls        ${r.balls}`);
  console.log(`state hash   ${r.hash}`);
  console.log(`sim time     ${r.ms.toFixed(1)} ms`);
}
