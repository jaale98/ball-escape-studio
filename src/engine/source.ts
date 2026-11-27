import { z } from 'zod';
import { ipow, pow } from './dmath';
import { Rng } from './rng';
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
    count: z.number().int().min(1).max(1000).default(5),
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
    spacing: z.number().positive().optional().describe('Fixed px between rings (ignores outer): for dozens or hundreds of rings, with camera.mode zoomOut.'),
    rainbow: z.boolean().default(false).describe('Color the rings along a rainbow, inner to outer.'),
    segments: z.number().int().min(2).max(360).optional().describe('Breakable: cut every ring into this many segments.'),
    segmentHp: z.number().int().min(1).optional(),
    segmentHpGrow: z.number().min(0).default(0).describe('Extra segment hp per ring outward.'),
    hp: z.number().int().positive().optional().describe('Breakable: each ring shatters after this many bounces.'),
    hpGrow: z.number().min(0).default(0).describe('Extra ring hp per ring outward.'),
    minGap: z.number().min(0).default(2).describe('Narrowest gap in degrees.'),
    gapCount: z.number().int().min(1).max(12).default(1).describe('Gaps per ring, evenly spaced.'),
  })
  .strict()
  .describe('Prefab: concentric rings with staggered gaps.');

export const StrataSchema = z
  .object({
    type: z.literal('strata'),
    count: z.number().int().min(2).max(20000).default(1000).describe('How many rings.'),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(HEIGHT / 2),
    inner: z.number().positive().default(160).describe('Radius of the innermost ring.'),
    spacing: z.number().positive().default(22).describe('px between rings. Leave room for the ball: spacing − thickness > its diameter.'),
    thickness: z.number().positive().default(3),
    gapArc: z.number().positive().default(40).describe('Width of every gap in px along the ring (the same on every ring, so a lined-up stack of gaps is a straight shaft).'),
    gapEvery: z.number().positive().default(700).describe('px of ring between neighbouring gaps (big rings get more gaps).'),
    layerMin: z.number().int().min(1).default(4).describe('Rings per stratum near the center.'),
    layerMax: z.number().int().min(1).default(120).describe('Rings per stratum at the outside.'),
    layerCurve: z.number().positive().default(1.6).describe('How late the strata thicken (1 = steadily, 2+ = the deep drops come at the end).'),
    drift: z.number().min(0).default(5).describe('px of random misalignment between the gaps of neighbouring rings in a stratum (0 = a perfectly straight shaft).'),
    speed: z.number().default(140).describe('px/s each stratum turns at its own radius (each stratum is one rigid piece, so its shafts stay lined up).'),
    fall: z.number().min(0).default(0).describe('Lean the shafts for a ball falling outward with this gravity (px/s², a radial force’s strength): each hole is set back by how far its ring turns while the ball falls to it, so a ball dropping from rest stays in the shaft. 0 = straight shafts.'),
    fallDrag: z.number().min(0).default(0).describe('With fall: the world damping, so the lean matches the ball’s real fall.'),
    speedJitter: z.number().min(0).max(1).default(0.4).describe('Random ± share of speed per stratum.'),
    alternate: z.boolean().default(true).describe('Neighbouring strata turn opposite ways.'),
    colors: z.array(z.string()).optional().describe('Colors per stratum, cycled. Default: the ring color.'),
    fadeTo: z.string().optional().describe('A #rrggbb color the rings shade toward with depth (with #rrggbb colors).'),
    oneWay: z.boolean().default(true).describe('Rings close behind the ball: no falling back up a shaft.'),
    seed: z.number().int().default(1).describe('Layout seed (where the strata break and their shafts sit). Separate from the scene seed.'),
  })
  .strict()
  .describe('Prefab: hundreds or thousands of rings in strata. Inside a stratum the gaps line up into shafts, so a ball that finds one drops through the whole stratum at once; the strata get thicker toward the outside.');

export const BrickwallSchema = z
  .object({
    type: z.literal('brickwall'),
    x1: z.number().default(120),
    x2: z.number().default(WIDTH - 120),
    top: z.number().default(480),
    rows: z.number().int().min(1).max(40).default(6),
    cols: z.number().int().min(1).max(40).default(8),
    height: z.number().positive().default(46),
    gap: z.number().min(0).default(8),
    hp: z.number().int().positive().default(3),
    hpGrow: z.number().int().min(0).default(1).describe('Extra hp per row toward the top.'),
    colors: z.array(z.string()).optional().describe('Row colors, cycled. Default: the palette.'),
  })
  .strict()
  .describe('Prefab: a grid of numbered, breakable bricks.');

export const FunnelSchema = z
  .object({
    type: z.literal('funnel'),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(900).describe('Top of the funnel.'),
    width: z.number().positive().default(800).describe('Opening at the top.'),
    gap: z.number().positive().default(90).describe('Opening at the bottom.'),
    height: z.number().positive().default(300),
    thickness: z.number().positive().default(10),
    color: z.string().optional(),
  })
  .strict()
  .describe('Prefab: two angled walls that funnel balls to a gap.');

export const CourseSchema = z
  .object({
    type: z.literal('course'),
    top: z.number().default(520),
    bottom: z.number().default(1560),
    levels: z.number().int().min(1).max(12).default(5).describe('Zig-zag ramps from top to bottom.'),
    x1: z.number().default(70),
    x2: z.number().default(WIDTH - 70),
    opening: z.number().positive().default(120).describe('Gap at the low end of each ramp.'),
    spinners: z.boolean().default(true).describe('A spinning paddle between ramps.'),
    bumpers: z.boolean().default(true).describe('Pinball bumpers on the ramps.'),
    thickness: z.number().positive().default(12),
    color: z.string().optional(),
  })
  .strict()
  .describe('Prefab: a marble-race run of zig-zag ramps, spinners and bumpers between two side walls.');

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

const PrefabSchema = z.discriminatedUnion('type', [NestedSchema, StrataSchema, PegboardSchema, BinsSchema, BrickwallSchema, FunnelSchema, CourseSchema]);
const PREFABS = new Set(['nested', 'strata', 'pegboard', 'bins', 'brickwall', 'funnel', 'course']);

const hexRgb = (c: string): [number, number, number] | null => (/^#[0-9a-f]{6}$/i.test(c) ? [0, 2, 4].map((k) => parseInt(c.slice(1 + k, 3 + k), 16)) as [number, number, number] : null);
const mixHex = (a: [number, number, number], b: [number, number, number], t: number) => '#' + a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, '0')).join('');

/** The rings of a strata prefab (see StrataSchema). Deterministic from its own seed. */
function expandStrata(p: z.output<typeof StrataSchema>): Raw[] {
  const rng = new Rng(p.seed, 'strata');
  const out: Raw[] = [];
  const fade = p.fadeTo ? hexRgb(p.fadeTo) : null;
  let i = 0;
  let layer = 0;
  while (i < p.count) {
    const t = i / p.count;
    const size = Math.max(1, Math.round((p.layerMin + (p.layerMax - p.layerMin) * pow(t, p.layerCurve)) * rng.range(0.55, 1.45)));
    const n = Math.min(size, p.count - i);
    const midR = p.inner + (i + n / 2) * p.spacing;
    // One rigid stratum: the same number of gaps on each ring, at the same angles, turning together.
    const gaps = Math.max(1, Math.round((2 * Math.PI * midR) / p.gapEvery));
    const period = 360 / gaps;
    const phase = rng.range(0, period);
    const dir = p.alternate && layer % 2 ? -1 : 1;
    const spin = (dir * p.speed * (1 + rng.range(-p.speedJitter, p.speedJitter))) / midR;
    const base = p.colors?.length ? p.colors[layer % p.colors.length] : undefined;
    // When does a ball dropping from rest at the top of this stratum reach ring k? (Euler, physics rate.)
    const arrive: number[] = [0];
    if (p.fall > 0) {
      let v = 0;
      let h = 0;
      let t = 0;
      const dt = 1 / 240;
      for (let k = 1; k < n; k++) {
        while (h < k * p.spacing && t < 60) {
          v += (p.fall - p.fallDrag * v) * dt;
          h += v * dt;
          t += dt;
        }
        arrive.push(t);
      }
    }
    for (let k = 0; k < n; k++, i++) {
      const radius = p.inner + i * p.spacing;
      const width = Math.min(170, (p.gapArc / radius) * (180 / Math.PI));
      const jitter = p.drift > 0 && k > 0 ? (rng.range(-p.drift, p.drift) / radius) * (180 / Math.PI) : 0;
      // Set the hole back by how far this ring turns before the falling ball gets there.
      const lean = p.fall > 0 ? -spin * arrive[k] * (180 / Math.PI) : 0;
      const rgb = base && fade ? hexRgb(base) : null;
      const color = rgb && fade ? mixHex(rgb, fade, Math.min(1, pow(i / p.count, 0.8))) : base;
      out.push({
        type: 'ring',
        x: p.x,
        y: p.y,
        radius,
        thickness: p.thickness,
        spin,
        gaps: [{ at: ((((phase + jitter + lean) % period) + period) % period), width }],
        ...(gaps > 1 ? { repeat: gaps } : {}),
        ...(color ? { color } : {}),
        ...(p.oneWay ? { oneWay: true } : {}),
      });
    }
    layer++;
  }
  return out;
}

function expandPrefab(raw: unknown, path: string): Raw[] {
  const parsed = PrefabSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid scene:\n${parsed.error.issues.map((i) => `${path}.${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const p = parsed.data;
  if (p.type === 'strata') return expandStrata(p);
  const out: Raw[] = [];
  if (p.type === 'nested') {
    for (let i = 0; i < p.count; i++) {
      const t = p.count === 1 ? 0 : i / (p.count - 1);
      const color = p.colors ? p.colors[i % p.colors.length] : p.rainbow ? `hsl(${Math.round((i * 360) / Math.min(p.count, 36)) % 360}, 90%, 62%)` : undefined;
      out.push({
        type: 'ring',
        x: p.x,
        y: p.y,
        radius: p.spacing !== undefined ? p.inner + i * p.spacing : p.inner + (p.outer - p.inner) * t,
        thickness: p.thickness,
        spin: p.spin * ipow(p.spinFalloff, i) * (p.alternate && i % 2 ? -1 : 1),
        gaps: Array.from({ length: p.gapCount }, (_, k) => ({ at: ((i * p.gapOffset) % 360) + (k * 360) / p.gapCount, width: Math.max(p.minGap, p.gapWidth - i * p.gapShrink) })),
        ...(color ? { color } : {}),
        ...(p.segments ? { segments: p.segments, segmentHp: Math.round((p.segmentHp ?? 1) + i * p.segmentHpGrow) } : {}),
        ...(p.hp ? { hp: Math.round(p.hp + i * p.hpGrow) } : {}),
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
  } else if (p.type === 'brickwall') {
    const w = (p.x2 - p.x1 - p.gap * (p.cols - 1)) / p.cols;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        out.push({
          type: 'brick',
          x: p.x1 + c * (w + p.gap) + w / 2,
          y: p.top + r * (p.height + p.gap) + p.height / 2,
          width: w,
          height: p.height,
          hp: p.hp + (p.rows - 1 - r) * p.hpGrow,
          ...(p.colors ? { color: p.colors[r % p.colors.length] } : {}),
        });
      }
    }
  } else if (p.type === 'funnel') {
    const color = p.color ? { color: p.color } : {};
    out.push({ type: 'wall', x1: p.x - p.width / 2, y1: p.y, x2: p.x - p.gap / 2, y2: p.y + p.height, thickness: p.thickness, ...color });
    out.push({ type: 'wall', x1: p.x + p.width / 2, y1: p.y, x2: p.x + p.gap / 2, y2: p.y + p.height, thickness: p.thickness, ...color });
  } else if (p.type === 'course') {
    const color = p.color ? { color: p.color } : {};
    out.push({ type: 'wall', x1: p.x1, y1: p.top - 120, x2: p.x1, y2: p.bottom, thickness: p.thickness, ...color });
    out.push({ type: 'wall', x1: p.x2, y1: p.top - 120, x2: p.x2, y2: p.bottom, thickness: p.thickness, ...color });
    const step = (p.bottom - p.top) / p.levels;
    for (let i = 0; i < p.levels; i++) {
      const y = p.top + i * step + step * 0.2;
      const fromLeft = i % 2 === 0;
      // A ramp from one side wall sloping down toward the other, leaving an opening.
      const xa = fromLeft ? p.x1 : p.x2;
      const xb = fromLeft ? p.x2 - p.opening : p.x1 + p.opening;
      out.push({ type: 'wall', x1: xa, y1: y, x2: xb, y2: y + step * 0.5, thickness: p.thickness, ...color });
      if (p.bumpers) {
        const bx = (xa + xb) / 2 + (fromLeft ? 60 : -60);
        out.push({ type: 'peg', x: bx, y: y + step * 0.25 - 80, radius: 20, boost: 1.25, color: '#ffd23f' });
      }
      if (p.spinners && i < p.levels - 1) {
        out.push({ type: 'spinner', x: (p.x1 + p.x2) / 2 + (fromLeft ? 120 : -120), y: y + step * 0.78, length: 150, width: 14, spin: fromLeft ? 3 : -3, color: '#4dd4ff' });
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

/** Set a value at a dotted path ("entities.1.speed"), creating objects on the way. */
export function setPath(obj: Raw, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Raw = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] === undefined || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
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

// ---- Themes -------------------------------------------------------------------

/** What each theme fills in (only keys the scene hasn't set). */
export const THEMES: Record<string, { style: Raw; overlay?: Raw }> = {
  neon: { style: { background: '#06060b', ringColor: '#ffffff', glow: true } },
  pastel: {
    style: { background: '#fff4f8', palette: ['#ff8fab', '#a2d2ff', '#ffc971', '#8fe3a0', '#cdb4db', '#f9c74f'], ringColor: '#5c5470', glow: false, ballStyle: 'glossy' },
    overlay: { textColor: '#3d3551', font: 'rounded' },
  },
  paper: {
    style: { background: '#f4efe6', palette: ['#1d3557', '#e63946', '#2a9d8f', '#f4a261', '#264653', '#e76f51'], ringColor: '#1b1b1b', glow: false, grain: true },
    overlay: { textColor: '#1b1b1b', font: 'serif' },
  },
  retro: {
    style: { background: '#0b0f0b', palette: ['#33ff66', '#ffcc33', '#ff3366', '#33ccff', '#cc66ff', '#ff9933'], ringColor: '#33ff66', scanlines: true, vignette: true },
    overlay: { textColor: '#33ff66', font: 'mono' },
  },
  vaporwave: {
    style: { background: '#1a0b2e', palette: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96'], ringColor: '#ff71ce', backdrop: 'grid', ringStyle: 'double', trailStyle: 'ribbon' },
    overlay: { textColor: '#fffb96', font: 'condensed' },
  },
  noir: { style: { background: '#000000', palette: ['#ffffff', '#bdbdbd', '#ff2e55', '#8a8a8a'], ringColor: '#ffffff', vignette: true, grain: true, ballStyle: '3d' } },
  blueprint: {
    style: { background: '#0d3b66', palette: ['#ffffff', '#a9d6e5', '#f4d35e', '#ee964b'], ringColor: '#ffffff', backdrop: 'grid', ringStyle: 'dashed', glow: false },
    overlay: { font: 'mono' },
  },
  candy: { style: { background: '#2b0a3d', palette: ['#ff4d9d', '#ffd23f', '#7cff6b', '#4dd4ff', '#ff9f1c', '#c77dff'], ringColor: '#ffe3f1', ballStyle: 'glossy', ringStyle: 'double' }, overlay: { font: 'rounded' } },
};

function applyTheme(scene: Raw): void {
  const name = scene.style?.theme;
  const theme = typeof name === 'string' ? THEMES[name] : undefined;
  if (!theme) return;
  const style = (scene.style ??= {});
  for (const [k, v] of Object.entries(theme.style)) if (!(k in style)) style[k] = structuredClone(v);
  if (theme.overlay) {
    const overlay = (scene.overlay ??= {});
    for (const [k, v] of Object.entries(theme.overlay)) if (!(k in overlay)) overlay[k] = v;
  }
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
  applyTheme(scene);
  if (Array.isArray(scene.entities)) {
    scene.entities = scene.entities.flatMap((e: Raw, i: number) => (isPlainObject(e) && PREFABS.has(e.type) ? expandPrefab(e, `entities.${i}`) : [e]));
  }
  return parseScene(scene);
}

// ---- Authoring schema --------------------------------------------------------

/** The source file format (for JSON Schema generation / editor autocomplete). */
/** A "modifiers" list (scenes and quick settings). */
export const ModifierListSchema = z
  .array(
    z.union([
      z.enum(Object.keys(MODIFIERS) as [string, ...string[]]),
      z.object({ use: z.enum(Object.keys(MODIFIERS) as [string, ...string[]]) }).catchall(z.union([z.number(), z.boolean(), z.string()])),
    ]),
  )
  .describe(Object.entries(MODIFIERS).map(([k, m]) => `${k}: ${m.description}`).join('\n'));

export const SourceSchema = SceneSchema.omit({ entities: true })
  .partial()
  .extend({
    $schema: z.string().optional(),
    extends: z.string().optional().describe('Inherit from another scene (file name without .json).'),
    modifiers: ModifierListSchema.optional(),
    entities: z.array(z.union([EntitySchema, PrefabSchema])).optional(),
  })
  .strict();
