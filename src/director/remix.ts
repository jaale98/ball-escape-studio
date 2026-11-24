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
const INSTRUMENTS = ['pluck', 'bell', 'marimba', 'glass', 'chip', 'piano', 'kalimba', 'pop', 'synth'];
const MELODIES = ['pentatonic', 'ode-to-joy', 'fur-elise'];

/** Remix k (1-based) of a merged scene source named `name`. */
export function remix(name: string, merged: Raw, k: number): { name: string; raw: Raw; label: string } {
  const rng = new Rng(k * 7919, `remix:${name}`);
  const look = PALETTES[(k - 1 + rng.int(PALETTES.length)) % PALETTES.length];
  const raw: Raw = {
    extends: name,
    title: `${merged.title ?? name} · ${look.name} remix`,
    style: { palette: look.palette, background: look.background, ringColor: look.ring },
    audio: { instrument: INSTRUMENTS[(k + rng.int(INSTRUMENTS.length)) % INSTRUMENTS.length] },
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

/**
 * "Make it weird": two or three surreal modifiers that suit this scene, picked
 * with `seed` (a new seed gives a new combination).
 */
export function weirdModifiers(merged: Raw, seed: number): (string | Raw)[] {
  const ents: Raw[] = Array.isArray(merged.entities) ? merged.entities : [];
  const has = (t: string) => ents.some((e) => e?.type === t);
  const ringy = has('ring') || has('nested');
  const container = ringy || has('polygon');
  const balls = ents.filter((e) => e?.type === 'ball').reduce((n, e) => n + Number(e.count ?? 1), 0);
  const current = new Set((Array.isArray(merged.modifiers) ? merged.modifiers : []).map((m: string | Raw) => (typeof m === 'string' ? m : m.use)));
  const pool: [string, string | Raw, boolean][] = [
    ['black-hole', { use: 'black-hole', grow: 1.03 }, container],
    ['portals', 'portals', container],
    ['gap-jump', 'gap-jump', ringy],
    ['add-side', 'add-side', has('polygon')],
    ['split', { use: 'split', max: 250 }, balls <= 6],
    ['clone-trail', 'clone-trail', balls <= 3],
    ['butterfly', { use: 'butterfly', copies: 8 }, balls <= 2],
    ['meow', 'meow', true],
    ['rainbow', 'rainbow', true],
    ['string-art', 'string-art', balls <= 4],
    ['storm', { use: 'storm', rate: 6 }, container],
    ['shake', 'shake', true],
    ['slowmo', 'slowmo', true],
  ];
  const options = pool.filter(([name, , ok]) => ok && !current.has(name));
  const rng = new Rng(seed, 'weird');
  const picks: (string | Raw)[] = [];
  const n = Math.min(options.length, 2 + rng.int(2));
  while (picks.length < n) {
    const [, mod] = options.splice(rng.int(options.length), 1)[0];
    picks.push(mod);
  }
  return picks;
}
