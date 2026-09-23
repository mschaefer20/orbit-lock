/* Generates resources/icon.png (1024) and resources/splash.png + splash-dark.png
   (2732) for `npx capacitor-assets generate --ios`. Pure Node: draws the goal
   ring with the orb swinging into it, supersampled 3x for smooth edges.
   Usage: node tools/make-assets.js */
const fs = require("fs"), path = require("path"), zlib = require("zlib");

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  const crc = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Scene in unit coordinates (0..1), rendered at any size.
function scene(size) {
  const SS = 3, S = size * SS;
  const buf = new Float32Array(S * S * 3);
  const bg = [5, 6, 15];
  for (let i = 0; i < S * S; i++) { buf[i * 3] = bg[0]; buf[i * 3 + 1] = bg[1]; buf[i * 3 + 2] = bg[2]; }
  const blend = (x, y, c, a) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 3; for (let k = 0; k < 3; k++) buf[i + k] += (c[k] - buf[i + k]) * a; };
  const disc = (cx, cy, r, c, a = 1) => { cx *= S; cy *= S; r *= S; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r) blend(x | 0, y | 0, c, a); };
  const glow = (cx, cy, r, c, a) => { cx *= S; cy *= S; r *= S; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const d = Math.hypot(x - cx, y - cy) / r; if (d < 1) blend(x | 0, y | 0, c, a * (1 - d) * (1 - d)); } };
  const ring = (cx, cy, r, w, c, a = 1) => { cx *= S; cy *= S; r *= S; w *= S; for (let y = cy - r - w; y <= cy + r + w; y++) for (let x = cx - r - w; x <= cx + r + w; x++) if (Math.abs(Math.hypot(x - cx, y - cy) - r) <= w / 2) blend(x | 0, y | 0, c, a); };
  const arc = (cx, cy, r, a0, a1, w, c) => { const n = S; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; const k = i / n; disc(cx + Math.cos(t) * r, cy + Math.sin(t) * r, w * (0.4 + 0.6 * k), c, 0.85 * k + 0.1); } };

  const PINK = [255, 94, 126], CYAN = [77, 210, 255], GOLD = [255, 216, 77];
  // two planets: pink lower-left (idle), cyan upper-right (active, brighter)
  glow(0.22, 0.74, 0.24, PINK, 0.35); disc(0.22, 0.74, 0.11, PINK, 0.55);
  glow(0.76, 0.28, 0.30, CYAN, 0.6); disc(0.76, 0.28, 0.13, CYAN, 0.95);
  // goal ring, centre-right-low
  glow(0.64, 0.68, 0.22, GOLD, 0.35);
  ring(0.64, 0.68, 0.12, 0.022, GOLD);
  // orb trail: leaves the pink planet, swings up and over, drops into the ring
  arc(0.47, 0.72, 0.1746, Math.PI * 0.9, Math.PI * 2 - 0.231, 0.012, CYAN);
  // orb sitting in the ring
  glow(0.64, 0.68, 0.10, CYAN, 0.7); disc(0.64, 0.68, 0.042, CYAN);

  // downsample
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let k = 0; k < 3; k++) {
    let sum = 0; for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += buf[((y * SS + dy) * S + x * SS + dx) * 3 + k];
    out[(y * size + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(sum / (SS * SS))));
  }
  return out;
}

// Splash: same scene, but small and centred on a big dark canvas.
function splash(size, inner) {
  const sc = scene(inner);
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { out[i * 3] = 5; out[i * 3 + 1] = 6; out[i * 3 + 2] = 15; }
  const off = (size - inner) / 2 | 0;
  for (let y = 0; y < inner; y++) sc.copy(out, ((off + y) * size + off) * 3, y * inner * 3, (y + 1) * inner * 3);
  return out;
}

const dir = path.join(__dirname, "..", "resources");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon.png"), png(1024, 1024, scene(1024)));
const sp = png(2732, 2732, splash(2732, 900));
fs.writeFileSync(path.join(dir, "splash.png"), sp);
fs.writeFileSync(path.join(dir, "splash-dark.png"), sp);
console.log("wrote resources/icon.png, splash.png, splash-dark.png");
