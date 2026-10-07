/* Orbit Lock — game shell: screens, input, rendering. Physics lives in
   physics.js (shared with tools/solve.js so every level is proven). */
(() => {
  "use strict";
  const P = window.OrbitPhysics;
  const W = P.W, H = P.H;
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const COLS = ["#ff5e7e", "#4dd2ff", "#b48cff", "#7dffa0"];
  const GOLD = "#ffd84d";
  const SAVE_KEY = "orbitlock.v1";

  // ---- persistence -------------------------------------------------------
  // save.done[i] = 1 once level i is cleared (early saves kept stars; any star counts)
  let save = { done: {} };
  try { save = Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || "{}")); } catch (_) {}
  if (save.stars) { for (const k in save.stars) if (save.stars[k]) save.done[k] = 1; delete save.stars; persist(); }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {} }
  // Dev mode unlocks every level. Toggle: tap the map logo 7 times quickly
  // (persists), or add ?all to the URL (this visit only).
  const DEV_KEY = "orbitlock.dev";
  let devMode = false;
  try { devMode = localStorage.getItem(DEV_KEY) === "1"; } catch (_) {}
  let unlockAll = devMode || /[?&]all([=&]|$)/.test(location.search);
  function unlocked(i) { return unlockAll || i === 0 || !!save.done[i - 1]; }

  // ---- HiDPI ---------------------------------------------------------------
  function setupHiDPI() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupHiDPI();
  window.addEventListener("resize", () => { setupHiDPI(); if (current === "levels") syncMap(); });

  // ---- audio (tiny procedural) -------------------------------------------
  let ac = null;
  function audio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
    if (ac && ac.state === "suspended") ac.resume();
    return ac;
  }
  function tone(f, dur, type, vol, when = 0, slide = 0) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, a.currentTime + when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), a.currentTime + when + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime + when);
    g.gain.exponentialRampToValueAtTime(vol, a.currentTime + when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
    o.connect(g).connect(a.destination); o.start(a.currentTime + when); o.stop(a.currentTime + when + dur + 0.02);
  }
  const sfx = {
    launch() { tone(220, 0.25, "sine", 0.18, 0, 260); },
    flip(i) { tone(440 + i * 110, 0.09, "triangle", 0.16); },
    win() { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.22, "sine", 0.16, k * 0.09)); },
    lost() { tone(140, 0.35, "sawtooth", 0.14, 0, -90); },
  };
  // Haptics: Capacitor plugin inside the iOS shell, navigator.vibrate on the web.
  const CAP = window.Capacitor && window.Capacitor.Plugins;
  function buzz(ms) {
    try {
      if (CAP && CAP.Haptics) {
        const strong = Array.isArray(ms) || ms >= 40;
        CAP.Haptics.impact({ style: strong ? "medium" : "light" });
      } else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (_) {}
  }
  if (CAP && CAP.StatusBar) { try { CAP.StatusBar.hide(); } catch (_) {} }

  // ---- state ---------------------------------------------------------------
  let levelIndex = 0, level = LEVELS[0];
  let s = P.make(level);
  let trail = [], ghost = [];
  let acc = 0, last = 0, clock = 0;
  let lostAt = 0, wonAt = 0, winShown = false;
  let flash = 0;
  let playing = false;         // canvas accepts taps

  const stars = [];
  {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) stars.push({ x: rnd() * W, y: rnd() * H, r: 0.4 + rnd() * 1.2, a: 0.25 + rnd() * 0.6, p: rnd() * 6.28 });
  }

  // ---- DOM -----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const screens = ["howto", "levels", "win"].reduce((m, k) => (m[k] = $("screen-" + k), m), {});
  const hudLevel = $("hud-level"), pipsEl = $("pips"), footer = $("footer-hint");
  let current = "levels", returnTo = "levels";
  function showScreen(name) {
    if (name === "howto" && current !== "howto") returnTo = current;
    current = name;
    for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
    playing = !name;
    $("app").classList.toggle("on-map", name === "levels");
    if (name === "levels") buildLevelGrid();
  }
  // ---- journey map: one winding road, level 1 at the bottom, climbing up ----
  // Built one chapter (20 levels) at a time, and only the chapters near the
  // viewport are in the DOM, so the road can run to thousands of levels.
  // Each chapter is its own SVG in global map coordinates (overflow visible);
  // chapters sit in ascending order so the next chapter's nodes cover the
  // road segment that leads into them. The far sky is one wrapping tile.
  const J = { w: 360, step: 84, pad: 70, top: 170, amp: 92, chap: 20, total: 1, h: 1, tile: 1400 };
  const svgNS = "http://www.w3.org/2000/svg";
  const map = { chunks: new Map(), frontier: 0, firstGate: -1, firstMover: -1, road: null, far: null };
  function nodePos(i) {
    return { x: J.w / 2 + Math.sin(i * 0.62) * J.amp, y: J.top + (J.total - 1 - i) * J.step };
  }
  function roadPath(from, to) {
    // smooth curve through the nodes from..to (inclusive), as an SVG path
    let d = "";
    for (let i = from; i <= to; i++) {
      const p = nodePos(i);
      if (i === from) { d += "M" + p.x + " " + p.y; continue; }
      const q = nodePos(i - 1), my = (p.y + q.y) / 2;
      d += " C" + q.x + " " + my + " " + p.x + " " + my + " " + p.x + " " + p.y;
    }
    return d;
  }
  function frontierIndex() { let f = 0; while (f < LEVELS.length - 1 && save.done[f]) f++; return f; }
  function bandTint(b) { return TINTS[b % TINTS.length]; }
  function svgRoot(viewBox) {
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", viewBox);
    const el = (tag, attrs, parent) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
    const defs = el("defs", {});
    return { svg, el, defs };
  }
  const scaleOf = (host) => host.clientWidth / J.w;

  function buildLevelGrid() {
    const host = $("journey"); host.innerHTML = "";
    J.total = LEVELS.length; J.h = J.top + J.pad + (J.total - 1) * J.step;
    map.frontier = frontierIndex();
    map.firstGate = LEVELS.findIndex((l) => l.gates && l.gates.length);
    map.firstMover = LEVELS.findIndex((l) => l.planets.some((q) => q.move));
    map.chunks.clear();
    map.road = document.createElement("div"); map.road.className = "journey-road";
    map.road.style.aspectRatio = J.w + " / " + J.h;
    host.appendChild(map.road);
    if (!map.far) buildFar();
    host.onscroll = syncMap;
    host.scrollTop = Math.max(0, nodePos(map.frontier).y * scaleOf(host) - host.clientHeight * 0.58);
    syncMap();
    let n = 0; for (const k in save.done) if (save.done[k]) n++;
    $("map-count").textContent = unlockAll ? "DEV · " + n : n + " / " + J.total;
  }

  // Keep the chapters around the viewport built, drop the rest; move the sky.
  function syncMap() {
    const host = $("journey"), sc = scaleOf(host); if (!sc || !map.road) return;
    const last = Math.ceil(J.total / J.chap) - 1;
    const levelAt = (y) => Math.max(0, Math.min(J.total - 1, Math.round(J.total - 1 - (y - J.top) / J.step)));
    const yTop = host.scrollTop / sc, yBot = (host.scrollTop + host.clientHeight) / sc;
    const cLo = Math.max(0, Math.floor(levelAt(yBot) / J.chap) - 1), cHi = Math.min(last, Math.floor(levelAt(yTop) / J.chap) + 1);
    for (const [c, svg] of map.chunks) if (c < cLo - 1 || c > cHi + 1) { svg.remove(); map.chunks.delete(c); }
    for (let c = cLo; c <= cHi; c++) {
      if (map.chunks.has(c)) continue;
      const svg = buildChapter(c); map.chunks.set(c, svg);
      let next = null; for (const [k, v] of map.chunks) if (k > c && (!next || k < next.k)) next = { k, v };
      map.road.insertBefore(svg, next ? next.v : null);
    }
    // the far sky moves at 0.65x the road's speed, wrapping every tile
    const o = ((yTop * 0.65) % J.tile + J.tile) % J.tile;
    map.far.style.transform = "translateY(" + (-o * sc).toFixed(1) + "px)";
    $("screen-levels").style.backgroundColor = bandTint(Math.floor(levelAt((yTop + yBot) / 2) / J.chap)).bg;
  }

  // The far sky: nebulae, dim stars and constellations on one tile, drawn twice.
  function buildFar() {
    const { svg, el, defs } = svgRoot("0 0 " + J.w + " " + J.tile * 2);
    let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const items = [];
    for (let k = 0; k < 4; k++) {
      const g = el("radialGradient", { id: "far" + k }, defs), col = TINTS[(k * 2 + 1) % TINTS.length].star;
      el("stop", { offset: "0%", "stop-color": col, "stop-opacity": 0.11 }, g); el("stop", { offset: "100%", "stop-color": col, "stop-opacity": 0 }, g);
      const cx = k % 2 ? J.w * 0.78 : J.w * 0.22, cy = (k + 0.5) * J.tile / 4;
      items.push(["ellipse", { cx, cy, rx: 150 + ri(0, 80), ry: 260 + ri(0, 160), fill: "url(#far" + k + ")", transform: "rotate(" + ri(-30, 30) + " " + cx + " " + cy + ")" }]);
    }
    for (let i = 0; i < 170; i++) items.push(["circle", { cx: rnd() * J.w, cy: rnd() * J.tile, r: 0.4 + rnd() * 0.8, fill: TINTS[i % TINTS.length].star, opacity: 0.12 + rnd() * 0.3 }]);
    for (let c = 0; c < 4; c++) {   // constellations: a few stars joined by faint lines
      const cx = J.w / 2 + (c % 2 ? -1 : 1) * (J.w * 0.28 + ri(-20, 20)), cy = (c + 0.5) * J.tile / 4 + ri(-40, 40);
      const pts = []; const n = ri(4, 6);
      for (let k = 0; k < n; k++) pts.push({ x: cx + ri(-46, 46), y: cy + ri(-60, 60) });
      items.push(["path", { d: pts.map((p, k) => (k ? "L" : "M") + p.x + " " + p.y).join(" "), fill: "none", stroke: "#eef0ff", "stroke-width": 0.8, opacity: 0.16 }]);
      pts.forEach((p) => items.push(["circle", { cx: p.x, cy: p.y, r: 1.4 + rnd(), fill: "#eef0ff", opacity: 0.6 }]));
    }
    for (let copy = 0; copy < 2; copy++) {
      const g = el("g", { transform: "translate(0 " + copy * J.tile + ")" });
      for (const [tag, attrs] of items) el(tag, attrs, g);
    }
    $("journey-far").appendChild(svg); map.far = svg;
  }

  // One chapter: scenery, landmark, road and nodes for levels lo..hi.
  function buildChapter(c) {
    const total = J.total, lo = c * J.chap, hi = Math.min(total - 1, lo + J.chap - 1), lastChap = hi === total - 1;
    const y0 = lastChap ? 0 : nodePos(hi).y - J.step / 2, y1 = c === 0 ? J.h : nodePos(lo).y + J.step / 2;
    const { svg, el, defs } = svgRoot("0 " + y0 + " " + J.w + " " + (y1 - y0));
    svg.setAttribute("overflow", "visible");
    svg.style.top = (y0 / J.h * 100) + "%"; svg.style.height = ((y1 - y0) / J.h * 100) + "%";
    const frontier = map.frontier;
    let seed = 99 + c * 7919; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const reached = (i) => unlockAll || i <= frontier;
    let uid = 0; const gid = () => "c" + c + "g" + (uid++);
    const radial = (col, stops) => { const g = el("radialGradient", { id: gid() }, defs); stops.forEach(([o, op]) => el("stop", { offset: o, "stop-color": col, "stop-opacity": op }, g)); return "url(#" + g.id + ")"; };
    const tint = bandTint(c);

    // ---- near stars: some twinkle; a shooting star on a long loop -------------
    for (let k = 0; k < J.chap * 2; k++) {
      const st = el("circle", { cx: rnd() * J.w, cy: y0 + rnd() * (y1 - y0), r: 0.6 + rnd() * 1.2, fill: tint.star, opacity: 0.25 + rnd() * 0.5 });
      if (k % 5 === 0) el("animate", { attributeName: "opacity", values: "0.2;0.9;0.2", dur: (2 + rnd() * 4).toFixed(1) + "s", begin: (rnd() * 4).toFixed(1) + "s", repeatCount: "indefinite" }, st);
    }
    {
      const y = y0 + 100 + rnd() * Math.max(0, y1 - y0 - 200), len = 70;
      const g = el("g", { opacity: 0 });
      el("line", { x1: 0, y1: 0, x2: -len, y2: len * 0.35, stroke: "#eef0ff", "stroke-width": 1.5, "stroke-linecap": "round", opacity: 0.8 }, g);
      el("circle", { r: 1.8, fill: "#fff" }, g);
      const dur = (12 + rnd() * 18).toFixed(1) + "s", begin = (rnd() * 20).toFixed(1) + "s";
      el("animateTransform", { attributeName: "transform", type: "translate", from: "-60 " + y, to: (J.w + 80) + " " + (y - (J.w + 140) * 0.35), dur, begin, repeatCount: "indefinite" }, g);
      el("animate", { attributeName: "opacity", values: "0;1;1;0;0", keyTimes: "0;0.05;0.12;0.16;1", dur, begin, repeatCount: "indefinite" }, g);
    }

    // ---- scenery beside the road ----------------------------------------------
    const planet = (x, y, r, col, on, kind) => {
      const g = el("g", { opacity: on ? 0.9 : 0.32 });
      if (kind === "ringed") el("ellipse", { cx: x, cy: y, rx: r * 2.1, ry: r * 0.55, fill: "none", stroke: col, "stroke-width": 1.2, opacity: 0.55, transform: "rotate(-20 " + x + " " + y + ")" }, g);
      el("circle", { cx: x, cy: y, r, fill: radial(col, [["0%", 1], ["72%", 1], ["100%", 0.12]]) }, g);
      if (kind === "ringed") el("path", { d: "M" + (x - r * 2.1) + " " + y + " A" + (r * 2.1) + " " + (r * 0.55) + " 0 0 0 " + (x + r * 2.1) + " " + y, fill: "none", stroke: col, "stroke-width": 1.4, opacity: 0.9, transform: "rotate(-20 " + x + " " + y + ")" }, g);
      if (kind === "cratered") for (let k = 0; k < 3; k++) { const a = rnd() * 6.28, d = rnd() * r * 0.55; el("circle", { cx: x + Math.cos(a) * d, cy: y + Math.sin(a) * d, r: r * (0.12 + rnd() * 0.16), fill: "#05060f", opacity: 0.35 }, g); }
      if (kind === "banded") { const cp = el("clipPath", { id: gid() }, defs); el("circle", { cx: x, cy: y, r }, cp); for (let k = -1; k <= 1; k += 2) el("rect", { x: x - r, y: y + k * r * 0.35 - r * 0.09, width: r * 2, height: r * 0.18, fill: "#05060f", opacity: 0.28, "clip-path": "url(#" + cp.id + ")" }, g); }
      if (kind === "moon") {
        const orb = el("g", {}, g);
        el("circle", { cx: x + r * 1.9, cy: y, r: r * 0.28, fill: "#eef0ff", opacity: 0.8 }, orb);
        el("animateTransform", { attributeName: "transform", type: "rotate", from: "0 " + x + " " + y, to: "360 " + x + " " + y, dur: (6 + rnd() * 8).toFixed(1) + "s", repeatCount: "indefinite" }, orb);
      }
    };
    const KINDS = ["plain", "ringed", "cratered", "banded", "moon", "plain"];
    for (let i = lo; i <= hi; i++) {
      if (i % 2 !== 1) continue;
      const lv = LEVELS[i], p = nodePos(i), side = p.x > J.w / 2 ? 1 : -1;
      const col = COLS[(i * 7 + lv.planets.length) % 4];
      const r = 5 + (lv.planets[0].r / 54) * 8;
      const x = Math.max(16, Math.min(J.w - 16, p.x + side * (44 + ri(0, 40)))), y = p.y + 28 + ri(0, 30);
      planet(x, y, r, col, reached(i), KINDS[(i >> 1) % KINDS.length]);
    }
    // asteroid belts: a scatter of grey rocks crossing the road on a slant
    for (let b = lo; b <= hi; b++) {
      if ((b - 12) % 25 !== 0 || b >= total - 5) continue;
      const p = nodePos(b), on = reached(b);
      const g = el("g", { opacity: on ? 0.7 : 0.3 });
      for (let k = 0; k < 34; k++) {
        const t = (k / 34) - 0.5, x = J.w / 2 + t * J.w * 1.1 + ri(-10, 10), y = p.y + t * 70 + ri(-22, 22);
        const near = Math.hypot(x - p.x, y - p.y) < 34 || Math.hypot(x - nodePos(b + 1).x, y - nodePos(b + 1).y) < 34;
        if (near) continue;
        el("circle", { cx: x, cy: y, r: 1 + rnd() * 2.4, fill: "#8a8fb5", opacity: 0.35 + rnd() * 0.5 }, g);
      }
    }
    // set pieces that come round every five chapters: a wormhole pair, a satellite
    if (c % 5 === 1 && lo + 14 < total) {
      const a = nodePos(lo + 11), b = nodePos(lo + 14), on = reached(lo + 11);
      const ax = Math.max(40, Math.min(J.w - 40, a.x + (a.x > J.w / 2 ? -1 : 1) * 105)), bx = Math.max(40, Math.min(J.w - 40, b.x + (b.x > J.w / 2 ? -1 : 1) * 105));
      const g = el("g", { opacity: on ? 0.9 : 0.3 });
      el("line", { x1: ax, y1: a.y, x2: bx, y2: b.y, stroke: COLS[2], "stroke-width": 1.2, "stroke-dasharray": "4 7", opacity: 0.4 }, g);
      [[ax, a.y], [bx, b.y]].forEach(([x, y]) => {
        el("circle", { cx: x, cy: y, r: 12, fill: "none", stroke: COLS[2], "stroke-width": 2.5, opacity: 0.9 }, g);
        const sw = el("path", { d: "M" + (x + 6.5) + " " + y + " A6.5 6.5 0 1 1 " + x + " " + (y - 6.5), fill: "none", stroke: COLS[2], "stroke-width": 1.6 }, g);
        el("animateTransform", { attributeName: "transform", type: "rotate", from: "0 " + x + " " + y, to: "360 " + x + " " + y, dur: "3s", repeatCount: "indefinite" }, sw);
      });
    }
    if (c % 5 === 2 && lo + 8 < total) {
      const p = nodePos(lo + 8), side = p.x > J.w / 2 ? -1 : 1, x = Math.max(60, Math.min(J.w - 60, p.x + side * 120)), y = p.y + 10, on = reached(lo + 8);
      const g = el("g", { opacity: on ? 0.85 : 0.3, transform: "rotate(-25 " + x + " " + y + ")" });
      el("rect", { x: x - 26, y: y - 5, width: 16, height: 10, fill: COLS[1], opacity: 0.8 }, g);
      el("rect", { x: x + 10, y: y - 5, width: 16, height: 10, fill: COLS[1], opacity: 0.8 }, g);
      el("line", { x1: x - 10, y1: y, x2: x + 10, y2: y, stroke: "#8a8fb5", "stroke-width": 1.5 }, g);
      el("circle", { cx: x, cy: y, r: 4.5, fill: "#eef0ff" }, g);
    }

    // ---- landmark on the chapter's last level; a summit where the road ends ----
    const LANDMARKS = [
      function ringedGiant(x, y, on) {
        el("ellipse", { cx: x, cy: y, rx: 62, ry: 16, fill: "none", stroke: COLS[2], "stroke-width": 2, opacity: on ? 0.5 : 0.2, transform: "rotate(-22 " + x + " " + y + ")" });
        el("circle", { cx: x, cy: y, r: 30, fill: radial(COLS[2], [["0%", 1], ["100%", 0.15]]), opacity: on ? 0.9 : 0.35 });
        el("path", { d: "M" + (x - 62) + " " + y + " A62 16 0 0 0 " + (x + 62) + " " + y, fill: "none", stroke: COLS[2], "stroke-width": 2, opacity: on ? 0.7 : 0.25, transform: "rotate(-22 " + x + " " + y + ")" });
      },
      function binaryPair(x, y, on) {
        el("ellipse", { cx: x, cy: y, rx: 46, ry: 20, fill: "none", stroke: "#2a2f5a", "stroke-width": 1.5, opacity: on ? 0.9 : 0.4, transform: "rotate(30 " + x + " " + y + ")" });
        const pair = el("g", {});
        [[-38, -14, COLS[0]], [38, 14, COLS[1]]].forEach(([dx, dy, col]) => el("circle", { cx: x + dx, cy: y + dy, r: 15, fill: radial(col, [["0%", 1], ["100%", 0.15]]), opacity: on ? 0.9 : 0.35 }, pair));
        if (on) el("animateTransform", { attributeName: "transform", type: "rotate", from: "0 " + x + " " + y, to: "360 " + x + " " + y, dur: "14s", repeatCount: "indefinite" }, pair);
      },
      function blackHole(x, y, on) {
        el("circle", { cx: x, cy: y, r: 48, fill: radial(GOLD, [["0%", 0], ["78%", 0], ["90%", on ? 0.55 : 0.2], ["100%", 0]]) });
        el("ellipse", { cx: x, cy: y, rx: 58, ry: 10, fill: "none", stroke: GOLD, "stroke-width": 1.2, opacity: on ? 0.45 : 0.15, transform: "rotate(-14 " + x + " " + y + ")" });
        el("circle", { cx: x, cy: y, r: 22, fill: "#000" });
        el("circle", { cx: x, cy: y, r: 23, fill: "none", stroke: "#eef0ff", "stroke-width": 1.2, opacity: on ? 0.8 : 0.3 });
      },
      function comet(x, y, on) {
        const lg = el("linearGradient", { id: gid(), gradientUnits: "userSpaceOnUse", x1: x, y1: y, x2: x + 110, y2: y - 70 }, defs);
        el("stop", { offset: "0%", "stop-color": COLS[3], "stop-opacity": on ? 0.7 : 0.25 }, lg);
        el("stop", { offset: "100%", "stop-color": COLS[3], "stop-opacity": 0 }, lg);
        el("path", { d: "M" + x + " " + (y - 8) + " L" + (x + 110) + " " + (y - 70) + " L" + x + " " + (y + 8) + " Z", fill: "url(#" + lg.id + ")" });
        el("circle", { cx: x, cy: y, r: 9, fill: COLS[3], opacity: on ? 1 : 0.4 });
        el("circle", { cx: x, cy: y, r: 16, fill: COLS[3], opacity: on ? 0.25 : 0.08 });
      },
      function summit(x, y, on) {
        el("circle", { cx: x, cy: y, r: 34, fill: GOLD, opacity: on ? 0.18 : 0.06 });
        el("circle", { cx: x, cy: y, r: 26, fill: "none", stroke: GOLD, "stroke-width": 3, opacity: on ? 1 : 0.35 });
        el("circle", { cx: x, cy: y, r: 9, fill: COLS[1], opacity: on ? 1 : 0.35 });
      },
    ];
    const cleared = (i) => !!save.done[i] || unlockAll;
    if (hi === lo + J.chap - 1) {
      const p = nodePos(hi), draw = LANDMARKS[c % LANDMARKS.length];
      if (lastChap) draw(J.w / 2, p.y - 80, cleared(hi));
      else { const side = p.x > J.w / 2 ? -1 : 1; draw(Math.max(70, Math.min(J.w - 70, p.x + side * 120)), p.y - 42, cleared(hi)); }
    } else LANDMARKS[4](J.w / 2, nodePos(hi).y - 80, cleared(hi));

    // ---- road: faint ahead, lit and flowing behind you ---------------------------
    // this chapter owns the segment up into the next chapter's first node
    const top = Math.min(total - 1, hi + 1);
    el("path", { d: roadPath(lo, top), fill: "none", stroke: "#2a2f5a", "stroke-width": 3, "stroke-linecap": "round" });
    if (lo < frontier) {
      const litTo = Math.min(top, frontier);
      const lg = el("linearGradient", { id: gid(), gradientUnits: "userSpaceOnUse", x1: 0, y1: nodePos(0).y, x2: 0, y2: nodePos(frontier).y }, defs);
      el("stop", { offset: "0%", "stop-color": COLS[0] }, lg);
      el("stop", { offset: "100%", "stop-color": COLS[1] }, lg);
      el("path", { d: roadPath(lo, litTo), fill: "none", stroke: "url(#" + lg.id + ")", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.85 });
      const flow = el("path", { d: roadPath(lo, litTo), fill: "none", stroke: "#fff", "stroke-width": 1.2, "stroke-linecap": "round", "stroke-dasharray": "2 14", opacity: 0.55 });
      el("animate", { attributeName: "stroke-dashoffset", from: 64, to: 0, dur: "2.4s", repeatCount: "indefinite" }, flow);
    }

    // ---- nodes -----------------------------------------------------------------
    for (let i = lo; i <= hi; i++) {
      const p = nodePos(i), done = !!save.done[i], open = unlocked(i), isCur = i === frontier;
      const g = el("g", { class: "node" + (open ? "" : " locked"), transform: "translate(" + p.x + " " + p.y + ")" });
      const hasNew = i === map.firstGate || i === map.firstMover;
      const big = i + 1 >= 1000;   // four-digit numbers need a smaller font
      el("circle", { r: 20, fill: tint.bg }, g);
      if (done) {
        el("circle", { r: 16, fill: COLS[1], opacity: 0.18 }, g);
        el("circle", { r: 16, fill: "none", stroke: COLS[1], "stroke-width": 2 }, g);
      } else if (isCur) {
        el("circle", { r: 16, fill: GOLD, opacity: 0.15 }, g);
        el("circle", { r: 16, fill: "none", stroke: GOLD, "stroke-width": 2.5 }, g);
        const halo = el("circle", { r: 22, fill: "none", stroke: GOLD, "stroke-width": 1.5, opacity: 0.6 }, g);
        el("animate", { attributeName: "r", values: "20;27;20", dur: "2.2s", repeatCount: "indefinite" }, halo);
        el("animate", { attributeName: "opacity", values: "0.6;0;0.6", dur: "2.2s", repeatCount: "indefinite" }, halo);
        // your orb, waiting above the node
        const orb = el("g", {}, g);
        el("circle", { cx: 0, cy: -30, r: 10, fill: COLS[1], opacity: 0.25 }, orb);
        el("circle", { cx: 0, cy: -30, r: 6, fill: COLS[1] }, orb);
        el("animateTransform", { attributeName: "transform", type: "translate", values: "0 0;0 -4;0 0", dur: "1.8s", repeatCount: "indefinite" }, orb);
        el("text", { y: 38, "text-anchor": "middle", "font-size": 9, fill: GOLD, "letter-spacing": 2, opacity: 0.8 }, g).textContent = "TAP TO PLAY";
      } else {
        el("circle", { r: open ? 14 : 10, fill: "#0b0e22", stroke: "#2a2f5a", "stroke-width": 1.5 }, g);
        if (!open) el("text", { y: big ? 2.5 : 3.5, "text-anchor": "middle", "font-size": big ? 6.5 : 9, fill: "#3a4080" }, g).textContent = i + 1;
      }
      if (open) {
        el("text", { y: big ? 4 : 5, "text-anchor": "middle", "font-size": big ? 10.5 : 13, "font-weight": 700, fill: done ? "#eef0ff" : isCur ? GOLD : "#7d82ad" }, g).textContent = i + 1;
        const side = p.x > J.w / 2 ? -1 : 1;
        if (hasNew && !done) el("text", { x: side * 30, y: 4, "text-anchor": side < 0 ? "end" : "start", "font-size": 9, fill: GOLD, "letter-spacing": 1 }, g).textContent = "SOMETHING NEW";
        g.addEventListener("click", () => { loadLevel(i); showScreen(null); });
      }
    }
    return svg;
  }
  function renderPips() {
    pipsEl.innerHTML = "";
    // one pip per tap; the level needs every one of them
    for (let i = 0; i < level.taps; i++) {
      const d = document.createElement("span");
      d.className = "pip" + (i < s.taps ? " spent" : "");
      pipsEl.appendChild(d);
    }
  }
  function firstHint() {
    // one-time hints when a new element first appears
    const firstWith = (key) => LEVELS.findIndex((l) => l[key] && l[key].length);
    const firstMover = LEVELS.findIndex((l) => l.planets.some((p) => p.move));
    if (levelIndex === firstWith("gates")) return "Pass through every white ring before the goal.";
    if (levelIndex === firstMover) return "Some planets drift now. Watch the track.";
    const firstPlanet = (f) => LEVELS.findIndex((l) => l.planets.some(f));
    if (levelIndex === firstPlanet((p) => p.g > 1)) return "Ringed planets are heavy: they pull harder.";
    if (levelIndex === firstPlanet((p) => p.g < 1)) return "Hollow planets are light: their pull is weak.";
    if (levelIndex === firstWith("moons")) return "Grey moons never pull, but hitting one still ends the run.";
    return null;
  }
  function setFooter() {
    if (s.status === "idle") footer.textContent = level.hint || firstHint() || "Tap to launch";
    else if (s.status === "live") footer.textContent = s.taps < level.taps ? "Tap to switch pull" : "No taps left";
    else footer.textContent = "";
  }

  // ---- level flow ----------------------------------------------------------
  function loadLevel(i, keepGhost) {
    levelIndex = i; level = LEVELS[i];
    s = P.make(level);
    if (!keepGhost) ghost = [];
    trail = [{ x: s.x, y: s.y, a: s.active }];
    acc = 0; lostAt = 0; wonAt = 0; winShown = false; flash = 0;
    hudLevel.textContent = i + 1;
    renderPips(); setFooter();
  }
  function reset() { ghost = trail.length > 2 ? trail : ghost; loadLevel(levelIndex, true); }

  function tap() {
    if (!playing) return;
    audio();
    if (s.status === "idle") { P.launch(s); sfx.launch(); buzz(8); setFooter(); return; }
    if (s.status === "live") {
      if (P.flip(s, level)) { sfx.flip(s.active); buzz(12); renderPips(); flash = 0.12; setFooter(); }
      return;
    }
    if (s.status === "lost") { reset(); return; }
  }

  function onWin() {
    if (!save.done[levelIndex]) { save.done[levelIndex] = 1; persist(); }
    $("win-text").textContent = "Level " + (levelIndex + 1) + " cleared";
    const nextBtn = screens.win.querySelector("[data-action=next]");
    nextBtn.disabled = levelIndex + 1 >= LEVELS.length;
    showScreen("win");
  }

  // ---- update --------------------------------------------------------------
  function update(dt) {
    clock += dt;
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (s.status === "live") {
      acc += Math.min(dt, 0.1);
      while (acc >= P.DT && s.status === "live") {
        P.step(s, level); acc -= P.DT;
        trail.push({ x: s.x, y: s.y, a: s.active });
      }
      if (s.status === "lost") { lostAt = clock; sfx.lost(); buzz(40); setFooter(); }
      if (s.status === "won") { wonAt = clock; sfx.win(); buzz([20, 40, 20]); setFooter(); renderPips(); }
    } else if (s.status === "lost") {
      if (clock - lostAt > 0.9) reset();
    } else if (s.status === "won") {
      if (!winShown && clock - wonAt > 0.55) { winShown = true; onWin(); }
    }
  }

  // ---- render --------------------------------------------------------------
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawTrail(pts, alpha, mono) {
    if (pts.length < 2) return;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    let i = 1;
    while (i < pts.length) {
      const a = pts[i].a; const j0 = i - 1;
      ctx.beginPath(); ctx.moveTo(pts[j0].x, pts[j0].y);
      while (i < pts.length && pts[i].a === a) { ctx.lineTo(pts[i].x, pts[i].y); i++; }
      ctx.strokeStyle = mono ? "rgba(160,166,210," + alpha + ")" : COLS[a % 4];
      ctx.globalAlpha = mono ? 1 : alpha; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // The sky drifts very slightly every 20 levels (cycling): same game, further out.
  const TINTS = [
    { bg: "#05060f", star: "#c9d1ff" },
    { bg: "#06070f", star: "#c4d6ff" },
    { bg: "#07060f", star: "#d3c9ff" },
    { bg: "#06080f", star: "#c1e0f6" },
    { bg: "#080610", star: "#e0c9f5" },
    { bg: "#050810", star: "#c9f0e6" },
  ];
  function tint() { return TINTS[Math.floor(levelIndex / 20) % TINTS.length]; }
  function render() {
    const tn = tint();
    ctx.fillStyle = tn.bg; ctx.fillRect(0, 0, W, H);
    for (const st of stars) {
      ctx.globalAlpha = st.a * (0.7 + 0.3 * Math.sin(clock * 1.3 + st.p));
      ctx.fillStyle = tn.star; circle(st.x, st.y, st.r); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (level.walls) for (const w of level.walls) {
      // Tidal barrier look: rounded slab with a soft glow
      ctx.fillStyle = "#3a4080"; ctx.shadowBlur = 8; ctx.shadowColor = "#5a63c0";
      rr(w.x, w.y, w.w, w.h, 6); ctx.fill(); ctx.shadowBlur = 0;
    }

    drawTrail(ghost, 0.22, true);
    drawTrail(trail, 0.6, false);

    // goal ring
    const g = level.goal, pulse = 0.5 + 0.5 * Math.sin(clock * 3);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
    ctx.shadowColor = GOLD; ctx.shadowBlur = 8 + 8 * pulse;
    circle(g.x, g.y, g.r - 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.12 + 0.1 * pulse; ctx.fillStyle = GOLD; circle(g.x, g.y, g.r - 2); ctx.fill(); ctx.globalAlpha = 1;
    if (s.status === "won") { ctx.globalAlpha = 0.9; circle(g.x, g.y, g.r - 2); ctx.fill(); ctx.globalAlpha = 1; }

    // pull beam
    const nextIdx = (s.active + 1) % level.planets.length;
    if (s.status === "live" || s.status === "idle") {
      const tp = P.planetPos(level, s.active, s.t);
      ctx.strokeStyle = COLS[s.active % 4]; ctx.globalAlpha = s.status === "live" ? 0.28 : 0.14;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // checkpoint gates (must all be touched before the goal counts)
    if (level.gates) level.gates.forEach((gt, i) => {
      const got = (s.got >> i) & 1;
      ctx.strokeStyle = got ? GOLD : "#eef0ff"; ctx.globalAlpha = got ? 0.9 : 0.55; ctx.lineWidth = got ? 2.5 : 1.5;
      if (got) { ctx.shadowColor = GOLD; ctx.shadowBlur = 10; }
      circle(gt.x, gt.y, gt.r - 2); ctx.stroke(); ctx.shadowBlur = 0;
      if (!got) { ctx.globalAlpha = 0.35; circle(gt.x, gt.y, 3); ctx.fillStyle = "#eef0ff"; ctx.fill(); }
      ctx.globalAlpha = 1;
    });

    // moons: inert grey rocks, fatal to touch
    if (level.moons) for (const mb of level.moons) {
      const m = P.bodyPos(mb, s.t);
      ctx.fillStyle = "#8a8ca3"; ctx.globalAlpha = 0.85; circle(m.x, m.y, m.r); ctx.fill();
      ctx.fillStyle = "#5d5f78";   // a couple of craters
      circle(m.x - m.r * 0.3, m.y - m.r * 0.25, m.r * 0.28); ctx.fill();
      circle(m.x + m.r * 0.35, m.y + m.r * 0.3, m.r * 0.18); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // planets
    level.planets.forEach((pb, i) => {
      const c = COLS[i % 4];
      const active = i === s.active && s.status !== "lost";
      const p = P.planetPos(level, i, s.t);
      if (pb.move) { // faint track showing the drift range
        ctx.strokeStyle = c; ctx.globalAlpha = 0.18; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pb.x - pb.move.ax, pb.y - pb.move.ay); ctx.lineTo(pb.x + pb.move.ax, pb.y + pb.move.ay); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Tidal-style planet: solid core fading into the background, no shading.
      // The gradient runs a little past the collision radius; a hairline ring
      // at the exact radius keeps the fatal edge readable on small planets.
      const R = p.r * 1.12;
      const grd = ctx.createRadialGradient(p.x, p.y, p.r * 0.2, p.x, p.y, R);
      grd.addColorStop(0, c); grd.addColorStop(0.7, c); grd.addColorStop(1, "rgba(5,6,15,0.1)");
      ctx.globalAlpha = active ? 0.95 : 0.4;
      ctx.fillStyle = grd; circle(p.x, p.y, R); ctx.fill();
      if (pb.g > 1) { // heavy: gravity rings drifting inward
        ctx.strokeStyle = c; ctx.lineWidth = 1.5;
        for (let k = 0; k < 2; k++) {
          const ph = (clock * 0.5 + k / 2) % 1;
          ctx.globalAlpha = (active ? 0.5 : 0.25) * ph;
          circle(p.x, p.y, p.r + 6 + 18 * (1 - ph)); ctx.stroke();
        }
      } else if (pb.g < 1) { // light: hollow core
        ctx.globalAlpha = 0.85; ctx.fillStyle = tn.bg; circle(p.x, p.y, p.r * 0.42); ctx.fill();
      }
      ctx.globalAlpha = active ? 0.5 : 0.22;
      ctx.strokeStyle = c; ctx.lineWidth = 1; circle(p.x, p.y, p.r); ctx.stroke();
      ctx.globalAlpha = 1;
      if (active && flash > 0) { ctx.globalAlpha = flash * 3; ctx.fillStyle = "#fff"; circle(p.x, p.y, p.r); ctx.fill(); ctx.globalAlpha = 1; }
      if (i === nextIdx && level.planets.length > 1 && s.status !== "won" && s.taps < level.taps) {
        ctx.strokeStyle = c; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 7]); ctx.lineDashOffset = -clock * 30;
        circle(p.x, p.y, p.r + 8); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    });

    // orb (Tidal glowCircle: flat fill + glow, colour = active pull)
    if (s.status !== "won") {
      const c = s.status === "lost" ? "#ff4d4d" : COLS[s.active % 4];
      ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 22;
      circle(s.x, s.y, P.ORB_R); ctx.fill(); ctx.shadowBlur = 0;
      if (s.status === "idle") {
        ctx.strokeStyle = "rgba(238,240,255,0.35)"; ctx.lineWidth = 1;
        circle(s.x, s.y, P.ORB_R + 6 + 3 * Math.sin(clock * 5)); ctx.stroke();
      }
    }

    // lost flash
    if (s.status === "lost") {
      const k = Math.max(0, 1 - (clock - lostAt) / 0.9);
      ctx.fillStyle = "rgba(255,60,80," + (0.25 * k) + ")"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255," + Math.min(1, k * 2) + ")";
      ctx.font = "800 22px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(s.why === "space" ? "LOST TO SPACE" : s.why === "time" ? "DRIFTED" : "CRASHED", W / 2, 72);
    }
  }

  function loop(ts) {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
    update(dt); render();
    requestAnimationFrame(loop);
  }

  // ---- input -------------------------------------------------------------
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); tap(); });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); tap(); }
    if (e.code === "KeyR" && playing) reset();
  });
  $("btn-restart").addEventListener("click", () => { if (playing) reset(); });
  $("btn-levels").addEventListener("click", () => showScreen("levels"));
  let logoTaps = [];
  document.querySelector(".map-head .logo").addEventListener("click", () => {
    const now = Date.now();
    logoTaps = logoTaps.filter((t) => now - t < 2500); logoTaps.push(now);
    if (logoTaps.length < 7) return;
    logoTaps = [];
    devMode = !devMode; unlockAll = devMode;
    try { devMode ? localStorage.setItem(DEV_KEY, "1") : localStorage.removeItem(DEV_KEY); } catch (_) {}
    buildLevelGrid();
  });
  document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.action;
    if (a === "play") { loadLevel(frontierIndex()); showScreen(null); }
    else if (a === "levels") showScreen("levels");
    else if (a === "howto") showScreen("howto");
    else if (a === "back") showScreen(returnTo);
    else if (a === "next") { loadLevel(Math.min(LEVELS.length - 1, levelIndex + 1)); showScreen(null); }
    else if (a === "retry") { loadLevel(levelIndex); showScreen(null); }
  }));

  loadLevel(0);
  showScreen("levels");
  requestAnimationFrame(loop);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
