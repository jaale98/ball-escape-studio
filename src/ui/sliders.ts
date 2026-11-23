/**
 * Auto-generated sliders: every number in a scene (after "extends" is merged)
 * becomes a slider with a sensible range, grouped by what it belongs to.
 */

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Tunable {
  path: string;
  group: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

const SKIP = new Set(['version', 'seed']);
const INTS = new Set(['count', 'sides', 'rows', 'cols', 'maxBalls', 'transpose', 'open']);

const RANGES: Record<string, [number, number]> = {
  radius: [4, 700],
  inner: [20, 520],
  outer: [40, 540],
  thickness: [1, 60],
  spin: [-6, 6],
  spinFalloff: [0.3, 1.5],
  speed: [0, 3000],
  gravity: [-3000, 3000],
  width: [0, 180],
  gapWidth: [2, 120],
  gapShrink: [0, 20],
  gapOffset: [0, 360],
  angle: [0, 360],
  direction: [0, 360],
  degrees: [-180, 180],
  count: [0, 60],
  sides: [3, 12],
  rows: [1, 20],
  cols: [1, 20],
  spacing: [20, 220],
  rowSpacing: [20, 220],
  factor: [0.9, 1.3],
  trail: [0, 0.98],
  volume: [0, 1],
  restitution: [0, 1.2],
  hp: [1, 50],
  tail: [0, 10],
  every: [0.1, 20],
  start: [0, 60],
  until: [0, 60],
  spread: [0, 200],
  perSpeed: [0, 20],
  maxBalls: [1, 1000],
  transpose: [-24, 24],
  x: [0, 1080],
  x1: [0, 1080],
  x2: [0, 1080],
  y: [0, 1920],
  y1: [0, 1920],
  y2: [0, 1920],
  top: [0, 1920],
  bottom: [0, 1920],
  wallTop: [0, 1920],
};

function rangeFor(path: string[], value: number): [number, number] {
  const key = path[path.length - 1];
  const parent = path[path.length - 2];
  if (/^\d+$/.test(key) && parent === 'gravity') return RANGES.gravity;
  if (key === 'at') return path[0] === 'timeline' ? [0, 60] : [0, 360];
  if (key === 'max' && path[0] === 'duration') return [5, 120];
  if (key === 'min') return [0, 60];
  const r = RANGES[key];
  if (r) return [Math.min(r[0], value), Math.max(r[1], value)];
  const span = Math.max(1, Math.abs(value) * 3);
  return [Math.min(0, value * 2), span];
}

function describe(path: string[], merged: Raw): { group: string; label: string } {
  const [top, i, ...rest] = path;
  if (top === 'entities') {
    const e = merged.entities?.[Number(i)] ?? {};
    return { group: `${e.type ?? 'entity'} ${Number(i) + 1}`, label: rest.join(' ') };
  }
  if (top === 'rules') {
    const r = merged.rules?.[Number(i)] ?? {};
    const act = rest[0] === 'do' ? r.do?.[Number(rest[1])]?.do : undefined;
    return { group: `rule: on ${r.on ?? '?'}${act ? ` → ${act}` : ''}`, label: rest.slice(rest[0] === 'do' ? 2 : 0).join(' ') };
  }
  if (top === 'timeline') {
    const t = merged.timeline?.[Number(i)] ?? {};
    return { group: `timeline ${Number(i) + 1}${t.every ? ` (every ${t.every}s)` : ''}`, label: rest.join(' ').replace(/^do \d+ /, '') };
  }
  if (top === 'modifiers') {
    const m = merged.modifiers?.[Number(i)] ?? {};
    return { group: `modifier: ${m.use ?? m}`, label: rest.join(' ') };
  }
  return { group: top, label: [i, ...rest].filter((s) => s !== undefined).join(' ') };
}

/** List every tunable number in a merged scene source. */
export function tunables(merged: Raw): Tunable[] {
  const out: Tunable[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === 'number') {
      if (SKIP.has(path[0])) return;
      const [min, max] = rangeFor(path, v);
      const key = path[path.length - 1];
      const isInt = INTS.has(key) || INTS.has(path[path.length - 2] ?? '');
      const step = isInt ? 1 : niceStep((max - min) / 400);
      out.push({ path: path.join('.'), value: v, min, max, step, ...describe(path, merged) });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(merged, []);
  return out;
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

/** Set a dotted path ("entities.0.spin") on an object. */
export function setPath(obj: Raw, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Raw = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  cur[parts[parts.length - 1]] = value;
}

/** Format a slider value for display. */
export function fmt(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toFixed(Math.min(4, decimals));
}
