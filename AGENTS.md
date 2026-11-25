# Ball Escape Studio: notes for Codex

A browser studio for making ball-physics shorts. Scenes are JSON files in `scenes/`; the studio (`npm run dev`, http://localhost:5173) hot-reloads them.

## Making or changing a scene ("folder mode")

When the user describes a video idea:

1. **Start from the closest preset** (see the README's preset table). Prefer `"extends": "<preset>"` plus `"modifiers"` over copying. Only write a scene from scratch when nothing is close.
2. Write `scenes/<kebab-name>.json` with `"$schema": "../scene.schema.json"`. Field reference: `src/engine/scene.ts` (primitives), `src/engine/source.ts` (extends, prefabs), `src/engine/modifiers.ts` (modifiers and their options).
3. Check it: `npm run sim -- <name>`. Parse errors list every bad field by path; unknown keys are errors. `npm run sim -- <name> --resolved` shows what the engine actually runs.
4. Tune the seed with the Director: `npm run sim -- <name> --director <story> --target <seconds> [--vary 0.1]`, where story is slow-burn, last-second, chaos, comeback or music-sync. It prints the best seeds with their facts and a ready-to-paste `seed` (and `world.speedScale` / `spinScale` when `--vary` is on). For a plain timing search, `--seeds 1-300 --target <s>` also works. Aim for 20–45 s unless asked otherwise.
5. To look at a frame, run in the browser page: `await studio.capture('name', 12.5)`. It saves the exact export frame at 12.5 s to `captures/name.png`; read the image to check it.
6. Run `npm test` before finishing.

When you are running from the studio's prompt box, extra instructions are appended (see `server/Codex.ts`): you may only edit `scenes/` and run `npm run sim` / `npm test`, and you should write the scene file first so the preview updates, then validate.

If `.studio/taste.md` exists, read it: it lists videos the user liked or disliked (with their notes). Lean toward what they liked.

When a format needs behaviour the built-in actions can't express, write a rule `script` (API in `src/engine/script.ts`) before touching engine code. Keep scripts short, deterministic (use `ctx.rng`, never `Math.random`), and set velocities directly: the engine re-bases energy after a script runs.

Other tools: `npm run tournament -- <battle-scene> "A,B,C,D"` writes a knockout bracket as scene files. The Director's `perfect-loop` story prints a ready-to-paste loop window. The studio's Critic panel lists problems with the current run; fix those first when asked to "improve" a scene.

Reaching for code is the last resort. If a format truly needs a new engine capability, add it as a general primitive (entity, action, rule event, or modifier), then express the format as a scene file.

## Scene conventions

- The canvas is 1080×1920. The default container center is (540, 960). Keep play areas within about x 60–1020 and y 400–1500 so the title (y around 250) and counter (y around 1700) stay clear.
- Angles in scene files are degrees (0 = right, 90 = down); `spin` is rad/s (positive = clockwise).
- A ball must fit its exit to escape: the ring gap's arc length (radius × width in radians) has to exceed the ball's diameter plus the ring thickness.
- Modifiers set what their format needs (for example `multiply` forces `endOn: never`). Later modifiers and explicit rules still apply on top.
- `extends` merges objects key by key but replaces arrays: a child that sets `entities` must list all of them.
- Overlay titles should be short hooks ("Can it escape?", "5 rings. 1 ball."). Text style lives in `overlay` (font, textColor, titleSize, titleY, counterSize, counterY, labelSize).
- Pictures live in `images/` and are referenced by file name: ball `image` / `images` (per ball, cycled), `style.backgroundImage` (+ `backgroundDim`). Emoji: ball `emoji` / `emojis` (flag emoji render on Mac; on Windows they show as letters). Never invent image file names: list `images/` first.
- Songs: `"melody": "midi:<name>"`. The songbook (`songs/songs.json` lists titles; source in `scripts/songbook.ts`, regenerate with `npm run songs`) has 27 public-domain pieces; songbook songs put the melody in part 0 and the bass in part 1, so use `"parts": [0]` for the tune alone. Users can drop their own `.mid` files into `songs/`.
- `audio.rhythmLock: true` keeps every bounce on the beat. It needs exactly one ball and a ring or polygon (gravity is fine); `rhythmLockStatus()` in `src/engine/world.ts` says whether it applies. Pick the seed with `npm run sim -- <name> --director music-sync`, since not every seed stays in time.
- Keep `keepEnergy: true` for bouncing formats; use `keepEnergy: false` with restitution below 1 and some `friction` for things that settle (Plinko).

## Engine rules (don't break these)

- `src/engine/` must stay deterministic: no `Math.random`, `Date`, `performance.now`, or iteration over unordered collections in simulation code. Use `Rng` with a named stream.
- After any engine change, run `npm test`. It resolves and replays every scene twice and compares state hashes. Hashes change when physics changes, which is expected; a FAIL is not. Re-tune affected preset seeds.
- After changing a schema in `scene.ts`, `source.ts` or `modifiers.ts`, run `npm run schema`.
- Visual effects in `src/render/` may only depend on the event log, the renderer's own `Rng`, and `dt`. The export re-renders from scratch and must match the preview.
- `npm run typecheck` must pass.

## Layout

- `src/engine/scene.ts`: primitive scene schema (zod, strict). `source.ts`: extends, prefabs, `resolveScene()`. `modifiers.ts`: named modifiers. `world.ts`: physics. `rng.ts`: seeded RNG. No DOM; runs in Node.
- `src/render/renderer.ts`: Canvas 2D drawing, trails, paint, particles, labels, hp, overlays.
- `src/audio/sound.ts`: event-to-sound mapping and Web Audio synth. `midi.ts`: MIDI reader.
- `src/export/`: `mp4.ts` (WebCodecs + mp4-muxer frame-by-frame export), `still.ts` (deterministic single frames).
- `src/director/score.ts`: Director scoring and story templates (shared by the studio and the CLI). `pool.ts` / `worker.ts`: Web Worker search. `critic.ts`, `remix.ts`, `tournament.ts`, `caption.ts`, `check.ts` / `preflight.ts` (script preflight).
- `src/engine/script.ts`: custom rule scripts (compile + the `ctx` API). `src/render/gl.ts`: WebGL crowd layer.
- `src/ui/`: `sliders.ts`, `music.ts` (song picker, rhythm lock, parts, MIDI drop), `director.ts` (variant grid), `review.ts` (swipe review), `queue.ts` (export queue, persisted), `player.ts` (mini previews), `gallery.ts` (scene browser and file operations), `timeline.ts` (scrubber and markers), `exports.ts` (past exports), `modal.ts` (dialogs).
- Studio state: everything the user changes is an "override" (unsaved change) in `main.ts` until Save writes it to the scene file. `src/main.ts`: studio UI; `window.studio` exposes `world`, `scene`, `exportMp4()`, `capture()`.
- `scripts/`: `sim.ts` (headless runner and seed search), `determinism.ts` (`npm test`), `schema.ts`, `make-midi.ts`.
- `server/studio.ts`: dev-only endpoints (captures, Save to file, the AI prompt box, version history, ratings). `server/Codex.ts`: runs `Codex -p` on the user's plan and turns its stream into studio events.
- `src/scenes.ts`: scene sources with hot updates (scene edits never reload the page). `src/ui/assistant.ts`: prompt box. `src/ui/history.ts`: history panel and Like/Dislike.
- `.studio/` (gitignored): `history/<scene>/` snapshots of every scene version, `taste.md` likes and dislikes.
- `npm run eval:ai`: runs 10 scene requests through the prompt-box path and reports how many produce valid scenes and how fast.
