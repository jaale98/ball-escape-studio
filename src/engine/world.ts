import { Rng } from './rng';
import { type Action, ActionSchema, type BallSpec, gravityVec, HEIGHT, PHYSICS_HZ, type Scene, WIDTH } from './scene';
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
}
export interface RingContainer extends ContainerBase {
  kind: 'ring';
  gaps: Gap[];
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
  kind: 'wall' | 'peg';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Half the wall thickness, or the peg radius. */
  half: number;
  color: string;
}

export interface Zone {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  count: number;
}

export type SimEventType = 'bounce' | 'escape' | 'spawn' | 'hit' | 'eliminate' | 'zone' | 'exit' | 'gravity' | 'strike' | 'clash' | 'wake';

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

type RuleEvent = 'bounce' | 'escape' | 'hit' | 'eliminate' | 'strike' | 'wake';
interface RuleEntry {
  actions: Action[];
  script?: ScriptFn;
  where: string;
}

/** Wrap an angle to (-PI, PI]. */
function wrap(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

const BALL_ACTIONS = new Set(['grow', 'speedUp', 'damage']);

/** Shortest distance between two segments. */
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx;
  const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  const d3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pt = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    let t = l2 ? ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
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
  /** Every event so far, in order. Consumers keep their own read cursor. */
  events: SimEvent[] = [];
  bounces = 0;
  /** Escape events, including re-escapes after slipping back in. */
  escapes = 0;
  /** Distinct (ball, container) escapes: what an "escaped" counter should show. */
  uniqueEscapes = 0;
  eliminations = 0;
  firstEscapeStep = -1;
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
  /** Rhythm lock: seconds of real time per second of song, or 0 when off. */
  private rhythmK = 0;
  private nextBallId = 0;
  private startingBalls = 0;
  private readonly rngSpawn: Rng;
  private readonly template: BallSpec;
  private readonly rules: Record<RuleEvent, RuleEntry[]>;
  private readonly timeline: TimelineState[];
  private readonly rngScript: Rng;
  private readonly scriptState: Record<string, unknown> = {};
  private maxR = 0;
  /** During a hit's rules: true when the ball the rules run for was the one struck. */
  private defending = true;

  constructor(scene: Scene) {
    this.scene = scene;
    this.rngSpawn = new Rng(scene.seed, 'spawn');
    [this.gx, this.gy] = gravityVec(scene.world.gravity);
    this.rngScript = new Rng(scene.seed, 'script');
    const rulesFor = (on: RuleEvent): RuleEntry[] =>
      scene.rules
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.on === on)
        .map(({ r, i }) => ({ actions: r.do ?? [], script: r.script ? compileScript(r.script, `rules.${i}`) : undefined, where: `rules.${i}` }));
    this.rules = { bounce: rulesFor('bounce'), escape: rulesFor('escape'), hit: rulesFor('hit'), eliminate: rulesFor('eliminate'), strike: rulesFor('strike'), wake: rulesFor('wake') };
    this.timeline = scene.timeline.map((t, i) => ({
      atStep: t.at !== undefined ? Math.round(t.at * PHYSICS_HZ) : undefined,
      everySteps: t.every !== undefined ? Math.max(1, Math.round(t.every * PHYSICS_HZ)) : undefined,
      startStep: Math.round(t.start * PHYSICS_HZ),
      untilStep: t.until !== undefined ? Math.round(t.until * PHYSICS_HZ) : Infinity,
      actions: t.do ?? [],
      script: t.script ? compileScript(t.script, `timeline.${i}`) : undefined,
      where: `timeline.${i}`,
    }));

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
        });
      } else if (e.type === 'wall') {
        this.solids.push({ id: this.solids.length, kind: 'wall', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, half: e.thickness / 2, color: e.color ?? scene.style.ringColor });
      } else if (e.type === 'peg') {
        this.solids.push({ id: this.solids.length, kind: 'peg', x1: e.x, y1: e.y, x2: e.x, y2: e.y, half: e.radius, color: e.color ?? scene.style.ringColor });
      } else if (e.type === 'zone') {
        this.zones.push({ id: this.zones.length, x: e.x, y: e.y, width: e.width, height: e.height, label: e.label, count: 0 });
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
        if (spec.arrange === 'grid' && spec.count > 1) {
          const gx = cx + ((i % cols) - (cols - 1) / 2) * gap;
          const gy = cy + (Math.floor(i / cols) - (Math.ceil(spec.count / cols) - 1) / 2) * gap;
          this.spawnBall(spec, i, gx, gy, 0);
        } else this.spawnBall(spec, i, spec.x, spec.y, spec.spread ?? (spec.count > 1 ? 40 : 0));
      }
    }
    this.startingBalls = this.balls.length;

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
      const speed = Math.max(1, Math.hypot(b.vx, b.vy));
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

  get aliveCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  /** Advance the world by one fixed physics step (1/240 s). */
  step(): void {
    if (this.done) return;
    this.runTimeline();
    for (const c of this.containers) c.angle = wrap(c.angle + c.spin * DT);

    // Only balls that existed at the start of the step move this step.
    const n = this.balls.length;
    for (let i = 0; i < n; i++) {
      const b = this.balls[i];
      if (b.alive && !b.frozen) this.integrate(b);
    }
    this.collideBalls();
    this.strikes();
    this.countZones();

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
      out.push([c.x + c.radius * Math.cos(a), c.y + c.radius * Math.sin(a)]);
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
      const len = Math.hypot(bx - ax, by - ay);
      if (c.gap === undefined || c.gap >= len) continue; // whole side open
      // Two stubs either side of a centered exit.
      const f = (len - c.gap) / 2 / len;
      out.push([ax, ay, ax + (bx - ax) * f, ay + (by - ay) * f]);
      out.push([bx + (ax - bx) * f, by + (ay - by) * f, bx, by]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------

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
      vx: Math.cos(dir) * v,
      vy: Math.sin(dir) * v,
      r: spec.radius,
      color: spec.colors?.[index % spec.colors.length] ?? spec.color ?? palette[id % palette.length],
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
      weapon: spec.weapon ? { ...spec.weapon, angle: spec.weapon.angle * DEG + (index * TAU) / Math.max(1, spec.count), lastClashStep: -Infinity } : undefined,
      escaped: this.containers.map((c) => Math.hypot(cx - c.x, cy - c.y) >= this.innerRadius(c)),
      everEscaped: [],
      inZone: this.zones.map(() => false),
      energy: 0,
    };
    ball.everEscaped = [...ball.escaped];
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
    const r = c.kind === 'ring' ? c.radius : c.radius * Math.cos(Math.PI / c.sides);
    return r - c.thickness / 2;
  }

  private energyOf(b: Ball): number {
    return 0.5 * (b.vx * b.vx + b.vy * b.vy) - (this.gx * b.x + this.gy * b.y);
  }

  /** Rescale speed so the ball's energy matches its budget (no decay, no blow-up). */
  private restoreEnergy(b: Ball): void {
    if (!this.scene.world.keepEnergy) return;
    const target2 = 2 * (b.energy + this.gx * b.x + this.gy * b.y);
    const s = Math.hypot(b.vx, b.vy);
    if (target2 > 0 && s > 1e-6) {
      const k = Math.sqrt(target2) / s;
      b.vx *= k;
      b.vy *= k;
    }
  }

  private integrate(b: Ball): void {
    // Substep so a ball never moves more than ~30% of its radius per substep:
    // thin walls can't be tunneled through.
    const gmag = Math.hypot(this.gx, this.gy);
    const travel = (Math.hypot(b.vx, b.vy) + gmag * DT) * DT;
    const n = Math.min(32, Math.max(1, Math.ceil(travel / (0.3 * b.r))));
    const h = DT / n;
    const e = this.scene.world.restitution;
    if (b.shape !== 'circle' || b.image || b.emoji) b.rot += (b.vx / b.r) * DT * 0.6;
    for (let k = 0; k < n && b.alive; k++) {
      b.vx += this.gx * h;
      b.vy += this.gy * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      for (let i = 0; i < this.containers.length; i++) {
        const c = this.containers[i];
        if (c.kind === 'ring') {
          if (!b.escaped[i]) this.collideRing(b, c, i);
          else this.collideRingOutside(b, c, i);
        } else this.collidePoly(b, c, i);
      }
      for (const s of this.solids) {
        const hit = this.collideCapsule(b, s.x1, s.y1, s.x2, s.y2, s.half, 0, 0, 0, e);
        if (hit > 0) this.onBounce(b, null, s.id, hit);
      }
    }
    if (b.alive && b.escaped.every(Boolean)) {
      const m = b.r + 60;
      if (b.y - m > HEIGHT || b.y + m < -HEIGHT || b.x + m < 0 || b.x - m > WIDTH) {
        b.alive = false;
        this.emit('exit', b);
      }
    }
  }

  private gapAt(ring: RingContainer, theta: number): Gap | null {
    for (const gap of ring.gaps) {
      if (Math.abs(wrap(theta - gap.at)) < gap.width / 2) return gap;
    }
    return null;
  }

  private collideRing(b: Ball, ring: RingContainer, idx: number): void {
    const dx = b.x - ring.x;
    const dy = b.y - ring.y;
    const d = Math.hypot(dx, dy) || 1e-9;
    const half = ring.thickness / 2;
    const inner = ring.radius - half;
    const outer = ring.radius + half;
    if (d + b.r < inner) return; // not touching the wall

    const gap = this.gapAt(ring, Math.atan2(dy, dx) - ring.angle);
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
    const d = Math.hypot(dx, dy) || 1e-9;
    const half = ring.thickness / 2;
    const outer = ring.radius + half;
    if (d - b.r > outer) return;
    const gap = this.gapAt(ring, Math.atan2(dy, dx) - ring.angle);
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

  private collideCap(b: Ball, ring: RingContainer, edge: number, silent: boolean): void {
    const a = ring.angle + edge;
    const px = ring.x + ring.radius * Math.cos(a);
    const py = ring.y + ring.radius * Math.sin(a);
    const e = this.scene.world.restitution * (silent ? 0.6 : 1);
    const hit = this.collideCapsule(b, px, py, px, py, ring.thickness / 2, ring.x, ring.y, ring.spin, e);
    if (hit > 0 && !silent) this.onBounce(b, ring, -1, hit);
  }

  /** Polygon sides are two-sided capsules; escape = fully outside the corner circle. */
  private collidePoly(b: Ball, c: PolyContainer, idx: number): void {
    const d = Math.hypot(b.x - c.x, b.y - c.y);
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
        for (let j = i + 1; j < balls.length && a.alive; j++) if (layer[i] === layer[j]) this.collidePair(a, balls[j]);
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
          for (const j of list) if (j > i && layer[i] === layer[j] && a.alive) this.collidePair(a, balls[j]);
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
    const armed = this.balls.filter((b) => b.alive && b.weapon);
    if (!armed.length) return;
    const e = this.scene.world.restitution;
    for (const a of armed) a.weapon!.angle = wrap(a.weapon!.angle + a.weapon!.spin * DT);
    const blade = (a: Ball): [number, number, number, number] => {
      const w = a.weapon!;
      const ca = Math.cos(w.angle);
      const sa = Math.sin(w.angle);
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
      for (const b of this.balls) {
        if (b === a || !b.alive) continue;
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
        const pvx = a.vx - w.spin * arm * Math.sin(w.angle);
        const pvy = a.vy + w.spin * arm * Math.cos(w.angle);
        const vn = (b.vx - pvx) * nx + (b.vy - pvy) * ny;
        if (vn < 0) {
          b.vx -= (1 + e) * vn * nx;
          b.vy -= (1 + e) * vn * ny;
          if (b.energy === 0) b.energy = this.energyOf(b);
          else this.restoreEnergy(b);
        }
        if (this.stepCount - b.lastDamageStep >= DAMAGE_COOLDOWN) {
          this.emit('strike', a, -1, -1, -1, Math.abs(vn), px, py);
          if (w.damage > 0) this.damage(b, w.damage, true);
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
        }
      }
    }
  }

  private onBounce(b: Ball, c: Container | null, solid: number, strength: number): void {
    this.restoreEnergy(b);
    // Settling scenes (no energy keeping) have balls resting in piles: only real
    // impacts count as bounces, or every jostle would become an event and a note.
    if (strength < (this.scene.world.keepEnergy ? BOUNCE_THRESHOLD : SETTLE_THRESHOLD)) return;
    this.bounces++;
    this.emit('bounce', b, c ? c.id : -1, solid, -1, strength);
    this.runRules('bounce', b, c, strength, null);
    if (this.rhythmK > 0) this.lockToRhythm(b, this.bounces - 1);
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
    const songLength = nt[nt.length - 1] - nt[0] + Math.max(0.25, nt[nt.length - 1] - nt[nt.length - 2]);
    let dt = 0;
    for (let j = i; dt < 1e-6 && j < i + nt.length; j++) {
      const a = nt[j % nt.length] + Math.floor(j / nt.length) * songLength;
      const z = nt[(j + 1) % nt.length] + Math.floor((j + 1) / nt.length) * songLength;
      dt = z - a;
    }
    const s0 = Math.hypot(b.vx, b.vy);
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
        const s = RHYTHM_MIN_SPEED * (RHYTHM_MAX_SPEED / RHYTHM_MIN_SPEED) ** (k / (N - 1));
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
        const cost = Math.abs(Math.log(root / s0));
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
      if (c.kind === 'ring') touching = Math.hypot(x - c.x, y - c.y) + b.r >= inner;
      else {
        const ang = c.angle + c.spin * t;
        touching = false;
        for (let k = 0; k < c.sides && !touching; k++) {
          const a1 = ang + (k / c.sides) * TAU - Math.PI / 2;
          const a2 = ang + ((k + 1) / c.sides) * TAU - Math.PI / 2;
          const ax = c.x + c.radius * Math.cos(a1);
          const ay = c.y + c.radius * Math.sin(a1);
          const bx = c.x + c.radius * Math.cos(a2);
          const by = c.y + c.radius * Math.sin(a2);
          const abx = bx - ax;
          const aby = by - ay;
          let u = ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby);
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          touching = Math.hypot(x - (ax + u * abx), y - (ay + u * aby)) <= b.r + half;
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
    this.emit('escape', b, idx, -1, -1, Math.hypot(b.vx, b.vy));
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
      if (r.actions.length) this.applyActions(r.actions, b, c, impact);
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
          world.applyActions([parsed.data], b, c, impact);
        },
        gravity: (x, y) => {
          world.gx = x;
          world.gy = y;
          world.gravityChanged();
        },
        end: () => {
          if (world.endStep === Infinity) {
            world.endReason = 'script';
            world.endStep = world.stepCount + Math.round(world.scene.duration.tail * PHYSICS_HZ);
          }
        },
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
  private applyActions(actions: Action[], b: Ball | null, c: Container | null, impact: number): void {
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
          b.r = Math.min(cap, b.r + act.amount);
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
          const s = Math.hypot(b.vx, b.vy);
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
          const ca = Math.cos(a);
          const sa = Math.sin(a);
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
        this.winner = this.balls.find((b) => b.alive)?.id ?? -1;
      }
      if (reason) {
        this.endReason = reason;
        this.endStep = this.stepCount + Math.round(duration.tail * PHYSICS_HZ);
      }
    }
    if (this.stepCount >= this.endStep) this.done = true;
    if (this.time >= duration.max) {
      this.done = true;
      if (!this.endReason) this.endReason = 'timeLimit';
    }
  }
}
