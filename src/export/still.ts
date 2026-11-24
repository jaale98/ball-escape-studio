import { FPS, type Scene, STEPS_PER_FRAME } from '../engine/scene';
import { World } from '../engine/world';
import { Renderer } from '../render/renderer';
import { tick } from './mp4';

/**
 * Render the exact frame the MP4 export would show at `seconds`, onto a new
 * 1080x1920 canvas. Every earlier frame is drawn too (trails and particles
 * depend on them), but nothing is encoded, so it is fast. Yields every few
 * frames: one long synchronous burst of GPU canvas work can come back blank.
 */
export async function renderStill(scene: Scene, seconds: number, scale = 1): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const world = new World(scene);
  const renderer = new Renderer(canvas, scene, { scale, glow: scale >= 0.5 });
  const target = Math.max(0, Math.round(seconds * FPS));
  renderer.render(world, 0);
  for (let i = 1; i <= target && !world.done; i++) {
    for (let s = 0; s < STEPS_PER_FRAME; s++) world.step();
    renderer.render(world, 1 / FPS);
    if (i % 20 === 0) await tick();
  }
  return canvas;
}
