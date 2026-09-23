/* Reachability cloud: draws every 1-tap trajectory (tap at each 0.1 s slot,
   hue by slot) and, faintly, 2-tap ones, so goals can be placed on paths.
   Usage: node tools/cloud.js levelIndex   -> tools/out/cloud-NN.png */
const fs = require("fs"), path = require("path");
const P = require("../www/physics.js");
const LEVELS = require("../www/levels.js");
const { trajectory } = require("./render.js");
const zlib = require("zlib");
const W = P.W, H = P.H;
function png(w, h, rgb) { // duplicated tiny encoder
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let cc = -1; for (const x of b) cc = t[(cc ^ x) & 255] ^ (cc >>> 8); return (cc ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const b = Buffer.alloc(W * H * 3, 0);
function px(x, y, c, add) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; for (let k = 0; k < 3; k++) b[i + k] = add ? Math.min(255, b[i + k] + c[k]) : c[k]; }
function line(x0, y0, x1, y1, c, add) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c, add); }
function circle(cx, cy, r, c, fillIt) { for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) { const d = Math.hypot(x - cx, y - cy); if (fillIt ? d <= r : Math.abs(d - r) < 1) px(x, y, c); } }
function hue(h) { const f = (n) => { const k = (n + h * 6) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; }

const i = Number(process.argv[2]); const lv = LEVELS[i];
const SLOTS = 40; // first 4 s of tap opportunities
// 2-tap faint
for (let a = 0; a < SLOTS; a++) for (let bb = a + 1; bb < a + 25; bb++) {
  const tr = trajectory(lv, [a, bb]); const c = [22, 22, 22];
  for (let j = 1; j < tr.pts.length; j++) line(tr.pts[j - 1].x, tr.pts[j - 1].y, tr.pts[j].x, tr.pts[j].y, c, true);
}
// 1-tap bright, hue by slot
for (let a = 0; a < SLOTS; a++) {
  const tr = trajectory(lv, [a]); const c = hue(a / SLOTS * 0.8).map((v) => v * 0.9 | 0);
  for (let j = 1; j < tr.pts.length; j++) line(tr.pts[j - 1].x, tr.pts[j - 1].y, tr.pts[j].x, tr.pts[j].y, c, false);
  if (tr.tapPts[0]) circle(tr.tapPts[0].x, tr.tapPts[0].y, 3, [255, 255, 255], true);
}
if (lv.walls) for (const w of lv.walls) for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) px(x, y, [90, 96, 160]);
const COLS = [[255, 94, 126], [77, 210, 255], [180, 140, 255], [125, 255, 160]];
lv.planets.forEach((p, k) => circle(p.x, p.y, p.r, COLS[k % 4], true));
circle(lv.goal.x, lv.goal.y, lv.goal.r, [255, 216, 77], false);
circle(lv.start.x, lv.start.y, P.ORB_R, [255, 255, 255], false);
// grid every 100 px for coordinates
for (let x = 100; x < W; x += 100) for (let y = 0; y < H; y += 4) px(x, y, [50, 50, 60]);
for (let y = 100; y < H; y += 100) for (let x = 0; x < W; x += 4) px(x, y, [50, 50, 60]);
fs.writeFileSync(path.join(__dirname, "out", `cloud-${String(i + 1).padStart(2, "0")}.png`), png(W, H, b));
console.log("wrote cloud", i + 1);
