/** Load every scene source in scenes/ (Node only). */
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { applySong, readMidi } from '../src/audio/midi';
import type { Scene } from '../src/engine/scene';
import { resolveScene } from '../src/engine/source';

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
export function resolveWithSongs(name: string, sources = loadSources()): Scene {
  const scene = resolveScene(name, sources);
  if (scene.audio.melody.startsWith('midi:') && !scene.audio.notes) {
    const buf = readFileSync(`songs/${scene.audio.melody.slice(5)}.mid`);
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    applySong(scene.audio, readMidi(ab));
  }
  return scene;
}
