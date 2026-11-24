/**
 * Modifiers: named, stackable tweaks that turn one format into another.
 * A scene lists them as "modifiers": ["multiply", { "use": "grow-on-bounce", "amount": 3 }].
 * Each one edits the raw scene (before defaults are filled in). A modifier sets
 * whatever its format needs (e.g. "multiply" forces endOn: never), even if a
 * parent scene set something else; list your own overrides after it if needed.
 */

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Params = Record<string, unknown>;

interface ModifierDef {
  description: string;
  params: Record<string, { default: number | boolean; description: string }>;
  apply: (scene: Raw, p: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const obj = (scene: Raw, key: string): Raw => (scene[key] ??= {});
const list = (scene: Raw, key: string): unknown[] => (scene[key] ??= []);
const balls = (scene: Raw): Raw[] => (scene.entities ?? []).filter((e: Raw) => e.type === 'ball');

export const MODIFIERS: Record<string, ModifierDef> = {
  'grow-on-bounce': {
    description: 'The ball grows a little with every wall bounce. Ends when it fills its ring.',
    params: { amount: { default: 2, description: 'px of radius per bounce' } },
    apply: (s, p) => list(s, 'rules').push({ on: 'bounce', do: [{ do: 'grow', amount: p.amount }] }),
  },
  'shrinking-gap': {
    description: 'The exit gets narrower with every bounce.',
    params: { amount: { default: 1.5, description: 'degrees per bounce' }, min: { default: 3, description: 'smallest gap in degrees' } },
    apply: (s, p) => list(s, 'rules').push({ on: 'bounce', do: [{ do: 'shrinkGap', amount: p.amount, min: p.min }] }),
  },
  'speed-up': {
    description: 'Every bounce makes the ball a little faster.',
    params: { factor: { default: 1.03, description: 'speed multiplier per bounce' }, max: { default: 2600, description: 'top speed px/s' } },
    apply: (s, p) => list(s, 'rules').push({ on: 'bounce', do: [{ do: 'speedUp', factor: p.factor, max: p.max }] }),
  },
  'spin-up': {
    description: 'Every bounce spins the container faster.',
    params: { factor: { default: 1.04, description: 'spin multiplier per bounce' }, max: { default: 6, description: 'top spin rad/s' } },
    apply: (s, p) => list(s, 'rules').push({ on: 'bounce', do: [{ do: 'spinUp', factor: p.factor, max: p.max }] }),
  },
  multiply: {
    description: 'Every escape spawns new balls back inside. Runs to the time limit.',
    params: { count: { default: 2, description: 'balls spawned per escape' } },
    apply: (s, p) => {
      list(s, 'rules').push({ on: 'escape', do: [{ do: 'spawn', count: p.count }] });
      obj(s, 'duration').endOn = 'never';
      obj(s, 'overlay').counter = 'balls';
    },
  },
  'zero-g': {
    description: 'No gravity: balls fly in straight lines.',
    params: {},
    apply: (s) => (obj(s, 'world').gravity = 0),
  },
  'gravity-flip': {
    description: 'Gravity reverses on a timer.',
    params: { every: { default: 5, description: 'seconds between flips' } },
    apply: (s, p) => list(s, 'timeline').push({ every: p.every, start: p.every, do: [{ do: 'flipGravity' }] }),
  },
  'gravity-spin': {
    description: 'Gravity rotates a quarter turn on a timer.',
    params: { every: { default: 4, description: 'seconds between turns' }, degrees: { default: 90, description: 'degrees per turn' } },
    apply: (s, p) => list(s, 'timeline').push({ every: p.every, start: p.every, do: [{ do: 'rotateGravity', degrees: p.degrees }] }),
  },
  paint: {
    description: 'Balls leave permanent paint instead of fading trails.',
    params: {},
    apply: (s) => {
      obj(s, 'style').paint = true;
      obj(s, 'style').trail = 0;
    },
  },
  battle: {
    description: 'Balls lose hp when they collide; the last one standing wins.',
    params: { hp: { default: 10, description: 'starting hp per ball' }, damage: { default: 1, description: 'hp lost per hit' } },
    apply: (s, p) => {
      for (const b of balls(s)) b.hp ??= p.hp;
      list(s, 'rules').push({ on: 'hit', do: [{ do: 'damage', amount: p.damage, when: 'defending' }] });
      obj(s, 'duration').endOn = 'lastStanding';
      obj(s, 'overlay').counter = 'balls';
    },
  },
  race: {
    description: 'First ball out wins.',
    params: {},
    apply: (s) => {
      obj(s, 'duration').endOn = 'firstEscape';
      obj(s, 'overlay').winner = true;
    },
  },
  // ---- V2 ----------------------------------------------------------------------
  'break-rings': {
    description: 'Rings are cut into segments that break when hit: the ball smashes its way out.',
    params: { segments: { default: 24, description: 'segments per ring' }, hp: { default: 1, description: 'bounces each segment takes' } },
    apply: (s, p) => {
      for (const e of s.entities ?? []) if (e.type === 'ring' || e.type === 'nested') Object.assign(e, { segments: p.segments, segmentHp: p.hp });
      obj(s, 'style').ringStyle ??= 'segments';
    },
  },
  'hp-ring': {
    description: 'Each ring has hit points and shatters when they run out.',
    params: { hp: { default: 60, description: 'bounces to break a ring' } },
    apply: (s, p) => {
      for (const e of s.entities ?? []) if (e.type === 'ring' || e.type === 'nested') e.hp = p.hp;
      obj(s, 'overlay').counter = 'hp';
    },
  },
  split: {
    description: 'Every bounce splits the ball in two (until they get tiny).',
    params: { min: { default: 7, description: 'smallest radius that still splits' }, max: { default: 400, description: 'max balls' } },
    apply: (s, p) => {
      list(s, 'rules').push({ on: 'bounce', do: [{ do: 'split', min: p.min }] });
      obj(s, 'world').maxBalls = p.max;
      obj(s, 'duration').endOn = 'never';
      obj(s, 'overlay').counter = 'balls';
    },
  },
  absorb: {
    description: 'Bigger eats smaller: on contact the bigger ball swallows the smaller one. Last one wins.',
    params: {},
    apply: (s) => {
      list(s, 'rules').push({ on: 'hit', do: [{ do: 'absorb' }] });
      obj(s, 'duration').endOn = 'lastStanding';
      obj(s, 'overlay').counter = 'balls';
    },
  },
  merge: {
    description: 'Two balls of the same level merge into a bigger one.',
    params: { growth: { default: 1.25, description: 'radius multiplier per level' } },
    apply: (s, p) => list(s, 'rules').push({ on: 'hit', do: [{ do: 'merge', growth: p.growth }] }),
  },
  infection: {
    description: 'One zombie, everyone else human: a zombie hit turns a human. Ends when everyone has turned.',
    params: { chance: { default: 0.35, description: 'chance a hit infects' } },
    apply: (s, p) => {
      if (!s.teams?.length) {
        s.teams = [
          { name: 'zombie', color: '#7cff6b', emoji: '🧟', beats: ['human'] },
          { name: 'human', color: '#4dd4ff', emoji: '🙂', beats: [] },
        ];
        for (const b of balls(s)) b.teams ??= ['zombie', ...Array.from({ length: Math.max(0, (b.count ?? 1) - 1) }, () => 'human')];
      }
      list(s, 'rules').push({ on: 'hit', do: [{ do: 'convert', chance: p.chance }] });
      obj(s, 'duration').endOn = 'oneTeam';
      obj(s, 'overlay').counter = 'teams';
    },
  },
  rps: {
    description: 'Rock, paper, scissors: every hit converts the loser. Ends when one side owns the arena.',
    params: {},
    apply: (s) => {
      if (!s.teams?.length) {
        s.teams = [
          { name: 'rock', color: '#b8b8c8', emoji: '🪨', beats: ['scissors'] },
          { name: 'paper', color: '#f4f1de', emoji: '📄', beats: ['rock'] },
          { name: 'scissors', color: '#ff4d6d', emoji: '✂️', beats: ['paper'] },
        ];
        for (const b of balls(s)) b.teams ??= ['rock', 'paper', 'scissors'];
      }
      list(s, 'rules').push({ on: 'hit', do: [{ do: 'convert' }] });
      obj(s, 'duration').endOn = 'oneTeam';
      obj(s, 'overlay').counter = 'teams';
    },
  },
  'black-hole': {
    description: 'A black hole in the middle pulls everything in and swallows what gets too close.',
    params: {
      strength: { default: 1400, description: 'pull at 100 px (px/s²)' },
      swallow: { default: 34, description: 'event horizon radius (px)' },
      grow: { default: 1.04, description: 'it gets this much stronger every second (1 = never)' },
    },
    apply: (s, p) => {
      const c = (s.entities ?? []).find((e: Raw) => e.type === 'ring' || e.type === 'polygon' || e.type === 'nested');
      list(s, 'entities').push({ type: 'force', kind: 'attract', x: c?.x ?? 540, y: c?.y ?? 960, strength: p.strength, swallow: p.swallow });
      if (p.grow !== 1) list(s, 'timeline').push({ every: 1, start: 1, do: [{ do: 'growForce', factor: p.grow, swallow: 0.6 }] });
      obj(s, 'overlay').counter = 'balls';
    },
  },
  storm: {
    description: 'The arena shrinks steadily (battle royale storm).',
    params: { rate: { default: 8, description: 'px per second' }, min: { default: 140, description: 'smallest radius' } },
    apply: (s, p) => list(s, 'timeline').push({ every: 0.1, start: 2, do: [{ do: 'shrinkContainer', amount: p.rate / 10, min: p.min }] }),
  },
  'add-side': {
    description: 'Every bounce adds a side to the polygon: triangle to circle.',
    params: { max: { default: 24, description: 'most sides' } },
    apply: (s, p) => list(s, 'rules').push({ on: 'bounce', do: [{ do: 'addSide', max: p.max }] }),
  },
  'gap-jump': {
    description: 'The exit jumps to a new random spot on every bounce.',
    params: {},
    apply: (s) => list(s, 'rules').push({ on: 'bounce', do: [{ do: 'moveGap' }] }),
  },
  'clone-trail': {
    description: 'Every bounce leaves a frozen clone behind; the ring slowly jams up.',
    params: { max: { default: 260, description: 'max balls' } },
    apply: (s, p) => {
      list(s, 'rules').push({ on: 'bounce', do: [{ do: 'clone' }] });
      obj(s, 'world').maxBalls = p.max;
      obj(s, 'overlay').counter = 'balls';
    },
  },
  butterfly: {
    description: 'Butterfly effect: ghost copies of each ball launched a millionth of a degree apart. They never touch, and slowly drift apart.',
    params: { copies: { default: 10, description: 'copies per ball' } },
    apply: (s, p) => {
      for (const b of balls(s)) b.copies = p.copies;
      obj(s, 'duration').endOn = obj(s, 'duration').endOn === 'firstEscape' ? 'allEscaped' : obj(s, 'duration').endOn;
    },
  },
  'string-art': {
    description: 'Every bounce draws a line to the last bounce point: string art.',
    params: {},
    apply: (s) => {
      obj(s, 'style').lines = 'web';
      obj(s, 'style').trail = 0.6;
    },
  },
  slowmo: {
    description: 'Slow motion around the climax.',
    params: { seconds: { default: 2, description: 'seconds of slow motion' }, factor: { default: 0.25, description: 'speed during slow motion' } },
    apply: (s, p) => Object.assign(obj(s, 'camera'), { slowmo: p.seconds, slowmoFactor: p.factor }),
  },
  meow: {
    description: 'Every bounce meows (in tune).',
    params: {},
    apply: (s) => (obj(s, 'audio').instrument = 'meow'),
  },
  rainbow: {
    description: 'Colors drift through the rainbow, with rainbow trails.',
    params: {},
    apply: (s) => Object.assign(obj(s, 'style'), { colorMode: 'rainbow', trailStyle: 'rainbow' }),
  },
  shake: {
    description: 'Screen shake on breaks, escapes and knockouts.',
    params: { amount: { default: 1, description: '0–3' } },
    apply: (s, p) => (obj(s, 'camera').shake = p.amount),
  },
  portals: {
    description: 'A pair of linked portals inside the arena.',
    params: { radius: { default: 42, description: 'portal size (px)' } },
    apply: (s, p) => {
      const c = (s.entities ?? []).find((e: Raw) => e.type === 'ring' || e.type === 'polygon' || e.type === 'nested');
      const x = c?.x ?? 540;
      const y = c?.y ?? 960;
      const R = (c?.type === 'nested' ? c.inner : c?.radius) ?? 420;
      list(s, 'entities').push({ type: 'portal', a: [x - R * 0.45, y - R * 0.25], b: [x + R * 0.4, y + R * 0.35], radius: p.radius });
    },
  },
  countdown: {
    description: 'A 3-2-1-GO intro with the run frozen.',
    params: { count: { default: 3, description: 'counts' } },
    apply: (s, p) => (obj(s, 'camera').countdown = p.count),
  },
};

/** Apply a "modifiers" list to a raw scene, in order. */
export function applyModifiers(scene: Raw, mods: unknown): void {
  if (mods === undefined) return;
  if (!Array.isArray(mods)) throw new Error('modifiers: must be a list');
  mods.forEach((m, i) => {
    const name = typeof m === 'string' ? m : (m as Params)?.use;
    const def = typeof name === 'string' ? MODIFIERS[name] : undefined;
    if (!def) throw new Error(`modifiers.${i}: unknown modifier "${String(name)}". Available: ${Object.keys(MODIFIERS).join(', ')}`);
    const given = typeof m === 'string' ? {} : { ...(m as Params) };
    delete given.use;
    for (const k of Object.keys(given)) {
      if (!(k in def.params)) throw new Error(`modifiers.${i} (${name}): unknown option "${k}". Options: ${Object.keys(def.params).join(', ') || 'none'}`);
    }
    const params = Object.fromEntries(Object.entries(def.params).map(([k, v]) => [k, given[k] ?? v.default]));
    def.apply(scene, params);
  });
}
