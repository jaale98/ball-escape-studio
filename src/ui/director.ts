/**
 * Director view: search hundreds of runs for the chosen story shape, then show
 * the best nine playing side by side. Use one, review them one by one, or send
 * the best to the export queue.
 */
import { direct, type Search } from '../director/pool';
import { applyVariation, type RunScore, type Template, TEMPLATES } from '../director/score';
import type { Scene } from '../engine/scene';
import { Player } from './player';
import { startReview } from './review';

export interface DirectorHooks {
  /** Current resolved scene (with tweaks and MIDI timing). */
  scene(): Scene | null;
  sceneName(): string;
  /** Apply a result to the studio (seed + speed/spin tweaks). */
  use(r: RunScore): void;
  /** Send a result to the export queue. */
  keep(r: RunScore): void;
  /** Pause/resume the main preview while this view is open. */
  setOpen(open: boolean): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let hooks: DirectorHooks;
let results: RunScore[] = [];
let resultsFor = '';
let players: Player[] = [];
let raf = 0;
let search: Search | null = null;

export function initDirector(h: DirectorHooks): void {
  hooks = h;
  const tpl = $<HTMLSelectElement>('d-template');
  tpl.replaceChildren(...Object.entries(TEMPLATES).map(([k, t]) => new Option(t.label, k)));
  tpl.addEventListener('change', describe);
  $('open-director').addEventListener('click', open);
  $('d-close').addEventListener('click', close);
  $('d-run').addEventListener('click', () => void run());
  $('d-review').addEventListener('click', () => {
    const scene = hooks.scene();
    if (!scene || !results.length) return;
    stopLoop();
    $('director').hidden = true;
    startReview(results.slice(0, 20), scene, {
      keep: (r) => hooks.keep(r),
      exit: () => {
        $('director').hidden = false;
        startLoop();
      },
    });
  });
  $('d-queue-top').addEventListener('click', () => results.slice(0, 3).forEach((r) => hooks.keep(r)));
}

function describe(): void {
  const t = $<HTMLSelectElement>('d-template').value as Template;
  $('d-desc').textContent = TEMPLATES[t].description;
}

/** Pick a sensible story for the scene. */
function defaultTemplate(scene: Scene): Template {
  if (scene.audio.rhythmLock || (scene.audio.noteTimes && scene.audio.melody.startsWith('midi:'))) return 'music-sync';
  if (scene.duration.endOn === 'lastStanding') return 'comeback';
  if (scene.duration.endOn === 'never') return 'chaos';
  return 'slow-burn';
}

function open(): void {
  const scene = hooks.scene();
  if (!scene) return;
  hooks.setOpen(true);
  $('director').hidden = false;
  if (resultsFor !== hooks.sceneName()) {
    results = [];
    $('d-grid').replaceChildren();
    $<HTMLSelectElement>('d-template').value = defaultTemplate(scene);
    const target = scene.duration.endOn === 'never' ? Math.round(scene.duration.max * 0.75) : Math.round(Math.min(45, scene.duration.max * 0.6));
    $<HTMLInputElement>('d-target').value = String(target);
  }
  $('d-scene').textContent = hooks.sceneName();
  describe();
  setFooter();
  startLoop();
}

function close(): void {
  search?.cancel();
  search = null;
  stopLoop();
  $('director').hidden = true;
  hooks.setOpen(false);
}

async function run(): Promise<void> {
  const scene = hooks.scene();
  if (!scene) return;
  search?.cancel();
  stopLoop();
  const template = $<HTMLSelectElement>('d-template').value as Template;
  const target = Math.max(3, Number($<HTMLInputElement>('d-target').value) || 30);
  const count = Number($<HTMLSelectElement>('d-count').value);
  const vary = $<HTMLInputElement>('d-vary').checked ? 0.1 : 0;
  const progress = $('d-progress');
  const bar = $('d-bar');
  const label = $('d-label');
  progress.hidden = false;
  const t0 = performance.now();
  search = direct(scene, { template, target }, count, vary, (done, total) => {
    bar.style.width = `${Math.round((done / total) * 100)}%`;
    label.textContent = `Simulated ${done} of ${total} runs…`;
  });
  try {
    results = await search.done;
  } catch {
    return; // cancelled
  } finally {
    search = null;
  }
  resultsFor = hooks.sceneName();
  label.textContent = `${results.length} runs in ${((performance.now() - t0) / 1000).toFixed(1)}s. Best ${results[0]?.score.toFixed(0)} / 100.`;
  bar.style.width = '100%';
  buildGrid(scene);
  setFooter();
  startLoop();
}

function buildGrid(scene: Scene): void {
  const grid = $('d-grid');
  grid.replaceChildren();
  players = [];
  results.slice(0, 9).forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'variant';
    const canvas = document.createElement('canvas');
    players.push(new Player(canvas, applyVariation(scene, r), 0.22));
    const info = document.createElement('div');
    info.className = 'variant-info';
    const head = document.createElement('b');
    head.textContent = `#${i + 1} · ${r.score.toFixed(0)}`;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `seed ${r.seed}${r.speed !== 1 || r.spin !== 1 ? ` · ×${r.speed}/×${r.spin}` : ''}`;
    const facts = document.createElement('span');
    facts.textContent = r.facts.join(' · ');
    const actions = document.createElement('div');
    actions.className = 'row buttons';
    const use = document.createElement('button');
    use.textContent = 'Use';
    use.title = 'Make this the scene’s seed (and speed/spin). Save to file keeps it.';
    use.onclick = () => {
      hooks.use(r);
      close();
    };
    const keep = document.createElement('button');
    keep.textContent = 'Export';
    keep.onclick = () => {
      hooks.keep(r);
      keep.textContent = 'Queued';
      keep.disabled = true;
    };
    actions.append(use, keep);
    info.append(head, meta, facts, actions);
    card.append(canvas, info);
    grid.append(card);
  });
}

function setFooter(): void {
  $<HTMLButtonElement>('d-review').disabled = !results.length;
  $<HTMLButtonElement>('d-queue-top').disabled = !results.length;
}

function startLoop(): void {
  stopLoop();
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const p of players) p.tick(dt);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function stopLoop(): void {
  cancelAnimationFrame(raf);
}
