import { z } from 'zod';
import { applyModifiers, MODIFIERS } from './modifiers';
import { EntitySchema, HEIGHT, parseScene, type Scene, SceneSchema, WIDTH } from './scene';

/**
 * Scene source files support three things on top of the plain scene format:
 *
 *  - "extends": "other-scene"   inherit everything from another scene file;
 *                               objects merge key by key, arrays are replaced.
 *  - "modifiers": [...]         stackable named tweaks (see modifiers.ts).
 *  - prefab entities            "nested", "pegboard", "bins" expand into
 *                               rings / pegs / walls / zones.
 *
 * resolveScene() turns a source file into a plain, validated Scene.
 */

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- Prefabs ----------------------------------------------------------------

export const NestedSchema = z
  .object({
    type: z.literal('nested'),
    count: z.number().int().min(1).max(60).default(5),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(HEIGHT / 2),
    inner: z.number().positive().default(150).describe('Radius of the innermost ring.'),
    outer: z.number().positive().default(470).describe('Radius of the outermost ring.'),
    thickness: z.number().positive().default(10),
    spin: z.number().default(1.2).describe('Spin of the innermost ring (rad/s).'),
    spinFalloff: z.number().default(0.85).describe('Each ring outward spins this fraction of the previous.'),
    alternate: z.boolean().default(true).describe('Alternate spin direction ring to ring.'),
    gapWidth: z.number().default(36).describe('Gap of the innermost ring in degrees.'),
    gapShrink: z.number().default(3).describe('Each ring outward has a gap this many degrees narrower.'),
    gapOffset: z.number().default(120).describe('Degrees between consecutive rings’ gaps.'),
    colors: z.array(z.string()).optional().describe('Ring colors, inner to outer, cycled.'),
  })
  .strict()
  .describe('Prefab: concentric rings with staggered gaps.');

export const PegboardSchema = z
  .object({
    type: z.literal('pegboard'),
    x: z.number().default(WIDTH / 2).describe('Center x.'),
    y: z.number().default(820).describe('Top row y.'),
    rows: z.number().int().min(1).default(10),
    cols: z.number().int().min(1).default(9),
    spacing: z.number().positive().default(100),
    rowSpacing: z.number().positive().optional().describe('Defaults to spacing × 0.87.'),
    radius: z.number().positive().default(9),
    stagger: z.boolean().default(true).describe('Offset every other row by half a spacing.'),
    color: z.string().optional(),
  })
  .strict()
  .describe('Prefab: a grid of pegs (Plinko / Galton board).');

export const BinsSchema = z
  .object({
    type: z.literal('bins'),
    count: z.number().int().min(1).default(9),
    x1: z.number().default(60),
    x2: z.number().default(WIDTH - 60),
    top: z.number().default(1420),
    bottom: z.number().default(1640),
    thickness: z.number().positive().default(8),
    walls: z.boolean().default(true).describe('Add side walls that run up to the board.'),
    wallTop: z.number().default(640),
    color: z.string().optional(),
    labels: z.array(z.string()).optional(),
  })
  .strict()
  .describe('Prefab: a row of bins with a floor, dividers, and a counting zone in each.');

const PrefabSchema = z.discriminatedUnion('type', [NestedSchema, PegboardSchema, BinsSchema]);
const PREFABS = new Set(['nested', 'pegboard', 'bins']);

function expandPrefab(raw: unknown, path: string): Raw[] {
  const parsed = PrefabSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid scene:\n${parsed.error.issues.map((i) => `${path}.${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const p = parsed.data;
  const out: Raw[] = [];
  if (p.type === 'nested') {
    for (let i = 0; i < p.count; i++) {
      const t = p.count === 1 ? 0 : i / (p.count - 1);
      out.push({
        type: 'ring',
        x: p.x,
        y: p.y,
        radius: p.inner + (p.outer - p.inner) * t,
        thickness: p.thickness,
        spin: p.spin * p.spinFalloff ** i * (p.alternate && i % 2 ? -1 : 1),
        gaps: [{ at: (i * p.gapOffset) % 360, width: Math.max(2, p.gapWidth - i * p.gapShrink) }],
        ...(p.colors ? { color: p.colors[i % p.colors.length] } : {}),
      });
    }
  } else if (p.type === 'pegboard') {
    const rowSpacing = p.rowSpacing ?? p.spacing * 0.87;
    for (let r = 0; r < p.rows; r++) {
      const shift = p.stagger && r % 2 ? p.spacing / 2 : 0;
      const n = p.stagger && r % 2 ? p.cols - 1 : p.cols;
      const x0 = p.x - ((p.cols - 1) * p.spacing) / 2 + shift;
      for (let c = 0; c < n; c++) {
        out.push({ type: 'peg', x: x0 + c * p.spacing, y: p.y + r * rowSpacing, radius: p.radius, ...(p.color ? { color: p.color } : {}) });
      }
    }
  } else {
    const w = (p.x2 - p.x1) / p.count;
    const color = p.color ? { color: p.color } : {};
    out.push({ type: 'wall', x1: p.x1, y1: p.bottom, x2: p.x2, y2: p.bottom, thickness: p.thickness, ...color });
    for (let i = 0; i <= p.count; i++) {
      const x = p.x1 + i * w;
      const isSide = i === 0 || i === p.count;
      out.push({ type: 'wall', x1: x, y1: isSide && p.walls ? p.wallTop : p.top, x2: x, y2: p.bottom, thickness: p.thickness, ...color });
    }
    for (let i = 0; i < p.count; i++) {
      out.push({ type: 'zone', x: p.x1 + i * w, y: p.top, width: w, height: p.bottom - p.top, ...(p.labels?.[i] ? { label: p.labels[i] } : {}) });
    }
  }
  return out;
}

// ---- Inheritance ------------------------------------------------------------

function isPlainObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge key by key, everything else (arrays included) is replaced. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Raw = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : structuredClone(v);
    return out;
  }
  return structuredClone(over);
}

/** Follow "extends" chains and merge. Keeps "modifiers" from every level (parent first). */
export function mergeSource(name: string, sources: Record<string, unknown>, seen: string[] = []): Raw {
  if (seen.includes(name)) throw new Error(`extends: cycle ${[...seen, name].join(' → ')}`);
  const raw = sources[name];
  if (!isPlainObject(raw)) throw new Error(seen.length ? `extends: no scene named "${name}"` : `No scene named "${name}"`);
  const { extends: parent, modifiers, $schema, ...rest } = raw;
  void $schema;
  let base: Raw = {};
  let baseMods: unknown[] = [];
  if (parent !== undefined) {
    if (typeof parent !== 'string') throw new Error('extends: must be a scene name (file name without .json)');
    base = mergeSource(parent, sources, [...seen, name]);
    baseMods = (base.modifiers as unknown[]) ?? [];
    delete base.modifiers;
  }
  const merged = deepMerge(base, rest) as Raw;
  const mods = [...baseMods, ...(Array.isArray(modifiers) ? modifiers : modifiers !== undefined ? [modifiers] : [])];
  if (mods.length) merged.modifiers = mods;
  return merged;
}

/**
 * Turn a scene source into a validated Scene.
 * `sources` maps scene name (file name without .json) to its parsed JSON.
 */
export function resolveScene(name: string, sources: Record<string, unknown>, overrides?: (merged: Raw) => void): Scene {
  const merged = mergeSource(name, sources);
  overrides?.(merged);
  const { modifiers, ...scene } = merged;
  applyModifiers(scene, modifiers);
  if (Array.isArray(scene.entities)) {
    scene.entities = scene.entities.flatMap((e: Raw, i: number) => (isPlainObject(e) && PREFABS.has(e.type) ? expandPrefab(e, `entities.${i}`) : [e]));
  }
  return parseScene(scene);
}

// ---- Authoring schema --------------------------------------------------------

/** The source file format (for JSON Schema generation / editor autocomplete). */
export const SourceSchema = SceneSchema.omit({ entities: true })
  .partial()
  .extend({
    $schema: z.string().optional(),
    extends: z.string().optional().describe('Inherit from another scene (file name without .json).'),
    modifiers: z
      .array(
        z.union([
          z.enum(Object.keys(MODIFIERS) as [string, ...string[]]),
          z.object({ use: z.enum(Object.keys(MODIFIERS) as [string, ...string[]]) }).catchall(z.union([z.number(), z.boolean()])),
        ]),
      )
      .optional()
      .describe(Object.entries(MODIFIERS).map(([k, m]) => `${k}: ${m.description}`).join('\n')),
    entities: z.array(z.union([EntitySchema, PrefabSchema])).optional(),
  })
  .strict();
