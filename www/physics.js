/* Orbit Lock — deterministic physics shared by the game and the level tools.
   Constant-magnitude pull toward the active planet (Tidal "Binary" feel),
   fixed timestep so a tap sequence replays identically anywhere.

   Level extras handled here:
   - planet.move = { ax, ay, f, ph }: the planet drifts around its base
     position, offset = (ax, ay) * sin(2*pi*f*t + ph). Deterministic in t.
   - level.gates = [{x, y, r}]: rings that must all be touched (any order)
     before the goal counts.
   - planet.g: pull strength multiplier (giants > 1, light planets < 1,
     repulsors < 0: they push instead of pull).
   - level.moons = [{x, y, r, move?}]: inert bodies, never in the tap order
     and never pulling; touching one is fatal like a planet.
   - level.holes = [{a: {x, y}, b: {x, y}, r}]: wormholes. Entering one end
     moves the orb to the other, velocity unchanged; that hole is inert
     until the orb has left both ends.
   - wall.blink = { on, off, ph }: a pulsar wall, solid only for `on` s of
     every on+off cycle (shifted by ph).
   - level.ordered: gates count only in array order (numbered in the game).
   - goal.move: the goal drifts like a planet.
   - wall.bounce: the orb rebounds off this wall instead of crashing.
   - level.wrap: leaving one screen edge brings the orb in at the opposite
     one (never "lost to space"). */
(function (root) {
  const P = {
    W: 420, H: 640,
    G: 800,           // px/s^2 pull toward the active planet
    MAXV: 460,        // speed clamp per axis
    DAMP: 0.55,       // momentum kept on a flip (reversal registers instantly)
    BOUNCE: 0.9,      // speed kept by a rebound off a bouncy wall
    ORB_R: 11,
    DT: 1 / 120,      // fixed step
    TIME_LIMIT: 16,   // s before a run is called "lost to space"
    STEPS_PER_SLOT: 12, // solver tap granularity = 0.1 s

    make(level) {
      return {
        x: level.start.x, y: level.start.y,
        vx: level.v0 ? level.v0.x : 0, vy: level.v0 ? level.v0.y : 0,
        active: level.active || 0,
        taps: 0, t: 0, got: 0, hole: -1, bounces: 0, wraps: 0,
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
    planetPos(level, i, t) { return P.bodyPos(level.planets[i], t); },
    bodyPos(p, t) {
      if (!p.move) return p;
      const k = Math.sin(6.283185307179586 * p.move.f * t + (p.move.ph || 0));
      return { x: p.x + p.move.ax * k, y: p.y + p.move.ay * k, r: p.r };
    },

    wallOn(w, t) {
      if (!w.blink) return true;
      const per = w.blink.on + w.blink.off;
      return ((t + (w.blink.ph || 0)) % per + per) % per < w.blink.on;
    },
    // gate i is touched at (x, y): does it count yet?
    gateOpen(level, s, i) { return !level.ordered || s.got === (1 << i) - 1; },

    allGates(level) { return level.gates ? (1 << level.gates.length) - 1 : 0; },

    step(s, level) {
      if (s.status !== "live") return s.status;
      const dt = P.DT;
      const tp = P.planetPos(level, s.active, s.t);
      const dx = tp.x - s.x, dy = tp.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const pull = P.G * (level.planets[s.active].g || 1);
      s.vx += (dx / len) * pull * dt;
      s.vy += (dy / len) * pull * dt;
      if (s.vx > P.MAXV) s.vx = P.MAXV; else if (s.vx < -P.MAXV) s.vx = -P.MAXV;
      if (s.vy > P.MAXV) s.vy = P.MAXV; else if (s.vy < -P.MAXV) s.vy = -P.MAXV;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.t += dt;

      const r = P.ORB_R;
      if (level.holes) {
        if (s.hole >= 0) {   // re-arm once clear of both ends
          const h = level.holes[s.hole], m = (h.r + r) ** 2;
          if ((s.x - h.a.x) ** 2 + (s.y - h.a.y) ** 2 > m && (s.x - h.b.x) ** 2 + (s.y - h.b.y) ** 2 > m) s.hole = -1;
        }
        for (let i = 0; i < level.holes.length; i++) {
          if (i === s.hole) continue;
          const h = level.holes[i], rr = h.r * h.r;
          let from = null, to = null;
          if ((s.x - h.a.x) ** 2 + (s.y - h.a.y) ** 2 < rr) { from = h.a; to = h.b; }
          else if ((s.x - h.b.x) ** 2 + (s.y - h.b.y) ** 2 < rr) { from = h.b; to = h.a; }
          if (from) { s.x += to.x - from.x; s.y += to.y - from.y; s.hole = i; break; }
        }
      }
      if (level.gates) for (let i = 0; i < level.gates.length; i++) {
        const gt = level.gates[i];
        if ((s.x - gt.x) ** 2 + (s.y - gt.y) ** 2 < gt.r * gt.r && P.gateOpen(level, s, i)) s.got |= 1 << i;
      }
      // goal first: touching the ring counts even if a hazard is adjacent
      const g = P.bodyPos(level.goal, s.t);
      if (s.got === P.allGates(level) && (s.x - g.x) ** 2 + (s.y - g.y) ** 2 < g.r * g.r) { s.status = "won"; return s.status; }

      if (level.wrap) {
        const ox = s.x, oy = s.y;
        if (s.x < -r) s.x += P.W + 2 * r; else if (s.x > P.W + r) s.x -= P.W + 2 * r;
        if (s.y < -r) s.y += P.H + 2 * r; else if (s.y > P.H + r) s.y -= P.H + 2 * r;
        if (s.x !== ox || s.y !== oy) s.wraps++;
      } else if (s.x < -r || s.x > P.W + r || s.y < -r || s.y > P.H + r) { s.status = "lost"; s.why = "space"; return s.status; }
      for (let i = 0; i < level.planets.length; i++) {
        const p = P.planetPos(level, i, s.t);
        const rr = p.r + r;
        if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < rr * rr) { s.status = "lost"; s.why = "planet"; return s.status; }
      }
      if (level.moons) for (const m of level.moons) {
        const p = P.bodyPos(m, s.t), rr = p.r + r;
        if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < rr * rr) { s.status = "lost"; s.why = "planet"; return s.status; }
      }
      if (level.walls) for (const w of level.walls) {
        if (w.blink && !P.wallOn(w, s.t)) continue;
        const cx = Math.max(w.x, Math.min(s.x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(s.y, w.y + w.h));
        if (w.bounce) {
          let nx = s.x - cx, ny = s.y - cy, d = Math.hypot(nx, ny);
          if (d >= r) continue;
          if (d < 1e-6) {   // centre inside the slab: push out the shallowest side
            const pen = [s.x - w.x, w.x + w.w - s.x, s.y - w.y, w.y + w.h - s.y], k = pen.indexOf(Math.min(...pen));
            nx = [-1, 1, 0, 0][k]; ny = [0, 0, -1, 1][k];
            s.x = k === 0 ? w.x - r : k === 1 ? w.x + w.w + r : s.x; s.y = k === 2 ? w.y - r : k === 3 ? w.y + w.h + r : s.y;
          } else { nx /= d; ny /= d; s.x = cx + nx * r; s.y = cy + ny * r; }
          const vn = s.vx * nx + s.vy * ny;
          if (vn < 0) { s.vx -= (1 + P.BOUNCE) * vn * nx; s.vy -= (1 + P.BOUNCE) * vn * ny; s.bounces++; }
          continue;
        }
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
