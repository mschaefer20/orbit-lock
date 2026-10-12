/* Renders each level + the solver's min-tap trajectory to tools/out/NN.png
   (pure Node, no deps), plus contact sheets of 20 (one per chapter):
   tools/out/sheet-101-120.png. The grey line is the no-tap path.
   Usage: node tools/render.js [from] [to] [--file levels.js|candidates.json]
   (from/to are 1-based level numbers; default: every level) */
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const P = require("../www/physics.js");
const argv = process.argv.slice(2), fi = argv.indexOf("--file");
const FILE = fi >= 0 ? path.resolve(argv.splice(fi, 2)[1]) : path.join(__dirname, "..", "www", "levels.js");
const LEVELS = FILE.endsWith(".json") ? JSON.parse(fs.readFileSync(FILE, "utf8")) : require(FILE);
const TAG = FILE.endsWith(".json") ? path.basename(FILE, ".json") + "-" : "";   // candidates: 120-1.png ...
const W = P.W, H = P.H;

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let cc = -1; for (const x of b) cc = t[(cc ^ x) & 255] ^ (cc >>> 8); return (cc ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
class Img {
  constructor() { this.b = Buffer.alloc(W * H * 3); this.fill([8, 9, 22]); }
  fill(c) { for (let i = 0; i < W * H; i++) { this.b[i * 3] = c[0]; this.b[i * 3 + 1] = c[1]; this.b[i * 3 + 2] = c[2]; } }
  px(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; this.b[i] = c[0]; this.b[i + 1] = c[1]; this.b[i + 2] = c[2]; }
  circle(cx, cy, r, c, fillIt) { for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) { const d = Math.hypot(x - cx, y - cy); if (fillIt ? d <= r : Math.abs(d - r) < 1) this.px(x, y, c); } }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c); }
  line(x0, y0, x1, y1, c) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) this.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); }
}
const COLS = [[255, 94, 126], [77, 210, 255], [180, 140, 255], [125, 255, 160]];

function trajectory(level, tapSlots) {
  const s = P.make(level); P.launch(s); const pts = [{ x: s.x, y: s.y, a: s.active }]; const tapPts = [];
  let slot = 0, k = 0;
  while (s.status === "live") {
    if (k % P.STEPS_PER_SLOT === 0) { if (tapSlots.includes(slot)) { P.flip(s, level); tapPts.push({ x: s.x, y: s.y }); } slot++; }
    P.step(s, level); pts.push({ x: s.x, y: s.y, a: s.active }); k++;
  }
  return { pts, tapPts, status: s.status, why: s.why, t: s.t };
}

function render(level, i, tapSlots) {
  const im = new Img();
  if (level.walls) for (const w of level.walls) {
    if (w.bounce) { im.rect(w.x, w.y, w.w, w.h, [70, 200, 150]); continue; }
    if (!w.blink) { im.rect(w.x, w.y, w.w, w.h, [70, 76, 130]); continue; }
    const c = [230, 140, 60];   // pulsar wall: outline only
    im.line(w.x, w.y, w.x + w.w, w.y, c); im.line(w.x, w.y + w.h, w.x + w.w, w.y + w.h, c);
    im.line(w.x, w.y, w.x, w.y + w.h, c); im.line(w.x + w.w, w.y, w.x + w.w, w.y + w.h, c);
  }
  if (level.wrap) for (let i = 0; i < H; i += 8) {   // dotted border = edges wrap
    if (i < W) { im.px(i, 0, [120, 200, 255]); im.px(i, H - 1, [120, 200, 255]); }
    im.px(0, i, [120, 200, 255]); im.px(W - 1, i, [120, 200, 255]);
  }
  if (level.holes) for (const h of level.holes) for (const e of [h.a, h.b]) { im.circle(e.x, e.y, h.r, [255, 120, 255], false); im.circle(e.x, e.y, h.r - 5, [255, 120, 255], false); }
  level.planets.forEach((p, k) => {
    im.circle(p.x, p.y, p.r, COLS[k % 4], true); im.circle(p.x, p.y, p.r + P.ORB_R, [40, 44, 80], false);
    if (p.g > 1) for (const d of [10, 18]) im.circle(p.x, p.y, p.r + d, COLS[k % 4].map((v) => v * 0.6 | 0), false);   // heavy: halo rings
    if (p.g > 0 && p.g < 1) im.circle(p.x, p.y, p.r * 0.45, [8, 9, 22], true);                                      // light: hollow core
    if (p.g < 0) for (let a = 0; a < 8; a++) { const c = Math.cos(a * Math.PI / 4), d = Math.sin(a * Math.PI / 4); im.line(p.x + c * (p.r + 3), p.y + d * (p.r + 3), p.x + c * (p.r + 12), p.y + d * (p.r + 12), COLS[k % 4]); }   // repulsor: spikes
    if (p.move) im.line(p.x - p.move.ax, p.y - p.move.ay, p.x + p.move.ax, p.y + p.move.ay, [200, 200, 200]);
  });
  if (level.moons) for (const m of level.moons) { im.circle(m.x, m.y, m.r, [150, 150, 165], true); im.circle(m.x, m.y, m.r + P.ORB_R, [40, 44, 80], false); }
  if (level.gates) level.gates.forEach((g, n) => {
    im.circle(g.x, g.y, g.r, [230, 230, 255], false);
    if (level.ordered) for (let d = 0; d <= n; d++) im.circle(g.x - 5 * n + 10 * d, g.y, 2, [230, 230, 255], true);   // order as dots
  });
  if (level.goal.move) { const g = level.goal; im.line(g.x - g.move.ax, g.y - g.move.ay, g.x + g.move.ax, g.y + g.move.ay, [255, 216, 77]); }
  im.circle(level.goal.x, level.goal.y, level.goal.r, [255, 216, 77], false);
  im.circle(level.goal.x, level.goal.y, level.goal.r - 2, [255, 216, 77], false);
  // no-tap path (grey) for reference
  const base = trajectory(level, []);
  const jump = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 60;   // wormhole / wrap: don't draw across
  for (let j = 1; j < base.pts.length; j++) if (!jump(base.pts[j - 1], base.pts[j])) im.line(base.pts[j - 1].x, base.pts[j - 1].y, base.pts[j].x, base.pts[j].y, [60, 60, 70]);
  const tr = trajectory(level, tapSlots);
  for (let j = 1; j < tr.pts.length; j++) if (!jump(tr.pts[j - 1], tr.pts[j])) im.line(tr.pts[j - 1].x, tr.pts[j - 1].y, tr.pts[j].x, tr.pts[j].y, COLS[tr.pts[j].a % 4].map((v) => v * 0.85 | 0));
  for (const t of tr.tapPts) im.circle(t.x, t.y, 5, [255, 255, 255], true);
  im.circle(level.start.x, level.start.y, P.ORB_R, [255, 255, 255], false);
  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "out", TAG + String(i + 1).padStart(2, "0") + ".png"), png(W, H, im.b));
  tr.img = im;
  return tr;
}
module.exports = { render, trajectory };
if (require.main === module) {
  const { solve } = require("./solve.js");
  const from = argv[0] !== undefined ? Number(argv[0]) : 1, to = argv[1] !== undefined ? Number(argv[1]) : argv[0] !== undefined ? from : LEVELS.length;
  const imgs = [];
  LEVELS.forEach((lv, i) => {
    if (i + 1 < from || i + 1 > to) return;
    const r = solve(lv);
    const ex = r.min !== null ? r.example[r.min] : [];
    const tr = render(lv, i, ex);
    imgs.push({ img: tr.img, n: i + 1 });
    console.log(`${i + 1}: min=${r.min} ${tr.status} ${tr.why} t=${tr.t.toFixed(1)}`);
  });
  // contact sheets: one per chapter (20 levels, 4 x 5), half scale, in level order
  const cols = 4, cw = W / 2, ch = H / 2, pages = {};
  for (const it of imgs) { const key = TAG ? "all" : Math.ceil(it.n / 20); (pages[key] = pages[key] || []).push(it); }
  for (const key in pages) {
    const page = pages[key], rows = Math.ceil(page.length / cols);
    const sheet = Buffer.alloc(cols * cw * rows * ch * 3);
    page.forEach(({ img: im }, k) => {
      const ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const si = ((y * 2) * W + x * 2) * 3, di = ((oy + y) * cols * cw + ox + x) * 3;
        for (let c = 0; c < 3; c++) sheet[di + c] = Math.max(im.b[si + c], im.b[si + 3 + c], im.b[si + W * 3 + c], im.b[si + W * 3 + 3 + c]);
      }
    });
    const name = TAG ? `sheet-${TAG}candidates.png` : `sheet-${key * 20 - 19}-${key * 20}.png`;
    fs.writeFileSync(path.join(__dirname, "out", name), png(cols * cw, rows * ch, sheet));
    console.log("sheet: tools/out/" + name);
  }
}
