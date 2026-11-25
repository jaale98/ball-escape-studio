/** Director worker: scores a batch of candidate runs off the main thread (and finds landing spots for picture reveals). */
import { PHYSICS_HZ, type Scene } from '../engine/scene';
import { World } from '../engine/world';
import { type DirectorOptions, scoreRun, type Variation } from './score';

type Job = { id: number; scene: Scene; jobs: Variation[]; opts: DirectorOptions } | { id: number; kind: 'landing'; scene: Scene };

self.onmessage = (e: MessageEvent<Job>) => {
  const data = e.data;
  if ('kind' in data) {
    // Picture reveal: where every ball is at the sampling time (default: the end).
    const w = new World({ ...data.scene, style: { ...data.scene.style, revealColors: undefined } });
    const at = data.scene.style.reveal?.at;
    const stop = at !== undefined ? Math.round(at * PHYSICS_HZ) : Infinity;
    while (!w.done && w.stepCount < stop) w.step();
    const spots = w.balls.filter((b) => b.alive && !b.projectile).map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r }));
    (self as unknown as Worker).postMessage({ id: data.id, spots });
    return;
  }
  const { id, scene, jobs, opts } = data;
  const results = jobs.map((v) => scoreRun(scene, v, opts));
  (self as unknown as Worker).postMessage({ id, results });
};
