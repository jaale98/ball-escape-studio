# Ball Escape Studio

**Make satisfying ball-physics shorts in your browser.** Describe a scene in a small JSON file, preview it live with sound, tweak it with sliders, and export a frame-perfect 1080×1920 60 fps MP4 ready for TikTok, Reels, or Shorts.

<p align="center">
  <img src="docs/ring-escape.jpg" width="190" alt="A ball bouncing inside a spinning ring with a gap, titled 'Can it escape?'">
  <img src="docs/nested-rings.jpg" width="190" alt="A ball inside five nested colored rings, each with a gap">
  <img src="docs/country-battle.jpg" width="190" alt="A battle royale in a ring ending with the banner 'Canada wins!'">
  <img src="docs/plinko.jpg" width="190" alt="A Plinko board with balls piled in nine bins, each with a count">
</p>
<p align="center">
  <img src="docs/multiply.jpg" width="190" alt="A ring packed with over a hundred colored balls, titled 'Every escape makes 2 more'">
  <img src="docs/hexagon-escape.jpg" width="190" alt="A ball inside a spinning hexagon with a narrow exit">
  <img src="docs/paint-the-ring.jpg" width="190" alt="Three balls covering the inside of a ring with red, blue and yellow paint">
  <img src="docs/ball-race.jpg" width="190" alt="Four labeled balls racing to leave a ring, ending with 'Red wins!'">
</p>

Every run is **deterministic**: the same scene and seed always produce exactly the same video, bounce for bounce. That makes it possible to search hundreds of seeds in seconds for the one with the most dramatic ending, then export exactly that run.

## Features

- **19 formats out of the box**, covering every format in the original catalog: ring escape, nested rings, multiply, grow on bounce, shrinking gap, ball race, battle royale, country battle, weapon battle, Plinko, hexagon escape, bouncing square, paint the ring, gravity flip, chain reaction, eternal loop, music bounce, rhythm bounce, and a 2,000-ball crowd. Each one is just a scene file.
- **The Director.** Simulates hundreds of runs in a fraction of a second, scores each for the story you want (slow burn, last-second escape, chaos, comeback, in time with the song), and shows the best nine playing side by side. Use one, swipe through them, or export the best.
- **Swipe review and an export queue.** Keep (→) or discard (←) candidates one by one; kept videos render in the background and land in `exports/` with a caption, the exact scene, and a line in `exports/log.csv`.
- **Batch production.** One click makes 4–12 remixes of a scene (new palette, instrument, melody and feel), each auto-directed. **Tournaments** turn any battle into a knockout bracket: every match becomes a scene with a close fight and a winner that advances.
- **The Critic.** Plain-language notes on the current run ("the climax comes at 6s, early for a short", "a 5s stretch where nothing happens", "one ball leads the whole battle"), with a **Fix with Claude** button.
- **Custom rule scripts.** When built-in actions aren't enough, a rule can run a few lines of JavaScript, deterministic and checked in a Worker before it runs.
- **Crowds.** Thousands of balls with WebGL rendering and spatial-hash collisions.
- **A small scene language.** Scenes can `extend` other scenes, stack named `modifiers` (`"multiply"`, `"battle"`, `"gravity-flip"`…), and use prefabs (`nested` rings, a `pegboard`, `bins`). Most new formats need no code at all.
- **Deterministic physics.** Fixed 240 Hz timestep, seeded randomness, no wall-clock time. A state hash proves two runs are identical.
- **Built for the genre.** Spinning rings and polygons with exits, walls, pegs, counting zones, hit points, winners, timed events, and bounces that never lose energy.
- **Live sliders.** Every number in a scene becomes a slider. Changes preview instantly, and **Save to file** writes them back to the JSON.
- **Music from bounces.** Every bounce plays the next note of a song. The built-in **songbook** has 27 public-domain pieces (Bach, Beethoven, Mozart, Grieg, Joplin, folk songs and nursery tunes, as simple melody-and-bass arrangements), plus an improvised pentatonic mode; drag any `.mid` onto the studio to add your own.
- **Rhythm lock.** Every bounce lands exactly on the beat of the song, in any single-ball scene: rings or polygons, with or without gravity. After each bounce the engine flies the ball's next path ahead and sets its speed so it reaches the wall on the next note. **Find a seed that stays in time** in the Music tab picks the cleanest run in one click.
- **Frame-perfect MP4 export.** Frames are rendered one by one, encoded with WebCodecs (H.264 + AAC), and muxed in the browser. A 30 s single-ball video exports in about 10 s, with no dropped frames, even in a background tab.
- **Headless CLI.** `npm run sim` runs a scene in milliseconds, searches seed ranges for the best ending, and prints the event log, for you or for an AI agent.
- **Editor autocomplete.** [`scene.schema.json`](scene.schema.json) gives VS Code completion and inline docs for every field.
- **Ask Claude.** A prompt box runs Claude Code on your regular Claude plan (no API key) to edit or create scenes while you watch, with full version history, undo, and Like/Dislike notes that teach it your taste.

## Quick start

Requires Node 20+ and a recent Chrome or Edge (for MP4 export).

```bash
git clone https://github.com/jaale98/ball-escape-studio.git
cd ball-escape-studio
npm install
npm run dev
```

Open http://localhost:5173. A short welcome card walks through it: pick a format, turn sound on, change it (ask Claude, or use the **Tune** and **Music** tabs), let the Director find the best run, and export.

### The studio at a glance

- **Scene switcher + Browse.** Pick a scene from the list, or **Browse** for a gallery with thumbnails, where you can open, build on (**New from this**), duplicate, rename or delete scenes. Remixes and tournament matches are grouped under the scene they came from. Deleted scenes go to `.studio/trash`.
- **One save model.** Every change (sliders, seed, song, rhythm lock, a Director pick) is an *unsaved change* shown in a bar at the top. **Save** (⌘S) writes it into the scene file; **Discard** drops it. Switching scenes asks first.
- **Tabs.** *Create* (ask Claude, the Critic, Director, export queue, Like/Dislike), *Tune* (seed and every number in the scene), *Music* (song, rhythm lock, parts), *History* (every version of the scene, and every export with Show in Finder / Export again / Open as scene), *Info* (live stats and the raw scene).
- **Timeline.** Under the preview: progress with markers for near-misses, escapes, eliminations and the climax. Click or drag to jump (runs are deterministic, so it jumps to the exact frame); **Climax** (J) jumps to just before it.
- **Export queue.** Exports render in the background, survive a page reload, and land in `exports/` with a caption and the exact scene.

**Keyboard** (press `?` in the studio for the list): `Space` play/pause · `J` jump to climax · `M` sound · `R` new seed · `B` browse · `D` Director · `E` export · `⌘S` save · `Backspace` restart

## Scenes

A scene is a JSON file in `scenes/`. Anything you leave out gets a sensible default, and unknown keys are errors, so typos never fail silently.

```json
{
  "$schema": "../scene.schema.json",
  "title": "Ring escape",
  "seed": 25,
  "duration": { "max": 60, "endOn": "firstEscape", "tail": 2.5 },
  "world": { "gravity": 900 },
  "entities": [
    { "type": "ring", "radius": 420, "thickness": 14, "spin": 0.9, "gaps": [{ "at": 0, "width": 26 }] },
    { "type": "ball", "radius": 24, "speed": 900 }
  ],
  "style": { "trail": 0.85 },
  "audio": { "melody": "pentatonic", "instrument": "pluck" },
  "overlay": { "title": "Can it escape?", "counter": "bounces" }
}
```

### Building on other scenes

Most formats are a base scene plus a twist. This is the whole `multiply` preset:

```json
{
  "extends": "ring-escape",
  "title": "Multiply on escape",
  "modifiers": ["multiply"],
  "duration": { "max": 40 },
  "overlay": { "title": "Every escape makes 2 more" }
}
```

`extends` merges objects key by key and replaces arrays. Modifiers stack and take options: `"modifiers": ["zero-g", { "use": "shrinking-gap", "amount": 2 }]`.

| Modifier | What it does |
| --- | --- |
| `grow-on-bounce` | The ball grows each bounce (`amount`); ends when it fills the ring |
| `shrinking-gap` | The exit narrows each bounce (`amount`, `min`) |
| `speed-up` / `spin-up` | Each bounce speeds up the ball / the container (`factor`, `max`) |
| `multiply` | Each escape spawns more balls inside (`count`); runs to the time limit |
| `battle` | Balls get hit points (`hp`) and lose `damage` per collision; the last one standing wins |
| `race` | The first ball out wins (shown with a winner banner) |
| `gravity-flip` / `gravity-spin` | Gravity reverses / rotates on a timer (`every`, `degrees`) |
| `zero-g` | No gravity |
| `paint` | Balls leave permanent paint instead of fading trails |

### Building blocks

| Section | What it controls |
| --- | --- |
| `entities` | `ring` (radius, spin, gaps), `polygon` (sides, open sides, exit `gap`), `wall`, `peg`, `zone` (counts balls entering), `ball` (radius, speed, count, colors, labels, hp, `weapon`, `shape`, `frozen`, `arrange`), and prefabs: `nested`, `pegboard`, `bins` |
| `rules` | On `bounce`, `escape`, `hit`, `eliminate`, `strike` or `wake`: `grow`, `shrinkGap`, `speedUp`, `spawn`, `damage`, `spinUp`, `reverseSpin`, gravity changes, or a `script` |
| `timeline` | Do the same actions `at` a time or `every` N seconds (spawners, gravity flips…) |
| `duration` | Length cap and what ends the run: `firstEscape`, `allEscaped`, `lastStanding`, `never`; `trimStart` for loops |
| `world` | Gravity (number or `[x, y]`), energy keeping, restitution, friction, ball cap |
| `style` | Background, palette, ring color, trail length, glow, paint, hp rings |
| `audio` | Melody (`pentatonic`, `ode-to-joy`, `fur-elise`, `midi:<file>`) or inline `notes`, chords, transpose, instrument, sound effects |
| `overlay` | Title, subtitle, counter, timer, winner banner, zone counts |

The full schema with every default lives in [`src/engine/scene.ts`](src/engine/scene.ts) and [`scene.schema.json`](scene.schema.json).

### The presets

| Scene | Format | Built from |
| --- | --- | --- |
| [`ring-escape`](scenes/ring-escape.json) | One ball, one spinning ring, one gap | base scene |
| [`grow-on-bounce`](scenes/grow-on-bounce.json) | Escape before you fill the ring | ring-escape + `grow-on-bounce` |
| [`shrinking-gap`](scenes/shrinking-gap.json) | The exit narrows with every bounce | ring-escape + `zero-g` + `shrinking-gap` |
| [`multiply`](scenes/multiply.json) | Every escape spawns two more | ring-escape + `multiply` |
| [`gravity-flip`](scenes/gravity-flip.json) | Gravity reverses every 4 s | ring-escape + `gravity-flip` |
| [`music-bounce`](scenes/music-bounce.json) | A ring escape where every bounce is a note of the song, in time | ring-escape + `midi:minuet-in-g` + `rhythmLock` (with gravity) |
| [`rhythm-bounce`](scenes/rhythm-bounce.json) | Every bounce lands in time with the song | music-bounce + `zero-g` + `rhythmLock` |
| [`ball-race`](scenes/ball-race.json) | Four named balls, first one out wins | ring-escape + `race` |
| [`nested-rings`](scenes/nested-rings.json) | Five counter-rotating rings | `nested` prefab |
| [`battle-royale`](scenes/battle-royale.json) | Hit points, last ball standing | closed ring + `battle` |
| [`country-battle`](scenes/country-battle.json) | Same battle with country names and colors | battle-royale + labels |
| [`hexagon-escape`](scenes/hexagon-escape.json) | A spinning hexagon with a narrow exit | `polygon` |
| [`plinko`](scenes/plinko.json) | Balls rain through pegs into counted bins | `pegboard` + `bins` + timeline spawner |
| [`paint-the-ring`](scenes/paint-the-ring.json) | Which color covers more? | closed ring + `paint` + `zero-g` |
| [`weapon-battle`](scenes/weapon-battle.json) | Four balls with spinning blades; strikes cost hp, clashing blades bounce | ball `weapon` |
| [`bouncing-square`](scenes/bouncing-square.json) | A spinning square tries to escape | ring-escape + ball `shape` |
| [`chain-reaction`](scenes/chain-reaction.json) | One moving ball passes its motion along a grid of frozen balls | `frozen` balls + `arrange: grid` + a `wake` rule script |
| [`eternal-loop`](scenes/eternal-loop.json) | A seamless loop found by the Director | `trimStart` loop window |
| [`crowd-pour`](scenes/crowd-pour.json) | 2,000 balls drain through a gap two balls wide | timeline spawner, WebGL crowd |

## The Director

Click **Director** in the studio. Pick a story, set when the climax should land, and click **Find the best runs**. The Director simulates every candidate in Web Workers (300 runs of a 30 s scene take well under a second), optionally nudging ball speed and container spin by up to ±10%, then refines around the best five.

| Story | What it rewards |
| --- | --- |
| Slow burn | Climax near the target, near-misses building toward it, no dead stretches |
| Last-second escape | Climax almost exactly on the target, lots of near-misses |
| Chaos | As many hits and balls as possible |
| Comeback | Races and battles where the lead changes and the winner was behind at halftime |
| In time with the song | Bounces that follow the MIDI song's note timing |
| Perfect loop | A stretch whose last frame matches its first (sets the loop window for export) |

The best nine play side by side. **Use** makes one the scene's seed (plus `world.speedScale` / `world.spinScale` tweaks; **Save to file** keeps them). **Export** queues it, and **Review one by one** opens the swipe view.

### Batch production

In the Director's **Batch** row:

- **Make remixes** builds 4–12 versions of the scene (new palette, background, instrument, melody, and a little speed and spin) and directs each one. **Save** keeps a remix as its own scene file; **Export** queues it.
- **Build tournament** (battle scenes) runs a knockout bracket for the names you list. Each match is a one-on-one battle that extends your scene, with a seed picked for a close fight near your target length. Winners advance, and **Save all as scenes** writes the bracket to `scenes/`. From the terminal:

```bash
npm run tournament -- country-battle "Brazil,Japan,France,Canada,Italy,Mexico,Kenya,Sweden" --name world-cup
```

Every queued export saves `exports/<name>.mp4`, `<name>.txt` (hook, caption, hashtags), `<name>.scene.json` (the exact scene, to remake or extend it later), and a row in `exports/log.csv`.

### Custom rule scripts

A rule (or timeline entry) can run JavaScript instead of, or as well as, built-in actions:

```json
{ "on": "wake", "script": "ctx.other.frozen = true; ctx.ball.color = ctx.other.color;" }
```

Scripts get `ctx.ball`, `ctx.other`, `ctx.container`, `ctx.world` (`balls()`, `spawn()`, `do(action)`, `gravity(x, y)`, `end()`), seeded `ctx.rng`, and a persistent `ctx.state`. `Math.random`, `Date`, timers and network access aren't available, so runs stay deterministic. The full reference is in [`src/engine/script.ts`](src/engine/script.ts). The studio runs scripted scenes headless in a Worker first, so a script that loops forever fails there instead of freezing the page.

Scripts are code: like any code, only run scene files you trust.

### Rhythm lock

Turn it on in the **Music** tab, or set `"audio": { "melody": "midi:<song>", "rhythmLock": true }`. It works for any scene with one ball bouncing in a ring or polygon, with or without gravity (it can't work with several balls: their bounces can't all land on the beat, and the tab says so). After every bounce the engine flies the ball's next path ahead and sets its launch speed so it hits the wall exactly when the next note is due. Under gravity there can be several speeds that work; it picks the one closest to the current speed, so the motion stays smooth.

Some paths can't hit a particular beat (a ball skimming along the wall, say), so not every seed stays in time. **Find a seed that stays in time** (or the Director's *In time with the song* story) tries 150 seeds and keeps the best; with it, ring escapes, gravity flips, polygons and the bouncing square typically land 85–100% of notes on time. The tempo is chosen automatically between half and double the song's own; the Tempo slider overrides it.

The songbook lives in [`scripts/songbook.ts`](scripts/songbook.ts) in a compact note notation; `npm run songs` regenerates `songs/*.mid` and `songs/songs.json`.

## Finding the perfect seed

The engine runs a 30-second scene headless in a few milliseconds, so you can search seeds before you watch anything:

```bash
npm run sim -- ring-escape --seeds 1-500 --target 30
```

This lists the seeds whose climax (first escape, last elimination, or fill) lands closest to 0:30, along with each winner. Put the one you like in the scene's `seed` field (or type it into the studio).

```bash
npm run sim -- ring-escape              # summary of one run
npm run sim -- ring-escape --events     # every bounce, escape and hit, timestamped
npm run sim -- ring-escape --resolved   # the scene after extends, modifiers and prefabs
npm run sim -- ring-escape --director slow-burn --target 30 --vary 0.1   # the Director, headless
npm test                                # every scene resolves and replays identically
npm run schema                          # regenerate scene.schema.json
```

## Ask Claude

The studio has a prompt box. Type what you want, such as *"make the gap shrink faster and use bell sounds"* or *"a new video: three balls race out of a hexagon, named after planets"*, and Claude edits or creates the scene while you watch. The preview updates the moment the file is written, without a page reload.

- **Runs on your Claude plan, not API credits.** The dev server runs the [Claude Code](https://claude.com/claude-code) CLI (`claude -p`) in this folder, with `ANTHROPIC_API_KEY` removed from its environment. You need Claude Code installed and logged in (`claude`, then `/login`).
- **Scoped.** In the prompt box Claude can only read the project, edit files in `scenes/`, and run `npm run sim` / `npm test`. Everything else is denied automatically.
- **Fast or Smart.** Fast (Haiku) for quick edits, Smart (Sonnet) for new formats. Follow-up prompts on the same scene continue the same conversation; **New chat** starts fresh.
- **History and undo.** Every version of every scene (from Claude, slider saves, or your editor) is kept in `.studio/history`. **Undo last change** or restore any version; restoring adds a new version, so nothing is ever lost.
- **It learns your taste.** **Like** / **Dislike** (with an optional note) append to `.studio/taste.md`, which Claude reads before making scenes.

You can also skip the prompt box and talk to Claude Code directly in this folder ("folder mode"). It follows the same conventions from [`CLAUDE.md`](CLAUDE.md): start from the closest preset, validate with `npm run sim`, tune the seed, and look at exact frames with `studio.capture()`.

`npm run eval:ai` runs ten typical requests through the prompt-box path and reports how many produce valid scenes and how quickly the first scene write lands. Last run (Fast model, Claude Code 2.1.87): **10/10 valid on the first try, median 7.6 s to the first preview update**, 9–30 s per request in total. A follow-up edit to an existing scene ("make the ring red") updated the preview in about 3 s.

## How it works

```
scenes/*.json ─► resolveScene: extends ─► modifiers ─► prefabs ─► zod validation
                                                                     │
                                         World (240 Hz physics) ◄────┘
                                                │
                                            event log
          ┌──────────────────┬──────────────────┼───────────────────┐
          ▼                  ▼                  ▼                   ▼
      Renderer          SoundMapper        Stats / UI          sim CLI
    (Canvas 2D)    (melody, MIDI, synth)
          │                  │
          └──── MP4 export: re-simulate, draw every frame,
                WebCodecs H.264 + offline-rendered AAC, mp4-muxer
```

- **`src/engine/`** holds the simulation: scene schema, the scene language (`source.ts`, `modifiers.ts`), seeded RNG, and the physics world. It has no DOM dependencies and runs in Node.
- **`src/render/`** draws a world onto a 1080×1920 canvas. Effects are driven only by the event log and a seeded RNG, so the export matches the preview.
- **`src/audio/`** maps events to notes, reads MIDI files, and synthesizes sound with Web Audio. The same code drives live playback and the offline mixdown.
- **`src/export/`** handles the frame-by-frame MP4 encoder and deterministic still frames.
- **`src/director/`** holds the Director: run scoring and story templates (`score.ts`, also used by the CLI), the Web Worker pool, the Critic, remixes, tournaments, captions, and the script preflight.
- **`src/ui/`** holds the sliders, prompt box, history, music panel, Director view, swipe review, and export queue.
- **`server/`** holds the dev-server endpoints, including the Claude Code runner (`claude.ts`) and scene history.

Export runs the scene twice: a headless pass that learns the length and every event (for the soundtrack), then a rendering pass. Both must end on the same state hash, which the studio reports after each export.

## Roadmap

1. **Core engine and export** (done)
2. **Scene language:** inheritance, modifiers, prefabs, sliders, MIDI, 13 formats (done)
3. **AI through Claude Code:** prompt box on your own plan, version history and undo, taste notes (done)
4. **The Director:** story-scored seed search in Web Workers, variant grid, swipe review, export queue, MIDI upload / part picker, rhythm lock (done)
5. **Full studio:** all 16 catalog formats, custom rule scripts, WebGL crowds, perfect loops, the Critic, remixes, tournaments, captions and run logs (done)

## License

[MIT](LICENSE). The bundled melodies (*Ode to Joy*, *Für Elise*, *Minuet in G*) are in the public domain.
