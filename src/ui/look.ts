/**
 * Look tab: title and subtitle text, font, sizes and positions, which overlays
 * show, colours, a background picture, and per-ball names, emoji and photos.
 * Every control is an unsaved change, like the Tune and Music tabs.
 */
import type { Scene } from '../engine/scene';
import { THEMES } from '../engine/source';
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

type Field =
  | { path: string; label: string; kind: 'select'; options: [string, string][] }
  | { path: string; label: string; kind: 'check' }
  | { path: string; label: string; kind: 'range'; min: number; max: number; step: number }
  | { path: string; label: string; kind: 'text'; placeholder: string }
  | { path: string; label: string; kind: 'image' }
  | { group: string };

const opts = (...xs: string[]): [string, string][] => xs.map((x) => [x, x[0].toUpperCase() + x.slice(1)]);

/** The Style section: every V2 look, effect, camera and sound option. */
const STYLE_FIELDS: Field[] = [
  { group: 'Look' },
  { path: 'style.theme', label: 'Theme', kind: 'select', options: [['', 'None'], ...opts(...Object.keys(THEMES))] },
  { path: 'style.ballStyle', label: 'Balls', kind: 'select', options: opts('flat', 'glossy', '3d', 'outline', 'glass') },
  { path: 'style.ringStyle', label: 'Rings', kind: 'select', options: opts('solid', 'dashed', 'double', 'rainbow', 'segments') },
  { path: 'style.trailStyle', label: 'Trails', kind: 'select', options: opts('dots', 'ribbon', 'comet', 'rainbow') },
  { path: 'style.trail', label: 'Trail length', kind: 'range', min: 0, max: 0.97, step: 0.01 },
  { path: 'style.colorMode', label: 'Ball colors', kind: 'select', options: [['fixed', 'Fixed'], ['bounce', 'Change every bounce'], ['rainbow', 'Rainbow drift'], ['speed', 'By speed (heat)']] },
  { path: 'style.lines', label: 'String art', kind: 'select', options: [['none', 'None'], ['center', 'Bounce → center'], ['web', 'Bounce → last bounce'], ['star', 'Star (5 back)'], ['tether', 'Tether to center']] },
  { path: 'style.lineAlpha', label: 'Line strength', kind: 'range', min: 0.05, max: 1, step: 0.05 },
  { path: 'style.backdrop', label: 'Backdrop', kind: 'select', options: opts('none', 'stars', 'grid', 'gradient', 'ripples') },
  { group: 'Effects' },
  { path: 'style.glow', label: 'Glow', kind: 'check' },
  { path: 'style.bloom', label: 'Bloom', kind: 'check' },
  { path: 'style.vignette', label: 'Vignette', kind: 'check' },
  { path: 'style.grain', label: 'Film grain', kind: 'check' },
  { path: 'style.scanlines', label: 'Scanlines', kind: 'check' },
  { path: 'style.chromatic', label: 'Color fringe on hits', kind: 'check' },
  { path: 'style.confetti', label: 'Confetti', kind: 'check' },
  { path: 'style.paint', label: 'Paint', kind: 'check' },
  { group: 'Camera & time' },
  { path: 'camera.mode', label: 'Camera', kind: 'select', options: [['fixed', 'Fixed'], ['follow', 'Follow the action'], ['zoomOut', 'Zoom out ring by ring']] },
  { path: 'camera.zoom', label: 'Zoom', kind: 'range', min: 0.5, max: 2, step: 0.05 },
  { path: 'camera.shake', label: 'Shake', kind: 'range', min: 0, max: 3, step: 0.1 },
  { path: 'camera.slowmo', label: 'Slow motion (s)', kind: 'range', min: 0, max: 6, step: 0.25 },
  { path: 'camera.slowmoFactor', label: 'Slow-mo speed', kind: 'range', min: 0.1, max: 0.8, step: 0.05 },
  { path: 'camera.countdown', label: 'Countdown', kind: 'range', min: 0, max: 5, step: 1 },
  { path: 'clock.seconds', label: 'Clock (s, 0 = off)', kind: 'range', min: 0, max: 90, step: 1 },
  { path: 'clock.final', label: 'Clock final stretch (s)', kind: 'range', min: 0, max: 15, step: 1 },
  { group: 'Text' },
  { path: 'overlay.progress', label: 'Time left', kind: 'select', options: [['none', 'Hidden'], ['bar', 'Bar'], ['ring', 'Ring']] },
  { path: 'overlay.endCard', label: 'End card', kind: 'text', placeholder: 'Follow for part 2' },
  { path: 'overlay.reveal', label: 'Reveal per bounce', kind: 'text', placeholder: 'A message, one word per bounce' },
  { path: 'overlay.revealBy', label: 'Reveal by', kind: 'select', options: opts('words', 'letters') },
  { group: 'Picture reveal' },
  { path: 'style.reveal.text', label: 'Word', kind: 'text', placeholder: 'Balls land and spell this' },
  { path: 'style.reveal.image', label: 'Picture', kind: 'image' },
  { group: 'Sound' },
  { path: 'audio.instrument', label: 'Instrument', kind: 'select', options: opts('pluck', 'bell', 'marimba', 'glass', 'chip', 'piano', 'kalimba', 'pop', 'synth', 'meow') },
  { path: 'audio.pitchBy', label: 'Pitch follows', kind: 'select', options: [['melody', 'The melody'], ['size', 'Ball size'], ['height', 'Height'], ['speed', 'Speed']] },
  { path: 'audio.climax', label: 'Climax sound', kind: 'select', options: [['none', 'None'], ['drop', 'Bass drop'], ['swell', 'Cymbal swell'], ['gong', 'Gong']] },
  { path: 'audio.eventSounds', label: 'Break / portal / merge sounds', kind: 'check' },
];

function getPath(o: Raw, path: string): unknown {
  return path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Raw)[k] : undefined), o);
}

/** Build (or refresh) the Style section from the resolved scene. */
function buildStyle(scene: Scene): void {
  const box = $('l-style');
  const focused = document.activeElement;
  if (focused && box.contains(focused) && (focused as HTMLInputElement).type === 'text') return; // don't steal a text box mid-typing
  box.replaceChildren();
  const resolved = scene as unknown as Raw;
  let toggles: HTMLElement | null = null;
  for (const f of STYLE_FIELDS) {
    if ('group' in f) {
      const h = document.createElement('div');
      h.className = 'slider-group';
      h.textContent = f.group;
      box.append(h);
      toggles = null;
      continue;
    }
    const value = getPath(resolved, f.path);
    const label = document.createElement('label');
    label.className = f.kind === 'check' ? 'check' : f.kind === 'range' ? 'slider' : 'style-field';
    if (f.kind === 'check') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!value;
      input.addEventListener('change', () => hooks.set(f.path, input.checked, false));
      label.append(input, ` ${f.label}`);
      // Checkboxes of a group share a compact two-column grid.
      if (!toggles) {
        toggles = document.createElement('div');
        toggles.className = 'toggles';
        box.append(toggles);
      }
      toggles.append(label);
      continue;
    } else {
      const span = document.createElement('span');
      span.textContent = f.label;
      label.append(span);
      if (f.kind === 'select' || f.kind === 'image') {
        const sel = document.createElement('select');
        const options = f.kind === 'image' ? ([['', 'None'], ...imageNames().map((n) => [n, n])] as [string, string][]) : f.options;
        for (const [v, t] of options) sel.append(new Option(t, v));
        sel.value = String(value ?? '');
        sel.addEventListener('change', () => {
          const v = sel.value || undefined;
          if (f.path === 'style.theme') applyThemeChoice(v);
          else hooks.set(f.path, v, false);
        });
        label.append(sel);
      } else if (f.kind === 'range') {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(f.min);
        input.max = String(f.max);
        input.step = String(f.step);
        input.value = String(value ?? f.min);
        const out = document.createElement('output');
        const show = () => (out.textContent = String(Math.round(Number(input.value) * 100) / 100));
        show();
        if (f.path.startsWith('clock.')) {
          // The clock is one object: 0 seconds removes it; the final stretch needs a clock first.
          if (f.path === 'clock.final' && !scene.clock) input.disabled = true;
          input.addEventListener('input', () => {
            show();
            const key = f.path.slice('clock.'.length);
            const v = Number(input.value);
            const base = { ...((getPath(merged, 'clock') as Raw | undefined) ?? {}) };
            if (key === 'seconds' && v <= 0) hooks.set('clock', undefined, false);
            else {
              base[key] = key === 'seconds' ? Math.max(3, v) : v;
              if (base.final !== undefined && base.seconds !== undefined) base.final = Math.min(base.final, base.seconds);
              hooks.set('clock', base, false);
            }
          });
        } else
          input.addEventListener('input', () => {
            show();
            hooks.set(f.path, Number(input.value), false);
          });
        label.append(input, out);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = f.placeholder;
        input.value = String(value ?? '');
        let timer = 0;
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = window.setTimeout(() => hooks.set(f.path, input.value.trim() || undefined, false), 400);
        });
        label.append(input);
      }
    }
    box.append(label);
  }
}

/** Picking a theme sets its colors and styles outright (so it shows even over the scene's own colors). */
function applyThemeChoice(name: string | undefined): void {
  hooks.set('style.theme', name, false);
  const theme = name ? THEMES[name] : undefined;
  if (!theme) return;
  for (const [k, v] of Object.entries(theme.style)) hooks.set(`style.${k}`, v, false);
  for (const [k, v] of Object.entries(theme.overlay ?? {})) hooks.set(`overlay.${k}`, v, false);
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
  buildStyle(scene);
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
