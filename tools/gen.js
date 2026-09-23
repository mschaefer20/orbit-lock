/* Orbit Lock level generator.

   Builds levels.js = hand-made openers (tools/handmade.js) + generated levels
   up to COUNT. Generation is seeded per slot, so re-running reproduces the
   same file; raising COUNT appends new blocks without touching earlier ones.

   Per slot: sample a layout from the block's profile -> rasterize every
   k-tap trajectory onto a grid -> pick a goal cell that is reached by a
   healthy number of exactly-par sequences and by none with fewer taps ->
   (optionally) drop a checkpoint gate on the winning paths -> confirm with
   the exact solver and the difficulty window -> keep, else retry.

   Usage: node tools/gen.js [--count 100] [--from 17] [--to 100] [--dry]
   --from/--to regenerate only those slots (others are read from levels.js). */
const fs = require("fs"), path = require("path");
const P = require("../www/physics.js");
const HANDMADE = require("./handmade.js");
const { solve } = require("./solve.js");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const COUNT = opt("--count", 100), FROM = opt("--from", HANDMADE.length + 1), TO = opt("--to", COUNT);
const DRY = args.includes("--dry");
const OUT = path.join(__dirname, "..", "www", "levels.js");

// ---- seeded rng ------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

// ---- block profiles ----------------------------------------------------------
// Slots 17-40 = block 0, 41-70 = block 1, 71-100 = block 2, 101-130 = block 3...
function blockOf(slot) { return slot <= 40 ? 0 : Math.floor((slot - 41) / 30) + 1; }
function blockRange(b) { return b === 0 ? [17, 40] : [41 + (b - 1) * 30, 70 + (b - 1) * 30]; }
function profile(slot) {
  const b = blockOf(slot); const [lo, hi] = blockRange(b); const u = (slot - lo) / (hi - lo); // 0..1 within block
  if (b === 0) return { planets: [2, u < 0.5 ? 3 : 4], walls: u < 0.3 ? 0 : 1, orbit: 0.35, gates: 0, movers: 0,
    par: [1, u < 0.4 ? 2 : 3], ways: [10 + Math.round(20 * (1 - u)), 90] };
  if (b === 1) return { planets: [2, 4], walls: u < 0.5 ? 1 : 2, orbit: 0.45, gates: u < 0.15 ? 0 : (u < 0.7 ? 1 : 2), movers: 0,
    par: [u < 0.3 ? 1 : 2, 3], ways: [6 + Math.round(8 * (1 - u)), 45] };
  const extra = b - 2; // every later block nudges harder
  return { planets: [3, 5], walls: 2, orbit: 0.5, gates: u < 0.5 ? 1 : 2, movers: u < 0.2 ? 1 : 2,
    par: [2, Math.min(4, 3 + (u > 0.6 ? 1 : 0) + Math.min(1, extra))], ways: [Math.max(3, 5 - extra), 28 - 3 * Math.min(4, extra)] };
}

// ---- names: near space -> deep space -----------------------------------------
const NAMES = [
  // block 0 (24): home system
  "Tide", "Ebb", "Apogee", "Perigee", "Umbra", "Halo", "Crescent", "Gibbous", "Zenith", "Nadir", "Lagrange", "Syzygy",
  "Transit", "Occult", "Libration", "Meridian", "Aphelion", "Perihelion", "Equinox", "Solstice", "Corona", "Flare", "Ecliptic", "Terminator",
  // block 1 (30): the belt and the giants
  "Ceres", "Vesta", "Pallas", "Kirkwood", "Trojan", "Hilda", "Callisto", "Ganymede", "Europa", "Io", "Amalthea", "Tethys",
  "Enceladus", "Mimas", "Rhea", "Titan", "Iapetus", "Cassini", "Encke", "Roche", "Miranda", "Ariel", "Umbriel", "Oberon",
  "Triton", "Nereid", "Charon", "Sedna", "Eris", "Kuiper",
  // block 2 (30): out among the stars
  "Oort", "Heliopause", "Proxima", "Centauri", "Barnard", "Sirius", "Procyon", "Vega", "Altair", "Deneb", "Arcturus", "Aldebaran",
  "Rigel", "Betelgeuse", "Antares", "Spica", "Polaris", "Capella", "Castor", "Pollux", "Mizar", "Alcor", "Algol", "Albireo",
  "Pleiades", "Hyades", "Praesepe", "Orion", "Carina", "Cygnus",
  // block 3 (30): deep sky
  "Nebula", "Pulsar", "Magnetar", "Quasar", "Blazar", "Cepheid", "Nova", "Supernova", "Remnant", "Accretion", "Horizon", "Singularity",
  "Andromeda", "Triangulum", "Whirlpool", "Sombrero", "Pinwheel", "Cartwheel", "Antennae", "Sculptor", "Fornax", "Draco",
  "Virgo", "Coma", "Laniakea", "Void", "Filament", "Redshift", "Relic", "Dawn",
];
function nameFor(slot, r) {
  const b = blockOf(slot); const [lo, hi] = blockRange(b);
  const start = b === 0 ? 0 : 24 + (b - 1) * 30;
  const pool = NAMES.slice(start, start + (hi - lo + 1));
  if (pool.length === hi - lo + 1) { // seeded shuffle of the block's pool, index by position
    const sh = pool.slice(); const rr = rng(1000 + b);
    for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    return sh[slot - lo];
  }
  return "Sector " + slot;
}

// ---- geometry helpers --------------------------------------------------------
const W = P.W, H = P.H;
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function reach(p) { return p.r + (p.move ? Math.hypot(p.move.ax, p.move.ay) : 0); }
function wallHits(w, x, y, m) { return x > w.x - m && x < w.x + w.w + m && y > w.y - m && y < w.y + w.h + m; }
function clearOf(lv, x, y, m) {
  for (const p of lv.planets) if (Math.hypot(x - p.x, y - p.y) < reach(p) + m) return false;
  if (lv.walls) for (const w of lv.walls) if (wallHits(w, x, y, m)) return false;
  return true;
}

// ---- layout sampler ----------------------------------------------------------
function sampleLayout(r, prof) {
  const lv = { planets: [], walls: [], gates: [] };
  const n = r.int(prof.planets[0], prof.planets[1]);
  for (let tries = 0; lv.planets.length < n && tries < 200; tries++) {
    const big = lv.planets.length === 0 && r.chance(0.2);
    const p = { x: r.int(50, W - 50), y: r.int(90, H - 60), r: big ? r.int(44, 54) : r.int(22, 38) };
    if (lv.planets.every((q) => dist(p, q) > p.r + q.r + 90)) lv.planets.push(p);
  }
  if (lv.planets.length < 2) return null;
  // movers: drift amplitude kept clear of neighbours
  const nm = prof.movers ? r.int(Math.min(1, prof.movers), prof.movers) : 0;
  for (let k = 0; k < nm; k++) {
    const i = r.int(0, lv.planets.length - 1); const p = lv.planets[i]; if (p.move) continue;
    const amp = r.int(24, 52), ang = r() * Math.PI * 2;
    const mv = { ax: Math.round(Math.cos(ang) * amp), ay: Math.round(Math.sin(ang) * amp), f: +(0.12 + r() * 0.16).toFixed(3), ph: +(r() * 6.283).toFixed(2) };
    const ok = lv.planets.every((q, j) => j === i || dist(p, q) > p.r + q.r + amp + 60);
    if (ok && p.x - amp - p.r > 20 && p.x + amp + p.r < W - 20 && p.y - amp - p.r > 50 && p.y + amp + p.r < H - 20) p.move = mv;
  }
  // walls
  const nw = r.int(0, prof.walls);
  for (let k = 0, tries = 0; k < nw && tries < 100; tries++) {
    const horiz = r.chance(0.65); const len = r.int(100, 220), th = r.int(14, 18);
    const w = horiz ? { x: r.int(0, W - len), y: r.int(120, H - 120), w: len, h: th } : { x: r.int(60, W - 60), y: r.int(80, H - 80 - len), w: th, h: len };
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    const okP = lv.planets.every((p) => {
      const qx = Math.max(w.x, Math.min(p.x, w.x + w.w)), qy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      return Math.hypot(p.x - qx, p.y - qy) > reach(p) + 45;
    });
    const okW = lv.walls.every((v) => !wallHits(v, cx, cy, 60));
    if (okP && okW) { lv.walls.push(w); k++; }
  }
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
  const [pmin, pmax] = prof.par;
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
  // prefer the higher par values a little, then random
  cands.sort((a, b) => b.k - a.k);
  const top = cands.filter((c) => c.k === cands[0].k);
  const pool = r.chance(0.7) ? top : cands;
  return r.pick(pool);
}
function chooseGates(lv, par, count, r) {
  // cells visited (before the goal) by par-tap winners; gates go on well-trodden ones
  const probe = Object.assign({}, lv, { taps: par, gates: undefined });
  const freq = new Uint16Array(CW * CH); let wins = 0;
  for (const seq of sequences(par, r)) {
    const seen = new Uint8Array(CW * CH);
    const s = runSeq(probe, seq, (cx, cy) => { if (cx >= 0 && cy >= 0 && cx < CW && cy < CH) seen[cy * CW + cx] = 1; });
    if (s.status !== "won") continue;
    wins++; for (let j = 0; j < seen.length; j++) if (seen[j]) freq[j]++;
  }
  if (!wins) return null;
  const cands = [];
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const j = cy * CW + cx, x = cx * CELL + 10, y = cy * CELL + 10, f = freq[j] / wins;
    if (f < 0.35 || f > 0.95) continue;
    if (!clearOf(lv, x, y, 30)) continue;
    if (Math.hypot(x - lv.start.x, y - lv.start.y) < 110 || Math.hypot(x - lv.goal.x, y - lv.goal.y) < 90) continue;
    cands.push({ x, y, r: 18, f });
  }
  const gates = [];
  for (let tries = 0; gates.length < count && cands.length && tries < 40; tries++) {
    const c = r.pick(cands);
    if (gates.every((g) => Math.hypot(g.x - c.x, g.y - c.y) > 100)) gates.push({ x: c.x, y: c.y, r: 18 });
  }
  return gates.length ? gates : null;
}

// ---- verification ------------------------------------------------------------
function verify(lv, prof) {
  const res = solve(lv);
  if (res.min === null || res.min !== lv.par) return null;
  let atPar = 0; for (const k in res.found) if (Number(k) <= lv.par) atPar += res.found[k];
  if (atPar < prof.ways[0] || atPar > prof.ways[1] * 2) return null;
  return { atPar, example: res.example[res.min] };
}

// ---- one slot ------------------------------------------------------------------
function generate(slot) {
  const prof = profile(slot);
  for (let attempt = 0; attempt < 80; attempt++) {
    const r = rng(slot * 7919 + attempt * 104729 + 17);
    const lv = sampleLayout(r, prof); if (!lv) continue;
    const grids = reachGrid(lv, prof.par[1], r);
    const goal = chooseGoal(lv, grids, prof, r); if (!goal) continue;
    lv.goal = { x: goal.x, y: goal.y, r: r.int(22, 28) };
    lv.par = goal.k; lv.taps = lv.par + (lv.par <= 2 ? 2 : 1);
    if (prof.gates) { const gs = chooseGates(lv, lv.par, prof.gates, r); if (gs) lv.gates = gs; }
    const v = verify(lv, prof); if (!v) continue;
    const out = { name: nameFor(slot, r), taps: lv.taps, par: lv.par, seed: slot * 7919 + attempt * 104729 + 17, ways: v.atPar,
      start: lv.start, active: lv.active };
    if (lv.v0) out.v0 = lv.v0;
    out.planets = lv.planets; if (lv.walls) out.walls = lv.walls; if (lv.gates) out.gates = lv.gates;
    out.goal = lv.goal;
    return out;
  }
  return null;
}

// ---- serialize ---------------------------------------------------------------
function fmt(v) { return JSON.stringify(v).replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ").replace(/\{/g, "{ ").replace(/\}/g, " }"); }
function serialize(levels) {
  const lines = levels.map((lv, i) => {
    const o = Object.assign({}, lv); const gen = "seed" in o;
    const head = `  // ${i + 1}\n  { name: ${JSON.stringify(o.name)}, taps: ${o.taps}, par: ${o.par}` + (o.hint ? `, hint: ${JSON.stringify(o.hint)}` : "") + (gen ? `, seed: ${o.seed}, ways: ${o.ways}` : "") + ",";
    const body = [];
    body.push(`    start: ${fmt(o.start)}` + (o.v0 ? `, v0: ${fmt(o.v0)}` : "") + `, active: ${o.active || 0},`);
    body.push(`    planets: [${o.planets.map(fmt).join(", ")}],`);
    if (o.walls) body.push(`    walls: [${o.walls.map(fmt).join(", ")}],`);
    if (o.gates) body.push(`    gates: [${o.gates.map(fmt).join(", ")}],`);
    body.push(`    goal: ${fmt(o.goal)} },`);
    return head + "\n" + body.join("\n");
  });
  return `/* Orbit Lock levels — GENERATED by tools/gen.js. Do not hand-edit the
   generated entries here; edit tools/handmade.js for levels 1-${HANDMADE.length}, or
   re-run the generator (--from/--to) to reroll a slot. Every level is proven
   by tools/solve.js. Canvas 420 x 640; taps cycle planets in array order. */
const LEVELS = [
${lines.join("\n\n")}
];
if (typeof module !== "undefined") module.exports = LEVELS;
`;
}

// ---- main ----------------------------------------------------------------------
let existing = [];
try { existing = require(OUT); } catch (_) {}
const levels = HANDMADE.slice();
const t0 = Date.now();
for (let slot = HANDMADE.length + 1; slot <= COUNT; slot++) {
  const prev = existing[slot - 1];
  if ((slot < FROM || slot > TO) && prev && "seed" in prev) { levels.push(prev); continue; }
  const ts = Date.now();
  const lv = generate(slot);
  if (!lv) { console.error(`slot ${slot}: FAILED to generate`); process.exitCode = 1; if (prev) levels.push(prev); continue; }
  levels.push(lv);
  console.log(`${String(slot).padStart(3)} ${lv.name.padEnd(12)} par=${lv.par} taps=${lv.taps} ways=${lv.ways} planets=${lv.planets.length} walls=${(lv.walls || []).length} gates=${(lv.gates || []).length} movers=${lv.planets.filter((p) => p.move).length} ${((Date.now() - ts) / 1000).toFixed(1)}s`);
}
// sort each generated block by a difficulty score (par dominates, fewer ways = harder).
// A partial reroll (--from/--to) keeps slots in place so the rest of the block is untouched.
const REROLL = FROM > HANDMADE.length + 1 || TO < COUNT;
function score(lv) { return lv.par * 100 - Math.min(60, lv.ways) + (lv.gates ? lv.gates.length * 12 : 0) + lv.planets.filter((p) => p.move).length * 8 + lv.planets.length * 3; }
for (let b = 0; ; b++) {
  const [lo, hi] = blockRange(b); if (lo > levels.length) break;
  const a = lo - 1, z = Math.min(hi, levels.length);
  const seg = levels.slice(a, z);
  if (!REROLL && seg.every((l) => "seed" in l)) { seg.sort((x, y) => score(x) - score(y)); levels.splice(a, seg.length, ...seg); }
}
// names follow the final slot so the near->deep progression holds after sorting
levels.forEach((lv, i) => { if ("seed" in lv) lv.name = nameFor(i + 1, null); });
if (!DRY) { fs.writeFileSync(OUT, serialize(levels)); console.log(`wrote ${OUT} (${levels.length} levels) in ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
