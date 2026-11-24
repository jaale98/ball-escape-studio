import type { Scene } from '../engine/scene';

/** True if the scene has any custom rule scripts. */
export function hasScripts(scene: Scene): boolean {
  return scene.rules.some((r) => r.script) || scene.timeline.some((t) => t.script);
}

/**
 * Run a scripted scene to the end in a Worker. Resolves with the first script
 * error (or ''), or rejects if it takes longer than `ms` (a script that loops
 * forever would otherwise freeze the page).
 */
export function preflight(scene: Scene, ms = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./preflight.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error(`A custom rule script didn't finish within ${ms / 1000}s of simulation work (an endless loop?). The scene was not started.`));
    }, ms);
    w.onmessage = (e: MessageEvent<{ ok: boolean; scriptError?: string; error?: string }>) => {
      clearTimeout(timer);
      w.terminate();
      if (e.data.ok) resolve(e.data.scriptError ?? '');
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      reject(new Error(e.message));
    };
    w.postMessage(scene);
  });
}
