/** A small self-contained preview: one World + Renderer on a canvas, looping (optionally with sound). */
import { playVoice, SoundMapper } from '../audio/sound';
import type { Scene } from '../engine/scene';
import { DT, World } from '../engine/world';
import { Renderer } from '../render/renderer';

export class Player {
  world: World;
  private renderer: Renderer;
  private acc = 0;
  private endedFor = 0;
  private mapper: SoundMapper;
  private cursor = 0;

  /** `audio` returns where to play sound right now, or null for silence. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly scale: number,
    private readonly audio: () => { ctx: AudioContext; master: AudioNode } | null = () => null,
  ) {
    this.mapper = new SoundMapper(scene);
    this.world = new World(scene);
    this.renderer = new Renderer(canvas, scene, { scale, glow: scale >= 0.5 });
    this.renderer.render(this.world, 0);
  }

  restart(): void {
    this.world = new World(this.scene);
    this.renderer = new Renderer(this.canvas, this.scene, { scale: this.scale, glow: this.scale >= 0.5 });
    this.acc = 0;
    this.endedFor = 0;
    this.mapper = new SoundMapper(this.scene);
    this.cursor = 0;
  }

  /** Advance by real seconds and draw. Loops 1.5 s after the run ends. */
  tick(dt: number): void {
    if (!this.world.done) {
      this.acc += dt;
      while (this.acc >= DT && !this.world.done) {
        this.world.step();
        this.acc -= DT;
      }
    } else if ((this.endedFor += dt) > 1.5) this.restart();
    const a = this.audio();
    const events = this.world.events;
    if (a && a.ctx.state === 'running') {
      for (; this.cursor < events.length; this.cursor++) {
        const v = this.mapper.map(events[this.cursor]);
        if (v) playVoice(a.ctx, a.master, v, a.ctx.currentTime + 0.03, this.scene.audio.instrument);
      }
    } else this.cursor = events.length;
    this.renderer.render(this.world, dt);
  }
}
