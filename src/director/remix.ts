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
 * "Make it weird". Rather than a random pile of modifiers, each click picks a
 * vibe and builds a coherent combination for it: one look, one sound, and one
 * or two twists to the physics. The vibes come from the internet aesthetics
 * that do this best:
 *  - analog horror: degraded tape, a mains hum, glitches that snap on and off;
 *  - dreamcore: slowed + reverb, soft haze, pastel, things that drift;
 *  - weirdcore: eyes, out-of-place text, symmetry that's slightly wrong;
 *  - glitch: the frame tearing on every big moment, a stuttering sample;
 *  - cosmic dread: an endless falling (Shepard) tone, a hungry black hole;
 *  - the backrooms: yellow wallpaper, fluorescent buzz, a room that breathes;
 *  - brainrot: the classic stack (meowing, splitting, rainbow, shake).
 * Picks only modifiers that suit the scene (no gap tricks without a ring)
 * and that it doesn't have already. A new seed gives a new combination.
 */
export interface WeirdPick {
  vibe: string;
  mods: (string | Raw)[];
}

type Slot = [string, string | Raw][];

interface Vibe {
  name: string;
  look: Slot;
  sound: Slot;
  twist: Slot;
}

export function weirdPick(merged: Raw, seed: number): WeirdPick {
  const ents: Raw[] = Array.isArray(merged.entities) ? merged.entities : [];
  const has = (t: string) => ents.some((e) => e?.type === t);
  const ringy = has('ring') || has('nested') || has('strata');
  const container = ringy || has('polygon');
  const balls = ents.filter((e) => e?.type === 'ball').reduce((n, e) => n + Number(e.count ?? 1), 0);
  const many = ents.some((e) => e?.type === 'nested' && Number(e.count ?? 5) > 60) || has('strata');
  const current = new Set((Array.isArray(merged.modifiers) ? merged.modifiers : []).map((m: string | Raw) => (typeof m === 'string' ? m : m.use)));
  const audio = merged.audio ?? {};
  const style = merged.style ?? {};
  const camera = merged.camera ?? {};
  const overlay = merged.overlay ?? {};
  const rng = new Rng(seed, 'weird');

  // Whether a modifier suits this scene (and isn't already doing its thing).
  const ok: Record<string, boolean> = {
    'black-hole': container,
    portals: container && !many,
    'gap-jump': ringy && !many,
    'add-side': has('polygon'),
    split: balls <= 6 && !many,
    'clone-trail': balls <= 3 && !many,
    butterfly: balls <= 2,
    meow: audio.instrument !== 'meow',
    rainbow: style.colorMode !== 'rainbow',
    'string-art': balls <= 4 && !many,
    storm: container && !many,
    shake: !(camera.shake > 0),
    slowmo: !(camera.slowmo > 0),
    'gravity-spin': merged.world?.gravity !== 0 && !has('strata'),
    vhs: !overlay.vhs,
    dreamcore: !(audio.reverb > 0.5),
    stutter: audio.escapeStyle === undefined || audio.escapeStyle === 'classic',
    shepard: !audio.drone || audio.drone === 'none',
    glitch: !style.glitch,
    mirror: !style.mirror || style.mirror === 'none',
    eyes: balls >= 1 && balls <= 40,
    whisper: !overlay.reveal,
    breathe: container && !many,
    backrooms: !style.backgroundImage,
    'tunnel-vision': camera.mode !== 'chase' && camera.mode !== 'zoomOut' && container,
    descent: container && !many && camera.mode !== 'chase' && merged.duration?.endOn !== 'never',
  };

  const line = rng.int(8);
  const VIBES: Vibe[] = [
    {
      name: 'analog horror',
      look: [['vhs', 'vhs']],
      sound: [['stutter', { use: 'stutter' }], ['shepard', { use: 'shepard', volume: 0.45 }]],
      twist: [['gap-jump', 'gap-jump'], ['storm', { use: 'storm', rate: 6 }], ['slowmo', 'slowmo'], ['butterfly', { use: 'butterfly', copies: 6 }], ['tunnel-vision', 'tunnel-vision'], ['whisper', { use: 'whisper', line }]],
    },
    {
      name: 'dreamcore',
      look: [['dreamcore', 'dreamcore']],
      sound: [['shepard', { use: 'shepard', volume: 0.35 }], ['meow', 'meow']],
      twist: [['breathe', 'breathe'], ['butterfly', { use: 'butterfly', copies: 8 }], ['string-art', 'string-art'], ['portals', 'portals'], ['mirror', 'mirror'], ['whisper', { use: 'whisper', line }]],
    },
    {
      name: 'weirdcore',
      look: [['eyes', 'eyes'], ['mirror', { use: 'mirror', quad: true }]],
      sound: [['stutter', { use: 'stutter' }], ['dreamcore', 'dreamcore']],
      twist: [['whisper', { use: 'whisper', line }], ['clone-trail', 'clone-trail'], ['gravity-spin', 'gravity-spin'], ['breathe', 'breathe'], ['split', { use: 'split', max: 200 }]],
    },
    {
      name: 'glitch',
      look: [['glitch', 'glitch']],
      sound: [['stutter', { use: 'stutter', at: 3 }]],
      twist: [['portals', 'portals'], ['gap-jump', 'gap-jump'], ['split', { use: 'split', max: 250 }], ['mirror', 'mirror'], ['descent', 'descent']],
    },
    {
      name: 'cosmic dread',
      look: [['tunnel-vision', 'tunnel-vision'], ['glitch', 'glitch']],
      sound: [['shepard', { use: 'shepard', volume: 0.6 }]],
      twist: [['black-hole', { use: 'black-hole', grow: 1.03 }], ['descent', 'descent'], ['storm', { use: 'storm', rate: 6 }], ['breathe', 'breathe'], ['slowmo', 'slowmo']],
    },
    {
      name: 'backrooms',
      look: [['backrooms', 'backrooms']],
      sound: [['stutter', { use: 'stutter' }], ['shepard', { use: 'shepard', volume: 0.3 }]],
      twist: [['breathe', 'breathe'], ['clone-trail', 'clone-trail'], ['gap-jump', 'gap-jump'], ['tunnel-vision', 'tunnel-vision'], ['whisper', { use: 'whisper', line }]],
    },
    {
      name: 'brainrot',
      look: [['rainbow', 'rainbow'], ['shake', 'shake']],
      sound: [['meow', 'meow']],
      twist: [['split', { use: 'split', max: 250 }], ['clone-trail', 'clone-trail'], ['black-hole', { use: 'black-hole', grow: 1.03 }], ['portals', 'portals'], ['string-art', 'string-art'], ['storm', { use: 'storm', rate: 6 }], ['butterfly', { use: 'butterfly', copies: 8 }]],
    },
  ];

  const usable = (slot: Slot, taken: Set<string>) => slot.filter(([name]) => ok[name] !== false && !current.has(name) && !taken.has(name));
  // Try vibes in a seeded order until one gives at least two picks.
  const order = VIBES.map((v) => ({ v, k: rng.next() })).sort((a, b) => a.k - b.k).map((x) => x.v);
  for (const vibe of order) {
    const taken = new Set<string>();
    const mods: (string | Raw)[] = [];
    const take = (slot: Slot, n: number) => {
      for (let i = 0; i < n; i++) {
        const opts = usable(slot, taken);
        if (!opts.length) return;
        const [name, mod] = opts[rng.int(opts.length)];
        taken.add(name);
        mods.push(structuredClone(mod));
      }
    };
    take(vibe.look, 1);
    take(vibe.sound, 1);
    take(vibe.twist, 1 + rng.int(2));
    if (mods.length >= 2) return { vibe: vibe.name, mods };
  }
  return { vibe: '', mods: [] };
}

/** The modifiers of weirdPick (for callers that only need the list). */
export function weirdModifiers(merged: Raw, seed: number): (string | Raw)[] {
  return weirdPick(merged, seed).mods;
}
