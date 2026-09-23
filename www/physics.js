/* Orbit Lock — deterministic physics shared by the game and the level tools.
   Constant-magnitude pull toward the active planet (Tidal "Binary" feel),
   fixed timestep so a tap sequence replays identically anywhere.

   Level extras handled here:
   - planet.move = { ax, ay, f, ph }: the planet drifts around its base
     position, offset = (ax, ay) * sin(2*pi*f*t + ph). Deterministic in t.
   - level.gates = [{x, y, r}]: rings that must all be touched (any order)
     before the goal counts. */
(function (root) {
  const P = {
    W: 420, H: 640,
    G: 800,           // px/s^2 pull toward the active planet
    MAXV: 460,        // speed clamp per axis
    DAMP: 0.55,       // momentum kept on a flip (reversal registers instantly)
    ORB_R: 11,
    DT: 1 / 120,      // fixed step
    TIME_LIMIT: 16,   // s before a run is called "lost to space"
    STEPS_PER_SLOT: 12, // solver tap granularity = 0.1 s

    make(level) {
      return {
        x: level.start.x, y: level.start.y,
        vx: level.v0 ? level.v0.x : 0, vy: level.v0 ? level.v0.y : 0,
        active: level.active || 0,
        taps: 0, t: 0, got: 0,
        status: "idle",   // idle | live | won | lost
        why: "",
      };
    },

    launch(s) { if (s.status === "idle") s.status = "live"; },

    // Returns true if the tap was spent.
    flip(s, level) {
      if (s.status !== "live") return false;
      if (s.taps >= level.taps) return false;
      s.active = (s.active + 1) % level.planets.length;
      s.vx *= P.DAMP; s.vy *= P.DAMP;
      s.taps++;
      return true;
    },

    // Planet i's position at time t (base position unless it drifts).
    planetPos(level, i, t) {
      const p = level.planets[i];
      if (!p.move) return p;
      const k = Math.sin(6.283185307179586 * p.move.f * t + (p.move.ph || 0));
      return { x: p.x + p.move.ax * k, y: p.y + p.move.ay * k, r: p.r };
    },

    allGates(level) { return level.gates ? (1 << level.gates.length) - 1 : 0; },

    step(s, level) {
      if (s.status !== "live") return s.status;
      const dt = P.DT;
      const tp = P.planetPos(level, s.active, s.t);
      const dx = tp.x - s.x, dy = tp.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      s.vx += (dx / len) * P.G * dt;
      s.vy += (dy / len) * P.G * dt;
      if (s.vx > P.MAXV) s.vx = P.MAXV; else if (s.vx < -P.MAXV) s.vx = -P.MAXV;
      if (s.vy > P.MAXV) s.vy = P.MAXV; else if (s.vy < -P.MAXV) s.vy = -P.MAXV;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.t += dt;

      const r = P.ORB_R;
      if (level.gates) for (let i = 0; i < level.gates.length; i++) {
        const gt = level.gates[i];
        if ((s.x - gt.x) ** 2 + (s.y - gt.y) ** 2 < gt.r * gt.r) s.got |= 1 << i;
      }
      // goal first: touching the ring counts even if a hazard is adjacent
      const g = level.goal;
      if (s.got === P.allGates(level) && (s.x - g.x) ** 2 + (s.y - g.y) ** 2 < g.r * g.r) { s.status = "won"; return s.status; }

      if (s.x < -r || s.x > P.W + r || s.y < -r || s.y > P.H + r) { s.status = "lost"; s.why = "space"; return s.status; }
      for (let i = 0; i < level.planets.length; i++) {
        const p = P.planetPos(level, i, s.t);
        const rr = p.r + r;
        if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < rr * rr) { s.status = "lost"; s.why = "planet"; return s.status; }
      }
      if (level.walls) for (const w of level.walls) {
        const cx = Math.max(w.x, Math.min(s.x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(s.y, w.y + w.h));
        if ((s.x - cx) ** 2 + (s.y - cy) ** 2 < r * r) { s.status = "lost"; s.why = "wall"; return s.status; }
      }
      if (s.t > P.TIME_LIMIT) { s.status = "lost"; s.why = "time"; }
      return s.status;
    },

    clone(s) { return Object.assign({}, s); },
  };
  root.OrbitPhysics = P;
})(typeof module !== "undefined" ? module.exports : window);
if (typeof module !== "undefined") module.exports = module.exports.OrbitPhysics;
