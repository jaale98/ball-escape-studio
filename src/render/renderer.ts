import { Rng } from '../engine/rng';
import { HEIGHT, PHYSICS_HZ, type Scene, WIDTH } from '../engine/scene';
import type { World } from '../engine/world';

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
  private particles: Particle[] = [];
  private rng: Rng;
  private cursor = 0;
  private ringFlash: number[] = [];
  private ringFlashColor: string[] = [];
  private escapeFlash = 0;
  private lastFlashStep = -Infinity;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
  ) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.rng = new Rng(scene.seed, 'fx');
  }

  /** Draw the current state. dt = seconds since the previous frame (1/60 for export, 0 when paused). */
  render(world: World, dt: number): void {
    const { ctx, scene } = this;
    const { style } = scene;
    this.consumeEvents(world);

    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Trails: redraw the last few positions with decaying opacity. Drawing
    // from history (not a fading buffer) leaves no ghosting residue.
    if (dt > 0 && style.trail > 0) {
      this.history.push(world.balls.filter((b) => b.alive).map((b) => ({ x: b.x, y: b.y, r: b.r, color: b.color })));
      const keep = Math.min(60, Math.ceil(Math.log(0.03) / Math.log(style.trail)));
      if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
    }
    const n = this.history.length;
    for (let i = 0; i < n - 1; i++) {
      ctx.globalAlpha = 0.5 * style.trail ** (n - 1 - i);
      for (const p of this.history[i]) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const glow = style.glow && world.aliveCount <= 60;

    // Rings.
    ctx.lineCap = 'round';
    for (const ring of world.rings) {
      const flash = this.ringFlash[ring.id] ?? 0;
      ctx.lineWidth = ring.thickness;
      if (glow) {
        ctx.shadowBlur = 18 + 30 * flash;
        ctx.shadowColor = flash > 0.05 ? this.ringFlashColor[ring.id] : ring.color;
      }
      this.strokeRing(ring, ring.color, 1);
      if (flash > 0.02) this.strokeRing(ring, this.ringFlashColor[ring.id], flash);
    }
    ctx.shadowBlur = 0;

    // Balls.
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
    }

    // Particles.
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

    // Decay flashes.
    const decay = Math.exp(-dt * 7);
    for (let i = 0; i < this.ringFlash.length; i++) this.ringFlash[i] = (this.ringFlash[i] ?? 0) * decay;
    if (this.escapeFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${(this.escapeFlash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    this.escapeFlash *= Math.exp(-dt * 5);

    this.drawOverlay(world);
  }

  private strokeRing(ring: World['rings'][number], color: string, alpha: number): void {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    const gaps = [...ring.gaps].sort((a, b) => a.at - b.at);
    ctx.beginPath();
    if (gaps.length === 0) {
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    } else {
      for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i];
        const next = gaps[(i + 1) % gaps.length];
        const start = g.at + g.width / 2;
        let end = next.at - next.width / 2;
        if (i === gaps.length - 1) end += Math.PI * 2;
        if (end <= start) continue;
        ctx.moveTo(ring.x + ring.radius * Math.cos(ring.angle + start), ring.y + ring.radius * Math.sin(ring.angle + start));
        ctx.arc(ring.x, ring.y, ring.radius, ring.angle + start, ring.angle + end);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private consumeEvents(world: World): void {
    const ballColor = (id: number) => world.balls[id]?.color ?? '#ffffff';
    for (; this.cursor < world.events.length; this.cursor++) {
      const e = world.events[this.cursor];
      if (e.type === 'bounce') {
        if (e.ring >= 0) {
          this.ringFlash[e.ring] = 1;
          this.ringFlashColor[e.ring] = ballColor(e.ball);
        }
        this.burst(e.x, e.y, ballColor(e.ball), 8, 260);
      } else if (e.type === 'escape') {
        // Flash only for escapes at least a second apart, so constant escapes
        // (multiply scenes) don't wash the frame out.
        if (e.step - this.lastFlashStep >= PHYSICS_HZ) {
          this.escapeFlash = 1;
          this.lastFlashStep = e.step;
        }
        this.burst(e.x, e.y, ballColor(e.ball), 40, 700);
        this.burst(e.x, e.y, '#ffffff', 16, 500);
      } else if (e.type === 'spawn' && e.step > 0) {
        this.burst(e.x, e.y, ballColor(e.ball), 6, 160);
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

  private drawOverlay(world: World): void {
    const { ctx } = this;
    const { overlay } = this.scene;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    if (overlay.title) {
      ctx.font = `800 76px ${FONT}`;
      this.fillWrapped(overlay.title, WIDTH / 2, 250, 940, 88);
    }
    if (overlay.subtitle) {
      ctx.font = `500 40px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.fillWrapped(overlay.subtitle, WIDTH / 2, overlay.title && overlay.title.length > 22 ? 430 : 340, 900, 50);
    }

    const parts: string[] = [];
    if (overlay.counter === 'bounces') parts.push(`${world.bounces} bounces`);
    if (overlay.counter === 'balls') parts.push(`${world.aliveCount} balls`);
    if (overlay.counter === 'escaped') parts.push(`${world.uniqueEscapes} escaped`);
    if (overlay.timer) {
      const secs = world.stepCount / PHYSICS_HZ;
      parts.push(`${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`);
    }
    if (parts.length) {
      ctx.font = `700 52px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(parts.join('   ·   '), WIDTH / 2, 1700);
    }
    ctx.shadowBlur = 0;
  }

  private fillWrapped(text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
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
  }
}
