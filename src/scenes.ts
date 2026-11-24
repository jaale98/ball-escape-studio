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

/** Gallery families, in display order. */
export const FAMILIES: [string, string][] = [
  ['escape', 'Escape'],
  ['destruction', 'Destruction'],
  ['battle', 'Battles'],
  ['teams', 'Teams'],
  ['forces', 'Forces'],
  ['surreal', 'Surreal'],
  ['chaos', 'Chaos & maths'],
  ['satisfying', 'Satisfying'],
  ['music', 'Music'],
  ['other', 'Other'],
];

/** Families for the V1 presets, which predate the "category" field. */
const V1_FAMILY: Record<string, string> = {
  'ring-escape': 'escape',
  'nested-rings': 'escape',
  'hexagon-escape': 'escape',
  'bouncing-square': 'escape',
  'shrinking-gap': 'escape',
  'grow-on-bounce': 'escape',
  'gravity-flip': 'escape',
  multiply: 'surreal',
  'ball-race': 'battle',
  'battle-royale': 'battle',
  'country-battle': 'battle',
  'weapon-battle': 'battle',
  plinko: 'satisfying',
  'paint-the-ring': 'satisfying',
  'crowd-pour': 'satisfying',
  'chain-reaction': 'chaos',
  'eternal-loop': 'chaos',
  'music-bounce': 'music',
  'rhythm-bounce': 'music',
};

/** A scene's family: its own "category", its parent's (extends), or the V1 table. */
export function categoryOf(entry: SceneEntry, all: SceneEntry[], seen: string[] = []): string {
  const raw = (entry.raw ?? {}) as { category?: string; extends?: string };
  if (raw.category) return raw.category;
  if (raw.extends && !seen.includes(raw.extends)) {
    const parent = all.find((e) => e.name === raw.extends);
    if (parent) return categoryOf(parent, all, [...seen, entry.name]);
  }
  return V1_FAMILY[entry.name] ?? 'other';
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
