/**
 * Remixes: new versions of a scene that keep its idea but change the look,
 * sound and feel (palette, background, instrument, melody, a little speed and
 * spin). Each remix is a scene source that extends the original.
 */
import { Rng } from '../engine/rng';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const PALETTES: { name: string; palette: string[]; background: string; ring: string }[] = [
  { name: 'neon', palette: ['#ff4d6d', '#4dd4ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c'], background: '#06060b', ring: '#ffffff' },
  { name: 'pastel', palette: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'], background: '#16131f', ring: '#fff4e6' },
  { name: 'sunset', palette: ['#ff6b6b', '#ffa94d', '#ffd43b', '#f783ac', '#cc5de8'], background: '#1a0b14', ring: '#ffd8a8' },
  { name: 'ocean', palette: ['#4dd4ff', '#38d9a9', '#74c0fc', '#e599f7', '#ffffff'], background: '#03101c', ring: '#a5d8ff' },
  { name: 'mono', palette: ['#ffffff', '#ced4da', '#adb5bd'], background: '#000000', ring: '#ffffff' },
  { name: 'lava', palette: ['#ff922b', '#ff6b6b', '#ffd43b', '#ffa8a8'], background: '#140404', ring: '#ff8787' },
  { name: 'forest', palette: ['#69db7c', '#a9e34b', '#ffe066', '#63e6be'], background: '#06120a', ring: '#d3f9d8' },
];
const INSTRUMENTS = ['pluck', 'bell', 'marimba'];
const MELODIES = ['pentatonic', 'ode-to-joy', 'fur-elise'];

/** Remix k (1-based) of a merged scene source named `name`. */
export function remix(name: string, merged: Raw, k: number): { name: string; raw: Raw; label: string } {
  const rng = new Rng(k * 7919, `remix:${name}`);
  const look = PALETTES[(k - 1 + rng.int(PALETTES.length)) % PALETTES.length];
  const raw: Raw = {
    extends: name,
    title: `${merged.title ?? name} · ${look.name} remix`,
    style: { palette: look.palette, background: look.background, ringColor: look.ring },
    audio: { instrument: INSTRUMENTS[(k + rng.int(3)) % 3] },
    world: { speedScale: round((merged.world?.speedScale ?? 1) * rng.range(0.92, 1.1)), spinScale: round((merged.world?.spinScale ?? 1) * rng.range(0.85, 1.2)) },
  };
  // Keep MIDI songs (the user chose them); otherwise vary the melody too.
  if (!String(merged.audio?.melody ?? '').startsWith('midi:')) raw.audio.melody = MELODIES[rng.int(MELODIES.length)];
  // Recolour entities that pin their own colours (unless they're named teams).
  if (Array.isArray(merged.entities)) {
    raw.entities = merged.entities.map((e: Raw) => {
      const c = structuredClone(e);
      if (c.type === 'ball' && !c.labels) {
        if (c.colors) c.colors = c.colors.map((_: string, i: number) => look.palette[i % look.palette.length]);
        if (c.color && !c.frozen) c.color = look.palette[rng.int(look.palette.length)];
      }
      if ((c.type === 'ring' || c.type === 'polygon' || c.type === 'wall' || c.type === 'peg') && c.color) delete c.color;
      if (c.type === 'nested' && c.colors) c.colors = look.palette;
      return c;
    });
  }
  return { name: `${name}-remix-${k}`, raw, label: `${look.name} · ${raw.audio.instrument}` };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
