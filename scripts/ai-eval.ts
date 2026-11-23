/**
 * Prompt-box eval: runs N scene requests through Claude Code (on your Claude
 * plan, exactly as the studio does) and checks each result.
 *
 *   npm run eval:ai                  all prompts, fast model
 *   npm run eval:ai -- --smart       use the smart model
 *   npm run eval:ai -- --only 3      run one prompt
 *   npm run eval:ai -- --keep        keep the generated eval-* scenes
 *
 * A result passes when Claude wrote scenes/eval-N.json, it resolves and
 * validates, and the simulation runs to a sensible end. Reports time to the
 * first scene write (when the preview would update) and total time.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolveScene } from '../src/engine/source';
import { World } from '../src/engine/world';
import { runClaude } from '../server/claude';
import { loadSources } from './scenes';

const PROMPTS = [
  'a ball escaping a spinning ring where the gap shrinks every bounce, purple theme',
  'three balls racing out of a hexagon, with names Alpha, Bravo and Charlie',
  'a battle royale with 6 balls named after planets, 8 hp each',
  'nested rings, 8 of them, rainbow colors, ending around 40 seconds',
  'plinko with 12 bins and 7 rows of pegs',
  'one ball that grows every bounce in a slow ring, played on marimba',
  'a ring escape where gravity flips every 3 seconds and the ring spins fast',
  'paint the ring with 4 balls, no gravity, pastel colors',
  'every escape spawns 3 new balls, max 120 balls, 30 seconds',
  'a square (4-sided polygon) with a small exit on one side, the ball speeds up every bounce',
];

const args = process.argv.slice(2);
const model = args.includes('--smart') ? 'smart' : 'fast';
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : undefined;
const root = process.cwd();

async function one(i: number, idea: string) {
  const name = `eval-${i}`;
  const file = `scenes/${name}.json`;
  rmSync(file, { force: true });
  const started = Date.now();
  let firstWrite = 0;
  let ok = false;
  let note = '';
  await new Promise<void>((done) => {
    runClaude(
      {
        prompt: `Create a new scene named ${name}: ${idea}`,
        root,
        model,
        onWrite: (abs) => {
          if (!firstWrite && abs.endsWith(`${name}.json`)) firstWrite = Date.now();
        },
      },
      (e) => {
        if (e.type === 'done') {
          ok = e.ok;
          note = e.text.replace(/\s+/g, ' ').slice(0, 140);
          done();
        } else if (e.type === 'error') {
          note = e.message.slice(0, 200);
          done();
        }
      },
    );
  });
  const total = (Date.now() - started) / 1000;
  let valid = false;
  let detail = '';
  if (existsSync(file)) {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
      const w = new World(resolveScene(name, loadSources())).runToEnd();
      valid = Number.isFinite(w.time) && w.time > 3;
      detail = `${w.endReason} at ${w.time.toFixed(1)}s, ${w.bounces} bounces${w.winner >= 0 ? `, winner ${w.balls[w.winner].label ?? w.winner}` : ''}`;
    } catch (err) {
      detail = (err as Error).message.replace(/\n/g, ' | ').slice(0, 200);
    }
  } else detail = 'no scene file written';
  return { i, ok: ok && valid, firstWrite: firstWrite ? (firstWrite - started) / 1000 : NaN, total, detail, note };
}

const results = [];
for (const [i, idea] of PROMPTS.entries()) {
  if (only !== undefined && only !== i + 1) continue;
  process.stdout.write(`${i + 1}. ${idea}\n`);
  const r = await one(i + 1, idea);
  results.push(r);
  console.log(`   ${r.ok ? 'PASS' : 'FAIL'}  first write ${Number.isNaN(r.firstWrite) ? '-' : `${r.firstWrite.toFixed(1)}s`}, total ${r.total.toFixed(1)}s  ${r.detail}`);
  if (!r.ok && r.note) console.log(`   claude: ${r.note}`);
}
const passed = results.filter((r) => r.ok).length;
const writes = results.map((r) => r.firstWrite).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
const median = writes.length ? writes[Math.floor(writes.length / 2)] : NaN;
console.log(`\n${passed}/${results.length} valid (${model} model). Median time to first scene write: ${Number.isNaN(median) ? '-' : `${median.toFixed(1)}s`}.`);
if (!args.includes('--keep')) for (const r of results) rmSync(`scenes/eval-${r.i}.json`, { force: true });
