/**
 * Director view: search hundreds of runs for the chosen story shape, then show
 * the best nine playing side by side. Batch tools produce whole sets: remixes
 * of the scene (each auto-directed) and knockout tournaments. Everything can
 * be reviewed one by one, exported, or saved as scene files.
 */
import { direct, type Search } from '../director/pool';
import { remix } from '../director/remix';
import { applyVariation, defaultTemplate, type RunScore, type Template, TEMPLATES } from '../director/score';
import { entrantsFrom, tournament } from '../director/tournament';
import type { Scene } from '../engine/scene';
import { Player } from './player';
import { startReview } from './review';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GridItem {
  /** The exact scene to play/export (variation applied). */
  scene: Scene;
  r: RunScore;
  title: string;
  /** For generated items (remixes, matches): a scene source that can be saved as a file. */
  source?: { name: string; raw: Raw };
}

export interface DirectorHooks {
  scene(): Scene | null;
  sceneName(): string;
  sources(): Record<string, unknown>;
  /** Resolve a scene by name with extra sources (handles MIDI). */
  resolve(name: string, extra: Record<string, unknown>): Promise<Scene>;
  use(r: RunScore): void;
  keep(item: GridItem): void;
  /** Save a generated scene as scenes/<name>.json; returns the name used. */
  save(source: { name: string; raw: Raw }): Promise<string>;
  setOpen(open: boolean): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let hooks: DirectorHooks;
let items: GridItem[] = [];
let itemsFor = '';
let players: Player[] = [];
let raf = 0;
let search: Search | null = null;
let busy = false;

export function initDirector(h: DirectorHooks): void {
  hooks = h;
  const tpl = $<HTMLSelectElement>('d-template');
  tpl.replaceChildren(...Object.entries(TEMPLATES).map(([k, t]) => new Option(t.label, k)));
  tpl.addEventListener('change', describe);
  $('open-director').addEventListener('click', open);
  $('d-close').addEventListener('click', close);
  $('d-run').addEventListener('click', () => void run());
  $('b-remix').addEventListener('click', () => void runRemixes());
  $('b-tournament').addEventListener('click', () => void runTournament());
  $('d-review').addEventListener('click', () => {
    if (!items.length) return;
    stopLoop();
    $('director').hidden = true;
    startReview(items.slice(0, 24), {
      keep: (it) => hooks.keep(it),
      exit: () => {
        $('director').hidden = false;
        startLoop();
      },
    });
  });
  $('d-queue-top').addEventListener('click', () => items.slice(0, 3).forEach((it) => hooks.keep(it)));
  $('d-queue-all').addEventListener('click', () => items.forEach((it) => hooks.keep(it)));
  $('d-save-all').addEventListener('click', async () => {
    const msg = $('d-label');
    let n = 0;
    for (const it of items) if (it.source) (await hooks.save(it.source).catch(() => '')) && n++;
    msg.textContent = n ? `Saved ${n} scene file${n === 1 ? '' : 's'} to scenes/.` : 'Nothing to save (these are seeds of the current scene: use "Use").';
  });
}

function describe(): void {
  const t = $<HTMLSelectElement>('d-template').value as Template;
  $('d-desc').textContent = TEMPLATES[t].description;
}

function open(): void {
  const scene = hooks.scene();
  if (!scene) return;
  hooks.setOpen(true);
  $('director').hidden = false;
  if (itemsFor !== hooks.sceneName()) {
    items = [];
    buildGrid();
    $<HTMLSelectElement>('d-template').value = scene.duration.trimStart > 0 ? 'perfect-loop' : defaultTemplate(scene);
    const target =
      scene.duration.trimStart > 0
        ? Math.round(scene.duration.max - scene.duration.trimStart)
        : scene.duration.endOn === 'never'
          ? Math.round(scene.duration.max * 0.75)
          : Math.round(Math.min(45, scene.duration.max * 0.6));
    $<HTMLInputElement>('d-target').value = String(target);
  }
  $('d-scene').textContent = hooks.sceneName();
  $<HTMLButtonElement>('b-tournament').disabled = scene.duration.endOn !== 'lastStanding';
  $('b-tournament').title = scene.duration.endOn === 'lastStanding' ? 'Build a knockout bracket from this battle' : 'Tournaments need a battle scene (endOn: lastStanding)';
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

function options() {
  return {
    template: $<HTMLSelectElement>('d-template').value as Template,
    target: Math.max(3, Number($<HTMLInputElement>('d-target').value) || 30),
    count: Number($<HTMLSelectElement>('d-count').value),
    vary: $<HTMLInputElement>('d-vary').checked ? 0.1 : 0,
  };
}

function progress(text: string, frac: number): void {
  $('d-progress').hidden = false;
  $('d-bar').style.width = `${Math.round(frac * 100)}%`;
  $('d-label').textContent = text;
}

async function run(): Promise<void> {
  const scene = hooks.scene();
  if (!scene || busy) return;
  search?.cancel();
  stopLoop();
  const o = options();
  const t0 = performance.now();
  search = direct(scene, { template: o.template, target: o.target }, o.count, o.vary, (done, total) => progress(`Simulated ${done} of ${total} runs…`, done / total));
  let results: RunScore[];
  try {
    results = await search.done;
  } catch {
    return; // cancelled
  } finally {
    search = null;
  }
  items = results.slice(0, 24).map((r, i) => ({ scene: applyVariation(scene, r), r, title: `#${i + 1} · ${r.score.toFixed(0)}` }));
  itemsFor = hooks.sceneName();
  progress(`${results.length} runs in ${((performance.now() - t0) / 1000).toFixed(1)}s. Best ${results[0]?.score.toFixed(0)} / 100.`, 1);
  buildGrid();
  setFooter();
  startLoop();
}

/** Batch: N remixes of the scene, each with its best run picked by the Director. */
async function runRemixes(): Promise<void> {
  const scene = hooks.scene();
  if (!scene || busy) return;
  busy = true;
  stopLoop();
  const name = hooks.sceneName();
  const n = Number($<HTMLSelectElement>('b-count').value);
  const o = options();
  const template = o.template === 'perfect-loop' ? defaultTemplate(scene) : o.template;
  const { mergeSource } = await import('../engine/source');
  const merged = mergeSource(name, hooks.sources());
  const out: GridItem[] = [];
  try {
    for (let k = 1; k <= n; k++) {
      progress(`Remix ${k} of ${n}: directing…`, (k - 1) / n);
      const rm = remix(name, merged, k);
      const s = await hooks.resolve(rm.name, { [rm.name]: rm.raw });
      search = direct(s, { template, target: o.target }, 80, o.vary, () => {});
      const [best] = await search.done;
      search = null;
      const raw = { ...rm.raw, seed: best.seed, world: { ...rm.raw.world, speedScale: round(rm.raw.world.speedScale * best.speed), spinScale: round(rm.raw.world.spinScale * best.spin) } };
      out.push({ scene: applyVariation(s, best), r: best, title: `${rm.label} · ${best.score.toFixed(0)}`, source: { name: rm.name, raw } });
      items = [...out];
      buildGrid();
      startLoop();
    }
    itemsFor = name;
    progress(`${n} remixes, each directed for “${TEMPLATES[template].label}”. Save the ones you like as scenes, or export them.`, 1);
  } catch (err) {
    progress(`Remix failed: ${(err as Error).message}`, 1);
  } finally {
    busy = false;
    search = null;
    setFooter();
  }
}

/** Batch: a knockout bracket from a battle scene. */
async function runTournament(): Promise<void> {
  const scene = hooks.scene();
  if (!scene || busy) return;
  const entrants = entrantsFrom($<HTMLInputElement>('b-entrants').value.split(','));
  const name = hooks.sceneName();
  busy = true;
  stopLoop();
  progress(`Fighting ${entrants.length - 1} matches…`, 0.1);
  await new Promise((r) => setTimeout(r, 30)); // let the label paint
  try {
    const prefix = `${name.replace(/-cup.*$/, '')}-cup`;
    const matches = tournament(name, hooks.sources(), entrants, prefix, 60, Math.max(15, options().target));
    const out: GridItem[] = [];
    for (const m of matches) {
      const s = await hooks.resolve(m.name, { [m.name]: m.raw });
      const r: RunScore = {
        seed: m.seed,
        speed: 1,
        spin: 1,
        score: 0,
        climax: m.climax,
        length: m.climax,
        endReason: 'lastStanding',
        winner: m.winner.label,
        signals: {},
        facts: [`${m.roundName}`, `climax ${m.climax.toFixed(1)}s`, `${m.winner.label} wins`],
        stats: { deadTime: 0, nearMisses: 0, bounceRate: 0, leadChanges: 0, peakBalls: 2, capped: false, scriptError: '' },
      };
      out.push({ scene: s, r, title: `${m.roundName}: ${m.a.label} vs ${m.b.label}`, source: { name: m.name, raw: m.raw } });
    }
    items = out;
    itemsFor = name;
    progress(`Champion: ${matches[matches.length - 1].winner.label}. ${matches.length} matches, in bracket order. "Save all as scenes" writes them to scenes/.`, 1);
    buildGrid();
    startLoop();
  } catch (err) {
    progress(`Tournament failed: ${(err as Error).message}`, 1);
  } finally {
    busy = false;
    setFooter();
  }
}

function buildGrid(): void {
  const grid = $('d-grid');
  grid.replaceChildren();
  players = [];
  items.slice(0, 9).forEach((it) => {
    const card = document.createElement('div');
    card.className = 'variant';
    const canvas = document.createElement('canvas');
    players.push(new Player(canvas, it.scene, 0.22));
    const info = document.createElement('div');
    info.className = 'variant-info';
    const head = document.createElement('b');
    head.textContent = it.title;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `seed ${it.r.seed}${it.r.speed !== 1 || it.r.spin !== 1 ? ` · ×${it.r.speed}/×${it.r.spin}` : ''}`;
    const facts = document.createElement('span');
    facts.textContent = it.r.facts.join(' · ');
    const actions = document.createElement('div');
    actions.className = 'row buttons';
    const first = document.createElement('button');
    if (it.source) {
      first.textContent = 'Save';
      first.title = `Save as scenes/${it.source.name}.json`;
      first.onclick = async () => {
        first.disabled = true;
        const saved = await hooks.save(it.source!).catch(() => '');
        first.textContent = saved ? 'Saved' : 'Failed';
      };
    } else {
      first.textContent = 'Use';
      first.title = 'Make this the scene’s seed (and speed/spin). Save to file keeps it.';
      first.onclick = () => {
        hooks.use(it.r);
        close();
      };
    }
    const keep = document.createElement('button');
    keep.textContent = 'Export';
    keep.onclick = () => {
      hooks.keep(it);
      keep.textContent = 'Queued';
      keep.disabled = true;
    };
    actions.append(first, keep);
    info.append(head, meta, facts, actions);
    card.append(canvas, info);
    grid.append(card);
  });
  if (items.length > 9) {
    const more = document.createElement('p');
    more.className = 'muted';
    more.textContent = `+${items.length - 9} more in "Review one by one".`;
    grid.append(more);
  }
}

function setFooter(): void {
  for (const id of ['d-review', 'd-queue-top', 'd-queue-all']) $<HTMLButtonElement>(id).disabled = !items.length || busy;
  $<HTMLButtonElement>('d-save-all').disabled = !items.some((i) => i.source) || busy;
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

const round = (x: number) => Math.round(x * 1000) / 1000;
