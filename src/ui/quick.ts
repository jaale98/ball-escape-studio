/**
 * Quick settings on the Tune tab: the scene's ready-made variations as cards,
 * each with a thumbnail, what it changes, and the Director's verdict on its run
 * (scored off the main thread, so a stale seed shows up as a warning).
 *
 * Picking one is a layer on top of the scene, not an unsaved change: the scene
 * file is never rewritten by it. Tweaks made on top of a quick setting save
 * into that quick setting (quick/<scene>.json), and "Save as quick setting"
 * keeps the current changes as a new one.
 */
import { direct, scoreOne } from '../director/pool';
import { problems, type Quick, quickStory, suggestQuick } from '../director/quick';
import type { RunScore } from '../director/score';
import type { Scene } from '../engine/scene';
import { renderStill } from '../export/still';

export interface QuickHooks {
  sceneName(): string;
  list(): Quick[];
  /** Why the scene's quick file couldn't be read ('' when fine). */
  error(): string;
  active(): Quick | null;
  /** Show a quick setting (null = the scene as saved). */
  pick(q: Quick | null): void;
  /** The scene with this quick setting and no unsaved changes, ready to play or export. */
  resolve(q: Quick | null): Promise<Scene>;
  /** Changes whenever the scene (or anything it extends) or the quick setting changes. */
  key(q: Quick | null): string;
  exportAll(items: { q: Quick | null; scene: Scene }[]): void;
  /** Keep the current unsaved changes as a new quick setting. */
  saveNew(): void;
  hasChanges(): boolean;
  /** Replace a quick setting in its file (null deletes it). */
  write(old: Quick, next: Quick | null): Promise<void>;
  /** Write the scene's whole quick file. */
  writeAll(list: Quick[]): Promise<void>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let hooks: QuickHooks;
const verdicts = new Map<string, RunScore | string>();
const thumbs = new Map<string, string>();
let token = 0;
let msgFor = '';
let suggesting = false;

export function initQuick(h: QuickHooks): void {
  hooks = h;
  $('quick-export-all').addEventListener('click', () => void exportAll());
  $('quick-save-new').addEventListener('click', () => hooks.saveNew());
  $('quick-retune').addEventListener('click', () => void retune());
  $('quick-delete').addEventListener('click', () => void remove());
  $('quick-original').addEventListener('click', () => hooks.pick(null));
  $('quick-suggest').addEventListener('click', () => void suggest());
}

/** Redraw the cards (cheap: verdicts and thumbnails are cached by content). */
export function refreshQuick(): void {
  if (!hooks) return;
  const list = hooks.list();
  const active = hooks.active();
  const items: (Quick | null)[] = [null, ...list];
  const grid = $('quick-grid');
  grid.replaceChildren(...items.map((q, i) => card(q, i, q === null ? !active : active?.name === q.name)));
  // Messages (a search result, say) stay until the scene changes; problems with the file always show.
  const err = hooks.error();
  const fresh = msgFor !== hooks.sceneName();
  msgFor = hooks.sceneName();
  if (err) $('quick-msg').textContent = `This scene's quick file has a problem, so its quick settings are hidden:\n${err}`;
  else if (!list.length && !suggesting) $('quick-msg').textContent = 'No quick settings for this scene yet. Suggest a set, tweak it and “Save as quick setting”, or ask Claude for some.';
  else if (fresh) $('quick-msg').textContent = '';
  $<HTMLButtonElement>('quick-export-all').textContent = `Export all ${items.length}`;
  $<HTMLButtonElement>('quick-export-all').disabled = items.length < 2;
  $<HTMLButtonElement>('quick-save-new').disabled = !hooks.hasChanges();
  $('quick-suggest').hidden = list.length > 0 || !!err;
  const bar = $('quick-active');
  bar.hidden = !active;
  if (active) {
    $('quick-active-name').textContent = `${active.emoji ? `${active.emoji} ` : ''}${active.name}`;
    $('quick-active-note').textContent = [active.note, active.seed !== undefined ? `seed ${active.seed}` : ''].filter(Boolean).join(' · ');
  }
  // Scoring and thumbnails only while the Tune tab is showing (switching to it refreshes).
  ++token;
  if (!grid.closest<HTMLElement>('section.tab')?.hidden) void fill(items, token);
}

function card(q: Quick | null, i: number, on: boolean): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `q-card${on ? ' on' : ''}${q?.kind ? ` k-${q.kind}` : ''}`;
  el.title = q ? (q.note ?? q.name) : 'The scene as saved';
  el.dataset.key = hooks.key(q);
  const img = document.createElement('img');
  img.className = 'q-thumb';
  img.alt = '';
  const cached = thumbs.get(el.dataset.key);
  if (cached) img.src = cached;
  const name = document.createElement('span');
  name.className = 'q-name';
  const key = document.createElement('kbd');
  key.textContent = String(i);
  name.append(key, ` ${q ? `${q.emoji ? `${q.emoji} ` : ''}${q.name}` : 'Original'}`);
  const note = document.createElement('span');
  note.className = 'q-note';
  note.textContent = q ? (q.note ?? '') : 'The scene as saved.';
  const verdict = document.createElement('span');
  verdict.className = 'q-verdict wait';
  verdict.textContent = 'Checking…';
  el.append(img, name, note, verdict);
  showVerdict(el, verdicts.get(el.dataset.key));
  el.addEventListener('click', () => hooks.pick(q));
  return el;
}

/** A short verdict for a small card: the time left (or when it ends), then who won or the close calls. */
function short(r: RunScore): string {
  const spare = r.facts.find((f) => /s to spare$/.test(f));
  const climax = r.facts.find((f) => /^climax /.test(f));
  const lead = spare ? `${Number.parseFloat(spare).toFixed(1)} s left` : climax ? `ends ${Number.parseFloat(climax.slice(7)).toFixed(1)} s` : r.facts[0];
  const rest = r.facts.find((f) => f !== spare && f !== climax && !/notes on time$/.test(f)) ?? r.facts.find((f) => /notes on time$/.test(f));
  return [lead, rest?.replace(/ near-misses?$/, ' close calls')].filter(Boolean).join(' · ');
}

/** The Original card's score: quick settings are judged against the scene they vary. */
function baselineFor(key: string): number {
  const original = document.querySelector<HTMLElement>('.q-card');
  const v = original && original.dataset.key !== key ? verdicts.get(original.dataset.key ?? '') : undefined;
  return v && typeof v !== 'string' ? v.score : 100;
}

function showVerdict(el: HTMLElement, v: RunScore | string | undefined): void {
  const span = el.querySelector<HTMLElement>('.q-verdict');
  if (!span || v === undefined) return;
  if (typeof v === 'string') {
    span.className = 'q-verdict warn';
    span.textContent = v;
    return;
  }
  const issues = problems(v, baselineFor(el.dataset.key ?? ''));
  span.className = `q-verdict ${issues.length ? 'warn' : v.score >= 80 ? 'good' : 'ok'}`;
  span.textContent = issues.length ? `⚠ ${issues.join(', ')}` : short(v);
  span.title = `Director score ${v.score.toFixed(0)}: ${v.facts.join(', ')}`;
}

/** Score every card's run and draw its thumbnail, newest request wins. */
async function fill(items: (Quick | null)[], my: number): Promise<void> {
  const keys = items.map((q) => hooks.key(q));
  // Verdicts: a few Workers at once.
  const todo = items.map((q, i) => ({ q, key: keys[i] })).filter((x) => !verdicts.has(x.key));
  const work = async () => {
    for (let job = todo.shift(); job; job = todo.shift()) {
      if (my !== token) return;
      try {
        const scene = await hooks.resolve(job.q);
        verdicts.set(job.key, await scoreOne(scene, quickStory(scene, job.q)));
      } catch (err) {
        verdicts.set(job.key, `⚠ ${(err as Error).message.split('\n')[0].slice(0, 80)}`);
      }
      const el = document.querySelector<HTMLElement>(`.q-card[data-key="${CSS.escape(job.key)}"]`);
      if (el) showVerdict(el, verdicts.get(job.key));
      if (job.q === null) for (const c of document.querySelectorAll<HTMLElement>('.q-card')) showVerdict(c, verdicts.get(c.dataset.key ?? ''));
    }
  };
  await Promise.all([work(), work(), work()]);
  // Thumbnails: one at a time on the main thread (each simulates a few seconds).
  for (let i = 0; i < items.length; i++) {
    if (my !== token) return;
    if (thumbs.has(keys[i])) continue;
    try {
      const scene = await hooks.resolve(items[i]);
      const full = await renderStill(scene, 3.5 + scene.camera.countdown, 0.2);
      thumbs.set(keys[i], crop(full));
    } catch {
      thumbs.set(keys[i], '');
    }
    const img = document.querySelector<HTMLImageElement>(`.q-card[data-key="${CSS.escape(keys[i])}"] img`);
    if (img && thumbs.get(keys[i])) img.src = thumbs.get(keys[i])!;
  }
}

/** The play area (y 480–1440 of the 1920 frame) of a small still. */
function crop(full: HTMLCanvasElement): string {
  const k = full.width / 1080;
  const c = document.createElement('canvas');
  c.width = 216;
  c.height = 192;
  c.getContext('2d')!.drawImage(full, 0, 480 * k, 1080 * k, 960 * k, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

async function exportAll(): Promise<void> {
  const btn = $<HTMLButtonElement>('quick-export-all');
  btn.disabled = true;
  try {
    const items: { q: Quick | null; scene: Scene }[] = [];
    for (const q of [null, ...hooks.list()]) items.push({ q, scene: await hooks.resolve(q) });
    hooks.exportAll(items);
  } finally {
    btn.disabled = false;
  }
}

/** Search 300 seeds for the active quick setting's story and keep the best (a different run from its siblings). */
async function retune(): Promise<void> {
  const q = hooks.active();
  if (!q) return;
  const btn = $<HTMLButtonElement>('quick-retune');
  btn.disabled = true;
  try {
    const scene = await hooks.resolve({ ...q, seed: undefined });
    const used = new Set(hooks.list().filter((x) => x.name !== q.name).map((x) => x.seed));
    const search = direct(scene, quickStory(scene, q), 300, 0, (done, total) => (btn.textContent = `Trying seeds… ${done}/${total}`));
    const results = await search.done;
    const best = results.find((r) => !problems(r).length && !used.has(r.seed)) ?? results[0];
    if (best && best.seed !== q.seed) {
      await hooks.write(q, { ...q, seed: best.seed });
      $('quick-msg').textContent = `${q.name}: seed ${best.seed} (${best.facts.join(', ')}).`;
    } else $('quick-msg').textContent = `${q.name}: its seed is already the best of 300.`;
  } catch (err) {
    $('quick-msg').textContent = `Search failed: ${(err as Error).message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find a better seed';
  }
}

async function remove(): Promise<void> {
  const q = hooks.active();
  if (!q) return;
  const { ask } = await import('./modal');
  const r = await ask({
    title: `Delete the quick setting “${q.name}”?`,
    body: 'It is removed from this scene’s quick file. The scene itself is not changed.',
    buttons: [
      { label: 'Delete', value: 'delete', danger: true },
      { label: 'Cancel', value: 'cancel', primary: true },
    ],
  });
  if (r.value !== 'delete') return;
  hooks.pick(null);
  await hooks.write(q, null);
}

/** Build a starter set for a scene with no quick settings, tune each seed in Workers, and save it. */
async function suggest(): Promise<void> {
  const btn = $<HTMLButtonElement>('quick-suggest');
  const scene = hooks.sceneName();
  btn.disabled = true;
  suggesting = true;
  try {
    const base = await hooks.resolve(null);
    const list = suggestQuick(scene, base);
    const used = new Set<number>([base.seed]);
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      const s = await hooks.resolve(q);
      const search = direct(s, quickStory(s, q), 150, 0, (done, total) => (btn.textContent = `Tuning ${i + 1}/${list.length}: ${q.name}… ${Math.round((done / total) * 100)}%`));
      const results = await search.done;
      if (hooks.sceneName() !== scene) return;
      const best = results.find((r) => !problems(r).length && !used.has(r.seed)) ?? results.find((r) => !used.has(r.seed)) ?? results[0];
      if (best) {
        q.seed = best.seed;
        used.add(best.seed);
      }
    }
    await hooks.writeAll(list);
    $('quick-msg').textContent = `Made ${list.length} quick settings, each with its own tuned run. Saved to quick/${scene}.json.`;
  } catch (err) {
    $('quick-msg').textContent = `Could not make quick settings: ${(err as Error).message}`;
  } finally {
    suggesting = false;
    btn.disabled = false;
    btn.textContent = '✨ Suggest quick settings';
  }
}
