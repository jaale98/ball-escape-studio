/** Every scene must resolve, and replay identically: same seed, same final state hash and event log. */
import { World } from '../src/engine/world';
import { checkPaintFinish } from './territory-test';
import { quickId } from '../src/director/quick';
import { loadQuick, loadSources, resolveWithSongs } from './scenes';

checkPaintFinish();
const sources = loadSources();
let failed = 0;
for (const name of Object.keys(sources)) {
  try {
    const scene = resolveWithSongs(name, sources);
    const a = new World(scene).runToEnd();
    const b = new World(scene).runToEnd();
    const same = a.hash() === b.hash() && a.events.length === b.events.length && a.stepCount === b.stepCount;
    const sane = a.balls.every((ball) => Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.vx));
    const ok = same && sane && !a.scriptError;
    if (a.scriptError) console.log(`      script error: ${a.scriptError}`);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${a.endReason.padEnd(12)} ${a.time.toFixed(2).padStart(6)}s  hash ${a.hash()}${sane ? '' : '  (non-finite state)'}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name.padEnd(20)} ${(err as Error).message.replace(/\n/g, ' | ')}`);
  }
}
// Quick settings (quick/<scene>.json): each must name a real scene and resolve cleanly.
let quickCount = 0;
try {
  const quick = loadQuick();
  for (const [name, list] of Object.entries(quick)) {
    if (!sources[name]) {
      failed++;
      console.log(`FAIL  quick/${name}.json: no scene named ${name}`);
      continue;
    }
    for (const q of list) {
      quickCount++;
      try {
        resolveWithSongs(name, sources, q);
      } catch (err) {
        failed++;
        console.log(`FAIL  quick/${name}.json "${quickId(q)}": ${(err as Error).message.replace(/\n/g, ' | ')}`);
      }
    }
  }
} catch (err) {
  failed++;
  console.log(`FAIL  ${(err as Error).message.replace(/\n/g, ' | ')}`);
}
if (quickCount) console.log(`\n${quickCount} quick settings resolve (npm run quick scores them).`);
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${Object.keys(sources).length} scenes resolve and replay deterministically.`);
