/**
 * Quick settings (quick/<scene>.json): check and tune them.
 *
 *   npm run quick                                  check every quick setting: resolve, run, score
 *   npm run quick -- ring-escape                   one scene (several: ring-escape,plinko)
 *   npm run quick -- ring-escape --tune            tune each one's seed for its story and write it back
 *       [--only buzzer-beater] [--seeds 1-600] [--force] (take the best seed even if the current one is close)
 *   npm run quick -- --tune --shard 2/8            split the scenes over several processes
 *   npm run quick -- --tune --missing              only quick settings that have no seed yet
 *   npm run quick -- my-scene --suggest            write a starter set for a scene without quick settings, then tune it
 *   npm run quick -- --suggest                     ...for every scene without quick settings
 *       --budget 60: seconds of searching per quick setting (heavy scenes try fewer seeds)
 *
 * A quick setting is checked with its own story and target (or the scene's defaults).
 * Problems: the clock runs out, a stalker catches the last ball, no climax, a weak score, or a
 * length outside 8–65 s.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { problems, type Quick, quickId, quickStory, suggestQuick } from '../src/director/quick';
import { candidates, type RunScore, scoreRun } from '../src/director/score';
import type { Scene } from '../src/engine/scene';
import { loadQuick, loadSources, resolveWithSongs } from './scenes';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flagValues = new Set(['--only', '--seeds', '--shard', '--budget'].map((f) => flag(f.slice(2))).filter(Boolean));
const wanted = args.find((a) => !a.startsWith('--') && !flagValues.has(a));
const suggest = args.includes('--suggest');
const tune = args.includes('--tune') || suggest;
const force = args.includes('--force');
const missing = args.includes('--missing');
const budget = Number(flag('budget') ?? 60);
const only = flag('only');
const [seedA, seedB] = (flag('seeds') ?? '1-600').split('-').map(Number);
const [shardI, shardN] = (flag('shard') ?? '1/1').split('/').map(Number);

const sources = loadSources();
const suggested: string[] = [];
if (suggest) {
  // Starter sets for scenes with no quick file (or the named ones), tuned below.
  const targets = wanted ? wanted.split(',') : Object.keys(sources).filter((n) => !existsSync(`quick/${n}.json`));
  mkdirSync('quick', { recursive: true });
  for (const n of targets) {
    if (!sources[n]) {
      console.error(`No scene named ${n}`);
      process.exit(1);
    }
    if (existsSync(`quick/${n}.json`)) {
      console.log(`quick/${n}.json already exists; leaving it (delete it to start over).`);
      continue;
    }
    const list = suggestQuick(n, resolveWithSongs(n, sources));
    writeFileSync(`quick/${n}.json`, `${JSON.stringify({ $schema: '../quick.schema.json', quick: list }, null, 2)}\n`);
    console.log(`wrote quick/${n}.json (${list.length} quick settings)`);
    suggested.push(n);
  }
}
const all = loadQuick();
let names = Object.keys(all).sort();
const orphans = names.filter((n) => !sources[n]);
names = names.filter((n) => sources[n]);
if (wanted) {
  const list = wanted.split(',');
  const missing = list.filter((n) => !all[n]);
  if (missing.length) {
    console.error(`No quick settings for: ${missing.join(', ')} (quick/<scene>.json)`);
    process.exit(1);
  }
  names = list;
}
if (suggest && !wanted) names = suggested;
names = names.filter((_, i) => i % shardN === shardI - 1);


const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
let bad = 0;
let total = 0;
let changed = 0;
const t0 = performance.now();

for (const name of names) {
  const file = `quick/${name}.json`;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { quick: Quick[] };
  let dirty = false;
  console.log(`== ${name}`);
  for (let i = 0; i < all[name].length; i++) {
    const q = all[name][i];
    const id = quickId(q);
    if (only && id !== only) continue;
    if (missing && q.seed !== undefined) continue;
    total++;
    let base: Scene;
    try {
      base = resolveWithSongs(name, sources, { ...q, seed: undefined });
    } catch (err) {
      bad++;
      console.log(`  FAIL  ${pad(q.name, 22)} ${(err as Error).message.replace(/\n/g, ' | ')}`);
      continue;
    }
    const opts = quickStory(base, q);
    const seed = q.seed ?? base.seed;
    // The original scene under the same story: how good this format gets on its own.
    const original = resolveWithSongs(name, sources);
    const baseline = scoreRun(original, { seed: original.seed, speed: 1, spin: 1 }, opts).score;
    const issuesOf = (x: RunScore) => problems(x, baseline);
    const t1 = performance.now();
    let r = scoreRun(base, { seed, speed: 1, spin: 1 }, opts);
    const cost = (performance.now() - t1) / 1000;
    if (tune) {
      // Heavy scenes (thousands of beads) try fewer seeds: about `budget` seconds each.
      const count = Math.max(24, Math.min(seedB - seedA + 1, Math.floor(budget / Math.max(cost, 1e-3))));
      const results = candidates(count, 0, seedA).map((v) => scoreRun(base, v, opts));
      results.sort((a, b) => b.score - a.score || issuesOf(a).length - issuesOf(b).length);
      // Every quick setting should be a different run: skip seeds the scene or its other quick settings use.
      const used = new Set<number>([(sources[name] as { seed?: number }).seed ?? 1, ...raw.quick.filter((_, j) => j !== i).map((x) => x.seed).filter((x): x is number => x !== undefined)]);
      const fresh = results.filter((x) => !used.has(x.seed));
      const best = fresh.find((x) => !issuesOf(x).length) ?? results.find((x) => !issuesOf(x).length) ?? fresh[0] ?? results[0];
      const clash = used.has(r.seed);
      if (best && (force || clash || q.seed === undefined || best.score > r.score + 0.5 || (issuesOf(r).length && !issuesOf(best).length))) {
        if (best.seed !== q.seed) {
          raw.quick[i].seed = best.seed;
          dirty = true;
          changed++;
        }
        // A perfect loop is a seed plus the seamless stretch the Director found in it.
        if (best.loop) {
          const patch = (raw.quick[i].patch ??= {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
          patch.duration = { ...patch.duration, max: best.loop.to, trimStart: best.loop.from, endOn: 'never', tail: 0 };
          patch.overlay = { ...patch.overlay, timer: false };
          dirty = true;
        }
        r = best;
      }
    }
    const issues = issuesOf(r);
    if (issues.length) bad++;
    console.log(`  ${issues.length ? 'WARN' : 'ok  '}  ${pad(q.name, 22)} seed ${String(r.seed).padEnd(5)} ${r.score.toFixed(1).padStart(5)}  ${opts.template}@${opts.target}  ${r.facts.join(', ')}${issues.length ? `  <- ${issues.join(', ')}` : ''}`);
  }
  if (dirty) {
    // Keep "seed" right after the descriptive fields so the files stay readable.
    raw.quick = raw.quick.map((q) => {
      const { name: n, emoji, kind, note, seed, ...rest } = q;
      return { name: n, emoji, kind, note, seed, ...rest } as Quick;
    });
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  }
}

if (orphans.length) console.log(`\nQuick files for scenes that don't exist: ${orphans.map((n) => `quick/${n}.json`).join(', ')}`);
console.log(`\n${total} quick settings in ${((performance.now() - t0) / 1000).toFixed(1)}s: ${total - bad} ok, ${bad} with problems${tune ? `, ${changed} seeds updated` : ''}.`);
if (bad && !tune) process.exitCode = 1;
