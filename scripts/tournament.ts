/**
 * Build a knockout tournament from a battle scene and write every match as a scene file.
 *
 *   npm run tournament -- country-battle "Brazil,Japan,France,Canada,Italy,Mexico,Kenya,Sweden" [--name world-cup] [--dry]
 */
import { writeFileSync } from 'node:fs';
import { entrantsFrom, tournament } from '../src/director/tournament';
import { loadSources, sceneName } from './scenes';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (args.length < 2) {
  console.error('Usage: npm run tournament -- <battle-scene> "Name A,Name B,..." [--name prefix] [--dry]');
  process.exit(1);
}
const base = sceneName(args[0]);
const prefix = flag('name') ?? `${base}-cup`;
const t0 = performance.now();
const matches = tournament(base, loadSources(), entrantsFrom(args[1].split(',')), prefix);
for (const m of matches) {
  console.log(`${m.roundName.padEnd(13)} ${`${m.a.label} vs ${m.b.label}`.padEnd(28)} → ${m.winner.label.padEnd(12)} seed ${String(m.seed).padEnd(4)} climax ${m.climax.toFixed(1)}s   scenes/${m.name}.json`);
  if (!process.argv.includes('--dry')) writeFileSync(`scenes/${m.name}.json`, `${JSON.stringify({ $schema: '../scene.schema.json', ...m.raw }, null, 2)}\n`);
}
console.log(`\nChampion: ${matches[matches.length - 1].winner.label}. ${matches.length} matches in ${((performance.now() - t0) / 1000).toFixed(1)}s${process.argv.includes('--dry') ? ' (dry run: nothing written)' : ''}.`);
