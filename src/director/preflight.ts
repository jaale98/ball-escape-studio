/** Runs a scripted scene headless off the main thread, to catch scripts that never finish. */
import type { Scene } from '../engine/scene';
import { World } from '../engine/world';

self.onmessage = (e: MessageEvent<Scene>) => {
  try {
    const w = new World(e.data).runToEnd();
    (self as unknown as Worker).postMessage({ ok: true, scriptError: w.scriptError, time: w.time });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
