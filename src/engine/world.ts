import * as M from './dmath';
import { Rng } from './rng';
import { type Action, ActionSchema, type BallSpec, gravityVec, HEIGHT, PHYSICS_HZ, type Scene, songLoopLength, type TeamSpec, WIDTH } from './scene';
import { compileScript, type ScriptContext, type ScriptFn } from './script';

export const DT = 1 / PHYSICS_HZ;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Minimum normal speed (px/s) for a contact to count as a bounce event. */
const BOUNCE_THRESHOLD = 20;
/** The same, for scenes without energy keeping (piles of resting balls). */
const SETTLE_THRESHOLD = 90;
/** Minimum closing speed (px/s) for a ball-ball contact to count as a hit. */
const HIT_THRESHOLD = 40;
/** After taking damage a ball can't be damaged again for this long (pinned balls would otherwise trade hits every step). */
const DAMAGE_COOLDOWN = Math.round(0.25 * PHYSICS_HZ);
const RHYTHM_MIN_SPEED = 120;
const RHYTHM_MAX_SPEED = 4000;

/**
 * Can rhythm lock work for this scene? It needs a MIDI song (for note timing),
 * exactly one ball for the whole run (several balls can't all bounce on the
 * beat), and a ring or polygon to bounce in. Gravity is fine.
 */
export function rhythmLockStatus(scene: Scene): { ok: boolean; reason: string } {
  if (!scene.audio.melody.startsWith('midi:') && !scene.audio.noteTimes) return { ok: false, reason: 'Needs a song with timing: pick a MIDI song (the songbook ones all work).' };
  const balls = scene.entities.reduce((n, e) => n + (e.type === 'ball' ? e.count : 0), 0);
  const spawns = JSON.stringify(scene.rules) + JSON.stringify(scene.timeline);
  if (balls !== 1 || /"spawn"|spawn\(/.test(spawns)) return { ok: false, reason: 'Needs exactly one ball: with several, the bounces can’t all land on the beat.' };
  if (!scene.entities.some((e) => e.type === 'ring' || e.type === 'polygon')) return { ok: false, reason: 'Needs a ring or polygon for the ball to bounce in.' };
  return { ok: true, reason: '' };
}

/** Above this many balls, ball-ball collisions use a spatial hash. */
const HASH_THRESHOLD = 48;

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  label?: string;
  hp?: number;
  maxHp?: number;
  /** Step of the last damage taken (for the damage cooldown). */
  lastDamageStep: number;
  alive: boolean;
  /** escaped[i] is true while the ball is outside container i. */
  escaped: boolean[];
  /** everEscaped[i] stays true once the ball has escaped container i. */
  everEscaped: boolean[];
  /** inZone[i] is true once the ball has been counted by zone i. */
  inZone: boolean[];
  /** Energy budget held constant when world.keepEnergy is on. */
  energy: number;
  /** Still and weightless until another ball hits it. */
  frozen: boolean;
  /** Drawn shape (collisions use the circle) and its rotation. */
  shape: 'circle' | 'square' | 'triangle' | 'hexagon' | 'star';
  rot: number;
  /** Picture (from images/) or emoji drawn on the ball. Visual only. */
  image?: string;
  emoji?: string;
  weapon?: Weapon;
  /** Team name (scene.teams), if any. */
  team?: string;
  /** Merge level. */
  level: number;
  /** Ghost-copy group: balls only touch balls of the same group. */
  group: number;
  /** Never moves and never wakes (clones). */
  anchored: boolean;
  /** An arrow: belongs to `owner`, deals `damage`, dies on any wall. */
  projectile?: { owner: number; damage: number };
  /** Portal it is standing in (can't re-enter until it leaves), or -1. */
  portal: number;
  /** Palette index, for recolor. */
  colorIndex: number;
  /** Emitter that made it, if any. */
  source?: number;
  /** Locked in place by freezeAll (drawn at full color, unlike a frozen ball). */
  locked?: boolean;
}

export interface Weapon {
  length: number;
  width: number;
  spin: number;
  damage: number;
  /** Current angle, radians. */
  angle: number;
  color?: string;
  lastClashStep: number;
  kind: 'blade' | 'sword' | 'dagger' | 'spear' | 'hammer' | 'scythe' | 'bow' | 'unarmed';
  grow: { damage: number; spin: number; length: number; speed: number; arrows: number };
  /** Hits landed so far. */
  hits: number;
  /** bow: arrows per volley, and the step of the next volley. */
  arrows: number;
  nextShot: number;
  fireSteps: number;
  knockback: number;
}

export interface Gap {
  /** Center of the gap, radians, relative to the ring's rotation. */
  at: number;
  /** Full angular width, radians. */
  width: number;
}

interface ContainerBase {
  id: number;
  x: number;
  y: number;
  /** Ring radius, or polygon circumradius. */
  radius: number;
  thickness: number;
  angle: number;
  spin: number;
  color: string;
  deadly: boolean;
  /** Whole-container hp (undefined = unbreakable). */
  hp?: number;
  maxHp?: number;
  /** Shattered: no longer a wall. */
  broken: boolean;
}
export interface RingContainer extends ContainerBase {
  kind: 'ring';
  gaps: Gap[];
  /** Breakable segments (hp per segment; 0 = broken), evenly spaced from angle 0. */
  segments?: number[];
  segmentHp: number;
  /** From outside, the gaps are solid: an escaped ball never falls back in. */
  oneWay: boolean;
  /** The gaps repeat this many times evenly around the ring. */
  repeat: number;
}
export interface PolyContainer extends ContainerBase {
  kind: 'poly';
  sides: number;
  /** open[k] = side k has an exit. */
  open: boolean[];
  /** Exit width in px within an open side; undefined = the whole side. */
  gap?: number;
}
/** Something balls start inside and can escape from. */
export type Container = RingContainer | PolyContainer;

/** A static capsule: a wall segment, or a peg (zero-length segment). */
export interface Solid {
  id: number;
  kind: 'wall' | 'peg' | 'spinner' | 'brick';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Half the wall thickness, or the peg radius. */
  half: number;
  color: string;
  deadly: boolean;
  boost: number;
  hp?: number;
  maxHp?: number;
  alive: boolean;
  /** spinner / brick: center (spinner: pivot), angle (radians), spin. */
  cx: number;
  cy: number;
  angle: number;
  spin: number;
  /** spinner: bar length and pivot; brick: half width / half height. */
  length: number;
  pivotEnd: boolean;
  hw: number;
  hh: number;
}

export interface Portal {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  colorA: string;
  colorB: string;
}

export interface Force {
  id: number;
  kind: 'attract' | 'repel' | 'vortex' | 'wind' | 'radial';
  x: number;
  y: number;
  strength: number;
  dx: number;
  dy: number;
  radius: number;
  swallow: number;
  inward: number;
  visible: boolean;
  color: string;
  /** Balls eaten so far. */
  eaten: number;
}

interface Emitter {
  spec: Extract<Scene['entities'][number], { type: 'emitter' }>;
  made: number;
  acc: number;
  startStep: number;
}

export interface Territory {
  x: number;
  y: number;
  cols: number;
  rows: number;
  cell: number;
  paint: boolean;
  /** Owner team index per cell (row-major), -1 for untouched canvas. */
  owner: Int16Array;
  /** Cells per team. */
  counts: number[];
}

export interface Pendulum {
  id: number;
  x: number;
  y: number;
  arms: 1 | 2;
  l1: number;
  l2: number;
  t1: number;
  t2: number;
  w1: number;
  w2: number;
  g: number;
  bob: number;
  color: string;
  chime: boolean;
}

export interface Zone {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  count: number;
  kill: boolean;
  finish: boolean;
}

export type SimEventType =
  | 'bounce'
  | 'escape'
  | 'spawn'
  | 'hit'
  | 'eliminate'
  | 'zone'
  | 'exit'
  | 'gravity'
  | 'strike'
  | 'clash'
  | 'wake'
  | 'break'
  | 'teleport'
  | 'swallow'
  | 'capture'
  | 'merge'
  | 'convert'
  | 'corner'
  | 'finish'
  | 'shoot'
  | 'swing'
  /** Clock: a whole second of the final stretch passed (n = seconds left). */
  | 'clock'
  /** Clock: zero, before the run's ending happened. */
  | 'timeUp';

export interface SimEvent {
  step: number;
  type: SimEventType;
  ball: number;
  /** Container index, or -1. */
  ring: number;
  /** Solid index (wall/peg), or -1. */
  solid: number;
  /** Zone index, or -1. */
  zone: number;
  x: number;
  y: number;
  /** Impact strength in px/s. */
  speed: number;
  /** Extra detail: the pendulum for a swing, the team index for a capture/convert, the level for a merge, the brick/solid broken. */
  n?: number;
}

interface TimelineState {
  atStep?: number;
  everySteps?: number;
  startStep: number;
  untilStep: number;
  actions: Action[];
  script?: ScriptFn;
  where: string;
}

type RuleEvent = 'bounce' | 'escape' | 'hit' | 'eliminate' | 'strike' | 'wake' | 'break' | 'teleport' | 'swallow' | 'capture' | 'merge' | 'convert' | 'corner' | 'finish';
const RULE_EVENTS: RuleEvent[] = ['bounce', 'escape', 'hit', 'eliminate', 'strike', 'wake', 'break', 'teleport', 'swallow', 'capture', 'merge', 'convert', 'corner', 'finish'];

/** Default power-ups per weapon kind (weapon.grow overrides). */
const WEAPON_GROW: Record<Weapon['kind'], Weapon['grow']> = {
  blade: { damage: 0, spin: 1, length: 0, speed: 1, arrows: 0 },
  sword: { damage: 1, spin: 1, length: 0, speed: 1, arrows: 0 },
  dagger: { damage: 0, spin: 1.18, length: 0, speed: 1, arrows: 0 },
  spear: { damage: 0, spin: 1, length: 14, speed: 1, arrows: 0 },
  hammer: { damage: 0.5, spin: 1, length: 0, speed: 1, arrows: 0 },
  scythe: { damage: 0, spin: 1.06, length: 4, speed: 1, arrows: 0 },
  bow: { damage: 0, spin: 1, length: 0, speed: 1, arrows: 1 },
  unarmed: { damage: 0, spin: 1, length: 0, speed: 1.12, arrows: 0 },
};
const MAX_WEAPON_SPIN = 22;
/** Top speed a knockback or arrow can give (px/s). */
const MAX_HIT_SPEED = 2600;
interface RuleEntry {
  actions: Action[];
  script?: ScriptFn;
  where: string;
}

/** Wrap an angle to (-PI, PI]. */
function wrap(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

const BALL_ACTIONS = new Set(['grow', 'speedUp', 'damage', 'split', 'recolor', 'clone']);

/** Shortest distance between two segments. */
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx;
  const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  const d3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pt = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    let t = l2 ? ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return M.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  };
  return Math.min(pt(ax, ay, cx, cy, dx, dy), pt(bx, by, cx, cy, dx, dy), pt(cx, cy, ax, ay, bx, by), pt(dx, dy, ax, ay, bx, by));
}

/**
 * The deterministic simulation. Same scene + same seed = identical run,
 * step for step. It never reads the clock and only uses seeded randomness.
 */
export class World {
  readonly scene: Scene;
  stepCount = 0;
  balls: Ball[] = [];
  containers: Container[] = [];
  solids: Solid[] = [];
  zones: Zone[] = [];
  portals: Portal[] = [];
  forces: Force[] = [];
  territory: Territory | null = null;
  pendulums: Pendulum[] = [];
  readonly teams: TeamSpec[];
  /** Winning team (oneTeam endings, territory at the end), or ''. */
  winnerTeam = '';
  breaks = 0;
  captures = 0;
  conversions = 0;
  merges = 0;
  swallowed = 0;
  corners = 0;
  /** Every event so far, in order. Consumers keep their own read cursor. */
  events: SimEvent[] = [];
  bounces = 0;
  /** Escape events, including re-escapes after slipping back in. */
  escapes = 0;
  /** Distinct (ball, container) escapes: what an "escaped" counter should show. */
  uniqueEscapes = 0;
  eliminations = 0;
  firstEscapeStep = -1;
  /** Step at which the run's ending happened (escape, last elimination, fill, script end), or -1. The on-screen timer stops here; the tail plays on after it. */
  climaxStep = -1;
  /** Winning ball id (race or battle), or -1. */
  winner = -1;
  done = false;
  endReason = '';
  gx: number;
  gy: number;
  /** First error thrown by a custom rule script (that script is then disabled). */
  scriptError = '';

  private endStep = Infinity;
  private filled = false;
  /** Rhythm lock: seconds of real time per second of song, or 0 when off. (The sound mapper reads it to time the backing track.) */
  rhythmK = 0;
  private nextBallId = 0;
  private startingBalls = 0;
  private readonly rngSpawn: Rng;
  private readonly template: BallSpec;
  private readonly rules: Record<RuleEvent, RuleEntry[]>;
  private readonly timeline: TimelineState[];
  private readonly rngScript: Rng;
  /** Randomness for V2 actions and emitters (its own stream, so V1 runs are unchanged). */
  private readonly rngAct: Rng;
  private readonly damping: number;
  private readonly emitters: Emitter[] = [];
  private readonly teamIndex = new Map<string, number>();
  private readonly scriptState: Record<string, unknown> = {};
  private maxR = 0;
  /** First ball to cross a finish zone, or -1. */
  private finishWinner = -1;
  private readonly hadBreakables: boolean;
  /** Merge / absorb rules on hits act on touch (any speed). */
  private readonly touchMerge: boolean;
  private readonly touchAbsorb: boolean;
  private readonly mergeGrowth: number;
  private readonly mergeMax: number;
  private readonly absorbMax: number;
  /** Safety net: a ball still inside something but this far from the frame's center has slipped out. */
  private farX = WIDTH * 4;
  private farY = HEIGHT * 4;
  /** During a hit's rules: true when the ball the rules run for was the one struck. */
  private defending = true;

  constructor(scene: Scene) {
    this.scene = scene;
    this.rngSpawn = new Rng(scene.seed, 'spawn');
    [this.gx, this.gy] = gravityVec(scene.world.gravity);
    this.rngScript = new Rng(scene.seed, 'script');
    this.rngAct = new Rng(scene.seed, 'act');
    this.damping = scene.world.damping;
    this.teams = scene.teams;
    scene.teams.forEach((t, i) => this.teamIndex.set(t.name, i));
    const rulesFor = (on: RuleEvent): RuleEntry[] =>
      scene.rules
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.on === on)
        .map(({ r, i }) => ({ actions: r.do ?? [], script: r.script ? compileScript(r.script, `rules.${i}`) : undefined, where: `rules.${i}` }));
    this.rules = Object.fromEntries(RULE_EVENTS.map((on) => [on, rulesFor(on)])) as Record<RuleEvent, RuleEntry[]>;
    this.timeline = scene.timeline.map((t, i) => ({
      atStep: t.at !== undefined ? Math.round(t.at * PHYSICS_HZ) : undefined,
      everySteps: t.every !== undefined ? Math.max(1, Math.round(t.every * PHYSICS_HZ)) : undefined,
      startStep: Math.round(t.start * PHYSICS_HZ),
      untilStep: t.until !== undefined ? Math.round(t.until * PHYSICS_HZ) : Infinity,
      actions: t.do ?? [],
      script: t.script ? compileScript(t.script, `timeline.${i}`) : undefined,
      where: `timeline.${i}`,
    }));
    // The clock's rush: escalate through the final stretch so the climax tends to land just before zero.
    const clock = scene.clock;
    if (clock?.rush?.length && clock.final > 0) {
      this.timeline.push({
        atStep: undefined,
        everySteps: Math.max(1, Math.round(clock.rushEvery * PHYSICS_HZ)),
        startStep: Math.round((clock.seconds - clock.final) * PHYSICS_HZ),
        untilStep: Math.round(clock.seconds * PHYSICS_HZ) - 1,
        actions: clock.rush,
        script: undefined,
        where: 'clock.rush',
      });
    }

    for (const e of scene.entities) {
      if (e.type === 'ring') {
        this.containers.push({
          kind: 'ring',
          id: this.containers.length,
          x: e.x,
          y: e.y,
          radius: e.radius,
          thickness: e.thickness,
          angle: e.angle * DEG,
          spin: e.spin * scene.world.spinScale,
          gaps: e.gaps.filter((g) => g.width > 0).map((g) => ({ at: g.at * DEG, width: g.width * DEG })),
          color: e.color ?? scene.style.ringColor,
          deadly: e.deadly,
          hp: e.hp,
          maxHp: e.hp,
          broken: false,
          segments: e.segments ? Array.from({ length: e.segments }, () => e.segmentHp) : undefined,
          segmentHp: e.segmentHp,
          oneWay: e.oneWay,
          repeat: e.repeat,
        });
      } else if (e.type === 'polygon') {
        this.containers.push({
          kind: 'poly',
          id: this.containers.length,
          x: e.x,
          y: e.y,
          radius: e.radius,
          thickness: e.thickness,
          angle: e.angle * DEG,
          spin: e.spin * scene.world.spinScale,
          sides: e.sides,
          open: Array.from({ length: e.sides }, (_, k) => e.open.includes(k)),
          gap: e.gap,
          color: e.color ?? scene.style.ringColor,
          deadly: e.deadly,
          hp: e.hp,
          maxHp: e.hp,
          broken: false,
        });
      } else if (e.type === 'wall' || e.type === 'peg' || e.type === 'brick' || e.type === 'spinner') {
        const base = { id: this.solids.length, color: e.color ?? scene.style.ringColor, alive: true, cx: 0, cy: 0, angle: 0, spin: 0, length: 0, pivotEnd: false, hw: 0, hh: 0, deadly: false, boost: 1 };
        if (e.type === 'wall') this.solids.push({ ...base, kind: 'wall', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, half: e.thickness / 2, deadly: e.deadly, boost: e.boost, hp: e.hp, maxHp: e.hp });
        else if (e.type === 'peg') this.solids.push({ ...base, kind: 'peg', x1: e.x, y1: e.y, x2: e.x, y2: e.y, half: e.radius, deadly: e.deadly, boost: e.boost, hp: e.hp, maxHp: e.hp });
        else if (e.type === 'brick')
          this.solids.push({ ...base, kind: 'brick', x1: e.x, y1: e.y, x2: e.x, y2: e.y, half: 0, cx: e.x, cy: e.y, angle: e.angle * DEG, hw: e.width / 2, hh: e.height / 2, hp: e.hp, maxHp: e.hp, color: e.color ?? scene.style.palette[this.solids.length % scene.style.palette.length] });
        else {
          const s: Solid = { ...base, kind: 'spinner', x1: 0, y1: 0, x2: 0, y2: 0, half: e.width / 2, cx: e.x, cy: e.y, angle: e.angle * DEG, spin: e.spin * scene.world.spinScale, length: e.length, pivotEnd: e.pivot === 'end', deadly: e.deadly };
          this.placeSpinner(s);
          this.solids.push(s);
        }
      } else if (e.type === 'zone') {
        this.zones.push({ id: this.zones.length, x: e.x, y: e.y, width: e.width, height: e.height, label: e.label, count: 0, kill: e.kill, finish: e.finish });
      } else if (e.type === 'portal') {
        this.portals.push({ id: this.portals.length, ax: e.a[0], ay: e.a[1], bx: e.b[0], by: e.b[1], r: e.radius, colorA: e.color ?? '#ff9f1c', colorB: e.color ?? '#4dd4ff' });
      } else if (e.type === 'force') {
        this.forces.push({
          id: this.forces.length,
          kind: e.kind,
          x: e.x,
          y: e.y,
          strength: e.strength,
          dx: M.cos(e.direction * DEG),
          dy: M.sin(e.direction * DEG),
          radius: e.radius,
          swallow: e.swallow,
          inward: e.inward,
          visible: e.visible,
          color: e.color ?? (e.kind === 'attract' ? '#c77dff' : e.kind === 'vortex' ? '#4dd4ff' : '#ffffff'),
          eaten: 0,
        });
      } else if (e.type === 'emitter') {
        this.emitters.push({ spec: e, made: 0, acc: 0, startStep: Math.round(e.start * PHYSICS_HZ) });
      } else if (e.type === 'territory') {
        const n = e.cols * e.rows;
        const owner = new Int16Array(n);
        const k = Math.max(1, scene.teams.length);
        const rng = new Rng(scene.seed, 'territory');
        for (let r = 0; r < e.rows; r++) {
          for (let c = 0; c < e.cols; c++) {
            let t = 0;
            if (e.layout === 'halves') t = Math.min(k - 1, Math.floor((c / e.cols) * Math.min(k, 2)));
            else if (e.layout === 'columns') t = Math.min(k - 1, Math.floor((c / e.cols) * k));
            else if (e.layout === 'stripes') t = Math.min(k - 1, Math.floor((r / e.rows) * k));
            else if (e.layout === 'quadrants') t = ((r < e.rows / 2 ? 0 : 2) + (c < e.cols / 2 ? 0 : 1)) % k;
            else if (e.layout === 'paint') t = -1;
            else t = rng.int(k);
            owner[r * e.cols + c] = t;
          }
        }
        const counts = Array.from({ length: k }, () => 0);
        for (const t of owner) if (t >= 0) counts[t]++;
        this.territory = { x: e.x, y: e.y, cols: e.cols, rows: e.rows, cell: e.cell, owner, counts, paint: e.layout === 'paint' };
      } else if (e.type === 'pendulum') {
        const rainbow = (i: number) => `hsl(${Math.round((i / Math.max(1, e.count)) * 300)}, 95%, 62%)`;
        for (let i = 0; i < e.count; i++) {
          let l1 = e.lengths[0] ?? 230;
          let x = e.x;
          if (e.wave > 0) {
            // Pendulum k swings (waveBase + k) times per wave period: the pattern repeats every `wave` seconds.
            const swings = e.waveBase + (e.count - 1 - i);
            l1 = e.gravity * M.ipow(e.wave / (2 * Math.PI * swings), 2);
            x = e.x + (i - (e.count - 1) / 2) * Math.min(64, 760 / Math.max(1, e.count));
          }
          const last = e.arms === 2 ? 1 : 0;
          const a1 = ((e.angles[0] ?? 120) + (last === 0 ? i * e.spread : 0)) * DEG;
          const a2 = ((e.angles[1] ?? 150) + (last === 1 ? i * e.spread : 0)) * DEG;
          this.pendulums.push({
            id: i,
            x,
            y: e.y,
            arms: e.arms,
            l1,
            l2: e.lengths[1] ?? l1,
            t1: a1,
            t2: a2,
            w1: 0,
            w2: 0,
            g: e.gravity,
            bob: e.bob,
            color: e.colors?.[i % e.colors.length] ?? rainbow(i),
            chime: e.chime,
          });
        }
      }
    }

    const ballSpecs = scene.entities.filter((e): e is BallSpec => e.type === 'ball');
    this.template = ballSpecs[0] ?? { type: 'ball', radius: 22, speed: 800, count: 1 };
    for (const spec of ballSpecs) {
      const cx = spec.x ?? this.containers[0]?.x ?? WIDTH / 2;
      const cy = spec.y ?? this.containers[0]?.y ?? HEIGHT / 2;
      // Grid: a square block centred on (x, y), never overlapping.
      const cols = Math.ceil(Math.sqrt(spec.count));
      const gap = Math.max(spec.radius * 2.6, ((spec.spread ?? 40) * 2) / Math.max(1, cols - 1));
      for (let i = 0; i < spec.count; i++) {
        if (spec.copies > 1) {
          // Butterfly effect: identical copies, each launched a hair apart, that never touch each other.
          const first = this.spawnBall(spec, i, spec.x, spec.y, spec.spread ?? (spec.count > 1 ? 40 : 0));
          if (!first) continue;
          const dir = M.atan2(first.vy, first.vx);
          const speed = M.hypot(first.vx, first.vy) / this.scene.world.speedScale;
          first.group = 0;
          for (let k = 1; k < spec.copies; k++) {
            const c = this.spawnBall(spec, i, first.x, first.y, 0, speed, dir / DEG + k * spec.jitter);
            if (!c) break;
            c.group = k;
            c.color = spec.colors?.[k % spec.colors.length] ?? this.scene.style.palette[k % this.scene.style.palette.length];
          }
          first.color = spec.colors?.[0] ?? this.scene.style.palette[0];
          continue;
        }
        if (spec.arrange === 'grid' && spec.count > 1) {
          const gx = cx + ((i % cols) - (cols - 1) / 2) * gap;
          const gy = cy + (Math.floor(i / cols) - (Math.ceil(spec.count / cols) - 1) / 2) * gap;
          this.spawnBall(spec, i, gx, gy, 0);
        } else this.spawnBall(spec, i, spec.x, spec.y, spec.spread ?? (spec.count > 1 ? 40 : 0));
      }
    }
    this.liftOutOfHoles();
    this.startingBalls = this.balls.length;
    // Ring systems bigger than the frame (thousands of rings) widen the safety net to fit.
    for (const c of this.containers) {
      this.farX = Math.max(this.farX, Math.abs(c.x - WIDTH / 2) + c.radius + c.thickness + 200);
      this.farY = Math.max(this.farY, Math.abs(c.y - HEIGHT / 2) + c.radius + c.thickness + 200);
    }
    this.hadBreakables = this.breakablesLeft > 0;
    const hitActs = scene.rules.filter((r) => r.on === 'hit').flatMap((r) => r.do ?? []);
    const merge = hitActs.find((a) => a.do === 'merge');
    const absorb = hitActs.find((a) => a.do === 'absorb');
    this.touchMerge = !!merge;
    this.touchAbsorb = !!absorb;
    this.mergeGrowth = merge && merge.do === 'merge' ? merge.growth : 1.25;
    this.mergeMax = merge && merge.do === 'merge' ? merge.maxLevel : 10;
    this.absorbMax = absorb && absorb.do === 'absorb' ? absorb.max : 400;

    // Rhythm lock: pick a tempo so the ball keeps roughly its launch speed.
    const nt = scene.audio.noteTimes;
    if (scene.audio.rhythmLock && nt && nt.length > 1 && rhythmLockStatus(scene).ok && this.balls.length === 1 && this.containers[0]) {
      const intervals = nt
        .slice(1)
        .map((t, i) => t - nt[i])
        .filter((d) => d > 1e-6)
        .sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      const b = this.balls[0];
      const speed = Math.max(1, M.hypot(b.vx, b.vy));
      // How long the ball naturally takes to reach the wall at its launch speed.
      const natural = this.ghostTime(b, this.containers[0], b.vx / speed, b.vy / speed, speed, 4);
      // Default tempo: the most common note length plays at about that pace,
      // but never slower than half or faster than double the song's own tempo
      // (beyond that it stops sounding like the song; the ball adapts instead).
      this.rhythmK = scene.audio.tempo ? 1 / scene.audio.tempo : Math.max(0.5, Math.min(2, (Number.isFinite(natural) ? natural : 0.4) / median));
    }
  }

  get time(): number {
    return this.stepCount * DT;
  }

  /** Live balls (arrows don't count). */
  get aliveCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive && !b.projectile) n++;
    return n;
  }

  /** Team index of a team name (-1 if none). */
  teamOf(name: string | undefined): number {
    return name === undefined ? -1 : (this.teamIndex.get(name) ?? -1);
  }

  /** Breakable things still standing: bricks, breakable walls/pegs, ring segments, rings with hp. */
  get breakablesLeft(): number {
    let n = 0;
    for (const s of this.solids) if (s.alive && s.hp !== undefined) n++;
    for (const c of this.containers) {
      if (c.broken) continue;
      if (c.kind === 'ring' && c.segments) for (const h of c.segments) n += h > 0 ? 1 : 0;
      else if (c.hp !== undefined) n++;
    }
    return n;
  }

  /** Advance the world by one fixed physics step (1/240 s). */
  step(): void {
    if (this.done) return;
    // The timed contest holds its deciding frame throughout the result tail.
    if (this.endReason === 'mostTerritory') {
      this.stepCount++;
      this.checkEnd();
      return;
    }
    this.runTimeline();
    for (const c of this.containers) c.angle = wrap(c.angle + c.spin * DT);
    for (const s of this.solids) {
      if (s.kind !== 'spinner') continue;
      s.angle = wrap(s.angle + s.spin * DT);
      this.placeSpinner(s);
    }
    if (this.emitters.length) this.runEmitters();

    // Only balls that existed at the start of the step move this step.
    const n = this.balls.length;
    for (let i = 0; i < n; i++) {
      const b = this.balls[i];
      if (b.alive && !b.frozen) this.integrate(b);
    }
    this.collideBalls();
    this.strikes();
    this.countZones();
    if (this.pendulums.length) this.stepPendulums();

    this.stepCount++;
    this.checkEnd();
  }

  /** Run headless until the scene ends. Returns this world. */
  runToEnd(): this {
    while (!this.done) this.step();
    return this;
  }

  /** FNV-1a hash of the full physical state. Equal hashes = identical runs. */
  hash(): string {
    const values: number[] = [this.stepCount, this.bounces, this.escapes, this.eliminations, this.gx, this.gy];
    for (const b of this.balls) values.push(b.x, b.y, b.vx, b.vy, b.r, b.alive ? 1 : 0, b.hp ?? -1);
    for (const c of this.containers) {
      values.push(c.angle, c.spin);
      if (c.kind === 'ring') for (const g of c.gaps) values.push(g.width);
    }
    for (const z of this.zones) values.push(z.count);
    // V2 state, only when present (so V1 scenes keep their V1 hashes).
    for (const b of this.balls) if (b.team !== undefined || b.level || b.group || b.anchored || b.projectile) values.push(this.teamOf(b.team), b.level, b.group);
    for (const s of this.solids) if (s.hp !== undefined || s.kind === 'spinner') values.push(s.hp ?? 0, s.alive ? 1 : 0, s.angle);
    for (const c of this.containers) {
      if (c.hp !== undefined) values.push(c.hp);
      if (c.broken) values.push(-7);
      if (c.kind === 'ring' && c.segments) values.push(...c.segments);
    }
    if (this.territory) {
      values.push(...this.territory.counts);
      if (this.territory.paint) for (const owner of this.territory.owner) values.push(owner);
    }
    for (const p of this.pendulums) values.push(p.t1, p.t2, p.w1, p.w2);
    for (const f of this.forces) values.push(f.eaten);
    const bytes = new Uint8Array(new Float64Array(values).buffer);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /** World-space corners of a polygon container, as of now. */
  polyVertices(c: PolyContainer): [number, number][] {
    const out: [number, number][] = [];
    for (let k = 0; k < c.sides; k++) {
      const a = c.angle + (k / c.sides) * TAU - Math.PI / 2;
      out.push([c.x + c.radius * M.cos(a), c.y + c.radius * M.sin(a)]);
    }
    return out;
  }

  /** The solid wall segments of a polygon container, as of now: [ax, ay, bx, by]. */
  polySegments(c: PolyContainer): [number, number, number, number][] {
    const v = this.polyVertices(c);
    const out: [number, number, number, number][] = [];
    for (let k = 0; k < c.sides; k++) {
      const [ax, ay] = v[k];
      const [bx, by] = v[(k + 1) % c.sides];
      if (!c.open[k]) {
        out.push([ax, ay, bx, by]);
        continue;
      }
      const len = M.hypot(bx - ax, by - ay);
      if (c.gap === undefined || c.gap >= len) continue; // whole side open
      // Two stubs either side of a centered exit.
      const f = (len - c.gap) / 2 / len;
      out.push([ax, ay, ax + (bx - ax) * f, ay + (by - ay) * f]);
      out.push([bx + (ax - bx) * f, by + (ay - by) * f, bx, by]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------

  /**
   * No ball starts inside a black hole (a ball at the center of a scene that
   * gained one would be eaten on the first step): it moves just outside the
   * event horizon, along its launch direction, and stays inside its container.
   */
  private liftOutOfHoles(): void {
    for (const f of this.forces) {
      if (f.kind !== 'attract' || f.swallow <= 0) continue;
      for (const b of this.balls) {
        const dx = b.x - f.x;
        const dy = b.y - f.y;
        const d = M.hypot(dx, dy);
        if (d >= f.swallow + b.r) continue;
        const s = M.hypot(b.vx, b.vy);
        const [ux, uy] = d > 1e-6 ? [dx / d, dy / d] : s > 0 ? [b.vx / s, b.vy / s] : [0, -1];
        let dist = f.swallow + b.r + 40;
        const c = this.containers[0];
        if (c && M.hypot(b.x - c.x, b.y - c.y) < c.radius) {
          // Room left inside the first container along this direction (it sits on the hole, or close).
          dist = Math.min(dist, c.radius - c.thickness / 2 - b.r - 2 - M.hypot(f.x - c.x, f.y - c.y));
        }
        if (dist <= f.swallow + b.r * 0.5) continue;
        b.x = f.x + ux * dist;
        b.y = f.y + uy * dist;
      }
    }
  }

  private spawnBall(spec: BallSpec, index: number, x?: number, y?: number, spread = 0, speed?: number, direction?: number): Ball | null {
    if (this.aliveCount >= this.scene.world.maxBalls) return null;
    const anchor = this.containers[0];
    const cx = (x ?? anchor?.x ?? WIDTH / 2) + (spread ? this.rngSpawn.range(-spread, spread) : 0);
    const cy = (y ?? anchor?.y ?? HEIGHT / 2) + (spread ? this.rngSpawn.range(-spread, spread) : 0);
    const dirDeg = direction ?? spec.direction;
    const dir = dirDeg !== undefined ? dirDeg * DEG : this.rngSpawn.range(0, TAU);
    const v = (speed ?? spec.speed) * this.scene.world.speedScale;
    const id = this.nextBallId++;
    const palette = this.scene.style.palette;
    const ball: Ball = {
      id,
      x: cx,
      y: cy,
      vx: M.cos(dir) * v,
      vy: M.sin(dir) * v,
      r: spec.radius,
      color: spec.colors?.[index % spec.colors.length] ?? spec.color ?? palette[id % palette.length],
      colorIndex: id % palette.length,
      team: spec.teams?.[index % spec.teams.length] ?? spec.team,
      level: spec.level ?? 0,
      group: 0,
      anchored: false,
      portal: -1,
      label: spec.labels?.[index % spec.labels.length],
      hp: spec.hp,
      maxHp: spec.hp,
      lastDamageStep: -Infinity,
      alive: true,
      frozen: !!spec.frozen,
      image: spec.images?.[index % spec.images.length] ?? spec.image,
      emoji: spec.emojis?.[index % spec.emojis.length] ?? spec.emoji,
      shape: spec.shape ?? 'circle',
      rot: 0,
      // Blades of a group start fanned out evenly, not all pointing the same way.
      weapon: spec.weapon
        ? {
            length: spec.weapon.length,
            width: spec.weapon.width,
            spin: spec.weapon.spin,
            damage: spec.weapon.damage,
            color: spec.weapon.color,
            angle: spec.weapon.angle * DEG + (index * TAU) / Math.max(1, spec.count),
            lastClashStep: -Infinity,
            kind: spec.weapon.kind,
            grow: { ...WEAPON_GROW[spec.weapon.kind], ...spec.weapon.grow },
            hits: 0,
            arrows: 1,
            fireSteps: Math.max(1, Math.round(spec.weapon.fireEvery * PHYSICS_HZ)),
            nextShot: Math.round(spec.weapon.fireEvery * PHYSICS_HZ * 0.5),
            knockback: spec.weapon.knockback * (spec.weapon.kind === 'hammer' ? 1.9 : 1),
          }
        : undefined,
      escaped: this.containers.map((c) => c.broken || M.hypot(cx - c.x, cy - c.y) >= this.innerRadius(c)),
      everEscaped: [],
      inZone: this.zones.map(() => false),
      energy: 0,
    };
    ball.everEscaped = [...ball.escaped];
    // A team ball takes its team's color and emoji unless the spec gives its own.
    const team = ball.team !== undefined ? this.teams[this.teamOf(ball.team)] : undefined;
    if (team) {
      if (team.color && !spec.colors && !spec.color) ball.color = team.color;
      if (team.emoji && !ball.emoji && !ball.image) ball.emoji = team.emoji;
    }
    // Picture reveal: the studio colored each ball by where it lands.
    const reveal = this.scene.style.revealColors?.[id];
    if (reveal) ball.color = reveal;
    if (ball.frozen) {
      ball.vx = 0;
      ball.vy = 0;
    }
    ball.energy = this.energyOf(ball);
    this.maxR = Math.max(this.maxR, ball.r);
    this.balls.push(ball);
    this.emit('spawn', ball);
    return ball;
  }

  private innerRadius(c: Container): number {
    const r = c.kind === 'ring' ? c.radius : c.radius * M.cos(Math.PI / c.sides);
    return r - c.thickness / 2;
  }

  private energyOf(b: Ball): number {
    return 0.5 * (b.vx * b.vx + b.vy * b.vy) - (this.gx * b.x + this.gy * b.y);
  }

  /** Rescale speed so the ball's energy matches its budget (no decay, no blow-up). */
  private restoreEnergy(b: Ball): void {
    if (!this.scene.world.keepEnergy) return;
    const target2 = 2 * (b.energy + this.gx * b.x + this.gy * b.y);
    const s = M.hypot(b.vx, b.vy);
    if (target2 > 0 && s > 1e-6) {
      const k = Math.sqrt(target2) / s;
      b.vx *= k;
      b.vy *= k;
    }
  }

  private integrate(b: Ball): void {
    // Substep so a ball never moves more than ~30% of its radius per substep:
    // thin walls can't be tunneled through.
    const gmag = M.hypot(this.gx, this.gy);
    const travel = (M.hypot(b.vx, b.vy) + gmag * DT) * DT;
    const n = Math.min(32, Math.max(1, Math.ceil(travel / (0.3 * b.r))));
    const h = DT / n;
    const e = this.scene.world.restitution;
    if (b.shape !== 'circle' || b.image || b.emoji) b.rot += (b.vx / b.r) * DT * 0.6;
    for (let k = 0; k < n && b.alive; k++) {
      b.vx += this.gx * h;
      b.vy += this.gy * h;
      if (this.damping > 0) {
        const k = M.exp(-this.damping * h);
        b.vx *= k;
        b.vy *= k;
      }
      if (this.forces.length) {
        this.applyForces(b, h);
        if (!b.alive) break;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      // Rings far from the ball are skipped without a call (thousands of nested rings):
      // only when the collision code would have returned straight away, so runs are unchanged.
      let cx = NaN;
      let cy = NaN;
      let cd = 0;
      for (let i = 0; i < this.containers.length && b.alive; i++) {
        const c = this.containers[i];
        if (c.broken) continue;
        if (c.kind === 'ring') {
          if (c.x !== cx || c.y !== cy) {
            cx = c.x;
            cy = c.y;
            cd = M.hypot(b.x - cx, b.y - cy);
          }
          const half = c.thickness / 2;
          if (!b.escaped[i]) {
            if (cd + b.r + 1 < c.radius - half) continue;
            this.collideRing(b, c, i);
          } else {
            if (cd - b.r - 1 > c.radius + half) continue;
            this.collideRingOutside(b, c, i);
          }
          // A collision moves the ball: measure again for the next ring.
          cx = NaN;
        } else this.collidePoly(b, c, i);
      }
      for (const s of this.solids) {
        if (!s.alive || !b.alive) continue;
        let hit: number;
        if (s.kind === 'brick') hit = this.collideBox(b, s, e);
        else if (s.kind === 'spinner') hit = this.collideCapsule(b, s.x1, s.y1, s.x2, s.y2, s.half, s.cx, s.cy, s.spin, e);
        else hit = this.collideCapsule(b, s.x1, s.y1, s.x2, s.y2, s.half, 0, 0, 0, e);
        if (hit > 0) this.onBounce(b, null, s.id, hit);
      }
      if (this.portals.length && b.alive) this.checkPortals(b);
      if (this.territory && b.team !== undefined && b.alive) this.collideTerritory(b);
    }
    if (b.alive && b.escaped.every(Boolean)) {
      // Out of everything: gone once off-screen (or, past a ring system far bigger than the frame, well beyond it).
      const m = b.r + 60;
      const huge = this.farX > WIDTH * 4;
      if (huge ? Math.abs(b.x - WIDTH / 2) > this.farX + 8000 || Math.abs(b.y - HEIGHT / 2) > this.farY + 8000 : b.y - m > HEIGHT || b.y + m < -HEIGHT || b.x + m < 0 || b.x - m > WIDTH) {
        b.alive = false;
        this.emit('exit', b);
      }
    } else if (b.alive && (Math.abs(b.x - WIDTH / 2) > this.farX || Math.abs(b.y - HEIGHT / 2) > this.farY)) {
      // Safety net: a ball this far off-screen has slipped out of everything; let it go.
      b.alive = false;
      this.emit('exit', b);
    }
  }

  /** The gap theta falls in (with repeat > 1: a copy of it, centered on the repeat theta is in), or null. */
  private gapAt(ring: RingContainer, theta: number): Gap | null {
    if (ring.repeat > 1) {
      const period = TAU / ring.repeat;
      for (const gap of ring.gaps) {
        const d = theta - gap.at;
        const k = Math.floor(d / period + 0.5);
        if (Math.abs(d - k * period) < gap.width / 2) return { at: gap.at + k * period, width: gap.width };
      }
      return null;
    }
    for (const gap of ring.gaps) {
      if (Math.abs(wrap(theta - gap.at)) < gap.width / 2) return gap;
    }
    return null;
  }

  private collideRing(b: Ball, ring: RingContainer, idx: number): void {
    const dx = b.x - ring.x;
    const dy = b.y - ring.y;
    const d = M.hypot(dx, dy) || 1e-9;
    const half = ring.thickness / 2;
    const inner = ring.radius - half;
    const outer = ring.radius + half;
    if (d + b.r < inner) return; // not touching the wall

    const theta = M.atan2(dy, dx) - ring.angle;
    const gap = this.gapAt(ring, theta);
    if (gap) {
      if (d - b.r > outer) {
        this.escape(b, ring, idx);
        return;
      }
      // Passing through the gap: the gap's two edges are rounded caps.
      this.collideCap(b, ring, gap.at - gap.width / 2, false);
      this.collideCap(b, ring, gap.at + gap.width / 2, false);
      return;
    }
    if (ring.segments && ring.segments[this.segmentAt(ring, theta)] <= 0) {
      // A broken segment is an opening without rounded edges.
      if (d - b.r > outer) this.escape(b, ring, idx);
      return;
    }

    const nx = dx / d;
    const ny = dy / d;
    const e = this.scene.world.restitution;
    if (d >= ring.radius) {
      // Mostly through the wall (the gap rotated away mid-exit): finish the exit.
      b.x = ring.x + nx * (outer + b.r);
      b.y = ring.y + ny * (outer + b.r);
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
      }
      this.escape(b, ring, idx);
      return;
    }

    b.x = ring.x + nx * (inner - b.r);
    b.y = ring.y + ny * (inner - b.r);
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      this.onBounce(b, ring, -1, vn);
    }
  }

  /** An escaped ball bounces softly off a ring's outside, and is recaptured if it slips back in. */
  private collideRingOutside(b: Ball, ring: RingContainer, idx: number): void {
    const dx = b.x - ring.x;
    const dy = b.y - ring.y;
    const d = M.hypot(dx, dy) || 1e-9;
    const half = ring.thickness / 2;
    const outer = ring.radius + half;
    if (d - b.r > outer) return;
    const theta = M.atan2(dy, dx) - ring.angle;
    if (ring.oneWay) {
      // The way back is shut: the outside is a solid wall, gaps and all.
      this.pushOutside(b, ring, d, dx, dy);
      return;
    }
    if (ring.segments && ring.segments[this.segmentAt(ring, theta)] <= 0) {
      if (d + b.r < ring.radius - half) b.escaped[idx] = false;
      return;
    }
    const gap = this.gapAt(ring, theta);
    if (gap) {
      if (d + b.r < ring.radius - half) b.escaped[idx] = false;
      else {
        this.collideCap(b, ring, gap.at - gap.width / 2, true);
        this.collideCap(b, ring, gap.at + gap.width / 2, true);
      }
      return;
    }
    if (d < ring.radius) {
      b.escaped[idx] = false;
      return;
    }
    const nx = dx / d;
    const ny = dy / d;
    b.x = ring.x + nx * (outer + b.r);
    b.y = ring.y + ny * (outer + b.r);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const e = 0.6 * this.scene.world.restitution;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
    }
  }

  /** Rest an escaped ball against a ring's outer face (a soft bounce). */
  private pushOutside(b: Ball, ring: RingContainer, d: number, dx: number, dy: number): void {
    const nx = dx / d;
    const ny = dy / d;
    b.x = ring.x + nx * (ring.radius + ring.thickness / 2 + b.r);
    b.y = ring.y + ny * (ring.radius + ring.thickness / 2 + b.r);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const e = 0.6 * this.scene.world.restitution;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
    }
  }

  private collideCap(b: Ball, ring: RingContainer, edge: number, silent: boolean): void {
    const a = ring.angle + edge;
    const px = ring.x + ring.radius * M.cos(a);
    const py = ring.y + ring.radius * M.sin(a);
    const e = this.scene.world.restitution * (silent ? 0.6 : 1);
    const hit = this.collideCapsule(b, px, py, px, py, ring.thickness / 2, ring.x, ring.y, ring.spin, e);
    if (hit > 0 && !silent) this.onBounce(b, ring, -1, hit);
  }

  /** Polygon sides are two-sided capsules; escape = fully outside the corner circle. */
  private collidePoly(b: Ball, c: PolyContainer, idx: number): void {
    const d = M.hypot(b.x - c.x, b.y - c.y);
    const half = c.thickness / 2;
    if (d - b.r > c.radius + half) {
      if (!b.escaped[idx]) this.escape(b, c, idx);
      return;
    }
    if (b.escaped[idx] && d + b.r < this.innerRadius(c)) b.escaped[idx] = false;
    const silent = b.escaped[idx];
    const e = this.scene.world.restitution * (silent ? 0.6 : 1);
    for (const [ax, ay, bx, by] of this.polySegments(c)) {
      const hit = this.collideCapsule(b, ax, ay, bx, by, half, c.x, c.y, c.spin, e);
      if (hit > 0 && !silent) this.onBounce(b, c, -1, hit);
    }
  }

  /**
   * Ball vs. a capsule (segment with rounded ends) that may be spinning about
   * (cx, cy). Pushes the ball out and reflects it. Returns the impact speed, or 0.
   */
  private collideCapsule(b: Ball, ax: number, ay: number, bx: number, by: number, half: number, cx: number, cy: number, spin: number, e: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((b.x - ax) * abx + (b.y - ay) * aby) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * abx;
    const py = ay + t * aby;
    const dx = b.x - px;
    const dy = b.y - py;
    const min = b.r + half;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 < 1e-18) return 0;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    b.x = px + nx * min;
    b.y = py + ny * min;
    const wvx = -spin * (py - cy);
    const wvy = spin * (px - cx);
    const vn = (b.vx - wvx) * nx + (b.vy - wvy) * ny;
    if (vn >= 0) return 0;
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    const mu = this.scene.world.friction;
    if (mu > 0) {
      // Damp the sliding (tangential) part of the velocity, in the wall's frame.
      const tx = -ny;
      const ty = nx;
      const vt = (b.vx - wvx) * tx + (b.vy - wvy) * ty;
      b.vx -= mu * vt * tx;
      b.vy -= mu * vt * ty;
    }
    return -vn;
  }

  private collideBalls(): void {
    const balls = this.balls;
    // Layer = how many containers a ball has escaped; only same-layer balls touch.
    const layer = new Int32Array(balls.length);
    for (let i = 0; i < balls.length; i++) {
      let n = 0;
      for (const v of balls[i].escaped) if (v) n++;
      layer[i] = n;
    }
    if (balls.length <= HASH_THRESHOLD) {
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < balls.length && a.alive; j++) if (layer[i] === layer[j] && a.group === balls[j].group) this.collidePair(a, balls[j]);
      }
      return;
    }
    // Large crowds: a uniform grid; each ball tests the 9 cells around it, in a
    // fixed order, against balls with a higher index (deterministic).
    const cell = Math.max(8, 2 * this.maxR + 2);
    const grid = new Map<number, number[]>();
    const cx = new Int32Array(balls.length);
    const cy = new Int32Array(balls.length);
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.alive) continue;
      cx[i] = Math.floor(b.x / cell);
      cy[i] = Math.floor(b.y / cell);
      const k = cx[i] * 100003 + cy[i];
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.alive) continue;
      for (let dx = -1; dx <= 1 && a.alive; dx++) {
        for (let dy = -1; dy <= 1 && a.alive; dy++) {
          const list = grid.get((cx[i] + dx) * 100003 + cy[i] + dy);
          if (!list) continue;
          for (const j of list) if (j > i && layer[i] === layer[j] && a.alive && a.group === balls[j].group) this.collidePair(a, balls[j]);
        }
      }
    }
  }

  private collidePair(a: Ball, b: Ball): void {
    if (!b.alive || (a.frozen && b.frozen)) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rr = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) return;
    if (a.projectile || b.projectile) {
      this.arrowHit(a.projectile ? a : b, a.projectile ? b : a);
      return;
    }
    if (a.anchored || b.anchored) {
      if (!(a.anchored && b.anchored)) this.collideAnchored(a.anchored ? a : b, a.anchored ? b : a);
      return;
    }
    // Contact mechanics: merge (same level) and absorb happen on touch, at any speed.
    if (this.touchMerge && a.level === b.level && !a.frozen && !b.frozen) {
      this.mergeBalls(a, b);
      return;
    }
    if (this.touchAbsorb && !a.frozen && !b.frozen) {
      const big = a.r > b.r || (a.r === b.r && a.id < b.id) ? a : b;
      this.absorbBall(big, big === a ? b : a);
      return;
    }
    const e = this.scene.world.restitution;
    // A moving ball wakes a frozen one on a real impact; the frozen one then
    // takes part normally. (A graze or a resting touch doesn't wake it.)
    let woke: Ball | null = a.frozen ? a : b.frozen ? b : null;
    const waker = woke === a ? b : woke === b ? a : null;
    if (woke) {
      const closing = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
      if (closing / Math.sqrt(d2) > -HIT_THRESHOLD) return;
      woke.frozen = false;
    }
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const ma = a.r * a.r;
    const mb = b.r * b.r;
    const overlap = rr - d;
    a.x -= (nx * overlap * mb) / (ma + mb);
    a.y -= (ny * overlap * mb) / (ma + mb);
    b.x += (nx * overlap * ma) / (ma + mb);
    b.y += (ny * overlap * ma) / (ma + mb);
    const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    // Who was charging whom: each ball's speed toward the other, before the impact.
    const aIn = a.vx * nx + a.vy * ny;
    const bIn = -(b.vx * nx + b.vy * ny);
    if (rvn < 0) {
      const imp = (-(1 + e) * rvn) / (1 / ma + 1 / mb);
      a.vx -= (imp * nx) / ma;
      a.vy -= (imp * ny) / ma;
      b.vx += (imp * nx) / mb;
      b.vy += (imp * ny) / mb;
      for (const x of [a, b]) {
        if (x === woke) x.energy = this.energyOf(x); // its energy budget starts now
        else this.restoreEnergy(x);
      }
      if (woke && waker) {
        this.emit('wake', woke, -1, -1, -1, -rvn);
        this.runRules('wake', woke, null, -rvn, waker);
      }
      if (-rvn > (this.scene.world.keepEnergy ? HIT_THRESHOLD : SETTLE_THRESHOLD * 2)) {
        this.emit('hit', a, -1, -1, -1, -rvn, (a.x + b.x) / 2, (a.y + b.y) / 2);
        // Unarmed fighters: the one charging in lands the punch.
        if (a.weapon?.kind === 'unarmed' && aIn > bIn && a.team !== b.team) this.punch(a, b);
        else if (b.weapon?.kind === 'unarmed' && bIn > aIn && a.team !== b.team) this.punch(b, a);
        this.defending = aIn < bIn;
        this.runRules('hit', a, null, -rvn, b);
        this.defending = bIn < aIn;
        this.runRules('hit', b, null, -rvn, a);
        this.defending = true;
      }
    }
  }

  /** Spinning weapons: strike other balls, and clash (both reverse) when two blades cross. */
  private strikes(): void {
    const armed = this.balls.filter((b) => b.alive && b.weapon && b.weapon.kind !== 'unarmed' && !b.projectile);
    if (!armed.length) return;
    for (const a of armed) if (a.weapon!.kind === 'bow' && this.stepCount >= a.weapon!.nextShot) this.fireArrows(a);
    const e = this.scene.world.restitution;
    for (const a of armed) a.weapon!.angle = wrap(a.weapon!.angle + a.weapon!.spin * DT);
    const blade = (a: Ball): [number, number, number, number] => {
      const w = a.weapon!;
      const ca = M.cos(w.angle);
      const sa = M.sin(w.angle);
      return [a.x + ca * a.r, a.y + sa * a.r, a.x + ca * (a.r + w.length), a.y + sa * (a.r + w.length)];
    };
    // Clashes.
    for (let i = 0; i < armed.length; i++) {
      for (let j = i + 1; j < armed.length; j++) {
        const a = armed[i];
        const b = armed[j];
        const wa = a.weapon!;
        const wb = b.weapon!;
        if (this.stepCount - Math.max(wa.lastClashStep, wb.lastClashStep) < DAMAGE_COOLDOWN) continue;
        const [ax1, ay1, ax2, ay2] = blade(a);
        const [bx1, by1, bx2, by2] = blade(b);
        if (segmentDistance(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) < (wa.width + wb.width) / 2) {
          wa.spin = -wa.spin;
          wb.spin = -wb.spin;
          wa.lastClashStep = wb.lastClashStep = this.stepCount;
          this.emit('clash', a, -1, -1, -1, 1000, (ax2 + bx2) / 2, (ay2 + by2) / 2);
        }
      }
    }
    // Strikes.
    for (const a of armed) {
      if (!a.alive) continue;
      const w = a.weapon!;
      const [x1, y1, x2, y2] = blade(a);
      const layerA = a.escaped.reduce((n, v) => n + (v ? 1 : 0), 0);
      if (w.kind === 'bow') continue; // a bow only shoots
      for (const b of this.balls) {
        if (b === a || !b.alive || b.group !== a.group) continue;
        if (a.team !== undefined && a.team === b.team) continue;
        if (b.projectile && b.projectile.owner === a.id) continue;
        if (b.escaped.reduce((n, v) => n + (v ? 1 : 0), 0) !== layerA) continue;
        const abx = x2 - x1;
        const aby = y2 - y1;
        let t = ((b.x - x1) * abx + (b.y - y1) * aby) / (abx * abx + aby * aby);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x1 + t * abx;
        const py = y1 + t * aby;
        const dx = b.x - px;
        const dy = b.y - py;
        const min = b.r + w.width / 2;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-12) continue;
        if (b.projectile) {
          // Parried: the blade knocks the arrow out of the air.
          b.alive = false;
          this.emit('clash', a, -1, -1, -1, 800, px, py);
          continue;
        }
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        b.x = px + nx * min;
        b.y = py + ny * min;
        if (b.frozen) {
          b.frozen = false;
          b.energy = 0;
        }
        // The blade point moves with the ball and its rotation.
        const arm = a.r + t * w.length;
        const pvx = a.vx - w.spin * arm * M.sin(w.angle);
        const pvy = a.vy + w.spin * arm * M.cos(w.angle);
        const vn = (b.vx - pvx) * nx + (b.vy - pvy) * ny;
        if (vn < 0) {
          b.vx -= (1 + e) * vn * nx * w.knockback;
          b.vy -= (1 + e) * vn * ny * w.knockback;
          if (w.knockback !== 1) {
            // A heavy hit sets a new pace, but never beyond a sane top speed.
            this.capSpeed(b, MAX_HIT_SPEED);
            b.energy = this.energyOf(b);
          } else if (b.energy === 0) b.energy = this.energyOf(b);
          else this.restoreEnergy(b);
        }
        if (this.stepCount - b.lastDamageStep >= DAMAGE_COOLDOWN) {
          this.emit('strike', a, -1, -1, -1, Math.abs(vn), px, py);
          if (w.damage > 0) this.damage(b, w.damage, true);
          this.powerUp(a);
          this.runRules('strike', a, null, Math.abs(vn), b);
          if (b.hp === undefined) b.lastDamageStep = this.stepCount; // still rate-limit strike events
        }
      }
    }
  }

  private countZones(): void {
    if (!this.zones.length) return;
    for (const b of this.balls) {
      if (!b.alive) continue;
      for (const z of this.zones) {
        if (b.inZone[z.id]) continue;
        if (b.x >= z.x && b.x <= z.x + z.width && b.y >= z.y && b.y <= z.y + z.height) {
          b.inZone[z.id] = true;
          z.count++;
          this.emit('zone', b, -1, -1, z.id);
          if (z.finish && !b.projectile) {
            this.emit('finish', b, -1, -1, z.id);
            if (this.finishWinner < 0) this.finishWinner = b.id;
            this.runRules('finish', b, null, 0, null);
          }
          if (z.kill) {
            this.swallowBall(b, null);
            break;
          }
        }
      }
    }
  }

  private onBounce(b: Ball, c: Container | null, solid: number, strength: number): void {
    // Arrows break on any wall.
    if (b.projectile) {
      b.alive = false;
      return;
    }
    const s = solid >= 0 ? this.solids[solid] : null;
    if ((c?.deadly || s?.deadly) && !(this.scene.duration.endOn === 'lastStanding' && this.aliveCount <= 1)) {
      this.emit('bounce', b, c ? c.id : -1, solid, -1, strength);
      b.hp = 0;
      this.eliminate(b);
      return;
    }
    this.restoreEnergy(b);
    if (s && s.boost !== 1) {
      // Bumper: a harder kick out (energy re-based so it sticks).
      const sp = M.hypot(b.vx, b.vy);
      const k = Math.min(3500, sp * s.boost) / Math.max(1e-6, sp);
      b.vx *= k;
      b.vy *= k;
      b.energy = this.energyOf(b);
    }
    // Settling scenes (no energy keeping) have balls resting in piles: only real
    // impacts count as bounces, or every jostle would become an event and a note.
    if (strength < (this.scene.world.keepEnergy ? BOUNCE_THRESHOLD : SETTLE_THRESHOLD)) return;
    this.bounces++;
    this.emit('bounce', b, c ? c.id : -1, solid, -1, strength);
    this.events[this.events.length - 1].n = b.r; // the sound can follow the ball's size
    if (c && c.kind === 'poly') this.checkCorner(b, c);
    this.runRules('bounce', b, c, strength, null);
    if (this.rhythmK > 0) this.lockToRhythm(b, this.bounces - 1);
    if (c) this.hitContainer(b, c);
    if (s && s.hp !== undefined) this.hitSolid(b, s);
  }

  /**
   * Rhythm lock: the bounce that just happened played note `i`. Set the ball's
   * speed so its straight-line path reaches the ring wall exactly when note
   * i+1 is due (the song loops). Exact with zero gravity and a circular wall.
   */
  private lockToRhythm(b: Ball, i: number): void {
    const nt = this.scene.audio.noteTimes!;
    const c = this.containers.find((_, k) => !b.escaped[k]);
    if (!c || this.aliveCount !== 1) return;
    const songLength = songLoopLength(nt);
    let dt = 0;
    for (let j = i; dt < 1e-6 && j < i + nt.length; j++) {
      const a = nt[j % nt.length] + Math.floor(j / nt.length) * songLength;
      const z = nt[(j + 1) % nt.length] + Math.floor((j + 1) / nt.length) * songLength;
      dt = z - a;
    }
    const s0 = M.hypot(b.vx, b.vy);
    if (s0 < 1e-6 || dt < 1e-6) return;
    const ux = b.vx / s0;
    const uy = b.vy / s0;
    const want = dt * this.rhythmK;
    let speed: number;
    if (this.gx === 0 && this.gy === 0 && c.kind === 'ring') {
      // Straight line to a circle: exact.
      const px = b.x - c.x;
      const py = b.y - c.y;
      const R = this.innerRadius(c) - b.r;
      const pu = px * ux + py * uy;
      const disc = pu * pu - (px * px + py * py - R * R);
      if (disc < 0) return;
      speed = (-pu + Math.sqrt(disc)) / want;
    } else {
      // Gravity or a polygon: fly the ball's own path ahead at a spread of
      // speeds. Flight time isn't monotonic in speed under gravity (launched
      // upward, faster = a longer arc), so find every speed whose next wall hit
      // lands on the note, and take the one closest to the current speed.
      const limit = Math.min(4, want * 2.5 + 0.3);
      const N = 24;
      const speeds: number[] = [];
      const err: number[] = [];
      for (let k = 0; k < N; k++) {
        const s = RHYTHM_MIN_SPEED * M.pow(RHYTHM_MAX_SPEED / RHYTHM_MIN_SPEED, k / (N - 1));
        speeds.push(s);
        err.push(this.ghostTime(b, c, ux, uy, s, limit) - want);
      }
      let best = -1;
      let bestCost = Infinity;
      for (let k = 0; k < N - 1; k++) {
        if (!Number.isFinite(err[k]) || !Number.isFinite(err[k + 1]) || err[k] * err[k + 1] > 0) continue;
        // Bracketed: refine by bisection on the sign of the error.
        let lo = speeds[k];
        let hi = speeds[k + 1];
        const loSign = Math.sign(err[k]);
        for (let it = 0; it < 8; it++) {
          const mid = Math.sqrt(lo * hi);
          if (Math.sign(this.ghostTime(b, c, ux, uy, mid, limit) - want) === loSign) lo = mid;
          else hi = mid;
        }
        const root = Math.sqrt(lo * hi);
        const cost = Math.abs(M.log(root / s0));
        if (cost < bestCost) {
          bestCost = cost;
          best = root;
        }
      }
      if (best < 0) {
        // No exact solution: the closest arrival time wins.
        let k0 = 0;
        for (let k = 1; k < N; k++) if (Math.abs(err[k]) < Math.abs(err[k0])) k0 = k;
        best = speeds[k0];
      }
      speed = best;
    }
    speed = Math.max(RHYTHM_MIN_SPEED, Math.min(RHYTHM_MAX_SPEED, speed));
    b.vx = ux * speed;
    b.vy = uy * speed;
    b.energy = this.energyOf(b);
  }

  /**
   * Seconds until a ball launched from where it is now, in direction (ux, uy)
   * at `speed`, next touches the container wall, under current gravity and
   * the container's rotation (gaps ignored). Infinity if not within `limit`.
   */
  private ghostTime(b: Ball, c: Container, ux: number, uy: number, speed: number, limit: number): number {
    const h = DT;
    let x = b.x;
    let y = b.y;
    let vx = ux * speed;
    let vy = uy * speed;
    const half = c.thickness / 2;
    const inner = this.innerRadius(c);
    // Ignore the wall we're touching right now: wait until we've left it.
    let left = false;
    for (let t = h; t <= limit; t += h) {
      vx += this.gx * h;
      vy += this.gy * h;
      x += vx * h;
      y += vy * h;
      let touching: boolean;
      if (c.kind === 'ring') touching = M.hypot(x - c.x, y - c.y) + b.r >= inner;
      else {
        const ang = c.angle + c.spin * t;
        touching = false;
        for (let k = 0; k < c.sides && !touching; k++) {
          const a1 = ang + (k / c.sides) * TAU - Math.PI / 2;
          const a2 = ang + ((k + 1) / c.sides) * TAU - Math.PI / 2;
          const ax = c.x + c.radius * M.cos(a1);
          const ay = c.y + c.radius * M.sin(a1);
          const bx = c.x + c.radius * M.cos(a2);
          const by = c.y + c.radius * M.sin(a2);
          const abx = bx - ax;
          const aby = by - ay;
          let u = ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby);
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          touching = M.hypot(x - (ax + u * abx), y - (ay + u * aby)) <= b.r + half;
        }
      }
      if (!touching) left = true;
      else if (left) return t;
    }
    return Infinity;
  }

  private escape(b: Ball, c: Container, idx: number): void {
    if (b.escaped[idx]) return;
    b.escaped[idx] = true;
    this.escapes++;
    if (!b.everEscaped[idx]) {
      b.everEscaped[idx] = true;
      this.uniqueEscapes++;
    }
    if (this.firstEscapeStep < 0) {
      this.firstEscapeStep = this.stepCount;
      // Only a race (several balls at the start) has a winner worth announcing.
      if (this.scene.duration.endOn === 'firstEscape' && this.startingBalls > 1) this.winner = b.id;
    }
    this.emit('escape', b, idx, -1, -1, M.hypot(b.vx, b.vy));
    this.runRules('escape', b, c, 0, null);
  }

  /** Take hp (respecting the damage cooldown) and eliminate at zero. */
  private damage(b: Ball, amount: number, force: boolean): void {
    if (!b.alive || b.hp === undefined) return;
    if (!force && this.stepCount - b.lastDamageStep < DAMAGE_COOLDOWN) return;
    b.lastDamageStep = this.stepCount;
    b.hp -= amount;
    if (b.hp <= 1e-9) {
      // In a last-standing battle the final ball always survives, even
      // when the last two knock each other out in the same hit.
      if (this.scene.duration.endOn === 'lastStanding' && this.aliveCount <= 1) b.hp = Math.min(b.maxHp ?? 1, 0.5);
      else {
        b.hp = 0;
        this.eliminate(b);
      }
    }
  }

  private eliminate(b: Ball): void {
    if (!b.alive) return;
    b.alive = false;
    this.eliminations++;
    this.emit('eliminate', b);
    this.runRules('eliminate', b, null, 0, null);
  }

  private runTimeline(): void {
    const s = this.stepCount;
    for (const t of this.timeline) {
      const fire = t.atStep !== undefined ? s === t.atStep : s >= t.startStep && s <= t.untilStep && (s - t.startStep) % t.everySteps! === 0;
      if (!fire) continue;
      const ballActions = t.actions.filter((a) => BALL_ACTIONS.has(a.do));
      const worldActions = t.actions.filter((a) => !BALL_ACTIONS.has(a.do));
      if (ballActions.length) {
        for (const b of this.balls.slice()) if (b.alive) this.applyActions(ballActions, b, null, 0);
      }
      if (worldActions.length) this.applyActions(worldActions, null, null, 0);
      if (t.script) this.runScript(t, 'timeline', null, null, 0, null);
    }
  }

  private runRules(on: RuleEvent, b: Ball, c: Container | null, impact: number, other: Ball | null): void {
    for (const r of this.rules[on]) {
      if (r.actions.length) this.applyActions(r.actions, b, c, impact, other);
      if (r.script) this.runScript(r, on, b, c, impact, other);
    }
  }

  private runScript(owner: { script?: ScriptFn; where: string }, event: string, b: Ball | null, c: Container | null, impact: number, other: Ball | null): void {
    const fn = owner.script;
    if (!fn) return;
    const world = this;
    const ctx: ScriptContext = {
      event,
      time: this.time,
      ball: b,
      other,
      container: c,
      state: this.scriptState,
      rng: { next: () => this.rngScript.next(), range: (a, z) => this.rngScript.range(a, z), int: (n) => this.rngScript.int(n) },
      world: {
        balls: () => world.balls.filter((x) => x.alive),
        spawn: (o = {}) => {
          const spec: BallSpec = { ...world.template, labels: undefined, colors: undefined, color: o.color, radius: o.radius ?? world.template.radius };
          return world.spawnBall(spec, 0, o.x, o.y, o.spread ?? 0, o.speed, o.direction);
        },
        do: (action) => {
          const parsed = ActionSchema.safeParse(action);
          if (!parsed.success) throw new Error(`world.do: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
          world.applyActions([parsed.data], b, c, impact, other);
        },
        gravity: (x, y) => {
          world.gx = x;
          world.gy = y;
          world.gravityChanged();
        },
        end: () => world.endNow('script'),
        get time() {
          return world.time;
        },
        get bounces() {
          return world.bounces;
        },
      },
    };
    try {
      fn(ctx);
      // Scripts may set velocities directly: re-base energy budgets so the
      // change sticks (and frozen balls stay still).
      for (const x of [b, other]) {
        if (!x) continue;
        if (x.frozen) {
          x.vx = 0;
          x.vy = 0;
        }
        x.energy = this.energyOf(x);
      }
    } catch (err) {
      if (!this.scriptError) this.scriptError = `${owner.where}: ${(err as Error).message}`;
      owner.script = undefined; // a broken script is switched off, not retried every event
    }
  }

  /**
   * Apply actions. `b` is the ball the event happened to (null for timeline
   * world actions); `c` is the container involved (null = all containers).
   */
  private applyActions(actions: Action[], b: Ball | null, c: Container | null, impact: number, other: Ball | null = null): void {
    const targets = c ? [c] : this.containers;
    for (const act of actions) {
      switch (act.do) {
        case 'grow': {
          if (!b || !b.alive) break;
          // Never grow past 92% of the innermost container still holding the ball.
          let cap = act.max;
          this.containers.forEach((k, i) => {
            if (!b.escaped[i]) cap = Math.min(cap, this.innerRadius(k) * 0.92);
          });
          b.r = Math.max(act.min, Math.min(cap, b.r + act.amount));
          if (b.r >= cap - 1e-9) this.filled = true;
          break;
        }
        case 'shrinkGap':
          for (const k of targets) {
            if (k.kind === 'ring') for (const gap of k.gaps) gap.width = Math.max(act.min * DEG, gap.width - act.amount * DEG);
          }
          break;
        case 'speedUp': {
          if (!b || !b.alive) break;
          const s = M.hypot(b.vx, b.vy);
          if (s > 1e-6) {
            const k = Math.min(act.max, s * act.factor) / s;
            b.vx *= k;
            b.vy *= k;
          }
          b.energy = this.energyOf(b);
          break;
        }
        case 'spawn': {
          const at = c ?? this.containers[0];
          const x = act.x ?? at?.x ?? WIDTH / 2;
          const y = act.y ?? at?.y ?? 300;
          const spec: BallSpec = { ...this.template, labels: undefined, colors: undefined, color: undefined };
          for (let i = 0; i < act.count; i++) this.spawnBall(spec, 0, x, y, act.spread, act.speed, act.direction);
          break;
        }
        case 'damage':
          if (b && (act.when === 'always' || this.defending)) this.damage(b, act.amount + (act.perSpeed * impact) / 1000, false);
          break;
        case 'setGravity':
          [this.gx, this.gy] = gravityVec(act.gravity);
          this.gravityChanged();
          break;
        case 'flipGravity':
          this.gx = -this.gx;
          this.gy = -this.gy;
          this.gravityChanged();
          break;
        case 'rotateGravity': {
          const a = act.degrees * DEG;
          const ca = M.cos(a);
          const sa = M.sin(a);
          [this.gx, this.gy] = [this.gx * ca - this.gy * sa, this.gx * sa + this.gy * ca];
          this.gravityChanged();
          break;
        }
        case 'spinUp':
          for (const k of targets) k.spin = Math.sign(k.spin || 1) * Math.min(act.max, Math.abs(k.spin) * act.factor);
          break;
        case 'reverseSpin':
          for (const k of targets) k.spin = -k.spin;
          break;
        case 'split':
          if (b && b.alive && !b.projectile) this.splitBall(b, act.min, act.angle * DEG, act.recolor);
          break;
        case 'absorb':
          if (b && other && b.alive && other.alive && (b.r > other.r || (b.r === other.r && b.id < other.id))) this.absorbBall(b, other, act.max);
          break;
        case 'merge':
          if (b && other && b.alive && other.alive && b.level === other.level && b.level < act.maxLevel) this.mergeBalls(b, other, act.growth);
          break;
        case 'convert':
          if (b && other && b.alive && other.alive && b.team !== undefined && other.team !== b.team) {
            const mine = this.teams[this.teamOf(b.team)];
            const wins = act.mode === 'always' || (mine && other.team !== undefined && mine.beats.includes(other.team));
            if (wins && (act.chance >= 1 || this.rngAct.next() < act.chance)) this.convertBall(other, b.team, b);
          }
          break;
        case 'clone':
          if (b && b.alive && !b.projectile) this.cloneBall(b);
          break;
        case 'moveGap':
          for (const k of targets) if (k.kind === 'ring') for (const g of k.gaps) g.at = this.rngAct.range(-Math.PI, Math.PI);
          break;
        case 'addGap':
          for (const k of targets) if (k.kind === 'ring' && k.gaps.length < act.max) k.gaps.push({ at: this.rngAct.range(-Math.PI, Math.PI), width: act.width * DEG });
          break;
        case 'addSide':
          for (const k of targets) {
            if (k.kind !== 'poly' || k.sides >= act.max) continue;
            k.sides++;
            k.open.push(false);
          }
          break;
        case 'shrinkContainer':
          for (const k of targets) k.radius = Math.max(act.min, k.radius - act.amount);
          break;
        case 'recolor':
          if (b && b.alive) {
            const pal = this.scene.style.palette;
            b.colorIndex = (b.colorIndex + 1) % pal.length;
            b.color = pal[b.colorIndex];
          }
          break;
        case 'end':
          this.endNow('rule');
          break;
        case 'freezeAll':
          for (const x of this.balls) {
            if (!x.alive || x.projectile) continue;
            x.vx = 0;
            x.vy = 0;
            x.frozen = true;
            x.anchored = true;
            x.locked = true;
            x.energy = 0;
          }
          break;
        case 'growForce':
          for (const f of this.forces) {
            f.strength *= act.factor;
            if (f.swallow > 0) f.swallow = Math.min(act.max, f.swallow + act.swallow);
          }
          break;
      }
    }
  }

  /** Gravity changed: re-base every ball's energy budget on its current speed. */
  private gravityChanged(): void {
    for (const b of this.balls) if (b.alive) b.energy = this.energyOf(b);
    this.events.push({ step: this.stepCount, type: 'gravity', ball: -1, ring: -1, solid: -1, zone: -1, x: this.gx, y: this.gy, speed: 0 });
  }

  private emit(type: SimEventType, b: Ball, ring = -1, solid = -1, zone = -1, speed = 0, x = b.x, y = b.y): void {
    this.events.push({ step: this.stepCount, type, ball: b.id, ring, solid, zone, x, y, speed });
  }

  // ---- V2 mechanics ---------------------------------------------------------------

  /** Seconds left on the clock at the climax (or now, before it); null without a clock. */
  clockLeft(): number | null {
    const clock = this.scene.clock;
    if (!clock) return null;
    const step = this.climaxStep >= 0 ? Math.min(this.stepCount, this.climaxStep) : this.stepCount;
    return Math.max(0, clock.seconds - step / PHYSICS_HZ);
  }

  /** Ticks through the final stretch, and the hard stop at zero. */
  private checkClock(clock: NonNullable<Scene['clock']>): void {
    if (this.endStep !== Infinity) return;
    const zero = Math.round(clock.seconds * PHYSICS_HZ);
    const left = zero - this.stepCount;
    if (left > 0 && left % PHYSICS_HZ === 0 && left / PHYSICS_HZ <= clock.final) {
      this.events.push({ step: this.stepCount, type: 'clock', ball: -1, ring: -1, solid: -1, zone: -1, x: WIDTH / 2, y: 0, speed: 0, n: left / PHYSICS_HZ });
    }
    if (left <= 0) {
      this.events.push({ step: this.stepCount, type: 'timeUp', ball: -1, ring: -1, solid: -1, zone: -1, x: WIDTH / 2, y: 0, speed: 0 });
      this.endNow('timeUp');
    }
  }

  /** End the run now (rule action or script). */
  endNow(reason: string): void {
    if (this.endStep !== Infinity) return;
    this.endReason = reason;
    this.climaxStep = this.stepCount;
    this.endStep = this.stepCount + Math.round(this.scene.duration.tail * PHYSICS_HZ);
  }

  /** The one team every live ball is on, or '' (also: one team owns the whole territory). */
  private soleTeam(): string {
    if (this.territory) {
      const c = this.territory.counts;
      const owners = c.filter((n) => n > 0).length;
      if (owners === 1 && this.teams.length > 1) return this.teams[c.findIndex((n) => n > 0)]?.name ?? '';
    }
    let team: string | undefined;
    let any = false;
    for (const b of this.balls) {
      if (!b.alive || b.projectile) continue;
      if (b.team === undefined) return '';
      if (!any) {
        team = b.team;
        any = true;
      } else if (b.team !== team) return '';
    }
    return any ? (team ?? '') : '';
  }

  private placeSpinner(s: Solid): void {
    const ca = M.cos(s.angle);
    const sa = M.sin(s.angle);
    if (s.pivotEnd) {
      s.x1 = s.cx;
      s.y1 = s.cy;
      s.x2 = s.cx + ca * s.length;
      s.y2 = s.cy + sa * s.length;
    } else {
      s.x1 = s.cx - (ca * s.length) / 2;
      s.y1 = s.cy - (sa * s.length) / 2;
      s.x2 = s.cx + (ca * s.length) / 2;
      s.y2 = s.cy + (sa * s.length) / 2;
    }
  }

  /** Ball vs. a (possibly rotated) rectangle. Returns the impact speed, or 0. */
  private collideBox(b: Ball, s: Solid, e: number): number {
    const ca = M.cos(s.angle);
    const sa = M.sin(s.angle);
    const dx = b.x - s.cx;
    const dy = b.y - s.cy;
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    if (Math.abs(lx) > s.hw + b.r || Math.abs(ly) > s.hh + b.r) return 0;
    const qx = Math.max(-s.hw, Math.min(s.hw, lx));
    const qy = Math.max(-s.hh, Math.min(s.hh, ly));
    let nx = lx - qx;
    let ny = ly - qy;
    const d2 = nx * nx + ny * ny;
    let pen: number;
    if (d2 > 1e-12) {
      if (d2 >= b.r * b.r) return 0;
      const d = Math.sqrt(d2);
      nx /= d;
      ny /= d;
      pen = b.r - d;
    } else {
      // Centre inside the box: push out along the nearest face.
      const px = s.hw - Math.abs(lx);
      const py = s.hh - Math.abs(ly);
      if (px < py) {
        nx = lx < 0 ? -1 : 1;
        ny = 0;
        pen = px + b.r;
      } else {
        nx = 0;
        ny = ly < 0 ? -1 : 1;
        pen = py + b.r;
      }
    }
    const wnx = nx * ca - ny * sa;
    const wny = nx * sa + ny * ca;
    b.x += wnx * pen;
    b.y += wny * pen;
    const vn = b.vx * wnx + b.vy * wny;
    if (vn >= 0) return 0;
    b.vx -= (1 + e) * vn * wnx;
    b.vy -= (1 + e) * vn * wny;
    return -vn;
  }

  private applyForces(b: Ball, h: number): void {
    for (const f of this.forces) {
      if (f.kind === 'wind') {
        b.vx += f.dx * f.strength * h;
        b.vy += f.dy * f.strength * h;
        continue;
      }
      const dx = f.x - b.x;
      const dy = f.y - b.y;
      const d = M.hypot(dx, dy) || 1e-9;
      if (f.radius > 0 && d > f.radius) continue;
      if (f.kind === 'radial') {
        // Gravity pointing away from the center (fading in over the first 20 px, where "away" is undefined).
        const a = f.strength * Math.min(1, d / 20);
        b.vx -= (dx / d) * a * h;
        b.vy -= (dy / d) * a * h;
        continue;
      }
      if (f.kind === 'attract' && f.swallow > 0 && d < f.swallow + b.r * 0.5 && !b.projectile) {
        if (!(this.scene.duration.endOn === 'lastStanding' && this.aliveCount <= 1)) {
          this.swallowBall(b, f);
          return;
        }
      }
      const ux = dx / d;
      const uy = dy / d;
      const dd = Math.max(d, 30);
      if (f.kind === 'attract' || f.kind === 'repel') {
        const a = f.strength * M.ipow(100 / dd, 2) * (f.kind === 'repel' ? -1 : 1);
        b.vx += ux * a * h;
        b.vy += uy * a * h;
      } else {
        // Vortex: swirl (1/r) plus some pull inward.
        const a = f.strength * (100 / dd);
        const tx = -uy;
        const ty = ux;
        b.vx += (tx * (1 - f.inward) + ux * f.inward) * a * h;
        b.vy += (ty * (1 - f.inward) + uy * f.inward) * a * h;
      }
    }
  }

  private capSpeed(b: Ball, max: number): void {
    const sp = M.hypot(b.vx, b.vy);
    if (sp <= max) return;
    b.vx *= max / sp;
    b.vy *= max / sp;
  }

  /** A ball eaten by a black hole, drain or bigger ball. */
  private swallowBall(b: Ball, f: Force | null): void {
    if (!b.alive) return;
    b.alive = false;
    this.swallowed++;
    if (f) f.eaten++;
    this.emit('swallow', b, -1, -1, -1, M.hypot(b.vx, b.vy), f ? f.x : b.x, f ? f.y : b.y);
    this.runRules('swallow', b, null, 0, null);
  }

  private checkPortals(b: Ball): void {
    if (b.portal >= 0) {
      // Must leave the mouth it came out of before it can enter again.
      const p = this.portals[b.portal >> 1];
      const [mx, my] = b.portal & 1 ? [p.bx, p.by] : [p.ax, p.ay];
      if (M.hypot(b.x - mx, b.y - my) > p.r + b.r) b.portal = -1;
      return;
    }
    for (const p of this.portals) {
      let from: [number, number] | null = null;
      let to: [number, number] = [0, 0];
      let end = 0;
      if (M.hypot(b.x - p.ax, b.y - p.ay) < p.r * 0.7) {
        from = [p.ax, p.ay];
        to = [p.bx, p.by];
        end = 1;
      } else if (M.hypot(b.x - p.bx, b.y - p.by) < p.r * 0.7) {
        from = [p.bx, p.by];
        to = [p.ax, p.ay];
        end = 0;
      }
      if (!from) continue;
      const ox = b.x;
      const oy = b.y;
      b.x = to[0] + (b.x - from[0]);
      b.y = to[1] + (b.y - from[1]);
      b.portal = p.id * 2 + end;
      b.energy = this.energyOf(b);
      this.emit('teleport', b, -1, -1, -1, M.hypot(b.vx, b.vy), ox, oy);
      // Coming out on the other side of a wall counts as an escape (or a recapture).
      this.containers.forEach((c, i) => {
        if (c.broken) return;
        const inside = M.hypot(b.x - c.x, b.y - c.y) < this.innerRadius(c);
        if (!inside && !b.escaped[i]) this.escape(b, c, i);
        else if (inside && b.escaped[i]) b.escaped[i] = false;
      });
      this.runRules('teleport', b, null, 0, null);
      return;
    }
  }

  /** Territory: pass through your own color, bounce off and repaint anyone else's. */
  private collideTerritory(b: Ball): void {
    const T = this.territory!;
    const team = this.teamOf(b.team);
    if (team < 0) return;
    if (T.paint) {
      // Sample cell centers. Last brush over a cell owns it, independent of render fps.
      const cx = (b.x - T.x) / T.cell;
      const cy = (b.y - T.y) / T.cell;
      const radius = b.r / T.cell;
      const right = Math.min(T.cols - 1, Math.floor(cx + radius - 0.5));
      const bottom = Math.min(T.rows - 1, Math.floor(cy + radius - 0.5));
      for (let row = Math.max(0, Math.ceil(cy - radius - 0.5)); row <= bottom; row++) {
        for (let col = Math.max(0, Math.ceil(cx - radius - 0.5)); col <= right; col++) {
          if ((col + 0.5 - cx) ** 2 + (row + 0.5 - cy) ** 2 > radius ** 2) continue;
          const i = row * T.cols + col;
          const previous = T.owner[i];
          if (previous === team) continue;
          if (previous >= 0) T.counts[previous]--;
          T.counts[team]++;
          T.owner[i] = team;
        }
      }
      return;
    }
    const x0 = T.x;
    const y0 = T.y;
    const x1 = T.x + T.cols * T.cell;
    const y1 = T.y + T.rows * T.cell;
    // The board's edge is a wall.
    if (b.x - b.r < x0 && b.vx < 0) (b.x = x0 + b.r), (b.vx = -b.vx);
    if (b.x + b.r > x1 && b.vx > 0) (b.x = x1 - b.r), (b.vx = -b.vx);
    if (b.y - b.r < y0 && b.vy < 0) (b.y = y0 + b.r), (b.vy = -b.vy);
    if (b.y + b.r > y1 && b.vy > 0) (b.y = y1 - b.r), (b.vy = -b.vy);
    const cellAt = (x: number, y: number) => {
      const c = Math.floor((x - x0) / T.cell);
      const r = Math.floor((y - y0) / T.cell);
      return c < 0 || r < 0 || c >= T.cols || r >= T.rows ? -1 : r * T.cols + c;
    };
    for (const axis of [0, 1]) {
      const px = axis === 0 ? b.x + Math.sign(b.vx) * b.r : b.x;
      const py = axis === 1 ? b.y + Math.sign(b.vy) * b.r : b.y;
      const cell = cellAt(px, py);
      if (cell < 0 || T.owner[cell] === team) continue;
      T.counts[T.owner[cell]]--;
      T.owner[cell] = team;
      T.counts[team]++;
      if (axis === 0) b.vx = -b.vx;
      else b.vy = -b.vy;
      // A hair of randomness keeps the paths from settling into a loop.
      const tw = this.rngAct.range(-0.03, 0.03);
      const c = M.cos(tw);
      const sn = M.sin(tw);
      [b.vx, b.vy] = [b.vx * c - b.vy * sn, b.vx * sn + b.vy * c];
      this.captures++;
      this.emit('capture', b, -1, -1, -1, M.hypot(b.vx, b.vy), px, py);
      this.events[this.events.length - 1].n = team;
      this.runRules('capture', b, null, 0, null);
    }
  }

  private runEmitters(): void {
    this.emitters.forEach((em, ei) => {
      const sp = em.spec;
      if (this.stepCount < em.startStep) return;
      if (!sp.loop && em.made >= sp.count) return;
      em.acc += sp.rate * DT;
      while (em.acc >= 1) {
        em.acc -= 1;
        if (!sp.loop && em.made >= sp.count) break;
        if (sp.loop) {
          let mine = 0;
          for (const b of this.balls) if (b.alive && b.source === ei) mine++;
          if (mine >= sp.count) break;
        }
        const level = sp.level === undefined ? undefined : sp.levels ? this.rngAct.int(sp.level + 1) : sp.level;
        const r = Math.max(2, (sp.radius + (sp.radiusJitter ? this.rngAct.range(-sp.radiusJitter, sp.radiusJitter) : 0)) * M.ipow(1.25, level ?? 0));
        const pal = this.scene.style.palette;
        const color = sp.rainbow
          ? `hsl(${Math.round((em.made * (sp.loop ? 9 : 360 / Math.max(12, sp.count))) % 360)}, 92%, 60%)`
          : sp.colors
            ? sp.colors[em.made % sp.colors.length]
            : level !== undefined
              ? pal[level % pal.length]
              : undefined;
        const spec: BallSpec = { ...this.template, count: 1, copies: 1, radius: r, color, colors: undefined, labels: undefined, team: sp.team, teams: undefined, level, frozen: false };
        const x = sp.x + (sp.jitter ? this.rngAct.range(-sp.jitter, sp.jitter) : 0);
        const y = sp.y + (sp.jitter ? this.rngAct.range(-sp.jitter, sp.jitter) : 0);
        const dir = sp.direction + (sp.cone ? this.rngAct.range(-sp.cone / 2, sp.cone / 2) : 0);
        const b = this.spawnBall(spec, em.made, x, y, 0, sp.speed, dir);
        if (!b) break;
        b.source = ei;
        em.made++;
      }
    });
  }

  private stepPendulums(): void {
    const h = DT;
    for (const p of this.pendulums) {
      const before = p.t1;
      if (p.arms === 1) {
        // Simple pendulum, RK4.
        const f = (t: number) => (-p.g / p.l1) * M.sin(t);
        const k1t = p.w1;
        const k1w = f(p.t1);
        const k2t = p.w1 + (h / 2) * k1w;
        const k2w = f(p.t1 + (h / 2) * k1t);
        const k3t = p.w1 + (h / 2) * k2w;
        const k3w = f(p.t1 + (h / 2) * k2t);
        const k4t = p.w1 + h * k3w;
        const k4w = f(p.t1 + h * k3t);
        p.t1 += (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
        p.w1 += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
      } else {
        // Double pendulum (equal masses), RK4 on (t1, t2, w1, w2).
        const g = p.g;
        const l1 = p.l1;
        const l2 = p.l2;
        const acc = (t1: number, t2: number, w1: number, w2: number): [number, number] => {
          const d = t1 - t2;
          const den = 3 - M.cos(2 * d);
          const a1 = (-3 * g * M.sin(t1) - g * M.sin(t1 - 2 * t2) - 2 * M.sin(d) * (w2 * w2 * l2 + w1 * w1 * l1 * M.cos(d))) / (l1 * den);
          const a2 = (2 * M.sin(d) * (2 * w1 * w1 * l1 + 2 * g * M.cos(t1) + w2 * w2 * l2 * M.cos(d))) / (l2 * den);
          return [a1, a2];
        };
        const s0 = [p.t1, p.t2, p.w1, p.w2];
        const deriv = (s: number[]): number[] => {
          const [a1, a2] = acc(s[0], s[1], s[2], s[3]);
          return [s[2], s[3], a1, a2];
        };
        const add = (a: number[], b: number[], k: number) => a.map((v, i) => v + b[i] * k);
        const k1 = deriv(s0);
        const k2 = deriv(add(s0, k1, h / 2));
        const k3 = deriv(add(s0, k2, h / 2));
        const k4 = deriv(add(s0, k3, h));
        const next = s0.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
        [p.t1, p.t2, p.w1, p.w2] = next;
      }
      // A chime when the (upper) arm swings through the bottom.
      if (p.chime && M.sin(before) * M.sin(p.t1) < 0 && M.cos(p.t1) > 0) {
        const [x, y] = this.pendulumBob(p);
        this.events.push({ step: this.stepCount, type: 'swing', ball: -1, ring: -1, solid: -1, zone: -1, x, y, speed: Math.abs(p.w1) * p.l1, n: p.id });
      }
    }
  }

  /** Where a pendulum's last bob is. */
  pendulumBob(p: Pendulum): [number, number] {
    const x1 = p.x + p.l1 * M.sin(p.t1);
    const y1 = p.y + p.l1 * M.cos(p.t1);
    if (p.arms === 1) return [x1, y1];
    return [x1 + p.l2 * M.sin(p.t2), y1 + p.l2 * M.cos(p.t2)];
  }

  /** A polygon bounce right next to a vertex. */
  private checkCorner(b: Ball, c: PolyContainer): void {
    let best = Infinity;
    for (const [vx, vy] of this.polyVertices(c)) best = Math.min(best, M.hypot(b.x - vx, b.y - vy));
    if (best > b.r * 1.45 + c.thickness / 2) return;
    this.corners++;
    this.emit('corner', b, c.id);
    this.runRules('corner', b, c, 0, null);
  }

  private segmentAt(ring: RingContainer, theta: number): number {
    const n = ring.segments!.length;
    const a = ((theta % TAU) + TAU) % TAU;
    return Math.min(n - 1, Math.floor((a / TAU) * n));
  }

  /** A bounce on a breakable container: chip a segment, or the whole ring's hp. */
  private hitContainer(b: Ball, c: Container): void {
    if (c.broken) return;
    if (c.kind === 'ring' && c.segments) {
      const i = this.segmentAt(c, M.atan2(b.y - c.y, b.x - c.x) - c.angle);
      if (c.segments[i] <= 0) return;
      c.segments[i]--;
      if (c.segments[i] <= 0) {
        this.breaks++;
        this.emit('break', b, c.id, -1, -1, M.hypot(b.vx, b.vy));
        this.events[this.events.length - 1].n = i;
        this.runRules('break', b, c, 0, null);
      }
      return;
    }
    if (c.hp === undefined) return;
    c.hp--;
    if (c.hp > 0) return;
    c.broken = true;
    this.breaks++;
    this.emit('break', b, c.id, -1, -1, M.hypot(b.vx, b.vy), c.x, c.y);
    this.events[this.events.length - 1].n = -1;
    this.runRules('break', b, c, 0, null);
    // Everything inside is free.
    const idx = this.containers.indexOf(c);
    for (const x of this.balls) if (x.alive && !x.escaped[idx]) this.escape(x, c, idx);
  }

  private hitSolid(b: Ball, s: Solid): void {
    s.hp!--;
    if (s.hp! > 0) return;
    s.alive = false;
    this.breaks++;
    this.emit('break', b, -1, s.id, -1, M.hypot(b.vx, b.vy), s.kind === 'brick' ? s.cx : b.x, s.kind === 'brick' ? s.cy : b.y);
    this.runRules('break', b, null, 0, null);
  }

  /** A moving ball against an immovable clone. */
  private collideAnchored(rock: Ball, b: Ball): void {
    const dx = b.x - rock.x;
    const dy = b.y - rock.y;
    const d = M.hypot(dx, dy) || 1e-9;
    const nx = dx / d;
    const ny = dy / d;
    if (b.frozen) return;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return; // moving away (e.g. off its own fresh clone)
    b.x = rock.x + nx * (rock.r + b.r);
    b.y = rock.y + ny * (rock.r + b.r);
    const e = this.scene.world.restitution;
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    this.onBounce(b, null, -1, -vn);
  }

  private arrowHit(arrow: Ball, target: Ball): void {
    if (!arrow.alive || !target.alive || target.projectile) return;
    if (target.id === arrow.projectile!.owner) return;
    const owner = this.balls[arrow.projectile!.owner];
    if (owner && owner.team !== undefined && owner.team === target.team) return;
    arrow.alive = false;
    target.vx += arrow.vx * 0.12;
    target.vy += arrow.vy * 0.12;
    if (target.frozen) target.frozen = false;
    this.capSpeed(target, MAX_HIT_SPEED);
    target.energy = this.energyOf(target);
    this.emit('strike', owner ?? arrow, -1, -1, -1, 600, arrow.x, arrow.y);
    this.damage(target, arrow.projectile!.damage, true);
    if (owner?.alive) this.powerUp(owner);
  }

  /** An unarmed ball lands a body blow. */
  private punch(a: Ball, b: Ball): void {
    const w = a.weapon!;
    if (this.stepCount - b.lastDamageStep < DAMAGE_COOLDOWN) return;
    this.emit('strike', a, -1, -1, -1, M.hypot(a.vx, a.vy), (a.x + b.x) / 2, (a.y + b.y) / 2);
    this.damage(b, w.damage, true);
    this.runRules('strike', a, null, 0, b);
    this.powerUp(a);
  }

  /** A weapon lands a hit: it powers up as its kind says. */
  private powerUp(a: Ball): void {
    const w = a.weapon;
    if (!w) return;
    w.hits++;
    const g = w.grow;
    if (g.damage) w.damage += g.damage;
    if (g.spin !== 1) w.spin = Math.sign(w.spin || 1) * Math.min(MAX_WEAPON_SPIN, Math.abs(w.spin) * g.spin);
    if (g.length) w.length = Math.min(420, w.length + g.length);
    if (g.arrows) w.arrows = Math.min(12, w.arrows + g.arrows);
    if (g.speed !== 1) {
      const sp = M.hypot(a.vx, a.vy);
      const k = Math.min(2600, sp * g.speed) / Math.max(1e-6, sp);
      a.vx *= k;
      a.vy *= k;
      a.energy = this.energyOf(a);
    }
  }

  /** A bow looses a volley at the nearest enemy. */
  private fireArrows(a: Ball): void {
    const w = a.weapon!;
    w.nextShot = this.stepCount + w.fireSteps;
    let target: Ball | null = null;
    let best = Infinity;
    for (const b of this.balls) {
      if (b === a || !b.alive || b.projectile || b.group !== a.group) continue;
      if (a.team !== undefined && a.team === b.team) continue;
      const d = M.hypot(b.x - a.x, b.y - a.y);
      if (d < best) {
        best = d;
        target = b;
      }
    }
    if (!target) return;
    const base = M.atan2(target.y - a.y, target.x - a.x);
    w.angle = base;
    for (let k = 0; k < w.arrows; k++) {
      const ang = base + (k - (w.arrows - 1) / 2) * 0.14;
      const arrow = this.spawnLike(a, a.x + M.cos(ang) * (a.r + 10), a.y + M.sin(ang) * (a.r + 10), M.cos(ang) * 1500, M.sin(ang) * 1500, 6);
      if (!arrow) return;
      arrow.projectile = { owner: a.id, damage: Math.max(1, w.damage) };
      arrow.color = w.color ?? '#fff3b0';
      arrow.weapon = undefined;
      arrow.label = undefined;
      arrow.hp = undefined;
      arrow.maxHp = undefined;
      arrow.emoji = undefined;
      arrow.image = undefined;
      arrow.shape = 'circle';
    }
    this.emit('shoot', a);
  }

  /** A new ball that looks like `src` (same team, look and level). */
  private spawnLike(src: Ball, x: number, y: number, vx: number, vy: number, r: number): Ball | null {
    if (this.aliveCount >= this.scene.world.maxBalls) return null;
    const b: Ball = {
      ...src,
      id: this.nextBallId++,
      x,
      y,
      vx,
      vy,
      r,
      hp: src.maxHp,
      lastDamageStep: -Infinity,
      alive: true,
      frozen: false,
      anchored: false,
      portal: -1,
      weapon: src.weapon ? { ...src.weapon, grow: { ...src.weapon.grow } } : undefined,
      escaped: [...src.escaped],
      everEscaped: [...src.everEscaped],
      inZone: [...src.inZone],
      projectile: undefined,
      energy: 0,
    };
    b.energy = this.energyOf(b);
    this.maxR = Math.max(this.maxR, r);
    this.balls.push(b);
    this.emit('spawn', b);
    return b;
  }

  private splitBall(b: Ball, min: number, spread: number, recolor: boolean): void {
    const r = b.r / Math.SQRT2;
    if (r < min) return;
    const sp = M.hypot(b.vx, b.vy);
    const dir = M.atan2(b.vy, b.vx);
    const px = -M.sin(dir) * r * 0.6;
    const py = M.cos(dir) * r * 0.6;
    const twin = this.spawnLike(b, b.x + px, b.y + py, M.cos(dir + spread / 2) * sp, M.sin(dir + spread / 2) * sp, r);
    if (!twin) return;
    b.r = r;
    b.x -= px;
    b.y -= py;
    b.vx = M.cos(dir - spread / 2) * sp;
    b.vy = M.sin(dir - spread / 2) * sp;
    b.energy = this.energyOf(b);
    if (recolor) {
      const pal = this.scene.style.palette;
      twin.colorIndex = (b.colorIndex + 1 + (twin.id % (pal.length - 1 || 1))) % pal.length;
      twin.color = pal[twin.colorIndex];
    }
  }

  private absorbBall(big: Ball, small: Ball, max = this.absorbMax): void {
    if (!small.alive || !big.alive) return;
    let cap = max;
    this.containers.forEach((k, i) => {
      if (!big.escaped[i] && !k.broken) cap = Math.min(cap, this.innerRadius(k) * 0.9);
    });
    big.r = Math.min(cap, Math.sqrt(big.r * big.r + small.r * small.r));
    this.maxR = Math.max(this.maxR, big.r);
    small.alive = false;
    this.swallowed++;
    this.emit('swallow', small, -1, -1, -1, M.hypot(small.vx, small.vy), big.x, big.y);
    this.runRules('swallow', small, null, 0, big);
  }

  private mergeBalls(a: Ball, b: Ball, growth = this.mergeGrowth): void {
    if (a.level >= this.mergeMax) return;
    const keep = a.id < b.id ? a : b;
    const gone = keep === a ? b : a;
    const ma = keep.r * keep.r;
    const mb = gone.r * gone.r;
    keep.x = (keep.x * ma + gone.x * mb) / (ma + mb);
    keep.y = (keep.y * ma + gone.y * mb) / (ma + mb);
    keep.vx = (keep.vx * ma + gone.vx * mb) / (ma + mb);
    keep.vy = (keep.vy * ma + gone.vy * mb) / (ma + mb);
    keep.level++;
    keep.r *= growth;
    this.maxR = Math.max(this.maxR, keep.r);
    const pal = this.scene.style.palette;
    keep.colorIndex = keep.level % pal.length;
    keep.color = pal[keep.colorIndex];
    keep.energy = this.energyOf(keep);
    gone.alive = false;
    this.merges++;
    this.emit('merge', keep, -1, -1, -1, 0);
    this.events[this.events.length - 1].n = keep.level;
    this.runRules('merge', keep, null, 0, gone);
  }

  private convertBall(b: Ball, team: string, by: Ball | null): void {
    const t = this.teams[this.teamOf(team)];
    b.team = team;
    b.color = t?.color ?? by?.color ?? b.color;
    if (t?.emoji) b.emoji = t.emoji;
    else if (by) b.emoji = by.emoji;
    this.conversions++;
    this.emit('convert', b);
    this.events[this.events.length - 1].n = this.teamOf(team);
    this.runRules('convert', b, null, 0, by);
  }

  private cloneBall(b: Ball): void {
    const c = this.spawnLike(b, b.x, b.y, 0, 0, b.r);
    if (!c) return;
    c.frozen = true;
    c.anchored = true;
    c.weapon = undefined;
    c.energy = 0;
    // The original steps off its clone so they don't start overlapped.
    const sp = M.hypot(b.vx, b.vy) || 1;
    b.x += (b.vx / sp) * 0.5;
    b.y += (b.vy / sp) * 0.5;
  }

  private checkEnd(): void {
    const { duration } = this.scene;
    if (this.endStep === Infinity && duration.endOn !== 'never') {
      let reason = '';
      if (this.filled) reason = 'filled';
      else if (duration.endOn === 'firstEscape' && this.escapes > 0) reason = 'escaped';
      else if (duration.endOn === 'allEscaped' && this.escapes > 0 && this.balls.every((b) => !b.alive || b.escaped.every(Boolean)))
        reason = 'allEscaped';
      else if (duration.endOn === 'lastStanding' && this.startingBalls > 1 && this.aliveCount <= 1) {
        reason = 'lastStanding';
        this.winner = this.balls.find((b) => b.alive && !b.projectile)?.id ?? -1;
      } else if (duration.endOn === 'oneTeam' && this.stepCount > 0) {
        const team = this.soleTeam();
        if (team) {
          reason = 'oneTeam';
          this.winnerTeam = team;
        } else if (this.territory && this.time >= duration.max - duration.tail) {
          // Territory battles rarely end in a full takeover: when time runs out, the biggest share wins
          // (decided early enough for the winner banner to show during the tail).
          const c = this.territory.counts;
          reason = 'oneTeam';
          this.winnerTeam = this.teams[c.indexOf(Math.max(...c))]?.name ?? '';
        }
      } else if (duration.endOn === 'mostTerritory' && this.territory && this.time >= duration.max - duration.tail) {
        reason = 'mostTerritory';
        const counts = this.territory.counts;
        const best = Math.max(...counts);
        const lead = counts.indexOf(best);
        if (best > 0 && lead === counts.lastIndexOf(best)) this.winnerTeam = this.teams[lead]?.name ?? '';
      } else if (duration.endOn === 'finish' && this.finishWinner >= 0) {
        reason = 'finish';
        this.winner = this.finishWinner;
      } else if (duration.endOn === 'cleared' && this.hadBreakables && this.breakablesLeft === 0) reason = 'cleared';
      if (reason) {
        this.endReason = reason;
        this.climaxStep = reason === 'escaped' && this.firstEscapeStep >= 0 ? this.firstEscapeStep : this.stepCount;
        this.endStep = this.stepCount + Math.round(duration.tail * PHYSICS_HZ);
      }
    }
    if (this.scene.clock) this.checkClock(this.scene.clock);
    if (this.stepCount >= this.endStep) this.done = true;
    if (this.time >= duration.max) {
      this.done = true;
      if (!this.endReason) this.endReason = 'timeLimit';
    }
    // Territory battles that run out the clock: the biggest share wins.
    if (this.done && this.territory && this.endReason !== 'mostTerritory' && !this.winnerTeam && this.teams.length) {
      const c = this.territory.counts;
      this.winnerTeam = this.teams[c.indexOf(Math.max(...c))]?.name ?? '';
    }
  }
}
