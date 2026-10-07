/* Level quality metrics + automatic gates, so generated levels can ship
   without anyone play-testing each one.

   metrics(level) solves the level, then measures:
   - ways:     winning 0.1 s tap sequences within the limit (robustness)
   - slack:    best fraction of a solution's one-tap-off-by-0.1 s neighbours
               that still win (1 = forgiving timing, 0 = pixel-perfect)
   - t:        seconds the canonical (most forgiving) solution takes
   - ratio:    path length / straight start-goal distance (1 = a straight shot)
   - turn:     total heading change along that path, in full turns
   - span:     fraction of the board the path's bounding box covers
   gate(m, g) returns the list of failed checks (empty = pass).
   similar(a, b) flags near-duplicate layouts.

   Usage: node tools/quality.js [from] [to]   (1-based; prints a table,
   plus percentiles to calibrate the gates in tools/chapters.js) */
const P = require("../www/physics.js");
const { solve } = require("./solve.js");

function key(seq) { return seq.join(","); }

// Replays a tap sequence (0.1 s slots) and records the path.
function trace(level, seq) {
  const s = P.make(level); P.launch(s);
  const pts = []; let slot = 0, k = 0, si = 0;
  while (s.status === "live") {
    if (k % P.STEPS_PER_SLOT === 0) { if (si < seq.length && seq[si] === slot) { P.flip(s, level); si++; } slot++; }
    P.step(s, level); k++;
    if (k % 3 === 0) pts.push({ x: s.x, y: s.y });
  }
  return { s, pts };
}

function metrics(level) {
  const res = solve(level, { collect: true });
  if (res.min === null) return { min: null, ways: 0 };
  const wins = res.wins, set = new Set(wins.map(key));
  let ways = 0; for (const k in res.found) ways += res.found[k];
  // slack: for each winner, how many single-tap +-1 slot shifts also win
  let best = wins[0], slack = 0;
  for (const w of wins) {
    if (!w.length) { best = w; slack = 1; break; }
    let ok = 0, n = 0;
    for (let i = 0; i < w.length; i++) for (const d of [-1, 1]) {
      const v = w.slice(); v[i] += d;
      if (v[i] < 0 || (i > 0 && v[i] <= v[i - 1]) || (i < v.length - 1 && v[i] >= v[i + 1])) continue;
      n++; if (set.has(key(v))) ok++;
    }
    const f = n ? ok / n : 0;
    if (f > slack) { slack = f; best = w; }
  }
  // path shape of the most forgiving solution
  const { s, pts } = trace(level, best);
  let len = 0, turn = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, prevA = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, d = Math.hypot(dx, dy);
    len += d;
    if (d > 0.5) { const a = Math.atan2(dy, dx); if (prevA !== null) { let da = a - prevA; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; turn += Math.abs(da); } prevA = a; }
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x); minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
  }
  const straight = Math.hypot(level.goal.x - level.start.x, level.goal.y - level.start.y) || 1;
  return {
    min: res.min, ways, slack: +slack.toFixed(2), t: +s.t.toFixed(1),
    ratio: +(len / straight).toFixed(2), turn: +(turn / (2 * Math.PI)).toFixed(2),
    span: +(((maxX - minX) * (maxY - minY)) / (P.W * P.H)).toFixed(2), solution: best,
  };
}

// g = { ways: [lo, hi], slack, t: [lo, hi], ratio, turn }
function gate(m, g) {
  const fail = [];
  if (m.min === null) return ["unsolvable"];
  if (g.taps !== undefined && m.min !== g.taps) fail.push(`min ${m.min} != taps ${g.taps}`);
  if (m.ways < g.ways[0]) fail.push(`ways ${m.ways} < ${g.ways[0]}`);
  if (m.ways > g.ways[1]) fail.push(`ways ${m.ways} > ${g.ways[1]}`);
  if (m.slack < g.slack) fail.push(`slack ${m.slack} < ${g.slack}`);
  if (m.t < g.t[0] || m.t > g.t[1]) fail.push(`t ${m.t} outside ${g.t}`);
  if (m.ratio < g.ratio) fail.push(`ratio ${m.ratio} < ${g.ratio}`);
  if (m.turn < g.turn) fail.push(`turn ${m.turn} < ${g.turn}`);
  return fail;
}

// Near-duplicate layouts: same planet count, every planet matched within
// 40 px, and goal and start both close.
function similar(a, b) {
  if (a.planets.length !== b.planets.length) return false;
  if (Math.hypot(a.goal.x - b.goal.x, a.goal.y - b.goal.y) > 50) return false;
  if (Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) > 60) return false;
  const used = new Set();
  for (const p of a.planets) {
    let hit = -1;
    b.planets.forEach((q, j) => { if (hit < 0 && !used.has(j) && Math.hypot(p.x - q.x, p.y - q.y) < 40) hit = j; });
    if (hit < 0) return false; used.add(hit);
  }
  return true;
}

module.exports = { metrics, gate, similar, trace };

if (require.main === module) {
  const LEVELS = require("../www/levels.js");
  const from = Number(process.argv[2] || 1), to = Number(process.argv[3] || LEVELS.length);
  const rows = [];
  for (let i = from - 1; i < to && i < LEVELS.length; i++) {
    const m = metrics(LEVELS[i]); rows.push(m);
    const dup = LEVELS.slice(0, i).findIndex((l) => similar(LEVELS[i], l));
    console.log(`${String(i + 1).padStart(4)} taps=${LEVELS[i].taps} min=${m.min} ways=${String(m.ways).padStart(5)} slack=${m.slack} t=${m.t} ratio=${m.ratio} turn=${m.turn} span=${m.span}${dup >= 0 ? "  DUP of " + (dup + 1) : ""}`);
  }
  const pct = (k) => { const v = rows.filter((r) => r.min !== null && r.min > 0).map((r) => r[k]).sort((a, b) => a - b); const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))]; return `${k}: p10=${q(0.1)} p25=${q(0.25)} p50=${q(0.5)} p90=${q(0.9)}`; };
  console.log(["ways", "slack", "t", "ratio", "turn", "span"].map(pct).join("\n"));
}
