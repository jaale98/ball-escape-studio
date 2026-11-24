import { FPS, type Scene } from '../engine/scene';
import { framePlan, hasTiming, timingFor } from '../engine/timing';
import { World } from '../engine/world';
import { withReveal } from '../director/reveal';
import { ensureImages } from '../images';
import { Renderer } from '../render/renderer';
import { tick } from './mp4';

/**
 * Render the exact frame the MP4 export would show at `seconds`, onto a new
 * 1080x1920 canvas. Every earlier frame is drawn too (trails and particles
 * depend on them), but nothing is encoded, so it is fast. Yields every few
 * frames: one long synchronous burst of GPU canvas work can come back blank.
 */
export async function renderStill(scene: Scene, seconds: number, scale = 1): Promise<HTMLCanvasElement> {
  await ensureImages(scene);
  scene = withReveal(scene);
  const canvas = document.createElement('canvas');
  const world = new World(scene);
  const renderer = new Renderer(canvas, scene, { scale, glow: scale >= 0.5 });
  const target = Math.max(0, Math.round(seconds * FPS));
  // The same frame plan as the export (slow motion and countdown included).
  const pre = hasTiming(scene) ? new World(scene).runToEnd() : null;
  const timing = timingFor(scene, pre?.climaxStep ?? -1);
  const plan = framePlan(timing, pre?.stepCount ?? Math.ceil(scene.duration.max * 240) + 4);
  renderer.render(world, 0);
  for (let i = 1; i <= target && i < plan.length && !world.done; i++) {
    for (let s = 0; s < plan[i]; s++) world.step();
    renderer.intro = Math.max(0, timing.intro - i / FPS);
    renderer.render(world, 1 / FPS);
    if (i % 20 === 0) await tick();
  }
  return canvas;
}
