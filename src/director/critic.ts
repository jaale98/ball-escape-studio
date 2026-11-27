/**
 * The Critic: plain-language notes on a scene's current run, from the same
 * measurements the Director uses. Instant and deterministic (no AI); the
 * studio offers to send its notes to Claude to fix.
 */
import type { Scene } from '../engine/scene';
import { racesClock, type RunScore } from './score';

export interface Note {
  level: 'good' | 'warn';
  text: string;
}

export function critique(scene: Scene, r: RunScore): Note[] {
  const notes: Note[] = [];
  const warn = (text: string) => notes.push({ level: 'warn', text });
  const s = r.stats;
  const endsOnClimax = scene.duration.endOn !== 'never';
  const loopScene = scene.duration.trimStart > 0;

  if (s.scriptError) warn(`A rule script failed and was switched off: ${s.scriptError}`);
  const clock = scene.clock;
  if (clock && racesClock(scene)) {
    if (r.endReason === 'timeUp') warn(`The clock ran out before the ending (${scene.duration.endOn}). That can work as a fail video, but a finish just before zero lands harder: try the Director’s “Beat the clock” story, or add a clock “rush”.`);
    else if (r.climax >= 0 && clock.seconds - r.climax > Math.max(3, clock.final)) warn(`It finishes with ${(clock.seconds - r.climax).toFixed(1)}s still on the clock, so the countdown never gets tense. Shorten the clock or use the Director’s “Beat the clock” story.`);
  }
  if (r.endReason === 'caught') warn(`The stalker catches the last ball at ${r.length.toFixed(1)}s. That works as a fail video; for a narrow escape, slow it down (speed, accel, or a longer shadow delay) or try the Director’s “Beat the clock” story.`);
  if (endsOnClimax && r.climax < 0) {
    warn(`The ending (${scene.duration.endOn}) never happens within ${scene.duration.max}s. Make it easier (a wider gap, a smaller ball, more damage) or allow more time.`);
  } else if (r.climax >= 0 && !loopScene) {
    if (r.climax < 12) warn(`The climax comes at ${r.climax.toFixed(1)}s, early for a short; most land between 20 and 45s. Try the Director, or make the ending harder.`);
    else if (r.climax > 50) warn(`The climax comes late (${r.climax.toFixed(1)}s); many viewers will have scrolled on. Make the ending easier or use the Director.`);
  }
  if (s.deadTime > 4 && !loopScene) warn(`There's a ${s.deadTime.toFixed(1)}s stretch where nothing hits anything.`);
  // Chimes, captures and drains provide their own cadence without wall bounces.
  const bounceless = scene.entities.some((e) => e.type === 'pendulum' || e.type === 'territory' || (e.type === 'zone' && e.kill));
  if (s.bounceRate < 0.6 && !loopScene && !bounceless) warn(`It's quiet: ${s.bounceRate.toFixed(1)} bounces a second. More speed or a smaller container would add energy.`);
  // Near-misses are measured at ring gaps; polygons and gapless (breakable) rings don't have them.
  const gapRings = scene.entities.some((e) => e.type === 'ring' && e.gaps.length > 0);
  if (scene.duration.endOn === 'firstEscape' && gapRings && r.climax > 0 && s.nearMisses === 0) warn('No near-misses before the escape, so there is little suspense. A narrower gap or a different seed builds tension.');
  const hpFight = scene.entities.some((e) => e.type === 'ball' && e.hp !== undefined);
  if (scene.duration.endOn === 'lastStanding' && hpFight && s.leadChanges === 0) warn('One ball leads the whole battle. A different seed (Director: Comeback) makes it closer.');
  if (s.capped) warn(`The ball cap (${scene.world.maxBalls}) was reached, so spawning stopped.`);
  if (scene.audio.rhythmLock && r.signals.rhythm !== undefined && r.signals.rhythm < 0.9) {
    warn(`Rhythm lock keeps only ${Math.round(r.signals.rhythm * 100)}% of notes on time with this seed (some paths can't hit the beat). The Director's “In time with the song” story finds seeds that stay in time.`);
  }
  if (scene.teams.length > 1 && r.climax > 0 && s.teamLeadChanges === 0) warn('One team leads from the first second, so the takeover has no suspense. The Director’s Underdog story finds runs where the lead swaps.');
  if (scene.style.reveal && s.endSpeed > 60) warn(`The picture isn't settled when the video ends (balls still moving at ${Math.round(s.endSpeed)} px/s), so it will look smeared. Allow more time or use more friction.`);
  if (scene.camera.slowmo > 0 && r.climax < 0) warn('Slow motion is on, but this run has no climax to slow down for.');
  const pend = scene.entities.find((e) => e.type === 'pendulum');
  if (pend && pend.type === 'pendulum' && pend.count > 1 && pend.wave === 0 && s.pendulumSpread < 60) warn(`The pendulums never split apart (${Math.round(s.pendulumSpread)}px at the end). A bigger spread or a longer video shows the chaos.`);
  if (r.loop && r.loop.error > 8) warn(`The loop seam is ${r.loop.error.toFixed(0)}px off; the cut may be visible. Try the Director's Perfect loop story.`);

  if (!notes.length) {
    const bits = [r.climax >= 0 ? `climax at ${r.climax.toFixed(1)}s` : `${r.length.toFixed(0)}s run`];
    if (s.nearMisses && s.peakBalls <= 20) bits.push(`${s.nearMisses} near-misses`);
    if (s.leadChanges) bits.push(`${s.leadChanges} lead changes`);
    bits.push(s.deadTime > 3 ? `longest lull ${s.deadTime.toFixed(1)}s` : 'no lulls');
    notes.push({ level: 'good', text: `Looks good: ${bits.join(', ')}.` });
  }
  return notes;
}
