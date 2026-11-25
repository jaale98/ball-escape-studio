# Ball Escape Studio preset review

Each of the 50 presets has a specific reason to stay for the ending. The race invites a pick, the paint contest settles an argument about who covered more, and the pendulum wave returns to a recognizable starting shape. Those are editorial hypotheses for this account. Actual retention and replay rates require published clips and audience data.

## What informed the edits

TikTok's *Creative Codes* recommends framing for a vertical screen, respecting the interface's safe area, getting to the hook early and using sound deliberately. Its evidence concerns advertising. For these organic clips, the practical test was whether a viewer could understand the first frame muted, then hear something tied to the physical action with sound on. [TikTok Creative Codes](https://ads.tiktok.com/business/en-US/creative-codes)

Nansen and Balanzategui's research on the oddly satisfying genre describes the sensory appeal of simulated materials and patterned motion. That informed a different choice for pours and drawings than for battles. Give a pour time to settle, a drawing a finished shape and a race a legible finish. [Research paper](https://doi.org/10.1177/13548565221105196)

## How to read the timings

Both columns below use each preset's checked-in seed and the export frame plan at 60 fps. They are nominal playback seconds, rounded to one decimal, including trim, slow motion and holds. Event times in the notes are simulation-clock times. For a new seed, run `npm run sim -- marble-race` or search with `npm run sim -- marble-race --director photo-finish --target 28`.

The review included the event log, the studio Critic and three reduced-size Canvas 2D frames per revised scene using the TikTok-safe overlay. The contact sheets revealed standings crowding the board and a camera that could lose the last ring. Those findings informed the final framing. Browser MP4 encoding and device audio playback were outside the verified results.

## Escapes and destruction

| Preset | Original read | Revised cut | Before (s) | After (s) |
| --- | --- | --- | ---: | ---: |
| [ring-escape](../scenes/ring-escape.json) | One revolving gap makes the first and twentieth bounce look alike. | Five ivory-to-mint gates give the lime ball five visible milestones. A kalimba plays Habanera as it climbs outward. | 32.5 | 31.2 |
| [nested-rings](../scenes/nested-rings.json) | Fourteen layers make a strong opening image, but the old run takes nearly a minute. | Soften the breakable sections. Viewers can follow two routes through each layer, an aligned gap or a broken segment. | 53.2 | 33.4 |
| [hundred-rings](../scenes/hundred-rings.json) | The spiral is worth keeping. The 104-second cut and extreme zoom make the final exit hard to follow. | Frame the spiral inside a circular window, hold the final camera position and pick a seed with 16 near misses. The ball clears the last ring at 32 seconds. | 103.7 | 34.5 |
| [ring-breaker](../scenes/ring-breaker.json) | The stack already conveys scale. Impacts need to feel different from ordinary escapes. | Build twelve progressively tougher shells, score impacts with glass notes from In the Hall of the Mountain King and hold the final breach in slow motion. | 32.9 | 31.3 |
| [hp-ring](../scenes/hp-ring.json) | A single solid wall makes damage hard to infer from the silhouette. | Promise exactly 45 hits, show the remaining HP and give the shatter its own gong. | 33.1 | 31.4 |
| [crusher](../scenes/crusher.json) | Fast paddle contacts can overwhelm the ear or shake the playfield out of focus. | Make each paddle copy part of a visible attack on a 150-HP shell. Space the bounce notes and reduce the camera shake so the cracks read. | 35.0 | 33.4 |
| [brick-breaker](../scenes/brick-breaker.json) | Watching five balls at once gives the eye little direction. | Ask which brick falls last, show the dwindling brick count and choose a run that actually clears the wall. | 38.8 | 37.1 |
| [shrinking-gap](../scenes/shrinking-gap.json) | A narrowing exit loses suspense if the ball stops fitting. | Show the opening in degrees as each hit removes 1.5°. Set a lower bound that still lets the ball escape. | 22.1 | 20.8 |
| [grow-on-bounce](../scenes/grow-on-bounce.json) | A generic bounce count hides the question of whether the ball will fit. | Display its diameter and map pitch to size so each increment is both visible and audible. | 31.1 | 29.9 |
| [gap-jumper](../scenes/gap-jumper.json) | A jumping exit can look like an animation discontinuity. | Tell viewers it moves on a miss. Use the moving gap itself as the target and keep the overlay clear. | 29.1 | 27.3 |
| [gravity-flip](../scenes/gravity-flip.json) | A reversed trajectory can be hard to distinguish from an ordinary deflection. | Show the active gravity direction and map pitch to height. The next arc demonstrates the flip. | 30.4 | 29.2 |
| [hexagon-escape](../scenes/hexagon-escape.json) | The missing edge is already the puzzle. | Outline the hexagon twice, give the violet ball a comet trail and use glass notes. Leave the missing edge unobstructed. | 30.5 | 29.3 |
| [orbit-escape](../scenes/orbit-escape.json) | The sun provides a natural focus, but a slingshot needs a perceptible change in speed. | Map pitch to speed so the acceleration around the sun is audible on the way out. | 29.5 | 28.0 |
| [portal-escape](../scenes/portal-escape.json) | A teleport that looks like an escape makes the wrong moment feel final. | Distinguish the decoy and exit portal pairs visually. Ask viewers to pick their route before the decisive transit. | 29.1 | 27.5 |
| [bouncing-square](../scenes/bouncing-square.json) | The square's orientation is more interesting than a bounce tally. | Use a gold silhouette, a ribbon trail and chip notes. Remove the timer and let the viewer track the corners. | 29.7 | 28.5 |

## Races, battles and scored boards

| Preset | Original read | Revised cut | Before (s) | After (s) |
| --- | --- | --- | ---: | ---: |
| [ball-race](../scenes/ball-race.json) | Four contenders need an opening where a viewer can pick one immediately. | Start the four colors on a grid. A seed with five near misses draws out the first escape, and the winner appears above the ring. | 26.5 | 21.3 |
| [marble-race](../scenes/marble-race.json) | A countdown held a motionless race on screen. A central result obscured the finish line. | Start the race immediately, slow the finish and report the measured margin once a second marble crosses. Plum wins by 0.20 seconds. | 37.2 | 31.3 |
| [battle-royale](../scenes/battle-royale.json) | Eight contestants make a good pick-a-side format if the viewer can recognize a survivor. | Give the entrants distinct color names, retain HP feedback and let the last exchange play beneath the result. | 36.2 | 35.0 |
| [country-battle](../scenes/country-battle.json) | The flags already give viewers an instant rooting interest. | Ask for a pick at the start. The chosen run changes leader four times before Kenya wins. | 36.2 | 25.7 |
| [weapon-battle](../scenes/weapon-battle.json) | Four similar blades made a viewer's choice feel cosmetic. | Give Sword, Dagger, Spear and Scythe different weapon mechanics. The seeded bout changes leader five times. | 34.2 | 24.2 |
| [weapon-legends](../scenes/weapon-legends.json) | Six fighters need a focal rivalry in the opening crowd. | Space them apart and frame Bow as the one to beat. Nine lead changes carry that question through to Sword's win. | 31.3 | 24.1 |
| [shrinking-arena](../scenes/shrinking-arena.json) | The contracting wall can disappear behind a crowded pack. | Use eight recognizable contenders and keep the survivor announcement above the arena so the final squeeze stays visible. | 34.3 | 27.4 |
| [survival](../scenes/survival.json) | Starting outside the intended arena allowed technical exits in a blade-dodging contest. | Move the opening lineup inside the ring. Keep contrasting blade and arena colors so viewers can follow who survives the sweep. | 33.9 | 29.9 |
| [black-hole](../scenes/black-hole.json) | Anonymous victims are hard to root for. | Stage seven named moons around a growing well. Six are swallowed before Titan is the last moon left. | 39.0 | 29.2 |
| [absorb](../scenes/absorb.json) | Individual contact matters more here than a winner's name. | Put the size hierarchy in the opening question and let the last remaining marble speak for itself after 25 swallows. | 34.0 | 32.6 |
| [infection](../scenes/infection.json) | The one-against-thirty premise can get lost once bodies overlap. | Lead with that imbalance, show team totals and pin a run that resolves with the Zombies taking over. | 33.2 | 31.7 |
| [rock-paper-scissors](../scenes/rock-paper-scissors.json) | Conversion can be difficult to track once the teams mingle. | Make the three choices explicit in the hook and keep team counts visible through the takeover. | 25.9 | 24.4 |
| [paint-the-ring](../scenes/paint-the-ring.json) | The old brush trails asked who won without actually measuring it. | Score the cells most recently touched by each brush. At 24 seconds the surface freezes after twelve lead changes, and the final shares resolve the question. | 30.0 | 26.0 |
| [pong-wars](../scenes/pong-wars.json) | Accelerating the leader undermined the back-and-forth between the two halves. | Remove the leader boost, put 24 seconds on the contest and lock the board. Day wins after eight lead changes. | 40.0 | 26.0 |
| [color-war](../scenes/color-war.json) | A board that keeps changing under its winner banner gives conflicting answers. | Give the four quadrants 28 seconds to trade territory. Freeze the cells and report the final shares, with the winner above the board. | 45.0 | 30.0 |

## Multiplication, crowds and construction

| Preset | Original read | Revised cut | Before (s) | After (s) |
| --- | --- | --- | ---: | ---: |
| [multiply](../scenes/multiply.json) | The original ran close to 50 seconds and continued generating contacts after the interesting growth. | Make 128 live balls the target. The first split arrives under half a second in and the threshold ends the run. | 49.8 | 27.1 |
| [split-swarm](../scenes/split-swarm.json) | All the branching happened before second nine in a 30-second clip. | Spread the generations across the run and stop at 64. The last split now happens at 21.7 seconds. | 30.0 | 22.9 |
| [clone-trail](../scenes/clone-trail.json) | Clones obscure the identity of the moving original. | Call them decoys up front and make the viewer's job tracking the escape through the accumulating marks. | 26.4 | 24.8 |
| [merge-jar](../scenes/merge-jar.json) | A fixed time limit gave the pile no single decisive merge. | Show the highest level, set level seven as the objective and end the run on the first level-seven merge. | 45.0 | 27.2 |
| [chain-reaction](../scenes/chain-reaction.json) | Counting contacts made revisiting a ball look like new progress. | Track the identities of the 49 initially frozen balls. The hand-off ends only once the spark has visited each one. | 37.3 | 41.8 |
| [crowd-pour](../scenes/crowd-pour.json) | The nominal 2,000-ball pour previously spawned extra beads and cut away with many still inside. | Meter exactly 2,000 into the vessel, then open the gate. The final bead leaves at 23.84 seconds. | 40.0 | 25.0 |
| [vortex-drain](../scenes/vortex-drain.json) | An endlessly renewed stream offers no last-marble moment. | Feed two opposing streams of 105 in turquoise and apricot. Count them down the drain and end when the last one disappears. | 30.0 | 22.3 |
| [sand-pour](../scenes/sand-pour.json) | Continuous rainbow variation makes the final layers difficult to distinguish. | Pour six separate runs of 190 grains, damp the impacts and leave time to see the 1,140-grain cross section. | 30.0 | 25.0 |
| [plinko](../scenes/plinko.json) | Rapid peg contacts compete with the reason to watch, the bins filling up. | Invite a prediction among nine bins, spread the drops, map pitch to height and space the audible impacts. | 34.0 | 28.0 |
| [picture-reveal](../scenes/picture-reveal.json) | The reveal was hard to read through bright outlines and a long end hold. | Settle 1,600 marbles into the word POP, tone down the fallback outlines and let the viewer read the word before the cut. | 27.0 | 22.5 |

## Music, patterns and loops

| Preset | Original read | Revised cut | Before (s) | After (s) |
| --- | --- | --- | ---: | ---: |
| [music-bounce](../scenes/music-bounce.json) | Rhythm lock is an advantage when the song offers a reason to listen closely. | Make Minuet in G a guessing game, retain its bass part and reveal the name at the end. The Director scored all 32 sampled notes in time. | 36.6 | 24.5 |
| [rhythm-bounce](../scenes/rhythm-bounce.json) | A second tune-guessing format would duplicate Music Bounce. | Make the can-can a six-ring performance. The chosen run has twelve near misses and all 32 sampled notes in time. | 23.2 | 28.7 |
| [meow-escape](../scenes/meow-escape.json) | A cat voice makes a familiar melody recognizable even without text. | Let the meows pose the question, then reveal Twinkle, Twinkle, Little Star on the end card. | 27.6 | 26.7 |
| [every-bounce-a-side](../scenes/every-bounce-a-side.json) | A many-sided polygon starts to look circular before the progression ends. | Count sides on screen with each bounce, from the initial triangle to the 24-side goal. | 26.6 | 25.1 |
| [string-art](../scenes/string-art.json) | An open-ended string drawing can keep scribbling after its best frame. | Stop after 42 wall contacts, leaving 41 chords and a held, readable rosette. | 40.0 | 30.3 |
| [corner-hit](../scenes/corner-hit.json) | The exact corner contact is the payoff, even if the viewer blinks. | Keep the familiar corner prediction as the hook and acknowledge the actual contact with an end card. | 32.7 | 31.4 |
| [butterfly-effect](../scenes/butterfly-effect.json) | Twelve coincident paths can look like a single unremarkable ball at first. | Explain the tiny difference in the starting trajectories and give the colored paths time to separate before they escape. | 35.9 | 34.2 |
| [chaos-pendulums](../scenes/chaos-pendulums.json) | The divergence is the event. A stopwatch competes with the point where the paths first separate. | Ask when eight become visible, disclose the 0.001° starting spread and leave the ribbon trails unobstructed. | 40.0 | 32.0 |
| [pendulum-wave](../scenes/pendulum-wave.json) | Two repetitions of the same wave dilute the moment when fifteen bobs line up. | Frame the question around the reunion and cut at one roughly 30-second cycle. | 60.0 | 30.1 |
| [eternal-loop](../scenes/eternal-loop.json) | A visible timer or changing title advertises the join. | Preserve the tuned 10.5-second window. Use a cyan glass ribbon with an empty overlay so motion carries the replay. | 10.5 | 10.5 |
