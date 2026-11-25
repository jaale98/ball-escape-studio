/**
 * Video timing: how simulation steps map onto video frames.
 *
 * The physics always runs at a fixed 240 Hz. Slow motion and the countdown
 * intro only change how many physics steps go into each video frame (4 at
 * 60 fps, 8 at 30 fps; 0 during the countdown, fewer during slow motion),
 * never the physics itself. The
 * preview, the MP4 export and the soundtrack all use this one plan, so they
 * stay in sync.
 */
import { FPS, PHYSICS_HZ, type Scene } from './scene';

/** Video frame rates the exporter supports. Physics stays at 240 Hz; only the steps per frame change. */
export const VIDEO_FPS = [30, 60] as const;
export type VideoFps = (typeof VIDEO_FPS)[number];

export interface Timing {
  /** Video seconds of frozen countdown before the run starts. */
  intro: number;
  /** Slow-motion window in simulation steps [start, end), or start = end = -1. */
  slowStart: number;
  slowEnd: number;
  /** Speed during slow motion (0.25 = quarter speed). */
  factor: number;
}

/** The timing for a scene whose climax happens at `climaxStep` (-1 = none / not known yet). */
export function timingFor(scene: Scene, climaxStep: number): Timing {
  const cam = scene.camera;
  const intro = cam.countdown > 0 ? cam.countdown + 0.6 : 0;
  if (cam.slowmo <= 0 || climaxStep < 0) return { intro, slowStart: -1, slowEnd: -1, factor: 1 };
  const f = cam.slowmoFactor;
  // slowmo and slowmoLead are video seconds; a video second of slow motion covers f sim seconds.
  const lead = Math.min(cam.slowmoLead, cam.slowmo);
  const slowStart = Math.max(0, climaxStep - Math.round(lead * f * PHYSICS_HZ));
  const slowEnd = climaxStep + Math.round((cam.slowmo - lead) * f * PHYSICS_HZ);
  return { intro, slowStart, slowEnd, factor: f };
}

/** Playback rate (sim seconds per video second) at a given step. */
export function rateAt(t: Timing, step: number): number {
  return t.slowStart >= 0 && step >= t.slowStart && step < t.slowEnd ? t.factor : 1;
}

/**
 * Steps to run before each video frame, for a run of `totalSteps` steps.
 * Frame 0 shows the start; frame i (i ≥ 1) first runs plan[i] steps.
 */
export function framePlan(t: Timing, totalSteps: number, fps: number = FPS): number[] {
  const stepsPerFrame = PHYSICS_HZ / fps;
  const plan: number[] = [0];
  const introFrames = Math.round(t.intro * fps);
  for (let i = 0; i < introFrames; i++) plan.push(0);
  let step = 0;
  let acc = 0;
  while (step < totalSteps) {
    acc += stepsPerFrame * rateAt(t, step);
    let n = Math.floor(acc + 1e-9);
    acc -= n;
    n = Math.min(n, totalSteps - step);
    plan.push(n);
    step += n;
    if (plan.length > 1e6) break; // safety
  }
  return plan;
}

/** For each step, the video time (seconds) of the frame where it first shows. */
export function stepTimes(plan: number[], fps: number = FPS): Float64Array {
  const total = plan.reduce((a, b) => a + b, 0);
  const out = new Float64Array(total + 1);
  let step = 0;
  for (let i = 0; i < plan.length; i++) {
    for (let k = 0; k < plan[i]; k++) out[step++] = i / fps;
  }
  out[total] = (plan.length - 1) / fps;
  return out;
}

/** True when the scene changes timing at all (countdown or slow motion). */
export function hasTiming(scene: Scene): boolean {
  return scene.camera.countdown > 0 || scene.camera.slowmo > 0;
}
