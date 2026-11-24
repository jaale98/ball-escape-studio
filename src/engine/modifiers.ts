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
