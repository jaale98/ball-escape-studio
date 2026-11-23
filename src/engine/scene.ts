import { z } from 'zod';

/** Output frame size (vertical 9:16). World units are output pixels. */
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const PHYSICS_HZ = 240;
export const FPS = 60;
export const STEPS_PER_FRAME = PHYSICS_HZ / FPS;

/** A gap in a ring. Angles in degrees: 0 = right, 90 = down. */
const GapSchema = z.object({
  at: z.number().default(0),
  width: z.number().min(0).max(360).default(30),
});

const RingSchema = z.object({
  type: z.literal('ring'),
  x: z.number().default(WIDTH / 2),
  y: z.number().default(HEIGHT / 2),
  radius: z.number().positive().default(420),
  thickness: z.number().positive().default(12),
  /** Rotation speed in radians per second. Positive = clockwise on screen. */
  spin: z.number().default(0.8),
  /** Starting rotation in degrees. */
  angle: z.number().default(0),
  gaps: z.array(GapSchema).default([{ at: 0, width: 30 }]),
  color: z.string().optional(),
});

const BallSchema = z.object({
  type: z.literal('ball'),
  /** Spawn position. Defaults to the first ring's center. */
  x: z.number().optional(),
  y: z.number().optional(),
  radius: z.number().positive().default(22),
  /** Launch speed in px/s. */
  speed: z.number().nonnegative().default(800),
  /** Launch direction in degrees. Random (from the seed) when omitted. */
  direction: z.number().optional(),
  count: z.number().int().min(1).default(1),
  color: z.string().optional(),
});

const ActionSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('grow'), amount: z.number().default(1.5), max: z.number().positive().default(380) }),
  z.object({ do: z.literal('shrinkGap'), amount: z.number().default(1), min: z.number().min(0).default(0) }),
  z.object({ do: z.literal('speedUp'), factor: z.number().positive().default(1.02), max: z.number().positive().default(3000) }),
  z.object({ do: z.literal('spawn'), count: z.number().int().min(1).default(2) }),
]);

const RuleSchema = z.object({
  on: z.enum(['bounce', 'escape']),
  do: z.array(ActionSchema).min(1),
});

export const SceneSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().default('Untitled'),
  seed: z.number().int().default(1),
  duration: z
    .object({
      /** Hard cap in seconds. */
      max: z.number().positive().default(60),
      endOn: z.enum(['firstEscape', 'allEscaped', 'never']).default('firstEscape'),
      /** Seconds to keep rolling after the ending event. */
      tail: z.number().nonnegative().default(2),
    })
    .default({}),
  world: z
    .object({
      /** Downward gravity in px/s². */
      gravity: z.number().default(900),
      /** Hold each ball's energy constant so bounces never die out. */
      keepEnergy: z.boolean().default(true),
      restitution: z.number().min(0).max(1.5).default(1),
      maxBalls: z.number().int().positive().default(300),
    })
    .default({}),
  entities: z.array(z.discriminatedUnion('type', [RingSchema, BallSchema])).min(1),
  rules: z.array(RuleSchema).default([]),
  style: z
    .object({
      background: z.string().default('#06060b'),
      palette: z.array(z.string()).min(1).default(['#ff4d6d', '#4dd4ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c']),
      ringColor: z.string().default('#ffffff'),
      /** 0 = no trail, 0.95 = long trail. */
      trail: z.number().min(0).max(0.99).default(0.82),
      glow: z.boolean().default(true),
    })
    .default({}),
  audio: z
    .object({
      melody: z.enum(['pentatonic', 'ode-to-joy', 'fur-elise']).default('pentatonic'),
      instrument: z.enum(['pluck', 'bell', 'marimba']).default('pluck'),
      volume: z.number().min(0).max(1).default(0.7),
      escapeSound: z.boolean().default(true),
    })
    .default({}),
  overlay: z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      timer: z.boolean().default(true),
      counter: z.enum(['none', 'bounces', 'balls', 'escaped']).default('bounces'),
    })
    .default({}),
});

export type Scene = z.output<typeof SceneSchema>;
export type RingSpec = z.output<typeof RingSchema>;
export type BallSpec = z.output<typeof BallSchema>;
export type Action = z.output<typeof ActionSchema>;

/** Parse and fill defaults. Throws an Error listing every problem by path. */
export function parseScene(input: unknown): Scene {
  const result = SceneSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid scene:\n${lines.join('\n')}`);
  }
  if (!result.data.entities.some((e) => e.type === 'ball')) {
    throw new Error('Invalid scene:\nentities: needs at least one ball');
  }
  return result.data;
}
