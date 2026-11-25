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
    hp: z.number().int().positive().optional().describe('Breakable: the ring shatters after this many bounces (every ball inside escapes).'),
    segments: z.number().int().min(2).max(360).optional().describe('Cut the ring into this many segments that break one by one (each after segmentHp bounces).'),
    segmentHp: z.number().int().min(1).default(1).describe('With segments: bounces each segment takes before it breaks.'),
    deadly: z.boolean().default(false).describe('Touching the ring eliminates the ball.'),
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
    hp: z.number().int().positive().optional().describe('Breakable: the polygon shatters after this many bounces.'),
    deadly: z.boolean().default(false).describe('Touching a side eliminates the ball.'),
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
    deadly: z.boolean().default(false).describe('Touching it eliminates the ball (spikes, lava).'),
    boost: z.number().min(0).max(3).default(1).describe('Bumper: ball speed is multiplied by this on each bounce (1 = normal).'),
    hp: z.number().int().positive().optional().describe('Breakable: disappears after this many bounces.'),
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
    deadly: z.boolean().default(false),
    boost: z.number().min(0).max(3).default(1).describe('Bumper: ball speed is multiplied by this on each bounce (pinball bumpers use ~1.3).'),
    hp: z.number().int().positive().optional().describe('Breakable: disappears after this many bounces.'),
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
    kill: z.boolean().default(false).describe('A drain: balls entering it are removed.'),
    finish: z.boolean().default(false).describe('A finish line: the first ball in wins (use with endOn: finish).'),
  })
  .strict()
  .describe('An invisible region that counts each ball entering it (once per ball).');

export const BrickSchema = z
  .object({
    type: z.literal('brick'),
    x: z.number().describe('Center x.'),
    y: z.number().describe('Center y.'),
    width: z.number().positive().default(90),
    height: z.number().positive().default(44),
    angle: z.number().default(0).describe('Rotation in degrees.'),
    hp: z.number().int().positive().default(3).describe('Bounces it takes before breaking. Shown on the brick.'),
    color: z.string().optional(),
  })
  .strict()
  .describe('A breakable rectangle with a hit counter (brick breaker).');

export const SpinnerSchema = z
  .object({
    type: z.literal('spinner'),
    x: z.number().default(WIDTH / 2).describe('Pivot x.'),
    y: z.number().default(HEIGHT / 2).describe('Pivot y.'),
    length: z.number().positive().default(300),
    width: z.number().positive().default(18),
    spin: z.number().default(2).describe('rad/s, positive = clockwise.'),
    angle: z.number().default(0).describe('Starting angle in degrees.'),
    pivot: z.enum(['center', 'end']).default('center').describe('Turn about the bar’s middle (a propeller) or one end (a paddle / sweeper).'),
    deadly: z.boolean().default(false).describe('A blade: touching it eliminates the ball.'),
    color: z.string().optional(),
  })
  .strict()
  .describe('A rotating bar: paddles, propellers, sweepers, saw blades.');

export const PortalSchema = z
  .object({
    type: z.literal('portal'),
    a: z.tuple([z.number(), z.number()]).describe('First mouth [x, y].'),
    b: z.tuple([z.number(), z.number()]).describe('Second mouth [x, y].'),
    radius: z.number().positive().default(46),
    color: z.string().optional().describe('Default: orange (a) and blue (b).'),
  })
  .strict()
  .describe('Two linked holes: a ball entering one comes out of the other at the same speed and direction.');

export const ForceSchema = z
  .object({
    type: z.literal('force'),
    kind: z.enum(['attract', 'repel', 'vortex', 'wind']).default('attract'),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(HEIGHT / 2),
    strength: z.number().default(900).describe('attract/repel/vortex: acceleration (px/s²) at 100 px away, falling with distance. wind: acceleration everywhere.'),
    direction: z.number().default(0).describe('wind: direction in degrees.'),
    radius: z.number().nonnegative().default(0).describe('Only acts within this distance (0 = everywhere).'),
    swallow: z.number().nonnegative().default(0).describe('attract: balls closer than this are swallowed (a black hole). 0 = none.'),
    inward: z.number().default(0.25).describe('vortex: how much of the pull is inward (0 = pure swirl, 1 = mostly inward).'),
    visible: z.boolean().default(true),
    color: z.string().optional(),
  })
  .strict()
  .describe('A force field: a black hole / sun (attract), repeller, whirlpool (vortex) or wind.');

export const EmitterSchema = z
  .object({
    type: z.literal('emitter'),
    x: z.number().default(WIDTH / 2),
    y: z.number().default(450),
    rate: z.number().positive().default(10).describe('Balls per second.'),
    count: z.number().int().positive().default(100).describe('Total balls it makes.'),
    start: z.number().nonnegative().default(0).describe('Seconds before it starts.'),
    speed: z.number().nonnegative().default(300),
    direction: z.number().default(90).describe('Degrees (90 = down).'),
    cone: z.number().nonnegative().default(20).describe('Random spread of the direction, degrees.'),
    jitter: z.number().nonnegative().default(6).describe('Random spread of the position, px.'),
    radius: z.number().positive().default(14),
    radiusJitter: z.number().nonnegative().default(0).describe('Random ± px on each ball’s radius.'),
    colors: z.array(z.string()).optional().describe('Cycled per ball. Default: the palette.'),
    rainbow: z.boolean().default(false).describe('Color balls along a smooth rainbow as they come out.'),
    team: z.string().optional(),
    level: z.number().int().min(0).optional().describe('Merge level of each ball (random 0..level when levels is on).'),
    levels: z.boolean().default(false).describe('Each ball gets a random merge level from 0 to level.'),
    loop: z.boolean().default(false).describe('Keep emitting forever, replacing balls removed by drains (count = how many at once).'),
  })
  .strict()
  .describe('A spawner: pours balls over time (sand, droppers, refills).');

export const TerritorySchema = z
  .object({
    type: z.literal('territory'),
    x: z.number().default(90).describe('Left edge.'),
    y: z.number().default(420).describe('Top edge.'),
    cols: z.number().int().min(2).max(120).default(20),
    rows: z.number().int().min(2).max(120).default(24),
    cell: z.number().positive().default(45).describe('Cell size in px.'),
    layout: z.enum(['halves', 'quadrants', 'stripes', 'columns', 'random', 'paint']).default('halves').describe('Initial ownership. Paint starts blank and awards cells under a moving ball to its team without reflecting it.'),
  })
  .strict()
  .describe('A tiled board for territory battles: a team ball passes through its own color, bounces off other colors and repaints them.');

export const PendulumSchema = z
  .object({
    type: z.literal('pendulum'),
    x: z.number().default(WIDTH / 2).describe('Pivot x.'),
    y: z.number().default(700).describe('Pivot y.'),
    arms: z.union([z.literal(1), z.literal(2)]).default(2).describe('1 = simple pendulum, 2 = double (chaotic).'),
    lengths: z.array(z.number().positive()).default([230, 230]).describe('Arm lengths in px.'),
    angles: z.array(z.number()).default([120, 150]).describe('Starting angles in degrees from straight down.'),
    count: z.number().int().min(1).max(200).default(1).describe('How many copies.'),
    spread: z.number().default(0.001).describe('Degrees added to the last arm’s angle for each copy (chaos: 0.001).'),
    wave: z.number().nonnegative().default(0).describe('Pendulum wave: > 0 = copies hang side by side with lengths tuned so the pattern repeats every this many seconds.'),
    waveBase: z.number().int().positive().default(18).describe('Pendulum wave: swings of the longest pendulum per pattern.'),
    gravity: z.number().positive().default(1400).describe('px/s².'),
    bob: z.number().positive().default(16).describe('Bob radius in px.'),
    colors: z.array(z.string()).optional().describe('Per copy, cycled. Default: a rainbow.'),
    chime: z.boolean().default(true).describe('Play a note when a bob swings through the bottom.'),
  })
  .strict()
  .describe('Pendulums: chaos (double pendulums a hair apart) or a pendulum wave. Drawn with trails; they don’t collide with balls.');

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
    team: z.string().optional().describe('Team name (from the scene’s teams). Sets the color and emoji unless given.'),
    teams: z.array(z.string()).optional().describe('Per-ball teams, cycled.'),
    level: z.number().int().min(0).optional().describe('Merge level (balls of the same level merge into the next one).'),
    copies: z.number().int().min(1).max(64).default(1).describe('Butterfly effect: spawn this many ghost copies of each ball that never touch each other.'),
    jitter: z.number().default(0.000001).describe('With copies: degrees added to the launch direction of each copy.'),
    weapon: z
      .object({
        kind: z
          .enum(['blade', 'sword', 'dagger', 'spear', 'hammer', 'scythe', 'bow', 'unarmed'])
          .default('blade')
          .describe('blade: plain. sword: +damage per hit. dagger: spins faster per hit. spear: longer per hit. hammer: huge knockback. scythe: long and fast. bow: fires arrows (more per hit). unarmed: no blade, body hits do damage and it speeds up per hit.'),
        grow: z
          .object({
            damage: z.number().default(0),
            spin: z.number().default(1).describe('Spin multiplier per hit.'),
            length: z.number().default(0),
            speed: z.number().default(1).describe('Ball speed multiplier per hit.'),
            arrows: z.number().default(0),
          })
          .strict()
          .optional()
          .describe('How the weapon powers up with each hit it lands. Default: set by kind.'),
        fireEvery: z.number().positive().default(1.1).describe('bow: seconds between volleys.'),
        knockback: z.number().positive().default(1).describe('Multiplier on the push a strike gives.'),
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
  z.object({ do: z.literal('grow'), amount: z.number().default(1.5).describe('px of radius (negative shrinks).'), max: z.number().positive().default(380), min: z.number().positive().default(3) }).strict(),
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
  z
    .object({
      do: z.literal('split'),
      min: z.number().positive().default(6).describe('Balls smaller than this stop splitting.'),
      angle: z.number().default(25).describe('Degrees between the two halves’ directions.'),
      recolor: z.boolean().default(true).describe('The new half takes the next palette color.'),
    })
    .strict()
    .describe('The ball splits into two, each with half the area.'),
  z.object({ do: z.literal('absorb'), max: z.number().positive().default(400) }).strict().describe('On a hit: the bigger ball swallows the smaller and gains its area.'),
  z
    .object({ do: z.literal('merge'), growth: z.number().min(1).default(1.25).describe('Radius multiplier per level.'), maxLevel: z.number().int().min(1).default(10) })
    .strict()
    .describe('On a hit: two balls of the same level fuse into one of the next level.'),
  z
    .object({
      do: z.literal('convert'),
      mode: z.enum(['beats', 'always']).default('beats').describe('beats: only if this ball’s team beats the other’s (teams[].beats). always: the hit ball always switches.'),
      chance: z.number().min(0).max(1).default(1).describe('Probability a hit converts (lower = slower spread).'),
    })
    .strict()
    .describe('On a hit: the other ball joins this ball’s team.'),
  z.object({ do: z.literal('clone') }).strict().describe('Leave a frozen, immovable copy of the ball where it is.'),
  z.object({ do: z.literal('moveGap') }).strict().describe('Every gap of the ring jumps to a new random angle.'),
  z.object({ do: z.literal('addGap'), width: z.number().positive().default(20), max: z.number().int().positive().default(8) }).strict().describe('Open another gap at a random angle.'),
  z.object({ do: z.literal('addSide'), max: z.number().int().min(3).max(24).default(24) }).strict().describe('A polygon gains a side.'),
  z.object({ do: z.literal('shrinkContainer'), amount: z.number().default(2).describe('px per firing (negative grows).'), min: z.number().positive().default(80) }).strict(),
  z.object({ do: z.literal('recolor') }).strict().describe('The ball takes the next palette color.'),
  z
    .object({ do: z.literal('growForce'), factor: z.number().positive().default(1.05).describe('Strength multiplier.'), swallow: z.number().default(1).describe('px added to the swallow radius.'), max: z.number().positive().default(200) })
    .strict()
    .describe('Every force field gets stronger (a black hole that grows).'),
  z.object({ do: z.literal('end') }).strict().describe('End the run now (the climax); the tail plays on.'),
  z.object({ do: z.literal('freezeAll') }).strict().describe('Lock every ball where it is (a settled pile holds its picture).'),
]);

export const RuleSchema = z
  .object({
    on: z
      .enum(['bounce', 'escape', 'hit', 'eliminate', 'strike', 'wake', 'break', 'teleport', 'swallow', 'capture', 'merge', 'convert', 'corner', 'finish'])
      .describe(
        'bounce = ball hits a wall; hit = two balls collide; eliminate = a ball runs out of hp; strike = a weapon hits a ball; wake = a frozen ball is woken; break = a ball breaks a brick, ring segment or ring; teleport = through a portal; swallow = eaten by a black hole, drain or bigger ball; capture = repaints a territory cell; merge = two balls fused; convert = a ball switched team; corner = a polygon bounce right in a corner; finish = a ball crossed a finish zone.',
      ),
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

export const EntitySchema = z.discriminatedUnion('type', [
  RingSchema,
  PolygonSchema,
  WallSchema,
  PegSchema,
  ZoneSchema,
  BallSchema,
  BrickSchema,
  SpinnerSchema,
  PortalSchema,
  ForceSchema,
  EmitterSchema,
  TerritorySchema,
  PendulumSchema,
]);

export const SceneSchema = z
  .object({
    version: z.literal(1).default(1),
    title: z.string().default('Untitled'),
    category: z.enum(['escape', 'destruction', 'teams', 'battle', 'forces', 'surreal', 'chaos', 'satisfying', 'music']).optional().describe('Gallery family.'),
    teams: z
      .array(
        z
          .object({
            name: z.string(),
            color: z.string().optional(),
            emoji: z.string().optional(),
            beats: z.array(z.string()).default([]).describe('Teams this one converts on a hit (rock beats scissors).'),
          })
          .strict(),
      )
      .default([])
      .describe('Teams for territory, conversion and team battles.'),
    camera: z
      .object({
        mode: z.enum(['fixed', 'follow', 'zoomOut']).default('fixed').describe('follow: gently keep the action centered. zoomOut: frame the innermost ring the ball is still inside (for dozens of nested rings).'),
        aperture: z.number().positive().optional().describe('Clip the playfield to a circular window of this radius in screen pixels, keeping text clear during zooms.'),
        zoom: z.number().min(0.2).max(4).default(1),
        shake: z.number().min(0).max(3).default(0).describe('Screen shake on breaks, knockouts and escapes (0 = off).'),
        slowmo: z.number().min(0).max(10).default(0).describe('Seconds of slow motion starting just before the climax (0 = off).'),
        slowmoFactor: z.number().min(0.05).max(1).default(0.25),
        slowmoLead: z.number().min(0).max(3).default(0.6).describe('Seconds of the run before the climax that are already slowed.'),
        countdown: z.number().int().min(0).max(5).default(0).describe('A 3-2-1-GO intro: this many counts with the run frozen.'),
      })
      .strict()
      .default({}),
    seed: z.number().int().default(1),
    duration: z
      .object({
        max: z.number().positive().default(60).describe('Hard cap in seconds.'),
        endOn: z
          .enum(['firstEscape', 'allEscaped', 'lastStanding', 'never', 'oneTeam', 'finish', 'cleared', 'mostTerritory'])
          .default('firstEscape')
          .describe('oneTeam = every ball left is on one team; finish = a ball reaches a finish zone; cleared = every brick and breakable ring is gone; mostTerritory = lock the board at max minus tail and show who owns the most cells.'),
        tail: z.number().nonnegative().default(2).describe('Seconds to keep rolling after the ending event.'),
        trimStart: z.number().nonnegative().default(0).describe('Export skips this many seconds (the simulation still runs from 0). Perfect loops use it.'),
      })
      .strict()
      .default({}),
    clock: z
      .object({
        seconds: z.number().min(3).max(300).describe('Countdown length. The run must reach its ending before zero, or it ends there with "Time’s up". Sets duration.max to seconds + tail.'),
        final: z.number().min(0).max(30).default(5).describe('The final stretch (seconds before zero): the clock turns red, pulses and ticks, and rush actions fire.'),
        rush: z
          .array(ActionSchema)
          .optional()
          .describe('Actions fired every rushEvery seconds through the final stretch (e.g. shrinkGap with a negative amount widens the exit; speedUp for battles), so the climax tends to land right before zero.'),
        rushEvery: z.number().positive().default(1).describe('Seconds between rush firings.'),
        ticks: z.boolean().default(true).describe('A tick each second of the final stretch and a buzzer at zero.'),
        timeUpText: z.string().default('TIME’S UP').describe('Banner when the clock hits zero first.'),
      })
      .strict()
      .optional()
      .describe('A countdown: urgency on screen, an escalating final stretch, and a hard stop at zero.'),
    world: z
      .object({
        gravity: z.union([z.number(), Vec]).default(900).describe('px/s². A number pulls down; [x, y] is a vector.'),
        keepEnergy: z.boolean().default(true).describe('Hold each ball’s energy constant so bounces never die out.'),
        restitution: z.number().min(0).max(1.5).default(1),
        friction: z.number().min(0).max(1).default(0).describe('Share of sliding speed lost on each wall/peg contact. 0 = frictionless.'),
        damping: z.number().min(0).max(20).default(0).describe('Velocity lost per second (air drag). Helps piles settle; 0 = none.'),
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
        theme: z.enum(['neon', 'pastel', 'paper', 'retro', 'vaporwave', 'noir', 'blueprint', 'candy']).optional().describe('A look: fills in colors and styles you haven’t set.'),
        ballStyle: z.enum(['flat', 'glossy', '3d', 'outline', 'glass']).default('flat'),
        ringStyle: z.enum(['solid', 'dashed', 'double', 'rainbow', 'segments']).default('solid'),
        trailStyle: z.enum(['dots', 'ribbon', 'comet', 'rainbow']).default('dots'),
        colorMode: z.enum(['fixed', 'bounce', 'rainbow', 'speed']).default('fixed').describe('bounce: new color every bounce; rainbow: hue drifts; speed: blue when slow, white-hot when fast.'),
        lines: z.enum(['none', 'center', 'web', 'star', 'tether']).default('none').describe('String art: center = each bounce point to the ring center; web = to the previous bounce point; star = to the bounce 5 back; tether = a live line from ball to center.'),
        lineAlpha: z.number().min(0).max(1).default(0.35),
        backdrop: z.enum(['none', 'stars', 'grid', 'gradient', 'ripples']).default('none'),
        vignette: z.boolean().default(false),
        grain: z.boolean().default(false),
        scanlines: z.boolean().default(false),
        chromatic: z.boolean().default(false).describe('Color fringing on big hits.'),
        bloom: z.boolean().default(false),
        confetti: z.boolean().default(false).describe('Confetti on escapes and wins.'),
        reveal: z
          .object({ text: z.string().optional(), image: z.string().optional().describe('A picture from images/.'), at: z.number().nonnegative().optional().describe('Sample landing spots at this time (default: the end).') })
          .strict()
          .optional()
          .describe('Picture reveal: each ball is colored by where it will land, so the run ends in this word or picture.'),
        revealColors: z.array(z.string()).optional().describe('Filled in by the studio for a reveal: color per ball id.'),
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
        instrument: z.enum(['pluck', 'bell', 'marimba', 'glass', 'chip', 'piano', 'kalimba', 'pop', 'synth', 'meow']).default('pluck'),
        climax: z.enum(['none', 'drop', 'swell', 'gong']).default('none').describe('A big sound at the climax.'),
        pitchBy: z.enum(['melody', 'size', 'height', 'speed']).default('melody').describe('size: bigger balls play lower; height: higher on screen plays higher; speed: faster plays higher.'),
        eventSounds: z.boolean().default(true).describe('Sounds for breaks, portals, merges, captures and swallows.'),
        volume: z.number().min(0).max(1).default(0.7),
        bounceSpacing: z.number().min(0).default(0).describe('Minimum seconds between audible bounce notes. Useful for dense pours.'),
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
        timer: z.boolean().default(true).describe('Elapsed time on the counter line (scenes without a clock).'),
        clock: z.boolean().default(true).describe('Show the clock’s countdown (big digits and a draining bar under the title). Needs a scene clock.'),
        clockY: z.number().min(100).max(1900).optional().describe('Where the countdown digits sit. Default: just under the title.'),
        clockSize: z.number().min(30).max(240).default(96),
        counter: z.enum(['none', 'bounces', 'balls', 'escaped', 'teams', 'rings', 'bricks', 'hp', 'sides', 'gap', 'gravity', 'diameter', 'level', 'swallowed']).default('bounces'),
        endCard: z.string().optional().describe('Text shown over the tail after the climax ("Follow for part 2").'),
        reveal: z.string().optional().describe('A message revealed one word (or letter) per bounce.'),
        revealBy: z.enum(['words', 'letters']).default('words'),
        progress: z.enum(['none', 'bar', 'ring']).default('none').describe('Time left, as a bar under the title or a ring around the counter.'),
        teamBar: z.boolean().default(true).describe('Show each team’s share as a bar (team formats).'),
        resultPosition: z.enum(['center', 'title']).default('center').describe('Place the result in the title area to keep the final play visible.'),
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
export type TeamSpec = Scene['teams'][number];

/** Parse and fill defaults. Throws an Error listing every problem by path. */
export function parseScene(input: unknown): Scene {
  const result = SceneSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid scene:\n${lines.join('\n')}`);
  }
  if (!result.data.entities.some((e) => e.type === 'ball' || e.type === 'emitter' || e.type === 'pendulum')) {
    throw new Error('Invalid scene:\nentities: needs at least one ball, emitter or pendulum (a ball with count 0 is fine as a spawn template)');
  }
  const teamNames = new Set(result.data.teams.map((t) => t.name));
  for (const [i, e] of result.data.entities.entries()) {
    const used = e.type === 'ball' ? [e.team, ...(e.teams ?? [])] : e.type === 'emitter' ? [e.team] : [];
    for (const t of used) if (t !== undefined && !teamNames.has(t)) throw new Error(`Invalid scene:\nentities.${i}: unknown team "${t}" (add it to "teams")`);
  }
  for (const [i, t] of result.data.timeline.entries()) {
    if ((t.at === undefined) === (t.every === undefined)) throw new Error(`Invalid scene:\ntimeline.${i}: set exactly one of "at" or "every"`);
    if (!t.do && !t.script) throw new Error(`Invalid scene:\ntimeline.${i}: needs "do" or "script"`);
  }
  for (const [i, r] of result.data.rules.entries()) {
    if (!r.do && !r.script) throw new Error(`Invalid scene:\nrules.${i}: needs "do" or "script"`);
  }
  const { clock, duration } = result.data;
  if (clock) {
    if (clock.final > clock.seconds) throw new Error('Invalid scene:\nclock.final: must not be longer than clock.seconds');
    // The clock is the run's length: zero is the hard stop, then the tail plays.
    duration.max = clock.seconds + duration.tail;
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

/**
 * The scene has a clock and an ending that can beat it (an endOn other than
 * never / mostTerritory, or a rule or timeline that ends the run), rather
 * than a contest that always runs the clock down.
 */
export function racesClock(scene: Scene): boolean {
  if (!scene.clock || scene.duration.endOn === 'mostTerritory') return false;
  if (scene.duration.endOn !== 'never') return true;
  return /world\.end\(|"do":"end"/.test(JSON.stringify(scene.rules) + JSON.stringify(scene.timeline));
}

/** Gravity as a vector. */
export function gravityVec(g: number | [number, number]): [number, number] {
  return typeof g === 'number' ? [0, g] : g;
}
