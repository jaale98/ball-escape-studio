import { applySong } from './audio/midi';
import { createMaster, playVoice, SoundMapper } from './audio/sound';
import { caption, captionText } from './director/caption';
import { hasScripts, preflight } from './director/check';
import { critique } from './director/critic';
import { weirdModifiers } from './director/remix';
import { revealColors } from './director/reveal';
import { direct, landingSpots, scoreOne } from './director/pool';
import { defaultTemplate, type RunScore } from './director/score';
import { PHYSICS_HZ, type Scene } from './engine/scene';
import { rateAt, type Timing, timingFor } from './engine/timing';
import { mergeSource, resolveScene } from './engine/source';
import { DT, rhythmLockStatus, World } from './engine/world';
import { canExport, exportMp4 } from './export/mp4';
import { AB_VARIANTS, type ExportOptions } from './export/presets';
import { renderStill } from './export/still';
import { TIKTOK_SAFE } from './render/look';
import { Renderer } from './render/renderer';
import { ensureImages } from './images';
import { categoryOf, entriesFrom, FAMILIES, type SceneEntry, sceneFiles } from './scenes';
import { loadSong, songFiles, songIndex, songUrls } from './songs';
import { initAssistant } from './ui/assistant';
import { initDirector } from './ui/director';
import { initExports, refreshExports } from './ui/exports';
import { closeGallery, initGallery, openGallery, refreshGallery } from './ui/gallery';
import { initRating, refreshHistory } from './ui/history';
import { ask } from './ui/modal';
import { initLook, refreshLook } from './ui/look';
import { initMusic, refreshMusic } from './ui/music';
import { enqueue, enqueueVariants, initQueue } from './ui/queue';
import { fmt, setPath, tunables } from './ui/sliders';
import { initTimeline, jumpToClimax, setLength, setRun, setTime } from './ui/timeline';

// Every JSON file in scenes/ is a scene. Edits arrive as hot updates (no page reload).
let scenes: SceneEntry[] = entriesFrom(sceneFiles);
let sources: Record<string, unknown> = Object.fromEntries(scenes.map((s) => [s.name, s.raw]));

// MIDI files in songs/ can be melodies: "audio": { "melody": "midi:minuet-in-g" }.
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
const presetSel = $<HTMLSelectElement>('x-preset');
const fpsSel = $<HTMLSelectElement>('x-fps');
const safeBox = $<HTMLInputElement>('x-safe');
const zonesBox = $<HTMLInputElement>('x-zones');
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
/** Notes sent to the speakers so far (diagnostics: window.studio.audioInfo()). */
let voicesPlayed = 0;
let playing = true;
let exporting = false;
let seeking = false;
/** An overlay covers the stage (Director, gallery): pause the main preview. */
let directorOpen = false;
let endedAt = 0;
/** Video time since restart (drives the countdown). */
let videoClock = 0;
let climaxPlayed = false;
/** Climax step from the Critic's headless run (-1 until known): lets slow motion start before the climax. */
let knownClimaxStep = -1;
let timing: Timing = { intro: 0, slowStart: -1, slowEnd: -1, factor: 1 };
let audio: { ctx: AudioContext; master: AudioNode } | null = null;
let soundOn = store.get('sound') === '1';
/** A scene that should be shown as soon as it arrives (Claude or a gallery action made it). */
let pendingSelect = '';

// ---- Tabs ---------------------------------------------------------------------

function showTab(tab: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const s of document.querySelectorAll<HTMLElement>('section.tab')) s.hidden = s.dataset.tab !== tab;
  store.set('tab', tab);
  if (tab === 'history') void refreshExports();
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab!));
showTab(store.get('tab') ?? 'create');

// ---- Scene list -----------------------------------------------------------------

/** Remixes and tournament matches are listed under the scene they came from. */
function fillSceneList(selected: string): void {
  const names = new Set(scenes.map((s) => s.name));
  const parent = (n: string) => {
    const m = /^(.+?)-(remix-\d+|cup.*)$/.exec(n);
    return m && names.has(m[1]) ? m[1] : null;
  };
  const top = scenes.filter((s) => !parent(s.name));
  const kids = scenes.filter((s) => parent(s.name));
  const opt = (s: SceneEntry) => new Option(`${s.name}`, s.name);
  // Grouped by family (Escape, Destruction, Teams…).
  sceneSelect.replaceChildren();
  for (const [fam, label] of FAMILIES) {
    const inFam = top.filter((s) => categoryOf(s, scenes) === fam);
    if (!inFam.length) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...inFam.map(opt));
    sceneSelect.append(g);
  }
  if (kids.length) {
    const g = document.createElement('optgroup');
    g.label = 'Remixes & matches';
    g.append(...kids.map(opt));
    sceneSelect.append(g);
  }
  sceneSelect.value = names.has(selected) ? selected : (top[0]?.name ?? '');
  shownScene = sceneSelect.value;
}
let shownScene = '';
fillSceneList(store.get('scene') ?? '');

function currentEntry() {
  return scenes.find((s) => s.name === shownScene);
}

// ---- Unsaved changes ---------------------------------------------------------------

/** Every change not yet saved to the file (sliders, seed, music, Director picks): dotted path -> value. */
const overrides = new Map<string, unknown>();
let loadToken = 0;

function updateDirty(): void {
  const n = overrides.size;
  $('dirty-bar').hidden = n === 0;
  const labels = [...overrides.keys()].map((p) => (p === 'seed' ? 'seed' : p.split('.').slice(-1)[0]));
  $('dirty-text').textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}: ${[...new Set(labels)].slice(0, 4).join(', ')}${labels.length > 4 ? '…' : ''}` : '';
  $('dirty-text').title = [...overrides.keys()].join('\n');
  // The "Make it weird" note only makes sense while its change is unsaved.
  if (n === 0 && $('export-msg').textContent?.startsWith('Weird:')) $('export-msg').textContent = '';
}

/** Set (or with undefined, clear) a change from any panel, and re-run the preview. */
function setTweak(path: string, value: unknown, rebuild = true): void {
  overrides.set(path, value);
  updateDirty();
  clearTimeout(sliderTimer);
  sliderTimer = window.setTimeout(() => void loadScene(rebuild), rebuild ? 60 : 120);
}

/** Write all unsaved changes into the scene file (dev server only). */
async function saveChanges(): Promise<boolean> {
  const entry = currentEntry();
  if (!entry || !overrides.size) return true;
  const merged = mergeSource(entry.name, sources);
  const child = structuredClone(entry.raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const inheritedMods = ((merged.modifiers as unknown[]) ?? []).length - ((child.modifiers as unknown[]) ?? []).length;
  const skipped: string[] = [];
  for (const [path, v] of overrides) {
    const parts = path.split('.');
    if (parts[0] === 'modifiers' && parts.length === 1) {
      // The whole list (Make it weird): inherited modifiers come first; keep this file's share.
      const list = Array.isArray(v) ? v.slice(inheritedMods) : [];
      if (list.length) child.modifiers = list;
      else delete child.modifiers;
      continue;
    }
    if (parts[0] === 'modifiers') {
      const i = Number(parts[1]) - inheritedMods;
      if (i < 0) {
        skipped.push(path);
        continue;
      }
      setPath(child, ['modifiers', String(i), ...parts.slice(2)].join('.'), v);
      continue;
    }
    // A change to an inherited value copies that whole section into this file.
    if (!(parts[0] in child)) child[parts[0]] = structuredClone(merged[parts[0]]);
    setPath(child, path, v);
  }
  try {
    const res = await fetch(`/__studio/scene?name=${encodeURIComponent(entry.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(child, null, 2),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  } catch (err) {
    $('save-msg').textContent = `Save failed: ${(err as Error).message}. Saving needs the dev server (npm run dev).`;
    return false;
  }
  $('save-msg').textContent = skipped.length ? `Saved. Not saved (a modifier inherited from another scene): ${skipped.join(', ')}` : `Saved to scenes/${entry.name}.json.`;
  setTimeout(() => ($('save-msg').textContent = ''), 4000);
  // The file change arrives as a hot update, which clears the changes and reloads.
  return true;
}

function discardChanges(): void {
  overrides.clear();
  updateDirty();
  void loadScene();
}

/** Ask what to do with unsaved changes before leaving this scene. Resolves false to stay. */
async function confirmLeave(): Promise<boolean> {
  if (!overrides.size) return true;
  const r = await ask({
    title: `Save your changes to “${shownScene}”?`,
    body: `You have ${overrides.size} unsaved change${overrides.size === 1 ? '' : 's'}.`,
    buttons: [
      { label: 'Save', value: 'save', primary: true },
      { label: 'Discard', value: 'discard', danger: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (r.value === 'cancel') return false;
  if (r.value === 'save' && !(await saveChanges())) return false;
  overrides.clear();
  updateDirty();
  return true;
}

/** Switch scenes (asking about unsaved changes first). */
async function openScene(name: string): Promise<void> {
  if (name === shownScene) return;
  if (!(await confirmLeave())) {
    sceneSelect.value = shownScene;
    return;
  }
  if (!sources[name]) {
    pendingSelect = name; // not here yet: it arrives with the next hot update
    return;
  }
  shownScene = name;
  sceneSelect.value = name;
  store.set('scene', name);
  void loadScene();
}

window.addEventListener('beforeunload', (e) => {
  if (overrides.size) e.preventDefault();
});

// ---- Loading a scene ---------------------------------------------------------------

/** Resolve the shown scene (extends, modifiers, prefabs, changes, MIDI) and restart. */
async function loadScene(rebuild = true): Promise<void> {
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
      if (!resolved.audio.notes) applySong(resolved.audio, song);
    }
    const missingImages = await ensureImages(resolved);
    if (token !== loadToken) return;
    $('image-msg').textContent = missingImages.length ? `Missing pictures (not in images/): ${missingImages.join(', ')}` : '';
    // Scripted scenes run headless in a Worker first: a runaway script fails there, not here.
    if (hasScripts(resolved)) {
      const scriptError = await preflight(resolved);
      if (token !== loadToken) return;
      $('script-msg').textContent = scriptError ? `Script error: ${scriptError} (that script was switched off)` : '';
    } else $('script-msg').textContent = '';
    scene = resolved;
    // Picture reveal: find where every ball lands in a worker, then color the balls (the run itself is unchanged).
    const PREPARING = 'Preparing the picture reveal…';
    if ($('export-msg').textContent === PREPARING) $('export-msg').textContent = '';
    if (resolved.style.reveal && (resolved.style.reveal.text || resolved.style.reveal.image)) {
      $('export-msg').textContent = PREPARING;
      void landingSpots(resolved)
        .then((spots) => {
          if (scene !== resolved) return;
          if ($('export-msg').textContent === PREPARING) $('export-msg').textContent = '';
          const colors = revealColors(resolved, spots);
          if (!colors) return;
          resolved.style.revealColors = colors;
          for (const b of world?.balls ?? []) if (colors[b.id]) b.color = colors[b.id];
        })
        .catch((err) => ($('export-msg').textContent = `Picture reveal failed: ${(err as Error).message}`));
    }
    seedInput.value = String(scene.seed);
    $('resolved-json').textContent = JSON.stringify({ ...scene, audio: { ...scene.audio, notes: scene.audio.notes ? `(${scene.audio.notes.length} note groups)` : undefined, noteTimes: undefined } }, null, 2);
    refreshMusic(scene, Object.keys(songs), song, rhythmLockStatus(scene));
    if (rebuild) refreshLook(scene, mergedSource());
    errorBox.hidden = true;
    if (rebuild) {
      buildSliders();
      void refreshHistory(entry.name);
    }
    updateDirty();
    knownClimaxStep = -1;
    setLength(scene.duration.max);
    applyVolume();
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

// ---- Sliders (Tune tab) -------------------------------------------------------------

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
      row.classList.add('changed');
      setTweak(t.path, v, false);
    });
    row.append(name, input, out);
    box.append(row);
  }
}

// ---- Playback ----------------------------------------------------------------------

/** The preview draws with the export's style toggle (and the safe-zone overlay when it's on). */
function makePreviewRenderer(s: Scene): Renderer {
  const r = new Renderer(canvas, s, { safe: safeBox.checked ? TIKTOK_SAFE : null });
  r.showSafeZones = zonesBox.checked;
  return r;
}

function restart(): void {
  if (!scene) return;
  world = new World(scene);
  renderer = makePreviewRenderer(scene);
  mapper = new SoundMapper(scene, world.rhythmK);
  audioCursor = 0;
  endedAt = 0;
  videoClock = 0;
  climaxPlayed = false;
  timing = timingFor(scene, knownClimaxStep);
  renderer.render(world, 0);
  setTime(0);
}

/**
 * Jump to time t. Runs are deterministic, so this re-simulates from the start;
 * the last half second is drawn frame by frame so trails and effects look right.
 */
async function seek(t: number): Promise<void> {
  if (!scene || seeking) return;
  seeking = true;
  try {
    restart();
    const w = world!;
    const r = renderer!;
    const warm = Math.max(0, t - 0.5);
    let n = 0;
    while (!w.done && w.time < warm) {
      w.step();
      if (++n % 4000 === 0) {
        $('tl-time').textContent = 'seeking…';
        await new Promise((res) => setTimeout(res, 0));
        if (w !== world) return; // replaced meanwhile
      }
    }
    while (!w.done && w.time < t) {
      for (let s = 0; s < 4 && !w.done; s++) w.step();
      r.render(w, 1 / 60);
    }
    r.render(w, 0);
    audioCursor = w.events.length; // don't replay the skipped sounds
    if (t > 0) videoClock = timing.intro; // past the countdown
    climaxPlayed = w.climaxStep >= 0;
    if (w.done) endedAt = performance.now();
    setTime(w.time);
  } finally {
    seeking = false;
  }
}

/**
 * Start (or resume) audio. Browsers only allow this during a click or key
 * press, so it is called from every user gesture until audio is running.
 */
function ensureAudio(): void {
  if (!soundOn) return;
  if (!audio) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    audio = { ctx, master: createMaster(ctx, scene?.audio.volume ?? 0.7) };
    ctx.onstatechange = () => syncSound();
  }
  if (audio.ctx.state !== 'running') void audio.ctx.resume().then(syncSound, syncSound);
  syncSound();
}

/** Each scene has its own volume. */
function applyVolume(): void {
  if (audio && scene) (audio.master as GainNode).gain.value = scene.audio.volume;
}

/** Audio-clock watchdog: if the context says it's running but its clock stops, rebuild it. */
let clockSeen = { ctx: -1, real: 0 };

function pumpAudio(): void {
  if (!world || !mapper || !scene) return;
  const events = world.events;
  if (!soundOn || !audio || audio.ctx.state !== 'running') {
    audioCursor = events.length;
    return;
  }
  const realNow = performance.now();
  if (audio.ctx.currentTime !== clockSeen.ctx) clockSeen = { ctx: audio.ctx.currentTime, real: realNow };
  else if (realNow - clockSeen.real > 1500) {
    // The audio thread is stuck (an overload can do this): start a fresh context.
    clockSeen = { ctx: -1, real: realNow };
    void audio.ctx.close().catch(() => {});
    audio = null;
    ensureAudio();
    audioCursor = events.length;
    return;
  }
  const now = audio.ctx.currentTime + 0.03;
  if (!climaxPlayed && world.climaxStep >= 0) {
    climaxPlayed = true;
    for (const v of mapper.climax(world.climaxStep)) playVoice(audio.ctx, audio.master, v, now, scene.audio.instrument);
  }
  // The mapper limits sounds by simulation time; this also caps each frame, so a
  // backlog (a slow frame, a busy tab) can't flood the audio thread at once.
  let budget = 24;
  for (; audioCursor < events.length; audioCursor++) {
    for (const v of mapper.map(events[audioCursor])) {
      if (budget <= 0) continue;
      budget--;
      try {
        playVoice(audio.ctx, audio.master, v, now + v.delay, scene.audio.instrument);
        voicesPlayed++;
      } catch (err) {
        console.warn('sound skipped', err);
      }
    }
  }
}

function updateStats(): void {
  if (!world) return;
  setTime(world.time);
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
  $('s-hash').textContent = world.done ? world.hash() : '— (shown when the run ends)';
}

// Main loop: fixed 240 Hz physics, rendered at the display's refresh rate.
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (world && renderer && !exporting && !directorOpen && !seeking) {
    let rdt = 0;
    if (playing && !world.done) {
      // Countdown: the run waits; slow motion: it runs slower (see engine/timing.ts).
      videoClock += dt;
      renderer.intro = Math.max(0, timing.intro - videoClock);
      if (renderer.intro <= 0) {
        acc += dt * rateAt(timing, world.stepCount);
        while (acc >= DT && !world.done) {
          world.step();
          acc -= DT;
          // A climax we didn't know about yet (first play): slow from here.
          if (world.climaxStep >= 0 && timing.slowStart < 0 && scene!.camera.slowmo > 0) {
            timing = timingFor(scene!, world.climaxStep);
            timing.slowStart = world.climaxStep;
            break;
          }
          if (rateAt(timing, world.stepCount) < 1 && acc > DT) acc = Math.min(acc, DT);
        }
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

function setPlaying(p: boolean): void {
  playing = p;
  playBtn.textContent = playing ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  ensureAudio();
}

function syncSound(): void {
  // Off: a clear call to action (bounces play music, so sound matters). On and
  // playing: a quiet icon. On but blocked by the browser (no click since the
  // page loaded): say so, because otherwise it looks on while staying silent.
  const blocked = soundOn && (!audio || audio.ctx.state !== 'running');
  soundBtn.textContent = !soundOn ? '🔇 Turn on sound' : blocked ? '🔈 Click to start sound' : '🔊';
  soundBtn.className = soundOn && !blocked ? 'icon' : 'sound-off';
  soundBtn.setAttribute('aria-label', !soundOn ? 'Sound off (M to turn on)' : blocked ? 'Sound is on but the browser is waiting for a click' : 'Sound on (M to mute)');
}
function toggleSound(on = !soundOn): void {
  // Clicking the button while the browser is blocking audio starts it rather than muting.
  if (on === false && soundOn && (!audio || audio.ctx.state !== 'running')) {
    ensureAudio();
    return;
  }
  soundOn = on;
  store.set('sound', soundOn ? '1' : '0');
  syncSound();
  ensureAudio();
}

// ---- Controls ------------------------------------------------------------------------

sceneSelect.addEventListener('change', () => void openScene(sceneSelect.value));
$('save').addEventListener('click', () => void saveChanges());
$('discard').addEventListener('click', discardChanges);
seedInput.addEventListener('change', () => setTweak('seed', Math.trunc(Number(seedInput.value) || 0)));
$('reroll').addEventListener('click', () => setTweak('seed', Math.floor(Math.random() * 100000)));
$('restart').addEventListener('click', () => restart());
playBtn.addEventListener('click', () => setPlaying(!playing));
soundBtn.addEventListener('click', () => toggleSound());
syncSound();
// Any click or key press can start audio (browsers require one after every page load).
for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, () => soundOn && (!audio || audio.ctx.state !== 'running') && ensureAudio(), true);
initTimeline((t) => void seek(t));

const overlayOpen = () => ['director', 'review', 'gallery', 'welcome', 'help', 'modal'].some((id) => !$(id).hidden);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    void saveChanges();
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (!$('help').hidden) $('help').hidden = true;
    else if (!$('welcome').hidden) closeWelcome();
    else if (!$('gallery').hidden) closeGallery();
    return;
  }
  if (e.key === '?') {
    $('help').hidden = false;
    return;
  }
  if (overlayOpen()) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === 'r') $('reroll').click();
  else if (e.key === 'm') toggleSound();
  else if (e.key === 'j') jumpToClimax();
  else if (e.key === 'b') openGallery();
  else if (e.key === 'd') $('open-director').click();
  else if (e.key === 'e') exportBtn.click();
  else if (e.key === 'Backspace') restart();
});

if (!canExport()) {
  exportBtn.disabled = true;
  $('export-msg').textContent = 'MP4 export needs WebCodecs (recent Chrome or Edge).';
}

// Export settings: preset, frame rate, style. Remembered per browser.
function exportOpts(): ExportOptions {
  return { preset: presetSel.value === 'tiktok' ? 'tiktok' : 'studio', fps: fpsSel.value === '30' ? 30 : 60, safe: safeBox.checked };
}
presetSel.value = store.get('x-preset') ?? 'studio';
fpsSel.value = store.get('x-fps') ?? '60';
safeBox.checked = store.get('x-safe') === '1';
zonesBox.checked = store.get('x-zones') === '1';
presetSel.addEventListener('change', () => store.set('x-preset', presetSel.value));
fpsSel.addEventListener('change', () => store.set('x-fps', fpsSel.value));
/** Redraw the preview with the new look at the same moment (the run itself doesn't change). */
function refreshLookToggles(): void {
  store.set('x-safe', safeBox.checked ? '1' : '0');
  store.set('x-zones', zonesBox.checked ? '1' : '0');
  // A fresh renderer has no trails yet and would replay every past spark, so re-run to this moment instead.
  if (world && renderer) void seek(world.time);
}
safeBox.addEventListener('change', refreshLookToggles);
zonesBox.addEventListener('change', () => {
  if (renderer) renderer.showSafeZones = zonesBox.checked;
  store.set('x-zones', zonesBox.checked ? '1' : '0');
});

function exportMeta(s: Scene, name: string) {
  return { caption: captionText(caption(s)), info: { scene: name, seed: s.seed, speedScale: s.world.speedScale, spinScale: s.world.spinScale } };
}

exportBtn.addEventListener('click', () => {
  if (!scene) return;
  const name = currentEntry()?.name ?? 'scene';
  enqueue(`${name} · seed ${scene.seed}`, `${name}-seed${scene.seed}`, scene, exportMeta(scene, name), exportOpts());
  $('export-msg').textContent = 'Added to the export queue below.';
});

/** The same run (same scene, same seed) four ways: normal / TikTok-safe style × 60 / 30 fps, all with the TikTok preset. */
function exportAB(): void {
  if (!scene) return;
  const name = currentEntry()?.name ?? 'scene';
  enqueueVariants(`${name} · seed ${scene.seed}`, `${name}-seed${scene.seed}`, scene, exportMeta(scene, name), AB_VARIANTS);
  $('export-msg').textContent = 'Queued 4 A/B variants (TikTok preset: normal / safe × 60 / 30 fps).';
}
$('export-ab').addEventListener('click', exportAB);

// ---- Welcome and shortcuts --------------------------------------------------------------

function closeWelcome(): void {
  $('welcome').hidden = true;
  store.set('welcomed', '1');
}
$('w-start').addEventListener('click', () => {
  closeWelcome();
  toggleSound(true);
  setPlaying(true);
  restart();
});
$('w-browse').addEventListener('click', () => {
  closeWelcome();
  openGallery();
});
$('w-close').addEventListener('click', closeWelcome);
$('show-tips').addEventListener('click', () => ($('welcome').hidden = false));
$('help-btn').addEventListener('click', () => ($('help').hidden = false));
$('help-close').addEventListener('click', () => ($('help').hidden = true));
if (!store.get('welcomed')) $('welcome').hidden = false;

// ---- Automation hook --------------------------------------------------------------------

// Expose a small hook for automated checks and Claude Code ("folder mode").
(window as unknown as { studio: unknown }).studio = {
  get world() {
    return world;
  },
  get scene() {
    return scene;
  },
  exportMp4: (opts?: Partial<ExportOptions>) => (scene ? exportMp4(scene, undefined, opts) : Promise.reject(new Error('no scene'))),
  /** Queue an export with explicit options, e.g. studio.exportTikTok({ fps: 30, safe: true }). Defaults: tiktok, 60 fps, current style toggle. */
  exportTikTok: (opts: Partial<ExportOptions> = {}) => {
    if (!scene) throw new Error('no scene');
    const name = currentEntry()?.name ?? 'scene';
    enqueue(`${name} · seed ${scene.seed}`, `${name}-seed${scene.seed}`, scene, exportMeta(scene, name), { preset: 'tiktok', fps: 60, safe: safeBox.checked, ...opts });
  },
  /** Queue the 4 A/B variants of the current run. */
  exportAB: () => exportAB(),
  seek: (t: number) => seek(t),
  audioInfo: () => ({ soundOn, playing, state: audio?.ctx.state ?? 'none', sampleRate: audio?.ctx.sampleRate, voicesPlayed, events: world?.events.length ?? 0, cursor: audioCursor, done: world?.done, exporting, directorOpen, seeking }),
  open: (name: string) => openScene(name),
  /**
   * Dev server only: save a frame to captures/<name>.png. With `seconds`, renders the
   * exact export frame at that time (deterministic); without it, saves the live preview.
   */
  capture: async (name = 'frame', seconds?: number, type: 'image/png' | 'image/jpeg' = 'image/png', look: { fps?: number; safe?: boolean } = {}) => {
    const source = seconds !== undefined && scene ? await renderStill(scene, seconds, 1, look) : canvas;
    const blob = await new Promise<Blob | null>((r) => source.toBlob(r, type, 0.92));
    if (!blob) throw new Error('could not read the canvas');
    const res = await fetch(`/__studio/capture?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type }, body: blob });
    return res.json();
  },
};

// ---- Critic (and the timeline's markers) ---------------------------------------------------

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
      setRun(r.length, r.markers, r.climax);
      knownClimaxStep = r.climax >= 0 ? Math.round(r.climax * PHYSICS_HZ) : -1;
      if (world && world.stepCount === 0) timing = timingFor(s, knownClimaxStep);
      else if (world && timing.slowStart < 0) timing = { ...timingFor(s, knownClimaxStep), intro: timing.intro };
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
  showTab('create');
  const box = $<HTMLTextAreaElement>('ai-prompt');
  box.value = `The Critic flagged these problems with this scene:\n${criticNotes.map((n) => `- ${n}`).join('\n')}\nFix them while keeping the idea of the video. Re-check with npm run sim.`;
  $<HTMLButtonElement>('ai-send').click();
});

// ---- Hot updates: scenes and songs ----------------------------------------------------------

window.addEventListener('images-updated', () => {
  if (scene) void loadScene();
});

window.addEventListener('songs-updated', (e) => {
  songs = (e as CustomEvent<Record<string, string>>).detail;
  if (scene) void loadScene();
});

initMusic({
  set: (path, value) => setTweak(path, value),
  audio: () => {
    if (!soundOn) return null;
    ensureAudio();
    return audio && audio.ctx.state === 'running' ? audio : null;
  },
});
initLook({ set: (path, value, rebuild) => setTweak(path, value, rebuild) });

/** The shown scene's source after extends, with unsaved changes applied (what the Look and Tune tabs edit). */
function mergedSource(): Record<string, unknown> {
  const entry = currentEntry();
  if (!entry) return {};
  const merged = mergeSource(entry.name, sources);
  for (const [path, v] of overrides) setPath(merged, path, v);
  return merged;
}

// Make it weird: stack a few surreal modifiers as an unsaved change (Discard undoes it).
let weirdCount = 0;
$('b-weird').addEventListener('click', () => {
  const merged = mergedSource();
  const picks = weirdModifiers(merged, (scene?.seed ?? 1) * 31 + ++weirdCount);
  if (!picks.length) return;
  const before = Array.isArray(merged.modifiers) ? merged.modifiers : [];
  setTweak('modifiers', [...before, ...picks]);
  const names = picks.map((m) => (typeof m === 'string' ? m : (m as { use: string }).use));
  $('export-msg').textContent = `Weird: added ${names.join(' + ')}. Discard undoes it; Save keeps it.`;
});

// Rhythm lock: one click to find a seed whose bounces stay on the beat.
$('rhythm-find').addEventListener('click', async () => {
  if (!scene) return;
  const btn = $<HTMLButtonElement>('rhythm-find');
  btn.disabled = true;
  btn.textContent = 'Trying seeds…';
  try {
    const search = direct(scene, { template: 'music-sync', target: 30 }, 150, 0, (done, total) => (btn.textContent = `Trying seeds… ${done}/${total}`));
    const [best] = await search.done;
    setTweak('seed', best.seed);
    $('rhythm-why').textContent = `Seed ${best.seed}: ${best.facts.join(', ')}. Save to keep it.`;
  } catch (err) {
    $('rhythm-why').textContent = `Search failed: ${(err as Error).message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find a seed that stays in time';
  }
});

window.addEventListener('scenes-updated', (e) => {
  const next = (e as CustomEvent<SceneEntry[]>).detail;
  const before = sources;
  scenes = next;
  sources = Object.fromEntries(scenes.map((s) => [s.name, s.raw]));
  let wanted = pendingSelect && sources[pendingSelect] ? pendingSelect : shownScene;
  // The shown scene was renamed or deleted: go to the scene it built on, if any.
  if (!sources[wanted]) {
    const parent = (before[wanted] as { extends?: string } | undefined)?.extends;
    wanted = parent && sources[parent] ? parent : (scenes[0]?.name ?? '');
  }
  const switched = wanted !== shownScene;
  if (wanted === pendingSelect) pendingSelect = '';
  fillSceneList(wanted);
  if (switched) store.set('scene', wanted);
  refreshGallery();
  const current = shownScene;
  // Reload when the shown scene (or anything it builds on) changed: the file is now the truth.
  if (switched || JSON.stringify(before[current]) !== JSON.stringify(sources[current]) || dependsOnChanged(current, before)) {
    overrides.clear();
    void loadScene();
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

// ---- Panels wired to the rest ----------------------------------------------------------------

initAssistant({
  currentScene: () => currentEntry()?.name,
  onFile: (path) => {
    const m = /^scenes\/([\w-]+)\.json$/.exec(path);
    if (m && m[1] !== shownScene) pendingSelect = m[1];
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
    `melody ${scene.audio.melody}${songIndex[scene.audio.melody.slice(5)] ? ` (${songIndex[scene.audio.melody.slice(5)].title})` : ''}/${scene.audio.instrument}${scene.audio.rhythmLock ? ', rhythm lock' : ''}`,
    `seed ${scene.seed}`,
    world ? `ran ${world.time.toFixed(1)}s, ${world.bounces} bounces${world.done ? `, ended ${world.endReason}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return { name: entry.name, title: scene.overlay.title ?? scene.title, summary };
});

const resumed = initQueue({
  setExporting: (busy) => {
    exporting = busy;
    if (!busy) restart();
  },
  onSaved: () => {
    if (!$<HTMLElement>('history-list').closest('section')!.hidden) void refreshExports();
  },
});
if (resumed) $('export-msg').textContent = `Resumed ${resumed} unfinished export${resumed === 1 ? '' : 's'} from last time.`;

async function createScene(name: string, raw: unknown): Promise<string> {
  const res = await fetch(`/__studio/scene?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(raw),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (await res.json()).name as string;
}

initExports({
  reexport: (label, fileName, s) => {
    enqueue(label, fileName, s, exportMeta(s, fileName), exportOpts());
    showTab('create');
  },
  openAsScene: async (name, s) => {
    const { notes, noteTimes, ...audioRest } = s.audio;
    void notes;
    void noteTimes;
    const made = await createScene(name, { $schema: '../scene.schema.json', ...s, audio: audioRest });
    await openScene(made);
  },
});

initGallery({
  scenes: () => scenes,
  sources: () => sources,
  current: () => shownScene,
  open: (name) => void openScene(name),
  op: async (op, name, to) => {
    if (op === 'delete' && name === shownScene && overrides.size) {
      overrides.clear();
      updateDirty();
    }
    const res = await fetch('/__studio/scene-op', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, name, to }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}. Managing scenes needs the dev server (npm run dev).`);
    if (op !== 'delete') pendingSelect = body.name;
    return body.name as string;
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
    }, exportOpts());
  },
  sources: () => sources,
  resolve: async (name, extra) => {
    const s = resolveScene(name, { ...sources, ...extra });
    if (s.audio.melody.startsWith('midi:') && !s.audio.notes) {
      applySong(s.audio, await loadSong(songUrl(s.audio.melody.slice(5))));
    }
    await ensureImages(s);
    return s;
  },
  save: (source) => createScene(source.name, { $schema: '../scene.schema.json', ...source.raw }),
  setOpen: (open) => {
    directorOpen = open;
  },
  audio: () => {
    if (!soundOn) return null;
    ensureAudio();
    return audio;
  },
});

void loadScene();
requestAnimationFrame(frame);
