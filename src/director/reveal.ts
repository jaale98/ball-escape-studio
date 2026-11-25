/**
 * Picture reveal: run the scene once, see where every ball ends up, and color
 * each ball by the word or picture at its landing spot. Colors don't change
 * the physics, so the real run lands the same way and the picture appears.
 *
 * Browser only (it draws the word or picture onto a canvas to sample it).
 */
import { HEIGHT, PHYSICS_HZ, type Scene, WIDTH } from '../engine/scene';
import { World } from '../engine/world';
import { getImage } from '../images';

export interface Spot {
  id: number;
  x: number;
  y: number;
  r: number;
}

/** A copy of the scene with style.revealColors filled in (or the scene itself if it has no reveal). */
export function withReveal(scene: Scene, finished?: World): Scene {
  const reveal = scene.style.reveal;
  if (!reveal || (!reveal.text && !reveal.image)) return scene;
  // Where every ball is at the sampling time.
  let world = finished;
  const at = reveal.at;
  if (!world || at !== undefined) {
    world = new World({ ...scene, style: { ...scene.style, revealColors: undefined } });
    const stop = at !== undefined ? Math.round(at * PHYSICS_HZ) : Infinity;
    while (!world.done && world.stepCount < stop) world.step();
  }
  const spots = world.balls.filter((b) => b.alive && !b.projectile).map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r }));
  const colors = revealColors(scene, spots);
  return colors ? { ...scene, style: { ...scene.style, revealColors: colors } } : scene;
}

/** Color per ball id: the word or picture sampled at each ball's landing spot. */
export function revealColors(scene: Scene, balls: Spot[]): string[] | null {
  const reveal = scene.style.reveal;
  if (!reveal || (!reveal.text && !reveal.image) || !balls.length) return null;
  // The picture fills the box the balls settled into.
  // (2nd–98th percentile, so a few strays don't stretch it.)
  const xs = balls.map((b) => b.x).sort((a, b) => a - b);
  const ys = balls.map((b) => b.y).sort((a, b) => a - b);
  const pct = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];
  const r = balls[0].r;
  const x0 = pct(xs, 0.02) - r;
  const x1 = pct(xs, 0.98) + r;
  const y0 = pct(ys, 0.02) - r;
  const y1 = pct(ys, 0.98) + r;
  const w = Math.max(10, x1 - x0);
  const h = Math.max(10, y1 - y0);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const dark = '#2a2a38';
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const img = getImage(reveal.image);
  if (img) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    ctx.drawImage(img, x0 + w / 2 - (img.naturalWidth * s) / 2, y0 + h / 2 - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  } else if (reveal.text) {
    // Big bold letters across the pile, in a rainbow from left to right.
    const text = reveal.text;
    let size = h * 0.85;
    ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
    const tw = ctx.measureText(text).width;
    if (tw > w * 0.94) size *= (w * 0.94) / tw;
    ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    const pal = scene.style.palette;
    pal.forEach((c, i) => g.addColorStop(pal.length > 1 ? i / (pal.length - 1) : 0, c));
    ctx.fillStyle = g;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + w / 2, y0 + h / 2 + size * 0.05);
  }
  const data = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  const colors: string[] = [];
  for (const b of balls) {
    const px = Math.max(0, Math.min(WIDTH - 1, Math.round(b.x)));
    const py = Math.max(0, Math.min(HEIGHT - 1, Math.round(b.y)));
    const i = (py * WIDTH + px) * 4;
    colors[b.id] = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  for (let i = 0; i < colors.length; i++) colors[i] ??= dark;
  return colors;
}
