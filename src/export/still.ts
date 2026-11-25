import { type Scene } from '../engine/scene';
import { framePlan, timingFor } from '../engine/timing';
import { World } from '../engine/world';
import { withReveal } from '../director/reveal';
import { ensureImages } from '../images';
import { TIKTOK_SAFE } from '../render/look';
import { Renderer } from '../render/renderer';
import { tick } from './mp4';

/**
 * Render the exact frame the MP4 export would show at `seconds`, onto a new
 * 1080x1920 canvas. Every earlier frame is drawn too (trails and particles
 * depend on them), but nothing is encoded, so it is fast. Yields every few
 * frames: one long synchronous burst of GPU canvas work can come back blank.
 */
export async function renderStill(scene: Scene, seconds: number, scale = 1, look: { fps?: number; safe?: boolean } = {}): Promise<HTMLCanvasElement> {
  const FPS = look.fps ?? 60;
  await ensureImages(scene);
  // Thumbnails (small scale) skip the costly full pre-runs: the picture reveal and the slow-motion
  // timing only matter late in a run, and a thumbnail shows its first seconds. Full-size stills
  // (captures) are exact export frames.
  const exact = scale >= 0.5;
  if (exact) scene = withReveal(scene);
  const canvas = document.createElement('canvas');
  const world = new World(scene);
  const renderer = new Renderer(canvas, scene, { scale, glow: scale >= 0.5, fps: FPS, safe: look.safe ? TIKTOK_SAFE : null });
  const target = Math.max(0, Math.round(seconds * FPS));
  // The same frame plan as the export (slow motion and countdown included).
  const pre = exact && scene.camera.slowmo > 0 ? new World(scene).runToEnd() : null;
  const timing = timingFor(scene, pre?.climaxStep ?? -1);
  const plan = framePlan(timing, pre?.stepCount ?? Math.ceil(scene.duration.max * 240) + 4, FPS);
  renderer.render(world, 0);
  for (let i = 1; i <= target && i < plan.length && !world.done; i++) {
    for (let s = 0; s < plan[i]; s++) world.step();
    renderer.intro = Math.max(0, timing.intro - i / FPS);
    renderer.render(world, 1 / FPS);
    if (i % 20 === 0) await tick();
  }
  return canvas;
}
