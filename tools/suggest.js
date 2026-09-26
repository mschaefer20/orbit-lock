/* Goal suggestions: for a level, count how many tap sequences (0..3 taps on
   the 0.1 s grid, taps within the first 4 s / 2.5 s after the previous tap)
   pass through each 20 px cell, ignoring the current goal. Prints cells that
   are reachable with exactly k taps by a robust number of sequences and by
   none with fewer taps. Usage: node tools/suggest.js levelIndex [k] */
const P = require("../www/physics.js");
const LEVELS = require("../www/levels.js");
const CELL = 20, CW = P.W / CELL, CH = P.H / CELL;
const i = Number(process.argv[2]); const wantK = process.argv[3] ? Number(process.argv[3]) : null; const MARGIN = process.argv[4] ? Number(process.argv[4]) : 40;
const lv = Object.assign({}, LEVELS[i], { goal: { x: -9999, y: -9999, r: 1 }, taps: 3 });
const counts = [0, 1, 2, 3].map(() => new Uint16Array(CW * CH));
function run(tapSlots) {
  const s = P.make(lv); P.launch(s); const seen = new Uint8Array(CW * CH); let slot = 0, k = 0;
  while (s.status === "live") {
    if (k % P.STEPS_PER_SLOT === 0) { if (tapSlots.includes(slot)) P.flip(s, lv); slot++; }
    P.step(s, lv); k++;
    const cx = s.x / CELL | 0, cy = s.y / CELL | 0;
    if (cx >= 0 && cy >= 0 && cx < CW && cy < CH) seen[cy * CW + cx] = 1;
  }
  const c = counts[tapSlots.length]; for (let j = 0; j < seen.length; j++) if (seen[j]) c[j]++;
}
run([]);
for (let a = 0; a < 40; a++) { run([a]); for (let b = a + 1; b < a + 25; b++) { run([a, b]); for (let c = b + 1; c < b + 25; c += 2) run([a, b, c]); } }
const total = [1, 40, 40 * 24, 40 * 24 * 12];
function clear(cx, cy) { // cell centre must be off planets/walls with margin
  const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
  for (const p of lv.planets) if (Math.hypot(x - p.x, y - p.y) < p.r + MARGIN) return false;
  if (lv.walls) for (const w of lv.walls) if (x > w.x - 30 && x < w.x + w.w + 30 && y > w.y - 30 && y < w.y + w.h + 30) return false;
  return x > 30 && x < P.W - 30 && y > 30 && y < P.H - 30;
}
for (const k of (wantK !== null ? [wantK] : [1, 2, 3])) {
  const out = [];
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const j = cy * CW + cx; if (!clear(cx, cy)) continue;
    let fewer = 0; for (let m = 0; m < k; m++) fewer += counts[m][j];
    const n = counts[k][j];
    const frac = n / total[k];
    if (fewer === 0 && n >= 3 && frac < 0.35) out.push({ x: cx * CELL + 10, y: cy * CELL + 10, n, frac });
  }
  out.sort((a, b) => b.n - a.n);
  console.log(`level ${i + 1} k=${k}: ` + out.slice(0, 14).map((o) => `(${o.x},${o.y})x${o.n}`).join(" "));
}
