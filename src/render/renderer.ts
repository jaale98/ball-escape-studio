import { Rng } from '../engine/rng';
import { HEIGHT, PHYSICS_HZ, racesClock, type Scene, WIDTH } from '../engine/scene';
import type { Ball, Container, Pendulum, Solid, World } from '../engine/world';
import { getImage } from '../images';
import { GlBallLayer } from './gl';
import { type RenderOptions, SAFE_RECT, type SafeLook, TEXT_BAND, TIKTOK_ZONES, TRAIL_ALPHA } from './look';

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

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  life: number;
  w: number;
  h: number;
  color: string;
}

/** A ball the WebGL layer can draw alone (no shape, weapon, label, hp or special style). */
function isPlain(b: Ball, flat: boolean): boolean {
  return flat && b.shape === 'circle' && !b.weapon && !b.label && b.hp === undefined && !b.image && !b.emoji && !b.projectile;
}

const FONTS: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", -apple-system, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  condensed: 'Impact, "Haettenschweiler", "Arial Narrow Bold", "Oswald", sans-serif',
};
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Draw an image to cover a w×h box centred on (cx, cy), like CSS object-fit: cover. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number): void {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif';
const TAU = Math.PI * 2;
/** Wrap an angle to (-PI, PI]. */
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** A repeatable pseudo-random number in [0, 1) for an integer (frame-locked jitter that doesn't use up an Rng). */
const hash01 = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Cap every glow (shadowBlur) on this one context. Glows are drawn from many places; capping the
 * setter keeps the safe style in one spot instead of a check at each call.
 */
function capShadowBlur(ctx: CanvasRenderingContext2D, max: number): void {
  const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur');
  if (!desc?.get || !desc.set) return;
  const { get, set } = desc;
  Object.defineProperty(ctx, 'shadowBlur', {
    configurable: true,
    get() {
      return get.call(this);
    },
    set(v: number) {
      set.call(this, Math.min(v, max));
    },
  });
}

/** A 256x256 tile of faint gray noise (overlaid at a few percent, it hides 8-bit gradient steps). */
function makeDither(rng: Rng): HTMLCanvasElement {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rng.next() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Draws a World onto a 1080x1920 canvas. Visual effects are driven only by
 * the world's event log, its own seeded RNGs, and the dt it is given, so the
 * same sequence of render() calls always produces the same frames.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Recent ball positions, newest last; one snapshot per rendered frame. */
  private history: { id: number; x: number; y: number; r: number; color: string }[][] = [];
  /** Permanent paint layer (style.paint). */
  private paint: HTMLCanvasElement | null = null;
  /** Permanent string-art layer (style.lines). */
  private lines: HTMLCanvasElement | null = null;
  private lastBounce = new Map<number, [number, number][]>();
  private particles: Particle[] = [];
  private confetti: Confetti[] = [];
  private rng: Rng;
  private rngFx2: Rng;
  private cursor = 0;
  private flash = new Map<string, { amount: number; color: string }>();
  private escapeFlash = 0;
  private lastFlashStep = -Infinity;
  private banner = 0;
  /** Where the countdown sits (fixed on the first frame drawn). */
  private countdownY = -1;
  private finishers: { ball: number; step: number }[] = [];
  private readonly scale: number;
  private readonly glowAllowed: boolean;
  /** Video frame rate these frames are for; per-frame effects (trails) are scaled so they last the same in seconds. */
  private readonly fps: number;
  /** The tiktok-safe style, or null for the scene's own look. */
  private readonly safe: SafeLook | null;
  /** Static noise tile that breaks up gradient banding (safe style, gradients: 'dither'). */
  private dither: HTMLCanvasElement | null = null;
  /** Drawing-only fit of the playfield into the TikTok safe area (scale and offset in canvas px). */
  private fitS = 1;
  private fitX = 0;
  private fitY = 0;
  private fitDone = false;
  /** Preview only: shade the areas TikTok covers with its UI. Never set for exports. */
  showSafeZones = false;
  /** WebGL layer for plain balls and trails in crowd scenes (null = Canvas 2D only). */
  private gl: GlBallLayer | null = null;
  /** Seconds of frames rendered (drives backdrops and pulsing). */
  private clock = 0;
  /** colorMode 'bounce': palette index per ball. */
  private bounceColor = new Map<number, number>();
  /** Camera state. */
  private camX = WIDTH / 2;
  private camY = HEIGHT / 2;
  private camZoom = 1;
  private camInit = false;
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private chroma = 0;
  /** chase + orient: view rotation (radians). */
  private camRot = 0;
  /** Glitch tearing amount (style.glitch), 0–1. */
  private glitch = 0;
  private readonly rngGlitch: Rng;
  /** Thousands of rings: cull what's off-screen, and keep per-escape effects small. */
  private manyRings = false;
  /** The current streak of escapes (each within 0.4 s of the last). */
  private streak = 0;
  private streakStep = -Infinity;
  /** Seconds since the streak last grew (drives the streak counter's pop and fade). */
  private streakAge = 99;
  private streakShown = 0;
  private ripples: { x: number; y: number; t: number; color: string }[] = [];
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private grain: HTMLCanvasElement | null = null;
  private scan: CanvasPattern | null = null;
  private fxBuf: HTMLCanvasElement | null = null;
  private territoryImg: { canvas: HTMLCanvasElement; data: ImageData; colors: [number, number, number][] } | null = null;
  private pendulumTrails: [number, number][][] = [];
  private confettiDone = false;
  /** Seconds left in the countdown intro (set by the player before each frame). */
  intro = 0;
  /** camera.unease: extra view rotation (radians). */
  private tilt = 0;
  /** style.darkness: the dark layer, with holes of light cut out around the balls. */
  private dark: HTMLCanvasElement | null = null;
  /** 0–1: how close a stalker is to its prey (red edges, a tremble). */
  private dread = 0;
  /** A stalker caught a ball: a red slam that fades. */
  private caughtFlash = 0;
  /** Seconds a forced subliminal flash (big moments) keeps showing, and which word. */
  private subForced = 0;
  private subIndex = 0;

  /**
   * @param opts  scale, glow, fps and the tiktok-safe style (see render/look.ts)
   */
  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    opts: RenderOptions = {},
  ) {
    this.scale = opts.scale ?? 1;
    this.fps = opts.fps ?? 60;
    this.safe = opts.safe ?? null;
    this.glowAllowed = (opts.glow ?? true) && (!this.safe || this.safe.maxGlow > 0);
    canvas.width = Math.round(WIDTH * this.scale);
    canvas.height = Math.round(HEIGHT * this.scale);
    // Canvas 2D anti-aliases every shape; keep image smoothing on as well (crisp edges, no stair-steps).
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    if (this.safe) capShadowBlur(this.ctx, this.safe.maxGlow);
    this.rng = new Rng(scene.seed, 'fx');
    this.rngFx2 = new Rng(scene.seed, 'fx2');
    this.rngGlitch = new Rng(scene.seed, 'glitch');
    const startBalls = scene.entities.reduce((n, e) => n + (e.type === 'ball' ? e.count * (e.copies ?? 1) : e.type === 'emitter' ? Math.min(e.count, 400) : 0), 0);
    const crowd = scene.world.maxBalls >= 400 || startBalls >= 80;
    if (scene.style.renderer === 'webgl' || (scene.style.renderer === 'auto' && crowd)) {
      try {
        this.gl = GlBallLayer.create(this.scale);
      } catch {
        this.gl = null; // fall back to Canvas 2D
      }
    }
    const layer = () => {
      const c = makeCanvas(canvas.width, canvas.height);
      c.getContext('2d')!.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      return c;
    };
    if (scene.style.paint) this.paint = layer();
    if (scene.style.lines !== 'none' && scene.style.lines !== 'tether') this.lines = layer();
    const { style } = scene;
    if (style.backdrop === 'stars') {
      const r = new Rng(scene.seed, 'stars');
      for (let i = 0; i < 170; i++) this.stars.push({ x: r.range(0, WIDTH), y: r.range(0, HEIGHT), r: r.range(0.6, 2.4), tw: r.range(0, TAU) });
    }
    const noise = !this.safe?.dropNoise;
    if (this.safe?.gradients === 'dither') this.dither = makeDither(new Rng(scene.seed, 'dither'));
    if (style.grain && noise) {
      this.grain = makeCanvas(256, 256);
      const g = this.grain.getContext('2d')!;
      const img = g.createImageData(256, 256);
      const r = new Rng(scene.seed, 'grain');
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(r.next() * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    if (style.scanlines && noise) {
      const p = makeCanvas(4, 4);
      const g = p.getContext('2d')!;
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(0, 0, 4, 2);
      this.scan = this.ctx.createPattern(p, 'repeat');
    }
    if (!this.safe && (style.bloom || style.chromatic || style.glitch)) this.fxBuf = makeCanvas(canvas.width, canvas.height);
    if ((style.mirror !== 'none' || style.droste > 0) && !this.fxBuf) this.fxBuf = makeCanvas(canvas.width, canvas.height);
    if (style.darkness > 0) this.dark = makeCanvas(canvas.width, canvas.height);
  }

  /** Draw the current state. dt = seconds since the previous frame (1/60 for export, 0 when paused). */
  render(world: World, dt: number): void {
    const { ctx, scene } = this;
    const { style } = scene;
    this.clock += dt;
    if (!this.fitDone) this.computeFit(world);
    this.consumeEvents(world);
    this.updateCamera(world, dt);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';

    // Background (colour, or picture darkened by backgroundDim), then the backdrop.
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const bg = getImage(style.backgroundImage);
    if (bg) {
      drawCover(ctx, bg, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT);
      if (style.backgroundDim > 0) {
        ctx.fillStyle = `rgba(0,0,0,${style.backgroundDim})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    }
    this.drawBackdrop();
    if (this.dither && (style.backdrop === 'gradient' || style.vignette || bg)) this.drawDither();

    const aperture = scene.camera.aperture;
    if (aperture) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.fitX + this.fitS * WIDTH / 2, this.fitY + this.fitS * HEIGHT / 2, aperture * this.fitS, 0, TAU);
      ctx.clip();
    }
    this.worldTransform();
    if (this.paint) {
      const p = this.paint.getContext('2d')!;
      if (dt > 0) {
        for (const b of world.balls) {
          if (!b.alive || b.projectile) continue;
          p.fillStyle = this.colorOf(b, world);
          p.beginPath();
          p.arc(b.x, b.y, b.r, 0, TAU);
          p.fill();
        }
      }
      ctx.drawImage(this.paint, 0, 0, WIDTH, HEIGHT);
    }
    this.drawRipples(dt);
    if (world.territory) this.drawTerritory(world);
    if (this.lines) ctx.drawImage(this.lines, 0, 0, WIDTH, HEIGHT);

    this.recordHistory(world, dt);
    if (!this.gl) this.drawTrails();
    const glow = style.glow && this.glowAllowed && world.aliveCount <= 60;
    this.drawZones(world);
    this.drawForces(world);
    this.drawPortals(world);
    this.drawSolids(world, glow);
    this.drawContainers(world, glow && world.containers.length <= 24);
    this.drawPendulums(world, dt, glow);
    if (style.lines === 'tether') this.drawTethers(world);
    if (this.gl) this.drawGl(world);
    this.drawBalls(world, glow, !!this.gl);
    if (world.stalkers.length) this.drawStalkers(world, dt, false);
    this.drawParticles(dt);
    this.drawConfetti(dt);
    if (aperture) ctx.restore();
    if (this.fxBuf && style.droste > 0) {
      // The room repeats; the balls (and whatever follows them) stay on top, in the real room.
      this.drawDroste(style.droste, world);
      this.worldTransform();
      this.drawBalls(world, glow, !!this.gl);
      if (world.stalkers.length) this.drawStalkers(world, 0, false);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    }
    if (this.dark) this.drawDarkness(world);
    if (world.stalkers.length) {
      // The eyes glow through the dark.
      this.worldTransform();
      this.drawStalkers(world, dt, true);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      this.drawDread(dt);
    }
    if (scene.camera.mode === 'chase') this.drawEdgeFade();

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    // Decay flashes.
    const decay = Math.exp(-dt * 7);
    for (const f of this.flash.values()) f.amount *= decay;
    if (this.escapeFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${(this.escapeFlash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    this.escapeFlash *= Math.exp(-dt * 5);

    this.drawPost(dt);
    this.drawOverlay(world, dt);
    if (style.subliminal?.length) this.drawSubliminal(world, dt);
    if (this.showSafeZones) this.drawSafeZones();
  }

  // ---- horror: stalkers, darkness, subliminal frames ----------------------------

  /**
   * Stalkers: a shadow that won't hold still, with two eyes on its prey. The
   * body is drawn with the world (so darkness hides it); the eyes again after
   * the dark layer (eyesOnly), so they glow even with the lights out.
   */
  private drawStalkers(world: World, dt: number, eyesOnly: boolean): void {
    const { ctx } = this;
    const t = world.time;
    const tick = Math.floor(t * 30);
    let dread = 0;
    for (const s of world.stalkers) {
      if (!s.visible) continue;
      const awake = world.stepCount >= s.startStep;
      const dir = Math.atan2(s.lookY - s.y, s.lookX - s.x);
      if (!eyesOnly) {
        for (const b of world.balls) {
          if (!b.alive || b.projectile) continue;
          const gap = Math.hypot(b.x - s.x, b.y - s.y) - s.r - b.r;
          dread = Math.max(dread, Math.min(1, Math.max(0, 1 - gap / 360)));
        }
        if (s.emoji) {
          ctx.save();
          ctx.font = `${Math.round(s.r * 2.3)}px ${EMOJI_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.translate(s.x + (hash01(tick + s.id * 31) - 0.5) * 3, s.y + (hash01(tick * 1.7 + s.id) - 0.5) * 3);
          ctx.fillText(s.emoji, 0, 0);
          ctx.restore();
          continue;
        }
        // A smear of darkness that never quite holds its shape.
        ctx.save();
        const halo = ctx.createRadialGradient(s.x, s.y, s.r * 0.4, s.x, s.y, s.r * 2.6);
        halo.addColorStop(0, 'rgba(0,0,0,0.55)');
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 2.6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = s.color;
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * TAU + t * (k % 2 ? 0.7 : -0.5);
          const wob = 0.55 + 0.5 * hash01(tick * 0.5 + k * 13 + s.id * 7);
          ctx.globalAlpha = 0.5 + 0.4 * hash01(k * 3 + tick * 0.25);
          ctx.beginPath();
          ctx.arc(s.x + Math.cos(a) * s.r * 0.55 * wob, s.y + Math.sin(a) * s.r * 0.55 * wob, s.r * (0.45 + 0.25 * wob), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 0.78, 0, TAU);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (s.emoji) continue;
      // Eyes: they look at the prey, blink now and then, and stay shut until it wakes.
      const blink = !awake || hash01(Math.floor(t * 3) * 1.3 + s.id * 17) < 0.07;
      const px = -Math.sin(dir);
      const py = Math.cos(dir);
      const fx = Math.cos(dir) * s.r * 0.22;
      const fy = Math.sin(dir) * s.r * 0.22;
      ctx.save();
      ctx.fillStyle = s.eyes;
      ctx.shadowColor = s.eyes;
      ctx.shadowBlur = this.glowAllowed ? 22 : 0;
      for (const side of [-1, 1]) {
        const ex = s.x + fx + px * side * s.r * 0.3;
        const ey = s.y + fy + py * side * s.r * 0.3;
        ctx.beginPath();
        ctx.ellipse(ex, ey, s.r * 0.15, blink ? s.r * 0.025 : s.r * 0.1, dir + side * 0.25, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    if (!eyesOnly) {
      const k = dt > 0 ? 1 - Math.exp(-dt * 6) : 0;
      this.dread += (dread - this.dread) * k;
    }
  }

  /** Something is close: the frame's edges bleed red and the picture trembles. */
  private drawDread(dt: number): void {
    const { ctx } = this;
    const { camera, style } = this.scene;
    if (this.dread > 0.05) {
      if (camera.shake > 0) this.shake = Math.max(this.shake, this.dread * 0.22);
      if (style.chromatic) this.chroma = Math.max(this.chroma, this.dread * 0.5);
      const a = this.dread * 0.55;
      const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.25, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.62);
      g.addColorStop(0, 'rgba(120,0,10,0)');
      g.addColorStop(1, `rgba(120,0,10,${a.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (this.caughtFlash > 0.01) {
      ctx.fillStyle = `rgba(170,0,20,${(this.caughtFlash * 0.75).toFixed(3)})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    this.caughtFlash *= Math.exp(-dt * 2.2);
  }

  /** style.darkness: black everywhere but a pool of light around each ball; flicker makes the light fail. */
  private drawDarkness(world: World): void {
    const { ctx, scale } = this;
    const { style } = this.scene;
    const d = this.dark!;
    const g = d.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, d.width, d.height);
    let level = 1;
    if (style.flicker) {
      const t = world.time;
      const fast = hash01(Math.floor(t * 18) + 0.5);
      const slow = hash01(Math.floor(t * 1.5) * 3.7 + 11);
      if (slow < 0.14 && (t * 1.5) % 1 < 0.4) level = 0.05;
      else if (fast < 0.1) level = 0.3;
      else if (fast < 0.24) level = 0.72;
    }
    // Every escape lights the room up for a moment.
    level = Math.min(1, level + this.escapeFlash * 0.5);
    g.fillStyle = `rgba(0,0,0,${style.darkness})`;
    g.fillRect(0, 0, d.width, d.height);
    g.globalCompositeOperation = 'destination-out';
    const zoom = scale * this.camZoom * this.fitS;
    let n = 0;
    for (const b of world.balls) {
      if (!b.alive || b.projectile) continue;
      if (++n > 40) break;
      const [sx, sy] = this.toScreen(b.x, b.y);
      const x = sx * scale;
      const y = sy * scale;
      const r = (style.light + b.r) * zoom * (0.8 + 0.2 * level);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(0,0,0,${level})`);
      grad.addColorStop(0.5, `rgba(0,0,0,${(0.8 * level).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(d, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  /** style.subliminal: a word on a single frame, now and then (and on big moments). */
  private drawSubliminal(world: World, dt: number): void {
    const words = this.scene.style.subliminal!;
    const { ctx } = this;
    const t = world.time;
    let idx = -1;
    if (this.subForced > 0) {
      idx = this.subIndex % words.length;
      if (dt > 0) this.subForced -= dt;
    } else if (world.stepCount > 0 && !world.done) {
      const bucket = Math.floor(t * 8);
      if (t - bucket / 8 < 1 / 40 && hash01(bucket * 5.17 + 3) < 0.035) idx = Math.floor(hash01(bucket * 9.1 + 0.3) * words.length);
    }
    if (idx < 0) return;
    const inverted = hash01(Math.floor(t * 8) * 2.3) < 0.5;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.fillStyle = inverted ? '#f2f2f2' : '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = inverted ? '#000000' : '#ff2a2a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 190px ${FONTS.condensed}`;
    ctx.fillText(words[idx].toUpperCase(), WIDTH / 2, HEIGHT / 2, WIDTH - 80);
    ctx.restore();
  }

  // ---- tiktok-safe helpers -------------------------------------------------

  /** A decorative stroke width: thicker in the safe style. */
  private lw(w: number): number {
    return this.safe ? Math.max(this.safe.minStroke, w * this.safe.strokeScale) : w;
  }

  /** A stroke whose width means something physically (ring or wall thickness): only thin ones are widened. */
  private minLw(w: number): number {
    return this.safe ? Math.max(this.safe.minStroke, w) : w;
  }

  /** Per-frame trail fade, adjusted so a trail lasts the same in seconds at any frame rate. */
  private trailDecay(): number {
    return this.scene.style.trail ** (60 / this.fps);
  }

  /** Frames of trail history to keep (same length in seconds at any frame rate; shorter in the safe style). */
  private trailKeep(maxAt60: number, minTrail = 0): number {
    const decay = Math.max(minTrail ** (60 / this.fps), this.trailDecay());
    let keep = Math.min(Math.round((maxAt60 * this.fps) / 60), Math.ceil(Math.log(0.03) / Math.log(decay)));
    if (this.safe) keep = Math.min(keep, Math.max(2, Math.round(this.safe.maxTrailSeconds * this.fps)));
    return Math.max(2, keep);
  }

  /** The ball as drawn: in the safe style, tiny balls are drawn at the minimum radius (collisions are unchanged). */
  private visible(b: Ball): Ball {
    return this.safe && b.r < this.safe.minBallRadius ? { ...b, r: this.safe.minBallRadius } : b;
  }

  /**
   * Safe style: if the playfield (rings, walls, zones, pendulums, starting balls) pokes into TikTok's
   * UI areas, shrink it a little and shift it into the safe rectangle. Drawing only, decided once from
   * the first frame so every frame uses the same fit.
   */
  private computeFit(world: World): void {
    this.fitDone = true;
    this.manyRings = world.containers.length > 60;
    // A chase camera frames the ball, not the playfield: nothing to fit.
    if (!this.safe?.fitSafeZone || this.scene.camera.mode === 'chase') return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (x: number, y: number, r = 0) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    };
    for (const c of world.containers) add(c.x, c.y, c.radius + c.thickness / 2);
    for (const s of world.solids) {
      add(s.x1, s.y1, s.half);
      add(s.x2, s.y2, s.half);
    }
    for (const z of world.zones) {
      add(z.x, z.y);
      add(z.x + z.width, z.y + z.height);
    }
    for (const p of world.pendulums) add(p.x, p.y, p.l1 + p.l2 + p.bob);
    for (const b of world.balls) if (b.alive && !b.projectile) add(b.x, b.y, b.r);
    if (!Number.isFinite(x0)) return;
    // Clamp to the canvas: things already off-screen don't count.
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(WIDTH, x1);
    y1 = Math.min(HEIGHT, y1);
    const m = 16;
    const R = { x0: SAFE_RECT.x0 + m, y0: SAFE_RECT.y0 + m, x1: SAFE_RECT.x1 - m, y1: SAFE_RECT.y1 - m };
    if (x0 >= R.x0 && y0 >= R.y0 && x1 <= R.x1 && y1 <= R.y1) return;
    const w = x1 - x0;
    const h = y1 - y0;
    // Never shrink below 85%: smaller shapes compress worse, which defeats the point.
    const s = Math.max(0.85, Math.min(1, (R.x1 - R.x0) / Math.max(1, w), (R.y1 - R.y0) / Math.max(1, h)));
    // Move the box the least distance that puts it inside the safe area (centered if it can't fit).
    const place = (lo: number, hi: number, rlo: number, rhi: number) => {
      const size = (hi - lo) * s;
      const start = lo * s;
      if (size >= rhi - rlo) return (rlo + rhi) / 2 - (start + size / 2);
      if (start < rlo) return rlo - start;
      if (start + size > rhi) return rhi - (start + size);
      return 0;
    };
    // Shrink about the box's own center first, so a box that already fits on one axis stays put.
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const ox = cx - cx * s;
    const oy = cy - cy * s;
    this.fitS = s;
    this.fitX = ox + place(x0 + ox / s, x1 + ox / s, R.x0, R.x1);
    this.fitY = oy + place(y0 + oy / s, y1 + oy / s, R.y0, R.y1);
  }

  private drawDither(): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.035;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(this.dither!, 'repeat')!;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /** Preview overlay: the parts of the frame TikTok covers with its own UI. */
  private drawSafeZones(): void {
    const { ctx } = this;
    const { top, bottom, right } = TIKTOK_ZONES;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 46, 85, 0.22)';
    ctx.fillRect(0, 0, WIDTH, top);
    ctx.fillRect(0, HEIGHT - bottom, WIDTH, bottom);
    ctx.fillRect(WIDTH - right, top, right, HEIGHT - top - bottom);
    ctx.strokeStyle = 'rgba(255, 46, 85, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 12]);
    ctx.strokeRect(SAFE_RECT.x0 + 1.5, SAFE_RECT.y0, SAFE_RECT.x1 - SAFE_RECT.x0 - 1.5, SAFE_RECT.y1 - SAFE_RECT.y0);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('TikTok top bar', 24, top / 2);
    ctx.fillText('Caption · sound · nav bar', 24, HEIGHT - bottom / 2);
    ctx.save();
    ctx.translate(WIDTH - right / 2, HEIGHT / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Like · comment · share', 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // ---- camera -------------------------------------------------------------

  private updateCamera(world: World, dt: number): void {
    const cam = this.scene.camera;
    let tx = WIDTH / 2;
    let ty = HEIGHT / 2;
    let tz = cam.zoom;
    // unease: never quite level. A slow, uneven tilt (every mode), and a drift and breathing zoom.
    const u = cam.unease;
    const ut = world.time;
    this.tilt = u > 0 ? u * (0.075 * Math.sin(ut * 0.31 + 1.3) + 0.03 * Math.sin(ut * 1.07)) : 0;
    if (u > 0 && cam.mode !== 'chase') {
      tz *= 1 + 0.06 * u * Math.sin(ut * 0.47);
      tx += u * 26 * Math.sin(ut * 0.23);
      ty += u * 34 * Math.sin(ut * 0.19 + 2);
    }
    if (cam.mode === 'follow') {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (const b of world.balls) {
        if (!b.alive || b.projectile || b.anchored) continue;
        sx += b.x;
        sy += b.y;
        n++;
      }
      if (n) {
        tx = WIDTH / 2 + (sx / n - WIDTH / 2) * 0.6;
        ty = HEIGHT / 2 + (sy / n - HEIGHT / 2) * 0.6;
      }
    } else if (cam.mode === 'zoomOut' && world.containers.length) {
      // Frame the innermost ring the lead ball is still inside.
      const lead = world.balls.find((b) => b.alive && !b.projectile);
      const outer = world.containers.reduce((a, b) => a.radius > b.radius ? a : b);
      let r = outer.radius;
      let cx = outer.x;
      let cy = outer.y;
      if (lead) {
        let best = Infinity;
        world.containers.forEach((c, i) => {
          if (!lead.escaped[i] && !c.broken && c.radius < best) {
            best = c.radius;
            cx = c.x;
            cy = c.y;
          }
        });
        r = Number.isFinite(best) ? best : outer.radius;
      }
      tz = Math.min(cam.zoom * 2.5, (cam.zoom * 470) / Math.max(60, r + 30));
      tx = cx;
      ty = cy;
    } else if (cam.mode === 'chase') {
      this.chase(world, dt);
      return;
    }
    if (!this.camInit || dt <= 0) {
      if (!this.camInit) {
        this.camX = tx;
        this.camY = ty;
        this.camZoom = tz;
        this.camInit = true;
      }
    } else {
      const k = 1 - Math.exp(-dt * 2.5);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.camZoom += (tz - this.camZoom) * k;
    }
    this.updateShake(dt);
  }

  /** Screen shake and fringe decay (every camera mode). */
  private updateShake(dt: number): void {
    const cam = this.scene.camera;
    if (cam.shake > 0 && dt > 0) {
      const amt = this.shake * 16 * cam.shake;
      this.shakeX = this.rngFx2.range(-1, 1) * amt;
      this.shakeY = this.rngFx2.range(-1, 1) * amt;
      this.shake *= Math.exp(-dt * 9);
    } else if (dt > 0) {
      this.shakeX = this.shakeY = 0;
    }
    this.chroma *= Math.exp(-dt * 6);
    this.glitch *= Math.exp(-dt * 5);
  }

  /** The ball that has escaped the most (the one a chase camera follows). */
  private leadBall(world: World): Ball | undefined {
    let lead: Ball | undefined;
    let best = -1;
    for (const b of world.balls) {
      if (!b.alive || b.projectile) continue;
      let n = 0;
      for (const v of b.everEscaped) if (v) n++;
      if (n > best) {
        best = n;
        lead = b;
      }
    }
    return lead;
  }

  /**
   * chase: lock onto the lead ball up close. With orient, turn the view so the
   * way out of its rings points down (or up); the ball sits a little above
   * center so the floors it is falling toward are in view.
   */
  private chase(world: World, dt: number): void {
    const cam = this.scene.camera;
    const lead = this.leadBall(world);
    const tz = cam.zoom;
    let tx = this.camX;
    let ty = this.camY;
    let rot = this.camRot;
    if (lead) {
      // The center of the rings it is still inside (the one with the most rings).
      const c = world.containers.find((k, i) => !lead.everEscaped[i] && !k.broken) ?? world.containers[world.containers.length - 1];
      let ox = 0;
      let oy = 0;
      if (c && cam.orient !== 'none') {
        const dx = lead.x - c.x;
        const dy = lead.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          const target = (cam.orient === 'down' ? Math.PI / 2 : -Math.PI / 2) - Math.atan2(dy, dx);
          // Near the very middle "outward" is shaky: turn slowly there.
          const w = Math.min(1, d / 220);
          const k = dt > 0 ? (1 - Math.exp(-dt * 5)) * w : this.camInit ? 0 : 1;
          rot += wrapAngle(target - rot) * k;
          // Look ahead: shift the view outward so the ball sits above center.
          const ahead = (260 / tz) * w * (cam.orient === 'down' ? 1 : 1);
          ox = (dx / d) * ahead;
          oy = (dy / d) * ahead;
        }
      }
      tx = lead.x + ox;
      ty = lead.y + oy;
    }
    if (!this.camInit || dt <= 0) {
      if (!this.camInit) {
        this.camX = tx;
        this.camY = ty;
        this.camZoom = tz;
        this.camRot = rot;
        this.camInit = true;
      }
    } else {
      const k = 1 - Math.exp(-dt * 9);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.camZoom += (tz - this.camZoom) * (1 - Math.exp(-dt * 2.5));
      this.camRot = rot;
      // Never let a fast fall drag the ball out of frame.
      const maxLag = 330 / this.camZoom;
      const lx = this.camX - tx;
      const ly = this.camY - ty;
      const lag = Math.hypot(lx, ly);
      if (lag > maxLag) {
        this.camX = tx + (lx / lag) * maxLag;
        this.camY = ty + (ly / lag) * maxLag;
      }
    }
    this.updateShake(dt);
  }
  /** The world-space transform (camera, zoom, shake). */
  private worldTransform(): void {
    const f = this.fitS;
    const s = this.scale * this.camZoom * f;
    const rot = this.camRot + this.tilt;
    if (rot === 0) {
      this.ctx.setTransform(
        s,
        0,
        0,
        s,
        this.scale * (this.fitX + f * (WIDTH / 2 - this.camX * this.camZoom + this.shakeX)),
        this.scale * (this.fitY + f * (HEIGHT / 2 - this.camY * this.camZoom + this.shakeY)),
      );
      return;
    }
    const cos = Math.cos(rot) * s;
    const sin = Math.sin(rot) * s;
    this.ctx.setTransform(
      cos,
      sin,
      -sin,
      cos,
      this.scale * (this.fitX + f * (WIDTH / 2 + this.shakeX)) - (cos * this.camX - sin * this.camY),
      this.scale * (this.fitY + f * (HEIGHT / 2 + this.shakeY)) - (sin * this.camX + cos * this.camY),
    );
  }

  private toScreen(x: number, y: number): [number, number] {
    const f = this.fitS;
    let dx = (x - this.camX) * this.camZoom;
    let dy = (y - this.camY) * this.camZoom;
    const rot = this.camRot + this.tilt;
    if (rot !== 0) {
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      [dx, dy] = [c * dx - sn * dy, sn * dx + c * dy];
    }
    return [this.fitX + f * (WIDTH / 2 + dx + this.shakeX), this.fitY + f * (HEIGHT / 2 + dy + this.shakeY)];
  }

  /** The world-space circle the screen shows (camera center, radius), for culling. */
  private viewCircle(): [number, number, number] {
    return [this.camX, this.camY, (Math.hypot(WIDTH, HEIGHT) / 2 + 40) / (this.camZoom * this.fitS)];
  }

  // ---- colors -------------------------------------------------------------

  /** A ball's displayed color, after the style's color mode. */
  private colorOf(b: Ball, world: World): string {
    const mode = this.scene.style.colorMode;
    if (mode === 'fixed' || b.projectile || b.team !== undefined) return b.color;
    if (mode === 'bounce') {
      const i = this.bounceColor.get(b.id);
      if (i === undefined) return b.color;
      const pal = this.scene.style.palette;
      return pal[(i + b.colorIndex) % pal.length];
    }
    if (mode === 'rainbow') return `hsl(${Math.round((world.time * 40 + b.id * 47) % 360)}, 95%, 62%)`;
    // speed: blue (slow) → magenta → orange → white-hot (fast)
    const sp = Math.min(1, Math.hypot(b.vx, b.vy) / 2200);
    const hue = 220 - sp * 200;
    return `hsl(${Math.round(hue)}, 95%, ${Math.round(55 + sp * 30)}%)`;
  }

  // ---- layers -------------------------------------------------------------

  private drawBackdrop(): void {
    const { ctx, scene } = this;
    const t = this.clock;
    switch (scene.style.backdrop) {
      case 'stars':
        for (const s of this.stars) {
          const y = (s.y + t * 6 * s.r) % HEIGHT;
          // Safe style: no twinkle (170 dots changing brightness every frame cost bitrate) and no sub-2px dots.
          ctx.globalAlpha = this.safe ? 0.55 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7 + s.tw));
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(s.x, y, this.safe ? Math.max(2, s.r) : s.r, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case 'grid': {
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = this.lw(2);
        const off = (t * 20) % 60;
        ctx.beginPath();
        for (let x = -60 + off; x < WIDTH + 60; x += 60) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, HEIGHT);
        }
        for (let y = -60 + off; y < HEIGHT + 60; y += 60) {
          ctx.moveTo(0, y);
          ctx.lineTo(WIDTH, y);
        }
        ctx.stroke();
        break;
      }
      case 'gradient': {
        const h = (t * 12) % 360;
        if (this.safe?.gradients === 'solid') {
          // One flat color (the gradient's midpoint): flat areas never band.
          ctx.fillStyle = `hsla(${(h + 60) % 360}, 70%, 25%, 0.55)`;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
          break;
        }
        const g = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        g.addColorStop(0, `hsla(${h}, 70%, 30%, 0.55)`);
        g.addColorStop(1, `hsla(${(h + 120) % 360}, 70%, 20%, 0.55)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        break;
      }
      default:
        break;
    }
  }

  private drawRipples(dt: number): void {
    if (this.scene.style.backdrop !== 'ripples') return;
    const { ctx } = this;
    ctx.lineWidth = this.lw(3);
    for (const r of this.ripples) {
      r.t += dt;
      const a = Math.max(0, 1 - r.t / 1.6);
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + r.t * 260, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.ripples = this.ripples.filter((r) => r.t < 1.6);
  }

  private drawTerritory(world: World): void {
    const T = world.territory!;
    if (!this.territoryImg) {
      const canvas = makeCanvas(T.cols, T.rows);
      const ctx2 = canvas.getContext('2d')!;
      const colors = world.teams.map((t, i) => this.rgbOf(t.color ?? this.scene.style.palette[i % this.scene.style.palette.length]));
      this.territoryImg = { canvas, data: ctx2.createImageData(T.cols, T.rows), colors };
    }
    const { canvas, data, colors } = this.territoryImg;
    for (let i = 0; i < T.owner.length; i++) {
      const c = colors[T.owner[i]] ?? [255, 255, 255];
      data.data[i * 4] = c[0];
      data.data[i * 4 + 1] = c[1];
      data.data[i * 4 + 2] = c[2];
      data.data[i * 4 + 3] = T.owner[i] < 0 ? 0 : 255;
    }
    canvas.getContext('2d')!.putImageData(data, 0, 0);
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, T.x, T.y, T.cols * T.cell, T.rows * T.cell);
    ctx.imageSmoothingEnabled = true;
    // Faint grid lines (skipped in the safe style: 1 px lines at 12% shimmer once re-encoded).
    if (this.safe || T.paint) return;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < T.cols; c++) {
      ctx.moveTo(T.x + c * T.cell, T.y);
      ctx.lineTo(T.x + c * T.cell, T.y + T.rows * T.cell);
    }
    for (let r = 1; r < T.rows; r++) {
      ctx.moveTo(T.x, T.y + r * T.cell);
      ctx.lineTo(T.x + T.cols * T.cell, T.y + r * T.cell);
    }
    ctx.stroke();
  }

  private rgbOf(color: string): [number, number, number] {
    const c = makeCanvas(1, 1).getContext('2d')!;
    c.fillStyle = color;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  private recordHistory(world: World, dt: number): void {
    const trail = this.scene.style.trail;
    if (trail <= 0 || dt <= 0) return;
    this.history.push(world.balls.filter((b) => b.alive && !b.frozen && !b.projectile).map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r, color: this.colorOf(b, world) })));
    const keep = this.trailKeep(60);
    if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
  }

  /** Crowd mode: trails and plain balls in one WebGL draw, composited into the 2D canvas. */
  private drawGl(world: World): void {
    const gl = this.gl!;
    const decay = this.trailDecay();
    const z = this.camZoom * this.fitS;
    const minR = this.safe?.minBallRadius ?? 0;
    gl.begin();
    const n = this.history.length;
    for (let i = 0; i < n - 1; i++) {
      const a = 0.5 * TRAIL_ALPHA * decay ** (n - 1 - i);
      for (const p of this.history[i]) {
        const [sx, sy] = this.toScreen(p.x, p.y);
        gl.add(sx, sy, Math.max(minR, p.r) * 0.85 * z, p.color, a, false);
      }
    }
    const glow = this.scene.style.glow && world.aliveCount <= 600;
    const flat = this.scene.style.ballStyle === 'flat';
    for (const b of world.balls) {
      if (!b.alive || !isPlain(b, flat)) continue;
      const [sx, sy] = this.toScreen(b.x, b.y);
      gl.add(sx, sy, Math.max(minR, b.r) * z, this.colorOf(b, world), b.frozen && !b.locked ? 0.55 : 1, glow && !b.anchored);
    }
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(gl.flush(), 0, 0);
    this.worldTransform();
  }

  private drawTrails(): void {
    const { ctx } = this;
    const { trail, trailStyle } = this.scene.style;
    if (trail <= 0) return;
    const n = this.history.length;
    const decay = this.trailDecay();
    const solid = !!this.safe?.solidTrails;
    const minR = this.safe?.minBallRadius ?? 0;
    if (trailStyle === 'dots') {
      for (let i = 0; i < n - 1; i++) {
        // Solid: every dot at one opacity, every other frame (fewer, crisper shapes).
        if (solid && (n - 1 - i) % 2) continue;
        ctx.globalAlpha = (solid ? 0.45 : 0.5 * decay ** (n - 1 - i)) * TRAIL_ALPHA;
        for (const p of this.history[i]) {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(minR, p.r) * 0.85, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    // Ribbon / comet / rainbow: one connected stroke per ball.
    const paths = new Map<number, { x: number; y: number; r: number; color: string; i: number }[]>();
    for (let i = 0; i < n; i++) {
      for (const p of this.history[i]) {
        let list = paths.get(p.id);
        if (!list) paths.set(p.id, (list = []));
        list.push({ ...p, i });
      }
    }
    ctx.lineCap = 'round';
    if (solid && trailStyle !== 'rainbow') {
      // One stroke per ball at one opacity: no per-segment alpha steps, no overlapping joints.
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.75 * TRAIL_ALPHA;
      for (const pts of paths.values()) {
        if (pts.length < 2) continue;
        const last = pts[pts.length - 1];
        ctx.strokeStyle = last.color;
        ctx.lineWidth = this.minLw(Math.max(minR, last.r) * (trailStyle === 'comet' ? 1.1 : 0.6));
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1];
          const b = pts[k];
          if (Math.hypot(b.x - a.x, b.y - a.y) > 200) ctx.moveTo(b.x, b.y);
          else ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    for (const pts of paths.values()) {
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        if (Math.hypot(b.x - a.x, b.y - a.y) > 200) continue; // teleports
        const age = (n - 1 - b.i) / Math.max(1, n - 1);
        ctx.globalAlpha = (solid ? 1 : Math.max(0, (1 - age) * 0.8)) * TRAIL_ALPHA;
        ctx.strokeStyle = trailStyle === 'rainbow' ? `hsl(${Math.round((b.i * 9 + this.clock * 90) % 360)}, 95%, 62%)` : b.color;
        ctx.lineWidth = this.minLw(trailStyle === 'comet' ? Math.max(1, b.r * 1.6 * (1 - age)) : Math.max(2, b.r * 0.6));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawZones(world: World): void {
    if (!world.zones.length) return;
    const { ctx } = this;
    for (const z of world.zones) {
      if (z.finish) {
        // A checkered finish strip.
        const sq = Math.max(10, Math.min(24, z.height / 2));
        for (let x = 0; x * sq < z.width; x++) {
          for (let y = 0; y * sq < Math.min(z.height, sq * 2); y++) {
            ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)';
            ctx.fillRect(z.x + x * sq, z.y + y * sq, Math.min(sq, z.width - x * sq), sq);
          }
        }
        if (z.label) {
          ctx.font = `900 26px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(z.label, z.x + z.width / 2, z.y - 8);
        }
      } else if (z.kill) {
        // A drain: a dark hole with a swirl.
        const cx = z.x + z.width / 2;
        const cy = z.y + z.height / 2;
        const r = Math.max(z.width, z.height) / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.8);
        g.addColorStop(0, '#000000');
        g.addColorStop(0.5, 'rgba(0,0,0,0.9)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.8, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = this.lw(2);
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(cx, cy, r * (0.6 + k * 0.35), this.clock * 3 + k, this.clock * 3 + k + Math.PI * 0.8);
          ctx.stroke();
        }
      }
    }
    if (!this.scene.overlay.zones) return;
    const counting = world.zones.filter((z) => !z.kill && !z.finish);
    if (!counting.length) return;
    const max = Math.max(1, ...counting.map((z) => z.count));
    ctx.textAlign = 'center';
    for (const z of counting) {
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

  private drawForces(world: World): void {
    const { ctx } = this;
    const t = this.clock;
    for (const f of world.forces) {
      if (!f.visible) continue;
      if (f.kind === 'attract' && f.swallow > 0) {
        // Black hole: glowing accretion disc around a black core.
        const R = f.swallow;
        const g = ctx.createRadialGradient(f.x, f.y, R * 0.6, f.x, f.y, R * 4.2);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.22, f.color);
        g.addColorStop(0.4, 'rgba(255,170,80,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, R * 4.2, 0, TAU);
        ctx.fill();
        ctx.lineWidth = this.lw(3);
        for (let k = 0; k < 6; k++) {
          ctx.strokeStyle = `rgba(255,${180 + k * 10},${120 + k * 20},${0.5 - k * 0.06})`;
          ctx.beginPath();
          const a = t * (2.4 - k * 0.25) + k;
          ctx.arc(f.x, f.y, R * (1.25 + k * 0.32), a, a + Math.PI * 1.1);
          ctx.stroke();
        }
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(f.x, f.y, R, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = this.lw(2);
        ctx.beginPath();
        ctx.arc(f.x, f.y, R + 1, 0, TAU);
        ctx.stroke();
        if (f.eaten > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = `800 ${Math.round(R * 0.8)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(f.eaten), f.x, f.y + 1);
          ctx.textBaseline = 'alphabetic';
        }
      } else if (f.kind === 'attract') {
        // A sun.
        const g = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, 90);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, f.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 90 + 6 * Math.sin(t * 3), 0, TAU);
        ctx.fill();
      } else if (f.kind === 'repel') {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = this.lw(3);
        for (let k = 0; k < 3; k++) {
          const ph = (t * 0.8 + k / 3) % 1;
          ctx.globalAlpha = 1 - ph;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 20 + ph * 140, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (f.kind === 'vortex') {
        // Spiral arms turning.
        ctx.strokeStyle = f.color;
        ctx.lineWidth = this.lw(3);
        const R = f.radius > 0 ? f.radius : 420;
        for (let arm = 0; arm < 5; arm++) {
          ctx.globalAlpha = 0.28;
          ctx.beginPath();
          for (let s = 0; s <= 40; s++) {
            const rr = 20 + (s / 40) * R;
            const a = -t * 1.4 + (arm / 5) * TAU + (s / 40) * 4.2;
            const x = f.x + Math.cos(a) * rr;
            const y = f.y + Math.sin(a) * rr;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawPortals(world: World): void {
    const { ctx } = this;
    for (const p of world.portals) {
      for (const [x, y, color, dir] of [
        [p.ax, p.ay, p.colorA, 1],
        [p.bx, p.by, p.colorB, -1],
      ] as [number, number, string, number][]) {
        const g = ctx.createRadialGradient(x, y, 2, x, y, p.r * 1.2);
        g.addColorStop(0, 'rgba(0,0,0,0.95)');
        g.addColorStop(0.7, 'rgba(0,0,0,0.6)');
        g.addColorStop(1, color);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = this.lw(5);
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = this.clock * 40 * dir;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    }
  }

  private drawSolids(world: World, glow: boolean): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const s of world.solids) {
      if (!s.alive) continue;
      const f = this.flash.get(`s${s.id}`);
      const amt = f?.amount ?? 0;
      const base = s.deadly ? '#ff2e55' : s.color;
      const color = amt > 0.05 ? f!.color : base;
      if ((glow && amt > 0.05) || s.deadly) {
        ctx.shadowBlur = s.deadly ? 22 : 24 * amt;
        ctx.shadowColor = s.deadly ? '#ff2e55' : color;
      }
      if (s.kind === 'brick') this.drawBrick(s, color, amt);
      else if (s.kind === 'peg') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s.x1, s.y1, s.half * (1 + 0.35 * amt), 0, TAU);
        ctx.fill();
        if (s.boost > 1) {
          // Bumper: a ring around the peg.
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = this.lw(3);
          ctx.beginPath();
          ctx.arc(s.x1, s.y1, s.half * (1.35 + 0.5 * amt), 0, TAU);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = this.minLw(s.half * 2);
        if (s.deadly && s.kind === 'spinner') ctx.setLineDash([s.half * 1.2, s.half * 0.8]);
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.kind === 'spinner') {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(s.cx, s.cy, Math.max(5, s.half * 0.7), 0, TAU);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
      if (s.hp !== undefined && s.kind !== 'brick' && s.maxHp && s.maxHp > 1) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 20px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(s.hp), (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2 - s.half - 6);
      }
    }
  }

  private drawBrick(s: Solid, color: string, amt: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.rotate(s.angle);
    const k = 1 + 0.06 * amt;
    ctx.scale(k, k);
    const frac = s.maxHp ? Math.max(0.35, s.hp! / s.maxHp) : 1;
    ctx.globalAlpha = 0.55 + 0.45 * frac;
    ctx.fillStyle = color;
    const w = s.hw * 2;
    const h = s.hh * 2;
    const r = Math.min(10, s.hh * 0.4);
    ctx.beginPath();
    ctx.roundRect(-s.hw, -s.hh, w, h, r);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-s.hw + r, -s.hh + 3, w - 2 * r, Math.max(2, h * 0.18));
    ctx.fillStyle = '#0b0b10';
    ctx.font = `900 ${Math.round(Math.min(h * 0.62, 34))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.hp), 0, 1);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  private drawContainers(world: World, glow: boolean): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const [vx, vy, vr] = this.viewCircle();
    for (const c of world.containers) {
      if (c.broken) continue;
      // Off-screen rings (thousands of rings around a chase camera) aren't drawn; huge ones only where they show.
      let window: [number, number] | null = null;
      if (this.manyRings && c.kind === 'ring') {
        const dc = Math.hypot(vx - c.x, vy - c.y);
        const R = c.radius;
        if (dc + vr < R - c.thickness || dc - vr > R + c.thickness) continue;
        const cosB = (R * R + dc * dc - vr * vr) / (2 * R * Math.max(dc, 1e-6));
        if (cosB > -1) window = [Math.atan2(vy - c.y, vx - c.x), Math.acos(Math.min(1, cosB)) + 0.02];
      }
      this.ringWindow = window;
      const f = this.flash.get(`c${c.id}`);
      const amt = f?.amount ?? 0;
      ctx.lineWidth = this.minLw(c.thickness);
      const base = c.deadly ? '#ff2e55' : c.color;
      if (glow) {
        ctx.shadowBlur = 18 + 30 * amt;
        ctx.shadowColor = amt > 0.05 ? f!.color : base;
      }
      this.strokeContainer(world, c, base, 1);
      if (amt > 0.02) this.strokeContainer(world, c, f!.color, amt);
      ctx.shadowBlur = 0;
      if (c.hp !== undefined && this.scene.style.showHp) {
        // The ring's hp, big and faint in the middle.
        ctx.fillStyle = base;
        ctx.globalAlpha = 0.22 + 0.4 * amt;
        ctx.font = `900 ${Math.round(Math.min(220, c.radius * 0.5))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(c.hp), c.x, c.y);
        ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
      }
    }
    this.ringWindow = null;
    ctx.shadowBlur = 0;
  }

  /** While drawing containers: the visible arc of a huge ring (center angle, half width), or null for all of it. */
  private ringWindow: [number, number] | null = null;

  /** Add the arc from a0 to a1 (a1 > a0) to the path, clipped to the ring window. */
  private arcPart(c: Container, a0: number, a1: number): void {
    const { ctx } = this;
    const w = this.ringWindow;
    const draw = (s: number, e: number) => {
      ctx.moveTo(c.x + c.radius * Math.cos(s), c.y + c.radius * Math.sin(s));
      ctx.arc(c.x, c.y, c.radius, s, e);
    };
    if (!w) return draw(a0, a1);
    const [mid, half] = w;
    for (const k of [-1, 0, 1, 2]) {
      const lo = mid - half + k * TAU;
      const hi = mid + half + k * TAU;
      const s = Math.max(a0, lo);
      const e = Math.min(a1, hi);
      if (e > s) draw(s, e);
    }
  }

  private strokeContainer(world: World, c: Container, color: string, alpha: number): void {
    const { ctx } = this;
    const ringStyle = this.scene.style.ringStyle;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    if (ringStyle === 'rainbow' && alpha >= 1) {
      const g = ctx.createConicGradient(c.angle, c.x, c.y);
      for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, `hsl(${k * 60}, 95%, 62%)`);
      ctx.strokeStyle = g;
    }
    if (ringStyle === 'dashed') ctx.setLineDash([26, 18]);
    else if (ringStyle === 'segments' && c.kind === 'ring' && !c.segments) {
      // The look of a breakable ring on a plain one: 24 segments with small gaps.
      const seg = (TAU * c.radius) / 24;
      ctx.setLineDash([Math.max(4, seg - 10 - c.thickness), 10 + c.thickness]);
    }
    if (c.kind === 'ring' && c.segments) {
      this.strokeSegments(c, color, alpha);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
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
      const sorted = [...c.gaps].sort((a, b) => a.at - b.at);
      // Repeated gaps: the visible copies only (all of them on a ring drawn whole).
      let gaps = sorted;
      if (c.repeat > 1 && sorted.length) {
        const period = TAU / c.repeat;
        let k0 = 0;
        let k1 = c.repeat - 1;
        if (this.ringWindow) {
          const rel = this.ringWindow[0] - c.angle;
          const span = Math.ceil(this.ringWindow[1] / period) + 1;
          const mid = Math.round(rel / period);
          if (2 * span + 1 < c.repeat) {
            k0 = mid - span;
            k1 = mid + span;
          }
        }
        gaps = [];
        for (let k = k0; k <= k1; k++) for (const g of sorted) gaps.push({ at: g.at + k * period, width: g.width });
        if (k1 - k0 + 1 < c.repeat) {
          // Only part of the ring: draw the walls between these copies (no wrap-around).
          ctx.beginPath();
          for (let i = 0; i + 1 < gaps.length; i++) {
            const start = gaps[i].at + gaps[i].width / 2;
            const end = gaps[i + 1].at - gaps[i + 1].width / 2;
            if (end > start) this.arcPart(c, c.angle + start, c.angle + end);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          return;
        }
      }
      if (gaps.length === 0) {
        if (this.ringWindow) this.arcPart(c, c.angle - Math.PI, c.angle + Math.PI);
        else ctx.arc(c.x, c.y, c.radius, 0, TAU);
      } else if (this.ringWindow) {
        // Normalise the window into this ring's frame, then walk only the walls near it.
        const [mid] = this.ringWindow;
        const rel = mid - c.angle;
        for (let i = 0; i < gaps.length; i++) {
          const g = gaps[i];
          const next = gaps[(i + 1) % gaps.length];
          const start = g.at + g.width / 2;
          let end = next.at - next.width / 2;
          if (i === gaps.length - 1) end += TAU;
          if (end <= start) continue;
          // Cheap reject: wall arc far from the window center (both measured in the ring frame).
          const m = (start + end) / 2;
          const d = Math.abs(m - rel - TAU * Math.round((m - rel) / TAU));
          if (d - (end - start) / 2 > this.ringWindow[1]) continue;
          this.arcPart(c, c.angle + start, c.angle + end);
        }
      } else {
        for (let i = 0; i < gaps.length; i++) {
          const g = gaps[i];
          const next = gaps[(i + 1) % gaps.length];
          const start = g.at + g.width / 2;
          let end = next.at - next.width / 2;
          if (i === gaps.length - 1) end += TAU;
          if (end <= start) continue;
          ctx.moveTo(c.x + c.radius * Math.cos(c.angle + start), c.y + c.radius * Math.sin(c.angle + start));
          ctx.arc(c.x, c.y, c.radius, c.angle + start, c.angle + end);
        }
      }
    }
    ctx.stroke();
    if (ringStyle === 'double' && alpha >= 1) {
      // Neon tube: a thin bright core over the colored stroke.
      ctx.setLineDash([]);
      const lw = ctx.lineWidth;
      ctx.lineWidth = Math.max(2, lw * 0.3);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.lineWidth = lw;
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** A breakable ring: each segment drawn on its own, fading as it weakens. */
  private strokeSegments(c: Extract<Container, { kind: 'ring' }>, color: string, alpha: number): void {
    const { ctx } = this;
    const n = c.segments!.length;
    const seg = TAU / n;
    const pad = Math.min(seg * 0.12, 4 / c.radius + 0.004);
    for (let i = 0; i < n; i++) {
      const hp = c.segments![i];
      if (hp <= 0) continue;
      ctx.globalAlpha = alpha * (0.4 + 0.6 * Math.min(1, hp / c.segmentHp));
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, c.angle + i * seg + pad, c.angle + (i + 1) * seg - pad);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    void color;
  }

  private drawPendulums(world: World, dt: number, glow: boolean): void {
    if (!world.pendulums.length) return;
    const { ctx } = this;
    const trail = this.scene.style.trail;
    // Pendulum trails are the picture, so the safe style keeps their length (only makes them solid).
    const keep = this.safe ? Math.max(2, Math.min(Math.round((240 * this.fps) / 60), Math.ceil(Math.log(0.03) / Math.log(Math.max(0.5, trail) ** (60 / this.fps))))) : this.trailKeep(240, 0.5);
    world.pendulums.forEach((p: Pendulum, i) => {
      const [bx, by] = world.pendulumBob(p);
      if (dt > 0) {
        const tr = (this.pendulumTrails[i] ??= []);
        tr.push([bx, by]);
        if (tr.length > keep) tr.splice(0, tr.length - keep);
      }
      const tr = this.pendulumTrails[i];
      if (tr && trail > 0) {
        ctx.strokeStyle = p.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = this.lw(Math.max(2, p.bob * 0.5));
        if (this.safe?.solidTrails) {
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(tr[0][0], tr[0][1]);
          for (let k = 1; k < tr.length; k++) ctx.lineTo(tr[k][0], tr[k][1]);
          ctx.stroke();
        }
        for (let k = 1; k < tr.length && !this.safe?.solidTrails; k++) {
          ctx.globalAlpha = (k / tr.length) * 0.8;
          ctx.beginPath();
          ctx.moveTo(tr[k - 1][0], tr[k - 1][1]);
          ctx.lineTo(tr[k][0], tr[k][1]);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    });
    for (const p of world.pendulums) {
      const x1 = p.x + p.l1 * Math.sin(p.t1);
      const y1 = p.y + p.l1 * Math.cos(p.t1);
      const [bx, by] = world.pendulumBob(p);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = this.lw(3);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(x1, y1);
      if (p.arms === 2) ctx.lineTo(bx, by);
      ctx.stroke();
      if (glow) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = p.color;
      }
      ctx.fillStyle = p.color;
      if (p.arms === 2) {
        ctx.beginPath();
        ctx.arc(x1, y1, p.bob * 0.6, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(bx, by, p.bob, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = '#ffffff';
    const pivots = new Set(world.pendulums.map((p) => `${p.x},${p.y}`));
    for (const k of pivots) {
      const [x, y] = k.split(',').map(Number);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, TAU);
      ctx.fill();
    }
    if (world.pendulums.some((p) => p.arms === 1) && world.pendulums.length > 1) {
      // The bar the pendulum wave hangs from.
      const xs = world.pendulums.map((p) => p.x);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = this.lw(6);
      ctx.beginPath();
      ctx.moveTo(Math.min(...xs) - 30, world.pendulums[0].y);
      ctx.lineTo(Math.max(...xs) + 30, world.pendulums[0].y);
      ctx.stroke();
    }
  }

  private drawTethers(world: World): void {
    const { ctx } = this;
    const c = world.containers[0];
    const cx = c?.x ?? WIDTH / 2;
    const cy = c?.y ?? HEIGHT / 2;
    ctx.lineWidth = this.lw(2);
    ctx.globalAlpha = this.scene.style.lineAlpha;
    for (const b of world.balls) {
      if (!b.alive || b.projectile) continue;
      ctx.strokeStyle = this.colorOf(b, world);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawBalls(world: World, glow: boolean, skipPlain: boolean): void {
    const { ctx } = this;
    const { showHp, ballStyle } = this.scene.style;
    const flat = ballStyle === 'flat';
    const mosaic = flat && !!this.scene.style.revealColors;
    for (const raw of world.balls) {
      if (!raw.alive || (skipPlain && isPlain(raw, flat))) continue;
      if (raw.projectile) {
        this.drawArrow(raw);
        continue;
      }
      const b = this.visible(raw);
      const color = this.colorOf(b, world);
      if (b.weapon && b.weapon.kind !== 'unarmed') this.drawWeapon(b);
      if (ballStyle === '3d') {
        // Drop shadow.
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(b.x + b.r * 0.18, b.y + b.r * 0.32, b.r * 0.95, b.r * 0.85, 0, 0, TAU);
        ctx.fill();
      }
      if (glow && !b.frozen && !b.anchored) {
        ctx.shadowBlur = 28;
        ctx.shadowColor = color;
      }
      ctx.globalAlpha = b.locked ? 1 : b.anchored ? 0.7 : b.frozen ? 0.55 : ballStyle === 'glass' ? 0.4 : 1;
      ctx.fillStyle = ballStyle === 'outline' ? 'rgba(0,0,0,0.6)' : color;
      ctx.beginPath();
      this.shapePath(b);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (ballStyle === 'glossy' || ballStyle === '3d' || ballStyle === 'glass') this.shade(b, ballStyle);
      // A photo fills the ball's shape and turns with it.
      const img = getImage(b.image);
      if (img) {
        ctx.save();
        ctx.beginPath();
        this.shapePath(b);
        ctx.clip();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        drawCover(ctx, img, 0, 0, b.r * 2.2, b.r * 2.2);
        ctx.restore();
      }
      if (b.emoji) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.font = `${Math.round(b.r * 1.55)}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.emoji, 0, b.r * 0.08);
        ctx.restore();
      }
      ctx.beginPath();
      this.shapePath(b);
      ctx.globalAlpha = b.locked ? 1 : b.anchored ? 0.7 : b.frozen ? 0.55 : 1;
      if (ballStyle === 'outline' || ballStyle === 'glass') {
        ctx.lineWidth = this.lw(Math.max(3, b.r * 0.22));
        ctx.strokeStyle = color;
      } else {
        ctx.lineWidth = this.lw(Math.max(2, b.r * 0.12));
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      }
      if (b.frozen && !b.anchored && !b.locked) ctx.setLineDash([b.r * 0.35, b.r * 0.25]);
      if (!mosaic || !isPlain(b, flat)) ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const hasHp = showHp && b.hp !== undefined && !!b.maxHp;
      if (hasHp) {
        // Remaining hp as an arc around the ball, and the number inside.
        const ring = b.r + Math.max(6, b.r * 0.22);
        ctx.lineWidth = Math.max(5, b.r * 0.18);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, ring, 0, TAU);
        ctx.stroke();
        const frac = Math.max(0, b.hp! / b.maxHp!);
        ctx.strokeStyle = frac > 0.5 ? '#7cff6b' : frac > 0.25 ? '#ffd23f' : '#ff4d6d';
        ctx.beginPath();
        ctx.arc(b.x, b.y, ring, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
        ctx.stroke();
        if (b.r >= 16 && !b.image && !b.emoji) {
          ctx.fillStyle = '#0b0b10';
          ctx.font = `800 ${Math.round(b.r * 0.9)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(Math.ceil(b.hp!)), b.x, b.y + 1);
          ctx.textBaseline = 'alphabetic';
        }
      }
      if (b.label) {
        const ov = this.scene.overlay;
        ctx.font = `700 ${ov.labelSize}px ${FONTS[ov.font]}`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = ov.textColor;
        const stat = b.weapon && b.weapon.hits > 0 ? this.weaponStat(b) : '';
        ctx.fillText(stat ? `${b.label} · ${stat}` : b.label, b.x, b.y + b.r + (hasHp ? 22 : 6) + ov.labelSize);
        ctx.shadowBlur = 0;
      }
    }
  }

  /** The power-up a weapon has gained, as a short tag ("DMG 4"). */
  private weaponStat(b: Ball): string {
    const w = b.weapon!;
    switch (w.kind) {
      case 'sword':
      case 'hammer':
        return `DMG ${Math.round(w.damage * 10) / 10}`;
      case 'dagger':
      case 'scythe':
        return `SPIN ${Math.abs(w.spin).toFixed(1)}`;
      case 'spear':
        return `LEN ${Math.round(w.length)}`;
      case 'bow':
        return `ARROWS ${w.arrows}`;
      case 'unarmed':
        return `SPD ${Math.round(Math.hypot(b.vx, b.vy))}`;
      default:
        return '';
    }
  }

  /** Highlights for glossy / 3d / glass balls. */
  private shade(b: Ball, style: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    this.shapePath(b);
    ctx.clip();
    if (style === '3d') {
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.05, b.x, b.y, b.r * 1.05);
      g.addColorStop(0, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - b.r * 1.3, b.y - b.r * 1.3, b.r * 2.6, b.r * 2.6);
    } else {
      const g = ctx.createRadialGradient(b.x - b.r * 0.38, b.y - b.r * 0.42, 0, b.x - b.r * 0.38, b.y - b.r * 0.42, b.r * 0.62);
      g.addColorStop(0, `rgba(255,255,255,${style === 'glass' ? 0.8 : 0.7})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - b.r * 1.3, b.y - b.r * 1.3, b.r * 2.6, b.r * 2.6);
    }
    ctx.restore();
  }

  private drawArrow(b: Ball): void {
    const { ctx } = this;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / sp;
    const uy = b.vy / sp;
    const len = 34;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = this.lw(4);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x - ux * len, b.y - uy * len);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(b.x + ux * 10, b.y + uy * 10);
    ctx.lineTo(b.x - uy * 7, b.y + ux * 7);
    ctx.lineTo(b.x + uy * 7, b.y - ux * 7);
    ctx.closePath();
    ctx.fill();
  }

  private shapePath(b: Ball): void {
    const { ctx } = this;
    if (b.shape === 'circle') {
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      return;
    }
    const pts: [number, number][] = [];
    if (b.shape === 'star') {
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? b.r * 0.48 : b.r * 1.08;
        const a = b.rot + (k / 10) * TAU - Math.PI / 2;
        pts.push([b.x + rr * Math.cos(a), b.y + rr * Math.sin(a)]);
      }
    } else {
      const sides = b.shape === 'square' ? 4 : b.shape === 'triangle' ? 3 : 6;
      // Size the polygon so its area roughly matches the collision circle.
      const rr = b.r * (sides === 3 ? 1.25 : sides === 4 ? 1.1 : 1.03);
      for (let k = 0; k < sides; k++) {
        const a = b.rot + (k / sides) * TAU - Math.PI / 2 + (sides === 4 ? Math.PI / 4 : 0);
        pts.push([b.x + rr * Math.cos(a), b.y + rr * Math.sin(a)]);
      }
    }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
  }

  private drawWeapon(b: Ball): void {
    const { ctx } = this;
    const w = b.weapon!;
    const ca = Math.cos(w.angle);
    const sa = Math.sin(w.angle);
    if (w.kind === 'bow') {
      // A bow: an arc facing its aim, with a string.
      const cx = b.x + ca * (b.r + 6);
      const cy = b.y + sa * (b.r + 6);
      ctx.strokeStyle = w.color ?? '#c8a27a';
      ctx.lineWidth = this.lw(6);
      ctx.beginPath();
      ctx.arc(cx - ca * 18, cy - sa * 18, w.length, w.angle - 1.1, w.angle + 1.1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = this.lw(2);
      ctx.beginPath();
      ctx.moveTo(cx - ca * 18 + Math.cos(w.angle - 1.1) * w.length, cy - sa * 18 + Math.sin(w.angle - 1.1) * w.length);
      ctx.lineTo(cx - ca * 18 + Math.cos(w.angle + 1.1) * w.length, cy - sa * 18 + Math.sin(w.angle + 1.1) * w.length);
      ctx.stroke();
      return;
    }
    const x1 = b.x + ca * b.r * 0.6;
    const y1 = b.y + sa * b.r * 0.6;
    const x2 = b.x + ca * (b.r + w.length);
    const y2 = b.y + sa * (b.r + w.length);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = w.width + 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = w.color ?? '#e9ecf5';
    ctx.lineWidth = w.width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (w.kind === 'hammer') {
      // A heavy head across the end.
      ctx.lineWidth = w.width * 2.4;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x2 - ca * 14 - sa * 22, y2 - sa * 14 + ca * 22);
      ctx.lineTo(x2 - ca * 14 + sa * 22, y2 - sa * 14 - ca * 22);
      ctx.stroke();
      ctx.lineCap = 'round';
    } else if (w.kind === 'scythe') {
      ctx.lineWidth = w.width;
      ctx.beginPath();
      ctx.arc(x2 - sa * 30, y2 + ca * 30, 30, w.angle - Math.PI / 2, w.angle + Math.PI / 2, true);
      ctx.stroke();
    } else if (w.kind === 'spear') {
      ctx.fillStyle = w.color ?? '#e9ecf5';
      ctx.beginPath();
      ctx.moveTo(x2 + ca * 18, y2 + sa * 18);
      ctx.lineTo(x2 - sa * 9, y2 + ca * 9);
      ctx.lineTo(x2 + sa * 9, y2 - ca * 9);
      ctx.closePath();
      ctx.fill();
    }
    // Guard across the blade near the ball.
    const gx = b.x + ca * (b.r + 4);
    const gy = b.y + sa * (b.r + 4);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = w.width * 0.9;
    ctx.beginPath();
    ctx.moveTo(gx - sa * w.width * 1.6, gy + ca * w.width * 1.6);
    ctx.lineTo(gx + sa * w.width * 1.6, gy - ca * w.width * 1.6);
    ctx.stroke();
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    for (const p of this.particles) {
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) continue;
      // Safe style: sparks shrink away at full opacity instead of fading (no translucent smear).
      const k = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = this.safe ? 1 : k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.safe ? p.size * (0.35 + 0.65 * k) : p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawConfetti(dt: number): void {
    if (!this.confetti.length) return;
    const { ctx } = this;
    for (const c of this.confetti) {
      c.vy += 600 * dt;
      c.vx *= Math.exp(-dt * 1.5);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      c.life -= dt;
      if (c.life <= 0) continue;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, (-c.h / 2) * Math.abs(Math.cos(c.rot * 1.7)), c.w, c.h * Math.abs(Math.cos(c.rot * 1.7)) + 1);
      ctx.restore();
    }
    this.confetti = this.confetti.filter((c) => c.life > 0);
  }

  private popConfetti(x: number, y: number, n: number): void {
    const pal = this.scene.style.palette;
    for (let i = 0; i < n; i++) {
      const a = this.rngFx2.range(-Math.PI * 0.95, -Math.PI * 0.05);
      const s = this.rngFx2.range(500, 1400);
      this.confetti.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        rot: this.rngFx2.range(0, TAU),
        spin: this.rngFx2.range(-12, 12),
        life: this.rngFx2.range(1.8, 3.2),
        w: this.rngFx2.range(10, 18),
        h: this.rngFx2.range(6, 12),
        color: pal[i % pal.length],
      });
    }
  }

  /** Post effects in screen space: bloom, chromatic fringing, vignette, grain, scanlines. */
  private drawPost(dt: number): void {
    const { ctx } = this;
    const { style } = this.scene;
    const canvas = ctx.canvas;
    if (this.fxBuf && style.mirror !== 'none') this.drawMirror(style.mirror);
    if (this.fxBuf && (style.bloom || (style.chromatic && this.chroma > 0.02))) {
      const b = this.fxBuf.getContext('2d')!;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, canvas.width, canvas.height);
      b.drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (style.bloom) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.32;
        ctx.filter = `blur(${Math.round(16 * this.scale)}px)`;
        ctx.drawImage(this.fxBuf, 0, 0);
        ctx.filter = 'none';
      }
      if (style.chromatic && this.chroma > 0.02) {
        const off = 9 * this.chroma * this.scale;
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.45 * this.chroma;
        ctx.filter = 'sepia(1) saturate(6) hue-rotate(-50deg)';
        ctx.drawImage(this.fxBuf, -off, 0);
        ctx.filter = 'sepia(1) saturate(6) hue-rotate(150deg)';
        ctx.drawImage(this.fxBuf, off, 0);
        ctx.filter = 'none';
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    }
    if (this.fxBuf && style.glitch && this.glitch > 0.04 && dt > 0) this.drawGlitch();
    if (style.vignette && this.safe?.gradients !== 'solid') {
      const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (this.scan) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.scan;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    }
    if (this.grain) {
      const ox = dt > 0 ? this.rngFx2.int(256) : 0;
      const oy = dt > 0 ? this.rngFx2.int(256) : 0;
      ctx.globalAlpha = 0.07;
      ctx.globalCompositeOperation = 'overlay';
      const pat = ctx.createPattern(this.grain, 'repeat')!;
      ctx.translate(-ox, -oy);
      ctx.fillStyle = pat;
      ctx.fillRect(ox, oy, WIDTH, HEIGHT);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /** chase: the top and bottom of the frame fade into the background, so the title, clock and counter stay readable over the rings. */
  private drawEdgeFade(): void {
    const { ctx } = this;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const bg = this.scene.style.background;
    const rgb = /^#[0-9a-f]{6}$/i.test(bg) ? [1, 3, 5].map((k) => parseInt(bg.slice(k, k + 2), 16)).join(',') : '0,0,0';
    const top = ctx.createLinearGradient(0, 0, 0, 640);
    top.addColorStop(0, `rgba(${rgb},0.92)`);
    top.addColorStop(0.62, `rgba(${rgb},0.7)`);
    top.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, WIDTH, 640);
    const bottom = ctx.createLinearGradient(0, 1480, 0, HEIGHT);
    bottom.addColorStop(0, `rgba(${rgb},0)`);
    bottom.addColorStop(0.45, `rgba(${rgb},0.72)`);
    bottom.addColorStop(1, `rgba(${rgb},0.92)`);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 1480, WIDTH, HEIGHT - 1480);
  }

  /** style.droste: the frame inside itself, again and again, each copy smaller and turned a little (the room repeats). */
  private drawDroste(levels: number, world: World): void {
    const { ctx } = this;
    const buf = this.fxBuf!;
    const b = buf.getContext('2d')!;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const k = 0.62;
    const turn = 0.06 + 0.03 * Math.sin(world.time * 0.29);
    const bg = this.scene.style.background;
    const rgb = /^#[0-9a-f]{6}$/i.test(bg) ? [1, 3, 5].map((k) => parseInt(bg.slice(k, k + 2), 16)) : [0, 0, 0];
    const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 128;
    for (let i = 0; i < levels; i++) {
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, w, h);
      b.drawImage(ctx.canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(turn);
      ctx.scale(k, k);
      ctx.translate(-w / 2, -h / 2);
      // Blend toward the background's opposite, so the copies show and the walls survive (dark rooms: lighten; pale rooms: darken).
      ctx.globalCompositeOperation = light ? 'darken' : 'lighten';
      ctx.globalAlpha = 0.7;
      ctx.drawImage(buf, 0, 0);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = this.scene.style.ringColor;
      ctx.lineWidth = 5 * this.scale;
      ctx.strokeRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  /** style.mirror: reflect one half (or quarter) of the frame onto the rest. */
  private drawMirror(mode: 'x' | 'y' | 'quad'): void {
    const { ctx } = this;
    const buf = this.fxBuf!;
    const b = buf.getContext('2d')!;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const flip = (horizontal: boolean) => {
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, w, h);
      b.drawImage(ctx.canvas, 0, 0);
      if (horizontal) {
        ctx.setTransform(-1, 0, 0, 1, w, 0);
        ctx.drawImage(buf, 0, 0, w / 2, h, 0, 0, w / 2, h);
      } else {
        ctx.setTransform(1, 0, 0, -1, 0, h);
        ctx.drawImage(buf, 0, 0, w, h / 2, 0, 0, w, h / 2);
      }
    };
    if (mode === 'x' || mode === 'quad') flip(true);
    if (mode === 'y' || mode === 'quad') flip(false);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  /** style.glitch: the frame tears into horizontally shifted slices, some with split or inverted colors. */
  private drawGlitch(): void {
    const { ctx } = this;
    const buf = this.fxBuf!;
    const b = buf.getContext('2d')!;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const g = this.glitch;
    const r = this.rngGlitch;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, w, h);
    b.drawImage(ctx.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const slices = 2 + Math.round(g * 9);
    for (let i = 0; i < slices; i++) {
      const y = Math.floor(r.range(0, h));
      const sh = Math.max(2, Math.floor(r.range(4, 90) * this.scale * (0.4 + g)));
      const dx = Math.round(r.range(-1, 1) * 70 * g * this.scale);
      const mode = r.next();
      if (mode < 0.15 * g) {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, y, w, sh);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.drawImage(buf, 0, y, w, sh, dx, y, w, sh);
        if (mode > 0.7) {
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.5 * g;
          ctx.filter = 'sepia(1) saturate(8) hue-rotate(-50deg)';
          ctx.drawImage(buf, 0, y, w, sh, dx + 10 * this.scale, y, w, sh);
          ctx.filter = 'none';
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  private consumeEvents(world: World): void {
    const ballColor = (id: number) => (world.balls[id] ? this.colorOf(world.balls[id], world) : '#ffffff');
    // In crowds, per-bounce sparks would be noise (and slow): keep only the big moments.
    const crowd = world.aliveCount > 150;
    const { style, camera } = this.scene;
    const kick = (k: number) => {
      if (camera.shake > 0) this.shake = Math.min(1.6, this.shake + k);
      if (style.chromatic) this.chroma = Math.min(1, this.chroma + k);
    };
    // Glitch tearing on the big moments (escape streaks have their own, below).
    const tear = (k: number) => {
      if (style.glitch) this.glitch = Math.min(1, this.glitch + k);
    };
    for (; this.cursor < world.events.length; this.cursor++) {
      const e = world.events[this.cursor];
      if (e.type === 'finish' && this.finishers.length < 2 && !this.finishers.some((f) => f.ball === e.ball)) {
        this.finishers.push({ ball: e.ball, step: e.step });
      }
      if (e.type === 'bounce' && e.ball >= 0) {
        if (style.colorMode === 'bounce') this.bounceColor.set(e.ball, (this.bounceColor.get(e.ball) ?? 0) + 1);
        if (this.lines) this.addLine(world, e.ball, e.x, e.y, e.ring);
        if (style.backdrop === 'ripples' && this.ripples.length < 60) this.ripples.push({ x: e.x, y: e.y, t: 0, color: ballColor(e.ball) });
      }
      if (crowd && (e.type === 'bounce' || e.type === 'spawn' || e.type === 'hit' || e.type === 'capture' || e.type === 'swallow' || e.type === 'merge')) {
        if (e.type === 'bounce' && e.ring >= 0) this.flash.set(`c${e.ring}`, { amount: 0.6, color: ballColor(e.ball) });
        continue;
      }
      switch (e.type) {
        case 'strike':
          this.burst(e.x, e.y, '#ffffff', 14, 520);
          this.burst(e.x, e.y, ballColor(e.ball), 10, 420);
          kick(0.35);
          tear(0.15);
          break;
        case 'clash':
          this.burst(e.x, e.y, '#fff3b0', 22, 640);
          kick(0.2);
          break;
        case 'wake':
          this.burst(e.x, e.y, ballColor(e.ball), 10, 300);
          break;
        case 'bounce':
          if (e.ring >= 0) this.flash.set(`c${e.ring}`, { amount: 1, color: ballColor(e.ball) });
          if (e.solid >= 0) this.flash.set(`s${e.solid}`, { amount: 1, color: ballColor(e.ball) });
          this.burst(e.x, e.y, ballColor(e.ball), e.solid >= 0 ? 3 : 8, 260);
          break;
        case 'escape': {
          const burstAt = this.scene.audio.burstAt;
          this.streak = e.step - this.streakStep < 0.4 * PHYSICS_HZ ? this.streak + 1 : 1;
          this.streakStep = e.step;
          this.streakAge = 0;
          if (this.manyRings) {
            // Thousands of rings: no flash per ring; a streak builds shake, fringe and tearing instead.
            this.burst(e.x, e.y, ballColor(e.ball), 3, 260);
            if (this.streak >= burstAt) {
              kick(Math.min(0.2, 0.05 + this.streak * 0.0015));
              if (style.glitch) this.glitch = Math.min(1, this.glitch + 0.06 + this.streak * 0.001);
              if (this.streak === burstAt) {
                this.escapeFlash = Math.max(this.escapeFlash, 0.35);
                this.burst(e.x, e.y, '#ffffff', 24, 700);
              }
            }
            break;
          }
          tear(this.streak >= burstAt ? 0.1 : e.step - this.lastFlashStep >= PHYSICS_HZ ? 0.5 : 0);
          // Flash only for escapes at least a second apart, so constant
          // escapes (multiply scenes) don't wash the frame out.
          if (e.step - this.lastFlashStep >= PHYSICS_HZ) {
            this.escapeFlash = 1;
            this.lastFlashStep = e.step;
            kick(0.8);
            if (style.confetti) this.popConfetti(e.x, e.y, 60);
          }
          this.burst(e.x, e.y, ballColor(e.ball), 40, 700);
          this.burst(e.x, e.y, '#ffffff', 16, 500);
          break;
        }
        case 'hit':
          this.burst(e.x, e.y, '#ffffff', 6, 380);
          break;
        case 'eliminate':
          this.burst(e.x, e.y, ballColor(e.ball), 60, 800);
          this.burst(e.x, e.y, '#ffffff', 20, 500);
          kick(0.7);
          tear(0.5);
          break;
        case 'spawn':
          if (e.step > 0) this.burst(e.x, e.y, ballColor(e.ball), 6, 160);
          break;
        case 'break': {
          tear(0.25);
          const c = e.ring >= 0 ? world.containers[e.ring] : null;
          const s = e.solid >= 0 ? world.solids[e.solid] : null;
          const color = c?.color ?? s?.color ?? '#ffffff';
          if (c && e.n !== undefined && e.n >= 0 && c.kind === 'ring' && c.segments) {
            // Shards fly off the broken segment.
            const a = c.angle + ((e.n + 0.5) / c.segments.length) * TAU;
            this.burst(c.x + Math.cos(a) * c.radius, c.y + Math.sin(a) * c.radius, color, 18, 520);
          } else if (c) {
            // A whole ring shatters.
            for (let k = 0; k < 48; k++) {
              const a = (k / 48) * TAU;
              this.burst(c.x + Math.cos(a) * c.radius, c.y + Math.sin(a) * c.radius, color, 3, 600);
            }
            this.escapeFlash = Math.max(this.escapeFlash, 0.8);
          } else this.burst(e.x, e.y, color, 26, 560);
          kick(c && e.n === -1 ? 1.2 : 0.4);
          break;
        }
        case 'teleport':
          tear(0.4);
          this.burst(e.x, e.y, '#c77dff', 16, 420);
          this.burst(world.balls[e.ball]?.x ?? e.x, world.balls[e.ball]?.y ?? e.y, '#4dd4ff', 16, 420);
          break;
        case 'swallow':
          tear(0.3);
          this.burst(e.x, e.y, ballColor(e.ball), 22, 300);
          kick(0.3);
          break;
        case 'merge':
          this.burst(e.x, e.y, ballColor(e.ball), 24, 420);
          this.burst(e.x, e.y, '#ffffff', 10, 300);
          break;
        case 'convert':
          this.burst(e.x, e.y, ballColor(e.ball), 12, 300);
          break;
        case 'capture':
          this.burst(e.x, e.y, ballColor(e.ball), 3, 180);
          break;
        case 'caught':
          this.caughtFlash = 1;
          kick(1.5);
          if (style.glitch) this.glitch = 1;
          this.subForced = 0.06;
          this.subIndex++;
          break;
        case 'corner':
          this.escapeFlash = 1;
          this.burst(e.x, e.y, '#ffffff', 50, 900);
          kick(1.2);
          if (style.confetti) this.popConfetti(e.x, e.y, 80);
          break;
        case 'finish':
          this.burst(e.x, e.y, ballColor(e.ball), 30, 600);
          break;
        default:
          break;
      }
    }
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
    // Confetti when a winner is decided.
    if (style.confetti && !this.confettiDone && world.endReason && (world.winner >= 0 || world.winnerTeam)) {
      this.confettiDone = true;
      this.popConfetti(WIDTH * 0.25, HEIGHT * 0.62, 70);
      this.popConfetti(WIDTH * 0.75, HEIGHT * 0.62, 70);
    }
  }

  /** String art: a new line for a bounce. */
  private addLine(world: World, id: number, x: number, y: number, ring: number): void {
    const g = this.lines!.getContext('2d')!;
    const mode = this.scene.style.lines;
    const b = world.balls[id];
    const color = b ? this.colorOf(b, world) : '#ffffff';
    g.strokeStyle = color;
    g.globalAlpha = this.scene.style.lineAlpha;
    g.lineWidth = this.lw(2);
    const pts = this.lastBounce.get(id) ?? [];
    let from: [number, number] | null = null;
    if (mode === 'center') {
      const c = ring >= 0 ? world.containers[ring] : world.containers[0];
      from = c ? [c.x, c.y] : [WIDTH / 2, HEIGHT / 2];
    } else if (mode === 'web') from = pts[pts.length - 1] ?? null;
    else if (mode === 'star') from = pts.length >= 5 ? pts[pts.length - 5] : null;
    if (from) {
      g.beginPath();
      g.moveTo(from[0], from[1]);
      g.lineTo(x, y);
      g.stroke();
    }
    pts.push([x, y]);
    if (pts.length > 8) pts.shift();
    this.lastBounce.set(id, pts);
    g.globalAlpha = 1;
  }

  private burst(x: number, y: number, color: string, n: number, speed: number): void {
    const safe = this.safe;
    for (let i = 0; i < n; i++) {
      // Always draw the same random numbers, so the safe style shows a subset of the very same sparks.
      const a = this.rng.range(0, TAU);
      const s = this.rng.range(0.25, 1) * speed;
      const life = this.rng.range(0.25, 0.7);
      const size = this.rng.range(2, 5);
      if (safe && (i % safe.particleEvery !== 0 || this.particles.length >= safe.maxParticles)) continue;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, size: safe ? size * safe.particleScale : size, color });
    }
  }

  // ---- overlay ------------------------------------------------------------

  private drawOverlay(world: World, dt: number): void {
    const { ctx } = this;
    const { overlay } = this.scene;
    const safeText = !!this.safe?.safeText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    if (this.safe && this.safe.maxGlow < 4) {
      // Soft text shadows are off in the safe style: a crisp offset shadow keeps text readable.
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowOffsetY = 4;
    }
    ctx.fillStyle = overlay.textColor;
    const font = FONTS[overlay.font];
    const team = world.winnerTeam ? world.teams.find((t) => t.name === world.winnerTeam) : undefined;
    const tied = world.endReason === 'mostTerritory' && !world.winnerTeam;
    const hasResult = overlay.winner && !!world.endReason && (world.winner >= 0 || !!team || tied);
    const titleResult = hasResult && overlay.resultPosition === 'title';
    let y = overlay.titleY;
    // Baseline of the last line of title text (for placing the countdown under it).
    let textBottom = safeText ? TIKTOK_ZONES.top : 60;
    if (overlay.title && !titleResult) {
      // Shrink a long title (to 60% at most) to keep it on one line inside the text band; wrap only past that.
      let size = overlay.titleSize;
      ctx.font = `800 ${size}px ${font}`;
      const wide = ctx.measureText(overlay.title).width;
      if (wide > TEXT_BAND.width) {
        size = Math.max(Math.round(size * 0.6), Math.floor((size * (TEXT_BAND.width - 20)) / wide));
        ctx.font = `800 ${size}px ${font}`;
      }
      textBottom = this.fillWrapped(overlay.title, WIDTH / 2, Math.max(y, TEXT_BAND.top), 940, size * 1.16);
      y = textBottom + overlay.subtitleSize * 1.75;
    }
    if (overlay.subtitle && !titleResult) {
      ctx.font = `500 ${overlay.subtitleSize}px ${font}`;
      ctx.globalAlpha = 0.8;
      textBottom = this.fillWrapped(overlay.subtitle, WIDTH / 2, y, 900, overlay.subtitleSize * 1.25);
      ctx.globalAlpha = 1;
    }
    // The countdown keeps the spot it took on the first frame (the title may give way to a result later).
    if (this.countdownY < 0) this.countdownY = overlay.clockY !== undefined ? Math.max(overlay.clockY, TEXT_BAND.top) : textBottom + 34 + overlay.clockSize * 0.76;

    // The timer stops at the climax (escape, knockout…); the tail after it doesn't count.
    const secs = (world.climaxStep >= 0 ? Math.min(world.stepCount, world.climaxStep) : world.stepCount) / PHYSICS_HZ;
    let counterY = overlay.counterY ?? (world.zones.some((z) => !z.kill && !z.finish) && overlay.zones ? 1830 : 1700);
    // Keep the counter above TikTok's caption area (the safe style lifts it a little more if needed).
    counterY = Math.min(counterY, TEXT_BAND.bottom);
    if (safeText) counterY = Math.min(counterY, SAFE_RECT.y1 - 24);
    const parts: string[] = [];
    if (overlay.counter === 'bounces') parts.push(`${world.bounces} bounces`);
    if (overlay.counter === 'balls') parts.push(`${world.aliveCount} ${world.aliveCount === 1 ? 'ball' : 'balls'}`);
    if (overlay.counter === 'escaped') parts.push(`${world.uniqueEscapes} escaped`);
    if (overlay.counter === 'rings') {
      let best = 0;
      for (const b of world.balls) {
        if (b.projectile) continue;
        let n = 0;
        world.containers.forEach((c, i) => (n += b.everEscaped[i] || c.broken ? 1 : 0));
        best = Math.max(best, n);
      }
      parts.push(`${best} / ${world.containers.length} rings`);
    }
    if (overlay.counter === 'ringsLeft') {
      const lead = this.leadBall(world);
      let n = 0;
      if (lead) world.containers.forEach((c, i) => (n += lead.everEscaped[i] || c.broken ? 0 : 1));
      parts.push(n === 0 ? 'ESCAPED' : `${n} ${n === 1 ? 'ring' : 'rings'} left`);
    }
    if (overlay.counter === 'bricks') parts.push(`${world.solids.filter((s) => s.alive && s.hp !== undefined).length} left`);
    if (overlay.counter === 'hp') {
      const c = world.containers.find((k) => k.hp !== undefined);
      parts.push(c ? (c.broken ? 'BROKEN' : `${c.hp} HP`) : `${world.bounces} bounces`);
    }
    const container = world.containers[0];
    if (overlay.counter === 'sides' && container?.kind === 'poly') parts.push(`${container.sides} sides`);
    if (overlay.counter === 'gap' && container?.kind === 'ring' && container.gaps.length)
      parts.push(`${Math.round(container.gaps[0].width * 180 / Math.PI)}° opening`);
    if (overlay.counter === 'gravity') {
      const arrow = Math.abs(world.gx) > Math.abs(world.gy) ? (world.gx > 0 ? '→' : '←') : (world.gy > 0 ? '↓' : '↑');
      parts.push(world.gx || world.gy ? `Gravity ${arrow}` : 'Zero gravity');
    }
    if (overlay.counter === 'diameter' && world.balls[0]) parts.push(`${Math.round(world.balls[0].r * 2)} px across`);
    if (overlay.counter === 'level') parts.push(`Top level ${world.balls.reduce((best, b) => Math.max(best, b.level), 0)}`);
    if (overlay.counter === 'swallowed') parts.push(`${world.swallowed} drained`);
    const clock = this.scene.clock;
    const left = world.clockLeft();
    if (overlay.timer && !clock) parts.push(clockText(secs));
    if (overlay.counter === 'teams') this.drawTeams(world, counterY, font);
    else if (overlay.teamBar && (world.territory || world.teams.length > 1)) this.drawTeams(world, counterY, font, true);
    if (overlay.clock && clock && left !== null) this.drawCountdown(world, clock, left, font);
    if (parts.length) {
      ctx.font = `700 ${overlay.counterSize}px ${font}`;
      ctx.fillStyle = overlay.textColor;
      ctx.fillText(parts.join('   ·   '), WIDTH / 2, counterY);
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    if (overlay.streak) this.drawStreak(world, dt, font);
    if (overlay.vhs) this.drawVhs(world, secs);
    if (overlay.progress !== 'none') this.drawProgress(world, secs);
    if (clock && world.endReason === 'timeUp' && world.climaxStep >= 0) this.drawTimeUp(world, clock.timeUpText, font);
    if (world.endReason === 'caught' && world.climaxStep >= 0) this.drawTimeUp(world, 'CAUGHT', font);
    if (overlay.reveal) this.drawReveal(world, counterY, font);

    // Winner banner once a race or battle is decided.
    if (hasResult) {
      this.banner = Math.min(1, this.banner + dt * 4);
      const w = world.winner >= 0 ? world.balls[world.winner] : undefined;
      const a = this.banner;
      ctx.save();
      if (titleResult) {
        ctx.translate(WIDTH / 2, Math.max(TEXT_BAND.top - 40, overlay.titleY));
        ctx.scale(0.82, 0.82);
        ctx.translate(-WIDTH / 2, -HEIGHT / 2);
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      if (!titleResult) ctx.fillRect(0, HEIGHT / 2 - 140, WIDTH, 280);
      const br = 48 * (0.6 + 0.4 * a);
      ctx.fillStyle = team?.color ?? w?.color ?? '#ffffff';
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2 - 45, br, 0, TAU);
      ctx.fill();
      // The winner's photo or emoji, if it has one.
      const wimg = w ? getImage(w.image) : undefined;
      const emoji = team?.emoji ?? w?.emoji;
      if (wimg) {
        ctx.save();
        ctx.clip();
        drawCover(ctx, wimg, WIDTH / 2, HEIGHT / 2 - 45, br * 2, br * 2);
        ctx.restore();
      } else if (emoji) {
        ctx.font = `${Math.round(br * 1.35)}px ${EMOJI_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, WIDTH / 2, HEIGHT / 2 - 41);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 72px ${FONTS[this.scene.overlay.font]}`;
      const name = team ? team.name[0].toUpperCase() + team.name.slice(1) : w?.label;
      ctx.fillText(tied ? 'Tie game' : name ? `${name} wins!` : 'Winner!', WIDTH / 2, HEIGHT / 2 + 85, 1000);
      if (titleResult && world.endReason === 'finish' && this.finishers.length === 2) {
        const [first, second] = this.finishers;
        const margin = (second.step - first.step) / PHYSICS_HZ;
        const runnerUp = world.balls[second.ball]?.label ?? 'Second place';
        ctx.font = `600 42px ${font}`;
        ctx.fillText(margin ? `${runnerUp} followed ${margin.toFixed(2)}s later` : 'Same-tick finish', WIDTH / 2, HEIGHT / 2 + 145, 980);
      }
      ctx.restore();
    }

    // End card over the tail.
    if (overlay.endCard && world.climaxStep >= 0) {
      const t = (world.stepCount - world.climaxStep) / PHYSICS_HZ - 0.5;
      if (t > 0) {
        const a = Math.min(1, t * 2.5);
        ctx.globalAlpha = a;
        ctx.font = `800 54px ${font}`;
        const w = Math.min(980, ctx.measureText(overlay.endCard).width + 80);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        const ey = Math.min(1440, counterY - 190);
        ctx.roundRect(WIDTH / 2 - w / 2, ey, w, 110, 28);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(overlay.endCard, WIDTH / 2, ey + 73, w - 50);
        ctx.globalAlpha = 1;
      }
    }

    // Countdown intro.
    if (this.intro > 0) {
      const n = Math.ceil(this.intro - 0.6);
      const frac = this.intro - Math.floor(this.intro);
      const text = n > 0 ? String(n) : 'GO!';
      const pulse = 1 + 0.25 * frac;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.font = `900 ${Math.round(230 * pulse)}px ${font}`;
      ctx.fillStyle = n > 0 ? overlay.textColor : '#7cff6b';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 30;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, WIDTH / 2, HEIGHT / 2);
      ctx.textBaseline = 'alphabetic';
      ctx.shadowBlur = 0;
    }
  }

  /** overlay.streak: −47 by the ball while it escapes ring after ring, popping on each one, fading after. */
  private drawStreak(world: World, dt: number, font: string): void {
    const { ctx } = this;
    this.streakAge += dt;
    const min = Math.max(2, Math.ceil(this.scene.audio.burstAt / 2));
    if (this.streak >= min && this.streakAge < 0.05) this.streakShown = this.streak;
    const n = this.streakShown;
    if (n < min) return;
    const fade = this.streakAge < 0.5 ? 1 : Math.max(0, 1 - (this.streakAge - 0.5) / 0.6);
    if (fade <= 0) {
      this.streakShown = 0;
      return;
    }
    const lead = this.leadBall(world);
    const [bx, by] = lead ? this.toScreen(lead.x, lead.y) : [WIDTH / 2, HEIGHT / 2];
    const pop = 1 + 0.35 * Math.exp(-this.streakAge * 14);
    const size = Math.round(Math.min(124, 64 + n * 0.3) * pop);
    const y = Math.max(560, Math.min(1500, by - 40));
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = `900 ${size}px ${font}`;
    // Beside the ball, kept inside the frame (and clear of TikTok's right-hand buttons in the safe style): left of it if the right has no room.
    const w = ctx.measureText(`−${n}`).width;
    const right = SAFE_RECT.x1 - 10;
    let x = bx + 70;
    if (x + w > right) x = bx - 70 - w;
    x = Math.max(40, Math.min(right - w, x));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const big = n >= this.scene.audio.burstAt * 4;
    const jx = big && this.streakAge < 0.5 ? (hash01(Math.floor(this.clock * 30)) - 0.5) * 8 : 0;
    if (big) {
      // Split colors on a big streak.
      ctx.fillStyle = 'rgba(255,40,80,0.8)';
      ctx.fillText(`−${n}`, x - 5 + jx, y);
      ctx.fillStyle = 'rgba(40,220,255,0.8)';
      ctx.fillText(`−${n}`, x + 5 + jx, y);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`−${n}`, x + jx, y);
    ctx.restore();
  }

  /** overlay.vhs: a camcorder stamp (PLAY ▶, a 3 a.m. tape clock) and a faint tracking band. */
  private drawVhs(world: World, secs: number): void {
    const { ctx } = this;
    const t = world.stepCount / PHYSICS_HZ;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = `600 44px ${FONTS.mono}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const top = TIKTOK_ZONES.top + 80;
    if (Math.floor(this.clock * 1.25) % 2 === 0 || world.climaxStep >= 0) ctx.fillText(world.climaxStep >= 0 ? 'STOP ■' : 'PLAY ▶', 64, top);
    ctx.textAlign = 'right';
    const all = Math.floor(secs);
    const mm = 33 + Math.floor(all / 60);
    ctx.fillText(`AM 3:${String(mm).padStart(2, '0')}:${String(all % 60).padStart(2, '0')}`, WIDTH - 64, top);
    ctx.restore();
    // Tracking band: a soft bright band that drifts down the frame, with a few torn lines.
    const band = ((t * 0.11) % 1.3) * HEIGHT - 120;
    const g = ctx.createLinearGradient(0, band - 60, 0, band + 60);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, band - 60, WIDTH, 120);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    const f = Math.floor(t * 30) * 4;
    for (let k = 0; k < 3; k++) {
      const y = band + (hash01(f + k * 17) - 0.5) * 100;
      ctx.fillRect(hash01(f + k * 17 + 1) * 800 - 200, y, 200 + hash01(f + k * 17 + 2) * 600, 1 + hash01(f + k * 17 + 3) * 2);
    }
  }

  /** Team standings: counts or territory shares, and a share bar. */
  private drawTeams(world: World, y: number, font: string, barOnly = false): void {
    const { ctx } = this;
    const teams = world.teams;
    if (!teams.length) return;
    let counts: number[];
    if (world.territory) counts = world.territory.counts;
    else {
      counts = teams.map(() => 0);
      for (const b of world.balls) if (b.alive && !b.projectile && b.team !== undefined) counts[world.teamOf(b.team)]++;
    }
    const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
    // Share bar.
    const bw = 900;
    const bx = (WIDTH - bw) / 2;
    // Just above the counter line, so it stays clear of the arena above.
    const by = y - this.scene.overlay.counterSize - 30;
    let x = bx;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 24, 12);
    ctx.clip();
    teams.forEach((t, i) => {
      const w = (bw * counts[i]) / total;
      ctx.fillStyle = t.color ?? this.scene.style.palette[i % this.scene.style.palette.length];
      ctx.fillRect(x, by, w + 0.5, 24);
      x += w;
    });
    ctx.restore();
    if (barOnly) return;
    const labels = teams.map((t, i) => {
      const v = world.territory ? `${Math.round((100 * counts[i]) / total)}%` : String(counts[i]);
      return `${t.emoji ?? t.name} ${v}`;
    });
    let size = this.scene.overlay.counterSize;
    ctx.font = `700 ${size}px ${font}`;
    const text = labels.join('    ');
    const wide = ctx.measureText(text).width;
    if (wide > 980) {
      size = Math.floor((size * 980) / wide);
      ctx.font = `700 ${size}px ${font}`;
    }
    ctx.fillStyle = this.scene.overlay.textColor;
    ctx.fillText(text, WIDTH / 2, y - 6 - (this.scene.overlay.timer ? this.scene.overlay.counterSize * 1.1 : 0));
  }

  /**
   * The countdown: big digits under the title with a draining bar beneath.
   * Calm while there's time; red, pulsing each second and growing through
   * the final stretch; green and frozen with the time to spare when the
   * climax beats it.
   */
  private drawCountdown(world: World, clock: NonNullable<Scene['clock']>, left: number, font: string): void {
    const { ctx } = this;
    const { overlay } = this.scene;
    const ended = world.climaxStep >= 0;
    const beat = ended && racesClock(this.scene) && world.endReason !== 'timeUp' && world.endReason !== 'caught';
    const final = !ended && clock.final > 0 && left <= clock.final;
    const frac = left / clock.seconds;
    const fmt = (x: number) => (x >= 10 ? `${Math.floor(Math.ceil(x) / 60)}:${String(Math.ceil(x) % 60).padStart(2, '0')}` : x.toFixed(1));
    let text = beat ? `${left.toFixed(2)}s left` : fmt(left);
    // clockLies: for a split second it shows something it shouldn't.
    let lying = false;
    if (overlay.clockLies && !ended && world.stepCount > 0) {
      const bucket = Math.floor(world.time * 3);
      const h = hash01(bucket * 7.7 + 1.9);
      if (h < 0.1 && (world.time * 3) % 1 < 0.4) {
        lying = true;
        text = h < 0.035 ? '0:00' : h < 0.07 ? fmt(left + 11 + Math.floor(hash01(bucket) * 40)) : fmt(clock.seconds * 2 + 6);
      }
    }
    const size = overlay.clockSize;
    const y = this.countdownY;
    // A jump on each whole second that relaxes over ~0.35 s, bigger as zero nears.
    const sub = left - Math.floor(left);
    const urgency = final ? 1 - left / Math.max(clock.final, 1e-6) : 0;
    const pulse = final ? 1 + (0.12 + 0.18 * urgency) * Math.max(0, (sub - 0.65) / 0.35) + 0.1 * urgency : 1;
    const color = lying ? '#ff3b4f' : beat ? '#7cff6b' : final || (ended && left <= 0) ? '#ff3b4f' : frac < 0.5 ? '#ffd23f' : overlay.textColor;

    ctx.save();
    ctx.shadowColor = final ? 'rgba(255,40,60,0.85)' : 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = final ? 28 * pulse : 16;
    ctx.translate(WIDTH / 2, y - size * 0.36);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${size}px ${font}`;
    ctx.fillText(text, 0, 0);
    ctx.restore();

    // The draining bar.
    const bw = Math.min(520, size * 5);
    const bh = Math.max(8, Math.round(size * 0.11));
    const bx = WIDTH / 2 - bw / 2;
    const by = y + size * 0.22;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx, by, Math.max(bh, bw * frac), bh, bh / 2);
      ctx.fill();
    }
    ctx.restore();

    // The final stretch tints the frame edges red, pulsing with the clock.
    if (final) {
      const a = (0.1 + 0.25 * urgency) * (0.55 + 0.45 * Math.max(0, (sub - 0.5) / 0.5));
      const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.38, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.62);
      g.addColorStop(0, 'rgba(255,30,50,0)');
      g.addColorStop(1, `rgba(255,30,50,${a.toFixed(3)})`);
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.restore();
    }
  }

  /** The clock hit zero first: a banner that slams in. */
  private drawTimeUp(world: World, text: string, font: string): void {
    const { ctx } = this;
    const t = (world.stepCount - world.climaxStep) / PHYSICS_HZ;
    const a = Math.min(1, t * 5);
    const scale = 1 + 0.6 * Math.max(0, 1 - t * 4);
    const y = this.safe?.safeText ? Math.min(HEIGHT / 2, SAFE_RECT.y1 - 300) : HEIGHT / 2;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, y - 110, WIDTH, 220);
    ctx.translate(WIDTH / 2, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ff3b4f';
    ctx.shadowColor = 'rgba(255,40,60,0.9)';
    ctx.shadowBlur = 30;
    ctx.font = `900 120px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 6, 1000);
    ctx.restore();
  }

  private drawProgress(world: World, secs: number): void {
    const { ctx } = this;
    const { duration } = this.scene;
    const max = this.scene.clock
      ? this.scene.clock.seconds
      : duration.endOn === 'mostTerritory'
        ? Math.max(1 / PHYSICS_HZ, duration.max - duration.tail)
        : duration.max;
    const f = Math.min(1, secs / max);
    const color = this.scene.overlay.textColor;
    // Safe style: below TikTok's top bar, and the ring clear of the button column.
    const barY = TIKTOK_ZONES.top + 24;
    const ringX = WIDTH - TIKTOK_ZONES.right - 70;
    const ringY = TIKTOK_ZONES.top + 70;
    if (this.scene.overlay.progress === 'bar') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(90, barY, WIDTH - 180, 14, 7);
      ctx.fill();
      ctx.fillStyle = f > 0.85 ? '#ff4d6d' : color;
      ctx.beginPath();
      ctx.roundRect(90, barY, (WIDTH - 180) * (1 - f), 14, 7);
      ctx.fill();
    } else {
      ctx.lineWidth = this.lw(10);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(ringX, ringY, 44, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = f > 0.85 ? '#ff4d6d' : color;
      ctx.beginPath();
      ctx.arc(ringX, ringY, 44, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - f));
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `800 30px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.max(0, Math.ceil(max - secs))), ringX, ringY + 1);
      ctx.textBaseline = 'alphabetic';
    }
    void world;
  }

  /** A message revealed one word (or letter) per bounce. */
  private drawReveal(world: World, counterY: number, font: string): void {
    const { ctx } = this;
    const { overlay } = this.scene;
    const text = overlay.reveal!;
    let shown: string;
    if (overlay.revealBy === 'letters') shown = text.slice(0, world.bounces);
    else shown = text.split(/\s+/).slice(0, world.bounces).join(' ');
    if (!shown) return;
    ctx.font = `900 64px ${font}`;
    ctx.fillStyle = overlay.textColor;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 14;
    this.fillWrapped(shown, WIDTH / 2, counterY - 170, 960, 74);
    ctx.shadowBlur = 0;
  }

  /** Draw word-wrapped text; returns the baseline y of the last line. */
  private fillWrapped(text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
    // Keep wrapped text out of the right-hand button column (centered at 540, so ≤ 840 wide).
    maxWidth = Math.min(maxWidth, TEXT_BAND.width, 2 * (WIDTH - TIKTOK_ZONES.right - x));
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

/** Elapsed time as m:ss.s. */
function clockText(secs: number): string {
  return `${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`;
}
