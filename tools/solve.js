/* Brute-force solver: proves each level solvable within its tap limit and
   reports the minimum taps + how many distinct 0.1 s-grid tap sequences win
   (a robustness proxy — 1 means pixel-perfect, avoid).
   Usage: node tools/solve.js [levelIndex]  */
const P = require("../www/physics.js");
const LEVELS = require("../www/levels.js");

function solve(level) {
  const SLOTS = Math.ceil(P.TIME_LIMIT / (P.DT * P.STEPS_PER_SLOT));
  const found = {};          // taps -> count
  const example = {};        // taps -> first winning slot list
  let nodes = 0;
  function runSlot(s) {
    for (let i = 0; i < P.STEPS_PER_SLOT; i++) { if (P.step(s, level) !== "live") return; }
  }
  function dfs(s, slot, seq) {
    nodes++;
    if (s.status === "won") { found[s.taps] = (found[s.taps] || 0) + 1; if (!example[s.taps]) example[s.taps] = seq.slice(); return; }
    if (s.status !== "live" || slot >= SLOTS) return;
    // branch: tap at this slot (if any left), or don't
    if (s.taps < level.taps) {
      const t = P.clone(s); P.flip(t, level); runSlot(t); seq.push(slot); dfs(t, slot + 1, seq); seq.pop();
    }
    const n = P.clone(s); runSlot(n); dfs(n, slot + 1, seq);
  }
  const s0 = P.make(level); P.launch(s0); dfs(s0, 0, []);
  const taps = Object.keys(found).map(Number).sort((a, b) => a - b);
  return { min: taps.length ? taps[0] : null, found, example, nodes };
}

module.exports = { solve };
if (require.main === module) {
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
let bad = 0;
LEVELS.forEach((lv, i) => {
  if (only !== null && i !== only) return;
  const r = solve(lv);
  const ok = r.min !== null;
  let ways = 0; for (const k in r.found) ways += r.found[k];
  const tight = ok && lv.taps > 0 && ways < 4;
  if (!ok || tight) bad++;
  const counts = Object.keys(r.found).map((k) => `${k}:${r.found[k]}`).join(" ");
  console.log(`${String(i + 1).padStart(3)} taps=${lv.taps} min=${r.min ?? "NONE"} wins{${counts}} ex=[${(r.example[r.min] || []).map((s) => (s / 10).toFixed(1)).join(",")}] ${ok ? "" : "<-- UNSOLVABLE"}${tight ? " <-- FRAGILE" : ""}`);
});
process.exit(bad ? 1 : 0);
}
