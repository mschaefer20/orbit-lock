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
  let save = { stars: {} };
  try { save = Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || "{}")); } catch (_) {}
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {} }
  const unlockAll = /[?&]all([=&]|$)/.test(location.search);
  function unlocked(i) { return unlockAll || i === 0 || !!save.stars[i - 1]; }

  // ---- HiDPI ---------------------------------------------------------------
  function setupHiDPI() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupHiDPI();
  window.addEventListener("resize", setupHiDPI);

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
  const hudLevel = $("hud-level"), hudName = $("hud-name"), pipsEl = $("pips"), footer = $("footer-hint");
  let current = "levels", returnTo = "levels";
  function showScreen(name) {
    if (name === "howto" && current !== "howto") returnTo = current;
    current = name;
    for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
    playing = !name;
    $("app").classList.toggle("on-map", name === "levels");
    if (name === "levels") buildLevelGrid();
  }
  function starStr(n) {
    let out = "";
    for (let i = 0; i < 3; i++) out += '<span class="' + (i < n ? "" : "off") + '">&#9733;</span>';
    return out;
  }
  // ---- journey map: one winding road, level 1 at the bottom, climbing up ----
  const J = { w: 360, step: 84, pad: 70, top: 170, amp: 92, ahead: 3, shown: 1 };
  function nodePos(i) {
    return { x: J.w / 2 + Math.sin(i * 0.62) * J.amp, y: J.top + (J.shown - 1 - i) * J.step };
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
  function buildLevelGrid() {
    const host = $("journey"); host.innerHTML = "";
    const total = LEVELS.length;
    let frontier = 0; while (frontier < total - 1 && save.stars[frontier]) frontier++;
    // the whole road is visible; what lies ahead is just dimmer
    const shown = total;
    J.shown = shown;
    const h = J.top + J.pad + (shown - 1) * J.step;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + J.w + " " + h);
    svg.setAttribute("width", J.w); svg.setAttribute("height", h);
    const el = (tag, attrs, parent) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };

    // sky: the same tint drift as in-game, one band per 20 levels, blended
    const defs = el("defs", {});
    const grad = el("linearGradient", { id: "sky", x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
    const bands = Math.ceil(total / 20);
    for (let b = 0; b < bands; b++) {
      const t = TINTS[Math.min(TINTS.length - 1, b)];
      el("stop", { offset: (b / bands) * 100 + "%", "stop-color": t.bg }, grad);
      el("stop", { offset: ((b + 1) / bands) * 100 - 2 + "%", "stop-color": t.bg }, grad);
    }
    el("rect", { x: 0, y: 0, width: J.w, height: h, fill: "url(#sky)" });
    // stars, seeded so the map is stable
    let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < total * 3; i++) {
      const cy = rnd() * h;                      // band follows height: bottom = level 1
      const band = TINTS[Math.min(TINTS.length - 1, Math.floor((h - cy) / (J.step * 20)))];
      el("circle", { cx: rnd() * J.w, cy, r: 0.5 + rnd() * 1.1, fill: band.star, opacity: 0.15 + rnd() * 0.45 });
    }

    // scenery: a soft nebula glow per band, and small planets beside the road,
    // coloured from each level's own first planet so the map echoes the levels
    for (let b = 0; b < bands; b++) {
      const t = TINTS[Math.min(TINTS.length - 1, b)];
      const rg = el("radialGradient", { id: "neb" + b }, defs);
      el("stop", { offset: "0%", "stop-color": t.star, "stop-opacity": 0.09 }, rg);
      el("stop", { offset: "100%", "stop-color": t.star, "stop-opacity": 0 }, rg);
      const cy = nodePos(Math.min(total - 1, b * 20 + 10)).y;
      el("ellipse", { cx: b % 2 ? J.w * 0.72 : J.w * 0.28, cy, rx: 200, ry: 420, fill: "url(#neb" + b + ")" });
    }
    LEVELS.forEach((lv, i) => {
      if (i % 3 !== 1) return;
      const p = nodePos(i), side = p.x > J.w / 2 ? 1 : -1;   // outer side of the curve (names sit inside)
      const pl = lv.planets[0], c = COLS[0], c2 = COLS[(lv.planets.length - 1) % 4];
      const r = 5 + (pl.r / 54) * 9;
      const x = Math.max(18, Math.min(J.w - 18, p.x + side * (46 + (i % 5) * 7))), y = p.y + 34 + (i % 4) * 8;
      const dim = i <= frontier ? 0.55 : 0.22;
      const rg = el("radialGradient", { id: "pl" + i }, defs);
      el("stop", { offset: "0%", "stop-color": i % 2 ? c : c2 }, rg);
      el("stop", { offset: "70%", "stop-color": i % 2 ? c : c2 }, rg);
      el("stop", { offset: "100%", "stop-color": i % 2 ? c : c2, "stop-opacity": 0.1 }, rg);
      el("circle", { cx: x, cy: y, r: r * 1.12, fill: "url(#pl" + i + ")", opacity: dim });
      if (i % 6 === 1) el("ellipse", { cx: x, cy: y, rx: r * 2.2, ry: r * 0.7, fill: "none", stroke: i % 2 ? c : c2, "stroke-width": 1, opacity: dim * 0.5, transform: "rotate(-18 " + x + " " + y + ")" });
    });

    // landmarks: one at each 20-level boundary, on the outer side of the road.
    // No names, no chapter screens: you just pass something big.
    const LANDMARKS = [
      function ringedGiant(x, y, c, on) {   // after 20
        const rg = el("radialGradient", { id: "lm-g" + x }, defs);
        el("stop", { offset: "0%", "stop-color": COLS[2] }, rg); el("stop", { offset: "100%", "stop-color": COLS[2], "stop-opacity": 0.15 }, rg);
        el("ellipse", { cx: x, cy: y, rx: 62, ry: 16, fill: "none", stroke: COLS[2], "stroke-width": 2, opacity: on ? 0.5 : 0.2, transform: "rotate(-22 " + x + " " + y + ")" });
        el("circle", { cx: x, cy: y, r: 30, fill: "url(#lm-g" + x + ")", opacity: on ? 0.9 : 0.35 });
        el("path", { d: "M" + (x - 62) + " " + y + " A62 16 0 0 0 " + (x + 62) + " " + y, fill: "none", stroke: COLS[2], "stroke-width": 2, opacity: on ? 0.7 : 0.25, transform: "rotate(-22 " + x + " " + y + ")" });
      },
      function binaryPair(x, y, c, on) {    // after 40
        el("ellipse", { cx: x, cy: y, rx: 46, ry: 20, fill: "none", stroke: "#2a2f5a", "stroke-width": 1.5, opacity: on ? 0.9 : 0.4, transform: "rotate(30 " + x + " " + y + ")" });
        const a = { x: x - 38, y: y - 14 }, b = { x: x + 38, y: y + 14 };
        [[a, COLS[0]], [b, COLS[1]]].forEach(([p, col], k) => {
          const rg = el("radialGradient", { id: "lm-b" + x + k }, defs);
          el("stop", { offset: "0%", "stop-color": col }, rg); el("stop", { offset: "100%", "stop-color": col, "stop-opacity": 0.15 }, rg);
          el("circle", { cx: p.x, cy: p.y, r: 15, fill: "url(#lm-b" + x + k + ")", opacity: on ? 0.9 : 0.35 });
        });
      },
      function blackHole(x, y, c, on) {     // after 60
        const rg = el("radialGradient", { id: "lm-h" + x }, defs);
        el("stop", { offset: "0%", "stop-color": "#eef0ff", "stop-opacity": 0 }, rg);
        el("stop", { offset: "78%", "stop-color": "#eef0ff", "stop-opacity": 0 }, rg);
        el("stop", { offset: "90%", "stop-color": GOLD, "stop-opacity": on ? 0.55 : 0.2 }, rg);
        el("stop", { offset: "100%", "stop-color": GOLD, "stop-opacity": 0 }, rg);
        el("circle", { cx: x, cy: y, r: 48, fill: "url(#lm-h" + x + ")" });
        el("ellipse", { cx: x, cy: y, rx: 58, ry: 10, fill: "none", stroke: GOLD, "stroke-width": 1.2, opacity: on ? 0.45 : 0.15, transform: "rotate(-14 " + x + " " + y + ")" });
        el("circle", { cx: x, cy: y, r: 22, fill: "#000" });
        el("circle", { cx: x, cy: y, r: 23, fill: "none", stroke: "#eef0ff", "stroke-width": 1.2, opacity: on ? 0.8 : 0.3 });
      },
      function comet(x, y, c, on) {         // after 80
        const lg = el("linearGradient", { id: "lm-c" + x, gradientUnits: "userSpaceOnUse", x1: x, y1: y, x2: x + 110, y2: y - 70 }, defs);
        el("stop", { offset: "0%", "stop-color": COLS[3], "stop-opacity": on ? 0.7 : 0.25 }, lg);
        el("stop", { offset: "100%", "stop-color": COLS[3], "stop-opacity": 0 }, lg);
        el("path", { d: "M" + x + " " + (y - 8) + " L" + (x + 110) + " " + (y - 70) + " L" + x + " " + (y + 8) + " Z", fill: "url(#lm-c" + x + ")" });
        el("circle", { cx: x, cy: y, r: 9, fill: COLS[3], opacity: on ? 1 : 0.4 });
        el("circle", { cx: x, cy: y, r: 16, fill: COLS[3], opacity: on ? 0.25 : 0.08 });
      },
      function summit(x, y, c, on) {        // after 100: the ring itself
        el("circle", { cx: x, cy: y, r: 34, fill: GOLD, opacity: on ? 0.18 : 0.06 });
        el("circle", { cx: x, cy: y, r: 26, fill: "none", stroke: GOLD, "stroke-width": 3, opacity: on ? 1 : 0.35 });
        el("circle", { cx: x, cy: y, r: 9, fill: COLS[1], opacity: on ? 1 : 0.35 });
      },
    ];
    for (let b = 1; b * 20 <= total; b++) {
      const idx = Math.min(total - 1, b * 20 - 1);          // last level of the band
      const p = nodePos(idx), on = !!save.stars[idx] || unlockAll;
      const draw = LANDMARKS[Math.min(LANDMARKS.length - 1, b - 1)];
      const isEnd = b * 20 === total;
      if (isEnd) draw(J.w / 2, p.y - 80, null, on);
      else { const side = p.x > J.w / 2 ? -1 : 1; draw(Math.max(70, Math.min(J.w - 70, p.x + side * 120)), p.y - 42, null, on); }
    }
    if (total % 20 !== 0) { const p = nodePos(total - 1); LANDMARKS[4](J.w / 2, p.y - 80, null, !!save.stars[total - 1] || unlockAll); }

    // road: full length faint, travelled part lit
    el("path", { d: roadPath(0, shown - 1), fill: "none", stroke: "#2a2f5a", "stroke-width": 3, "stroke-linecap": "round" });
    if (frontier > 0) {
      const lit = el("path", { d: roadPath(0, frontier), fill: "none", stroke: "url(#lit)", "stroke-width": 3, "stroke-linecap": "round" });
      const lg = el("linearGradient", { id: "lit", gradientUnits: "userSpaceOnUse", x1: 0, y1: nodePos(0).y, x2: 0, y2: nodePos(frontier).y }, defs);
      el("stop", { offset: "0%", "stop-color": COLS[0] }, lg);
      el("stop", { offset: "100%", "stop-color": COLS[1] }, lg);
      lit.setAttribute("opacity", 0.85);
    }

    // nodes
    LEVELS.forEach((lv, i) => {
      if (i >= shown) return;
      const p = nodePos(i), st = save.stars[i] || 0, open = unlocked(i), isCur = i === frontier;
      const g = el("g", { class: "node" + (open ? "" : " locked"), transform: "translate(" + p.x + " " + p.y + ")" });
      const hasNew = (lv.gates && lv.gates.length && !LEVELS.slice(0, i).some((l) => l.gates && l.gates.length)) ||
                     (lv.planets.some((q) => q.move) && !LEVELS.slice(0, i).some((l) => l.planets.some((q) => q.move)));
      if (st) {
        el("circle", { r: 20, fill: TINTS[Math.min(TINTS.length - 1, Math.floor(i / 20))].bg }, g);
        el("circle", { r: 16, fill: COLS[1], opacity: 0.18 }, g);
        el("circle", { r: 16, fill: "none", stroke: COLS[1], "stroke-width": 2 }, g);
      } else if (isCur) {
        el("circle", { r: 20, fill: TINTS[Math.min(TINTS.length - 1, Math.floor(i / 20))].bg }, g);
        el("circle", { r: 16, fill: GOLD, opacity: 0.15 }, g);
        el("circle", { r: 16, fill: "none", stroke: GOLD, "stroke-width": 2.5 }, g);
        const halo = el("circle", { r: 22, fill: "none", stroke: GOLD, "stroke-width": 1.5, opacity: 0.6 }, g);
        const an = el("animate", { attributeName: "r", values: "20;27;20", dur: "2.2s", repeatCount: "indefinite" }, halo);
        el("animate", { attributeName: "opacity", values: "0.6;0;0.6", dur: "2.2s", repeatCount: "indefinite" }, halo);
        void an;
        el("text", { y: 38, "text-anchor": "middle", "font-size": 9, fill: GOLD, "letter-spacing": 2, opacity: 0.8 }, g).textContent = "TAP TO PLAY";
      } else {
        // locked, ahead on the road: a small dark bead, numbered faintly
        el("circle", { r: 20, fill: TINTS[Math.min(TINTS.length - 1, Math.floor(i / 20))].bg }, g);
        el("circle", { r: open ? 14 : 10, fill: "#0b0e22", stroke: "#2a2f5a", "stroke-width": 1.5 }, g);
        if (!open) el("text", { y: 3.5, "text-anchor": "middle", "font-size": 9, fill: "#3a4080" }, g).textContent = i + 1;
      }
      if (open) {
        el("text", { y: 5, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: st ? "#eef0ff" : isCur ? GOLD : "#7d82ad" }, g).textContent = i + 1;
        if (st) el("text", { y: 34, "text-anchor": "middle", "font-size": 9, fill: GOLD, "letter-spacing": 1 }, g).textContent = "★".repeat(st) + "☆".repeat(3 - st);
        // no names on the map; only flag a level that brings something new
        const side = p.x > J.w / 2 ? -1 : 1;
        if (hasNew && !st) el("text", { x: side * 30, y: 4, "text-anchor": side < 0 ? "end" : "start", "font-size": 9, fill: GOLD, "letter-spacing": 1 }, g).textContent = "SOMETHING NEW";
        g.addEventListener("click", () => { loadLevel(i); showScreen(null); });
      }
    });
    host.appendChild(svg);
    // start the view on the current level, a little below centre so the road ahead shows
    const target = nodePos(frontier).y * (host.clientWidth / J.w) - host.clientHeight * 0.58;
    host.scrollTop = Math.max(0, target);
    let stars = 0; for (const k in save.stars) stars += save.stars[k];
    $("map-stars").textContent = stars + " ★";
  }
  function renderPips() {
    pipsEl.innerHTML = "";
    for (let i = 0; i < level.taps; i++) {
      const d = document.createElement("span");
      d.className = "pip " + (i < level.taps - s.taps ? "on" : "spent");
      pipsEl.appendChild(d);
    }
  }
  function firstHint() {
    // one-time hints when a new element first appears
    const firstWith = (key) => LEVELS.findIndex((l) => l[key] && l[key].length);
    const firstMover = LEVELS.findIndex((l) => l.planets.some((p) => p.move));
    if (levelIndex === firstWith("gates")) return "Pass through every white ring before the goal.";
    if (levelIndex === firstMover) return "Some planets drift now. Watch the track.";
    return null;
  }
  function setFooter() {
    if (s.status === "idle") footer.textContent = level.hint || firstHint() || (level.taps ? "Tap to launch · par " + level.par : "Tap to launch");
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
    hudLevel.textContent = "Level " + (i + 1);
    hudName.textContent = level.name;
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
    const n = s.taps <= level.par ? 3 : s.taps <= level.par + 1 ? 2 : 1;
    if ((save.stars[levelIndex] || 0) < n) { save.stars[levelIndex] = n; persist(); }
    $("win-stars").innerHTML = starStr(n);
    $("win-text").textContent = s.taps + " tap" + (s.taps === 1 ? "" : "s") + " · par " + level.par;
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
  // The sky drifts very slightly every 20 levels: same game, further out.
  const TINTS = [
    { bg: "#05060f", star: "#c9d1ff" },
    { bg: "#06070f", star: "#c4d6ff" },
    { bg: "#07060f", star: "#d3c9ff" },
    { bg: "#06080f", star: "#c1e0f6" },
    { bg: "#080610", star: "#e0c9f5" },
    { bg: "#050810", star: "#c9f0e6" },
  ];
  function tint() { return TINTS[Math.min(TINTS.length - 1, Math.floor(levelIndex / 20))]; }
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
  document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.action;
    if (a === "play") { let i = 0; while (i < LEVELS.length - 1 && save.stars[i]) i++; loadLevel(i); showScreen(null); }
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
