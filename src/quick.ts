/**
 * Quick settings (quick/*.json), with hot updates: edits (by you, the studio,
 * Claude or `npm run quick -- --tune`) arrive as a "quick-updated" event
 * instead of a page reload.
 */
import { parseQuickFile, type Quick } from './director/quick';

export const quickFiles = import.meta.glob('../quick/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export interface QuickSet {
  list: Quick[];
  /** Why the file couldn't be read (its quick settings are then hidden). */
  error: string;
}

/** Scene name -> its quick settings. */
export function quickSetsFrom(files: Record<string, unknown>): Record<string, QuickSet> {
  const out: Record<string, QuickSet> = {};
  for (const [path, raw] of Object.entries(files)) {
    const name = path.split('/').pop()!.replace(/\.json$/, '');
    try {
      out[name] = { list: parseQuickFile(raw, `quick/${name}.json`), error: '' };
    } catch (err) {
      out[name] = { list: [], error: (err as Error).message };
    }
  }
  return out;
}

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (mod) window.dispatchEvent(new CustomEvent('quick-updated', { detail: quickSetsFrom(mod.quickFiles as Record<string, unknown>) }));
  });
}
