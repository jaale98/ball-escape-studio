/**
 * Runs a Director search across a pool of Web Workers: every candidate in
 * phase 1, then (with variation on) a refinement round around the best five.
 */
import type { Scene } from '../engine/scene';
import { candidates, type DirectorOptions, refinements, type RunScore, type Variation } from './score';

export interface Search {
  done: Promise<RunScore[]>;
  cancel(): void;
}

export function direct(scene: Scene, opts: DirectorOptions, count: number, vary: number, onProgress: (done: number, total: number) => void): Search {
  const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const workers = Array.from({ length: size }, () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  let cancelled = false;
  const stop = () => workers.forEach((w) => w.terminate());

  const runAll = (jobs: Variation[], doneBefore: number, total: number) =>
    new Promise<RunScore[]>((resolve, reject) => {
      const batches: Variation[][] = [];
      for (let i = 0; i < jobs.length; i += 6) batches.push(jobs.slice(i, i + 6));
      const results: RunScore[] = [];
      let next = 0;
      let finished = 0;
      if (!batches.length) return resolve(results);
      const feed = (w: Worker) => {
        if (cancelled) return reject(new Error('cancelled'));
        if (next >= batches.length) return;
        const id = next++;
        w.postMessage({ id, scene, jobs: batches[id], opts });
      };
      for (const w of workers) {
        w.onmessage = (e: MessageEvent<{ results: RunScore[] }>) => {
          results.push(...e.data.results);
          finished++;
          onProgress(doneBefore + results.length, total);
          if (finished === batches.length) resolve(results);
          else feed(w);
        };
        w.onerror = (e) => reject(new Error(e.message));
        feed(w);
      }
    });

  const done = (async () => {
    try {
      const first = candidates(count, vary);
      const refineCount = vary > 0 ? 5 * 8 : 0;
      const total = count + refineCount;
      let results = await runAll(first, 0, total);
      results.sort((a, b) => b.score - a.score);
      if (vary > 0) {
        results = results.concat(await runAll(refinements(results.slice(0, 5), 8, vary), count, total));
        results.sort((a, b) => b.score - a.score);
      }
      return results;
    } finally {
      stop();
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}
