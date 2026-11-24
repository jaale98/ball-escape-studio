/**
 * Music panel: pick the melody (built-in or any MIDI file in songs/), choose
 * which MIDI parts feed it, toggle chords, and drop .mid files onto the
 * studio to add them. Choices are slider-style tweaks: they preview
 * instantly and "Save to file" writes them into the scene.
 */
import type { MidiSong } from '../audio/midi';
import type { Scene } from '../engine/scene';

export interface MusicHooks {
  /** Set a tweak (dotted path in the scene source) and re-run the preview. */
  set(path: string, value: unknown): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BUILT_IN = [
  ['pentatonic', 'Improvised (pentatonic)'],
  ['ode-to-joy', 'Ode to Joy'],
  ['fur-elise', 'Für Elise'],
];

let hooks: MusicHooks;
let lastSong: MidiSong | null = null;

export function initMusic(h: MusicHooks): void {
  hooks = h;
  $<HTMLSelectElement>('melody').addEventListener('change', (e) => {
    hooks.set('audio.melody', (e.target as HTMLSelectElement).value);
    hooks.set('audio.parts', undefined);
  });
  $<HTMLInputElement>('chords').addEventListener('change', (e) => hooks.set('audio.chords', (e.target as HTMLInputElement).checked));
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
      msg.textContent = `Added songs/${name}.mid. Playing it now; Save to file keeps it in this scene.`;
      // The song list arrives as a hot update; choose the song once it does.
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

/** Update the panel for the current scene and its loaded MIDI song (if any). */
export function refreshMusic(scene: Scene, songNames: string[], song: MidiSong | null): void {
  lastSong = song;
  const select = $<HTMLSelectElement>('melody');
  select.replaceChildren(
    ...BUILT_IN.map(([v, label]) => new Option(label, v)),
    ...songNames.sort().map((n) => new Option(`${n} (MIDI)`, `midi:${n}`)),
  );
  select.value = scene.audio.melody;
  $<HTMLInputElement>('chords').checked = scene.audio.chords;

  const box = $('parts');
  box.replaceChildren();
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
    text.textContent = `${p.id}: ${p.name} · ch ${p.channel + 1} · ${p.instrument} · ${p.notes} notes${p.id === song.melodyPart ? ' · melody' : ''}`;
    label.append(cb, text);
    box.append(label);
  }
}
