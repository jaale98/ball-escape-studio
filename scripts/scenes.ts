/** Load every scene source in scenes/ (Node only). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { applySong, readMidi } from '../src/audio/midi';
import type { Scene } from '../src/engine/scene';
import { parseQuickFile, type Quick, resolveQuick } from '../src/director/quick';

export function loadSources(dir = 'scenes'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    } catch (err) {
      throw new Error(`${dir}/${f}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** "scenes/foo.json", "foo.json" or "foo" → "foo" */
export function sceneName(arg: string): string {
  return basename(arg).replace(/\.json$/, '');
}

/** Resolve a scene and, for MIDI melodies, fill in its notes and note times (as the studio does). */
export function resolveWithSongs(name: string, sources = loadSources(), quick: Quick | null = null): Scene {
  const scene = resolveQuick(name, sources, quick);
  if (scene.audio.melody.startsWith('midi:') && !scene.audio.notes) {
    const buf = readFileSync(`songs/${scene.audio.melody.slice(5)}.mid`);
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    applySong(scene.audio, readMidi(ab));
  }
  return scene;
}

/** Every quick/<scene>.json (Node only): scene name -> its quick settings. */
export function loadQuick(dir = 'quick'): Record<string, Quick[]> {
  const out: Record<string, Quick[]> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    } catch (err) {
      throw new Error(`${dir}/${f}: ${(err as Error).message}`);
    }
    out[f.replace(/\.json$/, '')] = parseQuickFile(raw, `${dir}/${f}`);
  }
  return out;
}
