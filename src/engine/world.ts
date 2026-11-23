import { Rng } from './rng';
import { type Action, type BallSpec, type Scene, HEIGHT, PHYSICS_HZ, WIDTH } from './scene';

export const DT = 1 / PHYSICS_HZ;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Minimum normal speed (px/s) for a contact to count as a bounce event. */
const BOUNCE_THRESHOLD = 20;

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  alive: boolean;
  /** escaped[i] is true while the ball is outside ring i. */
  escaped: boolean[];
  /** everEscaped[i] stays true once the ball has escaped ring i at least once. */
  everEscaped: boolean[];
  /** Energy budget held constant when world.keepEnergy is on. */
  energy: number;
}

export interface Gap {
  /** Center of the gap, radians, relative to the ring's rotation. */
  at: number;
  /** Full angular width, radians. */
  width: number;
}

export interface Ring {
  id: number;
  x: number;
  y: number;
  radius: number;
  thickness: number;
  angle: number;
  spin: number;
  gaps: Gap[];
  color: string;
}

export type SimEventType = 'bounce' | 'escape' | 'spawn' | 'hit' | 'exit';

export interface SimEvent {
  step: number;
  type: SimEventType;
  ball: number;
  /** Ring index, or -1. */
  ring: number;
  x: number;
  y: number;
  /** Impact strength in px/s (normal speed). */
  speed: number;
}

/** Wrap an angle to (-PI, PI]. */
function wrap(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/**
 * The deterministic simulation. Same scene + same seed = identical run,
 * step for step. It never reads the clock and only uses seeded randomness.
 */
export class World {
  readonly scene: Scene;
  stepCount = 0;
  balls: Ball[] = [];
  rings: Ring[] = [];
  /** Every event so far, in order. Consumers keep their own read cursor. */
  events: SimEvent[] = [];
  bounces = 0;
  /** Escape events, including re-escapes after slipping back in. */
  escapes = 0;
  /** Distinct (ball, ring) escapes: what an "escaped" counter should show. */
  uniqueEscapes = 0;
  firstEscapeStep = -1;
  done = false;
  endReason = '';

  private endStep = Infinity;
  private filled = false;
  private nextBallId = 0;
  private readonly rngSpawn: Rng;
  private readonly template: BallSpec;
  private readonly bounceRules: Action[];
  private readonly escapeRules: Action[];

  constructor(scene: Scene) {
    this.scene = scene;
    this.rngSpawn = new Rng(scene.seed, 'spawn');
    this.bounceRules = scene.rules.filter((r) => r.on === 'bounce').flatMap((r) => r.do);
    this.escapeRules = scene.rules.filter((r) => r.on === 'escape').flatMap((r) => r.do);

    for (const e of scene.entities) {
      if (e.type !== 'ring') continue;
      this.rings.push({
        id: this.rings.length,
        x: e.x,
        y: e.y,
        radius: e.radius,
        thickness: e.thickness,
        angle: e.angle * DEG,
        spin: e.spin,
        gaps: e.gaps.filter((g) => g.width > 0).map((g) => ({ at: g.at * DEG, width: g.width * DEG })),
        color: e.color ?? scene.style.ringColor,
      });
    }

    const ballSpecs = scene.entities.filter((e): e is BallSpec => e.type === 'ball');
    this.template = ballSpecs[0] ?? { type: 'ball', radius: 22, speed: 800, count: 1 };
    for (const spec of ballSpecs) {
      for (let i = 0; i < spec.count; i++) {
        const jitter = spec.count > 1 ? 40 : 0;
        this.spawnBall(spec, spec.x, spec.y, jitter);
      }
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
    for (const ring of this.rings) ring.angle = wrap(ring.angle + ring.spin * DT);

    // Only balls that existed at the start of the step move this step;
    // balls spawned mid-step start moving next step.
    const n = this.balls.length;
    for (let i = 0; i < n; i++) {
      const b = this.balls[i];
      if (b.alive) this.integrate(b);
    }
    this.collideBalls();

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
    const values: number[] = [this.stepCount, this.bounces, this.escapes];
    for (const b of this.balls) values.push(b.x, b.y, b.vx, b.vy, b.r, b.alive ? 1 : 0);
    for (const r of this.rings) {
      values.push(r.angle);
      for (const g of r.gaps) values.push(g.width);
    }
    const bytes = new Uint8Array(new Float64Array(values).buffer);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // ---------------------------------------------------------------------------

  private spawnBall(spec: BallSpec, x?: number, y?: number, jitter = 0): Ball {
    const anchor = this.rings[0];
    const cx = (x ?? anchor?.x ?? WIDTH / 2) + (jitter ? this.rngSpawn.range(-jitter, jitter) : 0);
    const cy = (y ?? anchor?.y ?? HEIGHT / 2) + (jitter ? this.rngSpawn.range(-jitter, jitter) : 0);
    const dir = spec.direction !== undefined ? spec.direction * DEG : this.rngSpawn.range(0, TAU);
    const id = this.nextBallId++;
    const palette = this.scene.style.palette;
    const ball: Ball = {
      id,
      x: cx,
      y: cy,
      vx: Math.cos(dir) * spec.speed,
      vy: Math.sin(dir) * spec.speed,
      r: spec.radius,
      color: spec.color ?? palette[id % palette.length],
      alive: true,
      escaped: this.rings.map((ring) => Math.hypot(cx - ring.x, cy - ring.y) >= ring.radius),
      everEscaped: [],
      energy: 0,
    };
    ball.everEscaped = [...ball.escaped];
    ball.energy = this.energyOf(ball);
    this.balls.push(ball);
    this.emit('spawn', ball, -1, 0);
    return ball;
  }

  private energyOf(b: Ball): number {
    return 0.5 * (b.vx * b.vx + b.vy * b.vy) - this.scene.world.gravity * b.y;
  }

  /** Rescale speed so the ball's energy matches its budget (no decay, no blow-up). */
  private restoreEnergy(b: Ball): void {
    if (!this.scene.world.keepEnergy) return;
    const target2 = 2 * (b.energy + this.scene.world.gravity * b.y);
    const s = Math.hypot(b.vx, b.vy);
    if (target2 > 0 && s > 1e-6) {
      const k = Math.sqrt(target2) / s;
      b.vx *= k;
      b.vy *= k;
    }
  }

  private integrate(b: Ball): void {
    const g = this.scene.world.gravity;
    // Substep so a fast ball never moves more than ~30% of its radius per
    // substep: thin walls can't be tunneled through.
    const travel = (Math.hypot(b.vx, b.vy) + Math.abs(g) * DT) * DT;
    const n = Math.min(32, Math.max(1, Math.ceil(travel / (0.3 * b.r))));
    const h = DT / n;
    for (let k = 0; k < n; k++) {
      b.vy += g * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      for (let i = 0; i < this.rings.length; i++) {
        if (!b.escaped[i]) this.collideRing(b, this.rings[i], i);
        else this.collideOutside(b, this.rings[i], i);
      }
    }
    if (b.escaped.every(Boolean)) {
      const m = b.r + 60;
      if (b.y - m > HEIGHT || b.y + m < -HEIGHT || b.x + m < 0 || b.x - m > WIDTH) {
        b.alive = false;
        this.emit('exit', b, -1, 0);
      }
    }
  }

  private gapAt(ring: Ring, theta: number): Gap | null {
    for (const gap of ring.gaps) {
      if (Math.abs(wrap(theta - gap.at)) < gap.width / 2) return gap;
    }
    return null;
  }

  private collideRing(b: Ball, ring: Ring, idx: number): void {
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
      this.collideCap(b, ring, idx, gap.at - gap.width / 2);
      this.collideCap(b, ring, idx, gap.at + gap.width / 2);
      return;
    }

    const nx = dx / d;
    const ny = dy / d;
    const e = this.scene.world.restitution;
    if (d >= ring.radius) {
      // The ball is mostly through the wall (the gap rotated away mid-exit):
      // push it the rest of the way out and count it as escaped.
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

    // Inner wall contact.
    b.x = ring.x + nx * (inner - b.r);
    b.y = ring.y + ny * (inner - b.r);
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      this.onBounce(b, ring, idx, vn);
    }
  }

  /**
   * A ball that has escaped a ring bounces off its outer surface (softly, with
   * no bounce event), and is captured again if it slips back in through the gap.
   */
  private collideOutside(b: Ball, ring: Ring, idx: number): void {
    const dx = b.x - ring.x;
    const dy = b.y - ring.y;
    const d = Math.hypot(dx, dy) || 1e-9;
    const half = ring.thickness / 2;
    const outer = ring.radius + half;
    if (d - b.r > outer) return; // clear of the ring
    const gap = this.gapAt(ring, Math.atan2(dy, dx) - ring.angle);
    if (gap) {
      if (d + b.r < ring.radius - half) b.escaped[idx] = false; // back inside
      else {
        this.collideCap(b, ring, idx, gap.at - gap.width / 2, true);
        this.collideCap(b, ring, idx, gap.at + gap.width / 2, true);
      }
      return;
    }
    if (d < ring.radius) {
      b.escaped[idx] = false; // inside the wall's midline: treat as captured again
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

  private collideCap(b: Ball, ring: Ring, idx: number, edge: number, silent = false): void {
    const a = ring.angle + edge;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = ring.x + ring.radius * ca;
    const py = ring.y + ring.radius * sa;
    const ex = b.x - px;
    const ey = b.y - py;
    const dist = Math.hypot(ex, ey);
    const min = b.r + ring.thickness / 2;
    if (dist >= min || dist < 1e-9) return;
    const nx = ex / dist;
    const ny = ey / dist;
    b.x = px + nx * min;
    b.y = py + ny * min;
    // The cap moves with the ring's spin; bounce off it in its own frame.
    const cvx = -ring.spin * ring.radius * sa;
    const cvy = ring.spin * ring.radius * ca;
    const vn = (b.vx - cvx) * nx + (b.vy - cvy) * ny;
    if (vn < 0) {
      const e = this.scene.world.restitution * (silent ? 0.6 : 1);
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      if (!silent) this.onBounce(b, ring, idx, -vn);
    }
  }

  private collideBalls(): void {
    const e = this.scene.world.restitution;
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.alive) continue;
      const layerA = a.escaped.reduce((n, v) => n + (v ? 1 : 0), 0);
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        // Only balls in the same layer (same number of rings escaped) touch,
        // so balls never collide through a wall.
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
          const j2 = (-(1 + e) * rvn) / (1 / ma + 1 / mb);
          a.vx -= (j2 * nx) / ma;
          a.vy -= (j2 * ny) / ma;
          b.vx += (j2 * nx) / mb;
          b.vy += (j2 * ny) / mb;
          this.restoreEnergy(a);
          this.restoreEnergy(b);
          if (-rvn > 40) this.emit('hit', a, -1, -rvn);
        }
      }
    }
  }

  private onBounce(b: Ball, ring: Ring, idx: number, strength: number): void {
    this.restoreEnergy(b);
    if (strength < BOUNCE_THRESHOLD) return;
    this.bounces++;
    this.emit('bounce', b, idx, strength);
    this.applyActions(this.bounceRules, b, ring);
  }

  private escape(b: Ball, ring: Ring, idx: number): void {
    if (b.escaped[idx]) return;
    b.escaped[idx] = true;
    this.escapes++;
    if (!b.everEscaped[idx]) {
      b.everEscaped[idx] = true;
      this.uniqueEscapes++;
    }
    if (this.firstEscapeStep < 0) this.firstEscapeStep = this.stepCount;
    this.emit('escape', b, idx, Math.hypot(b.vx, b.vy));
    this.applyActions(this.escapeRules, b, ring);
  }

  private applyActions(actions: Action[], b: Ball, ring: Ring): void {
    const g = this.scene.world.gravity;
    for (const act of actions) {
      switch (act.do) {
        case 'grow': {
          // Never grow past 92% of the innermost ring still holding the ball.
          let cap = act.max;
          this.rings.forEach((r, i) => {
            if (!b.escaped[i]) cap = Math.min(cap, (r.radius - r.thickness / 2) * 0.92);
          });
          b.r = Math.min(cap, b.r + act.amount);
          if (b.r >= cap - 1e-9) this.filled = true;
          break;
        }
        case 'shrinkGap':
          for (const gap of ring.gaps) gap.width = Math.max(act.min * DEG, gap.width - act.amount * DEG);
          break;
        case 'speedUp': {
          const s = Math.hypot(b.vx, b.vy);
          if (s > 1e-6) {
            const k = Math.min(act.max, s * act.factor) / s;
            b.vx *= k;
            b.vy *= k;
          }
          b.energy = 0.5 * (b.vx * b.vx + b.vy * b.vy) - g * b.y;
          break;
        }
        case 'spawn':
          for (let i = 0; i < act.count; i++) {
            if (this.aliveCount >= this.scene.world.maxBalls) break;
            this.spawnBall({ ...this.template, direction: undefined }, ring.x, ring.y, 30);
          }
          break;
      }
    }
  }

  private emit(type: SimEventType, b: Ball, ring: number, speed: number): void {
    this.events.push({ step: this.stepCount, type, ball: b.id, ring, x: b.x, y: b.y, speed });
  }

  private checkEnd(): void {
    const { duration } = this.scene;
    if (this.endStep === Infinity && duration.endOn !== 'never') {
      let reason = '';
      if (this.filled) reason = 'filled';
      else if (duration.endOn === 'firstEscape' && this.escapes > 0) reason = 'escaped';
      else if (
        duration.endOn === 'allEscaped' &&
        this.escapes > 0 &&
        this.balls.every((b) => !b.alive || b.escaped.every(Boolean))
      )
        reason = 'allEscaped';
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
