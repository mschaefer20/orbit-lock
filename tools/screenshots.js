/* App Store screenshots: poses the real game mid-flight (using the solver's
   tap sequence), adds a caption, and renders in headless Edge/Chrome at the
   exact pixel sizes App Store Connect wants: 6.3" 1206x2622 (the required
   "Dynamic Island (medium display)" row), 6.9" 1320x2868, 6.5" 1284x2778.
   Output: store/screenshots/<size>-<n>-<name>.png
   Usage: node tools/screenshots.js [path-to-browser]
   Headless Chromium won't go narrower than ~500 css px, so the page is laid
   out in a fixed phone-sized body and the capture is cropped (pure Node). */
const fs = require("fs"), path = require("path"), os = require("os"), zlib = require("zlib"), { execFileSync } = require("child_process");

const SHOTS = [   // name, query for the harness, caption (HTML)
  ["map", "done=12", "One button.<br><b>Every planet.</b>"],
  ["flip", "lvl=9&taps=7&t=1.3&done=12", "Tap to flip gravity.<br>Momentum does the rest."],
  ["wormhole", "lvl=145&taps=3,7&t=4.2&done=12", "500 levels.<br><b>All proven solvable.</b>"],
  ["bouncy", "lvl=305&taps=5,6,30&t=2.6&done=12", "Only the taps you need.<br>Not one more."],
  ["wrap", "lvl=403&taps=0,10,12&t=2.2&done=12", "New twists keep coming.<br><b>Warp. Bounce. Wrap.</b>"],
];
const SIZES = [["6.3", 402, 874], ["6.9", 440, 956], ["6.5", 428, 926]];   // css px; rendered at 3x -> 1206x2622, 1320x2868, 1284x2778
const DPR = 3;

const CANDIDATES = [process.argv[2], "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].filter(Boolean);
const browser = CANDIDATES.find((c) => fs.existsSync(c));
if (!browser) { console.error("no headless browser found; pass its path"); process.exit(1); }

// ---- scratch copy of www with the harness patched in ------------------------
const root = path.join(__dirname, ".."), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orbitlock-shots-"));
fs.cpSync(path.join(root, "www"), path.join(tmp, "www"), { recursive: true });
const gj = path.join(tmp, "www", "game.js");
const harness = `
  {
    const q = new URLSearchParams(location.search);
    if (q.get("lvl")) {
      loadLevel(+q.get("lvl") - 1); showScreen(null);
      const taps = (q.get("taps") || "").split(",").filter(Boolean).map(Number), tEnd = +(q.get("t") || 0);
      if (tEnd > 0) {
        P.launch(s); let k = 0, slot = 0, si = 0;
        while (s.status === "live" && s.t < tEnd) {
          if (k % P.STEPS_PER_SLOT === 0) { if (si < taps.length && taps[si] === slot) { P.flip(s, level); si++; } slot++; }
          P.step(s, level); k++; trail.push({ x: s.x, y: s.y, a: s.active });
        }
        renderPips(); setFooter();
      }
    } else showScreen("levels");
    const c = document.createElement("div"); c.className = "shot-cap"; c.innerHTML = q.get("cap") || ""; document.body.appendChild(c);
    for (const e of [document.body, document.documentElement]) e.classList.add("shot");
    document.documentElement.style.setProperty("--sw", q.get("sw") + "px"); document.documentElement.style.setProperty("--sh", q.get("sh") + "px");
  }
`;
const src = fs.readFileSync(gj, "utf8"), startup = /  loadLevel\(0\);\r?\n  showScreen\("levels"\);\r?\n/;
if (!startup.test(src)) throw new Error("game.js startup lines not found");
fs.writeFileSync(gj, src.replace(startup, "  loadLevel(0);\n" + harness));
const ih = path.join(tmp, "www", "index.html");
fs.writeFileSync(ih, fs.readFileSync(ih, "utf8").replace('<script src="physics.js"></script>', `<script>try{const q=new URLSearchParams(location.search);if(q.get("done"))localStorage.setItem("orbitlock.v1",JSON.stringify({done:Object.fromEntries(Array.from({length:+q.get("done")},(_,i)=>[i,1])),sound:1}));}catch(e){}</script>
<style>html.shot,body.shot{width:var(--sw)!important;height:var(--sh)!important;left:0!important;top:0!important}body.shot .footer-hint{visibility:hidden}body.shot #app{padding-top:150px}
.shot-cap{position:fixed;left:0;top:40px;width:var(--sw);text-align:center;font:800 29px/1.25 "Segoe UI",system-ui,sans-serif;letter-spacing:1px;color:#eef0ff;padding:0 28px;z-index:9}
.shot-cap b{background:linear-gradient(90deg,#ff5e7e,#4dd2ff);-webkit-background-clip:text;background-clip:text;color:transparent}</style>
<script src="physics.js"></script>`));

// ---- minimal PNG crop (8-bit RGB/RGBA, non-interlaced) ------------------------
function cropPng(buf, w, h) {
  let p = 8; const chunks = []; let ihdr, idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); if (type === "IHDR") ihdr = data; else if (type === "IDAT") idat.push(data); p += 12 + len; }
  const W = ihdr.readUInt32BE(0), H = ihdr.readUInt32BE(4), ct = ihdr[9], bpp = ct === 6 ? 4 : 3;
  if (ihdr[8] !== 8 || (ct !== 2 && ct !== 6) || ihdr[12] !== 0) throw new Error("unsupported png");
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = W * bpp, px = Buffer.alloc(H * stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], o = y * (stride + 1) + 1, out = y * stride, up = out - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[o + i], a = i >= bpp ? px[out + i - bpp] : 0, b = y ? px[up + i] : 0, c = y && i >= bpp ? px[up + i - bpp] : 0;
      px[out + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  const cw = Math.min(w, W), chh = Math.min(h, H), rows = Buffer.alloc((cw * bpp + 1) * chh);
  for (let y = 0; y < chh; y++) { rows[y * (cw * bpp + 1)] = 0; px.copy(rows, y * (cw * bpp + 1) + 1, y * stride, y * stride + cw * bpp); }
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  const crc = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const nh = Buffer.from(ihdr); nh.writeUInt32BE(cw, 0); nh.writeUInt32BE(chh, 4);
  return Buffer.concat([buf.subarray(0, 8), chunk("IHDR", nh), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- render ---------------------------------------------------------------------
const outDir = path.join(root, "store", "screenshots"); fs.mkdirSync(outDir, { recursive: true });
const page = "file:///" + ih.replace(/\\/g, "/");
SHOTS.forEach(([name, q, cap], n) => {
  for (const [tag, w, h] of SIZES) {
    const out = path.join(outDir, `${tag}-${n + 1}-${name}.png`);
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=" + DPR, "--window-size=700," + h,
      "--virtual-time-budget=2500", "--screenshot=" + out, `${page}?${q}&cap=${encodeURIComponent(cap)}&sw=${w}&sh=${h}`], { stdio: "ignore" });
    fs.writeFileSync(out, cropPng(fs.readFileSync(out), w * DPR, h * DPR));
    console.log("wrote", path.relative(root, out), `${w * DPR}x${h * DPR}`);
  }
});
fs.rmSync(tmp, { recursive: true, force: true });
