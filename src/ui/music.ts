/**
 * Music tab: pick a song (the songbook, your own MIDI files, or improvised),
 * lock the bounces to its rhythm, choose which track plays on bounces, add the
 * rest of the song as backing, preview tracks, and drop .mid files onto the
 * studio to add them. Choices are unsaved changes: they preview instantly and
 * Save writes them into the scene.
 */
import { type MidiPart, type MidiSong, noteName, partRoles } from '../audio/midi';
import { playVoice } from '../audio/sound';
import type { Scene } from '../engine/scene';
import { songIndex } from '../songs';

export interface MusicHooks {
  /** Set a change (dotted path in the scene source) and re-run the preview. */
  set(path: string, value: unknown): void;
  /** Where to play a track preview (null = sound is off). */
  audio(): { ctx: AudioContext; master: AudioNode } | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CATEGORY_ORDER = ['Classical', 'Ragtime & marches', 'Folk & traditional', 'Nursery & kids'];
const LEGACY: Record<string, string> = { 'ode-to-joy': 'Ode to Joy (simple, no timing)', 'fur-elise': 'Für Elise (simple, no timing)' };

let hooks: MusicHooks;
let lastSong: MidiSong | null = null;
let lastScene: Scene | null = null;
let previewStop: (() => void) | null = null;

export function initMusic(h: MusicHooks): void {
  hooks = h;
  $<HTMLSelectElement>('melody').addEventListener('change', (e) => {
    hooks.set('audio.melody', (e.target as HTMLSelectElement).value);
    // A new song starts from its defaults: the melody on bounces, no backing choices.
    hooks.set('audio.parts', undefined);
    hooks.set('audio.backingParts', undefined);
  });
  $<HTMLSelectElement>('bounce-part').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'auto') hooks.set('audio.parts', undefined);
    else if (v === 'all') hooks.set('audio.parts', lastSong?.parts.map((p) => p.id));
    else hooks.set('audio.parts', [Number(v)]);
    hooks.set('audio.backingParts', undefined);
  });
  $<HTMLInputElement>('chords').addEventListener('change', (e) => hooks.set('audio.chords', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('backing').addEventListener('change', (e) => hooks.set('audio.backing', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('backing-volume').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    $('backing-vol-out').textContent = `${Math.round(v * 100)}%`;
    hooks.set('audio.backingVolume', v);
  });
  $<HTMLInputElement>('rhythm-lock').addEventListener('change', (e) => hooks.set('audio.rhythmLock', (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('tempo-auto').addEventListener('change', (e) => {
    const auto = (e.target as HTMLInputElement).checked;
    hooks.set('audio.tempo', auto ? undefined : Number($<HTMLInputElement>('tempo').value));
  });
  $<HTMLInputElement>('tempo').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    $('tempo-out').textContent = `×${v.toFixed(2)}`;
    $<HTMLInputElement>('tempo-auto').checked = false;
    hooks.set('audio.tempo', v);
  });

  // Drop a .mid anywhere to add it to songs/ and use it.
  const msg = $('music-msg');
  document.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
      e.preventDefault();
      document.body.classList.add('dropping');
    }
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dropping');
  });
  document.addEventListener('drop', async (e) => {
    document.body.classList.remove('dropping');
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.midi?$/i.test(f.name));
    if (!file) return;
    e.preventDefault();
    const name = file.name.replace(/\.midi?$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'song';
    try {
      const res = await fetch(`/__studio/song?name=${encodeURIComponent(name)}`, { method: 'POST', body: await file.arrayBuffer() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      msg.textContent = `Added songs/${name}.mid and switched to it: the melody track plays on bounces. Pick another track below if it guessed wrong.`;
      const use = () => {
        hooks.set('audio.melody', `midi:${name}`);
        hooks.set('audio.parts', undefined);
        hooks.set('audio.backingParts', undefined);
        document.querySelector<HTMLButtonElement>('.tabs button[data-tab="music"]')?.click();
      };
      window.addEventListener('songs-updated', use, { once: true });
      setTimeout(() => window.removeEventListener('songs-updated', use), 5000);
    } catch (err) {
      msg.textContent = `Could not add ${file.name}: ${(err as Error).message}`;
    }
  });
}

const describe = (p: MidiPart) =>
  `${p.label}${p.label.startsWith(p.instrument) ? '' : ` · ${p.instrument}`} · ${noteName(p.low)}–${noteName(p.high)} · ${p.notes} notes${p.poly > 0.5 ? ' · chords' : ''}`;

/** Update the tab for the current scene and its loaded MIDI song (if any). */
export function refreshMusic(scene: Scene, songNames: string[], song: MidiSong | null, lock: { ok: boolean; reason: string }): void {
  lastSong = song;
  lastScene = scene;
  const select = $<HTMLSelectElement>('melody');
  const group = (label: string, options: HTMLOptionElement[]) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...options);
    return g;
  };
  const groups: HTMLElement[] = [group('Improvise', [new Option('Improvised melody (pentatonic)', 'pentatonic')])];
  for (const cat of CATEGORY_ORDER) {
    const inCat = songNames.filter((n) => songIndex[n]?.category === cat).sort((a, b) => songIndex[a].title.localeCompare(songIndex[b].title));
    if (inCat.length) groups.push(group(cat, inCat.map((n) => new Option(`${songIndex[n].title} · ${songIndex[n].composer}`, `midi:${n}`))));
  }
  const yours = songNames.filter((n) => !songIndex[n]).sort();
  if (yours.length) groups.push(group('Your songs', yours.map((n) => new Option(n, `midi:${n}`))));
  if (LEGACY[scene.audio.melody]) groups.push(group('Simple built-ins', [new Option(LEGACY[scene.audio.melody], scene.audio.melody)]));
  select.replaceChildren(...groups);
  select.value = scene.audio.melody;

  const info = scene.audio.melody.startsWith('midi:') ? songIndex[scene.audio.melody.slice(5)] : undefined;
  $('song-info').textContent = info
    ? `${info.title} by ${info.composer} · ${info.bpm} bpm`
    : scene.audio.melody === 'pentatonic'
      ? 'Each bounce picks the next note of a wandering pentatonic tune.'
      : scene.audio.melody.startsWith('midi:')
        ? `Your MIDI file${song ? ` · ${song.parts.length} track${song.parts.length === 1 ? '' : 's'}` : ''}.`
        : 'A simple melody with no timing: pick a songbook version to use rhythm lock.';

  // Rhythm lock.
  const box = $<HTMLInputElement>('rhythm-lock');
  box.checked = scene.audio.rhythmLock;
  box.disabled = !lock.ok && !scene.audio.rhythmLock;
  $('rhythm-why').textContent = lock.ok
    ? scene.audio.rhythmLock
      ? 'After every bounce the ball’s speed is set so the next bounce lands exactly on the next note. For the cleanest result, use “Find a seed that stays in time”.'
      : 'Available for this scene: the ball will bounce exactly in time with the song.'
    : scene.audio.rhythmLock
      ? `Switched on, but it can’t apply here: ${lock.reason}`
      : lock.reason;
  $('rhythm-why').className = !lock.ok && scene.audio.rhythmLock ? 'muted bad' : 'muted';
  const locked = scene.audio.rhythmLock && lock.ok;
  $('rhythm-find').hidden = !locked;
  $('tempo-row').hidden = !locked;
  $('tempo-auto-row').hidden = !locked;
  $<HTMLInputElement>('tempo-auto').checked = scene.audio.tempo === undefined;
  if (scene.audio.tempo !== undefined) $<HTMLInputElement>('tempo').value = String(scene.audio.tempo);
  $('tempo-out').textContent = scene.audio.tempo === undefined ? 'auto' : `×${scene.audio.tempo.toFixed(2)}`;

  // Tracks.
  $('parts-row').hidden = !song;
  if (!song) return;
  const { bounce, backing } = partRoles(song, { ...scene.audio, backing: true });
  const allIds = song.parts.map((p) => p.id);
  const isAll = bounce.length === allIds.length && allIds.length > 1;
  const melody = song.parts[song.melodyPart];

  const bp = $<HTMLSelectElement>('bounce-part');
  bp.replaceChildren(
    new Option(`Melody, auto-detected (${melody.label})`, 'auto'),
    ...song.parts.map((p) => new Option(describe(p), String(p.id))),
    ...(song.parts.length > 1 ? [new Option('Everything (all tracks merged)', 'all')] : []),
  );
  bp.value = !scene.audio.parts?.length ? 'auto' : isAll ? 'all' : bounce.length === 1 ? String(bounce[0]) : 'auto';
  $<HTMLInputElement>('chords').checked = scene.audio.chords;
  const chordal = bounce.some((id) => song.parts[id]?.poly > 0.5) || isAll;
  ($('chords').nextElementSibling as HTMLElement).textContent =
    chordal && !scene.audio.chords
      ? 'Play chords: this track is mostly chords, so right now each bounce plays only the top note'
      : 'Play chords (every note struck together, not just the top one)';

  // Backing: only meaningful under rhythm lock (otherwise bounces have no timing to follow).
  const bk = $<HTMLInputElement>('backing');
  const others = song.parts.filter((p) => !bounce.includes(p.id));
  bk.checked = scene.audio.backing;
  bk.disabled = !locked || !others.length;
  $('backing-why').textContent = !others.length
    ? 'Every track is already on the bounces.'
    : !locked
      ? 'Needs rhythm lock: without it the bounces have no timing for the rest of the song to follow.'
      : scene.audio.backing
        ? 'The other tracks play in time between bounces. Tick or untick tracks below.'
        : 'Turn on to hear the other tracks too.';
  $('backing-vol-row').hidden = !(locked && scene.audio.backing && others.length);
  $<HTMLInputElement>('backing-volume').value = String(scene.audio.backingVolume);
  $('backing-vol-out').textContent = `${Math.round(scene.audio.backingVolume * 100)}%`;

  const list = $<HTMLOListElement>('parts');
  list.replaceChildren(
    ...song.parts.map((p) => {
      const li = document.createElement('li');
      const play = document.createElement('button');
      play.className = 'icon-small';
      play.textContent = '▶';
      play.title = 'Preview this track (first few seconds)';
      play.onclick = () => preview(p, play);
      const text = document.createElement('span');
      text.textContent = describe(p);
      li.append(play, text);
      if (bounce.includes(p.id)) {
        const tag = document.createElement('em');
        tag.textContent = 'on bounces';
        li.append(tag);
      } else {
        const lab = document.createElement('label');
        lab.className = 'check small';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = scene.audio.backing && backing.includes(p.id);
        cb.disabled = !locked;
        cb.title = locked ? 'Play this track as backing' : 'Backing needs rhythm lock';
        cb.addEventListener('change', () => {
          const next = others.map((q) => q.id).filter((id) => (id === p.id ? cb.checked : backing.includes(id)));
          hooks.set('audio.backingParts', next.length === others.length ? undefined : next);
          if (cb.checked && !scene.audio.backing) hooks.set('audio.backing', true);
        });
        lab.append(cb, document.createTextNode(' backing'));
        li.append(lab);
      }
      return li;
    }),
  );
  $('drums-note').textContent = song.drums ? `Drum track skipped (${song.drums} hits): drums have no notes to play on a bounce.` : '';
}

/** Play the first few seconds of one track at its real tempo. */
function preview(p: MidiPart, btn: HTMLButtonElement): void {
  previewStop?.();
  const a = hooks.audio();
  if (!a || !lastSong || !lastScene) {
    $('music-msg').textContent = 'Turn sound on to preview tracks.';
    return;
  }
  const notes = lastSong.notes.filter((n) => n.part === p.id);
  if (!notes.length) return;
  const t0 = notes[0].time;
  const now = a.ctx.currentTime + 0.05;
  const span = 6;
  const nodes: GainNode[] = [];
  // A private gain so the preview can be stopped.
  const g = a.ctx.createGain();
  g.connect(a.master);
  nodes.push(g);
  for (const n of notes) {
    if (n.time - t0 > span) break;
    playVoice(a.ctx, g, { time: 0, delay: 0, kind: 'note', midi: [n.note + lastScene.audio.transpose], gain: 0.7, pan: 0 }, now + (n.time - t0), lastScene.audio.instrument);
  }
  btn.textContent = '■';
  const timer = window.setTimeout(() => stop(), (span + 1.5) * 1000);
  const stop = () => {
    clearTimeout(timer);
    g.gain.setValueAtTime(0, a.ctx.currentTime);
    btn.textContent = '▶';
    previewStop = null;
  };
  btn.onclick = () => (previewStop ? stop() : preview(p, btn));
  previewStop = stop;
}
