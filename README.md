# Ball Escape Studio

**Make satisfying ball-physics shorts in your browser.** Describe a scene in a small JSON file, preview it live with sound, and export a frame-perfect 1080×1920 60 fps MP4 ready for TikTok, Reels, or Shorts.

<p align="center">
  <img src="docs/ring-escape.jpg" width="250" alt="A ball bouncing inside a spinning ring with a gap, titled 'Can it escape?'">
  <img src="docs/nested-rings.jpg" width="250" alt="A ball inside five nested colored rings, each with a gap">
  <img src="docs/multiply.jpg" width="250" alt="A ring packed with over a hundred colored balls, titled 'Every escape makes 2 more'">
</p>

Every run is **deterministic**: the same scene and seed always produce exactly the same video, bounce for bounce. That makes it possible to search hundreds of seeds in seconds for the one that escapes at the most dramatic moment, then export exactly that run.

## Features

- **Deterministic physics.** Fixed 240 Hz timestep, seeded randomness, no wall-clock time. A state hash proves two runs are identical.
- **Built for the genre.** Spinning rings with any number of gaps, nested rings, bounces that never lose energy, balls that grow, gaps that shrink, escapes that spawn more balls.
- **Scenes are data.** Each video is one JSON file in [`scenes/`](scenes/). Edit it and the preview reloads instantly.
- **Music from bounces.** Every bounce plays the next note of a melody (pentatonic improvisation, *Ode to Joy*, *Für Elise*) on a built-in synth (pluck, bell, marimba), with an escape sound effect.
- **Frame-perfect MP4 export.** The video is rendered frame by frame with WebCodecs (H.264 + AAC) and muxed in the browser. A 30 s single-ball video exports in about 10 s (a 40 s scene with 160 balls takes about 45 s), with no dropped frames, even in a background tab.
- **Headless CLI.** `npm run sim` runs scenes in about a millisecond each, tries seed ranges, and prints the event log, for you or for an AI agent.
- **Made for Claude Code.** [`CLAUDE.md`](CLAUDE.md) teaches Claude Code the scene format, so you can ask it for new scenes in plain English and watch them appear in the preview. No API key needed.

## Quick start

Requires Node 20+ and a recent Chrome or Edge (for MP4 export).

```bash
git clone https://github.com/jaale98/ball-escape-studio.git
cd ball-escape-studio
npm install
npm run dev
```

Open http://localhost:5173, pick a scene, press **Sound off** to turn sound on, and click **Export MP4**.

**Keyboard:** `Space` play/pause · `R` reroll seed · `M` sound · `Backspace` restart

## Scenes

A scene is a JSON file in `scenes/`. Anything you leave out gets a sensible default.

```json
{
  "title": "Ring escape",
  "seed": 25,
  "duration": { "max": 60, "endOn": "firstEscape", "tail": 2.5 },
  "world": { "gravity": 900, "keepEnergy": true },
  "entities": [
    { "type": "ring", "radius": 420, "thickness": 14, "spin": 0.9, "gaps": [{ "at": 0, "width": 26 }] },
    { "type": "ball", "radius": 24, "speed": 900 }
  ],
  "rules": [{ "on": "bounce", "do": [{ "do": "shrinkGap", "amount": 1 }] }],
  "style": { "trail": 0.85, "ringColor": "#ffffff" },
  "audio": { "melody": "pentatonic", "instrument": "pluck" },
  "overlay": { "title": "Can it escape?", "counter": "bounces" }
}
```

| Section | What it controls |
| --- | --- |
| `duration` | Hard length cap, what ends the run (`firstEscape`, `allEscaped`, `never`), and seconds of tail after the ending |
| `world` | Gravity (px/s²), energy keeping, restitution, ball cap |
| `entities` | `ring`s (radius, thickness, spin in rad/s, gaps in degrees) and `ball`s (radius, speed, direction, count, color) |
| `rules` | On `bounce` or `escape`, do `grow`, `shrinkGap`, `speedUp`, or `spawn` |
| `style` | Background, ball palette, ring color, trail length, glow |
| `audio` | Melody, instrument, volume, escape sound |
| `overlay` | Title, subtitle, counter (`bounces`, `balls`, `escaped`), timer |

The full schema with every default lives in [`src/engine/scene.ts`](src/engine/scene.ts). The starter scenes:

| Scene | Format |
| --- | --- |
| [`ring-escape`](scenes/ring-escape.json) | One ball, one spinning ring, one gap |
| [`grow-on-bounce`](scenes/grow-on-bounce.json) | The ball grows every bounce: escape before it fills the ring? |
| [`shrinking-gap`](scenes/shrinking-gap.json) | The exit narrows with every bounce, no gravity |
| [`multiply`](scenes/multiply.json) | Every escape spawns two new balls inside |
| [`nested-rings`](scenes/nested-rings.json) | Five counter-rotating rings to escape in turn |

## Finding the perfect seed

The engine runs a 30-second scene headless in about 1–2 ms, so you can search seeds before you watch anything:

```bash
npm run sim -- scenes/ring-escape.json --seeds 1-500 --target 30
```

This lists the seeds whose first escape lands closest to 0:30. Put the one you like in the scene's `seed` field (or type it into the studio).

```bash
npm run sim -- scenes/ring-escape.json            # summary of one run
npm run sim -- scenes/ring-escape.json --events   # every bounce and escape, timestamped
npm test                                          # every scene replays identically
```

## Using it with Claude Code

Scenes are plain files, so [Claude Code](https://claude.com/claude-code) can write them for you on your regular Claude plan, with no API key. Open this folder in Claude Code, keep `npm run dev` running, and ask:

> Make a scene where three balls race out of a ring that spins faster every time one bounces, and the gap shrinks a little each bounce.

Claude Code writes `scenes/<name>.json`, checks it with `npm run sim`, tunes the seed for a good ending, and the studio reloads it. [`CLAUDE.md`](CLAUDE.md) holds the conventions it follows.

## How it works

```
scenes/*.json ──► parseScene (zod) ──► World (240 Hz physics) ──► event log
                                                                   │
                         ┌──────────────────┬──────────────────────┼─────────────────┐
                         ▼                  ▼                      ▼                 ▼
                     Renderer          SoundMapper            Stats / UI        sim CLI
                   (Canvas 2D)    (melody + synth voices)
                         │                  │
                         └──── MP4 export: re-simulate, draw every frame,
                               WebCodecs H.264 + offline-rendered AAC, mp4-muxer
```

- **`src/engine/`** holds the simulation: scene schema, seeded RNG, physics world. It has no DOM dependencies and runs in Node.
- **`src/render/`** draws a world onto a 1080×1920 canvas. Effects are driven only by the event log and a seeded RNG, so the export matches the preview.
- **`src/audio/`** maps events to notes and synthesizes them with Web Audio. The same code drives live playback and the offline mixdown.
- **`src/export/`** handles the frame-by-frame MP4 encoder and deterministic still frames.

Export runs the scene twice: a headless pass that learns the length and every event (for the soundtrack), then a rendering pass. Both must end on the same state hash, which the studio reports after each export.

## Roadmap

This is phase 1 of a larger plan:

1. **Core engine and export** (this release)
2. **Scene language:** prefabs, stackable modifiers, scene inheritance, auto-generated sliders, MIDI import, more formats (races, battles, Plinko, polygons)
3. **AI through Claude Code:** an in-studio prompt box backed by the Claude Code CLI on your own plan
4. **The Director:** automatic seed search scored for suspense, a variant grid, swipe-to-keep review
5. **Full studio:** WebGL crowds, custom rule scripts, batch production and series tools

## License

[MIT](LICENSE)
