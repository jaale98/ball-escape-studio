/** Every scene must replay identically: same seed, same final state hash and event log. */
import { readFileSync, readdirSync } from 'node:fs';
import { parseScene } from '../src/engine/scene';
import { World } from '../src/engine/world';

let failed = 0;
for (const name of readdirSync('scenes').filter((f) => f.endsWith('.json')).sort()) {
  const scene = parseScene(JSON.parse(readFileSync(`scenes/${name}`, 'utf8')));
  const a = new World(scene).runToEnd();
  const b = new World(scene).runToEnd();
  const same = a.hash() === b.hash() && a.events.length === b.events.length && a.stepCount === b.stepCount;
  const sanity = a.balls.every((ball) => Number.isFinite(ball.x) && Number.isFinite(ball.y));
  const ok = same && sanity;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${a.endReason.padEnd(11)} ${a.time.toFixed(2)}s  hash ${a.hash()}`);
}
if (failed) {
  console.error(`\n${failed} scene(s) failed`);
  process.exit(1);
}
console.log('\nAll scenes deterministic.');
