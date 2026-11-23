/** Load every scene source in scenes/ (Node only). */
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

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
