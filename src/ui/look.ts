/**
 * Look tab: title and subtitle text, font, sizes and positions, which overlays
 * show, colours, a background picture, and per-ball names, emoji and photos.
 * Every control is an unsaved change, like the Tune and Music tabs.
 */
import type { Scene } from '../engine/scene';
import { imageNames, imageUrl } from '../images';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LookHooks {
  /** Set a change; rebuild=false keeps the tab as it is (so a text box keeps focus). */
  set(path: string, value: unknown, rebuild?: boolean): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let hooks: LookHooks;
let merged: Raw = {};

const SLIDERS: [string, string, (v: number) => string][] = [
  ['l-titleSize', 'overlay.titleSize', (v) => `${v}px`],
  ['l-titleY', 'overlay.titleY', (v) => `${v}`],
  ['l-subtitleSize', 'overlay.subtitleSize', (v) => `${v}px`],
  ['l-counterSize', 'overlay.counterSize', (v) => `${v}px`],
  ['l-counterY', 'overlay.counterY', (v) => `${v}`],
  ['l-labelSize', 'overlay.labelSize', (v) => `${v}px`],
  ['l-backgroundDim', 'style.backgroundDim', (v) => `${Math.round(v * 100)}%`],
];

export function initLook(h: LookHooks): void {
  hooks = h;
  const text = (id: string, path: string) => {
    let timer = 0;
    $<HTMLInputElement>(id).addEventListener('input', (e) => {
      clearTimeout(timer);
      const v = (e.target as HTMLInputElement).value;
      timer = window.setTimeout(() => hooks.set(path, v.trim() ? v : undefined, false), 250);
    });
  };
  text('l-title', 'overlay.title');
  text('l-subtitle', 'overlay.subtitle');
  $<HTMLSelectElement>('l-font').addEventListener('change', (e) => hooks.set('overlay.font', (e.target as HTMLSelectElement).value, false));
  $<HTMLSelectElement>('l-counter').addEventListener('change', (e) => hooks.set('overlay.counter', (e.target as HTMLSelectElement).value, false));
  for (const [id, path] of [
    ['l-textColor', 'overlay.textColor'],
    ['l-background', 'style.background'],
    ['l-ringColor', 'style.ringColor'],
  ]) {
    $<HTMLInputElement>(id).addEventListener('input', (e) => hooks.set(path, (e.target as HTMLInputElement).value, false));
  }
  for (const [id, path] of [
    ['l-timer', 'overlay.timer'],
    ['l-winner', 'overlay.winner'],
    ['l-showHp', 'style.showHp'],
    ['l-zones', 'overlay.zones'],
  ]) {
    $<HTMLInputElement>(id).addEventListener('change', (e) => hooks.set(path, (e.target as HTMLInputElement).checked, false));
  }
  for (const [id, path, show] of SLIDERS) {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      (input.nextElementSibling as HTMLOutputElement).textContent = show(v);
      hooks.set(path, v, false);
    });
  }
  $<HTMLSelectElement>('l-bgImage').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    hooks.set('style.backgroundImage', v || undefined, false);
    $('l-dim-row').hidden = !v;
  });

  // Drop pictures anywhere to add them to images/.
  document.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    document.body.classList.remove('dropping');
    const added: string[] = [];
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'picture';
      const ext = (/\.([^.]+)$/.exec(f.name)?.[1] ?? 'png').toLowerCase();
      try {
        const res = await fetch(`/__studio/image?name=${encodeURIComponent(`${base}.${ext}`)}`, { method: 'POST', body: await f.arrayBuffer() });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        added.push((await res.json()).name);
      } catch (err) {
        $('look-msg').textContent = `Could not add ${f.name}: ${(err as Error).message}`;
      }
    }
    if (added.length) {
      $('look-msg').textContent = `Added ${added.map((n) => `images/${n}`).join(', ')}. Pick ${added.length === 1 ? 'it' : 'them'} for a ball or the background in the Look tab.`;
      document.querySelector<HTMLButtonElement>('.tabs button[data-tab="look"]')?.click();
    }
  });
}

/** Fill the tab from the resolved scene (values with defaults) and its merged source (for per-ball arrays). */
export function refreshLook(scene: Scene, source: Raw): void {
  merged = source;
  const o = scene.overlay;
  const focused = document.activeElement;
  const setVal = (id: string, v: string) => {
    const el = $<HTMLInputElement>(id);
    if (el !== focused) el.value = v;
  };
  setVal('l-title', o.title ?? '');
  setVal('l-subtitle', o.subtitle ?? '');
  $<HTMLSelectElement>('l-font').value = o.font;
  $<HTMLSelectElement>('l-counter').value = o.counter;
  setVal('l-textColor', toHex(o.textColor));
  setVal('l-background', toHex(scene.style.background));
  setVal('l-ringColor', toHex(scene.style.ringColor));
  $<HTMLInputElement>('l-timer').checked = o.timer;
  $<HTMLInputElement>('l-winner').checked = o.winner;
  $<HTMLInputElement>('l-showHp').checked = scene.style.showHp;
  $<HTMLInputElement>('l-zones').checked = o.zones;
  const values: Record<string, number> = {
    'overlay.titleSize': o.titleSize,
    'overlay.titleY': o.titleY,
    'overlay.subtitleSize': o.subtitleSize,
    'overlay.counterSize': o.counterSize,
    'overlay.counterY': o.counterY ?? (scene.entities.some((e) => e.type === 'zone') && o.zones ? 1830 : 1700),
    'overlay.labelSize': o.labelSize,
    'style.backgroundDim': scene.style.backgroundDim,
  };
  for (const [id, path, show] of SLIDERS) {
    const input = $<HTMLInputElement>(id);
    input.value = String(values[path]);
    (input.nextElementSibling as HTMLOutputElement).textContent = show(values[path]);
  }
  const bg = $<HTMLSelectElement>('l-bgImage');
  bg.replaceChildren(new Option('None', ''), ...imageNames().map((n) => new Option(n, n)));
  bg.value = scene.style.backgroundImage ?? '';
  $('l-dim-row').hidden = !scene.style.backgroundImage;
  buildBalls(scene);
}

/** Per-ball rows: name, emoji, photo. Arrays in the source are cycled, so they're expanded to one entry per ball. */
function buildBalls(scene: Scene): void {
  const box = $('l-balls');
  box.replaceChildren();
  const entities: Raw[] = Array.isArray(merged.entities) ? merged.entities : [];
  const images = imageNames();
  const palette = scene.style.palette;
  let groups = 0;
  entities.forEach((e, gi) => {
    if (e?.type !== 'ball') return;
    groups++;
    const count = Math.max(0, Number(e.count ?? 1));
    const path = `entities.${gi}`;
    const head = document.createElement('div');
    head.className = 'slider-group';
    head.textContent = count === 0 ? 'Spawned balls (all alike)' : count === 1 ? 'The ball' : `${count} balls`;
    box.append(head);

    const perBall = count >= 1 && count <= 24;
    const rows = perBall ? count : 1;
    const cycled = (arr: unknown[] | undefined, single: unknown) => Array.from({ length: count || 1 }, (_, i) => (arr?.length ? arr[i % arr.length] : single) ?? '');
    const labels = cycled(e.labels, undefined) as string[];
    const emojis = cycled(e.emojis, e.emoji) as string[];
    const pics = cycled(e.images, e.image) as string[];
    const colors = Array.from({ length: count || 1 }, (_, i) => e.colors?.[i % e.colors.length] ?? e.color ?? palette[i % palette.length]);

    const write = (key: 'labels' | 'emojis' | 'images', arr: string[], single: 'emoji' | 'image' | null) => {
      const empty = arr.every((x) => !x);
      if (!perBall && single) {
        hooks.set(`${path}.${single}`, arr[0] || undefined, false);
        return;
      }
      hooks.set(`${path}.${key}`, empty ? undefined : arr, false);
      if (single) hooks.set(`${path}.${single}`, undefined, false);
    };

    for (let i = 0; i < rows; i++) {
      const row = document.createElement('div');
      row.className = 'ball-row';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = colors[i];
      const name = document.createElement('input');
      name.type = 'text';
      name.placeholder = perBall ? 'Name' : 'Name (n/a)';
      name.value = labels[i] ?? '';
      name.disabled = !perBall;
      name.addEventListener('change', () => {
        labels[i] = name.value.trim();
        write('labels', labels, null);
      });
      const emoji = document.createElement('input');
      emoji.type = 'text';
      emoji.className = 'emoji-input';
      emoji.placeholder = '🙂';
      emoji.value = emojis[i] ?? '';
      emoji.addEventListener('change', () => {
        emojis[i] = emoji.value.trim();
        write('emojis', emojis, 'emoji');
      });
      const pic = document.createElement('select');
      pic.append(new Option('No photo', ''), ...images.map((n) => new Option(n, n)));
      pic.value = pics[i] ?? '';
      const thumb = document.createElement('img');
      thumb.className = 'mini';
      const showThumb = () => {
        const u = pic.value ? imageUrl(pic.value) : undefined;
        thumb.hidden = !u;
        if (u) thumb.src = u;
      };
      showThumb();
      pic.addEventListener('change', () => {
        pics[i] = pic.value;
        showThumb();
        write('images', pics, 'image');
      });
      row.append(sw, name, emoji, pic, thumb);
      box.append(row);
    }
    if (count > 24) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = `With ${count} balls, the emoji and photo apply to all of them.`;
      box.append(note);
    }
  });
  if (!groups) box.innerHTML = '<p class="muted">This scene has no balls of its own.</p>';
}

/** <input type=color> needs #rrggbb. */
function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : '#ffffff';
}
