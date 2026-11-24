/**
 * Music tab: pick a song (the songbook, your own MIDI files, or improvised),
 * lock the bounces to its rhythm, choose which parts play, toggle chords, and
 * drop .mid files onto the studio to add them. Choices are unsaved changes:
 * they preview instantly and Save writes them into the scene.
 */
import type { MidiSong } from '../audio/midi';
import type { Scene } from '../engine/scene';
import { songIndex } from '../songs';

export interface MusicHooks {
  /** Set a change (dotted path in the scene source) and re-run the preview. */
  set(path: string, value: unknown): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CATEGORY_ORDER = ['Classical', 'Ragtime & marches', 'Folk & traditional', 'Nursery & kids'];
const LEGACY: Record<string, string> = { 'ode-to-joy': 'Ode to Joy (simple, no timing)', 'fur-elise': 'Für Elise (simple, no timing)' };

let hooks: MusicHooks;
let lastSong: MidiSong | null = null;

export function initMusic(h: MusicHooks): void {
  hooks = h;
  $<HTMLSelectElement>('melody').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    hooks.set('audio.melody', v);
    // Songbook songs: the melody is part 0 (the bass is part 1). Your own files: all parts.
    hooks.set('audio.parts', v.startsWith('midi:') && songIndex[v.slice(5)] ? [0] : undefined);
  });
  $<HTMLInputElement>('chords').addEventListener('change', (e) => hooks.set('audio.chords', (e.target as HTMLInputElement).checked));
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
  $('parts-melody').addEventListener('click', () => lastSong && hooks.set('audio.parts', [lastSong.melodyPart]));
  $('parts-all').addEventListener('click', () => hooks.set('audio.parts', undefined));

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
      msg.textContent = `Added songs/${name}.mid and switched to it. Save keeps it in this scene.`;
      const use = () => {
        hooks.set('audio.melody', `midi:${name}`);
        hooks.set('audio.parts', undefined);
      };
      window.addEventListener('songs-updated', use, { once: true });
      setTimeout(() => window.removeEventListener('songs-updated', use), 5000);
    } catch (err) {
      msg.textContent = `Could not add ${file.name}: ${(err as Error).message}`;
    }
  });
}

/** Update the tab for the current scene and its loaded MIDI song (if any). */
export function refreshMusic(scene: Scene, songNames: string[], song: MidiSong | null, lock: { ok: boolean; reason: string }): void {
  lastSong = song;
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
        ? 'Your MIDI file.'
        : 'A simple melody with no timing: pick a songbook version to use rhythm lock.';
  $<HTMLInputElement>('chords').checked = scene.audio.chords;

  // Rhythm lock.
  const box = $<HTMLInputElement>('rhythm-lock');
  box.checked = scene.audio.rhythmLock;
  box.disabled = !lock.ok && !scene.audio.rhythmLock;
  $('rhythm-why').textContent = lock.ok
    ? scene.audio.rhythmLock
      ? 'After every bounce the ball’s speed is set so the next bounce lands exactly on the next note. For the cleanest result, run the Director’s “In time with the song” story.'
      : 'Available for this scene: the ball will bounce exactly in time with the song.'
    : scene.audio.rhythmLock
      ? `Switched on, but it can’t apply here: ${lock.reason}`
      : lock.reason;
  $('rhythm-why').className = !lock.ok && scene.audio.rhythmLock ? 'muted bad' : 'muted';
  const showTempo = scene.audio.rhythmLock && lock.ok;
  $('rhythm-find').hidden = !showTempo;
  $('tempo-row').hidden = !showTempo;
  $('tempo-auto-row').hidden = !showTempo;
  $<HTMLInputElement>('tempo-auto').checked = scene.audio.tempo === undefined;
  if (scene.audio.tempo !== undefined) $<HTMLInputElement>('tempo').value = String(scene.audio.tempo);
  $('tempo-out').textContent = scene.audio.tempo === undefined ? 'auto' : `×${scene.audio.tempo.toFixed(2)}`;

  // Parts.
  const parts = $('parts');
  parts.replaceChildren();
  $('parts-row').hidden = !song;
  if (!song) return;
  const chosen = scene.audio.parts?.length ? scene.audio.parts : song.parts.map((p) => p.id);
  for (const p of song.parts) {
    const label = document.createElement('label');
    label.className = 'check part';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = chosen.includes(p.id);
    cb.addEventListener('change', () => {
      const next = song.parts.map((q) => q.id).filter((id) => (id === p.id ? cb.checked : chosen.includes(id)));
      hooks.set('audio.parts', next.length === song.parts.length ? undefined : next.length ? next : [p.id]);
    });
    const text = document.createElement('span');
    text.textContent = `${p.channel === 1 && songIndex[scene.audio.melody.slice(5)] ? 'Bass' : p.id === song.melodyPart ? 'Melody' : `Part ${p.id + 1}`} · ${p.instrument} · ${p.notes} notes`;
    label.append(cb, text);
    parts.append(label);
  }
}
