import { songGroups } from './audio/midi';
import { createMaster, playVoice, SoundMapper } from './audio/sound';
import type { Scene } from './engine/scene';
import { mergeSource, resolveScene } from './engine/source';
import { DT, World } from './engine/world';
import { hasScripts, preflight } from './director/check';
import { critique } from './director/critic';
import { scoreOne } from './director/pool';
import { caption, captionText } from './director/caption';
import { defaultTemplate, type RunScore } from './director/score';
import { canExport, exportMp4 } from './export/mp4';
import { renderStill } from './export/still';
import { Renderer } from './render/renderer';
import { entriesFrom, type SceneEntry, sceneFiles } from './scenes';
import { loadSong, songFiles, songUrls } from './songs';
import { initDirector } from './ui/director';
import { initMusic, refreshMusic } from './ui/music';
import { enqueue, initQueue } from './ui/queue';
import { initAssistant } from './ui/assistant';
import { initRating, refreshHistory } from './ui/history';
import { fmt, setPath, tunables } from './ui/sliders';

// Every JSON file in scenes/ is a scene. Edits arrive as hot updates (no page reload).
let scenes: SceneEntry[] = entriesFrom(sceneFiles);
let sources: Record<string, unknown> = Object.fromEntries(scenes.map((s) => [s.name, s.raw]));

// MIDI files in songs/ can be used as melodies: "audio": { "melody": "midi:minuet-in-g" }.
let songs: Record<string, string> = songUrls(songFiles);
function songUrl(name: string): string {
  const url = songs[name.replace(/\.mid$/, '')];
  if (!url) throw new Error(`audio.melody: no MIDI file songs/${name}.mid (drop one onto the studio to add it)`);
  return url;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sceneSelect = $<HTMLSelectElement>('scene');
const seedInput = $<HTMLInputElement>('seed');
const playBtn = $<HTMLButtonElement>('play');
const soundBtn = $<HTMLButtonElement>('sound');
const loopBox = $<HTMLInputElement>('loop');
const exportBtn = $<HTMLButtonElement>('export');
const canvas = $<HTMLCanvasElement>('view');
const errorBox = $<HTMLPreElement>('error');

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`bes:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`bes:${key}`, value);
    } catch {
      /* storage unavailable: fine */
    }
  },
};

let scene: Scene | null = null;
let world: World | null = null;
let renderer: Renderer | null = null;
let mapper: SoundMapper | null = null;
let audioCursor = 0;
let playing = true;
let exporting = false;
/** The Director view covers the stage: pause the main preview while it's open. */
let directorOpen = false;
let endedAt = 0;
let audio: { ctx: AudioContext; master: AudioNode } | null = null;
let soundOn = store.get('sound') === '1';

function fillSceneList(selected: string): void {
  sceneSelect.replaceChildren(...scenes.map((s) => new Option(s.name, s.name)));
  sceneSelect.value = scenes.some((s) => s.name === selected) ? selected : (scenes[0]?.name ?? '');
}
fillSceneList(store.get('scene') ?? '');
/** A scene Claude just wrote that should be shown as soon as it arrives. */
let pendingSelect = '';

function currentEntry() {
  return scenes.find((s) => s.name === sceneSelect.value);
}

/** Slider tweaks not yet saved to the file: dotted path -> value. */
const overrides = new Map<string, unknown>();
let loadToken = 0;

/** Resolve the selected scene (extends, modifiers, prefabs, slider tweaks, MIDI) and restart. */
async function loadScene(keepSeed: boolean, rebuildSliders = true): Promise<void> {
  const entry = currentEntry();
  if (!entry) return;
  const token = ++loadToken;
  $('scene-path').textContent = entry.path;
  $('scene-json').textContent = JSON.stringify(entry.raw, null, 2);
  try {
    const resolved = resolveScene(entry.name, sources, (merged) => {
      for (const [path, v] of overrides) setPath(merged, path, v);
    });
    let song = null;
    if (resolved.audio.melody.startsWith('midi:')) {
      song = await loadSong(songUrl(resolved.audio.melody.slice(5)));
      if (!resolved.audio.notes) {
        const { groups, times } = songGroups(song, resolved.audio.parts);
        resolved.audio.notes = groups;
        resolved.audio.noteTimes = times;
      }
    }
    if (token !== loadToken) return;
    // Scripted scenes run headless in a Worker first: a runaway script fails there, not here.
    if (hasScripts(resolved)) {
      const scriptError = await preflight(resolved);
      if (token !== loadToken) return;
      $('script-msg').textContent = scriptError ? `Script error: ${scriptError} (that script was switched off)` : '';
    } else $('script-msg').textContent = '';
    // A UI seed is remembered per scene, but only while the file's own seed is
    // unchanged: editing the seed in the file always wins.
    const [fileSeed, uiSeed] = (store.get(`seed:${entry.name}`) ?? '').split(':').map(Number);
    const remembered = fileSeed === resolved.seed && Number.isFinite(uiSeed) ? uiSeed : resolved.seed;
    const seed = keepSeed && seedInput.value !== '' ? Number(seedInput.value) : remembered;
    scene = { ...resolved, seed };
    seedInput.value = String(seed);
    $('resolved-json').textContent = JSON.stringify({ ...scene, audio: { ...scene.audio, notes: scene.audio.notes ? `(${scene.audio.notes.length} note groups)` : undefined, noteTimes: undefined } }, null, 2);
    refreshMusic(scene, Object.keys(songs), song);
    errorBox.hidden = true;
    if (rebuildSliders) {
      buildSliders();
      void refreshHistory(entry.name);
    }
    restart();
    scheduleCritic();
  } catch (err) {
    if (token !== loadToken) return;
    scene = null;
    world = null;
    errorBox.hidden = false;
    errorBox.textContent = `${entry.path}\n${(err as Error).message}`;
  }
}

/** Set (or with undefined, clear) a tweak from any panel, and re-run the preview. */
function setTweak(path: string, value: unknown): void {
  overrides.set(path, value); // undefined = unset (dropped when saved)
  updateTweakButtons();
  clearTimeout(sliderTimer);
  sliderTimer = window.setTimeout(() => void loadScene(true, true), 60);
}

// ---- Sliders ----------------------------------------------------------------

let sliderTimer = 0;
function buildSliders(): void {
  const entry = currentEntry();
  const box = $('sliders');
  box.replaceChildren();
  if (!entry) return;
  let merged: Record<string, unknown>;
  try {
    merged = mergeSource(entry.name, sources);
  } catch {
    return;
  }
  for (const [path, v] of overrides) setPath(merged, path, v);
  let group = '';
  for (const t of tunables(merged)) {
    if (t.group !== group) {
      group = t.group;
      const h = document.createElement('div');
      h.className = 'slider-group';
      h.textContent = group;
      box.append(h);
    }
    const row = document.createElement('label');
    row.className = 'slider';
    row.title = t.path;
    const name = document.createElement('span');
    name.textContent = t.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(t.min);
    input.max = String(t.max);
    input.step = String(t.step);
    input.value = String(t.value);
    const out = document.createElement('output');
    out.textContent = fmt(t.value, t.step);
    if (overrides.has(t.path)) row.classList.add('changed');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = fmt(v, t.step);
      overrides.set(t.path, v);
      row.classList.add('changed');
      updateTweakButtons();
      clearTimeout(sliderTimer);
      sliderTimer = window.setTimeout(() => void loadScene(true, false), 120);
    });
    row.append(name, input, out);
    box.append(row);
  }
  updateTweakButtons();
}

function updateTweakButtons(): void {
  const n = overrides.size;
  $<HTMLButtonElement>('save').disabled = n === 0;
  $<HTMLButtonElement>('reset-tweaks').disabled = n === 0;
  $('tweak-count').textContent = n ? `${n} unsaved ${n === 1 ? 'change' : 'changes'}` : 'Drag to tweak; changes preview instantly.';
}

/** Write slider tweaks into the scene file (dev server only). The page reloads with the saved file. */
async function saveTweaks(): Promise<void> {
  const entry = currentEntry();
  if (!entry || !overrides.size) return;
  const merged = mergeSource(entry.name, sources);
  const child = structuredClone(entry.raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const inheritedMods = ((merged.modifiers as unknown[]) ?? []).length - ((child.modifiers as unknown[]) ?? []).length;
  const skipped: string[] = [];
  for (const [path, v] of overrides) {
    const parts = path.split('.');
    if (parts[0] === 'modifiers') {
      const i = Number(parts[1]) - inheritedMods;
      if (i < 0) {
        skipped.push(path);
        continue;
      }
      setPath(child, ['modifiers', String(i), ...parts.slice(2)].join('.'), v);
      continue;
    }
    // A tweak to an inherited value copies that whole section into this file.
    if (!(parts[0] in child)) child[parts[0]] = structuredClone(merged[parts[0]]);
    setPath(child, path, v);
  }
  const res = await fetch(`/__studio/scene?name=${encodeURIComponent(entry.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(child, null, 2),
  });
  if (!res.ok) throw new Error(await res.text());
  $('tweak-count').textContent = skipped.length ? `Saved. Not saved (inherited modifier): ${skipped.join(', ')}` : 'Saved.';
}

function restart(): void {
  if (!scene) return;
  world = new World(scene);
  renderer = new Renderer(canvas, scene);
  mapper = new SoundMapper(scene);
  audioCursor = 0;
  endedAt = 0;
  renderer.render(world, 0);
}

function setSeed(seed: number): void {
  seedInput.value = String(seed);
  const entry = currentEntry();
  let fileSeed = 1;
  try {
    fileSeed = entry ? ((mergeSource(entry.name, sources).seed as number | undefined) ?? 1) : 1;
  } catch {
    /* unresolvable scene: the error box already says why */
  }
  store.set(`seed:${sceneSelect.value}`, `${fileSeed}:${seed}`);
  void loadScene(true, false);
}

function ensureAudio(): void {
  if (!soundOn || !scene) return;
  if (!audio) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    audio = { ctx, master: createMaster(ctx, scene.audio.volume) };
  }
  if (audio.ctx.state === 'suspended') void audio.ctx.resume();
}

function pumpAudio(): void {
  if (!world || !mapper || !scene) return;
  const events = world.events;
  if (!soundOn || !audio || audio.ctx.state !== 'running') {
    audioCursor = events.length;
    return;
  }
  const now = audio.ctx.currentTime + 0.03;
  for (; audioCursor < events.length; audioCursor++) {
    const v = mapper.map(events[audioCursor]);
    if (v) playVoice(audio.ctx, audio.master, v, now, scene.audio.instrument);
  }
}

function updateStats(): void {
  if (!world) return;
  $('s-time').textContent = `${world.time.toFixed(1)}s`;
  $('s-bounces').textContent = String(world.bounces);
  $('s-balls').textContent = String(world.aliveCount);
  $('s-escapes').textContent = String(world.uniqueEscapes);
  const winner = world.winner >= 0 ? world.balls[world.winner] : null;
  $('s-status').textContent = world.done
    ? `ended: ${world.endReason} at ${world.time.toFixed(2)}s${winner ? ` · winner ${winner.label ?? `ball ${winner.id}`}` : ''}`
    : world.firstEscapeStep >= 0
      ? `first escape at ${(world.firstEscapeStep * DT).toFixed(2)}s`
      : playing
        ? 'running'
        : 'paused';
  if (world.done) $('s-hash').textContent = world.hash();
  else $('s-hash').textContent = '— (shown when the run ends)';
}

// Main loop: fixed 240 Hz physics, rendered at the display's refresh rate.
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (world && renderer && !exporting && !directorOpen) {
    let rdt = 0;
    if (playing && !world.done) {
      acc += dt;
      while (acc >= DT && !world.done) {
        world.step();
        acc -= DT;
      }
      rdt = dt;
      pumpAudio();
    } else if (playing && world.done) {
      rdt = dt;
      if (!endedAt) endedAt = now;
      if (loopBox.checked && now - endedAt > 1500) restart();
    }
    renderer.render(world, rdt);
    updateStats();
  }
  requestAnimationFrame(frame);
}

// --- Controls --------------------------------------------------------------

sceneSelect.addEventListener('change', () => {
  store.set('scene', sceneSelect.value);
  seedInput.value = '';
  overrides.clear();
  void loadScene(false);
});
$('reset-tweaks').addEventListener('click', () => {
  overrides.clear();
  void loadScene(true);
});
$('save').addEventListener('click', () => {
  saveTweaks().catch((err) => ($('tweak-count').textContent = `Save failed: ${(err as Error).message}`));
});
seedInput.addEventListener('change', () => setSeed(Math.trunc(Number(seedInput.value) || 0)));
$('reroll').addEventListener('click', () => setSeed(Math.floor(Math.random() * 100000)));
$('restart').addEventListener('click', () => restart());
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  ensureAudio();
});
function syncSoundButton() {
  soundBtn.textContent = soundOn ? 'Sound on' : 'Sound off';
}
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('sound', soundOn ? '1' : '0');
  syncSoundButton();
  ensureAudio();
});
syncSoundButton();
document.addEventListener('pointerdown', () => ensureAudio(), { once: true });

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === 'r') $('reroll').click();
  else if (e.key === 'm') soundBtn.click();
  else if (e.key === 'Backspace') restart();
});

if (!canExport()) {
  exportBtn.disabled = true;
  $('export-msg').textContent = 'MP4 export needs WebCodecs (recent Chrome or Edge).';
}

exportBtn.addEventListener('click', () => {
  if (!scene) return;
  const name = currentEntry()?.name ?? 'scene';
  enqueue(`${name} · seed ${scene.seed}`, `${name}-seed${scene.seed}`, scene, {
    caption: captionText(caption(scene)),
    info: { scene: name, seed: scene.seed, speedScale: scene.world.speedScale, spinScale: scene.world.spinScale },
  });
  $('export-msg').textContent = 'Added to the export queue below.';
});

// Expose a small hook for automated checks and Claude Code ("folder mode").
(window as unknown as { studio: unknown }).studio = {
  get world() {
    return world;
  },
  get scene() {
    return scene;
  },
  exportMp4: () => (scene ? exportMp4(scene) : Promise.reject(new Error('no scene'))),
  /**
   * Dev server only: save a frame to captures/<name>.png. With `seconds`, renders the
   * exact export frame at that time (deterministic); without it, saves the live preview.
   */
  capture: async (name = 'frame', seconds?: number, type: 'image/png' | 'image/jpeg' = 'image/png') => {
    const source = seconds !== undefined && scene ? await renderStill(scene, seconds) : canvas;
    const blob = await new Promise<Blob | null>((r) => source.toBlob(r, type, 0.92));
    if (!blob) throw new Error('could not read the canvas');
    const res = await fetch(`/__studio/capture?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type }, body: blob });
    return res.json();
  },
};

// ---- Critic -----------------------------------------------------------------

let criticTimer = 0;
let criticToken = 0;
let criticNotes: string[] = [];
function scheduleCritic(): void {
  clearTimeout(criticTimer);
  criticTimer = window.setTimeout(async () => {
    if (!scene) return;
    const token = ++criticToken;
    const s = scene;
    $('critic-list').innerHTML = '<li class="muted">Checking…</li>';
    try {
      const loop = s.duration.trimStart > 0;
      const r = await scoreOne(s, loop ? { template: 'perfect-loop', target: s.duration.max - s.duration.trimStart } : { template: defaultTemplate(s), target: 30 });
      if (token !== criticToken) return;
      const notes = critique(s, r);
      criticNotes = notes.filter((n) => n.level === 'warn').map((n) => n.text);
      $('critic-list').replaceChildren(
        ...notes.map((n) => {
          const li = document.createElement('li');
          li.className = n.level;
          li.textContent = n.text;
          return li;
        }),
      );
      $<HTMLButtonElement>('critic-fix').hidden = criticNotes.length === 0;
    } catch (err) {
      $('critic-list').innerHTML = '';
      console.warn('critic failed', err);
    }
  }, 400);
}

$('critic-fix').addEventListener('click', () => {
  if (!criticNotes.length) return;
  const box = $<HTMLTextAreaElement>('ai-prompt');
  box.value = `The Critic flagged these problems with this scene:\n${criticNotes.map((n) => `- ${n}`).join('\n')}\nFix them while keeping the idea of the video. Re-check with npm run sim.`;
  $<HTMLButtonElement>('ai-send').click();
});

// ---- Hot scene updates, Claude, history, taste --------------------------------

window.addEventListener('songs-updated', (e) => {
  songs = (e as CustomEvent<Record<string, string>>).detail;
  if (scene) void loadScene(true, true);
});

initMusic({ set: setTweak });

window.addEventListener('scenes-updated', (e) => {
  const next = (e as CustomEvent<SceneEntry[]>).detail;
  const before = sources;
  scenes = next;
  sources = Object.fromEntries(scenes.map((s) => [s.name, s.raw]));
  const wanted = pendingSelect && sources[pendingSelect] ? pendingSelect : sceneSelect.value;
  const switched = wanted !== sceneSelect.value;
  if (wanted === pendingSelect) pendingSelect = '';
  fillSceneList(wanted);
  if (switched) store.set('scene', wanted);
  const current = sceneSelect.value;
  // Reload when the shown scene (or anything it extends) changed. The file is now the truth.
  if (switched || JSON.stringify(before[current]) !== JSON.stringify(sources[current]) || dependsOnChanged(current, before)) {
    overrides.clear();
    if (switched) seedInput.value = '';
    void loadScene(false);
  }
});

/** True if a scene this one extends changed. */
function dependsOnChanged(name: string, before: Record<string, unknown>): boolean {
  let raw = sources[name] as { extends?: string } | undefined;
  for (let i = 0; i < 10 && raw?.extends; i++) {
    const parent = raw.extends;
    if (JSON.stringify(before[parent]) !== JSON.stringify(sources[parent])) return true;
    raw = sources[parent] as { extends?: string } | undefined;
  }
  return false;
}

initAssistant({
  currentScene: () => currentEntry()?.name,
  onFile: (path) => {
    const m = /^scenes\/([\w-]+)\.json$/.exec(path);
    if (m && m[1] !== sceneSelect.value) pendingSelect = m[1];
  },
});

initRating(() => {
  const entry = currentEntry();
  if (!entry || !scene) return null;
  const kinds = scene.entities.map((e) => (e.type === 'ball' ? `${e.count}× ball r${e.radius}` : e.type)).join(', ');
  const raw = entry.raw as { extends?: string; modifiers?: unknown };
  const summary = [
    raw.extends ? `extends ${raw.extends}` : '',
    raw.modifiers ? `modifiers ${JSON.stringify(raw.modifiers)}` : '',
    kinds,
    `gravity ${JSON.stringify(scene.world.gravity)}`,
    `ends on ${scene.duration.endOn}`,
    `melody ${scene.audio.melody}/${scene.audio.instrument}`,
    `seed ${scene.seed}`,
    world ? `ran ${world.time.toFixed(1)}s, ${world.bounces} bounces${world.done ? `, ended ${world.endReason}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return { name: entry.name, title: scene.overlay.title ?? scene.title, summary };
});

initQueue({
  setExporting: (busy) => {
    exporting = busy;
    if (!busy) restart();
  },
});

const variantName = (r: RunScore) => {
  const name = currentEntry()?.name ?? 'scene';
  return `${name}-seed${r.seed}${r.speed !== 1 || r.spin !== 1 ? `-v${Math.round(r.speed * 100)}-${Math.round(r.spin * 100)}` : ''}`;
};

initDirector({
  scene: () => scene,
  sceneName: () => currentEntry()?.name ?? '',
  use: (r) => {
    setSeed(r.seed);
    setTweak('seed', r.seed);
    setTweak('world.speedScale', r.speed);
    setTweak('world.spinScale', r.spin);
    if (r.loop) {
      setTweak('duration.max', r.loop.to);
      setTweak('duration.trimStart', r.loop.from);
      setTweak('duration.endOn', 'never');
      setTweak('duration.tail', 0);
      setTweak('overlay.timer', false);
    }
  },
  keep: (item) => {
    const name = item.source?.name ?? currentEntry()?.name ?? 'scene';
    const r = item.r;
    const c = caption(item.scene, r.facts, r.winner);
    enqueue(`${item.source ? item.title : `${name} · seed ${r.seed}`}${r.score ? ` · score ${r.score.toFixed(0)}` : ''}`, item.source ? name : variantName(r), item.scene, {
      caption: captionText(c),
      info: { scene: name, seed: r.seed, speedScale: item.scene.world.speedScale, spinScale: item.scene.world.spinScale, score: r.score, winner: r.winner },
    });
  },
  sources: () => sources,
  resolve: async (name, extra) => {
    const s = resolveScene(name, { ...sources, ...extra });
    if (s.audio.melody.startsWith('midi:') && !s.audio.notes) {
      const song = await loadSong(songUrl(s.audio.melody.slice(5)));
      const { groups, times } = songGroups(song, s.audio.parts);
      s.audio.notes = groups;
      s.audio.noteTimes = times;
    }
    return s;
  },
  save: async (source) => {
    const res = await fetch(`/__studio/scene?name=${encodeURIComponent(source.name)}&create=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ $schema: '../scene.schema.json', ...source.raw }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()).name as string;
  },
  setOpen: (open) => {
    directorOpen = open;
  },
});

void loadScene(false);
requestAnimationFrame(frame);
