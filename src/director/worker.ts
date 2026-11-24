/** Director worker: scores a batch of candidate runs off the main thread. */
import type { Scene } from '../engine/scene';
import { type DirectorOptions, scoreRun, type Variation } from './score';

self.onmessage = (e: MessageEvent<{ id: number; scene: Scene; jobs: Variation[]; opts: DirectorOptions }>) => {
  const { id, scene, jobs, opts } = e.data;
  const results = jobs.map((v) => scoreRun(scene, v, opts));
  (self as unknown as Worker).postMessage({ id, results });
};
