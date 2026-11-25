import assert from 'node:assert/strict';
import { parseScene } from '../src/engine/scene';
import { World } from '../src/engine/world';

/** The winning brush owns a cell even when the two colors cross between video frames. */
export function checkPaintFinish(): void {
  const scene = parseScene({
    title: 'Paint finish', teams: [{ name: 'A' }, { name: 'B' }],
    duration: { max: 0.5, tail: 0.25, endOn: 'mostTerritory' },
    world: { gravity: 0 },
    entities: [
      { type: 'territory', x: 0, y: 0, rows: 2, cols: 2, cell: 40, layout: 'paint' },
      { type: 'ball', x: 20, y: 20, radius: 8, speed: 0, team: 'A' },
      { type: 'ball', x: 60, y: 60, radius: 8, speed: 0, team: 'B' },
    ],
  });
  const tie = new World(scene).runToEnd();
  assert.deepEqual(tie.territory?.counts, [1, 1]);
  assert.equal(tie.endReason, 'mostTerritory');
  assert.equal(tie.winnerTeam, '');

  const w = new World(scene);
  w.step();
  w.balls[0].x = 60;
  w.balls[0].y = 60;
  w.balls[1].x = 160;
  w.step();
  assert.deepEqual(w.territory?.counts, [2, 0]);
  while (!w.endReason) w.step();
  assert.equal(w.winnerTeam, 'A');
  assert.equal(w.climaxStep, 60);
  const cells = w.territory!.owner.slice();
  w.balls[1].x = 20;
  w.balls[1].y = 20;
  w.runToEnd();
  assert.equal(w.stepCount, 120);
  assert.deepEqual(w.territory!.owner, cells);
  assert.deepEqual(w.territory!.counts, [2, 0]);
}
