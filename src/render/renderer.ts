import { Rng } from '../engine/rng';
import { HEIGHT, PHYSICS_HZ, type Scene, WIDTH } from '../engine/scene';
import type { Container, World } from '../engine/world';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif';

/**
 * Draws a World onto a 1080x1920 canvas. Visual effects are driven only by
 * the world's event log, its own seeded RNG, and the dt it is given, so the
 * same sequence of render() calls always produces the same frames.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Recent ball positions, newest last; one snapshot per rendered frame. */
  private history: { x: number; y: number; r: number; color: string }[][] = [];
  /** Permanent paint layer (style.paint). */
  private paint: HTMLCanvasElement | null = null;
  private particles: Particle[] = [];
  private rng: Rng;
  private cursor = 0;
  private flash = new Map<string, { amount: number; color: string }>();
  private escapeFlash = 0;
  private lastFlashStep = -Infinity;
  private banner = 0;
  private readonly scale: number;
  private readonly glowAllowed: boolean;

  /**
   * @param opts.scale  draw at this fraction of 1080x1920 (mini previews use ~0.25)
   * @param opts.glow   allow glow effects (off for mini previews: they're costly)
   */
  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    opts: { scale?: number; glow?: boolean } = {},
  ) {
    this.scale = opts.scale ?? 1;
    this.glowAllowed = opts.glow ?? true;
    canvas.width = Math.round(WIDTH * this.scale);
    canvas.height = Math.round(HEIGHT * this.scale);
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.rng = new Rng(scene.seed, 'fx');
    if (scene.style.paint) {
      this.paint = document.createElement('canvas');
      this.paint.width = canvas.width;
      this.paint.height = canvas.height;
      const p = this.paint.getContext('2d')!;
      p.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      p.fillStyle = scene.style.background;
      p.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  /** Draw the current state. dt = seconds since the previous frame (1/60 for export, 0 when paused). */
  render(world: World, dt: number): void {
    const { ctx, scene } = this;
    const { style } = scene;
    this.consumeEvents(world);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    // Background, or the paint layer with this frame's paint added.
    if (this.paint) {
      const p = this.paint.getContext('2d')!;
      if (dt > 0) {
        for (const b of world.balls) {
          if (!b.alive) continue;
          p.fillStyle = b.color;
          p.beginPath();
          p.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          p.fill();
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.paint, 0, 0);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    } else {
      ctx.fillStyle = style.background;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    this.drawTrails(world, dt);
    const glow = style.glow && this.glowAllowed && world.aliveCount <= 60;
    this.drawZones(world);
    this.drawSolids(world, glow);
    this.drawContainers(world, glow);
    this.drawBalls(world, glow);
    this.drawParticles(dt);

    // Decay flashes.
    const decay = Math.exp(-dt * 7);
    for (const f of this.flash.values()) f.amount *= decay;
    if (this.escapeFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${(this.escapeFlash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    this.escapeFlash *= Math.exp(-dt * 5);

    this.drawOverlay(world, dt);
  }

  // ---- layers -------------------------------------------------------------

  private drawTrails(world: World, dt: number): void {
    const { ctx } = this;
    const trail = this.scene.style.trail;
    if (trail <= 0) return;
    if (dt > 0) {
      this.history.push(world.balls.filter((b) => b.alive).map((b) => ({ x: b.x, y: b.y, r: b.r, color: b.color })));
      const keep = Math.min(60, Math.ceil(Math.log(0.03) / Math.log(trail)));
      if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
    }
    const n = this.history.length;
    for (let i = 0; i < n - 1; i++) {
      ctx.globalAlpha = 0.5 * trail ** (n - 1 - i);
      for (const p of this.history[i]) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawZones(world: World): void {
    if (!this.scene.overlay.zones || !world.zones.length) return;
    const { ctx } = this;
    const max = Math.max(1, ...world.zones.map((z) => z.count));
    ctx.textAlign = 'center';
    for (const z of world.zones) {
      // Fill level shows the share of the busiest bin.
      const h = (z.height * z.count) / max;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(z.x, z.y + z.height - h, z.width, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${Math.round(Math.min(44, z.width * 0.42))}px ${FONT}`;
      ctx.fillText(String(z.count), z.x + z.width / 2, z.y + z.height + 56);
      if (z.label) {
        ctx.font = `600 22px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(z.label, z.x + z.width / 2, z.y + z.height + 88);
      }
    }
  }

  private drawSolids(world: World, glow: boolean): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const s of world.solids) {
      const f = this.flash.get(`s${s.id}`);
      const amt = f?.amount ?? 0;
      const color = amt > 0.05 ? f!.color : s.color;
      if (glow && amt > 0.05) {
        ctx.shadowBlur = 24 * amt;
        ctx.shadowColor = color;
      }
      if (s.kind === 'peg') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s.x1, s.y1, s.half * (1 + 0.35 * amt), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = s.half * 2;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }

  private drawContainers(world: World, glow: boolean): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const c of world.containers) {
      const f = this.flash.get(`c${c.id}`);
      const amt = f?.amount ?? 0;
      ctx.lineWidth = c.thickness;
      if (glow) {
        ctx.shadowBlur = 18 + 30 * amt;
        ctx.shadowColor = amt > 0.05 ? f!.color : c.color;
      }
      this.strokeContainer(world, c, c.color, 1);
      if (amt > 0.02) this.strokeContainer(world, c, f!.color, amt);
    }
    ctx.shadowBlur = 0;
  }

  private strokeContainer(world: World, c: Container, color: string, alpha: number): void {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (c.kind === 'poly') {
      // Join consecutive segments so corners render as proper joins.
      let lastX = Infinity;
      let lastY = Infinity;
      for (const [ax, ay, bx, by] of world.polySegments(c)) {
        if (!(Math.abs(ax - lastX) < 0.01 && Math.abs(ay - lastY) < 0.01)) ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        lastX = bx;
        lastY = by;
      }
    } else {
      const gaps = [...c.gaps].sort((a, b) => a.at - b.at);
      if (gaps.length === 0) {
        ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      } else {
        for (let i = 0; i < gaps.length; i++) {
          const g = gaps[i];
          const next = gaps[(i + 1) % gaps.length];
          const start = g.at + g.width / 2;
          let end = next.at - next.width / 2;
          if (i === gaps.length - 1) end += Math.PI * 2;
          if (end <= start) continue;
          ctx.moveTo(c.x + c.radius * Math.cos(c.angle + start), c.y + c.radius * Math.sin(c.angle + start));
          ctx.arc(c.x, c.y, c.radius, c.angle + start, c.angle + end);
        }
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawBalls(world: World, glow: boolean): void {
    const { ctx } = this;
    const showHp = this.scene.style.showHp;
    for (const b of world.balls) {
      if (!b.alive) continue;
      if (glow) {
        ctx.shadowBlur = 28;
        ctx.shadowColor = b.color;
      }
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, b.r * 0.12);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();

      const hasHp = showHp && b.hp !== undefined && !!b.maxHp;
      if (hasHp) {
        // Remaining hp as an arc around the ball, and the number inside.
        const ring = b.r + Math.max(6, b.r * 0.22);
        ctx.lineWidth = Math.max(5, b.r * 0.18);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, ring, 0, Math.PI * 2);
        ctx.stroke();
        const frac = Math.max(0, b.hp! / b.maxHp!);
        ctx.strokeStyle = frac > 0.5 ? '#7cff6b' : frac > 0.25 ? '#ffd23f' : '#ff4d6d';
        ctx.beginPath();
        ctx.arc(b.x, b.y, ring, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        if (b.r >= 16) {
          ctx.fillStyle = '#0b0b10';
          ctx.font = `800 ${Math.round(b.r * 0.9)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(Math.ceil(b.hp!)), b.x, b.y + 1);
          ctx.textBaseline = 'alphabetic';
        }
      }
      if (b.label) {
        ctx.font = `700 26px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.label, b.x, b.y + b.r + (hasHp ? 48 : 32));
        ctx.shadowBlur = 0;
      }
    }
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    for (const p of this.particles) {
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private consumeEvents(world: World): void {
    const ballColor = (id: number) => world.balls[id]?.color ?? '#ffffff';
    for (; this.cursor < world.events.length; this.cursor++) {
      const e = world.events[this.cursor];
      switch (e.type) {
        case 'bounce':
          if (e.ring >= 0) this.flash.set(`c${e.ring}`, { amount: 1, color: ballColor(e.ball) });
          if (e.solid >= 0) this.flash.set(`s${e.solid}`, { amount: 1, color: ballColor(e.ball) });
          this.burst(e.x, e.y, ballColor(e.ball), e.solid >= 0 ? 3 : 8, 260);
          break;
        case 'escape':
          // Flash only for escapes at least a second apart, so constant
          // escapes (multiply scenes) don't wash the frame out.
          if (e.step - this.lastFlashStep >= PHYSICS_HZ) {
            this.escapeFlash = 1;
            this.lastFlashStep = e.step;
          }
          this.burst(e.x, e.y, ballColor(e.ball), 40, 700);
          this.burst(e.x, e.y, '#ffffff', 16, 500);
          break;
        case 'hit':
          this.burst(e.x, e.y, '#ffffff', 6, 380);
          break;
        case 'eliminate':
          this.burst(e.x, e.y, ballColor(e.ball), 60, 800);
          this.burst(e.x, e.y, '#ffffff', 20, 500);
          break;
        case 'spawn':
          if (e.step > 0) this.burst(e.x, e.y, ballColor(e.ball), 6, 160);
          break;
        default:
          break;
      }
    }
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  private burst(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.25, 1) * speed;
      const life = this.rng.range(0.25, 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, size: this.rng.range(2, 5), color });
    }
  }

  private drawOverlay(world: World, dt: number): void {
    const { ctx } = this;
    const { overlay } = this.scene;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    let y = 250;
    if (overlay.title) {
      ctx.font = `800 76px ${FONT}`;
      y = this.fillWrapped(overlay.title, WIDTH / 2, y, 940, 88) + 70;
    }
    if (overlay.subtitle) {
      ctx.font = `500 40px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.fillWrapped(overlay.subtitle, WIDTH / 2, y, 900, 50);
    }

    const parts: string[] = [];
    if (overlay.counter === 'bounces') parts.push(`${world.bounces} bounces`);
    if (overlay.counter === 'balls') parts.push(`${world.aliveCount} ${world.aliveCount === 1 ? 'ball' : 'balls'}`);
    if (overlay.counter === 'escaped') parts.push(`${world.uniqueEscapes} escaped`);
    if (overlay.timer) {
      const secs = world.stepCount / PHYSICS_HZ;
      parts.push(`${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`);
    }
    if (parts.length) {
      ctx.font = `700 52px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(parts.join('   ·   '), WIDTH / 2, world.zones.length && overlay.zones ? 1830 : 1700);
    }
    ctx.shadowBlur = 0;

    // Winner banner once a race or battle is decided.
    if (overlay.winner && world.winner >= 0 && world.endReason) {
      this.banner = Math.min(1, this.banner + dt * 4);
      const w = world.balls[world.winner];
      const a = this.banner;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, HEIGHT / 2 - 140, WIDTH, 280);
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2 - 45, 48 * (0.6 + 0.4 * a), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 72px ${FONT}`;
      ctx.fillText(w.label ? `${w.label} wins!` : 'Winner!', WIDTH / 2, HEIGHT / 2 + 85);
      ctx.globalAlpha = 1;
    }
  }

  /** Draw word-wrapped text; returns the baseline y of the last line. */
  private fillWrapped(text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
    const words = text.split(/\s+/);
    let line = '';
    let yy = y;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (this.ctx.measureText(test).width > maxWidth && line) {
        this.ctx.fillText(line, x, yy);
        line = w;
        yy += lineHeight;
      } else line = test;
    }
    if (line) this.ctx.fillText(line, x, yy);
    return yy;
  }
}
