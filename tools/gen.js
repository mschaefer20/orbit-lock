/* Orbit Lock level generator.

   Builds levels.js = hand-made levels (tools/handmade.js) + generated levels
   up to COUNT. What goes in each slot comes from tools/chapters.js (20-level
   chapters, a difficulty wave inside each). Generation is seeded per slot,
   so re-running reproduces the same file; raising --count appends chapters
   without touching earlier slots.

   Per slot: sample a layout from the profile -> rasterize every k-tap
   trajectory onto a grid -> pick a goal cell that is reached by a healthy
   number of exactly-k sequences and by none with fewer taps -> (optionally)
   drop checkpoint gates on the winning paths -> prove with the exact solver
   and pass the quality gates (tools/quality.js) -> keep, else retry.
   taps = k is a hard limit: the level needs every tap it gives you.
   Finale slots generate several passing candidates and keep the most
   interesting; all of them are saved so you can pick another by eye.
   Near-duplicates of any earlier level are rerolled.

   Usage: node tools/gen.js [options]
     --count N        levels in the file (default: current length, min 100)
     --from A --to B  regenerate these slots even if they exist (with a
                      new seed). Without them, existing slots are kept and
                      only missing ones (up to --count) are generated.
     --jobs N         worker threads (default: cores - 2, max 16)
     --out FILE       write here instead of www/levels.js
     --force          generate slots whose mechanics aren't built yet,
                      using only the ready ones (for pipeline testing)
     --pick S:I       put candidate I (1-based) of finale slot S into the file
     --dry            don't write */
const fs = require("fs"), path = require("path"), os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");
const P = require("../www/physics.js");
const { openers: OPENERS, at: HANDMADE_AT } = require("./handmade.js");
const { solve } = require("./solve.js");
const { profile, INGREDIENTS } = require("./chapters.js");
const Q = require("./quality.js");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DEFAULT_OUT = path.join(__dirname, "..", "www", "levels.js");
const OUT = path.resolve(opt("--out", DEFAULT_OUT));
const CAND_DIR = path.join(__dirname, "out", "candidates");

// ---- seeded rng ------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}
const seedOf = (slot, attempt) => slot * 7919 + attempt * 104729 + 17;
const attemptOf = (slot, seed) => Math.round((seed - slot * 7919 - 17) / 104729);

// ---- geometry helpers --------------------------------------------------------
const W = P.W, H = P.H;
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function reach(p) { return p.r + (p.move ? Math.hypot(p.move.ax, p.move.ay) : 0); }
function wallHits(w, x, y, m) { return x > w.x - m && x < w.x + w.w + m && y > w.y - m && y < w.y + w.h + m; }
function clearOf(lv, x, y, m) {
  for (const p of lv.planets) if (Math.hypot(x - p.x, y - p.y) < reach(p) + m) return false;
  if (lv.moons) for (const p of lv.moons) if (Math.hypot(x - p.x, y - p.y) < p.r + m) return false;
  if (lv.holes) for (const h of lv.holes) for (const e of [h.a, h.b]) if (Math.hypot(x - e.x, y - e.y) < h.r + m) return false;
  if (lv.walls) for (const w of lv.walls) if (wallHits(w, x, y, m)) return false;
  return true;
}

// ---- layout sampler ----------------------------------------------------------
function sampleLayout(r, prof) {
  const lv = { planets: [], walls: [], gates: [], moons: [], holes: [] };
  const n = r.int(prof.planets[0], prof.planets[1]);
  for (let tries = 0; lv.planets.length < n && tries < 200; tries++) {
    const big = lv.planets.length === 0 && r.chance(0.2);
    const p = { x: r.int(50, W - 50), y: r.int(90, H - 60), r: big ? r.int(44, 54) : r.int(22, 38) };
    if (lv.planets.every((q) => dist(p, q) > p.r + q.r + 90)) lv.planets.push(p);
  }
  if (lv.planets.length < 2) return null;
  // giants: heavy planets (stronger pull, drawn bigger) and light ones
  if (prof.giants) {
    const order = lv.planets.map((_, i) => i).sort(() => r() - 0.5).slice(0, prof.giants);
    let heavy = prof.heavyFirst || r.chance(0.65);
    for (const i of order) {
      const p = lv.planets[i];
      const nr = heavy ? r.int(42, 52) : r.int(20, 26);
      const fits = lv.planets.every((q, j) => j === i || dist(p, q) > nr + q.r + 90) && p.x - nr > 20 && p.x + nr < W - 20 && p.y - nr > 50 && p.y + nr < H - 20;
      if (fits) p.r = nr; else if (heavy) return null;   // a heavy planet must look heavy
      p.g = heavy ? +(1.6 + r() * 0.3).toFixed(2) : +(0.5 + r() * 0.15).toFixed(2);
      heavy = prof.heavyFirst || !heavy;
    }
  }
  // movers: drift amplitude kept clear of neighbours
  const nm = prof.movers ? r.int(Math.min(1, prof.movers), prof.movers) : 0;
  for (let k = 0; k < nm; k++) {
    const i = r.int(0, lv.planets.length - 1); const p = lv.planets[i]; if (p.move) continue;
    const amp = r.int(24, 52), ang = r() * Math.PI * 2;
    const mv = { ax: Math.round(Math.cos(ang) * amp), ay: Math.round(Math.sin(ang) * amp), f: +(0.12 + r() * 0.16).toFixed(3), ph: +(r() * 6.283).toFixed(2) };
    const ok = lv.planets.every((q, j) => j === i || dist(p, q) > p.r + q.r + amp + 60);
    if (ok && p.x - amp - p.r > 20 && p.x + amp + p.r < W - 20 && p.y - amp - p.r > 50 && p.y + amp + p.r < H - 20) p.move = mv;
  }
  // repulsors: push instead of pull (never every planet)
  if (prof.repulsors) {
    const free = lv.planets.map((_, i) => i).filter((i) => !lv.planets[i].g).sort(() => r() - 0.5);
    const n = Math.min(prof.repulsors, lv.planets.length - 1, free.length);
    if (!n) return null;
    for (const i of free.slice(0, n)) { lv.planets[i].g = -+(0.7 + r() * 0.3).toFixed(2); lv.planets[i].r = Math.min(lv.planets[i].r, r.int(22, 30)); }
  }
  // moons: inert rocks, placed between two planets where paths tend to run
  for (let k = 0, tries = 0; k < (prof.moons || 0) && tries < 80; tries++) {
    const a = r.pick(lv.planets), b = r.pick(lv.planets); if (a === b) continue;
    const u = 0.3 + r() * 0.4, off = (r() - 0.5) * 120, d = dist(a, b) || 1;
    const x = Math.round(a.x + (b.x - a.x) * u + (-(b.y - a.y) / d) * off), y = Math.round(a.y + (b.y - a.y) * u + ((b.x - a.x) / d) * off);
    const m = { x, y, r: r.int(12, 19) };
    if (x < 40 || x > W - 40 || y < 70 || y > H - 40) continue;
    if (lv.planets.every((p) => dist(p, m) > reach(p) + m.r + 55) && lv.moons.every((q) => dist(q, m) > q.r + m.r + 70)) { lv.moons.push(m); k++; }
  }
  // walls (pulsar levels always have their blinking ones)
  const nw = Math.max(r.int(0, prof.walls), prof.pulsars || 0);
  for (let k = 0, tries = 0; k < nw && tries < 100; tries++) {
    const horiz = r.chance(0.65); const len = r.int(100, 220), th = r.int(14, 18);
    const w = horiz ? { x: r.int(0, W - len), y: r.int(120, H - 120), w: len, h: th } : { x: r.int(60, W - 60), y: r.int(80, H - 80 - len), w: th, h: len };
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    const okP = lv.planets.every((p) => {
      const qx = Math.max(w.x, Math.min(p.x, w.x + w.w)), qy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      return Math.hypot(p.x - qx, p.y - qy) > reach(p) + 45;
    });
    const okW = lv.walls.every((v) => !wallHits(v, cx, cy, 60)) && lv.moons.every((m) => !wallHits(w, m.x, m.y, m.r + 40));
    if (okP && okW) { lv.walls.push(w); k++; }
  }
  if (prof.pulsars) {
    if (lv.walls.length < prof.pulsars) return null;
    // the longest walls blink: they are the ones worth waiting for
    lv.walls.slice().sort((a, b) => (b.w + b.h) - (a.w + a.h)).slice(0, prof.pulsars).forEach((w) => {
      w.blink = { on: +(0.7 + r() * 0.7).toFixed(1), off: +(0.6 + r() * 0.6).toFixed(1), ph: +(r() * 2).toFixed(1) };
    });
  }
  // wormholes: two ends far apart, clear of everything
  for (let k = 0, tries = 0; k < (prof.holes || 0) && tries < 120; tries++) {
    const a = { x: r.int(40, W - 40), y: r.int(70, H - 40) }, b = { x: r.int(40, W - 40), y: r.int(70, H - 40) };
    if (dist(a, b) < 220 || !clearOf(lv, a.x, a.y, 70) || !clearOf(lv, b.x, b.y, 70)) continue;
    lv.holes.push({ a, b, r: 20 }); k++;
  }
  if (lv.holes.length < (prof.holes || 0)) return null;
  // start: at rest, or in orbit around a planet
  lv.active = r.int(0, lv.planets.length - 1);
  if (r.chance(prof.orbit)) {
    const p = lv.planets[lv.active];
    for (let tries = 0; tries < 60; tries++) {
      const ang = r() * Math.PI * 2, d = r.int(p.r + 90, p.r + 200);
      const x = Math.round(p.x + Math.cos(ang) * d), y = Math.round(p.y + Math.sin(ang) * d);
      if (x < 30 || x > W - 30 || y < 40 || y > H - 30 || !clearOf(lv, x, y, 40)) continue;
      const sp = r.int(220, 360), dir = r.chance(0.5) ? 1 : -1;
      lv.start = { x, y }; lv.v0 = { x: Math.round(-Math.sin(ang) * sp * dir), y: Math.round(Math.cos(ang) * sp * dir) };
      break;
    }
  }
  if (!lv.start) {
    for (let tries = 0; tries < 60; tries++) {
      const x = r.int(40, W - 40), y = r.int(40, H - 60);
      if (clearOf(lv, x, y, 70)) { lv.start = { x, y }; break; }
    }
  }
  if (!lv.start) return null;
  if (!lv.walls.length) delete lv.walls;
  if (!lv.moons.length) delete lv.moons;
  if (!lv.holes.length) delete lv.holes;
  delete lv.gates;
  return lv;
}

// ---- reachability grid -------------------------------------------------------
const CELL = 20, CW = W / CELL, CH = H / CELL;
const FIRST = 30, NEXT = 20; // tap windows in 0.1 s slots
function runSeq(lv, seq, onCell) {
  const s = P.make(lv); P.launch(s); let slot = 0, k = 0, si = 0;
  while (s.status === "live") {
    if (k % P.STEPS_PER_SLOT === 0) { if (si < seq.length && seq[si] === slot) { P.flip(s, lv); si++; } slot++; }
    P.step(s, lv); k++;
    if (onCell) onCell(s.x / CELL | 0, s.y / CELL | 0, s);
  }
  return s;
}
function* sequences(k, r) {
  if (k === 0) { yield []; return; }
  if (k <= 3) {
    const rec = function* (prefix, depth) {
      if (depth === k) { yield prefix; return; }
      const lo = depth === 0 ? 0 : prefix[depth - 1] + 1, hi = depth === 0 ? FIRST : prefix[depth - 1] + NEXT;
      for (let s = lo; s < hi; s++) yield* rec(prefix.concat(s), depth + 1);
    };
    yield* rec([], 0);
  } else {
    for (let n = 0; n < 12000; n++) { const seq = []; let t = 0; for (let d = 0; d < k; d++) { t = d === 0 ? r.int(0, FIRST - 1) : t + r.int(1, NEXT - 1); seq.push(t); } yield seq; }
  }
}
function reachGrid(lv, maxK, r) {
  const grids = [];
  const probe = Object.assign({}, lv, { goal: { x: -9999, y: -9999, r: 1 }, taps: maxK, gates: undefined });
  for (let k = 0; k <= maxK; k++) {
    const g = new Uint16Array(CW * CH); const seen = new Uint8Array(CW * CH); let n = 0;
    for (const seq of sequences(k, r)) {
      seen.fill(0);
      runSeq(probe, seq, (cx, cy) => { if (cx >= 0 && cy >= 0 && cx < CW && cy < CH) seen[cy * CW + cx] = 1; });
      for (let j = 0; j < seen.length; j++) if (seen[j]) g[j]++;
      n++;
    }
    grids.push({ g, n });
  }
  return grids;
}

// ---- goal + gate choice ------------------------------------------------------
function chooseGoal(lv, grids, prof, r) {
  const cands = [];
  const [pmin, pmax] = prof.taps;
  for (let k = Math.max(1, pmin); k <= pmax; k++) {
    if (!grids[k]) continue;
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
      const j = cy * CW + cx, x = cx * CELL + 10, y = cy * CELL + 10;
      if (x < 40 || x > W - 40 || y < 40 || y > H - 40) continue;
      let fewer = 0; for (let m = 0; m < k; m++) fewer += grids[m].g[j];
      const n = grids[k].g[j];
      if (fewer || n < prof.ways[0] || n > prof.ways[1] * 2) continue;
      if (!clearOf(lv, x, y, 44)) continue;   // goal r <= 28, orb r 11: ring never overlaps a kill zone
      if (Math.hypot(x - lv.start.x, y - lv.start.y) < 170) continue;
      cands.push({ x, y, k, n });
    }
  }
  if (!cands.length) return null;
  // prefer the higher tap counts a little, then random
  cands.sort((a, b) => b.k - a.k);
  const top = cands.filter((c) => c.k === cands[0].k);
  const pool = r.chance(0.7) ? top : cands;
  return r.pick(pool);
}
function chooseGates(lv, count, r) {
  // cells visited (before the goal) by winners; gates go on well-trodden ones
  const probe = Object.assign({}, lv, { gates: undefined });
  const freq = new Uint16Array(CW * CH), when = new Float64Array(CW * CH); let wins = 0;
  for (const seq of sequences(lv.taps, r)) {
    const seen = new Float32Array(CW * CH);   // first-visit time + 1 (0 = never)
    const s = runSeq(probe, seq, (cx, cy, st) => { if (cx >= 0 && cy >= 0 && cx < CW && cy < CH && !seen[cy * CW + cx]) seen[cy * CW + cx] = st.t + 1; });
    if (s.status !== "won") continue;
    wins++; for (let j = 0; j < seen.length; j++) if (seen[j]) { freq[j]++; when[j] += seen[j] - 1; }
  }
  if (!wins) return null;
  const cands = [];
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const j = cy * CW + cx, x = cx * CELL + 10, y = cy * CELL + 10, f = freq[j] / wins;
    if (f < 0.35 || f > 0.95) continue;
    if (!clearOf(lv, x, y, 30)) continue;
    if (Math.hypot(x - lv.start.x, y - lv.start.y) < 110 || Math.hypot(x - lv.goal.x, y - lv.goal.y) < 90) continue;
    cands.push({ x, y, r: 18, f, t: when[j] / freq[j] });
  }
  const gates = [];
  for (let tries = 0; gates.length < count && cands.length && tries < 40; tries++) {
    const c = r.pick(cands);
    if (gates.every((g) => Math.hypot(g.x - c.x, g.y - c.y) > 100)) gates.push({ x: c.x, y: c.y, r: 18, t: c.t });
  }
  gates.sort((a, b) => a.t - b.t).forEach((g) => delete g.t);   // the order winners pass them in
  return gates.length ? gates : null;
}

// ---- verification ------------------------------------------------------------
// v1.0 slots (1-100) keep their original check; newer slots must also pass
// the quality gates.
function verify(lv, prof) {
  if (prof.legacy) {
    const res = solve(lv);
    if (res.min === null || res.min !== lv.taps) return null;
    let ways = 0; for (const k in res.found) ways += res.found[k];
    if (ways < prof.ways[0] || ways > prof.ways[1] * 2) return null;
    return { ways };
  }
  const m = Q.metrics(lv);
  const g = Object.assign({}, prof.gate, { taps: lv.taps, ways: prof.ways });
  return Q.gate(m, g).length ? null : m;
}
// how interesting a passing level is (ranks finale candidates): a long,
// curling, board-filling path; more taps and fewer winning routes = harder.
function interest(m) { return m.turn + 2 * m.span + 0.1 * Math.min(10, m.ratio) + m.slack + 0.5 * m.min - Math.min(150, m.ways) / 75; }

// ---- one slot ------------------------------------------------------------------
// Tries seeds from attempt `start` on until `want` levels pass.
// relax = one tap lower at the top of the window (fallback for stuck slots).
// Returns { level (the most interesting), candidates, attempts }.
function generate(slot, start, want = 1, relax = false) {
  const prof = profile(slot);
  if (relax) { prof.taps = [Math.max(1, prof.taps[0] - 1), Math.max(1, prof.taps[1] - 1)]; prof.finale = false; }
  const cands = [];
  const maxAttempts = prof.legacy ? 80 : prof.finale ? 600 : 400 * want;
  const deadline = Date.now() + (prof.finale ? 120 : 600) * 1000;   // a finale job may fail; its siblings cover it
  let attempt = start;
  for (; attempt < start + maxAttempts && cands.length < want && Date.now() < deadline; attempt++) {
    const seed = seedOf(slot, attempt), r = rng(seed);
    const lv = sampleLayout(r, prof); if (!lv) continue;
    const grids = reachGrid(lv, prof.taps[1], r);
    const goal = chooseGoal(lv, grids, prof, r); if (!goal) continue;
    lv.goal = { x: goal.x, y: goal.y, r: r.int(22, 28) };
    lv.taps = goal.k;
    if (prof.gates) {
      const gs = chooseGates(lv, prof.gates, r); if (gs) lv.gates = gs;
      if (prof.ordered) { if (!gs || gs.length < 2) continue; lv.ordered = true; }
    }
    if (prof.driftgoal && r.chance(prof.driftgoal)) {
      const amp = r.int(25, 55), ang = r() * Math.PI * 2;
      lv.goal.move = { ax: Math.round(Math.cos(ang) * amp), ay: Math.round(Math.sin(ang) * amp), f: +(0.12 + r() * 0.12).toFixed(3), ph: +(r() * 6.283).toFixed(2) };
      const g = lv.goal;
      if (!clearOf(lv, g.x + g.move.ax, g.y + g.move.ay, 44) || !clearOf(lv, g.x - g.move.ax, g.y - g.move.ay, 44) ||
          g.x - amp < 30 || g.x + amp > W - 30 || g.y - amp < 30 || g.y + amp > H - 30) delete g.move;
    }
    const v = verify(lv, prof); if (!v) continue;
    const out = { taps: lv.taps, seed, ways: v.ways, start: lv.start, active: lv.active };
    if (lv.v0) out.v0 = lv.v0;
    out.planets = lv.planets; if (lv.moons) out.moons = lv.moons; if (lv.holes) out.holes = lv.holes;
    if (lv.walls) out.walls = lv.walls; if (lv.gates) out.gates = lv.gates; if (lv.ordered) out.ordered = true;
    out.goal = lv.goal;
    cands.push({ level: out, score: prof.legacy ? 0 : interest(v), m: v });
  }
  if (!cands.length) return { level: null, candidates: [], attempts: attempt - start };
  const best = cands.slice().sort((a, b) => b.score - a.score)[0];
  return { level: best.level, m: best.m, score: best.score, candidates: cands.map((c) => c.level), attempts: attempt - start };
}

// ---- serialize ---------------------------------------------------------------
function fmt(v) { return JSON.stringify(v).replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ").replace(/\{/g, "{ ").replace(/\}/g, " }"); }
function serialize(levels) {
  const lines = levels.map((lv, i) => {
    const o = Object.assign({}, lv); const gen = "seed" in o;
    const head = `  // ${i + 1}\n  { taps: ${o.taps}` + (o.hint ? `, hint: ${JSON.stringify(o.hint)}` : "") + (gen ? `, seed: ${o.seed}, ways: ${o.ways}` : "") + ",";
    const body = [];
    body.push(`    start: ${fmt(o.start)}` + (o.v0 ? `, v0: ${fmt(o.v0)}` : "") + `, active: ${o.active || 0},`);
    body.push(`    planets: [${o.planets.map(fmt).join(", ")}],`);
    if (o.moons) body.push(`    moons: [${o.moons.map(fmt).join(", ")}],`);
    if (o.holes) body.push(`    holes: [${o.holes.map(fmt).join(", ")}],`);
    if (o.walls) body.push(`    walls: [${o.walls.map(fmt).join(", ")}],`);
    if (o.gates) body.push(`    gates: [${o.gates.map(fmt).join(", ")}],` + (o.ordered ? " ordered: true," : ""));
    body.push(`    goal: ${fmt(o.goal)} },`);
    return head + "\n" + body.join("\n");
  });
  return `/* Orbit Lock levels — GENERATED by tools/gen.js. Do not hand-edit the
   generated entries here; edit tools/handmade.js for hand-made levels, or
   re-run the generator (--from/--to) to reroll a slot. Every level is proven
   by tools/solve.js. Canvas 420 x 640; taps cycle planets in array order. */
const LEVELS = [
${lines.join("\n\n")}
];
if (typeof module !== "undefined") module.exports = LEVELS;
`;
}

// ---- main ----------------------------------------------------------------------
// the file being written is also the one read (so --out files can be iterated on)
function loadExisting() { const f = fs.existsSync(OUT) ? OUT : DEFAULT_OUT; try { delete require.cache[require.resolve(f)]; return require(f); } catch (_) { return []; } }
function write(levels, t0) {
  if (args.includes("--dry")) return;
  fs.writeFileSync(OUT, serialize(levels));
  console.log(`wrote ${OUT} (${levels.length} levels)${t0 ? ` in ${((Date.now() - t0) / 1000).toFixed(0)}s` : ""}`);
}
const tag = (p) => p.legacy ? "" : p.finale ? " finale" : p.breather ? " breather" : "";
function describe(slot, lv, m, secs, attempts) {
  const p = profile(slot);
  const extra = m && m.slack !== undefined ? ` slack=${m.slack} t=${m.t} turn=${m.turn}` : "";
  return `${String(slot).padStart(3)} taps=${lv.taps} ways=${lv.ways} planets=${lv.planets.length} walls=${(lv.walls || []).length} gates=${(lv.gates || []).length} movers=${lv.planets.filter((q) => q.move).length}${lv.moons ? ` moons=${lv.moons.length}` : ""}${lv.planets.some((q) => q.g > 0) ? ` giants=${lv.planets.filter((q) => q.g > 0).length}` : ""}${lv.planets.some((q) => q.g < 0) ? ` push=${lv.planets.filter((q) => q.g < 0).length}` : ""}${lv.holes ? ` holes=${lv.holes.length}` : ""}${(lv.walls || []).some((w) => w.blink) ? ` pulsars=${lv.walls.filter((w) => w.blink).length}` : ""}${lv.ordered ? " ordered" : ""}${lv.goal.move ? " driftgoal" : ""}${extra}${tag(p)}  ${secs.toFixed(1)}s/${attempts}`;
}

async function main() {
  const existing = loadExisting();
  // --pick S:I — swap in a saved finale candidate, nothing else
  if (opt("--pick")) {
    const [slot, idx] = opt("--pick").split(":").map(Number);
    const cands = JSON.parse(fs.readFileSync(path.join(CAND_DIR, slot + ".json"), "utf8"));
    if (!cands[idx - 1]) throw new Error(`slot ${slot} has ${cands.length} candidates`);
    const levels = existing.slice(); levels[slot - 1] = cands[idx - 1];
    write(levels); return;
  }
  const COUNT = Number(opt("--count", Math.max(100, existing.length)));
  const FROM = Number(opt("--from", 1)), TO = Number(opt("--to", COUNT));
  const JOBS = Number(opt("--jobs", Math.max(1, Math.min(16, os.cpus().length - 2))));
  const FORCE = args.includes("--force");

  // decide each slot: hand-made, kept, or generated (and from which attempt)
  const levels = [], todo = [];
  for (let slot = 1; slot <= COUNT; slot++) {
    const hand = slot <= OPENERS.length ? OPENERS[slot - 1] : HANDMADE_AT[slot];
    const prev = existing[slot - 1];
    if (hand) { levels.push(hand); continue; }
    const inRange = (args.includes("--from") || args.includes("--to")) && slot >= FROM && slot <= TO;
    if (prev && "seed" in prev && !inRange) { levels.push(prev); continue; }
    levels.push(null);
    // rerolling an existing slot starts past the seed it has now
    const start = prev && "seed" in prev && inRange ? attemptOf(slot, prev.seed) + 1 : 0;
    const n = profile(slot).candidates || 1;
    // finale candidates run as separate jobs on disjoint seed ranges
    for (let j = 0; j < n; j++) todo.push({ slot, start: start + j * 1000, part: j, of: n });
  }
  const blocked = todo.filter((t) => profile(t.slot).need.length);
  if (blocked.length && !FORCE) {
    const needs = [...new Set(blocked.flatMap((t) => profile(t.slot).need))];
    console.error(`slots ${blocked[0].slot}-${blocked[blocked.length - 1].slot} need mechanics that aren't built yet: ${needs.join(", ")}.\n` +
      `Build them (tools/chapters.js INGREDIENTS.ready) or pass --force to test the pipeline with the ready ones only.`);
    process.exit(1);
  }
  if (!todo.length) { write(levels); return; }
  const slots = [...new Set(todo.map((t) => t.slot))];
  todo.sort((a, b) => (b.of > 1) - (a.of > 1));   // slow finale jobs first

  // generate in parallel; slots are independent (seeded per slot)
  const t0 = Date.now();
  console.log(`generating ${slots.length} slot(s) (${todo.length} jobs) on ${Math.min(JOBS, todo.length)} worker(s)...`);
  const results = {};
  await new Promise((resolve) => {
    let next = 0, done = 0;
    const workers = [];
    const feed = (w) => { if (next < todo.length) { const t = todo[next++]; w.t0 = Date.now(); w.postMessage(t); } };
    for (let i = 0; i < Math.min(JOBS, todo.length); i++) {
      const w = new Worker(__filename, { argv: args }); workers.push(w);
      w.on("message", (msg) => {
        (results[msg.slot] = results[msg.slot] || []).push(msg);
        const secs = (Date.now() - w.t0) / 1000, part = msg.of > 1 ? ` [candidate ${msg.part + 1}/${msg.of}]` : "";
        if (msg.level) console.log(describe(msg.slot, msg.level, msg.m, secs, msg.attempts) + part);
        else console.error(`${String(msg.slot).padStart(3)} FAILED after ${msg.attempts} attempts${part}`);
        if (++done === todo.length) { workers.forEach((x) => x.terminate()); resolve(); } else feed(w);
      });
      feed(w);
    }
  });

  // fill in, then reroll near-duplicates of anything earlier (in slot order)
  let failed = 0;
  for (const slot of slots) {
    const ok = results[slot].filter((r) => r.level).sort((a, b) => a.part - b.part);
    if (!ok.length) {   // every job failed: one relaxed retry here, else keep what was there
      const r = generate(slot, 50000, 1, true);
      if (r.level) { console.log(describe(slot, r.level, r.m, 0, r.attempts) + " [relaxed: one tap easier]"); levels[slot - 1] = r.level; }
      else { failed++; levels[slot - 1] = existing[slot - 1] || null; console.error(`${String(slot).padStart(3)} still failing after a relaxed retry`); }
      continue;
    }
    levels[slot - 1] = ok.slice().sort((a, b) => b.score - a.score)[0].level;   // most interesting
    if (ok.length > 1) {
      fs.mkdirSync(CAND_DIR, { recursive: true });
      fs.writeFileSync(path.join(CAND_DIR, slot + ".json"), JSON.stringify(ok.map((r) => r.level)));
      const chosen = ok.findIndex((r) => r.level === levels[slot - 1]) + 1;
      console.log(`${String(slot).padStart(3)} kept candidate ${chosen} of ${ok.length} (see them: node tools/render.js --file tools/out/candidates/${slot}.json; swap: node tools/gen.js --pick ${slot}:N)`);
    }
  }
  for (const slot of slots) {
    let lv = levels[slot - 1]; if (!lv) continue;
    for (let tries = 0; tries < 5; tries++) {
      const dup = levels.slice(0, slot - 1).findIndex((o) => o && Q.similar(lv, o));
      if (dup < 0) break;
      console.log(`${String(slot).padStart(3)} near-duplicate of ${dup + 1}, rerolling`);
      const r = generate(slot, attemptOf(slot, lv.seed) + 1);
      if (!r.level) break;
      lv = levels[slot - 1] = r.level;
    }
  }
  // v1.0 blocks (17-40, 41-70, 71-100) were sorted by difficulty after a full regeneration
  const legacyScore = (lv) => lv.taps * 100 - Math.min(60, lv.ways) + (lv.gates ? lv.gates.length * 12 : 0) + lv.planets.filter((p) => p.move).length * 8 + lv.planets.length * 3;
  for (const [lo, hi] of [[17, 40], [41, 70], [71, 100]]) {
    if (!slots.includes(lo) || !slots.includes(hi) || args.includes("--from") || args.includes("--to")) continue;
    const seg = levels.slice(lo - 1, hi).filter(Boolean);
    if (seg.length === hi - lo + 1) { seg.sort((a, b) => legacyScore(a) - legacyScore(b)); levels.splice(lo - 1, seg.length, ...seg); }
  }
  // never throw a batch away: write up to the first hole
  const hole = levels.findIndex((l) => !l);
  if (hole >= 0) { console.error(`slot ${hole + 1} could not be generated; writing levels 1-${hole} only`); levels.length = hole; process.exitCode = 1; }
  write(levels, t0);
  if (failed) { console.error(`${failed} slot(s) failed; kept their previous level`); process.exitCode = 1; }
}

if (isMainThread) main().catch((e) => { console.error(e); process.exit(1); });
else parentPort.on("message", ({ slot, start, part, of }) => {
  const r = generate(slot, start);
  parentPort.postMessage({ slot, part, of, level: r.level, score: r.score || 0, m: r.m ? { slack: r.m.slack, t: r.m.t, turn: r.m.turn } : null, attempts: r.attempts });
});
