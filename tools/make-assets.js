/* Renders resources/icon.png (1024) and resources/splash.png + splash-dark.png
   (2732) from tools/icon.html for `npx capacitor-assets generate --ios`.
   The scene is drawn with the game's own canvas look, so it needs a browser:
   headless Edge or Chrome, found on PATH or in the usual Windows/macOS spots.
   Usage: node tools/make-assets.js [path-to-browser] */
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");

const CANDIDATES = [
  process.argv[2],
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "google-chrome", "chromium", "msedge",
].filter(Boolean);
const browser = CANDIDATES.find((c) => { try { return c.includes("/") ? fs.existsSync(c) : (execFileSync("which", [c]), true); } catch (e) { return false; } });
if (!browser) { console.error("no headless browser found; pass its path: node tools/make-assets.js /path/to/chrome"); process.exit(1); }

const dir = path.join(__dirname, "..", "resources");
fs.mkdirSync(dir, { recursive: true });
const page = "file:///" + path.join(__dirname, "icon.html").replace(/\\/g, "/");
function shot(out, size, query) {
  execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=" + size + "," + size,
    "--screenshot=" + out, page + "?size=" + size + query], { stdio: "ignore" });
  console.log("wrote", path.relative(process.cwd(), out));
}
// App Store creative asset (optional): one 16:9 PNG Connect accepts for both the
// product-page header (cropped to 21:9) and the search-results card (3:2).
const creative = path.join(__dirname, "..", "store", "creative"); fs.mkdirSync(creative, { recursive: true });
const hpage = "file:///" + path.join(__dirname, "header.html").replace(/\\/g, "/");
execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=5244,2950",
  "--screenshot=" + path.join(creative, "header-16x9.png"), hpage + "?w=5244&h=2950"], { stdio: "ignore" });
console.log("wrote store/creative/header-16x9.png 5244x2950");
shot(path.join(dir, "icon.png"), 1024, "&shrink=0.88");
shot(path.join(dir, "splash.png"), 2732, "&inner=1100");
fs.copyFileSync(path.join(dir, "splash.png"), path.join(dir, "splash-dark.png"));
console.log("wrote resources/splash-dark.png");
