/**
 * Swipe review: candidates one at a time, full size. Keep (→ / swipe right)
 * sends it to the export queue; Discard (← / swipe left) moves on.
 */
import type { GridItem } from './director';
import { Player } from './player';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface ReviewHooks {
  keep(item: GridItem): void;
  exit(): void;
  /** Where to play sound (null = silent). */
  audio?: () => { ctx: AudioContext; master: AudioNode } | null;
}

let list: GridItem[] = [];
let index = 0;
let kept = 0;
let player: Player | null = null;
let raf = 0;
let hooks: ReviewHooks;
let wired = false;

export function startReview(candidates: GridItem[], h: ReviewHooks): void {
  list = candidates;
  hooks = h;
  index = 0;
  kept = 0;
  $('review').hidden = false;
  if (!wired) wire();
  show();
  let last = performance.now();
  const loop = (now: number) => {
    player?.tick(Math.min(0.1, (now - last) / 1000));
    last = now;
    raf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function show(): void {
  if (index >= list.length) return finish();
  const it = list[index];
  const r = it.r;
  player = new Player($<HTMLCanvasElement>('r-canvas'), it.scene, 0.5, hooks.audio);
  $('r-count').textContent = `${index + 1} / ${list.length} · kept ${kept}`;
  $('r-meta').textContent = `${it.title} · seed ${r.seed}${r.speed !== 1 || r.spin !== 1 ? ` · speed ×${r.speed} spin ×${r.spin}` : ''} · ${r.facts.join(', ')}`;
}

function decide(keep: boolean): void {
  if ($('review').hidden || index >= list.length) return;
  if (keep) {
    kept++;
    hooks.keep(list[index]);
  }
  index++;
  show();
}

function finish(): void {
  cancelAnimationFrame(raf);
  player = null;
  $('review').hidden = true;
  hooks.exit();
}

function wire(): void {
  wired = true;
  $('r-keep').addEventListener('click', () => decide(true));
  $('r-discard').addEventListener('click', () => decide(false));
  $('r-exit').addEventListener('click', finish);
  document.addEventListener('keydown', (e) => {
    if ($('review').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'k') decide(true);
    else if (e.key === 'ArrowLeft' || e.key === 'j') decide(false);
    else if (e.key === 'Escape') finish();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  // Swipe on touch screens / trackpads with a pointer drag.
  let startX = 0;
  const c = $('r-canvas');
  c.addEventListener('pointerdown', (e) => (startX = e.clientX));
  c.addEventListener('pointerup', (e) => {
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 60) decide(dx > 0);
  });
}
