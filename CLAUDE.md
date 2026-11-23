# Ball Escape Studio: notes for Claude Code

A browser studio for making ball-physics shorts. Scenes are JSON files in `scenes/`; the studio (`npm run dev`, http://localhost:5173) hot-reloads them.

## Making or changing a scene ("folder mode")

When the user describes a video idea:

1. Write `scenes/<kebab-name>.json`. Schema and defaults: `src/engine/scene.ts`. Copy the closest starter scene rather than starting blank.
2. Check that it parses and ends well: `npm run sim -- scenes/<name>.json`. A parse error lists every bad field by path.
3. Tune the seed: `npm run sim -- scenes/<name>.json --seeds 1-300 --target <seconds>` lists seeds whose first escape lands nearest the target. Aim for a climax around 20–45 s unless asked otherwise, then set `seed` in the file.
4. If the dev server is running, the user sees it immediately. To look at a frame yourself, run this in the browser page: `await studio.capture('name', 12.5)`. It saves the exact export frame at 12.5 s to `captures/name.png`.

Scene conventions:
- The canvas is 1080×1920. The default ring center is (540, 960). Keep rings within about x 60–1020 and y 400–1500 so the title (y around 250) and counter (y around 1700) stay clear.
- Angles in scene files are degrees (0 = right, 90 = down); `spin` is rad/s (positive = clockwise).
- A ball must be smaller than its gap to escape: the gap's arc length (radius × width in radians) has to exceed the ball's diameter plus the ring thickness.
- `grow` stops at 92% of the innermost ring holding the ball and then ends the run (`filled`).
- Overlay titles should be short hooks ("Can it escape?", "5 rings. 1 ball.").

## Engine rules (don't break these)

- `src/engine/` must stay deterministic: no `Math.random`, `Date`, `performance.now`, or iteration over unordered collections in simulation code. Use `Rng` with a named stream.
- After any engine change, run `npm test`. It replays every scene twice and compares state hashes. Hashes in the output change when physics changes, which is expected; a FAIL is not.
- Visual effects in `src/render/` may only depend on the event log, the renderer's own `Rng`, and `dt`. The export re-renders from scratch and must match the preview.
- `npm run typecheck` must pass.

## Layout

- `src/engine/`: scene schema (zod), seeded RNG, physics `World`. No DOM; runs in Node.
- `src/render/renderer.ts`: Canvas 2D drawing, trails, particles, overlay text.
- `src/audio/sound.ts`: event-to-note mapping and Web Audio synth voices.
- `src/export/`: `mp4.ts` (WebCodecs + mp4-muxer frame-by-frame export), `still.ts` (deterministic single frames).
- `src/main.ts`: studio UI. `window.studio` exposes `world`, `scene`, `exportMp4()`, `capture()`.
- `scripts/sim.ts`: headless runner and seed search. `scripts/determinism.ts`: `npm test`.
