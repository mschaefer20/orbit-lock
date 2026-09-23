/* Hand-made opening levels (1-16). tools/gen.js prepends these to the
   generated set and writes levels.js. Edit here, then re-run the generator. */
const HANDMADE = [
  { name: "Drop", taps: 0, par: 0, hint: "Tap to launch. Gravity does the rest.",
    start: { x: 210, y: 110 }, active: 0,
    planets: [{ x: 210, y: 540, r: 36 }],
    goal: { x: 210, y: 360, r: 26 } },

  { name: "Flip", taps: 2, par: 1, hint: "Tap again to switch which planet pulls you.",
    start: { x: 210, y: 100 }, active: 0,
    planets: [{ x: 70, y: 330, r: 30 }, { x: 300, y: 330, r: 30 }],
    goal: { x: 350, y: 450, r: 34 } },

  { name: "Moons", taps: 2, par: 1, hint: "You start in orbit. Break it when the time is right.",
    start: { x: 50, y: 330 }, v0: { x: 0, y: -260 }, active: 1,
    planets: [{ x: 180, y: 130, r: 26 }, { x: 180, y: 330, r: 26 }, { x: 180, y: 530, r: 26 }],
    goal: { x: 250, y: 510, r: 26 } },

  { name: "Slingshot", taps: 2, par: 1,
    start: { x: 60, y: 330 }, v0: { x: 0, y: -300 }, active: 0,
    planets: [{ x: 210, y: 330, r: 34 }, { x: 360, y: 560, r: 28 }],
    goal: { x: 300, y: 560, r: 26 } },

  { name: "Swing", taps: 3, par: 2, hint: "The dashed ring marks who pulls next.",
    start: { x: 210, y: 100 }, active: 0,
    planets: [{ x: 70, y: 330, r: 30 }, { x: 350, y: 330, r: 30 }],
    goal: { x: 50, y: 430, r: 26 } },

  { name: "Eclipse", taps: 3, par: 2,
    start: { x: 60, y: 540 }, v0: { x: 0, y: -340 }, active: 0,
    planets: [{ x: 230, y: 360, r: 52 }, { x: 360, y: 110, r: 24 }],
    goal: { x: 130, y: 390, r: 26 } },

  { name: "Triangle", taps: 3, par: 2,
    start: { x: 210, y: 70 }, active: 0,
    planets: [{ x: 80, y: 360, r: 30 }, { x: 340, y: 360, r: 30 }, { x: 210, y: 590, r: 30 }],
    goal: { x: 210, y: 470, r: 24 } },

  { name: "Hook", taps: 3, par: 2,
    start: { x: 60, y: 60 }, active: 0,
    planets: [{ x: 330, y: 200, r: 30 }, { x: 110, y: 460, r: 30 }],
    goal: { x: 350, y: 275, r: 24 },
    walls: [{ x: 200, y: 330, w: 220, h: 16 }, { x: 200, y: 330, w: 16, h: 130 }] },

  { name: "Binary", taps: 2, par: 1,
    start: { x: 40, y: 320 }, v0: { x: 0, y: -300 }, active: 0,
    planets: [{ x: 210, y: 180, r: 34 }, { x: 210, y: 460, r: 34 }],
    goal: { x: 380, y: 320, r: 28 } },

  { name: "Comet", taps: 2, par: 1,
    start: { x: 40, y: 600 }, v0: { x: 300, y: -520 }, active: 0,
    planets: [{ x: 300, y: 220, r: 34 }, { x: 90, y: 300, r: 26 }],
    goal: { x: 130, y: 175, r: 28 } },

  { name: "Underpass", taps: 4, par: 3,
    start: { x: 60, y: 90 }, active: 0,
    planets: [{ x: 210, y: 300, r: 36 }, { x: 360, y: 120, r: 26 }, { x: 210, y: 600, r: 26 }],
    goal: { x: 210, y: 402, r: 24 },
    walls: [{ x: 0, y: 370, w: 150, h: 18 }, { x: 270, y: 370, w: 150, h: 18 }] },

  { name: "Corridor", taps: 4, par: 3,
    start: { x: 210, y: 50 }, active: 0,
    planets: [{ x: 60, y: 200, r: 26 }, { x: 360, y: 200, r: 26 }, { x: 60, y: 480, r: 26 }, { x: 360, y: 480, r: 26 }],
    goal: { x: 210, y: 600, r: 24 },
    walls: [{ x: 140, y: 330, w: 140, h: 16 }] },

  { name: "Diamond", taps: 4, par: 3,
    start: { x: 210, y: 40 }, active: 0,
    planets: [{ x: 60, y: 320, r: 26 }, { x: 210, y: 150, r: 26 }, { x: 360, y: 320, r: 26 }, { x: 210, y: 500, r: 26 }],
    goal: { x: 210, y: 330, r: 24 },
    walls: [{ x: 150, y: 250, w: 120, h: 14 }] },

  { name: "Pinball", taps: 3, par: 2,
    start: { x: 210, y: 40 }, active: 0,
    planets: [{ x: 90, y: 180, r: 24 }, { x: 330, y: 300, r: 24 }, { x: 90, y: 420, r: 24 }, { x: 330, y: 540, r: 24 }],
    goal: { x: 60, y: 600, r: 24 } },

  { name: "Spiral", taps: 4, par: 3,
    start: { x: 210, y: 320 }, v0: { x: 0, y: -380 }, active: 0,
    planets: [{ x: 210, y: 120, r: 26 }, { x: 380, y: 320, r: 26 }, { x: 210, y: 520, r: 26 }, { x: 40, y: 320, r: 26 }],
    goal: { x: 80, y: 560, r: 26 } },

  { name: "Cradle", taps: 3, par: 2,
    start: { x: 210, y: 90 }, active: 0,
    planets: [{ x: 50, y: 330, r: 28 }, { x: 370, y: 330, r: 28 }],
    goal: { x: 210, y: 480, r: 26 },
    walls: [{ x: 150, y: 400, w: 120, h: 16 }] },
];
if (typeof module !== "undefined") module.exports = HANDMADE;
