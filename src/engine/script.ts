/**
 * Custom rule scripts: small pieces of JavaScript in a scene file that run on
 * an event (rules) or on a schedule (timeline). They let a scene do things the
 * built-in actions can't, while staying deterministic.
 *
 *   { "on": "hit", "script": "if (ctx.other) ctx.ball.color = ctx.other.color" }
 *
 * What a script gets (`ctx`):
 *   ctx.event      'bounce' | 'escape' | 'hit' | 'eliminate' | 'strike' | 'wake' | 'timeline'
 *   ctx.time       seconds since the start
 *   ctx.ball       the ball the event happened to (mutable: x, y, vx, vy, r, color, hp, label…), or null
 *   ctx.other      the other ball in a hit / strike / wake, or null
 *   ctx.container  the ring or polygon involved (mutable: spin, radius, gaps…), or null
 *   ctx.world      balls(), spawn({x,y,speed,direction,radius,color}), do(action), gravity(x, y), end(), time, bounces
 *   ctx.rng        seeded randomness: next(), range(min, max), int(n)
 *   ctx.state      an object that persists between calls (counters, flags)
 *
 * Determinism: Math.random, Date, timers and network access are not available.
 * This is not a security sandbox: scene scripts are code, so only open scene
 * files you trust. The studio runs every scripted scene headless in a Worker
 * first, so a script that loops forever is caught instead of freezing the page.
 */
import type { Ball, Container } from './world';

export interface ScriptWorld {
  balls(): Ball[];
  spawn(opts?: { x?: number; y?: number; speed?: number; direction?: number; radius?: number; color?: string; spread?: number }): Ball | null;
  do(action: unknown): void;
  gravity(x: number, y: number): void;
  end(): void;
  readonly time: number;
  readonly bounces: number;
}

export interface ScriptContext {
  event: string;
  time: number;
  ball: Ball | null;
  other: Ball | null;
  container: Container | null;
  world: ScriptWorld;
  rng: { next(): number; range(min: number, max: number): number; int(n: number): number };
  state: Record<string, unknown>;
}

export type ScriptFn = (ctx: ScriptContext) => void;

/** Math without Math.random. */
const SAFE_MATH: Readonly<Record<string, unknown>> = Object.freeze(
  Object.fromEntries(Object.getOwnPropertyNames(Math).filter((k) => k !== 'random').map((k) => [k, (Math as unknown as Record<string, unknown>)[k]])),
);

/** Names shadowed (set to undefined) inside scripts. */
const SHADOWED = ['Date', 'window', 'document', 'globalThis', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval', 'performance', 'crypto', 'process', 'require'];

/** Compile a script. Throws a scene-style error if it doesn't parse. */
export function compileScript(src: string, where: string): ScriptFn {
  let fn: (...args: unknown[]) => unknown;
  try {
    fn = new Function('ctx', 'Math', ...SHADOWED, `"use strict";\n${src}`) as (...args: unknown[]) => unknown;
  } catch (err) {
    throw new Error(`Invalid scene:\n${where}: script does not compile: ${(err as Error).message}`);
  }
  return (ctx) => void fn(ctx, SAFE_MATH);
}
