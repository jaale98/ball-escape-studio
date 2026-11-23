/** FNV-1a 32-bit hash of a string. Used to derive independent random streams. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Seeded random number generator (mulberry32).
 * Each named stream is independent, so changing how many random numbers one
 * system uses (say, particles) never reshuffles another (say, ball spawns).
 */
export class Rng {
  private a: number;

  constructor(seed: number, stream = '') {
    this.a = (hashString(stream) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
