/**
 * Captions for exported videos: a hook, a line of context and hashtags, built
 * from the scene and its run. Written next to each export as <name>.txt.
 */
import type { Scene } from '../engine/scene';

const TAGS: [RegExp | ((s: Scene) => boolean), string[]][] = [
  [(s) => s.duration.endOn === 'lastStanding', ['#battleroyale', '#whowins']],
  [(s) => s.entities.some((e) => e.type === 'ball' && !!e.weapon), ['#weapons']],
  [(s) => s.entities.some((e) => e.type === 'peg'), ['#plinko', '#galtonboard']],
  [(s) => s.style.paint, ['#paint', '#oddlysatisfying']],
  [(s) => s.audio.melody.startsWith('midi:') || s.audio.rhythmLock, ['#music', '#asmr']],
  [(s) => s.duration.trimStart > 0, ['#loop', '#infiniteloop']],
  [(s) => s.entities.some((e) => e.type === 'ball' && e.frozen), ['#chainreaction']],
  [(s) => s.duration.endOn === 'firstEscape' || s.duration.endOn === 'allEscaped', ['#canitescape']],
  [(s) => s.teams.length > 1, ['#whowins', '#teams']],
  [(s) => s.entities.some((e) => e.type === 'territory'), ['#pongwars']],
  [(s) => s.teams.some((t) => /rock|paper|scissors/i.test(t.name)), ['#rockpaperscissors']],
  [(s) => s.entities.some((e) => e.type === 'brick' || (e.type === 'ring' && (e.hp !== undefined || e.segments !== undefined))), ['#destruction', '#oddlysatisfying']],
  [(s) => s.entities.some((e) => e.type === 'pendulum'), ['#chaostheory', '#pendulum']],
  [(s) => s.entities.some((e) => e.type === 'force' && e.swallow > 0), ['#blackhole']],
  [(s) => s.entities.some((e) => e.type === 'portal'), ['#portal']],
  [(s) => s.entities.some((e) => e.type === 'zone' && e.finish), ['#marblerace']],
  [(s) => !!s.style.reveal, ['#waitforit', '#oddlysatisfying']],
  [(s) => s.audio.instrument === 'meow', ['#cat', '#meow']],
  [(s) => s.entities.some((e) => e.type === 'ball' && e.copies > 1), ['#butterflyeffect', '#chaostheory']],
];

export interface Caption {
  hook: string;
  text: string;
  hashtags: string[];
}

export function caption(scene: Scene, facts: string[] = [], winner = ''): Caption {
  const hook = scene.overlay.title ?? scene.title;
  const lines: string[] = [];
  if (scene.duration.endOn === 'lastStanding' || scene.duration.endOn === 'firstEscape' || scene.duration.endOn === 'finish') {
    const names = scene.entities.flatMap((e) => (e.type === 'ball' && e.labels ? e.labels.slice(0, e.count) : []));
    if (names.length > 1) lines.push(`${names.join(' vs ')}. Pick one before it ends.`);
    else lines.push('Watch till the end.');
  } else if (scene.teams.length > 1) lines.push(`${scene.teams.map((t) => t.emoji ?? t.name).join(' vs ')}. Pick a side before it ends.`);
  else if (scene.style.reveal) lines.push('Wait for it… the picture is hiding in there from the start.');
  else if (scene.duration.endOn === 'cleared') lines.push('How long until it is all gone?');
  else if (scene.duration.trimStart > 0) lines.push('It loops forever. Try to find the cut.');
  else lines.push('Turn the sound on.');
  if (winner) lines.push(`(Spoiler for the comments: ${winner}.)`);
  const tags = new Set(['#satisfying', '#physics', '#simulation']);
  for (const [test, t] of TAGS) if (typeof test === 'function' && test(scene)) t.forEach((x) => tags.add(x));
  void facts;
  return { hook, text: lines.join(' '), hashtags: [...tags] };
}

export function captionText(c: Caption): string {
  return `${c.hook}\n\n${c.text}\n\n${c.hashtags.join(' ')}\n`;
}
