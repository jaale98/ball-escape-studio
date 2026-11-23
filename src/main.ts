import { createMaster, playVoice, SoundMapper } from './audio/sound';
import { parseScene, type Scene } from './engine/scene';
import { DT, World } from './engine/world';
import { canExport, exportMp4 } from './export/mp4';
import { renderStill } from './export/still';
import { Renderer } from './render/renderer';

// Every JSON file in scenes/ is a scene. Editing one triggers a Vite reload.
const files = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const scenes = Object.entries(files)
  .map(([path, raw]) => ({ name: path.split('/').pop()!.replace(/\.json$/, ''), path: path.replace('../', ''), raw }))
  .sort((a, b) => a.name.localeCompare(b.name));

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
let endedAt = 0;
let audio: { ctx: AudioContext; master: AudioNode } | null = null;
let soundOn = store.get('sound') === '1';

for (const s of scenes) sceneSelect.add(new Option(s.name, s.name));
sceneSelect.value = scenes.some((s) => s.name === store.get('scene')) ? store.get('scene')! : (scenes[0]?.name ?? '');

function currentEntry() {
  return scenes.find((s) => s.name === sceneSelect.value);
}

/** Load the selected scene file. Keeps the seed from the UI when `keepSeed` is set. */
function loadScene(keepSeed: boolean): void {
  const entry = currentEntry();
  if (!entry) return;
  $('scene-path').textContent = entry.path;
  $('scene-json').textContent = JSON.stringify(entry.raw, null, 2);
  try {
    const parsed = parseScene(entry.raw);
    // A UI seed is remembered per scene, but only while the file's own seed is
    // unchanged: editing the seed in the file always wins.
    const [fileSeed, uiSeed] = (store.get(`seed:${entry.name}`) ?? '').split(':').map(Number);
    const remembered = fileSeed === parsed.seed && Number.isFinite(uiSeed) ? uiSeed : parsed.seed;
    const seed = keepSeed && seedInput.value !== '' ? Number(seedInput.value) : remembered;
    scene = { ...parsed, seed };
    seedInput.value = String(seed);
    errorBox.hidden = true;
    restart();
  } catch (err) {
    scene = null;
    world = null;
    errorBox.hidden = false;
    errorBox.textContent = `${entry.path}\n${(err as Error).message}`;
  }
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
  const fileSeed = entry ? (entry.raw as { seed?: number }).seed ?? 1 : 1;
  store.set(`seed:${sceneSelect.value}`, `${fileSeed}:${seed}`);
  loadScene(true);
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
  $('s-escapes').textContent = String(world.escapes);
  $('s-status').textContent = world.done
    ? `ended: ${world.endReason} at ${world.time.toFixed(2)}s`
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
  if (world && renderer && !exporting) {
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
  loadScene(false);
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
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

exportBtn.addEventListener('click', async () => {
  if (!scene || exporting) return;
  exporting = true;
  exportBtn.disabled = true;
  const progress = $('progress');
  const bar = $('bar');
  const label = $('progress-label');
  const msg = $('export-msg');
  progress.hidden = false;
  msg.textContent = '';
  const names = { simulate: 'Simulating', audio: 'Rendering audio', video: 'Encoding video', finish: 'Encoding audio' };
  try {
    const result = await exportMp4(scene, (stage, f) => {
      bar.style.width = `${Math.round((stage === 'video' ? f : stage === 'finish' ? 1 : 0) * 100)}%`;
      label.textContent = `${names[stage]}${stage === 'video' ? ` ${Math.round(f * 100)}%` : '…'}`;
    });
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sceneSelect.value}-seed${scene.seed}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    msg.textContent =
      `Saved ${a.download}: ${result.seconds.toFixed(1)}s video, ${(result.blob.size / 1e6).toFixed(1)} MB, ` +
      `rendered in ${(result.ms / 1000).toFixed(1)}s (${result.codec}). ` +
      (result.deterministic ? 'Determinism check passed.' : 'Warning: render pass diverged from the pre-pass.');
  } catch (err) {
    msg.textContent = `Export failed: ${(err as Error).message}`;
    console.error(err);
  } finally {
    progress.hidden = true;
    exporting = false;
    exportBtn.disabled = false;
    restart();
  }
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

loadScene(false);
requestAnimationFrame(frame);
