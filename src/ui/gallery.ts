/**
 * Scene gallery: every scene as a card with a thumbnail, grouped so remixes
 * and tournament matches sit under the scene they came from. Open, build on,
 * duplicate, rename or delete scenes from here.
 */
import type { Scene } from '../engine/scene';
import { resolveScene } from '../engine/source';
import { renderStill } from '../export/still';
import type { SceneEntry } from '../scenes';
import { ask, slug } from './modal';

export interface GalleryHooks {
  scenes(): SceneEntry[];
  sources(): Record<string, unknown>;
  current(): string;
  /** Switch to a scene (handles unsaved changes). */
  open(name: string): void;
  /** Run a file operation on the dev server; returns the resulting scene name. */
  op(op: 'derive' | 'duplicate' | 'rename' | 'delete', name: string, to?: string): Promise<string>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let hooks: GalleryHooks;
const thumbs = new Map<string, string>(); // name|json -> data URL
let queue: { name: string; img: HTMLImageElement }[] = [];
let rendering = false;
let observer: IntersectionObserver | null = null;

export function initGallery(h: GalleryHooks): void {
  hooks = h;
  $('browse').addEventListener('click', openGallery);
  $('g-close').addEventListener('click', closeGallery);
  $('g-search').addEventListener('input', build);
}

export function openGallery(): void {
  $('gallery').hidden = false;
  build();
  $<HTMLInputElement>('g-search').focus();
}

export function closeGallery(): void {
  $('gallery').hidden = true;
  observer?.disconnect();
  queue = [];
}

/** Rebuild if open (scenes changed on disk). */
export function refreshGallery(): void {
  if (!$('gallery').hidden) build();
}

/** Remixes and tournament matches belong to the scene they were made from. */
function parentOf(name: string, names: Set<string>): string | null {
  const m = /^(.+?)-(remix-\d+|cup(-[\w-]+)?)$/.exec(name);
  if (m && names.has(m[1])) return m[1];
  const cup = /^(.+?)-cup-r\d+-m\d+$/.exec(name);
  if (cup && names.has(cup[1])) return cup[1];
  return null;
}

function build(): void {
  const q = $<HTMLInputElement>('g-search').value.trim().toLowerCase();
  const all = hooks.scenes();
  const names = new Set(all.map((s) => s.name));
  const children = new Map<string, SceneEntry[]>();
  const roots: SceneEntry[] = [];
  for (const s of all) {
    const p = parentOf(s.name, names);
    if (p) children.set(p, [...(children.get(p) ?? []), s]);
    else roots.push(s);
  }
  const match = (s: SceneEntry) => !q || s.name.includes(q) || String((s.raw as { title?: string })?.title ?? '').toLowerCase().includes(q);
  observer?.disconnect();
  queue = [];
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target as HTMLImageElement;
      observer!.unobserve(img);
      queue.push({ name: img.dataset.name!, img });
    }
    void pump();
  });

  const box = $('g-groups');
  box.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';
  for (const s of roots) {
    const kids = (children.get(s.name) ?? []).filter(match);
    if (!match(s) && !kids.length) continue;
    grid.append(card(s, kids.length));
  }
  box.append(grid);
  for (const [parent, kids] of children) {
    const shown = kids.filter(match);
    if (!shown.length) continue;
    const det = document.createElement('details');
    det.className = 'gallery-group';
    det.open = !!q || shown.some((k) => k.name === hooks.current());
    const sum = document.createElement('summary');
    sum.textContent = `${parent}: ${shown.length} remix${shown.length === 1 ? '' : 'es'} & matches`;
    const g = document.createElement('div');
    g.className = 'gallery-grid';
    for (const k of shown) g.append(card(k, 0));
    det.append(sum, g);
    box.append(det);
  }
}

function card(s: SceneEntry, kids: number): HTMLElement {
  const raw = (s.raw ?? {}) as { title?: string; overlay?: { title?: string }; extends?: string; modifiers?: unknown[]; audio?: { melody?: string; rhythmLock?: boolean } };
  const el = document.createElement('div');
  el.className = `g-card${s.name === hooks.current() ? ' current' : ''}`;
  const img = document.createElement('img');
  img.alt = '';
  img.dataset.name = s.name;
  const key = `${s.name}|${JSON.stringify(s.raw)}`;
  if (thumbs.has(key)) img.src = thumbs.get(key)!;
  else observer!.observe(img);
  img.onclick = () => pick(s.name);
  const title = document.createElement('b');
  title.textContent = raw.overlay?.title ?? raw.title ?? s.name;
  title.onclick = () => pick(s.name);
  const meta = document.createElement('span');
  meta.className = 'muted';
  const tags = [s.name];
  if (raw.extends) tags.push(`builds on ${raw.extends}`);
  if (raw.audio?.rhythmLock) tags.push('rhythm lock');
  if (kids) tags.push(`${kids} remixes/matches`);
  meta.textContent = tags.join(' · ');
  const actions = document.createElement('div');
  actions.className = 'g-actions';
  const btn = (label: string, title: string, fn: () => void, cls = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    if (cls) b.className = cls;
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return b;
  };
  actions.append(
    btn('New from this', 'A new scene that builds on this one (extends it): change what you like, the rest follows the original.', () => void create('derive', s.name)),
    btn('Duplicate', 'An independent copy.', () => void create('duplicate', s.name)),
    btn('Rename', 'Rename the file (scenes that build on it are updated).', () => void rename(s.name)),
    btn('Delete', 'Move to .studio/trash (recoverable).', () => void remove(s.name), 'danger-text'),
  );
  el.append(img, title, meta, actions);
  return el;
}

function pick(name: string): void {
  closeGallery();
  hooks.open(name);
}

async function create(op: 'derive' | 'duplicate', name: string): Promise<void> {
  const r = await ask({
    title: op === 'derive' ? `New scene from “${name}”` : `Duplicate “${name}”`,
    body: op === 'derive' ? 'The new scene builds on this one: anything you change is its own; everything else follows the original.' : 'An independent copy you can change freely.',
    input: { value: `${name}-${op === 'derive' ? 'new' : 'copy'}`, placeholder: 'scene name' },
    buttons: [
      { label: 'Create', value: 'ok', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (r.value !== 'ok' || !slug(r.input)) return;
  try {
    const made = await hooks.op(op, name, slug(r.input));
    closeGallery();
    hooks.open(made);
  } catch (err) {
    void ask({ title: 'Could not create the scene', body: (err as Error).message, buttons: [{ label: 'OK', value: 'ok', primary: true }] });
  }
}

async function rename(name: string): Promise<void> {
  const r = await ask({
    title: `Rename “${name}”`,
    input: { value: name, placeholder: 'new name' },
    buttons: [
      { label: 'Rename', value: 'ok', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (r.value !== 'ok' || !slug(r.input) || slug(r.input) === name) return;
  try {
    const made = await hooks.op('rename', name, slug(r.input));
    if (hooks.current() === name) hooks.open(made);
  } catch (err) {
    void ask({ title: 'Could not rename', body: (err as Error).message, buttons: [{ label: 'OK', value: 'ok', primary: true }] });
  }
}

async function remove(name: string): Promise<void> {
  const r = await ask({
    title: `Delete “${name}”?`,
    body: 'The file moves to .studio/trash, so you can get it back. Its version history stays.',
    buttons: [
      { label: 'Delete', value: 'ok', danger: true },
      { label: 'Cancel', value: 'cancel', primary: true },
    ],
  });
  if (r.value !== 'ok') return;
  try {
    await hooks.op('delete', name);
  } catch (err) {
    void ask({ title: 'Could not delete', body: (err as Error).message, buttons: [{ label: 'OK', value: 'ok', primary: true }] });
  }
}

/** Render queued thumbnails one at a time (each simulates a few seconds). */
async function pump(): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    while (queue.length) {
      const { name, img } = queue.shift()!;
      const entry = hooks.scenes().find((s) => s.name === name);
      if (!entry) continue;
      const key = `${name}|${JSON.stringify(entry.raw)}`;
      if (!thumbs.has(key)) {
        try {
          const scene: Scene = resolveScene(name, hooks.sources());
          const t = scene.duration.trimStart > 0 ? scene.duration.trimStart + 1 : Math.min(5, scene.duration.max / 3);
          const c = await renderStill(scene, t, 0.2);
          thumbs.set(key, c.toDataURL('image/jpeg', 0.8));
        } catch {
          thumbs.set(key, '');
        }
      }
      img.src = thumbs.get(key) || '';
      if (!img.src) img.classList.add('broken');
    }
  } finally {
    rendering = false;
  }
}
