# AlgoWorld 1

**[Open the world →](https://anttiluode.github.io/AlgoWorld1/)**

A procedural world you explore by zooming. Each depth is a different place run by a different law, and the zoom closes into a loop: inside the last level is the first one again.

| Depth | Place | Law | Ancestor |
|---|---|---|---|
| 0 | Planet | Standing waves on a sphere: a sum of zonal spherical harmonics about seeded axes, each beating against the world clock. Coasts are the nodal lines. | PerceptionLab's EEG-eigenmode clan |
| 1 | Landscape | 65,536 slime-mould agents sense their own trail and the lowness of a fractal terrain. Their trail map is the river network; vegetation follows the water. | Limasieni, SlimeBody |
| 2 | Grove | Trees are chiral fractals: every branching decision is rotated by a small skew, so a whole grove shares one handedness. Crystals grow in the clearings. | GeometricNeuronAndSapolskysFractal, the crystal line |
| 3 | Bark | Gray-Scott reaction-diffusion slime on bark, its feed pumped by a travelling wave. | SlimeBody, GelatinIsland |
| 4 | Cell | An excitable medium (Barkley model) paced by the heartbeat. Zoom in and it resolves into a checkerboard. | Gated Resonance, `ecg.json` |
| 5 | Planet again | Inside the checkerboard. | the Wednesday Loop |

## The heartbeat

`js/ecg.js` is a port of the PerceptionLab "ECG accident" loop (coupler → checkerboard → image-to-vector → splitter → coupler, one tick of delay per edge). With the saved settings it repeats every 59 ticks, the same period measured in [PerceptionLabNodes](https://anttiluode.github.io/PerceptionLabNodes/). It runs at 20 ticks a second and is the only clock in the world:

- its signal sets the planet's tide and how fast the standing waves drift,
- it paces the excitable medium and the slime's pumping,
- its checkerboard square size is the checkerboard you see at the bottom of the cell.

## How the scales connect

Each place hands four numbers to the place inside it (moisture, stress, handedness, rhythm), read at the exact point you zoom into:

- Planet → landscape: wetter coasts give greener land with more rivers; steep coasts give rugged terrain.
- Landscape → grove: moisture sets how many trees and vines; handedness sets which way every tree spirals.
- Grove → bark: moisture and stress set the reaction-diffusion feed and kill rates, so the slime pattern differs from tree to tree.
- Bark → cell: slime density sets how excitable the tissue is.
- Cell → planet: sets sea level and roughness of the planet inside.
- Place → heartbeat: the "rhythm" number of where you are shifts the coupler's setpoint, which changes the beat (59-tick pulse, a slow 285-tick one, or an 8-tick flutter).

Every link has a switch under **How it works**. Off means the level below gets neutral numbers (0.5), so you can see what the link was doing.

## Controls

Scroll or pinch to zoom, drag to move, double-click to zoom in, **Dive** (or space) to fall on your own. **Copy link to this place** gives an address (seed, zoom path, clock) you can share.

## Honest notes

- Built and tested on 15 Nov 2026 in a headless browser with a software renderer only. It ran there at 10–30 fps; real GPU frame rate is not measured yet. If it drops below ~38 fps the page lowers its own render resolution.
- Only two neighbouring levels are ever live: one shader each, plus at most one 512×512 simulation each.
- A shared address reproduces the procedural parts exactly. The simulated parts (rivers, slime, excitable waves) regrow from the same seed and look alike, but are not bit-identical across machines, so numbers handed down from them can differ slightly.
- Each level wraps like a torus, so panning far brings you back round.
- Zooming like this is not new in itself. What I could not find elsewhere, without a real prior-art search, is the combination: a different live law per depth, small readable couplings between depths, and a zoom that closes on itself.
- The "upward" coupling is only the heartbeat. Places do not yet leave permanent marks on the level above.

Files: `index.html`, `js/world.js` (engine), `js/shaders.js` (all GLSL), `js/ecg.js` (the heartbeat). No build step, no dependencies.
