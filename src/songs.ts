/**
 * MIDI songs in songs/*.mid, with hot updates: dropping a new song into the
 * studio adds it without reloading the page ("songs-updated" event).
 */
import { type MidiSong, readMidi } from './audio/midi';

export const songFiles = import.meta.glob('../songs/*.mid', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Titles and categories for the songbook (songs/songs.json, from `npm run songs`). */
export interface SongInfo {
  title: string;
  composer: string;
  category: string;
  bpm: number;
}
export const songIndex: Record<string, SongInfo> =
  (Object.values(import.meta.glob('../songs/songs.json', { eager: true, import: 'default' }))[0] as Record<string, SongInfo> | undefined) ?? {};

/** Song name (file name without .mid) -> URL. */
export function songUrls(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([p, url]) => [p.split('/').pop()!.replace(/\.mid$/, ''), url]));
}

const cache = new Map<string, Promise<MidiSong>>();
export function loadSong(url: string): Promise<MidiSong> {
  if (!cache.has(url)) cache.set(url, fetch(url).then(async (r) => readMidi(await r.arrayBuffer())));
  return cache.get(url)!;
}

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (mod) window.dispatchEvent(new CustomEvent('songs-updated', { detail: songUrls(mod.songFiles as Record<string, string>) }));
  });
}
