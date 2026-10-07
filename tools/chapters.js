/* What the generator builds in each slot.

   Levels come in 20-level chapters (chapter n = slots 20n-19 .. 20n), one
   per landmark on the map. Targets: most players stop around 200, a few
   reach 500.
   - Chapters 1-5 (1-100) shipped in v1.0; their original block profiles are
     kept so single slots can still be rerolled the same way.
   - Chapters 6-10 (101-200) each introduce one mechanic.
   - Chapters 11-25 (201-500) remix what the player has seen, harder, with
     two surprise mechanics at 301 and 401.

   Inside a chapter, difficulty climbs then resets (a wave): easy opener,
   a breather in the middle, a best-of-N finale on the landmark slot. */

// Mechanics the generator can mix in. ready = physics + rendering exist.
const INGREDIENTS = {
  walls:     { ready: true },
  orbit:     { ready: true },   // start in orbit around a planet
  gates:     { ready: true },   // checkpoint rings
  movers:    { ready: true },   // drifting planets
  giants:    { ready: false },  // per-planet pull strength (heavy / light)
  moons:     { ready: false },  // inert planets, never in the tap order
  repulsors: { ready: false },
  wormholes: { ready: false },
  pulsars:   { ready: false },  // walls / planets that blink on a rhythm
  ordered:   { ready: false },  // numbered gates, passed in order
  driftgoal: { ready: false },
  bouncy:    { ready: false },  // walls that reflect instead of kill
  wrap:      { ready: false },  // screen edges wrap around
};
const BASE = ["walls", "orbit", "gates", "movers"];

// Chapter -> the mechanic it introduces (chapters not listed are remixes).
const INTRO = { 6: ["giants", "moons"], 7: ["repulsors"], 8: ["wormholes"], 9: ["pulsars"], 10: ["ordered", "driftgoal"], 16: ["bouncy"], 21: ["wrap"] };
const SUMMITS = new Set([10, 25]);   // levels 200 and 500: the hardest finales
const LAST_CHAPTER = 25;

const chapterOf = (slot) => Math.ceil(slot / 20);
function known(ch) {   // every mechanic introduced up to and including chapter ch
  const out = BASE.slice();
  for (let c = 6; c <= ch; c++) if (INTRO[c]) out.push(...INTRO[c]);
  return out;
}
function seeded(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The ingredient mix for a chapter: intro chapters feature their new mechanic
// plus a little of the basics; remix chapters draw 2-3 known mechanics, never
// the same set as the chapter before.
const mixCache = {};
function mixFor(ch) {
  if (mixCache[ch]) return mixCache[ch];
  let mix;
  if (INTRO[ch]) mix = { feature: INTRO[ch], extra: ["walls", "orbit"] };
  else {
    const pool = known(ch).filter((k) => !BASE.includes(k) || k === "gates" || k === "movers");
    const prev = ch > 11 ? mixFor(ch - 1).feature.slice().sort().join() : "";
    const r = seeded(ch * 31337);
    for (let tries = 0; ; tries++) {
      const pick = pool.slice().sort(() => r() - 0.5).slice(0, 2 + (r() < 0.4 ? 1 : 0));
      if (pick.slice().sort().join() !== prev || tries > 20) { mix = { feature: pick, extra: ["walls", "orbit"] }; break; }
    }
  }
  return (mixCache[ch] = mix);
}

// v1.0 block profiles for slots 17-100 (unchanged; used only for rerolls).
function legacyProfile(slot) {
  const b = slot <= 40 ? 0 : Math.floor((slot - 41) / 30) + 1;
  const [lo, hi] = b === 0 ? [17, 40] : [41 + (b - 1) * 30, 70 + (b - 1) * 30];
  const u = (slot - lo) / (hi - lo);
  if (b === 0) return { planets: [2, u < 0.5 ? 3 : 4], walls: u < 0.3 ? 0 : 1, orbit: 0.35, gates: 0, movers: 0,
    taps: [1, u < 0.4 ? 2 : 3], ways: [10 + Math.round(20 * (1 - u)), 90] };
  if (b === 1) return { planets: [2, 4], walls: u < 0.5 ? 1 : 2, orbit: 0.45, gates: u < 0.15 ? 0 : (u < 0.7 ? 1 : 2), movers: 0,
    taps: [u < 0.3 ? 1 : 2, 3], ways: [6 + Math.round(8 * (1 - u)), 45] };
  return { planets: [3, 5], walls: 2, orbit: 0.5, gates: u < 0.5 ? 1 : 2, movers: u < 0.2 ? 1 : 2,
    taps: [2, Math.min(4, 3 + (u > 0.6 ? 1 : 0))], ways: [5, 28] };
}

// Full profile for a slot: layout knobs, tap window, and quality gates.
function profile(slot) {
  const ch = chapterOf(slot);
  if (ch <= 5) return Object.assign(legacyProfile(slot), { chapter: ch, legacy: true, need: [] });
  const k = (slot - 1) % 20, u = k / 19;             // position in the chapter
  const late = ch > 10;                               // 201-500: the dedicated few
  const finale = k === 19, breather = k === 9;
  const mix = mixFor(ch), use = new Set([...mix.feature, ...mix.extra]);
  // tap window: the wave
  let taps;
  // exact 5-tap levels are rare (most cells are reachable with fewer), so 5 is a stretch goal
  if (finale) taps = SUMMITS.has(ch) || late ? [4, 5] : [3, 4];
  else if (breather) taps = [2, 2];
  else if (!late) taps = k < 5 ? [2, 2] : k < 12 ? [2, 3] : [3, 3];
  else taps = k < 4 ? [2, 3] : k < 12 ? [3, 3] : [3, 4];
  const ramp = (a, b) => Math.round(a + (b - a) * u);
  return {
    chapter: ch, slot, finale, breather, feature: mix.feature,
    need: [...use].filter((x) => !INGREDIENTS[x].ready),   // mechanics this slot wants that don't exist yet
    planets: [2, late ? 5 : ramp(3, 5)],
    walls: use.has("walls") ? ramp(0, 2) : 0,
    orbit: use.has("orbit") ? 0.45 : 0,
    gates: use.has("gates") ? (u < 0.3 ? 0 : u < 0.7 ? 1 : 2) : 0,
    movers: use.has("movers") ? (u < 0.4 ? 1 : 2) : 0,
    taps,
    ways: finale ? [5, 150] : [breather ? 20 : Math.max(late ? 4 : 6, ramp(late ? 12 : 20, late ? 4 : 6)), breather ? 400 : 150],
    // quality gates, calibrated against v1.0's levels (node tools/quality.js)
    gate: { ways: null, slack: late ? 0.3 : (u < 0.5 ? 0.5 : 0.34), t: [1.5, 10], ratio: 1.2, turn: 0.4 },
    candidates: finale ? 8 : 1,
  };
}

module.exports = { INGREDIENTS, INTRO, LAST_CHAPTER, chapterOf, known, mixFor, profile };

if (require.main === module) {   // print the plan: node tools/chapters.js
  for (let ch = 6; ch <= LAST_CHAPTER; ch++) {
    const p0 = profile(ch * 20 - 19), pf = profile(ch * 20);
    const need = [...new Set([...p0.need, ...pf.need])];
    console.log(`ch ${String(ch).padStart(2)}  ${String(ch * 20 - 19).padStart(3)}-${ch * 20}  ${INTRO[ch] ? "NEW " : "mix "} ${p0.feature.join("+").padEnd(28)} taps ${p0.taps.join("-")} .. finale ${pf.taps.join("-")}${need.length ? "   needs: " + need.join(", ") : ""}`);
  }
}
