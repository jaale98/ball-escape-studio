/**
 * A failing fluorescent tube: how much light there is at a given physics step
 * (1 = fully on, 0.05 = out). Integer hashing only, so the engine (stalkers
 * that move only in the dark) and the renderer's flicker agree exactly, in
 * every browser and in Node.
 */
export function lightLevel(step: number): number {
  // About 4 times a second the tube may cut out for a moment; 18 times a second it may dip.
  const slowK = Math.floor((step * 3) / 480);
  const slowPhase = (step * 3) / 480 - slowK;
  if (hashInt(slowK, 2) < 0.14 && slowPhase < 0.4) return 0.05;
  const fast = hashInt(Math.floor((step * 3) / 40), 1);
  if (fast < 0.1) return 0.3;
  if (fast < 0.24) return 0.72;
  return 1;
}

/** Dark enough for something to move unseen. */
export const isDark = (step: number) => lightLevel(step) <= 0.3;

/** A repeatable number in [0, 1) for an integer (murmur3 finalizer). */
function hashInt(n: number, salt: number): number {
  let h = Math.imul(n ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
