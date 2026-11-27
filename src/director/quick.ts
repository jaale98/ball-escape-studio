/**
 * Quick settings: a handful of ready-made variations per scene, each known to
 * make a good video (its seed is tuned by the Director for its story).
 *
 * They live in quick/<scene>.json, never in the scene file, so picking one
 * never changes the scene's own defaults. A quick setting is a small layer
 * applied on top of the scene source before it resolves:
 *
 *   patch      deep-merged like "extends" (objects key by key, arrays replaced)
 *   set        dotted paths ("entities.1.speed": 900) for one item in a list
 *   modifiers  appended to the scene's own modifiers
 *   seed       the tuned seed (npm run quick -- <scene> --tune writes it)
 *
 * Pure: runs in the studio, in Workers and in Node (scripts/quick.ts).
 */
import { z } from 'zod';
import { racesClock, type Scene } from '../engine/scene';
import { deepMerge, ModifierListSchema, resolveScene, setPath, SourceSchema } from '../engine/source';
import { defaultTarget, defaultTemplate, type DirectorOptions, type RunScore, TEMPLATES, type Template } from './score';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const KINDS = ['pace', 'look', 'sound', 'twist', 'vibe'] as const;
export type QuickKind = (typeof KINDS)[number];

const quickFields = {
  name: z.string().min(1).max(32).describe('Short and punchy: "Buzzer beater", "Neon rush".'),
  emoji: z.string().max(16).optional().describe('One emoji for the card.'),
  kind: z.enum(KINDS).optional().describe('pace (timing and length), look (colors and style), sound, twist (the physics change), vibe (look + sound + mood).'),
  note: z.string().max(160).optional().describe('One line on what changes and why it works.'),
  seed: z.number().int().optional().describe('The run. Tuned by `npm run quick -- <scene> --tune`.'),
  story: z.enum(Object.keys(TEMPLATES) as [Template, ...Template[]]).optional().describe('Director story used to tune and check it. Default: the scene’s own.'),
  target: z.number().positive().optional().describe('Seconds where the climax should land. Default: the story’s (with a clock, just before zero).'),
  set: z.record(z.unknown()).optional().describe('Dotted paths to set, e.g. { "entities.1.speed": 900 }. Applied after patch.'),
  modifiers: ModifierListSchema.optional().describe('Appended to the scene’s modifiers.'),
};

/** Runtime schema: patch is checked when the scene resolves (strictly), not here. */
export const QuickSchema = z
  .object({ ...quickFields, patch: z.record(z.unknown()).optional().describe('Scene fields, deep-merged like "extends".') })
  .strict();

export const QuickFileSchema = z
  .object({
    $schema: z.string().optional(),
    quick: z.array(QuickSchema).max(12),
  })
  .strict();

/** For quick.schema.json (editor autocomplete): patch is a partial scene. */
export const QuickFileAuthoringSchema = z
  .object({
    $schema: z.string().optional(),
    quick: z.array(z.object({ ...quickFields, patch: SourceSchema.omit({ $schema: true, extends: true, modifiers: true }).optional().describe('Scene fields, deep-merged like "extends".') }).strict()).max(12),
  })
  .strict();

export type Quick = z.infer<typeof QuickSchema>;

/** "Neon rush" -> "neon-rush" (used in file names and the CLI's --only). */
export function quickId(q: Pick<Quick, 'name'>): string {
  return q.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'quick';
}

/** Parse a quick/<scene>.json file. Throws with every bad field by path. */
export function parseQuickFile(raw: unknown, label = 'quick file'): Quick[] {
  const r = QuickFileSchema.safeParse(raw);
  if (!r.success) throw new Error(`${label}:\n${r.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`);
  const ids = new Set<string>();
  for (const q of r.data.quick) {
    const id = quickId(q);
    if (ids.has(id)) throw new Error(`${label}: two quick settings are called "${q.name}"`);
    ids.add(id);
  }
  return r.data.quick;
}

/** Apply a quick setting to a merged scene source, in place. */
export function applyQuick(merged: Raw, q: Quick): void {
  if (q.patch) {
    const next = deepMerge(merged, q.patch) as Raw;
    for (const k of Object.keys(merged)) delete merged[k];
    Object.assign(merged, next);
  }
  for (const [path, v] of Object.entries(q.set ?? {})) setPath(merged, path, structuredClone(v));
  if (q.seed !== undefined) merged.seed = q.seed;
  if (q.modifiers?.length) merged.modifiers = [...((merged.modifiers as unknown[]) ?? []), ...structuredClone(q.modifiers)];
}

/** Resolve a scene with a quick setting (and then any further changes) applied. */
export function resolveQuick(name: string, sources: Record<string, unknown>, q: Quick | null, more?: (merged: Raw) => void): Scene {
  return resolveScene(name, sources, (merged) => {
    if (q) applyQuick(merged, q);
    more?.(merged);
  });
}

/**
 * The story a quick setting is tuned and checked with: its own, else rhythm-locked
 * scenes stay in time, clock scenes beat the clock, everything else gets the scene's default.
 */
export function quickStory(scene: Scene, q: Pick<Quick, 'story' | 'target'> | null): DirectorOptions {
  const fallback = (): Template => {
    const t = defaultTemplate(scene);
    if (t !== 'music-sync') return t;
    // A MIDI song without rhythm lock: judge the run, not the timing of its notes.
    return defaultTemplate({ ...scene, audio: { ...scene.audio, noteTimes: undefined } });
  };
  const template: Template = q?.story ?? (scene.duration.trimStart > 0 ? 'perfect-loop' : scene.audio.rhythmLock ? 'music-sync' : fallback());
  const target = q?.target ?? (template === 'perfect-loop' ? Math.round(scene.duration.max - scene.duration.trimStart) : defaultTarget(scene));
  return { template, target };
}

/**
 * What's wrong with a quick setting's run, if anything (the CLI and the Tune tab agree).
 * `baseline` is the original scene's score under the same story: a quick setting is only
 * weak when it scores low in absolute terms and clearly below the scene it varies.
 */
export function problems(r: RunScore, baseline = 100): string[] {
  const out: string[] = [];
  if (r.endReason === 'timeUp') out.push('clock ran out');
  if (r.endReason === 'caught') out.push('caught');
  if (r.score < Math.min(55, baseline - 12)) out.push(`weak (${r.score.toFixed(0)})`);
  if (r.length > 65) out.push(`long (${r.length.toFixed(0)} s)`);
  if (r.length < 8) out.push(`short (${r.length.toFixed(1)} s)`);
  return out;
}

// ---- Suggestions: a starter set for a scene that has none -------------------------------------

// Songs that stay in time under rhythm lock in most scenes (ragtime and long notes don't).
const SONGS = ['fur-elise', 'can-can', 'ode-to-joy', 'greensleeves', 'william-tell', 'turkish-march', 'yankee-doodle', 'oh-susanna', 'mary-had-a-little-lamb', 'hall-of-the-mountain-king', 'minuet-in-g', 'happy-birthday'];
const SONG_TITLES: Record<string, string> = {
  'fur-elise': 'Für Elise',
  'can-can': 'Can-can',
  'ode-to-joy': 'Ode to Joy',
  greensleeves: 'Greensleeves',
  'william-tell': 'William Tell',
  'turkish-march': 'Turkish March',
  'yankee-doodle': 'Yankee Doodle',
  'oh-susanna': 'Oh! Susanna',
  'mary-had-a-little-lamb': 'Little Lamb',
  'hall-of-the-mountain-king': 'Mountain King',
  'minuet-in-g': 'Minuet in G',
  'happy-birthday': 'Happy Birthday',
};
const LOOKS: { palette: string; name: string; emoji: string; note: string; light?: boolean }[] = [
  { palette: 'neon', name: 'Neon', emoji: '🌃', note: 'Neon colors with bloom.' },
  { palette: 'sunset', name: 'Sunset', emoji: '🌅', note: 'Warm sunset colors.' },
  { palette: 'ocean', name: 'Deep blue', emoji: '🌊', note: 'Ocean blues.' },
  { palette: 'gold', name: 'Gold', emoji: '🥇', note: 'Gold on black, with a serif title.' },
  { palette: 'pastel', name: 'Pastel', emoji: '🎀', note: 'Soft pastels and glossy balls.', light: true },
  { palette: 'vaporwave', name: 'Vaporwave', emoji: '🌴', note: 'Pink and cyan on a retro grid.' },
  { palette: 'ice', name: 'Ice', emoji: '🧊', note: 'Frosted glass colors.' },
  { palette: 'toxic', name: 'Toxic', emoji: '☣️', note: 'Radioactive greens.' },
];

/** A small stable hash of a string (picks differ per scene but never change between runs). */
function pick(name: string, salt: number, n: number): number {
  let h = salt * 2654435761;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 2246822507) >>> 0;
  return (h >>> 0) % n;
}

/**
 * About five quick settings that suit a scene, from what it is: a buzzer beater for clock races,
 * a race of named balls for single-ball escapes, song swaps for rhythm lock, a new palette, and a
 * vibe that fits (horror scenes get tape and heartbeat; the rest lo-fi, arcade, ASMR or a hype edit).
 * Seeds are left out: tune them afterwards.
 */
export function suggestQuick(name: string, scene: Scene): Quick[] {
  const out: Quick[] = [];
  const balls = scene.entities.filter((e) => e.type === 'ball');
  const ballCount = balls.reduce((n, b) => n + (b.type === 'ball' ? b.count : 0), 0);
  const singleBall = balls.length === 1 && ballCount === 1 && balls[0].type === 'ball' && !balls[0].team;
  const escapes = scene.duration.endOn === 'firstEscape' || scene.duration.endOn === 'allEscaped' || scene.duration.endOn === 'firstOut';
  const horror = scene.entities.some((e) => e.type === 'stalker') || scene.style.darkness > 0;
  const clock = racesClock(scene) && scene.clock ? scene.clock.seconds : 0;
  const locked = scene.audio.rhythmLock;

  if (locked) {
    const current = scene.audio.melody.replace(/^midi:/, '');
    const songs = SONGS.filter((s) => s !== current);
    for (let k = 0; k < 3; k++) {
      const song = songs[(pick(name, 1, songs.length) + k * 5) % songs.length];
      out.push({ name: SONG_TITLES[song], emoji: ['🎹', '🎼', '🎻'][k], kind: 'sound', note: `Every bounce on the beat of ${SONG_TITLES[song]}.`, patch: { audio: { melody: `midi:${song}` } } });
    }
  } else if (clock) {
    out.push({ name: 'Buzzer beater', emoji: '⏱️', kind: 'pace', note: 'Same scene, a run that ends with a split second left.', story: 'last-second', target: Math.round((clock - 0.25) * 100) / 100 });
  }
  if (singleBall && escapes && !locked) {
    const set = pick(name, 2, 3);
    const n = set === 0 ? 2 : 3;
    const names = [
      ['Red vs blue', '🆚', 'Red or blue?'],
      ['Animal race', '🐾', 'Which animal gets out?'],
      ['Fruit race', '🍉', 'Which fruit escapes?'],
    ][set];
    out.push({ name: horror ? 'Two of you' : names[0], emoji: names[1], kind: 'twist', note: `${n} named balls race out. First one out wins.`, modifiers: [{ use: 'versus', count: n, set }], patch: { overlay: { title: horror ? 'It only needs one of you.' : names[2] } } });
  } else if (scene.duration.endOn === 'lastStanding' && scene.entities.some((e) => e.type === 'ring') && !horror) {
    out.push({ name: 'Storm', emoji: '🌪️', kind: 'twist', note: 'The arena closes in, battle-royale style.', modifiers: [{ use: 'storm', rate: 7, min: 170 }] });
  }
  // Looks: never a pale palette under darkness; two different ones when there is room.
  const looks = LOOKS.filter((l) => !(horror && l.light));
  const first = pick(name, 3, looks.length);
  const lookAt = (k: number): Quick => {
    const l = looks[(first + k * 3) % looks.length];
    return { name: l.name, emoji: l.emoji, kind: 'look', note: l.note, modifiers: [{ use: 'palette', name: l.palette }] };
  };
  out.push(lookAt(0));
  const vibes: Quick[] = horror
    ? [
        { name: 'VHS tape', emoji: '📼', kind: 'vibe', note: 'Found on a tape: scanlines, hum, a PLAY stamp and glitches.', modifiers: ['vhs', { use: 'unease', amount: 0.3 }] },
        { name: 'Heartbeat', emoji: '💓', kind: 'vibe', note: 'A heartbeat that races as the end gets close.', modifiers: ['heartbeat'] },
      ]
    : [
        { name: 'Lo-fi', emoji: '☕', kind: 'vibe', note: 'Soft piano, dusky colors and film grain.', modifiers: ['lofi'] },
        { name: 'Arcade', emoji: '🕹️', kind: 'vibe', note: 'Chiptune bleeps, green-screen colors and scanlines.', modifiers: ['arcade'] },
        { name: 'ASMR', emoji: '🎧', kind: 'vibe', note: 'Soft wooden taps, no music bed, silky trails.', modifiers: [{ use: 'asmr', instrument: 'kalimba' }] },
      ];
  const v0 = pick(name, 4, vibes.length);
  out.push(vibes[v0]);
  if (!horror && !locked && (clock || escapes || scene.duration.endOn === 'lastStanding' || scene.duration.endOn === 'finish')) {
    out.push({ name: 'Hype edit', emoji: '🎉', kind: 'vibe', note: '3-2-1 intro, slow motion into the finish, a bass drop and confetti.', modifiers: ['hype'] });
  }
  // Fill to five: the other vibes, a second look, then rainbow.
  for (let k = 1; out.length < 5 && k < vibes.length; k++) out.push(vibes[(v0 + k) % vibes.length]);
  if (out.length < 5) out.push(lookAt(1));
  if (out.length < 5 && !horror) out.push({ name: 'Rainbow', emoji: '🌈', kind: 'vibe', note: 'Everything drifts through the rainbow.', modifiers: ['rainbow'] });
  const seen = new Set<string>();
  return out.filter((q) => !seen.has(q.name) && seen.add(q.name)).slice(0, 5);
}
