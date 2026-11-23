/**
 * Scene sources (scenes/*.json), with hot updates.
 *
 * This module accepts its own hot updates, so when a scene file is edited or
 * added (by you, a slider save, or Claude) the page is NOT reloaded: the new
 * sources are announced with a "scenes-updated" event instead. That keeps a
 * streaming AI conversation alive while its edits land.
 */
export const sceneFiles = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export interface SceneEntry {
  name: string;
  path: string;
  raw: unknown;
}

export function entriesFrom(files: Record<string, unknown>): SceneEntry[] {
  return Object.entries(files)
    .map(([path, raw]) => ({ name: path.split('/').pop()!.replace(/\.json$/, ''), path: path.replace('../', ''), raw }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (mod) window.dispatchEvent(new CustomEvent('scenes-updated', { detail: entriesFrom(mod.sceneFiles as Record<string, unknown>) }));
  });
}
