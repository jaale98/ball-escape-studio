import { Rng } from './rng';
import { type Action, type BallSpec, gravityVec, HEIGHT, PHYSICS_HZ, type Scene, WIDTH } from './scene';

export const DT = 1 / PHYSICS_HZ;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Minimum normal speed (px/s) for a contact to count as a bounce event. */
const BOUNCE_THRESHOLD = 20;
/** Minimum closing speed (px/s) for a ball-ball contact to count as a hit. */
const HIT_THRESHOLD = 40;
/** After taking damage a ball can't be damaged again for this long (pinned balls would otherwise trade hits every step). */
const DAMAGE_COOLDOWN = Math.round(0.25 * PHYSICS_HZ);

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

export type SimEventType = 'bounce' | 'escape' | 'spawn' | 'hit' | 'eliminate' | 'zone' | 'exit' | 'gravity';

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
}

/** Wrap an angle to (-PI, PI]. */
function wrap(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

const BALL_ACTIONS = new Set(['grow', 'speedUp', 'damage']);

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

  private endStep = Infinity;
  private filled = false;
  private nextBallId = 0;
  private startingBalls = 0;
  private readonly rngSpawn: Rng;
  private readonly template: BallSpec;
  private readonly rules: Record<'bounce' | 'escape' | 'hit' | 'eliminate', Action[]>;
  private readonly timeline: TimelineState[];

  constructor(scene: Scene) {
    this.scene = scene;
    this.rngSpawn = new Rng(scene.seed, 'spawn');
    [this.gx, this.gy] = gravityVec(scene.world.gravity);
    const rulesFor = (on: string) => scene.rules.filter((r) => r.on === on).flatMap((r) => r.do);
    this.rules = { bounce: rulesFor('bounce'), escape: rulesFor('escape'), hit: rulesFor('hit'), eliminate: rulesFor('eliminate') };
    this.timeline = scene.timeline.map((t) => ({
      atStep: t.at !== undefined ? Math.round(t.at * PHYSICS_HZ) : undefined,
      everySteps: t.every !== undefined ? Math.max(1, Math.round(t.every * PHYSICS_HZ)) : undefined,
      startStep: Math.round(t.start * PHYSICS_HZ),
      untilStep: t.until !== undefined ? Math.round(t.until * PHYSICS_HZ) : Infinity,
      actions: t.do,
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
          spin: e.spin,
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
          spin: e.spin,
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
      for (let i = 0; i < spec.count; i++) {
        this.spawnBall(spec, i, spec.x, spec.y, spec.spread ?? (spec.count > 1 ? 40 : 0));
      }
    }
    this.startingBalls = this.balls.length;
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
      if (b.alive) this.integrate(b);
    }
    this.collideBalls();
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
    const v = speed ?? spec.speed;
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
      escaped: this.containers.map((c) => Math.hypot(cx - c.x, cy - c.y) >= this.innerRadius(c)),
      everEscaped: [],
      inZone: this.zones.map(() => false),
      energy: 0,
    };
    ball.everEscaped = [...ball.escaped];
    ball.energy = this.energyOf(ball);
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
    const e = this.scene.world.restitution;
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.alive) continue;
      const layerA = a.escaped.reduce((n, v) => n + (v ? 1 : 0), 0);
      for (let j = i + 1; j < balls.length && a.alive; j++) {
        const b = balls[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        // Only balls in the same layer touch, so they never collide through a wall.
        const layerB = b.escaped.reduce((n, v) => n + (v ? 1 : 0), 0);
        if (layerA !== layerB) continue;
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
        if (rvn < 0) {
          const imp = (-(1 + e) * rvn) / (1 / ma + 1 / mb);
          a.vx -= (imp * nx) / ma;
          a.vy -= (imp * ny) / ma;
          b.vx += (imp * nx) / mb;
          b.vy += (imp * ny) / mb;
          this.restoreEnergy(a);
          this.restoreEnergy(b);
          if (-rvn > HIT_THRESHOLD) {
            this.emit('hit', a, -1, -1, -1, -rvn, (a.x + b.x) / 2, (a.y + b.y) / 2);
            this.applyActions(this.rules.hit, a, null, -rvn);
            this.applyActions(this.rules.hit, b, null, -rvn);
          }
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
    if (strength < BOUNCE_THRESHOLD) return;
    this.bounces++;
    this.emit('bounce', b, c ? c.id : -1, solid, -1, strength);
    this.applyActions(this.rules.bounce, b, c, strength);
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
      if (this.scene.duration.endOn === 'firstEscape') this.winner = b.id;
    }
    this.emit('escape', b, idx, -1, -1, Math.hypot(b.vx, b.vy));
    this.applyActions(this.rules.escape, b, c, 0);
  }

  private eliminate(b: Ball): void {
    if (!b.alive) return;
    b.alive = false;
    this.eliminations++;
    this.emit('eliminate', b);
    this.applyActions(this.rules.eliminate, b, null, 0);
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
          if (b && b.alive && b.hp !== undefined && this.stepCount - b.lastDamageStep >= DAMAGE_COOLDOWN) {
            b.lastDamageStep = this.stepCount;
            b.hp -= act.amount + (act.perSpeed * impact) / 1000;
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
