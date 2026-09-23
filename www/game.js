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
  const screens = ["title", "howto", "levels", "win"].reduce((m, k) => (m[k] = $("screen-" + k), m), {});
  const hudLevel = $("hud-level"), hudName = $("hud-name"), pipsEl = $("pips"), footer = $("footer-hint");
  let current = "title", returnTo = "title";
  function showScreen(name) {
    if ((name === "levels" || name === "howto") && current !== "levels" && current !== "howto") returnTo = current;
    current = name;
    for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
    playing = !name;
    if (name === "levels") buildLevelGrid();
  }
  function starStr(n) {
    let out = "";
    for (let i = 0; i < 3; i++) out += '<span class="' + (i < n ? "" : "off") + '">&#9733;</span>';
    return out;
  }
  function buildLevelGrid() {
    const grid = $("level-grid"); grid.innerHTML = "";
    LEVELS.forEach((lv, i) => {
      const b = document.createElement("button");
      b.className = "lvl" + (unlocked(i) ? "" : " locked");
      b.innerHTML = (i + 1) + "<small>" + "★".repeat(save.stars[i] || 0) + "</small>";
      b.disabled = !unlocked(i);
      b.addEventListener("click", () => { loadLevel(i); showScreen(null); });
      grid.appendChild(b);
    });
    // scroll the current level into view
    const cur = grid.children[levelIndex];
    if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: "center" }));
    let total = 0; for (const k in save.stars) total += save.stars[k];
    $("levels-summary").textContent = total + " / " + (LEVELS.length * 3) + " stars";
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
  showScreen("title");
  requestAnimationFrame(loop);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
