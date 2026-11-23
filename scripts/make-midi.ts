/**
 * Writes songs/minuet-in-g.mid: the Minuet in G (Petzold, public domain),
 * melody plus a simple bass on each downbeat. Also a fixture for the MIDI reader.
 */
import { writeFileSync } from 'node:fs';

const Q = 480; // ticks per quarter note
const E = Q / 2;
// [midi note, duration in ticks]. 3/4 time.
const melody: [number, number][] = [
  [74, Q], [67, E], [69, E], [71, E], [72, E], [74, Q], [67, Q], [67, Q],
  [76, Q], [72, E], [74, E], [76, E], [78, E], [79, Q], [67, Q], [67, Q],
  [72, Q], [74, E], [72, E], [71, E], [69, E], [71, Q], [72, E], [71, E], [69, E], [67, E],
  [66, Q], [67, E], [69, E], [71, E], [67, E], [71, Q], [69, Q * 2],
  [74, Q], [67, E], [69, E], [71, E], [72, E], [74, Q], [67, Q], [67, Q],
  [76, Q], [72, E], [74, E], [76, E], [78, E], [79, Q], [67, Q], [67, Q],
  [72, Q], [74, E], [72, E], [71, E], [69, E], [71, Q], [72, E], [71, E], [69, E], [67, E],
  [69, Q], [71, E], [69, E], [67, E], [66, E], [67, Q * 3],
];
// One bass note per bar (dotted half).
const bass = [55, 59, 60, 59, 57, 55, 62, 50, 55, 59, 60, 59, 57, 55, 50, 43];

type Ev = { tick: number; bytes: number[] };
const evs: Ev[] = [];
let t = 0;
for (const [n, d] of melody) {
  evs.push({ tick: t, bytes: [0x90, n, 90] }, { tick: t + d - 10, bytes: [0x80, n, 0] });
  t += d;
}
bass.forEach((n, bar) => {
  const at = bar * Q * 3;
  evs.push({ tick: at, bytes: [0x91, n, 70] }, { tick: at + Q * 3 - 10, bytes: [0x81, n, 0] });
});
evs.sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));

const varint = (v: number) => {
  const out = [v & 0x7f];
  while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
  return out;
};
const track: number[] = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // tempo 120 bpm
let last = 0;
for (const e of evs) {
  track.push(...varint(e.tick - last), ...e.bytes);
  last = e.tick;
}
track.push(0x00, 0xff, 0x2f, 0x00);
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const file = [
  ...[0x4d, 0x54, 0x68, 0x64], ...u32(6), 0, 0, 0, 1, (Q >> 8) & 255, Q & 255,
  ...[0x4d, 0x54, 0x72, 0x6b], ...u32(track.length), ...track,
];
writeFileSync('songs/minuet-in-g.mid', Uint8Array.from(file));
console.log(`wrote songs/minuet-in-g.mid (${file.length} bytes, ${melody.length} melody notes)`);
