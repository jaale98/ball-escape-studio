import { z } from 'zod';

/** Output frame size (vertical 9:16). World units are output pixels. */
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const PHYSICS_HZ = 240;
export const FPS = 60;
export const STEPS_PER_FRAME = PHYSICS_HZ / FPS;

// Every object is strict: an unknown key (usually a typo) is an error, not silently ignored.

/** A gap in a ring. Angles in degrees: 0 = right, 90 = down. */
const GapSchema = z
  .object({
    at: z.number().default(0).describe('Center of the gap in degrees (0 = right, 90 = down), relative to the ring rotation.'),
    width: z.number().min(0).max(360).default(30).describe('Angular width of the gap in degrees.'),
  })
  .strict();

export const RingSchema = z
  .object({
    type: z.literal('ring'),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(HEIGHT / 2),
    radius: z.number().positive().default(420),
    thickness: z.number().positive().default(12),
    spin: z.number().default(0.8).describe('Rotation speed in radians per second. Positive = clockwise.'),
    angle: z.number().default(0).describe('Starting rotation in degrees.'),
    gaps: z.array(GapSchema).default([{ at: 0, width: 30 }]).describe('Openings in the ring. [] = closed ring.'),
    color: z.string().optional(),
  })
  .strict()
  .describe('A circular wall the balls start inside. Escaping = leaving through a gap.');

export const PolygonSchema = z
  .object({
    type: z.literal('polygon'),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(HEIGHT / 2),
    radius: z.number().positive().default(430).describe('Distance from center to each corner.'),
    sides: z.number().int().min(3).max(24).default(6),
    thickness: z.number().positive().default(12),
    spin: z.number().default(0.8),
    angle: z.number().default(0),
    open: z.array(z.number().int().min(0)).default([0]).describe('Indices of sides with an exit. [] = closed.'),
    gap: z.number().positive().optional().describe('Width (px) of the exit in each open side, centered. Default: the whole side is missing.'),
    color: z.string().optional(),
  })
  .strict()
  .describe('A spinning regular polygon the balls start inside. Missing sides are exits.');

export const WallSchema = z
  .object({
    type: z.literal('wall'),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    thickness: z.number().positive().default(10),
    color: z.string().optional(),
  })
  .strict()
  .describe('A static straight wall (two-sided).');

export const PegSchema = z
  .object({
    type: z.literal('peg'),
    x: z.number(),
    y: z.number(),
    radius: z.number().positive().default(9),
    color: z.string().optional(),
  })
  .strict()
  .describe('A static round peg.');

export const ZoneSchema = z
  .object({
    type: z.literal('zone'),
    x: z.number().describe('Left edge.'),
    y: z.number().describe('Top edge.'),
    width: z.number().positive(),
    height: z.number().positive(),
    label: z.string().optional(),
  })
  .strict()
  .describe('An invisible region that counts each ball entering it (once per ball).');

export const BallSchema = z
  .object({
    type: z.literal('ball'),
    x: z.number().optional().describe('Spawn position. Defaults to the first container center.'),
    y: z.number().optional(),
    radius: z.number().positive().default(22),
    speed: z.number().nonnegative().default(800).describe('Launch speed in px/s.'),
    direction: z.number().optional().describe('Launch direction in degrees. Random (from the seed) when omitted.'),
    count: z.number().int().min(0).default(1).describe('How many to spawn. 0 = template only (for spawn actions).'),
    spread: z.number().nonnegative().optional().describe('Random position jitter in px. Defaults to 40 when count > 1.'),
    color: z.string().optional(),
    colors: z.array(z.string()).optional().describe('Per-ball colors, cycled.'),
    labels: z.array(z.string()).optional().describe('Per-ball names (teams, countries), cycled. Shown under each ball.'),
    image: z.string().optional().describe('A picture from images/ (file name, e.g. "cat.png") cropped into the ball.'),
    images: z.array(z.string()).optional().describe('Per-ball pictures from images/, cycled.'),
    emoji: z.string().optional().describe('An emoji drawn on the ball (e.g. "🍕"; flags like "🇧🇷" work on Mac).'),
    emojis: z.array(z.string()).optional().describe('Per-ball emoji, cycled.'),
    hp: z.number().positive().optional().describe('Hit points. Balls without hp cannot be damaged.'),
    frozen: z.boolean().optional().describe('Starts still and weightless; wakes up when another ball hits it (chain reactions).'),
    arrange: z.enum(['random', 'grid']).default('random').describe('With count > 1: scatter randomly within spread, or lay out in a tidy grid that never overlaps.'),
    shape: z.enum(['circle', 'square', 'triangle', 'hexagon', 'star']).optional().describe('How the ball is drawn (it spins as it moves). Collisions still use its circle.'),
    weapon: z
      .object({
        length: z.number().positive().default(70).describe('px beyond the ball’s edge.'),
        width: z.number().positive().default(8),
        spin: z.number().default(4).describe('rad/s. Weapons that clash reverse direction.'),
        damage: z.number().nonnegative().default(1).describe('hp taken from a ball the weapon strikes.'),
        angle: z.number().default(0).describe('Starting angle in degrees.'),
        color: z.string().optional(),
      })
      .strict()
      .optional()
      .describe('A spinning blade attached to the ball: strikes damage and knock back other balls.'),
  })
  .strict();

const Vec = z.tuple([z.number(), z.number()]);

export const ActionSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('grow'), amount: z.number().default(1.5), max: z.number().positive().default(380) }).strict(),
  z.object({ do: z.literal('shrinkGap'), amount: z.number().default(1), min: z.number().min(0).default(0) }).strict(),
  z.object({ do: z.literal('speedUp'), factor: z.number().positive().default(1.02), max: z.number().positive().default(3000) }).strict(),
  z
    .object({
      do: z.literal('spawn'),
      count: z.number().int().min(1).default(1),
      x: z.number().optional().describe('Spawn point. In a rule, defaults to the container the event happened at.'),
      y: z.number().optional(),
      spread: z.number().nonnegative().default(30),
      speed: z.number().nonnegative().optional(),
      direction: z.number().optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal('damage'),
      amount: z.number().default(1),
      perSpeed: z.number().default(0).describe('Extra damage per 1000 px/s of impact.'),
      when: z.enum(['always', 'defending']).default('always').describe('On a hit: "defending" damages only the ball that was struck (the one coming in slower), so two equal balls never trade damage.'),
    })
    .strict(),
  z.object({ do: z.literal('setGravity'), gravity: z.union([z.number(), Vec]) }).strict(),
  z.object({ do: z.literal('flipGravity') }).strict(),
  z.object({ do: z.literal('rotateGravity'), degrees: z.number().default(90) }).strict(),
  z.object({ do: z.literal('spinUp'), factor: z.number().default(1.05), max: z.number().positive().default(8) }).strict(),
  z.object({ do: z.literal('reverseSpin') }).strict(),
]);

export const RuleSchema = z
  .object({
    on: z
      .enum(['bounce', 'escape', 'hit', 'eliminate', 'strike', 'wake'])
      .describe('bounce = ball hits a wall; hit = two balls collide; eliminate = a ball runs out of hp; strike = a weapon hits a ball; wake = a frozen ball is woken.'),
    do: z.array(ActionSchema).min(1).optional(),
    script: z
      .string()
      .optional()
      .describe('JavaScript run on each event, with `ctx` (see src/engine/script.ts): ctx.ball, ctx.other, ctx.container, ctx.world, ctx.rng, ctx.state. Must be deterministic.'),
  })
  .strict();

export const TimelineSchema = z
  .object({
    at: z.number().nonnegative().optional().describe('Fire once at this time (seconds).'),
    every: z.number().positive().optional().describe('Fire repeatedly with this period (seconds).'),
    start: z.number().nonnegative().default(0).describe('With every: first firing time.'),
    until: z.number().nonnegative().optional().describe('With every: stop after this time.'),
    do: z.array(ActionSchema).min(1).optional().describe('Ball actions (grow, speedUp, damage) apply to every live ball.'),
    script: z.string().optional().describe('JavaScript run each time this fires, with `ctx` (ctx.ball is null).'),
  })
  .strict();

export const EntitySchema = z.discriminatedUnion('type', [RingSchema, PolygonSchema, WallSchema, PegSchema, ZoneSchema, BallSchema]);

export const SceneSchema = z
  .object({
    version: z.literal(1).default(1),
    title: z.string().default('Untitled'),
    seed: z.number().int().default(1),
    duration: z
      .object({
        max: z.number().positive().default(60).describe('Hard cap in seconds.'),
        endOn: z.enum(['firstEscape', 'allEscaped', 'lastStanding', 'never']).default('firstEscape'),
        tail: z.number().nonnegative().default(2).describe('Seconds to keep rolling after the ending event.'),
        trimStart: z.number().nonnegative().default(0).describe('Export skips this many seconds (the simulation still runs from 0). Perfect loops use it.'),
      })
      .strict()
      .default({}),
    world: z
      .object({
        gravity: z.union([z.number(), Vec]).default(900).describe('px/s². A number pulls down; [x, y] is a vector.'),
        keepEnergy: z.boolean().default(true).describe('Hold each ball’s energy constant so bounces never die out.'),
        restitution: z.number().min(0).max(1.5).default(1),
        friction: z.number().min(0).max(1).default(0).describe('Share of sliding speed lost on each wall/peg contact. 0 = frictionless.'),
        maxBalls: z.number().int().positive().default(300),
        speedScale: z.number().positive().default(1).describe('Multiplies every ball launch speed. The Director tunes this.'),
        spinScale: z.number().default(1).describe('Multiplies every container spin. The Director tunes this.'),
      })
      .strict()
      .default({}),
    entities: z.array(EntitySchema).min(1),
    rules: z.array(RuleSchema).default([]),
    timeline: z.array(TimelineSchema).default([]),
    style: z
      .object({
        background: z.string().default('#06060b'),
        palette: z.array(z.string()).min(1).default(['#ff4d6d', '#4dd4ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c']),
        ringColor: z.string().default('#ffffff'),
        trail: z.number().min(0).max(0.99).default(0.82).describe('0 = no trail, 0.95 = long trail.'),
        glow: z.boolean().default(true),
        paint: z.boolean().default(false).describe('Balls leave permanent paint on the background.'),
        showHp: z.boolean().default(true),
        renderer: z.enum(['auto', 'canvas', 'webgl']).default('auto').describe('Ball drawing: webgl handles thousands of balls; auto picks it for crowd scenes.'),
        backgroundImage: z.string().optional().describe('A picture from images/ filling the background (cropped to fit).'),
        backgroundDim: z.number().min(0).max(1).default(0.45).describe('How much to darken the background picture so balls stand out.'),
      })
      .strict()
      .default({}),
    audio: z
      .object({
        melody: z
          .string()
          .regex(/^(pentatonic|ode-to-joy|fur-elise|midi:[\w.-]+)$/, 'melody must be pentatonic, ode-to-joy, fur-elise, or midi:<file in songs/>')
          .default('pentatonic'),
        notes: z
          .array(z.union([z.number(), z.array(z.number())]))
          .optional()
          .describe('Inline melody as MIDI note numbers; an array is a chord. Overrides melody.'),
        chords: z.boolean().default(false).describe('With a MIDI melody: play every note struck together, not just the top one.'),
        parts: z.array(z.number().int().min(0)).optional().describe('With a MIDI melody: which parts (track/channel pairs, numbered from 0) play on bounces. Default: the detected melody part.'),
        noteTimes: z.array(z.number()).optional().describe('Filled in by the studio from the MIDI file: when each melody note falls in the song (seconds). Used for rhythm sync.'),
        backing: z.boolean().default(false).describe('With rhythm lock: play the rest of the song (the parts not on bounces) in time underneath.'),
        backingParts: z.array(z.number().int().min(0)).optional().describe('Which parts play as backing. Default: every part not on bounces.'),
        backingVolume: z.number().min(0).max(1).default(0.5),
        backingNotes: z.array(z.tuple([z.number(), z.number()])).optional().describe('Filled in by the studio: [time, note] of every backing note.'),
        rhythmLock: z
          .boolean()
          .default(false)
          .describe('Keep bounces in time with the MIDI song: after each bounce the ball’s speed is set so it reaches the wall exactly on the next note. Needs zero gravity, one ball and a ring.'),
        tempo: z.number().positive().optional().describe('With rhythmLock: song speed multiplier. Default: chosen so the ball keeps roughly its launch speed.'),
        transpose: z.number().int().default(0),
        instrument: z.enum(['pluck', 'bell', 'marimba']).default('pluck'),
        volume: z.number().min(0).max(1).default(0.7),
        escapeSound: z.boolean().default(true),
        hitSound: z.boolean().default(true).describe('Click when balls hit each other.'),
      })
      .strict()
      .default({}),
    overlay: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        font: z.enum(['sans', 'rounded', 'serif', 'mono', 'condensed']).default('sans'),
        textColor: z.string().default('#ffffff'),
        titleSize: z.number().min(20).max(200).default(76),
        subtitleSize: z.number().min(14).max(120).default(40),
        titleY: z.number().min(60).max(1800).default(250).describe('Where the title sits (px from the top of the 1920 frame).'),
        counterSize: z.number().min(16).max(160).default(52),
        counterY: z.number().min(100).max(1900).optional().describe('Where the counter and timer sit. Default: near the bottom.'),
        labelSize: z.number().min(10).max(80).default(26).describe('Size of the names under balls.'),
        timer: z.boolean().default(true),
        counter: z.enum(['none', 'bounces', 'balls', 'escaped']).default('bounces'),
        winner: z.boolean().default(true).describe('Show a winner banner when a race or battle ends.'),
        zones: z.boolean().default(true).describe('Show zone counts.'),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Scene = z.output<typeof SceneSchema>;
export type RingSpec = z.output<typeof RingSchema>;
export type PolygonSpec = z.output<typeof PolygonSchema>;
export type BallSpec = z.output<typeof BallSchema>;
export type Action = z.output<typeof ActionSchema>;
export type TimelineEntry = z.output<typeof TimelineSchema>;

/** Parse and fill defaults. Throws an Error listing every problem by path. */
export function parseScene(input: unknown): Scene {
  const result = SceneSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid scene:\n${lines.join('\n')}`);
  }
  if (!result.data.entities.some((e) => e.type === 'ball')) {
    throw new Error('Invalid scene:\nentities: needs at least one ball (count 0 is fine for a spawn template)');
  }
  for (const [i, t] of result.data.timeline.entries()) {
    if ((t.at === undefined) === (t.every === undefined)) throw new Error(`Invalid scene:\ntimeline.${i}: set exactly one of "at" or "every"`);
    if (!t.do && !t.script) throw new Error(`Invalid scene:\ntimeline.${i}: needs "do" or "script"`);
  }
  for (const [i, r] of result.data.rules.entries()) {
    if (!r.do && !r.script) throw new Error(`Invalid scene:\nrules.${i}: needs "do" or "script"`);
  }
  return result.data;
}

/**
 * How long one pass through a song's notes lasts (seconds), for looping: from
 * the first note to the last, plus the last note's own length. Rhythm lock and
 * the backing track both use this, so they stay aligned on every loop.
 */
export function songLoopLength(noteTimes: number[]): number {
  const n = noteTimes.length;
  if (n < 2) return 1;
  return noteTimes[n - 1] - noteTimes[0] + Math.max(0.25, noteTimes[n - 1] - noteTimes[n - 2]);
}

/** Gravity as a vector. */
export function gravityVec(g: number | [number, number]): [number, number] {
  return typeof g === 'number' ? [0, g] : g;
}
