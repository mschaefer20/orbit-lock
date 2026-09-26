# Orbit Lock

A one-button gravity puzzle, spun off from Tidal Orbit's "Binary" mechanic.
The orb is pulled toward the active planet; a tap switches the pull to the
next planet in the level's order. Reach the gold ring before the pips run
out. The tap limit is hard: a level gives you exactly the taps it needs.
No stars, no names — a level is cleared or not, and is known by its number.

Plain HTML/CSS/JS, no bundler. `physics.js` is shared by the game and the
level tools, so a tap sequence replays identically in both.

## Run

```
cd www
python -m http.server 8000
```
Open http://localhost:8000 (add `?all` to unlock every level).

The game lives in `www/`; the repo root holds the Capacitor/Codemagic
wrapper (see `BUILD-iOS.md`) and the level tools.

Tap / click / Space = launch, then switch pull. R = restart.

## Files (all under `www/`)
- `index.html`, `style.css` — shell and screens (title, how-to, level select, win)
- `physics.js` — fixed-step simulation (`make`, `launch`, `flip`, `step`)
- `levels.js` — level data, generated (see below)
- `game.js` — loop, rendering, input, save (localStorage key `orbitlock.v1`)
- `sw.js`, `manifest.json` — installable PWA (bump `CACHE` in sw.js on changes)

Repo root: `package.json`, `capacitor.config.json`, `codemagic.yaml`, `ci/`
(CI patch scripts), `resources/` (icon + splash from `tools/make-assets.js`),
`docs/` (privacy + support pages for GitHub Pages), `BUILD-iOS.md`,
`STORE-LISTING.md`.

## Level format
```js
{ taps, hint?,                            // taps = hard limit = the solver's minimum
  start: {x,y}, v0?: {x,y}, active: 0,   // initial pull index
  planets: [{x,y,r, move?: {ax,ay,f,ph}}], // tap order = array order (wraps);
                                           // move = drift offset (ax,ay)*sin(2*pi*f*t+ph)
  walls?: [{x,y,w,h}],
  gates?: [{x,y,r}],                       // rings that must all be touched before the goal
  goal: {x,y,r} }
```
Canvas is 420 x 640. Planets, walls, and leaving the screen are fatal.

## Levels: hand-made + generated
`levels.js` is written by `tools/gen.js`. Levels 1-16 come from
`tools/handmade.js`; the rest are generated per slot from a seed, then
proven by the solver and sorted by difficulty inside fixed blocks
(17-40, 41-70, 71-100, 101-130, ...). Blocks introduce elements quietly:
walls and orbit starts early, checkpoint gates from the second block,
drifting planets from the third.

- `node tools/gen.js` — regenerate everything up to `--count` (default 100).
  Slots already in levels.js are kept unless `--from A --to B` names them.
- To add more levels: `node tools/gen.js --count 130`. Existing slots are
  untouched; the new block gets its own difficulty ramp.
- To reroll one level you dislike: `node tools/gen.js --from 57 --to 57`.
- To change an opener: edit `tools/handmade.js` and re-run `gen.js`.
- Bump `CACHE` in `sw.js` after any change.

## Level tools (Node, no deps)
- `node tools/solve.js [i]` — brute-forces every 0.1 s tap sequence within the
  limit. Prints min taps, how many sequences win per tap count, and flags
  levels that can't be solved or that fewer than 4 sequences win (fragile).
  Exits 1 if anything is flagged, so it can gate a commit.
- `node tools/render.js` — `tools/out/NN.png` per level with the min-tap
  solution drawn, plus `tools/out/sheet.png` contact sheet.
- `node tools/cloud.js i` — reachability cloud: every 1-tap path (hue = tap
  time) and 2-tap paths (grey) for level i, to see where flips land.
- `node tools/suggest.js i [k] [margin]` — lists 20 px cells reached by many
  exactly-k-tap sequences and by none with fewer taps: candidate goal spots.

Workflow for a new level: write the layout with a placeholder goal, run
`suggest` to pick a goal cell, then `solve` to confirm and set `taps`.

## Map
The home screen builds one 20-level chapter at a time and keeps only the
chapters around the viewport in the DOM, so it scales to thousands of levels.
Sky tints, landmarks and set pieces cycle every 20 / 100 levels. Save format:
`orbitlock.v1` = `{ done: { [index]: 1 } }` (older `stars` saves migrate).
