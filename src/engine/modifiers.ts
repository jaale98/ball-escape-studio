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
  clock: {
    description: 'A countdown: beat it or "Time’s up". The final stretch turns red, ticks, and escalates (the exit widens, or balls speed up) so the climax tends to land just before zero.',
    params: {
      seconds: { default: 30, description: 'countdown length' },
      final: { default: 5, description: 'seconds of red, ticking final stretch' },
      rush: { default: true, description: 'escalate through the final stretch' },
    },
    apply: (s, p) => {
      const clock: Raw = { seconds: p.seconds, final: p.final };
      if (p.rush) {
        // Escape formats with ring gaps: the exit widens a little each second. Everything else: more speed, more hits.
        const endOn = s.duration?.endOn ?? 'firstEscape';
        const gapped = (s.entities ?? []).some((e: Raw) => (e.type === 'ring' && e.gaps?.length) || e.type === 'nested');
        clock.rush =
          gapped && (endOn === 'firstEscape' || endOn === 'allEscaped')
            ? [{ do: 'shrinkGap', amount: -3 }]
            : [{ do: 'speedUp', factor: 1.06, max: 3200 }];
      }
      s.clock = clock;
    },
  },
  // ---- weird: looks and sounds from analog horror, dreamcore and weirdcore ------------------
  vhs: {
    description: 'Analog horror: a camcorder tape at 3 a.m. Scanlines, grain, color fringing, glitch tears on big moments, a PLAY ▶ stamp and a mains-hum drone.',
    params: {},
    apply: (s) => {
      Object.assign(obj(s, 'style'), { scanlines: true, grain: true, vignette: true, chromatic: true, glitch: true });
      Object.assign(obj(s, 'overlay'), { vhs: true, font: 'mono' });
      Object.assign(obj(s, 'audio'), { drone: 'hum' });
    },
  },
  dreamcore: {
    description: 'Slowed + reverb: everything a few semitones down in a huge, washed-out hall, soft bloom, long hazy trails and pastel colors.',
    params: { semitones: { default: 5, description: 'how far down the sound goes' } },
    apply: (s, p) => {
      Object.assign(obj(s, 'style'), {
        bloom: true,
        trail: 0.9,
        trailStyle: 'ribbon',
        palette: ['#ffc6ff', '#bde0fe', '#caffbf', '#fdffb6', '#ffd6a5'],
        background: '#1b1530',
        ringColor: '#f5e6ff',
      });
      const audio = obj(s, 'audio');
      Object.assign(audio, { reverb: 0.8, instrument: 'glass', transpose: (audio.transpose ?? 0) - p.semitones });
    },
  },
  stutter: {
    description: 'Every escape restarts one short clip of a voice, cutting itself off, so a run of escapes stutters (a-a-a-a-ah); a streak of them drops into an endless falling swoop.',
    params: { at: { default: 4, description: 'escapes within 0.4 s that count as a streak' } },
    apply: (s, p) => Object.assign(obj(s, 'audio'), { escapeStyle: 'voice', burst: 'dive', burstAt: p.at, escapeSound: true }),
  },
  shepard: {
    description: 'A Shepard tone under everything: a pitch that seems to fall forever and never lands, swelling as the clock runs down.',
    params: { volume: { default: 0.5, description: 'drone volume 0–1' } },
    apply: (s, p) => Object.assign(obj(s, 'audio'), { drone: 'shepard', droneVolume: p.volume }),
  },
  glitch: {
    description: 'Digital glitch: the frame tears into shifted, color-split slices on every big moment, with a bass drop on streaks.',
    params: {},
    apply: (s) => {
      Object.assign(obj(s, 'style'), { glitch: true, chromatic: true });
      obj(s, 'camera').shake = Math.max(1, obj(s, 'camera').shake ?? 0);
      Object.assign(obj(s, 'audio'), { burst: 'drop', burstAt: 3 });
    },
  },
  mirror: {
    description: 'The playfield is mirrored: the left half reflected onto the right (or a four-way kaleidoscope). Text stays readable.',
    params: { quad: { default: false, description: 'four-way kaleidoscope instead of left-right' } },
    apply: (s, p) => (obj(s, 'style').mirror = p.quad ? 'quad' : 'x'),
  },
  eyes: {
    description: 'Every ball becomes an eye.',
    params: {},
    apply: (s) => {
      for (const b of balls(s)) {
        if (b.image || b.images || b.emoji || b.emojis || b.team || b.teams) continue;
        b.emoji = '👁️';
        b.radius = Math.max(b.radius ?? 22, 16);
      }
    },
  },
  whisper: {
    description: 'An out-of-place sentence appears one word per bounce (weirdcore text).',
    params: { line: { default: 0, description: 'which sentence (0–7)' } },
    apply: (s, p) => {
      const lines = [
        'you have been here before',
        'it is not a ring it is a door',
        'do not count the rings',
        'the ball remembers you',
        'nobody is coming to let it out',
        'this is the last time it escapes',
        'the room is bigger on the inside',
        'it was always this way',
      ];
      Object.assign(obj(s, 'overlay'), { reveal: lines[Math.abs(Math.round(p.line)) % lines.length], revealBy: 'words' });
    },
  },
  breathe: {
    description: 'The walls breathe: every ring and polygon slowly swells and shrinks.',
    params: { amount: { default: 18, description: 'px in and out' }, rate: { default: 0.4, description: 'breaths per second' } },
    apply: (s, p) => {
      // A sine wave of radius changes: each firing moves the walls by the slope, so the radius traces amount × cos.
      const w = 2 * Math.PI * p.rate;
      const step = 0.05;
      list(s, 'timeline').push({
        every: step,
        start: step,
        script: `ctx.world.do({ do: 'shrinkContainer', amount: ${round4(p.amount * w * step)} * Math.sin(${round4(w)} * ctx.time), min: 40 })`,
      });
    },
  },
  backrooms: {
    description: 'The backrooms: damp yellow wallpaper, buzzing fluorescent hum, a camcorder grain.',
    params: {},
    apply: (s) => {
      Object.assign(obj(s, 'style'), {
        background: '#b9a95a',
        ringColor: '#4a3f1c',
        palette: ['#f4ecc2', '#6b5a24', '#2b2410', '#e6d58a'],
        grain: true,
        vignette: true,
        backdrop: 'none',
        glow: false,
      });
      Object.assign(obj(s, 'overlay'), { textColor: '#2b2410' });
      Object.assign(obj(s, 'audio'), { drone: 'hum', reverb: Math.max(0.45, obj(s, 'audio').reverb ?? 0) });
    },
  },
  'tunnel-vision': {
    description: 'The camera locks onto the ball up close, so you never see the whole arena.',
    params: { zoom: { default: 2.4, description: 'how close' } },
    apply: (s, p) => {
      Object.assign(obj(s, 'camera'), { mode: 'chase', zoom: p.zoom });
      obj(s, 'style').vignette = true;
    },
  },
  descent: {
    description: 'The ring falls away: gravity points outward from the center (balls fall out through the walls) and the camera follows the ball down.',
    params: { gravity: { default: 2200, description: 'outward pull (px/s²)' } },
    apply: (s, p) => {
      const c = (s.entities ?? []).find((e: Raw) => e.type === 'ring' || e.type === 'polygon' || e.type === 'nested' || e.type === 'strata');
      list(s, 'entities').push({ type: 'force', kind: 'radial', x: c?.x ?? 540, y: c?.y ?? 960, strength: p.gravity, visible: false });
      obj(s, 'world').gravity = 0;
      Object.assign(obj(s, 'camera'), { mode: 'chase', orient: 'down', zoom: Math.max(1.6, obj(s, 'camera').zoom ?? 1) });
    },
  },
  // ---- weird: horror (something follows you) ----------------------------------------------
  'lights-out': {
    description: 'Lights out: pitch black but a pool of light around each ball, from a failing fluorescent tube that stutters and cuts out.',
    params: { light: { default: 190, description: 'radius of the light (px)' }, flicker: { default: true, description: 'the light stutters and cuts out' } },
    apply: (s, p) => Object.assign(obj(s, 'style'), { darkness: 0.97, light: p.light, flicker: p.flicker, vignette: true }),
  },
  stalker: {
    description: 'Something wakes up in the middle and drifts toward the ball, through the walls, faster and faster. Touch it and you are caught; get out of every ring and you are safe.',
    params: {
      speed: { default: 40, description: 'starting speed (px/s)' },
      accel: { default: 9, description: 'speed gained per second' },
      start: { default: 2.5, description: 'seconds before it moves' },
      outside: { default: false, description: 'it starts just outside the outermost wall and comes in, instead of waking in the middle' },
      harmless: { default: false, description: 'touching it only scares (a flash, a shriek), so the scene keeps its own ending' },
    },
    apply: (s, p) => {
      const ents: Raw[] = s.entities ?? [];
      const c = ents.find((e: Raw) => e.type === 'ring' || e.type === 'polygon' || e.type === 'nested' || e.type === 'strata');
      const x = c?.x ?? 540;
      let y = c?.y ?? 960;
      if (p.outside) {
        // The outermost wall: ring and polygon radius, nested rings' outer.
        const reach = Math.max(0, ...ents.map((e: Raw) => (e.type === 'ring' || e.type === 'polygon' ? (e.radius ?? 0) : e.type === 'nested' ? (e.outer ?? 0) : 0)));
        y += Math.min(reach + 90, 900);
      }
      list(s, 'entities').push({ type: 'stalker', mode: 'chase', x, y, speed: p.speed, accel: p.accel, start: p.start, deadly: !p.harmless });
      obj(s, 'style').chromatic = true;
      obj(s, 'camera').shake = Math.max(0.6, obj(s, 'camera').shake ?? 0);
    },
  },
  shadow: {
    description: 'The ball’s own shadow retraces its path a few seconds behind and slowly closes the gap. Stop moving, or cross your own path, and it catches you.',
    params: { delay: { default: 3, description: 'seconds behind at the start' }, catchUp: { default: 0.06, description: 'seconds it wins back each second' } },
    apply: (s, p) => {
      list(s, 'entities').push({ type: 'stalker', mode: 'shadow', delay: p.delay, catchUp: p.catchUp, start: p.delay, radius: 22 });
      obj(s, 'style').chromatic = true;
    },
  },
  watchers: {
    description: 'A circle of eyes just outside the arena that follow the ball wherever it goes. They never move, but brush past one and it shrieks and vanishes (only to come back).',
    params: { count: { default: 14, description: 'how many pairs of eyes' }, gap: { default: 70, description: 'px outside the outermost wall' } },
    apply: (s, p) => {
      const ents: Raw[] = s.entities ?? [];
      const c = ents.find((e: Raw) => e.type === 'ring' || e.type === 'polygon' || e.type === 'nested');
      const reach = Math.max(120, ...ents.map((e: Raw) => (e.type === 'ring' || e.type === 'polygon' ? (e.radius ?? 0) : e.type === 'nested' ? (e.outer ?? 0) : 0)));
      list(s, 'entities').push({ type: 'stalker', mode: 'chase', x: c?.x ?? 540, y: c?.y ?? 960, count: Math.max(2, Math.round(p.count)), circle: reach + p.gap, speed: 0, accel: 0, start: 0, radius: 22, deadly: false });
    },
  },
  heartbeat: {
    description: 'A heartbeat under everything that races as the stalker closes in (or as the clock runs down).',
    params: { volume: { default: 0.8, description: 'volume 0–1' } },
    apply: (s, p) => Object.assign(obj(s, 'audio'), { drone: 'heartbeat', droneVolume: p.volume }),
  },
  backmask: {
    description: 'Backmasked: each escape is a voice played backwards that restarts on the next one; a streak of escapes is a tape sucked into rewind.',
    params: { at: { default: 4, description: 'escapes within 0.4 s that count as a streak' } },
    apply: (s, p) => Object.assign(obj(s, 'audio'), { escapeStyle: 'reverse', burst: 'rewind', burstAt: p.at, escapeSound: true }),
  },
  'music-box': {
    description: 'A worn-out music box: bounces ring high and glassy in a big room, escapes are a warbling tine that restarts each time.',
    params: {},
    apply: (s) => {
      const audio = obj(s, 'audio');
      Object.assign(audio, { instrument: 'bell', transpose: (audio.transpose ?? 0) + 12, escapeStyle: 'musicbox', escapeSound: true, reverb: Math.max(0.5, audio.reverb ?? 0) });
    },
  },
  subliminal: {
    description: 'Single frames of words flash by, easy to miss (and on every big moment).',
    params: { set: { default: 0, description: 'which words (0–3)' } },
    apply: (s, p) => {
      const sets = [
        ['wake up', 'behind you', 'it sees you', 'not real'],
        ['look away', 'don’t blink', 'stay', 'it knows'],
        ['help', 'let me out', 'again', 'why'],
        ['run', 'closer', 'now', 'sorry'],
      ];
      obj(s, 'style').subliminal = sets[Math.abs(Math.round(p.set)) % sets.length];
    },
  },
  droste: {
    description: 'The room repeats: the frame shows inside itself, again and again, each copy smaller and turned a little.',
    params: { levels: { default: 3, description: 'how many times (1–6)' } },
    apply: (s, p) => (obj(s, 'style').droste = Math.max(1, Math.min(6, Math.round(p.levels)))),
  },
  liar: {
    description: 'The countdown lies: for a split second it skips back, or flashes 0:00.',
    params: {},
    apply: (s) => (obj(s, 'overlay').clockLies = true),
  },
  unease: {
    description: 'The camera is never quite level: it slowly tilts, drifts and breathes.',
    params: { amount: { default: 0.6, description: '0–1' } },
    apply: (s, p) => (obj(s, 'camera').unease = Math.max(0, Math.min(1, p.amount))),
  },
  countdown: {
    description: 'A 3-2-1-GO intro with the run frozen.',
    params: { count: { default: 3, description: 'counts' } },
    apply: (s, p) => (obj(s, 'camera').countdown = p.count),
  },
};

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

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
