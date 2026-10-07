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
`levels.js` is written by `tools/gen.js`. Hand-made levels live in
`tools/handmade.js` (`openers` = 1-16, `at[slot]` = any later slot, e.g.
mechanic intros); everything else is generated per slot from a seed and
proven by the solver.

What goes in each slot comes from `tools/chapters.js`: 20-level chapters
(one per map landmark), aimed at most players stopping around 200 and a
few reaching 500.
- 1-100: v1.0 (walls, orbit starts, checkpoint gates, drifting planets).
- 101-200: one new mechanic per chapter (giants + moons, repulsors,
  wormholes, pulsars, ordered gates + drifting goal).
- 201-500: remixes of known mechanics, harder; surprises at 301 (bouncy
  walls) and 401 (wrap-around edges).
Inside a chapter difficulty is a wave: easy opener, a breather at slot 10,
and a finale on slot 20. `node tools/chapters.js` prints the plan and which
mechanics each chapter still needs; the generator refuses slots whose
mechanics aren't built (`INGREDIENTS[x].ready`) unless `--force`.

New slots (101+) must pass quality gates (`tools/quality.js`), calibrated
on v1.0's levels: timing slack (a 0.1 s mistake on one tap often still
wins), a 1.5-10 s solution, a curving path (no straight shots), and no
near-duplicate layout of any earlier level. Finales generate 8 candidates in
parallel and keep the most interesting/hardest.

- `node tools/gen.js --count 200` — generate missing slots up to 200 on all
  cores. Existing slots are never touched unless named.
- Reroll levels you dislike: `node tools/gen.js --from 57 --to 57` (a new seed).
- Finale candidates: `node tools/render.js --file tools/out/candidates/120.json`
  renders them; `node tools/gen.js --pick 120:3` swaps one in.
- `--out FILE` writes (and reads) a scratch file instead of `www/levels.js`.
- Review a chapter: `node tools/render.js 101 120` -> `tools/out/sheet-101-120.png`.
- Bump `CACHE` in `sw.js` after any change.

## Level tools (Node, no deps)
- `node tools/solve.js [i]` — brute-forces every 0.1 s tap sequence within the
  limit. Prints min taps, how many sequences win per tap count, and flags
  levels that can't be solved or that fewer than 4 sequences win (fragile).
  Exits 1 if anything is flagged, so it can gate a commit.
- `node tools/quality.js [from] [to]` — quality metrics per level (ways,
  slack, solution time, path ratio, turns, board span, duplicates) plus
  percentiles for calibrating the gates.
- `node tools/render.js [from] [to] [--file F]` — `tools/out/NN.png` per level
  with the most direct solution drawn (grey = no-tap path), plus one contact
  sheet per chapter.
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
